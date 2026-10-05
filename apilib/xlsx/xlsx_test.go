package xlsx

import (
	"bytes"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	"github.com/Rayhanbintang/csps-calc-code/apilib/report"
)

func f(v float64) *float64 { return &v }

// The nested example: VPC → cluster → "stateful" (3 VMs, 2 disks each) and "web"
// (5 VMs, 1 disk each). Rows must indent by depth, show "6 × ... (2 each)"-style counts,
// and carry no subtotal column.
func TestNestedItems(t *testing.T) {
	r := &report.Report{V: 1, Name: "Nested", Accounts: []report.Account{{
		Provider: "aws", ProviderName: "AWS", Label: "DC",
		Boxes: []report.Box{{Region: "ap-southeast-3", RegionName: "Asia Pacific (Jakarta)", Items: []report.Item{
			{Depth: 0, Name: "VPC", Qty: 1, OwnQty: 1, Monthly: 72.57, Subtotal: f(811.81)},
			{Depth: 1, Name: "EKS", Qty: 1, OwnQty: 1, Monthly: 73, Subtotal: f(739.24)},
			{Depth: 2, Name: "stateful", Qty: 3, OwnQty: 3, Monthly: 210.24, Subtotal: f(267.84)},
			{Depth: 3, Name: "Data disk", Qty: 3, OwnQty: 1, Monthly: 28.8},
			{Depth: 3, Name: "Log disk", Qty: 3, OwnQty: 1, Monthly: 28.8},
			{Depth: 2, Name: "web", Qty: 5, OwnQty: 5, Monthly: 350.4, Subtotal: f(398.4)},
			{Depth: 3, Name: "Disk", Qty: 5, OwnQty: 1, Monthly: 48},
		}}},
	}}}
	out, err := Build(r)
	if err != nil {
		t.Fatal(err)
	}
	wb, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	rows, _ := wb.GetRows("All items")
	if len(rows) != 8 {
		t.Fatalf("want header + 7 items, got %d rows", len(rows))
	}
	want := map[int]string{1: "VPC", 2: "   └ EKS", 3: "      └ 3 × stateful", 4: "         └ 3 × Data disk (1 each)", 7: "         └ 5 × Disk (1 each)"}
	for i, label := range want {
		if rows[i][3] != label {
			t.Errorf("row %d item: want %q, got %q", i, label, rows[i][3])
		}
	}
	// No subtotal column: the header row ends with Notes after Upfront.
	if rows[0][11] != "Notes" || len(rows[0]) != 12 {
		t.Errorf("want 12 columns ending in Notes, got %v", rows[0])
	}
	for _, r := range rows {
		for _, c := range r {
			if strings.Contains(c, "With inside") || strings.Contains(c, "811.81") {
				t.Errorf("subtotal leaked into the sheet: %q", c)
			}
		}
	}
}
