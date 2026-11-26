package progress

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// FilmPerRoll is how many extra shots one film roll adds to the current expedition.
const FilmPerRoll = 12

// gadgetItems work passively while carried in the backpack (not in cabin storage)
// and each costs a slot to carry: with eight slots to begin with, which ones come
// along is the tradeoff. They have no slot and no upgrades.
func gadgetItems() []proto.ItemDef {
	return []proto.ItemDef{
		{
			ID: "headphones", Name: "Field Headphones",
			Desc: "Closed-back monitoring headphones. Worn over one ear while you listen, they take the edge off wind and water and sharpen your sense of where a call came from.",
			Kind: KindGadget, Tier: 1, Rarity: proto.RarityCommon,
			Price: 90, ReqRank: 1, Source: "shop", Icon: "headphones",
			Mods: mods{"noiseReduce": 0.15, "dirAccuracy": 0.08, "focusBonus": 0.1},
			Pros: []string{"Ignores 15% of wind, rain and water noise", "Tighter bearings on what you hear", "Focused listening reaches farther"},
			Cons: []string{"Takes up a pack slot"},
		},
		{
			ID: "pocket_guide", Name: "Pocket Field Guide",
			Desc: "A dog-eared regional guide with plates of every bird you are likely to meet and a few you are not. It never names a bird for you; it helps you rule the wrong ones out.",
			Kind: KindGadget, Tier: 1, Rarity: proto.RarityCommon,
			Price: 60, ReqRank: 1, Source: "shop", Icon: "bird",
			Mods: mods{"idAssist": 0.4},
			Pros: []string{"A longer, better-ordered list of candidates when you identify a bird"},
			Cons: []string{"Takes up a pack slot"},
		},
		{
			ID: "pocket_barometer", Name: "Pocket Barometer",
			Desc: "A brass aneroid barometer on a lanyard. Tap the glass: a falling needle means rain within hours.",
			Kind: KindGadget, Tier: 1, Rarity: proto.RarityCommon,
			Price: 70, ReqRank: 1, Source: "shop", Icon: "wind",
			Mods: mods{"forecast": 3},
			Pros: []string{"Three hours of weather forecast"},
			Cons: []string{"Takes up a pack slot"},
		},
		{
			ID: "field_stool", Name: "Folding Stool & Scrim",
			Desc: "A three-legged stool and a square of camouflage netting. Somewhere to sit, something to sit behind, and the patience tends to follow.",
			Kind: KindGadget, Tier: 1, Rarity: proto.RarityCommon,
			Price: 80, ReqRank: 1, Source: "shop", Icon: "camp",
			Mods: mods{"camp": 0.3, "settle": 0.15},
			Pros: []string{"Sitting down to wait works noticeably better", "Wary birds settle 15% sooner"},
			Cons: []string{"Takes up a pack slot"},
		},
		{
			ID: "tripod", Name: "Folding Tripod",
			Desc: "A light tripod with a ball head. Rock-steady frames and a still view at high magnification, once you have stopped to set it up.",
			Kind: KindGadget, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 150, ReqRank: 2, Source: "shop", Icon: "camera",
			Mods: mods{"camStability": 0.25, "binoStability": 0.2, "longLens": 0.2, "camReady": 0.25, "moveSpeed": -0.03},
			Pros: []string{"Much steadier camera and binoculars", "Tames the shake of long lenses"},
			Cons: []string{"The camera takes longer to bring up", "Slows your walking a little", "Takes up a pack slot"},
		},
		{
			ID: "audio_analyzer", Name: "Audio Analyzer",
			Desc: "A handheld meter that reads the frequency and level of whatever your ears are pointed at. Numbers for what you could only describe as \"high\" or \"thin\".",
			Kind: KindGadget, Tier: 2, Rarity: proto.RarityUncommon,
			Price: 260, ReqRank: 2, Source: "shop", Icon: "note",
			Mods: mods{"audioAssist": 1, "pitchInfo": 1, "distAcc": 0.1},
			Pros: []string{"Sound clues show the pitch of a call", "Recordings become stronger identification evidence", "A better estimate of distance"},
			Cons: []string{"Takes up a pack slot"},
		},
		{
			ID: "spectrogram_device", Name: "Spectrogram Device",
			Desc: "A small screen that draws sound as it happens: time across, pitch upward. A wren's song becomes a picture you can compare with another.",
			Kind: KindGadget, Tier: 3, Rarity: proto.RarityRare,
			Price: 340, ReqRank: 3, Source: "shop", Icon: "wave",
			Mods: mods{"spectrogram": 1, "patternInfo": 1, "audioAssist": 0.5},
			Pros: []string{"Live spectrogram on the recorder", "Sound clues show the pattern of a call", "Recordings become stronger identification evidence"},
			Cons: []string{"Takes up a pack slot"},
		},
		{
			ID: "explorers_lens", Name: "Explorer's Lens",
			Desc: "A folding brass magnifier with three stacked lenses and a bone handle polished by a lifetime of thumbs.",
			Kind: KindGadget, Tier: 4, Rarity: proto.RarityEpic,
			Source: "loot", Icon: "lens",
			Mods: mods{"lensInspect": 1, "trackSigns": 8},
			Pros: []string{"Inspecting feathers, tracks and feeding signs yields extra clues", "Signs on the ground catch your eye from 8 m farther"},
			Cons: []string{"Takes up a pack slot"},
			History: "Marsh surveyors read reedbeds the way others read newspapers: a chewed stem, a moulted feather, a line of prints in the mud. " +
				"This lens went out with them every morning, and its case still smells faintly of peat.",
			Special: "Look closely: with the lens in your pack, every feather, track and feeding sign you examine tells you more — what dropped " +
				"it, and what that bird was doing there. No other tool can do this.",
		},
	}
}

// keepsakeItems are story items whose effects apply while carried.
func keepsakeItems() []proto.ItemDef {
	return []proto.ItemDef{
		{
			ID: "forgotten_journal", Name: "Forgotten Field Journal",
			Desc: "A swollen, water-stained notebook in a weathered satchel. Sketch maps, sightings by date, and paths drawn in pencil that are on no printed map.",
			Kind: KindKeepsake, Tier: 4, Rarity: proto.RarityEpic,
			Source: "loot", Icon: "journal",
			Mods: mods{"trailSense": 15, "journalInfo": 1},
			Pros: []string{"Its sketch maps put the home valley's secret paths on your map", "While carried, hidden trails and secret places reveal from 15 m farther", "Its notes add a layer of detail to your own journal entries"},
			Cons: []string{"Takes up a pack slot"},
			History: "The working notebook of the naturalist who watched this valley before you. The entries grow shorter and more hurried " +
				"towards the end, and then simply stop. Pages have been torn out along the way; they turn up wherever the writer " +
				"once sat down to rest.",
			Special: "A second pair of eyes from another time. The moment you open it, its sketch maps add the home valley's four secret paths " +
				"to your map. While you carry it, other old paths show themselves from much farther away, and your species entries " +
				"gain the previous naturalist's margin notes.",
		},
	}
}

// supplyItems are consumables. They stack in the backpack and are used from it.
func supplyItems() []proto.ItemDef {
	return []proto.ItemDef{
		{
			ID: "film_roll", Name: "Film Roll",
			Desc: "A spare roll of film. Load it in the field for twelve more frames before you have to go home and develop.",
			Kind: KindSupply, Tier: 1, Rarity: proto.RarityCommon,
			Price: 15, ReqRank: 1, Source: "shop", Icon: "film",
			Stack: 6, Use: UseFilm,
			Pros: []string{"+12 shots this expedition"},
		},
		{
			ID: "seed_mix", Name: "Seed Mix",
			Desc: "A paper bag of sunflower hearts, millet and crushed peanuts. Scatter a handful, step well back, and sit still.",
			Kind: KindSupply, Tier: 1, Rarity: proto.RarityCommon,
			Price: 12, ReqRank: 1, Source: "shop", Icon: "seed",
			Stack: 8, Use: UseSeed,
			Pros: []string{"Draws seed-eating and ground-feeding birds to the spot for a while"},
		},
	}
}
