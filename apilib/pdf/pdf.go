// Package pdf renders a report as a short executive summary: totals, cost by site and
// region, the largest items, and the assumptions. The full detail lives in the Excel file.
package pdf

import (
	"bytes"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"

	"github.com/Rayhanbintang/csps-calc-code/apilib/report"
)

const (
	marginX = 16.0
	pageW   = 210.0
	contW   = pageW - 2*marginX
)

type rgb struct{ r, g, b int }

var (
	ink    = rgb{28, 35, 48}
	muted  = rgb{93, 104, 120}
	rule   = rgb{223, 227, 232}
	band   = rgb{240, 242, 245}
	accent = rgb{31, 111, 235}
	clouds = map[string]rgb{"aws": {217, 119, 6}, "gcp": {37, 99, 235}, "oci": {185, 28, 28}, "onprem": {71, 85, 105}}
)

type doc struct {
	*fpdf.Fpdf
	tr func(string) string
}

func (d *doc) color(c rgb)                     { d.SetTextColor(c.r, c.g, c.b) }
func (d *doc) fill(c rgb)                      { d.SetFillColor(c.r, c.g, c.b) }
func (d *doc) draw(c rgb)                      { d.SetDrawColor(c.r, c.g, c.b) }
func (d *doc) font(style string, size float64) { d.SetFont("Helvetica", style, size) }

// text writes a cell, converting UTF-8 to the PDF core font encoding.
func (d *doc) text(w, h float64, s, align string, fill bool) {
	d.CellFormat(w, h, d.tr(s), "", 0, align, fill, 0, "")
}

func money(v float64) string {
	s := fmt.Sprintf("%.2f", v)
	intPart, frac, _ := strings.Cut(s, ".")
	var b strings.Builder
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	return "$" + b.String() + "." + frac
}

func dateOnly(iso string) string {
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		return iso
	}
	return t.UTC().Format("2 January 2006")
}

// fit shortens text to a width, adding an ellipsis only when it must.
func (d *doc) fit(s string, w float64) string {
	s = d.tr(s)
	if d.GetStringWidth(s) <= w {
		return s
	}
	for len(s) > 1 && d.GetStringWidth(s+"...") > w {
		s = s[:len(s)-1]
	}
	return s + "..."
}

// Build renders the PDF.
func Build(r *report.Report) ([]byte, error) {
	p := fpdf.New("P", "mm", "A4", "")
	d := &doc{Fpdf: p, tr: p.UnicodeTranslatorFromDescriptor("")}
	d.SetMargins(marginX, 16, marginX)
	d.SetAutoPageBreak(true, 18)
	d.SetTitle(d.tr(r.Name), false)
	d.SetCreator("csps-calc", false)
	d.SetFooterFunc(func() {
		d.SetY(-12)
		d.font("", 7.5)
		d.color(muted)
		d.text(contW/2, 5, "csps-calc · prices as of "+dateOnly(r.PricesAsOf), "L", false)
		d.text(contW/2, 5, fmt.Sprintf("Page %d of {nb}", d.PageNo()), "R", false)
	})
	d.AliasNbPages("{nb}")
	d.AddPage()

	// Title block
	d.font("B", 18)
	d.color(ink)
	d.MultiCell(contW, 8, d.tr(r.Name), "", "L", false)
	d.font("", 9)
	d.color(muted)
	d.text(contW, 5, fmt.Sprintf("Cloud cost estimate · created %s · prices as of %s", dateOnly(r.Created), dateOnly(r.PricesAsOf)), "L", false)
	d.Ln(9)

	// Key figures
	kpis := [][2]string{
		{"Per month", money(r.Monthly)},
		{"Upfront, once", money(r.Upfront)},
		{"First 12 months", money(r.FirstYear)},
		{"36 months", money(r.ThreeYear)},
	}
	gap := 3.0
	bw := (contW - gap*3) / 4
	y := d.GetY()
	for i, k := range kpis {
		x := marginX + float64(i)*(bw+gap)
		d.fill(band)
		d.RoundedRect(x, y, bw, 19, 2, "1234", "F")
		d.SetXY(x+3, y+3)
		d.font("", 8)
		d.color(muted)
		d.text(bw-6, 4, k[0], "L", false)
		d.SetXY(x+3, y+9)
		d.font("B", 12.5)
		d.color(ink)
		d.text(bw-6, 7, k[1], "L", false)
	}
	d.SetY(y + 26)

	// Cost by site and region
	section(d, "Cost by site and region")
	cols := []float64{contW * 0.46, contW * 0.18, contW * 0.18, contW * 0.18}
	header(d, cols, []string{"Site / region", "Per month", "Upfront", "12 months"})
	for _, a := range r.Accounts {
		c := clouds[a.Provider]
		d.fill(band)
		d.font("B", 9)
		d.color(ink)
		x, y := d.GetX(), d.GetY()
		d.text(cols[0], 6.5, "   "+a.Site(), "L", true)
		d.SetFillColor(c.r, c.g, c.b)
		d.Rect(x, y, 1.6, 6.5, "F")
		d.fill(band)
		d.text(cols[1], 6.5, money(a.Monthly), "R", true)
		d.text(cols[2], 6.5, money(a.Upfront), "R", true)
		d.text(cols[3], 6.5, money(a.Monthly*12+a.Upfront), "R", true)
		d.Ln(-1)
		d.font("", 9)
		for _, b := range a.Boxes {
			name := b.RegionName
			if b.Label != "" {
				name += " (" + b.Label + ")"
			}
			d.color(ink)
			d.CellFormat(cols[0], 6, d.fit("      "+name, cols[0]-1), "B", 0, "L", false, 0, "")
			d.draw(rule)
			d.CellFormat(cols[1], 6, money(b.Monthly), "B", 0, "R", false, 0, "")
			d.CellFormat(cols[2], 6, money(b.Upfront), "B", 0, "R", false, 0, "")
			d.CellFormat(cols[3], 6, money(b.Monthly*12+b.Upfront), "B", 0, "R", false, 0, "")
			d.Ln(-1)
		}
	}
	d.Ln(6)

	// Largest items
	type row struct {
		where string
		it    report.Item
	}
	var items []row
	unpriced := 0
	for _, a := range r.Accounts {
		for _, b := range a.Boxes {
			for _, it := range b.Items {
				if it.Unavailable != "" {
					unpriced++
				}
				items = append(items, row{a.Label + " · " + b.RegionName, it})
			}
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].it.Monthly*12+items[i].it.Upfront > items[j].it.Monthly*12+items[j].it.Upfront
	})
	if len(items) > 12 {
		items = items[:12]
	}
	if len(items) > 0 {
		section(d, "Largest items")
		ic := []float64{contW * 0.24, contW * 0.40, contW * 0.22, contW * 0.14}
		header(d, ic, []string{"Item", "Type / pricing", "Site", "Per month"})
		for _, rw := range items {
			it := rw.it
			name := it.Name
			if it.Qty > 1 {
				name = fmt.Sprintf("%g × %s", it.Qty, it.Name)
			}
			if it.Depth > 0 && it.OwnQty > 0 && it.OwnQty != it.Qty {
				name = fmt.Sprintf("%g × %s (%g each)", it.Qty, it.Name, it.OwnQty)
			}
			detail := it.SKU
			if it.Pricing != "" {
				detail += " · " + it.Pricing
			}
			if it.Unavailable != "" {
				detail = "Not priced"
			}
			d.font("", 8.5)
			d.color(ink)
			d.draw(rule)
			d.CellFormat(ic[0], 6, d.fit(name, ic[0]-1), "B", 0, "L", false, 0, "")
			d.color(muted)
			d.CellFormat(ic[1], 6, d.fit(detail, ic[1]-1), "B", 0, "L", false, 0, "")
			d.CellFormat(ic[2], 6, d.fit(rw.where, ic[2]-1), "B", 0, "L", false, 0, "")
			d.color(ink)
			d.CellFormat(ic[3], 6, money(it.Monthly), "B", 0, "R", false, 0, "")
			d.Ln(-1)
		}
		d.font("", 8)
		d.color(muted)
		d.Ln(1)
		d.MultiCell(contW, 4, d.tr("The Excel file lists every item with its price lines."), "", "L", false)
		d.Ln(5)
	}

	// Every item, nested as on the canvas: VPC > cluster > node group > disk.
	if len(items) > 0 {
		section(d, "Items by site and region")
		tc := []float64{contW * 0.50, contW * 0.34, contW * 0.16}
		header(d, tc, []string{"Item", "Type / pricing", "Per month"})
		for _, a := range r.Accounts {
			for _, b := range a.Boxes {
				if len(b.Items) == 0 {
					continue
				}
				if d.GetY() > 262 {
					d.AddPage()
				}
				d.font("B", 8.5)
				d.color(ink)
				d.fill(band)
				name := a.Site() + " · " + b.RegionName
				if b.Label != "" {
					name += " (" + b.Label + ")"
				}
				d.CellFormat(contW, 6, d.fit(name, contW-2), "", 1, "L", true, 0, "")
				for _, it := range b.Items {
					detail := it.SKU
					if it.Pricing != "" {
						detail += " · " + it.Pricing
					}
					if it.Unavailable != "" {
						detail = "Not priced"
					}
					indent := 2 + 4.5*float64(it.Depth)
					d.draw(rule)
					d.font("", 8.5)
					if it.Depth == 0 {
						d.font("B", 8.5)
					}
					d.color(ink)
					x, y := d.GetX(), d.GetY()
					d.CellFormat(tc[0], 5.6, "", "B", 0, "L", false, 0, "")
					d.SetXY(x+indent, y)
					d.CellFormat(tc[0]-indent, 5.6, d.fit(treeLabel(it), tc[0]-indent-1), "", 0, "L", false, 0, "")
					if it.Depth > 0 {
						// A short elbow ties a child to the card above it.
						d.draw(rule)
						d.Line(x+indent-2.6, y, x+indent-2.6, y+2.8)
						d.Line(x+indent-2.6, y+2.8, x+indent-0.8, y+2.8)
					}
					d.SetXY(x+tc[0], y)
					d.font("", 8.5)
					d.color(muted)
					d.CellFormat(tc[1], 5.6, d.fit(detail, tc[1]-1), "B", 0, "L", false, 0, "")
					d.color(ink)
					d.CellFormat(tc[2], 5.6, money(it.Monthly), "B", 1, "R", false, 0, "")
				}
				d.Ln(2)
			}
		}
		d.Ln(4)
	}

	// Assumptions
	section(d, "Assumptions")
	d.font("", 9)
	d.color(ink)
	bullets := []string{
		report.Disclaimer,
		"Monthly figures use 730 hours a month. Upfront payments are one-time amounts at the start of a commitment.",
		"Prices come from each provider's public price list on the date above. Providers change prices; check before you sign.",
	}
	if unpriced > 0 {
		bullets = append(bullets, fmt.Sprintf("%d item(s) could not be priced and count as $0. The Excel file names them.", unpriced))
	}
	for _, b := range bullets {
		d.SetX(marginX)
		d.color(accent)
		d.CellFormat(4, 5, "-", "", 0, "L", false, 0, "")
		d.color(ink)
		d.MultiCell(contW-4, 5, d.tr(b), "", "L", false)
		d.Ln(1)
	}

	var buf bytes.Buffer
	if err := d.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// treeLabel names an item with its count, e.g. "6 × Data disk (2 each)" for two disks on
// each of three VMs. The indent shows the nesting, so the label carries no padding.
func treeLabel(it report.Item) string {
	switch {
	case it.OwnQty > 0 && it.OwnQty != it.Qty:
		return fmt.Sprintf("%g × %s (%g each)", it.Qty, it.Name, it.OwnQty)
	case it.Qty > 1:
		return fmt.Sprintf("%g × %s", it.Qty, it.Name)
	}
	return it.Name
}

func section(d *doc, title string) {
	if d.GetY() > 250 {
		d.AddPage()
	}
	d.font("B", 11)
	d.color(ink)
	d.text(contW, 7, title, "L", false)
	d.Ln(8)
}

func header(d *doc, widths []float64, labels []string) {
	d.font("B", 8)
	d.color(muted)
	d.draw(rule)
	for i, l := range labels {
		align := "L"
		if i > 0 && strings.Contains("Per month Upfront 12 months", l) {
			align = "R"
		}
		d.CellFormat(widths[i], 6, d.tr(l), "B", 0, align, false, 0, "")
	}
	d.Ln(-1)
}
