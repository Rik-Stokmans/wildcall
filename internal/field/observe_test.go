package field

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func TestClarityMonotonic(t *testing.T) {
	c, _ := newCtx()
	p := withBinoculars(standing(), 6)
	at := func(d, cover float32) core.BirdState {
		return birdAt(1, spRobin, north(d, 2), core.ActPerched, cover)
	}
	clar := func(c *Context, b core.BirdState, p proto.Pose) float32 {
		return Clarity(c, b, lookAt(p, b.Pos)).Clarity
	}

	prev := float32(2)
	for _, d := range []float32{20, 40, 60, 80, 100} {
		v := clar(c, at(d, 0.2), p)
		if v > prev {
			t.Errorf("clarity rose with distance at %v m: %.3f > %.3f", d, v, prev)
		}
		prev = v
	}
	prev = 2
	for _, cov := range []float32{0, 0.3, 0.6, 0.9} {
		v := clar(c, at(30, cov), p)
		if v >= prev {
			t.Errorf("clarity did not fall with cover %.1f: %.3f", cov, v)
		}
		prev = v
	}
	prev = 2
	for _, light := range []float32{1, 0.6, 0.3, 0.05} {
		cc := *c
		cc.Env.Light = light
		v := clar(&cc, at(30, 0.2), p)
		if v >= prev {
			t.Errorf("clarity did not fall with darkness %.2f: %.3f", light, v)
		}
		prev = v
	}
	prev = -1
	for _, z := range []float32{1, 2, 4, 6} {
		pz := standing()
		if z > 1 {
			pz = withBinoculars(pz, z)
		}
		v := clar(c, at(60, 0.2), pz)
		if v < prev {
			t.Errorf("clarity fell with zoom %vx: %.3f < %.3f", z, v, prev)
		}
		prev = v
	}
	// Zoom is capped by the equipment.
	if a, b := clar(c, at(80, 0.2), withBinoculars(standing(), 6)), clar(c, at(80, 0.2), withBinoculars(standing(), 20)); b > a+1e-4 {
		t.Errorf("zoom beyond BinoZoom must not help: %.3f > %.3f", b, a)
	}
	// Rain and soft focus hurt.
	rainy := *c
	rainy.Env.Rain = 1
	if clar(&rainy, at(30, 0.2), p) >= clar(c, at(30, 0.2), p) {
		t.Errorf("rain should reduce clarity")
	}
	soft := p
	soft.Sharp = 0.2
	if clar(c, at(30, 0.2), soft) >= clar(c, at(30, 0.2), p) {
		t.Errorf("soft focus should reduce clarity")
	}
	// Airborne birds are harder.
	fl := at(30, 0)
	fl.Act = core.ActFlying
	if clar(c, fl, p) >= clar(c, at(30, 0), p) {
		t.Errorf("a flying bird should be harder to study")
	}
	// Blocked reasons.
	if v := Clarity(c, at(30, 0.9), lookAt(p, at(30, 0.9).Pos)); v.Blocked != "foliage" {
		t.Errorf("deep cover: blocked %q", v.Blocked)
	}
	if v := Clarity(c, at(120, 0.1), lookAt(standing(), at(120, 0.1).Pos)); v.Blocked != "distance" {
		t.Errorf("far bird: blocked %q", v.Blocked)
	}
	dark := *c
	dark.Env.Light = 0
	if v := Clarity(&dark, at(15, 0.1), lookAt(p, at(15, 0.1).Pos)); v.Blocked != "dark" {
		t.Errorf("night: blocked %q", v.Blocked)
	}
}

// watchFor ticks a Watch at 4 Hz for the given seconds and returns every reveal (in
// order), the last result and the time of the first sighting.
func watchFor(c *Context, w *Watch, p proto.Pose, birds []core.BirdState, seconds float32) (reveals []Reveal, last WatchResult, firstSeen float32) {
	firstSeen = -1
	for t := float32(0); t < seconds; t += 0.25 {
		last = w.Tick(c, 0.25, p, birds)
		if last.Sighting.Bird != 0 && firstSeen < 0 {
			firstSeen = t + 0.25
		}
		reveals = append(reveals, last.Reveals...)
	}
	return
}

func traitKeys(rs []Reveal) []string {
	var out []string
	for _, r := range rs {
		if _, ok := EvidenceGate(r.Key); ok {
			out = append(out, r.Key)
		}
	}
	return out
}

func TestRobinThroughBinocularsYieldsAllEvidence(t *testing.T) {
	c, _ := newCtx()
	c.Stats.BinoZoom = 8
	robin := birdAt(11, spRobin, north(25, 3), core.ActPerched, 0.2)
	p := lookAt(withBinoculars(standing(), 8), robin.Pos)

	var w Watch
	reveals, last, first := watchFor(c, &w, p, []core.BirdState{robin}, 2)
	if first < 0 || first > 1 {
		t.Fatalf("robin should be under observation within a second, first seen %.2f", first)
	}
	if last.Sighting.Clarity <= 0.7 {
		t.Errorf("robin at 25 m through 8x: clarity %.3f, want > 0.7", last.Sighting.Clarity)
	}
	more, last, _ := watchFor(c, &w, p, []core.BirdState{robin}, 10)
	reveals = append(reveals, more...)
	got := traitKeys(reveals)
	want := []string{"size", "shape", "primary", "secondary", "bill", "marking"}
	if len(got) != len(want) {
		t.Fatalf("within 12 s got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("reveal order %v, want %v", got, want)
		}
	}
	for _, r := range reveals {
		if _, ok := EvidenceGate(r.Key); ok && r.Value != c.Species[spRobin].TraitValue(r.Key) {
			t.Errorf("reveal %s = %q, want the true trait", r.Key, r.Value)
		}
	}
	ev := last.Sighting.Evidence
	if ev["habitat"] != "woodland" {
		t.Errorf("habitat evidence %q", ev["habitat"])
	}
	if last.Sighting.Known != "" || last.Species != spRobin {
		t.Errorf("unidentified robin: known %q species %d", last.Sighting.Known, last.Species)
	}
	if last.Sighting.Progress != 1 {
		t.Errorf("all visible evidence gathered: progress %.2f, want 1", last.Sighting.Progress)
	}
	if len(last.Sighting.Candidates) == 0 || last.Sighting.Candidates[0].Species != "test_robin" || last.Sighting.Candidates[0].Confidence < CertainConfidence {
		t.Errorf("candidates after a full look: %+v", last.Sighting.Candidates)
	}
}

func TestWrenInShrubWithholdsDetail(t *testing.T) {
	c, _ := newCtx()
	c.Stats.BinoZoom = 8
	wren := birdAt(12, spWren, north(25, -0.6), core.ActPerched, 0.6)
	p := lookAt(withBinoculars(standing(), 8), wren.Pos)

	var w Watch
	reveals, last, _ := watchFor(c, &w, p, []core.BirdState{wren}, 30)
	if last.Sighting.Bird != wren.ID {
		t.Fatalf("the wren should still be under observation")
	}
	if cl := last.Sighting.Clarity; cl >= 0.45 {
		t.Errorf("wren deep in a shrub: clarity %.3f, want < 0.45", cl)
	}
	for _, k := range traitKeys(reveals) {
		if k == "marking" || k == "secondary" || k == "bill" {
			t.Errorf("wren in cover revealed %q", k)
		}
	}
	if last.Sighting.Blocked != "foliage" {
		t.Errorf("blocked %q, want foliage", last.Sighting.Blocked)
	}

	// It comes out to forage in the open: the rest follows.
	wren.Act, wren.Cover, wren.Pos = core.ActForaging, 0.1, north(25, -1.6)
	p = lookAt(p, wren.Pos)
	more, last, _ := watchFor(c, &w, p, []core.BirdState{wren}, 15)
	if last.Sighting.Clarity < 0.65 {
		t.Errorf("wren in the open: clarity %.3f", last.Sighting.Clarity)
	}
	keys := traitKeys(more)
	if len(keys) == 0 || keys[len(keys)-1] != "marking" {
		t.Errorf("after coming out the wren should yield its marking last: %v", keys)
	}
}

func TestNakedEyeRange(t *testing.T) {
	c, _ := newCtx()
	near := birdAt(1, spRobin, north(10, 0), core.ActPerched, 0.1)
	var w Watch
	reveals, last, _ := watchFor(c, &w, lookAt(standing(), near.Pos), []core.BirdState{near}, 6)
	if last.Sighting.Bird == 0 || len(traitKeys(reveals)) < 2 {
		t.Errorf("naked eye at 10 m should give size and shape: %v", traitKeys(reveals))
	}
	// A small bird on an open perch is worth watching to about 20 m with the naked
	// eye: at 17 m size, shape and its main colour.
	mid := birdAt(3, spRobin, north(17, 0), core.ActPerched, 0.1)
	var w3 Watch
	reveals, last, _ = watchFor(c, &w3, lookAt(standing(), mid.Pos), []core.BirdState{mid}, 12)
	if got := traitKeys(reveals); len(got) < 3 || got[2] != "primary" {
		t.Errorf("naked eye at 17 m should give size, shape and primary: %v (clarity %.3f)", got, last.Sighting.Clarity)
	}
	far := birdAt(2, spRobin, north(26, 0), core.ActPerched, 0.1)
	var w2 Watch
	_, last, _ = watchFor(c, &w2, lookAt(standing(), far.Pos), []core.BirdState{far}, 4)
	if last.Sighting.Bird != 0 {
		t.Errorf("naked eye at 26 m should not make out a robin (clarity %.3f)", last.Sighting.Clarity)
	}
}

// Through 6× glasses an exposed songbird at 30-40 m gives up every visible trait
// in about ten seconds.
func TestSixTimesAtFortyMetres(t *testing.T) {
	for _, d := range []float32{30, 40} {
		c, _ := newCtx()
		c.Stats.BinoZoom = 6
		robin := birdAt(21, spRobin, north(d, 3), core.ActPerched, 0.2)
		p := lookAt(withBinoculars(standing(), 6), robin.Pos)
		var w Watch
		reveals, last, _ := watchFor(c, &w, p, []core.BirdState{robin}, 11)
		if got := traitKeys(reveals); len(got) != 6 {
			t.Errorf("6x at %.0f m: %v within 11 s (clarity %.3f, blocked %q)", d, got, last.Sighting.Clarity, last.Sighting.Blocked)
		}
	}
}

func TestWatchNeedsAttentionAndAim(t *testing.T) {
	c, _ := newCtx()
	b := birdAt(3, spRobin, north(8, 0), core.ActPerched, 0.1)
	var w Watch
	p := lookAt(standing(), b.Pos)
	if r := w.Tick(c, 0.25, p, []core.BirdState{b}); r.Sighting.Bird != 0 {
		t.Errorf("a glance must not be enough: attention time first")
	}
	// Looking well away: nothing.
	away := p
	away.Yaw += rad(40)
	var w2 Watch
	_, last, _ := watchFor(c, &w2, away, []core.BirdState{b}, 3)
	if last.Sighting.Bird != 0 {
		t.Errorf("a bird 40° off axis must not be studied")
	}
	// Lost subject lingers briefly, then the sighting ends.
	watchFor(c, &w, p, []core.BirdState{b}, 2)
	r := w.Tick(c, 0.25, p, nil)
	if r.Sighting.Bird != 0 {
		t.Errorf("a bird gone from the world ends the sighting")
	}
}

func TestEvidenceGates(t *testing.T) {
	sp := &testCatalog()[spRobin]
	cases := []struct {
		clarity float32
		have    map[string]string
		key     string
	}{
		{0.1, nil, ""},
		{0.25, nil, "size"},
		{0.25, map[string]string{"size": "small", "shape": "songbird"}, ""},
		{0.35, map[string]string{"size": "small", "shape": "songbird"}, "primary"},
		{0.4, map[string]string{"size": "small", "shape": "songbird", "primary": "brown"}, ""},
		{0.5, map[string]string{"size": "small", "shape": "songbird", "primary": "brown"}, "secondary"},
		{0.6, map[string]string{"size": "small", "shape": "songbird", "primary": "brown", "secondary": "orange", "bill": "thin"}, ""},
		{0.7, map[string]string{"size": "small", "shape": "songbird", "primary": "brown", "secondary": "orange", "bill": "thin"}, "marking"},
	}
	for _, tc := range cases {
		ev := map[string]string{}
		for k, v := range tc.have {
			ev[k] = v
		}
		if k, _ := nextTrait(ev, sp, tc.clarity, false); k != tc.key {
			t.Errorf("clarity %.2f with %v: next %q, want %q", tc.clarity, tc.have, k, tc.key)
		}
	}
	// Flight style only while airborne, after primary.
	ev := map[string]string{"size": "small", "shape": "songbird", "primary": "brown"}
	if k, _ := nextTrait(ev, sp, 0.3, true); k != "flight" {
		t.Errorf("airborne: next %q, want flight", k)
	}
	if _, ok := EvidenceGate("pitch"); ok {
		t.Errorf("pitch is not revealed by watching")
	}
}

func TestKnownSpeciesRecognised(t *testing.T) {
	c, _ := newCtx()
	c.Know = &Memory{Known: map[string]bool{"test_robin": true}, Evid: map[string]map[string]string{"test_robin": {"size": "small"}}}
	b := birdAt(5, spRobin, north(25, 3), core.ActPerched, 0.2)
	p := lookAt(withBinoculars(standing(), 6), b.Pos)

	var w Watch
	// The first sighting tick: not yet recognised, and nothing is shown.
	var res WatchResult
	for i := 0; i < 3 && res.Sighting.Bird == 0; i++ {
		res = w.Tick(c, 0.25, p, []core.BirdState{b})
	}
	if res.Sighting.Bird == 0 {
		t.Fatal("no sighting")
	}
	if res.Sighting.Known != "" || len(res.Sighting.Evidence) != 0 {
		t.Errorf("not recognised yet, but sighting shows %q %v", res.Sighting.Known, res.Sighting.Evidence)
	}
	recognised := false
	for i := 0; i < 12; i++ {
		res = w.Tick(c, 0.25, p, []core.BirdState{b})
		if res.Recognised {
			recognised = true
		}
		if res.Sighting.Known == "test_robin" {
			break
		}
	}
	if res.Sighting.Known != "test_robin" || !recognised {
		t.Fatalf("an identified robin in clear view should be recognised within ~1.5 s: %+v", res.Sighting)
	}
	if len(res.Sighting.Candidates) != 0 {
		t.Errorf("a known species needs no candidate table")
	}

	// With Recognise >= 1 it is known at a glance.
	c.Stats.Recognise = 1
	var w2 Watch
	for i := 0; i < 3; i++ {
		res = w2.Tick(c, 0.25, p, []core.BirdState{b})
		if res.Sighting.Bird != 0 {
			break
		}
	}
	if res.Sighting.Known != "test_robin" {
		t.Errorf("Recognise should give recognition at a glance: %+v", res.Sighting)
	}

	// An unidentified species is never "known", and carries its mystery id.
	c.Know = &Memory{Known: map[string]bool{"test_robin": true}, Mysteries: map[string]*proto.Mystery{"test_wren": {ID: "m2"}}}
	wb := birdAt(6, spWren, north(12, -0.6), core.ActForaging, 0.1)
	var w3 Watch
	_, last, _ := watchFor(c, &w3, lookAt(withBinoculars(standing(), 6), wb.Pos), []core.BirdState{wb}, 3)
	if last.Sighting.Known != "" || last.Sighting.Mystery != "m2" {
		t.Errorf("unknown wren sighting: known %q mystery %q", last.Sighting.Known, last.Sighting.Mystery)
	}
}

func TestEncounterBehaviourAndMoment(t *testing.T) {
	c, _ := newCtx()
	b := birdAt(8, spRobin, north(20, 0), core.ActFeeding, 0.1)
	p := lookAt(withBinoculars(standing(), 6), b.Pos)
	var w Watch
	encounters, behaviour := 0, ""
	var last WatchResult
	for i := 0; i < 16; i++ {
		last = w.Tick(c, 0.25, p, []core.BirdState{b})
		if last.Encounter {
			encounters++
		}
		if last.Behavior != "" {
			behaviour = last.Behavior
		}
	}
	if encounters != 1 {
		t.Errorf("Encounter should fire exactly once, got %d", encounters)
	}
	if behaviour != "feeding" || last.Sighting.Evidence["behavior"] != "feeding" {
		t.Errorf("feeding should be observed: %q / %v", behaviour, last.Sighting.Evidence)
	}
	if last.Sighting.Moment {
		t.Errorf("Moment cue requires MomentBonus >= 1")
	}
	c.Stats.MomentBonus = 1
	last = w.Tick(c, 0.25, p, []core.BirdState{b})
	if !last.Sighting.Moment {
		t.Errorf("Moment cue expected for a feeding bird with MomentBonus 1")
	}
}
