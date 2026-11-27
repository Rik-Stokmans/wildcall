package progress

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// The field kitchen (contract §12): eating and drinking for timed buffs, cooking,
// recipes, and the bookkeeping of foraging. The plant and recipe catalogs belong to
// internal/content, which this package does not import: functions that need a
// recipe take the proto.RecipeDef (the session looks it up with content.Recipe),
// and ValidateLarder checks the two catalogs against each other when handed both.
//
// Time: the only clock in this file is the `now` argument of Eat, ExpireBuffs,
// ActiveBuffs and ComputeStatsAt, the absolute game clock in hours,
// (day-1)*24 + time of day, the same unit as proto.Buff.Until.

// XP for the firsts of the field kitchen (spec §7.4: once, never for repeats).
const (
	XPPlant = 25 // first time a plant is picked and pressed into the herbarium
	XPCook  = 20 // first time a recipe is cooked

	SrcPlant = "plant" // XPLog source, key: plant id          once
	SrcCook  = "cook"  // XPLog source, key: recipe id         once
)

// MaxRegrowDays is the longest PlantDef.Regrow there may be. A forage record older
// than this is a plant that bears again whatever it is, so PruneForage may drop it.
const MaxRegrowDays = 8

// maxCookBatches caps one cook request, so a hand-made message cannot ask for an
// absurd quantity.
const maxCookBatches = 99

// startingRecipes are known from the beginning (contract §12).
var startingRecipes = []string{"pine_tip_tea", "mint_tea", "berry_oat_bars"}

// StartingRecipes returns the recipe ids a new naturalist knows.
func StartingRecipes() []string { return append([]string(nil), startingRecipes...) }

// ---------------------------------------------------------------------------
// Buffs

// ActiveBuffs returns copies of the buffs still running at the game clock now.
func ActiveBuffs(p *proto.Profile, now float64) []proto.Buff {
	var out []proto.Buff
	for _, b := range p.Buffs {
		if b.Until > now {
			out = append(out, cloneBuff(b))
		}
	}
	return out
}

func cloneBuff(b proto.Buff) proto.Buff {
	b.Mods = cloneMods(b.Mods)
	return b
}

// Eat eats or drinks one unit of a food, or of a raw ingredient that can be eaten
// as it is, from the backpack. It starts the item's buff, lasting its BuffDef.Hours
// from the game clock now, replacing whatever buff is running in the same slot
// (a new drink replaces the current drink; the slots do not affect each other).
// The new buff is returned. On failure the profile is unchanged.
func Eat(p *proto.Profile, itemID string, now float64) (proto.Buff, error) {
	def := itemIndex[itemID]
	if def == nil {
		return proto.Buff{}, fail(ErrUnknown, "There is no such item.")
	}
	if def.Use != UseEat || def.Buff == nil {
		return proto.Buff{}, fail(ErrInvalid, "The %s is not something you eat.", def.Name)
	}
	if Carried(p, itemID) <= 0 {
		if Stored(p, itemID) > 0 {
			return proto.Buff{}, fail(ErrNotOwned, "Your %s is in cabin storage.", def.Name)
		}
		return proto.Buff{}, fail(ErrNotOwned, "You have no %s left.", def.Name)
	}
	takeFromPack(p, itemID, 1)
	b := proto.Buff{
		Item: def.ID, Name: def.Name, Slot: def.Buff.Slot,
		Until: now + float64(def.Buff.Hours), Hours: def.Buff.Hours,
		Mods: cloneMods(def.Buff.Mods), Text: def.Buff.Text,
	}
	kept := p.Buffs[:0:0]
	for _, old := range p.Buffs {
		if old.Slot != b.Slot {
			kept = append(kept, old)
		}
	}
	p.Buffs = append(kept, b)
	Recompute(p)
	return cloneBuff(b), nil
}

// ExpireBuffs removes the buffs that have run out at the game clock now and
// recomputes the stats; it reports whether anything changed (so the session knows
// to push the profile). Call it on the tick.
func ExpireBuffs(p *proto.Profile, now float64) bool {
	kept := p.Buffs[:0:0]
	for _, b := range p.Buffs {
		if b.Until > now {
			kept = append(kept, b)
		}
	}
	if len(kept) == len(p.Buffs) {
		return false
	}
	p.Buffs = kept
	Recompute(p)
	return true
}

// ---------------------------------------------------------------------------
// Cooking

// KnowsRecipe reports whether the player has learned a recipe.
func KnowsRecipe(p *proto.Profile, recipeID string) bool { return containsString(p.Recipes, recipeID) }

// LearnRecipe teaches the player a recipe; false if they already knew it (or the id
// is empty). Triggers are the session's: the first pick of a plant for a
// "plant:<id>" recipe, a dialogue action for "npc:<id>", an unlocked lore entry for
// "lore:<id>" (content.RecipesLearnedBy lists the recipes of a trigger).
func LearnRecipe(p *proto.Profile, recipeID string) bool {
	if recipeID == "" || KnowsRecipe(p, recipeID) {
		return false
	}
	p.Recipes = append(p.Recipes, recipeID)
	return true
}

// CookResult is what a successful Cook produced.
type CookResult struct {
	Item      string // the food made
	Made      int    // units of it now in the pack
	FirstTime bool   // the first time this recipe was cooked (XP paid)
	XP        int    // XP granted, after Stats.XPMult (0 unless FirstTime)
	Levels    int    // levels gained from it
}

// MissingFor lists what the pack lacks to cook qty batches of a recipe, as
// item/shortfall pairs in recipe order (nil if nothing is missing).
func MissingFor(p *proto.Profile, recipe proto.RecipeDef, qty int) []proto.ItemStack {
	var out []proto.ItemStack
	for _, in := range recipe.Inputs {
		if short := in.Qty*max(qty, 1) - Carried(p, in.Item); short > 0 {
			out = append(out, proto.ItemStack{Item: in.Item, Qty: short})
		}
	}
	return out
}

// CanCook reports why qty batches of a recipe cannot be cooked right now, or nil:
// the recipe is known, the inputs are all in the backpack, and what is made fits in
// the backpack once the inputs are used up. It changes nothing. Whether the player
// stands at a kettle or a stove is the session's check.
func CanCook(p *proto.Profile, recipe proto.RecipeDef, qty int) error {
	if qty < 1 || qty > maxCookBatches {
		return fail(ErrInvalid, "Choose how many to make, from 1 to %d.", maxCookBatches)
	}
	if !KnowsRecipe(p, recipe.ID) {
		return fail(ErrRecipe, "You have not learned that recipe yet.")
	}
	out := itemIndex[recipe.Output]
	if out == nil || out.Kind != KindFood || recipe.Qty < 1 {
		return fail(ErrUnknown, "That recipe makes nothing you could eat.")
	}
	for _, in := range recipe.Inputs {
		if itemIndex[in.Item] == nil || in.Qty < 1 {
			return fail(ErrUnknown, "That recipe calls for something nobody has heard of.")
		}
	}
	if miss := MissingFor(p, recipe, qty); len(miss) > 0 {
		parts := make([]string, len(miss))
		for i, m := range miss {
			parts[i] = fmt.Sprintf("%d more %s", m.Qty, itemName(m.Item))
		}
		return fail(ErrIngredients, "For %s you still need %s.", out.Name, strings.Join(parts, " and "))
	}
	// Room: take the inputs out of a copy of the pack (their cells free up), then
	// see whether the food fits.
	if g := cookedPack(p, recipe, qty); g.Room(out.ID, recipe.Qty*qty) < recipe.Qty*qty {
		return fail(ErrPackFull, "There is no room in your pack for the %s. %s", out.Name, roomHint(g, out))
	}
	return nil
}

// cookedPack is the backpack with the inputs of qty batches taken out.
func cookedPack(p *proto.Profile, recipe proto.RecipeDef, qty int) *Grid {
	g := PackGrid(p)
	for _, in := range recipe.Inputs {
		g.Remove(in.Item, in.Qty*qty)
	}
	return g
}

// Cook makes qty batches of a recipe (each batch yields recipe.Qty units): the
// inputs leave the backpack and the food goes into it. The recipe must be known,
// the inputs carried and the result must fit in the backpack; otherwise nothing at
// all changes. The first cook of each recipe pays XPCook once through the anti-grind
// log; repeats pay nothing. Station and location (cabin, camp) are the session's
// check.
func Cook(p *proto.Profile, recipe proto.RecipeDef, qty int) (CookResult, error) {
	if err := CanCook(p, recipe, qty); err != nil {
		return CookResult{}, err
	}
	out := itemIndex[recipe.Output]
	g := cookedPack(p, recipe, qty)
	g.Add(out.ID, recipe.Qty*qty)
	p.Inventory = g.Stacks
	res := CookResult{Item: out.ID, Made: recipe.Qty * qty}
	before := p.Level
	if xp := AwardXP(p, SrcCook, recipe.ID, XPCook); xp > 0 {
		res.FirstTime, res.XP = true, xp
	}
	res.Levels = p.Level - before
	Recompute(p)
	return res, nil
}

// ---------------------------------------------------------------------------
// Foraging

// ForageRoom is how many units of an item the backpack can still take as it is
// packed now (at most 999).
func ForageRoom(p *proto.Profile, itemID string) int {
	def := itemIndex[itemID]
	if def == nil {
		return 0
	}
	return PackGrid(p).Room(itemID, 999)
}

// AddForage puts picked ingredients into the backpack, stacking onto existing
// stacks first, then new stacks wherever they fit. Unlike AddItem nothing
// overflows to cabin storage — a forager far from home simply carries what fits:
// added is how many went in (up to qty), and ErrPackFull comes back, changing
// nothing, if not even one fits; its message says what would make room ("Your pack
// is full: no room for the Blackberry. Taking out the Field Stool & Scrim would
// make room.").
func AddForage(p *proto.Profile, itemID string, qty int) (added int, err error) {
	def := itemIndex[itemID]
	if def == nil {
		return 0, fail(ErrUnknown, "There is no such item.")
	}
	if def.Kind != KindIngredient {
		return 0, fail(ErrInvalid, "The %s is not something you gather.", def.Name)
	}
	if qty <= 0 {
		return 0, fail(ErrInvalid, "Nothing to pick.")
	}
	g := PackGrid(p)
	left := g.Add(itemID, qty)
	if left == qty {
		return 0, packFull(PackGrid(p), def)
	}
	p.Inventory = g.Stacks
	Recompute(p)
	return qty - left, nil
}

// ForageReady reports whether a forage node bears fruit: it was never picked, or
// was picked at least regrow in-game days before day.
func ForageReady(p *proto.Profile, nodeID string, day, regrow int) bool {
	picked, ok := p.Forage[nodeID]
	return !ok || day-picked >= regrow
}

// MarkForaged records that a forage node was picked on a day.
func MarkForaged(p *proto.Profile, nodeID string, day int) {
	if p.Forage == nil {
		p.Forage = map[string]int{}
	}
	p.Forage[nodeID] = day
}

// PruneForage drops the forage records old enough that the plant has certainly
// regrown (MaxRegrowDays), keeping the save small, and returns how many it dropped.
func PruneForage(p *proto.Profile, day int) int {
	n := 0
	for id, picked := range p.Forage {
		if day-picked >= MaxRegrowDays {
			delete(p.Forage, id)
			n++
		}
	}
	return n
}

// RecordForage enters a picked plant in the herbarium (Journal.Plants): the first
// pick creates the entry, with the day and region type, and pays XPPlant once
// through the anti-grind log; every pick counts in Picked. first is true the first
// time; xp is what was granted after Stats.XPMult.
func RecordForage(p *proto.Profile, plantID string, region, day int) (first bool, xp, levels int) {
	if plantID == "" {
		return false, 0, 0
	}
	if p.Journal.Plants == nil {
		p.Journal.Plants = map[string]*proto.PlantEntry{}
	}
	e := p.Journal.Plants[plantID]
	if e == nil {
		e = &proto.PlantEntry{ID: plantID, FirstDay: day, Region: region}
		p.Journal.Plants[plantID] = e
		first = true
	}
	e.Picked++
	before := p.Level
	xp = AwardXP(p, SrcPlant, plantID, XPPlant)
	return first, xp, p.Level - before
}

// ---------------------------------------------------------------------------
// Migration

// MigrateLarder fills in what a profile saved before the field kitchen lacks: the
// maps and slices (nil would marshal as null), the starting recipes, and a clean
// buff list (well-formed buffs only, at most one per slot — the longest-lasting).
// It never takes a recipe or a record away. Normalize calls it.
func MigrateLarder(p *proto.Profile) {
	if p.Forage == nil {
		p.Forage = map[string]int{}
	}
	if p.Journal.Plants == nil {
		p.Journal.Plants = map[string]*proto.PlantEntry{}
	}
	if p.Journal.Nests == nil {
		p.Journal.Nests = []*proto.NestEntry{}
	}
	if p.Recipes == nil {
		p.Recipes = []string{}
	}
	for _, id := range startingRecipes {
		LearnRecipe(p, id)
	}

	buffs := []proto.Buff{}
	for _, slot := range buffSlots {
		var best *proto.Buff
		for i := range p.Buffs {
			b := &p.Buffs[i]
			if b.Slot != slot || math.IsNaN(b.Until) || math.IsInf(b.Until, 0) || len(b.Mods) == 0 {
				continue
			}
			if best == nil || b.Until > best.Until {
				best = b
			}
		}
		if best != nil {
			c := cloneBuff(*best)
			buffs = append(buffs, c)
		}
	}
	p.Buffs = buffs
}

// ---------------------------------------------------------------------------
// Validation against the content catalogs

// foodSlots pins the buff slot of each food (contract §12: teas and cordials are
// drinks, then snacks, then meals).
var foodSlots = func() map[string]string {
	m := map[string]string{}
	for i, id := range foodItems {
		switch {
		case i < 9:
			m[id] = SlotDrink
		case i < 14:
			m[id] = SlotSnack
		default:
			m[id] = SlotMeal
		}
	}
	return m
}()

// ValidateLarder checks the plant and recipe catalogs of internal/content against
// this package's items and returns every problem found (nil means all is well):
// every yield of every plant is a foraged ingredient that exists, every foraged
// ingredient has a plant, every recipe's inputs are ingredients and its output a
// food, every food has a recipe, the starting recipes are the pinned three, and the
// learn rules are well-formed. Validate checks the item catalog itself.
func ValidateLarder(recipes []proto.RecipeDef, plants []proto.PlantDef) []error {
	var errs []error
	bad := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }

	foraged := toSet(foragedIngredients)
	plantIDs := map[string]bool{}
	yielded := map[string]bool{}
	for _, pl := range plants {
		w := "plant " + pl.ID
		if pl.ID == "" || plantIDs[pl.ID] {
			bad("%s: empty or duplicate id", w)
		}
		plantIDs[pl.ID] = true
		if pl.Regrow < 1 || pl.Regrow > MaxRegrowDays {
			bad("%s: regrow %d days, want 1..%d", w, pl.Regrow, MaxRegrowDays)
		}
		if len(pl.Yields) == 0 {
			bad("%s: yields nothing", w)
		}
		for _, y := range pl.Yields {
			it := itemIndex[y.Item]
			switch {
			case it == nil:
				bad("%s: yield item %q does not exist", w, y.Item)
			case !foraged[y.Item]:
				bad("%s: yield %q is not a foraged ingredient", w, y.Item)
			default:
				yielded[y.Item] = true
			}
			if y.Min < 1 || y.Max < y.Min || y.Max > 3 {
				bad("%s: yield %s of %d..%d, want 1..3", w, y.Item, y.Min, y.Max)
			}
			if !y.Seasons[0] && !y.Seasons[1] && !y.Seasons[2] && !y.Seasons[3] {
				bad("%s: yield %s has no season", w, y.Item)
			}
		}
	}
	if len(plants) > 0 {
		for _, id := range foragedIngredients {
			if !yielded[id] {
				bad("foraged ingredient %q is yielded by no plant", id)
			}
		}
	}

	known := map[string]bool{}
	made := map[string]bool{}
	var starts []string
	for _, r := range recipes {
		w := "recipe " + r.ID
		if r.ID == "" || known[r.ID] {
			bad("%s: empty or duplicate id", w)
		}
		known[r.ID] = true
		if strings.TrimSpace(r.Name) == "" || strings.TrimSpace(r.Desc) == "" {
			bad("%s: incomplete text", w)
		}
		if r.Station != "kettle" && r.Station != "stove" {
			bad("%s: station %q, want kettle or stove", w, r.Station)
		}
		out := itemIndex[r.Output]
		if out == nil || out.Kind != KindFood {
			bad("%s: output %q is not a food item", w, r.Output)
		} else {
			made[r.Output] = true
		}
		if r.Qty < 1 || r.Qty > 4 {
			bad("%s: makes %d, want 1..4", w, r.Qty)
		}
		if len(r.Inputs) == 0 {
			bad("%s: no inputs", w)
		}
		seen := map[string]bool{}
		for _, in := range r.Inputs {
			it := itemIndex[in.Item]
			switch {
			case it == nil || it.Kind != KindIngredient:
				bad("%s: input %q is not an ingredient item", w, in.Item)
			case seen[in.Item]:
				bad("%s: input %q listed twice", w, in.Item)
			}
			seen[in.Item] = true
			if in.Qty < 1 || in.Qty > 6 {
				bad("%s: input %s x%d, want 1..6", w, in.Item, in.Qty)
			}
		}
		switch kind, arg, _ := strings.Cut(r.Learn, ":"); {
		case r.Learn == "start":
			starts = append(starts, r.ID)
		case kind == "plant" && len(plants) > 0:
			if !plantIDs[arg] {
				bad("%s: learned from unknown plant %q", w, arg)
			}
		case kind == "plant" || kind == "npc" || kind == "lore":
			if arg == "" {
				bad("%s: learn rule %q has no id", w, r.Learn)
			}
		default:
			bad("%s: learn rule %q", w, r.Learn)
		}
	}
	for _, id := range foodItems {
		if len(recipes) > 0 && !made[id] {
			bad("food %q has no recipe", id)
		}
	}
	if len(recipes) > 0 {
		sort.Strings(starts)
		want := append([]string(nil), startingRecipes...)
		sort.Strings(want)
		if strings.Join(starts, ",") != strings.Join(want, ",") {
			bad("starting recipes are %v, want %v", starts, want)
		}
	}
	return errs
}
