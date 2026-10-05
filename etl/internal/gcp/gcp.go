// Package gcp reads the Cloud Billing Catalog API and writes one price file per region.
package gcp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"

	"github.com/Rayhanbintang/csps-calc-code/etl/internal/httpx"
)

// Services are the catalog services the calculator prices, by service ID.
var Services = map[string]string{
	"6F81-5844-456A": "compute",
	"95FF-2EF5-5EA1": "storage",
	"9662-B51E-5089": "sql",
	"5AF5-2C11-D467": "redis",
	"CCD8-9BF1-090E": "gke",
	"152E-C115-5142": "run",
	"29E7-DA93-CA13": "functions",
	"36A9-155B-23F0": "apigw",
	"5490-F7B7-8DF6": "logging",
	"58CD-E7C3-72CA": "monitoring",
	"A1E8-BE35-7EBC": "pubsub",
	"D97E-AB26-5D95": "filestore",
	"E505-1604-58F8": "networking",
	"FA26-5236-B8B5": "dns",
}

// Row is one SKU in a slim form. Tiers are [start, usd] pairs: the price applies from
// "start" units upward until the next tier starts.
type Row struct {
	Svc   string       `json:"s"`
	Desc  string       `json:"d"`
	Group string       `json:"g,omitempty"`
	Usage string       `json:"u"`
	Unit  string       `json:"n"`
	Tiers [][2]float64 `json:"t"`
}

type sku struct {
	Description string `json:"description"`
	Category    struct {
		ResourceFamily string `json:"resourceFamily"`
		ResourceGroup  string `json:"resourceGroup"`
		UsageType      string `json:"usageType"`
	} `json:"category"`
	ServiceRegions []string `json:"serviceRegions"`
	PricingInfo    []struct {
		PricingExpression struct {
			UsageUnit   string `json:"usageUnit"`
			TieredRates []struct {
				StartUsageAmount float64 `json:"startUsageAmount"`
				UnitPrice        struct {
					Units string `json:"units"`
					Nanos int64  `json:"nanos"`
				} `json:"unitPrice"`
			} `json:"tieredRates"`
		} `json:"pricingExpression"`
	} `json:"pricingInfo"`
}

// noise matches SKUs the calculator never prices: spot, sole tenancy, GPUs and other
// specialised capacity. Dropping them keeps each region file small.
var noise = regexp.MustCompile(`(?i)preemptible|spot |sole tenancy|confidential|custom extended|gpu|tpu|nvidia|` +
	`free with promotional|extended support|dws |reservation|flex-start|calendar mode|mps |cross-cloud|` +
	`app engine|bare metal|sap |marketplace`)

func keep(s sku) bool {
	u := s.Category.UsageType
	if u != "OnDemand" && u != "Commit1Yr" && u != "Commit3Yr" {
		return false
	}
	switch s.Category.ResourceGroup {
	case "GPU", "TPU", "LocalSSD":
		return false
	}
	return !noise.MatchString(s.Description)
}

// regionalMax is the most regions a SKU may list and still count as regional. SKUs sold
// in more regions at one price (licences, DNS, Pub/Sub) go to global.json once.
const regionalMax = 8

// cityOf finds the region in "E2 Instance Core running in Jakarta". The catalog's own
// names are uneven ("APAC" for Taiwan), so known regions take their name from cities.
var cityOf = regexp.MustCompile(`^E2 Instance Core running in (.+)$`)

var cities = map[string]string{
	"africa-south1": "Johannesburg", "asia-east1": "Taiwan", "asia-east2": "Hong Kong",
	"asia-northeast1": "Tokyo", "asia-northeast2": "Osaka", "asia-northeast3": "Seoul",
	"asia-south1": "Mumbai", "asia-south2": "Delhi", "asia-southeast1": "Singapore",
	"asia-southeast2": "Jakarta", "asia-southeast3": "Bangkok", "australia-southeast1": "Sydney",
	"australia-southeast2": "Melbourne", "europe-central2": "Warsaw", "europe-north1": "Finland",
	"europe-north2": "Stockholm", "europe-southwest1": "Madrid", "europe-west1": "Belgium",
	"europe-west2": "London", "europe-west3": "Frankfurt", "europe-west4": "Netherlands",
	"europe-west6": "Zurich", "europe-west8": "Milan", "europe-west9": "Paris",
	"europe-west10": "Berlin", "europe-west12": "Turin", "me-central1": "Doha",
	"me-central2": "Dammam", "me-west1": "Tel Aviv", "northamerica-northeast1": "Montreal",
	"northamerica-northeast2": "Toronto", "northamerica-south1": "Queretaro",
	"southamerica-east1": "Sao Paulo", "southamerica-west1": "Santiago", "us-central1": "Iowa",
	"us-east1": "South Carolina", "us-east4": "Northern Virginia", "us-east5": "Columbus",
	"us-south1": "Dallas", "us-west1": "Oregon", "us-west2": "Los Angeles",
	"us-west3": "Salt Lake City", "us-west4": "Las Vegas",
}

// Fetch downloads every service, writes <region>.json and global.json, and returns the
// region list as [code, name] pairs plus the file names written.
func Fetch(ctx context.Context, write func(string, any) error) ([][2]string, []string, error) {
	key := os.Getenv("GCP_BILLING_API_KEY")
	if key == "" {
		return nil, nil, fmt.Errorf("GCP_BILLING_API_KEY is not set")
	}
	byRegion := map[string][]Row{}
	names := map[string]string{}

	ids := make([]string, 0, len(Services))
	for id := range Services {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		skus, err := listSKUs(ctx, key, id)
		if err != nil {
			return nil, nil, fmt.Errorf("%s: %w", Services[id], err)
		}
		if len(skus) == 0 {
			return nil, nil, fmt.Errorf("%s: catalog returned no SKUs", Services[id])
		}
		for _, s := range skus {
			// us-central1, us-east1 and us-west1 share one E2 SKU named "Americas", so a
			// region counts as having VMs when any E2 core SKU lists it.
			if len(s.ServiceRegions) <= regionalMax && s.Category.UsageType == "OnDemand" {
				if m := cityOf.FindStringSubmatch(s.Description); m != nil {
					for _, code := range s.ServiceRegions {
						names[code] = m[1]
						if c, ok := cities[code]; ok {
							names[code] = c
						}
					}
				}
			}
			if !keep(s) || len(s.PricingInfo) == 0 {
				continue
			}
			pe := s.PricingInfo[0].PricingExpression
			row := Row{Svc: Services[id], Desc: strings.TrimSpace(s.Description), Group: s.Category.ResourceGroup,
				Usage: s.Category.UsageType, Unit: pe.UsageUnit}
			for _, t := range pe.TieredRates {
				var units float64
				fmt.Sscan(t.UnitPrice.Units, &units)
				row.Tiers = append(row.Tiers, [2]float64{t.StartUsageAmount, units + float64(t.UnitPrice.Nanos)/1e9})
			}
			if len(row.Tiers) == 0 {
				continue
			}
			regions := s.ServiceRegions
			if len(regions) > regionalMax {
				regions = []string{"global"}
			}
			for _, r := range regions {
				byRegion[r] = append(byRegion[r], row)
			}
		}
	}

	// Spot-check regions that must always be present; a miss means the catalog or the
	// region detection changed shape.
	for _, code := range []string{"us-central1", "us-east1", "asia-southeast2", "europe-west1"} {
		if names[code] == "" || len(byRegion[code]) == 0 {
			return nil, nil, fmt.Errorf("region %s missing from the catalog output", code)
		}
	}

	var regions [][2]string
	var files []string
	for code, rows := range byRegion {
		if code != "global" && names[code] == "" {
			continue // not a region with VMs (multi-region buckets, "us", "eu", ...)
		}
		sort.Slice(rows, func(i, j int) bool {
			if rows[i].Svc != rows[j].Svc {
				return rows[i].Svc < rows[j].Svc
			}
			return rows[i].Desc < rows[j].Desc
		})
		if err := write(code+".json", rows); err != nil {
			return nil, nil, err
		}
		files = append(files, code+".json")
		if code != "global" {
			regions = append(regions, [2]string{code, names[code]})
		}
	}
	sort.Slice(regions, func(i, j int) bool { return regions[i][0] < regions[j][0] })
	if len(regions) < 20 {
		return nil, nil, fmt.Errorf("only %d regions found; catalog looks incomplete", len(regions))
	}
	return regions, files, nil
}

func listSKUs(ctx context.Context, key, service string) ([]sku, error) {
	var all []sku
	token := ""
	for {
		url := fmt.Sprintf("https://cloudbilling.googleapis.com/v1/services/%s/skus?currencyCode=USD&pageSize=5000&pageToken=%s", service, token)
		var page struct {
			SKUs          []sku  `json:"skus"`
			NextPageToken string `json:"nextPageToken"`
		}
		err := httpx.Stream(ctx, url, http.Header{"X-Goog-Api-Key": {key}}, func(r io.Reader) error {
			page.SKUs, page.NextPageToken = nil, ""
			return json.NewDecoder(r).Decode(&page)
		})
		if err != nil {
			return nil, err
		}
		all = append(all, page.SKUs...)
		if page.NextPageToken == "" {
			return all, nil
		}
		token = page.NextPageToken
	}
}
