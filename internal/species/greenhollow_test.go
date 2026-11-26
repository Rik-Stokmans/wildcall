package species

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// ghWantIDs is the pinned Greenhollow roster, in catalog order.
var ghWantIDs = []string{
	"european_robin", "blue_tit", "great_tit", "common_blackbird", "eurasian_wren",
	"common_chaffinch", "great_spotted_woodpecker", "eurasian_jay", "eurasian_nuthatch",
	"eurasian_treecreeper", "tawny_owl", "common_buzzard", "song_thrush", "goldcrest",
	"long_tailed_tit", "eurasian_blackcap", "common_chiffchaff", "grey_wagtail",
	"common_kingfisher", "golden_oriole",
}

// ghRegionalIDs is the pinned roster of the other regions (regional.go), which
// Similar lists may refer to.
var ghRegionalIDs = []string{
	"mallard", "common_moorhen", "grey_heron", "eurasian_reed_warbler", "eurasian_bittern",
	"western_marsh_harrier", "northern_wheatear", "common_raven", "ring_ouzel", "golden_eagle",
	"herring_gull", "eurasian_oystercatcher", "great_cormorant", "atlantic_puffin",
	"redwing", "brambling", "hawfinch", "snow_bunting", "rock_ptarmigan", "snowy_owl",
}

func ghByID(t *testing.T) map[string]*core.Species {
	t.Helper()
	list := greenhollowSpecies()
	m := make(map[string]*core.Species, len(list))
	for i := range list {
		m[list[i].ID] = &list[i]
	}
	return m
}

func ghContains(set []string, v string) bool {
	for _, s := range set {
		if s == v {
			return true
		}
	}
	return false
}

func TestGreenhollowValidates(t *testing.T) {
	list := greenhollowSpecies()
	// Similar may point into the regional roster, which Validate can only resolve in
	// the assembled catalog; the references are checked by TestGreenhollowSimilar.
	for i := range list {
		list[i].Similar = nil
	}
	for _, err := range Validate(list) {
		t.Error(err)
	}
}

func TestGreenhollowIDsAndOrder(t *testing.T) {
	list := greenhollowSpecies()
	if len(list) != len(ghWantIDs) {
		t.Fatalf("got %d species, want %d", len(list), len(ghWantIDs))
	}
	for i, sp := range list {
		if sp.ID != ghWantIDs[i] {
			t.Errorf("position %d: got %q, want %q", i, sp.ID, ghWantIDs[i])
		}
	}
}

func TestGreenhollowSimilar(t *testing.T) {
	known := append(append([]string{}, ghWantIDs...), ghRegionalIDs...)
	for _, sp := range greenhollowSpecies() {
		seen := map[string]bool{}
		for _, s := range sp.Similar {
			if !ghContains(known, s) {
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

// "Compare similar" in the field guide must work in both directions, inside this
// roster and towards the regional species that point at a Greenhollow bird.
func TestGreenhollowSimilarSymmetric(t *testing.T) {
	by := ghByID(t)
	for _, sp := range by {
		for _, s := range sp.Similar {
			if other, ok := by[s]; ok && !ghContains(other.Similar, sp.ID) {
				t.Errorf("%s lists %s as similar, but not the other way round", sp.ID, s)
			}
		}
	}
	for _, other := range regionalSpecies() {
		for _, s := range other.Similar {
			if mine, ok := by[s]; ok && !ghContains(mine.Similar, other.ID) {
				t.Errorf("%s (regional) lists %s as similar, but not the other way round", other.ID, s)
			}
		}
	}
}

func TestGreenhollowTraitTuplesUnique(t *testing.T) {
	type tuple struct{ size, shape, primary, secondary, marking, bill string }
	seen := map[tuple]string{}
	// The marking is free text, so also require the tuple WITHOUT it to be unique:
	// two species must never differ only by the hardest piece of evidence to get.
	coarse := map[tuple]string{}
	markings := map[string]string{}
	for _, sp := range greenhollowSpecies() {
		tr := sp.Traits
		full := tuple{tr.Size, tr.Shape, tr.Primary, tr.Secondary, tr.Marking, tr.Bill}
		if other, dup := seen[full]; dup {
			t.Errorf("%s and %s share the full trait tuple %v", sp.ID, other, full)
		}
		seen[full] = sp.ID
		c := tuple{tr.Size, tr.Shape, tr.Primary, tr.Secondary, "", tr.Bill}
		if other, dup := coarse[c]; dup {
			t.Errorf("%s and %s differ only by marking", sp.ID, other)
		}
		coarse[c] = sp.ID
		if other, dup := markings[tr.Marking]; dup {
			t.Errorf("%s and %s share the marking %q", sp.ID, other, tr.Marking)
		}
		markings[tr.Marking] = sp.ID
	}
}

// ghEvidenceDiff counts the species-derived evidence keys on which two species differ.
func ghEvidenceDiff(a, b *core.Species) int {
	n := 0
	for _, k := range []string{"size", "shape", "primary", "secondary", "marking", "bill", "flight", "pitch", "pattern"} {
		if a.TraitValue(k) != b.TraitValue(k) {
			n++
		}
	}
	return n
}

func TestGreenhollowSimilarSpeciesDistinguishable(t *testing.T) {
	by := ghByID(t)
	pairs := [][2]string{
		{"blue_tit", "great_tit"},
		{"common_chiffchaff", "eurasian_blackcap"},
		{"eurasian_treecreeper", "eurasian_nuthatch"},
	}
	for _, sp := range by {
		for _, s := range sp.Similar {
			if _, ok := by[s]; ok {
				pairs = append(pairs, [2]string{sp.ID, s})
			}
		}
	}
	for _, p := range pairs {
		a, b := by[p[0]], by[p[1]]
		if a == nil || b == nil {
			t.Fatalf("pair %v: species missing", p)
		}
		if d := ghEvidenceDiff(a, b); d < 2 {
			t.Errorf("%s / %s differ in only %d evidence keys", p[0], p[1], d)
		}
	}
	// Even unrelated species must be separable by what can be seen: at least two of
	// the visual keys differ for every pair in the roster.
	list := greenhollowSpecies()
	for i := range list {
		for j := i + 1; j < len(list); j++ {
			n := 0
			for _, k := range []string{"size", "shape", "primary", "secondary", "bill", "flight"} {
				if list[i].TraitValue(k) != list[j].TraitValue(k) {
					n++
				}
			}
			if n < 2 {
				t.Errorf("%s / %s differ in only %d visual keys (marking aside)", list[i].ID, list[j].ID, n)
			}
		}
	}
}

func TestGreenhollowCallDurations(t *testing.T) {
	for _, sp := range greenhollowSpecies() {
		if len(sp.Calls) < 2 || len(sp.Calls) > 3 {
			t.Errorf("%s: %d calls, want 2 or 3", sp.ID, len(sp.Calls))
		}
		for ci, c := range sp.Calls {
			d := c.PhraseDur()
			if d < 0.15 || d > 8 {
				t.Errorf("%s call %d (%s): phrase lasts %.2f s, want 0.15..8", sp.ID, ci, c.Kind, d)
			}
			if c.Gap < 0 {
				t.Errorf("%s call %d: negative gap", sp.ID, ci)
			}
			// A whole bout (every repeat plus the gaps) must stay a listenable length.
			bout := float32(c.Repeat[1])*d + float32(c.Repeat[1]-1)*c.Gap
			if bout > 30 {
				t.Errorf("%s call %d: longest bout lasts %.1f s", sp.ID, ci, bout)
			}
			for ni, n := range c.Notes {
				if n.Gap < 0 || n.Rate < 0 || n.Depth < 0 {
					t.Errorf("%s call %d note %d: negative gap/rate/depth", sp.ID, ci, ni)
				}
				maxDepth := float32(0.5) // vibrato: fraction of frequency
				if n.Wave == "trill" {
					maxDepth = 1 // amplitude modulation depth
				}
				if n.Depth > maxDepth {
					t.Errorf("%s call %d note %d: depth %.2f too large for %s", sp.ID, ci, ni, n.Depth, n.Wave)
				}
				if (n.Rate == 0) != (n.Depth == 0) {
					t.Errorf("%s call %d note %d: rate and depth must be set together", sp.ID, ci, ni)
				}
				if n.Wave == "trill" && n.Rate == 0 {
					t.Errorf("%s call %d note %d: trill without a rate", sp.ID, ci, ni)
				}
			}
		}
	}
}

// ghMeanHz is the loudness-weighted mean frequency of a phrase: what the ear takes
// as "the pitch" of the call.
func ghMeanHz(c core.Call) float64 {
	var sum, w float64
	for _, n := range c.Notes {
		k := float64(n.Dur * n.Amp)
		sum += k * float64(n.F0+n.F1) / 2
		w += k
	}
	return sum / w
}

// The pitch word shown in audio clues must describe the sound the client actually
// synthesizes from the notes.
func TestGreenhollowPitchMatchesNotes(t *testing.T) {
	band := func(hz float64) string {
		switch {
		case hz < 1000:
			return "low"
		case hz < 3000:
			return "medium"
		case hz < 6000:
			return "high"
		}
		return "very high"
	}
	for _, sp := range greenhollowSpecies() {
		for ci, c := range sp.Calls {
			hz := ghMeanHz(c)
			if got := band(hz); got != c.Pitch {
				t.Errorf("%s call %d (%s): notes centre on %.0f Hz (%s) but pitch says %q", sp.ID, ci, c.Kind, hz, got, c.Pitch)
			}
			// Keep clear of the band edges so the label is never arguable.
			for _, edge := range []float64{1000, 3000, 6000} {
				if math.Abs(hz-edge) < 120 {
					t.Errorf("%s call %d (%s): %.0f Hz sits on the %v Hz band edge", sp.ID, ci, c.Kind, hz, edge)
				}
			}
		}
	}
}

// Audio is gameplay: the pitch and pattern of a primary call should narrow a mystery
// down to one species. Only the two sound-alike pairs that real birdwatchers also
// struggle with are allowed to share a clue pair.
func TestGreenhollowPrimaryCluesDistinct(t *testing.T) {
	allowed := map[string][2]string{
		"high/melodic":  {"european_robin", "eurasian_blackcap"},
		"high/repeated": {"great_tit", "common_chiffchaff"},
	}
	groups := map[string][]string{}
	for _, sp := range greenhollowSpecies() {
		key := sp.Calls[0].Pitch + "/" + sp.Calls[0].Pattern
		groups[key] = append(groups[key], sp.ID)
	}
	for key, ids := range groups {
		if len(ids) == 1 {
			continue
		}
		want, ok := allowed[key]
		if !ok || len(ids) != 2 || ids[0] != want[0] || ids[1] != want[1] {
			t.Errorf("primary calls of %v all sound %s", ids, key)
		}
	}
}

func TestGreenhollowCallCharacter(t *testing.T) {
	by := ghByID(t)
	primary := map[string][3]string{ // id → kind, pitch, pattern of Calls[0]
		"european_robin":           {"song", "high", "melodic"},
		"blue_tit":                 {"song", "high", "trill"},
		"great_tit":                {"song", "high", "repeated"},
		"common_blackbird":         {"song", "medium", "melodic"},
		"eurasian_wren":            {"song", "very high", "trill"},
		"common_chaffinch":         {"song", "high", "chatter"},
		"great_spotted_woodpecker": {"drum", "low", "drumming"},
		"eurasian_jay":             {"call", "medium", "harsh"},
		"eurasian_nuthatch":        {"song", "high", "whistle"},
		"eurasian_treecreeper":     {"song", "very high", "melodic"},
		"tawny_owl":                {"song", "low", "whistle"},
		"common_buzzard":           {"call", "medium", "single"},
		"song_thrush":              {"song", "medium", "repeated"},
		"goldcrest":                {"song", "very high", "repeated"},
		"long_tailed_tit":          {"call", "very high", "chatter"},
		"eurasian_blackcap":        {"song", "high", "melodic"},
		"common_chiffchaff":        {"song", "high", "repeated"},
		"grey_wagtail":             {"call", "very high", "single"},
		"common_kingfisher":        {"call", "very high", "whistle"},
		"golden_oriole":            {"song", "medium", "whistle"},
	}
	for id, want := range primary {
		c := by[id].Calls[0]
		if got := [3]string{c.Kind, c.Pitch, c.Pattern}; got != want {
			t.Errorf("%s primary call: got %v, want %v", id, got, want)
		}
	}
	loud := map[string]float32{"goldcrest": 0.15, "eurasian_wren": 0.55, "common_blackbird": 0.6, "common_buzzard": 0.8}
	for id, want := range loud {
		if got := by[id].Calls[0].Loud; math.Abs(float64(got-want)) > 0.051 {
			t.Errorf("%s primary loudness %.2f, want about %.2f", id, got, want)
		}
	}
	// The woodpecker drums with rapid clicks and also has its sharp "kik".
	gsw := by["great_spotted_woodpecker"]
	for _, n := range gsw.Calls[0].Notes {
		if n.Wave != "click" {
			t.Errorf("woodpecker drum contains a %q note", n.Wave)
		}
	}
	if len(gsw.Calls[0].Notes) < 8 {
		t.Errorf("woodpecker drum has only %d strikes", len(gsw.Calls[0].Notes))
	}
	if gsw.Calls[1].Kind != "call" || gsw.Calls[1].Pattern != "single" {
		t.Errorf("woodpecker second call should be the single 'kik'")
	}
	// The jay screeches with noise, the owl hoots with a wavering low note.
	if by["eurasian_jay"].Calls[0].Notes[0].Wave != "noise" {
		t.Errorf("jay screech should be noise")
	}
	wavering := false
	for _, n := range by["tawny_owl"].Calls[0].Notes {
		if n.Rate > 0 && n.F0 < 1000 {
			wavering = true
		}
	}
	if !wavering {
		t.Errorf("tawny owl hoot has no wavering note")
	}
	// The oriole's whistle carries far; the rare bird is heard long before it is seen.
	if by["golden_oriole"].Calls[0].Loud < 0.7 {
		t.Errorf("golden oriole song should carry far")
	}
}

func TestGreenhollowSeasonsAndRarity(t *testing.T) {
	summer := map[string]bool{"eurasian_blackcap": true, "common_chiffchaff": true, "golden_oriole": true}
	rarity := map[string]core.Rarity{
		"common_buzzard": core.Uncommon, "tawny_owl": core.Uncommon,
		"common_kingfisher": core.Uncommon, "eurasian_treecreeper": core.Uncommon,
		"golden_oriole": core.Rare,
	}
	for _, sp := range greenhollowSpecies() {
		want := [4]bool{true, true, true, true}
		if summer[sp.ID] {
			want = [4]bool{true, true, false, false}
		}
		if sp.Seasons != want {
			t.Errorf("%s: seasons %v, want %v", sp.ID, sp.Seasons, want)
		}
		if got, want := sp.Rarity, rarity[sp.ID]; got != want { // zero value = Common
			t.Errorf("%s: rarity %s, want %s", sp.ID, got, want)
		}
	}
}

func TestGreenhollowRegionsAndHabitats(t *testing.T) {
	amber := []string{"european_robin", "common_blackbird", "great_tit", "blue_tit", "common_chaffinch", "eurasian_jay", "eurasian_nuthatch", "song_thrush"}
	marsh := []string{"grey_wagtail", "common_kingfisher"}
	for _, sp := range greenhollowSpecies() {
		want := []core.RegionID{core.RegionGreenhollow}
		if ghContains(amber, sp.ID) {
			want = append(want, core.RegionAmberwood)
		}
		if ghContains(marsh, sp.ID) {
			want = append(want, core.RegionMurmurMarsh)
		}
		if len(sp.Regions) != len(want) {
			t.Errorf("%s: regions %v, want %v", sp.ID, sp.Regions, want)
			continue
		}
		for _, r := range want {
			found := false
			for _, got := range sp.Regions {
				found = found || got == r
			}
			if !found {
				t.Errorf("%s: missing region %s", sp.ID, r.Key())
			}
		}
		if sp.Regions[0] != core.RegionGreenhollow {
			t.Errorf("%s: Greenhollow must be listed first", sp.ID)
		}
		var sum float32
		seen := map[string]bool{}
		for i, h := range sp.Habitats {
			if h.Weight <= 0 {
				t.Errorf("%s: habitat %s has weight %.2f", sp.ID, h.Habitat, h.Weight)
			}
			if seen[h.Habitat] {
				t.Errorf("%s: habitat %s listed twice", sp.ID, h.Habitat)
			}
			seen[h.Habitat] = true
			if i > 0 && h.Weight > sp.Habitats[i-1].Weight {
				t.Errorf("%s: habitats must be listed most preferred first", sp.ID)
			}
			sum += h.Weight
		}
		if math.Abs(float64(sum-1)) > 0.01 {
			t.Errorf("%s: habitat weights sum to %.2f", sp.ID, sum)
		}
	}
	by := ghByID(t)
	// The tutorial's unseen singer lives in dense shrubs and ferns.
	if h := by["eurasian_wren"].Habitats[0]; h.Habitat != "shrub" {
		t.Errorf("wren's first habitat is %q, want shrub", h.Habitat)
	}
	for _, id := range marsh {
		if by[id].Habitats[0].Habitat != "river" {
			t.Errorf("%s should be a riverside bird first", id)
		}
	}
}

func TestGreenhollowBehaviour(t *testing.T) {
	acts := map[string]core.BirdAct{}
	for a := core.BirdAct(0); a < core.ActCount; a++ {
		acts[a.Key()] = a
	}
	for _, sp := range greenhollowSpecies() {
		b := sp.Behavior
		for name, v := range map[string]float32{"camo": b.Camo, "skulking": b.Skulking, "habituate": b.Habituate} {
			if v < 0 || v > 1 {
				t.Errorf("%s: %s %.2f outside 0..1", sp.ID, name, v)
			}
		}
		var peak float32
		for _, a := range b.Activity {
			if a < 0 || a > 1 {
				t.Errorf("%s: activity %.2f outside 0..1", sp.ID, a)
			}
			if a > peak {
				peak = a
			}
		}
		if peak != 1 {
			t.Errorf("%s: peak activity is %.2f, want 1", sp.ID, peak)
		}
		if b.Specials == nil || len(b.Specials) == 0 {
			t.Errorf("%s: no special behaviours", sp.ID)
		}
		for _, s := range b.Specials {
			a, ok := acts[s]
			if !ok || !a.UncommonBehaviour() {
				t.Errorf("%s: special %q is not an uncommon BirdAct key", sp.ID, s)
			}
		}
		switch b.Sociality {
		case "flock":
			if b.FlockMin < 2 || b.FlockMax < b.FlockMin {
				t.Errorf("%s: flock size %d..%d", sp.ID, b.FlockMin, b.FlockMax)
			}
		case "pair":
			if b.FlockMin != 1 || b.FlockMax != 2 {
				t.Errorf("%s: pair should be 1..2, got %d..%d", sp.ID, b.FlockMin, b.FlockMax)
			}
		default:
			if b.FlockMin != 1 || b.FlockMax != 1 {
				t.Errorf("%s: solitary should be 1..1, got %d..%d", sp.ID, b.FlockMin, b.FlockMax)
			}
		}
		l := sp.Look
		if l.Plump < 0.7 || l.Plump > 1.3 || l.Neck < 0 || l.Neck > 1 || l.Legs < 0 || l.Legs > 1 ||
			l.Tail < 0.2 || l.Tail > 1.5 || l.Bill < 0.2 || l.Bill > 3 {
			t.Errorf("%s: appearance ratio outside the documented range: %+v", sp.ID, l)
		}
		if l.Wingspan <= l.Length {
			t.Errorf("%s: wingspan %.2f not larger than length %.2f", sp.ID, l.Wingspan, l.Length)
		}
	}

	by := ghByID(t)
	const dawn, midday, night = 0, 2, 5
	owl := by["tawny_owl"].Behavior.Activity
	if owl[night] != 1 || owl[midday] > 0.05 {
		t.Errorf("tawny owl must be nocturnal, activity %v", owl)
	}
	for id, sp := range by {
		if id != "tawny_owl" && sp.Behavior.Activity[night] > 0.2 {
			t.Errorf("%s is too active at night", id)
		}
	}
	for _, id := range []string{"european_robin", "common_blackbird", "song_thrush", "eurasian_wren", "eurasian_blackcap", "golden_oriole"} {
		if by[id].Behavior.Activity[dawn] != 1 {
			t.Errorf("%s should peak in the dawn chorus", id)
		}
	}
	if a := by["golden_oriole"].Behavior.Activity; a[midday] > 0.3 {
		t.Errorf("golden oriole should be a bird of the morning, activity %v", a)
	}
	wren := by["eurasian_wren"].Behavior
	if wren.Skulking != 0.9 || wren.Perches[0] != "shrub" {
		t.Errorf("wren must skulk (0.9) in shrubs, got %.2f in %v", wren.Skulking, wren.Perches)
	}
	if h := by["european_robin"].Behavior; h.Habituate < 0.85 || h.Shyness > 5 {
		t.Errorf("robin should be very tame, got habituate %.2f shyness %.1f", h.Habituate, h.Shyness)
	}
	if h := by["eurasian_jay"].Behavior; h.Habituate > 0.2 || h.Shyness < 25 {
		t.Errorf("jay should be wary, got habituate %.2f shyness %.1f", h.Habituate, h.Shyness)
	}
	if by["golden_oriole"].Behavior.Perches[0] != "canopy" || by["golden_oriole"].Behavior.Density > 0.05 {
		t.Errorf("golden oriole should be a scarce bird of the high canopy")
	}
	if by["long_tailed_tit"].Behavior.Sociality != "flock" {
		t.Errorf("long-tailed tits travel in flocks")
	}
	// Camouflage specialists.
	for _, id := range []string{"eurasian_treecreeper", "tawny_owl"} {
		if by[id].Behavior.Camo < 0.8 {
			t.Errorf("%s should be strongly camouflaged", id)
		}
	}
}

func TestGreenhollowTraitVocabulary(t *testing.T) {
	colours := []string{"brown", "black", "grey", "white", "blue", "green", "yellow", "red", "orange", "buff", "pink"}
	bills := []string{"short", "thin", "stout", "dagger", "hooked", "flat", "long curved", "chisel"}
	// A bird's model and its evidence must tell the same story about the bill.
	billFor := map[string][]string{
		"cone": {"short", "stout"}, "thin": {"thin"}, "dagger": {"dagger"}, "hooked": {"hooked"},
		"flat": {"flat"}, "curved": {"long curved"}, "chisel": {"chisel"},
	}
	for _, sp := range greenhollowSpecies() {
		tr := sp.Traits
		if !ghContains(colours, tr.Primary) || !ghContains(colours, tr.Secondary) {
			t.Errorf("%s: colours %q/%q outside the trait vocabulary", sp.ID, tr.Primary, tr.Secondary)
		}
		if tr.Primary == tr.Secondary {
			t.Errorf("%s: primary and secondary colour are both %q", sp.ID, tr.Primary)
		}
		if !ghContains(bills, tr.Bill) {
			t.Errorf("%s: bill %q outside the trait vocabulary", sp.ID, tr.Bill)
		}
		if !ghContains(billFor[sp.Look.BillShape], tr.Bill) {
			t.Errorf("%s: bill trait %q contradicts the model's %q bill", sp.ID, tr.Bill, sp.Look.BillShape)
		}
		var want string
		switch l := sp.Look.Length; {
		case l < 0.12:
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
		if sp.ID == "long_tailed_tit" {
			want = "tiny" // more than half of its 14 cm is tail; the body is smaller than a blue tit's
		}
		if tr.Size != want {
			t.Errorf("%s: size %q but a length of %.2f m is %q", sp.ID, tr.Size, sp.Look.Length, want)
		}
		if strings.ToLower(tr.Marking) != tr.Marking || strings.HasSuffix(tr.Marking, ".") {
			t.Errorf("%s: marking %q should be a lower-case phrase without a full stop", sp.ID, tr.Marking)
		}
	}
}

func TestGreenhollowWriting(t *testing.T) {
	names := map[string]bool{}
	for _, sp := range greenhollowSpecies() {
		if names[sp.Name] || names[sp.Sci] {
			t.Errorf("%s: duplicate name", sp.ID)
		}
		names[sp.Name], names[sp.Sci] = true, true
		for field, text := range map[string]string{"desc": sp.Desc, "idTips": sp.IDTips, "fact": sp.Fact} {
			if len(text) < 80 || len(text) > 520 {
				t.Errorf("%s: %s is %d characters long", sp.ID, field, len(text))
			}
			if text != strings.TrimSpace(text) || strings.Contains(text, "  ") || strings.Contains(text, "\n") {
				t.Errorf("%s: %s has stray whitespace", sp.ID, field)
			}
			if !strings.HasSuffix(text, ".") {
				t.Errorf("%s: %s should end with a full stop", sp.ID, field)
			}
		}
		if len(sp.Relations) < 2 {
			t.Errorf("%s: wants at least two ecological relations", sp.ID)
		}
		for _, r := range sp.Relations {
			if len(r) < 30 || !strings.HasSuffix(r, ".") {
				t.Errorf("%s: relation %q is not a sentence", sp.ID, r)
			}
		}
		if parts := strings.Fields(sp.Sci); len(parts) != 2 {
			t.Errorf("%s: scientific name %q is not a binomial", sp.ID, sp.Sci)
		}
	}
}

// The client iterates these lists without nil checks, so they must encode as JSON
// arrays, never as null.
func TestGreenhollowEncodesWithoutNulls(t *testing.T) {
	for _, sp := range greenhollowSpecies() {
		raw, err := json.Marshal(sp)
		if err != nil {
			t.Fatalf("%s: %v", sp.ID, err)
		}
		if strings.Contains(string(raw), "null") {
			t.Errorf("%s: encodes a null list: %s", sp.ID, raw)
		}
	}
}

// Every call must hand out its own data: the catalog writes Index into its copy and
// callers may clear fields (as the validation test above does).
func TestGreenhollowReturnsFreshData(t *testing.T) {
	a := greenhollowSpecies()
	a[0].Calls[0].Notes[0].F0 = 1
	a[0].Similar = nil
	a[0].Look.Marks[0].Color = "#000000"
	b := greenhollowSpecies()
	if b[0].Calls[0].Notes[0].F0 == 1 || b[0].Similar == nil || b[0].Look.Marks[0].Color == "#000000" {
		t.Errorf("greenhollowSpecies shares state between calls")
	}
}
