package progress

import (
	"fmt"
	"strconv"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// The larder catalog (contract §12): foraged and pantry ingredients, and the food
// cooked from them. Plant, recipe and quest data live in internal/content; the item
// ids below are the shared vocabulary between the two (the plant table of §12 pins
// the yields, the food ids are pinned there too).
//
// Rules the data follows (Validate enforces them):
//   - Ingredients and food stack (20 and 8 per slot), have no equipment slot, no
//     stat mods of their own and no upgrades. What eating does is the item's Buff.
//   - A buff is a modest, entirely positive additive change to real core.Stats
//     fields, in one of three slots (drink, meal, snack); drinks last 2–3 in-game
//     hours, snacks 2–4, meals 4–6, and raw edibles a short hour. Nothing that buffs
//     touches the pack size or the XP and credit multipliers.
//   - Foraged ingredients are never sold; the three pantry staples are Finn's.
//   - Nothing is magic: a thermos of mint tea does not make you hear better than a
//     good pair of headphones.

// Pinned item ids (contract §12).
var (
	// foragedIngredients are the 19 wild yields, in the plant table's order.
	foragedIngredients = []string{
		"blackberry", "wild_strawberry", "bilberry", "elderflower", "elderberry", "rosehip",
		"hazelnut", "chestnut", "nettle", "wild_garlic", "water_mint", "chamomile", "pine_tips",
		"chanterelle", "penny_bun", "sea_buckthorn", "samphire", "cloudberry", "wild_thyme",
	}
	// pantryIngredients are the staples Finn sells.
	pantryIngredients = []string{"oats", "honey", "flour"}
	// foodItems are the 19 prepared foods.
	foodItems = []string{
		"pine_tip_tea", "mint_tea", "chamomile_tea", "thyme_honey_tea", "nettle_tea",
		"elderflower_cordial", "elderberry_syrup", "rosehip_syrup", "sea_buckthorn_juice",
		"berry_oat_bars", "hazelnut_trail_mix", "roasted_chestnuts", "cloudberry_preserve", "bilberry_tart",
		"nettle_soup", "wild_garlic_flatbread", "mushroom_broth", "forager_stew", "samphire_salad",
	}
)

// ForagedIngredients returns the ids of the 19 foraged ingredients.
func ForagedIngredients() []string { return append([]string(nil), foragedIngredients...) }

// PantryIngredients returns the ids of the pantry staples Finn sells.
func PantryIngredients() []string { return append([]string(nil), pantryIngredients...) }

// FoodItems returns the ids of the 19 prepared foods, in display order.
func FoodItems() []string { return append([]string(nil), foodItems...) }

const (
	stackIngredient = 20
	stackFood       = 8
)

// hoursText formats a buff duration for player text: "3 hours", "2.5 hours", "1 hour".
func hoursText(h float32) string {
	s := strconv.FormatFloat(float64(h), 'f', -1, 32)
	if h == 1 {
		return s + " hour"
	}
	return s + " hours"
}

// buff builds a BuffDef; what reads "Steadier hands" and the duration is appended.
func buff(slot string, hours float32, what string, m mods) *proto.BuffDef {
	return &proto.BuffDef{Slot: slot, Hours: hours, Mods: m, Text: fmt.Sprintf("%s for %s", what, hoursText(hours))}
}

func ingredient(id, name, desc string, rarity int, icon string, b *proto.BuffDef) proto.ItemDef {
	d := proto.ItemDef{
		ID: id, Name: name, Desc: desc,
		Kind: KindIngredient, Tier: 1, Rarity: rarity, ReqRank: 1,
		Source: "loot", Icon: icon, Stack: stackIngredient,
		Pros: []string{"An ingredient for the field kitchen"},
	}
	if b != nil {
		d.Use = UseEat
		d.Buff = b
		d.Pros = []string{"Good to eat as it is: " + lowerFirst(b.Text), "An ingredient for the field kitchen"}
	}
	return d
}

func pantry(id, name, desc string, price int, icon string) proto.ItemDef {
	return proto.ItemDef{
		ID: id, Name: name, Desc: desc,
		Kind: KindIngredient, Tier: 1, Rarity: proto.RarityCommon, ReqRank: 1,
		Price: price, Source: "shop", Icon: icon, Stack: stackIngredient,
		Pros: []string{"A pantry staple for the field kitchen"},
	}
}

func food(id, name, desc string, rarity int, icon string, b *proto.BuffDef) proto.ItemDef {
	return proto.ItemDef{
		ID: id, Name: name, Desc: desc,
		Kind: KindFood, Tier: 1, Rarity: rarity, ReqRank: 1,
		Source: "loot", Icon: icon, Stack: stackFood, Use: UseEat, Buff: b,
		Pros: []string{b.Text},
	}
}

func lowerFirst(s string) string {
	if s == "" || s[0] < 'A' || s[0] > 'Z' {
		return s
	}
	return string(s[0]+'a'-'A') + s[1:]
}

func ingredientItems() []proto.ItemDef {
	c, u := proto.RarityCommon, proto.RarityUncommon
	return []proto.ItemDef{
		ingredient("blackberry", "Blackberry",
			"A fat, glossy bramble fruit, black when ripe and ready to drop into your hand. The ones low on the stem are the ones the birds have not got to.",
			c, "seed", buff(SlotSnack, 1, "A little extra spring in your step", mods{"stamina": 0.5})),
		ingredient("wild_strawberry", "Wild Strawberry",
			"Hardly bigger than a fingernail and far sweeter than anything from a shop. It smells of strawberry from a metre away.",
			c, "seed", buff(SlotSnack, 1, "Sharper eyes for movement", mods{"moveSense": 1.5})),
		ingredient("bilberry", "Bilberry",
			"A small blue-black berry that stains fingers and lips purple. Cousin of the blueberry, with more flavour and a dusty bloom on the skin.",
			c, "seed", buff(SlotSnack, 1, "A touch better in the dim light", mods{"lowLight": 0.04})),
		ingredient("elderflower", "Elderflower",
			"A flat head of tiny cream flowers with a sweet, musky scent: muscat grapes and hay. Picked dry on a sunny morning and used the same day.",
			c, "leaf", nil),
		ingredient("elderberry", "Elderberry",
			"Heavy purple-black clusters on red stalks. Raw they upset the stomach; heated they make one of the best winter syrups there is.",
			c, "seed", nil),
		ingredient("rosehip", "Rosehip",
			"The glossy scarlet fruit of the dog rose, hanging on long after the leaves have gone. Packed with vitamin C, and the seeds inside are hairy: not for eating raw.",
			c, "seed", nil),
		ingredient("hazelnut", "Hazelnut",
			"A round brown nut in a ragged green cup. Squirrels, jays and nuthatches all want them, so pick only a few.",
			c, "seed", buff(SlotSnack, 1, "A little more stamina", mods{"stamina": 1})),
		ingredient("chestnut", "Sweet Chestnut",
			"A glossy brown nut from a spiny green case. Not the conker of the horse chestnut: sweet chestnuts are flat on one side and have a small tassel at the tip. Best roasted.",
			c, "seed", nil),
		ingredient("nettle", "Nettle",
			"The soft top leaves of the stinging nettle, picked with a glove and wilted in hot water until the sting is gone. Green, earthy and rich in iron.",
			c, "leaf", nil),
		ingredient("wild_garlic", "Wild Garlic",
			"Broad, bright leaves of ramsons from a damp spring wood. Crush one and the smell is unmistakable; it is milder than a clove and goes with everything.",
			c, "leaf", nil),
		ingredient("water_mint", "Water Mint",
			"Soft, slightly furry leaves from the edge of a stream, with a pungent, peppery mint smell that rises as you handle it.",
			c, "leaf", nil),
		ingredient("chamomile", "Chamomile",
			"Little white daisies with a hollow golden cone, smelling of apples. A tea made from the heads has soothed people for thousands of years.",
			c, "leaf", nil),
		ingredient("pine_tips", "Pine Tips",
			"The pale green candles of new growth on a young pine, sticky with resin and smelling of a forest after rain. A little goes a long way.",
			c, "tree", nil),
		ingredient("chanterelle", "Chanterelle",
			"A golden, trumpet-shaped mushroom with blunt ridges instead of gills, and a faint scent of apricots. A prized find, and not one to pick unless you are certain what it is.",
			u, "egg", nil),
		ingredient("penny_bun", "Penny Bun",
			"A fat brown-capped bolete with a creamy sponge underneath instead of gills and a thick, netted stem. The porcini of the Italian kitchen.",
			u, "egg", nil),
		ingredient("sea_buckthorn", "Sea Buckthorn",
			"Clusters of tight orange berries crowding the thorny branches of a coastal shrub. Intensely sour and full of vitamins; they burst when you look at them hard.",
			u, "seed", buff(SlotSnack, 1, "A sharp, bright shot of energy", mods{"stamina": 0.5, "moveSense": 1})),
		ingredient("samphire", "Marsh Samphire",
			"Succulent, jointed green shoots from the salt marsh, like tiny sea-green asparagus. Crunchy and salty straight from the mud.",
			c, "leaf", nil),
		ingredient("cloudberry", "Cloudberry",
			"An amber, raspberry-like berry that grows alone on a low stalk in northern bogs. Rare, tart and honeyed, with a flavour found nowhere else.",
			u, "seed", buff(SlotSnack, 1, "Sharper eyes for what sits in the cover", mods{"observeSpeed": 0.05})),
		ingredient("wild_thyme", "Wild Thyme",
			"A tiny-leaved, creeping herb that carpets sunny banks with purple flowers. Crush a sprig and it smells of every roast dinner you have ever liked.",
			c, "leaf", nil),

		pantry("oats", "Rolled Oats", "A paper sack of rolled oats from the mill down the valley. Porridge, bars, thickening for a soup: the quiet foundation of most field cooking.", 4, "seed"),
		pantry("honey", "Jar of Honey", "Golden honey from the valley's hives, in a jar with a wax-paper lid. It sweetens a tea and keeps a syrup.", 10, "star"),
		pantry("flour", "Bag of Flour", "A small bag of plain flour, rough-milled and a little grey. Enough for a flatbread or a tart or two.", 5, "home"),
	}
}

func foodItemDefs() []proto.ItemDef {
	c, u := proto.RarityCommon, proto.RarityUncommon
	return []proto.ItemDef{
		// --- Teas: drinks
		food("pine_tip_tea", "Pine-Tip Tea",
			"A pale, resinous tea of fresh pine tips with a citrus edge. Drunk hot, it settles the shakes before a long look through the glass.",
			c, "pond", buff(SlotDrink, 3, "Steadier hands", mods{"camStability": 0.08, "binoStability": 0.08})),
		food("mint_tea", "Water Mint Tea",
			"Hot water over crushed water mint: sharp and clean, and good for waking up the senses before dawn.",
			c, "pond", buff(SlotDrink, 3, "Sharper ears", mods{"hearRange": 0.1, "focusBonus": 0.08})),
		food("chamomile_tea", "Chamomile Tea",
			"A soft golden tea that smells of apples. It slows the heart and makes it easier to sit still, and wildlife seems to notice.",
			c, "pond", buff(SlotDrink, 3, "Calmer: wildlife settles sooner and a quieter approach", mods{"settle": 0.2, "stealth": -0.06})),
		food("thyme_honey_tea", "Thyme and Honey Tea",
			"Wild thyme steeped with a spoon of honey. Warm in the chest, and good for tired legs on rough ground.",
			c, "pond", buff(SlotDrink, 2.5, "Surer feet and a longer sprint", mods{"terrain": 0.08, "stamina": 1.5})),
		food("nettle_tea", "Nettle Tea",
			"A dark green, earthy tea of young nettle tops. It tastes like a lawn in the best possible way and leaves the head clear.",
			c, "pond", buff(SlotDrink, 2.5, "A clear head: watching teaches you faster", mods{"observeSpeed": 0.1, "trackSigns": 2})),

		// --- Cordials and syrups: drinks
		food("elderflower_cordial", "Elderflower Cordial",
			"Cream flowers steeped in sweet syrup and cut with water: the taste of an English early summer in a glass.",
			c, "pond", buff(SlotDrink, 2.5, "Bright eyes", mods{"nakedEye": 0.08, "moveSense": 3})),
		food("elderberry_syrup", "Elderberry Syrup",
			"A thick, dark syrup of simmered elderberries. Spooned into hot water it clears the head and the noise in it.",
			u, "pond", buff(SlotDrink, 3, "Less distracted by the noise around you", mods{"noiseReduce": 0.08, "dirAccuracy": 0.05})),
		food("rosehip_syrup", "Rosehip Syrup",
			"A rust-coloured syrup, sieved twice through muslin so none of the seed hairs get in. A cold-weather drink: it keeps the damp out.",
			c, "pond", buff(SlotDrink, 3, "Rain and cold matter less", mods{"rainProof": 0.1, "stamina": 1})),
		food("sea_buckthorn_juice", "Sea Buckthorn Juice",
			"A sharp, orange juice with a savoury edge. Sweetened with honey it is zingy rather than cruel, and it wakes you right up.",
			u, "pond", buff(SlotDrink, 2.5, "A bright, restless energy", mods{"stamina": 2.5, "moveSense": 4})),

		// --- Snacks
		food("berry_oat_bars", "Berry Oat Bars",
			"Oats, honey and blackberries pressed into a pan and left to set. Sticky, dense and the best thing in a coat pocket on a long walk.",
			c, "seed", buff(SlotSnack, 4, "Energy for a long walk", mods{"stamina": 2, "moveSpeed": 0.03})),
		food("hazelnut_trail_mix", "Hazelnut Trail Mix",
			"Hazelnuts toasted in honey with a handful of oats. Crunchy, sweet and surprisingly filling.",
			c, "seed", buff(SlotSnack, 4, "Stamina and a steadier step on rough ground", mods{"stamina": 3, "terrain": 0.05})),
		food("roasted_chestnuts", "Roasted Chestnuts",
			"Nicked, then roasted in a pan until the skins curl. Hot, floury and sweet, and they warm your hands as well as your insides.",
			c, "seed", buff(SlotSnack, 3, "Warm and dry-spirited: rain matters less", mods{"rainProof": 0.08, "stamina": 1.5})),
		food("cloudberry_preserve", "Cloudberry Preserve",
			"A small jar of amber preserve, spooned onto a biscuit. The flavour is rare and the effect is something like patience.",
			u, "seed", buff(SlotSnack, 3, "Patient eyes: watching shows you more, and trails reveal sooner", mods{"observeSpeed": 0.1, "trailSense": 4})),
		food("bilberry_tart", "Bilberry Tart",
			"A rough little tart of bilberries in a floury crust. Purple everywhere it touches, and the dusk looks clearer afterwards.",
			c, "seed", buff(SlotSnack, 3, "Better eyes at dusk", mods{"lowLight": 0.12, "nakedEye": 0.05})),

		// --- Meals
		food("nettle_soup", "Nettle Soup",
			"Nettle and wild garlic simmered with oats. Bright green and deeply savoury, and the kind of hot meal that makes weather someone else's problem.",
			c, "camp", buff(SlotMeal, 5, "Rain and cold matter much less", mods{"rainProof": 0.2, "stamina": 2})),
		food("wild_garlic_flatbread", "Wild Garlic Flatbread",
			"Flour and crushed ramsons patted flat and cooked in a dry pan. Chewy, garlicky and quick: it keeps you going all day.",
			c, "camp", buff(SlotMeal, 5, "Lasting energy for the whole walk", mods{"stamina": 3, "moveSpeed": 0.04})),
		food("mushroom_broth", "Mushroom Broth",
			"Chanterelles and penny buns simmered slowly until the water goes the colour of tea. A warm, quiet, fragrant bowl.",
			u, "camp", buff(SlotMeal, 5, "Warm, and a calmer background hum", mods{"rainProof": 0.15, "noiseReduce": 0.06})),
		food("forager_stew", "Forager's Stew",
			"A penny bun, sweet chestnuts, thyme and oats in one pot over a low fire. It is everything a wood gives you in one bowl.",
			u, "camp", buff(SlotMeal, 6, "Set up for the whole day outdoors", mods{"rainProof": 0.2, "stamina": 3, "trackSigns": 3})),
		food("samphire_salad", "Samphire Salad",
			"Blanched marsh samphire dressed with thyme. Salty, crisp and clean, and it leaves you light and watchful.",
			c, "camp", buff(SlotMeal, 4, "Light and alert", mods{"observeSpeed": 0.1, "moveSense": 3, "stamina": 1})),
	}
}
