// Package azure reads Microsoft's public Azure Retail Prices API
// (prices.azure.com/api/retail/prices, no sign-in) and writes one price file per region
// plus global.json for services priced once for all regions or per billing zone.
package azure

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strings"
	"sync"

	"github.com/Rayhanbintang/csps-calc-code/etl/internal/httpx"
)

const api = "https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview"

// Regions are Azure's public regions with VM prices, kept by hand (armRegionName and
// display name). A region that returns no VM rows is skipped with a log line.
var Regions = [][2]string{
	{"australiacentral", "Australia Central"}, {"australiaeast", "Australia East"}, {"australiasoutheast", "Australia Southeast"},
	{"brazilsouth", "Brazil South"}, {"canadacentral", "Canada Central"}, {"canadaeast", "Canada East"},
	{"centralindia", "Central India"}, {"centralus", "Central US"}, {"eastasia", "East Asia (Hong Kong)"},
	{"eastus", "East US (Virginia)"}, {"eastus2", "East US 2 (Virginia)"}, {"francecentral", "France Central (Paris)"},
	{"germanywestcentral", "Germany West Central (Frankfurt)"}, {"indonesiacentral", "Indonesia Central (Jakarta)"},
	{"israelcentral", "Israel Central"}, {"italynorth", "Italy North (Milan)"}, {"japaneast", "Japan East (Tokyo)"},
	{"japanwest", "Japan West (Osaka)"}, {"koreacentral", "Korea Central (Seoul)"}, {"koreasouth", "Korea South (Busan)"},
	{"malaysiawest", "Malaysia West (Kuala Lumpur)"}, {"mexicocentral", "Mexico Central (Queretaro)"},
	{"newzealandnorth", "New Zealand North (Auckland)"}, {"northcentralus", "North Central US (Illinois)"},
	{"northeurope", "North Europe (Ireland)"}, {"norwayeast", "Norway East (Oslo)"}, {"polandcentral", "Poland Central (Warsaw)"},
	{"qatarcentral", "Qatar Central (Doha)"}, {"southafricanorth", "South Africa North (Johannesburg)"},
	{"southcentralus", "South Central US (Texas)"}, {"southeastasia", "Southeast Asia (Singapore)"},
	{"southindia", "South India (Chennai)"}, {"spaincentral", "Spain Central (Madrid)"}, {"swedencentral", "Sweden Central"},
	{"switzerlandnorth", "Switzerland North (Zurich)"}, {"uaenorth", "UAE North (Dubai)"}, {"uksouth", "UK South (London)"},
	{"ukwest", "UK West (Cardiff)"}, {"westcentralus", "West Central US (Wyoming)"}, {"westeurope", "West Europe (Netherlands)"},
	{"westindia", "West India (Mumbai)"}, {"westus", "West US (California)"}, {"westus2", "West US 2 (Washington)"},
	{"westus3", "West US 3 (Arizona)"},
}

// regional are the services read per region.
var regional = []string{
	"Virtual Machines", "Storage", "Azure Kubernetes Service", "Container Instances", "Azure Container Apps", "Functions",
	"Azure Database for MySQL", "Azure Database for PostgreSQL", "SQL Database", "Redis Cache", "Application Gateway",
	"Bandwidth", "VPN Gateway", "ExpressRoute", "Azure DDOS Protection", "API Management", "Service Bus", "Event Grid",
	"Notification Hubs", "Azure Monitor", "Log Analytics", "Backup",
}

// global are the services priced under "Global", "" or a billing zone ("Zone 1").
var global = []string{"Load Balancer", "NAT Gateway", "Virtual Network", "Azure DNS", "ExpressRoute", "Azure Front Door Service"}

// vmLicences are the per-VM-size licence products the VM pricer reads.
var vmLicences = []string{
	"SQL Server Standard", "SQL Server Enterprise", "SQL Server Web",
	"Red Hat Enterprise Linux", "SUSE Linux Enterprise Server Standard", "Ubuntu Pro",
}

// dedupe drops rows that repeat exactly; the API lists some billing-zone meters twice.
func dedupe(rows []Row) []Row {
	seen := map[string]bool{}
	out := rows[:0]
	for _, r := range rows {
		b, _ := json.Marshal(r)
		if seen[string(b)] {
			continue
		}
		seen[string(b)] = true
		out = append(out, r)
	}
	return out
}

// Row is one meter in a slim form.
type Row struct {
	Service string       `json:"s"`
	Product string       `json:"p"`
	Sku     string       `json:"k"`
	ArmSku  string       `json:"a,omitempty"` // VM size, e.g. Standard_D2s_v5
	Meter   string       `json:"m"`
	Unit    string       `json:"u"`
	Type    string       `json:"t"`           // "c" pay as you go, "r" reservation (price is for the whole term)
	Years   int          `json:"y,omitempty"` // reservation term
	Price   float64      `json:"r"`
	From    float64      `json:"f,omitempty"`  // tier: the price applies from this many units
	Zone    string       `json:"z,omitempty"`  // global.json: "Global", "Zone 1", ...
	SP      [][2]float64 `json:"sp,omitempty"` // savings plan: [years, hourly]
}

type item struct {
	ServiceName   string  `json:"serviceName"`
	ProductName   string  `json:"productName"`
	SkuName       string  `json:"skuName"`
	ArmSkuName    string  `json:"armSkuName"`
	MeterName     string  `json:"meterName"`
	Unit          string  `json:"unitOfMeasure"`
	Type          string  `json:"type"`
	Term          string  `json:"reservationTerm"`
	RetailPrice   float64 `json:"retailPrice"`
	TierMin       float64 `json:"tierMinimumUnits"`
	ArmRegionName string  `json:"armRegionName"`
	Currency      string  `json:"currencyCode"`
	SavingsPlan   []struct {
		RetailPrice float64 `json:"retailPrice"`
		Term        string  `json:"term"`
	} `json:"savingsPlan"`
}

func years(term string) int {
	switch {
	case strings.HasPrefix(term, "1 "):
		return 1
	case strings.HasPrefix(term, "3 "):
		return 3
	case strings.HasPrefix(term, "5 "):
		return 5
	}
	return 0
}

// slim keeps pay-as-you-go and reservation meters, and drops Spot, Low Priority and
// Dev/Test prices, which the calculator does not offer. Storage keeps disks, blobs and
// files only.
func slim(it item) (Row, bool) {
	if it.Currency != "" && it.Currency != "USD" {
		return Row{}, false
	}
	var t string
	switch it.Type {
	case "Consumption":
		t = "c"
	case "Reservation":
		t = "r"
	default:
		return Row{}, false
	}
	if strings.Contains(it.SkuName, "Spot") || strings.Contains(it.SkuName, "Low Priority") {
		return Row{}, false
	}
	if it.ServiceName == "Storage" {
		p := it.ProductName
		if !(strings.Contains(p, "Managed Disks") || strings.Contains(p, "Premium SSD v2") || p == "General Block Blob v2" || strings.Contains(p, "Files")) {
			return Row{}, false
		}
	}
	r := Row{Service: it.ServiceName, Product: it.ProductName, Sku: it.SkuName, Meter: it.MeterName, Unit: it.Unit, Type: t, Price: it.RetailPrice, From: it.TierMin}
	if it.ServiceName == "Virtual Machines" {
		r.ArmSku = it.ArmSkuName
	}
	if t == "r" {
		r.Years = years(it.Term)
	}
	for _, sp := range it.SavingsPlan {
		if y := years(sp.Term); y > 0 {
			r.SP = append(r.SP, [2]float64{float64(y), sp.RetailPrice})
		}
	}
	sort.Slice(r.SP, func(i, j int) bool { return r.SP[i][0] < r.SP[j][0] })
	return r, true
}

// query reads every page of one filter.
func query(ctx context.Context, filter string) ([]item, error) {
	// The API reads "+" literally, so spaces must be %20.
	next := api + "&$filter=" + strings.ReplaceAll(url.QueryEscape(filter), "+", "%20")
	var all []item
	for next != "" {
		var page struct {
			Items []item `json:"Items"`
			Next  string `json:"NextPageLink"`
		}
		err := httpx.Stream(ctx, next, nil, func(r io.Reader) error {
			page.Items, page.Next = nil, ""
			return json.NewDecoder(r).Decode(&page)
		})
		if err != nil {
			return nil, err
		}
		all = append(all, page.Items...)
		next = page.Next
	}
	return all, nil
}

func anyOf(field string, values []string) string {
	parts := make([]string, len(values))
	for i, v := range values {
		parts[i] = fmt.Sprintf("%s eq '%s'", field, v)
	}
	return "(" + strings.Join(parts, " or ") + ")"
}

// Fetch writes <region>.json for each region and global.json. One region failing fails
// the fetch, so the caller can fall back to the live files.
func Fetch(ctx context.Context, write func(string, any) error) ([][2]string, []string, error) {
	type result struct {
		code, name string
		ok         bool
		err        error
	}
	results := make([]result, len(Regions))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, reg := range Regions {
		wg.Add(1)
		go func(i int, code, name string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			// The API refuses filters with much more than a dozen "or" terms, so the
			// services go in groups.
			var items []item
			for start := 0; start < len(regional); start += 8 {
				group := regional[start:min(start+8, len(regional))]
				got, err := query(ctx, fmt.Sprintf("armRegionName eq '%s' and %s", code, anyOf("serviceName", group)))
				if err != nil {
					results[i] = result{code: code, err: err}
					return
				}
				items = append(items, got...)
			}
			var rows []Row
			vms := 0
			for _, it := range items {
				if r, ok := slim(it); ok {
					rows = append(rows, r)
					if r.Service == "Virtual Machines" {
						vms++
					}
				}
			}
			if vms == 0 {
				results[i] = result{code: code} // not a VM region (yet): skip it
				return
			}
			results[i] = result{code: code, name: name, ok: true, err: write(code+".json", rows)}
		}(i, reg[0], reg[1])
	}
	wg.Wait()

	var regions [][2]string
	files := []string{"global.json"}
	for _, r := range results {
		if r.err != nil {
			return nil, files, fmt.Errorf("%s: %w", r.code, r.err)
		}
		if r.ok {
			regions = append(regions, [2]string{r.code, r.name})
			files = append(files, r.code+".json")
		}
	}
	if len(regions) < 10 {
		return nil, files, fmt.Errorf("only %d regions have VM prices", len(regions))
	}

	items, err := query(ctx, fmt.Sprintf("(armRegionName eq 'Global' or armRegionName eq '' or startswith(armRegionName, 'Zone ')) and %s", anyOf("serviceName", global)))
	if err != nil {
		return nil, files, fmt.Errorf("global: %w", err)
	}
	var rows []Row
	for _, it := range items {
		if r, ok := slim(it); ok {
			r.Zone = it.ArmRegionName
			if r.Zone == "" {
				r.Zone = "Global"
			}
			rows = append(rows, r)
		}
	}
	// Licences sold once for all regions: SQL Server and Linux distributions on VMs (per VM
	// size), and the SQL licence of SQL Database (per vCore; the regional meter is compute only).
	for _, f := range []string{
		"serviceName eq 'Virtual Machines Licenses' and " + anyOf("productName", vmLicences),
		"serviceName eq 'SQL Database' and armRegionName eq 'Global' and contains(productName, 'SQL License')",
	} {
		lic, err := query(ctx, f)
		if err != nil {
			return nil, files, fmt.Errorf("licences: %w", err)
		}
		for _, it := range lic {
			if r, ok := slim(it); ok {
				r.Zone = "Global"
				rows = append(rows, r)
			}
		}
	}
	rows = dedupe(rows)
	if err := write("global.json", rows); err != nil {
		return nil, files, err
	}
	return regions, files, nil
}
