package content

import (
	"strconv"
	"sync"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// TutorialQuest is the id of the primary tutorial quest (spec §27).
const TutorialQuest = "unseen_singer"

// acceptItems are handed over when a quest is accepted (see Accepted.Items).
// Mara lends her field recorder for the tutorial's "record it" step; Finn puts up
// the seed that makes his photograph possible.
var acceptItems = map[string][]string{
	TutorialQuest:    {itemRecorder},
	"perfect_moment": {itemSeed, itemSeed},
}

// AcceptItems returns the items a quest hands to the player on acceptance.
// Tracker.Accept reports the same list (once per save); this getter exists for UI
// and validation.
func AcceptItems(questID string) []string {
	return append([]string(nil), acceptItems[questID]...)
}

// o builds an objective. params are key, value pairs.
func o(id, kind, target string, count int, text, hint string, params ...string) proto.ObjectiveDef {
	d := proto.ObjectiveDef{ID: id, Text: text, Kind: kind, Target: target, Count: count, Hint: hint}
	if len(params) > 0 {
		d.Params = make(map[string]string, len(params)/2)
		for i := 0; i+1 < len(params); i += 2 {
			d.Params[params[i]] = params[i+1]
		}
	}
	return d
}

func stars(n int) string { return strconv.Itoa(n) }

// Quests returns every quest and research contract. The slice is freshly built on
// each call, in the order the quest log should list them.
//
// Because the world is generated, objectives refer by id only to the pinned
// home-valley POIs; anything further afield is a kind target with a region
// parameter ("discover kind:watchtower in windpeak").
func Quests() []proto.QuestDef {
	var q []proto.QuestDef
	q = append(q, valleyQuests()...)
	q = append(q, regionQuests()...)
	q = append(q, larderQuests()...)
	q = append(q, boardContracts()...)
	return q
}

var (
	defaultOnce sync.Once
	defaultTrk  *Tracker
)

// defaultTracker is the shared tracker over the authored catalog. The catalog is
// immutable after construction, so one instance serves every caller.
func defaultTracker() *Tracker {
	defaultOnce.Do(func() { defaultTrk = NewTracker() })
	return defaultTrk
}

// QuestByID returns one quest definition.
func QuestByID(id string) (proto.QuestDef, bool) {
	if d, ok := defaultTracker().Quest(id); ok {
		return *d, true
	}
	return proto.QuestDef{}, false
}

// valleyQuests are set in the home valley and work in every generated world.
func valleyQuests() []proto.QuestDef {
	return []proto.QuestDef{
		{
			ID: TutorialQuest, Name: "The Unseen Singer", Category: CatResearch, Giver: NPCMara,
			Summary: "Something small is singing from the undergrowth along the old woodland trail. Find out what it is.",
			Story:   "Every morning this week Mara has heard the same voice: a long, loud, rattling song from somewhere low in the tangle beside the old trail. She knows what it is. She would rather you found out for yourself, and she has lent you her field recorder to help.",
			Ordered: true, Tutorial: true, AutoStart: true,
			Objectives: []proto.ObjectiveDef{
				o("hear", KindHear, tutorialSpecies, 1, "Hear the unknown singer",
					"Walk the trail slowly and stop often. Hold F to listen for a long, fast, rattling song from low cover: bramble, fern, fallen wood."),
				o("investigate", KindObserve, tutorialSpecies, 1, "Investigate the sound",
					"Follow the direction the sound gives you. Crouch (C) as you get near, do not walk straight at it, and watch the undergrowth for something small on the move."),
				o("record", KindRecord, tutorialSpecies, 1, "Record its song",
					"Take out the recorder (3), face the singer and click to start. Stay still until it has sung a whole phrase, then click again. If it has gone quiet, sit (X) close by and wait; it sings most freely at dawn."),
				o("identify", KindIdentify, tutorialSpecies, 1, "Identify the bird",
					"Watch it through your binoculars (1, hold the right mouse button) until you have a few pieces of evidence. Then press T and weigh up the candidates."),
				o("photograph", KindPhoto, tutorialSpecies, 1, "Photograph it",
					"Camera (2): hold the right mouse button to raise it, left click to shoot. It likes to hop up onto a stump or a stem to sing. Wait for that."),
			},
			// 60 starting credits + 260 puts the Explorer binoculars within reach at
			// Finn's (spec §27 stage 9), and the skill point can be spent at once.
			Rewards: proto.Reward{
				XP: 300, Credits: 260, SkillPoints: 1,
				Rep:   map[string]int{FactionResearch: 25, FactionNaturalists: 15},
				Lore:  []string{"listen_first"},
				Badge: "badge_first_song",
			},
		},
		{
			ID: "perfect_moment", Name: "A Perfect Moment", Category: CatPhotography, Giver: NPCFinn,
			Summary: "Finn wants a photograph for the front of his stall: a bird caught in the act of feeding.",
			Story:   "Finn's stall has a sun-bleached photograph of a duck pinned to it and he is tired of looking at it. He wants a bird with its bill full: a worm, a seed, a berry, anything. He has given you two handfuls of seed mix to tip the odds.",
			Objectives: []proto.ObjectiveDef{
				o("feeding", KindPhoto, TargetAny, 1, "Photograph a bird in the act of feeding",
					"Feeding lasts a second or two. Scatter seed (G) in the open, back away, sit (X) and keep the camera raised. Morning is the busiest time.",
					ParamBehavior, "feeding", ParamMinStars, stars(2)),
			},
			Rewards: proto.Reward{
				XP: 150, Credits: 90,
				Rep:   map[string]int{FactionOutfitters: 20},
				Items: []string{itemFilm},
				Lore:  []string{"sit_and_wait"},
				Badge: "badge_perfect_moment",
			},
		},
		{
			ID: "old_watchtower", Name: "The Old Watchtower", Category: CatExploration, Giver: NPCJune,
			Summary: "An abandoned fire-watch tower stands somewhere off the trail. June wants to know what is left in it.",
			Story:   "The tower has not been staffed since before June's time, and the path to it grew over long ago. The last keeper was a naturalist; June has always wondered whether her papers are still up there.",
			Objectives: []proto.ObjectiveDef{
				o("tower", KindDiscover, "old_watchtower", 1, "Find the Old Watchtower",
					"It stands on a wooded rise away from the main trail. From open ground, look for a roofline above the trees."),
				o("page", KindCollect, "page_0", 1, "Recover the torn journal page",
					"Search the tower from its foot to its platform. Paper lasts longest out of the rain."),
				o("satchel", KindCollect, "cache_watchtower", 1, "Search the weathered satchel",
					"Somebody left a satchel at the tower. Press E to open it."),
			},
			Rewards: proto.Reward{
				XP: 200, Credits: 100,
				Rep:    map[string]int{FactionRangers: 25},
				Lore:   []string{"fire_watch"},
				Unlock: []string{"quest:harrows_survey", trailFeature + "secret_lookout"},
			},
		},
		{
			ID: "familiar_voice", Name: "A Familiar Voice", Category: CatAcoustic, Giver: NPCMara,
			Summary:  "Put a name to three species from their voices alone.",
			Story:    "You found one singer with your eyes. Mara wants you to find the next three with your ears: listen until you know the pitch and the pattern of a voice, and name it before you have had a proper look.",
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("voices", KindIdentify, TargetAny, 3, "Identify three species by sound",
					"Hold F and keep listening until the clue shows pitch and pattern. Then open your journal (J), find the mystery voice and identify it from what you heard. A probable identification counts.",
					ParamMethod, "sound"),
			},
			Rewards: proto.Reward{
				XP: 200, Credits: 120,
				Rep:  map[string]int{FactionNaturalists: 20, FactionResearch: 10},
				Lore: []string{"birding_by_ear"},
			},
		},
		{
			ID: "visitor_from_afar", Name: "A Visitor from Afar", Category: CatResearch, Giver: NPCAlder,
			Summary:  "Document a bird that is far outside its normal range.",
			Story:    "Every so often the weather delivers a bird to the wrong country. Professor Alder has thirty years of such records in other people's handwriting and would like one in yours.",
			Requires: []string{TutorialQuest}, ReqRank: 2,
			Objectives: []proto.ObjectiveDef{
				o("vagrant", KindRare, "out_of_range", 1, "Identify an out-of-range visitor",
					"Look after strong wind or rain and when the season turns; autumn is best. You are looking for a bird that does not belong in the habitat you find it in. Identify it and it goes into your Rare Discoveries."),
			},
			Rewards: proto.Reward{
				XP: 300, Credits: 150,
				Rep:   map[string]int{FactionResearch: 40},
				Lore:  []string{"lost_on_the_wind"},
				Badge: "badge_far_traveller",
			},
		},
		{
			ID: "harrows_survey", Name: "Harrow's Unfinished Survey", Category: CatResearch, Giver: NPCAlder,
			Summary:  "The page from the watchtower belongs to a survey nobody finished. Repeat four of Edith Harrow's records.",
			Story:    "The torn page is in the hand of Edith Harrow, the last fire-watch keeper, who logged the valley's birds for thirty years and never published a line. Professor Alder wants to know how much of what she saw is still here.",
			Requires: []string{"old_watchtower"}, Hidden: true,
			Objectives: []proto.ObjectiveDef{
				o("thrush", KindIdentify, "song_thrush", 1, "Find the singer that says everything twice",
					"Harrow logged a singer on a high perch at dawn and dusk: clear, rich phrases, each one repeated two or three times before the next."),
				o("creeper", KindIdentify, "eurasian_treecreeper", 1, "Find the mouse that climbs trees",
					"Her record of a small brown bird spiralling up a rough-barked trunk, then dropping to the foot of the next."),
				o("owl", KindHear, "tawny_owl", 1, "Hear the owl she listened for from the tower",
					"Only after dark. Rest at the cabin until night, then stand quietly among the big old trees."),
				o("pond", KindDiscover, "hidden_pond", 1, "Find the still water she kept to herself",
					"No trail goes there. Look for wet ground and reeds where there should be none, and for a faint path leaving the main trail."),
				o("submit", KindResearch, "submit", 1, "Submit a photo or recording at your Research Desk",
					"Open the Research Desk at the cabin and submit your best piece of evidence to the board."),
			},
			Rewards: proto.Reward{
				XP: 300, Credits: 160,
				Rep:    map[string]int{FactionResearch: 35, FactionNaturalists: 10},
				Lore:   []string{"unfinished_survey"},
				Unlock: []string{"quest:golden_flute"},
				Badge:  "badge_harrows_heir",
			},
		},
		{
			ID: "harrows_places", Name: "Off the Map", Category: CatExploration, Giver: NPCMara,
			Summary:  "Edith Harrow kept four places to herself. None of them is on a trail.",
			Story:    "Mara was a girl when Harrow kept the tower, and remembers being told that the best of the valley was not on any map. The diary agrees: still water, a grey rock with a long view, a cabin, and a camp in the pines.",
			Requires: []string{"old_watchtower"},
			Objectives: []proto.ObjectiveDef{
				o("pond", KindDiscover, "hidden_pond", 1, "Find the still water",
					"Wet ground, reeds, and a faint path leaving the main trail. Listen for water birds where you would not expect any."),
				o("lookout", KindDiscover, "viewpoint_lookout", 1, "Find the grey rock with the long view",
					"A bare shoulder of rock standing clear of the trees. Climb, and keep climbing."),
				o("cabin", KindDiscover, "hidden_cabin", 1, "Find the trapper's cabin",
					"Deep in the wood, far from any trail. A straight roofline is easy to pick out among trunks once you are looking for one."),
				o("camp", KindDiscover, "camp_survey", 1, "Find the camp in the pines",
					"Look where the wood turns dark and the ground is soft with needles."),
			},
			Rewards: proto.Reward{
				XP: 320, Credits: 180,
				Rep:   map[string]int{FactionNaturalists: 30, FactionRangers: 10},
				Lore:  []string{"off_the_path"},
				Badge: "badge_pathfinder",
			},
		},
		{
			ID: "golden_hour", Name: "Golden Hour", Category: CatPhotography, Giver: NPCMara,
			Summary:  "Take one good photograph in the low light of dawn or evening.",
			Story:    "Mara says there are two hours in the day when anyone can take a good photograph, and most people sleep through one and eat through the other.",
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("light", KindPhoto, TargetAny, 1, "Take a three-star photograph at dawn or in the evening",
					"Rest at the cabin until dawn or evening. Get the bird in the open, fill a good part of the frame, and let the focus settle before you press the shutter.",
					ParamPhase, "dawn|evening", ParamMinStars, stars(3)),
			},
			Rewards: proto.Reward{
				XP: 180, Credits: 100,
				Rep:  map[string]int{FactionNaturalists: 15},
				Lore: []string{"golden_light"},
			},
		},
		{
			ID: "quiet_creek", Name: "The Quiet Creek", Category: CatConservation, Giver: NPCJune,
			Summary: "June thinks the creek has gone quiet. Walk its length and find out whether its birds are still there.",
			Story:   "A creek that is in good health has a particular bird on it: grey above, yellow beneath, never still. June has not seen one since the spring floods and wants a second pair of eyes before she starts to worry.",
			Objectives: []proto.ObjectiveDef{
				o("crossing", KindDiscover, "creekside", 1, "Visit the crossing at Creekside", "Follow the main trail to where it meets the water."),
				o("hide", KindDiscover, "hide_creek", 1, "Find the Creek Hide", "A wooden hide overlooks the creek. Birds ignore you inside it."),
				o("hollow", KindDiscover, "fern_valley", 1, "Walk down to Fern Valley", "Follow the water downstream into the damp hollow."),
				o("wagtail", KindIdentify, "grey_wagtail", 1, "Identify the creek's long-tailed bird",
					"Watch the stones in the stream and the water's edge. It walks, it never hops, and its tail never stops moving."),
				o("alder", KindTalk, NPCAlder, 1, "Ask Professor Alder what it means", "He keeps the field lab at Creekside."),
			},
			Rewards: proto.Reward{
				XP: 220, Credits: 110,
				Rep:  map[string]int{FactionRangers: 30, FactionResearch: 10},
				Lore: []string{"what_the_wagtail_knows"},
			},
		},
		{
			ID: "dawn_count", Name: "The Dawn Count", Category: CatConservation, Giver: NPCJune,
			Summary:  "Count the voices in the dawn chorus, so June can compare this year with the last.",
			Story:    "The rangers count the dawn chorus every year: one morning, one listener, every different voice. The numbers only mean something if somebody keeps turning up to take them.",
			Requires: []string{"quiet_creek"}, Ordered: true,
			Objectives: []proto.ObjectiveDef{
				o("voices", KindHear, TargetAny, 6, "Hear six different voices at dawn",
					"Rest at the cabin until dawn, then stand still somewhere with trees and open ground both in earshot. You do not need to know their names; a voice you cannot name still counts.",
					ParamPhase, "dawn", ParamDistinct, "true"),
				o("report", KindReturn, "", 1, "Return to the cabin and write up the count", "Your desk is the place for it."),
			},
			Rewards: proto.Reward{
				XP: 260, Credits: 130,
				Rep:   map[string]int{FactionRangers: 30},
				Lore:  []string{"dawn_chorus"},
				Badge: "badge_dawn_counter",
			},
		},
		{
			ID: "golden_flute", Name: "The Golden Flute", Category: CatResearch, Giver: NPCMara,
			Summary:  "Harrow heard a flute in the treetops on spring mornings. Mara has waited forty years to hear it herself.",
			Story:    "The survey's last line reads: \"The flute again, high in the crown, a little after sunrise. Gone by June.\" Nobody has reported that voice in Greenhollow since. Mara does not believe they ever left.",
			Requires: []string{"harrows_survey"}, ReqRank: 2, Hidden: true,
			Objectives: []proto.ObjectiveDef{
				o("flute", KindHear, "golden_oriole", 1, "Hear the flute in the canopy",
					"Late spring, in the morning, in the tallest broadleaved trees. A short, rich, fluting whistle from far overhead. It will not be there every day."),
				o("oriole", KindIdentify, "golden_oriole", 1, "Identify the singer",
					"It stays in the crown among the leaves. Stand well back so you can see into the top of the tree, sit down, and wait for it to cross a gap."),
			},
			Rewards: proto.Reward{
				XP: 400, Credits: 250,
				Rep:   map[string]int{FactionNaturalists: 40, FactionResearch: 20},
				Badge: "badge_golden_flute",
			},
		},
	}
}

// regionQuests motivate the five outer region types. They open with the permit for
// their region and are written against kinds and regions, never ids.
func regionQuests() []proto.QuestDef {
	const (
		marsh = "murmur_marsh"
		peak  = "windpeak"
		coast = "whispering_coast"
		amber = "amberwood"
		frost = "frostveil"
	)
	return []proto.QuestDef{
		{
			ID: "reedbed_voices", Name: "Voices in the Reeds", Category: CatAcoustic, Giver: NPCJune,
			Summary: "Your Observer permit opens Murmur Marsh. June wants to know what is living in it.",
			Story:   "Nobody has surveyed the marshes properly in years. You cannot see ten feet into a reedbed, so this is a job for ears and a recorder: find a hide, settle in, and listen.",
			ReqRank: 2,
			Objectives: []proto.ObjectiveDef{
				o("hide", KindDiscover, TargetKind+"hide", 1, "Find a bird hide in Murmur Marsh",
					"Marsh lies beyond the valley wherever the land drops to the level of the water. Hides stand at the edge of the larger pools.",
					ParamRegion, marsh),
				o("species", KindIdentify, TargetAny, 3, "Identify three species in the marsh",
					"Open water for the swimmers, the margins for the waders, the reeds for everything you can only hear.",
					ParamRegion, marsh),
				o("tape", KindRecord, TargetAny, 1, "Make a two-star recording in the marsh",
					"Reeds hiss in any wind. Record on a still morning, or from the lee of a hide.",
					ParamRegion, marsh, ParamMinStars, stars(2)),
			},
			Rewards: proto.Reward{
				XP: 280, Credits: 160,
				Rep:  map[string]int{FactionRangers: 30},
				Lore: []string{"the_reedbed"},
			},
		},
		{
			ID: "booming_dusk", Name: "The Boom at Dusk", Category: CatAcoustic, Giver: NPCAlder,
			Summary:  "Something in the marsh makes a sound like breath across the neck of a bottle. Professor Alder wants it on tape.",
			Story:    "The boom carries for miles and is nearly impossible to place. They are few, they stand motionless among the reeds, and they call when the light is going.",
			Requires: []string{"reedbed_voices"}, ReqRank: 2,
			Objectives: []proto.ObjectiveDef{
				o("boom", KindHear, "eurasian_bittern", 1, "Hear the boom from the reedbed",
					"Dusk, in spring, on a still evening, beside a big reedbed. It is a very low sound: you may feel it before you hear it."),
				o("tape", KindRecord, "eurasian_bittern", 1, "Record it",
					"Low sounds travel, so you need not be close. Point the recorder at the reeds and keep it running until the boom comes again."),
			},
			Rewards: proto.Reward{
				XP: 350, Credits: 200,
				Rep:   map[string]int{FactionResearch: 40},
				Badge: "badge_voice_of_the_reeds",
			},
		},
		{
			ID: "amber_passage", Name: "The Amber Passage", Category: CatPhotography, Giver: NPCMara,
			Summary: "Your Observer permit opens Amberwood. Bring Mara photographs from the autumn woods.",
			Story:   "Amberwood is where the travelling flocks stop to feed, and where the light does half a photographer's work. Mara wants three birds on film to show what is passing through.",
			ReqRank: 2,
			Objectives: []proto.ObjectiveDef{
				o("plates", KindPhoto, TargetAny, 3, "Photograph three different species in Amberwood (two stars or better)",
					"Find the berry thickets and wait beside them. Flocks arrive in waves; let them come to you.",
					ParamRegion, amber, ParamMinStars, stars(2), ParamDistinct, "true"),
				o("species", KindIdentify, TargetAny, 2, "Identify two species in Amberwood",
					"The visitors change with the season. What you find in autumn will not be what you find in spring.",
					ParamRegion, amber),
			},
			Rewards: proto.Reward{
				XP: 280, Credits: 160,
				Rep:  map[string]int{FactionNaturalists: 30},
				Lore: []string{"autumn_passage"},
			},
		},
		{
			ID: "above_the_treeline", Name: "Above the Treeline", Category: CatExploration, Giver: NPCJune,
			Summary: "Your Naturalist permit opens the Windpeak Highlands. June needs the high ground checked.",
			Story:   "The towers and cairns of the highlands were the rangers' eyes once. June wants to know which are still standing, and what is living up there now that nobody climbs to look.",
			ReqRank: 3,
			Objectives: []proto.ObjectiveDef{
				o("tower", KindDiscover, TargetKind+"watchtower", 1, "Find a watchtower in the Windpeak Highlands",
					"Towers were built where they could see each other. Get high and look along the ridges.",
					ParamRegion, peak),
				o("view", KindDiscover, TargetKind+"viewpoint", 1, "Reach a viewpoint in the highlands",
					"Local summits and cliff tops. None of them is marked until you have stood on it.",
					ParamRegion, peak),
				o("species", KindIdentify, TargetAny, 2, "Identify two highland species",
					"Wind steals the sound. Listen from the lee of a crag, and check every rock that seems to have a bird-shaped top.",
					ParamRegion, peak),
			},
			Rewards: proto.Reward{
				XP: 350, Credits: 220,
				Rep:  map[string]int{FactionRangers: 40},
				Lore: []string{"above_the_trees"},
			},
		},
		{
			ID: "the_long_view", Name: "The Long View", Category: CatPhotography, Giver: NPCAlder,
			Summary: "Your Naturalist permit opens the Whispering Coast. Professor Alder wants the seabirds counted and one caught on the wing.",
			Story:   "The coast is watched at a distance: birds on ledges, birds on the water, birds going past. Professor Alder calls it the only honest test of a pair of binoculars.",
			ReqRank: 3,
			Objectives: []proto.ObjectiveDef{
				o("species", KindIdentify, TargetAny, 3, "Identify three species on the Whispering Coast",
					"Scan the ledges, the tideline and the water in turn. Size is hard to judge over the sea; compare each bird with the one beside it.",
					ParamRegion, coast),
				o("wing", KindPhoto, TargetAny, 1, "Photograph a bird in flight on the coast (two stars or better)",
					"Stand on a cliff top where birds pass at eye level. Follow one smoothly and press the shutter without stopping the swing.",
					ParamRegion, coast, ParamBehavior, "flying|soaring|hovering|diving", ParamMinStars, stars(2)),
			},
			Rewards: proto.Reward{
				XP: 350, Credits: 220,
				Rep:  map[string]int{FactionResearch: 35},
				Lore: []string{"the_tideline"},
			},
		},
		{
			ID: "white_on_white", Name: "White on White", Category: CatResearch, Giver: NPCAlder,
			Summary: "Your Field Specialist permit opens Frostveil. Very little has ever been recorded there.",
			Story:   "The research stations on the plateau were abandoned decades ago and their records with them. Professor Alder would like to know what winters there, and he would like someone else to go and look.",
			ReqRank: 4,
			Objectives: []proto.ObjectiveDef{
				o("station", KindDiscover, TargetKind+"abandoned_station", 1, "Find an abandoned station in Frostveil",
					"A straight line in a white country is always man-made. Look for roofs and masts against the snow.",
					ParamRegion, frost),
				o("species", KindIdentify, TargetAny, 2, "Identify two species in Frostveil",
					"Look for shape and shadow, not colour. On snow, movement gives a bird away before anything else does.",
					ParamRegion, frost),
				o("plate", KindPhoto, TargetAny, 1, "Take a three-star photograph in Frostveil",
					"Snow light is bright and flat. Get low, get close slowly, and let the bird settle before you raise the camera.",
					ParamRegion, frost, ParamMinStars, stars(3)),
			},
			Rewards: proto.Reward{
				XP: 450, Credits: 300,
				Rep:   map[string]int{FactionResearch: 50},
				Lore:  []string{"surviving_the_cold"},
				Badge: "badge_white_on_white",
			},
		},
	}
}

// boardContracts are the research contracts posted at the cabin's Research Desk.
// Each can be done once; they pay Field Credits for the kind of careful work the
// economy is meant to reward (spec §22).
func boardContracts() []proto.QuestDef {
	return []proto.QuestDef{
		{
			ID: "contract_census", Name: "Contract: Valley Census", Category: CatResearch, Giver: BoardGiver,
			Summary:  "The research board wants five more species added to the record.",
			Story:    "Posted by the Creekside Field Lab: \"Wanted: confirmed identifications from any habitat. Five species. Probable records accepted and will be reviewed.\"",
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("species", KindIdentify, TargetAny, 5, "Identify five species you have not named before",
					"Try a habitat you have been walking past: the meadow, the creek, the pines, the deep shade."),
			},
			Rewards: proto.Reward{XP: 200, Credits: 140, Rep: map[string]int{FactionResearch: 20}},
		},
		{
			ID: "contract_drummer", Name: "Contract: The Drummer", Category: CatAcoustic, Giver: BoardGiver,
			Summary:  "A clean recording of a woodpecker is wanted for the sound archive.",
			Story:    "Posted by the Creekside Field Lab: \"Wanted: woodpecker, drum or call, two stars or better. Please analyse before submitting. Dead trees are your friend.\"",
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("tape", KindRecord, "great_spotted_woodpecker", 1, "Make a two-star recording of a woodpecker",
					"Listen for a sharp \"kick\" call or a short burst of drumming on dead wood, mostly in the morning. Get under the tree and aim up.",
					ParamMinStars, stars(2)),
				o("analyze", KindResearch, "analyze", 1, "Analyze a recording at the Research Desk",
					"At the cabin, open the Research Desk and analyze any recording you have made."),
			},
			Rewards: proto.Reward{
				XP: 180, Credits: 130,
				Rep:  map[string]int{FactionResearch: 20},
				Lore: []string{"why_woodpeckers_drum"},
			},
		},
		{
			ID: "contract_night_shift", Name: "Contract: Night Shift", Category: CatAcoustic, Giver: BoardGiver,
			Summary:  "The board wants to know whether the valley's owls are still calling.",
			Story:    "Posted by the Greenhollow Ranger Station: \"Wanted: the valley's owl, heard and recorded, any night. Coffee not supplied.\"",
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("hear", KindHear, "tawny_owl", 1, "Hear the valley's owl",
					"Rest at the cabin until night. Walk out among the oldest trees, stop, and give it time."),
				o("tape", KindRecord, "tawny_owl", 1, "Record it",
					"Owls call, pause, and call again from the same perch. Start the recorder in the pause."),
			},
			Rewards: proto.Reward{XP: 200, Credits: 150, Rep: map[string]int{FactionResearch: 15, FactionRangers: 10}},
		},
		{
			ID: "contract_feathers", Name: "Contract: Feather Reference", Category: CatExploration, Giver: BoardGiver,
			Summary:  "Three shed feathers are wanted for the lab's reference drawer.",
			Story:    "Posted by the Creekside Field Lab: \"Wanted: moulted feathers, three, from three different birds. Found, not plucked. They turn up off the trails, where birds preen and bathe.\"",
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("feathers", KindCollect, TargetKind+"feather", 3, "Collect three different feathers",
					"Leave the trail. Feathers lie where birds spend their time: under roosts, by water, at the edge of cover. They catch the light when you are close.",
					ParamDistinct, "true"),
			},
			Rewards: proto.Reward{
				XP: 180, Credits: 120,
				Rep:  map[string]int{FactionResearch: 15, FactionNaturalists: 10},
				Lore: []string{"reading_a_feather"},
			},
		},
		{
			ID: "contract_plates", Name: "Contract: Field Guide Plates", Category: CatPhotography, Giver: BoardGiver,
			Summary:  "Four publishable photographs are wanted, each of a different species.",
			Story:    "Posted by Finn's Field Supply on behalf of a publisher: \"Wanted: four species, three stars or better, bird clearly visible. No more photographs of the backs of ducks.\"",
			Requires: []string{TutorialQuest}, ReqRank: 2,
			Objectives: []proto.ObjectiveDef{
				o("plates", KindPhoto, TargetAny, 4, "Take three-star photographs of four different species",
					"Focus, framing, distance, light and a clear view all count. A bird in the open in early or late light is worth ten in the leaves.",
					ParamMinStars, stars(3), ParamDistinct, "true"),
				o("submit", KindResearch, "submit", 1, "Submit a photograph at the Research Desk",
					"At the cabin, open the Research Desk and submit one of them to the board.",
					ParamWhat, "photo"),
			},
			Rewards: proto.Reward{
				XP: 240, Credits: 200,
				Rep:   map[string]int{FactionResearch: 15, FactionOutfitters: 15},
				Items: []string{itemFilm},
			},
		},
		{
			ID: "contract_behaviour", Name: "Contract: What Birds Do", Category: CatResearch, Giver: BoardGiver,
			Summary:  "The board wants behaviour, not just names: feeding, preening, and something less ordinary.",
			Story:    "Posted by the Creekside Field Lab: \"A list of species tells us who is here. We should like to know what they are doing. Watch, and write it up.\"",
			Requires: []string{TutorialQuest}, ReqRank: 2,
			Objectives: []proto.ObjectiveDef{
				o("feeding", KindObserve, TargetAny, 1, "Watch a bird feeding",
					"Follow a foraging bird through your binoculars until it actually catches or swallows something.",
					ParamBehavior, "feeding"),
				o("preening", KindObserve, TargetAny, 1, "Watch a bird preening",
					"Settled birds preen. Sit down (X) near a favourite perch around midday and wait.",
					ParamBehavior, "preening"),
				o("unusual", KindObserve, TargetAny, 1, "Witness something less ordinary: bathing, courtship, nest-building, a dive or a hover",
					"Water's edge for bathing and diving, spring for nests and displays, open sky for hovering.",
					ParamBehavior, "bathing|social|nesting|diving|hovering"),
				o("study", KindResearch, "study", 1, "Study a documented species at the Research Desk",
					"A species is documented once you have identified it and hold a photo or recording of it. Study it at the cabin's Research Desk."),
			},
			Rewards: proto.Reward{XP: 260, Credits: 180, Rep: map[string]int{FactionResearch: 25}, Lore: []string{"reading_behaviour"}},
		},
	}
}
