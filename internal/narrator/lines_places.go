package narrator

// Lines about places: discovered points of interest and region types.
func init() {
	register(map[string][]string{
		"place.watchtower": {
			"{place}. A tower, and a view. Worth the climb, I'd imagine.",
			"An old watchtower. From up there, the world looks very different.",
			"A watchtower. Somebody once spent a great many hours looking out from that.",
		},
		"place.hide": {
			"{place}. A hide, built for exactly what we're doing.",
			"A hide. Somewhere to sit, be patient and disappear.",
			"A hide. Inside, one becomes invisible, or very nearly.",
		},
		"place.camp": {
			"{place}. Somebody camped here once. A long time ago, by the look of it.",
			"An old camp. Ashes, a few scraps, and a story we'll never quite know.",
			"A campsite. I wonder who sat here, and what they were listening for.",
		},
		"place.hidden_cabin": {
			"A cabin, tucked away where nobody would ever find it. Except us, now.",
			"{place}. Abandoned, and quietly reclaimed by the wood.",
			"Somebody lived out here once. Rather a lonely life, or perhaps a contented one.",
		},
		"place.abandoned_station": {
			"An old research station. Whoever worked here left in rather a hurry.",
			"{place}. Instruments rusting, notes long gone. But the birds are still here.",
			"Abandoned. I wonder what they were studying, out here.",
		},
		"place.viewpoint": {
			"{place}. Oh, now that's a view.",
			"Look at that. The whole country laid out like a map.",
			"A wonderful vantage point. One could sit here all morning.",
		},
		"place.pond": {
			"A hidden pond. These quiet corners are often the busiest, if one waits.",
			"{place}. Still water, ringed with reeds. Rather magical.",
			"A secret little pond. Anything thirsty for a mile around knows about this place.",
		},
		"place.landmark": {
			"{place}. Remarkable, isn't it?",
			"Now that's a landmark. Worth remembering, for finding one's way.",
			"{place}. Some places just feel older than others.",
		},
		"place.ranger_station": {
			"{place}. Signs of people, and a good place to get one's bearings.",
			"A ranger station. Somebody keeps a kindly eye on these parts.",
		},
		"place.research_site": {
			"{place}. A proper field lab. Notes, specimens, and far too much tea, I should think.",
			"A field lab. Somebody here is asking the same questions we are.",
		},
		"place.feather": {
			"A feather. Somebody's been preening nearby.",
			"A single feather, just lying there. Every one tells a small story.",
		},
		"place.page": {
			"A page, torn from someone's notebook. Another naturalist passed this way.",
			"Handwriting. Someone stood here once, doing just what we're doing.",
		},
		"place.relic": {
			"Now what's this? Something old, and left here a long time ago.",
			"An odd little relic. The land keeps its secrets, and occasionally shares one.",
		},
		"place.cache": {
			"Something left behind. Curious.",
			"Tucked away, out of the weather. Somebody meant to come back for this.",
		},
		"place.hidden": {
			"Now this, nobody told us about. A secret, and ours now.",
			"Off the path, and look what we've found.",
			"This is why one wanders off the trail. {place}.",
			"Hidden away. The best places usually are.",
		},
		"place.generic": {
			"{place}. Worth remembering.",
			"{place}. Another little piece of the map filled in.",
			"Somewhere new. {place}.",
			"Well, now. Somewhere we haven't been before.",
		},

		// First entry into a region type.
		"region.greenhollow": {
			"Greenhollow Woods. Oak, birch and birdsong. A gentle place to begin anything.",
			"Back among the broadleaves of Greenhollow. It feels like home, this sort of wood.",
		},
		"region.murmur_marsh": {
			"Murmur Marsh. Reeds as far as the eye can see, and every one of them could be hiding something.",
			"The marsh. Listen to it. It's never truly silent.",
			"Wet feet, I suspect, and wonderful birds. Murmur Marsh.",
		},
		"region.windpeak": {
			"Windpeak. Rock, sky and wind. Up here, every living thing has to be tough.",
			"The highlands. Look up as much as you look around.",
			"Windpeak Highlands. The air is thinner, and the views are quite something.",
		},
		"region.whispering_coast": {
			"The coast. Salt, spray, and an awful lot of shouting from the cliffs.",
			"Whispering Coast. The sea has a voice of its own, so listen past it.",
			"The sea. A whole new cast of characters, I expect.",
		},
		"region.amberwood": {
			"Amberwood. It's always autumn here, in colour if not in fact.",
			"Look at those colours. Amberwood, burning gold and copper.",
			"Amberwood. The leaves crunch underfoot. So much for creeping up on anything.",
		},
		"region.frostveil": {
			"Frostveil. Cold, white and very, very quiet. Anything living here is tough.",
			"Snow. Every sound carries out here, including ours.",
			"Frostveil. Everything still, everything hushed. Wonderful, and a little daunting.",
		},
		"region.locked": {
			"Not this way, not yet. That country will wait for us.",
			"The trail's closed beyond here. Another time, when we're better prepared.",
			"Ah. Not yet, I think. Something to look forward to.",
			"That's for later. There's plenty still to learn this side of the border.",
			"We'll need the proper permit for that. One day.",
		},
	})
}
