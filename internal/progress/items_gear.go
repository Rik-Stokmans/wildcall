package progress

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// backpackItems: carrying capacity (spec §9.2 "Backpack"). The pack is a grid of
// cells (Stats.PackW x PackH, base 5x4 = the satchel) and every item takes its
// footprint in it (items_size.go). Base film: 12 frames. Bigger packs carry more
// and tire you sooner.
func backpackItems() []proto.ItemDef {
	return []proto.ItemDef{
		{
			ID: "canvas_satchel", Name: "Canvas Satchel",
			Desc: "A shoulder bag of waxed canvas. Room for the day's essentials and nothing to slow you down.",
			Kind: KindEquipment, Slot: SlotBackpack, Tier: 1, Rarity: proto.RarityCommon,
			Source: "start", Icon: "backpack",
			Pros: []string{"Light: no effect on your pace or stamina"},
			Cons: []string{"A small 5×4 grid: bulky gear soon fills it", "Room for a single roll of film"},
			Upgrades: []proto.UpgradeDef{
				up("canvas_satchel_pocket", "Sewn-on Side Pocket",
					"A row of pockets down one side, stitched on by Finn while you wait: the satchel grows to 6×4.", 50,
					mods{"packW": 1}),
				up("canvas_satchel_film", "Film Pouch",
					"A light-tight pouch on the strap: four more frames per outing.", 60,
					mods{"filmCap": 4}),
			},
		},
		{
			ID: "explorer_pack", Name: "Explorer Pack",
			Desc: "A two-strap day pack with a proper lid. Room for gadgets, spare film and whatever you find on the way.",
			Kind: KindEquipment, Slot: SlotBackpack, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 170, ReqRank: 2, Source: "shop", Icon: "backpack",
			Mods: mods{"packW": 1, "packH": 1, "filmCap": 4, "stamina": -1},
			Pros: []string{"A 6×5 grid: room for a spare lens and a gadget or two", "Sixteen frames of film per outing"},
			Cons: []string{"The extra weight shortens your sprint"},
			Upgrades: []proto.UpgradeDef{
				up("explorer_pack_hipbelt", "Hip Belt",
					"Puts the load on your hips. You get your wind back.", 80,
					mods{"stamina": 1}),
				atWorkshop(up("explorer_pack_dividers", "Gear Dividers",
					"Fitted dividers cut at your workbench: another column of room from the same pack (7×5).", 110,
					mods{"packW": 1})),
			},
		},
		{
			ID: "expedition_pack", Name: "Expedition Pack",
			Desc: "A tall framed pack for days in the far country. It carries everything, and you carry it.",
			Kind: KindEquipment, Slot: SlotBackpack, Tier: 3, Rarity: proto.RarityRare,
			Price: 420, ReqRank: 3, Source: "shop", Icon: "backpack",
			Mods: mods{"packW": 2, "packH": 2, "filmCap": 8, "moveSpeed": -0.06, "stamina": -2, "stealth": 0.05},
			Pros: []string{"A big 7×6 grid: carries a whole second kit", "Twenty frames of film per outing"},
			Cons: []string{"Slows your walking pace", "Tiring: a much shorter sprint", "The frame creaks: birds notice you a little sooner"},
			Upgrades: []proto.UpgradeDef{
				atWorkshop(up("expedition_pack_frame", "Lightweight Frame",
					"Swap the steel frame for one you bend from alloy tube.", 220,
					mods{"moveSpeed": 0.03, "stamina": 1})),
			},
		},
		{
			ID: "research_backpack", Name: "Research Backpack",
			Desc: "A field researcher's pack: labelled sleeves, a padded instrument bay, a film safe in the lid. Everything has a place, and you can find it without looking.",
			Kind: KindEquipment, Slot: SlotBackpack, Tier: 4, Rarity: proto.RarityEpic,
			Source: "loot", Icon: "backpack",
			Mods: mods{"packW": 3, "packH": 2, "filmCap": 12, "camReady": -0.1, "stamina": -1},
			Pros: []string{"The biggest grid of all, 8×6", "Labelled sleeves: stacks hold half as much again", "A film safe: twenty-four frames per outing", "The camera comes to hand faster"},
			Cons: []string{"Old leather and brass: the weight shortens your sprint"},
			History: "Made to order for a coastal research station that closed when its funding did. Whoever packed up last left this behind, " +
				"each sleeve still labelled in the same careful hand: RINGS · CALIPERS · SPARE REELS · TEA.",
			Special: "More room than an expedition pack without its drag on your pace, sleeves that hold half as much again of every supply, " +
				"food and ingredient, twice the film of any other pack, and an instrument bay that brings the camera up 0.1 s faster.",
			Upgrades: []proto.UpgradeDef{
				fromRank(3, atWorkshop(up("research_backpack_harness", "Re-stitched Harness",
					"New webbing on the old harness spreads the load properly.", 200,
					mods{"stamina": 1}))),
			},
		},
	}
}

// navigationItems: maps and compasses. Base: an 8-point compass strip, a map that
// shows landmarks only, hidden places revealing at 12 m.
func navigationItems() []proto.ItemDef {
	return []proto.ItemDef{
		{
			ID: "trail_map", Name: "Trail Map",
			Desc: "The folded visitor's map from the ranger station: the cabin, the main landmarks, a compass rose in the corner. The rest is yours to fill in.",
			Kind: KindEquipment, Slot: SlotNavigation, Tier: 1, Rarity: proto.RarityCommon,
			Source: "start", Icon: "map",
			Pros: []string{"Shows the places you have discovered", "Fits in a shirt pocket"},
			Cons: []string{"Landmarks only: no trails or habitats", "Compass points, not bearings"},
			Upgrades: []proto.UpgradeDef{
				up("trail_map_overlay", "Trail Overlay",
					"A tracing-paper overlay of the footpaths, inked by the rangers.", 60,
					mods{"mapDetail": 1}),
				up("trail_map_notes", "Ranger's Margin Notes",
					"Pencilled hints about where the old paths used to run. You notice overgrown trails a little sooner.", 85,
					mods{"trailSense": 5}),
			},
		},
		{
			ID: "field_compass", Name: "Orienteering Set",
			Desc: "A baseplate compass and a proper topographic sheet. You always know your bearing; you spend a little more time looking at your hands.",
			Kind: KindEquipment, Slot: SlotNavigation, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 150, ReqRank: 2, Source: "shop", Icon: "compass",
			Mods: mods{"compass": 1, "mapDetail": 1, "trailSense": 6, "moveSense": -3},
			Pros: []string{"Compass reads in degrees", "Map shows trails", "Hidden paths reveal from farther off"},
			Cons: []string{"Eyes on the needle: you catch slightly less movement around you"},
			Upgrades: []proto.UpgradeDef{
				up("field_compass_mirror", "Sighting Mirror",
					"Take bearings on distant features without lowering your eyes for long.", 90,
					mods{"trailSense": 4, "moveSense": 2}),
				up("field_compass_tint", "Habitat Tint Sheet",
					"A hand-coloured sheet marking woodland, reedbed, meadow and scree.", 130,
					mods{"mapDetail": 1}),
			},
		},
		{
			ID: "survey_kit", Name: "Surveyor's Kit",
			Desc: "Prismatic compass, habitat survey sheets and an aneroid barometer in a fitted case. The country explains itself; the case weighs on your shoulder.",
			Kind: KindEquipment, Slot: SlotNavigation, Tier: 3, Rarity: proto.RarityRare,
			Price: 390, ReqRank: 3, Source: "shop", Icon: "compass",
			Mods: mods{"compass": 1, "mapDetail": 2, "trailSense": 14, "forecast": 3, "stamina": -0.5, "moveSense": -3},
			Pros: []string{"Map shows trails and habitats", "Compass reads in degrees", "Hidden places reveal from much farther off", "Three hours of weather warning"},
			Cons: []string{"The fitted case is a weight on your shoulder: a shorter sprint", "Eyes on the instruments: you catch less movement around you"},
			Upgrades: []proto.UpgradeDef{
				atWorkshop(up("survey_kit_altimeter", "Calibrated Altimeter",
					"Re-zero the barometer against your own cabin's height: a longer, surer forecast.", 160,
					mods{"forecast": 3, "trailSense": 4})),
			},
		},
		{
			ID: "naturalists_compass", Name: "Naturalist's Compass",
			Desc: "A pocket compass in a dented brass case. Around the dial, instead of degrees, someone has engraved tiny pictures: a tower, an oak, a cairn, a pool.",
			Kind: KindEquipment, Slot: SlotNavigation, Tier: 4, Rarity: proto.RarityEpic,
			Source: "loot", Icon: "compass",
			Mods: mods{"compass": 2, "trailSense": 18, "trackSigns": 4, "mapDetail": -1},
			Pros: []string{"Shows the bearing to landmarks you have discovered", "Hidden trails and secret places reveal from far away", "Signs on the ground catch your eye sooner"},
			Cons: []string{"It replaces your map sheet: the map falls back a level of detail"},
			History: "Found where the wind never stops. Highland rangers carried compasses like this before there were maps worth the name, " +
				"and navigated by what they could see: each owner engraved the landmarks they trusted and handed it on.",
			Special: "Navigates by landmark instead of by north: the compass strip shows the direction of places you have discovered, and the " +
				"needle seems to hesitate near anything hidden. You give up your detailed map sheet to carry it.",
		},
	}
}

// clothingItems: outfits (spec §9.1 "Clothing"). Base: flush distance ×1, ×0.75 while
// crouched, no rain protection. One outfit at a time, so boots, shell and smock are
// a decision made at the door: where am I going, and in what weather?
func clothingItems() []proto.ItemDef {
	return []proto.ItemDef{
		{
			ID: "field_clothes", Name: "Field Clothes",
			Desc: "Muted cottons, a soft hat, shoes you have already walked a hundred miles in. Unremarkable, which is the point.",
			Kind: KindEquipment, Slot: SlotClothing, Tier: 1, Rarity: proto.RarityCommon,
			Source: "start", Icon: "clothing",
			Pros: []string{"Comfortable all day", "Quiet, dull colours"},
			Cons: []string{"No protection from rain", "No help on rough ground"},
			Upgrades: []proto.UpgradeDef{
				up("field_clothes_soles", "Soft Crepe Soles",
					"Resoled in crepe rubber. Twigs complain less.", 45,
					mods{"stealth": -0.03}),
				up("field_clothes_wax", "Waxed Shoulders",
					"A waxed yoke and hat brim shrug off a light shower.", 55,
					mods{"rainProof": 0.15}),
			},
		},
		{
			ID: "rain_shell", Name: "Rain Shell",
			Desc: "A hooded waterproof in lichen green. Rain becomes weather instead of a reason to go home — though the hood dulls the forest a little.",
			Kind: KindEquipment, Slot: SlotClothing, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 130, ReqRank: 1, Source: "shop", Icon: "clothing",
			Mods: mods{"rainProof": 0.7, "hearRange": -0.06, "stealth": 0.05},
			Pros: []string{"Shrugs off most of the rain's effect on what you can see and do"},
			Cons: []string{"The hood muffles your hearing slightly", "The fabric rustles: birds notice you a little sooner"},
			Upgrades: []proto.UpgradeDef{
				up("rain_shell_hood", "Cut-away Hood",
					"Ear panels cut into the hood. You hear as well as you would bare-headed.", 90,
					mods{"hearRange": 0.06}),
				atWorkshop(up("rain_shell_lining", "Brushed Lining",
					"A soft outer facing sewn over the noisiest panels.", 120,
					mods{"stealth": -0.05})),
			},
		},
		{
			ID: "sturdy_boots", Name: "Sturdy Boots",
			Desc: "Field outfit built around a pair of nailed leather boots and gaiters. Scree, bog and stream bed stop being obstacles; tiptoeing stops being possible.",
			Kind: KindEquipment, Slot: SlotClothing, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 160, ReqRank: 2, Source: "shop", Icon: "footprint",
			Mods: mods{"terrain": 0.4, "stamina": 2, "moveSpeed": 0.03, "stealth": 0.08, "settle": -0.1},
			Pros: []string{"Slopes, undergrowth and shallows slow you far less", "A longer sprint and a brisker walk"},
			Cons: []string{"A heavy tread: birds flush from farther away", "Disturbed wildlife takes longer to settle again"},
			Upgrades: []proto.UpgradeDef{
				atWorkshop(up("sturdy_boots_soles", "Felted Soles",
					"Felt cut and glued over the nails. Most of the grip, much less of the crunch.", 110,
					mods{"stealth": -0.05})),
			},
		},
		{
			ID: "camouflage_smock", Name: "Camouflage Smock",
			Desc: "A long hooded smock in broken leaf pattern with scrim at the shoulders. Sit down in it and you become part of the bank.",
			Kind: KindEquipment, Slot: SlotClothing, Tier: 3, Rarity: proto.RarityRare,
			Price: 400, ReqRank: 3, Source: "shop", Icon: "clothing",
			Mods: mods{"stealth": -0.15, "crouchBonus": -0.12, "familiarity": 0.25, "moveSpeed": -0.04, "stamina": -1},
			Pros: []string{"Birds let you approach much closer", "Crouched or sitting, you all but vanish", "Wildlife accepts you sooner"},
			Cons: []string{"Long and snag-prone: a slower walking pace", "Warm: a shorter sprint"},
			Upgrades: []proto.UpgradeDef{
				up("camouflage_smock_veil", "Face Veil",
					"A mesh veil hides the pale flash of a face turned towards the bird.", 150,
					mods{"crouchBonus": -0.05}),
				atWorkshop(up("camouflage_smock_vents", "Vented Panels",
					"Mesh panels let into the back and underarms.", 170,
					mods{"stamina": 1})),
			},
		},
	}
}
