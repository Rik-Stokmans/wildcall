package progress

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// opticsItems: binoculars and scopes (spec §9.5). Base (bare stats): 6×, 48° apparent
// field (8° true at 6×), clarity 0.5, stability 0.35, focus 1.2 /s, 0.6 kg, low
// light 0.2. The true field of view already narrows as magnification rises (true
// FOV = binoFov / zoom) and hand sway grows with it on the client, so more zoom is
// never free even before the explicit tradeoffs below.
func opticsItems() []proto.ItemDef {
	return []proto.ItemDef{
		{
			ID: "basic_binoculars", Name: "Basic Binoculars",
			Desc: "A well-travelled pair of 6× field glasses. Wide, forgiving, and light enough to forget you are wearing them.",
			Kind: KindEquipment, Slot: SlotOptics, Tier: 1, Rarity: proto.RarityCommon,
			Source: "start", Icon: "binoculars",
			Pros: []string{"Wide view: easy to get a bird in the glass", "Light and quick to raise"},
			Cons: []string{"Only 6× magnification", "Soft at long range and dim at dusk"},
			Upgrades: []proto.UpgradeDef{
				up("basic_binoculars_strap", "Padded Neck Strap",
					"Takes the weight off your hands, so the view settles sooner.", 35,
					mods{"binoWeight": -0.1, "binoStability": 0.04}),
				up("basic_binoculars_recoat", "Lens Clean & Recoat",
					"Finn strips years of haze from the old glass.", 70,
					mods{"binoClarity": 0.08, "lowLight": 0.04}),
			},
		},
		{
			ID: "explorer_binoculars", Name: "Explorer Binoculars",
			Desc: "Balanced 8×32 roof prisms: the pair most naturalists settle on. More reach and cleaner glass, at the cost of a little steadiness.",
			Kind: KindEquipment, Slot: SlotOptics, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 180, ReqRank: 1, Source: "shop", Icon: "binoculars",
			Mods: mods{"binoZoom": 2, "binoClarity": 0.15, "lowLight": 0.06, "binoStability": -0.06, "binoWeight": 0.15},
			Pros: []string{"8× magnification: field marks at twice the distance", "Clearer, brighter image"},
			Cons: []string{"Narrower view at full magnification", "Hand shake shows more", "A little heavier to raise"},
			Upgrades: []proto.UpgradeDef{
				up("explorer_binoculars_coating", "Multi-coated Lenses",
					"Better coatings pull more light and contrast through the glass.", 120,
					mods{"binoClarity": 0.08, "lowLight": 0.06}),
				up("explorer_binoculars_harness", "Chest Harness",
					"Carries the weight on your shoulders and braces the glasses against your chest.", 90,
					mods{"binoStability": 0.06, "binoWeight": -0.1}),
				fromRank(2, atWorkshop(up("explorer_binoculars_focus", "Fast-Focus Wheel",
					"A re-geared focus wheel fitted at your own workbench: half a turn from near to far.", 150,
					mods{"binoFocus": 0.5}))),
			},
		},
		{
			ID: "wide_field_binoculars", Name: "Wide-Field Glasses",
			Desc: "Squat 7×35 porro prisms with an enormous picture window. Made for flocks in the canopy and anything that will not sit still.",
			Kind: KindEquipment, Slot: SlotOptics, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 200, ReqRank: 2, Source: "shop", Icon: "binoculars",
			Mods: mods{"binoZoom": 1, "binoFov": 16, "binoFocus": 0.4, "binoClarity": 0.05, "lowLight": -0.08, "binoWeight": 0.1},
			Pros: []string{"Very wide view: follow birds in flight and through branches", "Fast, light focus"},
			Cons: []string{"Only 7×: distant birds stay small", "Dim at dawn, dusk and under heavy canopy"},
			Upgrades: []proto.UpgradeDef{
				up("wide_field_binoculars_eyecups", "Twist-up Eyecups",
					"Seat the glasses firmly against your brow and open the view to its edges.", 80,
					mods{"binoStability": 0.05, "binoFov": 2}),
			},
		},
		{
			ID: "specialist_binoculars", Name: "Ridgeline 10× Specialist",
			Desc: "Big 10×42 objectives with dawn-bright glass. They show everything, including every tremor in your hands.",
			Kind: KindEquipment, Slot: SlotOptics, Tier: 3, Rarity: proto.RarityRare,
			Price: 520, ReqRank: 3, Source: "shop", Icon: "binoculars",
			Mods: mods{"binoZoom": 4, "binoClarity": 0.25, "lowLight": 0.25, "binoStability": -0.12, "binoWeight": 0.3, "binoFocus": -0.2},
			Pros: []string{"10× magnification: detail across a valley", "Superb clarity", "Bright at dawn and dusk"},
			Cons: []string{"Narrow view: finding the bird takes practice", "Noticeably shakier in the hand", "Heavy, and slower to focus"},
			Upgrades: []proto.UpgradeDef{
				up("specialist_binoculars_dawn", "Dawn-Glass Coating",
					"A coating tuned for the blue hour, when the forest is loudest and the light is worst.", 180,
					mods{"lowLight": 0.15, "binoClarity": 0.05}),
				fromRank(3, atWorkshop(up("specialist_binoculars_brace", "Stabilising Brace",
					"A folding shoulder brace built at your workbench. It gives back the steadiness the magnification took.", 220,
					mods{"binoStability": 0.14}))),
			},
		},
		{
			ID: "spotting_scope", Name: "Tripod Spotting Scope",
			Desc: "A 22× scope on a field tripod. Across open marsh, shore and mountainside it reaches birds no binoculars can; in woodland it is a telescope pointed at leaves.",
			Kind: KindEquipment, Slot: SlotOptics, Tier: 3, Rarity: proto.RarityRare,
			Price: 680, ReqRank: 4, Source: "shop", Icon: "binoculars",
			Mods: mods{"binoZoom": 16, "binoClarity": 0.3, "binoStability": 0.3, "lowLight": 0.15,
				"binoFov": -14, "binoWeight": 1.8, "binoFocus": -0.5, "moveSpeed": -0.04},
			Pros: []string{"22× magnification: identify birds far out of reach", "Tripod-steady image", "Excellent clarity"},
			Cons: []string{"Tunnel-narrow view: hopeless for close or moving birds", "Slow to set up and slow to focus", "Heavy: it slows your walking"},
			Upgrades: []proto.UpgradeDef{
				up("spotting_scope_carbon", "Carbon Tripod Legs",
					"Half the weight on your shoulder, and quicker to plant.", 200,
					mods{"binoWeight": -0.6, "moveSpeed": 0.02}),
				fromRank(4, atWorkshop(up("spotting_scope_eyepiece", "Zoom Eyepiece",
					"A long-throw eyepiece you fit and collimate yourself: 28× at the top end with a slightly wider view.", 240,
					mods{"binoZoom": 6, "binoFov": 4}))),
			},
		},
		{
			ID: "historical_binoculars", Name: "Historical Binoculars",
			Desc: "Heavy brass 8× field glasses in a dusty leather case, the leather worn to the shape of one pair of hands.",
			Kind: KindEquipment, Slot: SlotOptics, Tier: 4, Rarity: proto.RarityLegendary,
			Source: "loot", Icon: "binoculars",
			Mods: mods{"binoZoom": 2, "binoClarity": 0.4, "lowLight": 0.5, "binoFov": 6, "observeSpeed": 0.15,
				"binoWeight": 0.6, "binoFocus": -0.4},
			Pros: []string{"Hand-ground glass: the clearest image you will ever look through", "Sees deep into dusk and dawn", "Field marks resolve faster while you watch"},
			Cons: []string{"Solid brass: slow to raise and tiring to hold", "The focus wheel is stiff with age"},
			History: "Engraved inside the hinge, almost worn away: \"Greenhollow Survey — No. 1\". They belonged to the naturalist who first " +
				"counted the birds of this valley, alone, for thirty years, and who never owned a camera: everything in that famous survey " +
				"was learned through this glass. The trapper who sheltered the old surveyor kept the case on its nail long after, " +
				"waiting for someone to come back for it.",
			Special: "The hand-ground lenses gather light like nothing made since: birds stay sharp and bright long after other binoculars have " +
				"gone grey, and you read a watched bird's features 15% faster. The price is brass: they are heavy, and slow to focus.",
			Upgrades: []proto.UpgradeDef{
				fromRank(3, atWorkshop(up("historical_binoculars_service", "Workshop Service",
					"Strip, clean and re-grease the focus mechanism without touching the glass. The wheel turns like new.", 260,
					mods{"binoFocus": 0.4}))),
			},
		},
	}
}
