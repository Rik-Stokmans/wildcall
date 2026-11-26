package narrator

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/rand/v2"
	"regexp"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

var factWords = []string{"one", "two", "three", "four", "five", "six", "seven"}

// catalogWithFacts is the fixture with seven invented facts per species (the real
// facts live in internal/species and may be empty while it is being written).
func catalogWithFacts(t testing.TB) []core.Species {
	var out []core.Species
	for i, f := range loadFixture(t) {
		sp := f.sp
		sp.Index = i
		for _, w := range factWords {
			sp.Facts = append(sp.Facts, "Fact "+w+" about the "+shortName(&sp)+", which is perfectly true.")
		}
		// Noise the narrator must cope with: blank, duplicate, padded, overlong.
		sp.Facts = append(sp.Facts, "", "  Fact one about the "+shortName(&sp)+",   which is perfectly true. ",
			strings.Repeat("word ", 50))
		out = append(out, sp)
	}
	return out
}

func TestLineIDFormat(t *testing.T) {
	text := "Mm. Blackberries. One for the pot, one for me."
	h := sha256.Sum256([]byte(text))
	if got, want := LineID(text), hex.EncodeToString(h[:])[:16]; got != want {
		t.Fatalf("LineID = %s, want %s", got, want)
	}
	if !regexp.MustCompile(`^[0-9a-f]{16}$`).MatchString(LineID("x")) {
		t.Fatal("LineID is not 16 lowercase hex characters")
	}
}

func TestAllLinesWellFormed(t *testing.T) {
	cat := catalogWithFacts(t)
	lines := AllLines(cat)
	ids := map[string]string{}
	facts := 0
	for _, l := range lines {
		if l.ID != LineID(l.Text) {
			t.Fatalf("id %s does not match text %q", l.ID, l.Text)
		}
		if prev, dup := ids[l.ID]; dup {
			t.Fatalf("duplicate id %s: %q and %q", l.ID, prev, l.Text)
		}
		ids[l.ID] = l.Text
		if l.Kind == "" {
			t.Fatalf("no kind for %q", l.Text)
		}
		if strings.HasSuffix(l.Kind, ".fact") {
			facts++
			continue
		}
		checkLine(t, l.Text)
	}
	if facts != 7*len(cat) {
		t.Errorf("%d facts enumerated, want %d (blank, duplicate and overlong facts dropped)", facts, 7*len(cat))
	}
	// Stable order and content.
	again := AllLines(cat)
	a, _ := json.Marshal(lines)
	b, _ := json.Marshal(again)
	if string(a) != string(b) {
		t.Fatal("AllLines is not deterministic")
	}
	t.Logf("AllLines: %d sentences (%d of them species facts) for %d species", len(lines), facts, len(cat))
	if len(lines) > 2500 {
		t.Errorf("%d sentences: over the ~2500 budget of §13", len(lines))
	}
	// Without facts it must still work (the species data may not have them yet).
	plain := AllLines(func() []core.Species {
		var out []core.Species
		for _, f := range loadFixture(t) {
			out = append(out, f.sp)
		}
		return out
	}())
	if len(plain) != len(lines)-facts {
		t.Errorf("without facts: %d lines, want %d", len(plain), len(lines)-facts)
	}
}

// Generic (non-naming) sentences in AllLines must never name a bird, whatever the
// slots were filled with.
func TestAllLinesGenericNeverName(t *testing.T) {
	words, phrases := forbidden(loadFixture(t))
	for _, l := range AllLines(catalogWithFacts(t)) {
		if namingPool(l.Kind) || strings.HasSuffix(l.Kind, ".fact") {
			continue
		}
		named := false
		for _, tpl := range bank[l.Kind] {
			if usesName(tpl) {
				named = true
			}
		}
		if named {
			continue
		}
		if w := spoils(l.Text, words, phrases); w != "" {
			t.Errorf("%s: %q names %q", l.Kind, l.Text, w)
		}
	}
}

// pick returns a random element.
func pickS(r *rand.Rand, xs []string) string { return xs[r.IntN(len(xs))] }

// randomEvent builds an arbitrary event: closed-vocabulary values, junk values and
// empty values mixed, known and unknown birds, every kind.
func randomEvent(r *rand.Rand, cat []core.Species) Event {
	kinds := []Kind{CallHeard, FocusBegin, Watching, NewEvidence, Behaviour, Flushed, Settled, Identified,
		Photographed, Recorded, PlaceFound, RegionEntered, RegionLocked, CabinReturn, Rested, RareFind,
		RankReached, NewAdventure, Resumed, Foraged, Cooked, Ate, PackFull, Collected, Climbed, Waded,
		Sheltered, SatDown, EmptyView, OutOfFilm, NestFound, Kind("bogus")}
	junk := []string{"", "Something odd", "the Robin's perch", "12 metres", "Wren", "🙂"}
	or := func(vals []string) string {
		if r.IntN(4) == 0 {
			return pickS(r, junk)
		}
		return pickS(r, vals)
	}
	keysOf := func(m map[string]string) []string {
		var out []string
		for k := range m {
			out = append(out, k, strings.ToUpper(k[:1])+k[1:])
		}
		return out
	}
	sp := &cat[r.IntN(len(cat))]
	ev := Event{Kind: kinds[r.IntN(len(kinds))], Subject: pickS(r, []string{"", "m1", "m2", "poi7", "nest3"})}
	if r.IntN(2) == 0 {
		ev.Known = sp
	}
	habLabels := []string{}
	for h := core.Habitat(0); h < core.HabCount; h++ {
		habLabels = append(habLabels, h.Label(), h.Key())
	}
	if r.IntN(3) > 0 {
		ev.Clue = &proto.Clue{ID: uint32(r.IntN(9)), Mystery: pickS(r, []string{"", "m1", "m3"}),
			Dir:   or([]string{"Northeast", "North", "South-west", "west"}),
			Pitch: or(keysOf(pitchSound)), Pattern: or(keysOf(patternSound)),
			Habitat: or(habLabels), Perch: or(keysOf(perchWhere)),
			Elevation: or([]string{"above", "below", "level"}),
			DistMin:   r.Float32() * 60, DistMax: r.Float32() * 150, Strength: r.Float32(),
			New: r.IntN(2) == 0, Unusual: r.IntN(8) == 0}
		if r.IntN(10) == 0 {
			ev.Clue.Known = sp.ID // a careless session leaking the species
		}
	}
	tr := sp.Traits
	ev.Evidence = map[string]string{}
	for _, k := range core.EvidenceKeys {
		if r.IntN(3) == 0 {
			continue
		}
		switch k {
		case "size":
			ev.Evidence[k] = or([]string{tr.Size})
		case "shape":
			ev.Evidence[k] = or([]string{tr.Shape})
		case "primary":
			ev.Evidence[k] = or([]string{tr.Primary, "Gray"})
		case "secondary":
			ev.Evidence[k] = tr.Secondary
		case "marking":
			ev.Evidence[k] = tr.Marking
		case "bill":
			ev.Evidence[k] = or([]string{tr.Bill})
		case "flight":
			ev.Evidence[k] = or([]string{tr.Flight})
		case "behavior":
			ev.Evidence[k] = or(keysOf(actPhrases))
		case "habitat":
			ev.Evidence[k] = or(habLabels)
		default:
			ev.Evidence[k] = or(keysOf(patternSound))
		}
	}
	ev.NewKey = core.EvidenceKeys[r.IntN(len(core.EvidenceKeys))]
	ev.Behavior = or(keysOf(actPhrases))
	ev.Blocked = pickS(r, []string{"", "", "foliage", "distance", "dark", "rain", "motion", "fog"})
	ev.Clarity = r.Float32()
	ev.Outcome = pickS(r, []string{"certain", "probable", "wrong", "insufficient", "maybe"})
	ev.Mismatch = or(keysOf(mismatchWords))
	ev.Stars = r.IntN(7) - 1
	ev.Quality = r.IntN(101)
	ev.Tags = []string{pickS(r, []string{"behavior:feeding", "behavior:diving", "golden hour", "exceptional", "rare", ""})}
	ev.POIKind = pickS(r, []string{"watchtower", "hide", "camp", "hidden_cabin", "abandoned_station", "viewpoint",
		"pond", "landmark", "ranger_station", "research_site", "feather", "page", "relic", "cache", "npc", "odd"})
	ev.POIName = pickS(r, []string{"", "Thornback Tower", "Greywater Heron Station", "Robin's Rest"})
	ev.Hidden = r.IntN(3) == 0
	ev.Region = core.RegionID(r.IntN(int(core.RegionCount) + 1))
	ev.RareKind = pickS(r, []string{"unusual_plumage", "out_of_range", "rare_species", "behavior", ""})
	ev.Rank = r.IntN(6)
	ev.RankName = pickS(r, []string{"Observer", "naturalist", "Field Specialist", "Master Naturalist", "Grand Poobah", ""})
	ev.Item = or(append(append(append(append(append([]string{}, PlantIDs...), FoodIDs...), RawFoodIDs...), NestSites...),
		"feather", "page", "relic", "cache", "journal_page", "old_cache", "watchtower", "elderberry", "honey", "none"))
	ev.Yield = pickS(r, []string{"", "", "elderflower", "elderberry", "blackberry", "junk"})
	ev.Stage = pickS(r, []string{"", "old", "building", "eggs", "chicks", "hatched"})
	ev.First = r.IntN(4) == 0
	if r.IntN(4) == 0 {
		ctx := randomContext(r)
		ev.Where = &ctx
	}
	return ev
}

func randomContext(r *rand.Rand) Context {
	return Context{
		Region:  core.RegionID(r.IntN(int(core.RegionCount) + 1)),
		Habitat: core.Habitat(r.IntN(int(core.HabCount) + 1)),
		Env: core.Env{Time: r.Float32() * 24, Day: r.IntN(200), Season: core.Season(r.IntN(4)),
			Weather: core.Weather(r.IntN(4)), Rain: r.Float32(), Wind: r.Float32(), Mist: r.Float32(), Light: r.Float32()},
		Still:   r.Float32() * 200,
		Moving:  r.IntN(2) == 0,
		AtCabin: r.IntN(6) == 0,
		Busy:    r.IntN(8) == 0,
	}
}

// TestEverythingSaidIsEnumerated is the contract of the pregenerated voice: thousands
// of random events and idle moments over every species and state, and every line
// Offer or Idle returns is in AllLines.
func TestEverythingSaidIsEnumerated(t *testing.T) {
	cat := catalogWithFacts(t)
	all := map[string]bool{}
	for _, l := range AllLines(cat) {
		all[l.Text] = true
	}
	said := map[string]bool{}
	total := 0
	for seed := int64(0); seed < 24; seed++ {
		r := rand.New(rand.NewPCG(uint64(seed), 77))
		n := New(seed)
		now := 0.0
		for i := 0; i < 4000; i++ {
			// Mostly far apart so pacing rarely blocks; sometimes dense.
			if r.IntN(3) == 0 {
				now += r.Float64() * 5
			} else {
				now += 40 + r.Float64()*400
			}
			var line proto.Narration
			var ok bool
			if r.IntN(4) == 0 {
				line, ok = n.Idle(randomContext(r), now)
			} else {
				line, ok = n.Offer(randomEvent(r, cat), now)
			}
			if !ok {
				continue
			}
			total++
			said[line.Text] = true
			if !all[line.Text] {
				t.Fatalf("seed %d: %q (kind %s) is not in AllLines", seed, line.Text, line.Kind)
			}
		}
		// Round-trip the state now and then.
		if seed%5 == 0 {
			b, _ := json.Marshal(n.State())
			var st State
			if err := json.Unmarshal(b, &st); err != nil {
				t.Fatal(err)
			}
			n2 := New(0)
			n2.Restore(st)
		}
	}
	if total < 20000 {
		t.Fatalf("only %d lines produced; the fuzz is not exercising the narrator", total)
	}
	t.Logf("%d lines produced (%d distinct of %d enumerated), all enumerated", total, len(said), len(all))
}

func TestActivityLinesForEveryID(t *testing.T) {
	for _, id := range PlantIDs {
		if len(bank["forage."+id]) < 2 {
			t.Errorf("plant %s: fewer than 2 lines", id)
		}
	}
	for _, id := range FoodIDs {
		if len(bank["cook."+id]) < 2 || len(bank["eat."+id]) < 2 {
			t.Errorf("food %s: needs cook and eat lines", id)
		}
	}
	for _, id := range RawFoodIDs {
		if len(bank["eat."+id]) < 2 {
			t.Errorf("raw %s: fewer than 2 lines", id)
		}
	}
	for _, s := range NestSites {
		if len(bank["nest."+s]) < 2 {
			t.Errorf("nest site %s: fewer than 2 lines", s)
		}
	}
	// Each activity kind speaks, with its item's own pool.
	cases := []struct {
		ev   Event
		pool string
	}{
		{Event{Kind: Foraged, Item: "bramble", First: true}, "forage.bramble"},
		{Event{Kind: Foraged, Item: "elder", Yield: "elderberry", First: true}, "forage.yield.elderberry"},
		{Event{Kind: Foraged, Item: "mystery_plant", First: true}, "forage.any"},
		{Event{Kind: Cooked, Item: "nettle_soup", First: true}, "cook.nettle_soup"},
		{Event{Kind: Ate, Item: "roasted_chestnuts"}, "eat.roasted_chestnuts"},
		{Event{Kind: Ate, Item: "hazelnut"}, "eat.hazelnut"},
		{Event{Kind: Ate, Item: "wild_thyme"}, "eat.raw"},
		{Event{Kind: Ate, Item: "honey"}, "eat.any"},
		{Event{Kind: PackFull}, "pack.full"},
		{Event{Kind: Collected, Item: "old_cache"}, "collect.cache"},
		{Event{Kind: Collected, Item: "feather"}, "collect.feather"},
		{Event{Kind: Climbed}, "climb.watchtower"},
		{Event{Kind: Waded}, "wade"},
		{Event{Kind: Sheltered}, "shelter"},
		{Event{Kind: SatDown}, "sit"},
		{Event{Kind: EmptyView}, "binoculars.empty"},
		{Event{Kind: OutOfFilm}, "film.out"},
		{Event{Kind: NestFound, Item: "cavity", Subject: "n1"}, "nest.cavity"},
	}
	for _, c := range cases {
		inPool := map[string]bool{}
		for _, l := range bank[c.pool] {
			inPool[l] = true
		}
		got := false
		for seed := int64(0); seed < 40 && !got; seed++ {
			n := New(seed)
			if l, ok := n.Offer(c.ev, 1000); ok {
				checkLine(t, l.Text)
				if !inPool[l.Text] {
					t.Errorf("%s/%s: %q is not from %s", c.ev.Kind, c.ev.Item, l.Text, c.pool)
				}
				got = true
			}
		}
		if !got {
			t.Errorf("%s/%s: never spoke", c.ev.Kind, c.ev.Item)
		}
	}
}

// Nests: the owner is named only when Known (identified); never otherwise.
func TestNestNeverNamesUnknownOwner(t *testing.T) {
	fs := loadFixture(t)
	words, phrases := forbidden(fs)
	namedWhenKnown := 0
	for si, f := range fs {
		for _, site := range NestSites {
			for seed := int64(0); seed < 4; seed++ {
				n := New(seed*100 + int64(si))
				for _, st := range []string{"", "eggs", "chicks", "old", "building"} {
					l, ok := n.Offer(Event{Kind: NestFound, Item: site, Stage: st, Subject: site + st}, float64(seed)*1e5+float64(len(st))*1000)
					if ok {
						if w := spoils(l.Text, words, phrases); w != "" {
							t.Fatalf("unknown nest at %s: %q names %q", site, l.Text, w)
						}
					}
				}
				sp := f.sp
				l, ok := n.Offer(Event{Kind: NestFound, Item: site, Known: &sp, Subject: "k" + site}, float64(seed)*1e5+50000)
				if ok && strings.Contains(l.Text, shortName(&sp)) {
					namedWhenKnown++
				}
			}
		}
	}
	if namedWhenKnown == 0 {
		t.Error("a known owner's nest was never named")
	}
}

// Facts rotate: every fact once before any repeats, preferred the first times.
func TestFactsRotateWithoutRepeats(t *testing.T) {
	cat := catalogWithFacts(t)
	sp := cat[0]
	facts := SpeciesFacts(&sp)
	if len(facts) != 7 {
		t.Fatalf("%d facts after cleaning, want 7", len(facts))
	}
	isFact := map[string]bool{}
	for _, f := range facts {
		isFact[f] = true
	}
	n := New(3)
	var got []string
	spoken := 0
	for i := 0; i < 400 && len(got) < 14; i++ {
		l, ok := n.Offer(Event{Kind: Watching, Known: &sp, Clarity: 0.9}, float64(i)*1000)
		if !ok {
			continue
		}
		spoken++
		if isFact[l.Text] {
			got = append(got, l.Text)
		}
	}
	if len(got) < 14 {
		t.Fatalf("only %d facts in %d lines", len(got), spoken)
	}
	first := map[string]bool{}
	for _, f := range got[:7] {
		if first[f] {
			t.Fatalf("fact repeated before all were said: %q", f)
		}
		first[f] = true
	}
	second := map[string]bool{}
	for _, f := range got[7:14] {
		if second[f] {
			t.Fatalf("fact repeated within the second round: %q", f)
		}
		second[f] = true
	}
	// The rotation survives a save.
	n2 := New(3)
	for i := 0; i < 3; i++ {
		n2.Offer(Event{Kind: Watching, Known: &sp, Clarity: 0.9}, float64(i)*1000)
	}
	b, _ := json.Marshal(n2.State())
	var st State
	if err := json.Unmarshal(b, &st); err != nil {
		t.Fatal(err)
	}
	if len(st.Facts[sp.ID]) == 0 && st.FactRounds[sp.ID] == 0 {
		t.Error("fact rotation not saved")
	}
	// A species without facts still gets its watch lines.
	plain := loadFixture(t)[0].sp
	n3 := New(1)
	ok := false
	for i := 0; i < 20 && !ok; i++ {
		_, ok = n3.Offer(Event{Kind: Watching, Known: &plain, Clarity: 0.9}, float64(i)*1000)
	}
	if !ok {
		t.Error("no line for a known species without facts")
	}
}

// Activities stay occasional: a stream of them does not make him chatter.
func TestActivitiesShareThePacingBudget(t *testing.T) {
	n := New(8)
	said := 0
	for i := 0; i < 3600; i++ { // an hour, one activity a second
		ev := Event{Kind: []Kind{Foraged, Ate, Waded, SatDown, EmptyView, Cooked}[i%6],
			Item: PlantIDs[i%len(PlantIDs)]}
		if ev.Kind == Cooked || ev.Kind == Ate {
			ev.Item = FoodIDs[i%len(FoodIDs)]
		}
		if _, ok := n.Offer(ev, float64(i)); ok {
			said++
		}
	}
	t.Logf("%d activity lines in an hour of constant activity", said)
	if said > 60 || said == 0 {
		t.Errorf("%d activity lines in an hour", said)
	}
}
