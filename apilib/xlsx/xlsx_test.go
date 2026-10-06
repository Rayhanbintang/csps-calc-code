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
// and carry no subtotal column. The All items sheet stays a flat list that sums cleanly;
// the region sheet adds a subtotal row after each container's last child.
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
				t.Errorf("subtotal leaked into the All items sheet: %q", c)
			}
		}
	}

	// Region sheet: the order of item and subtotal rows (line rows have no "└" and are skipped).
	box, _ := wb.GetRows(wb.GetSheetList()[2])
	var got []string
	for _, r := range box[4:] {
		if len(r) > 0 && (strings.Contains(r[0], "Subtotal") || r[0] == "VPC" || strings.Contains(r[0], "└")) {
			got = append(got, strings.TrimSpace(r[0])+" | "+strings.TrimPrefix(r[len(r)-1], "$"))
		}
	}
	wantRows := []string{
		"VPC | 72.57",
		"└ EKS | 73.00",
		"└ 3 × stateful | 210.24",
		"└ 3 × Data disk (1 each) | 28.80",
		"└ 3 × Log disk (1 each) | 28.80",
		"Subtotal, stateful | 267.84", // 210.24 + 28.80 + 28.80
		"└ 5 × web | 350.40",
		"└ 5 × Disk (1 each) | 48.00",
		"Subtotal, web | 398.40", // 350.40 + 48.00
		"Subtotal, EKS | 739.24", // 73 + 267.84 + 398.40
		"Subtotal, VPC | 811.81", // 72.57 + 739.24
	}
	if g, w := strings.Join(got, "\n"), strings.Join(wantRows, "\n"); g != w {
		t.Errorf("region sheet rows:\n%s\nwant:\n%s", g, w)
	}
}
