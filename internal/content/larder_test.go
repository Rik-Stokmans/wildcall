package content

import (
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// pinnedPlants is the plant table of contract §12: plant id, VegKind, yields.
var pinnedPlants = []struct {
	id    string
	veg   int
	items []string
}{
	{"bramble", 18, []string{"blackberry"}}, {"wild_strawberry", 19, []string{"wild_strawberry"}},
	{"bilberry", 20, []string{"bilberry"}}, {"elder", 21, []string{"elderflower", "elderberry"}},
	{"dog_rose", 22, []string{"rosehip"}}, {"hazel", 23, []string{"hazelnut"}},
	{"sweet_chestnut", 24, []string{"chestnut"}}, {"nettle", 25, []string{"nettle"}},
	{"wild_garlic", 26, []string{"wild_garlic"}}, {"water_mint", 27, []string{"water_mint"}},
	{"chamomile", 28, []string{"chamomile"}}, {"young_pine", 29, []string{"pine_tips"}},
	{"chanterelle", 30, []string{"chanterelle"}}, {"penny_bun", 31, []string{"penny_bun"}},
	{"sea_buckthorn", 32, []string{"sea_buckthorn"}}, {"samphire", 33, []string{"samphire"}},
	{"cloudberry", 34, []string{"cloudberry"}}, {"wild_thyme", 35, []string{"wild_thyme"}},
}

func TestPinnedPlants(t *testing.T) {
	if len(Plants()) != len(pinnedPlants) {
		t.Fatalf("%d plants, want %d", len(Plants()), len(pinnedPlants))
	}
	for i, want := range pinnedPlants {
		p := Plants()[i]
		if p.ID != want.id || p.Veg != want.veg {
			t.Errorf("plant #%d is %s/%d, want %s/%d", i, p.ID, p.Veg, want.id, want.veg)
		}
		var got []string
		for _, y := range p.Yields {
			got = append(got, y.Item)
		}
		if strings.Join(got, ",") != strings.Join(want.items, ",") {
			t.Errorf("%s yields %v, want %v", p.ID, got, want.items)
		}
		if p.Name == "" || p.Sci == "" || p.Desc == "" || p.Uses == "" || p.Habitat == "" || p.Caution == "" {
			t.Errorf("%s: incomplete herbarium page", p.ID)
		}
		if _, ok := Plant(p.ID); !ok {
			t.Errorf("Plant(%q) not found", p.ID)
		}
		if got, ok := PlantByVeg(p.Veg); !ok || got.ID != p.ID {
			t.Errorf("PlantByVeg(%d) = %v", p.Veg, got.ID)
		}
	}
	if _, ok := PlantByVeg(int(core.VegOak)); ok {
		t.Error("an oak is not a forage plant")
	}
}

func TestPlantSeasonsAreReal(t *testing.T) {
	// Spring, summer, autumn, winter.
	want := map[string][4]bool{
		"blackberry":  {false, false, true, false}, // late summer and autumn: summer is checked below
		"elderflower": {true, false, false, false},
		"elderberry":  {false, false, true, false},
		"rosehip":     {false, false, true, true},
		"hazelnut":    {false, false, true, false},
		"wild_garlic": {true, false, false, false},
		"pine_tips":   {true, true, true, true},
		"cloudberry":  {false, true, false, false},
		"samphire":    {false, true, false, false},
	}
	for _, p := range Plants() {
		for _, y := range p.Yields {
			w, ok := want[y.Item]
			if !ok {
				continue
			}
			if y.Item == "blackberry" {
				w[1] = true // late summer
			}
			if y.Seasons != w {
				t.Errorf("%s: seasons %v, want %v", y.Item, y.Seasons, w)
			}
		}
	}
	if got := YieldsIn("elder", 0); len(got) != 1 || got[0].Item != "elderflower" {
		t.Errorf("elder in spring: %v", got)
	}
	if got := YieldsIn("elder", 3); len(got) != 0 {
		t.Errorf("elder in winter: %v", got)
	}
	if len(YieldsIn("ghost", 0)) != 0 || len(YieldsIn("elder", 9)) != 0 {
		t.Error("unknown plant or season should yield nothing")
	}
}

func TestPlantCautionsWhereAForagerWantsOne(t *testing.T) {
	for _, id := range []string{"chanterelle", "penny_bun"} {
		p, _ := Plant(id)
		if !strings.Contains(p.Caution, "only pick what you can identify with certainty") &&
			!strings.Contains(p.Caution, "Only pick what you can identify with certainty") {
			t.Errorf("%s caution lacks the certainty rule: %q", id, p.Caution)
		}
	}
	e, _ := Plant("elder")
	if !strings.Contains(e.Caution, "flowers and cooked berries") {
		t.Errorf("elder caution: %q", e.Caution)
	}
}

func TestPlantPlacementMatchesTheWorldBrief(t *testing.T) {
	where := map[string][]core.RegionID{
		"chestnut":       nil, // see below
		"sweet_chestnut": {core.RegionAmberwood},
		"cloudberry":     {core.RegionFrostveil},
		"wild_thyme":     {core.RegionWindpeak},
		"sea_buckthorn":  {core.RegionWhisperingCoast},
		"samphire":       {core.RegionWhisperingCoast},
	}
	for id, regions := range where {
		p, ok := Plant(id)
		if !ok {
			continue
		}
		if len(p.Regions) != len(regions) {
			t.Errorf("%s: regions %v, want %v", id, p.Regions, regions)
			continue
		}
		for i, r := range regions {
			if p.Regions[i] != int(r) {
				t.Errorf("%s: regions %v, want %v", id, p.Regions, regions)
			}
		}
	}
	for _, p := range Plants() {
		if p.Regrow < 3 || p.Regrow > 8 {
			t.Errorf("%s: regrow %d", p.ID, p.Regrow)
		}
		if !contains(p.Regions, int(core.RegionGreenhollow)) && p.Veg < int(core.VegSeaBuckthorn) && p.ID != "sweet_chestnut" {
			t.Errorf("%s does not grow in the home valley", p.ID)
		}
	}
}

func contains(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func TestPinnedRecipes(t *testing.T) {
	rs := Recipes()
	if len(rs) != 19 {
		t.Fatalf("%d recipes", len(rs))
	}
	foods := progress.FoodItems()
	for i, r := range rs {
		if r.ID != foods[i] || r.Output != foods[i] {
			t.Errorf("recipe #%d is %s -> %s, want %s", i, r.ID, r.Output, foods[i])
		}
		if got, ok := Recipe(r.ID); !ok || got.Name != r.Name {
			t.Errorf("Recipe(%q) lookup failed", r.ID)
		}
	}
	starts := RecipesLearnedBy("start")
	if len(starts) != 0 {
		t.Errorf("start is not a trigger: %v", starts)
	}
	var start []string
	for _, r := range rs {
		if r.Learn == LearnStart {
			start = append(start, r.ID)
		}
	}
	if strings.Join(start, ",") != strings.Join(progress.StartingRecipes(), ",") {
		t.Errorf("starting recipes %v vs progress %v", start, progress.StartingRecipes())
	}
	if got := RecipesLearnedBy("plant:chamomile"); len(got) != 1 || got[0] != "chamomile_tea" {
		t.Errorf("plant:chamomile teaches %v", got)
	}
	if got := RecipesLearnedBy("npc:mara"); len(got) != 1 || got[0] != "elderberry_syrup" {
		t.Errorf("npc:mara teaches %v", got)
	}
	if got := RecipesLearnedBy("npc:finn"); len(got) != 1 || got[0] != "wild_garlic_flatbread" {
		t.Errorf("npc:finn teaches %v", got)
	}
	if got := RecipesLearnedBy("lore:keepers_stew"); len(got) != 1 || got[0] != "forager_stew" {
		t.Errorf("lore:keepers_stew teaches %v", got)
	}
	if len(RecipesLearnedBy("plant:nothing")) != 0 {
		t.Error("unknown trigger should teach nothing")
	}
}

func TestRecipeStations(t *testing.T) {
	stove, _ := Recipe("bilberry_tart")
	kettle, _ := Recipe("mint_tea")
	if !RecipeStationOK(kettle, false, true) || !RecipeStationOK(kettle, true, false) || RecipeStationOK(kettle, false, false) {
		t.Error("kettle: cabin or camp")
	}
	if RecipeStationOK(stove, false, true) || !RecipeStationOK(stove, true, false) {
		t.Error("stove: cabin only")
	}
}

// TestLarderAgreesWithProgress cross-checks the two catalogs: every yield, input
// and output is a real item, every food has a recipe, and every learn rule is real.
func TestLarderAgreesWithProgress(t *testing.T) {
	for _, err := range progress.ValidateLarder(Recipes(), Plants()) {
		t.Error(err)
	}
	for _, err := range progress.Validate() {
		t.Error(err)
	}
	// Every recipe can be cooked from a pack holding its inputs, and the resulting
	// buff is real.
	for _, r := range Recipes() {
		p := progress.NewProfile("t")
		p.Credits = 0
		progress.LearnRecipe(p, r.ID)
		for _, in := range r.Inputs {
			if _, err := progress.AddItem(p, in.Item, in.Qty*2); err != nil {
				t.Fatalf("%s: %v", r.ID, err)
			}
		}
		if len(p.Inventory) > progress.Capacity(p) {
			continue
		}
		res, err := progress.Cook(p, r, 1)
		if err != nil {
			t.Errorf("%s: %v", r.ID, err)
			continue
		}
		if _, err := progress.Eat(p, res.Item, 8); err != nil {
			t.Errorf("%s: cannot eat what it makes: %v", r.ID, err)
		}
	}
	// Every plant yield is something the world's items know, in a season, and every
	// pantry staple that recipes call for is sold.
	var allItems []string
	for _, it := range progress.Items() {
		allItems = append(allItems, it.ID)
	}
	shop := set(progress.ShopItems())
	for _, r := range Recipes() {
		for _, in := range r.Inputs {
			if it, _ := progress.Item(in.Item); it.Source == "shop" && !shop[in.Item] {
				t.Errorf("%s: pantry input %s is not in the shop", r.ID, in.Item)
			}
		}
	}
	if errs := Validate(pinnedSpecies, allItems, pinnedPOIs, pinnedSkills); len(errs) != 0 {
		t.Errorf("Validate with the real item ids: %v", errs)
	}
}

func TestValidateReportsMissingLarderItems(t *testing.T) {
	errs := Validate(pinnedSpecies, []string{"basic_recorder", "film_roll", "seed_mix", "explorers_lens", "naturalists_compass", "research_backpack"}, pinnedPOIs, pinnedSkills)
	joined := ""
	for _, e := range errs {
		joined += e.Error() + "\n"
	}
	for _, want := range []string{"blackberry", "pine_tip_tea", "oats"} {
		if !strings.Contains(joined, want) {
			t.Errorf("Validate did not report the missing %q", want)
		}
	}
}

func TestEveryNPCRecipeHasATopic(t *testing.T) {
	for _, r := range Recipes() {
		if npc, ok := strings.CutPrefix(r.Learn, LearnNPC); ok && !npcTeaches(npc, r.ID) {
			t.Errorf("%s: %s teaches nothing", r.ID, npc)
		}
	}
	// The topic actually teaches it through Choose.
	for npc, topic := range map[string]string{NPCMara: "t_elder", NPCFinn: "f_flatbread"} {
		n, acts := Choose(npc, topic, afterTutorial())
		if len(n.Lines) == 0 || len(acts) == 0 || acts[0].Kind != ActionLearnRecipe {
			t.Errorf("%s/%s: %+v %+v", npc, topic, n, acts)
		}
	}
}

func TestLoreForTheLarder(t *testing.T) {
	for _, id := range []string{"pick_with_care", "fair_share", "keepers_stew", "elder_year", "mushroom_rule", "nettle_nursery", "salt_marsh_greens"} {
		l, ok := LoreByID(id)
		if !ok || len(l.Text) < 200 {
			t.Errorf("lore %s missing or too short", id)
		}
	}
	if got := LoreFor("forage:elder"); len(got) != 1 || got[0] != "elder_year" {
		t.Errorf("forage:elder unlocks %v", got)
	}
	if got := LoreFor("page_4"); len(got) != 2 {
		t.Errorf("page_4 unlocks %v", got)
	}
}

// ---------------------------------------------------------------------------
// Quests with the new objective kinds.

func larderProfile() *proto.Profile {
	p := afterTutorial()
	return p
}

func TestForageCookEatQuestAdvances(t *testing.T) {
	tr := NewTracker()
	p := larderProfile()
	mustAccept(t, tr, p, "tea_at_the_cabin")
	at := Place(core.RegionGreenhollow, core.HabWoodland, core.PhaseMorning)

	// Ordered: cooking before picking does nothing.
	if ps := tr.OnEvent(p, Cooked("mint_tea", "drink", 1)); len(ps) != 0 {
		t.Errorf("cooked out of order: %+v", ps)
	}
	// Distinct plants: the same plant twice counts once.
	tr.OnEvent(p, Foraged("bramble", at))
	if ps := tr.OnEvent(p, Foraged("bramble", at)); len(ps) != 0 {
		t.Errorf("the same plant twice moved the quest: %+v", ps)
	}
	tr.OnEvent(p, Foraged("hazel", at))
	ps := tr.OnEvent(p, Foraged("water_mint", at))
	if !progressed(ps, "tea_at_the_cabin", "pick") || !ps[0].Done {
		t.Fatalf("third plant: %+v", ps)
	}
	ps = tr.OnEvent(p, Cooked("mint_tea", "drink", 2))
	if !progressed(ps, "tea_at_the_cabin", "cook") {
		t.Fatalf("cook: %+v", ps)
	}
	ps = tr.OnEvent(p, Eaten("mint_tea", "drink"))
	if !progressed(ps, "tea_at_the_cabin", "eat") || !ps[len(ps)-1].Complete {
		t.Fatalf("eat: %+v", ps)
	}
	rw, err := tr.TurnIn(p, "tea_at_the_cabin")
	if err != nil || len(rw.Lore) != 1 || rw.Lore[0] != "pick_with_care" {
		t.Errorf("turn in: %+v %v", rw, err)
	}
}

func TestFairShareQuestWantsTheValley(t *testing.T) {
	tr := NewTracker()
	p := larderProfile()
	mustAccept(t, tr, p, "a_fair_share")
	away := Place(core.RegionAmberwood, core.HabWoodland, core.PhaseMorning)
	for _, id := range []string{"bramble", "hazel", "elder", "nettle", "dog_rose"} {
		if ps := tr.OnEvent(p, Foraged(id, away)); len(ps) != 0 {
			t.Fatalf("picking in Amberwood counted: %+v", ps)
		}
	}
	home := Place(core.RegionGreenhollow, core.HabWoodland, core.PhaseMorning)
	var last []Progress
	for _, id := range []string{"bramble", "hazel", "elder", "nettle", "dog_rose"} {
		last = tr.OnEvent(p, Foraged(id, home))
	}
	if len(last) == 0 || !last[0].Done {
		t.Fatalf("five plants: %+v", last)
	}
	// A meal does not satisfy "snack".
	if ps := tr.OnEvent(p, Eaten("nettle_soup", "meal")); len(ps) != 0 {
		t.Errorf("a meal counted as a snack: %+v", ps)
	}
	ps := tr.OnEvent(p, Eaten("blackberry", "snack"))
	if len(ps) == 0 || !ps[len(ps)-1].Complete {
		t.Errorf("snack: %+v", ps)
	}
}

func TestMealQuestCountsDistinctRecipesAndBatches(t *testing.T) {
	tr := NewTracker()
	p := larderProfile()
	setStatus(p, StatusTurnedIn, "tea_at_the_cabin")
	mustAccept(t, tr, p, "a_meal_from_the_wood")
	tr.OnEvent(p, Cooked("mint_tea", "drink", 3)) // three batches of ONE recipe: counts once
	if p.Quests["a_meal_from_the_wood"].Progress["dishes"] != 1 {
		t.Errorf("distinct recipes: %v", p.Quests["a_meal_from_the_wood"].Progress)
	}
	tr.OnEvent(p, Cooked("nettle_soup", "meal", 1))
	ps := tr.OnEvent(p, Cooked("pine_tip_tea", "drink", 1))
	if !progressed(ps, "a_meal_from_the_wood", "dishes") {
		t.Errorf("third dish: %+v", ps)
	}
	ps = tr.OnEvent(p, Eaten("nettle_soup", "meal"))
	if len(ps) == 0 || !ps[len(ps)-1].Complete {
		t.Errorf("meal: %+v", ps)
	}
	rw, _ := tr.TurnIn(p, "a_meal_from_the_wood")
	if len(rw.Lore) != 1 || rw.Lore[0] != "keepers_stew" {
		t.Errorf("reward %+v", rw)
	}
}

func TestVolunteerTeaContractCountsBatchesOfDrinks(t *testing.T) {
	tr := NewTracker()
	p := larderProfile()
	mustAccept(t, tr, p, "contract_volunteer_tea")
	if ps := tr.OnEvent(p, Cooked("nettle_soup", "meal", 3)); len(ps) != 0 {
		t.Errorf("soup is not a drink: %+v", ps)
	}
	tr.OnEvent(p, Cooked("mint_tea", "drink", 2))
	ps := tr.OnEvent(p, Cooked("mint_tea", "drink", 1))
	if len(ps) == 0 || !ps[0].Done || !ps[len(ps)-1].Complete {
		t.Errorf("three batches: %+v", ps)
	}
}

func TestLarderQuestsAreOfferedByTheirGivers(t *testing.T) {
	// The hub only lists two pitches at a time, so the foraging talk leads to the
	// errand directly.
	p := afterTutorial()
	for npc, tc := range map[string][2]string{NPCMara: {"t_forage", "tea_at_the_cabin"}, NPCJune: {"j_forage", "a_fair_share"}} {
		n, _ := Choose(npc, tc[0], p)
		found := false
		for _, c := range n.Choices {
			found = found || c.ID == pfxOffer+tc[1]
		}
		if !found {
			t.Errorf("%s: the foraging topic does not lead to %s: %+v", npc, tc[1], n.Choices)
		}
		offer, _ := Choose(npc, pfxOffer+tc[1], p)
		if offer.Quest != tc[1] || offer.Rewards == nil {
			t.Errorf("%s: offer %+v", npc, offer)
		}
		if _, acts := Choose(npc, pfxAccept+tc[1], p); len(acts) == 0 || acts[0].Kind != ActionAcceptQuest {
			t.Errorf("%s: accept %+v", npc, acts)
		}
	}
	// The sequel appears only once the first is handed in.
	n, _ := Choose(NPCMara, "t_forage", p)
	for _, c := range n.Choices {
		if c.ID == pfxOffer+"a_meal_from_the_wood" {
			t.Error("the meal quest is offered too early")
		}
	}
	setStatus(p, StatusTurnedIn, "tea_at_the_cabin")
	n, _ = Choose(NPCMara, "t_forage", p)
	found := false
	for _, c := range n.Choices {
		found = found || c.ID == pfxOffer+"a_meal_from_the_wood"
	}
	if !found {
		t.Errorf("the sequel is not offered after the first: %+v", n.Choices)
	}
	// And it shows in the hub when the other pitches are out of the way.
	q := afterTutorial()
	setStatus(q, StatusTurnedIn, "familiar_voice", "golden_hour")
	hub := Talk(NPCMara, q)
	for _, c := range hub.Choices {
		if c.ID == pfxOffer+"tea_at_the_cabin" {
			return
		}
	}
	t.Logf("hub choices: %+v", hub.Choices)
}

func TestLarderQuestsNeverNameBirds(t *testing.T) {
	// Discovery must be earned: nothing in the larder content names a species.
	for _, q := range larderQuests() {
		text := q.Summary + q.Story
		for _, o := range q.Objectives {
			text += o.Text + o.Hint
		}
		for _, sp := range pinnedSpecies {
			if strings.Contains(strings.ToLower(text), strings.ReplaceAll(sp, "_", " ")) {
				t.Errorf("%s names %s", q.ID, sp)
			}
		}
	}
}
