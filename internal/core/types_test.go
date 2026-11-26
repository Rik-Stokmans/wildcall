package core

import (
	"encoding/json"
	"testing"
)

// A []RegionID must travel as a JSON array of numbers: the client reads
// species.regions as a list. (encoding/json would otherwise base64 it as bytes.)
func TestRegionIDsMarshalAsArray(t *testing.T) {
	sp := Species{Regions: []RegionID{RegionGreenhollow, RegionAmberwood}}
	b, err := json.Marshal(struct {
		R []RegionID `json:"r"`
		P POI        `json:"p"`
	}{sp.Regions, POI{Region: RegionWindpeak}})
	if err != nil {
		t.Fatal(err)
	}
	var back struct {
		R []int `json:"r"`
		P struct {
			Region int `json:"region"`
		} `json:"p"`
	}
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("not an array of numbers: %s (%v)", b, err)
	}
	if len(back.R) != 2 || back.R[1] != int(RegionAmberwood) || back.P.Region != int(RegionWindpeak) {
		t.Fatalf("round trip mismatch: %s", b)
	}
	var rt []RegionID
	if err := json.Unmarshal([]byte(`[0,4,255]`), &rt); err != nil || len(rt) != 3 || rt[2] != RegionNone {
		t.Fatalf("unmarshal: %v %v", rt, err)
	}
}
