// Package awsec2 fills AWS's "EC2 Instances" bulk upload template (the .xlsx the AWS
// Pricing Calculator offers) with rows built in the browser. The visitor supplies their
// own copy of AWS's file; this package only writes the "Inputs" sheet's data cells, so
// AWS's dropdowns, hidden sheets and the column A formulas stay as AWS made them.
package awsec2

import (
	"bytes"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/xuri/excelize/v2"
)

// Sheet is the template's input sheet.
const Sheet = "Inputs"

// MaxRows is the number of data rows AWS's template holds (rows 4 to 1003).
const MaxRows = 1000

// Row is one EC2 line of the template, in AWS's own wording ("Windows Server",
// "Shared Instances", "On-Demand", ...). Zero numbers are left blank.
type Row struct {
	Group       string `json:"group"`
	Description string `json:"description"`
	Region      string `json:"region"`
	OS          string `json:"os"`
	Type        string `json:"type"`
	Tenancy     string `json:"tenancy"`
	Count       int    `json:"count"`
	Usage       int    `json:"usage"`
	UsageType   string `json:"usageType"`
	Purchase    string `json:"purchase"`
	Storage     string `json:"storage"`
	GB          int    `json:"gb"`
	IOPS        int    `json:"iops"`
	Mbps        int    `json:"mbps"`
	SnapFreq    string `json:"snapFreq"`
	SnapGB      int    `json:"snapGb"`
}

// Columns are found by the start of their header text, as the importer in the browser
// does, so the file still fills if AWS moves a column.
var columns = []struct {
	key string
	re  *regexp.Regexp
}{
	{"group", regexp.MustCompile(`(?i)^group`)},
	{"description", regexp.MustCompile(`(?i)^description`)},
	{"region", regexp.MustCompile(`(?i)^aws region`)},
	{"os", regexp.MustCompile(`(?i)^operating system`)},
	{"type", regexp.MustCompile(`(?i)^instance type`)},
	{"tenancy", regexp.MustCompile(`(?i)^tenancy`)},
	{"count", regexp.MustCompile(`(?i)^number of instances`)},
	{"usage", regexp.MustCompile(`(?i)^assumed usage`)},
	{"usageType", regexp.MustCompile(`(?i)^usage type`)},
	{"purchase", regexp.MustCompile(`(?i)^purchasing option`)},
	{"storage", regexp.MustCompile(`(?i)^storage type`)},
	{"gb", regexp.MustCompile(`(?i)^storage amount`)},
	{"iops", regexp.MustCompile(`(?i)^provisioning iops`)},
	{"mbps", regexp.MustCompile(`(?i)^ebs throughput`)},
	{"snapFreq", regexp.MustCompile(`(?i)^snapshot frequency`)},
	{"snapGb", regexp.MustCompile(`(?i)^ebs snapshot amount`)},
}

// ErrNotTemplate means the file is not AWS's EC2 bulk upload template.
var ErrNotTemplate = errors.New(`this is not the AWS "EC2 Instances" bulk upload template`)

// The template refuses these characters in Group and Description.
var banned = strings.NewReplacer("<", "", ">", "", "&", "and")

func (r Row) value(key string) any {
	num := func(n int) any {
		if n <= 0 {
			return nil
		}
		return n
	}
	switch key {
	case "group":
		return banned.Replace(r.Group)
	case "description":
		return banned.Replace(r.Description)
	case "region":
		return r.Region
	case "os":
		return r.OS
	case "type":
		return r.Type
	case "tenancy":
		return r.Tenancy
	case "count":
		return num(r.Count)
	case "usage":
		return num(r.Usage)
	case "usageType":
		return r.UsageType
	case "purchase":
		return r.Purchase
	case "storage":
		return r.Storage
	case "gb":
		return num(r.GB)
	case "iops":
		return num(r.IOPS)
	case "mbps":
		return num(r.Mbps)
	case "snapFreq":
		return r.SnapFreq
	case "snapGb":
		return num(r.SnapGB)
	}
	return nil
}

// Fill writes rows into the template and returns the new file.
func Fill(template []byte, rows []Row) ([]byte, error) {
	if len(rows) == 0 {
		return nil, errors.New("there are no AWS virtual machines to export")
	}
	if len(rows) > MaxRows {
		return nil, fmt.Errorf("the template holds %d rows; this estimate has %d", MaxRows, len(rows))
	}
	f, err := excelize.OpenReader(bytes.NewReader(template))
	if err != nil {
		return nil, ErrNotTemplate
	}
	defer f.Close()
	if idx, err := f.GetSheetIndex(Sheet); err != nil || idx < 0 {
		return nil, ErrNotTemplate
	}
	all, err := f.GetRows(Sheet)
	if err != nil {
		return nil, ErrNotTemplate
	}
	header := -1
	for i, r := range all {
		hasType, hasRegion := false, false
		for _, c := range r {
			t := strings.TrimSpace(c)
			hasType = hasType || columns[4].re.MatchString(t)
			hasRegion = hasRegion || columns[2].re.MatchString(t)
		}
		if hasType && hasRegion {
			header = i
			break
		}
	}
	if header < 0 {
		return nil, ErrNotTemplate
	}
	col := map[string]int{} // key → 1-based column
	for i, c := range all[header] {
		t := strings.TrimSpace(c)
		for _, k := range columns {
			if _, done := col[k.key]; !done && k.re.MatchString(t) {
				col[k.key] = i + 1
			}
		}
	}
	for _, k := range columns {
		if col[k.key] == 0 {
			return nil, fmt.Errorf("%w: no %q column", ErrNotTemplate, k.key)
		}
	}
	first := header + 2 // 1-based row number of the first data row
	// AWS ships example rows; clear every data row we will not fill, so none survive.
	last := len(all)
	for r := first; r <= max(last, first+len(rows)-1); r++ {
		for _, k := range columns {
			cell, _ := excelize.CoordinatesToCellName(col[k.key], r)
			var v any
			if i := r - first; i < len(rows) {
				v = rows[i].value(k.key)
			}
			if err := f.SetCellValue(Sheet, cell, v); err != nil {
				return nil, err
			}
		}
	}
	var out bytes.Buffer
	if err := f.Write(&out); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
