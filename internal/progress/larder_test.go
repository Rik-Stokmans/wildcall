package progress

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// testRecipe is a small known recipe for the cooking tests.
func testRecipe(id string) proto.RecipeDef {
	return proto.RecipeDef{
		ID: id, Name: "Test", Desc: "d", Station: "kettle", Output: "pine_tip_tea", Qty: 2,
		Inputs: []proto.ItemStack{{Item: "pine_tips", Qty: 2}},
		Learn:  "start",
	}
}

func TestLarderItemsExistAndAreWellFormed(t *testing.T) {
	if len(ForagedIngredients()) != 19 || len(PantryIngredients()) != 3 || len(FoodItems()) != 19 {
		t.Fatalf("counts: %d foraged, %d pantry, %d food", len(ForagedIngredients()), len(PantryIngredients()), len(FoodItems()))
	}
	for _, id := range append(ForagedIngredients(), PantryIngredients()...) {
		it, ok := Item(id)
		if !ok || it.Kind != KindIngredient || it.Stack != 20 {
			t.Errorf("ingredient %s: %+v", id, it)
		}
	}
	for _, id := range FoodItems() {
		it, ok := Item(id)
		if !ok || it.Kind != KindFood || it.Stack != 8 || it.Use != UseEat || it.Buff == nil {
			t.Errorf("food %s: %+v", id, it)
		}
	}
	for _, id := range PantryIngredients() {
		if it, _ := Item(id); it.Price <= 0 {
			t.Errorf("%s is not in the shop", id)
		}
	}
	shop := map[string]bool{}
	for _, id := range ShopItems() {
		shop[id] = true
	}
	for _, id := range PantryIngredients() {
		if !shop[id] {
			t.Errorf("%s missing from ShopItems", id)
		}
	}
	for _, id := range ForagedIngredients() {
		if shop[id] {
			t.Errorf("%s must not be sold", id)
		}
	}
	// Raw berries and nuts can be eaten; elderberries and rosehips cannot.
	for _, id := range []string{"blackberry", "wild_strawberry", "bilberry", "hazelnut", "cloudberry", "sea_buckthorn"} {
		if it, _ := Item(id); it.Use != UseEat || it.Buff.Slot != SlotSnack || it.Buff.Hours > 1.5 {
			t.Errorf("%s should be a short raw snack: %+v", id, it.Buff)
		}
	}
	for _, id := range []string{"elderberry", "rosehip", "chestnut", "nettle", "chanterelle"} {
		if it, _ := Item(id); it.Use != "" || it.Buff != nil {
			t.Errorf("%s is not edible raw", id)
		}
	}
}

func TestBuffsAreModestAndHonest(t *testing.T) {
	// Validate does the bounds; here, spot-check the flavour of §12.
	cases := map[string]string{
		"pine_tip_tea": "camStability", "mint_tea": "hearRange", "chamomile_tea": "settle",
		"bilberry_tart": "lowLight", "berry_oat_bars": "stamina", "nettle_soup": "rainProof",
	}
	for id, stat := range cases {
		it, _ := Item(id)
		if it.Buff.Mods[stat] == 0 {
			t.Errorf("%s should modify %s: %v", id, stat, it.Buff.Mods)
		}
	}
	if it, _ := Item("chamomile_tea"); it.Buff.Mods["stealth"] >= 0 {
		t.Error("chamomile should make the approach quieter (stealth down)")
	}
	slots := map[string][2]float32{SlotDrink: {2, 3}, SlotSnack: {2, 4}, SlotMeal: {4, 6}}
	for _, id := range FoodItems() {
		it, _ := Item(id)
		r := slots[it.Buff.Slot]
		if it.Buff.Hours < r[0] || it.Buff.Hours > r[1] {
			t.Errorf("%s: %g hours in slot %s", id, it.Buff.Hours, it.Buff.Slot)
		}
	}
}

func TestEatAppliesBuffAndExpires(t *testing.T) {
	p := NewProfile("t")
	base := p.Stats
	AddItem(p, "pine_tip_tea", 2)
	b, err := Eat(p, "pine_tip_tea", 30)
	if err != nil {
		t.Fatal(err)
	}
	if b.Slot != SlotDrink || b.Until != 33 || b.Hours != 3 || b.Item != "pine_tip_tea" {
		t.Errorf("buff %+v", b)
	}
	if Carried(p, "pine_tip_tea") != 1 || len(p.Buffs) != 1 {
		t.Fatalf("inventory %+v buffs %+v", p.Inventory, p.Buffs)
	}
	if p.Stats.CamStability <= base.CamStability || p.Stats.BinoStability <= base.BinoStability {
		t.Errorf("stats unchanged: %+v", p.Stats)
	}
	// ComputeStatsAt ignores a buff that has run out without touching the profile.
	if got := ComputeStatsAt(p, 34); got != base {
		t.Errorf("stats at 34 should be the base: %+v", got)
	}
	if len(p.Buffs) != 1 {
		t.Error("ComputeStatsAt changed the profile")
	}
	if ExpireBuffs(p, 32.9) {
		t.Error("expired early")
	}
	if !ExpireBuffs(p, 33) {
		t.Fatal("did not expire at its end")
	}
	if len(p.Buffs) != 0 || p.Stats != base {
		t.Errorf("after expiry: %+v %+v", p.Buffs, p.Stats)
	}
	if ExpireBuffs(p, 40) {
		t.Error("nothing left to expire")
	}
}

func TestBuffsReplaceWithinSlotAndStackAcrossSlots(t *testing.T) {
	p := NewProfile("t")
	for _, id := range []string{"pine_tip_tea", "mint_tea", "berry_oat_bars", "nettle_soup"} {
		if _, err := AddItem(p, id, 1); err != nil {
			t.Fatal(err)
		}
	}
	Eat(p, "pine_tip_tea", 10)
	steady := p.Stats
	Eat(p, "mint_tea", 11) // a second drink replaces the first
	if len(p.Buffs) != 1 || p.Buffs[0].Item != "mint_tea" {
		t.Fatalf("drink slot: %+v", p.Buffs)
	}
	if p.Stats.CamStability != core.BaseStats().CamStability || p.Stats.HearRange <= steady.HearRange {
		t.Errorf("old drink still counts: %+v", p.Stats)
	}
	Eat(p, "berry_oat_bars", 11)
	Eat(p, "nettle_soup", 11)
	if len(p.Buffs) != 3 {
		t.Fatalf("slots should stack: %+v", p.Buffs)
	}
	b := BaseStats()
	if p.Stats.HearRange <= b.HearRange || p.Stats.MoveSpeed <= b.MoveSpeed || p.Stats.RainProof <= b.RainProof {
		t.Errorf("stacked stats: %+v", p.Stats)
	}
	// stamina: 2 (bars) + 2 (soup)
	if want := b.Stamina + 4; p.Stats.Stamina != want {
		t.Errorf("stamina %v, want %v", p.Stats.Stamina, want)
	}
	// Buffs expire one by one.
	ExpireBuffs(p, 14.5) // drink (3h from 11) is over
	if len(p.Buffs) != 2 {
		t.Errorf("after the drink ran out: %+v", p.Buffs)
	}
	ExpireBuffs(p, 40)
	if len(p.Buffs) != 0 || p.Stats != b {
		t.Errorf("everything should be over: %+v", p.Stats)
	}
}

func TestEatRules(t *testing.T) {
	p := NewProfile("t")
	snap := snapshot(t, p)
	_, err := Eat(p, "mint_tea", 1)
	wantErr(t, err, ErrNotOwned)
	_, err = Eat(p, "nonsense", 1)
	wantErr(t, err, ErrUnknown)
	_, err = Eat(p, "film_roll", 1)
	wantErr(t, err, ErrInvalid)
	AddItem(p, "elderberry", 1)
	_, err = Eat(p, "elderberry", 1)
	wantErr(t, err, ErrInvalid) // cooked only
	if _, err := UseItem(p, "mint_tea"); err == nil {
		t.Error("UseItem must not eat: it has no clock")
	}
	if snapshot(t, p) == snap {
		t.Fatal("test setup: elderberry should have been added")
	}
	// In storage only.
	q := NewProfile("t")
	q.Storage = []proto.ItemStack{{Item: "mint_tea", Qty: 1}}
	_, err = Eat(q, "mint_tea", 1)
	wantErr(t, err, ErrNotOwned)
	if len(q.Buffs) != 0 || len(q.Storage) != 1 {
		t.Error("failed eat changed the profile")
	}
	// A raw berry is a short snack.
	AddItem(p, "bilberry", 3)
	b, err := Eat(p, "bilberry", 5)
	if err != nil || b.Slot != SlotSnack || b.Until != 6 {
		t.Errorf("%+v %v", b, err)
	}
	if Carried(p, "bilberry") != 2 {
		t.Error("one berry should be eaten")
	}
}

func TestBuffedStatsStayClamped(t *testing.T) {
	p := NewProfile("t")
	p.Buffs = []proto.Buff{
		{Item: "x", Slot: SlotDrink, Until: 99, Mods: map[string]float32{"stamina": 500, "packH": -50, "capacity": 70}},
	}
	Recompute(p)
	_, hi, _ := StatLimits("stamina")
	lo, _, _ := StatLimits("packH")
	if p.Stats.Stamina != hi || p.Stats.PackH != lo || p.Stats.Capacity != 5*lo {
		t.Errorf("stamina %v packH %v capacity %v", p.Stats.Stamina, p.Stats.PackH, p.Stats.Capacity)
	}
}

func TestCookConsumesInputsAndPaysFirstTimeXPOnce(t *testing.T) {
	p := NewProfile("t")
	AddItem(p, "pine_tips", 5)
	r := testRecipe("pine_tip_tea")
	xp0 := p.XPTotal
	res, err := Cook(p, r, 2)
	if err != nil {
		t.Fatal(err)
	}
	if res.Item != "pine_tip_tea" || res.Made != 4 || !res.FirstTime || res.XP != XPCook || p.XPTotal != xp0+XPCook {
		t.Errorf("result %+v xp %d", res, p.XPTotal)
	}
	if Carried(p, "pine_tips") != 1 || Carried(p, "pine_tip_tea") != 4 {
		t.Errorf("inventory %+v", p.Inventory)
	}
	res, err = Cook(p, r, 0+1) // only one pine_tips left: needs 2
	wantErr(t, err, ErrIngredients)
	AddItem(p, "pine_tips", 3)
	res, err = Cook(p, r, 1)
	if err != nil || res.FirstTime || res.XP != 0 {
		t.Errorf("repeat cook %+v %v", res, err)
	}
	if p.XPTotal != xp0+XPCook {
		t.Error("repeat cooking paid XP")
	}
	// Doubled XP multiplier scales the one-off payment.
	q := NewProfile("t")
	AddItem(q, "pine_tips", 2)
	q.Stats.XPMult = 2
	if res, _ := Cook(q, r, 1); res.XP != 2*XPCook {
		t.Errorf("scaled XP %d", res.XP)
	}
}

func TestCookRefusals(t *testing.T) {
	p := NewProfile("t")
	AddItem(p, "pine_tips", 4)
	snap := snapshot(t, p)

	_, err := Cook(p, testRecipe("not_learned"), 1)
	wantErr(t, err, ErrRecipe)
	_, err = Cook(p, testRecipe("pine_tip_tea"), 0)
	wantErr(t, err, ErrInvalid)
	_, err = Cook(p, testRecipe("pine_tip_tea"), 3) // needs 6, has 4
	wantErr(t, err, ErrIngredients)
	bad := testRecipe("pine_tip_tea")
	bad.Output = "film_roll"
	_, err = Cook(p, bad, 1)
	wantErr(t, err, ErrUnknown)
	if snapshot(t, p) != snap {
		t.Fatal("a refused cook changed the profile")
	}
	if miss := MissingFor(p, testRecipe("pine_tip_tea"), 3); len(miss) != 1 || miss[0].Qty != 2 {
		t.Errorf("missing %+v", miss)
	}
}

func TestCookRespectsCapacity(t *testing.T) {
	p := NewProfile("t")
	AddItem(p, "pine_tips", 2)
	for _, id := range []string{"headphones", "pocket_guide", "pocket_barometer", "field_stool", "film_roll", "seed_mix"} {
		if _, err := AddItem(p, id, 1); err != nil {
			t.Fatal(err)
		}
	}
	fillPack(p, "nettle", 20)
	if FreeSlots(p) != 0 {
		t.Fatalf("setup: %d free", FreeSlots(p))
	}
	// The pack is full, but the inputs free a cell: the teas take it.
	if _, err := Cook(p, testRecipe("pine_tip_tea"), 1); err != nil {
		t.Fatal(err)
	}
	if !PackGrid(p).Valid() || Carried(p, "pine_tip_tea") == 0 {
		t.Fatalf("after cooking: %+v", p.Inventory)
	}
	// A truly full pack, one cell of it a big stack of tips.
	q := NewProfile("t")
	AddItem(q, "pine_tips", 20)
	for _, id := range []string{"headphones", "pocket_guide", "pocket_barometer", "field_stool", "film_roll", "seed_mix"} {
		AddItem(q, id, 1)
	}
	fillPack(q, "nettle", 20)
	r := testRecipe("pine_tip_tea")
	r.Inputs = []proto.ItemStack{{Item: "pine_tips", Qty: 1}}
	snap := snapshot(t, q)
	// One tip out of twenty frees no cell, and the tea has nowhere to go.
	_, err := Cook(q, r, 1)
	wantErr(t, err, ErrPackFull)
	if snapshot(t, q) != snap {
		t.Error("a pack-full cook changed the profile")
	}
	// Using up the whole stack frees its cell for the tea.
	r.Inputs = []proto.ItemStack{{Item: "pine_tips", Qty: 20}}
	if _, err := Cook(q, r, 1); err != nil {
		t.Errorf("using up the stack should leave room: %v", err)
	}
	if !PackGrid(q).Valid() {
		t.Errorf("pack %+v", q.Inventory)
	}
}

func TestLearnRecipe(t *testing.T) {
	p := NewProfile("t")
	if got := p.Recipes; !reflect.DeepEqual(got, StartingRecipes()) {
		t.Fatalf("starting recipes %v", got)
	}
	if !LearnRecipe(p, "nettle_tea") || LearnRecipe(p, "nettle_tea") || LearnRecipe(p, "") {
		t.Error("learn should report newness once")
	}
	if !KnowsRecipe(p, "nettle_tea") || KnowsRecipe(p, "forager_stew") {
		t.Error("KnowsRecipe")
	}
}

func TestAddForageStacksAndRespectsCapacity(t *testing.T) {
	p := NewProfile("t")
	if n, err := AddForage(p, "blackberry", 3); err != nil || n != 3 {
		t.Fatalf("%d %v", n, err)
	}
	if n, _ := AddForage(p, "blackberry", 2); n != 2 || len(p.Inventory) != 1 || p.Inventory[0].Qty != 5 {
		t.Errorf("stacking: %+v", p.Inventory)
	}
	// Fill to the brim around the nearly full stack.
	for _, id := range []string{"headphones", "pocket_guide", "pocket_barometer", "field_stool", "film_roll", "seed_mix"} {
		AddItem(p, id, 1)
	}
	fillPack(p, "nettle", 20)
	if room := ForageRoom(p, "blackberry"); room != 15 {
		t.Errorf("room %d", room)
	}
	if n, err := AddForage(p, "blackberry", 30); err != nil || n != 15 {
		t.Errorf("partial: %d %v", n, err)
	}
	snap := snapshot(t, p)
	_, err := AddForage(p, "blackberry", 1)
	wantErr(t, err, ErrPackFull)
	_, err = AddForage(p, "hazelnut", 1)
	wantErr(t, err, ErrPackFull)
	if !strings.Contains(err.Error(), "Taking out the ") {
		t.Errorf("a full pack should say what would make room: %q", err)
	}
	_, err = AddForage(p, "film_roll", 1)
	wantErr(t, err, ErrInvalid)
	_, err = AddForage(p, "nope", 1)
	wantErr(t, err, ErrUnknown)
	if snapshot(t, p) != snap {
		t.Error("failed forage changed the profile")
	}
	// Foraged items never overflow to storage.
	if Stored(p, "blackberry") != 0 {
		t.Error("forage overflowed to storage")
	}
}

func TestForageRegrowAndHerbarium(t *testing.T) {
	p := NewProfile("t")
	if !ForageReady(p, "fg@1,2,3", 5, 4) {
		t.Error("an untouched plant should bear")
	}
	MarkForaged(p, "fg@1,2,3", 5)
	if ForageReady(p, "fg@1,2,3", 8, 4) || !ForageReady(p, "fg@1,2,3", 9, 4) {
		t.Error("regrow after 4 days")
	}
	MarkForaged(p, "fg@1,2,4", 1)
	if n := PruneForage(p, 9); n != 1 || len(p.Forage) != 1 {
		t.Errorf("prune %d: %v", n, p.Forage)
	}

	xp0 := p.XPTotal
	first, xp, _ := RecordForage(p, "bramble", 0, 3)
	if !first || xp != XPPlant || p.XPTotal != xp0+XPPlant {
		t.Errorf("first pick: %v %d", first, xp)
	}
	first, xp, _ = RecordForage(p, "bramble", 0, 9)
	e := p.Journal.Plants["bramble"]
	if first || xp != 0 || e.Picked != 2 || e.FirstDay != 3 || p.XPTotal != xp0+XPPlant {
		t.Errorf("second pick: %v %d %+v", first, xp, e)
	}
}

func TestMigrationOfAnOldProfile(t *testing.T) {
	// A profile as saved before the field kitchen: none of the new keys.
	old := `{"name":"Old","level":4,"rank":2,"credits":300,"inventory":[{"item":"film_roll","qty":3}],
	"journal":{"species":{},"lore":["listen_first"]}}`
	var p proto.Profile
	if err := json.Unmarshal([]byte(old), &p); err != nil {
		t.Fatal(err)
	}
	if p.Buffs != nil || p.Forage != nil || p.Recipes != nil {
		t.Fatal("test setup: new fields should be absent")
	}
	Normalize(&p)
	if p.Buffs == nil || p.Forage == nil || p.Journal.Plants == nil || p.Journal.Nests == nil {
		t.Errorf("nil fields: %+v", p)
	}
	if !reflect.DeepEqual(p.Recipes, StartingRecipes()) {
		t.Errorf("recipes %v", p.Recipes)
	}
	if p.Level != 4 || p.Credits != 300 || Carried(&p, "film_roll") != 3 {
		t.Error("migration changed existing data")
	}
	b, _ := json.Marshal(&p)
	var m map[string]any
	json.Unmarshal(b, &m)
	for _, k := range []string{"buffs", "forage", "recipes"} {
		if m[k] == nil {
			t.Errorf("%s marshals as null", k)
		}
	}
	// Idempotent, and it never takes a learned recipe away.
	LearnRecipe(&p, "nettle_tea")
	Normalize(&p)
	Normalize(&p)
	if !KnowsRecipe(&p, "nettle_tea") || len(p.Recipes) != 4 {
		t.Errorf("recipes %v", p.Recipes)
	}
}

func TestMigrationCleansBuffs(t *testing.T) {
	p := NewProfile("t")
	p.Buffs = []proto.Buff{
		{Item: "a", Slot: SlotDrink, Until: 10, Mods: map[string]float32{"stamina": 1}},
		{Item: "b", Slot: SlotDrink, Until: 12, Mods: map[string]float32{"stamina": 2}},
		{Item: "c", Slot: "bogus", Until: 12, Mods: map[string]float32{"stamina": 2}},
		{Item: "d", Slot: SlotMeal, Until: 12},
	}
	Normalize(p)
	if len(p.Buffs) != 1 || p.Buffs[0].Item != "b" {
		t.Errorf("buffs %+v", p.Buffs)
	}
}

func TestBuyPantryStaples(t *testing.T) {
	p := NewProfile("t")
	for i := 0; i < 3; i++ {
		if err := Buy(p, "oats"); err != nil {
			t.Fatal(err)
		}
	}
	if Carried(p, "oats") != 3 || len(p.Inventory) != 1 || p.Credits != StartingCredits-12 {
		t.Errorf("%+v credits %d", p.Inventory, p.Credits)
	}
	wantErr(t, Buy(p, "blackberry"), ErrNotForSale)
}

func TestProfileWithBuffsRoundTrips(t *testing.T) {
	p := NewProfile("t")
	AddItem(p, "mint_tea", 1)
	Eat(p, "mint_tea", 12.5)
	Normalize(p)
	b, _ := json.Marshal(p)
	var q proto.Profile
	if err := json.Unmarshal(b, &q); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(p, &q) {
		t.Errorf("round trip differs:\n%s", b)
	}
	Normalize(&q)
	if q.Stats != p.Stats {
		t.Error("buffed stats changed on load")
	}
}

func TestValidateLarderCatchesBadCatalogs(t *testing.T) {
	good := []proto.RecipeDef{testRecipe("pine_tip_tea")}
	if errs := ValidateLarder(good, nil); len(errs) == 0 {
		t.Error("a catalog missing most foods and starting recipes should be reported")
	}
	badPlant := []proto.PlantDef{{ID: "x", Regrow: 2, Yields: []proto.PlantYield{{Item: "ghost", Seasons: [4]bool{true}, Min: 1, Max: 2}}}}
	if errs := ValidateLarder(nil, badPlant); len(errs) == 0 {
		t.Error("missing yield item not reported")
	}
	badRecipe := testRecipe("x")
	badRecipe.Learn = "magic"
	badRecipe.Inputs = []proto.ItemStack{{Item: "film_roll", Qty: 1}}
	badRecipe.Station = "oven"
	if errs := ValidateLarder([]proto.RecipeDef{badRecipe}, nil); len(errs) < 3 {
		t.Errorf("want several problems, got %v", errs)
	}
}
