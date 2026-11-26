package progress

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// MaxRank is the highest naturalist rank.
const MaxRank = 5

// RankSkillPoints is the bonus granted on reaching each rank above the first.
const RankSkillPoints = 2

// TutorialQuest is the milestone quest of the Observer rank.
const TutorialQuest = "unseen_singer"

// ranks are milestone-based (spec §7.2): a level alone never promotes anyone.
// Unlock lines describe things that really are gated by rank: region permits
// (contract §3.5), ReqRank on items and cabin upgrades, the tier IV skill rule, and
// the rank-5 standing perk applied in ComputeStats.
var ranks = []proto.RankDef{
	{
		Index: 1, Title: "Beginner",
		Desc: "Basic equipment and common species. Everyone starts by learning to listen.",
		Unlocks: []string{
			"Greenhollow Woods and the Naturalist Cabin",
			"Your starting field kit and Finn's everyday stock",
			"Skill tiers I to III in all five disciplines",
			"Cabin upgrades: Photography Wall and Observation Garden",
		},
	},
	{
		Index: 2, Title: "Observer",
		Desc:     "Common species and expanded exploration. You have learned to follow a voice to its singer.",
		ReqLevel: 3, ReqSpecies: 5, ReqQuest: TutorialQuest,
		Unlocks: []string{
			"Ranger permits for Murmur Marsh and Amberwood",
			"Explorer-tier equipment at Finn's Field Supply",
			"Cabin upgrades: Equipment Workshop and Audio Laboratory",
			"2 bonus skill points",
		},
		SkillPoints: RankSkillPoints,
	},
	{
		Index: 3, Title: "Naturalist",
		Desc:     "Advanced tools and difficult observations. Your journal has become a record others consult.",
		ReqLevel: 8, ReqSpecies: 12, ReqDocs: 6, ReqRep: 60,
		Unlocks: []string{
			"Ranger permits for Windpeak Highlands and the Whispering Coast",
			"Specialist-tier equipment at Finn's Field Supply",
			"Tier IV specialization skills",
			"Cabin upgrade: Map Room",
			"2 bonus skill points",
		},
		SkillPoints: RankSkillPoints,
	},
	{
		Index: 4, Title: "Field Specialist",
		Desc:     "Rare species and advanced research. You are trusted with the places few people are allowed to go.",
		ReqLevel: 14, ReqSpecies: 22, ReqDocs: 14, ReqRep: 150,
		Unlocks: []string{
			"Ranger permit for Frostveil",
			"Finn's long-range instruments: the spotting scope and the parabolic microphone",
			"2 bonus skill points",
		},
		SkillPoints: RankSkillPoints,
	},
	{
		Index: 5, Title: "Master Naturalist",
		Desc:     "Mastery, prestigious discoveries, unique expeditions. The field guide quotes you now.",
		ReqLevel: 22, ReqSpecies: 32, ReqDocs: 25, ReqRep: 300,
		Unlocks: []string{
			"A master's standing: 10% off everything at Finn's",
			"Your name on the work: +15% Field Credits from research and contracts",
			"2 bonus skill points",
		},
		SkillPoints: RankSkillPoints,
	},
}

// Ranks returns the five naturalist ranks in order (index 1..5).
func Ranks() []proto.RankDef {
	out := make([]proto.RankDef, len(ranks))
	for i, r := range ranks {
		r.Unlocks = append([]string{}, r.Unlocks...)
		out[i] = r
	}
	return out
}

// Rank looks up a rank by index (1..5). Treat the result as read-only.
func Rank(index int) (proto.RankDef, bool) {
	if index < 1 || index > len(ranks) {
		return proto.RankDef{}, false
	}
	return ranks[index-1], true
}

// RankTitle is the title of a rank, or "" if there is no such rank.
func RankTitle(index int) string {
	r, _ := Rank(index)
	return r.Title
}

// RankFacts are the things a rank check needs that are not progression state of
// their own. They are passed in so the check stays a pure function; FactsFromProfile
// derives them from a profile the standard way.
type RankFacts struct {
	Species    int             // species identified (journal entries, discovery level ≥ 4)
	Documented int             // species documented (discovery level ≥ 5)
	Reputation int             // total reputation across all factions
	Quests     map[string]bool // ids of quests that have been turned in
}

// FactsFromProfile reads the rank facts out of a profile: every species in the
// journal counts as identified (a "probable" identification is still the right
// bird), entries at level ≥ 5 count as documented, reputation is summed over all
// factions, and quests with status "turned_in" count as done.
func FactsFromProfile(p *proto.Profile) RankFacts {
	f := RankFacts{Reputation: TotalRep(p), Quests: make(map[string]bool)}
	for _, e := range p.Journal.Species {
		if e == nil || e.Level < proto.LevelIdentified {
			continue
		}
		f.Species++
		if e.Level >= proto.LevelDocumented {
			f.Documented++
		}
	}
	for id, q := range p.Quests {
		if q != nil && q.Status == "turned_in" {
			f.Quests[id] = true
		}
	}
	return f
}

// meetsRank reports whether the requirements of one rank are satisfied.
func meetsRank(r *proto.RankDef, level int, f RankFacts) bool {
	return level >= r.ReqLevel &&
		f.Species >= r.ReqSpecies &&
		f.Documented >= r.ReqDocs &&
		f.Reputation >= r.ReqRep &&
		(r.ReqQuest == "" || f.Quests[r.ReqQuest])
}

// EligibleRank is the highest rank reachable from rank `from` with this level and
// these facts. Ranks are earned in order: nobody skips a milestone.
func EligibleRank(from, level int, f RankFacts) int {
	rank := min(max(from, 1), MaxRank)
	for rank < MaxRank && meetsRank(&ranks[rank], level, f) {
		rank++
	}
	return rank
}

// CheckRank promotes the player as far as their level and the facts allow, granting
// each new rank's bonus skill points, and returns the (possibly unchanged) rank and
// whether a promotion happened. Ranks are never taken away. Call it after every
// profile change; it is cheap.
func CheckRank(p *proto.Profile, f RankFacts) (newRank int, ok bool) {
	if p.Rank < 1 {
		p.Rank = 1
	}
	target := EligibleRank(p.Rank, p.Level, f)
	for p.Rank < target {
		p.Rank++
		p.SkillPoints += ranks[p.Rank-1].SkillPoints
		ok = true
	}
	if ok {
		Recompute(p) // rank perks live in the stats
	}
	return p.Rank, ok
}

// ---------------------------------------------------------------------------
// Reputation

// AddRep adds reputation with a faction (never below zero) and returns the new value.
func AddRep(p *proto.Profile, faction string, n int) int {
	if p.Rep == nil {
		p.Rep = make(map[string]int)
	}
	v := max(0, p.Rep[faction]+n)
	p.Rep[faction] = v
	if faction == FactionOutfitters {
		Recompute(p) // Finn's discount follows his opinion of you
	}
	return v
}

// TotalRep is the player's reputation summed over all factions (rank requirement).
func TotalRep(p *proto.Profile) int {
	t := 0
	for _, v := range p.Rep {
		t += v
	}
	return t
}
