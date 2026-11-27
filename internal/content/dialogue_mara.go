package content

import (
	"fmt"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// maraSpeaker is the veteran naturalist: patient, wry, and unwilling to give away an
// answer. Her first conversation is the tutorial (spec §27 stage 1): movement and
// interaction, listening, binoculars, the journal, then The Unseen Singer. The same
// lessons stay available afterwards as "a refresher".
//
// Rule for this file: until The Unseen Singer is handed in, nothing Mara says names
// the bird she is sending the player to find.
func maraSpeaker() *speaker {
	return &speaker{
		id: NPCMara,
		voice: voice{
			offer:    "Here is what I had in mind.",
			taken:    "Good. Take your time. Nobody is counting.",
			declined: "Of course. It will keep. Most good things do.",
			report:   "You have the look of someone who has finished something. Let me see.",
			thanks:   "Well done. Truly.",
			busy:     "Not that one, not just yet.",
			nothing:  "Nothing outstanding. That is the nicest sort of afternoon.",
			bye:      "I'll see you later.",
		},
		entry: maraEntry,
		hub:   maraHub,
		topics: []topic{
			{id: "t_move", title: "Remind me how everything works.", lines: tutMove, follow: tutFollow("t_listen", "Go on."), acts: setFlags("tutorial:move")},
			{id: "t_stealth", title: "How do I get close without scaring them?", lines: maraStealth},
			{id: "t_time", title: "Does the time of day matter?", lines: maraTime},
			{id: "t_cabin", title: "What is the cabin for?", lines: maraCabin},
			{id: "t_why", title: "Why won't you just tell me the answer?", lines: maraWhy},
			{id: "t_seed", title: "Can I coax birds closer?", lines: maraSeed, acts: maraSeedGift},
			{id: "t_forage", title: "Is it all right to eat what grows out here?", lines: maraForage, follow: maraForageFollow},
			{id: "t_kettle", title: "What do I do with the kettle?", lines: maraKettle},
			{id: "t_elder", title: "What do I do with elderberries?", lines: maraElder, acts: teachRecipe("elderberry_syrup")},
			// Stories the naturalists' standing unlocks (spec §16.2).
			{id: "m_edith", title: "Tell me about Edith Harrow.", lines: maraEdith, minRep: 40},
			{id: "m_margins", title: "What did Edith write in her margins?", lines: maraMargins, minRep: 100},
			// The rest of the tutorial chain: reachable only through t_move.
			{id: "t_welcome", hidden: true, lines: tutWelcome, follow: tutFollow("t_move", "Go on, then.")},
			{id: "t_listen", hidden: true, lines: tutListen, follow: tutFollow("t_bino", "And the binoculars?"), acts: setFlags("tutorial:listen")},
			{id: "t_bino", hidden: true, lines: tutBino, follow: tutFollow("t_journal", "And then?"), acts: setFlags("tutorial:binoculars")},
			{id: "t_journal", hidden: true, lines: tutJournal, follow: tutJournalFollow, acts: setFlags("tutorial:journal", "tutorial:intro")},
			{id: "t_progress", hidden: true, lines: maraProgress, follow: tutFollow("t_move", "Remind me how things work.")},
		},
		report: map[string][]string{
			TutorialQuest:  {"There you are. Your journal has the look of a page that has had a day. Come on, then: show me what you found."},
			"golden_flute": {"You were gone a while. Tell me you heard it."},
		},
		taken: map[string][]string{
			TutorialQuest: {
				"Good. Here, take my recorder. It is older than you are and still works. Press 3 to bring it out, point it at the singer, click to start and click again to stop.",
				"I shall not tell you what it is; that would spoil it. I hear it from the old woodland trail past the Woodland Entrance, low in the tangle beside the path. Go slowly, stop often, hold F. Come back when you know.",
			},
		},
		done: map[string][]string{
			TutorialQuest: {
				"A wren! Of course it was. Ten grams of bird and a song like a handful of gravel thrown at a tin roof. This valley is full of people who have walked past that bird a thousand times, and you went and found it with your ears. That is exactly how it begins.",
				"You have earned a little something, and a skill point. Press K and spend it: Keen Ears if you want to hear more, Sharp Eyes if you want to see more. Finn's stall at the Woodland Entrance has better binoculars than those, and I would say you can afford a pair now.",
				"Level three and five species will make you an Observer, and then the marsh and Amberwood open up. June at the ranger station signs the permits. And do not neglect the places that are on no trail. Those are the best of it.",
			},
			"familiar_voice": {"Three voices and no faces. You see? Once the ear is trained, half of the wood introduces itself."},
			"golden_hour":    {"There it is: the light does half the work, you only have to be standing in the right place. Keep that one."},
			"harrows_places": {"The pond, the rock, the cabin and the camp. Edith Harrow would have been very pleased. So am I, rather more than I expected to be."},
			"amber_passage":  {"Autumn light on a wing. I could look at those all evening, and I think I shall."},
			"golden_flute":   {"The Golden Oriole. In Greenhollow. After forty years of my saying they had never really gone. Thank you. Truly, thank you."},
		},
	}
}

func setFlags(flags ...string) func(*dctx) []Action {
	return func(*dctx) []Action {
		acts := make([]Action, len(flags))
		for i, f := range flags {
			acts[i] = Action{Kind: ActionSetFlag, Flag: f, Value: true}
		}
		return acts
	}
}

// tutFollow continues a lesson with a single "next" choice.
func tutFollow(id, text string) func(*dctx) []proto.DialogChoice {
	return func(*dctx) []proto.DialogChoice { return []proto.DialogChoice{next(id, text)} }
}

// tutJournalFollow ends the lessons: on the first run it leads into the quest.
func tutJournalFollow(c *dctx) []proto.DialogChoice {
	if !started(c.status(TutorialQuest)) {
		return []proto.DialogChoice{next(pfxOffer+TutorialQuest, "You said there was something you wanted looked into?")}
	}
	return nil
}

func maraEntry(c *dctx) string {
	switch st := c.status(TutorialQuest); {
	case st == StatusActive:
		return "t_progress"
	case !started(st) && !c.flag("tutorial:intro"):
		return "t_welcome"
	}
	return ""
}

func maraHub(c *dctx) []string {
	f := c.facts()
	switch st := c.status(TutorialQuest); {
	case st == StatusActive:
		return []string{"Take your time. Listening is most of the job, and the wood is in no hurry either."}
	case !started(st):
		return []string{"Back again. Are you ready to go and find our singer?"}
	}
	var l []string
	switch c.rank() {
	case 1:
		l = append(l, "You have the right habit already: you stop, and you listen. Most people never do.")
	case 2:
		l = append(l, "An Observer now. The marsh and Amberwood are yours to ask June about.")
	case 3:
		l = append(l, "A Naturalist. I remember getting that card. Windpeak and the coast are open to you.")
	case 4:
		l = append(l, "A Field Specialist. There are not many of those. Even Frostveil will let you in.")
	default:
		l = append(l, "A Master Naturalist. I have nothing left to teach you, and I shall keep talking regardless.")
	}
	switch {
	case f.species < 5:
		l = append(l, fmt.Sprintf("You have named %s so far. Five makes an Observer, and there are plenty more in the wood.", speciesWord(f.species)))
	case f.species < 12:
		l = append(l, fmt.Sprintf("%s in your journal already. I did not have half as many in my first year.", capitalFirst(speciesWord(f.species))))
	case f.species < 25:
		l = append(l, fmt.Sprintf("%s. You are a better field naturalist than I was at your age, and do not tell anyone I said so.", capitalFirst(speciesWord(f.species))))
	default:
		l = append(l, fmt.Sprintf("%s. I stopped counting at thirty, because it began to feel like boasting.", capitalFirst(speciesWord(f.species))))
	}
	l = append(l, maraStanding(c.rep()))
	if f.rare != nil {
		l = append(l, fmt.Sprintf("And word reaches even me: \"%s\". I would have given a week's tea to have seen that.", f.rare.Title))
	}
	return l
}

func capitalFirst(s string) string {
	if s == "" {
		return s
	}
	b := []byte(s)
	if b[0] >= 'a' && b[0] <= 'z' {
		b[0] -= 'a' - 'A'
	}
	return string(b)
}

func tutWelcome(*dctx) []string {
	return []string{
		"Ah, the new naturalist. Come in out of the damp. I am Mara. I have walked this wood a good deal longer than you have been alive, and I do not intend to stop.",
		"This is your cabin and the valley is yours to wander. Nobody will mark the birds on a map for you, and nothing here is a test. You cannot fail it. You can only learn it.",
		"Let me give you the basics before you go out.",
	}
}

func tutMove(*dctx) []string {
	return []string{
		"Walk with W, A, S and D and look about with the mouse. Hold Shift to run, though birds notice quick movement, so mostly you will want to walk. C crouches and X sits you down to wait, and both make you far less worrying to a bird.",
		"Press E when something invites you: a signpost, a satchel, me. The cabin door too. Anything you can use shows a small prompt when you are close enough.",
	}
}

func tutListen(*dctx) []string {
	return []string{
		"Now the important part: listen first, look second. When a bird sings, a soft tick appears along your compass and a card at the edge of the screen tells you roughly which way, how far, and what the voice is like: high or low, a trill or a phrase.",
		"Hold F to listen properly. The wood goes quiet around you and your hearing sharpens, though you walk slowly while you do it. Rain and wind take sound away, and so do your own footsteps, so stand still and you will catch more.",
		"And a voice never gives you a name. Not at first. A name is something you earn.",
	}
}

func tutBino(*dctx) []string {
	return []string{
		"Press 1 for your binoculars, hold the right mouse button to raise them, and use the wheel to zoom. The picture needs a moment to come into focus when you swing from near to far, and your hands shake more the harder you zoom, so crouch or sit if you can.",
		"Keep a bird in the middle of the view and you slowly pick up its marks: size, shape, colours, bill, what it is doing. When you have a few, press T and weigh up what it might be. If you guess wrong nothing is lost; you learn one thing that does not fit and you try again.",
		"Key 2 is your camera: right mouse to raise it, left click for the shutter. Key 3 is the recorder.",
	}
}

func tutJournal(c *dctx) []string {
	l := []string{
		"Everything lands in your journal. Press J. A voice you cannot put a name to still gets a page, labelled as an unknown bird, with whatever evidence you gathered, and you can come back and name it whenever you like.",
		"L opens your quests and M the map. The map fills in as you walk, and it never marks a bird. That is not a limitation. That is the whole art of it.",
	}
	if !started(c.status(TutorialQuest)) {
		l = append(l, "There is something I would like you to look into, if you have a mind to.")
	}
	return l
}

// maraProgress coaches the player through the tutorial quest's current step.
func maraProgress(c *dctx) []string {
	cur, ok := c.t.Current(c.p, TutorialQuest)
	if !ok {
		return []string{"You are nearly there. Go and see what is left."}
	}
	coach := map[string]string{
		"hear":        "Not yet? Patience. The wood does not perform on demand. Keep to the old trail, stop every few steps, hold F and turn slowly. You are listening for something that is not a robin.",
		"investigate": "You have heard it. Now follow it. Go round it rather than at it, and crouch as you get near. It knows you are coming long before you know where it is.",
		"record":      "Good, you have found it. Now catch it: recorder out with 3, aim, click, and keep still until it has sung a whole verse.",
		"identify":    "Now name it. Watch it a while through the binoculars, collect your marks, then press T. Take your time. Probable is a perfectly respectable answer.",
		"photograph":  "The last piece: a photograph. It likes to climb a stump to sing, so wait beside one with the camera raised.",
	}
	l := []string{coach[cur.ID]}
	if coach[cur.ID] == "" {
		l = []string{cur.Text + "."}
	}
	if cur.Hint != "" {
		l = append(l, cur.Hint)
	}
	return l
}

func maraStealth(*dctx) []string {
	return []string{
		"A bird weighs up a stranger by how fast it comes and from which direction. Walking straight at one is the rudest thing you can do. Sidle instead: go across its line rather than along it, stop when it stiffens or looks at you, and crouch.",
		"Sit with X and keep still, and after a while it forgets you. Do that often enough in the same place and the locals decide you are furniture.",
		"If one does fly, do not chase it. It will be back at the same patch within a couple of minutes. Birds are creatures of habit, and so, I am afraid, are we.",
	}
}

func maraTime(*dctx) []string {
	return []string{
		"Dawn is when the wood is loudest. Between about half past four and seven everything sings at once. By midday most birds go quiet and sit still; the evening brings a second, smaller chorus, and after dark the owls take over.",
		"Rain and wind quiet the birds and muffle what is left. Mist is lovely, but it hides them. Seasons turn every four days, so some visitors are only here for a spell. A day takes about twenty-four minutes, an hour of ours is about a minute of yours.",
		"If you want the dawn chorus, rest at the cabin until dawn. It is much easier than waiting.",
	}
}

func maraCabin(*dctx) []string {
	return []string{
		"The cabin is your base. Press E at the door. At the Research Desk you review the mysteries in your journal, analyse your recordings, study the species you have documented, and take the contracts on the board. You will also find the equipment station, your storage, and the photo wall.",
		"Your camera only holds so many frames. When you come home, the roll is developed and you start again fresh. Rest if you want to skip to a particular hour: dawn, midday, evening, night.",
		"Over time you can improve it: an audio lab for your recordings, a wall for your photographs, a workshop, a map room, and a garden that always has a feeder out.",
	}
}

func maraWhy(*dctx) []string {
	return []string{
		"Because you would forget it by morning. A name handed to you means nothing. One you have worked out for yourself, from a size, a shape, a bill and the way it moves, stays with you for life.",
		"And you cannot get it wrong in any way that matters. A wrong guess tells you one thing that does not fit, and you try again. \"Probable\" is a perfectly good answer: you can firm it up later with a photograph or a recording.",
	}
}

func maraSeed(c *dctx) []string {
	if c.flag("gift:mara_seed") {
		return []string{
			"Seed eaters and ground feeders will come to a scatter of seed if you give them room. Press G to scatter it, step back, sit, and wait. They will not come while you are standing over it. I gave you my spare; Finn sells more.",
		}
	}
	return []string{
		"Seed eaters and ground feeders will come to a scatter of seed if you give them room. Press G to scatter it, step back, sit, and wait. They will not come while you are standing over it.",
		"Here, a handful of mine. Do not expect owls.",
	}
}

func maraSeedGift(c *dctx) []Action {
	if c.flag("gift:mara_seed") {
		return nil
	}
	return []Action{
		{Kind: ActionGiveItem, Item: itemSeed, Qty: 1},
		{Kind: ActionSetFlag, Flag: "gift:mara_seed", Value: true},
	}
}

func maraForage(*dctx) []string {
	return []string{
		"Yes, some of it, and gladly. I have been eating this valley for forty years: nettles in spring, bilberries in summer, hazelnuts when the jays have had theirs. A forager's day is a naturalist's day with a basket.",
		"Press E on a plant that has something to give. A bramble has fruit only in late summer and autumn, and a plant you have just picked will not bear again for a few days, so do not stand and wait.",
		"There is one rule and it is the only one that matters: pick nothing you cannot identify with certainty. The plant has a page in your journal, in the Herbarium, with how to tell it from its lookalikes. The mushrooms most of all. If you are in any doubt, you leave it where it is.",
	}
}

func maraForageFollow(c *dctx) []proto.DialogChoice {
	for _, q := range []struct{ id, text string }{
		{"tea_at_the_cabin", "You said something about an errand with a kettle?"},
		{"a_meal_from_the_wood", "Is there more to cook?"},
	} {
		if ch := offerIfAvailable(q.id, q.text)(c); len(ch) > 0 {
			return ch
		}
	}
	return nil
}

func maraKettle(*dctx) []string {
	return []string{
		"The kettle at the cabin is yours, and so is every camp's fire in the wild: stand near either, press E, and see what you know how to make. The stove is at the cabin only, and some things need its oven.",
		"You already know pine-tip tea, mint tea and oat bars. Pick a new plant for the first time and you will usually learn something to do with it. And a hot drink in the field does more for the hands than you would think.",
		"Food and drink give you a little help for a few hours, one of each sort at a time: a drink, a snack and a meal. A new cup of something replaces the last one, so there is no use in drinking two. Do not expect miracles. It is tea.",
	}
}

func maraElder(*dctx) []string {
	return []string{
		"Elder. The flowers in spring and the berries in autumn. Flowers go into a cordial, which is easy. The berries, now: never raw. Raw elderberries will give you a very bad afternoon. Cooked slowly with honey, they make the best syrup there is, and I will show you how.",
		"Simmer them gently until they burst, strain through a cloth, and add honey. I have written it into your recipes. Take the stalks off first, and leave a fair share on the bush for the birds.",
	}
}

// maraStanding is Mara's remark on the player's standing with the naturalists. The
// bands are <20, 20-59, 60-149 and 150+.
func maraStanding(rep int) string {
	switch {
	case rep < 20:
		return "The naturalists' circle does not know your name yet. It will: every species you document goes into the record, and somebody always reads the record."
	case rep < 60:
		return "Your name has started turning up in the circle's notebooks. Mostly spelled correctly."
	case rep < 150:
		return "The circle speaks of you the way we speak of good weather: with approval, and a little suspicion that it cannot last."
	default:
		return "There is not a naturalist in the valley who has not heard your name. Edith would have pretended not to be impressed. So shall I."
	}
}

// maraEdith is Mara's memory of the woman who taught her (40 naturalists reputation).
func maraEdith(c *dctx) []string {
	l := []string{
		"Edith. Well. I was nine or ten when I first climbed her tower, uninvited, and she did not send me down. She gave me a cup of tea and told me to be quiet for an hour. I have been doing it, on and off, ever since.",
		"She kept two books: the keeper's log for the sky, and her own for the birds. Thirty years of it, and she never published a word. A bird written down by someone who had not seen it was a rumour, she said, and she would not add to the rumours.",
		"She taught the way I teach you, which is to say infuriatingly. I would describe a bird, and she would ask what it was doing, and where, and at what hour, until I had answered my own question. You may blame her for me.",
	}
	if c.owns("forgotten_journal") || c.turnedIn("old_watchtower") {
		l = append(l, "And you found her papers at the tower. I am glad it was you. She would have looked at you over her spectacles for a long while, and then put the kettle on.")
	} else {
		l = append(l, "Her own book went missing when she left the tower. June has her suspicions about where. So, if I am honest, do I.")
	}
	return l
}

// maraMargins explains the Forgotten Field Journal's margin notes (100 naturalists
// reputation): the client shows one only for a species the player has identified, while
// the journal is in the player's possession.
func maraMargins(c *dctx) []string {
	l := []string{
		"She wrote in the margins of everything: where, when, and something faintly rude about the weather, beside every bird she knew. Short notes. She said a long note was a sign you had not been paying attention at the time.",
	}
	if c.owns("forgotten_journal") {
		l = append(l, "Keep her journal with you and those notes open up beside your own pages, but only for birds you have named yourself. A note on a bird you have never met would just be another rumour, and you know how she felt about those.")
	} else {
		l = append(l, "If her journal ever turns up, keep it with you. Her notes will sit beside the birds you have already named, and keep quiet about the rest. She was very firm about not spoiling things.")
	}
	l = append(l, "The ones from beyond the valley are her sister's, copied out of letters. Edith never went further than Amberwood. She always meant to. Read them slowly; she wrote slowly.")
	return l
}
