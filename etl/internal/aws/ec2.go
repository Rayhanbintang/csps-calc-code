// Package aws reads AWS Price List bulk files and slims them to what the calculator uses.
package aws

import (
	"io"
	"sort"
	"strconv"
	"strings"
)

// Instance is one priced EC2 configuration: an instance type with one OS / licence combo.
type Instance struct {
	Type   string     `json:"t"`
	VCPU   int        `json:"c"`
	MemGiB float64    `json:"m"`
	Arch   string     `json:"ar,omitempty"`  // "arm" for Graviton; empty = x86
	OS     string     `json:"os"`            // Linux, Windows, RHEL, SUSE, ...
	SW     string     `json:"sw,omitempty"`  // pre-installed software, e.g. "SQL Std"; empty = none
	BYOL   bool       `json:"byol,omitempty"`
	OnDem  float64    `json:"od"`            // USD per hour
	RI     []Reserved `json:"ri,omitempty"`  // Reserved Instance options
	SP     []SPRate   `json:"sp,omitempty"`  // Savings Plans options
	usage  string
	op     string
}

// SPRate is the hourly rate of an instance under one Savings Plan.
type SPRate struct {
	Kind   string  `json:"k"` // "c" Compute SP, "e" EC2 Instance SP
	Term   int     `json:"y"`
	Pay    string  `json:"p"`
	Hourly float64 `json:"h"`
}

// Row is one non-instance price line (EBS, NAT gateway, load balancer hour, ...).
type Row struct {
	Key      string            `json:"k"`           // usage type without the region prefix
	Op       string            `json:"o,omitempty"` // operation
	Family   string            `json:"f,omitempty"`
	Unit     string            `json:"u"`
	Tiers    []Tier            `json:"t"`
	Attr     map[string]string `json:"a,omitempty"`
	Reserved []Reserved        `json:"ri,omitempty"`
}

// ec2Families are the non-instance EC2 product families the calculator prices.
var ec2Families = map[string]bool{
	"Storage": true, "System Operation": true, "Provisioned Throughput": true,
	"Storage Snapshot": true, "NAT Gateway": true, "IP Address": true,
}

// EC2Result is everything taken from one region's AmazonEC2 offer file.
type EC2Result struct {
	Instances []Instance // shared-tenancy VMs with on-demand and Reserved prices
	Rows      []Row      // EBS, NAT gateway, public IP
	Location  string     // display name, e.g. "Asia Pacific (Jakarta)"
	Prefix    string     // billing prefix of usage types, e.g. "APS4"; "USE1" for us-east-1
}

// ParseEC2 streams one region's AmazonEC2 offer file.
func ParseEC2(r io.Reader) (*EC2Result, error) {
	items, err := parseOffer(r, func(family string, a map[string]string) bool {
		if family == "Compute Instance" {
			return wantedInstance(a)
		}
		return ec2Families[family]
	})
	if err != nil {
		return nil, err
	}
	res := &EC2Result{}
	var others []*item
	for _, it := range items {
		if !it.hasOnDem {
			continue
		}
		if it.Family != "Compute Instance" {
			others = append(others, it)
			continue
		}
		inst, ok := toInstance(it)
		if !ok {
			continue
		}
		if res.Location == "" {
			res.Location = it.Attr["location"]
		}
		if res.Prefix == "" {
			res.Prefix = prefixOf(inst.usage)
		}
		res.Instances = append(res.Instances, inst)
	}
	for _, it := range others {
		res.Rows = append(res.Rows, toRow(it, res.Prefix, []string{"volumeApiName"}))
	}
	sortInstances(res.Instances)
	sortRows(res.Rows)
	return res, nil
}

// prefixOf reads the billing prefix from an instance usage type:
// "APS4-BoxUsage:m5.large" -> "APS4"; "BoxUsage:m5.large" (us-east-1) -> "USE1".
func prefixOf(usage string) string {
	if i := strings.Index(usage, "-BoxUsage:"); i > 0 {
		return usage[:i]
	}
	return "USE1"
}

func wantedInstance(a map[string]string) bool {
	if a["tenancy"] != "Shared" || a["capacitystatus"] != "Used" {
		return false
	}
	if mo := a["marketoption"]; mo != "" && mo != "OnDemand" {
		return false
	}
	// "RunInstances:0002:box" and friends are the infrastructure-only half of a
	// licence-included SKU; the licence is billed on a separate line. The full price
	// a customer pays sits on the operation without ":box".
	return !strings.HasSuffix(a["operation"], ":box")
}

func toInstance(it *item) (Instance, bool) {
	a := it.Attr
	vcpu, err := strconv.Atoi(a["vcpu"])
	if err != nil {
		return Instance{}, false
	}
	mem, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(strings.ReplaceAll(a["memory"], ",", ""), "GiB")), 64)
	if err != nil {
		return Instance{}, false
	}
	if len(it.Tiers) == 0 || it.Tiers[0].USD <= 0 {
		return Instance{}, false // no on-demand price = not orderable as a normal VM here
	}
	sw := a["preInstalledSw"]
	if sw == "NA" {
		sw = ""
	}
	// processorArchitecture says "64-bit" for both Intel and Graviton; the processor
	// name is the reliable signal.
	arch := ""
	if strings.Contains(a["physicalProcessor"], "Graviton") || strings.Contains(strings.ToLower(a["processorArchitecture"]), "arm") {
		arch = "arm"
	}
	sortReserved(it.Reserved)
	return Instance{
		Type: a["instanceType"], VCPU: vcpu, MemGiB: mem, Arch: arch,
		OS: a["operatingSystem"], SW: sw, BYOL: a["licenseModel"] == "Bring your own license",
		OnDem: it.Tiers[0].USD, RI: it.Reserved,
		usage: a["usagetype"], op: a["operation"],
	}, true
}

// toRow converts an item to a Row, keeping only the listed attributes.
func toRow(it *item, prefix string, attrs []string) Row {
	row := Row{
		Key: stripPrefix(it.Attr["usagetype"], prefix), Op: it.Attr["operation"],
		Family: it.Family, Unit: it.Unit, Tiers: it.Tiers,
	}
	for _, k := range attrs {
		if v := it.Attr[k]; v != "" && v != "NA" {
			if row.Attr == nil {
				row.Attr = map[string]string{}
			}
			row.Attr[k] = v
		}
	}
	if len(it.Reserved) > 0 {
		sortReserved(it.Reserved)
		row.Reserved = it.Reserved
	}
	return row
}

// stripPrefix removes the billing region prefix ("APS4-") from a usage type.
// us-east-1 uses either no prefix or "USE1-" depending on the service.
func stripPrefix(usage, prefix string) string {
	if prefix != "" && strings.HasPrefix(usage, prefix+"-") {
		return usage[len(prefix)+1:]
	}
	return usage
}

func sortInstances(out []Instance) {
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Type != b.Type {
			return a.Type < b.Type
		}
		if a.OS != b.OS {
			return a.OS < b.OS
		}
		if a.SW != b.SW {
			return a.SW < b.SW
		}
		return !a.BYOL && b.BYOL
	})
}

func sortRows(rows []Row) {
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Key != rows[j].Key {
			return rows[i].Key < rows[j].Key
		}
		if rows[i].Op != rows[j].Op {
			return rows[i].Op < rows[j].Op
		}
		return attrKey(rows[i].Attr) < attrKey(rows[j].Attr)
	})
}

func attrKey(a map[string]string) string {
	keys := make([]string, 0, len(a))
	for k := range a {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k + "=" + a[k] + ";")
	}
	return b.String()
}
