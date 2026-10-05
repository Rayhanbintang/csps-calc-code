// Package oci reads Oracle's public price list. OCI charges the same price in every
// commercial region, so one file serves all regions.
package oci

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"

	"github.com/Rayhanbintang/csps-calc-code/etl/internal/httpx"
)

const listURL = "https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD"

// Regions are OCI's public commercial regions. Oracle publishes no machine-readable
// list without an account, so this one is kept by hand from Oracle's region page.
var Regions = [][2]string{
	{"af-johannesburg-1", "Johannesburg"}, {"ap-batam-1", "Batam"}, {"ap-chuncheon-1", "Chuncheon"},
	{"ap-hyderabad-1", "Hyderabad"}, {"ap-melbourne-1", "Melbourne"}, {"ap-mumbai-1", "Mumbai"},
	{"ap-osaka-1", "Osaka"}, {"ap-seoul-1", "Seoul"}, {"ap-singapore-1", "Singapore"},
	{"ap-singapore-2", "Singapore West"}, {"ap-sydney-1", "Sydney"}, {"ap-tokyo-1", "Tokyo"},
	{"ca-montreal-1", "Montreal"}, {"ca-toronto-1", "Toronto"}, {"eu-amsterdam-1", "Amsterdam"},
	{"eu-frankfurt-1", "Frankfurt"}, {"eu-madrid-1", "Madrid"}, {"eu-marseille-1", "Marseille"},
	{"eu-milan-1", "Milan"}, {"eu-paris-1", "Paris"}, {"eu-stockholm-1", "Stockholm"},
	{"eu-zurich-1", "Zurich"}, {"il-jerusalem-1", "Jerusalem"}, {"me-abudhabi-1", "Abu Dhabi"},
	{"me-dubai-1", "Dubai"}, {"me-jeddah-1", "Jeddah"}, {"me-riyadh-1", "Riyadh"},
	{"mx-monterrey-1", "Monterrey"}, {"mx-queretaro-1", "Queretaro"}, {"sa-bogota-1", "Bogota"},
	{"sa-santiago-1", "Santiago"}, {"sa-saopaulo-1", "Sao Paulo"}, {"sa-valparaiso-1", "Valparaiso"},
	{"sa-vinhedo-1", "Vinhedo"}, {"uk-cardiff-1", "Cardiff"}, {"uk-london-1", "London"},
	{"us-ashburn-1", "Ashburn"}, {"us-chicago-1", "Chicago"}, {"us-phoenix-1", "Phoenix"},
	{"us-sanjose-1", "San Jose"},
}

// Row is one part number with its tiered pay-as-you-go price.
type Row struct {
	Part     string       `json:"p"`
	Name     string       `json:"n"`
	Metric   string       `json:"m"`
	Category string       `json:"c"`
	Tiers    [][3]float64 `json:"t"` // [from, to, usd]; to = -1 means no upper limit
}

// Fetch downloads the price list and writes prices.json.
func Fetch(ctx context.Context, write func(string, any) error) ([][2]string, []string, error) {
	var list struct {
		Items []struct {
			PartNumber  string `json:"partNumber"`
			DisplayName string `json:"displayName"`
			MetricName  string `json:"metricName"`
			Category    string `json:"serviceCategory"`
			Loc         []struct {
				CurrencyCode string `json:"currencyCode"`
				Prices       []struct {
					Model    string   `json:"model"`
					Value    float64  `json:"value"`
					RangeMin *float64 `json:"rangeMin"`
					RangeMax *float64 `json:"rangeMax"`
				} `json:"prices"`
			} `json:"currencyCodeLocalizations"`
		} `json:"items"`
	}
	err := httpx.Stream(ctx, listURL, nil, func(r io.Reader) error {
		list.Items = nil
		return json.NewDecoder(r).Decode(&list)
	})
	if err != nil {
		return nil, nil, err
	}
	var rows []Row
	for _, it := range list.Items {
		row := Row{Part: it.PartNumber, Name: it.DisplayName, Metric: it.MetricName, Category: it.Category}
		for _, l := range it.Loc {
			if l.CurrencyCode != "USD" {
				continue
			}
			for _, p := range l.Prices {
				if p.Model != "PAY_AS_YOU_GO" {
					continue
				}
				from, to := 0.0, -1.0
				if p.RangeMin != nil {
					from = *p.RangeMin
				}
				if p.RangeMax != nil && *p.RangeMax < 1e12 && *p.RangeMax < 999999999 {
					to = *p.RangeMax
				}
				row.Tiers = append(row.Tiers, [3]float64{from, to, p.Value})
			}
		}
		if len(row.Tiers) == 0 {
			continue
		}
		sort.Slice(row.Tiers, func(i, j int) bool { return row.Tiers[i][0] < row.Tiers[j][0] })
		rows = append(rows, row)
	}
	if len(rows) < 200 {
		return nil, nil, fmt.Errorf("only %d priced parts; list looks incomplete", len(rows))
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Part < rows[j].Part })
	if err := write("prices.json", rows); err != nil {
		return nil, nil, err
	}
	return Regions, []string{"prices.json"}, nil
}
