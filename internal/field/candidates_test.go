package field

import (
	"reflect"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func evidenceOf(sp *core.Species, keys ...string) map[string]string {
	ev := map[string]string{}
	for _, k := range keys {
		ev[k] = sp.TraitValue(k)
	}
	return ev
}

func sumConf(cs []proto.Candidate) int {
	s := 0
	for _, c := range cs {
		s += c.Confidence
	}
	return s
}

func greenhollow() IDContext {
	return IDContext{Region: core.RegionGreenhollow, Season: core.Spring, Unlocked: []int{int(core.RegionGreenhollow)}}
}

func TestCandidatesFullEvidenceIsConfident(t *testing.T) {
	cat := testCatalog()
	st := core.BaseStats()
	for _, i := range []int{spRobin, spWren, spBlackbird, spGoldcrest, spDunnock, spChaffinch, spGreatTit, spNightingale} {
		sp := &cat[i]
		ev := evidenceOf(sp, "size", "shape", "primary", "secondary", "marking")
		cs := Candidates(ev, nil, greenhollow(), st, cat)
		if s := sumConf(cs); s < 99 || s > 101 {
			t.Errorf("%s: confidences sum to %d", sp.ID, s)
		}
		if len(cs) == 0 || cs[0].Species != sp.ID || cs[0].Confidence < CertainConfidence {
			t.Errorf("%s: full evidence should make it the >= 70%% favourite: %+v", sp.ID, cs)
		}
		if got := ConfidenceFor(sp.ID, ev, nil, greenhollow(), st, cat); got != cs[0].Confidence {
			t.Errorf("ConfidenceFor %d != table %d", got, cs[0].Confidence)
		}
	}
}

func TestCandidatesAmbiguousWithLittleEvidence(t *testing.T) {
	cat := testCatalog()
	st := core.BaseStats()
	robin := &cat[spRobin]
	for _, keys := range [][]string{{"size"}, {"pitch"}} {
		cs := Candidates(evidenceOf(robin, keys...), nil, greenhollow(), st, cat)
		if len(cs) < 2 {
			t.Fatalf("%v: expected a spread of candidates: %+v", keys, cs)
		}
		if cs[0].Confidence >= 50 {
			t.Errorf("%v alone should stay ambiguous: %+v", keys, cs)
		}
		if s := sumConf(cs); s < 99 || s > 101 {
			t.Errorf("%v: sum %d", keys, s)
		}
	}
	// Size + shape narrows, but not to certainty.
	cs := Candidates(evidenceOf(robin, "size", "shape"), nil, greenhollow(), st, cat)
	if cs[0].Confidence >= CertainConfidence {
		t.Errorf("size+shape should not be certain: %+v", cs)
	}
	// No evidence, no table.
	if cs := Candidates(map[string]string{}, nil, greenhollow(), st, cat); len(cs) != 0 {
		t.Errorf("empty evidence should give an empty table")
	}
}

func TestCandidatesRankingAndRules(t *testing.T) {
	cat := testCatalog()
	st := core.BaseStats()
	robin := &cat[spRobin]
	ev := evidenceOf(robin, "size", "shape", "primary", "secondary")

	cs := Candidates(ev, nil, greenhollow(), st, cat)
	if cs[0].Species != "test_robin" {
		t.Errorf("robin should lead: %+v", cs)
	}
	if len(cs) > 3 {
		t.Errorf("IDAssist 0 shows at most 3 entries: %d", len(cs))
	}
	for i := 1; i < len(cs); i++ {
		if cs[i].Confidence > cs[i-1].Confidence {
			t.Errorf("table not sorted: %+v", cs)
		}
	}

	// Wrong guesses are excluded.
	cw := Candidates(ev, []string{"test_robin"}, greenhollow(), st, cat)
	for _, c := range cw {
		if c.Species == "test_robin" {
			t.Errorf("ruled-out species listed: %+v", cw)
		}
	}
	if s := sumConf(cw); s < 99 || s > 101 {
		t.Errorf("sum %d", s)
	}

	// Locked regions: the marsh osprey is not considered from Greenhollow …
	osp := &cat[spOsprey]
	oev := evidenceOf(osp, "size", "shape", "primary", "secondary", "marking")
	for _, c := range Candidates(oev, nil, greenhollow(), st, cat) {
		if c.Species == "test_osprey" {
			t.Errorf("species of a locked region listed")
		}
	}
	// … unless the session includes it (a vagrant).
	ic := greenhollow()
	ic.Include = []string{"test_osprey"}
	if cs := Candidates(oev, nil, ic, st, cat); cs[0].Species != "test_osprey" {
		t.Errorf("included vagrant should be identifiable: %+v", cs)
	}

	// IDAssist lengthens the table and sharpens it toward the truth.
	sharp := st
	sharp.IDAssist = 2
	cl := Candidates(evidenceOf(robin, "size", "shape", "primary"), nil, greenhollow(), sharp, cat)
	cb := Candidates(evidenceOf(robin, "size", "shape", "primary"), nil, greenhollow(), st, cat)
	if wide := Candidates(evidenceOf(robin, "size"), nil, greenhollow(), sharp, cat); len(wide) != 5 {
		t.Errorf("IDAssist >= 1 should list up to 5: %+v", wide)
	}
	if Confidence(cl, "test_buzzard") > Confidence(cb, "test_buzzard") {
		t.Errorf("IDAssist should not raise a clear misfit")
	}

	// Season prior: the summer-only nightingale is less likely in autumn.
	nev := evidenceOf(&cat[spNightingale], "size", "shape", "primary")
	spring := Candidates(nev, nil, greenhollow(), st, cat)
	autumn := greenhollow()
	autumn.Season = core.Autumn
	if Confidence(Candidates(nev, nil, autumn, st, cat), "test_nightingale") >= Confidence(spring, "test_nightingale") {
		t.Errorf("season prior should lower an absent species")
	}

	// Deterministic.
	if !reflect.DeepEqual(Candidates(ev, nil, greenhollow(), st, cat), Candidates(ev, nil, greenhollow(), st, cat)) {
		t.Errorf("Candidates is not deterministic")
	}
}

func TestFitsAndMisfit(t *testing.T) {
	cat := testCatalog()
	robin := &cat[spRobin]
	cases := []struct {
		key, value string
		want       Fit
	}{
		{"size", "small", FitMatch}, {"size", "tiny", FitClose}, {"size", "huge", FitMiss},
		{"primary", "brown", FitMatch}, {"primary", "orange", FitClose}, {"primary", "blue", FitMiss},
		{"pitch", "very high", FitClose}, {"pattern", "melodic", FitMatch}, {"pattern", "booming", FitMiss},
		{"habitat", "woodland", FitMatch}, {"habitat", "ocean", FitMiss},
		{"behavior", "perched", FitNeutral}, {"behavior", "bathing", FitMatch}, {"behavior", "soaring", FitMiss},
		{"marking", "", FitNeutral},
	}
	for _, tc := range cases {
		if got := Fits(robin, tc.key, tc.value); got != tc.want {
			t.Errorf("Fits(robin, %s, %q) = %v, want %v", tc.key, tc.value, got, tc.want)
		}
	}
	wren := &cat[spWren]
	note := MisfitNote(robin, evidenceOf(wren, "size", "marking"))
	if note == "" || !contains([]string{"You noted its cocked tail, which a Test Robin does not have."}, note) {
		t.Errorf("misfit note %q", note)
	}
	if _, _, ok := Misfit(robin, evidenceOf(robin, "size", "shape", "marking")); ok {
		t.Errorf("matching evidence must not produce a misfit")
	}
}
