package progress

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// audioItems: recorders and microphones for the audio slot (spec §5.5, §9.7). Base:
// clean recordings within 25 m, fidelity 0.4, no directionality. The ladder is a
// real choice, not a line: directional rigs reach far and reject noise but must be
// aimed and are bulky; the advanced recorder is pristine but must be carried close.
// Headphones, the analyzer and the spectrogram device are gadgets (items_misc.go).
func audioItems() []proto.ItemDef {
	return []proto.ItemDef{
		{
			ID: "basic_recorder", Name: "Basic Recorder",
			Desc: "Mara's old pocket recorder with its built-in microphone. Get close, hold still, and it will keep a voice for you.",
			Kind: KindEquipment, Slot: SlotAudio, Tier: 1, Rarity: proto.RarityCommon,
			Source: "quest", Icon: "recorder",
			Pros: []string{"Hears all around: no aiming needed", "Small and simple"},
			Cons: []string{"Short range: about 25 m for a clean take", "Picks up wind and water as readily as birdsong"},
			Upgrades: []proto.UpgradeDef{
				up("basic_recorder_windscreen", "Foam Windscreen",
					"A fuzzy cover for the microphone. The wind stops roaring on your tapes.", 45,
					mods{"noiseReduce": 0.08}),
				up("basic_recorder_heads", "Cleaned Tape Heads",
					"An hour with cotton buds and alcohol: clearer takes, a few metres more reach.", 70,
					mods{"recQuality": 0.07, "recRange": 3}),
			},
		},
		{
			ID: "directional_microphone", Name: "Directional Microphone",
			Desc: "A shotgun microphone on a pistol grip. Point it at a singer and the rest of the forest steps back.",
			Kind: KindEquipment, Slot: SlotAudio, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 210, ReqRank: 2, Source: "shop", Icon: "microphone",
			Mods: mods{"recRange": 20, "recFocus": 0.55, "noiseReduce": 0.12, "recQuality": 0.1, "stamina": -0.5},
			Pros: []string{"Clean recordings from nearly twice as far", "Rejects noise from the sides", "Better fidelity"},
			Cons: []string{"Must be aimed: a call off to one side is lost", "The boom and cable are an awkward carry: a shorter sprint"},
			Upgrades: []proto.UpgradeDef{
				up("directional_microphone_blimp", "Wind Blimp",
					"A zeppelin cover for breezy days on the ridge and the shore.", 110,
					mods{"noiseReduce": 0.1}),
				atWorkshop(up("directional_microphone_preamp", "Low-Noise Preamp",
					"A quieter preamplifier you solder in yourself.", 160,
					mods{"recQuality": 0.1})),
			},
		},
		{
			ID: "parabolic_microphone", Name: "Parabolic Microphone",
			Desc: "A clear dish half a metre across that gathers a distant voice to a point. Astonishing reach, if you can hold it on the bird — and carry it there.",
			Kind: KindEquipment, Slot: SlotAudio, Tier: 3, Rarity: proto.RarityRare,
			Price: 520, ReqRank: 4, Source: "shop", Icon: "microphone",
			Mods: mods{"recRange": 60, "recFocus": 0.9, "recQuality": 0.2, "noiseReduce": 0.15, "stamina": -1, "moveSpeed": -0.05},
			Pros: []string{"Records clearly from 85 m and beyond", "Isolates one singer from a whole chorus", "Rich, close-sounding takes"},
			Cons: []string{"Pinpoint aim required", "The dish is a burden to carry: a shorter sprint", "Awkward to carry: it slows your walking"},
			Upgrades: []proto.UpgradeDef{
				fromRank(4, atWorkshop(up("parabolic_microphone_fold", "Folding Dish",
					"Cut and hinge the dish into petals so it packs flat.", 230,
					mods{"stamina": 0.5, "moveSpeed": 0.03}))),
			},
		},
		{
			ID: "advanced_recorder", Name: "Advanced Field Recorder",
			Desc: "A studio-grade recorder with matched stereo capsules. What it hears it keeps perfectly; it simply has to be near enough to hear it.",
			Kind: KindEquipment, Slot: SlotAudio, Tier: 3, Rarity: proto.RarityRare,
			Price: 460, ReqRank: 3, Source: "shop", Icon: "recorder",
			Mods: mods{"recQuality": 0.45, "noiseReduce": 0.15, "audioAssist": 0.5, "recRange": -5},
			Pros: []string{"Studio fidelity: five-star recordings within reach", "Clean preamps cut hiss and rumble", "Detailed takes are stronger identification evidence"},
			Cons: []string{"Built-in capsules: you must get even closer than with the basic recorder", "No directionality at all"},
			Upgrades: []proto.UpgradeDef{
				up("advanced_recorder_filter", "High-Pass Filter",
					"Rolls off wind rumble and river roar below the birds.", 120,
					mods{"noiseReduce": 0.1}),
				atWorkshop(up("advanced_recorder_capsules", "Extended Capsules",
					"Longer-reaching capsules, matched by ear at your bench.", 200,
					mods{"recRange": 8, "recQuality": 0.05})),
			},
		},
		{
			ID: "vintage_recorder", Name: "Vintage Field Recorder",
			Desc: "A reel-to-reel recorder in a scuffed leather case, wrapped in oilcloth against the damp. The meters still twitch when you wind it.",
			Kind: KindEquipment, Slot: SlotAudio, Tier: 4, Rarity: proto.RarityEpic,
			Source: "loot", Icon: "recorder",
			Mods: mods{"recQuality": 0.3, "callMemory": 1, "audioAssist": 0.75, "noiseReduce": -0.15, "recRange": -6},
			Pros: []string{"Warm, full-bodied tape sound", "Its reels teach your ear: you recognise any species you have recorded", "Slow tape reveals a call's structure"},
			Cons: []string{"Tape hiss: it undoes some of your noise reduction", "An old capsule: you must get close"},
			History: "Left behind at a survey camp that was packed up in a hurry and never reopened. A reel is still threaded: forty minutes of a " +
				"dawn chorus from a spring long before you were born, with a pencilled note on the box — \"listen twice before you look once\".",
			Special: "Recordings made on tape have a warmth no modern recorder matches, and playing them back at half speed trains the ear: " +
				"while you use it you recognise by voice every species you have recorded, with no skill needed. The price is hiss and a short reach.",
			Upgrades: []proto.UpgradeDef{
				fromRank(2, atWorkshop(up("vintage_recorder_belts", "New Drive Belts",
					"Fresh belts and a demagnetised head: steadier tape, far less hiss.", 180,
					mods{"noiseReduce": 0.1}))),
			},
		},
	}
}
