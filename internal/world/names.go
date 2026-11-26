package world

import (
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// Place names are built from region-flavoured word lists: a first element (often
// an animal, plant or colour) and a second (a landform), either joined into one
// word ("Thornback") or kept as two ("Heron Reach"). The choice is a pure function
// of the seed and the POI id, so a name never changes, and with ~15 x 15 x 2 x
// variants per region repeats are rare and never next to each other in practice.

var nameFirst = [core.RegionCount][]string{
	core.RegionGreenhollow:     {"Hazel", "Bramble", "Moss", "Oak", "Fern", "Wren", "Thrush", "Willow", "Badger", "Foxglove", "Bluebell", "Linden", "Hollin", "Ash", "Robin", "Primrose", "Elder"},
	core.RegionMurmurMarsh:     {"Heron", "Reed", "Bittern", "Sedge", "Rush", "Snipe", "Mire", "Teal", "Willow", "Alder", "Greywater", "Otter", "Marsh", "Bog", "Lapwing", "Moorhen"},
	core.RegionWindpeak:        {"Thorn", "Raven", "Grey", "Kestrel", "Scree", "Gale", "Crag", "Ptarmigan", "High", "Eagle", "Flint", "Storm", "Cloud", "Rook", "Iron", "Wind"},
	core.RegionWhisperingCoast: {"Gull", "Tern", "Salt", "Shell", "Puffin", "Kittiwake", "Spray", "Driftwood", "Gannet", "Shingle", "Sandpiper", "Seal", "Wrack", "Cormorant", "Pebble", "Brine"},
	core.RegionAmberwood:       {"Amber", "Russet", "Copper", "Rowan", "Ember", "Hawthorn", "Chestnut", "Bracken", "Tawny", "Maple", "Gold", "Squirrel", "Acorn", "Owl", "Hearth", "Sorrel"},
	core.RegionFrostveil:       {"Frost", "Snow", "Rime", "White", "Hoar", "Ice", "Winter", "Glacier", "Pale", "Silver", "Sleet", "Crystal", "Bunting", "Hare", "Still", "Lumen"},
}

var nameSecond = [core.RegionCount][]string{
	core.RegionGreenhollow:     {"hollow", "dell", "glade", "copse", "brook", "rise", "bank", "combe", "wood", "lea", "knoll", "shaw", "dingle", "spinney"},
	core.RegionMurmurMarsh:     {"reach", "fen", "mere", "carr", "water", "flats", "pool", "sedge", "levels", "wash", "ings", "mire", "dyke", "holm"},
	core.RegionWindpeak:        {"back", "crag", "fell", "pike", "scar", "edge", "ridge", "tor", "nab", "knott", "gill", "rigg", "howe", "cairn"},
	core.RegionWhisperingCoast: {"head", "cove", "point", "strand", "haven", "ness", "bay", "skerry", "sands", "cliff", "wick", "shore", "stack"},
	core.RegionAmberwood:       {"wood", "holt", "glen", "hurst", "dene", "field", "brake", "hanger", "ridge", "dale", "grove", "fold", "wold", "copse"},
	core.RegionFrostveil:       {"veil", "fell", "moor", "tarn", "drift", "hollow", "shelf", "reach", "steps", "field", "pass", "mere", "plateau", "fold"},
}

var kindWords = map[string][]string{
	"watchtower":        {"Tower", "Watchtower", "Watch", "Lookout Tower"},
	"hide":              {"Hide", "Blind", "Hide"},
	"camp":              {"Camp", "Bivouac", "Camp"},
	"hidden_cabin":      {"Hut", "Cabin", "Shack", "Bothy"},
	"abandoned_station": {"Station", "Outpost", "Field Station", "Post"},
	"viewpoint":         {"Point", "Overlook", "View", "Lookout"},
	"pond":              {"Pool", "Pond", "Mere", "Tarn"},
	"ranger_station":    {"Ranger Post", "Ranger Station", "Waystation"},
}

var landmarkWords = map[string][]string{
	"giant_tree":      {"Elder Oak", "Great Tree", "Old Giant", "Grandfather Tree"},
	"standing_stones": {"Stones", "Standing Stones", "Stone Ring", "Henge"},
	"waterfall_rocks": {"Falls", "Force", "Spout", "Cascade"},
	"sea_arch":        {"Arch", "Sea Arch", "Needle Arch"},
	"lighthouse":      {"Light", "Lighthouse"},
	"boardwalk":       {"Boardwalk", "Duckboards", "Causeway"},
	"cairn":           {"Cairn", "Waymark", "Stoneman"},
	"frozen_falls":    {"Frozen Falls", "Ice Curtain", "Still Falls"},
}

// placeName returns a region-flavoured place name ("Heron Reach", "Thornback").
func placeName(seed int64, id string, region core.RegionID) string {
	if region >= core.RegionCount {
		region = core.RegionWhisperingCoast
	}
	r := noise.NewRNG(noise.HashString(uint64(seed), id))
	firsts, seconds := nameFirst[region], nameSecond[region]
	a := firsts[r.Intn(len(firsts))]
	bi := r.Intn(len(seconds))
	b := seconds[bi]
	if strings.HasSuffix(strings.ToLower(a), b) { // "Oak" + "oak": take the next landform
		b = seconds[(bi+1)%len(seconds)]
	}
	// Short pairs read well as one word ("Thornback", "Ravencrag"); longer ones
	// stay two ("Sandpiper Strand").
	if len(a) <= 6 && len(a)+len(b) <= 10 && r.Chance(0.6) {
		return a + b
	}
	return a + " " + strings.ToUpper(b[:1]) + b[1:]
}

// poiName names a generated POI from its kind, region and (for landmarks) subtype.
func poiName(seed int64, id, kind, landmark string, region core.RegionID) string {
	r := noise.NewRNG(noise.HashString(uint64(seed)^0x5eed, id))
	switch kind {
	case "feather":
		return pick(&r, "Loose Feather", "Fallen Feather", "Moulted Feather")
	case "page":
		return pick(&r, "Torn Journal Page", "Weathered Page", "Loose Journal Page")
	case "relic":
		return pick(&r, "Curious Relic", "Old Keepsake", "Weathered Relic")
	case "cache":
		return pick(&r, "Forgotten Cache", "Weathered Satchel", "Oilcloth Bundle", "Tin Box", "Canvas Kitbag")
	case "landmark":
		if landmark == "lighthouse" {
			return placeName(seed, id, region) + " " + pick(&r, landmarkWords[landmark]...)
		}
		if w, ok := landmarkWords[landmark]; ok {
			if landmark == "giant_tree" && r.Chance(0.35) {
				return "The " + pick(&r, "Lonely", "Crooked", "Old", "Hollow", "Twisted") + " " + pick(&r, "Oak", "Beech", "Ash", "Yew")
			}
			return placeName(seed, id, region) + " " + pick(&r, w...)
		}
	}
	base := placeName(seed, id, region)
	if kind == "hidden_cabin" && r.Chance(0.3) {
		return pick(&r, "Hermit's", "Forester's", "Charcoal Burner's", "Woodcutter's") + " " + pick(&r, kindWords[kind]...)
	}
	if kind == "abandoned_station" && r.Chance(0.3) {
		return base + " " + pick(&r, "Weather Station", "Survey Station", "Ringing Station")
	}
	if w, ok := kindWords[kind]; ok {
		return base + " " + pick(&r, w...)
	}
	return base
}

// trailName names a generated trail.
func trailName(seed int64, id string, region core.RegionID, hidden bool) string {
	r := noise.NewRNG(noise.HashString(uint64(seed)^0x7a11, id))
	if hidden {
		return pick(&r, "Faint Path", "Deer Track", "Overgrown Path", "Old Track", "Badger Run")
	}
	return placeName(seed, id, region) + " " + pick(&r, "Path", "Way", "Track", "Trail", "Walk")
}

func pick(r *noise.RNG, opts ...string) string { return opts[r.Intn(len(opts))] }
