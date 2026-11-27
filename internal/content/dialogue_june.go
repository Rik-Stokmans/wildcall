package content

import (
	"fmt"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// juneSpeaker is the park ranger: practical, spare with words, fond of the land. She
// gives the conservation and exploration quests, explains the ranger permits (the
// rank gates on region types) and tells the player that the land goes on far beyond
// the valley.
func juneSpeaker() *speaker {
	return &speaker{
		id: NPCJune,
		voice: voice{
			offer:    "I could use a hand with something.",
			taken:    "Good. Watch your footing and leave the place as you found it.",
			declined: "Fair enough. Come back when you are ready.",
			report:   "You are back. Let us hear it.",
			thanks:   "Thanks. It makes a difference, even when it does not feel like it.",
			busy:     "Not that one yet.",
			nothing:  "Nothing outstanding. A quiet day is a good day on this job.",
			bye:      "Mind the trail.",
		},
		hub: juneHub,
		topics: []topic{
			{id: "j_permits", title: "Tell me about the ranger permits.", lines: junePermits},
			{id: "j_beyond", title: "What lies beyond the valley?", lines: juneBeyond},
			{id: "j_hidden", title: "Are there places off the trail?", lines: juneHidden},
			{id: "j_care", title: "How should I behave around the birds?", lines: juneCare},
			{id: "j_map", title: "How do I find my way?", lines: juneMap},
			{id: "j_forage", title: "Is it all right to pick plants in the park?", lines: juneForage, follow: offerIfAvailable("a_fair_share", "Is there something I can do about it?")},
		},
		taken: map[string][]string{
			"old_watchtower": {
				"Good. The path grew over long ago. Look for a roofline above the trees, somewhere on a wooded rise away from the main trail. If you find the tower, search it top to bottom. Paper lasts longest out of the rain.",
			},
		},
		done: map[string][]string{
			"old_watchtower": {
				"So she did leave her papers there. Edith Harrow was the last keeper, and I have wondered for years. Take this to Professor Alder at the Creekside lab; he will want to see it. And keep your eyes open. She does not seem to have kept her best places on the trails.",
			},
			"quiet_creek":        {"So the creek is still alive. That is a load off my mind. Thanks for walking it for me."},
			"dawn_count":         {"Six voices at dawn and it all goes into the ledger. Next year someone will compare their count with yours."},
			"reedbed_voices":     {"Good work. Nobody has listened to the marsh properly in years. Murmur Marsh is better for it."},
			"above_the_treeline": {"The high ground, checked and written up. I owe you a hot drink."},
		},
	}
}

func juneHub(c *dctx) []string {
	var l []string
	switch {
	case !c.turnedIn(TutorialQuest):
		l = append(l, "Hello. I am June, I look after Greenhollow. Mara said you were out looking for something. Come and find me when you have time.")
	case c.rank() < 2:
		l = append(l, "Hello again. No permits yet, but the valley is open to everyone.")
	default:
		l = append(l, fmt.Sprintf("Hello again. You hold the %s permit.", RankTitle(c.rank())))
	}
	if next := c.nextPermit(); next != "" {
		l = append(l, next)
	}
	if c.p.Rep[FactionRangers] >= 60 {
		l = append(l, "The other rangers know your name. That is not nothing.")
	}
	return l
}

// nextPermit names what the next rank would open, or "".
func (c *dctx) nextPermit() string {
	r := c.rank()
	if r >= 5 {
		return ""
	}
	var names []string
	for id := core.RegionID(0); id < core.RegionCount; id++ {
		if RegionGate(id) == r+1 {
			names = append(names, id.Name())
		}
	}
	if len(names) == 0 {
		return fmt.Sprintf("The next permit will not open anywhere new. The %s card is for the work itself.", RankTitle(r+1))
	}
	return fmt.Sprintf("When you make %s, I can sign the permit for %s.", RankTitle(r+1), strings.Join(names, " and "))
}

func junePermits(c *dctx) []string {
	l := []string{
		"The wild country outside the valley is closed to anyone who has not shown they can look after it, and the way I check is your naturalist rank. A rank gets you a permit. No permit and the trail turns you back; nothing is lost, and it will still be there.",
	}
	for id := core.RegionID(0); id < core.RegionCount; id++ {
		gate := RegionGate(id)
		if gate <= 1 {
			continue
		}
		state := "needs"
		if c.rank() >= gate {
			state = "you hold"
		}
		l = append(l, fmt.Sprintf("%s: %s the %s permit.", id.Name(), state, RankTitle(gate)))
	}
	l = append(l, "Rank comes from milestones, not just from hours: level, species identified, species documented and your standing with the rest of us. Your journal's rank page lists exactly what is left.")
	return l
}

func juneBeyond(c *dctx) []string {
	l := []string{
		"People think Greenhollow is the world. It is a valley. The land runs on a very long way in every direction, and it changes as it goes: reedbeds where it drops, bare rock where it climbs, cold white country in the high north, and a coast where it finally runs out.",
		"Along the way you will find old towers, hides, camps and abandoned stations, and rangers' signposts at the waypoints. Some are on trails and many are not. I have been walking for years and I have not seen all of it.",
	}
	if c.rank() < 2 {
		l = append(l, "You will need permits to enter most of it. Make Observer first. After that, come and see me.")
	}
	return l
}

func juneHidden(*dctx) []string {
	return []string{
		"Yes. Every valley has them: a pond that no trail visits, a ruined cabin deep in the trees, a camp in the pines, a rock with a long view. They are not marked. You find them by looking for the places where the land should have something and does not, by following faint paths, and by listening for birds in the wrong sort of place.",
		"Further out there are old stations in the marshes and on the plateau, and cairns on the summits. Some of them still hold things somebody left behind.",
	}
}

func juneCare(*dctx) []string {
	return []string{
		"Keep to a walk near nesting places and give anything that is feeding some room. A bird that has been flushed has lost time it needed for food, so do not make a habit of it. If one does fly, stay still and let it settle.",
		"Do not chase. Do not call them in with a recording. Seed is all right, in the open, in small amounts. Leave nothing behind, take only what the land has dropped on its own: a feather, for example, off the trail.",
	}
}

func juneMap(*dctx) []string {
	return []string{
		"Press M for the map. It fills in as you walk and never shows where a bird is. Trails appear as you find them; hidden ones only show when you have found them. The compass strip at the top of your screen shows direction.",
		"Climb the towers to get your bearings, and follow my signposts when you are far from home. If you are properly lost, the cabin's bearing is on the map.",
	}
}

func juneForage(*dctx) []string {
	return []string{
		"A little, for yourself, from things that are common, yes. Berries, nuts, leaves, a few mushrooms. Never roots, never a whole plant, and never from anything rare. A few of the things that grow here are protected, and the herbarium in your journal will tell you which are fair game.",
		"The fair share rule is simple: the birds were here first. Leave at least two of every three berries, and the high ones for the thrushes. Pick for one meal, not a stockpile. Then everyone eats again next year.",
	}
}
