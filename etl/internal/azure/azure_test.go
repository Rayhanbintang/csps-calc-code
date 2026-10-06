package azure

import "testing"

func TestSlim(t *testing.T) {
	vm := item{ServiceName: "Virtual Machines", ProductName: "Virtual Machines Dsv5 Series", SkuName: "Standard_D2s_v5", ArmSkuName: "Standard_D2s_v5",
		MeterName: "D2s v5", Unit: "1 Hour", Type: "Consumption", RetailPrice: 0.12}
	vm.SavingsPlan = append(vm.SavingsPlan, struct {
		RetailPrice float64 `json:"retailPrice"`
		Term        string  `json:"term"`
	}{0.055224, "3 Years"}, struct {
		RetailPrice float64 `json:"retailPrice"`
		Term        string  `json:"term"`
	}{0.0834, "1 Year"})
	r, ok := slim(vm)
	if !ok || r.ArmSku != "Standard_D2s_v5" || r.Type != "c" || len(r.SP) != 2 || r.SP[0] != [2]float64{1, 0.0834} {
		t.Fatalf("pay as you go VM row: %+v", r)
	}

	res := vm
	res.Type, res.Term, res.RetailPrice, res.SavingsPlan = "Reservation", "1 Year", 649, nil
	if r, ok := slim(res); !ok || r.Type != "r" || r.Years != 1 || r.Price != 649 {
		t.Fatalf("reservation row: %+v", r)
	}

	for _, drop := range []item{
		{ServiceName: "Virtual Machines", SkuName: "Standard_D2s_v5 Spot", Type: "Consumption"},
		{ServiceName: "Virtual Machines", SkuName: "Standard_D2s_v5 Low Priority", Type: "Consumption"},
		{ServiceName: "Virtual Machines", SkuName: "Standard_D2s_v5", Type: "DevTestConsumption"},
		{ServiceName: "Storage", ProductName: "Azure Managed Lustre", Type: "Consumption"},
	} {
		if _, ok := slim(drop); ok {
			t.Errorf("kept %+v", drop)
		}
	}
	if _, ok := slim(item{ServiceName: "Storage", ProductName: "Premium SSD Managed Disks", Type: "Consumption"}); !ok {
		t.Error("dropped a managed disk row")
	}
}
