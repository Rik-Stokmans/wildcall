package narrator

// Lines about what is heard: new voices, mysteries heard again, known voices, and
// focus listening. Unknown-bird lines use only perception slots, and each template
// uses at most one slot so the set of spoken sentences stays small (AllLines).
func init() {
	register(map[string][]string{
		// A voice the player has never heard before.
		"call.new": {
			"{sound}. I don't believe we've been introduced.",
			"Listen. {sound}. Somebody out there with a great deal to say.",
			"{sound}. Unfamiliar, and rather pleased with itself, by the sound of it.",
			"What have we here? {sound}. New to me.",
			"Hello. Someone new, {where}.",
			"Now what was that? Something {where}.",
			"A voice I can't place, {dist}. I haven't the faintest idea who that is, and I'm delighted.",
			"A new voice, somewhere {dir}. I'd very much like to meet its owner.",
			"A stranger, {elev}, and an interesting one.",
			"There's a voice I haven't heard before.",
			"I don't know you, but I should very much like to.",
			"Ah, a newcomer. Now who are you?",
			"Not a voice I know. Not yet, anyway.",
		},
		// Pattern-specific first impressions.
		"call.new.melodic": {
			"A most sophisticated little song, that. I couldn't begin to tell you who sang it.",
			"Now that is a proper song. Fluent, unhurried, and entirely unfamiliar.",
		},
		"call.new.trill": {
			"A trill, running down like water over stones. Who are you, I wonder?",
			"That rippling trill. New to me, and very cheerful about it.",
		},
		"call.new.harsh": {
			"Well, that was hardly a lullaby. A harsh, scolding voice.",
			"A rasping call. Not pretty, but very much worth following.",
		},
		"call.new.drumming": {
			"That drumming. A rhythm rather than a song. Curious.",
			"A rapid drumming, like a tiny carpenter in a hurry. I'd love to see who's making it.",
		},
		"call.new.booming": {
			"Did you feel that? A deep, hollow boom. A sound with some weight to it.",
			"A low boom. I'm not entirely sure what makes a noise like that. Let's find out.",
		},
		"call.new.whistle": {
			"A clear whistle, as though someone were calling a dog. Someone with feathers, presumably.",
			"That fluting whistle. Lovely, and quite new to me.",
		},
		"call.new.chatter": {
			"A busy chatter. Somebody has a great deal to get off their chest.",
			"That scratchy chatter goes on and on. New to me, and in no hurry to stop.",
		},
		"call.new.laughing": {
			"Something out there is laughing. A raucous voice. I do hope it isn't at us.",
			"A laughing call. Loud, cheerful, and quite unknown to me.",
		},
		"call.new.repeated": {
			"The same phrase, again and again. Insistent little thing, whoever you are.",
			"Repeat, repeat, repeat. A voice that believes in making itself perfectly clear.",
		},
		"call.new.single": {
			"One note, and then nothing. Tantalising.",
			"A single call. Just enough to make one curious.",
		},

		// The same unidentified voice again.
		"call.again": {
			"There it is again. {sound}.",
			"{sound} once more. Persistent, I'll give it that.",
			"The stranger again, {where}. One of these days we'll be properly introduced.",
			"Our mystery singer, {dist}. Still not giving anything away.",
			"Again, {dir}. The same voice, I'm almost sure of it.",
			"There's that voice again, {elev}.",
			"That voice again. I'm beginning to feel it's teasing us.",
			"Ah, our unnamed friend is still about.",
			"Is it any closer, do you think? That voice again.",
			"Still singing, our stranger. And still entirely anonymous.",
		},

		// Loud and close.
		"call.close": {
			"Close, that. Very close. {sound}.",
			"Goodness, that was near. Stay still a moment.",
			"That was practically at my elbow. Don't move.",
			"Loud and close. Whoever it is, it can't be far.",
		},

		// Faint, at the edge of hearing.
		"call.faint": {
			"Faint, very faint. {sound}. Or was I imagining it?",
			"Just at the edge of hearing, {dir}. Something new, I think.",
			"Barely there. A thin thread of sound, and then nothing.",
		},

		// Natural Instinct flagged something out of the ordinary. Never says "rare".
		"call.unusual": {
			"Now that's odd. {sound}, and something about it isn't what I'd expect here.",
			"Hm. That voice doesn't belong to this place. Or at least, not usually.",
			"Something unusual about that call. I can't say what, exactly. Worth a look, I think.",
			"Wait. That one gave me a little shiver. Not the usual sort of voice, {where}.",
			"Interesting. Not a voice that fits these surroundings at all.",
			"Curious. I have a feeling that voice is a little out of place.",
		},

		// A species the player has identified and recognises by ear.
		"call.known": {
			"The {name} again. I'd know that voice anywhere now.",
			"Ah, the {name}. Still at it.",
			"There's the {name}, singing away. Some voices never get old.",
		},

		// Focus listening begun. These work as reflections even if said a moment later.
		"focus": {
			"Stop, and the whole place fills up with voices.",
			"Stillness, and then the layers. Wind, leaves, water, and somewhere underneath, the birds.",
			"The trick is not to listen for anything in particular. Just listen.",
			"Everything worth hearing is a little quieter than one expects.",
			"There's always more out there than one first hears.",
			"Ears first, eyes later. That's the proper order of things.",
			"Let the near sounds fall away, and the far ones come forward.",
			"Every one of those voices is somebody going about their day.",
			"Listening properly is harder than it sounds. And far more rewarding.",
		},
	})
}
