package narrator

// Lines about results: identifications, photographs and recordings. A wrong guess is
// always met kindly, and never names anything.
func init() {
	register(map[string][]string{
		"identify.certain": {
			"{aname}. Of course it is. How satisfying.",
			"{aname}, without a doubt. Well spotted.",
			"There we are, {aname}. Introductions complete.",
			"{aname}. Every clue pointing the same way. Beautifully done.",
			"Yes. {aname}. I'll never hear that voice quite the same way again.",
			"{aname}. Now we know each other properly.",
			"So that's who you are. {aname}. Delighted.",
			"{aname}. It always feels like a small miracle, putting a name to a voice.",
			"A name at last, and a well-earned one.",
		},
		"identify.probable": {
			"{aname}, probably. I'd want another look to be certain.",
			"Probably {aname}. Probably. A good photograph would settle it.",
			"I think {aname}. Not quite sure enough to swear to it.",
			"{aname}, most likely. We'll know more next time.",
			"Leaning towards {aname}. A little more evidence wouldn't hurt.",
			"Very likely right. Though I'd like one more good look.",
		},
		"identify.wrong": {
			"Hm. I'm not sure that fits. Something doesn't quite match.",
			"Not that, I think. No shame in it. It happens to everyone.",
			"Close, perhaps, but not quite. Let's keep looking.",
			"I don't think so. The details don't agree with each other yet.",
			"Not quite. Back to the evidence, then. It's patient, even if we aren't.",
			"Hm, no. A good guess, but the bird disagrees.",
			"Not that one. Every wrong answer narrows the field, you know.",
			"Not quite right. But we're closer than we were.",
		},
		"identify.mismatch": {
			"I'm not sure about the {mismatch}. It doesn't quite match.",
			"The {mismatch} doesn't sit right with that, I think. Worth another look.",
			"Hm. The {mismatch} rather argues against it.",
		},
		"identify.insufficient": {
			"Too soon to say, really. We need to see more of it.",
			"Not enough to go on yet. A few more details, I think.",
			"I couldn't honestly put a name to it yet. More watching.",
			"It's a guess at this stage, and guesses are risky things.",
			"Let's not rush it. A little more evidence first.",
			"We've barely met. Another look would help.",
		},

		"photo.empty": {
			"A lovely photograph of a branch. The bird had other plans.",
			"Hm. Mostly leaves, that one.",
			"Nothing in frame, I'm afraid. It happens.",
			"A fine study of where a bird used to be.",
			"Missed. The bird moved, or the camera did.",
		},
		"photo.poor": {
			"Well, it's a bird. Probably. A souvenir, if not a masterpiece.",
			"A bit soft, that. Still, it's a start.",
			"Not the sharpest, but it's a record.",
			"Something to build on. They can't all be gems.",
			"Better than nothing, and nothing is what most people get.",
		},
		"photo.good": {
			"Oh, that's rather nice.",
			"Nicely done. That's one for the journal.",
			"A good one. Sharp and well framed.",
			"Now that's a proper photograph.",
			"Lovely. The bird even seemed to cooperate.",
		},
		"photo.great": {
			"Oh, that is something. That is really something.",
			"Now that one goes on the wall.",
			"Perfect. I wouldn't change a thing.",
			"That's the shot. Years from now, you'll still remember taking it.",
		},
		"photo.golden": {
			"And in that light. The whole thing glows.",
			"Golden light. Everything looks its best at this hour.",
			"That warm, low light. Couldn't have asked for better.",
		},
		"photo.behaviour": {
			"Caught in the act. That's the photograph that tells a story.",
			"Not just a bird, but a bird doing something. That's the difference.",
			"A moment, not just a portrait. Splendid.",
			"{act}, and caught at exactly the right instant.",
		},

		"rec.none": {
			"Nothing usable, I'm afraid. Just wind and footsteps.",
			"Hm. That's mostly the sound of us.",
			"No luck. The bird fell silent at just the wrong moment.",
			"Plenty of atmosphere on that one, and not much bird.",
		},
		"rec.poor": {
			"A bit faint, but it's there if you listen closely.",
			"Rather noisy. Still, it's a voice on tape.",
			"Not perfect, but a record is a record.",
		},
		"rec.good": {
			"A clean recording. Lovely.",
			"That came out nicely. You can hear every note.",
			"Good. That one's worth keeping.",
			"Clear as anything. Well done.",
		},
		"rec.great": {
			"Oh, that's beautiful. Like having the bird in the room.",
			"Crisp, close and clear. A recording to be proud of.",
			"Every note, every breath. Wonderful.",
		},
	})
}
