package field

import (
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func kinds(ds []proto.RareDiscovery) []string {
	var out []string
	for _, d := range ds {
		out = append(out, d.Kind)
	}
	return out
}

func TestRareFromSighting(t *testing.T) {
	cat := testCatalog()
	osp := &cat[spOsprey]
	b := birdAt(40, spOsprey, north(30, 10), core.ActSoaring, 0)

	if ds := RareFromSighting(b, osp, 0.8, core.RegionMurmurMarsh, false); len(ds) != 0 {
		t.Errorf("rarity must not be announced before identification: %v", kinds(ds))
	}
	ds := RareFromSighting(b, osp, 0.8, core.RegionMurmurMarsh, true)
	if len(ds) != 1 || ds[0].Kind != RareKindSpecies || ds[0].Species != "test_osprey" || ds[0].Rarity < 2 {
		t.Errorf("rare species seen: %+v", ds)
	}
	if ds := RareFromSighting(b, osp, 0.2, core.RegionMurmurMarsh, true); len(ds) != 0 {
		t.Errorf("too unclear to count: %v", kinds(ds))
	}

	// Vagrant: only once known.
	robin := &cat[spRobin]
	v := birdAt(41, spRobin, north(10, 0), core.ActPerched, 0.1)
	v.Flags = core.FlagVagrant
	if ds := RareFromSighting(v, robin, 0.8, core.RegionWindpeak, false); len(ds) != 0 {
		t.Errorf("unknown vagrant leaked: %v", kinds(ds))
	}
	if ds := RareFromSighting(v, robin, 0.8, core.RegionWindpeak, true); len(ds) != 1 || ds[0].Kind != RareKindVagrant {
		t.Errorf("vagrant: %+v", ds)
	}

	// Plumage: visible to anyone at clarity >= 0.5, nameless until known.
	pl := v
	pl.Flags = core.FlagRarePlumage
	if ds := RareFromSighting(pl, robin, 0.45, core.RegionGreenhollow, false); len(ds) != 0 {
		t.Errorf("plumage below 0.5 clarity: %v", kinds(ds))
	}
	ds = RareFromSighting(pl, robin, 0.55, core.RegionGreenhollow, false)
	if len(ds) != 1 || ds[0].Kind != RareKindPlumage || ds[0].Species != "" || strings.Contains(ds[0].Text+ds[0].Title, "Robin") {
		t.Errorf("unknown pale bird must not be named: %+v", ds)
	}
	ds = RareFromSighting(pl, robin, 0.55, core.RegionGreenhollow, true)
	if len(ds) != 1 || ds[0].Species != "test_robin" {
		t.Errorf("known pale bird: %+v", ds)
	}
}

func TestRareFromIdentificationBehaviorAndLog(t *testing.T) {
	cat := testCatalog()
	osp, robin := &cat[spOsprey], &cat[spRobin]
	ds := RareFromIdentification(osp, 7, core.FlagVagrant|core.FlagRarePlumage, core.RegionGreenhollow)
	got := kinds(ds)
	if len(got) != 3 || got[0] != RareKindSpecies || got[1] != RareKindVagrant || got[2] != RareKindPlumage {
		t.Errorf("identification discoveries: %v", got)
	}
	if ds := RareFromIdentification(robin, 7, 0, core.RegionGreenhollow); len(ds) != 0 {
		t.Errorf("a common bird is not a rare discovery: %v", kinds(ds))
	}

	if _, ok := RareFromBehavior(robin, core.ActPerched); ok {
		t.Errorf("perching is not a discovery")
	}
	if _, ok := RareFromBehavior(robin, core.ActFeeding); ok {
		t.Errorf("a robin feeding is a nice moment, not a rarity")
	}
	d, ok := RareFromBehavior(robin, core.ActBathing)
	if !ok || d.Kind != RareKindBehavior || d.ID != "behavior:test_robin:bathing" {
		t.Errorf("bathing robin: %+v %v", d, ok)
	}
	if _, ok := RareFromBehavior(osp, core.ActHovering); !ok {
		t.Errorf("hovering is one of the osprey's specials")
	}

	log := []*proto.RareDiscovery{&d}
	if !HasRare(log, d.ID) || HasRare(log, "behavior:test_robin:social") {
		t.Errorf("HasRare")
	}
	if !OutOfRange(osp, core.RegionGreenhollow) || OutOfRange(robin, core.RegionGreenhollow) {
		t.Errorf("OutOfRange")
	}
}

func TestRareFromPhoto(t *testing.T) {
	c, _ := newCtx()
	c.Stats.CamQuality, c.Stats.MomentBonus = 1, 1
	b := birdAt(1, spRobin, north(4, 0), core.ActBathing, 0)
	s := ScorePhoto(c, shotAt(b.Pos, 8), []core.BirdState{b})
	if s.Meta.Score < exceptionalScore {
		t.Fatalf("test shot should be exceptional, scored %d (%+v)", s.Meta.Score, s.Meta)
	}
	d, ok := RareFromPhoto(c, s)
	if !ok || d.Kind != RareKindPhoto || d.Species != "" || strings.Contains(d.Text, "Robin") {
		t.Errorf("exceptional photo of an unknown bird: %+v", d)
	}
	c.Know = &Memory{Known: map[string]bool{"test_robin": true}}
	d, ok = RareFromPhoto(c, ScorePhoto(c, shotAt(b.Pos, 8), []core.BirdState{b}))
	if !ok || d.ID != "exceptional_photo:test_robin" || d.Species != "test_robin" {
		t.Errorf("exceptional photo of a known bird: %+v", d)
	}
	c.Stats.CamQuality = 0.5
	if _, ok := RareFromPhoto(c, ScorePhoto(c, shotAt(b.Pos, 8), []core.BirdState{b})); ok {
		t.Errorf("a capped photo is not exceptional")
	}
}

func TestEvidenceHelpers(t *testing.T) {
	if EvidenceLabel("marking") != "Field mark" || EvidenceLabel("primary") != "Main colour" {
		t.Errorf("labels")
	}
	if EvidenceText("habitat", "shrub") != "Dense shrubs" || EvidenceText("pitch", "very high") != "Very high" {
		t.Errorf("text: %q %q", EvidenceText("habitat", "shrub"), EvidenceText("pitch", "very high"))
	}
	ev := map[string]string{"pitch": "high", "pattern": "trill", "habitat": "woodland", "bogus": "x"}
	if EvidenceCount(ev) != 3 {
		t.Errorf("count %d", EvidenceCount(ev))
	}
	if IDMethod(ev) != "sound" {
		t.Errorf("method %q", IDMethod(ev))
	}
	ev["size"] = "small"
	if IDMethod(ev) != "mixed" || IDMethod(map[string]string{"size": "small"}) != "sight" {
		t.Errorf("method mixed/sight")
	}
}

func TestProfileKnowledge(t *testing.T) {
	p := &proto.Profile{Journal: proto.Journal{
		Species:    map[string]*proto.SpeciesEntry{"test_robin": {ID: "test_robin", Evidence: map[string]string{"size": "small"}}},
		Mysteries:  []*proto.Mystery{{ID: "m1", Species: "test_wren", Evidence: map[string]string{"pitch": "very high"}, Recs: []string{"r1"}}},
		Recordings: []*proto.RecMeta{{ID: "r2", Species: "test_robin"}},
	}}
	k := ProfileKnowledge{P: p}
	if !k.Identified("test_robin") || k.Identified("test_wren") {
		t.Errorf("Identified")
	}
	if !k.Recorded("test_robin") || !k.Recorded("test_wren") || k.Recorded("test_buzzard") {
		t.Errorf("Recorded")
	}
	if m := k.Mystery("test_wren"); m == nil || m.ID != "m1" {
		t.Errorf("Mystery")
	}
	if k.Evidence("test_robin")["size"] != "small" || k.Evidence("test_wren")["pitch"] != "very high" {
		t.Errorf("Evidence")
	}
	var none ProfileKnowledge
	if none.Identified("x") || none.Recorded("x") || none.Mystery("x") != nil {
		t.Errorf("nil profile")
	}
}
