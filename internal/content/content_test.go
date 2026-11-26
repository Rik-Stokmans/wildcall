package content

import (
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func TestValidateAgainstPinnedCatalogs(t *testing.T) {
	for _, err := range Validate(pinnedSpecies, pinnedItems, pinnedPOIs, pinnedSkills) {
		t.Error(err)
	}
}

func TestValidateCatchesBrokenReferences(t *testing.T) {
	// Drop a species, an item and a POI the content relies on: every one must be reported.
	drop := func(list []string, id string) []string {
		var out []string
		for _, s := range list {
			if s != id {
				out = append(out, s)
			}
		}
		return out
	}
	errs := Validate(drop(pinnedSpecies, "eurasian_wren"), drop(pinnedItems, "basic_recorder"), drop(pinnedPOIs, "old_watchtower"), pinnedSkills)
	joined := ""
	for _, e := range errs {
		joined += e.Error() + "\n"
	}
	for _, want := range []string{"eurasian_wren", "basic_recorder", "old_watchtower"} {
		if !strings.Contains(joined, want) {
			t.Errorf("Validate did not report the missing %q:\n%s", want, joined)
		}
	}
}

func TestRegions(t *testing.T) {
	rs := Regions()
	if len(rs) != 6 {
		t.Fatalf("%d regions", len(rs))
	}
	gate := map[string]int{"greenhollow": 1, "murmur_marsh": 2, "amberwood": 2, "windpeak": 3, "whispering_coast": 3, "frostveil": 4}
	for i, r := range rs {
		if r.ID != i || r.Name != core.RegionID(i).Name() {
			t.Errorf("region %d = %+v", i, r)
		}
		if want, ok := gate[r.Key]; !ok || r.ReqRank != want {
			t.Errorf("%s: ReqRank %d, want %d", r.Key, r.ReqRank, want)
		}
		if len(r.Habitats) < 3 || len(r.Emphasis) < 3 || r.Tagline == "" || len(r.Desc) < 80 {
			t.Errorf("%s: thin text", r.Key)
		}
	}
	if got := UnlockedRegions(1); len(got) != 1 || got[0] != int(core.RegionGreenhollow) {
		t.Errorf("rank 1 unlocks %v", got)
	}
	if got := UnlockedRegions(2); len(got) != 3 {
		t.Errorf("rank 2 unlocks %v", got)
	}
	if got := UnlockedRegions(4); len(got) != 6 {
		t.Errorf("rank 4 unlocks %v", got)
	}
	if RegionLockReason(core.RegionFrostveil, 3) == "" || RegionLockReason(core.RegionFrostveil, 4) != "" {
		t.Error("lock reason mismatch")
	}
	if RegionLockReason(core.RegionCount, 1) != "" {
		t.Error("open water must never be locked")
	}
	for r := core.RegionID(0); r < core.RegionCount; r++ {
		if len(RegionHints(r)) == 0 {
			t.Errorf("%s has no hints", r.Key())
		}
	}
}

func TestNPCs(t *testing.T) {
	want := map[string][3]string{
		"mara":  {"Veteran Naturalist", "naturalists", "npc_mara"},
		"finn":  {"Equipment Specialist", "outfitters", "npc_finn"},
		"alder": {"Researcher", "research", "npc_alder"},
		"june":  {"Park Ranger", "rangers", "npc_june"},
	}
	looks := map[proto.NPCLook]bool{}
	for _, n := range NPCs() {
		w, ok := want[n.ID]
		if !ok || n.Role != w[0] || n.Faction != w[1] || n.POI != w[2] {
			t.Errorf("npc %+v", n)
		}
		if len(n.Bio) < 60 || n.Look.Coat == "" || n.Look.Height <= 0 {
			t.Errorf("%s: thin definition", n.ID)
		}
		looks[n.Look] = true
		delete(want, n.ID)
	}
	if len(want) != 0 || len(looks) != 4 {
		t.Errorf("missing npcs %v, distinct looks %d", want, len(looks))
	}
}

func TestQuestCatalog(t *testing.T) {
	qs := Quests()
	if len(qs) < 14 {
		t.Fatalf("only %d quests", len(qs))
	}
	cats := map[string]int{}
	board, june := 0, 0
	for _, q := range qs {
		cats[q.Category]++
		if q.Giver == BoardGiver {
			board++
		}
		if q.Giver == NPCJune && q.Category == CatConservation {
			june++
		}
		for _, o := range q.Objectives {
			if o.Hint == "" && o.Kind != KindTalk {
				t.Errorf("%s/%s has no gentle hint", q.ID, o.ID)
			}
		}
	}
	for _, c := range QuestCategories() {
		if cats[c] == 0 {
			t.Errorf("no %s quest", c)
		}
	}
	if board < 4 || june < 2 {
		t.Errorf("board contracts %d, June conservation quests %d", board, june)
	}
	for _, id := range []string{"unseen_singer", "perfect_moment", "old_watchtower", "familiar_voice", "visitor_from_afar"} {
		if _, ok := QuestByID(id); !ok {
			t.Errorf("pinned quest %s missing", id)
		}
	}
	if q, _ := QuestByID("visitor_from_afar"); q.Objectives[0].Kind != KindRare || q.Objectives[0].Target != "out_of_range" {
		t.Errorf("visitor_from_afar = %+v", q.Objectives)
	}
	if q, _ := QuestByID("old_watchtower"); len(q.Objectives) != 3 || q.Objectives[0].Target != "old_watchtower" ||
		q.Objectives[1].Target != "page_0" || q.Objectives[2].Target != "cache_watchtower" {
		t.Errorf("old_watchtower objectives = %+v", q.Objectives)
	}
	// One quest per outer region type that motivates its unlock.
	motivated := map[string]bool{}
	for _, q := range qs {
		for _, o := range q.Objectives {
			if r := o.Params[ParamRegion]; r != "" && r != "greenhollow" {
				motivated[r] = true
			}
		}
	}
	for _, r := range []string{"murmur_marsh", "windpeak", "whispering_coast", "amberwood", "frostveil"} {
		if !motivated[r] {
			t.Errorf("no quest sends the player to %s", r)
		}
	}
	// A fresh slice each call, so callers cannot corrupt the catalog.
	qs[0].Name = "changed"
	if Quests()[0].Name == "changed" {
		t.Error("Quests() shares state between calls")
	}
}

// A quest may name a species only by its voice or habits: the player has to earn the
// name. Species ids are fine (they are data); species display names in player-facing
// text are not, except in text that is only shown after the quest is done.
func TestQuestTextNeverNamesASpeciesTheQuestIsAbout(t *testing.T) {
	names := map[string]string{
		"eurasian_wren": "wren", "tawny_owl": "tawny", "golden_oriole": "oriole", "eurasian_bittern": "bittern",
		"song_thrush": "thrush", "eurasian_treecreeper": "treecreeper", "grey_wagtail": "wagtail",
		"great_spotted_woodpecker": "great spotted",
	}
	for _, q := range Quests() {
		texts := []string{q.Name, q.Summary, q.Story}
		for _, o := range q.Objectives {
			texts = append(texts, o.Text, o.Hint)
		}
		for _, o := range q.Objectives {
			word, ok := names[o.Target]
			if !ok {
				continue
			}
			for _, tx := range texts {
				if strings.Contains(strings.ToLower(tx), word) {
					t.Errorf("quest %s text gives away %q: %q", q.ID, word, tx)
				}
			}
		}
	}
	// Mara never names the wren until the tutorial is handed in.
	p := newProfile()
	for _, node := range allNodes(t, NPCMara, p) {
		for _, l := range node.Lines {
			if strings.Contains(strings.ToLower(l), "wren") {
				t.Errorf("Mara names the bird before it is identified: %q", l)
			}
		}
	}
	setStatus(p, StatusActive, TutorialQuest)
	for _, node := range allNodes(t, NPCMara, p) {
		for _, l := range node.Lines {
			if strings.Contains(strings.ToLower(l), "wren") {
				t.Errorf("Mara names the bird mid-quest: %q", l)
			}
		}
	}
}

func TestRewardsOnlyUsePinnedItems(t *testing.T) {
	pinned := set(pinnedItems)
	for _, q := range Quests() {
		for _, it := range q.Rewards.Items {
			if !pinned[it] {
				t.Errorf("%s rewards %q", q.ID, it)
			}
		}
	}
	for r := core.RegionID(0); r < core.RegionCount; r++ {
		for _, it := range CacheLoot(r.Key()) {
			if !pinned[it] {
				t.Errorf("cache loot %q", it)
			}
		}
	}
}

func TestCollectibles(t *testing.T) {
	var sp []core.Species
	for i, id := range pinnedSpecies {
		r := core.Common
		if i%7 == 3 {
			r = core.Rare
		}
		sp = append(sp, core.Species{ID: id, Name: "Eurasian " + strings.Title(strings.ReplaceAll(id, "_", " ")), Rarity: r})
	}
	cs := Collectibles(sp)
	byID := map[string]proto.CollectibleDef{}
	counts := map[string]int{}
	for _, c := range cs {
		if _, dup := byID[c.ID]; dup {
			t.Errorf("duplicate collectible %s", c.ID)
		}
		byID[c.ID] = c
		counts[c.Kind]++
		if c.POI != "" {
			t.Errorf("%s has POI %q", c.ID, c.POI)
		}
		if c.Name == "" || c.Desc == "" || c.Set == "" || c.Icon == "" || c.Rarity < 0 || c.Rarity > 4 {
			t.Errorf("%s incomplete: %+v", c.ID, c)
		}
	}
	if counts["feather"] != len(sp) || counts["page"] != 8 || counts["relic"] != 6 || counts["badge"] < 10 {
		t.Errorf("counts = %v", counts)
	}
	for _, s := range sp {
		f, ok := byID["feather_"+s.ID]
		if !ok || f.Set != "Feathers" || f.Kind != "feather" {
			t.Errorf("feather for %s: %+v", s.ID, f)
		}
		if s.Rarity == core.Rare && f.Rarity <= proto.RarityUncommon {
			t.Errorf("rare species feather has rarity %d", f.Rarity)
		}
	}
	for i := 0; i < 8; i++ {
		pg := byID[pageID(i)]
		if pg.Set != "The Forgotten Field Journal" || len(pg.Text) < 200 {
			t.Errorf("page %d: %+v", i, pg)
		}
	}
	if pageID(0) != "page_0" || pageID(7) != "page_7" || relicID(5) != "relic_5" {
		t.Error("id helpers")
	}
	if len(Collectibles(nil)) != 8+6+len(badges()) {
		t.Error("Collectibles(nil) should hold only the fixed collectibles")
	}
	if FeatherID("eurasian_jay") != "feather_eurasian_jay" {
		t.Error("FeatherID")
	}
}

// The diary hints at the hidden places and the rare birds' conditions, never gives
// coordinates and never names the birds.
func TestPagesHintWithoutNamingOrCoordinates(t *testing.T) {
	all := ""
	for _, pg := range pages {
		all += strings.ToLower(pg.text) + "\n"
		for _, bad := range []string{"coordinates", " x ", "metres north", "bearing"} {
			if strings.Contains(strings.ToLower(pg.text), bad) {
				t.Errorf("page %q contains %q", pg.title, bad)
			}
		}
	}
	for _, name := range []string{"golden oriole", "bittern", "snowy owl", "oriole"} {
		if strings.Contains(all, name) {
			t.Errorf("a page names %q", name)
		}
	}
	for _, hint := range []string{"pond", "cabin", "rock", "camp", "oak", "dusk", "spring", "winter", "cairn", "station"} {
		if !strings.Contains(all, hint) {
			t.Errorf("the diary never mentions %q", hint)
		}
	}
}

func TestCacheLootAndModestFind(t *testing.T) {
	if got := CacheLoot("murmur_marsh"); len(got) != 1 || got[0] != "explorers_lens" {
		t.Errorf("marsh: %v", got)
	}
	if got := CacheLoot("windpeak"); len(got) != 1 || got[0] != "naturalists_compass" {
		t.Errorf("windpeak: %v", got)
	}
	if got := CacheLoot("whispering_coast"); len(got) != 1 || got[0] != "research_backpack" {
		t.Errorf("coast: %v", got)
	}
	for _, k := range []string{"greenhollow", "amberwood", "frostveil", "nonsense"} {
		if got := CacheLoot(k); got == nil || len(got) != 0 {
			t.Errorf("%s: %#v, want an empty non-nil slice", k, got)
		}
	}
	a, b := ModestFind("cache@3,4", nil), ModestFind("cache@3,4", nil)
	if a.Credits != b.Credits || len(a.Items) != len(b.Items) || a.Lore != b.Lore {
		t.Error("ModestFind is not deterministic")
	}
	for i := 0; i < 200; i++ {
		f := ModestFind("cache@"+string(rune('a'+i%26))+strings.Repeat("x", i/26), nil)
		if f.Credits < 20 || f.Credits > 60 || len(f.Items) == 0 || len(f.Items) > 2 {
			t.Fatalf("find %+v", f)
		}
		for _, it := range f.Items {
			if it != "film_roll" && it != "seed_mix" {
				t.Fatalf("item %q", it)
			}
		}
		if f.Lore != "" {
			if _, ok := LoreByID(f.Lore); !ok {
				t.Fatalf("lore %q", f.Lore)
			}
			if again := ModestFind("cache@"+string(rune('a'+i%26))+strings.Repeat("x", i/26), []string{f.Lore}); again.Lore == f.Lore {
				t.Fatalf("handed out lore the player already has")
			}
		}
	}
}

func TestLore(t *testing.T) {
	ls := Lore()
	if len(ls) < 16 {
		t.Fatalf("only %d lore entries", len(ls))
	}
	cats := map[string]int{}
	for _, l := range ls {
		cats[l.Category]++
		if len(l.Text) < 80 || l.Title == "" {
			t.Errorf("%s: thin", l.ID)
		}
	}
	for _, c := range []string{LoreEcology, LoreHistory, LoreFieldcraft, LoreSpecies} {
		if cats[c] < 2 {
			t.Errorf("category %s has %d entries", c, cats[c])
		}
	}
	if got := LoreFor("page_3"); len(got) == 0 {
		t.Error("page_3 unlocks nothing")
	}
	if LoreFor("nothing") != nil && len(LoreFor("nothing")) != 0 {
		t.Error("unknown trigger")
	}
	if _, ok := LoreByID("no_such"); ok {
		t.Error("LoreByID")
	}
}

func TestRankTitle(t *testing.T) {
	want := []string{"Beginner", "Beginner", "Observer", "Naturalist", "Field Specialist", "Master Naturalist", "Master Naturalist"}
	for i, w := range want {
		r := i
		if i == 0 {
			r = -3
		}
		if got := RankTitle(r); got != w {
			t.Errorf("RankTitle(%d) = %q, want %q", r, got, w)
		}
	}
}
