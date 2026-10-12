package advise

import (
	"strings"
	"testing"

	"github.com/Rayhanbintang/csps-calc-code/apilib/report"
)

func TestSummary(t *testing.T) {
	r := &report.Report{Name: "Core", PricesAsOf: "2026-10-12", Monthly: 100, Accounts: []report.Account{{
		Label: "DC", ProviderName: "AWS", Monthly: 100,
		Boxes: []report.Box{{RegionName: "Asia Pacific (Jakarta)", Monthly: 100, Items: []report.Item{
			{Depth: 0, Name: "App cluster", Qty: 1, Service: "Kubernetes cluster", SKU: "EKS control plane", Pricing: "On-demand", Monthly: 73},
			{Depth: 1, Name: "Nodes", Qty: 3, Service: "Virtual machine", SKU: "m5.large", Pricing: "On-demand", Monthly: 27},
		}}},
	}}}
	s := Summary(r)
	for _, want := range []string{"Site: DC (AWS)", "Region box Asia Pacific (Jakarta)", "    - App cluster: 1 × Kubernetes cluster", "      - Nodes: 3 × Virtual machine (m5.large)"} {
		if !strings.Contains(s, want) {
			t.Errorf("summary misses %q:\n%s", want, s)
		}
	}
}

func TestSummaryIsCut(t *testing.T) {
	items := make([]report.Item, 2000)
	for i := range items {
		items[i] = report.Item{Name: strings.Repeat("x", 40), Qty: 1, Service: "Virtual machine"}
	}
	s := Summary(&report.Report{Accounts: []report.Account{{Boxes: []report.Box{{Items: items}}}}})
	if len(s) > MaxSummary+300 || !strings.Contains(s, "is cut") {
		t.Errorf("a large estimate must be cut near %d characters; got %d", MaxSummary, len(s))
	}
}
