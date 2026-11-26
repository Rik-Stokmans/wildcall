package content

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// Recipe stations (proto.RecipeDef.Station). A kettle is at the cabin and at every
// camp's fire; a stove is the cabin's only.
const (
	StationKettle = "kettle"
	StationStove  = "stove"
)

// Learn rule prefixes (proto.RecipeDef.Learn). "start" is known from the beginning.
const (
	LearnStart = "start"
	LearnPlant = "plant:" // the first time that plant is picked
	LearnNPC   = "npc:"   // a dialogue action (ActionLearnRecipe) of that NPC
	LearnLore  = "lore:"  // that Natural History entry is unlocked
)

func in(item string, qty int) proto.ItemStack { return proto.ItemStack{Item: item, Qty: qty} }

func recipe(id, name, desc, station string, qty int, learn string, inputs ...proto.ItemStack) proto.RecipeDef {
	return proto.RecipeDef{ID: id, Name: name, Desc: desc, Station: station, Inputs: inputs, Output: id, Qty: qty, Learn: learn}
}

// Recipes returns the 19 recipes of the field kitchen (contract §12), one per food
// (the recipe id is the id of the food it makes), in the order of the food list.
// Inputs are foraged ingredients and the pantry staples oats, honey and flour; each
// batch makes Qty servings. The slice is freshly built on each call.
func Recipes() []proto.RecipeDef {
	k, s := StationKettle, StationStove
	return []proto.RecipeDef{
		// --- Teas
		recipe("pine_tip_tea", "Pine-Tip Tea", "Steep fresh pine tips in a pot of hot water for ten minutes. Resinous and lemony.", k, 2, LearnStart, in("pine_tips", 2)),
		recipe("mint_tea", "Water Mint Tea", "Crush a few sprigs of water mint into a pot and pour boiling water over. Sharp and clean.", k, 2, LearnStart, in("water_mint", 2)),
		recipe("chamomile_tea", "Chamomile Tea", "Steep chamomile heads in a pot for five minutes, covered, so the scent stays in. Soft and golden.", k, 2, LearnPlant+"chamomile", in("chamomile", 2)),
		recipe("thyme_honey_tea", "Thyme and Honey Tea", "Steep a few sprigs of wild thyme and stir a spoon of honey in at the end. Warm and herby.", k, 2, LearnPlant+"wild_thyme", in("wild_thyme", 2), in("honey", 1)),
		recipe("nettle_tea", "Nettle Tea", "Pour boiling water over a handful of nettle tops, wearing gloves to pick, and leave to steep. Earthy and green.", k, 2, LearnPlant+"nettle", in("nettle", 2)),
		// --- Cordials and syrups
		recipe("elderflower_cordial", "Elderflower Cordial", "Steep elderflower heads in hot honey-sweetened water overnight, strain, and dilute to taste.", k, 2, LearnPlant+"elder", in("elderflower", 3), in("honey", 1)),
		recipe("elderberry_syrup", "Elderberry Syrup", "Simmer elderberries gently with honey until they burst, then strain. Elderberries must always be cooked.", k, 2, LearnNPC+NPCMara, in("elderberry", 3), in("honey", 1)),
		recipe("rosehip_syrup", "Rosehip Syrup", "Simmer chopped rosehips with honey and strain through muslin twice so no seed hairs get through.", k, 2, LearnPlant+"dog_rose", in("rosehip", 3), in("honey", 1)),
		recipe("sea_buckthorn_juice", "Sea Buckthorn Juice", "Crush the berries, strain out the skins and seeds, and sweeten with honey to take the edge off.", k, 2, LearnPlant+"sea_buckthorn", in("sea_buckthorn", 3), in("honey", 1)),
		// --- Snacks
		recipe("berry_oat_bars", "Berry Oat Bars", "Warm honey in the pot, stir in oats and blackberries, press the mixture into a tray and leave it to set.", k, 2, LearnStart, in("oats", 2), in("honey", 1), in("blackberry", 2)),
		recipe("hazelnut_trail_mix", "Hazelnut Trail Mix", "Toast shelled hazelnuts and oats in a dry pan, then toss in honey until it coats everything.", s, 2, LearnPlant+"hazel", in("hazelnut", 3), in("oats", 1), in("honey", 1)),
		recipe("roasted_chestnuts", "Roasted Chestnuts", "Score each chestnut with a knife and roast them in a pan on the embers until the shells curl open.", k, 2, LearnPlant+"sweet_chestnut", in("chestnut", 4)),
		recipe("cloudberry_preserve", "Cloudberry Preserve", "Simmer cloudberries with honey until the mixture thickens, then jar it while it is warm.", s, 2, LearnPlant+"cloudberry", in("cloudberry", 3), in("honey", 2)),
		recipe("bilberry_tart", "Bilberry Tart", "Press a flour-and-honey dough into a dish, fill it with bilberries and bake until the edges brown.", s, 2, LearnPlant+"bilberry", in("bilberry", 3), in("flour", 2), in("honey", 1)),
		// --- Meals
		recipe("nettle_soup", "Nettle Soup", "Simmer nettle tops with wild garlic and a handful of oats until the oats thicken it. Season well.", k, 2, LearnPlant+"wild_garlic", in("nettle", 3), in("wild_garlic", 1), in("oats", 1)),
		recipe("wild_garlic_flatbread", "Wild Garlic Flatbread", "Knead flour with chopped wild garlic and water, pat into flat rounds and cook in a dry hot pan.", s, 2, LearnNPC+NPCFinn, in("flour", 2), in("wild_garlic", 2)),
		recipe("mushroom_broth", "Mushroom Broth", "Simmer chanterelles and a penny bun slowly in water until the broth is the colour of tea.", k, 2, LearnPlant+"chanterelle", in("chanterelle", 2), in("penny_bun", 1)),
		recipe("forager_stew", "Forager's Stew", "One pot over a low fire: a penny bun, sweet chestnuts, thyme and a handful of oats, simmered until thick.", k, 2, LearnLore+"keepers_stew", in("penny_bun", 1), in("chestnut", 2), in("wild_thyme", 1), in("oats", 1)),
		recipe("samphire_salad", "Samphire Salad", "Blanch samphire for a minute in the kettle, drain and dress with thyme. Skip the salt.", k, 2, LearnPlant+"samphire", in("samphire", 3), in("wild_thyme", 1)),
	}
}

var recipeIndex = func() map[string]int {
	m := map[string]int{}
	for i, r := range Recipes() {
		m[r.ID] = i
	}
	return m
}()

// Recipe looks up a recipe by id.
func Recipe(id string) (proto.RecipeDef, bool) {
	i, ok := recipeIndex[id]
	if !ok {
		return proto.RecipeDef{}, false
	}
	return Recipes()[i], true
}

// RecipesLearnedBy lists the ids of the recipes a trigger teaches, in catalog
// order. The trigger is a Learn rule: "plant:<plant id>" (the first time that plant
// is picked), "npc:<npc id>" or "lore:<lore id>". The session calls it when the
// trigger happens and teaches each result with progress.LearnRecipe.
func RecipesLearnedBy(trigger string) []string {
	var out []string
	if trigger == "" || trigger == LearnStart {
		return out
	}
	for _, r := range Recipes() {
		if r.Learn == trigger {
			out = append(out, r.ID)
		}
	}
	return out
}

// RecipeStationOK reports whether a recipe can be cooked at a station: a stove only
// at the cabin, a kettle at the cabin or at a camp's fire. atCabin and atCamp say
// where the player stands (the session decides distances).
func RecipeStationOK(r proto.RecipeDef, atCabin, atCamp bool) bool {
	switch r.Station {
	case StationStove:
		return atCabin
	case StationKettle:
		return atCabin || atCamp
	}
	return false
}
