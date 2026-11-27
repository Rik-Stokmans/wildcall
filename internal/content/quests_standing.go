package content

import "github.com/Rik-Stokmans/wildcall/internal/proto"

// Quests that open with standing rather than with the story (spec §7.2, §16.2):
//
//   - HarrowGlassQuest, revealed by owning Edith Harrow's binoculars (§10.3);
//   - one or two errands per faction gated on reputation with it (QuestDef.ReqRep);
//   - rank-gated "challenges" on the cabin board;
//   - the Master Naturalist's special expedition.
//
// Like every quest they are written against kinds, regions and the pinned home
// valley, and never name a bird the player is being sent to work out.

// HarrowGlassQuest is the hidden research quest the Historical Binoculars reveal.
const HarrowGlassQuest = "through_her_glass"

// HarrowGlassLore is the Natural History entry about the binoculars' first owner,
// unlocked when the player first owns them.
const HarrowGlassLore = "survey_no_one"

// upgradeUnlock is the Reward.Unlock entry that fits an item upgrade for free
// (progress.UnlockUpgrade: "upgrade:<item>:<upgrade>").
func upgradeUnlock(item, upgrade string) string { return "upgrade:" + item + ":" + upgrade }

func standingQuests() []proto.QuestDef {
	return []proto.QuestDef{
		{
			ID: HarrowGlassQuest, Name: "Through Her Glass", Category: CatResearch, Giver: NPCAlder,
			Summary:  "Edith Harrow's own binoculars have come back to the valley. Professor Alder wants her last field season seen again, through the same glass.",
			Story:    "The brass glasses were the only instrument Harrow ever used. Her final season's notes follow the creek out of the valley and into the reedbeds beyond, and Professor Alder would dearly like to know whether what she saw is still there to be seen.",
			ReqRank:  2,
			Hidden:   true,
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("blue", KindObserve, "common_kingfisher", 1, "Watch the blue flash she logged at the creek",
					"Her notes: \"Low over the water like a thrown stone, then still on a stick above the pool.\" Sit near slow water on the creek and watch the perches over it."),
				o("stalker", KindPhoto, "grey_heron", 1, "Photograph the grey hunter she sketched standing in the shallows (two stars or better)",
					"Tall, grey, and patient beyond all reason. It stands in shallow water for minutes at a time. Approach slowly and from the side.",
					ParamMinStars, stars(2)),
				o("marsh", KindIdentify, TargetAny, 2, "Identify two species in Murmur Marsh, as she did in her last season",
					"Her final pages are about the reedbeds beyond the valley. Listen first; the reeds hide nearly everything.",
					ParamRegion, "murmur_marsh"),
				o("submit", KindResearch, "submit", 1, "Submit a photo or recording at your Research Desk",
					"Her survey never reached the board. Yours can."),
			},
			Rewards: proto.Reward{
				XP: 350, Credits: 180,
				Rep:   map[string]int{FactionResearch: 35, FactionNaturalists: 15},
				Lore:  []string{"patient_watching"},
				Badge: "badge_her_glass",
			},
		},

		// --- Reputation errands, one per faction (and a second for Finn, whose
		// discount tiers at 60 and 120 need somewhere to come from).
		{
			ID: "the_long_watch", Name: "The Long Watch", Category: CatResearch, Giver: NPCMara,
			Summary:  "Mara trusts you with the kind of watching she does herself: hours of it, for a few seconds of real behaviour.",
			Story:    "Anyone can list the birds in a wood. Mara wants to know what they were doing: the bath at the water's edge, the squabble on a branch, the nest under construction. Sit down before the bird arrives and still be sitting when it leaves.",
			ReqRep:   map[string]int{FactionNaturalists: 60},
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("social", KindObserve, TargetAny, 1, "Watch birds interacting: courtship, a chase, flock chatter",
					"Spring is the time for displays and squabbles; winter flocks chatter all day.",
					ParamBehavior, "social"),
				o("bathing", KindObserve, TargetAny, 1, "Watch a bird bathing",
					"Shallow, still water at the edge of cover. Midday is bath time."),
				o("study", KindResearch, "study", 2, "Study documented species at your Research Desk twice",
					"The desk turns watching into knowledge. Once a day per species."),
			},
			Rewards: proto.Reward{
				XP: 320, Credits: 170,
				Rep:   map[string]int{FactionNaturalists: 30},
				Lore:  []string{"patient_watching"},
				Badge: "badge_long_watch",
			},
		},
		{
			ID: "field_test", Name: "Field Test", Category: CatPhotography, Giver: NPCFinn,
			Summary:  "Finn wants his kit proven in the field by someone who uses it properly.",
			Story:    "Finn says a catalogue full of promises is worth nothing; he wants work he can pin above the counter, taken by a customer, with the kit he sold them. A sharp photograph and a clean recording, both good enough to show.",
			ReqRep:   map[string]int{FactionOutfitters: 40},
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("plate", KindPhoto, TargetAny, 1, "Take a four-star photograph",
					"Fill the frame, let the focus settle, find the light, and keep the bird in the open.",
					ParamMinStars, stars(4)),
				o("tape", KindRecord, TargetAny, 1, "Make a three-star recording",
					"Close, quiet and on axis. A whole phrase, then a little more.",
					ParamMinStars, stars(3)),
			},
			Rewards: proto.Reward{
				XP: 260, Credits: 160,
				Rep:   map[string]int{FactionOutfitters: 30},
				Lore:  []string{"kit_that_lasts"},
				Badge: "badge_field_tested",
			},
		},
		{
			ID: "contract_catalogue", Name: "Contract: Finn's Catalogue", Category: CatPhotography, Giver: BoardGiver,
			Summary:  "Finn's Field Supply wants plates for next season's catalogue, from its best customer.",
			Story:    "Posted by Finn's Field Supply: \"Wanted: three different birds, four stars or better, for the catalogue. Credited to the photographer. Regular customers only, I'm afraid; I need to know the kit was mine.\"",
			ReqRep:   map[string]int{FactionOutfitters: 80},
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("plates", KindPhoto, TargetAny, 3, "Take four-star photographs of three different species",
					"Golden light, a clear view, and the bird large in the frame.",
					ParamMinStars, stars(4), ParamDistinct, "true"),
				o("submit", KindResearch, "submit", 1, "Submit a photograph at the Research Desk",
					"At the cabin, open the Research Desk and submit one of them to the board.",
					ParamWhat, "photo"),
			},
			Rewards: proto.Reward{XP: 280, Credits: 220, Rep: map[string]int{FactionOutfitters: 35}},
		},
		{
			ID: "contract_scarce", Name: "Contract: Scarce Records", Category: CatResearch, Giver: BoardGiver,
			Summary:  "The field lab wants a scarce bird properly documented, from a researcher it trusts.",
			Story:    "Posted by the Creekside Field Lab: \"Records of scarce species are only as good as the observer. We are therefore asking only those whose work we know. Wanted: one rare discovery of any kind, and one scarce species identified.\"",
			ReqRep:   map[string]int{FactionResearch: 100},
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("rare", KindRare, TargetAny, 1, "Log a rare discovery",
					"An odd plumage, a lost visitor, a rare behaviour, an exceptional photograph: the conditions matter more than the luck."),
				o("scarce", KindIdentify, TargetAny, 1, "Identify a scarce species",
					"Scarce birds keep strict hours and strict places. Read the old diary pages for the conditions.",
					ParamRarity, "rare|legendary"),
			},
			Rewards: proto.Reward{XP: 350, Credits: 240, Rep: map[string]int{FactionResearch: 30}},
		},
		{
			ID: "nest_survey", Name: "The Nest Survey", Category: CatConservation, Giver: NPCJune,
			Summary:  "June trusts you to record nests for the rangers' survey without disturbing a single one.",
			Story:    "The nest survey tells the rangers where to close a path in spring and where to leave the dead wood standing. June gives it only to people she has seen move quietly: watch the adults, note the nest from a distance, keep the visit short.",
			ReqRep:   map[string]int{FactionRangers: 80},
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("nests", KindObserve, TargetAny, 3, "Find three active nests of different species",
					"Follow a bird carrying food or nest material with your eyes, not your feet. Spring and early summer.",
					ParamBehavior, "nesting", ParamDistinct, "true"),
				o("report", KindTalk, NPCJune, 1, "Report to June at the ranger station", "She will want the details."),
			},
			Rewards: proto.Reward{
				XP: 300, Credits: 160,
				Rep:   map[string]int{FactionRangers: 30, FactionNaturalists: 10},
				Lore:  []string{"nest_etiquette"},
				Badge: "badge_nest_warden",
			},
		},

		// --- Rank challenges on the cabin board (spec §7.2: ranks unlock challenges).
		{
			ID: "challenge_twenty", Name: "Challenge: Twenty Species", Category: CatResearch, Giver: BoardGiver,
			Summary:  "A Naturalist's challenge: twenty species named in your own journal.",
			Story:    "Pinned to the board in Mara's handwriting: \"Twenty. Not seen, named. Every one of them earned.\"",
			ReqRank:  3,
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("species", KindIdentify, TargetAny, 20, "Have twenty species identified in your journal",
					"Every identification counts, old and new. New habitats and new hours of the day are where the rest are."),
			},
			Rewards: proto.Reward{XP: 400, Credits: 200, Rep: map[string]int{FactionNaturalists: 25, FactionResearch: 15}},
		},
		{
			ID: "challenge_six_countries", Name: "Challenge: Six Countries", Category: CatExploration, Giver: BoardGiver,
			Summary:  "A Field Specialist's challenge: a bird named in every kind of country.",
			Story:    "Pinned to the board by June: \"The valley, the marsh, the highlands, the coast, the amber woods and the white country. One bird in each, named by you.\"",
			ReqRank:  4,
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("wood", KindIdentify, TargetAny, 1, "Identify a species in Greenhollow Woods", "Earlier identifications count. The valley is where everyone starts.", ParamRegion, "greenhollow"),
				o("marsh", KindIdentify, TargetAny, 1, "Identify a species in Murmur Marsh", "Water birds on the open pools are the easiest start.", ParamRegion, "murmur_marsh"),
				o("peak", KindIdentify, TargetAny, 1, "Identify a species in the Windpeak Highlands", "Check every rock with a bird-shaped top, and listen from the lee of a crag.", ParamRegion, "windpeak"),
				o("coast", KindIdentify, TargetAny, 1, "Identify a species on the Whispering Coast", "Scan the ledges, the tideline and the water in turn.", ParamRegion, "whispering_coast"),
				o("amber", KindIdentify, TargetAny, 1, "Identify a species in Amberwood", "Wait beside the berry thickets; the flocks come to you.", ParamRegion, "amberwood"),
				o("frost", KindIdentify, TargetAny, 1, "Identify a species in Frostveil", "On snow, movement gives a bird away before colour does.", ParamRegion, "frostveil"),
			},
			Rewards: proto.Reward{XP: 500, Credits: 260, Rep: map[string]int{FactionRangers: 30}, Badge: "badge_six_countries"},
		},
		{
			ID: "challenge_master_plates", Name: "Challenge: Master Plates", Category: CatPhotography, Giver: BoardGiver,
			Summary:  "A Field Specialist's challenge: photographs good enough for a museum wall.",
			Story:    "Pinned to the board by Finn: \"One five-star plate, and four-star plates of five different birds. Then come and tell me my cameras are not good enough.\"",
			ReqRank:  4,
			Requires: []string{TutorialQuest},
			Objectives: []proto.ObjectiveDef{
				o("five", KindPhoto, TargetAny, 1, "Take a five-star photograph",
					"Everything at once: sharp, well framed, large in the frame, good light, nothing in the way.",
					ParamMinStars, stars(5)),
				o("plates", KindPhoto, TargetAny, 5, "Take four-star photographs of five different species", "A bird in the open, early or late light, large in the frame.",
					ParamMinStars, stars(4), ParamDistinct, "true"),
			},
			Rewards: proto.Reward{XP: 450, Credits: 260, Rep: map[string]int{FactionOutfitters: 25, FactionNaturalists: 15}},
		},

		// --- The Master Naturalist's special expedition (spec §7.2).
		{
			ID: "expedition_far_north", Name: "Expedition: The Far North", Category: CatExploration, Giver: NPCAlder,
			Summary:  "Professor Alder offers a Master Naturalist the expedition he never made himself: the far edge of the white country, in winter.",
			Story:    "Forty years ago an expedition was planned to the stations at the edge of the white country, to see what comes down from the north when the ice closes. It never left. Professor Alder still has the plan, and he would like it carried out by someone who can do it properly.",
			ReqRank:  5,
			Requires: []string{"white_on_white"},
			Objectives: []proto.ObjectiveDef{
				o("view", KindDiscover, TargetKind+"viewpoint", 1, "Reach a viewpoint in Frostveil",
					"Get high enough to see the whole plateau.", ParamRegion, "frostveil"),
				o("visitor", KindIdentify, TargetAny, 1, "Identify the white hunter that comes south in deepest winter",
					"Only in winter. It hunts by day over open snow, and it is very hard to see until it moves.",
					ParamRegion, "frostveil", ParamRarity, "legendary"),
				o("plate", KindPhoto, TargetAny, 1, "Take a four-star photograph in Frostveil",
					"Snow light is bright and flat. Get low and let the bird settle.", ParamRegion, "frostveil", ParamMinStars, stars(4)),
				o("record", KindRecord, TargetAny, 1, "Make a two-star recording in Frostveil",
					"The wind steals everything. Record from the lee of rock or a building.", ParamRegion, "frostveil", ParamMinStars, stars(2)),
			},
			Rewards: proto.Reward{
				XP: 700, Credits: 400,
				Rep:   map[string]int{FactionResearch: 50, FactionRangers: 25},
				Lore:  []string{"the_white_edge"},
				Badge: "badge_far_north",
			},
		},
	}
}
