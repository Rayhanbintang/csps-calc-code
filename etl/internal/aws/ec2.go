// Package aws reads AWS Price List bulk files and slims them to what the calculator uses.
package aws

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

// Instance is one priced EC2 configuration: an instance type with one OS / licence combo.
type Instance struct {
	Type   string   `json:"t"`
	VCPU   int      `json:"c"`
	MemGiB float64  `json:"m"`
	OS     string   `json:"os"`           // Linux, Windows, RHEL, SUSE, ...
	SW     string   `json:"sw,omitempty"` // pre-installed software, e.g. "SQL Std"; empty = none
	BYOL   bool     `json:"byol,omitempty"`
	OnDem  float64  `json:"od"`           // USD per hour
	RI     []RIRate `json:"ri,omitempty"` // Reserved Instance options
}

// RIRate is one Reserved Instance offer: term, class and payment option.
type RIRate struct {
	Term    int     `json:"y"`  // years: 1 or 3
	Class   string  `json:"k"`  // "s" standard, "c" convertible
	Pay     string  `json:"p"`  // "no", "partial", "all" upfront
	Hourly  float64 `json:"h"`  // USD per hour
	Upfront float64 `json:"u"`  // USD once
}

type product struct {
	SKU           string `json:"sku"`
	ProductFamily string `json:"productFamily"`
	Attributes    struct {
		InstanceType    string `json:"instanceType"`
		VCPU            string `json:"vcpu"`
		Memory          string `json:"memory"`
		OperatingSystem string `json:"operatingSystem"`
		PreInstalledSw  string `json:"preInstalledSw"`
		LicenseModel    string `json:"licenseModel"`
		Tenancy         string `json:"tenancy"`
		CapacityStatus  string `json:"capacitystatus"`
		MarketOption    string `json:"marketoption"`
		Operation       string `json:"operation"`
	} `json:"attributes"`
}

type term struct {
	PriceDimensions map[string]struct {
		Unit         string            `json:"unit"`
		PricePerUnit map[string]string `json:"pricePerUnit"`
	} `json:"priceDimensions"`
	TermAttributes struct {
		LeaseContractLength string `json:"LeaseContractLength"`
		OfferingClass       string `json:"OfferingClass"`
		PurchaseOption      string `json:"PurchaseOption"`
	} `json:"termAttributes"`
}

// ParseEC2 streams one region's AmazonEC2 offer file and returns shared-tenancy,
// on-demand-capacity instances with their on-demand and Reserved prices.
func ParseEC2(r io.Reader) ([]Instance, error) {
	dec := json.NewDecoder(r)
	keep := map[string]*Instance{}

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
			if err := eachObject(dec, func(sku string) error {
				var p product
				if err := dec.Decode(&p); err != nil {
					return err
				}
				if inst, ok := wanted(p); ok {
					keep[sku] = inst
				}
				return nil
			}); err != nil {
				return nil, fmt.Errorf("products: %w", err)
			}
		case "terms":
			if err := eachObject(dec, func(kind string) error {
				return eachObject(dec, func(sku string) error {
					var offers map[string]term
					if err := dec.Decode(&offers); err != nil {
						return err
					}
					inst := keep[sku]
					if inst == nil {
						return nil
					}
					for _, t := range offers {
						applyTerm(inst, kind, t)
					}
					return nil
				})
			}); err != nil {
				return nil, fmt.Errorf("terms: %w", err)
			}
		default:
			var skip json.RawMessage
			if err := dec.Decode(&skip); err != nil {
				return nil, err
			}
		}
	}

	out := make([]Instance, 0, len(keep))
	for _, inst := range keep {
		if inst.OnDem <= 0 {
			continue // no on-demand price = not orderable as a normal VM here
		}
		sort.Slice(inst.RI, func(i, j int) bool {
			a, b := inst.RI[i], inst.RI[j]
			if a.Term != b.Term {
				return a.Term < b.Term
			}
			if a.Class != b.Class {
				return a.Class > b.Class
			}
			return a.Pay < b.Pay
		})
		out = append(out, *inst)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Type != out[j].Type {
			return out[i].Type < out[j].Type
		}
		if out[i].OS != out[j].OS {
			return out[i].OS < out[j].OS
		}
		if out[i].SW != out[j].SW {
			return out[i].SW < out[j].SW
		}
		return !out[i].BYOL && out[j].BYOL
	})
	return out, nil
}

func wanted(p product) (*Instance, bool) {
	a := p.Attributes
	if p.ProductFamily != "Compute Instance" || a.Tenancy != "Shared" ||
		a.CapacityStatus != "Used" || (a.MarketOption != "" && a.MarketOption != "OnDemand") {
		return nil, false
	}
	// "RunInstances:0002:box" and friends are the infrastructure-only half of a
	// licence-included SKU; the licence is billed on a separate line. The full price
	// a customer pays sits on the operation without ":box".
	if strings.HasSuffix(a.Operation, ":box") {
		return nil, false
	}
	vcpu, err := strconv.Atoi(a.VCPU)
	if err != nil {
		return nil, false
	}
	mem, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(strings.ReplaceAll(a.Memory, ",", ""), "GiB")), 64)
	if err != nil {
		return nil, false
	}
	sw := a.PreInstalledSw
	if sw == "NA" {
		sw = ""
	}
	return &Instance{
		Type:   a.InstanceType,
		VCPU:   vcpu,
		MemGiB: mem,
		OS:     a.OperatingSystem,
		SW:     sw,
		BYOL:   a.LicenseModel == "Bring your own license",
	}, true
}

func applyTerm(inst *Instance, kind string, t term) {
	var hourly, upfront float64
	for _, d := range t.PriceDimensions {
		v, _ := strconv.ParseFloat(d.PricePerUnit["USD"], 64)
		switch d.Unit {
		case "Hrs":
			hourly = v
		case "Quantity":
			upfront = v
		}
	}
	switch kind {
	case "OnDemand":
		inst.OnDem = hourly
	case "Reserved":
		ta := t.TermAttributes
		years := 1
		if ta.LeaseContractLength == "3yr" {
			years = 3
		}
		class := "s"
		if ta.OfferingClass == "convertible" {
			class = "c"
		}
		pay := map[string]string{"No Upfront": "no", "Partial Upfront": "partial", "All Upfront": "all"}[ta.PurchaseOption]
		if pay == "" {
			return
		}
		inst.RI = append(inst.RI, RIRate{Term: years, Class: class, Pay: pay, Hourly: hourly, Upfront: upfront})
	}
}

func expectDelim(dec *json.Decoder, want json.Delim) error {
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	if d, ok := tok.(json.Delim); !ok || d != want {
		return fmt.Errorf("expected %q, got %v", want, tok)
	}
	return nil
}

func stringToken(dec *json.Decoder) (string, error) {
	tok, err := dec.Token()
	if err != nil {
		return "", err
	}
	s, ok := tok.(string)
	if !ok {
		return "", fmt.Errorf("expected object key, got %v", tok)
	}
	return s, nil
}

// eachObject walks an object value key by key; fn must consume the value.
func eachObject(dec *json.Decoder, fn func(key string) error) error {
	if err := expectDelim(dec, '{'); err != nil {
		return err
	}
	for dec.More() {
		key, err := stringToken(dec)
		if err != nil {
			return err
		}
		if err := fn(key); err != nil {
			return fmt.Errorf("%s: %w", key, err)
		}
	}
	return expectDelim(dec, '}')
}
