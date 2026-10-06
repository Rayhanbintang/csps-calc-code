package aws

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

type spProduct struct {
	SKU        string `json:"sku"`
	Family     string `json:"productFamily"`
	Attributes struct {
		PurchaseOption string `json:"purchaseOption"`
		PurchaseTerm   string `json:"purchaseTerm"`
	} `json:"attributes"`
}

type spTerm struct {
	SKU   string `json:"sku"`
	Rates []struct {
		UsageType string `json:"discountedUsageType"`
		Operation string `json:"discountedOperation"`
		Service   string `json:"discountedServiceCode"`
		Rate      struct {
			Price string `json:"price"`
		} `json:"discountedRate"`
	} `json:"rates"`
}

// UsageSP is the Compute Savings Plan rates for one Fargate or Lambda usage type, e.g.
// "Fargate-vCPU-Hours:perCPU" or "Lambda-GB-Second". Rates are per unit of that usage.
type UsageSP struct {
	Usage string   `json:"k"`
	SP    []SPRate `json:"sp"`
}

// spServices are the non-EC2 services a Compute Savings Plan covers.
var spServices = map[string]bool{"AmazonECS": true, "AWSLambda": true}

// AttachSavingsPlans streams a region's AWSComputeSavingsPlan file and adds the EC2
// rates of each Compute and EC2 Instance Savings Plan to the matching instances.
// A rate matches an instance on usage type plus operation. It also returns the Compute
// Savings Plan rates for Fargate and Lambda usage types, with the region prefix removed.
func AttachSavingsPlans(r io.Reader, insts []Instance, prefix string) ([]UsageSP, error) {
	other := map[string][]SPRate{}
	byKey := map[string][]int{}
	for i := range insts {
		k := insts[i].usage + "|" + insts[i].op
		byKey[k] = append(byKey[k], i)
	}

	type plan struct {
		kind, pay string
		years     int
	}
	plans := map[string]plan{}

	dec := json.NewDecoder(r)
	if err := expectDelim(dec, '{'); err != nil {
		return nil, err
	}
	for dec.More() {
		key, err := stringToken(dec)
		if err != nil {
			return nil, err
		}
		switch key {
		case "products":
			err = eachArray(dec, func() error {
				var p spProduct
				if err := dec.Decode(&p); err != nil {
					return err
				}
				kind := map[string]string{"ComputeSavingsPlans": "c", "EC2InstanceSavingsPlans": "e"}[p.Family]
				pay := map[string]string{"No Upfront": "no", "Partial Upfront": "partial", "All Upfront": "all"}[p.Attributes.PurchaseOption]
				if kind == "" || pay == "" {
					return nil
				}
				years := 1
				if p.Attributes.PurchaseTerm == "3yr" {
					years = 3
				}
				plans[p.SKU] = plan{kind, pay, years}
				return nil
			})
		case "terms":
			err = eachObject(dec, func(string) error {
				return eachArray(dec, func() error {
					var t spTerm
					if err := dec.Decode(&t); err != nil {
						return err
					}
					pl, ok := plans[t.SKU]
					if !ok {
						return nil
					}
					for _, rt := range t.Rates {
						h, err := strconv.ParseFloat(rt.Rate.Price, 64)
						if err != nil {
							continue
						}
						if spServices[rt.Service] && pl.kind == "c" {
							u := strings.TrimPrefix(rt.UsageType, prefix+"-")
							other[u] = append(other[u], SPRate{Kind: pl.kind, Term: pl.years, Pay: pl.pay, Hourly: h})
							continue
						}
						if rt.Service != "AmazonEC2" {
							continue
						}
						for _, i := range byKey[rt.UsageType+"|"+rt.Operation] {
							insts[i].SP = append(insts[i].SP, SPRate{Kind: pl.kind, Term: pl.years, Pay: pl.pay, Hourly: h})
						}
					}
					return nil
				})
			})
		default:
			err = skipValue(dec)
		}
		if err != nil {
			return nil, fmt.Errorf("savings plans %s: %w", key, err)
		}
	}
	for i := range insts {
		sortSP(insts[i].SP)
	}
	out := make([]UsageSP, 0, len(other))
	for u, sp := range other {
		sortSP(sp)
		out = append(out, UsageSP{Usage: u, SP: sp})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Usage < out[j].Usage })
	return out, nil
}

func sortSP(sp []SPRate) {
	order := map[string]int{"no": 0, "partial": 1, "all": 2}
	for i := 1; i < len(sp); i++ {
		for j := i; j > 0; j-- {
			a, b := sp[j-1], sp[j]
			less := b.Kind < a.Kind || (b.Kind == a.Kind && (b.Term < a.Term || (b.Term == a.Term && order[b.Pay] < order[a.Pay])))
			if !less {
				break
			}
			sp[j-1], sp[j] = b, a
		}
	}
}
