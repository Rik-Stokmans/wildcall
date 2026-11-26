package content

import (
	"errors"
	"reflect"
	"sort"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func progressed(ps []Progress, quest, obj string) bool {
	for _, p := range ps {
		if p.Quest == quest && p.Objective == obj {
			return true
		}
	}
	return false
}

func mustAccept(t *testing.T, tr *Tracker, p *proto.Profile, id string) Accepted {
	t.Helper()
	a, err := tr.Accept(p, id, 1)
	if err != nil {
		t.Fatalf("Accept(%s): %v", id, err)
	}
	return a
}

func TestEventConstructorsUseTheVocabulary(t *testing.T) {
	at := Place(core.RegionMurmurMarsh, core.HabMarsh, core.PhaseDawn)
	events := []Event{
		Heard("mallard", false, at), Observed("mallard", "feeding", at),
		Identified("mallard", "sound", core.Common, at), Photographed("mallard", "feeding", 3, at),
		Recorded("mallard", 2, at), Discovered("hide_creek", "hide", at), Collected("page_1", "page", at),
		CacheOpened("cache_camp", at), Talked("mara"), Returned(), Researched("study", "mallard", "", 0),
		RareFound("out_of_range", "mallard", at),
	}
	seen := map[string]bool{}
	for _, e := range events {
		if !oneOf(e.Kind, ObjectiveKinds()...) {
			t.Errorf("event kind %q is not in the vocabulary", e.Kind)
		}
		seen[e.Kind] = true
	}
	for _, k := range ObjectiveKinds() {
		if !seen[k] {
			t.Errorf("no constructor produces kind %q", k)
		}
	}
	want := []string{"hear", "observe", "identify", "photo", "record", "discover", "collect", "talk", "return", "research", "rare"}
	got := ObjectiveKinds()
	sort.Strings(want)
	sort.Strings(got)
	if !reflect.DeepEqual(got, want) {
		t.Errorf("vocabulary = %v, want the pinned %v", got, want)
	}
	if at.Region != "murmur_marsh" || at.Habitat != "marsh" || at.Phase != "dawn" {
		t.Errorf("Place = %+v", at)
	}
	if p := Place(core.RegionCount, core.HabMeadow, core.PhaseNight); p.Region != "" || p.Phase != "night" {
		t.Errorf("open water place = %+v", p)
	}
}

func TestEveryQuestObjectiveKindIsPinned(t *testing.T) {
	for _, q := range Quests() {
		for _, o := range q.Objectives {
			if !oneOf(o.Kind, ObjectiveKinds()...) {
				t.Errorf("%s/%s: kind %q", q.ID, o.ID, o.Kind)
			}
		}
	}
}

func TestTutorialIsOrderedAndIgnoresOutOfOrderEvents(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	a := mustAccept(t, tr, p, TutorialQuest)
	if !reflect.DeepEqual(a.Items, []string{"basic_recorder"}) {
		t.Fatalf("accept items = %v, want the recorder", a.Items)
	}
	wren := tutorialSpecies

	// Everything but the first step is ignored at first.
	for _, ev := range []Event{
		Observed(wren, "perched", noPlace), Recorded(wren, 3, noPlace),
		Identified(wren, "sight", core.Common, noPlace), Photographed(wren, "perched", 5, noPlace),
	} {
		if ps := tr.OnEvent(p, ev); len(ps) != 0 {
			t.Fatalf("out-of-order %s event advanced the tutorial: %+v", ev.Kind, ps)
		}
	}
	// Another species' voice is not the singer.
	if ps := tr.OnEvent(p, Heard("european_robin", false, noPlace)); len(ps) != 0 {
		t.Fatalf("a robin advanced the tutorial: %+v", ps)
	}
	steps := []struct {
		obj string
		ev  Event
	}{
		{"hear", Heard(wren, false, noPlace)},
		{"investigate", Observed(wren, "perched", noPlace)},
		{"record", Recorded(wren, 1, noPlace)},
		{"identify", Identified(wren, "sound", core.Common, noPlace)},
		{"photograph", Photographed(wren, "singing", 1, noPlace)},
	}
	for i, s := range steps {
		// A later step's event must still be ignored.
		if i+1 < len(steps) {
			if ps := tr.OnEvent(p, steps[i+1].ev); len(ps) != 0 {
				t.Fatalf("step %s: next step's event advanced: %+v", s.obj, ps)
			}
		}
		cur, ok := tr.Current(p, TutorialQuest)
		if !ok || cur.ID != s.obj {
			t.Fatalf("current objective = %q, want %q", cur.ID, s.obj)
		}
		ps := tr.OnEvent(p, s.ev)
		if len(ps) != 1 || !ps[0].Done || ps[0].Objective != s.obj {
			t.Fatalf("step %s: progress = %+v", s.obj, ps)
		}
		if last := i == len(steps)-1; ps[0].Complete != last {
			t.Fatalf("step %s: Complete = %v", s.obj, ps[0].Complete)
		}
	}
	if Status(p, TutorialQuest) != StatusComplete {
		t.Fatalf("status = %s", Status(p, TutorialQuest))
	}
	if ps := tr.OnEvent(p, Heard(wren, false, noPlace)); len(ps) != 0 {
		t.Errorf("a finished quest kept advancing: %+v", ps)
	}
}

func TestTutorialRewardPaysForBinoculars(t *testing.T) {
	q, _ := QuestByID(TutorialQuest)
	if !q.Tutorial || !q.AutoStart || !q.Ordered || q.Giver != NPCMara {
		t.Fatalf("tutorial flags wrong: %+v", q)
	}
	r := q.Rewards
	if r.XP != 300 || r.SkillPoints != 1 || r.Rep[FactionResearch] == 0 {
		t.Errorf("reward = %+v", r)
	}
	if 60+r.Credits < 180 {
		t.Errorf("60 starting + %d credits cannot buy the 180-credit Explorer Binoculars", r.Credits)
	}
	if len(q.Objectives) != 5 || q.Objectives[0].Kind != KindHear || q.Objectives[1].Kind != KindObserve ||
		q.Objectives[2].Kind != KindRecord || q.Objectives[3].Kind != KindIdentify || q.Objectives[4].Kind != KindPhoto {
		t.Errorf("objectives are not hear, investigate, record, identify, photograph")
	}
	for _, o := range q.Objectives {
		if o.Target != "eurasian_wren" {
			t.Errorf("objective %s targets %q", o.ID, o.Target)
		}
	}
}

func TestTurnInPaysOnceAndOnlyWhenComplete(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	mustAccept(t, tr, p, TutorialQuest)
	if _, err := tr.TurnIn(p, TutorialQuest); !errors.Is(err, ErrNotComplete) {
		t.Fatalf("turn-in of an unfinished quest: %v", err)
	}
	for _, ev := range []Event{
		Heard(tutorialSpecies, false, noPlace), Observed(tutorialSpecies, "perched", noPlace),
		Recorded(tutorialSpecies, 2, noPlace), Identified(tutorialSpecies, "sound", core.Common, noPlace),
		Photographed(tutorialSpecies, "perched", 2, noPlace),
	} {
		tr.OnEvent(p, ev)
	}
	rw, err := tr.TurnIn(p, TutorialQuest)
	if err != nil {
		t.Fatal(err)
	}
	if rw.XP != 300 || Status(p, TutorialQuest) != StatusTurnedIn || Tracked(p) != "" {
		t.Errorf("reward %+v status %s tracked %q", rw, Status(p, TutorialQuest), Tracked(p))
	}
	rw.Items = append(rw.Items, "mutated")
	rw.Rep[FactionResearch] = 999
	if q, _ := QuestByID(TutorialQuest); q.Rewards.Rep[FactionResearch] == 999 {
		t.Error("the reward handed out aliases the catalog")
	}
	if _, err := tr.TurnIn(p, TutorialQuest); !errors.Is(err, ErrNotComplete) {
		t.Errorf("second turn-in: %v", err)
	}
	if _, err := tr.TurnIn(p, "no_such_quest"); !errors.Is(err, ErrUnknownQuest) {
		t.Errorf("unknown quest: %v", err)
	}
	if _, err := tr.Accept(p, TutorialQuest, 2); !errors.Is(err, ErrNotAvailable) {
		t.Errorf("re-accepting a finished quest: %v", err)
	}
}

func TestAcceptItemsGrantedOncePerSave(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	if a := mustAccept(t, tr, p, TutorialQuest); len(a.Items) != 1 {
		t.Fatalf("first accept items = %v", a.Items)
	}
	if err := tr.Abandon(p, TutorialQuest); err != nil {
		t.Fatal(err)
	}
	if a := mustAccept(t, tr, p, TutorialQuest); len(a.Items) != 0 {
		t.Errorf("re-accepting minted items again: %v", a.Items)
	}
	if got := AcceptItems("perfect_moment"); len(got) == 0 {
		t.Error("perfect_moment hands out no seed")
	}
}

func TestCountsAndParamFilters(t *testing.T) {
	tr := NewTracker()
	p := afterTutorial()
	mustAccept(t, tr, p, "familiar_voice") // 3 identifications by sound

	// Sight identifications do not count; sound ones do, with a running count.
	if ps := tr.OnEvent(p, Identified("blue_tit", "sight", core.Common, noPlace)); len(ps) != 0 {
		t.Fatalf("sight ID counted for a sound objective: %+v", ps)
	}
	for i, sp := range []string{"blue_tit", "great_tit"} {
		ps := tr.OnEvent(p, Identified(sp, "sound", core.Common, noPlace))
		if len(ps) != 1 || ps[0].Count != i+1 || ps[0].Need != 3 || ps[0].Done {
			t.Fatalf("progress %d = %+v", i, ps)
		}
	}
	ps := tr.OnEvent(p, Identified("common_blackbird", "sound", core.Common, noPlace))
	if len(ps) != 1 || !ps[0].Done || !ps[0].Complete {
		t.Fatalf("final progress = %+v", ps)
	}
	if got := p.Quests["familiar_voice"].Progress["voices"]; got != 3 {
		t.Errorf("stored count = %d", got)
	}
}

func TestEventAdvancesSeveralQuests(t *testing.T) {
	tr := NewTracker()
	p := afterTutorial()
	mustAccept(t, tr, p, "perfect_moment") // photo, feeding, 2 stars
	mustAccept(t, tr, p, "golden_hour")    // photo, dawn|evening, 3 stars

	// Feeding photo at midday, 2 stars: only perfect_moment.
	ps := tr.OnEvent(p, Photographed("blue_tit", "feeding", 2, At{Phase: "midday"}))
	if len(ps) != 1 || ps[0].Quest != "perfect_moment" {
		t.Fatalf("midday: %+v", ps)
	}
	// A 4-star dawn photo of a feeding bird: golden_hour (perfect_moment is done).
	ps = tr.OnEvent(p, Photographed("blue_tit", "feeding", 4, At{Phase: "dawn"}))
	if len(ps) != 1 || ps[0].Quest != "golden_hour" || !ps[0].Complete {
		t.Fatalf("dawn: %+v", ps)
	}

	// And one event that satisfies two fresh quests at once.
	p2 := afterTutorial()
	mustAccept(t, tr, p2, "perfect_moment")
	mustAccept(t, tr, p2, "golden_hour")
	ps = tr.OnEvent(p2, Photographed("great_tit", "feeding", 3, At{Phase: "evening"}))
	if !progressed(ps, "perfect_moment", "feeding") || !progressed(ps, "golden_hour", "light") {
		t.Fatalf("one photo should advance both quests: %+v", ps)
	}
}

func TestParamsRegionRarityHabitatPhase(t *testing.T) {
	cases := []struct {
		name string
		o    proto.ObjectiveDef
		ev   Event
		want bool
	}{
		{"region match", o("x", KindIdentify, TargetAny, 1, "", "", ParamRegion, "windpeak"), Identified("raven", "sight", core.Common, At{Region: "windpeak"}), true},
		{"region mismatch", o("x", KindIdentify, TargetAny, 1, "", "", ParamRegion, "windpeak"), Identified("raven", "sight", core.Common, At{Region: "frostveil"}), false},
		{"region missing", o("x", KindIdentify, TargetAny, 1, "", "", ParamRegion, "windpeak"), Identified("raven", "sight", core.Common, noPlace), false},
		{"alternatives", o("x", KindPhoto, TargetAny, 1, "", "", ParamBehavior, "flying|soaring"), Photographed("a", "soaring", 1, noPlace), true},
		{"alternatives miss", o("x", KindPhoto, TargetAny, 1, "", "", ParamBehavior, "flying|soaring"), Photographed("a", "perched", 1, noPlace), false},
		{"rarity", o("x", KindIdentify, TargetAny, 1, "", "", ParamRarity, "rare"), Identified("a", "sight", core.Rare, noPlace), true},
		{"rarity miss", o("x", KindIdentify, TargetAny, 1, "", "", ParamRarity, "rare"), Identified("a", "sight", core.Uncommon, noPlace), false},
		{"habitat", o("x", KindObserve, TargetAny, 1, "", "", ParamHabitat, "marsh"), Observed("a", "wading", At{Habitat: "marsh"}), true},
		{"stars exact", o("x", KindRecord, TargetAny, 1, "", "", ParamMinStars, "3"), Recorded("a", 3, noPlace), true},
		{"stars low", o("x", KindRecord, TargetAny, 1, "", "", ParamMinStars, "3"), Recorded("a", 2, noPlace), false},
		{"species target", o("x", KindHear, "tawny_owl", 1, "", ""), Heard("tawny_owl", false, noPlace), true},
		{"species other", o("x", KindHear, "tawny_owl", 1, "", ""), Heard("snowy_owl", false, noPlace), false},
		{"unknown voice", o("x", KindHear, TargetUnknown, 1, "", ""), Heard("tawny_owl", false, noPlace), true},
		{"known voice is not unknown", o("x", KindHear, TargetUnknown, 1, "", ""), Heard("tawny_owl", true, noPlace), false},
		{"kind target", o("x", KindDiscover, TargetKind+"hide", 1, "", ""), Discovered("hide@3,4", "hide", noPlace), true},
		{"kind target miss", o("x", KindDiscover, TargetKind+"hide", 1, "", ""), Discovered("camp@3,4", "camp", noPlace), false},
		{"kind plus region", o("x", KindDiscover, TargetKind+"watchtower", 1, "", "", ParamRegion, "windpeak"), Discovered("watchtower@1,1", "watchtower", At{Region: "windpeak"}), true},
		{"cache by kind", o("x", KindCollect, TargetKind+"cache", 1, "", ""), CacheOpened("cache@1,1", noPlace), true},
		{"feather by kind", o("x", KindCollect, TargetKind+"feather", 1, "", ""), Collected("feather_mallard", "feather", noPlace), true},
		{"kind never matches page", o("x", KindCollect, TargetKind+"feather", 1, "", ""), Collected("page_2", "page", noPlace), false},
		{"wrong kind of event", o("x", KindHear, TargetAny, 1, "", ""), Identified("a", "sight", core.Common, noPlace), false},
		{"research target", o("x", KindResearch, "submit", 1, "", "", ParamWhat, "photo"), Researched("submit", "a", "photo", 3), true},
		{"research what miss", o("x", KindResearch, "submit", 1, "", "", ParamWhat, "photo"), Researched("submit", "a", "recording", 3), false},
		{"talk", o("x", KindTalk, "alder", 1, "", ""), Talked("alder"), true},
		{"return", o("x", KindReturn, "", 1, "", ""), Returned(), true},
		{"rare kind", o("x", KindRare, "out_of_range", 1, "", ""), RareFound("out_of_range", "a", noPlace), true},
		{"rare kind miss", o("x", KindRare, "out_of_range", 1, "", ""), RareFound("behavior", "a", noPlace), false},
	}
	for _, c := range cases {
		if got := matches(&c.o, c.ev); got != c.want {
			t.Errorf("%s: matches = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestDistinctCountsEachTargetOnce(t *testing.T) {
	tr := NewTracker()
	p := afterTutorial()
	setStatus(p, StatusTurnedIn, "quiet_creek")
	mustAccept(t, tr, p, "dawn_count") // ordered: six distinct voices at dawn, then return
	dawn := At{Phase: "dawn"}

	if ps := tr.OnEvent(p, Returned()); len(ps) != 0 {
		t.Fatalf("return before the count advanced: %+v", ps)
	}
	if ps := tr.OnEvent(p, Heard("blue_tit", false, At{Phase: "midday"})); len(ps) != 0 {
		t.Fatalf("a midday voice counted at dawn: %+v", ps)
	}
	for i := 0; i < 3; i++ {
		tr.OnEvent(p, Heard("blue_tit", false, dawn))
	}
	if got := p.Quests["dawn_count"].Progress["voices"]; got != 1 {
		t.Fatalf("the same species counted %d times", got)
	}
	for _, sp := range []string{"great_tit", "european_robin", "song_thrush", "goldcrest"} {
		tr.OnEvent(p, Heard(sp, true, dawn)) // known or not, a voice counts
	}
	if got := p.Quests["dawn_count"].Progress["voices"]; got != 5 {
		t.Fatalf("count = %d, want 5", got)
	}
	ps := tr.OnEvent(p, Heard("common_chaffinch", false, dawn))
	if len(ps) != 1 || !ps[0].Done || ps[0].Complete {
		t.Fatalf("sixth voice: %+v", ps)
	}
	ps = tr.OnEvent(p, Returned())
	if len(ps) != 1 || !ps[0].Complete {
		t.Fatalf("return: %+v", ps)
	}
	// The save must not leak which species were heard: only hashed keys are stored.
	for k := range p.Quests["dawn_count"].Progress {
		if k != "voices" && k != "report" && len(k) > 0 {
			for _, sp := range pinnedSpecies {
				if len(k) >= len(sp) && k[len(k)-len(sp):] == sp {
					t.Errorf("progress key %q leaks a species id", k)
				}
			}
		}
	}
}

func TestAvailabilityHonoursRequiresRankAndHidden(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	avail := func() map[string]bool {
		m := map[string]bool{}
		for _, id := range tr.Available(p) {
			m[id] = true
		}
		return m
	}
	a := avail()
	for _, id := range []string{TutorialQuest, "perfect_moment", "old_watchtower", "quiet_creek"} {
		if !a[id] {
			t.Errorf("%s should be available from the start", id)
		}
	}
	for _, id := range []string{"familiar_voice", "golden_hour", "contract_census", "contract_drummer"} {
		if a[id] {
			t.Errorf("%s needs the tutorial first", id)
		}
	}
	for _, id := range []string{"harrows_survey", "golden_flute", "reedbed_voices", "above_the_trees"} {
		if a[id] {
			t.Errorf("%s must not be available yet", id)
		}
	}

	setStatus(p, StatusTurnedIn, TutorialQuest)
	a = avail()
	for _, id := range []string{"familiar_voice", "golden_hour", "contract_census", "contract_drummer", "contract_night_shift", "contract_feathers"} {
		if !a[id] {
			t.Errorf("%s should open after the tutorial", id)
		}
	}
	// Rank gates.
	for _, id := range []string{"reedbed_voices", "amber_passage", "visitor_from_afar", "contract_plates", "contract_behaviour"} {
		if a[id] {
			t.Errorf("%s needs rank 2", id)
		}
	}
	p.Rank = 2
	a = avail()
	for _, id := range []string{"reedbed_voices", "amber_passage", "visitor_from_afar", "contract_plates", "contract_behaviour"} {
		if !a[id] {
			t.Errorf("%s should be available at rank 2", id)
		}
	}
	for _, id := range []string{"above_the_treeline", "the_long_view", "white_on_white", "booming_dusk"} {
		if a[id] {
			t.Errorf("%s must wait (rank or requirement)", id)
		}
	}
	p.Rank = 3
	if !avail()["above_the_treeline"] || !avail()["the_long_view"] || avail()["white_on_white"] {
		t.Errorf("rank 3 gates wrong: %v", avail())
	}
	p.Rank = 4
	if !avail()["white_on_white"] {
		t.Error("white_on_white should open at rank 4")
	}
	// Requires: booming_dusk needs reedbed_voices turned in.
	setStatus(p, StatusTurnedIn, "reedbed_voices")
	if !avail()["booming_dusk"] {
		t.Error("booming_dusk should follow reedbed_voices")
	}
	// A started quest is not available again.
	setStatus(p, StatusActive, "old_watchtower")
	if avail()["old_watchtower"] {
		t.Error("an active quest is listed as available")
	}
	// Hidden quests need the reveal flag AND their requirements.
	if avail()["harrows_survey"] {
		t.Error("harrows_survey is hidden")
	}
	Reveal(p, "harrows_survey")
	if avail()["harrows_survey"] {
		t.Error("harrows_survey still needs old_watchtower turned in")
	}
	setStatus(p, StatusTurnedIn, "old_watchtower")
	if !avail()["harrows_survey"] {
		t.Error("harrows_survey should be available once revealed and unlocked")
	}
	if _, err := tr.Accept(newProfile(), "harrows_survey", 1); !errors.Is(err, ErrNotAvailable) {
		t.Errorf("accepting a hidden quest: %v", err)
	}
}

func TestWatchtowerQuestUnlocksTheHiddenResearchQuest(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	mustAccept(t, tr, p, "old_watchtower")
	for _, ev := range []Event{
		Collected("page_0", "page", noPlace), // unordered: any order is fine
		Discovered("old_watchtower", "watchtower", noPlace),
		CacheOpened("cache_watchtower", noPlace),
	} {
		tr.OnEvent(p, ev)
	}
	if Status(p, "old_watchtower") != StatusComplete {
		t.Fatalf("status %s", Status(p, "old_watchtower"))
	}
	if _, err := tr.TurnIn(p, "old_watchtower"); err != nil {
		t.Fatal(err)
	}
	if !oneOf("secret_lookout", p.Trails...) {
		t.Errorf("the map-expansion reward did not reveal the trail: %v", p.Trails)
	}
	hidden := false
	for _, id := range tr.Available(p) {
		hidden = hidden || id == "harrows_survey"
	}
	if !hidden {
		t.Fatal("the hidden research quest did not appear")
	}
	if q, _ := QuestByID("harrows_survey"); !q.Hidden || q.Giver != NPCAlder || q.Category != CatResearch {
		t.Errorf("harrows_survey = %+v", q)
	}
}

func TestAcceptSettlesWhatIsAlreadyDone(t *testing.T) {
	tr := NewTracker()
	p := newProfile()
	p.Journal.Locations["old_watchtower"] = &proto.LocEntry{Name: "Old Watchtower"}
	p.Journal.Collectibles["page_0"] = 2
	p.Flags["taken:cache_watchtower"] = true
	a := mustAccept(t, tr, p, "old_watchtower")
	if len(a.Progress) != 3 || !a.Progress[2].Complete {
		t.Fatalf("progress = %+v", a.Progress)
	}
	if Status(p, "old_watchtower") != StatusComplete {
		t.Errorf("status = %s", Status(p, "old_watchtower"))
	}

	// An ordered quest only settles from the front, so the order still holds.
	p2 := newProfile()
	speciesEntry(p2, tutorialSpecies, proto.LevelIdentified, "sight")
	mustAccept(t, NewTracker(), p2, TutorialQuest)
	if cur, _ := tr.Current(p2, TutorialQuest); cur.ID != "hear" {
		t.Errorf("an already identified wren skipped the hear step: current %q", cur.ID)
	}
}

func TestTrackUntrackAbandonSync(t *testing.T) {
	tr := NewTracker()
	p := afterTutorial()
	added := tr.Sync(p)
	if len(added) == 0 || Status(p, "perfect_moment") != StatusAvailable {
		t.Fatalf("Sync added %v", added)
	}
	if again := tr.Sync(p); len(again) != 0 {
		t.Errorf("second Sync added %v", again)
	}
	mustAccept(t, tr, p, "perfect_moment")
	if Tracked(p) != "perfect_moment" {
		t.Errorf("the first accepted quest should be tracked, got %q", Tracked(p))
	}
	mustAccept(t, tr, p, "golden_hour")
	if Tracked(p) != "perfect_moment" {
		t.Errorf("accepting another quest stole the tracker: %q", Tracked(p))
	}
	if err := tr.Track(p, "golden_hour"); err != nil || Tracked(p) != "golden_hour" || p.Quests["perfect_moment"].Tracked {
		t.Errorf("Track: %v tracked=%q", err, Tracked(p))
	}
	if err := tr.Untrack(p, "golden_hour"); err != nil || Tracked(p) != "" {
		t.Errorf("Untrack: %v tracked=%q", err, Tracked(p))
	}
	if err := tr.Track(p, "quiet_creek"); !errors.Is(err, ErrNotActive) {
		t.Errorf("tracking an unaccepted quest: %v", err)
	}
	tr.OnEvent(p, Photographed("a", "feeding", 3, At{Phase: "dawn"}))
	if err := tr.Abandon(p, "perfect_moment"); err != nil {
		t.Fatal(err)
	}
	if st := p.Quests["perfect_moment"]; st.Status != StatusAvailable || len(st.Progress) != 0 {
		t.Errorf("abandoned state = %+v", st)
	}
	if got := tr.Available(p); !oneOf("perfect_moment", got...) {
		t.Error("an abandoned quest should be available again")
	}
	if err := tr.Abandon(p, "perfect_moment"); !errors.Is(err, ErrNotActive) {
		t.Errorf("abandoning twice: %v", err)
	}
	setStatus(p, StatusTurnedIn, "quiet_creek")
	if err := tr.Abandon(p, "quiet_creek"); !errors.Is(err, ErrNotActive) {
		t.Errorf("a handed-in quest can be abandoned: %v", err)
	}
	if err := tr.Track(p, "nope"); !errors.Is(err, ErrUnknownQuest) {
		t.Errorf("unknown quest: %v", err)
	}
}

func TestOnEventToleratesNilAndEmpty(t *testing.T) {
	tr := NewTracker()
	if tr.OnEvent(nil, Returned()) != nil || tr.OnEvent(newProfile(), Returned()) != nil {
		t.Error("expected nil progress")
	}
	if tr.Available(nil) != nil {
		t.Error("Available(nil)")
	}
}

func TestRegionQuestEventsNeedTheRegion(t *testing.T) {
	tr := NewTracker()
	p := afterTutorial()
	mustAccept(t, tr, p, "reedbed_voices")
	marsh := At{Region: "murmur_marsh", Habitat: "marsh"}
	if ps := tr.OnEvent(p, Discovered("hide@2,2", "hide", At{Region: "greenhollow"})); len(ps) != 0 {
		t.Fatalf("a Greenhollow hide counted for the marsh: %+v", ps)
	}
	if ps := tr.OnEvent(p, Discovered("hide@5,-3", "hide", marsh)); len(ps) != 1 {
		t.Fatalf("marsh hide: %+v", ps)
	}
	if ps := tr.OnEvent(p, Recorded("mallard", 1, marsh)); len(ps) != 0 {
		t.Fatalf("one-star recording counted: %+v", ps)
	}
	tr.OnEvent(p, Recorded("mallard", 2, marsh))
	for _, sp := range []string{"mallard", "common_moorhen", "grey_heron"} {
		tr.OnEvent(p, Identified(sp, "sight", core.Common, marsh))
	}
	if Status(p, "reedbed_voices") != StatusComplete {
		t.Errorf("status %s, progress %v", Status(p, "reedbed_voices"), p.Quests["reedbed_voices"].Progress)
	}
}
