package awsec2

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

// A small stand-in for AWS's file: the same header row 3, column A formulas, and two
// example rows, as in Amazon_EC2_Instances_BulkUpload_Template_Commercial.xlsx.
func fakeTemplate(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	f.SetSheetName("Sheet1", Sheet)
	heads := []string{"Group\n(Group name cannot contain '>', '<' and '&')", "Description", "AWS Region \n", "Operating System", "Instance Type", "Tenancy",
		"Number of Instances ", "Assumed Usage", "Usage Type", "Purchasing Option", "Storage Type", "Storage amount per Instance \n(GB)",
		"Provisioning IOPS per instance", "EBS Throughput per Instance", "Snapshot Frequency", "EBS Snapshot amount per Instance (GB/snapshot)"}
	for i, h := range heads {
		c, _ := excelize.CoordinatesToCellName(i+2, 3)
		f.SetCellValue(Sheet, c, h)
	}
	for r := 4; r <= 10; r++ {
		c, _ := excelize.CoordinatesToCellName(1, r)
		f.SetCellFormula(Sheet, c, "IF(ISBLANK(H"+strings.TrimPrefix(c, "A")+"),0,1)")
	}
	f.SetSheetRow(Sheet, "B4", &[]any{"Production", "Test1", "us-east-1", "Linux", "t4g.nano", "Shared Instances", 1})
	f.SetSheetRow(Sheet, "B5", &[]any{"Beta", "Test2", "us-east-2", "Windows Server", "c5.4xlarge", "Shared Instances", 1})
	var b bytes.Buffer
	if err := f.Write(&b); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestFill(t *testing.T) {
	out, err := Fill(fakeTemplate(t), []Row{{
		Group: "Prod <core>", Description: "App & web", Region: "ap-southeast-3", OS: "Linux", Type: "m6i.large",
		Tenancy: "Shared Instances", Count: 3, UsageType: "Always On", Purchase: "On-Demand",
		Storage: "General Purpose SSD (gp3)", GB: 100, IOPS: 3000, Mbps: 125, SnapFreq: "No snapshot storage",
	}})
	if err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	get := func(c string) string { v, _ := f.GetCellValue(Sheet, c); return v }
	if get("B4") != "Prod core" || get("C4") != "App and web" || get("F4") != "m6i.large" || get("H4") != "3" || get("M4") != "100" {
		t.Errorf("row 4: got B=%q C=%q F=%q H=%q M=%q", get("B4"), get("C4"), get("F4"), get("H4"), get("M4"))
	}
	if get("I4") != "" {
		t.Errorf("assumed usage stays blank for Always On; got %q", get("I4"))
	}
	if get("B5") != "" || get("F5") != "" {
		t.Errorf("AWS's second example row must be cleared; got B5=%q F5=%q", get("B5"), get("F5"))
	}
	if fx, _ := f.GetCellFormula(Sheet, "A4"); fx != "IF(ISBLANK(H4),0,1)" {
		t.Errorf("column A formula must stay; got %q", fx)
	}
}

func TestFillRefusesOtherFiles(t *testing.T) {
	f := excelize.NewFile()
	var b bytes.Buffer
	f.Write(&b)
	if _, err := Fill(b.Bytes(), []Row{{Type: "m5.large"}}); err == nil {
		t.Error("a workbook without an Inputs sheet must be refused")
	}
	if _, err := Fill([]byte("not a zip"), []Row{{Type: "m5.large"}}); err == nil {
		t.Error("a file that is no workbook must be refused")
	}
}

// AWS's own file, when it is on this machine (it is not committed): the dropdowns AWS
// keeps in the x14 extension must survive the fill.
func TestFillKeepsAwsDropdowns(t *testing.T) {
	src, err := os.ReadFile("/mnt/c/Users/Raybin/Downloads/Amazon_EC2_Instances_BulkUpload_Template_Commercial.xlsx")
	if err != nil {
		t.Skip("AWS's template is not on this machine")
	}
	out, err := Fill(src, []Row{{Region: "ap-southeast-3", OS: "Linux", Type: "m6i.large", Tenancy: "Shared Instances", Count: 1, UsageType: "Always On", Purchase: "On-Demand"}})
	if err != nil {
		t.Fatal(err)
	}
	count := func(b []byte) int {
		z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, e := range z.File {
			if strings.HasPrefix(e.Name, "xl/worksheets/sheet") {
				r, _ := e.Open()
				x, _ := io.ReadAll(r)
				n += strings.Count(string(x), "<x14:dataValidation ")
			}
		}
		return n
	}
	if before, after := count(src), count(out); before == 0 || after != before {
		t.Errorf("x14 dropdowns: %d in AWS's file, %d after the fill", before, after)
	}
}
