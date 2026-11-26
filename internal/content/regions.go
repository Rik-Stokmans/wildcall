package content

import (
	"fmt"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// regionExtra is what proto.RegionInfo has no room for: the lines the session needs
// for the Region Discovery screen and for the "trail closed" explanation.
type regionExtra struct {
	hints  []string // exploration opportunities (proto.RegionMsg.Hints)
	closed string   // what turning the player back looks like here
}

var regionExtras = [core.RegionCount]regionExtra{
	core.RegionGreenhollow: {
		hints: []string{
			"Faint paths leave the main trail. Follow one.",
			"The dawn chorus is at its loudest before seven.",
			"Something uses the still water that no trail visits.",
		},
		closed: "The woods are open to everyone.",
	},
	core.RegionMurmurMarsh: {
		hints: []string{
			"Bird hides overlook the larger pools.",
			"Most of what lives in a reedbed is heard, not seen. Come back at dusk.",
			"Old survey stations stand out in the reeds, some of them forgotten.",
		},
		closed: "The ground ahead turns to reed and standing water.",
	},
	core.RegionWindpeak: {
		hints: []string{
			"Towers and cairns mark the high ground. The views are long.",
			"Wind steals sound up here. Find the lee of a crag before you listen.",
			"Watch the sky as much as the rocks.",
		},
		closed: "The path climbs out of the trees towards bare rock.",
	},
	core.RegionWhisperingCoast: {
		hints: []string{
			"Sea cliffs and stacks hold the seabirds. Bring your longest glass.",
			"After a gale, look along the tideline for tired travellers.",
			"Hides and old stations sit above the beaches.",
		},
		closed: "You can smell salt on the wind from here.",
	},
	core.RegionAmberwood: {
		hints: []string{
			"Flocks move through the amber canopy in loose, calling waves.",
			"Ruined cabins hide in the deep wood.",
			"Late light through the leaves makes every photograph better.",
		},
		closed: "The leaves ahead have turned copper and gold.",
	},
	core.RegionFrostveil: {
		hints: []string{
			"White birds on white ground: look for the shape, not the colour.",
			"Abandoned stations are the only shelter on the plateau.",
			"Some visitors only come in the depth of winter.",
		},
		closed: "The air ahead is sharp with cold and the ground is white.",
	},
}

// Regions returns the six region TYPES of the generated world, indexed by
// core.RegionID. Each is gated by naturalist rank (a "ranger permit"); a locked type
// is closed wherever it occurs.
func Regions() []proto.RegionInfo {
	def := func(id core.RegionID, tagline, desc string, rank int, color string, habitats, emphasis []string) proto.RegionInfo {
		return proto.RegionInfo{
			ID: int(id), Key: id.Key(), Name: id.Name(),
			Tagline: tagline, Desc: desc,
			Habitats: habitats, Emphasis: emphasis,
			ReqRank: rank, Color: color,
		}
	}
	return []proto.RegionInfo{
		def(core.RegionGreenhollow,
			"Where every naturalist begins.",
			"A temperate forest of oak, birch and pine, broken by small clearings, fern-filled hollows, streams and meadows. Trails cross it, and a good deal more lies off them. It is gentle country, and it is where you learn to listen.",
			1, "#5f8f58",
			[]string{"Forest canopy", "Shrubs", "Meadow", "Riverbank", "Pond", "Woodland floor"},
			[]string{"Listening", "Spotting movement", "Patience", "Off-trail discovery"}),
		def(core.RegionMurmurMarsh,
			"A country of reeds, water and voices.",
			"Reedbeds, slow channels and shallow pools at the level of the sea. The reeds hide nearly everything that lives in them, so the marsh is learned by ear: grunts, chatters and booms from somewhere just out of sight.",
			2, "#6f9c8f",
			[]string{"Reedbeds", "Waterways", "Ponds", "Wet meadow"},
			[]string{"Audio", "Water movement", "Visibility", "Habitat exploration"}),
		def(core.RegionWindpeak,
			"Thin air, long views, hard ground.",
			"High, open country of rock, scree and wind-bent pines, where trails climb to cairns and old watchtowers. The weather turns quickly, the wind takes the sound away, and the birds that live here are few, wary and worth the climb.",
			3, "#8f8b7e",
			[]string{"Mountain trails", "Rocky slopes", "Scree", "Cliffs", "High pines"},
			[]string{"Navigation", "Weather", "Specialized equipment", "Rare encounters"}),
		def(core.RegionWhisperingCoast,
			"Where the land runs out and the sky fills with wings.",
			"Beaches, dunes, sea cliffs and stacks along the edge of the water. Seabirds nest on the ledges and travellers follow the shore, so most watching here is done at a distance, into the wind, with the best glass you own.",
			3, "#c9b680",
			[]string{"Cliffs", "Beaches", "Dunes", "Coastal trails", "Open sea"},
			[]string{"Long-distance observation", "Coastal wildlife", "Weather", "Migration"}),
		def(core.RegionAmberwood,
			"A forest that is always turning.",
			"Old woodland held in permanent autumn: copper oaks, gold birches, a floor deep in leaves. Flocks pass through on their way elsewhere and stay only as long as the berries last. Come for the light as much as the birds.",
			2, "#c98a4a",
			[]string{"Autumn canopy", "Leaf litter", "Berry thickets", "Woodland glades"},
			[]string{"Seasonal wildlife", "Changing foliage", "Migration", "Environmental atmosphere"}),
		def(core.RegionFrostveil,
			"Silence, snow, and what survives it.",
			"Cold high plateaus of snowfield, frozen lake and snow-laden pine. Very little lives here and all of it is hard to see. What does turn up, in the right season, is found nowhere else.",
			4, "#b7cdd8",
			[]string{"Snowfields", "Frozen lakes", "Snow-laden pines", "Bare ridges"},
			[]string{"Winter wildlife", "Snow", "Difficult conditions", "Rare seasonal discoveries"}),
	}
}

// RegionGate returns the naturalist rank needed to enter a region type (1 = open
// from the start). Unknown regions (open water) are never gated.
func RegionGate(r core.RegionID) int {
	switch r {
	case core.RegionMurmurMarsh, core.RegionAmberwood:
		return 2
	case core.RegionWindpeak, core.RegionWhisperingCoast:
		return 3
	case core.RegionFrostveil:
		return 4
	}
	return 1
}

// UnlockedRegions lists the region ids a naturalist of the given rank may enter,
// in core.RegionID order. The session copies this into Profile.Regions.
func UnlockedRegions(rank int) []int {
	if rank < 1 {
		rank = 1
	}
	var out []int
	for r := core.RegionID(0); r < core.RegionCount; r++ {
		if RegionGate(r) <= rank {
			out = append(out, int(r))
		}
	}
	return out
}

// RegionLockReason is the gentle explanation shown when the player is turned back at
// the edge of a region type they hold no permit for. It returns "" if the region is
// open to that rank.
func RegionLockReason(r core.RegionID, rank int) string {
	need := RegionGate(r)
	if r >= core.RegionCount || need <= rank {
		return ""
	}
	return fmt.Sprintf("%s This is %s, and the rangers keep it closed until you hold the %s permit. June at the Greenhollow Ranger Station signs it once you reach that rank. Nothing is lost by turning back; it will be here.",
		regionExtras[r].closed, r.Name(), RankTitle(need))
}

// RegionHints returns the exploration opportunities shown on the Region Discovery
// screen (proto.RegionMsg.Hints).
func RegionHints(r core.RegionID) []string {
	if r >= core.RegionCount {
		return nil
	}
	return append([]string(nil), regionExtras[r].hints...)
}
