// Package proto is the wire contract between the Go server and the browser client:
// static content definitions (sent once in the welcome message), the player profile,
// and every message in both directions. JSON field names here ARE the protocol; the
// client reads them verbatim. See docs/contract.md for semantics.
package proto

import "github.com/Rik-Stokmans/wildcall/internal/core"

// Version is bumped whenever the wire format changes incompatibly.
const Version = "0.1.0"

// ---------------------------------------------------------------------------
// Static content definitions

// RegionInfo describes a region for the map, the region-discovery screen and gating.
type RegionInfo struct {
	ID       int      `json:"id"`  // core.RegionID
	Key      string   `json:"key"` // core.RegionID.Key()
	Name     string   `json:"name"`
	Tagline  string   `json:"tagline"`
	Desc     string   `json:"desc"`
	Habitats []string `json:"habitats"` // player-facing habitat names
	Emphasis []string `json:"emphasis"` // gameplay emphasis lines (spec §17.2)
	ReqRank  int      `json:"reqRank"`  // naturalist rank needed to enter (1 = open from the start)
	ReqQuest string   `json:"reqQuest"` // quest that must be turned in ("" = none)
	Color    string   `json:"color"`    // map tint "#rrggbb"
}

// RankDef is a naturalist rank (spec §7.2). Ranks are milestone-based.
type RankDef struct {
	Index       int      `json:"index"` // 1..5
	Title       string   `json:"title"` // Beginner, Observer, Naturalist, Field Specialist, Master Naturalist
	Desc        string   `json:"desc"`
	ReqLevel    int      `json:"reqLevel"`
	ReqSpecies  int      `json:"reqSpecies"`  // species identified
	ReqDocs     int      `json:"reqDocs"`     // species documented (discovery level >= 5)
	ReqRep      int      `json:"reqRep"`      // total reputation
	ReqQuest    string   `json:"reqQuest"`    // milestone quest ("" = none)
	Unlocks     []string `json:"unlocks"`     // player-facing unlock lines
	SkillPoints int      `json:"skillPoints"` // bonus skill points on reaching the rank
}

// DisciplineDef is one of the five skill disciplines (spec §8).
type DisciplineDef struct {
	ID    string `json:"id"`    // acoustics|observation|photography|knowledge|fieldcraft
	Name  string `json:"name"`  // "Acoustics"
	Title string `json:"title"` // "The Listener"
	Desc  string `json:"desc"`
	Color string `json:"color"`
	Icon  string `json:"icon"`
}

// TierReq is the requirement to buy skills of a tier (spec §8.1).
type TierReq struct {
	Tier   int    `json:"tier"`   // 1..4
	Points int    `json:"points"` // points already invested in the discipline
	Rank   int    `json:"rank"`   // minimum naturalist rank (tier IV specialization)
	Label  string `json:"label"`  // "Tier II — Intermediate"
}

// SkillDef is one skill node.
type SkillDef struct {
	ID         string             `json:"id"`
	Name       string             `json:"name"`
	Desc       string             `json:"desc"`   // the spec's one-line description
	Effect     string             `json:"effect"` // concrete effect per rank, player-facing
	Discipline string             `json:"discipline"`
	Tier       int                `json:"tier"`    // 1..4
	MaxRank    int                `json:"maxRank"` // times it can be bought
	Cost       int                `json:"cost"`    // skill points per rank
	Mods       map[string]float32 `json:"mods"`    // per rank, additive, keys = core.Stats JSON names
	Icon       string             `json:"icon"`
}

// Item rarity (spec §10.1).
const (
	RarityCommon = iota
	RarityUncommon
	RarityRare
	RarityEpic
	RarityLegendary
)

// ItemDef is anything that can sit in the inventory.
type ItemDef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Desc string `json:"desc"`
	// Kind: equipment (goes in a slot) | gadget (works passively while carried) |
	// supply (consumable, stackable) | keepsake (story item, may grant effects while owned)
	Kind string `json:"kind"`
	// Slot (equipment only): optics|camera|audio|backpack|navigation|clothing
	Slot   string `json:"slot"`
	Tier   int    `json:"tier"`   // 1 Basic, 2 Explorer, 3 Specialist, 4 Unique
	Rarity int    `json:"rarity"` // 0..4
	Price  int    `json:"price"`  // Field Credits; 0 = not sold
	// ReqRank / ReqRep gate purchase.
	ReqRank int                `json:"reqRank"`
	ReqRep  int                `json:"reqRep"`
	Mods    map[string]float32 `json:"mods"` // additive stat modifiers; negatives are tradeoffs
	Pros    []string           `json:"pros"` // player-facing advantages
	Cons    []string           `json:"cons"` // player-facing disadvantages
	// History and Special are shown on the Rare Item Presentation screen.
	History  string       `json:"history"`
	Special  string       `json:"special"`
	Upgrades []UpgradeDef `json:"upgrades"`
	Stack    int          `json:"stack"`  // max stack size (supplies); 0 = not stackable
	Use      string       `json:"use"`    // supply action: "film" | "seed" | ""
	Source   string       `json:"source"` // start|shop|quest|loot|research
	Icon     string       `json:"icon"`   // icon key (see docs/contract.md §Icons)
}

// UpgradeDef is a purchasable improvement to a specific item.
type UpgradeDef struct {
	ID       string             `json:"id"`
	Name     string             `json:"name"`
	Desc     string             `json:"desc"`
	Price    int                `json:"price"`
	ReqRank  int                `json:"reqRank"`
	ReqCabin string             `json:"reqCabin"` // cabin upgrade needed ("" = none), e.g. "workshop"
	Mods     map[string]float32 `json:"mods"`
}

// CabinUpgradeDef is a home-base improvement (spec §21.2).
type CabinUpgradeDef struct {
	ID      string             `json:"id"` // audio_lab|photo_wall|workshop|map_room|garden
	Name    string             `json:"name"`
	Desc    string             `json:"desc"`
	Effect  string             `json:"effect"` // player-facing effect
	Price   int                `json:"price"`
	ReqRank int                `json:"reqRank"`
	Mods    map[string]float32 `json:"mods"`
	Icon    string             `json:"icon"`
}

// NPCDef is a non-player character (spec §16).
type NPCDef struct {
	ID      string  `json:"id"` // mara|finn|alder|june
	Name    string  `json:"name"`
	Role    string  `json:"role"`    // "Veteran Naturalist"
	Faction string  `json:"faction"` // reputation track: naturalists|outfitters|research|rangers
	POI     string  `json:"poi"`     // POI id where they stand
	Bio     string  `json:"bio"`
	Look    NPCLook `json:"look"`
}

// NPCLook drives the stylised procedural NPC model.
type NPCLook struct {
	Skin   string  `json:"skin"`
	Hair   string  `json:"hair"`
	Coat   string  `json:"coat"`
	Trim   string  `json:"trim"`
	Hat    string  `json:"hat"`    // none|brim|beanie|ranger|cap
	Prop   string  `json:"prop"`   // none|binoculars|clipboard|toolbelt|staff
	Height float32 `json:"height"` // metres
	Build  float32 `json:"build"`  // 0.8 slim … 1.3 stout
}

// QuestDef is a quest or a cabin research contract (spec §15).
type QuestDef struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Category   string         `json:"category"` // research|photography|exploration|acoustic|conservation
	Giver      string         `json:"giver"`    // NPC id, or "board" for cabin research contracts
	Summary    string         `json:"summary"`
	Story      string         `json:"story"`
	Objectives []ObjectiveDef `json:"objectives"`
	Ordered    bool           `json:"ordered"` // objectives must be completed in order
	Rewards    Reward         `json:"rewards"`
	Requires   []string       `json:"requires"` // quests that must be turned in first
	ReqRank    int            `json:"reqRank"`
	Hidden     bool           `json:"hidden"`   // not listed until discovered (e.g. found via a journal page)
	Tutorial   bool           `json:"tutorial"` // the primary tutorial quest
	AutoStart  bool           `json:"autoStart"`
}

// ObjectiveDef is one quest step. Kind vocabulary (pinned; see docs/contract.md §Quest events):
//
//	hear          hear a call            Target: species id | "unknown" | "any"
//	observe       watch a bird           Target: species id | "any"; Params: behavior
//	identify      identify a species     Target: species id | "any"; Params: method=sound|sight, region, habitat, rarity
//	photo         photograph             Target: species id | "any"; Params: behavior, minStars, region
//	record        audio recording        Target: species id | "any"; Params: minStars
//	discover      discover a POI         Target: poi id | kind:<poi kind>
//	collect       pick up a collectible  Target: collectible id | kind:<kind>
//	talk          talk to an NPC         Target: npc id
//	return        return to the cabin    Target: ""
//	research      desk research          Target: "study" | "analyze" | "submit"
//	rare          log a rare discovery   Target: rare kind | "any"
type ObjectiveDef struct {
	ID     string            `json:"id"`
	Text   string            `json:"text"`
	Kind   string            `json:"kind"`
	Target string            `json:"target"`
	Count  int               `json:"count"`
	Params map[string]string `json:"params,omitempty"`
	Hint   string            `json:"hint"` // optional gentle hint shown in the quest log
}

// Reward is what a quest, contract or discovery pays out.
type Reward struct {
	XP          int            `json:"xp"`
	Credits     int            `json:"credits"`
	Rep         map[string]int `json:"rep,omitempty"` // faction → points
	Items       []string       `json:"items,omitempty"`
	SkillPoints int            `json:"skillPoints"`
	Unlock      []string       `json:"unlock,omitempty"` // "region:<key>" | "quest:<id>" | "feature:<key>"
	Lore        []string       `json:"lore,omitempty"`   // natural-history entries
	Badge       string         `json:"badge"`
}

// CollectibleDef is a findable keepsake (spec §3.1, §28 screen 20).
type CollectibleDef struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"` // feather|page|relic|badge
	Set    string `json:"set"`  // collection set name, e.g. "Greenhollow Feathers"
	Name   string `json:"name"`
	Desc   string `json:"desc"`
	Text   string `json:"text"`   // lore / page text
	Rarity int    `json:"rarity"` // 0..4
	POI    string `json:"poi"`    // POI id where it lies ("" = awarded, e.g. badges)
	Icon   string `json:"icon"`
}

// LoreDef is a Natural History journal entry.
type LoreDef struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Category string `json:"category"` // ecology|history|fieldcraft|species
	Text     string `json:"text"`
}

// DialogNode is one beat of NPC conversation.
type DialogNode struct {
	NPC     string         `json:"npc"`
	Name    string         `json:"name"`
	Role    string         `json:"role"`
	Lines   []string       `json:"lines"`
	Choices []DialogChoice `json:"choices"`
	Quest   string         `json:"quest"`   // quest being offered / discussed ("" = none)
	Rewards *Reward        `json:"rewards"` // shown when turning in
	Rep     int            `json:"rep"`     // player's reputation with this NPC's faction
}

// DialogChoice kinds: next (continue) | accept | decline | turnin | shop | ask | bye
type DialogChoice struct {
	ID   string `json:"id"`
	Text string `json:"text"`
	Kind string `json:"kind"`
}

// ---------------------------------------------------------------------------
// Player profile (persisted in the save file; a client view is sent on every change)

type Profile struct {
	Name        string              `json:"name"`
	Level       int                 `json:"level"`
	XP          int                 `json:"xp"`     // XP into the current level
	XPNext      int                 `json:"xpNext"` // XP needed for the next level
	XPTotal     int                 `json:"xpTotal"`
	Rank        int                 `json:"rank"` // 1..5
	SkillPoints int                 `json:"skillPoints"`
	Skills      map[string]int      `json:"skills"` // skill id → rank
	Credits     int                 `json:"credits"`
	Rep         map[string]int      `json:"rep"`       // faction → reputation
	Inventory   []ItemStack         `json:"inventory"` // carried, limited by Stats.Capacity (equipped items do not count)
	Storage     []ItemStack         `json:"storage"`   // cabin storage, unlimited
	Equipped    map[string]string   `json:"equipped"`  // slot → item id (equipped items live here, not in Inventory)
	Upgrades    map[string][]string `json:"upgrades"`  // item id → purchased upgrade ids
	Cabin       []string            `json:"cabin"`     // cabin upgrade ids owned
	Regions     []int               `json:"regions"`   // unlocked region ids
	// Explored is the sparse fog of war. Key "tx,tz" is a map tile (512 m); the value
	// is 32 bytes = 256 bits, one per 32 m cell, bit index = cz*16 + cx within the
	// tile (cell (cx,cz) covers x in [tx*512 + cx*32, +32), likewise z), bit i lives
	// in byte i/8 at mask 1<<(i%8). Base64 in JSON. A missing tile is unexplored.
	Explored map[string][]byte      `json:"explored"`
	Trails   []string               `json:"trails"` // hidden trail ids revealed
	Journal  Journal                `json:"journal"`
	Quests   map[string]*QuestState `json:"quests"`
	Flags    map[string]bool        `json:"flags"` // tutorial steps, features, npc met…
	Stats    core.Stats             `json:"stats"` // derived; recomputed by progress
	Film     Film                   `json:"film"`
	Totals   Totals                 `json:"totals"`
	XPLog    map[string]int         `json:"xpLog"` // diminishing-returns counters, key "<source>:<species>"
	Pos      core.Vec3              `json:"pos"`
	Yaw      float32                `json:"yaw"`
}

type ItemStack struct {
	Item string `json:"item"`
	Qty  int    `json:"qty"`
}

type Film struct {
	Used int `json:"used"`
	Cap  int `json:"cap"`
}

type Totals struct {
	Photos     int     `json:"photos"`
	Recordings int     `json:"recordings"`
	Distance   float32 `json:"distance"` // metres walked
	Seconds    float32 `json:"seconds"`  // play time
	Flushed    int     `json:"flushed"`  // birds scared off
}

// Discovery levels (spec §14.3).
const (
	LevelUnknown     = 1
	LevelHeard       = 2
	LevelEncountered = 3
	LevelIdentified  = 4
	LevelDocumented  = 5
	LevelStudied     = 6
)

type Journal struct {
	Species      map[string]*SpeciesEntry `json:"species"`   // identified species, by species id
	Mysteries    []*Mystery               `json:"mysteries"` // heard / encountered but unidentified
	Photos       []*PhotoMeta             `json:"photos"`
	Recordings   []*RecMeta               `json:"recordings"`
	Observations []*Observation           `json:"observations"`
	Locations    map[string]*LocEntry     `json:"locations"` // discovered POIs, by POI id
	Lore         []string                 `json:"lore"`      // natural-history entry ids unlocked
	Rare         []*RareDiscovery         `json:"rare"`
	Collectibles map[string]int           `json:"collectibles"` // collectible id → day found
	Pinned       []string                 `json:"pinned"`       // photo ids on the photography wall
	Badges       []string                 `json:"badges"`
}

// SpeciesEntry is the player's personal record of an identified species.
type SpeciesEntry struct {
	ID          string            `json:"id"`
	Level       int               `json:"level"`      // 4 identified, 5 documented, 6 studied
	Probable    bool              `json:"probable"`   // identified as "probable", not yet confirmed
	Confidence  int               `json:"confidence"` // % evidence confidence at the time of identification
	Method      string            `json:"method"`     // sight|sound|photo|mixed
	Evidence    map[string]string `json:"evidence"`
	FirstDay    int               `json:"firstDay"`
	FirstRegion int               `json:"firstRegion"`
	FirstPlace  string            `json:"firstPlace"` // nearest discovered location name
	Seen        int               `json:"seen"`
	Heard       int               `json:"heard"`
	PhotoCount  int               `json:"photoCount"`
	RecCount    int               `json:"recCount"`
	BestPhoto   string            `json:"bestPhoto"`
	BestRec     string            `json:"bestRec"`
	Behaviors   []string          `json:"behaviors"` // behaviour keys observed
	Habitats    []string          `json:"habitats"`  // habitat keys where encountered
	Regions     []int             `json:"regions"`
	Phases      [6]int            `json:"phases"` // encounters per day phase: the player's own activity pattern data
	Study       int               `json:"study"`  // 0..100 research progress toward "Studied"
	Notes       string            `json:"notes"`  // personal notes
}

// Mystery is a bird the player has heard or seen but not identified.
type Mystery struct {
	ID         string            `json:"id"`    // "m1", "m2"…
	Label      string            `json:"label"` // "Unknown bird A"
	Level      int               `json:"level"` // 2 heard, 3 encountered
	Evidence   map[string]string `json:"evidence"`
	Heard      int               `json:"heard"`
	Seen       int               `json:"seen"`
	Photos     []string          `json:"photos"`
	Recs       []string          `json:"recs"`
	Wrong      []string          `json:"wrong"` // species ids ruled out by a wrong guess
	FirstDay   int               `json:"firstDay"`
	Region     int               `json:"region"`
	Pos        core.Vec3         `json:"pos"` // where it was last noticed
	Candidates []Candidate       `json:"candidates"`
	// Species is the true species id. Persisted in the save file but ALWAYS blanked
	// in the view sent to the client.
	Species string `json:"species,omitempty"`
}

// Candidate is one entry in the identification confidence table (spec §13.1).
type Candidate struct {
	Species    string `json:"species"`
	Confidence int    `json:"confidence"` // percent; candidates sum to ~100
}

type PhotoMeta struct {
	ID       string         `json:"id"`
	URL      string         `json:"url"` // "/photos/<id>.jpg"
	Day      int            `json:"day"`
	Time     float32        `json:"time"`
	Region   int            `json:"region"`
	Weather  int            `json:"weather"`
	Subjects []PhotoSubject `json:"subjects"`
	// Sub-scores 0..100 (spec §13.2) and the total.
	Focus       int      `json:"focus"`
	Composition int      `json:"composition"`
	Distance    int      `json:"distance"`
	Lighting    int      `json:"lighting"`
	Visibility  int      `json:"visibility"`
	Score       int      `json:"score"` // 0..100
	Stars       int      `json:"stars"` // 0 (no subject) .. 5
	Tags        []string `json:"tags"`  // "behavior:feeding", "golden hour", "rare", "exceptional"
	Submitted   bool     `json:"submitted"`
}

type PhotoSubject struct {
	Species  string  `json:"species"`  // species id if the player has identified it, else ""
	Mystery  string  `json:"mystery"`  // mystery id otherwise
	Behavior string  `json:"behavior"` // BirdAct key
	Dist     float32 `json:"dist"`
	Size     float32 `json:"size"` // fraction of frame height
}

type RecMeta struct {
	ID        string  `json:"id"`
	Day       int     `json:"day"`
	Time      float32 `json:"time"`
	Region    int     `json:"region"`
	Species   string  `json:"species"` // species id if identified, else ""
	Mystery   string  `json:"mystery"`
	SpIndex   int     `json:"spIndex"` // species index for playback synthesis (client must not display it)
	Call      int     `json:"call"`    // index into Species.Calls
	Dur       float32 `json:"dur"`
	Dist      float32 `json:"dist"`
	Noise     float32 `json:"noise"` // 0..1 background noise in the recording
	Quality   int     `json:"quality"`
	Stars     int     `json:"stars"`
	Analyzed  bool    `json:"analyzed"`
	Submitted bool    `json:"submitted"`
}

// Observation is a written field observation (spec §13.2 "Observation").
type Observation struct {
	ID       string  `json:"id"`
	Day      int     `json:"day"`
	Time     float32 `json:"time"`
	Species  string  `json:"species"` // species id, or ""
	Mystery  string  `json:"mystery"`
	Behavior string  `json:"behavior"`
	Habitat  string  `json:"habitat"`
	Weather  int     `json:"weather"`
	Region   int     `json:"region"`
	Text     string  `json:"text"`
	Auto     bool    `json:"auto"` // generated by the game (vs. typed by the player)
}

// LocEntry is a discovered place. It copies what the journal and map need so they
// work even when the POI itself is far away and not loaded.
type LocEntry struct {
	Day    int       `json:"day"`
	Time   float32   `json:"time"`
	Name   string    `json:"name"`
	Kind   string    `json:"kind"`
	Region int       `json:"region"`
	Pos    core.Vec3 `json:"pos"`
	Hidden bool      `json:"hidden"`
}

// RareDiscovery kinds: rare_species|unusual_plumage|out_of_range|behavior|exceptional_photo|migration|hidden_habitat|relic
type RareDiscovery struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	Text    string `json:"text"`
	Day     int    `json:"day"`
	Species string `json:"species"`
	Photo   string `json:"photo"`
	Rarity  int    `json:"rarity"` // 1 uncommon .. 4 legendary
}

// QuestState.Status: available|active|complete|turned_in
type QuestState struct {
	Status   string         `json:"status"`
	Progress map[string]int `json:"progress"` // objective id → count
	Tracked  bool           `json:"tracked"`
	Day      int            `json:"day"`
}
