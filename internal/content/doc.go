// Package content holds WILDCALL's authored content and the pure logic that runs it
// (spec §15–§18, §27; contract §3.5):
//
//   - Regions: the six region TYPES of the generated world and their ranger permits.
//   - NPCs and their dialogue (Talk / Choose), which returns data Actions for the
//     session to execute.
//   - Quests and research contracts, and the Tracker that advances them from Events.
//   - Collectibles (feathers, the Forgotten Field Journal pages, relics, badges),
//     cache loot, and the Natural History lore entries.
//   - Validate, which checks every reference against the real catalogs.
//
// Everything here is a pure function over *proto.Profile plus authored data: no
// clocks, no randomness, no I/O. The package depends only on internal/core and
// internal/proto.
//
// Two rules shape the writing. Discovery must be earned: quest text, hints and
// dialogue describe a voice or a habit, they never hand over the name of a bird the
// player is being sent to work out, and nothing in here marks a bird's position.
// And the game stays cozy: nothing can be failed, lost or timed out; a wrong turn
// costs a little time and nothing else.
package content

// Objective kinds: the pinned vocabulary documented on proto.ObjectiveDef. Event.Kind
// uses exactly the same words.
const (
	KindHear     = "hear"     // hear a call
	KindObserve  = "observe"  // watch a bird (or get close enough to investigate it)
	KindIdentify = "identify" // identify a species
	KindPhoto    = "photo"    // photograph a bird
	KindRecord   = "record"   // make an audio recording
	KindDiscover = "discover" // discover a point of interest
	KindCollect  = "collect"  // pick up a collectible or open a cache
	KindTalk     = "talk"     // talk to an NPC
	KindReturn   = "return"   // return to the cabin
	KindResearch = "research" // desk research: study | analyze | submit
	KindRare     = "rare"     // log a rare discovery
)

var objectiveKinds = []string{
	KindHear, KindObserve, KindIdentify, KindPhoto, KindRecord, KindDiscover,
	KindCollect, KindTalk, KindReturn, KindResearch, KindRare,
}

// ObjectiveKinds returns the objective / event kind vocabulary.
func ObjectiveKinds() []string { return append([]string(nil), objectiveKinds...) }

// Special objective targets.
const (
	TargetAny     = "any"     // any species / any rare discovery
	TargetUnknown = "unknown" // hear: a voice the player has not identified yet
	TargetKind    = "kind:"   // prefix: discover kind:<poi kind>, collect kind:<feather|page|relic|cache>
)

// Objective parameter keys. The first six are pinned by proto.ObjectiveDef; phase,
// distinct, species and what are this package's additions (see Event for what each
// one is matched against). A value may list alternatives separated by "|".
const (
	ParamBehavior = "behavior" // core.BirdAct key the bird must be showing
	ParamMinStars = "minStars" // minimum star rating of the photo / recording / submission
	ParamMethod   = "method"   // identify: sight | sound | photo | mixed
	ParamRegion   = "region"   // region key where it must happen
	ParamHabitat  = "habitat"  // habitat key where it must happen
	ParamRarity   = "rarity"   // identify: common | uncommon | rare | legendary
	ParamPhase    = "phase"    // day phase: dawn | morning | midday | afternoon | evening | night
	ParamDistinct = "distinct" // "true": each counted event must have a different target (species, place…)
	ParamSpecies  = "species"  // research: the species studied / analysed / submitted
	ParamWhat     = "what"     // research submit: photo | recording
)

// Event-only parameter keys (set by the constructors in events.go).
const (
	paramStars = "stars" // star rating carried by photo / record / research events
	paramKnown = "known" // hear: "true" if the player has already identified the species
	paramKind  = "kind"  // discover / collect: the POI or collectible kind
)

// Quest statuses (proto.QuestState.Status).
const (
	StatusAvailable = "available"
	StatusActive    = "active"
	StatusComplete  = "complete"
	StatusTurnedIn  = "turned_in"
)

// Quest categories (proto.QuestDef.Category, spec §15.1).
const (
	CatResearch     = "research"
	CatPhotography  = "photography"
	CatExploration  = "exploration"
	CatAcoustic     = "acoustic"
	CatConservation = "conservation"
)

var questCategories = []string{CatResearch, CatPhotography, CatExploration, CatAcoustic, CatConservation}

// QuestCategories returns the five quest categories in display order.
func QuestCategories() []string { return append([]string(nil), questCategories...) }

// BoardGiver is the Giver of cabin research contracts: they are accepted and turned
// in at the Research Desk board, not through an NPC.
const BoardGiver = "board"

// NPC ids and reputation factions (pinned by the contract).
const (
	NPCMara  = "mara"
	NPCFinn  = "finn"
	NPCAlder = "alder"
	NPCJune  = "june"

	FactionNaturalists = "naturalists"
	FactionOutfitters  = "outfitters"
	FactionResearch    = "research"
	FactionRangers     = "rangers"
)

var factions = []string{FactionNaturalists, FactionOutfitters, FactionResearch, FactionRangers}

// Item ids this package hands out. All are pinned by contract §3.4.
const (
	itemRecorder = "basic_recorder"
	itemFilm     = "film_roll"
	itemSeed     = "seed_mix"
	itemLens     = "explorers_lens"
	itemCompass  = "naturalists_compass"
	itemBackpack = "research_backpack"
	itemJournal  = "forgotten_journal"
	itemGlasses  = "historical_binoculars"
	itemVintage  = "vintage_recorder"
	itemExplorer = "explorer_binoculars"
)

// The tutorial's mystery singer.
const tutorialSpecies = "eurasian_wren"

// rankTitles are the spec §7.2 titles; index = rank.
var rankTitles = [...]string{"Beginner", "Beginner", "Observer", "Naturalist", "Field Specialist", "Master Naturalist"}

// RankTitle returns the spec title for a naturalist rank (clamped to 1..5).
func RankTitle(rank int) string {
	if rank < 1 {
		rank = 1
	}
	if rank > 5 {
		rank = 5
	}
	return rankTitles[rank]
}

func oneOf(v string, set ...string) bool {
	for _, s := range set {
		if s == v {
			return true
		}
	}
	return false
}
