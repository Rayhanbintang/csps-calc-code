package aws

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
)

// Tier is one price step: usage from From up to To (To < 0 means no upper limit).
type Tier struct {
	From float64
	To   float64
	USD  float64
}

// MarshalJSON writes a tier as [from, to, usd] with to = null for "no limit".
func (t Tier) MarshalJSON() ([]byte, error) {
	if t.To < 0 {
		return json.Marshal([]any{t.From, nil, t.USD})
	}
	return json.Marshal([]any{t.From, t.To, t.USD})
}

// Reserved is one Reserved Instance offer.
type Reserved struct {
	Term    int     `json:"y"` // years
	Class   string  `json:"k"` // "s" standard, "c" convertible
	Pay     string  `json:"p"` // "no", "partial", "all" upfront
	Hourly  float64 `json:"h"`
	Upfront float64 `json:"u"`
}

// item is one product from an offer file with its prices attached.
type item struct {
	SKU       string
	Family    string
	Attr      map[string]string
	Unit      string
	Tiers     []Tier
	Reserved  []Reserved
	hasOnDem  bool
}

type rawProduct struct {
	SKU           string            `json:"sku"`
	ProductFamily string            `json:"productFamily"`
	Attributes    map[string]string `json:"attributes"`
}

type rawTerm struct {
	PriceDimensions map[string]struct {
		Unit         string            `json:"unit"`
		BeginRange   string            `json:"beginRange"`
		EndRange     string            `json:"endRange"`
		PricePerUnit map[string]string `json:"pricePerUnit"`
	} `json:"priceDimensions"`
	TermAttributes struct {
		LeaseContractLength string `json:"LeaseContractLength"`
		OfferingClass       string `json:"OfferingClass"`
		PurchaseOption      string `json:"PurchaseOption"`
	} `json:"termAttributes"`
}

// parseOffer streams an AWS offer file (products + OnDemand/Reserved terms) and keeps
// the products for which keep returns true. Only the attributes it needs stay in memory.
func parseOffer(r io.Reader, keep func(family string, a map[string]string) bool) (map[string]*item, error) {
	dec := json.NewDecoder(r)
	items := map[string]*item{}

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
			err = eachObject(dec, func(sku string) error {
				var p rawProduct
				if err := dec.Decode(&p); err != nil {
					return err
				}
				if keep(p.ProductFamily, p.Attributes) {
					items[sku] = &item{SKU: sku, Family: p.ProductFamily, Attr: p.Attributes}
				}
				return nil
			})
		case "terms":
			err = eachObject(dec, func(kind string) error {
				return eachObject(dec, func(sku string) error {
					it := items[sku]
					if it == nil {
						return skipValue(dec)
					}
					var offers map[string]rawTerm
					if err := dec.Decode(&offers); err != nil {
						return err
					}
					for _, t := range offers {
						applyTerm(it, kind, t)
					}
					return nil
				})
			})
		default:
			err = skipValue(dec)
		}
		if err != nil {
			return nil, fmt.Errorf("%s: %w", key, err)
		}
	}
	return items, nil
}

func applyTerm(it *item, kind string, t rawTerm) {
	switch kind {
	case "OnDemand":
		var tiers []Tier
		unit := ""
		for _, d := range t.PriceDimensions {
			usd, _ := strconv.ParseFloat(d.PricePerUnit["USD"], 64)
			from, _ := strconv.ParseFloat(d.BeginRange, 64)
			to := -1.0
			if d.EndRange != "" && d.EndRange != "Inf" {
				to, _ = strconv.ParseFloat(d.EndRange, 64)
			}
			tiers = append(tiers, Tier{From: from, To: to, USD: usd})
			unit = d.Unit
		}
		sort.Slice(tiers, func(i, j int) bool { return tiers[i].From < tiers[j].From })
		it.Tiers, it.Unit, it.hasOnDem = tiers, unit, true
	case "Reserved":
		var hourly, upfront float64
		for _, d := range t.PriceDimensions {
			v, _ := strconv.ParseFloat(d.PricePerUnit["USD"], 64)
			if d.Unit == "Quantity" {
				upfront = v
			} else {
				hourly = v
			}
		}
		ta := t.TermAttributes
		years := 1
		if ta.LeaseContractLength == "3yr" || ta.LeaseContractLength == "3 yr" {
			years = 3
		}
		class := "s"
		if strings.EqualFold(ta.OfferingClass, "convertible") {
			class = "c"
		}
		pay := map[string]string{"No Upfront": "no", "Partial Upfront": "partial", "All Upfront": "all"}[ta.PurchaseOption]
		if pay == "" {
			return
		}
		it.Reserved = append(it.Reserved, Reserved{Term: years, Class: class, Pay: pay, Hourly: hourly, Upfront: upfront})
	}
}

func sortReserved(rs []Reserved) {
	sort.Slice(rs, func(i, j int) bool {
		a, b := rs[i], rs[j]
		if a.Term != b.Term {
			return a.Term < b.Term
		}
		if a.Class != b.Class {
			return a.Class > b.Class
		}
		return a.Pay < b.Pay
	})
}

func skipValue(dec *json.Decoder) error {
	var skip json.RawMessage
	return dec.Decode(&skip)
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

// eachArray walks an array value element by element; fn must consume the element.
func eachArray(dec *json.Decoder, fn func() error) error {
	if err := expectDelim(dec, '['); err != nil {
		return err
	}
	for dec.More() {
		if err := fn(); err != nil {
			return err
		}
	}
	return expectDelim(dec, ']')
}
