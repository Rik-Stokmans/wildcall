package game

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func ledgerSum(p *proto.Profile) int {
	n := 0
	for _, e := range p.Ledger {
		n += e.Amount
	}
	return n
}

// The ledger books every credit movement with a reason and adds up to the balance.
func TestCreditLedger(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	if len(s.p.Ledger) != 1 || s.p.Ledger[0].Amount != progress.StartingCredits || ledgerSum(s.p) != s.p.Credits {
		t.Fatalf("new game ledger: %+v (credits %d)", s.p.Ledger, s.p.Credits)
	}
	// A purchase.
	s.p.Credits += 500
	h.standNear("npc_finn", 2)
	h.send(proto.CBuy, proto.ItemAction{Item: "explorer_binoculars"})
	last := s.p.Ledger[len(s.p.Ledger)-1]
	if last.Amount >= 0 || !strings.Contains(last.Reason, "Explorer Binoculars") {
		t.Fatalf("purchase not booked: %+v", s.p.Ledger)
	}
	if ledgerSum(s.p) != s.p.Credits {
		t.Fatalf("ledger %d != balance %d: %+v", ledgerSum(s.p), s.p.Credits, s.p.Ledger)
	}
	// Buying gear earns a little standing with the outfitters, once per item.
	rep := s.p.Rep[content.FactionOutfitters]
	if rep != repBuyGear {
		t.Fatalf("outfitters rep after buying gear: %d", rep)
	}
	// A quest turn-in, booked as such.
	s.p.Quests["perfect_moment"] = &proto.QuestState{Status: content.StatusComplete, Progress: map[string]int{}}
	h.take()
	if _, err := s.turnIn("perfect_moment"); err != nil {
		t.Fatal(err)
	}
	s.afterChange()
	last = s.p.Ledger[len(s.p.Ledger)-1]
	if last.Amount <= 0 || last.Reason != "Quest: A Perfect Moment" || ledgerSum(s.p) != s.p.Credits {
		t.Fatalf("turn-in booking: %+v", s.p.Ledger)
	}
	// The cap.
	for i := 0; i < 60; i++ {
		s.p.Credits++
		s.afterChange()
	}
	if len(s.p.Ledger) != progress.LedgerCap {
		t.Fatalf("ledger length %d", len(s.p.Ledger))
	}
}

// A Perfect Moment fits a camera upgrade, shown on the Rewards screen.
func TestPerfectMomentFitsACameraUpgrade(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	s.p.Quests["perfect_moment"] = &proto.QuestState{Status: content.StatusComplete, Progress: map[string]int{}}
	r, err := s.turnIn("perfect_moment")
	if err != nil {
		t.Fatal(err)
	}
	if !containsStr(s.p.Upgrades["starter_camera"], "starter_camera_lens") {
		t.Fatalf("upgrade not fitted: %v", s.p.Upgrades)
	}
	found := false
	for _, l := range r.Journal {
		found = found || strings.Contains(l, "Sharper Kit Lens")
	}
	if !found {
		t.Fatalf("rewards screen does not show the upgrade: %v", r.Journal)
	}
}

// Owning Edith Harrow's binoculars unlocks her lore and reveals the hidden quest.
func TestHistoricalBinocularsStory(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	if content.Status(s.p, content.HarrowGlassQuest) != "" {
		t.Fatal("the hidden quest is listed before the binoculars are found")
	}
	s.giveItems([]string{"historical_binoculars"}, true)
	s.p.Rank = 2
	s.p.Quests[content.TutorialQuest] = &proto.QuestState{Status: content.StatusTurnedIn, Progress: map[string]int{}}
	s.afterChange()
	if !containsStr(s.p.Journal.Lore, content.HarrowGlassLore) {
		t.Fatal("no lore entry about the previous owner")
	}
	if content.Status(s.p, content.HarrowGlassQuest) != content.StatusAvailable {
		t.Fatalf("hidden quest status %q", content.Status(s.p, content.HarrowGlassQuest))
	}
}

func TestMarginNotesInWelcome(t *testing.T) {
	h := newHarness(t, false)
	var w proto.Welcome
	for _, m := range h.all {
		if m.T == proto.SWelcome {
			if err := json.Unmarshal(m.D, &w); err != nil {
				t.Fatal(err)
			}
		}
	}
	if len(w.MarginNotes) != len(h.s.species) {
		t.Fatalf("welcome carries %d margin notes for %d species", len(w.MarginNotes), len(h.s.species))
	}
}

// The Explorer's Lens: a feather of an unknown species adds true evidence to its
// mystery without naming it; a feather of a known species adds study progress.
func TestExplorersLensFeathers(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	sp := s.spByID("eurasian_jay")
	poi := core.POI{ID: "feather@1,2", Kind: "feather", Pos: s.feet}
	if l := s.lensFeather(sp, poi); l != "" {
		t.Fatalf("no lens, yet: %q", l)
	}
	s.p.Stats.LensInspect = 1
	l := s.lensFeather(sp, poi)
	m := s.mysteryOf(sp.ID)
	if m == nil || len(m.Evidence) == 0 || l == "" {
		t.Fatalf("lens: %q, mystery %+v", l, m)
	}
	for k, v := range m.Evidence {
		if sp.TraitValue(k) != v {
			t.Fatalf("lens evidence %s=%q is not true (%q)", k, v, sp.TraitValue(k))
		}
	}
	low := strings.ToLower(l)
	if strings.Contains(low, "jay") || strings.Contains(low, sp.ID) {
		t.Fatalf("lens line names the bird: %q", l)
	}
	// Identified: study progress.
	s.p.Journal.Species["european_robin"] = &proto.SpeciesEntry{ID: "european_robin", Level: proto.LevelIdentified}
	s.lensFeather(s.spByID("european_robin"), poi)
	if st := s.p.Journal.Species["european_robin"].Study; st != lensStudy {
		t.Fatalf("study %d", st)
	}
}

func TestExplorersLensNests(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	s.p.Stats.LensInspect = 1
	sp := s.spByID("song_thrush")
	l := s.lensNest(sp, core.Nest{ID: 7, Species: sp.Index, Pos: s.feet})
	m := s.mysteryOf(sp.ID)
	if l == "" || m == nil || m.Evidence["size"] != sp.Traits.Size || m.Evidence["shape"] != sp.Traits.Shape {
		t.Fatalf("nest lens: %q %+v", l, m)
	}
	if strings.Contains(strings.ToLower(l), "thrush") && !strings.Contains(sp.Traits.Shape, "thrush") {
		t.Fatalf("nest lens names the bird: %q", l)
	}
}

// A submitted piece is paid once per species: not again under the species id after
// identification.
func TestSubmissionsPayOncePerSpecies(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	sp := s.spByID("european_robin")
	m := s.ensureMystery(sp, proto.LevelEncountered, s.feet)
	s.p.Journal.Photos = append(s.p.Journal.Photos,
		&proto.PhotoMeta{ID: "p1", Stars: 3, Subjects: []proto.PhotoSubject{{Mystery: m.ID}}},
		&proto.PhotoMeta{ID: "p2", Stars: 3, Subjects: []proto.PhotoSubject{{Species: sp.ID}}})
	c0 := s.p.Credits
	if err := s.submit("p1"); err != nil {
		t.Fatal(err)
	}
	paid := s.p.Credits - c0
	if paid <= 0 {
		t.Fatal("first submission paid nothing")
	}
	s.p.Journal.Species[sp.ID] = &proto.SpeciesEntry{ID: sp.ID, Level: proto.LevelIdentified}
	c1 := s.p.Credits
	if err := s.submit("p2"); err != nil {
		t.Fatal(err)
	}
	if s.p.Credits != c1 {
		t.Fatalf("paid again under the species id: +%d", s.p.Credits-c1)
	}
}

func TestModestFindsDiminishAndAreCapped(t *testing.T) {
	if modestCredits(40, 0, 0) != 40 {
		t.Fatal("first modest find not paid in full")
	}
	prev := 1 << 30
	for n := 0; n < 30; n++ {
		c := modestCredits(40, n, 0)
		if c > prev || c < modestFloor {
			t.Fatalf("find %d pays %d (prev %d)", n, c, prev)
		}
		prev = c
	}
	if modestCredits(40, 0, modestDailyCap-10) != 10 || modestCredits(40, 0, modestDailyCap) != 0 {
		t.Fatal("daily cap not applied")
	}
	h := newHarness(t, false)
	s := h.s
	total := 0
	for i := 0; i < 20; i++ {
		total += s.payModestFind(40, "test")
	}
	if total > modestDailyCap*2 { // CreditMult may be above 1 at most modestly
		t.Fatalf("modest finds paid %d in a day", total)
	}
	if ledgerSum(s.p) != s.p.Credits {
		t.Fatal("modest finds not in the ledger")
	}
}

func TestFirstRecordingNeedsMinimalQuality(t *testing.T) {
	st := core.BaseStats()
	if firstRecordingCounts(proto.RecMeta{Stars: 1, Dist: 80}, st) {
		t.Fatal("a faint, far one-star take counts as a first recording")
	}
	if !firstRecordingCounts(proto.RecMeta{Stars: 1, Dist: 20}, st) || !firstRecordingCounts(proto.RecMeta{Stars: 2, Dist: 80}, st) {
		t.Fatal("a reasonable take does not count")
	}
}

func TestDeedReputationPaysOnceAndIsCapped(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	r0 := s.p.Rep[content.FactionRangers]
	s.deedRep(content.FactionRangers, "place", "x", 1, "test")
	s.deedRep(content.FactionRangers, "place", "x", 1, "test")
	if s.p.Rep[content.FactionRangers] != r0+1 {
		t.Fatal("a deed paid twice")
	}
	for i := 0; i < 200; i++ {
		s.deedRep(content.FactionRangers, "place", "p"+itoa(i), 1, "test")
	}
	if got := s.p.Rep[content.FactionRangers] - r0; got != repCaps["place"] {
		t.Fatalf("place reputation %d, cap %d", got, repCaps["place"])
	}
}

func TestObserverMoveFollowsThePose(t *testing.T) {
	if moveMode(proto.Pose{Move: "sprint", Speed: 2}) != "sprint" || moveMode(proto.Pose{Sit: true, Move: "walk"}) != "still" || moveMode(proto.Pose{Move: "zoom"}) != "" {
		t.Fatal("moveMode")
	}
	h := newHarness(t, false)
	p := standPose(h.s.feet, 0)
	p.Move, p.Speed = "sprint", 2.5
	h.send(proto.CPose, p)
	if o := h.s.observer(); o.Move != "sprint" {
		t.Fatalf("observer move %q", o.Move)
	}
}

// Loading a save credits active quests with what the journal already proves.
func TestLoadReconcilesQuests(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	s.p.Rank = 2
	s.p.Quests["reedbed_voices"] = &proto.QuestState{Status: content.StatusActive, Progress: map[string]int{}}
	for _, id := range []string{"mallard", "common_moorhen"} {
		s.p.Journal.Species[id] = &proto.SpeciesEntry{ID: id, Level: proto.LevelIdentified, Method: "sight",
			FirstRegion: int(core.RegionMurmurMarsh), Regions: []int{int(core.RegionMurmurMarsh)}}
	}
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	s2 := newSession(t, h.dir, testSeedText, false)
	if got := s2.Profile().Quests["reedbed_voices"].Progress["species"]; got != 2 {
		t.Fatalf("after load: %d", got)
	}
}

func TestMigrantArrivalIsARareDiscoveryOnce(t *testing.T) {
	h := newHarness(t, false)
	s := h.s
	h.stand(h.ground(s.feet.X, s.feet.Z), 0)
	eye := s.eye()
	bc := s.spByID("eurasian_blackcap") // a summer migrant, present in spring
	robin := s.spByID("european_robin") // resident: never a migration
	s.onArrival(core.EcoEvent{Kind: core.EvArrive, Species: robin.Index, Pos: eye}, eye)
	s.onArrival(core.EcoEvent{Kind: core.EvArrive, Species: bc.Index, Pos: eye.Add(core.V(500, 0, 0))}, eye)
	if len(s.p.Journal.Rare) != 0 {
		t.Fatalf("resident or far arrival logged: %+v", s.p.Journal.Rare[0])
	}
	s.onArrival(core.EcoEvent{Kind: core.EvArrive, Species: bc.Index, Pos: eye.Add(core.V(30, 0, 0))}, eye)
	if len(s.p.Journal.Rare) != 0 {
		t.Fatal("an arrival in the adventure's first season was logged")
	}
	s.clock.Set(9, 17) // spring of the second year
	s.onArrival(core.EcoEvent{Kind: core.EvArrive, Species: bc.Index, Pos: eye.Add(core.V(30, 0, 0))}, eye)
	s.onArrival(core.EcoEvent{Kind: core.EvArrive, Species: bc.Index, Pos: eye.Add(core.V(20, 0, 0))}, eye)
	if len(s.p.Journal.Rare) != 1 || s.p.Journal.Rare[0].Kind != RareKindMigration {
		t.Fatalf("migration: %+v", s.p.Journal.Rare)
	}
	if v := s.clientView(); v.Journal.Rare[0].Species != "" || strings.Contains(strings.ToLower(v.Journal.Rare[0].Text), "blackcap") {
		t.Fatalf("migration leaks the unidentified species: %+v", v.Journal.Rare[0])
	}
}

func TestMixedFlockIsAnEpicDiscovery(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	if _, err := s.Debug("season", "autumn"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Debug("time", "9"); err != nil {
		t.Fatal(err)
	}
	h.standNear("old_oak", 20)
	var f uint32
	var members []core.BirdState
	for i := 0; i < 4000 && f == 0; i++ {
		h.tick(1)
		if i%20 != 0 {
			continue
		}
		for _, b := range s.sim.Near(s.eye(), 900, nil) {
			if id := s.sim.MixedFlock(b.ID); id != 0 {
				f = id
			}
		}
	}
	if f == 0 {
		t.Skip("no mixed flock formed within the test window")
	}
	seen := map[int]bool{}
	for _, b := range s.sim.Near(s.eye(), 2000, nil) {
		if s.sim.MixedFlock(b.ID) == f && !seen[b.Species] {
			seen[b.Species] = true
			members = append(members, b)
		}
	}
	if len(members) < 3 {
		t.Fatalf("mixed flock with %d species", len(members))
	}
	rare0 := len(s.p.Journal.Rare)
	s.noteMixedFlock(members[0], s.spAt(members[0].Species))
	s.noteMixedFlock(members[1], s.spAt(members[1].Species))
	if len(s.p.Journal.Rare) != rare0 {
		t.Fatal("logged after two species")
	}
	s.noteMixedFlock(members[2], s.spAt(members[2].Species))
	if len(s.p.Journal.Rare) != rare0+1 {
		t.Fatal("three species of a mixed flock not logged")
	}
	if rd := s.p.Journal.Rare[len(s.p.Journal.Rare)-1]; rd.Kind != RareKindMixedFlock || rd.Rarity != 3 {
		t.Fatalf("discovery %+v", rd)
	}
}
