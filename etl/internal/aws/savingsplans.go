package aws

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"
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

// AttachSavingsPlans streams a region's AWSComputeSavingsPlan file and adds the EC2
// rates of each Compute and EC2 Instance Savings Plan to the matching instances.
// A rate matches an instance on usage type plus operation.
func AttachSavingsPlans(r io.Reader, insts []Instance) error {
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
		return err
	}
	for dec.More() {
		key, err := stringToken(dec)
		if err != nil {
			return err
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
						if rt.Service != "AmazonEC2" {
							continue
						}
						h, err := strconv.ParseFloat(rt.Rate.Price, 64)
						if err != nil {
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
			return fmt.Errorf("savings plans %s: %w", key, err)
		}
	}
	for i := range insts {
		sortSP(insts[i].SP)
	}
	return nil
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
