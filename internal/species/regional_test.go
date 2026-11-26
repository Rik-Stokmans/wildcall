package species

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// rgPinnedIDs is the regional roster in its pinned order (docs/contract.md §1 and the
// species-regional task): Murmur Marsh, Windpeak, Whispering Coast, Amberwood, Frostveil.
var rgPinnedIDs = []string{
	"mallard", "common_moorhen", "grey_heron", "eurasian_reed_warbler", "eurasian_bittern", "western_marsh_harrier",
	"northern_wheatear", "common_raven", "ring_ouzel", "golden_eagle",
	"herring_gull", "eurasian_oystercatcher", "great_cormorant", "atlantic_puffin",
	"redwing", "brambling", "hawfinch",
	"snow_bunting", "rock_ptarmigan", "snowy_owl",
}

// rgGreenhollowIDs is the other roster's pinned id list; Similar may point into it.
var rgGreenhollowIDs = []string{
	"european_robin", "blue_tit", "great_tit", "common_blackbird", "eurasian_wren", "common_chaffinch",
	"great_spotted_woodpecker", "eurasian_jay", "eurasian_nuthatch", "eurasian_treecreeper", "tawny_owl",
	"common_buzzard", "song_thrush", "goldcrest", "long_tailed_tit", "eurasian_blackcap", "common_chiffchaff",
	"grey_wagtail", "common_kingfisher", "golden_oriole",
}

// rgPinnedRegions: the region types each species occurs in, home region first.
var rgPinnedRegions = map[string][]core.RegionID{
	"mallard":                {core.RegionMurmurMarsh, core.RegionGreenhollow},
	"common_moorhen":         {core.RegionMurmurMarsh, core.RegionGreenhollow},
	"grey_heron":             {core.RegionMurmurMarsh, core.RegionGreenhollow, core.RegionWhisperingCoast},
	"eurasian_reed_warbler":  {core.RegionMurmurMarsh},
	"eurasian_bittern":       {core.RegionMurmurMarsh},
	"western_marsh_harrier":  {core.RegionMurmurMarsh},
	"northern_wheatear":      {core.RegionWindpeak},
	"common_raven":           {core.RegionWindpeak, core.RegionFrostveil},
	"ring_ouzel":             {core.RegionWindpeak},
	"golden_eagle":           {core.RegionWindpeak},
	"herring_gull":           {core.RegionWhisperingCoast, core.RegionMurmurMarsh},
	"eurasian_oystercatcher": {core.RegionWhisperingCoast},
	"great_cormorant":        {core.RegionWhisperingCoast},
	"atlantic_puffin":        {core.RegionWhisperingCoast},
	"redwing":                {core.RegionAmberwood},
	"brambling":              {core.RegionAmberwood},
	"hawfinch":               {core.RegionAmberwood},
	"snow_bunting":           {core.RegionFrostveil},
	"rock_ptarmigan":         {core.RegionFrostveil},
	"snowy_owl":              {core.RegionFrostveil},
}

func rgByID(t *testing.T) map[string]core.Species {
	t.Helper()
	m := map[string]core.Species{}
	for _, sp := range regionalSpecies() {
		m[sp.ID] = sp
	}
	return m
}

func TestRegionalIDsAndOrder(t *testing.T) {
	list := regionalSpecies()
	if len(list) != len(rgPinnedIDs) {
		t.Fatalf("got %d species, want %d", len(list), len(rgPinnedIDs))
	}
	for i, sp := range list {
		if sp.ID != rgPinnedIDs[i] {
			t.Errorf("position %d: got %q, want %q", i, sp.ID, rgPinnedIDs[i])
		}
	}
}

// The roster must satisfy the contract vocabulary on its own. Similar is cleared
// because it may legitimately reference the Greenhollow roster, which Validate cannot
// see when handed only this list.
func TestRegionalValidate(t *testing.T) {
	list := regionalSpecies()
	for i := range list {
		list[i].Similar = nil
	}
	for _, err := range Validate(list) {
		t.Error(err)
	}
}

// regionalSpecies must hand out fresh data on every call so no caller can corrupt
// another's copy (the test above mutates its list).
func TestRegionalFreshCopies(t *testing.T) {
	a := regionalSpecies()
	a[0].Similar[0] = "tampered"
	a[0].Calls[0].Notes[0].F0 = 1
	a[0].Look.Marks[0].Color = "#000000"
	b := regionalSpecies()
	if b[0].Similar[0] == "tampered" || b[0].Calls[0].Notes[0].F0 == 1 || b[0].Look.Marks[0].Color == "#000000" {
		t.Error("regionalSpecies shares mutable state between calls")
	}
}

func TestRegionalSimilar(t *testing.T) {
	known := map[string]bool{}
	for _, id := range rgPinnedIDs {
		known[id] = true
	}
	for _, id := range rgGreenhollowIDs {
		known[id] = true
	}
	for _, sp := range regionalSpecies() {
		seen := map[string]bool{}
		for _, s := range sp.Similar {
			if !known[s] {
				t.Errorf("%s: similar %q is not a pinned species id", sp.ID, s)
			}
			if s == sp.ID {
				t.Errorf("%s: lists itself as similar", sp.ID)
			}
			if seen[s] {
				t.Errorf("%s: similar %q listed twice", sp.ID, s)
			}
			seen[s] = true
		}
	}
}

// Similarity inside this roster is mutual: if the guide sends you from A to B to
// compare, B must send you back.
func TestRegionalSimilarSymmetric(t *testing.T) {
	m := rgByID(t)
	for _, sp := range m {
		for _, s := range sp.Similar {
			other, ok := m[s]
			if !ok {
				continue // Greenhollow species: the other roster's business
			}
			back := false
			for _, o := range other.Similar {
				back = back || o == sp.ID
			}
			if !back {
				t.Errorf("%s lists %s as similar, but not the other way round", sp.ID, s)
			}
		}
	}
}

func TestRegionalTraitTuplesUnique(t *testing.T) {
	seen := map[string]string{}
	markings := map[string]string{}
	for _, sp := range regionalSpecies() {
		tr := sp.Traits
		key := strings.Join([]string{tr.Size, tr.Shape, tr.Primary, tr.Secondary, tr.Marking, tr.Bill}, "|")
		if prev, dup := seen[key]; dup {
			t.Errorf("%s and %s share the trait tuple %s", prev, sp.ID, key)
		}
		seen[key] = sp.ID
		// The key field mark is what clinches an identification: it must be unique.
		if prev, dup := markings[tr.Marking]; dup {
			t.Errorf("%s and %s share the marking %q", prev, sp.ID, tr.Marking)
		}
		markings[tr.Marking] = sp.ID
	}
}

func TestRegionalTraitVocabulary(t *testing.T) {
	colours := map[string]bool{"brown": true, "black": true, "grey": true, "white": true, "blue": true, "green": true,
		"yellow": true, "red": true, "orange": true, "buff": true, "pink": true}
	bills := map[string]bool{"short": true, "thin": true, "stout": true, "dagger": true, "hooked": true, "flat": true,
		"long curved": true, "chisel": true}
	for _, sp := range regionalSpecies() {
		if !colours[sp.Traits.Primary] || !colours[sp.Traits.Secondary] {
			t.Errorf("%s: colour words %q/%q are outside the contract vocabulary", sp.ID, sp.Traits.Primary, sp.Traits.Secondary)
		}
		if !bills[sp.Traits.Bill] {
			t.Errorf("%s: bill word %q is outside the contract vocabulary", sp.ID, sp.Traits.Bill)
		}
		// Size words follow one scale across the roster (see the header of regional.go).
		var want string
		switch l := sp.Look.Length; {
		case l < 0.11:
			want = "tiny"
		case l < 0.20:
			want = "small"
		case l < 0.45:
			want = "medium"
		case l < 0.80:
			want = "large"
		default:
			want = "huge"
		}
		if sp.Traits.Size != want {
			t.Errorf("%s: size %q does not match length %.2f m (want %q)", sp.ID, sp.Traits.Size, sp.Look.Length, want)
		}
		if sp.Look.Wingspan < sp.Look.Length {
			t.Errorf("%s: wingspan %.2f shorter than body %.2f", sp.ID, sp.Look.Wingspan, sp.Look.Length)
		}
	}
}

func TestRegionalRegions(t *testing.T) {
	count := map[core.RegionID]int{}
	for _, sp := range regionalSpecies() {
		want := rgPinnedRegions[sp.ID]
		if len(sp.Regions) != len(want) {
			t.Errorf("%s: regions %v, want %v", sp.ID, sp.Regions, want)
			continue
		}
		for i := range want {
			if sp.Regions[i] != want[i] {
				t.Errorf("%s: regions %v, want %v", sp.ID, sp.Regions, want)
				break
			}
		}
		for _, r := range sp.Regions {
			count[r]++
		}
	}
	for r := core.RegionMurmurMarsh; r < core.RegionCount; r++ {
		if count[r] < 3 {
			t.Errorf("%s has only %d species, want >= 3", r.Name(), count[r])
		}
	}
}

func TestRegionalHabitats(t *testing.T) {
	m := rgByID(t)
	for id, sp := range m {
		var sum float32
		seen := map[string]bool{}
		for _, h := range sp.Habitats {
			if h.Weight <= 0 {
				t.Errorf("%s: habitat %s has weight %v", id, h.Habitat, h.Weight)
			}
			if seen[h.Habitat] {
				t.Errorf("%s: habitat %s listed twice", id, h.Habitat)
			}
			seen[h.Habitat] = true
			sum += h.Weight
		}
		if sum < 0.98 || sum > 1.02 {
			t.Errorf("%s: habitat weights sum to %.3f, want ~1", id, sum)
		}
	}
	// Greenhollow has no reedbeds: the species that also live there need its ponds,
	// creeks and rivers, i.e. the river habitat.
	for _, id := range []string{"mallard", "common_moorhen", "grey_heron"} {
		ok := false
		for _, h := range m[id].Habitats {
			ok = ok || (h.Habitat == "river" && h.Weight >= 0.3)
		}
		if !ok {
			t.Errorf("%s: needs a substantial river habitat weight to occur in Greenhollow", id)
		}
	}
}

func TestRegionalSeasons(t *testing.T) {
	summer := [4]bool{true, true, false, false}
	winter := [4]bool{false, false, true, true}
	want := map[string][4]bool{
		"eurasian_reed_warbler": summer,
		"northern_wheatear":     summer,
		"atlantic_puffin":       summer,
		"redwing":               winter,
		"brambling":             winter,
		"snowy_owl":             {false, false, false, true},
		"ring_ouzel":            {true, true, true, false},
	}
	for _, sp := range regionalSpecies() {
		w, ok := want[sp.ID]
		if !ok {
			w = [4]bool{true, true, true, true}
		}
		if sp.Seasons != w {
			t.Errorf("%s: seasons %v, want %v", sp.ID, sp.Seasons, w)
		}
	}
	// No region type may ever be empty of its own birds: every outer region keeps
	// resident species in every season, at least two of them - except Amberwood, whose
	// pinned roster is two winter visitors plus the resident (rare) hawfinch; in spring
	// and summer it is carried by the woodland birds the Greenhollow roster shares
	// with it.
	for r := core.RegionMurmurMarsh; r < core.RegionCount; r++ {
		need := 2
		if r == core.RegionAmberwood {
			need = 1
		}
		for s := 0; s < 4; s++ {
			n := 0
			for _, sp := range regionalSpecies() {
				for _, reg := range sp.Regions {
					if reg == r && sp.Seasons[s] {
						n++
					}
				}
			}
			if n < need {
				t.Errorf("%s has %d species in %s", r.Name(), n, core.Season(s))
			}
		}
	}
}

func TestRegionalRarity(t *testing.T) {
	want := map[string]core.Rarity{
		"eurasian_bittern":      core.Rare,
		"golden_eagle":          core.Rare,
		"hawfinch":              core.Rare,
		"snowy_owl":             core.Legendary,
		"western_marsh_harrier": core.Uncommon,
		"ring_ouzel":            core.Uncommon,
		"atlantic_puffin":       core.Uncommon,
		"rock_ptarmigan":        core.Uncommon,
	}
	var commonMin, rareMax float32 = 1e9, 0
	for _, sp := range regionalSpecies() {
		if sp.Rarity != want[sp.ID] { // missing key = Common
			t.Errorf("%s: rarity %v, want %v", sp.ID, sp.Rarity, want[sp.ID])
		}
		d := sp.Behavior.Density
		switch {
		case sp.Rarity == core.Common && d < commonMin:
			commonMin = d
		case sp.Rarity >= core.Rare && d > rareMax:
			rareMax = d
		}
		// Rare birds are hard-won, and nothing in a cozy game is harder than 5 / easier than 1.
		if sp.Rarity >= core.Rare && sp.Difficulty < 4 {
			t.Errorf("%s: a %v species with difficulty %d", sp.ID, sp.Rarity, sp.Difficulty)
		}
	}
	// "Rare and legendary species exist in very small numbers" (contract §3.2).
	if rareMax >= commonMin {
		t.Errorf("densest rare species (%.2f) is not scarcer than the scarcest common one (%.2f)", rareMax, commonMin)
	}
}

func TestRegionalCalls(t *testing.T) {
	for _, sp := range regionalSpecies() {
		if n := len(sp.Calls); n < 1 || n > 3 {
			t.Errorf("%s: %d calls, want 1-3", sp.ID, n)
		}
		for ci, c := range sp.Calls {
			if d := c.PhraseDur(); d < 0.15 || d > 8 {
				t.Errorf("%s call %d: phrase lasts %.2f s, want 0.15-8", sp.ID, ci, d)
			}
			if c.Gap <= 0 {
				t.Errorf("%s call %d: gap between repeats must be > 0", sp.ID, ci)
			}
			var mean, total float32
			for ni, n := range c.Notes {
				if n.Gap < 0 || n.Rate < 0 || n.Depth < 0 || n.Depth > 1 {
					t.Errorf("%s call %d note %d: gap/rate/depth out of range", sp.ID, ci, ni)
				}
				// Depth is a frequency fraction (max 0.5) except for the trill wave,
				// where it is an amplitude-modulation depth.
				if n.Wave != "trill" && n.Depth > 0.5 {
					t.Errorf("%s call %d note %d: vibrato depth %.2f > 0.5", sp.ID, ci, ni, n.Depth)
				}
				if (n.Rate == 0) != (n.Depth == 0) {
					t.Errorf("%s call %d note %d: rate and depth must be set together", sp.ID, ci, ni)
				}
				if n.Wave == "trill" && n.Rate == 0 {
					t.Errorf("%s call %d note %d: a trill needs a rate", sp.ID, ci, ni)
				}
				mean += (n.F0 + n.F1) / 2 * n.Dur
				total += n.Dur
			}
			mean /= total
			// The pitch word is the clue the player reads; it must agree with what
			// the synth will actually play (bands overlap: timbre shifts perception).
			band := map[string][2]float32{
				"low":       {40, 1100},
				"medium":    {500, 3600},
				"high":      {2800, 6500},
				"very high": {5500, 11000},
			}[c.Pitch]
			if mean < band[0] || mean > band[1] {
				t.Errorf("%s call %d: pitch %q but mean frequency is %.0f Hz", sp.ID, ci, c.Pitch, mean)
			}
		}
	}
}

// Two species that can be heard in the same region type must not give the player the
// same (pitch, pattern) clue pair for their primary call: audio is gameplay.
func TestRegionalPrimaryCallCluesDistinctPerRegion(t *testing.T) {
	for r := core.RegionMurmurMarsh; r < core.RegionCount; r++ {
		seen := map[string]string{}
		for _, sp := range regionalSpecies() {
			in := false
			for _, reg := range sp.Regions {
				in = in || reg == r
			}
			if !in {
				continue
			}
			key := sp.Calls[0].Pitch + "/" + sp.Calls[0].Pattern
			if prev, dup := seen[key]; dup {
				t.Errorf("%s: %s and %s both sound %s", r.Name(), prev, sp.ID, key)
			}
			seen[key] = sp.ID
		}
	}
}

func TestRegionalSignatureCalls(t *testing.T) {
	m := rgByID(t)

	boom := m["eurasian_bittern"].Calls[0]
	if boom.Kind != "boom" || boom.Pitch != "low" || boom.Pattern != "booming" {
		t.Errorf("bittern primary call is %s/%s/%s, want boom/low/booming", boom.Kind, boom.Pitch, boom.Pattern)
	}
	for _, sp := range m {
		for ci, c := range sp.Calls {
			if c.Loud > boom.Loud {
				t.Errorf("%s call %d (loud %.2f) outcarries the bittern's boom (%.2f)", sp.ID, ci, c.Loud, boom.Loud)
			}
			if sp.ID != "eurasian_bittern" && (c.Kind == "boom" || c.Pattern == "booming") {
				t.Errorf("%s call %d: the boom belongs to the bittern alone", sp.ID, ci)
			}
		}
	}
	if boom.AudibleRange() < 280 {
		t.Errorf("bittern boom carries only %.0f m", boom.AudibleRange())
	}

	// A rare bird's voice must be its own: no other species in the roster shares the
	// (pitch, pattern) clue pair of a rare or legendary species' primary call.
	for _, rare := range m {
		if rare.Rarity < core.Rare {
			continue
		}
		for _, other := range m {
			if other.ID == rare.ID {
				continue
			}
			shareRegion := false
			for _, a := range rare.Regions {
				for _, b := range other.Regions {
					shareRegion = shareRegion || a == b
				}
			}
			if shareRegion && other.Calls[0].Pitch == rare.Calls[0].Pitch && other.Calls[0].Pattern == rare.Calls[0].Pattern {
				t.Errorf("%s shares its call clues with %s", rare.ID, other.ID)
			}
		}
	}

	if c := m["golden_eagle"].Calls[0]; c.Pitch == "low" {
		t.Error("golden eagle: the yelps are thin, not low")
	}
	if c := m["snowy_owl"].Calls[0]; c.Pitch != "low" {
		t.Error("snowy owl: the barks are deep")
	}
	if c := m["herring_gull"].Calls[0]; c.Pattern != "laughing" {
		t.Error("herring gull: the long-call is the laughing one")
	}
	if c := m["redwing"].Calls[0]; c.Pitch != "very high" {
		t.Error("redwing: the tseep is very high and thin")
	}
}

func TestRegionalMovement(t *testing.T) {
	m := rgByID(t)
	check := func(id, field, got, want string) {
		t.Helper()
		if got != want {
			t.Errorf("%s: %s %q, want %q", id, field, got, want)
		}
	}
	check("grey_heron", "ground", m["grey_heron"].Move.Ground, "wade")
	check("eurasian_bittern", "ground", m["eurasian_bittern"].Move.Ground, "wade")
	check("mallard", "ground", m["mallard"].Move.Ground, "swim")
	check("common_moorhen", "ground", m["common_moorhen"].Move.Ground, "swim")
	check("great_cormorant", "ground", m["great_cormorant"].Move.Ground, "swim")
	check("great_cormorant", "feeding", m["great_cormorant"].Behavior.Feeding, "dive")
	check("herring_gull", "flight", m["herring_gull"].Move.Flight, "soaring")
	check("golden_eagle", "flight", m["golden_eagle"].Move.Flight, "soaring")
	check("western_marsh_harrier", "flight", m["western_marsh_harrier"].Move.Flight, "flapglide")
	check("atlantic_puffin", "flight", m["atlantic_puffin"].Move.Flight, "whirring")
	check("rock_ptarmigan", "ground", m["rock_ptarmigan"].Move.Ground, "walk")

	// Swimmers need open water to float on, waders a shore to stalk along.
	for id, sp := range m {
		has := map[string]bool{}
		for _, p := range sp.Behavior.Perches {
			has[p] = true
		}
		if sp.Move.Ground == "swim" && !has["water"] {
			t.Errorf("%s: swims but has no water perch", id)
		}
		if sp.Move.Ground == "wade" && !has["shore"] {
			t.Errorf("%s: wades but has no shore perch", id)
		}
	}
}

func TestRegionalBehavior(t *testing.T) {
	m := rgByID(t)
	acts := map[string]bool{}
	for a := core.BirdAct(0); a < core.ActCount; a++ {
		acts[a.Key()] = true
	}
	for id, sp := range m {
		b := sp.Behavior
		for _, s := range b.Specials {
			if !acts[s] {
				t.Errorf("%s: special %q is not a BirdAct key", id, s)
			}
		}
		for i, a := range b.Activity {
			if a < 0 || a > 1 {
				t.Errorf("%s: activity[%d] = %v outside 0..1", id, i, a)
			}
		}
		for name, v := range map[string]float32{"camo": b.Camo, "skulking": b.Skulking, "habituate": b.Habituate} {
			if v < 0 || v > 1 {
				t.Errorf("%s: %s = %v outside 0..1", id, name, v)
			}
		}
		switch b.Sociality {
		case "flock":
			if b.FlockMin < 2 || b.FlockMax <= b.FlockMin {
				t.Errorf("%s: flock size %d-%d", id, b.FlockMin, b.FlockMax)
			}
		case "pair":
			if b.FlockMin != 1 || b.FlockMax != 2 {
				t.Errorf("%s: pair must be 1-2, got %d-%d", id, b.FlockMin, b.FlockMax)
			}
		default:
			if b.FlockMin != 1 || b.FlockMax != 1 {
				t.Errorf("%s: solitary must be 1-1, got %d-%d", id, b.FlockMin, b.FlockMax)
			}
		}
		// The game stays cozy: no bird flushes from farther than a patient player
		// with binoculars can still enjoy it.
		if b.Shyness > 100 {
			t.Errorf("%s: shyness %v m is unplayable", id, b.Shyness)
		}
	}

	for _, id := range []string{"herring_gull", "brambling", "redwing", "snow_bunting"} {
		if m[id].Behavior.Sociality != "flock" {
			t.Errorf("%s must flock", id)
		}
	}
	for _, id := range []string{"grey_heron", "golden_eagle"} {
		if m[id].Behavior.Shyness < 55 {
			t.Errorf("%s must be very shy, got %v", id, m[id].Behavior.Shyness)
		}
	}
	if s := m["mallard"].Behavior.Shyness; s > 12 {
		t.Errorf("mallard must be tame, got shyness %v", s)
	}
	for _, id := range []string{"eurasian_bittern", "rock_ptarmigan"} {
		if m[id].Behavior.Camo < 0.9 {
			t.Errorf("%s must be superbly camouflaged, got %v", id, m[id].Behavior.Camo)
		}
	}
	for _, id := range []string{"eurasian_bittern", "eurasian_reed_warbler", "common_moorhen"} {
		if m[id].Behavior.Skulking < 0.6 {
			t.Errorf("%s must skulk, got %v", id, m[id].Behavior.Skulking)
		}
	}
	// The bittern booms at dawn, in the evening and through the night, not by day.
	act := m["eurasian_bittern"].Behavior.Activity
	for _, p := range []core.DayPhase{core.PhaseDawn, core.PhaseEvening, core.PhaseNight} {
		if act[p] < 0.7 {
			t.Errorf("bittern activity at %s is %v, want >= 0.7", p, act[p])
		}
	}
	for _, p := range []core.DayPhase{core.PhaseMorning, core.PhaseMidday, core.PhaseAfternoon} {
		if act[p] > 0.35 {
			t.Errorf("bittern activity at %s is %v, want <= 0.35", p, act[p])
		}
	}
	// Diurnal birds sleep at night; only these are abroad after dark.
	nocturnal := map[string]bool{"eurasian_bittern": true, "snowy_owl": true}
	for id, sp := range m {
		if !nocturnal[id] && sp.Behavior.Activity[core.PhaseNight] > 0.5 {
			t.Errorf("%s is too active at night (%v)", id, sp.Behavior.Activity[core.PhaseNight])
		}
	}
}

// The client reads these arrays without nil checks; the wire form must be [] not null,
// and the journal text must be real prose.
func TestRegionalJSONAndProse(t *testing.T) {
	for _, sp := range regionalSpecies() {
		if sp.Similar == nil || sp.Relations == nil || sp.Behavior.Specials == nil || sp.Look.Marks == nil {
			t.Errorf("%s: similar/relations/specials/marks must be non-nil slices", sp.ID)
		}
		raw, err := json.Marshal(sp)
		if err != nil {
			t.Fatalf("%s: %v", sp.ID, err)
		}
		if strings.Contains(string(raw), ":null") {
			t.Errorf("%s: JSON contains null", sp.ID)
		}
		if len(sp.Relations) == 0 {
			t.Errorf("%s: no ecological relations", sp.ID)
		}
		for name, text := range map[string]string{"desc": sp.Desc, "idTips": sp.IDTips, "fact": sp.Fact} {
			if len(text) < 80 || len(text) > 520 {
				t.Errorf("%s: %s is %d characters, want 80-520", sp.ID, name, len(text))
			}
			if !strings.HasSuffix(text, ".") || text != strings.TrimSpace(text) || strings.Contains(text, "  ") {
				t.Errorf("%s: %s is not clean prose: %q", sp.ID, name, text)
			}
		}
		for _, rel := range sp.Relations {
			if len(rel) < 30 || !strings.HasSuffix(rel, ".") {
				t.Errorf("%s: relation %q is not a sentence", sp.ID, rel)
			}
		}
		if n := len(strings.Fields(sp.Sci)); n != 2 {
			t.Errorf("%s: scientific name %q is not a binomial", sp.ID, sp.Sci)
		}
	}
}
