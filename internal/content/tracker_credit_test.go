package content

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// identifiedIn adds an identified species first named in region r.
func identifiedIn(p *proto.Profile, id string, r core.RegionID, method string, habitats ...string) {
	p.Journal.Species[id] = &proto.SpeciesEntry{ID: id, Level: proto.LevelIdentified, Method: method,
		FirstRegion: int(r), Regions: []int{int(r)}, Habitats: habitats}
}

func progressOf(p *proto.Profile, quest, obj string) int { return p.Quests[quest].Progress[obj] }

// Quests whose "identify N species in region X" objectives used to count only
// identifications made after accepting: a player who named the region's birds
// first could never finish them. Accepting now credits the journal.
func TestRegionalIdentifyQuestsCreditTheJournal(t *testing.T) {
	cases := []struct {
		quest  string
		rank   int
		region core.RegionID
		ids    []string
	}{
		{"reedbed_voices", 2, core.RegionMurmurMarsh, []string{"mallard", "common_moorhen", "grey_heron"}},
		{"amber_passage", 2, core.RegionAmberwood, []string{"redwing", "brambling"}},
		{"above_the_treeline", 3, core.RegionWindpeak, []string{"northern_wheatear", "common_raven"}},
		{"the_long_view", 3, core.RegionWhisperingCoast, []string{"herring_gull", "eurasian_oystercatcher", "great_cormorant"}},
		{"white_on_white", 4, core.RegionFrostveil, []string{"snow_bunting", "rock_ptarmigan"}},
	}
	for _, c := range cases {
		tr := NewTracker()
		p := newProfile()
		p.Rank = c.rank
		// A species named elsewhere does not count.
		identifiedIn(p, "eurasian_wren", core.RegionGreenhollow, "sight")
		for _, id := range c.ids {
			identifiedIn(p, id, c.region, "sight")
		}
		mustAccept(t, tr, p, c.quest)
		if got := progressOf(p, c.quest, "species"); got != len(c.ids) {
			t.Errorf("%s: species objective %d after accepting, want %d", c.quest, got, len(c.ids))
		}
		// Re-running the reconciliation never adds again.
		tr.Reconcile(p)
		tr.Reconcile(p)
		if got := progressOf(p, c.quest, "species"); got != len(c.ids) {
			t.Errorf("%s: reconcile double counted: %d", c.quest, got)
		}
	}
}

func TestRegionalCreditAndLaterEventsDoNotDoubleCount(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	p.Rank = 2
	identifiedIn(p, "mallard", core.RegionMurmurMarsh, "sight")
	mustAccept(t, tr, p, "reedbed_voices")
	if progressOf(p, "reedbed_voices", "species") != 1 {
		t.Fatalf("progress %v", p.Quests["reedbed_voices"].Progress)
	}
	// A new identification in the marsh: the event and its journal entry are one deed.
	at := Place(core.RegionMurmurMarsh, core.HabMarsh, core.PhaseMorning)
	identifiedIn(p, "common_moorhen", core.RegionMurmurMarsh, "sight")
	tr.OnEvent(p, Identified("common_moorhen", "sight", core.Common, at))
	tr.Reconcile(p)
	if got := progressOf(p, "reedbed_voices", "species"); got != 2 {
		t.Fatalf("species objective %d, want 2", got)
	}
	// A species named at home and later recorded in the marsh counts too.
	identifiedIn(p, "grey_heron", core.RegionGreenhollow, "sight")
	p.Journal.Species["grey_heron"].Regions = append(p.Journal.Species["grey_heron"].Regions, int(core.RegionMurmurMarsh))
	tr.Reconcile(p)
	if got := progressOf(p, "reedbed_voices", "species"); got != 3 {
		t.Fatalf("species objective %d, want 3", got)
	}
}

func TestFamiliarVoiceAndCensusCreditTheJournal(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	setStatus(p, StatusTurnedIn, TutorialQuest)
	identifiedIn(p, "eurasian_wren", core.RegionGreenhollow, "sight")
	identifiedIn(p, "european_robin", core.RegionGreenhollow, "sound")
	identifiedIn(p, "song_thrush", core.RegionGreenhollow, "mixed")
	identifiedIn(p, "common_chaffinch", core.RegionGreenhollow, "sound")
	identifiedIn(p, "blue_tit", core.RegionGreenhollow, "sight")
	a := mustAccept(t, tr, p, "familiar_voice")
	if got := progressOf(p, "familiar_voice", "voices"); got != 3 {
		t.Fatalf("familiar_voice: %d by-ear identifications credited, want 3 (sound, sound, mixed)", got)
	}
	if len(a.Progress) == 0 || !a.Progress[len(a.Progress)-1].Complete || Status(p, "familiar_voice") != StatusComplete {
		t.Fatalf("familiar_voice not complete: %+v", a.Progress)
	}
	mustAccept(t, tr, p, "contract_census")
	if Status(p, "contract_census") != StatusComplete {
		t.Fatalf("census with five species in the journal: %s %v", Status(p, "contract_census"), p.Quests["contract_census"].Progress)
	}
	// A mixed identification also counts as "by sound" for a live event.
	p2 := newProfile()
	setStatus(p2, StatusTurnedIn, TutorialQuest)
	mustAccept(t, tr, p2, "familiar_voice")
	tr.OnEvent(p2, Identified("song_thrush", "mixed", core.Common, noPlace))
	if progressOf(p2, "familiar_voice", "voices") != 1 {
		t.Fatal("a mixed identification did not count as one by ear")
	}
}

func TestDiscoverCollectForageCookCreditTheJournal(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	p.Rank = 3
	p.Journal.Locations["watchtower@3,4"] = &proto.LocEntry{Kind: "watchtower", Region: int(core.RegionWindpeak)}
	p.Journal.Locations["watchtower@9,9"] = &proto.LocEntry{Kind: "watchtower", Region: int(core.RegionGreenhollow)}
	mustAccept(t, tr, p, "above_the_treeline")
	if progressOf(p, "above_the_treeline", "tower") != 1 || progressOf(p, "above_the_treeline", "view") != 0 {
		t.Fatalf("discover kind+region: %v", p.Quests["above_the_treeline"].Progress)
	}

	// Feathers already in the collection count once each, and a feather picked up
	// again does not count twice.
	setStatus(p, StatusTurnedIn, TutorialQuest)
	p.Journal.Collectibles["feather_mallard"] = 1
	p.Journal.Collectibles["feather_eurasian_jay"] = 1
	p.Journal.Collectibles["page_0"] = 1
	mustAccept(t, tr, p, "contract_feathers")
	if got := progressOf(p, "contract_feathers", "feathers"); got != 2 {
		t.Fatalf("feathers credited %d, want 2", got)
	}
	tr.OnEvent(p, Collected("feather_mallard", "feather", noPlace))
	if got := progressOf(p, "contract_feathers", "feathers"); got != 2 {
		t.Fatalf("a credited feather counted again: %d", got)
	}
	tr.OnEvent(p, Collected("feather_blue_tit", "feather", noPlace))
	if Status(p, "contract_feathers") != StatusComplete {
		t.Fatalf("third feather did not complete: %v", p.Quests["contract_feathers"].Progress)
	}

	// Plants in the herbarium and recipes already cooked.
	p.Journal.Plants = map[string]*proto.PlantEntry{
		"bramble": {ID: "bramble", Region: int(core.RegionGreenhollow), Picked: 2},
		"nettle":  {ID: "nettle", Region: int(core.RegionGreenhollow), Picked: 1},
		"hazel":   {ID: "hazel", Region: int(core.RegionAmberwood), Picked: 1},
	}
	p.XPLog = map[string]int{"cook:pine_tip_tea": 40}
	mustAccept(t, tr, p, "tea_at_the_cabin")
	if got := progressOf(p, "tea_at_the_cabin", "pick"); got != 3 {
		t.Fatalf("tea: picks %d, want 3", got)
	}
	if got := progressOf(p, "tea_at_the_cabin", "cook"); got != 1 {
		t.Fatalf("tea: cook %d, want 1 (ordered: credited once the picking is done)", got)
	}
	mustAccept(t, tr, p, "a_fair_share")
	if got := progressOf(p, "a_fair_share", "plants"); got != 2 {
		t.Fatalf("fair share: %d Greenhollow plants, want 2", got)
	}
	tr.OnEvent(p, Foraged("bramble", Place(core.RegionGreenhollow, core.HabWoodland, core.PhaseMorning)))
	if got := progressOf(p, "a_fair_share", "plants"); got != 2 {
		t.Fatalf("a credited plant counted again: %d", got)
	}
}

func TestIdentifyByRarityNeedsTheCatalog(t *testing.T) {
	q := proto.QuestDef{ID: "q", Name: "Q", Objectives: []proto.ObjectiveDef{
		o("r", KindIdentify, TargetAny, 1, "rare", "", ParamRarity, "rare"),
	}, Rewards: proto.Reward{XP: 1}}
	p := newProfile()
	identifiedIn(p, "golden_oriole", core.RegionGreenhollow, "sight")
	plain := NewTrackerFor([]proto.QuestDef{q})
	mustAccept(t, plain, p, "q")
	if Status(p, "q") == StatusComplete {
		t.Fatal("credited a rarity filter without knowing the rarity")
	}
	p2 := newProfile()
	identifiedIn(p2, "golden_oriole", core.RegionGreenhollow, "sight")
	withCat := NewTrackerFor([]proto.QuestDef{q}).WithSpecies([]core.Species{{ID: "golden_oriole", Rarity: core.Rare}})
	mustAccept(t, withCat, p2, "q")
	if Status(p2, "q") != StatusComplete {
		t.Fatal("rarity filter not credited from the journal")
	}
}

func TestReputationGatesQuests(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	setStatus(p, StatusTurnedIn, TutorialQuest)
	p.Rep[FactionOutfitters] = 39
	if _, err := tr.Accept(p, "field_test", 1); err == nil {
		t.Fatal("field_test accepted below its reputation gate")
	}
	for _, id := range tr.Available(p) {
		if id == "field_test" {
			t.Fatal("field_test listed below its gate")
		}
	}
	p.Rep[FactionOutfitters] = 40
	mustAccept(t, tr, p, "field_test")
}

func TestRankChallengesAndExpeditionAreGated(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	setStatus(p, StatusTurnedIn, TutorialQuest, "white_on_white")
	for _, c := range []struct {
		id   string
		rank int
	}{{"challenge_twenty", 3}, {"challenge_six_countries", 4}, {"challenge_master_plates", 4}, {"expedition_far_north", 5}} {
		p.Rank = c.rank - 1
		if _, err := tr.Accept(p, c.id, 1); err == nil {
			t.Errorf("%s accepted at rank %d", c.id, p.Rank)
		}
		p.Rank = c.rank
		mustAccept(t, tr, p, c.id)
	}
}
