package content

import "fmt"

// finnSpeaker is the equipment specialist: easy, funny, and scrupulously honest about
// what his kit is bad at. He explains the trade-offs of the gear the shop really
// stocks (see internal/progress) and opens the shop through an action.
func finnSpeaker() *speaker {
	return &speaker{
		id:   NPCFinn,
		shop: true,
		voice: voice{
			offer:    "Right, since you are here: a favour, and I will make it worth your while.",
			taken:    "Brilliant. Mind the seed; it is worth more than it looks.",
			declined: "No bother. The offer stands, and so does the stall.",
			report:   "Is that what I think it is? Come here, let me see it.",
			thanks:   "That is the stall sorted. You are a credit to the trade.",
			busy:     "Not that one, not yet.",
			nothing:  "Nothing I am waiting on. Spend some credits, then, it is good for the economy.",
			bye:      "Right, see you.",
		},
		hub: finnHub,
		topics: []topic{
			{id: "f_optics", title: "What is the difference between binoculars?", lines: finnOptics},
			{id: "f_camera", title: "Which camera should I get?", lines: finnCamera},
			{id: "f_audio", title: "What about audio gear?", lines: finnAudio},
			{id: "f_pack", title: "How much can I carry?", lines: finnPack},
			{id: "f_upgrades", title: "Can I improve what I already have?", lines: finnUpgrades},
			{id: "f_credits", title: "How do I earn Field Credits?", lines: finnCredits},
			{id: "f_pantry", title: "Do you sell anything to cook with?", lines: finnPantry},
			{id: "f_flatbread", title: "Do you know a good trail bread?", lines: finnFlatbread, acts: teachRecipe("wild_garlic_flatbread")},
		},
		taken: map[string][]string{
			"perfect_moment": {
				"Brilliant. Here are two handfuls of seed mix to tip the odds. Press G to scatter it, step well back, sit down with X, and keep the camera up. A bird feeds for only a second or two, so have the shutter ready.",
			},
		},
		done: map[string][]string{
			"perfect_moment": {"There it is, right on the front of the stall, and the duck can go. Have a roll of film on me."},
		},
	}
}

func finnHub(c *dctx) []string {
	var l []string
	switch {
	case !c.turnedIn(TutorialQuest):
		l = append(l, "Morning! Mara has got you chasing something, has she? Mind she does not wear you out. Come back when you have a few credits and I will see you right.")
	case c.p.Credits >= 180 && !c.owns("explorer_binoculars"):
		l = append(l, "You have come into some credits, I see. The Explorer Binoculars are a hundred and eighty: eight times magnification and clean glass, and the pair most naturalists end up with.")
	default:
		l = append(l, "Come in, come in. Everything on the counter is something I have personally dropped, soaked or sat on.")
	}
	if c.p.Rep[FactionOutfitters] >= 40 {
		l = append(l, "You are a regular now. Some of the good kit stays behind the counter until I know who I am dealing with, and that includes you.")
	}
	if c.rank() >= 3 {
		l = append(l, fmt.Sprintf("A %s, no less. There is kit under the counter for people with that card.", RankTitle(c.rank())))
	}
	return l
}

func finnOptics(*dctx) []string {
	return []string{
		"Three things matter with binoculars, and you cannot have all of them. Magnification gets you more detail at a distance. Field of view gets you more of the scene, so a flock or something that will not sit still is easier to keep in sight. Steadiness keeps the picture still.",
		"More magnification means a narrower view and more shake. The Explorer pair is the happy middle most people settle on. The Wide-Field Glasses are brilliant in the canopy and poor at distance. The Ridgeline 10x reaches far and wobbles like jelly if you do not sit down first.",
		"Good glass is also brighter at dusk. Heavier glass takes longer to raise. Everything is a trade, and I will tell you which one before I take your credits.",
	}
}

func finnCamera(*dctx) []string {
	return []string{
		"The starter camera is fine for learning. After that it depends what you like to shoot. A telephoto reaches shy birds but shakes at full zoom. A fast-action body fires bursts that catch a bird in flight, but wastes film. A silent camera does not startle anything, and a macro does not reach anything beyond a few metres.",
		"Every shot uses a frame and a roll holds only so many. It is developed when you get back to the cabin. A film roll from me is a supply item: use one and you get a dozen more shots on that trip.",
		"Better cameras raise the ceiling on your score, but the score still depends on you: focus, framing, light and a clear view of the bird.",
	}
}

func finnAudio(*dctx) []string {
	return []string{
		"Two kinds of audio kit. Recorders and microphones go in your audio slot: the Directional Microphone rejects noise but you have to point it at the bird; the Parabolic reaches further and is worse at most else; the Advanced Recorder is the all-rounder.",
		"Then there are the gadgets: Field Headphones, an Audio Analyzer, a Spectrogram Device. They work whenever you carry them, but they take up room in your pack. Headphones help you hear, the spectrogram helps you read what you heard.",
		"For a clean recording: stay still, aim, and let the bird finish a whole phrase.",
	}
}

func finnPack(*dctx) []string {
	return []string{
		"Your pack holds only so much. Gadgets and keepsakes take up room; equipped items do not, so what you wear and carry in your hands is free. A bigger pack carries more, and some are heavier going.",
		"Anything you do not need on a trip, leave in the storage chest at the cabin. It is unlimited and it is not going anywhere.",
	}
}

func finnUpgrades(*dctx) []string {
	return []string{
		"Most gear can be improved: coatings for glass, harnesses for steadiness, better focus wheels. Each costs credits and each does one thing, and I will tell you what it does and what it costs you.",
		"Some of the work needs a proper bench, which means the workshop at your cabin. Get yourself one and the better upgrades are worth the trip home.",
	}
}

func finnCredits(*dctx) []string {
	return []string{
		"Field Credits come from work, not from wandering. Quests and research contracts pay, and so do discoveries, and so does a photograph or a recording submitted at your Research Desk, once each. Seeing the same robin twice earns you nothing, which is as it should be.",
		"Look at the board in your cabin for contracts. They are small and they pay properly.",
	}
}

func finnPantry(*dctx) []string {
	return []string{
		"I do, actually, and do not look so surprised. Oats, honey from the hives down the valley, and flour. Plain stuff. The wild plants bring the flavour and I bring the bits that keep.",
		"Put your own in the pack and cook it at the cabin or a camp fire. And do mind the pack: ingredients stack, but they still take up room, and a full pack means a picked mushroom has nowhere to go.",
	}
}

func finnFlatbread(*dctx) []string {
	return []string{
		"Wild garlic flatbread. Flour, a few crushed ramsons leaves, water, a hot dry pan. Nothing to it. I put one in my pocket every spring when the woods smell like a kitchen and I swear I walk further on it.",
		"I have written it down for you. You will need the stove at the cabin: a camp fire is not flat enough, and I speak from experience.",
	}
}
