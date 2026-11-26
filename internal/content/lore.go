package content

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// Lore categories (proto.LoreDef.Category).
const (
	LoreEcology    = "ecology"
	LoreHistory    = "history"
	LoreFieldcraft = "fieldcraft"
	LoreSpecies    = "species"
)

// loreUnlocks maps an in-game trigger to the Natural History entries it unlocks.
//
//	page_<n>              a Forgotten Field Journal page is picked up
//	relic_<n>             a relic is picked up
//	identify:<species id> the species is identified for the first time
//	forage:<plant id>     the plant is picked for the first time (the session also
//	                      teaches the recipes of RecipesLearnedBy("plant:<id>"))
//	cache                 the "modest find" of a cache (see ModestFind)
//
// Quest rewards name their entries directly in proto.Reward.Lore.
var loreUnlocks = map[string][]string{
	"page_0": {"keepers_logbooks"},
	"page_1": {"quiet_water"},
	"page_2": {"rising_air"},
	"page_3": {"the_trappers"},
	"page_4": {"night_in_the_pines", "keepers_stew"},
	"page_5": {"canopy_singers"},
	"page_6": {"listening_houses"},
	"page_7": {"the_white_country"},

	"relic_0": {"ring_marks"},
	"relic_1": {"whistles_and_pipes"},
	"relic_2": {"lamp_and_glass"},
	"relic_3": {"pressed_plants"},
	"relic_4": {"survey_pins"},
	"relic_5": {"carved_decoy"},

	"forage:bramble":     {"pick_with_care"},
	"forage:dog_rose":    {"fair_share"},
	"forage:elder":       {"elder_year"},
	"forage:chanterelle": {"mushroom_rule"},
	"forage:penny_bun":   {"mushroom_rule"},
	"forage:nettle":      {"nettle_nursery"},
	"forage:samphire":    {"salt_marsh_greens"},

	"identify:eurasian_wren":     {"small_and_loud"},
	"identify:golden_oriole":     {"flute_in_the_crown"},
	"identify:eurasian_bittern":  {"the_boom"},
	"identify:snowy_owl":         {"owl_by_day"},
	"identify:atlantic_puffin":   {"puffin_winters"},
	"identify:hawfinch":          {"cherry_stones"},
	"identify:common_kingfisher": {"kingfisher_blue"},
}

// cacheLore are the entries a cache's modest find may contain.
var cacheLore = []string{"station_logbooks", "trappers_marks", "oilskin_notes"}

// LoreFor returns the lore entry ids a trigger unlocks (see loreUnlocks): "page_3",
// "relic_0", "identify:golden_oriole". Unknown triggers unlock nothing.
func LoreFor(trigger string) []string { return append([]string(nil), loreUnlocks[trigger]...) }

// Lore returns every Natural History entry (spec §14.1 "history"), in the order the
// journal should list them within a category.
func Lore() []proto.LoreDef {
	e := func(id, cat, title, text string) proto.LoreDef {
		return proto.LoreDef{ID: id, Title: title, Category: cat, Text: text}
	}
	return []proto.LoreDef{
		// --- fieldcraft
		e("listen_first", LoreFieldcraft, "Listen First",
			"Most birds are heard long before they are seen, and many are never seen at all. Experienced watchers spend the first minutes in any new place standing still and listening, building a picture of who is around before they ever raise their glasses. The ears find the bird; the eyes only confirm it."),
		e("sit_and_wait", LoreFieldcraft, "Sit and Wait",
			"A bird that has seen you move will watch you for a long time. A bird that has watched you sit still for ten minutes begins to forget you are there. Settling beside a perch, a feeding place or water is the most productive thing a watcher can do. Birds come to the patient."),
		e("birding_by_ear", LoreFieldcraft, "Birding by Ear",
			"Every voice has a pitch, a pattern and a place. Some birds repeat each phrase, some run on without pause, and some do not sing at all but drum. Ask three questions of any unknown sound: how high is it, how is it arranged, and from what sort of cover does it come. Those three answers rule out most of a wood."),
		e("off_the_path", LoreFieldcraft, "Off the Path",
			"Most paths follow what suits people: dry ground, a short route, a view. Birds follow food, cover and water. The richest places are often where the path is not. Leave the track, note where you left it, and let the way back never be a worry."),
		e("golden_light", LoreFieldcraft, "The Golden Hour",
			"Soon after dawn and before dusk the sun sits low and warm, and the shadows that flatten a bird at midday turn into shape and colour. Photographers call it the golden hour. Birds are more active in it too, so the light and the subject arrive together."),
		e("reading_a_feather", LoreFieldcraft, "Reading a Feather",
			"A flight feather's length and shape say how big its owner was and how it flew; a short soft covert says less. Moulted feathers are natural, and where they lie is a clue to where the bird spends its time: under a roost, at the edge of cover, beside water."),
		e("reading_behaviour", LoreFieldcraft, "Reading Behaviour",
			"Behaviour is evidence. A bird that bobs on a stream stone is not the same as one that creeps up a trunk. Watch what it eats, how it moves between perches, whether it hops or walks, how it holds its tail and what alarms it. Often the behaviour narrows the species faster than the colour does."),
		e("night_in_the_pines", LoreFieldcraft, "A Night in the Pines",
			"Owls are met at night, and mostly by ear. A territorial call is often answered by a neighbour, so wait for the reply. Dense conifers hold sound, and owls like the cover, so a quiet camp among pines is a good place to listen."),
		e("oilskin_notes", LoreFieldcraft, "Notes That Keep",
			"The best field notes are written on the spot, in pencil, in a book that will survive rain. Wrapped in oilskin, a notebook can outlast the person who wrote it. Date every entry, and note the weather."),

		// --- ecology
		e("lost_on_the_wind", LoreEcology, "Lost on the Wind",
			"Vagrants are birds found far outside their range, usually young, usually blown off course by storms or following a faulty internal compass. Autumn brings the most, as juveniles make their first migrations. They tend to turn up in places that look right but are not."),
		e("dawn_chorus", LoreEcology, "The Dawn Chorus",
			"Birds sing most intensely in the hour around sunrise. The air is cool and still and carries sound well, it is too dark to forage efficiently, and males advertise their territories before the day's business begins. Species with larger eyes tend to start first, so the chorus builds in a rough order."),
		e("what_the_wagtail_knows", LoreEcology, "What the Wagtail Knows",
			"Birds that feed along fast, clean streams, such as the grey wagtail, depend on insects that only live in unpolluted water. When they vanish from a stream, something upstream has usually changed. That is why rangers watch them."),
		e("the_reedbed", LoreEcology, "The Reedbed",
			"A reedbed looks like a wall and behaves like a city. Warblers weave nests between the stems, rails and moorhens thread the bases, and bitterns stand motionless among them. Nearly everything inside is heard and not seen, which makes the marsh a place for ears."),
		e("autumn_passage", LoreEcology, "Autumn Passage",
			"In autumn many birds leave their breeding grounds and move through woods in loose flocks, feeding on berries and seeds before travelling on. Thrushes, finches and buntings sweep from thicket to thicket. The same wood can be empty on Tuesday and full on Wednesday."),
		e("above_the_trees", LoreEcology, "Above the Trees",
			"Above the treeline the shelter disappears. Birds nest in rock crevices and hide in the lee of boulders. Wind carries sound away, and thermals lift the big birds, so the highlands reward those who watch the sky."),
		e("the_tideline", LoreEcology, "The Tideline",
			"A beach is a line of leftovers. The sea leaves food at the tide's edge twice a day, and waders and gulls follow it. Cliff ledges hold the nesting seabirds, and after a storm tired travellers sometimes come ashore along the strand."),
		e("surviving_the_cold", LoreEcology, "Surviving the Cold",
			"Winter birds keep warm by eating enough and by fluffing their feathers to trap air. Some grow feathered feet and turn white; others leave. In deep winter a bird that sits very still is saving energy, which is why snow birds so often seem to wait for you."),
		e("quiet_water", LoreEcology, "Quiet Water",
			"Small ponds are scarce and heavily used for drinking, bathing and hunting insects. A hidden pond ringed with reeds gives shelter to birds that need cover and water together, and the birds usually find it before the people do."),
		e("rising_air", LoreEcology, "Rising Air",
			"On sunny mornings the ground warms and air rises in columns called thermals. Large soaring birds use them to climb without flapping. A high rock with a long view is where you see them circle."),
		e("canopy_singers", LoreEcology, "Singers in the Crown",
			"Many of the brightest woodland birds live in the highest leaves, where the sun is. Foliage hides them even when they are loud. Stand well back from a tree and look into the crown, rather than up at it, and you get gaps to watch."),
		e("the_white_country", LoreEcology, "The White Country",
			"The high northern plateau is the last place that stays white. What lives there is few and far between, and some of it comes only in the depth of winter, following food. White birds on white ground are found by their shadows."),

		// --- history
		e("fire_watch", LoreHistory, "The Fire Watch",
			"Fire-watch towers stood on rises where one keeper could see all of a forest. The keepers lived alone for months and many kept notebooks to pass the time; some of those, of weather and birds, are the only records of the places they watched."),
		e("unfinished_survey", LoreHistory, "An Unfinished Survey",
			"A long record is worth more than the sum of its pages. A keeper's list of what sang from which tree on which date, kept for thirty years, shows how a valley changes in a way no single survey can. That is why old notebooks are looked after."),
		e("keepers_logbooks", LoreHistory, "A Keeper's Logbook",
			"A fire-watch keeper's logbook was an official document: weather at the hour, visibility, smoke. Many keepers also noted birds in the margin. The margin is where we find them now."),
		e("the_trappers", LoreHistory, "The Trappers",
			"Before the valley was protected, trappers and woodcutters kept cabins deep in the forest. They knew the birds because they lived on the same ground. What they left behind says a good deal about how the wood used to be."),
		e("listening_houses", LoreHistory, "Listening Houses",
			"In wetlands, observers once built small raised stations at the edge of the reeds, because a place visited at the right hour can hear the whole marsh. Most were abandoned long ago, but the ones that remain stand where listening is best."),
		e("station_logbooks", LoreHistory, "Station Logbooks",
			"Abandoned stations often keep a logbook of the last season's weather and visitors. The pages are brittle, but the handwriting is steady, and every one ends with the date and a promise to come back."),
		e("trappers_marks", LoreHistory, "Trappers' Marks",
			"Trappers cut small marks into trunks and posts to find their way between camps. Look for a notch at eye height, repeated at intervals: it usually leads somewhere worth finding."),
		e("ring_marks", LoreHistory, "Ring Marks",
			"Ringing fits each bird with a small numbered band. When a ringed bird is found again we learn where it has been, and a single band on a stranger's leg can map a continent."),
		e("whistles_and_pipes", LoreHistory, "Whistles and Pipes",
			"Bird-call whistles have been made for centuries, first to lure birds in for hunting and later for watching. A bird called in is a bird interrupted, and modern watchers leave them alone."),
		e("lamp_and_glass", LoreHistory, "Lamp and Glass",
			"Before electricity, towers and stations used storm lamps with glass chimneys. A smoke-blackened lens in a ruin usually tells you where the keeper sat."),
		e("pressed_plants", LoreHistory, "Pressed Between Pages",
			"Naturalists once pressed plants and feathers between sheets of paper to keep a record of what grew and flew where they walked. A pressed sheet can last a century."),
		e("survey_pins", LoreHistory, "Survey Pins",
			"Surveyors drove brass pins into the ground to mark where a line began. Naturalists borrowed the habit, to return to the same count point year after year."),
		e("carved_decoy", LoreHistory, "A Carved Decoy",
			"A decoy is a carved bird set where a real one might land. Whoever carved this one knew the bird's shape by heart."),
		e("keepers_stew", LoreHistory, "The Keeper's Stew",
			"The keepers who lived out in the wood ate what it gave them, and the margins of their logbooks are full of it: a penny bun and a handful of chestnuts, thyme from the bank, and oats for body, all in one pot over a low fire. Nobody ever wrote down an amount. Start with less than you think, and taste."),

		// --- the wild larder
		e("pick_with_care", LoreFieldcraft, "Pick With Care",
			"The first rule of foraging is certainty: pick nothing you cannot identify beyond doubt, and when a plant has a poisonous lookalike, check every feature the book gives, not just the one you hope for. The second rule is moderation: take a little from many plants rather than a lot from one, leave the best for seed, and never pick a plant to its last leaf. A forager is a visitor with a basket."),
		e("fair_share", LoreEcology, "A Fair Share",
			"Hedgerow berries are not decoration. A bramble, a dog rose or an elder in fruit is a larder for thrushes, blackbirds, waxwings and the winter visitors that arrive hungry. Take what you need for one meal, leave at least two berries out of three, and never strip a bush bare; a bush stripped in October means hungry birds in January."),
		e("elder_year", LoreSpecies, "The Elder's Year",
			"Elder flowers in late spring, in flat heads that smell of muscat and hay, and fruits in early autumn in heavy purple-black bunches that birds strip within a fortnight. People have made cordial from the flowers and syrup from the berries for as long as there have been kitchens, but the berries are for cooking only: raw they are mildly poisonous, and so are the leaves, bark and stalks."),
		e("mushroom_rule", LoreFieldcraft, "Mushrooms: Be Certain",
			"Many of the best-loved wild mushrooms have a poisonous double, and the difference is often a single small feature: ridges where there should be gills, a pink pore where there should be white, a ring on the stem. Experienced foragers learn a few species well, check each one against several features, and take nothing with them they are not sure of. The mushroom you walk past does no harm. The one you are wrong about might."),
		e("nettle_nursery", LoreEcology, "Nettles and Butterflies",
			"Stinging nettles are not just a weed. Small tortoiseshell, peacock, red admiral and comma butterflies all lay their eggs on nettle leaves and their caterpillars eat nothing else. Take the top few leaves from a young plant in spring, wear a glove, and leave the older patches alone in summer, when the caterpillars are feeding."),
		e("salt_marsh_greens", LoreEcology, "Where the Land Meets the Salt",
			"A salt marsh floods twice a day, and the plants that live there can drink seawater. Samphire stores the salt in its fat, jointed stems, which is why it tastes of the sea. The marsh is also a nursery for fish and a feeding ground for waders; walk on the firm creek edges, take samphire by cutting the tips, and the plants regrow within weeks."),

		// --- species
		e("why_woodpeckers_drum", LoreSpecies, "Why Woodpeckers Drum",
			"Woodpeckers drum on resonant dead wood, not to feed but to announce a territory, the way other birds sing. The roll is faster than the eye can follow, and a bird will choose the branch or post that gives the loudest sound. Look for the dead limb."),
		e("small_and_loud", LoreSpecies, "Small and Loud",
			"The Eurasian Wren is among the smallest birds in the wood and one of the loudest. Its song is delivered with astonishing force from a bird of about ten grams that keeps its tail cocked and creeps through low cover like a mouse."),
		e("flute_in_the_crown", LoreSpecies, "The Flute in the Crown",
			"The Golden Oriole is one of the most strikingly coloured birds of the woods and one of the hardest to see. It hides in the canopy of tall broadleaved trees and gives itself away by a liquid, fluting whistle. Most people hear one many times before they see one."),
		e("the_boom", LoreSpecies, "The Boom",
			"The Eurasian Bittern's deep, far-carrying boom can cross a whole reedbed on a still evening. The bird is a heron that stands rigid among the stems with its bill pointed at the sky, and it is far more often heard than seen."),
		e("owl_by_day", LoreSpecies, "Owl by Day",
			"Unlike most owls, the Snowy Owl hunts in daylight, which suits the endless days of its Arctic summer. In deep winter it may wander onto open ground far to the south, where on a snowfield it can be very hard to see."),
		e("puffin_winters", LoreSpecies, "Where Puffins Winter",
			"Puffins spend most of the year far out on the open ocean and come ashore only to breed. The colourful bill is a breeding ornament; outside the season they shed its brightest parts."),
		e("cherry_stones", LoreSpecies, "Cherry Stones",
			"The Hawfinch has a bill powerful enough to crack a cherry stone, which almost nothing else can open. It is shy, keeps to the treetops, and is more often heard, with a sharp \"tick\", than seen."),
		e("kingfisher_blue", LoreSpecies, "Kingfisher Blue",
			"A kingfisher perches over still or slow water and dives for small fish, then beats its catch on the perch before swallowing. Its blue is structural, not pigment: it comes from the way light scatters in the feather."),
	}
}

// LoreByID returns one Natural History entry.
func LoreByID(id string) (proto.LoreDef, bool) {
	for _, l := range Lore() {
		if l.ID == id {
			return l, true
		}
	}
	return proto.LoreDef{}, false
}
