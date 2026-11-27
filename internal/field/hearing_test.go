package field

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func TestAudibleRangeScales(t *testing.T) {
	st := core.BaseStats()
	loud := core.Call{Loud: 0.7}
	quiet := core.Call{Loud: 0.12}
	base := AudibleRange(loud, st, false, 0, 0)
	if want := loud.AudibleRange(); absf(base-want) > 0.01 {
		t.Fatalf("base range %.1f, want %.1f", base, want)
	}
	if q := AudibleRange(quiet, st, false, 0, 0); q >= base {
		t.Errorf("quieter call should carry less: %.1f >= %.1f", q, base)
	}
	if f := AudibleRange(loud, st, true, 0, 0); f <= base {
		t.Errorf("focus should extend range: %.1f <= %.1f", f, base)
	}
	if o := AudibleRange(loud, st, false, 0.8, 0); o >= base || o < base*0.5 {
		t.Errorf("occlusion should cut range but never below half: %.1f", o)
	}
	noisy := AudibleRange(loud, st, false, 0, 0.6)
	if noisy >= base {
		t.Errorf("noise should cut range: %.1f", noisy)
	}
	st2 := st
	st2.NoiseReduce = 0.5
	if r := AudibleRange(loud, st2, false, 0, 0.6); r <= noisy {
		t.Errorf("NoiseReduce should recover range: %.1f <= %.1f", r, noisy)
	}
	st3 := st
	st3.HearRange = 1.3
	if r := AudibleRange(loud, st3, false, 0, 0); r <= base {
		t.Errorf("HearRange should extend range")
	}
	if r := AudibleRange(loud, st, false, 0, 1); r < base*(1-maxMasking)-0.01 {
		t.Errorf("a storm must leave some range: %.1f", r)
	}
}

func TestHearScenarios(t *testing.T) {
	c, flat := newCtx()
	flat.Occ = func(from, to core.Vec3) float32 { return 0.4 } // typical woodland foliage
	p := standing()

	// A blackbird singing 60 m away in woodland is clearly heard.
	bb := birdAt(1, spBlackbird, north(60, 6), core.ActPerched, 0.6)
	h := mustHear(t, c, bb, p)
	if h.Clue.Confidence != "Clear" && h.Clue.Confidence != "Fair" {
		t.Errorf("blackbird at 60 m: confidence %q (strength %.2f), want Fair or Clear", h.Clue.Confidence, h.Loudness)
	}

	// A goldcrest is only heard when close.
	gc := birdAt(2, spGoldcrest, north(60, 6), core.ActPerched, 0.6)
	if _, ok := Hear(c, callFrom(gc, 3), gc, p, seeded()); ok {
		t.Errorf("goldcrest at 60 m in woodland should be inaudible")
	}
	gc.Pos = north(12, 4)
	mustHear(t, c, gc, p)

	// Wind and own movement mask a distant voice.
	far := birdAt(3, spBlackbird, north(160, 6), core.ActPerched, 0.6)
	mustHear(t, c, far, p)
	windy := *c
	windy.Env.Wind, windy.Env.Rain = 1, 0.6
	if _, ok := Hear(&windy, callFrom(far, 3), far, p, seeded()); ok {
		t.Errorf("a gale should mask a blackbird at 160 m")
	}
	run := p
	run.Speed, run.Move = 6.5, "sprint"
	hr, _ := Hear(c, callFrom(far, 3), far, run, seeded())
	if hr.Range >= h.Range {
		t.Errorf("sprinting should shrink the audible range: %.1f >= %.1f", hr.Range, h.Range)
	}
	// Focus extends it again.
	foc := p
	foc.Focus = true
	hf, _ := Hear(c, callFrom(far, 3), far, foc, seeded())
	if hf.Range <= h.Range {
		t.Errorf("focus should extend the range: %.1f <= %.1f", hf.Range, h.Range)
	}
}

func TestHearNeverLeaksUnknownSpecies(t *testing.T) {
	c, _ := newCtx()
	c.Stats.PitchInfo, c.Stats.PatternInfo, c.Stats.HabitatInfo, c.Stats.PerchHint, c.Stats.Instinct = 1, 1, 1, 1, 1
	c.Stats.CallRecognise, c.Stats.CallMemory = 1, 1
	c.Stats.DirAccuracy, c.Stats.DistAcc = 1, 1
	b := birdAt(9, spRobin, north(20, 2), core.ActPerched, 0.3)
	b.Flags = core.FlagVagrant
	for _, focus := range []bool{false, true} {
		p := standing()
		p.Focus = focus
		h := mustHear(t, c, b, p)
		if h.Clue.Known != "" {
			t.Fatalf("focus=%v: unidentified species leaked in Known: %q", focus, h.Clue.Known)
		}
		if !h.Clue.New || !h.NewVoice {
			t.Errorf("first hearing of an unknown voice should be New")
		}
		raw, _ := json.Marshal(h.Clue)
		s := strings.ToLower(string(raw))
		if strings.Contains(s, "robin") || strings.Contains(s, "test_") {
			t.Fatalf("clue JSON leaks the species: %s", raw)
		}
	}
	// A known mystery is tagged with its id, not the species.
	c.Know = &Memory{Mysteries: map[string]*proto.Mystery{"test_robin": {ID: "m1"}}}
	h := mustHear(t, c, b, standing())
	if h.Clue.Mystery != "m1" || h.Clue.New || h.Clue.Known != "" {
		t.Errorf("mystery clue: %+v", h.Clue)
	}
}

func TestHearKnownRules(t *testing.T) {
	c, _ := newCtx()
	b := birdAt(4, spRobin, north(20, 2), core.ActPerched, 0.3)
	mem := &Memory{Known: map[string]bool{"test_robin": true}}
	c.Know = mem

	if h := mustHear(t, c, b, standing()); h.Clue.Known != "" {
		t.Errorf("identified species without CallRecognise must not be named by ear")
	}
	fp := standing()
	fp.Focus = true
	if h := mustHear(t, c, b, fp); h.Clue.Known != "" {
		t.Errorf("focus must not name a species")
	}
	c.Stats.CallMemory = 1
	if h := mustHear(t, c, b, standing()); h.Clue.Known != "" {
		t.Errorf("CallMemory without a recording must not name the species")
	}
	mem.Recs = map[string]bool{"test_robin": true}
	if h := mustHear(t, c, b, standing()); h.Clue.Known != "test_robin" {
		t.Errorf("CallMemory + recording should recognise: %q", h.Clue.Known)
	}
	c.Stats.CallMemory = 0
	c.Stats.CallRecognise = 1
	if h := mustHear(t, c, b, standing()); h.Clue.Known != "test_robin" {
		t.Errorf("CallRecognise should recognise an identified species")
	}
	// CallRecognise never names an unidentified species.
	w := birdAt(5, spWren, north(20, 0), core.ActPerched, 0.6)
	if h := mustHear(t, c, w, standing()); h.Clue.Known != "" {
		t.Errorf("CallRecognise named an unidentified species")
	}
}

func bearingError(t *testing.T, acc float32) (meanErr, spread float32, words map[string]bool) {
	t.Helper()
	c, _ := newCtx()
	c.Stats.DirAccuracy = acc
	words = map[string]bool{}
	rng := seeded()
	b := birdAt(1, spBlackbird, core.V(origin.X+30, origin.Y+3, origin.Z-30), core.ActPerched, 0.3)
	truth := core.HeadingTo(origin, b.Pos)
	const n = 400
	var sum float32
	for i := 0; i < n; i++ {
		h, ok := Hear(c, callFrom(b, 3), b, standing(), rng)
		if !ok {
			t.Fatal("expected audible")
		}
		sum += absf(wrapPi(h.Clue.Bearing - truth))
		spread = h.Clue.Spread
		words[h.Clue.Dir] = true
	}
	return sum / n, spread, words
}

func TestDirectionErrorShrinksWithAccuracy(t *testing.T) {
	e0, s0, w0 := bearingError(t, 0)
	e5, s5, _ := bearingError(t, 0.5)
	e1, s1, w1 := bearingError(t, 1)
	if !(e0 > e5 && e5 > e1) {
		t.Errorf("mean bearing error should shrink: %.3f, %.3f, %.3f", e0, e5, e1)
	}
	if !(s0 > s5 && s5 > s1) {
		t.Errorf("spread should shrink: %.3f, %.3f, %.3f", s0, s5, s1)
	}
	if e1 > rad(5) {
		t.Errorf("precise hearing still off by %.1f° on average", e1*180/math.Pi)
	}
	eight := map[string]bool{}
	for i := 0; i < 16; i += 2 {
		eight[compassWords[i]] = true
	}
	for w := range w0 {
		if !eight[w] {
			t.Errorf("low accuracy should use 8-point words, got %q", w)
		}
	}
	if len(w1) > 2 {
		t.Errorf("precise hearing should settle on one or two 16-point words, got %v", w1)
	}
	if directionWord(rad(22.5), true) != "North-northeast" || directionWord(rad(22.5), false) == "North-northeast" {
		t.Errorf("direction words: 16-point when precise only")
	}
}

func TestStatGatedClueFields(t *testing.T) {
	c, _ := newCtx()
	// Beyond nearHearR (40 m) a beginner gets no elevation and no perch layer; close
	// up everyone does (TestCloseVoiceIsEasyToPlace).
	b := birdAt(1, spRobin, north(60, 6), core.ActPerched, 0.7)
	b.Flags = core.FlagRarePlumage

	h := mustHear(t, c, b, standing())
	cl := h.Clue
	if cl.Pitch != "" || cl.Pattern != "" || cl.Habitat != "" || cl.Perch != "" || cl.Elevation != "" || cl.ElevSpread != 0 || cl.Unusual {
		t.Errorf("beginner clue shows gated fields: %+v", cl)
	}
	if cl.DistMin == 0 && cl.DistMax == 0 {
		t.Errorf("DistAcc 0.15 should give a distance band")
	}
	if len(h.Evidence) != 0 {
		t.Errorf("beginner hearing should yield no evidence: %v", h.Evidence)
	}

	c.Stats.DistAcc = 0.05
	if cl := mustHear(t, c, b, standing()).Clue; cl.DistMin != 0 || cl.DistMax != 0 {
		t.Errorf("DistAcc <= 0.1 must not give a band: %v-%v", cl.DistMin, cl.DistMax)
	}

	// Focus temporarily grants pitch, pattern and habitat, but no perch hint.
	fp := standing()
	fp.Focus = true
	fc := mustHear(t, c, b, fp).Clue
	if fc.Pitch != "High" || fc.Pattern != "Melodic" || fc.Habitat != "Woodland canopy" || fc.Perch != "" {
		t.Errorf("focus clue: %+v", fc)
	}
	// Habitat Reading rank 1: habitat without focus; the perch hint while focusing.
	b.Pos = north(20, 6)
	c.Stats.HabitatInfo = 1
	// Unfocused it says only the coarse layer anyone hears; focused it adds the detail.
	if cl := mustHear(t, c, b, standing()).Clue; cl.Habitat != "Woodland canopy" || cl.Perch != "high in the crown" {
		t.Errorf("habitat reading 1, unfocused: %+v", cl)
	}
	if cl := mustHear(t, c, b, fp).Clue; cl.Perch != "high in the canopy" {
		t.Errorf("habitat reading 1, focused: no perch hint: %+v", cl)
	}
	c.Stats.HabitatInfo = 0

	c.Stats.PitchInfo, c.Stats.PatternInfo, c.Stats.HabitatInfo, c.Stats.PerchHint, c.Stats.Instinct = 1, 1, 1, 1, 1
	c.Stats.DirAccuracy, c.Stats.DistAcc = 0.7, 0.9
	h = mustHear(t, c, b, standing())
	cl = h.Clue
	if cl.Pitch != "High" || cl.Pattern != "Melodic" || cl.Habitat != "Woodland canopy" {
		t.Errorf("stat clue: %+v", cl)
	}
	if cl.Perch != "high in the canopy" {
		t.Errorf("perch hint %q", cl.Perch)
	}
	if cl.Elevation != "above" {
		t.Errorf("elevation %q", cl.Elevation)
	}
	if !cl.Unusual {
		t.Errorf("Instinct should flag rare plumage")
	}
	if h.Evidence["pitch"] != "high" || h.Evidence["pattern"] != "melodic" || h.Evidence["habitat"] != "woodland" {
		t.Errorf("evidence %v", h.Evidence)
	}
	if !(cl.DistMin <= h.Dist && h.Dist <= cl.DistMax) || cl.DistMax-cl.DistMin > 15 {
		t.Errorf("tight band %v-%v should contain %.1f", cl.DistMin, cl.DistMax, h.Dist)
	}
}

func TestDistanceBandContainsTruthAndTightens(t *testing.T) {
	rng := seeded()
	for _, d := range []float32{3, 18, 47, 120, 240} {
		var wLo, wHi float32
		for i := 0; i < 50; i++ {
			lo, hi := distanceBand(d, 0.15, rng)
			if lo > d || hi < d || hi <= 0 {
				t.Fatalf("band %v-%v misses %v", lo, hi, d)
			}
			wLo += hi - lo
			lo, hi = distanceBand(d, 1, rng)
			if lo > d || hi < d {
				t.Fatalf("tight band %v-%v misses %v", lo, hi, d)
			}
			wHi += hi - lo
		}
		if wHi > wLo {
			t.Errorf("d=%v: band should tighten with DistAcc (%.1f vs %.1f)", d, wHi/50, wLo/50)
		}
	}
}

func TestMergeHeardPrecedence(t *testing.T) {
	ev := map[string]string{}
	ch := MergeHeard(ev, Heard{Evidence: map[string]string{"pitch": "high"}, Primary: false})
	if len(ch) != 1 || ev["pitch"] != "high" {
		t.Fatalf("secondary call should fill a gap: %v", ev)
	}
	MergeHeard(ev, Heard{Evidence: map[string]string{"pitch": "low"}, Primary: false})
	if ev["pitch"] != "high" {
		t.Errorf("secondary call must not overwrite")
	}
	MergeHeard(ev, Heard{Evidence: map[string]string{"pitch": "medium"}, Primary: true})
	if ev["pitch"] != "medium" {
		t.Errorf("primary call should overwrite")
	}
}

// TestCloseVoiceIsEasyToPlace pins the close-range hearing numbers for a beginner
// (base stats, not focusing): spread, distance band, elevation and layer by range,
// and their monotonicity.
func TestCloseVoiceIsEasyToPlace(t *testing.T) {
	c, _ := newCtx()
	deg := func(r float32) float32 { return r * 180 / math.Pi }
	// The skill's own spread (the pre-proximity formula) for a voice at strength s.
	skillSpread := func(s float32) float32 {
		return rad(lerp(sigmaVagueDeg, sigmaPreciseDeg, c.Stats.DirAccuracy)) * (faintErrBase - faintErrSlope*s) * spreadSigmas
	}
	type row struct {
		d                      float32
		maxSpreadDeg, maxBandW float32
		elev                   bool
	}
	rows := []row{
		{4, 6, 3, true}, {8, 6, 4, true}, {12, 6, 5, true}, {18, 9.5, 8, true},
		{25, 12, 12, true}, {35, 25, 22, true}, {50, 0, 0, false}, {90, 0, 0, false},
	}
	var lastSpread, lastBand float32
	for _, r := range rows {
		b := birdAt(1, spWren, north(r.d, -core.EyeHeight+1.0), core.ActPerched, 0.2) // 1 m above the ground
		h := mustHear(t, c, b, standing())
		cl := h.Clue
		sp := deg(cl.Spread)
		t.Logf("%4.0f m: spread ±%.1f°  band %v-%v m  elevation %q %.1f°±%.1f°  layer %q", r.d, sp, cl.DistMin, cl.DistMax, cl.Elevation, deg(cl.Elev), deg(cl.ElevSpread), cl.Perch)
		if r.maxSpreadDeg > 0 && sp > r.maxSpreadDeg {
			t.Errorf("%.0f m: spread ±%.1f° > ±%.0f°", r.d, sp, r.maxSpreadDeg)
		}
		if r.d >= farBlendR && absf(cl.Spread-skillSpread(h.Loudness)) > 1e-4 {
			t.Errorf("%.0f m: beyond %d m the spread must be the skill's own (%.1f° vs %.1f°)", r.d, farBlendR, sp, deg(skillSpread(h.Loudness)))
		}
		if sp < lastSpread-0.01 {
			t.Errorf("%.0f m: spread shrank with distance (%.1f° < %.1f°)", r.d, sp, lastSpread)
		}
		lastSpread = sp
		if !(cl.DistMin <= h.Dist && h.Dist <= cl.DistMax) {
			t.Errorf("%.0f m: band %v-%v misses the truth", r.d, cl.DistMin, cl.DistMax)
		}
		bw := cl.DistMax - cl.DistMin
		if r.maxBandW > 0 && bw > r.maxBandW {
			t.Errorf("%.0f m: band %v-%v wider than %.0f m", r.d, cl.DistMin, cl.DistMax, r.maxBandW)
		}
		if bw < lastBand-0.01 {
			t.Errorf("%.0f m: band narrowed with distance", r.d)
		}
		lastBand = bw
		if got := cl.Elevation != "" && cl.ElevSpread > 0; got != r.elev {
			t.Errorf("%.0f m: elevation given = %v, want %v", r.d, got, r.elev)
		}
		if r.elev {
			if cl.Perch != "low, knee to head height" {
				t.Errorf("%.0f m: layer %q", r.d, cl.Perch)
			}
			if truth := elevationOf(origin, b.Pos); absf(cl.Elev-truth) > cl.ElevSpread*1.4 {
				t.Errorf("%.0f m: elevation %.1f° off the truth %.1f° by more than its spread", r.d, deg(cl.Elev), deg(truth))
			}
		} else if cl.Perch != "" {
			t.Errorf("%.0f m: a beginner gets no layer beyond %d m: %q", r.d, nearHearR, cl.Perch)
		}
	}

	// A close voice really is placed to a few degrees, draw after draw.
	rng := seeded()
	b := birdAt(2, spWren, north(10, -0.6), core.ActPerched, 0.2)
	truth := core.HeadingTo(origin, b.Pos)
	var worst float32
	for i := 0; i < 300; i++ {
		h, _ := Hear(c, callFrom(b, 3), b, standing(), rng)
		worst = maxf(worst, absf(wrapPi(h.Clue.Bearing-truth)))
		if h.Clue.DistMax-h.Clue.DistMin > 5 {
			t.Fatalf("10 m: band %v-%v", h.Clue.DistMin, h.Clue.DistMax)
		}
	}
	if deg(worst) > 7 {
		t.Errorf("10 m: worst bearing error %.1f°", deg(worst))
	}

	// Focus sharpens a close voice further.
	fp := standing()
	fp.Focus = true
	plain, foc := mustHear(t, c, b, standing()).Clue, mustHear(t, c, b, fp).Clue
	if !(foc.Spread < plain.Spread && foc.ElevSpread < plain.ElevSpread) {
		t.Errorf("focus should sharpen: spread %.3f vs %.3f, elevation %.3f vs %.3f", foc.Spread, plain.Spread, foc.ElevSpread, plain.ElevSpread)
	}

	// The coarse layer, by height above the ground.
	for _, tc := range []struct {
		above float32
		want  string
	}{{0.1, "low, on or near the ground"}, {1.2, "low, knee to head height"}, {4, "up in the branches"}, {9, "high in the crown"}} {
		bb := birdAt(3, spWren, north(10, -core.EyeHeight+tc.above), core.ActPerched, 0.2)
		if got := mustHear(t, c, bb, standing()).Clue.Perch; got != tc.want {
			t.Errorf("%.1f m up: layer %q, want %q", tc.above, got, tc.want)
		}
	}
}
