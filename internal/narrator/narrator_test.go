package narrator

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
	"unicode"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// fixture: id|name|sci|family|size|shape|primary|secondary|marking|bill|flight|pitch|pattern
// (a hand-copied subset of internal/species so this package's tests stand alone).
const fixture = `
european_robin|European Robin|Erithacus rubecula|Thrushes & Chats|small|songbird|brown|orange|orange-red face and breast|thin|darting|high|melodic
blue_tit|Blue Tit|Cyanistes caeruleus|Tits|tiny|tit|blue|yellow|blue cap, white face with a dark eye-stripe|short|whirring|high|trill
great_tit|Great Tit|Parus major|Tits|small|tit|yellow|black|black stripe down a yellow belly, white cheeks|short|undulating|high|repeated
common_blackbird|Common Blackbird|Turdus merula|Thrushes & Chats|medium|thrush|black|yellow|orange-yellow bill and eye-ring|thin|direct|low|melodic
eurasian_wren|Eurasian Wren|Troglodytes troglodytes|Wrens|tiny|songbird|brown|buff|short cocked tail, fine dark barring|thin|whirring|high|trill
common_chaffinch|Common Chaffinch|Fringilla coelebs|Finches|small|finch|pink|grey|double white wing-bars, blue-grey cap|stout|undulating|high|melodic
great_spotted_woodpecker|Great Spotted Woodpecker|Dendrocopos major|Woodpeckers|medium|woodpecker|black|white|white shoulder patches, crimson under the tail|chisel|undulating|medium|drumming
eurasian_jay|Eurasian Jay|Garrulus glandarius|Crows & Jays|medium|corvid|pink|black|blue-barred wing patch, white rump|stout|buoyant|medium|harsh
eurasian_nuthatch|Eurasian Nuthatch|Sitta europaea|Nuthatches|small|songbird|grey|buff|long black eye-stripe|dagger|direct|high|whistle
eurasian_treecreeper|Eurasian Treecreeper|Certhia familiaris|Treecreepers|small|treecreeper|brown|white|bark-mottled back, silky white underparts|long curved|undulating|very high|trill
tawny_owl|Tawny Owl|Strix aluco|Owls|medium|owl|brown|buff|round head, dark eyes in a plain face|hooked|flapglide|low|repeated
common_buzzard|Common Buzzard|Buteo buteo|Hawks & Eagles|large|raptor|brown|white|pale crescent across the breast|hooked|soaring|medium|single
song_thrush|Song Thrush|Turdus philomelos|Thrushes & Chats|medium|thrush|brown|buff|dark arrowhead spots on a cream breast|thin|direct|medium|repeated
goldcrest|Goldcrest|Regulus regulus|Kinglets|tiny|warbler|green|yellow|yellow crown-stripe edged with black|thin|whirring|very high|trill
long_tailed_tit|Long-tailed Tit|Aegithalos caudatus|Long-tailed Tits|tiny|tit|white|black|tail longer than its body, pink shoulders|short|undulating|high|chatter
eurasian_blackcap|Eurasian Blackcap|Sylvia atricapilla|Warblers|small|warbler|grey|black|neat black cap|thin|darting|medium|melodic
common_chiffchaff|Common Chiffchaff|Phylloscopus collybita|Warblers|tiny|warbler|green|buff|faint pale eyebrow, dark legs|thin|darting|high|repeated
grey_wagtail|Grey Wagtail|Motacilla cinerea|Wagtails & Pipits|small|wagtail|grey|yellow|lemon-yellow under a very long tail|thin|undulating|high|single
common_kingfisher|Common Kingfisher|Alcedo atthis|Kingfishers|small|kingfisher|blue|orange|electric-blue stripe down the back|dagger|direct|very high|whistle
golden_oriole|Golden Oriole|Oriolus oriolus|Orioles|medium|thrush|yellow|black|golden body with black wings|stout|undulating|medium|whistle
mallard|Mallard|Anas platyrhynchos|Ducks, Geese & Swans|large|duck|grey|green|glossy green head with a white neck ring|flat|direct|medium|harsh
common_moorhen|Common Moorhen|Gallinula chloropus|Rails & Crakes|medium|rail|black|brown|red bill shield and a white line along the flank|short|direct|medium|single
grey_heron|Grey Heron|Ardea cinerea|Herons & Bitterns|huge|heron|grey|white|black plume behind the eye on a white head|dagger|direct|low|harsh
eurasian_reed_warbler|Eurasian Reed Warbler|Acrocephalus scirpaceus|Warblers|small|warbler|brown|buff|plain unmarked face with a pale throat|thin|direct|medium|chatter
eurasian_bittern|Eurasian Bittern|Botaurus stellaris|Herons & Bitterns|large|heron|buff|brown|golden buff streaked like dead reeds, black crown|dagger|direct|low|booming
western_marsh_harrier|Western Marsh Harrier|Circus aeruginosus|Hawks & Eagles|large|raptor|brown|buff|cream crown and throat on a chocolate-brown body|hooked|flapglide|medium|whistle
northern_wheatear|Northern Wheatear|Oenanthe oenanthe|Thrushes & Chats|small|songbird|grey|buff|white rump and a black T on the tail|thin|direct|high|chatter
common_raven|Common Raven|Corvus corax|Crows & Jays|large|corvid|black|black|all black with a shaggy throat and wedge-shaped tail|stout|soaring|low|harsh
ring_ouzel|Ring Ouzel|Turdus torquatus|Thrushes & Chats|medium|thrush|black|white|white crescent across the breast|thin|direct|medium|whistle
golden_eagle|Golden Eagle|Aquila chrysaetos|Hawks & Eagles|huge|raptor|brown|buff|golden nape and vast, long-fingered wings|hooked|soaring|medium|repeated
herring_gull|Herring Gull|Larus argentatus|Gulls & Terns|large|gull|white|grey|pale grey back, black wingtips and pink legs|stout|soaring|medium|laughing
eurasian_oystercatcher|Eurasian Oystercatcher|Haematopus ostralegus|Waders|medium|wader|black|white|long carrot-orange bill and pink legs|dagger|direct|high|repeated
great_cormorant|Great Cormorant|Phalacrocorax carbo|Cormorants|huge|seabird|black|white|white chin patch on a snaky black neck|hooked|direct|low|repeated
atlantic_puffin|Atlantic Puffin|Fratercula arctica|Auks|medium|seabird|black|white|huge banded orange bill on a pale clown face|stout|whirring|low|single
redwing|Redwing|Turdus iliacus|Thrushes & Chats|medium|thrush|brown|red|cream eyebrow and rust-red flanks|thin|direct|very high|single
brambling|Brambling|Fringilla montifringilla|Finches|small|finch|orange|black|orange breast and shoulders with a white rump|short|undulating|medium|harsh
hawfinch|Hawfinch|Coccothraustes coccothraustes|Finches|small|finch|brown|orange|massive bill and a broad white wing-bar|stout|undulating|high|repeated
snow_bunting|Snow Bunting|Plectrophenax nivalis|Buntings|small|finch|white|buff|white wings with black tips|short|undulating|high|trill
rock_ptarmigan|Rock Ptarmigan|Lagopus muta|Grouse|medium|grouse|white|black|feathered feet and a red comb over the eye|short|direct|low|drumming
snowy_owl|Snowy Owl|Bubo scandiacus|Owls|large|owl|white|grey|golden eyes in a round white face|hooked|flapglide|low|repeated
`

type fx struct {
	sp                     core.Species
	pitch, pattern         string
	nameWords, familyWords []string
}

func loadFixture(t testing.TB) []fx {
	var out []fx
	for _, line := range strings.Split(strings.TrimSpace(fixture), "\n") {
		f := strings.Split(line, "|")
		if len(f) != 13 {
			t.Fatalf("bad fixture line %q", line)
		}
		sp := core.Species{ID: f[0], Name: f[1], Sci: f[2], Family: f[3],
			Traits: core.Traits{Size: f[4], Shape: f[5], Primary: f[6], Secondary: f[7], Marking: f[8], Bill: f[9], Flight: f[10]},
			Calls:  []core.Call{{Pitch: f[11], Pattern: f[12]}},
		}
		out = append(out, fx{sp: sp, pitch: f[11], pattern: f[12]})
	}
	if len(out) != 40 {
		t.Fatalf("fixture has %d species, want 40", len(out))
	}
	return out
}

// forbidden builds every word and phrase that would name or classify a bird:
// species names (full and head noun), scientific names, family names and their
// words, and every silhouette class word.
func forbidden(fs []fx) (words map[string]bool, phrases []string) {
	words = map[string]bool{}
	add := func(w string) {
		w = strings.ToLower(w)
		if w == "" || w == "long" || w == "tailed" || w == "and" {
			return
		}
		words[w] = true
		for _, suf := range []string{"es", "s"} {
			if strings.HasSuffix(w, suf) && len(w) > len(suf)+2 {
				words[strings.TrimSuffix(w, suf)] = true
			}
		}
		words[w+"s"] = true
	}
	for _, f := range fs {
		phrases = append(phrases, strings.ToLower(f.sp.Name), strings.ToLower(f.sp.Sci), strings.ToLower(f.sp.Family))
		nw := letterWords(f.sp.Name)
		add(nw[len(nw)-1])
		for _, w := range letterWords(f.sp.Family) {
			add(w)
		}
		add(f.sp.Traits.Shape)
		phrases = append(phrases, strings.ToLower(strings.ReplaceAll(f.sp.ID, "_", " ")))
	}
	return words, phrases
}

func letterWords(s string) []string {
	return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) })
}

func spoils(text string, words map[string]bool, phrases []string) string {
	norm := " " + strings.Join(letterWords(text), " ") + " "
	for _, w := range letterWords(text) {
		if words[w] {
			return w
		}
	}
	for _, p := range phrases {
		if strings.Contains(norm, " "+strings.Join(letterWords(p), " ")+" ") {
			return p
		}
	}
	return ""
}

// checkLine enforces the writing rules on a produced line.
func checkLine(t *testing.T, text string) {
	t.Helper()
	if strings.ContainsAny(text, "{}") {
		t.Errorf("unresolved slot in %q", text)
	}
	if n := len(strings.Fields(text)); n > 25 || n == 0 {
		t.Errorf("%d words in %q", n, text)
	}
	for _, r := range text {
		if !(unicode.IsLetter(r) || r == ' ' || strings.ContainsRune(".,'?!;:-", r)) {
			t.Errorf("unspeakable character %q in %q", r, text)
			break
		}
	}
}

func richClue(f fx, id uint32) *proto.Clue {
	return &proto.Clue{ID: id, Dir: "Northeast", DistMin: 20, DistMax: 40, Elevation: "above",
		Pitch: strings.ToUpper(f.pitch[:1]) + f.pitch[1:], Pattern: strings.ToUpper(f.pattern[:1]) + f.pattern[1:],
		Habitat: "Woodland canopy", Perch: "high in the canopy", Confidence: "Fair", Strength: 0.5,
		Mystery: "m1", TTL: 8}
}

func fullEvidence(f fx) map[string]string {
	t := f.sp.Traits
	return map[string]string{"size": t.Size, "shape": t.Shape, "primary": t.Primary, "secondary": t.Secondary,
		"marking": t.Marking, "bill": t.Bill, "flight": t.Flight, "pitch": f.pitch, "pattern": f.pattern,
		"habitat": "woodland", "behavior": "foraging"}
}

// unknownEvents builds every bird-related moment for an UNIDENTIFIED bird of this
// species, filled with its true traits as perceived.
func unknownEvents(f fx) []Event {
	ev := fullEvidence(f)
	var out []Event
	for i, mod := range []func(*proto.Clue){
		func(c *proto.Clue) { c.New = true },
		func(c *proto.Clue) { c.New = true; c.Strength = 0.1 },
		func(c *proto.Clue) { c.New = true; c.Strength = 0.9 },
		func(c *proto.Clue) { c.Unusual = true },
		func(c *proto.Clue) {},
		func(c *proto.Clue) { c.Strength = 0.95 },
		// A careless session that leaks the species into the clue must still not spoil.
		func(c *proto.Clue) { c.New = true; c.Known = f.sp.ID },
	} {
		c := richClue(f, uint32(i+1))
		mod(c)
		out = append(out, Event{Kind: CallHeard, Clue: c, Subject: "m1"})
	}
	out = append(out, Event{Kind: FocusBegin})
	out = append(out, Event{Kind: Watching, Subject: "m1", Evidence: ev, Behavior: "foraging", Clarity: 0.7})
	for _, b := range []string{"foliage", "distance", "dark", "rain", "motion"} {
		out = append(out, Event{Kind: Watching, Subject: "m1", Evidence: ev, Blocked: b, Clarity: 0.1})
	}
	for _, k := range core.EvidenceKeys {
		out = append(out, Event{Kind: NewEvidence, Subject: "m1", Evidence: ev, NewKey: k})
	}
	for _, a := range []string{"feeding", "bathing", "nesting", "social", "hovering", "diving", "preening"} {
		out = append(out, Event{Kind: Behaviour, Subject: "m1", Evidence: ev, Behavior: a})
	}
	known := f.sp // the wrong/insufficient path must ignore Known even if set
	out = append(out,
		Event{Kind: Flushed, Subject: "m1", Evidence: ev},
		Event{Kind: Settled, Subject: "m1", Evidence: ev},
		Event{Kind: Identified, Outcome: "wrong", Mismatch: "bill", Known: &known, Evidence: ev},
		Event{Kind: Identified, Outcome: "wrong", Evidence: ev},
		Event{Kind: Identified, Outcome: "insufficient", Known: &known},
		Event{Kind: Photographed, Stars: 0, Evidence: ev},
		Event{Kind: Photographed, Stars: 2, Evidence: ev},
		Event{Kind: Photographed, Stars: 4, Tags: []string{"behavior:feeding", "golden hour"}, Evidence: ev},
		Event{Kind: Photographed, Stars: 5, Tags: []string{"exceptional", "rare"}, Evidence: ev},
		Event{Kind: Recorded, Stars: 0}, Event{Kind: Recorded, Stars: 2}, Event{Kind: Recorded, Stars: 4}, Event{Kind: Recorded, Stars: 5},
		Event{Kind: RareFind, RareKind: "unusual_plumage", Subject: "m1", Evidence: ev},
		Event{Kind: RareFind, RareKind: "out_of_range", Subject: "m1", Evidence: ev},
		Event{Kind: RareFind, RareKind: "rare_species", Subject: "m1", Evidence: ev},
		Event{Kind: RareFind, RareKind: "behavior", Subject: "m1", Evidence: ev},
	)
	return out
}

func TestNonSpoiler(t *testing.T) {
	fs := loadFixture(t)
	words, phrases := forbidden(fs)
	produced := 0
	for si, f := range fs {
		evs := unknownEvents(f)
		for seed := int64(0); seed < 12; seed++ {
			n := New(seed*1000 + int64(si))
			now := 0.0
			for rep := 0; rep < 3; rep++ {
				for _, e := range evs {
					now += 5000 // far apart: pacing never blocks, every pool gets exercised
					line, ok := n.Offer(e, now)
					if !ok {
						continue
					}
					produced++
					checkLine(t, line.Text)
					if w := spoils(line.Text, words, phrases); w != "" {
						t.Fatalf("unknown %s (%s): line %q names %q", f.sp.ID, e.Kind, line.Text, w)
					}
				}
			}
		}
	}
	if produced < 3000 {
		t.Fatalf("only %d lines produced; the test is not exercising the bank", produced)
	}
	t.Logf("%d unknown-bird lines checked, none spoils", produced)
}

// Every pool that is reachable for unidentified birds (or for no bird at all) must be
// free of bird names in its literal text; naming happens only through sp./shape.
// pools and the {name}/{aname} slots.
func TestGenericPoolsNameNoBird(t *testing.T) {
	words, phrases := forbidden(loadFixture(t))
	for pool, lines := range bank {
		if namingPool(pool) {
			continue
		}
		for _, l := range lines {
			lit := l
			for _, s := range []string{"{name}", "{aname}"} {
				lit = strings.ReplaceAll(lit, s, "")
			}
			if w := spoils(lit, words, phrases); w != "" {
				t.Errorf("pool %s line %q contains %q", pool, l, w)
			}
		}
	}
}

func TestSpeciesLinesForAll40(t *testing.T) {
	fs := loadFixture(t)
	if len(speciesBank) != 40 {
		t.Errorf("speciesBank has %d species, want 40", len(speciesBank))
	}
	for _, f := range fs {
		s, ok := speciesBank[f.sp.ID]
		if !ok || len(s.hear) == 0 || len(s.watch) == 0 || len(s.note) == 0 {
			t.Errorf("%s: missing hear/watch/note lines", f.sp.ID)
			continue
		}
		if _, ok := shortNames[f.sp.ID]; !ok {
			t.Errorf("%s: no short name", f.sp.ID)
		}
		// Known bird under observation produces a line, and hearing it can too.
		sp := f.sp
		n := New(7)
		got := 0
		for i := 0; i < 20; i++ {
			if line, ok := n.Offer(Event{Kind: Watching, Known: &sp, Behavior: "perched", Clarity: 0.8}, float64(i)*5000); ok {
				checkLine(t, line.Text)
				got++
			}
			c := richClue(f, 1)
			c.Known = sp.ID
			if line, ok := n.Offer(Event{Kind: CallHeard, Known: &sp, Clue: c}, float64(i)*5000+2500); ok {
				checkLine(t, line.Text)
				got++
			}
		}
		if got == 0 {
			t.Errorf("%s: no known-species lines produced", f.sp.ID)
		}
	}
	// A species outside the bank falls back to its shape or generic known lines.
	other := core.Species{ID: "made_up", Name: "Made-up Bird", Traits: core.Traits{Shape: "finch"}}
	n := New(1)
	ok := false
	for i := 0; i < 20 && !ok; i++ {
		_, ok = n.Offer(Event{Kind: Watching, Known: &other, Clarity: 0.8}, float64(i)*5000)
	}
	if !ok {
		t.Error("no fallback line for a known species without its own lines")
	}
}

var knownSlotNames = map[string]bool{"sound": true, "pitch": true, "where": true, "dist": true, "elev": true,
	"dir": true, "act": true, "size": true, "shape": true, "colours": true, "bill": true, "flight": true,
	"habitat": true, "subj": true, "name": true, "aname": true, "title": true, "mismatch": true}

// Every template: literal text speakable, slots known, and fillable within 25 words
// with the longest value of every slot vocabulary.
func TestEveryTemplate(t *testing.T) {
	sl := slots{}
	for k := range knownSlotNames {
		for _, v := range slotDomain(k) {
			if len(v) > len(sl[k]) {
				sl[k] = v
			}
		}
	}
	long := core.Species{ID: "great_spotted_woodpecker", Name: "Great Spotted Woodpecker"}
	nameSlots(sl, &long)
	total := 0
	for pool, lines := range bank {
		if len(lines) == 0 {
			t.Errorf("empty pool %s", pool)
		}
		for _, l := range lines {
			total++
			for _, part := range strings.Split(l, "{")[1:] {
				name := part[:strings.IndexByte(part, '}')]
				if !knownSlotNames[name] {
					t.Errorf("pool %s: unknown slot {%s} in %q", pool, name, l)
				}
			}
			out, ok := fill(l, sl)
			if !ok {
				t.Errorf("pool %s: cannot fill %q within %d words", pool, l, maxWords)
				continue
			}
			checkLine(t, out)
			if strings.ContainsAny(l, "0123456789()") {
				t.Errorf("pool %s: digits or parentheses in %q", pool, l)
			}
		}
	}
	t.Logf("%d lines in %d pools", total, len(bank))
	if total < 450 {
		t.Errorf("only %d lines in the bank", total)
	}
}

// denseHour simulates an hour of a very eventful session at 10 Hz plus Idle at 1 Hz.
func denseHour(n *Narrator, fs []fx, start float64, steps int) []proto.Narration {
	var lines []proto.Narration
	env := core.Env{Time: 4.0, Day: 1, Light: 0.2}
	for i := 0; i < steps; i++ {
		now := start + float64(i)*0.125 // exactly representable, so save/restore rebasing is exact
		f := fs[i%len(fs)]
		var ev Event
		switch i % 13 {
		case 0, 1, 2:
			c := richClue(f, uint32(i%7))
			c.Mystery = fmt.Sprintf("m%d", i%5)
			c.New = i%11 == 0
			ev = Event{Kind: CallHeard, Clue: c}
		case 3:
			sp := f.sp
			ev = Event{Kind: CallHeard, Known: &sp, Clue: richClue(f, 9)}
		case 4:
			ev = Event{Kind: Watching, Subject: fmt.Sprintf("m%d", i%5), Evidence: fullEvidence(f), Clarity: 0.6}
		case 5:
			ev = Event{Kind: NewEvidence, Subject: fmt.Sprintf("m%d", i%5), Evidence: fullEvidence(f), NewKey: core.EvidenceKeys[i%len(core.EvidenceKeys)]}
		case 6:
			ev = Event{Kind: Behaviour, Subject: "m2", Behavior: []string{"feeding", "bathing", "social"}[i%3]}
		case 7:
			ev = Event{Kind: Flushed}
		case 8:
			ev = Event{Kind: Settled}
		case 9:
			ev = Event{Kind: Photographed, Stars: i % 6}
		case 10:
			ev = Event{Kind: FocusBegin}
		case 11:
			ev = Event{Kind: PlaceFound, POIKind: "watchtower", POIName: "Thornback Tower", Subject: fmt.Sprintf("tower%d", i/500)}
		case 12:
			ev = Event{Kind: RareFind, RareKind: "out_of_range", Subject: fmt.Sprintf("m%d", i%5)}
		}
		if l, ok := n.Offer(ev, now); ok {
			lines = append(lines, l)
		}
		if i%10 == 0 {
			env.Time = float32(math.Mod(4.0+float64(i)/600.0, 24)) // one game hour per real minute
			env.Rain = float32(0.5 + 0.5*math.Sin(float64(i)/3000))
			ctx := Context{Region: core.RegionGreenhollow, Env: env, Still: float32(i%900) / 10, Moving: i%2000 > 1000}
			if l, ok := n.Idle(ctx, now); ok {
				lines = append(lines, l)
			}
		}
	}
	return lines
}

func TestPacingBudget(t *testing.T) {
	fs := loadFixture(t)
	lines := denseHour(New(42), fs, 0, 28800) // one hour at 8 Hz, an event every tick
	if len(lines) == 0 {
		t.Fatal("no lines at all in a dense hour")
	}
	t.Logf("%d lines in a dense simulated hour", len(lines))
	// Even when something happens every tick, he should average well under one line a minute.
	if len(lines) > 75 {
		t.Errorf("%d lines in an hour is chatter", len(lines))
	}
}

// TestPacingWindow checks the exact pacing rules using recorded timestamps.
func TestPacingWindow(t *testing.T) {
	fs := loadFixture(t)
	n := New(99)
	type stamped struct {
		at float64
		l  proto.Narration
	}
	var got []stamped
	env := core.Env{Time: 6, Day: 1}
	for i := 0; i < 36000; i++ {
		now := float64(i) * 0.1
		f := fs[i%40]
		c := richClue(f, uint32(i%9))
		c.Mystery = fmt.Sprintf("m%d", i%17)
		c.New = i%3 == 0
		c.Unusual = i%97 == 0
		evs := []Event{
			{Kind: CallHeard, Clue: c},
			{Kind: Watching, Subject: c.Mystery, Evidence: fullEvidence(f), Clarity: 0.6},
			{Kind: Behaviour, Subject: c.Mystery, Behavior: "feeding"},
			{Kind: Photographed, Stars: 1 + i%5},
			{Kind: Flushed},
		}
		if l, ok := n.Offer(evs[i%len(evs)], now); ok {
			got = append(got, stamped{now, l})
		}
		if i%10 == 0 {
			env.Time = float32(math.Mod(6+float64(i)/600, 24))
			if l, ok := n.Idle(Context{Region: core.RegionMurmurMarsh, Env: env, Still: 100}, now); ok {
				got = append(got, stamped{now, l})
			}
		}
	}
	if len(got) < 10 {
		t.Fatalf("only %d lines in an hour of constant events", len(got))
	}
	for i, s := range got {
		if s.l.Priority >= 3 {
			continue
		}
		// Budget: at most 3 lines (priority < 3) in any 90 s window ending here.
		c := 0
		for j := i; j >= 0 && s.at-got[j].at < budgetWindow; j-- {
			if got[j].l.Priority < 3 {
				c++
			}
		}
		if c > budgetLines {
			t.Fatalf("%d lines within 90 s ending at %.1f", c, s.at)
		}
		// Long-run average: a priority 0/1 line only when fewer than 8 lines came in
		// the previous 10 minutes.
		if s.l.Priority < 3 {
			c = 0
			for j := i - 1; j >= 0 && s.at-got[j].at < longWindow; j-- {
				if got[j].l.Priority < 3 {
					c++
				}
			}
			if (s.l.Priority < 2 && c >= longLines) || c >= longLines2 {
				t.Fatalf("priority %d line at %.1f after %d lines in 10 min", s.l.Priority, s.at, c)
			}
		}
		if i > 0 {
			gap := s.at - got[i-1].at
			if gap < priorityGap[s.l.Priority]-1e-9 {
				t.Fatalf("priority %d line %.1f s after the previous one (min %.0f)", s.l.Priority, gap, priorityGap[s.l.Priority])
			}
		}
		if i > 0 && s.l.Text == got[i-1].l.Text {
			t.Fatalf("immediate repeat: %q", s.l.Text)
		}
		checkLine(t, s.l.Text)
	}
	t.Logf("%d lines in an hour of constant events", len(got))
}

func TestPoolNoRepeatUntilMostUsed(t *testing.T) {
	n := New(5)
	pool := "flush"
	size := len(bank[pool])
	limit := size * 3 / 4
	var idx []int
	for i := 0; i < 60; i++ {
		c, ok := n.pick([]string{pool}, plan{slots: slots{}})
		if !ok {
			t.Fatal("no candidate")
		}
		n.commit(c, plan{})
		n.st.LastText = c.text
		idx = append(idx, c.idx)
	}
	for i := range idx {
		for j := i + 1; j < len(idx) && j <= i+limit; j++ {
			if idx[i] == idx[j] {
				t.Fatalf("line %d reused after %d picks (pool of %d)", idx[i], j-i, size)
			}
		}
	}
}

func run(n *Narrator, fs []fx, start float64, steps int) []string {
	var out []string
	for _, l := range denseHour(n, fs, start, steps) {
		b, _ := json.Marshal(l)
		out = append(out, string(b))
	}
	return out
}

func TestDeterminism(t *testing.T) {
	fs := loadFixture(t)
	a := run(New(11), fs, 0, 12000)
	b := run(New(11), fs, 0, 12000)
	if strings.Join(a, "\n") != strings.Join(b, "\n") {
		t.Fatal("same seed and calls gave different lines")
	}
	c := run(New(12), fs, 0, 12000)
	if strings.Join(a, "\n") == strings.Join(c, "\n") {
		t.Error("different seeds gave identical narration")
	}
}

func TestStateRestoreRoundTrip(t *testing.T) {
	fs := loadFixture(t)
	orig := New(21)
	run(orig, fs, 0, 6000) // ten minutes
	saved := orig.State()
	b, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	var back State
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatal(err)
	}
	restored := New(9999) // a different seed: everything must come from the state
	restored.Restore(back)

	// The original carries on from the moment of the save; the restored session's
	// clock restarts at 0. Both must say exactly the same things from here.
	contA := run(orig, fs, saved.Clock, 6000)
	contB := run(restored, fs, 0, 6000)
	if len(contA) == 0 {
		t.Fatal("nothing said after the save")
	}
	strip := func(xs []string) string { return strings.Join(xs, "\n") }
	if strip(contA) != strip(contB) {
		t.Fatalf("restored narrator diverged:\n%v\n---\n%v", contA[:min(3, len(contA))], contB[:min(3, len(contB))])
	}
	// Recently used lines survived.
	if len(back.Recent) == 0 || back.Seq == 0 {
		t.Error("state lost its memory")
	}
}

func TestWelcomeOnceAndMilestonesImmediate(t *testing.T) {
	n := New(1)
	l, ok := n.Offer(Event{Kind: NewAdventure}, 1)
	if !ok || l.Priority != 3 {
		t.Fatalf("no welcome: %v %v", l, ok)
	}
	if _, ok := n.Offer(Event{Kind: NewAdventure}, 5000); ok {
		t.Error("welcomed twice")
	}
	// Identification right after another line still speaks (priority 3).
	sp := core.Species{ID: "eurasian_wren", Name: "Eurasian Wren"}
	l, ok = n.Offer(Event{Kind: Identified, Outcome: "certain", Known: &sp}, 2)
	if !ok || !strings.Contains(strings.ToLower(l.Text), "wren") && !strings.Contains(l.Text, "name") {
		t.Errorf("certain identification: %q %v", l.Text, ok)
	}
	l, ok = n.Offer(Event{Kind: RankReached, Rank: 2, RankName: "Observer"}, 3)
	if !ok {
		t.Error("no rank line")
	}
	checkLine(t, l.Text)
}

func TestEnvTransitions(t *testing.T) {
	n := New(4)
	ctx := Context{Region: core.RegionGreenhollow, Env: core.Env{Time: 4.0, Day: 1}}
	n.Idle(ctx, 0)
	ctx.Env.Time = 5.0 // dawn
	l, ok := n.Idle(ctx, 1)
	if !ok || l.Kind != "time" {
		t.Fatalf("dawn not remarked: %v %v", l, ok)
	}
	ctx.Env.Rain = 0.6
	if _, ok := n.Idle(ctx, 2); ok {
		t.Error("spoke again 1 s later")
	}
	l, ok = n.Idle(ctx, 40) // pending rain line waits for the gap
	if !ok || l.Kind != "weather" {
		t.Fatalf("rain not remarked after the gap: %v %v", l, ok)
	}
	// Busy: nothing unprompted.
	ctx.Busy = true
	ctx.Env.Rain = 0
	for s := 41.0; s < 400; s++ {
		if _, ok := n.Idle(ctx, s); ok {
			t.Fatal("spoke while busy")
		}
	}
}

func TestLineCountReasonable(t *testing.T) {
	c := LineCount()
	t.Logf("line bank: %d lines", c)
	if c < 700 || c > 1100 {
		t.Errorf("line bank has %d lines", c)
	}
}
