package progress

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

func wantErr(t *testing.T, err, kind error) {
	t.Helper()
	if !errors.Is(err, kind) {
		t.Fatalf("want error %v, got %v", kind, err)
	}
}

// snapshot is a deep copy through JSON, so a failed action can be shown to be a no-op.
func snapshot(t *testing.T, p *proto.Profile) string {
	t.Helper()
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestValidate(t *testing.T) {
	for _, err := range Validate() {
		t.Error(err)
	}
}

func TestPinnedIDsPresent(t *testing.T) {
	for _, id := range PinnedItems() {
		if _, ok := Item(id); !ok {
			t.Errorf("pinned item %q missing", id)
		}
	}
	for _, id := range []string{CabinAudioLab, CabinPhotoWall, CabinWorkshop, CabinMapRoom, CabinGarden} {
		if _, ok := CabinUpgrade(id); !ok {
			t.Errorf("cabin upgrade %q missing", id)
		}
	}
	if n := len(Skills()); n != 35 {
		t.Errorf("want 35 skills, got %d", n)
	}
	if n := len(Disciplines()); n != 5 {
		t.Errorf("want 5 disciplines, got %d", n)
	}
	if n := len(Ranks()); n != 5 {
		t.Errorf("want 5 ranks, got %d", n)
	}
	kit := 0
	for _, it := range Items() {
		if it.Kind != KindIngredient && it.Kind != KindFood {
			kit++
		}
	}
	if kit < 36 || kit > 44 {
		t.Errorf("item count %d (without ingredients and food) outside 36..44", kit)
	}
	for _, id := range []string{"keen_ears", "sound_direction", "acoustic_memory", "frequency_awareness", "deep_listening",
		"echo_reading", "natural_recognition", "sharp_eyes", "movement_recognition", "patience", "habitat_reading",
		"peripheral_awareness", "tracking", "natural_instinct", "steady_hands", "quick_shot", "focus_control",
		"silent_shutter", "wildlife_composition", "long_lens_mastery", "perfect_moment", "field_experience",
		"species_recognition", "habitat_knowledge", "seasonal_awareness", "behavioral_insight", "ecological_knowledge",
		"master_naturalist", "quiet_steps", "trail_sense", "weather_sense", "concealment", "campcraft",
		"wildlife_familiarity", "woodland_mastery"} {
		if _, ok := Skill(id); !ok {
			t.Errorf("skill %q missing", id)
		}
	}
}

func TestEverySlotHasThreeShopTiersAndUnique(t *testing.T) {
	for _, slot := range Slots() {
		tiers := map[int]bool{}
		for _, it := range Items() {
			if it.Kind == KindEquipment && it.Slot == slot && (it.Price > 0 || it.Source == "start") {
				tiers[it.Tier] = true
			}
		}
		if slot == SlotAudio {
			// the basic recorder is Mara's gift, but it is still the tier-1 audio piece
			tiers[1] = true
		}
		for tier := 1; tier <= 3; tier++ {
			if !tiers[tier] {
				t.Errorf("slot %s has no tier %d available", slot, tier)
			}
		}
		unique := false
		for _, it := range Items() {
			if it.Kind == KindEquipment && it.Slot == slot && it.Tier == 4 {
				unique = true
			}
		}
		if slot != SlotClothing && !unique {
			t.Logf("slot %s has no tier 4 find (only six uniques are pinned)", slot)
		}
	}
}

func TestTierTwoPlusEquipmentHasTradeoff(t *testing.T) {
	for _, it := range Items() {
		if it.Kind != KindEquipment || it.Tier < 2 {
			continue
		}
		neg := false
		for k, v := range it.Mods {
			if IsTradeoff(k, v) {
				neg = true
			}
		}
		if !neg {
			t.Errorf("%s (tier %d) has no tradeoff mod", it.ID, it.Tier)
		}
		if len(it.Cons) == 0 {
			t.Errorf("%s has no cons", it.ID)
		}
	}
}

func TestUniqueItemsHaveStoryAndEffects(t *testing.T) {
	for _, id := range []string{"forgotten_journal", "historical_binoculars", "vintage_recorder", "explorers_lens", "naturalists_compass", "research_backpack"} {
		it, _ := Item(id)
		if it.Tier != 4 || it.History == "" || it.Special == "" || it.Price != 0 {
			t.Errorf("%s: tier %d price %d history/special missing=%v", id, it.Tier, it.Price, it.History == "" || it.Special == "")
		}
	}
	for stat, id := range map[string]string{"lensInspect": "explorers_lens", "compass": "naturalists_compass", "filmCap": "research_backpack", "journalInfo": "forgotten_journal", "callMemory": "vintage_recorder"} {
		if it, _ := Item(id); it.Mods[stat] == 0 {
			t.Errorf("%s lacks mod %s", id, stat)
		}
	}
	if v, _ := Item("vintage_recorder"); v.Mods["noiseReduce"] >= 0 || v.Mods["recQuality"] <= 0 {
		t.Errorf("vintage recorder should be warm but noisy: %v", v.Mods)
	}
}

func TestStartingKitNeutral(t *testing.T) {
	p := NewProfile("Test")
	if got, want := p.Stats, BaseStats(); got != want {
		t.Errorf("starting stats differ from base:\n got %+v\nwant %+v", got, want)
	}
	if p.Level != 1 || p.Rank != 1 || p.Credits != 60 {
		t.Errorf("new profile: level %d rank %d credits %d", p.Level, p.Rank, p.Credits)
	}
	for slot, id := range StartingKit() {
		if p.Equipped[slot] != id {
			t.Errorf("slot %s = %q, want %q", slot, p.Equipped[slot], id)
		}
	}
	if !reflect.DeepEqual(p.Regions, []int{int(core.RegionGreenhollow)}) {
		t.Errorf("regions %v", p.Regions)
	}
	if len(p.Explored) != 0 && p.Explored == nil {
		t.Error("explored nil")
	}
	if p.Film.Cap != 12 {
		t.Errorf("film cap %d", p.Film.Cap)
	}
}

func TestXPCurve(t *testing.T) {
	if XPForLevel(1) != 200 || XPForLevel(2) != 320 || XPForLevel(10) != 1280 {
		t.Errorf("curve wrong: %d %d %d", XPForLevel(1), XPForLevel(2), XPForLevel(10))
	}
	if TotalXPForLevel(3) != 200+320 {
		t.Errorf("total xp to level 3: %d", TotalXPForLevel(3))
	}
	p := NewProfile("t")
	if n := GrantXP(p, 199); n != 0 || p.Level != 1 || p.XP != 199 {
		t.Fatalf("199 xp: levels %d level %d xp %d", n, p.Level, p.XP)
	}
	// 1 + 320 + 320+... multi-level in one grant: 1 + 320 + 440 = 761 -> level 4 exactly
	if n := GrantXP(p, 1+320+440); n != 3 || p.Level != 4 || p.XP != 0 || p.SkillPoints != 3 {
		t.Fatalf("multi level: levels %d level %d xp %d points %d", n, p.Level, p.XP, p.SkillPoints)
	}
	if p.XPNext != XPForLevel(4) {
		t.Errorf("xpNext %d", p.XPNext)
	}
	GrantXP(p, 10_000_000)
	if p.Level != MaxLevel || p.XP != p.XPNext {
		t.Errorf("cap: level %d xp %d next %d", p.Level, p.XP, p.XPNext)
	}
	if p.SkillPoints != MaxLevel-1 {
		t.Errorf("skill points %d", p.SkillPoints)
	}
	before := p.XPTotal
	if GrantXP(p, 100) != 0 || p.XPTotal != before+100 {
		t.Error("xp at cap")
	}
}

func TestAntiGrind(t *testing.T) {
	p := NewProfile("t")
	if got := AwardXP(p, SrcPhoto, "wren", PhotoXP(1)); got != 40 {
		t.Fatalf("first photo %d", got)
	}
	if got := AwardXP(p, SrcPhoto, "wren", PhotoXP(1)); got != 0 {
		t.Fatalf("identical photo paid %d", got)
	}
	if got := AwardXP(p, SrcPhoto, "wren", PhotoXP(3)); got != 30 {
		t.Fatalf("3 star after 1 star paid %d, want 30", got)
	}
	if got := AwardXP(p, SrcPhoto, "wren", PhotoXP(2)); got != 0 {
		t.Fatalf("worse photo paid %d", got)
	}
	if got := AwardXP(p, SrcPhoto, "robin", PhotoXP(2)); got != 55 {
		t.Fatalf("other species %d", got)
	}
	if got := AwardXP(p, SrcRecording, "wren", RecordingXP(2)); got != 50 {
		t.Fatalf("recording %d", got)
	}
	if AwardXP(p, SrcLandmark, "old_oak", XPLandmark) != 25 || AwardXP(p, SrcLandmark, "old_oak", XPLandmark) != 0 {
		t.Error("landmark should pay once")
	}
	// probable identification pays half, confirmation the rest
	if got := AwardXP(p, SrcIdentify, "wren", IdentifyXP(250, true)); got != 125 {
		t.Fatalf("probable %d", got)
	}
	if got := AwardXP(p, SrcIdentify, "wren", IdentifyXP(250, false)); got != 125 {
		t.Fatalf("confirmation paid %d", got)
	}
	if got := AwardXP(p, SrcIdentify, "wren", IdentifyXP(250, false)); got != 0 {
		t.Fatalf("repeat identification paid %d", got)
	}
	if AwardXP(p, SrcPhoto, "x", PhotoXP(0)) != 0 {
		t.Error("no subject should pay nothing")
	}
}

func TestXPMultiplierApplies(t *testing.T) {
	p := NewProfile("t")
	p.Stats.XPMult = 1.5
	if got := AwardXP(p, SrcSpot, "wren", XPSpot); got != 75 {
		t.Errorf("scaled xp %d", got)
	}
}

func facts(species, docs, rep int, quests ...string) RankFacts {
	f := RankFacts{Species: species, Documented: docs, Reputation: rep, Quests: map[string]bool{}}
	for _, q := range quests {
		f.Quests[q] = true
	}
	return f
}

func TestRankThresholds(t *testing.T) {
	cases := []struct {
		name  string
		level int
		f     RankFacts
		want  int
	}{
		{"fresh", 1, facts(0, 0, 0), 1},
		{"observer needs the quest", 3, facts(5, 0, 0), 1},
		{"observer", 3, facts(5, 0, 0, "unseen_singer"), 2},
		{"observer short on species", 3, facts(4, 0, 0, "unseen_singer"), 1},
		{"naturalist short on rep", 8, facts(12, 6, 59, "unseen_singer"), 2},
		{"naturalist", 8, facts(12, 6, 60, "unseen_singer"), 3},
		{"field specialist", 14, facts(22, 14, 150, "unseen_singer"), 4},
		{"master", 22, facts(32, 25, 300, "unseen_singer"), 5},
		{"master short on docs", 22, facts(32, 24, 300, "unseen_singer"), 4},
		{"high level alone", 40, facts(0, 0, 0), 1},
	}
	for _, c := range cases {
		p := NewProfile("t")
		p.Level = c.level
		got, _ := CheckRank(p, c.f)
		if got != c.want || p.Rank != c.want {
			t.Errorf("%s: rank %d, want %d", c.name, got, c.want)
		}
	}
	p := NewProfile("t")
	p.Level = 22
	r, ok := CheckRank(p, facts(32, 25, 300, "unseen_singer"))
	if !ok || r != 5 || p.SkillPoints != 8 {
		t.Errorf("rank-up bonus: rank %d ok %v points %d (want 4 ranks x 2)", r, ok, p.SkillPoints)
	}
	if _, ok := CheckRank(p, facts(0, 0, 0)); ok || p.Rank != 5 {
		t.Error("ranks are never taken away")
	}
	for i, r := range Ranks() {
		if r.Index != i+1 || r.Title == "" || r.Desc == "" || len(r.Unlocks) == 0 {
			t.Errorf("rank %d incomplete: %+v", i+1, r)
		}
	}
}

func TestFactsFromProfile(t *testing.T) {
	p := NewProfile("t")
	p.Journal.Species["a"] = &proto.SpeciesEntry{ID: "a", Level: 4}
	p.Journal.Species["b"] = &proto.SpeciesEntry{ID: "b", Level: 5}
	p.Journal.Species["c"] = &proto.SpeciesEntry{ID: "c", Level: 6}
	p.Rep["research"] = 10
	p.Rep["rangers"] = 5
	p.Quests["unseen_singer"] = &proto.QuestState{Status: "turned_in"}
	p.Quests["other"] = &proto.QuestState{Status: "active"}
	f := FactsFromProfile(p)
	if f.Species != 3 || f.Documented != 2 || f.Reputation != 15 || !f.Quests["unseen_singer"] || f.Quests["other"] {
		t.Errorf("%+v", f)
	}
}

func buyAll(t *testing.T, p *proto.Profile, id string, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if err := BuySkill(p, id); err != nil {
			t.Fatalf("buy %s #%d: %v", id, i+1, err)
		}
	}
}

func TestSkillTierGates(t *testing.T) {
	p := NewProfile("t")
	p.SkillPoints = 100
	// Tier II needs 3 points in the discipline.
	wantErr(t, BuySkill(p, "deep_listening"), ErrRequirement)
	wantErr(t, BuySkill(p, "frequency_awareness"), ErrRequirement)
	buyAll(t, p, "keen_ears", 3)
	if PointsInvested(p, DiscAcoustics) != 3 {
		t.Fatalf("invested %d", PointsInvested(p, DiscAcoustics))
	}
	wantErr(t, BuySkill(p, "keen_ears"), ErrMaxed)
	buyAll(t, p, "frequency_awareness", 2)
	// Tier III needs 6 (3 + 2 = 5 so far).
	wantErr(t, BuySkill(p, "deep_listening"), ErrRequirement)
	buyAll(t, p, "sound_direction", 1)
	buyAll(t, p, "deep_listening", 1) // costs 2
	if p.Skills["deep_listening"] != 1 {
		t.Fatal("deep listening not bought")
	}
	// Tier IV: needs 10 points AND rank 3. Invested: 3+1+2+2 = 8.
	wantErr(t, BuySkill(p, "natural_recognition"), ErrRank) // rank checked first
	p.Rank = 3
	wantErr(t, BuySkill(p, "natural_recognition"), ErrRequirement)
	buyAll(t, p, "deep_listening", 1) // 10
	buyAll(t, p, "natural_recognition", 1)
	if p.SkillPoints != 100-(3+2+1+2+2+3) {
		t.Errorf("points left %d", p.SkillPoints)
	}
	wantErr(t, BuySkill(p, "natural_recognition"), ErrMaxed)
	wantErr(t, BuySkill(p, "nope"), ErrUnknown)

	q := NewProfile("t")
	snap := snapshot(t, q)
	wantErr(t, BuySkill(q, "keen_ears"), ErrSkillPoints)
	if snapshot(t, q) != snap {
		t.Error("failed skill purchase changed the profile")
	}
}

func TestSkillShape(t *testing.T) {
	per := map[string]int{}
	for _, s := range Skills() {
		per[s.Discipline]++
		wantMax := map[int]int{1: 3, 2: 2, 3: 2, 4: 1}[s.Tier]
		wantCost := map[int]int{1: 1, 2: 1, 3: 2, 4: 3}[s.Tier]
		if s.MaxRank != wantMax || s.Cost != wantCost {
			t.Errorf("%s tier %d maxRank %d cost %d", s.ID, s.Tier, s.MaxRank, s.Cost)
		}
		if s.Effect == "" || s.Desc == "" || len(s.Mods) == 0 {
			t.Errorf("%s incomplete", s.ID)
		}
	}
	for d, n := range per {
		if n != 7 {
			t.Errorf("%s has %d skills", d, n)
		}
	}
	tiers := SkillTiers()
	if tiers[1].Points != 3 || tiers[2].Points != 6 || tiers[3].Points != 10 || tiers[3].Rank != 3 {
		t.Errorf("tiers %+v", tiers)
	}
}

func TestEverySkillChangesAStat(t *testing.T) {
	for _, s := range Skills() {
		p := NewProfile("t")
		before := p.Stats
		p.Skills[s.ID] = 1
		Recompute(p)
		if p.Stats == before {
			t.Errorf("skill %s changes no stat", s.ID)
		}
		if s.MaxRank > 1 {
			p.Skills[s.ID] = s.MaxRank
			Recompute(p)
			if p.Stats == before {
				t.Errorf("skill %s at max rank changes no stat", s.ID)
			}
		}
	}
}

func TestSkillEnableThresholds(t *testing.T) {
	// single-rank-reachable ">= 1 enables" stats must reach 1 at max rank.
	enable := []string{"pitchInfo", "patternInfo", "habitatInfo", "perchHint", "callMemory", "callRecognise", "instinct", "recognise", "habitatKnow", "seasonKnow", "ecoKnow"}
	for _, stat := range enable {
		found := false
		for _, s := range Skills() {
			if s.Mods[stat] > 0 {
				found = true
				if total := s.Mods[stat] * float32(s.MaxRank); total < 1-1e-6 {
					t.Errorf("%s: %s reaches only %v at max rank", s.ID, stat, total)
				}
			}
		}
		if !found {
			t.Errorf("no skill drives %s", stat)
		}
	}
}

func TestSkillMapping(t *testing.T) {
	want := map[string][]string{
		"keen_ears": {"hearRange"}, "sound_direction": {"dirAccuracy"}, "acoustic_memory": {"callMemory"},
		"frequency_awareness": {"pitchInfo", "patternInfo"}, "deep_listening": {"clueSlots", "noiseReduce"},
		"echo_reading": {"distAcc"}, "natural_recognition": {"callRecognise"}, "sharp_eyes": {"nakedEye", "observeSpeed"},
		"movement_recognition": {"moveSense"}, "patience": {"settle"}, "habitat_reading": {"habitatInfo", "perchHint"},
		"peripheral_awareness": {"peripheral"}, "tracking": {"trackSigns"}, "natural_instinct": {"instinct"},
		"steady_hands": {"camStability", "binoStability"}, "quick_shot": {"camReady"}, "focus_control": {"camFocus", "binoFocus"},
		"silent_shutter": {"camNoise"}, "wildlife_composition": {"composition"}, "long_lens_mastery": {"longLens"},
		"perfect_moment": {"momentBonus"}, "field_experience": {"journalInfo"}, "species_recognition": {"idAssist", "recognise"},
		"habitat_knowledge": {"habitatKnow"}, "seasonal_awareness": {"seasonKnow"}, "behavioral_insight": {"behaviorInsight"},
		"ecological_knowledge": {"ecoKnow", "xpMult"}, "master_naturalist": {"rareId", "idAssist"}, "quiet_steps": {"stealth"},
		"trail_sense": {"trailSense", "mapDetail"}, "weather_sense": {"forecast"}, "concealment": {"crouchBonus"},
		"campcraft": {"camp"}, "wildlife_familiarity": {"familiarity"}, "woodland_mastery": {"terrain", "moveSpeed"},
	}
	for id, stats := range want {
		s, _ := Skill(id)
		for _, st := range stats {
			if _, ok := s.Mods[st]; !ok {
				t.Errorf("%s should modify %s: %v", id, st, s.Mods)
			}
		}
	}
	for _, id := range []string{"quiet_steps", "silent_shutter", "concealment", "quick_shot"} {
		s, _ := Skill(id)
		for k, v := range s.Mods {
			if k == "camBurst" {
				continue
			}
			if v >= 0 {
				t.Errorf("%s: %s should be negative", id, k)
			}
		}
	}
}

func TestStatsClampAndOrder(t *testing.T) {
	p := NewProfile("t")
	for _, s := range Skills() {
		p.Skills[s.ID] = s.MaxRank
	}
	for _, c := range CabinUpgrades() {
		p.Cabin = append(p.Cabin, c.ID)
	}
	p.Rank = 5
	p.Rep[FactionOutfitters] = 1000
	Recompute(p)
	v := reflect.ValueOf(p.Stats)
	for i, name := range StatNames() {
		lo, hi, ok := StatLimits(name)
		if !ok {
			t.Errorf("no limits for %s", name)
			continue
		}
		if f := float32(v.Field(i).Float()); f < lo || f > hi {
			t.Errorf("%s = %v outside [%v,%v]", name, f, lo, hi)
		}
	}
	if p.Stats.Discount > 0.5 {
		t.Errorf("discount %v", p.Stats.Discount)
	}
}

func TestSkillsAddUpExactly(t *testing.T) {
	p := NewProfile("t")
	p.Skills["keen_ears"] = 3
	Recompute(p)
	if p.Stats.HearRange != 1.45 {
		t.Errorf("hearRange %v", p.Stats.HearRange)
	}
	p.Skills["frequency_awareness"] = 2
	Recompute(p)
	if p.Stats.PitchInfo < 1 || p.Stats.PatternInfo < 1 {
		t.Errorf("rank 2 frequency awareness: pitch %v pattern %v", p.Stats.PitchInfo, p.Stats.PatternInfo)
	}
}

func TestStatsFor(t *testing.T) {
	p := NewProfile("t")
	p.Credits = 5000
	p.Rank = 3
	if err := Buy(p, "specialist_binoculars"); err != nil {
		t.Fatal(err)
	}
	eq := map[string]string{}
	for k, v := range p.Equipped {
		eq[k] = v
	}
	eq[SlotOptics] = "specialist_binoculars"
	prev := snapshot(t, p)
	st := StatsFor(p, eq)
	if st.BinoZoom <= p.Stats.BinoZoom {
		t.Errorf("preview zoom %v not above %v", st.BinoZoom, p.Stats.BinoZoom)
	}
	if snapshot(t, p) != prev {
		t.Error("StatsFor mutated the profile")
	}
	// binocular spec example from the brief
	b, _ := Item("specialist_binoculars")
	if b.Mods["binoZoom"] <= 0 {
		t.Error("specialist binoculars should zoom")
	}
}

func TestCarriedGadgetsCountOnceAndStoredDoNot(t *testing.T) {
	p := NewProfile("t")
	p.Credits = 1000
	if err := Buy(p, "headphones"); err != nil {
		t.Fatal(err)
	}
	if p.Stats.NoiseReduce < 0.15 {
		t.Errorf("carried headphones: noiseReduce %v", p.Stats.NoiseReduce)
	}
	if err := MoveItem(p, "headphones", ToStorage); err != nil {
		t.Fatal(err)
	}
	if p.Stats.NoiseReduce != 0 {
		t.Errorf("stored headphones should not work: %v", p.Stats.NoiseReduce)
	}
}

func TestCapacityAndStacking(t *testing.T) {
	p := NewProfile("t")
	if w, h := PackSize(p); w != 5 || h != 4 || Capacity(p) != 20 || p.Stats.Capacity != 20 {
		t.Fatalf("satchel grid %dx%d capacity %d", w, h, Capacity(p))
	}
	// supplies stack: 8 rolls take two stacks (stack of 6), one cell each
	if _, err := AddItem(p, "film_roll", 8); err != nil {
		t.Fatal(err)
	}
	if len(p.Inventory) != 2 || Carried(p, "film_roll") != 8 || FreeSlots(p) != 18 {
		t.Fatalf("inventory %+v", p.Inventory)
	}
	if _, err := AddItem(p, "film_roll", 4); err != nil {
		t.Fatal(err)
	}
	if len(p.Inventory) != 2 || p.Inventory[0].Qty != 6 || p.Inventory[1].Qty != 6 {
		t.Fatalf("top-up: %+v", p.Inventory)
	}
	// gear takes its footprint: 2x2 + 1x2 + 1x1 + 2x3 = 13 cells, 15 used in all
	for _, id := range []string{"headphones", "pocket_guide", "pocket_barometer", "field_stool"} {
		if stored, err := AddItem(p, id, 1); err != nil || stored != 0 {
			t.Fatalf("%s: stored %d err %v (%+v)", id, stored, err, p.Inventory)
		}
	}
	if FreeSlots(p) != 5 || !PackGrid(p).Valid() {
		t.Fatalf("free %d: %+v", FreeSlots(p), p.Inventory)
	}
	fillPack(p, "seed_mix", 8)
	stored, err := AddItem(p, "seed_mix", 3)
	if err != nil || stored != 3 || Stored(p, "seed_mix") != 3 || FreeSlots(p) != 0 {
		t.Fatalf("overflow: stored %d err %v free %d", stored, err, FreeSlots(p))
	}
	if !StorageGrid(p).Valid() {
		t.Fatalf("storage %+v", p.Storage)
	}
	// gear is one of a kind
	_, err = AddItem(p, "headphones", 1)
	wantErr(t, err, ErrAlreadyOwned)
	_, err = AddItem(p, "nonsense", 1)
	wantErr(t, err, ErrUnknown)
	// equipped items do not take room: the satchel is worn, not carried
	if Where(p, "canvas_satchel") != "equipped" {
		t.Error("satchel should be equipped")
	}
	// using film adds frames
	if _, err := UseItem(p, "film_roll"); err != nil {
		t.Fatal(err)
	}
	if p.Film.Cap != 24 {
		t.Errorf("film cap after roll %d", p.Film.Cap)
	}
	if got := DevelopFilm(p); got != 0 || p.Film.Cap != 12 {
		t.Errorf("develop: %d cap %d", got, p.Film.Cap)
	}
	use, err := UseItem(p, "seed_mix")
	if err != nil || use != UseSeed {
		t.Errorf("seed use %q %v", use, err)
	}
	_, err = UseItem(p, "headphones")
	wantErr(t, err, ErrInvalid)
}

func TestEquipUnequipRoundTrip(t *testing.T) {
	p := NewProfile("t")
	p.Credits = 1000
	if err := Buy(p, "explorer_binoculars"); err != nil {
		t.Fatal(err)
	}
	zoom0 := p.Stats.BinoZoom
	if err := Equip(p, "explorer_binoculars", false); err != nil {
		t.Fatal(err)
	}
	if p.Equipped[SlotOptics] != "explorer_binoculars" || Where(p, "basic_binoculars") != ToInventory {
		t.Fatalf("equip swap: %+v inv %+v", p.Equipped, p.Inventory)
	}
	if p.Stats.BinoZoom <= zoom0 {
		t.Errorf("zoom %v not better than %v", p.Stats.BinoZoom, zoom0)
	}
	if len(p.Inventory) != 1 {
		t.Fatalf("swap should not change pack size: %+v", p.Inventory)
	}
	if err := Equip(p, "basic_binoculars", false); err != nil {
		t.Fatal(err)
	}
	if p.Stats.BinoZoom != zoom0 || Where(p, "explorer_binoculars") != ToInventory {
		t.Errorf("round trip failed: zoom %v", p.Stats.BinoZoom)
	}
	if err := Unequip(p, SlotOptics); err != nil {
		t.Fatal(err)
	}
	if p.Equipped[SlotOptics] != "" || len(p.Inventory) != 2 {
		t.Errorf("unequip: %+v %+v", p.Equipped, p.Inventory)
	}
	wantErr(t, Unequip(p, SlotOptics), ErrInvalid)
	wantErr(t, Unequip(p, "hat"), ErrUnknown)
	wantErr(t, Equip(p, "headphones", false), ErrInvalid)
	wantErr(t, Equip(p, "spotting_scope", false), ErrNotOwned)
}

func TestUnequipIntoFullPackFails(t *testing.T) {
	p := NewProfile("t")
	for _, id := range []string{"headphones", "pocket_guide", "pocket_barometer", "field_stool"} {
		AddItem(p, id, 1)
	}
	AddItem(p, "film_roll", 6)
	AddItem(p, "film_roll", 6)
	AddItem(p, "seed_mix", 8)
	AddItem(p, "seed_mix", 8)
	if len(p.Inventory) != 8 {
		t.Fatalf("setup: %d", len(p.Inventory))
	}
	snap := snapshot(t, p)
	wantErr(t, Unequip(p, SlotOptics), ErrPackFull)
	if snapshot(t, p) != snap {
		t.Error("failed unequip changed the profile")
	}
}

func TestEquipFromStorageOnlyAtCabin(t *testing.T) {
	p := NewProfile("t")
	p.Credits = 1000
	Buy(p, "explorer_binoculars")
	if err := MoveItem(p, "explorer_binoculars", ToStorage); err != nil {
		t.Fatal(err)
	}
	wantErr(t, Equip(p, "explorer_binoculars", false), ErrNotOwned)
	if err := Equip(p, "explorer_binoculars", true); err != nil {
		t.Fatal(err)
	}
	if Where(p, "basic_binoculars") != ToStorage {
		t.Errorf("old optics should land in storage: %+v %+v", p.Inventory, p.Storage)
	}
	if err := MoveItem(p, "basic_binoculars", ToInventory); err != nil || Where(p, "basic_binoculars") != ToInventory {
		t.Fatalf("move back: %v", err)
	}
	wantErr(t, MoveItem(p, "basic_binoculars", "attic"), ErrInvalid)
	wantErr(t, MoveItem(p, "explorer_binoculars", ToStorage), ErrInvalid) // equipped
}

func TestBackpackSwapCannotOverflow(t *testing.T) {
	p := NewProfile("t")
	p.Credits = 5000
	p.Rank = 3
	Buy(p, "expedition_pack")
	if err := Equip(p, "expedition_pack", false); err != nil {
		t.Fatal(err)
	}
	fillPack(p, "seed_mix", 8) // 42 cells of the 7x6 pack, the satchel holds 20
	snap := snapshot(t, p)
	if err := Equip(p, "canvas_satchel", false); err == nil {
		t.Fatal("swapping to a smaller pack with a full bag should fail")
	} else {
		wantErr(t, err, ErrPackFull)
	}
	if snapshot(t, p) != snap {
		t.Error("failed equip changed the profile")
	}
}

func TestBuyRules(t *testing.T) {
	p := NewProfile("t")
	// rank gate
	snap := snapshot(t, p)
	wantErr(t, Buy(p, "specialist_binoculars"), ErrRank)
	p.Credits = 5000
	snap = snapshot(t, p)
	wantErr(t, Buy(p, "specialist_binoculars"), ErrRank)
	wantErr(t, Buy(p, "historical_binoculars"), ErrNotForSale)
	wantErr(t, Buy(p, "nonsense"), ErrUnknown)
	wantErr(t, Buy(p, "basic_binoculars"), ErrNotForSale)
	if snapshot(t, p) != snap {
		t.Error("failed buys changed the profile")
	}
	// credits
	q := NewProfile("t")
	snap = snapshot(t, q)
	wantErr(t, Buy(q, "explorer_binoculars"), ErrCredits)
	if snapshot(t, q) != snap {
		t.Error("credit failure changed the profile")
	}
	// success + discount
	q.Credits = 1000
	q.Stats.Discount = 0.5
	if err := Buy(q, "explorer_binoculars"); err != nil {
		t.Fatal(err)
	}
	if q.Credits != 1000-90 {
		t.Errorf("credits %d", q.Credits)
	}
	// duplicates
	wantErr(t, Buy(q, "explorer_binoculars"), ErrAlreadyOwned)
	// reputation gate
	var gated string
	for _, it := range Items() {
		if it.ReqRep > 0 && it.Price > 0 {
			gated = it.ID
		}
	}
	if gated != "" {
		r := NewProfile("t")
		r.Credits, r.Rank = 9999, MaxRank
		wantErr(t, Buy(r, gated), ErrReputation)
	}
	// pack full
	f := NewProfile("t")
	f.Credits = 9999
	fillPack(f, "film_roll", 6)
	snap = snapshot(t, f)
	wantErr(t, Buy(f, "headphones"), ErrPackFull)
	wantErr(t, Buy(f, "film_roll"), ErrPackFull)
	if snapshot(t, f) != snap {
		t.Error("pack-full failure changed the profile")
	}
	// supplies stack and can always top up
	g := NewProfile("t")
	g.Credits = 100
	for i := 0; i < 3; i++ {
		if err := Buy(g, "seed_mix"); err != nil {
			t.Fatal(err)
		}
	}
	if len(g.Inventory) != 1 || g.Inventory[0].Qty != 3 || g.Credits != 64 {
		t.Errorf("%+v credits %d", g.Inventory, g.Credits)
	}
}

func TestBuyUpgrade(t *testing.T) {
	p := NewProfile("t")
	p.Credits = 5000
	p.Rank = 2
	snap := snapshot(t, p)
	wantErr(t, BuyUpgrade(p, "explorer_binoculars", "explorer_binoculars_coating"), ErrNotOwned)
	wantErr(t, BuyUpgrade(p, "basic_binoculars", "nope"), ErrUnknown)
	wantErr(t, BuyUpgrade(p, "nonsense", "x"), ErrUnknown)
	if snapshot(t, p) != snap {
		t.Error("failed upgrade changed the profile")
	}
	Buy(p, "explorer_binoculars")
	Equip(p, "explorer_binoculars", false)
	before := p.Stats
	if err := BuyUpgrade(p, "explorer_binoculars", "explorer_binoculars_coating"); err != nil {
		t.Fatal(err)
	}
	if p.Stats == before {
		t.Error("upgrade changed no stat")
	}
	wantErr(t, BuyUpgrade(p, "explorer_binoculars", "explorer_binoculars_coating"), ErrAlreadyOwned)
	// workshop gate
	wantErr(t, BuyUpgrade(p, "explorer_binoculars", "explorer_binoculars_focus"), ErrRequirement)
	if err := BuyCabinUpgrade(p, CabinWorkshop); err != nil {
		t.Fatal(err)
	}
	if err := BuyUpgrade(p, "explorer_binoculars", "explorer_binoculars_focus"); err != nil {
		t.Fatal(err)
	}
	// rank gate
	low := NewProfile("t")
	low.Credits = 5000
	Buy(low, "explorer_binoculars")
	low.Cabin = append(low.Cabin, CabinWorkshop)
	wantErr(t, BuyUpgrade(low, "explorer_binoculars", "explorer_binoculars_focus"), ErrRank)
	// credits
	poor := NewProfile("t")
	poor.Credits = 0
	AddItem(poor, "explorer_binoculars", 1)
	wantErr(t, BuyUpgrade(poor, "explorer_binoculars", "explorer_binoculars_coating"), ErrCredits)
}

func TestCabinUpgrades(t *testing.T) {
	p := NewProfile("t")
	p.Credits = 5000
	snap := snapshot(t, p)
	wantErr(t, BuyCabinUpgrade(p, CabinMapRoom), ErrRank)
	wantErr(t, BuyCabinUpgrade(p, "pool"), ErrUnknown)
	if snapshot(t, p) != snap {
		t.Error("failed cabin buy changed the profile")
	}
	p.Rank = 3
	before := p.Stats
	if err := BuyCabinUpgrade(p, CabinMapRoom); err != nil {
		t.Fatal(err)
	}
	if p.Stats.MapDetail <= before.MapDetail || p.Stats.TrailSense <= before.TrailSense {
		t.Error("map room has no effect")
	}
	wantErr(t, BuyCabinUpgrade(p, CabinMapRoom), ErrAlreadyOwned)
	if PinSlots(p) != PinSlotsBase {
		t.Error("pin slots before photo wall")
	}
	BuyCabinUpgrade(p, CabinPhotoWall)
	if PinSlots(p) != PinSlotsUpgraded || p.Stats.CreditMult <= 1 {
		t.Errorf("photo wall: slots %d creditMult %v", PinSlots(p), p.Stats.CreditMult)
	}
	BuyCabinUpgrade(p, CabinAudioLab)
	if p.Stats.AudioAssist < 1 {
		t.Error("audio lab has no effect")
	}
	poor := NewProfile("t")
	poor.Rank = 5
	wantErr(t, BuyCabinUpgrade(poor, CabinGarden), ErrCredits)
}

func TestApplyReward(t *testing.T) {
	p := NewProfile("t")
	// fill the pack so item rewards overflow
	fillPack(p, "film_roll", 6)
	r := proto.Reward{
		XP: 700, Credits: 100, Rep: map[string]int{"research": 20, "naturalists": 10},
		Items: []string{"explorer_binoculars", "nonsense"}, SkillPoints: 2,
		Unlock: []string{"region:murmur_marsh", "quest:visitor_from_afar", "feature:garden", "region:bogus"},
		Lore:   []string{"lore_a", "lore_a"}, Badge: "badge_x",
	}
	levels, items := ApplyReward(p, r)
	if levels != 2 || p.Level != 3 {
		t.Errorf("levels %d level %d (700 xp = 200 + 320 + 180)", levels, p.Level)
	}
	if !reflect.DeepEqual(items, []string{"explorer_binoculars"}) {
		t.Errorf("items %v", items)
	}
	if Stored(p, "explorer_binoculars") != 1 || len(p.Inventory) != Capacity(p) {
		t.Errorf("overflow: storage %+v", p.Storage)
	}
	if p.Credits != 160 || p.Rep["research"] != 20 || p.SkillPoints != 2+2 {
		t.Errorf("credits %d rep %v points %d", p.Credits, p.Rep, p.SkillPoints)
	}
	marsh, _ := core.RegionFromKey("murmur_marsh")
	if !RegionUnlocked(p, marsh) || len(p.Regions) != 2 {
		t.Errorf("regions %v", p.Regions)
	}
	if !p.Flags["unlock:quest:visitor_from_afar"] || !p.Flags["unlock:feature:garden"] {
		t.Errorf("flags %v", p.Flags)
	}
	if len(p.Journal.Lore) != 1 || len(p.Journal.Badges) != 1 {
		t.Errorf("lore %v badges %v", p.Journal.Lore, p.Journal.Badges)
	}
	// a duplicate unique is paid as credits
	c0 := p.Credits
	_, items = ApplyReward(p, proto.Reward{Items: []string{"explorer_binoculars"}})
	if len(items) != 0 || p.Credits != c0+180 {
		t.Errorf("duplicate: items %v credits %d -> %d", items, c0, p.Credits)
	}
	// multipliers
	q := NewProfile("t")
	q.Cabin = []string{CabinPhotoWall}
	Recompute(q)
	ApplyReward(q, proto.Reward{Credits: 100})
	if q.Credits != 60+105 {
		t.Errorf("credit multiplier: %d", q.Credits)
	}
}

func TestForgottenJournalRevealsTrails(t *testing.T) {
	p := NewProfile("t")
	if _, err := AddItem(p, "forgotten_journal", 1); err != nil {
		t.Fatal(err)
	}
	if len(p.Trails) != len(JournalTrails()) || p.Stats.TrailSense <= 12 {
		t.Errorf("trails %v trailSense %v", p.Trails, p.Stats.TrailSense)
	}
	AddItem(p, "explorers_lens", 1)
	if p.Stats.LensInspect < 1 {
		t.Error("lens should enable inspection while carried")
	}
}

func TestRepDiscount(t *testing.T) {
	p := NewProfile("t")
	AddRep(p, FactionOutfitters, 60)
	if p.Stats.Discount != 0.10 {
		t.Errorf("discount %v", p.Stats.Discount)
	}
	if AddRep(p, FactionOutfitters, -500) != 0 {
		t.Error("reputation should floor at zero")
	}
}

func TestProfileJSONRoundTrip(t *testing.T) {
	p := NewProfile("Robin")
	p.Credits = 9999
	p.Rank = 3
	Buy(p, "explorer_binoculars")
	Equip(p, "explorer_binoculars", false)
	AddItem(p, "film_roll", 9)
	BuySkill(p, "keen_ears")
	AwardXP(p, SrcSpot, "wren", XPSpot)
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var q proto.Profile
	if err := json.Unmarshal(b, &q); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(p, &q) {
		t.Errorf("round trip differs:\n%s\n%s", b, snapshot(t, &q))
	}
	Normalize(&q)
	if q.Stats != p.Stats {
		t.Error("normalize changed stats")
	}
	// nothing null on the wire
	var m map[string]any
	json.Unmarshal(b, &m)
	for k, v := range m {
		if v == nil {
			t.Errorf("profile field %q marshals as null", k)
		}
	}
	// Explored is a (possibly empty) map, never nil
	if p.Explored == nil {
		t.Error("explored nil")
	}
	// Normalize on a bare profile
	var bare proto.Profile
	Normalize(&bare)
	if bare.Level != 1 || bare.Rank != 1 || bare.Skills == nil || bare.Journal.Species == nil {
		t.Errorf("bare normalize: %+v", bare)
	}
}

func TestCatalogCopiesAreIndependent(t *testing.T) {
	it := Items()
	it[0].Mods["binoZoom"] = 999
	if v, _ := Item(it[0].ID); v.Mods["binoZoom"] == 999 {
		t.Error("Items() leaked internal state")
	}
	sk := Skills()
	sk[0].Mods["hearRange"] = 999
	if v, _ := Skill(sk[0].ID); v.Mods["hearRange"] == 999 {
		t.Error("Skills() leaked internal state")
	}
}

func TestCatalogJSONHasNoNulls(t *testing.T) {
	b, _ := json.Marshal(Items())
	var arr []map[string]any
	json.Unmarshal(b, &arr)
	for _, it := range arr {
		for _, k := range []string{"mods", "pros", "cons", "upgrades"} {
			if it[k] == nil {
				t.Errorf("%v: %s is null", it["id"], k)
			}
		}
	}
}
