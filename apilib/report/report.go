// Package report mirrors the Report built by the web app (web/src/lib/report.ts).
package report

import (
	"errors"
	"fmt"
	"math"
)

// Line is one priced line of an item.
type Line struct {
	Label   string  `json:"label"`
	Qty     float64 `json:"qty"`
	Unit    string  `json:"unit"`
	Rate    float64 `json:"rate"`
	Monthly float64 `json:"monthly"`
}

// Item is one estimate item with its price. Items arrive parents first; Depth says how
// deep each one sits (0 = in the region box, 1 = inside a VPC, cluster or VM, ...).
type Item struct {
	Depth           int      `json:"depth"`
	Subtotal        *float64 `json:"subtotal,omitempty"`
	SubtotalUpfront *float64 `json:"subtotalUpfront,omitempty"`
	OwnQty          float64  `json:"ownQty"`
	Name            string   `json:"name"`
	Service         string   `json:"service"`
	Product         string   `json:"product"`
	SKU             string   `json:"sku"`
	Qty             float64  `json:"qty"`
	Pricing         string   `json:"pricing"`
	Monthly         float64  `json:"monthly"`
	Upfront         float64  `json:"upfront"`
	Lines           []Line   `json:"lines"`
	Notes           []string `json:"notes"`
	Unavailable     string   `json:"unavailable,omitempty"`
}

// Box is one region box.
type Box struct {
	Region     string  `json:"region"`
	RegionName string  `json:"regionName"`
	Label      string  `json:"label"`
	Monthly    float64 `json:"monthly"`
	Upfront    float64 `json:"upfront"`
	Items      []Item  `json:"items"`
}

// Account is one site on one provider.
type Account struct {
	Provider     string  `json:"provider"`
	ProviderName string  `json:"providerName"`
	Kind         string  `json:"kind"` // "AWS account", "Google Cloud project", ...
	Ref          string  `json:"ref"`  // account ID, project ID or compartment; may be empty
	Label        string  `json:"label"`
	Monthly      float64 `json:"monthly"`
	Upfront      float64 `json:"upfront"`
	Boxes        []Box   `json:"boxes"`
}

// Report is the priced estimate.
type Report struct {
	V          int       `json:"v"`
	Name       string    `json:"name"`
	Created    string    `json:"created"`
	PricesAsOf string    `json:"pricesAsOf"`
	Monthly    float64   `json:"monthly"`
	Upfront    float64   `json:"upfront"`
	FirstYear  float64   `json:"firstYear"`
	ThreeYear  float64   `json:"threeYear"`
	Accounts   []Account `json:"accounts"`
}

// Site names the account for people: "DC · AWS account 1234-5678".
func (a Account) Site() string {
	s := a.Label
	kind := a.Kind
	if kind == "" {
		kind = a.ProviderName
	}
	if s != "" {
		s += " · "
	}
	s += kind
	if a.Ref != "" {
		s += " " + a.Ref
	}
	return s
}

// Disclaimer goes on every page and file.
const Disclaimer = "Estimate only. Prices are public list prices in USD and exclude taxes, support plans, negotiated discounts and free-tier credits unless a line says otherwise."

// Limits keep one request from making a huge file.
const (
	MaxAccounts = 50
	MaxItems    = 2000
	MaxText     = 300
)

// Validate checks shape and size. Prices are the visitor's own numbers; the check
// only stops broken or oversized input.
func (r *Report) Validate() error {
	if r.V != 1 {
		return errors.New("unknown report version")
	}
	if len(r.Accounts) > MaxAccounts {
		return fmt.Errorf("more than %d sites", MaxAccounts)
	}
	n := 0
	for _, a := range r.Accounts {
		for _, b := range a.Boxes {
			n += len(b.Items)
			for _, it := range b.Items {
				if len(it.Name) > MaxText || len(it.SKU) > MaxText || len(it.Lines) > 50 || it.Depth < 0 || it.Depth > 10 {
					return errors.New("an item is too large")
				}
				if bad(it.Monthly) || bad(it.Upfront) {
					return errors.New("an item has an invalid price")
				}
			}
		}
	}
	if n > MaxItems {
		return fmt.Errorf("more than %d items", MaxItems)
	}
	if len(r.Name) > MaxText {
		return errors.New("the estimate name is too long")
	}
	return nil
}

func bad(f float64) bool { return math.IsNaN(f) || math.IsInf(f, 0) || f < 0 }
