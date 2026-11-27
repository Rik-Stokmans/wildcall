package proto

import (
	"encoding/json"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Every JSON message in either direction is an envelope {"t": <type>, "d": <payload>}.
// Binary WebSocket frames are terrain chunks (docs/contract.md §Chunk).
type Envelope struct {
	T string          `json:"t"`
	D json.RawMessage `json:"d,omitempty"`
}

// Encode builds an envelope for a payload.
func Encode(t string, payload any) ([]byte, error) {
	d, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Envelope{T: t, D: d})
}

// Out is a message queued for the client.
type Out struct {
	T string
	D any
}

// ===========================================================================
// Client → Server

const (
	CHello        = "hello"        // Hello
	CPose         = "pose"         // Pose (10 Hz)
	CChunkReq     = "chunkReq"     // ChunkReq
	CPhoto        = "photo"        // Photo
	CRecStart     = "recStart"     // {}
	CRecStop      = "recStop"      // {}
	CIdentify     = "identify"     // Identify
	CInteract     = "interact"     // Interact
	CDialogChoice = "dialogChoice" // DialogChoiceMsg
	CQuest        = "quest"        // QuestAction
	CBuy          = "buy"          // ItemAction
	CUpgrade      = "upgrade"      // ItemAction (Upgrade set)
	CEquip        = "equip"        // ItemAction
	CUnequip      = "unequip"      // SlotAction
	CMove         = "move"         // MoveItem
	CUse          = "use"          // ItemAction
	CSkill        = "skill"        // SkillAction
	CCabin        = "cabin"        // CabinAction
	CNote         = "note"         // NoteMsg
	CForage       = "forage"       // ForageMsg: pick from a forage plant
	CCook         = "cook"         // CookMsg: prepare a recipe at a kettle or stove
	CPlace        = "place"        // PlaceItem: move a stack to a cell of the backpack or storage grid
	CTidy         = "tidy"         // TidyMsg: let the game re-pack a grid neatly
	CDebug        = "debug"        // DebugMsg (only honoured when the server runs with -dev)
)

type Hello struct {
	Name    string `json:"name"`
	NewGame bool   `json:"newGame"` // true = discard the save and start a new adventure
	// Seed for a new adventure: any text (hashed) or number; "" = a random world.
	Seed string `json:"seed"`
}

// Pose is the player's state, sent ~10 times a second.
type Pose struct {
	X     float32 `json:"x"` // eye position
	Y     float32 `json:"y"`
	Z     float32 `json:"z"`
	Yaw   float32 `json:"yaw"`   // compass heading rad
	Pitch float32 `json:"pitch"` // rad, + up
	Speed float32 `json:"speed"` // m/s horizontal
	// Move: still|crouch|crawl|walk|run|sprint
	Move   string `json:"move"`
	Crouch bool   `json:"crouch"`
	Sit    bool   `json:"sit"`   // sitting down to wait
	Prone  bool   `json:"prone"` // lying flat: crawling or still (eye ~0.35 m)
	Focus  bool   `json:"focus"` // focused-listening mode held
	// Tool: none|binoculars|camera|recorder   Raised: tool is up at the eye / aimed
	Tool   string  `json:"tool"`
	Raised bool    `json:"raised"`
	FOV    float32 `json:"fov"`   // current vertical field of view in degrees (after zoom)
	Zoom   float32 `json:"zoom"`  // current magnification factor (1 = naked eye)
	Sharp  float32 `json:"sharp"` // 0..1 current optical focus sharpness
	Noise  float32 `json:"noise"` // 0..1 transient noise the player just made (jump landing…)
}

type ChunkReq struct {
	CX  int `json:"cx"`
	CZ  int `json:"cz"`
	LOD int `json:"lod"`
}

// Photo is a shutter press. The server scores it from the pose it carries and the
// world state; Img is a JPEG data URL (≤ 640 px wide) kept as the player's photo.
type Photo struct {
	X      float32 `json:"x"`
	Y      float32 `json:"y"`
	Z      float32 `json:"z"`
	Yaw    float32 `json:"yaw"`
	Pitch  float32 `json:"pitch"`
	FOV    float32 `json:"fov"`    // vertical FOV degrees
	Aspect float32 `json:"aspect"` // width / height
	Sharp  float32 `json:"sharp"`  // 0..1 focus sharpness at the moment of capture
	Shake  float32 `json:"shake"`  // 0..1 camera shake at the moment of capture
	Img    string  `json:"img"`
}

// Identify submits an identification for a mystery (spec §13).
type Identify struct {
	Mystery string `json:"mystery"`
	Species string `json:"species"`
}

type Interact struct {
	POI string `json:"poi"`
}

type DialogChoiceMsg struct {
	NPC    string `json:"npc"`
	Choice string `json:"choice"`
}

// QuestAction.Action: accept|turnin|track|untrack|abandon
type QuestAction struct {
	ID     string `json:"id"`
	Action string `json:"action"`
}

type ItemAction struct {
	Item    string `json:"item"`
	Upgrade string `json:"upgrade,omitempty"`
}

type SlotAction struct {
	Slot string `json:"slot"`
}

// MoveItem moves a stack between the backpack and cabin storage. To: storage|inventory
type MoveItem struct {
	Item string `json:"item"`
	To   string `json:"to"`
}

type SkillAction struct {
	ID string `json:"id"`
}

// CabinAction.Action (only valid while at the cabin):
//
//	upgrade  buy a cabin upgrade            ID = cabin upgrade id
//	rest     rest until an hour of day      Until = hour 0..24
//	pin      pin a photo to the wall        ID = photo id
//	unpin    remove a photo from the wall   ID = photo id
//	study    desk research on a species     ID = species id
//	analyze  analyze a recording            ID = recording id
//	submit   submit a photo or recording to the research board   ID = photo/recording id
//	develop  review the expedition's film (resets Film.Used)
type CabinAction struct {
	Action string  `json:"action"`
	ID     string  `json:"id,omitempty"`
	Until  float32 `json:"until,omitempty"`
}

// NoteMsg writes a personal note. Species != "" sets that species entry's notes;
// otherwise a free-form Observation is added to the journal.
type NoteMsg struct {
	Species string `json:"species"`
	Mystery string `json:"mystery"`
	Text    string `json:"text"`
}

// ForageMsg picks from a forage plant. ID is "fg@<cx>,<cz>,<n>": n is the index of the
// plant's record in the vegetation list of chunk (cx, cz) at LOD 0.
type ForageMsg struct {
	ID string `json:"id"`
}

// CookMsg prepares a recipe Qty times. Valid within 25 m of the cabin (kettle and
// stove) or within 12 m of a camp POI (kettle only).
type CookMsg struct {
	Recipe string `json:"recipe"`
	Qty    int    `json:"qty"`
}

// PlaceItem moves the stack whose top-left cell is (FX, FY) in grid From to cell (X, Y)
// of grid To, optionally turned (R). From/To: inventory | storage (storage only at the
// cabin). Dropping onto a stack of the same item merges as far as the stack limit
// allows; any other overlap or an out-of-bounds placement is refused with an error and
// nothing changes.
type PlaceItem struct {
	From string `json:"from"`
	FX   int    `json:"fx"`
	FY   int    `json:"fy"`
	To   string `json:"to"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
	R    bool   `json:"r"`
}

// TidyMsg re-packs a grid (Where: inventory | storage): merges stacks and arranges
// items compactly, largest first.
type TidyMsg struct {
	Where string `json:"where"`
}

// DebugMsg.Cmd: xp|credits|time|weather|season|tp|unlock|give|identify|skillpoints|rank|spawn|rep|
// forage|nest|buff|seed (see internal/game/debug.go for arguments)
type DebugMsg struct {
	Cmd  string   `json:"cmd"`
	Args []string `json:"args"`
}

// ===========================================================================
// Server → Client

const (
	SWelcome  = "welcome"  // Welcome
	SEnv      = "env"      // EnvMsg (1 Hz)
	SBirds    = "birds"    // BirdsMsg (10 Hz)
	SCall     = "call"     // CallMsg
	SClue     = "clue"     // Clue
	SCue      = "cue"      // MoveCue
	SSighting = "sighting" // Sighting
	SProfile  = "profile"  // Profile (client view)
	SToast    = "toast"    // Toast
	SRewards  = "rewards"  // RewardsMsg
	SRareItem = "rareItem" // RareItemMsg
	SRegion   = "region"   // RegionMsg
	SRankUp   = "rankUp"   // RankUpMsg
	SPhoto    = "photoResult"
	SRec      = "recResult"
	SRecState = "recState" // RecState (while recording, 4 Hz)
	SIdentify = "identifyResult"
	SDialog   = "dialog"   // DialogNode
	SBase     = "base"     // BaseMsg: open the home-base screen
	STeleport = "teleport" // Teleport
	SLure     = "lure"     // LureMsg: seed placed / expired
	SPois     = "pois"     // PoisMsg: points of interest and trails that came into range
	SNarrate  = "narrate"  // Narration: a line from the narrator
	SNests    = "nests"    // NestsMsg: nests near the player (1 Hz, full list within range)
	SForaged  = "foraged"  // ForagedMsg: result of a pick
	SError    = "error"    // ErrorMsg
	SFlight   = "flight"   // FlightMsg: a flushed bird took off / landed at its refuge
)

type Welcome struct {
	Version      string            `json:"version"`
	Seed         int64             `json:"seed"`
	Dev          bool              `json:"dev"`
	HasSave      bool              `json:"hasSave"` // an existing adventure was loaded
	World        WorldInfo         `json:"world"`
	Regions      []RegionInfo      `json:"regions"`
	Species      []core.Species    `json:"species"`
	Ranks        []RankDef         `json:"ranks"`
	Disciplines  []DisciplineDef   `json:"disciplines"`
	SkillTiers   []TierReq         `json:"skillTiers"`
	Skills       []SkillDef        `json:"skills"`
	Items        []ItemDef         `json:"items"`
	CabinUps     []CabinUpgradeDef `json:"cabinUpgrades"`
	NPCs         []NPCDef          `json:"npcs"`
	Quests       []QuestDef        `json:"quests"`
	Collectibles []CollectibleDef  `json:"collectibles"`
	Lore         []LoreDef         `json:"lore"`
	Plants       []PlantDef        `json:"plants"`
	Recipes      []RecipeDef       `json:"recipes"`
	Trees        []TreeModel       `json:"trees"`
	// MarginNotes are the previous naturalist's notes on species (species id → note),
	// shown in the journal while the player carries the Forgotten Field Journal.
	MarginNotes map[string]string `json:"marginNotes"`
	POIs        []core.POI        `json:"pois"`   // home-valley POIs + those near the player now
	Trails      []core.Trail      `json:"trails"` // likewise
	Shop        []string          `json:"shop"`   // item ids Finn sells
	Profile     Profile           `json:"profile"`
	Env         EnvMsg            `json:"env"`
	Spawn       Teleport          `json:"spawn"`
}

// WorldInfo describes the generated world. It is unbounded: there is no size.
type WorldInfo struct {
	Seed        int64     `json:"seed"`
	SeedText    string    `json:"seedText"`    // what the player typed, or the number as text
	ChunkSize   int       `json:"chunkSize"`   // 64 m
	SeaLevel    float32   `json:"seaLevel"`    // 0
	MapTileSize int       `json:"mapTileSize"` // 512 m per map tile
	MapTilePx   int       `json:"mapTilePx"`   // 128 px per tile
	MapURL      string    `json:"mapUrl"`      // "/map/{tx}/{tz}.png" — substitute signed tile coordinates
	FogCell     int       `json:"fogCell"`     // 32 m per fog-of-war cell
	Home        core.Vec3 `json:"home"`        // the cabin
	HomeRadius  int       `json:"homeRadius"`  // 450 m
}

// PoisMsg streams points of interest and trails as the player travels. POIs are
// never removed by the server; the client may drop far-away ones and will be sent
// them again when it returns (the server re-sends on re-entry).
type PoisMsg struct {
	POIs   []core.POI   `json:"pois"`
	Trails []core.Trail `json:"trails"`
}

type EnvMsg struct {
	core.Env
	Phase    string         `json:"phase"`    // "Dawn" … "Night"
	Forecast []ForecastSlot `json:"forecast"` // next 12 hours, 3-hour slots (client shows what Stats.Forecast allows)
	DayLen   float32        `json:"dayLen"`   // real seconds per in-game day
}

type ForecastSlot struct {
	Hour    float32 `json:"hour"`
	Weather int     `json:"weather"`
}

// BirdsMsg is the snapshot of birds near the player. Each bird is the array
// [id, speciesIndex, act, flags, x, y, z, yaw, speed] (numbers; see core.BirdAct / flags).
// Birds absent from a snapshot have left the area of interest and should be removed.
type BirdsMsg struct {
	Tick uint32      `json:"tick"`
	B    [][]float32 `json:"b"`
}

// CallMsg tells the client to synthesize a vocalization bout in 3D.
type CallMsg struct {
	Bird    uint32  `json:"bird"`
	Sp      int     `json:"sp"`   // species index
	Call    int     `json:"call"` // index into species.calls
	Repeats int     `json:"reps"`
	X       float32 `json:"x"`
	Y       float32 `json:"y"`
	Z       float32 `json:"z"`
	Occ     float32 `json:"occ"`  // 0..1 occlusion between the player and the bird right now
	Seed    uint32  `json:"seed"` // variation seed
}

// Clue is the subtle HUD information about a heard sound (spec §5.2). Upsert by ID;
// fade out after TTL seconds without an update. Empty strings / zero values mean
// "the player cannot tell".
type Clue struct {
	ID         uint32  `json:"id"`         // stable per sound source
	Bearing    float32 `json:"bearing"`    // perceived compass heading rad (already includes error)
	Spread     float32 `json:"spread"`     // ± uncertainty rad
	Dir        string  `json:"dir"`        // "Northeast"
	DistMin    float32 `json:"distMin"`    // 0,0 = unknown
	DistMax    float32 `json:"distMax"`    //
	Elevation  string  `json:"elevation"`  // ""|above|level|below
	Pitch      string  `json:"pitch"`      // ""|Low|Medium|High|Very high
	Pattern    string  `json:"pattern"`    // ""|Repeated|Trill|…
	Habitat    string  `json:"habitat"`    // ""|"Woodland canopy"…
	Perch      string  `json:"perch"`      // ""|"high in the canopy"… (Habitat Reading)
	Confidence string  `json:"confidence"` // Faint|Uncertain|Fair|Clear
	Strength   float32 `json:"strength"`   // 0..1 perceived loudness
	Known      string  `json:"known"`      // species id if the player recognises the call, else ""
	Mystery    string  `json:"mystery"`    // mystery id this sound belongs to, else ""
	New        bool    `json:"new"`        // first time the player hears this unknown voice
	Unusual    bool    `json:"unusual"`    // Natural Instinct: something about this is out of the ordinary
	TTL        float32 `json:"ttl"`        // seconds to keep showing
	// Elev is the perceived elevation of the voice: the pitch angle in radians from
	// the player's eye (positive = above, already includes the estimate's error), for
	// drawing up/down on the sound ring around the crosshair. ElevSpread is its ±
	// uncertainty in radians; ElevSpread 0 means the player cannot tell (Elev is then 0).
	Elev       float32 `json:"elev,omitempty"`
	ElevSpread float32 `json:"elevSpread,omitempty"`
}

// MoveCue is a subtle "something moved" hint (Sharp Eyes / Peripheral Awareness).
// It never marks the bird itself.
type MoveCue struct {
	Bearing  float32 `json:"bearing"`  // compass heading rad of the movement
	Elev     float32 `json:"elev"`     // pitch rad from the player's eye
	InView   bool    `json:"inView"`   //
	Strength float32 `json:"strength"` // 0..1
}

// FlightMsg marks the two moments of a flush the player can follow: the take-off
// (Phase "flush": the bird is on its way from From to To, landing in Dur seconds) and
// the landing (Phase "land": it has just landed at To). Only for flushes within
// sight range of the player. It never carries anything the birds snapshot does not.
type FlightMsg struct {
	Bird  uint32     `json:"bird"`
	Phase string     `json:"phase"` // flush | land
	From  [3]float32 `json:"from"`  // take-off point
	To    [3]float32 `json:"to"`    // landing perch
	Dur   float32    `json:"dur"`   // flush: seconds until it lands (0 on land)
	Flock int        `json:"flock"` // flush: flock mates following it (0 = alone)
}

// Sighting is the live result of watching a bird (spec §6, §13, screen 3).
// Sent ~4 Hz while a bird is under observation; Bird = 0 means nothing in view.
type Sighting struct {
	Bird       uint32            `json:"bird"`
	Mystery    string            `json:"mystery"`    // mystery id (unidentified)
	Known      string            `json:"known"`      // species id if already identified & recognised
	Clarity    float32           `json:"clarity"`    // 0..1 how well it can be seen right now
	Progress   float32           `json:"progress"`   // 0..1 toward the next piece of evidence
	Evidence   map[string]string `json:"evidence"`   // all evidence so far
	NewKey     string            `json:"newKey"`     // evidence key just revealed ("" = none)
	Behavior   string            `json:"behavior"`   // current behaviour key
	Blocked    string            `json:"blocked"`    // ""|foliage|distance|dark|rain|motion — why clarity is low
	Candidates []Candidate       `json:"candidates"` // current confidence table
	Moment     bool              `json:"moment"`     // Perfect Moment cue: a behaviour worth photographing right now
}

type Toast struct {
	// Kind: xp|discovery|level|quest|item|info|warn|location|journal|rep|credits|behavior
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Text  string `json:"text"`
	XP    int    `json:"xp"`
	Icon  string `json:"icon"`
}

// RewardsMsg opens the Rewards screen (spec screen 14).
type RewardsMsg struct {
	Title       string         `json:"title"`
	Subtitle    string         `json:"subtitle"`
	XP          int            `json:"xp"`
	Credits     int            `json:"credits"`
	Items       []string       `json:"items"`
	Rep         map[string]int `json:"rep"`
	SkillPoints int            `json:"skillPoints"`
	Journal     []string       `json:"journal"` // journal update lines
	LevelUp     int            `json:"levelUp"` // new level reached (0 = none)
}

// RareItemMsg opens the Rare Item Presentation screen (spec screen 11).
type RareItemMsg struct {
	Item string `json:"item"`
}

// RegionMsg opens the Region Discovery screen (spec screen 16).
type RegionMsg struct {
	Region   int      `json:"region"`
	Species  int      `json:"species"`  // number of species that live here
	Unlocked bool     `json:"unlocked"` // false = the player was turned back (needs rank / quest)
	Reason   string   `json:"reason"`   // why it is locked
	Hints    []string `json:"hints"`    // exploration opportunities
}

type RankUpMsg struct {
	Rank int `json:"rank"`
}

type PhotoResult struct {
	Photo    *PhotoMeta `json:"photo"`
	XP       int        `json:"xp"`
	Notes    []string   `json:"notes"` // feedback lines: "Slightly out of focus", "Lovely light"
	FilmLeft int        `json:"filmLeft"`
	NoFilm   bool       `json:"noFilm"` // true = shot refused, out of film
}

type RecState struct {
	Seconds float32 `json:"seconds"`
	Level   float32 `json:"level"`  // 0..1 signal level of the target call
	Noise   float32 `json:"noise"`  // 0..1 background noise
	OnAxis  float32 `json:"onAxis"` // 0..1 how well the mic is aimed
	Signal  bool    `json:"signal"` // a call is currently being captured
}

type RecResult struct {
	Rec   *RecMeta `json:"rec"` // nil = nothing usable captured
	XP    int      `json:"xp"`
	Notes []string `json:"notes"`
}

// IdentifyResult.Outcome: certain|probable|wrong|insufficient
type IdentifyResult struct {
	Outcome    string   `json:"outcome"`
	Mystery    string   `json:"mystery"`
	Species    string   `json:"species"`    // the species now in the journal (certain/probable)
	Guess      string   `json:"guess"`      // what the player submitted
	Confidence int      `json:"confidence"` // %
	XP         int      `json:"xp"`
	Feedback   string   `json:"feedback"` // gentle note, e.g. which evidence did not fit
	First      bool     `json:"first"`
	Notes      []string `json:"notes"`
}

type BaseMsg struct {
	FilmDeveloped int `json:"filmDeveloped"` // photos developed on arrival
}

type Teleport struct {
	Pos core.Vec3 `json:"pos"`
	Yaw float32   `json:"yaw"`
}

type LureMsg struct {
	ID     uint32    `json:"id"`
	Pos    core.Vec3 `json:"pos"`
	Kind   string    `json:"kind"`
	Active bool      `json:"active"`
}

// Narration is one line of the narrator: an original, warm, wry nature-documentary
// voice that thinks aloud as the player explores (docs/contract.md §8). The client
// speaks it and shows it as a caption. It must never reveal a species the player has
// not identified.
type Narration struct {
	ID   uint32 `json:"id"`
	Text string `json:"text"`
	// Kind: ambient|sound|sighting|identify|discovery|place|weather|time|advice|rare|quest|base|activity
	Kind string `json:"kind"`
	// Priority: 0 idle musing, 1 reaction to something happening, 2 a discovery,
	// 3 a milestone. A higher priority may interrupt a lower one.
	Priority int `json:"priority"`
	// TTL is how many seconds the line stays relevant if it has to wait its turn.
	TTL float32 `json:"ttl"`
}

// NestsMsg lists the nests within ~200 m. Each nest is the array
// [id, siteIndex, stage, x, y, z, size, yaw] where siteIndex indexes NestSites.
// The owner species is never sent. A nest missing from the list is out of range.
type NestsMsg struct {
	N [][]float32 `json:"n"`
}

// NestSites is the wire order of core.NestInfo.Site values in NestsMsg.
var NestSites = []string{"cavity", "cup_shrub", "cup_fork", "platform", "dome", "pendant", "ground", "scrape", "reed", "floating", "burrow", "ledge"}

// ForagedMsg answers a forage message.
type ForagedMsg struct {
	ID      string      `json:"id"`
	OK      bool        `json:"ok"`
	Plant   string      `json:"plant"` // plant id
	Got     []ItemStack `json:"got"`
	First   bool        `json:"first"`   // first time this plant was found: added to the herbarium
	Learned []string    `json:"learned"` // recipe ids learned from it
	Reason  string      `json:"reason"`  // when !OK: "Nothing to pick this season", "Already picked", "Pack is full"…
}

type ErrorMsg struct {
	Msg string `json:"msg"`
}
