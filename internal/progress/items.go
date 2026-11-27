package progress

import (
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// The item catalog (spec §9, §10). It is authored in the items_*.go files, one per
// family, and assembled here in display order: equipment slot by slot and tier by
// tier, then gadgets, the keepsake and supplies.
//
// Design rules the data follows (Validate enforces them):
//   - The starting kit has no modifiers at all, so core.BaseStats() IS the beginner
//     experience and every other item reads as a change from it.
//   - Every tier 2+ piece of equipment gives something up (spec §9.3, rule 4:
//     equipment changes playstyle). Its Mods contain at least one modifier that
//     makes a stat worse, and its Cons say so in words.
//   - Tier 4 items are unique finds: never sold, each with a history and something
//     only it does.
//   - Gadgets and keepsakes work while carried, and take room in the backpack grid
//     (every item has a footprint in cells: items_size.go).
var items = buildItems()

func buildItems() []proto.ItemDef {
	var all []proto.ItemDef
	for _, family := range [][]proto.ItemDef{
		opticsItems(), cameraItems(), audioItems(),
		backpackItems(), navigationItems(), clothingItems(),
		gadgetItems(), keepsakeItems(), supplyItems(),
		ingredientItems(), foodItemDefs(),
	} {
		all = append(all, family...)
	}
	// The client iterates these without nil checks: never send null.
	for i := range all {
		it := &all[i]
		if it.Mods == nil {
			it.Mods = mods{}
		}
		if it.Pros == nil {
			it.Pros = []string{}
		}
		if it.Cons == nil {
			it.Cons = []string{}
		}
		if it.Upgrades == nil {
			it.Upgrades = []proto.UpgradeDef{}
		}
		for j := range it.Upgrades {
			if it.Upgrades[j].Mods == nil {
				it.Upgrades[j].Mods = mods{}
			}
			if it.Upgrades[j].ReqRank == 0 {
				it.Upgrades[j].ReqRank = 1
			}
		}
		if it.ReqRank == 0 {
			it.ReqRank = 1
		}
	}
	applyFootprints(all)
	return all
}

var itemIndex = func() map[string]*proto.ItemDef {
	idx := make(map[string]*proto.ItemDef, len(items))
	for i := range items {
		idx[items[i].ID] = &items[i]
	}
	return idx
}()

// startingKit is what a new naturalist wears (contract §3.4). The audio slot is
// empty on purpose: Mara hands over the basic recorder during "The Unseen Singer".
var startingKit = map[string]string{
	SlotOptics:     "basic_binoculars",
	SlotCamera:     "starter_camera",
	SlotBackpack:   "canvas_satchel",
	SlotNavigation: "trail_map",
	SlotClothing:   "field_clothes",
}

// StartingKit returns the equipment a new profile starts with (slot → item id).
func StartingKit() map[string]string {
	out := make(map[string]string, len(startingKit))
	for k, v := range startingKit {
		out[k] = v
	}
	return out
}

// pinnedItems are the item ids other packages reference (contract §3.4).
var pinnedItems = []string{
	"basic_binoculars", "starter_camera", "canvas_satchel", "trail_map", "field_clothes",
	"basic_recorder", "explorer_binoculars",
	"forgotten_journal", "historical_binoculars", "vintage_recorder",
	"explorers_lens", "naturalists_compass", "research_backpack",
	"film_roll", "seed_mix",
}

// PinnedItems returns the item ids the contract pins.
func PinnedItems() []string { return append([]string(nil), pinnedItems...) }

// Items returns the whole item catalog (a deep copy) in display order.
func Items() []proto.ItemDef {
	out := make([]proto.ItemDef, len(items))
	for i := range items {
		out[i] = cloneItem(&items[i])
	}
	return out
}

// Item looks up an item definition. Treat the result (its maps and slices) as
// read-only.
func Item(id string) (proto.ItemDef, bool) {
	d := itemIndex[id]
	if d == nil {
		return proto.ItemDef{}, false
	}
	return *d, true
}

// Upgrade looks up one upgrade of an item. Treat the result as read-only.
func Upgrade(itemID, upgradeID string) (proto.UpgradeDef, bool) {
	if u := findUpgrade(itemIndex[itemID], upgradeID); u != nil {
		return *u, true
	}
	return proto.UpgradeDef{}, false
}

func findUpgrade(d *proto.ItemDef, upgradeID string) *proto.UpgradeDef {
	if d == nil {
		return nil
	}
	for i := range d.Upgrades {
		if d.Upgrades[i].ID == upgradeID {
			return &d.Upgrades[i]
		}
	}
	return nil
}

// stackable reports whether items of this kind stack in the backpack and may be
// held in any number (supplies, ingredients and food); everything else is a
// one-of-a-kind piece of kit.
func stackable(def *proto.ItemDef) bool {
	return def.Kind == KindSupply || def.Kind == KindIngredient || def.Kind == KindFood
}

// ShopItems returns the ids Finn sells, in display order: every item with a price.
// Starting-kit items are not stocked (they cannot be lost, so nobody needs a second
// pair) and unique finds are never for sale. Whether the player may buy a listed
// item yet (rank, reputation, credits) is Buy's business.
func ShopItems() []string {
	var out []string
	for i := range items {
		if items[i].Price > 0 {
			out = append(out, items[i].ID)
		}
	}
	return out
}

func cloneItem(d *proto.ItemDef) proto.ItemDef {
	c := *d
	c.Mods = cloneMods(d.Mods)
	if d.Buff != nil {
		b := *d.Buff
		b.Mods = cloneMods(d.Buff.Mods)
		c.Buff = &b
	}
	c.Pros = append([]string{}, d.Pros...)
	c.Cons = append([]string{}, d.Cons...)
	c.Upgrades = make([]proto.UpgradeDef, len(d.Upgrades))
	for i, u := range d.Upgrades {
		u.Mods = cloneMods(u.Mods)
		c.Upgrades[i] = u
	}
	return c
}

// up builds an upgrade definition; rank and cabin requirements are set by the
// modifiers below.
func up(id, name, desc string, price int, m mods) proto.UpgradeDef {
	return proto.UpgradeDef{ID: id, Name: name, Desc: desc, Price: price, ReqRank: 1, Mods: m}
}

// atWorkshop marks an upgrade as needing the cabin's Equipment Workshop, and so at
// least the rank at which the workshop can be built.
func atWorkshop(u proto.UpgradeDef) proto.UpgradeDef {
	u.ReqCabin = CabinWorkshop
	u.ReqRank = max(u.ReqRank, workshopRank)
	return u
}

// fromRank sets the naturalist rank an upgrade needs.
func fromRank(rank int, u proto.UpgradeDef) proto.UpgradeDef {
	u.ReqRank = rank
	return u
}
