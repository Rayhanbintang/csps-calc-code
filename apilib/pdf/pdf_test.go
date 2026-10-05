package pdf

import (
	"bytes"
	"os"
	"testing"

	"github.com/Rayhanbintang/csps-calc-code/apilib/report"
)

// The nested example from the canvas: the PDF must build, and set PDF_OUT to look at it.
func TestNestedTree(t *testing.T) {
	r := &report.Report{V: 1, Name: "Nested", Monthly: 811.81, Accounts: []report.Account{{
		Provider: "aws", ProviderName: "AWS", Label: "DC", Kind: "AWS account", Monthly: 811.81,
		Boxes: []report.Box{{Region: "ap-southeast-3", RegionName: "Asia Pacific (Jakarta)", Monthly: 811.81, Items: []report.Item{
			{Depth: 0, Name: "VPC", Qty: 1, OwnQty: 1, Monthly: 72.57, SKU: "NAT gateway"},
			{Depth: 1, Name: "EKS", Qty: 1, OwnQty: 1, Monthly: 73, SKU: "EKS cluster"},
			{Depth: 2, Name: "stateful", Qty: 3, OwnQty: 3, Monthly: 210.24, SKU: "m6i.xlarge", Pricing: "On-demand"},
			{Depth: 3, Name: "Data disk", Qty: 6, OwnQty: 2, Monthly: 57.6, SKU: "gp3"},
			{Depth: 2, Name: "web", Qty: 5, OwnQty: 5, Monthly: 350.4, SKU: "m6i.large"},
			{Depth: 3, Name: "Disk", Qty: 5, OwnQty: 1, Monthly: 48, SKU: "gp3"},
		}}},
	}}}
	out, err := Build(r)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(out, []byte("%PDF")) {
		t.Fatal("not a PDF")
	}
	if p := os.Getenv("PDF_OUT"); p != "" {
		os.WriteFile(p, out, 0o644)
	}
	if got := treeLabel(r.Accounts[0].Boxes[0].Items[3]); got != "6 × Data disk (2 each)" {
		t.Errorf("label %q", got)
	}
}
