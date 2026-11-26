package progress

import (
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// mods is a stat modifier map: keys are core.Stats JSON names, values are additive.
type mods = map[string]float32

// Discipline ids (pinned).
const (
	DiscAcoustics   = "acoustics"
	DiscObservation = "observation"
	DiscPhotography = "photography"
	DiscKnowledge   = "knowledge"
	DiscFieldcraft  = "fieldcraft"
)

var disciplines = []proto.DisciplineDef{
	{ID: DiscAcoustics, Name: "Acoustics", Title: "The Listener",
		Desc:  "Improves your ability to hear, interpret, and identify wildlife through sound.",
		Color: "#627F9A", Icon: "acoustics"},
	{ID: DiscObservation, Name: "Observation", Title: "The Scout",
		Desc:  "Improves your ability to visually discover wildlife and understand environmental clues.",
		Color: "#7C9A70", Icon: "observation"},
	{ID: DiscPhotography, Name: "Photography", Title: "The Photographer",
		Desc:  "Improves photography performance and wildlife documentation.",
		Color: "#C98A50", Icon: "photography"},
	{ID: DiscKnowledge, Name: "Knowledge", Title: "The Naturalist",
		Desc:  "Improves identification and understanding of species.",
		Color: "#8E6BA8", Icon: "knowledge"},
	{ID: DiscFieldcraft, Name: "Fieldcraft", Title: "The Ranger",
		Desc:  "Improves navigation, movement, and interaction with the environment.",
		Color: "#355C43", Icon: "fieldcraft"},
}

// skillTiers: points are those already invested in the same discipline (spec §8.1).
// Tier IV is the specialization: it also needs the Naturalist rank.
var skillTiers = []proto.TierReq{
	{Tier: 1, Points: 0, Rank: 0, Label: "Tier I — Basic"},
	{Tier: 2, Points: 3, Rank: 0, Label: "Tier II — Intermediate"},
	{Tier: 3, Points: 6, Rank: 0, Label: "Tier III — Advanced"},
	{Tier: 4, Points: 10, Rank: 3, Label: "Tier IV — Specialization"},
}

// tierShape is the fixed layout of every discipline (contract §3.4): the position
// of a skill in the spec's list decides its tier, how often it can be bought and
// what a rank costs.
var tierShape = [7]struct{ tier, maxRank, cost int }{
	{1, 3, 1}, {1, 3, 1}, // Tier I
	{2, 2, 1}, {2, 2, 1}, // Tier II
	{3, 2, 2}, {3, 2, 2}, // Tier III
	{4, 1, 3}, // Tier IV
}

// skillSpec is the authored part of a skill; tier, max rank and cost follow from
// its position.
type skillSpec struct {
	id, name, desc, effect, icon string
	mods                         mods // per rank
}

func discipline(id string, specs [7]skillSpec) []proto.SkillDef {
	out := make([]proto.SkillDef, 0, len(specs))
	for i, s := range specs {
		sh := tierShape[i]
		out = append(out, proto.SkillDef{
			ID: s.id, Name: s.name, Desc: s.desc, Effect: s.effect,
			Discipline: id, Tier: sh.tier, MaxRank: sh.maxRank, Cost: sh.cost,
			Mods: s.mods, Icon: s.icon,
		})
	}
	return out
}

// skills is the whole tree, discipline by discipline in the spec's order. Names and
// one-line descriptions are the spec's (§8.2–§8.6); Effect says what a rank really
// does, in the terms the player meets in the field. Every modifier lands on a
// core.Stats field that a consumer reads (see the notes on core.Stats).
var skills = buildSkills()

func buildSkills() []proto.SkillDef {
	var all []proto.SkillDef

	all = append(all, discipline(DiscAcoustics, [7]skillSpec{
		{id: "keen_ears", name: "Keen Ears", icon: "ear",
			desc:   "Detect quieter bird calls",
			effect: "+15% hearing range per rank: faint and distant calls reach you that others would miss.",
			mods:   mods{"hearRange": 0.15}},
		{id: "sound_direction", name: "Sound Direction", icon: "compass",
			desc:   "Improve directional accuracy",
			effect: "+18% directional accuracy per rank: sound clues give a tighter bearing. From rank 2 you can also tell whether a call comes from above, level or below.",
			mods:   mods{"dirAccuracy": 0.18}},
		{id: "acoustic_memory", name: "Acoustic Memory", icon: "recorder",
			desc:   "Recognize previously recorded calls",
			effect: "You recognise by ear every species you have recorded: its name appears on the sound clue. Each rank also makes your recordings count for more as identification evidence.",
			mods:   mods{"callMemory": 1, "audioAssist": 0.5}},
		{id: "frequency_awareness", name: "Frequency Awareness", icon: "wave",
			desc:   "Distinguish sound characteristics",
			effect: "Rank 1: sound clues show the pitch of a call. Rank 2: they also show its pattern (repeated notes, trill, whistle…) without focused listening.",
			mods:   mods{"pitchInfo": 1, "patternInfo": 0.5}},
		{id: "deep_listening", name: "Deep Listening", icon: "headphones",
			desc:   "Isolate sounds in crowded soundscapes",
			effect: "Per rank: follow one more voice at the same time, and ignore 15% of wind, rain and water noise.",
			mods:   mods{"clueSlots": 1, "noiseReduce": 0.15}},
		{id: "echo_reading", name: "Echo Reading", icon: "mountain",
			desc:   "Estimate distance more accurately",
			effect: "+30% distance accuracy per rank: sound clues give a much narrower distance band.",
			mods:   mods{"distAcc": 0.3}},
		{id: "natural_recognition", name: "Natural Recognition", icon: "bird",
			desc:   "Recognize familiar species through calls with less assistance",
			effect: "You know every species you have identified by its voice alone, recorded or not, and focused listening reaches 15% farther.",
			mods:   mods{"callRecognise": 1, "focusBonus": 0.15}},
	})...)

	all = append(all, discipline(DiscObservation, [7]skillSpec{
		{id: "sharp_eyes", name: "Sharp Eyes", icon: "eye",
			desc:   "Detect movement more easily",
			effect: "Per rank: +15% unaided viewing range and +10% faster reading of a bird's features while you watch it.",
			mods:   mods{"nakedEye": 0.15, "observeSpeed": 0.1}},
		{id: "movement_recognition", name: "Movement Recognition", icon: "leaf",
			desc:   "Notice subtle movement",
			effect: "+8 m per rank to the distance at which a hop or a wingbeat in front of you catches your eye.",
			mods:   mods{"moveSense": 8}},
		{id: "patience", name: "Patience", icon: "pause",
			desc:   "Wildlife settles more quickly",
			effect: "+35% per rank to how quickly wary birds calm down and go back to what they were doing while you keep still.",
			mods:   mods{"settle": 0.35}},
		{id: "habitat_reading", name: "Habitat Reading", icon: "tree",
			desc:   "Predict where birds may hide",
			effect: "Rank 1: sound clues name the habitat the call comes from. Rank 2: they also suggest where the bird is sitting — high in the canopy, low in the shrubs, down in the reeds.",
			mods:   mods{"habitatInfo": 1, "perchHint": 0.5}},
		{id: "peripheral_awareness", name: "Peripheral Awareness", icon: "search",
			desc:   "Detect nearby movement",
			effect: "+10 m per rank: movement outside your view shows as a soft ripple at the edge of the screen.",
			mods:   mods{"peripheral": 10}},
		{id: "tracking", name: "Tracking", icon: "footprint",
			desc:   "Identify environmental clues",
			effect: "+9 m per rank to the distance at which feathers, old pages and other signs on the ground catch the light.",
			mods:   mods{"trackSigns": 9}},
		{id: "natural_instinct", name: "Natural Instinct", icon: "star",
			desc:   "Recognize unusual activity",
			effect: "Clues quietly flag when something is out of the ordinary — a visitor far from home, an odd plumage — and you read a watched bird 10% faster.",
			mods:   mods{"instinct": 1, "observeSpeed": 0.1}},
	})...)

	all = append(all, discipline(DiscPhotography, [7]skillSpec{
		{id: "steady_hands", name: "Steady Hands", icon: "camera",
			desc:   "Reduce camera shake",
			effect: "Per rank: +12% camera stability and +8% binocular stability.",
			mods:   mods{"camStability": 0.12, "binoStability": 0.08}},
		{id: "quick_shot", name: "Quick Shot", icon: "forward",
			desc:   "Faster camera readiness",
			effect: "Per rank: the camera comes up 0.12 s sooner and fires 0.25 more frames per second in a burst.",
			mods:   mods{"camReady": -0.12, "camBurst": 0.25}},
		{id: "focus_control", name: "Focus Control", icon: "lens",
			desc:   "Improve manual focusing",
			effect: "Per rank: camera and binoculars snap into focus noticeably faster (+0.4 focus speed each).",
			mods:   mods{"camFocus": 0.4, "binoFocus": 0.4}},
		{id: "silent_shutter", name: "Silent Shutter", icon: "moon",
			desc:   "Reduce disturbance",
			effect: "−15% shutter disturbance per rank: fewer birds flinch or flush when you take the picture.",
			mods:   mods{"camNoise": -0.15}},
		{id: "wildlife_composition", name: "Wildlife Composition", icon: "wall",
			desc:   "Improve photograph quality",
			effect: "+15 points of composition score per rank on every photograph.",
			mods:   mods{"composition": 0.15}},
		{id: "long_lens_mastery", name: "Long Lens Mastery", icon: "binoculars",
			desc:   "Better handling of high magnification",
			effect: "Removes 30% per rank of the extra shake that comes with zooming in.",
			mods:   mods{"longLens": 0.3}},
		{id: "perfect_moment", name: "Perfect Moment", icon: "film",
			desc:   "Improve timing for behavior photographs",
			effect: "A subtle cue tells you when a watched bird is doing something worth a frame, and behaviour photographs score at their full bonus.",
			mods:   mods{"momentBonus": 1}},
	})...)

	all = append(all, discipline(DiscKnowledge, [7]skillSpec{
		{id: "field_experience", name: "Field Experience", icon: "journal",
			desc:   "Unlock additional journal information",
			effect: "Each rank unlocks a deeper layer of detail in the journal entries of species you have identified.",
			mods:   mods{"journalInfo": 1}},
		{id: "species_recognition", name: "Species Recognition", icon: "bird",
			desc:   "Improve visual identification",
			effect: "Each rank sharpens the candidate list and its confidence figures when you identify by sight. From rank 2 you recognise species you already know at a glance.",
			mods:   mods{"idAssist": 0.6, "recognise": 0.5}},
		{id: "habitat_knowledge", name: "Habitat Knowledge", icon: "pond",
			desc:   "Predict species locations",
			effect: "The field guide shows where each species is likely to be found, and each rank lets where you are standing weigh more surely in your identifications.",
			mods:   mods{"habitatKnow": 1, "idAssist": 0.2}},
		{id: "seasonal_awareness", name: "Seasonal Awareness", icon: "dawn",
			desc:   "Understand seasonal patterns",
			effect: "The field guide shows each species' seasonal and daily activity, and each rank adds 10% confidence when identifying migrants and other difficult visitors.",
			mods:   mods{"seasonKnow": 1, "rareId": 0.1}},
		{id: "behavioral_insight", name: "Behavioral Insight", icon: "nest",
			desc:   "Recognize unusual behavior",
			effect: "Per rank: behaviour is read 50% faster as evidence, and discovering a unique behaviour is worth 25% more XP.",
			mods:   mods{"behaviorInsight": 0.5}},
		{id: "ecological_knowledge", name: "Ecological Knowledge", icon: "leaf",
			desc:   "Understand species relationships",
			effect: "Journal entries show how species depend on one another, and all XP you earn rises by 5% per rank.",
			mods:   mods{"ecoKnow": 1, "xpMult": 0.05}},
		{id: "master_naturalist", name: "Master Naturalist", icon: "rank",
			desc:   "Improve difficult and rare identification",
			effect: "+60% confidence when identifying rare and easily confused species, and a sharper candidate list for every bird.",
			mods:   mods{"rareId": 0.6, "idAssist": 0.5}},
	})...)

	all = append(all, discipline(DiscFieldcraft, [7]skillSpec{
		{id: "quiet_steps", name: "Quiet Steps", icon: "footprint",
			desc:   "Reduce disturbance",
			effect: "−8% per rank to the distance at which birds take fright at your approach.",
			mods:   mods{"stealth": -0.08}},
		{id: "trail_sense", name: "Trail Sense", icon: "map",
			desc:   "Discover hidden paths",
			effect: "+10 m per rank to the distance at which hidden trails and secret places reveal themselves. From rank 2 your map shows trails.",
			mods:   mods{"trailSense": 10, "mapDetail": 0.5}},
		{id: "weather_sense", name: "Weather Sense", icon: "cloudy",
			desc:   "Better predict conditions",
			effect: "Read the sky: +6 hours of weather forecast per rank.",
			mods:   mods{"forecast": 6}},
		{id: "concealment", name: "Concealment", icon: "hide",
			desc:   "Become less noticeable to wildlife",
			effect: "While crouched or sitting, birds tolerate you a further 12% closer per rank.",
			mods:   mods{"crouchBonus": -0.12}},
		{id: "campcraft", name: "Campcraft", icon: "camp",
			desc:   "Improve temporary observation setups",
			effect: "+40% per rank to the effect of sitting down to wait: the wildlife around a settled observer relaxes sooner and comes closer.",
			mods:   mods{"camp": 0.4}},
		{id: "wildlife_familiarity", name: "Wildlife Familiarity", icon: "feather",
			desc:   "Wildlife becomes less reactive",
			effect: "Birds get used to your presence 50% faster per rank and then allow a closer approach.",
			mods:   mods{"familiarity": 0.5}},
		{id: "woodland_mastery", name: "Woodland Mastery", icon: "tree",
			desc:   "Traverse difficult terrain efficiently",
			effect: "Slopes, undergrowth and shallow water slow you 60% less; you walk 8% faster and can sprint 3 seconds longer.",
			mods:   mods{"terrain": 0.6, "moveSpeed": 0.08, "stamina": 3}},
	})...)

	return all
}

var skillIndex = func() map[string]*proto.SkillDef {
	idx := make(map[string]*proto.SkillDef, len(skills))
	for i := range skills {
		idx[skills[i].ID] = &skills[i]
	}
	return idx
}()

// Disciplines returns the five skill disciplines in display order.
func Disciplines() []proto.DisciplineDef { return append([]proto.DisciplineDef{}, disciplines...) }

// SkillTiers returns the four tier requirements (index = tier − 1).
func SkillTiers() []proto.TierReq { return append([]proto.TierReq{}, skillTiers...) }

// Skills returns all 35 skills, discipline by discipline, tier by tier.
func Skills() []proto.SkillDef {
	out := make([]proto.SkillDef, len(skills))
	for i, s := range skills {
		s.Mods = cloneMods(s.Mods)
		out[i] = s
	}
	return out
}

// Skill looks up a skill. Treat the result (its Mods map) as read-only.
func Skill(id string) (proto.SkillDef, bool) {
	s := skillIndex[id]
	if s == nil {
		return proto.SkillDef{}, false
	}
	return *s, true
}

// TierRequirement returns the requirement for a tier (1..4).
func TierRequirement(tier int) (proto.TierReq, bool) {
	if tier < 1 || tier > len(skillTiers) {
		return proto.TierReq{}, false
	}
	return skillTiers[tier-1], true
}

// PointsInvested is the number of skill points the player has spent in a discipline
// (cost × rank over its skills): the figure tier requirements are measured against.
func PointsInvested(p *proto.Profile, discipline string) int {
	n := 0
	for i := range skills {
		if skills[i].Discipline == discipline {
			n += skills[i].Cost * min(max(p.Skills[skills[i].ID], 0), skills[i].MaxRank)
		}
	}
	return n
}

// CanBuySkill reports why the next rank of a skill cannot be bought right now, or
// nil if it can. It changes nothing.
func CanBuySkill(p *proto.Profile, skillID string) error {
	s := skillIndex[skillID]
	if s == nil {
		return fail(ErrUnknown, "There is no such skill.")
	}
	if p.Skills[s.ID] >= s.MaxRank {
		return fail(ErrMaxed, "You have learned all there is to %s.", s.Name)
	}
	req := skillTiers[s.Tier-1]
	if p.Rank < req.Rank {
		return fail(ErrRank, "%s is a specialization: it opens at the rank of %s.", s.Name, RankTitle(req.Rank))
	}
	if have := PointsInvested(p, s.Discipline); have < req.Points {
		return fail(ErrRequirement, "%s needs %d points invested in %s first (you have %d).",
			s.Name, req.Points, disciplineName(s.Discipline), have)
	}
	if p.SkillPoints < s.Cost {
		if s.Cost == 1 {
			return fail(ErrSkillPoints, "%s costs 1 skill point. Level up to earn more.", s.Name)
		}
		return fail(ErrSkillPoints, "%s costs %d skill points (you have %d).", s.Name, s.Cost, p.SkillPoints)
	}
	return nil
}

// BuySkill spends skill points on the next rank of a skill and recomputes stats.
func BuySkill(p *proto.Profile, skillID string) error {
	if err := CanBuySkill(p, skillID); err != nil {
		return err
	}
	s := skillIndex[skillID]
	if p.Skills == nil {
		p.Skills = make(map[string]int)
	}
	p.SkillPoints -= s.Cost
	p.Skills[s.ID]++
	Recompute(p)
	return nil
}

func disciplineName(id string) string {
	for _, d := range disciplines {
		if d.ID == id {
			return d.Name
		}
	}
	return id
}

func cloneMods(m map[string]float32) map[string]float32 {
	out := make(map[string]float32, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
