package content

// MarginNotes returns Edith Harrow's handwritten margin notes from the Forgotten Field
// Journal, one per catalog species, keyed by species id: where she looked, when, and
// an aside in her own dry field-notebook hand. Birds she never saw herself (outside the
// valley) come from her sister's letters, as in the diary pages.
//
// The map is served in welcome.marginNotes always. The client shows a note only while
// the player owns the forgotten_journal item AND has identified that species, so a note
// may name its own bird and describe it, but it never names another species and never
// gives a place by coordinates: only habitats and the pinned home-valley place names.
func MarginNotes() map[string]string {
	out := make(map[string]string, len(marginNotes))
	for id, n := range marginNotes {
		out[id] = n
	}
	return out
}

var marginNotes = map[string]string{
	// Greenhollow Woods.
	"european_robin":           "Sings all year, even Dec. - the hen too, each on her own patch. Dawn & dusk from the bramble edge by the cabin. Came for the worms the first time I dug the garden. Of course it did.",
	"blue_tit":                 "Woods, top twigs, hanging upside down off the thinnest one going. Mornings busiest. Nested in a hole in the Old Oak one spring - ten eggs, I counted twice. Winters with the mixed bands.",
	"great_tit":                "'Teacher, teacher' - first song of the year, on mild Jan. mornings when nothing else has the nerve. Woods & the pines. Old woodpecker holes in spring. Broad black tie on the cock, thin on the hen.",
	"common_blackbird":         "Dusk: the 'chink-chink' that means the cat is out, or I am. Best song in the valley on a still evening, from a high branch at the wood edge. The hen is brown. Took me a whole summer to believe it.",
	"eurasian_wren":            "Low in every tangle - roots, ivy, the brambles along the old trail past the Woodland Entrance. Song far too loud for the size of it. Cock builds several nests in spring & lets her choose. Sensible.",
	"common_chaffinch":         "Woods, pines & the meadow edge, picking seed off the ground. Song a rattle with a flourish on the end - ours have their own dialect, I swear it. Spring nest done up in lichen, near invisible in a fork.",
	"great_spotted_woodpecker": "Drumming off the dead limbs, spring mornings - a short roll, fading. 'Kick' as it goes over. Jams pine cones into the bark to hammer out the seed. Found its anvil by the tower path: a heap of shredded cones.",
	"eurasian_jay":             "Hear it before you see it - a scream like tearing cloth from the oaks. Oct.: back & forth all day burying acorns. Half the young oaks below the tower are a jay's bad memory.",
	"eurasian_nuthatch":        "The only one that walks DOWN a trunk head first. Loud whistles in the big woods, mornings. Plasters mud round an old woodpecker hole till it fits her exactly. Fussy. I approve.",
	"eurasian_treecreeper":     "A mouse with a curved bill - spirals up a trunk, drops to the foot of the next, starts over. Woods & pines, all day, all year. Song so thin I hear it less each spring. Nests behind loose bark.",
	"tawny_owl":                "After dark from the tall woods: the hen's 'ke-wick', the cock's long hoot. Never both from one bird, whatever the rhyme says. Pellets under the day roost tell you more than the owl will. Leave it be.",
	"common_buzzard":           "Midday, when the air lifts off the meadow - circling & mewing, hardly a wingbeat. Otherwise hunched on a dead tree at the wood edge. After rain it walks the meadow for worms like a big brown hen.",
	"song_thrush":              "Each phrase twice or thrice from a high perch, dawn & dusk. Find the stone it smashes snails on & you have its address - broken shells all round. Eggs sky blue. Nest lined with mud, nothing soft.",
	"goldcrest":                "In the pines, high up, needle by needle - smaller than my thumb & never still. Song so high it is nearly not there. Nest slung under the tip of a branch like a hammock. Must feed all day in winter.",
	"long_tailed_tit":          "Through the scrub & wood edge in a chattering band, a dozen or so, then gone. Tail longer than the rest of it. Spring nest a felted bag of moss & feathers in a bramble. Counted to 1,000 feathers & gave up.",
	"eurasian_blackcap":        "Spring & summer only. Rich fluting song from thick scrub - sounds rarer than it is. Cock's cap black, hen's rust-brown. Nests low in bramble & nettles. Says 'tac' when cross, which is often.",
	"common_chiffchaff":        "First back in spring, singing its own name in the bare wood: chiff chaff chiff chaff. Gone by autumn. Dips its tail as it feeds. Nest a little dome right on the ground in brambles - mind your feet.",
	"grey_wagtail":             "On the stones at Creekside, all year - tail never still, & yellow underneath whatever the name says. Sharp 'tzit' over the noise of the water. Nests in the bank or under a ledge right above the stream.",
	"common_kingfisher":        "Creekside & the quieter pools. A blue spark low over the water & a thin whistle - most days that is all. Sit still near a branch over the water. Burrow in a steep bank. Hard winters take them.",
	"golden_oriole":            "Late spring, first hours after sunrise, the very crown of the tallest oaks. A flute, yellow as a lemon, & still you will not see it. Quiet by July. Nest a hammock slung in a high fork. My best bird.",
	"mallard":                  "Any open water - the creek pools, the hidden pond, the marsh if you go that far. Only the duck quacks; the drake rasps. Spring nest hidden in the reeds, lined with her own down. Ducklings swim day one.",
	"common_moorhen":           "The two small dark birds on the still water: red shield on the bill, white under the tail, nodding as they swim. Dawn & dusk. Nest of dead reeds at the edge. Hides underwater with only its bill out.",
	"grey_heron":               "Stands at Creekside longer than I can - then a stab. Dawn & evening best. Croaks like an old gate when it lifts. Heronries go back centuries; they start nesting in Feb., before the leaves.",

	// Murmur Marsh, from her sister's letters.
	"eurasian_reed_warbler": "Sister, from the marsh: chattering in the reeds all summer, each phrase twice or thrice, steady as a clock. Nest woven round living stems so the eggs ride out the wind. Same reeds every year.",
	"eurasian_bittern":      "Sister heard it from a listening station on stilts: the boom at dusk in spring, like someone blowing across a bottle a mile off. Freezes bill to the sky & becomes a reed. I never heard one. Envy.",
	"western_marsh_harrier": "Sister writes: low & slow over the reedbeds, tilting side to side, all day long. In spring the cock passes food to the hen in mid-air - she rolls over & catches it. Nests on the ground deep in the reeds.",

	// Windpeak Highlands.
	"northern_wheatear": "Sister, from the high country: a white rump flashing off every rock, tail bobbing, spring & summer. Alarm like two pebbles knocked. Nests in a crevice or a gap in a wall. Name means 'white rump', politely.",
	"common_raven":      "Sister's summits: a deep 'cronk' over the crags & a pair tumbling for the fun of it. Nest on a sheltered ledge, built in Feb. with snow still down. Pairs for life. Clever enough to be rude about it.",
	"ring_ouzel":        "A mountain thrush, sister says, dark as soot with a white crescent on the breast. Gullies & crags under heather, spring to autumn. Shy - flies off high & far. Takes the rowan berries before going south.",
	"golden_eagle":      "The cairn country, sister writes, around midday when the air lifts: one great shape, wings in a shallow V, & everything else suddenly elsewhere. Eyrie on a crag ledge, added to every year.",

	// Whispering Coast.
	"herring_gull":           "Sister, from the coast & the marsh edge: laughing all day, she says, & no respect for a picnic. The chick pecks the red spot on the parent's bill to ask for supper. Nests on cliff ledges, rocks & rooftops. Never shy.",
	"eurasian_oystercatcher": "At the tide line, sister says, you hear them first - shrill piping, loudest at dusk. Orange bill, pink legs. Nest a bare scrape in the shingle with bits of shell. Mind your step. They live forty years.",
	"great_cormorant":        "Coast: black, low in the water, then gone under. After, on a rock with its wings hung out to dry like washing. Nests in crowded colonies on the ledges, all whitewashed. Sister calls them the vicars.",
	"atlantic_puffin":        "Sister's favourite. Clifftop turf in spring & summer, burrows everywhere, & a bill full of fish laid crosswise. Winters far out at sea. She says they look worried. They are only busy.",

	// Amberwood.
	"redwing":   "Oct. nights - thin 'tseep' calls from flocks passing over in the dark. Autumn & winter by day in Amberwood, stripping berries: cream eyebrow, red flanks. Not on the wing at all, whatever it is called.",
	"brambling": "Autumn & winter in Amberwood, under the beeches where the mast lies thick, in among the other finches. Orange shoulder, & a white rump when the flock lifts. Wheezy call. Never stays for summer.",
	"hawfinch":  "Amberwood, the highest crowns of the old trees, mornings. An explosive 'tzik' is usually all you get. Bill like a nutcracker - you can hear the stones crack. Sat a whole morning for one look. Worth it.",

	// Frostveil.
	"snow_bunting":   "From sister's last letters, the white north: flocks over the snow like a flurry going the wrong way, trilling as they lift. Nest deep in a boulder crevice out of the wind. Cocks go back first for the best.",
	"rock_ptarmigan": "Sister nearly trod on one. Mottled on the rocks in summer, white in winter, feet feathered like snowshoes - trusts its coat & sits till you are a step away. Dawn & dusk best. Croaks like a rattle.",
	"snowy_owl":      "Only in the depths of winter, in the white north. Sister saw it once, hunting the open snow in daylight from a low rock. Old cocks near pure white, hens barred. I shall not see it. You might.",
}
