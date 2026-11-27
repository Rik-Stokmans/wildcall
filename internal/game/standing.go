package game

import (
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// ---------------------------------------------------------------------------
// The credit ledger (spec screen 13)

// ledger records a Field Credit movement the session just made (positive earned,
// negative spent) with a player-facing reason. Anything that moves credits without
// a ledger call is caught by settleLedger at the end of the message or tick.
func (s *Session) ledger(amount int, reason string) {
	if amount != 0 {
		progress.AddLedger(s.p, s.clock.Env().Day, amount, reason)
		s.changed()
	}
	s.ledgerCredits = s.p.Credits
}

// settleLedger books any credit movement that was not recorded explicitly, so the
// ledger always adds up to the balance.
func (s *Session) settleLedger() {
	if d := s.p.Credits - s.ledgerCredits; d != 0 {
		reason := "Field Credits"
		if d < 0 {
			reason = "Spent"
		}
		s.ledger(d, reason)
	}
}

// credit runs fn, which may move credits, and books the difference with reason.
func (s *Session) credit(reason string, fn func()) {
	s.settleLedger()
	fn()
	s.ledger(s.p.Credits-s.ledgerCredits, reason)
}

// ---------------------------------------------------------------------------
// Reputation from deeds (spec §16.2)

// Small reputation awards for deeds other than quests. Each deed pays once (keyed
// in Profile.XPLog as "rep:<deed>:<key>", where the client view strips any key that
// names an unidentified species), and every kind of deed has a lifetime cap so an
// unbounded world cannot be farmed for standing.
const (
	repIdentify   = 2 // research: first identification of a species
	repDocument   = 2 // naturalists: a species first documented (discovery level 5)
	repStudied    = 5 // research: a species fully studied (level 6)
	repPlace      = 1 // rangers: a place discovered (hidden places: 2)
	repNest       = 2 // rangers: the first nest found of a species
	repBuyGear    = 4 // outfitters: the first purchase of a piece of equipment or a gadget
	repBuyUpgrade = 2 // outfitters: an item upgrade fitted at Finn's
)

// repCaps bounds each deed kind's lifetime total.
var repCaps = map[string]int{
	"identify": 80, "document": 80, "studied": 200, "place": 40, "nest": 40, "gear": 80, "upgrade": 40,
}

// deedRep pays n reputation with faction for a deed once, within the deed kind's
// cap, and announces it. It returns the reputation actually added.
func (s *Session) deedRep(faction, deed, key string, n int, why string) int {
	if n <= 0 {
		return 0
	}
	once := "rep:" + deed + ":" + key
	total := "rep:" + deed
	if s.p.XPLog[once] > 0 {
		return 0
	}
	if c := repCaps[deed]; c > 0 {
		n = min(n, c-s.p.XPLog[total])
	}
	s.p.XPLog[once] = max(n, 1) // remembered even when the cap is reached
	if n <= 0 {
		return 0
	}
	s.p.XPLog[total] += n
	progress.AddRep(s.p, faction, n)
	s.toast("rep", content.FactionTitle(faction), "+"+itoa(n)+" reputation: "+why, 0, "rep")
	s.changed()
	return n
}

// ---------------------------------------------------------------------------
// Story items

// storyItems runs the one-time story of special items the first time the player
// owns them, however they came by them: Edith Harrow's binoculars unlock her lore
// entry and reveal the hidden research quest that follows her last season.
func (s *Session) storyItems() {
	const flag = "story:historical_binoculars"
	if s.p.Flags[flag] || !progress.Owned(s.p, "historical_binoculars") {
		return
	}
	s.p.Flags[flag] = true
	if s.addLore(content.HarrowGlassLore) {
		if def, ok := content.LoreByID(content.HarrowGlassLore); ok {
			s.toast("journal", "Natural History", def.Title, 0, "journal")
		}
	}
	content.Reveal(s.p, content.HarrowGlassQuest)
	if q, ok := content.QuestByID(content.HarrowGlassQuest); ok {
		s.toast("quest", "A new lead", q.Name+": ask Professor Alder at the field lab.", 0, "quest")
	}
	s.changed()
}

// rewardUpgradeLines describes the item upgrades a reward fits, for the Rewards
// screen ("Upgrade fitted: Sharper Kit Lens (Starter Camera)").
func rewardUpgradeLines(r proto.Reward) []string {
	var out []string
	for _, u := range r.Unlock {
		item, up, ok := progress.ParseRewardUpgrade(u)
		if !ok {
			continue
		}
		def, ok1 := progress.Upgrade(item, up)
		it, ok2 := progress.Item(item)
		if ok1 && ok2 {
			out = append(out, "Upgrade fitted: "+def.Name+" ("+it.Name+")")
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Modest finds (spec §22: credits come from careful work, not from opening boxes)

// Once a region type's unique item has been found, its further caches (and
// collectible spots with nothing new left) hold only a modest find. Each pays once
// (the POI is taken), its credits shrink with every modest find opened before it,
// and modest finds never pay more than modestDailyCap credits in one in-game day.
const (
	modestDailyCap = 60 // base credits per in-game day from modest finds
	modestFloor    = 5  // the smallest modest find still pays this much
	modestHalving  = 6  // after this many modest finds, a find pays half its base
)

// modestCredits is what a modest find with base credits pays after opened earlier
// modest finds, when paidToday base credits have already been paid today.
func modestCredits(base, opened, paidToday int) int {
	if base <= 0 {
		return 0
	}
	c := base * modestHalving / (modestHalving + opened)
	c = max(c, min(base, modestFloor))
	return max(0, min(c, modestDailyCap-paidToday))
}

// payModestFind pays a modest find's credits (diminishing, daily-capped), books
// it in the ledger and returns the credits paid.
func (s *Session) payModestFind(base int, reason string) int {
	day := s.clock.Env().Day
	dayKey := "modest:day:" + itoa(day)
	for k := range s.p.XPLog {
		if len(k) > 11 && k[:11] == "modest:day:" && k != dayKey {
			delete(s.p.XPLog, k)
		}
	}
	c := modestCredits(base, s.p.XPLog["modest:count"], s.p.XPLog[dayKey])
	s.p.XPLog["modest:count"]++
	if c <= 0 {
		return 0
	}
	s.p.XPLog[dayKey] += c
	s.settleLedger()
	got := progress.GrantCredits(s.p, c)
	s.ledger(got, reason)
	return got
}

// trueSpecies resolves a journal subject to its true species id: the species if
// identified, else the species behind the mystery ("" if neither is known).
func (s *Session) trueSpecies(spID, mysteryID string) string {
	if spID != "" {
		return spID
	}
	if m := s.mysteryByID(mysteryID); m != nil {
		return m.Species
	}
	return ""
}

// firstRecReach is how many times Stats.RecRange away a singer may be for a
// one-star take to still count as the species' first recording.
const firstRecReach = 1.5

// firstRecordingCounts reports whether a recording is good enough to pay a
// species' first-recording XP: two stars or better, or captured within
// firstRecReach × RecRange of the singer.
func firstRecordingCounts(r proto.RecMeta, st core.Stats) bool {
	return r.Stars >= 2 || (r.Dist > 0 && r.Dist <= firstRecReach*st.RecRange)
}

// ---------------------------------------------------------------------------
// Guessing (design rule 1: discovery must be earned)

// A wrong guess is free and rules its candidate out. To keep evidence at the heart
// of identification, the next guess on the same mystery needs at least one new
// piece of evidence: a key the mystery did not have at the last wrong guess. The
// evidence keys at that guess are kept in Profile.Flags as
// "guessed:<mystery id>:<sorted keys>" (keys only: no species, nothing to leak).

const guessPrefix = "guessed:"

func evidenceFingerprint(ev map[string]string) []string {
	var keys []string
	for _, k := range core.EvidenceKeys {
		if ev[k] != "" {
			keys = append(keys, k)
		}
	}
	return keys
}

// markGuess remembers the evidence a wrong guess was made on.
func (s *Session) markGuess(m *proto.Mystery) {
	s.clearGuess(m.ID)
	s.p.Flags[guessPrefix+m.ID+":"+strings.Join(evidenceFingerprint(m.Evidence), ",")] = true
	s.changed()
}

func (s *Session) clearGuess(mysteryID string) {
	pfx := guessPrefix + mysteryID + ":"
	for k := range s.p.Flags {
		if strings.HasPrefix(k, pfx) {
			delete(s.p.Flags, k)
		}
	}
}

// newEvidenceSinceGuess reports whether the mystery may be guessed: there was no
// wrong guess yet, or it holds an evidence key it did not have at the last one.
func (s *Session) newEvidenceSinceGuess(m *proto.Mystery) bool {
	pfx := guessPrefix + m.ID + ":"
	for k, on := range s.p.Flags {
		if !on || !strings.HasPrefix(k, pfx) {
			continue
		}
		had := map[string]bool{}
		for _, key := range strings.Split(strings.TrimPrefix(k, pfx), ",") {
			had[key] = true
		}
		for _, key := range evidenceFingerprint(m.Evidence) {
			if !had[key] {
				return true
			}
		}
		return false
	}
	return true
}

// evidenceHint says, warmly, what kind of observation would help most next.
func evidenceHint(ev map[string]string) string {
	switch {
	case ev["pitch"] == "" || ev["pattern"] == "":
		return "Hearing it sing would help: hold F and keep listening until you have its pitch and pattern."
	case ev["marking"] == "":
		return "A longer look would help: keep it in your binoculars until its markings show."
	case ev["bill"] == "" || ev["secondary"] == "":
		return "A closer, clearer view would help: its bill and its second colour are still unknown."
	case ev["behavior"] == "":
		return "Watching what it does would help: how it feeds, how it moves."
	case ev["habitat"] == "":
		return "Noting where it lives would help: listen for where its voice comes from."
	case ev["flight"] == "":
		return "Seeing it fly would help: the way a bird flies says a lot."
	}
	return "Take another look or listen: any new detail will do."
}

// ---------------------------------------------------------------------------
// The Explorer's Lens (spec §10.3: inspect feathers, tracks, feeding signs and
// environmental clues in greater detail)

// lensStudy is the study progress a feather of an identified species adds under
// the lens.
const lensStudy = 5

// lensFeather inspects a picked-up feather with the Explorer's Lens and returns a
// line for the pickup toast ("" without the lens). A feather of an identified
// species adds a little study progress; otherwise one or two true evidence keys go
// to that species' mystery (created if needed). The line never names the bird.
func (s *Session) lensFeather(sp *core.Species, poi core.POI) string {
	if sp == nil || s.p.Stats.LensInspect < 1 {
		return ""
	}
	if e := s.entry(sp.ID); e != nil {
		if e.Study >= 100 {
			return "Under the lens: nothing you have not already noted."
		}
		ceil := 100
		if e.Level < proto.LevelDocumented {
			ceil = 95 // studying fully still needs it documented
		}
		e.Study = min(e.Study+lensStudy, ceil)
		if e.Study >= 100 {
			e.Level = proto.LevelStudied
			s.toast("journal", "Studied", sp.Name+" is fully studied.", 0, "knowledge")
			s.deedRep(content.FactionResearch, "studied", sp.ID, repStudied, "a species fully studied")
		}
		s.changed()
		return "Under the lens: barbs, wear and moult noted (study " + itoa(e.Study) + "%)."
	}
	m := s.ensureMystery(sp, proto.LevelHeard, poi.Pos)
	want := 1 + int(hashStr(poi.ID)%2)
	var got []string
	for _, k := range rotate([]string{"primary", "secondary", "size"}, int(hashStr(poi.ID)%3)) {
		if len(got) >= want {
			break
		}
		if v := sp.TraitValue(k); v != "" && m.Evidence[k] == "" {
			m.Evidence[k] = v
			got = append(got, k)
		}
	}
	s.changed()
	if len(got) == 0 {
		return "Under the lens: it matches what you already know of " + m.Label + "."
	}
	return "Under the lens: " + featherWords(sp, got) + " Noted under " + m.Label + "."
}

func featherWords(sp *core.Species, keys []string) string {
	var parts []string
	for _, k := range keys {
		switch k {
		case "primary":
			parts = append(parts, "the vane is mostly "+sp.Traits.Primary)
		case "secondary":
			parts = append(parts, "edged and barred with "+sp.Traits.Secondary)
		case "size":
			parts = append(parts, "its length says a "+sp.Traits.Size+" bird")
		}
	}
	return capitalFirst(strings.Join(parts, "; ")) + "."
}

// lensNest inspects a newly found nest of an unidentified owner with the lens:
// the size and build of the nest say how big its owner is and what shape of bird
// built it. It returns a line for the nest toast ("" when there is nothing to add).
func (s *Session) lensNest(sp *core.Species, n core.Nest) string {
	if sp == nil || s.p.Stats.LensInspect < 1 || s.identified(sp.ID) {
		return ""
	}
	m := s.ensureMystery(sp, proto.LevelHeard, n.Pos)
	var got []string
	for _, k := range []string{"size", "shape"} {
		if v := sp.TraitValue(k); v != "" && m.Evidence[k] == "" {
			m.Evidence[k] = v
			got = append(got, k)
		}
	}
	if len(got) == 0 {
		return ""
	}
	s.changed()
	return "Under the lens: the cup and its lining were made by a " + sp.Traits.Size + " bird, built like a " + sp.Traits.Shape + ". Noted under " + m.Label + "."
}

func rotate(xs []string, n int) []string {
	out := make([]string, 0, len(xs))
	for i := range xs {
		out = append(out, xs[(i+n)%len(xs)])
	}
	return out
}

func hashStr(s string) uint32 {
	h := uint32(2166136261)
	for i := 0; i < len(s); i++ {
		h ^= uint32(s[i])
		h *= 16777619
	}
	return h
}

func capitalFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// ---------------------------------------------------------------------------
// Narrator beats

// tutorialBeat narrates a beat of the first quest once per save, and only while
// the tutorial quest is under way (Item = singer_heard | singer_raised).
func (s *Session) tutorialBeat(item string) {
	flag := "narr:" + item
	if s.p.Flags[flag] || content.Status(s.p, content.TutorialQuest) != content.StatusActive {
		return
	}
	s.p.Flags[flag] = true
	s.narrate(narrator.Event{Kind: narrator.TutorialBeat, Item: item})
}

// ---------------------------------------------------------------------------
// Ecological rarities (spec §11): migration and the mixed feeding flock

const (
	// RareKindMigration is logged when the player witnesses the first arrival of
	// a migrant species (once per species).
	RareKindMigration = "migration"
	// RareKindMixedFlock is the Epic ecological event: a mixed feeding flock of
	// three or more species watched within mixedWindow seconds.
	RareKindMixedFlock = "mixed_flock"

	arrivalWitness = 150 // m: an arrival this close to the player is witnessed
	mixedWindow    = 120 // s: species of one mixed flock watched within this window
	mixedSpecies   = 3   // species of the flock the player must watch
	settleNear     = 45  // m: a bird settling this close is worth a narrator line
	settleStill    = 3   // s the player must have been still for the settle to be theirs
	// firstSeasonDays is the length of the adventure's first season (contract §3.1:
	// a season lasts 4 days): arrivals before its end are not witnessed migrations.
	firstSeasonDays = 4
)

func migrant(sp *core.Species) bool {
	return !(sp.Seasons[0] && sp.Seasons[1] && sp.Seasons[2] && sp.Seasons[3])
}

// onArrival handles an ecosystem EvArrive: a seasonal migrant arriving near the
// player is a "migration" rare discovery, once per species. Vagrants (out of
// range) are left to identification.
func (s *Session) onArrival(ev core.EcoEvent, eye core.Vec3) {
	sp := s.spAt(ev.Species)
	if sp == nil || !migrant(sp) || ev.Pos.Dist(eye) > arrivalWitness {
		return
	}
	if b, ok := s.sim.Get(ev.Bird); ok && b.Flags&core.FlagVagrant != 0 {
		return
	}
	e := s.clock.Env()
	season := e.Season
	// The migrants already arriving when a new adventure begins are not a
	// discovery: the player has to have been out in the season before.
	if !sp.Seasons[season] || e.Day <= firstSeasonDays {
		return
	}
	text := "A newcomer has arrived for the " + strings.ToLower(season.String()) + ": a bird that was not here a few days ago. Listen for a voice you have not heard here before."
	if s.identified(sp.ID) {
		text = "The first " + sp.Name + " of the " + strings.ToLower(season.String()) + " has arrived."
	}
	s.logRare(proto.RareDiscovery{
		ID: RareKindMigration + ":" + sp.ID, Kind: RareKindMigration, Title: "First arrival",
		Text: text, Species: sp.ID, Rarity: 2,
	}, sp.ID, ev.Pos)
}

// noteMixedFlock records the species of a mixed feeding flock the player is
// watching; three or more species of one flock within mixedWindow seconds is the
// Epic "mixed flock" discovery, once per season of each year.
func (s *Session) noteMixedFlock(b core.BirdState, sp *core.Species) {
	f := s.sim.MixedFlock(b.ID)
	if f == 0 || sp == nil {
		return
	}
	if s.flockSeen == nil || s.flockID != f {
		s.flockID, s.flockSeen = f, map[string]float64{}
	}
	s.flockSeen[sp.ID] = s.now
	n := 0
	for _, at := range s.flockSeen {
		if s.now-at <= mixedWindow {
			n++
		}
	}
	if n < mixedSpecies {
		return
	}
	e := s.clock.Env()
	s.logRare(proto.RareDiscovery{
		ID:     RareKindMixedFlock + ":" + itoa((e.Day-1)/16) + ":" + itoa(int(e.Season)),
		Kind:   RareKindMixedFlock,
		Title:  "A mixed feeding flock",
		Text:   "Several kinds of small birds moving through the trees together, feeding as they go: more eyes for danger, more chance of food. A wave like this passes in minutes.",
		Rarity: 3,
	}, "", b.Pos)
}

// onSettled narrates a bird settling or returning near the player because the
// player waited (the ecosystem's Settled list for the last step).
func (s *Session) onSettled(eye core.Vec3) {
	if !s.havePose || s.still < settleStill {
		return
	}
	for _, id := range s.sim.Settled() {
		b, ok := s.sim.Get(id)
		if !ok || b.Pos.Dist(eye) > settleNear {
			continue
		}
		sp := s.spAt(b.Species)
		subject := ""
		if sp != nil && !s.identified(sp.ID) {
			if m := s.mysteryOf(sp.ID); m != nil {
				subject = m.ID
			}
		}
		s.narrate(narrator.Event{Kind: narrator.Settled, Known: s.knownSp(sp), Subject: subject})
		return
	}
}
