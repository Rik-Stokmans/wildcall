package narrator

// Lines about watching birds: observation, blocked views, new evidence, uncommon
// behaviour, flushing and settling, and rare discoveries (never announced as rare).
func init() {
	register(map[string][]string{
		// An unidentified bird under observation.
		"observe.unknown": {
			"{subj}, {act}. Now, who might you be?",
			"There. Something {size}, {colours}. Hold still, just a moment longer.",
			"Something {size}, with {bill}. Let's take a closer look.",
			"{subj}. Note the {marking}, I'm almost sure of it.",
			"{shape}, {act}. I don't know you yet, but I will.",
			"Look at it, {act}, without a care in the world. Or without a care about us, at any rate.",
			"{subj}. Not one I know. Every detail matters now.",
			"Watch, don't guess. Size, shape, colour. The rest follows.",
			"Ah, there you are. {colours}, and {size}.",
			"Easy now. {subj}, and it hasn't seen us. Or it's being polite.",
			"There's our mystery, {act}, quite unaware of the fuss it's causing.",
			"{subj}. A face I don't know, and I'm rather glad of it.",
			"Well, well. {shape}. I wonder what you are.",
			"Got you. Well, I've got your outline, anyway.",
		},
		"observe.blocked.foliage": {
			"Somewhere in all those leaves. I can see movement, and very little else.",
			"It's tucked well into the foliage. Patience, it'll shift.",
			"Leaves, leaves, and a hint of bird. Wait for a gap.",
			"Hiding in plain sight, behind every leaf in the wood.",
			"A different angle might do it. Or a little more patience.",
		},
		"observe.blocked.distance": {
			"Too far, really. A shape and not much more.",
			"A speck, at this distance. A charming speck, but a speck.",
			"It's a long way off. Closer would be nice, if it'll allow it.",
			"At this range it could be almost anything. Almost.",
		},
		"observe.blocked.dark": {
			"The light's going. I can make out a shape, and not much else.",
			"Too dark to see colour. Everything's grey in this light.",
			"Just a silhouette against the gloom.",
			"In this light, it's mostly outline and imagination.",
		},
		"observe.blocked.rain": {
			"Rain on the lenses, rain on everything. It's all a blur.",
			"Hard to see a thing through this rain.",
			"Wet, grey and blurry. That's the view, and probably the bird's opinion of the weather.",
		},
		"observe.blocked.motion": {
			"It won't sit still. A flicker here, a flicker there.",
			"If only it would stop for half a second.",
			"There and gone, there and gone. Exhausting just to watch.",
		},
		// An identified bird with no species line to hand.
		"observe.known": {
			"The {name}, {act}. Lovely.",
			"There's the {name}. Just as I'd hoped.",
			"Ah, {aname}, {act}. Taking no notice of us whatsoever.",
			"{aname}, {where}. Familiar, and still a pleasure.",
			"The {name} again. Always worth a second look.",
			"Look at that {name}. I never tire of them.",
			"Hello again, {name}.",
			"The {name}, {act}, as though we weren't here at all.",
		},

		// New evidence noticed about an unidentified bird.
		"evidence.size": {
			"Size first. {size}, I'd say.",
			"{size}, roughly, judging by its surroundings.",
			"{size}. That narrows it down a little.",
		},
		"evidence.shape": {
			"{shape}. That's a start.",
			"The silhouette says a great deal. {shape}.",
			"Look at the outline. {shape}.",
		},
		"evidence.colour": {
			"{colours}. Hard to miss, once you've seen it.",
			"Colour now. {colours}, mostly.",
			"{colours}. I'll remember that.",
		},
		"evidence.marking": {
			"There, the {marking}. That's the detail to remember.",
			"Note the {marking}. Field marks are everything.",
			"The {marking}. Now we're getting somewhere.",
		},
		"evidence.bill": {
			"And the bill. {bill}. A bill tells you what a bird eats, and that tells you a lot.",
			"Look at that, {bill}. Built for a particular job.",
			"{bill}. Worth remembering.",
		},
		"evidence.flight": {
			"{flight}. The way a bird flies is a kind of signature.",
			"Did you see that? {flight}.",
			"In the air now. {flight}.",
		},
		"evidence.behavior": {
			"{act}. Behaviour is evidence too.",
			"It's {act}. Every habit is a clue.",
		},
		"evidence.habitat": {
			"And it's fond of {habitat}. That counts for something.",
			"{habitat}. A bird is very often exactly where it belongs.",
		},
		"evidence.pitch": {
			"That voice again, and now I've had a proper listen. {sound}.",
		},
		"evidence.pattern": {
			"The rhythm of it. {sound}. That's worth writing down.",
		},
		"evidence.generic": {
			"Another detail for the notebook.",
			"That's one more piece of the puzzle.",
			"Every little detail helps.",
		},

		// Uncommon behaviour seen. {subj} is a perceived description or "the <name>".
		"behaviour.feeding": {
			"{subj}, feeding. That's the moment, right there.",
			"Breakfast, or lunch, or whatever this is. {subj} has found something good.",
			"Look, it's caught something. Nature at its most practical.",
			"Feeding. The most honest thing any creature does.",
		},
		"behaviour.bathing": {
			"A bath. {subj}, splashing about like a small child. Wonderful.",
			"Bathing. Dignity completely abandoned. I love it.",
			"Look at that, a proper wash. Every feather gets attention.",
			"There's nothing quite like a bird in a bath. Pure enthusiasm.",
		},
		"behaviour.nesting": {
			"Nesting material. {subj} is building something.",
			"Carrying something to a nest, I think. A respectful distance, now.",
			"A home in the making. Very busy, very important.",
			"There's a nest nearby, I'm sure of it. Gently does it.",
		},
		"behaviour.social": {
			"Company. They're interacting, and it's quite a performance.",
			"A little social drama. I'd love to know what's being said.",
			"Two of them, and there's clearly some history there.",
			"A disagreement, or a courtship. With birds, it's sometimes hard to tell.",
		},
		"behaviour.hovering": {
			"Hovering. Hanging there in the air by sheer effort.",
			"Look at that, perfectly still in mid air. Exhausting, I should think.",
			"{subj}, hovering. Every wingbeat a small act of balance.",
		},
		"behaviour.diving": {
			"And in it goes. Straight down.",
			"A dive. Gone in a splash.",
			"Did you see that dive? All or nothing.",
		},
		"behaviour.preening": {
			"Preening. Feathers need constant care, rather like a good tweed jacket.",
			"A spot of grooming. {subj} is taking its appearance very seriously.",
			"Preening. One feather at a time, nothing rushed.",
		},
		"behaviour.generic": {
			"Now that's something you don't see every day.",
			"Watch this. It's not often one gets to see it.",
		},

		// The player's hasty approach flushed a bird. Gentle, never scolding.
		"flush": {
			"Ah. Too hasty. Off it goes.",
			"And there it goes. My fault entirely.",
			"Gone. Birds don't care for a direct approach. Neither would I.",
			"Well, that's that. Slowly next time, I think.",
			"Off like a shot. We were a little too eager.",
			"Flushed it. Never mind, it'll be back. They usually are.",
			"There's a lesson in that. Patience usually gets closer than speed.",
			"Oh dear. Startled. Let's give it some peace.",
			"And away. A little more stealth, perhaps.",
			"Too close, too quickly. It'll forgive us, in time.",
		},
		// A bird settled or came back because the player waited.
		"settle": {
			"And it's back. Patience, rewarded.",
			"There, it's settled. It's decided we're harmless.",
			"Look, it's coming back. Stillness works wonders.",
			"Waiting pays. It's returned to its perch.",
			"It's forgotten all about us. Lovely.",
			"Back again, and calmer now. Good.",
			"That's the reward for sitting still. The world comes back to you.",
			"It's relaxed. We're part of the scenery now, which is exactly where we want to be.",
		},

		// Rare discoveries: quiet wonder, never the word.
		"rare.unusual_plumage": {
			"Wait. Look at that one. Pale, almost ghostly. I don't think I've seen one quite like it.",
			"Now that's extraordinary. Something about its colouring isn't quite usual.",
			"Oh, look at that. Washed out, like a photograph left in the sun. How remarkable.",
			"That one's different. Paler than it ought to be. One remembers birds like that.",
		},
		"rare.out_of_range": {
			"Now, that's interesting. That one seems a long way from where I'd expect to find it.",
			"I wouldn't have expected to see that one here. Not at all.",
			"Something's not quite right about where that bird is. Out of place, and all the more wonderful for it.",
			"A traveller, I think. Blown off course, or simply curious. Like us.",
		},
		"rare.rare_species": {
			"Oh. Oh, now. Stay very, very still.",
			"I don't quite believe what I'm seeing. Don't breathe.",
			"That. That is something special. Just watch.",
			"Some moments one waits years for. Quietly, now.",
		},
		"rare.generic": {
			"Well. That's one for the journal, and for the memory.",
			"Moments like this are why one comes out here at all.",
			"Remember this. Not many people ever get to see it.",
		},
	})
}
