// Package xlsx renders a report as an Excel workbook: a summary sheet, a sheet with
// every item, and one sheet per region box with each item's price lines.
//
// Every cell must read in full as opened: column widths come from the content (with
// a cap), long text wraps, and row heights are set from the wrapped line count because
// Excel does not grow rows for wrapped text written by a library.
package xlsx

import (
	"bytes"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/xuri/excelize/v2"

	"github.com/Rayhanbintang/csps-calc-code/apilib/report"
)

const (
	maxWidth  = 60.0 // characters
	lineH     = 15.0 // points per text line
	moneyFmt  = `"$"#,##0.00`
	rateFmt   = `"$"#,##0.000000##`
	qtyFmt    = `#,##0.##`
	fontName  = "Calibri"
	headerHex = "1F2937"
)

type cell struct {
	v     any
	style int
}

type sheet struct {
	f      *excelize.File
	name   string
	rows   [][]cell
	widths []float64
	min    []float64
}

func newSheet(f *excelize.File, name string, minWidths []float64) *sheet {
	return &sheet{f: f, name: name, min: minWidths}
}

func (s *sheet) add(cells ...cell) {
	s.rows = append(s.rows, cells)
}

func textLen(v any) float64 {
	switch t := v.(type) {
	case string:
		longest := 0
		for _, part := range strings.Split(t, "\n") {
			if n := utf8.RuneCountInString(part); n > longest {
				longest = n
			}
		}
		return float64(longest)
	case float64:
		return float64(len(fmt.Sprintf("%.2f", t))) + 4
	case int:
		return float64(len(fmt.Sprint(t)))
	}
	return 0
}

// write lays the rows out, then sizes columns and rows so nothing is cut off.
func (s *sheet) write(skipWidth map[int]bool) error {
	cols := 0
	for _, r := range s.rows {
		if len(r) > cols {
			cols = len(r)
		}
	}
	s.widths = make([]float64, cols)
	for i := range s.widths {
		if i < len(s.min) {
			s.widths[i] = s.min[i]
		} else {
			s.widths[i] = 8
		}
	}
	for ri, r := range s.rows {
		if skipWidth[ri] {
			continue
		}
		for ci, c := range r {
			if w := math.Min(textLen(c.v)+2, maxWidth); w > s.widths[ci] {
				s.widths[ci] = w
			}
		}
	}
	for ci, w := range s.widths {
		col, _ := excelize.ColumnNumberToName(ci + 1)
		if err := s.f.SetColWidth(s.name, col, col, w); err != nil {
			return err
		}
	}
	for ri, r := range s.rows {
		lines := 1.0
		for ci, c := range r {
			addr, _ := excelize.CoordinatesToCellName(ci+1, ri+1)
			if c.v != nil {
				if err := s.f.SetCellValue(s.name, addr, c.v); err != nil {
					return err
				}
			}
			if c.style != 0 {
				s.f.SetCellStyle(s.name, addr, addr, c.style)
			}
			if str, ok := c.v.(string); ok && !skipWidth[ri] {
				lines = math.Max(lines, wrappedLines(str, s.widths[ci]))
			}
		}
		if lines > 1 {
			s.f.SetRowHeight(s.name, ri+1, lines*lineH+2)
		}
	}
	return nil
}

// wrappedLines estimates how many lines Excel needs for text in a column of width w.
func wrappedLines(text string, w float64) float64 {
	usable := math.Max(1, w-1.5)
	total := 0.0
	for _, part := range strings.Split(text, "\n") {
		total += math.Max(1, math.Ceil(float64(utf8.RuneCountInString(part))*1.05/usable))
	}
	return total
}

type styles struct {
	title, sub, wrap, header, text, money, rate, qty, bold, boldMoney, total, totalMoney, warn, subtotal, subtotalMoney int
}

func makeStyles(f *excelize.File) (*styles, error) {
	var firstErr error
	mk := func(s *excelize.Style) int {
		id, err := f.NewStyle(s)
		if err != nil && firstErr == nil {
			firstErr = err
		}
		return id
	}
	font := func(size float64, bold bool, color string) *excelize.Font {
		return &excelize.Font{Family: fontName, Size: size, Bold: bold, Color: color}
	}
	top := &excelize.Alignment{Vertical: "top", WrapText: true}
	topR := &excelize.Alignment{Vertical: "top", Horizontal: "right"}
	border := []excelize.Border{{Type: "bottom", Color: "D9DEE5", Style: 1}}
	st := &styles{}
	st.title = mk(&excelize.Style{Font: font(16, true, headerHex)})
	st.sub = mk(&excelize.Style{Font: font(10, false, "5D6878")})
	st.wrap = mk(&excelize.Style{Font: font(10, false, "5D6878"), Alignment: top})
	st.header = mk(&excelize.Style{Font: font(10, true, "FFFFFF"), Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{headerHex}}, Alignment: &excelize.Alignment{Vertical: "center", WrapText: true}})
	st.text = mk(&excelize.Style{Font: font(10, false, ""), Alignment: top, Border: border})
	st.money = mk(&excelize.Style{Font: font(10, false, ""), CustomNumFmt: strPtr(moneyFmt), Alignment: topR, Border: border})
	st.rate = mk(&excelize.Style{Font: font(10, false, ""), CustomNumFmt: strPtr(rateFmt), Alignment: topR, Border: border})
	st.qty = mk(&excelize.Style{Font: font(10, false, ""), CustomNumFmt: strPtr(qtyFmt), Alignment: topR, Border: border})
	st.bold = mk(&excelize.Style{Font: font(10, true, ""), Alignment: top, Border: border, Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"F0F2F5"}}})
	st.boldMoney = mk(&excelize.Style{Font: font(10, true, ""), CustomNumFmt: strPtr(moneyFmt), Alignment: topR, Border: border, Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"F0F2F5"}}})
	st.total = mk(&excelize.Style{Font: font(11, true, ""), Alignment: top})
	st.totalMoney = mk(&excelize.Style{Font: font(11, true, ""), CustomNumFmt: strPtr(moneyFmt), Alignment: topR})
	italic := &excelize.Font{Family: fontName, Size: 10, Bold: true, Italic: true, Color: "1F6FEB"}
	st.subtotal = mk(&excelize.Style{Font: italic, Alignment: top, Border: border})
	st.subtotalMoney = mk(&excelize.Style{Font: italic, CustomNumFmt: strPtr(moneyFmt), Alignment: topR, Border: border})
	st.warn = mk(&excelize.Style{Font: font(10, false, "B42318"), Alignment: top, Border: border})
	return st, firstErr
}

func strPtr(s string) *string { return &s }

func dateOnly(iso string) string {
	t, err := time.Parse(time.RFC3339Nano, iso)
	if err != nil {
		return iso
	}
	return t.UTC().Format("2 Jan 2006")
}

// sheetName makes a unique sheet name within Excel's 31-character limit.
func sheetName(used map[string]bool, parts ...string) string {
	base := strings.Join(parts, " ")
	for _, bad := range []string{"\\", "/", "?", "*", "[", "]", ":"} {
		base = strings.ReplaceAll(base, bad, "-")
	}
	base = strings.TrimSpace(base)
	if utf8.RuneCountInString(base) > 28 {
		base = string([]rune(base)[:28])
	}
	name := base
	for i := 2; used[strings.ToLower(name)]; i++ {
		name = fmt.Sprintf("%s %d", base, i)
	}
	used[strings.ToLower(name)] = true
	return name
}

// itemLabel indents by depth and shows how the count builds up inside containers,
// e.g. "      └ 6 × Data disk (2 each)".
func itemLabel(it report.Item) string {
	pad := strings.Repeat("   ", it.Depth)
	if it.Depth > 0 {
		pad += "└ "
	}
	switch {
	case it.OwnQty > 0 && it.OwnQty != it.Qty:
		return fmt.Sprintf("%s%g × %s (%g each)", pad, it.Qty, it.Name, it.OwnQty)
	case it.Qty > 1:
		return fmt.Sprintf("%s%g × %s", pad, it.Qty, it.Name)
	}
	return pad + it.Name
}

func notes(it report.Item) string {
	parts := append([]string{}, it.Notes...)
	if it.Unavailable != "" {
		parts = append([]string{"Not priced: " + it.Unavailable}, parts...)
	}
	return strings.Join(parts, "\n")
}

// Build renders the workbook.
func Build(r *report.Report) ([]byte, error) {
	f := excelize.NewFile()
	defer f.Close()
	st, err := makeStyles(f)
	if err != nil {
		return nil, err
	}
	used := map[string]bool{}

	// ---- Summary ----
	sum := sheetName(used, "Summary")
	f.SetSheetName("Sheet1", sum)
	s := newSheet(f, sum, []float64{22, 16, 30, 16, 16, 18})
	s.add(cell{r.Name, st.title})
	s.add(cell{fmt.Sprintf("Prices as of %s. Created %s.", dateOnly(r.PricesAsOf), dateOnly(r.Created)), st.sub})
	s.add(cell{report.Disclaimer, st.wrap})
	s.add()
	s.add(cell{"Site", st.header}, cell{"Cloud", st.header}, cell{"Region", st.header}, cell{"Per month (USD)", st.header}, cell{"Upfront (USD)", st.header}, cell{"First 12 months (USD)", st.header})
	for _, a := range r.Accounts {
		s.add(cell{a.Site(), st.bold}, cell{a.ProviderName, st.bold}, cell{"", st.bold}, cell{a.Monthly, st.boldMoney}, cell{a.Upfront, st.boldMoney}, cell{a.Monthly*12 + a.Upfront, st.boldMoney})
		for _, b := range a.Boxes {
			region := b.RegionName
			if b.Label != "" {
				region += " (" + b.Label + ")"
			}
			s.add(cell{"", st.text}, cell{"", st.text}, cell{region, st.text}, cell{b.Monthly, st.money}, cell{b.Upfront, st.money}, cell{b.Monthly*12 + b.Upfront, st.money})
		}
		if a.Support != nil {
			s.add(cell{"", st.text}, cell{"", st.text}, cell{"Support, " + a.Support.Plan, st.text}, cell{a.Support.Monthly, st.money}, cell{0.0, st.money}, cell{a.Support.Monthly * 12, st.money})
		}
	}
	s.add()
	s.add(cell{"Total per month", st.total}, nil_(), nil_(), cell{r.Monthly, st.totalMoney})
	s.add(cell{"Upfront, once", st.total}, nil_(), nil_(), cell{r.Upfront, st.totalMoney})
	s.add(cell{"First 12 months", st.total}, nil_(), nil_(), cell{r.FirstYear, st.totalMoney})
	s.add(cell{"36 months", st.total}, nil_(), nil_(), cell{r.ThreeYear, st.totalMoney})
	// The title and the disclaimer span the table; merge them instead of widening column A.
	if err := s.write(map[int]bool{0: true, 1: true, 2: true}); err != nil {
		return nil, err
	}
	f.MergeCell(sum, "A1", "F1")
	f.MergeCell(sum, "A2", "F2")
	f.MergeCell(sum, "A3", "F3")
	totalW := 0.0
	for _, w := range s.widths {
		totalW += w
	}
	f.SetRowHeight(sum, 3, wrappedLines(report.Disclaimer, totalW)*lineH+4)
	f.SetPanes(sum, &excelize.Panes{Freeze: true, YSplit: 5, TopLeftCell: "A6", ActivePane: "bottomLeft"})

	// ---- All items ----
	all := sheetName(used, "All items")
	f.NewSheet(all)
	ai := newSheet(f, all, []float64{14, 12, 22, 26, 18, 18, 22, 6, 20, 14, 14, 30})
	ai.add(cell{"Site", st.header}, cell{"Cloud", st.header}, cell{"Region", st.header}, cell{"Item", st.header}, cell{"Service", st.header}, cell{"Product", st.header}, cell{"Type / SKU", st.header}, cell{"Qty", st.header}, cell{"Pricing", st.header}, cell{"Per month (USD)", st.header}, cell{"Upfront (USD)", st.header}, cell{"Notes", st.header})
	for _, a := range r.Accounts {
		for _, b := range a.Boxes {
			for _, it := range b.Items {
				noteStyle := st.text
				if it.Unavailable != "" {
					noteStyle = st.warn
				}
				ai.add(cell{a.Site(), st.text}, cell{a.ProviderName, st.text}, cell{b.RegionName, st.text}, cell{itemLabel(it), st.text}, cell{it.Service, st.text}, cell{it.Product, st.text}, cell{it.SKU, st.text}, cell{it.Qty, st.qty}, cell{it.Pricing, st.text}, cell{it.Monthly, st.money}, cell{it.Upfront, st.money}, cell{notes(it), noteStyle})
			}
		}
		// Support is one line per site, so "All items" still sums to the total.
		if a.Support != nil {
			ai.add(cell{a.Site(), st.text}, cell{a.ProviderName, st.text}, cell{"", st.text}, cell{"Support plan", st.text}, cell{"Support", st.text}, cell{a.Support.Plan, st.text}, cell{"", st.text}, cell{1, st.qty}, cell{"Monthly", st.text}, cell{a.Support.Monthly, st.money}, cell{0.0, st.money}, cell{a.Support.Basis, st.text})
		}
	}
	if err := ai.write(nil); err != nil {
		return nil, err
	}
	f.SetPanes(all, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})
	f.AutoFilter(all, fmt.Sprintf("A1:L%d", len(ai.rows)), nil)

	// ---- One sheet per region box ----
	for _, a := range r.Accounts {
		for _, b := range a.Boxes {
			name := sheetName(used, a.Label, b.Region)
			f.NewSheet(name)
			bs := newSheet(f, name, []float64{30, 34, 12, 14, 16, 16})
			title := fmt.Sprintf("%s · %s", a.Site(), b.RegionName)
			if b.Label != "" {
				title += " (" + b.Label + ")"
			}
			bs.add(cell{title, st.title})
			bs.add(cell{fmt.Sprintf("%s per month, %s upfront. Prices as of %s.", money(b.Monthly), money(b.Upfront), dateOnly(r.PricesAsOf)), st.sub})
			bs.add()
			bs.add(cell{"Item / line", st.header}, cell{"Type / SKU · pricing", st.header}, cell{"Quantity", st.header}, cell{"Unit", st.header}, cell{"Rate (USD)", st.header}, cell{"Per month (USD)", st.header})
			// A container's subtotal row follows its last child. open holds the containers
			// whose children are still being written, outermost first.
			var open []report.Item
			closeTo := func(depth int) {
				for len(open) > 0 && open[len(open)-1].Depth >= depth {
					c := open[len(open)-1]
					open = open[:len(open)-1]
					label := strings.Repeat("   ", c.Depth) + "Subtotal, " + c.Name
					bs.add(cell{label, st.subtotal}, cell{"", st.subtotal}, cell{"", st.subtotal}, cell{"", st.subtotal}, cell{"", st.subtotal}, cell{*c.Subtotal, st.subtotalMoney})
				}
			}
			for _, it := range b.Items {
				closeTo(it.Depth)
				pad := strings.Repeat("   ", it.Depth) + "      "
				bs.add(cell{itemLabel(it), st.bold}, cell{strings.TrimSpace(it.SKU + "\n" + it.Pricing), st.bold}, cell{"", st.bold}, cell{"", st.bold}, cell{"", st.bold}, cell{it.Monthly, st.boldMoney})
				for _, l := range it.Lines {
					bs.add(cell{pad + l.Label, st.text}, cell{"", st.text}, cell{l.Qty, st.qty}, cell{l.Unit, st.text}, cell{l.Rate, st.rate}, cell{l.Monthly, st.money})
				}
				if it.Upfront > 0 {
					bs.add(cell{pad + "Upfront, once", st.text}, cell{"", st.text}, cell{"", st.text}, cell{"", st.text}, cell{"", st.text}, cell{it.Upfront, st.money})
				}
				if n := notes(it); n != "" {
					style := st.wrap
					if it.Unavailable != "" {
						style = st.warn
					}
					bs.add(cell{pad + strings.ReplaceAll(n, "\n", "\n"+pad), style})
				}
				if it.Subtotal != nil {
					open = append(open, it)
				}
			}
			closeTo(0)
			skip := map[int]bool{0: true, 1: true}
			for i, row := range bs.rows {
				if len(row) == 1 && i > 2 {
					skip[i] = true // note rows are merged across the sheet below
				}
			}
			if err := bs.write(skip); err != nil {
				return nil, err
			}
			totalW := 0.0
			for _, w := range bs.widths {
				totalW += w
			}
			for i, row := range bs.rows {
				if len(row) == 1 && row[0].v != nil {
					a1, _ := excelize.CoordinatesToCellName(1, i+1)
					f1, _ := excelize.CoordinatesToCellName(len(bs.widths), i+1)
					f.MergeCell(name, a1, f1)
					if i > 2 {
						f.SetRowHeight(name, i+1, wrappedLines(row[0].v.(string), totalW)*lineH+2)
					}
				}
			}
			f.SetPanes(name, &excelize.Panes{Freeze: true, YSplit: 4, TopLeftCell: "A5", ActivePane: "bottomLeft"})
		}
	}

	f.SetActiveSheet(0)
	f.SetDocProps(&excelize.DocProperties{Title: r.Name, Creator: "csps-calc", Description: report.Disclaimer})
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func nil_() cell { return cell{} }

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
