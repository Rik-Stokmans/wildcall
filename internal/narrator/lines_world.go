package narrator

// Lines about the world and the day: time of day, weather, seasons, stillness, quiet
// walks, the cabin, milestones and unprompted musings.
func init() {
	register(map[string][]string{
		"time.dawn": {
			"Dawn. Listen to them all. Every bird for miles trying to be heard at once.",
			"First light. The dawn chorus, and the best seat in the house.",
			"The sun's coming up, and so is the volume.",
			"Dawn. If one ever needed a reason to get up early, this is it.",
			"Morning comes, and the whole land clears its throat.",
		},
		"time.morning": {
			"Morning. Breakfast time, for everyone with feathers.",
			"A fine morning. Everyone's busy feeding now.",
		},
		"time.midday": {
			"Midday. Things go a little quiet. Even birds take a long lunch.",
			"The middle of the day. Everybody's resting in the shade, very sensibly.",
		},
		"time.afternoon": {
			"Afternoon. Things are stirring again.",
			"The afternoon. The light softens, and everyone gets moving.",
		},
		"time.dusk": {
			"Evening. The light goes gold, and the voices come back.",
			"Dusk. A last song or two before bed.",
			"The day's winding down. Listen, everyone's saying goodnight.",
			"Evening light. My favourite hour, I think.",
			"The shadows are lengthening. Some creatures are only just waking up.",
		},
		"time.night": {
			"Night. A different world entirely, with different voices.",
			"Dark now. Ears matter more than eyes from here on.",
			"Nightfall. The day shift goes to bed, and the night shift wakes.",
			"The stars are out. Listen. The night has its own residents.",
			"It's dark. Anything singing now is worth paying attention to.",
		},

		"weather.rain": {
			"Rain. Most birds will sit it out quietly, and very sensibly.",
			"Here comes the rain. Everything goes hushed and dripping.",
			"Rain on the leaves. A lovely sound, though it hides a good deal.",
			"Rain. Hard to hear anything over it. The birds feel the same.",
		},
		"weather.clear": {
			"The rain's easing. Listen, everything starts up again.",
			"That's the rain passing. The birds will be out in a moment, shaking themselves off.",
			"Rain's stopped. The world smells wonderful.",
			"After rain, everything's busy. The worms come up, and so do the birds.",
		},
		"weather.wind": {
			"The wind's getting up. Harder to hear, harder to see. Everything sways.",
			"Windy. Small birds keep low and out of it.",
			"A strong breeze. The trees are louder than the birds now.",
		},
		"weather.mist": {
			"Mist. The world shrinks to a few yards, and every sound seems closer.",
			"Mist rolling in. Soft, grey and very still.",
			"In mist like this, one listens rather more than one looks.",
		},
		"weather.sun": {
			"Sunshine. Everything brightens, including the mood.",
			"The clouds are breaking. Lovely.",
		},

		"season.spring": {
			"Spring. Everything singing, everything building, everything in a hurry.",
			"Spring has arrived. The travellers are coming home.",
			"Spring. The busiest season for anyone with a nest to build.",
		},
		"season.summer": {
			"Summer. Long days, full hedges and young birds everywhere.",
			"High summer. The songs fade a little, and the hard work of parenting begins.",
			"Summer now. The light seems to last forever.",
		},
		"season.autumn": {
			"Autumn. Some birds are leaving, others arriving. The great shuffle.",
			"The leaves are turning. Autumn, and the travellers pass through.",
			"Autumn. Berries, travellers, and the occasional surprise.",
		},
		"season.winter": {
			"Winter. Fewer voices, but every one of them counts.",
			"Winter's here. A hard season for small birds. Every berry matters.",
			"Winter. Sharp air, bare branches, and birds rather easier to see.",
		},

		"stillness": {
			"Sit still long enough and the world forgets you're there.",
			"Patience. The place is quietly getting used to us.",
			"Nothing happening. Which, out here, is rarely true.",
			"This is the part people skip. It's the best part.",
			"Just waiting. One learns a great deal about a place by waiting in it.",
			"Still. The birds are deciding whether we're a threat or a tree.",
			"Quiet. Lovely, isn't it? Let it settle.",
			"Waiting is most of the job. The rest is luck, and paying attention.",
		},
		"walking": {
			"Quiet out here. Perhaps we're making too much noise.",
			"A long walk, and not much stirring. Perhaps it's the hour.",
			"Sometimes the land is simply quiet. That's allowed.",
			"Not much about. Stopping for a while might change that.",
			"One sees more by walking less. Or so I'm always telling myself.",
			"Footsteps, and not much else. The birds are hearing us before we hear them.",
			"Rather a quiet stretch. Every place has its lulls.",
		},

		"cabin": {
			"Home. Kettle on, notes out.",
			"Back at the cabin. Time to make sense of the day.",
			"Ah, the cabin. Somewhere warm to sort through everything we've seen.",
			"Home again. The best part of any expedition is the coming back.",
			"The cabin. Boots off, I think.",
			"Back. There's always more to write up than one expects.",
		},
		"rest": {
			"A good rest. The world has carried on without us, as it should.",
			"Rested. Let's see who's about now.",
			"That's better. Everything outside has moved on a little.",
			"Refreshed. The light's changed, and so have the voices.",
			"A pause, and the day has turned over. Shall we see what's different?",
		},

		"welcome": {
			"Well, here we are. A cabin, a pair of binoculars, and the whole wild world. Let's listen first.",
			"Out we go. I have no idea what we'll find, which is the very best way to begin.",
			"Fresh air, and somewhere out there, a voice we've never heard. Shall we go and find it?",
			"A new beginning. Everything out there is a stranger, for now.",
			"Listen to that. The woods are full of voices, and we don't know a single one of them yet.",
			"Every naturalist starts exactly here. Curious, and not quite sure what anything is.",
		},
		"resume": {
			"Back again. I wonder what's changed while we were away.",
			"Ah, the outdoors. Exactly where we left it, more or less.",
			"Here we are again. Let's see who's about.",
			"Welcome back. The birds didn't wait for us, of course.",
		},
		"rank": {
			"A proper naturalist now. Or rather more of one than yesterday.",
			"{title}. They'll be asking you for advice soon.",
			"Well, well. {title}. It suits you.",
			"Look how far we've come. The world sounds rather different to us now.",
			"Recognition, at last. Not that the birds will care in the slightest.",
			"{title}. Earned, every bit of it, with patience and wet feet.",
		},

		// Unprompted musings.
		"idle.any": {
			"The thing about wild places is that they're always watching you back.",
			"Every one of these trees is somebody's home.",
			"One could spend a lifetime in a single valley and never know it completely.",
			"I do love the sound of nothing much happening.",
			"It's the small things, out here. The very small things.",
			"Somewhere nearby, something is watching us and wondering what on earth we're doing.",
			"The best naturalists I've known were simply very good at standing still.",
			"There's no such thing as an empty landscape. Just one you haven't listened to yet.",
			"Curiosity, mostly. That's all one really needs out here. And dry socks.",
			"Each voice out here belongs to somebody with a whole life to get on with.",
			"I wonder what we'll find today. That's the lovely thing. One never knows.",
			"Look at the light through those leaves. Nobody paints like that.",
		},
		"idle.greenhollow": {
			"Greenhollow always sounds busy, even when nothing seems to be happening.",
			"An old oak supports more life than almost anything else in a wood. A little city, every one.",
			"Moss on the trunks, ferns in the hollows. A wood that's been left to itself.",
			"Listen to the canopy. There's an entire world up there we rarely see.",
		},
		"idle.murmur_marsh": {
			"The reeds whisper all day long. It's how the marsh got its name, I imagine.",
			"Marshes are wonderful places to hide, if you're a bird. Maddening, if you're us.",
			"Everything here smells of water and mud and growing things.",
			"The marsh is never still. Something's always moving in the reeds.",
		},
		"idle.windpeak": {
			"Up here, the wind does most of the talking.",
			"Every bird up here has to be tough. There's no shelter to speak of.",
			"Look up. In the highlands, the sky is where things happen.",
			"Rock and heather and enormous sky. Small wonder the voices up here sound so lonely.",
		},
		"idle.whispering_coast": {
			"The sea never stops. It's rather comforting, once you're used to it.",
			"Cliffs, spray and wheeling shapes. The coast is all drama.",
			"Everything here lives by the tides. Even the birds keep a timetable.",
			"Salt on the air. I could stand here all day.",
		},
		"idle.amberwood": {
			"Amberwood. Every leaf seems to be falling in slow motion.",
			"All this colour. It feels as if the wood is glowing from the inside.",
			"There's a hush to an autumn wood. Everything getting ready.",
			"Crunch, crunch. Rather hard to be stealthy in Amberwood.",
		},
		"idle.frostveil": {
			"The cold makes everything sound sharper. Even one's thoughts.",
			"Out here, every living thing is making a very careful calculation about warmth.",
			"Snow keeps a record of everything. Every footprint, every landing.",
			"So quiet. The snow swallows sound like a blanket.",
		},
		"idle.phase.dawn": {
			"Dawn is when the land is loudest. Every bird announcing it survived the night.",
			"Early light, cold air, and a hundred voices. Worth every yawn.",
		},
		"idle.phase.morning": {
			"Mornings are for feeding. Everybody's hungry after a long night.",
			"A good morning for it. Busy, bright, and full of movement.",
		},
		"idle.phase.midday": {
			"The midday lull. Even the birds know when to take a break.",
			"Quiet at this hour. A good time for thinking.",
		},
		"idle.phase.afternoon": {
			"The afternoon's warming up. Things are on the move again.",
			"Long afternoon shadows. A good time to sit by water and wait.",
		},
		"idle.phase.evening": {
			"Evening. Everything is heading home. Us included, eventually.",
			"The evening light makes everything look like a painting.",
		},
		"idle.phase.night": {
			"At night, the land belongs to the listeners.",
			"Darkness changes everything. Ears first, now.",
			"The night is full of voices. One just has to be still enough to catch them.",
		},
		"idle.weather.rain": {
			"There's something rather lovely about the world in the rain.",
			"Rain drips from every leaf. Small birds keep their heads down.",
		},
		"idle.weather.wind": {
			"In wind like this, small birds tuck themselves away. Very sensible.",
			"The trees are creaking. The whole place is talking.",
		},
		"idle.weather.cloudy": {
			"Grey skies. Soft light, though. Good for seeing colours, oddly.",
			"Overcast. A gentle sort of day.",
		},
		"idle.weather.sunny": {
			"Sunshine, and everything warm. Insects up, birds up.",
			"A beautiful day for it. Not that birds keep track of beautiful days.",
		},
		"idle.season.spring": {
			"Spring is a frantic time. So much to sing about, so much to build.",
			"Everyone's arriving in spring. One must listen very carefully for the newcomers.",
		},
		"idle.season.summer": {
			"Summer's full of young birds, clumsy and loud and endlessly hungry.",
			"In summer the leaves hide everything. Ears are worth more than eyes.",
		},
		"idle.season.autumn": {
			"Autumn is the season of comings and goings. Keep an ear out for travellers.",
			"The berries are ripening. A feast for anyone passing through.",
		},
		"idle.season.winter": {
			"Winter thins the woods. Fewer leaves, fewer places to hide.",
			"In winter, every bird is thinking about food. Every single minute.",
		},
	})
}
