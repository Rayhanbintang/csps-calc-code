package aws

import (
	"strings"
	"testing"
)

// Trimmed from the real ap-southeast-3 offer file (2026-09-25): m5.large Windows appears
// three times. Only the licence-included row (operation without ":box") is the price a
// customer pays.
const fixture = `{
  "formatVersion": "v1.0",
  "products": {
    "BYOL": {"sku": "BYOL", "productFamily": "Compute Instance", "attributes": {
      "instanceType": "m5.large", "vcpu": "2", "memory": "8 GiB", "operatingSystem": "Windows",
      "preInstalledSw": "NA", "licenseModel": "Bring your own license", "tenancy": "Shared",
      "capacitystatus": "Used", "marketoption": "OnDemand", "operation": "RunInstances:0800"}},
    "LI": {"sku": "LI", "productFamily": "Compute Instance", "attributes": {
      "instanceType": "m5.large", "vcpu": "2", "memory": "8 GiB", "operatingSystem": "Windows",
      "preInstalledSw": "NA", "licenseModel": "No License required", "tenancy": "Shared",
      "capacitystatus": "Used", "marketoption": "OnDemand", "operation": "RunInstances:0002"}},
    "BOX": {"sku": "BOX", "productFamily": "Compute Instance", "attributes": {
      "instanceType": "m5.large", "vcpu": "2", "memory": "8 GiB", "operatingSystem": "Windows",
      "preInstalledSw": "NA", "licenseModel": "License Included - Infrastructure", "tenancy": "Shared",
      "capacitystatus": "Used", "marketoption": "OnDemand", "operation": "RunInstances:0002:box"}},
    "GRAVITON": {"sku": "GRAVITON", "productFamily": "Compute Instance", "attributes": {
      "instanceType": "m6g.large", "vcpu": "2", "memory": "8 GiB", "operatingSystem": "Linux",
      "preInstalledSw": "NA", "licenseModel": "No License required", "tenancy": "Shared",
      "capacitystatus": "Used", "marketoption": "OnDemand", "operation": "RunInstances",
      "physicalProcessor": "AWS Graviton2 Processor", "processorArchitecture": "64-bit"}},
    "DEDICATED": {"sku": "DEDICATED", "productFamily": "Compute Instance", "attributes": {
      "instanceType": "m5.large", "vcpu": "2", "memory": "8 GiB", "operatingSystem": "Linux",
      "preInstalledSw": "NA", "licenseModel": "No License required", "tenancy": "Dedicated",
      "capacitystatus": "Used", "marketoption": "OnDemand", "operation": "RunInstances"}}
  },
  "terms": {
    "OnDemand": {
      "BYOL": {"BYOL.od": {"priceDimensions": {"a": {"unit": "Hrs", "pricePerUnit": {"USD": "0.1200000000"}}}}},
      "LI":   {"LI.od":   {"priceDimensions": {"a": {"unit": "Hrs", "pricePerUnit": {"USD": "0.2120000000"}}}}},
      "GRAVITON": {"G.od": {"priceDimensions": {"a": {"unit": "Hrs", "pricePerUnit": {"USD": "0.0960000000"}}}}},
      "BOX":  {"BOX.od":  {"priceDimensions": {"a": {"unit": "Hrs", "pricePerUnit": {"USD": "0.1200000000"}}}}},
      "DEDICATED": {"D.od": {"priceDimensions": {"a": {"unit": "Hrs", "pricePerUnit": {"USD": "0.1300000000"}}}}}
    },
    "Reserved": {
      "LI": {"LI.ri": {
        "priceDimensions": {
          "h": {"unit": "Hrs", "pricePerUnit": {"USD": "0.0500000000"}},
          "u": {"unit": "Quantity", "pricePerUnit": {"USD": "700"}}},
        "termAttributes": {"LeaseContractLength": "1yr", "OfferingClass": "standard", "PurchaseOption": "Partial Upfront"}}}
    }
  }
}`

func TestParseEC2Windows(t *testing.T) {
	res, err := ParseEC2(strings.NewReader(fixture))
	if err != nil {
		t.Fatal(err)
	}
	var got []Instance
	var grav *Instance
	for i := range res.Instances {
		if res.Instances[i].Type == "m6g.large" {
			grav = &res.Instances[i]
			continue
		}
		got = append(got, res.Instances[i])
	}
	if grav == nil || grav.Arch != "arm" {
		t.Errorf("m6g.large must be marked arm (processorArchitecture says only 64-bit); got %+v", grav)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 Windows rows (licence-included + BYOL; :box and dedicated dropped), got %d: %+v", len(got), got)
	}
	li, byol := got[0], got[1]
	if li.BYOL || li.OnDem != 0.212 {
		t.Errorf("licence-included Windows: want od 0.212, byol false; got %+v", li)
	}
	if !byol.BYOL || byol.OnDem != 0.12 {
		t.Errorf("BYOL Windows: want od 0.12, byol true; got %+v", byol)
	}
	want := Reserved{Term: 1, Class: "s", Pay: "partial", Hourly: 0.05, Upfront: 700}
	if len(li.RI) != 1 || li.RI[0] != want {
		t.Errorf("RI: want %+v, got %+v", want, li.RI)
	}
	if li.VCPU != 2 || li.MemGiB != 8 {
		t.Errorf("spec: want 2 vCPU / 8 GiB, got %d / %v", li.VCPU, li.MemGiB)
	}
}
