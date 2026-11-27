package narrator

import (
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// maxFactWords bounds a spoken species fact. Facts are authored with the species
// data (one sentence each); anything longer is not spoken.
const maxFactWords = 40

// SpeciesFacts returns the species' facts as the narrator speaks them: whitespace
// collapsed, empty, overlong and duplicate facts dropped, in catalog order.
func SpeciesFacts(sp *core.Species) []string {
	if sp == nil {
		return nil
	}
	var out []string
	seen := map[string]bool{}
	for _, f := range sp.Facts {
		t := strings.Join(strings.Fields(f), " ")
		if t == "" || seen[t] || len(strings.Fields(t)) > maxFactWords || strings.ContainsAny(t, "{}") {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}

// plantYields are the ingredients forage plants give (§12): eaten as they are, the
// ones without their own lines get the generic eat.raw lines.
var plantYields = map[string]bool{
	"blackberry": true, "wild_strawberry": true, "bilberry": true, "elderflower": true,
	"elderberry": true, "rosehip": true, "hazelnut": true, "chestnut": true, "nettle": true,
	"wild_garlic": true, "water_mint": true, "chamomile": true, "pine_tips": true,
	"chanterelle": true, "penny_bun": true, "sea_buckthorn": true, "samphire": true,
	"cloudberry": true, "wild_thyme": true,
}

var collectAlias = map[string]string{"journal_page": "page", "old_cache": "cache"}

// planActivity plans the activity mumbles of §13. They share the ordinary pacing
// budget, so they stay occasional: most have a chance below one and a cooldown.
func (n *Narrator) planActivity(ev Event, sl slots) (plan, bool) {
	item := norm(ev.Item)
	r := n.rng.Float64
	switch ev.Kind {
	case Foraged:
		var g [][]string
		if y := norm(ev.Yield); y != "" {
			g = append(g, []string{"forage.yield." + y})
		}
		g = append(g, []string{"forage." + item}, []string{"forage.any"})
		if ev.First {
			return plan{prio: 2, kind: "activity", chance: 1, slots: sl, groups: g,
				topics: []topic{{"k:forage", 30}}}, true
		}
		return plan{prio: 1, kind: "activity", chance: 0.55, slots: sl, groups: g,
			topics: []topic{{"k:forage", 150}, {"forage:" + item, 900}}}, true

	case Cooked:
		g := [][]string{{"cook." + item}, {"cook.any"}}
		if ev.First {
			return plan{prio: 2, kind: "activity", chance: 1, slots: sl, groups: g,
				topics: []topic{{"k:cook", 20}}}, true
		}
		return plan{prio: 1, kind: "activity", chance: 0.7, slots: sl, groups: g,
			topics: []topic{{"k:cook", 60}, {"cook:" + item, 600}}}, true

	case Ate:
		g := [][]string{{"eat." + item}}
		if plantYields[item] {
			g = append(g, []string{"eat.raw"})
		}
		g = append(g, []string{"eat.any"})
		return plan{prio: 1, kind: "activity", chance: 0.6, slots: sl, groups: g,
			topics: []topic{{"k:eat", 120}, {"eat:" + item, 600}}}, true

	case PackFull:
		return plan{prio: 1, kind: "advice", chance: 1, slots: sl,
			groups: [][]string{{"pack.full"}}, topics: []topic{{"k:pack", 300}}}, true

	case Collected:
		if a, ok := collectAlias[item]; ok {
			item = a
		}
		return plan{prio: 2, kind: "activity", chance: 0.8, slots: sl,
			groups: [][]string{{"collect." + item}, {"collect.any"}}, topics: []topic{{"k:collect", 45}}}, true

	case Climbed:
		if item == "" {
			item = "watchtower"
		}
		return plan{prio: 1, kind: "activity", chance: 0.8, slots: sl,
			groups: [][]string{{"climb." + item}, {"climb.any"}}, topics: []topic{{"k:climb", 300}}}, true

	case TutorialBeat:
		switch item {
		case "singer_heard", "singer_raised", "first_stars":
		default:
			return plan{}, false
		}
		return plan{prio: 2, kind: "quest", chance: 1, ttl: 12, slots: sl,
			groups: [][]string{{"tutorial." + item}}, topics: []topic{{"tutorial:" + item, 86400}}}, true

	case Waded:
		return plan{prio: 0, kind: "activity", chance: 0.5, slots: sl,
			groups: [][]string{{"wade"}}, topics: []topic{{"k:wade", 900}}}, true

	case Sheltered:
		return plan{prio: 1, kind: "weather", chance: 0.8, slots: sl,
			groups: [][]string{{"shelter"}}, topics: []topic{{"k:shelter", 900}}}, true

	case SatDown:
		return plan{prio: 0, kind: "activity", chance: 0.5, slots: sl,
			groups: [][]string{{"sit"}}, topics: []topic{{"k:sit", 600}}}, true

	case EmptyView:
		return plan{prio: 0, kind: "activity", chance: 0.35, slots: sl,
			groups: [][]string{{"binoculars.empty"}}, topics: []topic{{"k:empty", 300}}}, true

	case OutOfFilm:
		return plan{prio: 2, kind: "advice", chance: 1, slots: sl,
			groups: [][]string{{"film.out"}}, topics: []topic{{"k:film", 120}}}, true

	case NestFound:
		key := ev.Subject
		if key == "" {
			key = item
		}
		site := []string{"nest." + item}
		var g [][]string
		if ev.Known != nil {
			// Only an identified owner may be named.
			nameSlots(sl, ev.Known)
			if r() < 0.6 {
				g = [][]string{{"nest.known"}, site}
			} else {
				g = [][]string{site, {"nest.known"}}
			}
		} else {
			g = [][]string{site}
		}
		if st := norm(ev.Stage); st != "" && len(bank["nest.stage."+st]) > 0 && r() < 0.35 {
			g = append([][]string{{"nest.stage." + st}}, g...)
		}
		g = append(g, []string{"nest.any"})
		return plan{prio: 2, kind: "discovery", chance: 1, slots: sl, groups: g,
			topics: []topic{{"nest:" + key, 86400}, {"k:nest", 60}}}, true
	}
	return plan{}, false
}
