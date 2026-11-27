package core

// Season of the in-game year.
type Season uint8

const (
	Spring Season = iota
	Summer
	Autumn
	Winter
)

func (s Season) String() string { return [...]string{"Spring", "Summer", "Autumn", "Winter"}[s&3] }

// Weather state (spec §20.2: sunny, cloudy, rain, wind).
type Weather uint8

const (
	WeatherSunny Weather = iota
	WeatherCloudy
	WeatherRain
	WeatherWind
	WeatherCount
)

func (w Weather) String() string {
	if w < WeatherCount {
		return [...]string{"Sunny", "Cloudy", "Rain", "Wind"}[w]
	}
	return "Sunny"
}

// DayPhase is the spec §20.1 day phase. It also indexes Behavior.Activity.
type DayPhase uint8

const (
	PhaseDawn      DayPhase = iota // 04:30–07:00  high vocal activity
	PhaseMorning                   // 07:00–11:00  feeding and movement
	PhaseMidday                    // 11:00–14:00  reduced activity
	PhaseAfternoon                 // 14:00–18:00  increased movement
	PhaseEvening                   // 18:00–21:30  calls and returning activity
	PhaseNight                     // 21:30–04:30  nocturnal wildlife
	PhaseCount
)

func (p DayPhase) String() string {
	if p < PhaseCount {
		return [...]string{"Dawn", "Morning", "Midday", "Afternoon", "Evening", "Night"}[p]
	}
	return "Night"
}

// PhaseAt returns the day phase for an hour of day (0..24).
func PhaseAt(hour float32) DayPhase {
	switch {
	case hour >= 4.5 && hour < 7:
		return PhaseDawn
	case hour >= 7 && hour < 11:
		return PhaseMorning
	case hour >= 11 && hour < 14:
		return PhaseMidday
	case hour >= 14 && hour < 18:
		return PhaseAfternoon
	case hour >= 18 && hour < 21.5:
		return PhaseEvening
	default:
		return PhaseNight
	}
}

// Env is the shared environment state, advanced by internal/env.
type Env struct {
	Time    float32 `json:"time"`    // hour of day, 0..24
	Day     int     `json:"day"`     // day counter, starts at 1
	Season  Season  `json:"season"`  // 0..3
	Weather Weather `json:"weather"` // 0..3
	Wind    float32 `json:"wind"`    // 0..1
	Rain    float32 `json:"rain"`    // 0..1 intensity
	Mist    float32 `json:"mist"`    // 0..1 ground mist (dawn, after rain)
	Cloud   float32 `json:"cloud"`   // 0..1 cloud cover
	Light   float32 `json:"light"`   // 0..1 daylight (0 night, 1 midday sun)
}

// Phase returns the current day phase.
func (e Env) Phase() DayPhase { return PhaseAt(e.Time) }

// WeatherNoise is the 0..1 masking noise contributed by wind and rain.
func (e Env) WeatherNoise() float32 {
	n := e.Wind*0.45 + e.Rain*0.6
	if n > 1 {
		n = 1
	}
	return n
}

// BirdAct is a bird's current activity. The numeric value is the wire value in bird
// snapshots, so NEVER reorder; append only. Spec §12.2 states map onto these:
// Idle = perched/preening/roosting, Foraging = foraging/feeding, Calling = FlagSinging,
// Moving = flying/soaring/hovering/swimming/wading/climbing, Alert = alert,
// Fleeing = fleeing, Social = social, Nesting = nesting.
type BirdAct uint8

const (
	ActPerched  BirdAct = iota // sitting still on a perch
	ActForaging                // searching for food: hopping, walking, gleaning
	ActFeeding                 // actually eating: worm caught, at seed, prey in bill (brief; the "perfect moment")
	ActFlying                  // travelling flight
	ActSoaring                 // circling high (raptors, gulls)
	ActHovering                // hovering in place (kestrel, kingfisher)
	ActSwimming                // on water
	ActWading                  // standing / stalking in shallows
	ActClimbing                // creeping on a trunk
	ActAlert                   // frozen upright, watching the player; about to flee or settle
	ActFleeing                 // flushed, flying away fast
	ActHiding                  // ducked into deep cover after a disturbance
	ActRoosting                // asleep, tucked away
	ActPreening                // perched, preening
	ActBathing                 // splashing at the water's edge (uncommon behaviour)
	ActDiving                  // plunge / dive for prey
	ActSocial                  // interacting: courtship display, chasing, flock chatter, mobbing
	ActNesting                 // carrying material / visiting a nest site (spring)
	ActCount
)

var actKeys = [...]string{"perched", "foraging", "feeding", "flying", "soaring", "hovering", "swimming", "wading", "climbing", "alert", "fleeing", "hiding", "roosting", "preening", "bathing", "diving", "social", "nesting"}

// Key is the behaviour word used as evidence, photo tags and quest targets.
func (a BirdAct) Key() string {
	if int(a) < len(actKeys) {
		return actKeys[a]
	}
	return "perched"
}

// Airborne reports whether the activity is a flight state.
func (a BirdAct) Airborne() bool {
	switch a {
	case ActFlying, ActSoaring, ActHovering, ActFleeing, ActDiving:
		return true
	}
	return false
}

// UncommonBehaviour reports whether seeing this activity counts as a
// "unique behaviour" discovery (spec §7.3) the first time per species.
func (a BirdAct) UncommonBehaviour() bool {
	switch a {
	case ActFeeding, ActBathing, ActDiving, ActSocial, ActNesting, ActHovering, ActPreening:
		return true
	}
	return false
}

// Bird flag bits (wire values; append only).
const (
	FlagSinging     uint8 = 1 << iota // currently vocalizing
	FlagWary                          // has noticed the player (raised alertness)
	FlagHidden                        // tucked out of sight in deep cover
	FlagRarePlumage                   // unusual plumage (leucistic individual): a rare discovery
	FlagVagrant                       // out-of-range visitor: a rare discovery
	FlagHabituated                    // used to the player; tolerates a closer approach
)

// BirdState is the public snapshot of one simulated bird.
type BirdState struct {
	ID      uint32
	Species int // Species.Index
	Act     BirdAct
	Flags   uint8
	Pos     Vec3
	Yaw     float32 // heading
	Speed   float32 // m/s
	Cover   float32 // 0..1 cover of its current perch (0 when airborne)
	Fear    float32 // 0..1 current alarm level
}

// Observer is what the ecosystem needs to know about the player (spec §6.4, §12.4).
type Observer struct {
	Present bool
	Pos     Vec3
	Vel     Vec3    // m/s; lets birds tell a direct approach from an indirect one
	Speed   float32 // m/s (walk ≈ 2.2, run ≈ 4.2, sprint ≈ 6.5, crouch ≈ 1.1)
	Crouch  bool
	Sitting bool // settled down to wait (strongly calming once still)
	Prone   bool // lying flat on the ground (crawling or still): the least visible posture
	// Move is the player's own movement mode when known: still|crouch|crawl|walk|run|sprint
	// ("" = infer it from Speed). A sprint slowed by rough ground is still a sprint.
	Move string
	// Still is the number of seconds the player has been (nearly) motionless.
	Still float32
	// Noise is 0..1 extra disturbance this tick (camera shutter, jumping, landing).
	Noise float32
	// From Stats: multipliers applied by the simulation.
	Stealth     float32 // multiplies flush distance (1 = none, lower = closer approach)
	CrouchBonus float32 // extra multiplier applied while crouched or sitting (1 = none)
	Settle      float32 // multiplies how fast fear decays (1 = base, higher = faster)
	Familiarity float32 // multiplies habituation rate (1 = base)
}

// EcoEventKind enumerates ecosystem events.
type EcoEventKind uint8

const (
	EvCall   EcoEventKind = iota // a bird starts a bout of vocalization
	EvFlush                      // a bird was scared off by the observer
	EvMove                       // a bird made a conspicuous movement (take-off, landing, branch hop)
	EvArrive                     // a notable bird entered the world (migrant / vagrant / rare visitor)
	EvLand                       // a bird flushed by the observer (EvFlush) landed at its refuge
)

// EcoEvent is emitted by Ecosystem.Step.
type EcoEvent struct {
	Kind    EcoEventKind
	Bird    uint32
	Species int     // Species.Index
	Call    int     // index into Species.Calls (EvCall)
	Repeats int     // phrase repeats in this bout (EvCall); flock mates flying with it (EvFlush)
	Pos     Vec3    // where the bird is
	Dur     float32 // total bout duration in seconds (EvCall); flight duration (EvFlush)
	Seed    uint32  // per-event variation seed for the synth
	// EvFlush / EvLand: the two ends of the escape flight - where it took off and the
	// perch it is heading for (EvFlush) or has just landed on (EvLand).
	From, To Vec3
}

// Nest stages.
const (
	NestOld      uint8 = iota // disused: last season's nest
	NestBuilding              // adults carrying material (ActNesting)
	NestEggs                  // one adult sitting tight
	NestChicks                // adults visiting with food
)

// Nest is a nest in the world. Nests belong to a breeding pair, sit on a perch that
// suits the species' real nesting habit, and persist for the season.
type Nest struct {
	ID      uint32
	Species int     // Species.Index (never sent to the client)
	Site    string  // NestInfo.Site
	Stage   uint8   // NestOld … NestChicks
	Pos     Vec3    // centre of the nest
	Size    float32 // outer diameter, metres
	Yaw     float32 // orientation (e.g. which side of the trunk a cavity faces)
}

// Lure is a temporary attraction placed in the world (seed mix, garden feeder).
type Lure struct {
	Pos    Vec3
	Radius float32 // metres over which birds are drawn in
	TTL    float32 // seconds remaining
	Kind   string  // "seed" | "feeder"
}

// Ecosystem is the living-world simulation, implemented by internal/eco.
// All methods are called from the single simulation goroutine.
type Ecosystem interface {
	// Step advances the simulation by dt seconds and returns the events that occurred.
	Step(dt float32, env Env, obs Observer) []EcoEvent
	// Near appends the state of every bird within radius of center to buf.
	Near(center Vec3, radius float32, buf []BirdState) []BirdState
	Get(id uint32) (BirdState, bool)
	Count() int
	// Nests appends every nest within radius of center to buf.
	Nests(center Vec3, radius float32, buf []Nest) []Nest
	// AddLure places an attraction; ground- and seed-feeding birds nearby will visit
	// and show ActFeeding there.
	AddLure(l Lure)
	// FastForward advances the world by a number of in-game hours in coarse steps
	// (used when the player rests); birds end up where their routine puts them.
	FastForward(hours float32, env Env)
}

// Stats are the player's derived capabilities: base values modified by equipped
// items, carried gadgets, upgrades, cabin upgrades and learned skills. Computed by
// internal/progress. Modifier maps in item/skill definitions use these JSON field
// names as keys and are ADDITIVE (negative values are tradeoffs).
// "Consumer" notes say who reads the stat: [field] server perception, [eco] via
// Observer, [client] tool feel / UI, [game] session rules.
type Stats struct {
	// --- Acoustics
	HearRange     float32 `json:"hearRange"`     // [field] multiplier on a call's audible range (base 1)
	FocusBonus    float32 `json:"focusBonus"`    // [field] extra range multiplier while focus-listening (base 0.35)
	DirAccuracy   float32 `json:"dirAccuracy"`   // [field] 0..1: 0 = vague 8-point with big error, 1 = precise bearing (base 0.25)
	DistAcc       float32 `json:"distAcc"`       // [field] 0..1: 0 = no distance estimate, 1 = tight band (base 0.15)
	PitchInfo     float32 `json:"pitchInfo"`     // [field] >=1: clue shows pitch
	PatternInfo   float32 `json:"patternInfo"`   // [field] >=1: clue shows pattern
	HabitatInfo   float32 `json:"habitatInfo"`   // [field] >=1: clue shows habitat
	NoiseReduce   float32 `json:"noiseReduce"`   // [field][client] 0..1 fraction of ambient noise ignored
	ClueSlots     float32 `json:"clueSlots"`     // [field] simultaneous sound sources the player can separate (base 2)
	CallMemory    float32 `json:"callMemory"`    // [field] >=1: recognises by ear species the player has RECORDED
	CallRecognise float32 `json:"callRecognise"` // [field] >=1: recognises by ear any IDENTIFIED species

	// --- Audio recording
	RecRange    float32 `json:"recRange"`    // [field] metres at which a clean recording is possible (base 25)
	RecQuality  float32 `json:"recQuality"`  // [field] 0..1 base fidelity (base 0.4)
	RecFocus    float32 `json:"recFocus"`    // [field] 0..1 directionality: rejects off-axis noise, needs aiming (base 0)
	Spectrogram float32 `json:"spectrogram"` // [client] >=1: live spectrogram display available
	AudioAssist float32 `json:"audioAssist"` // [field] 0..3: recordings add pitch/pattern evidence & sharpen ID confidence

	// --- Optics
	BinoZoom      float32 `json:"binoZoom"`      // [client][field] max magnification (base 6)
	BinoFOV       float32 `json:"binoFov"`       // [client] apparent field: true FOV (deg) = BinoFOV / zoom (base 48 → 8° at 6×)
	BinoStability float32 `json:"binoStability"` // [client] 0..1: 1 = rock steady (base 0.35)
	BinoFocus     float32 `json:"binoFocus"`     // [client] focus speed, 1/seconds to full focus (base 1.2)
	BinoClarity   float32 `json:"binoClarity"`   // [client][field] 0..1 optical clarity (base 0.5)
	BinoWeight    float32 `json:"binoWeight"`    // [client] kg: slows raising, adds sway (base 0.6)
	LowLight      float32 `json:"lowLight"`      // [field][client] 0..1 performance at dawn/dusk/night (base 0.2)

	// --- Camera
	CamZoom      float32 `json:"camZoom"`      // [client] max zoom factor (base 3)
	CamStability float32 `json:"camStability"` // [client] 0..1 (base 0.4)
	CamFocus     float32 `json:"camFocus"`     // [client] autofocus speed 1/s (base 1.0)
	CamQuality   float32 `json:"camQuality"`   // [field] 0..1 image quality: caps photo score (base 0.5)
	CamBurst     float32 `json:"camBurst"`     // [client] shots per second while holding the shutter (base 1)
	CamNoise     float32 `json:"camNoise"`     // [game] 0..1 shutter disturbance (base 0.5)
	CamReady     float32 `json:"camReady"`     // [client] seconds to raise the camera (base 0.6)
	FilmCap      float32 `json:"filmCap"`      // [game] shots per expedition before returning to base (base 12)
	Composition  float32 `json:"composition"`  // [field] 0..1 bonus to composition scoring
	LongLens     float32 `json:"longLens"`     // [client] 0..1 fraction of zoom-induced shake removed
	MomentBonus  float32 `json:"momentBonus"`  // [field] 0..1 bonus score for behaviour photos; >=1 also shows a subtle "moment" cue

	// --- Observation
	ObserveSpeed float32 `json:"observeSpeed"` // [field] multiplier on how fast watching reveals traits (base 1)
	NakedEye     float32 `json:"nakedEye"`     // [field] multiplier on unaided observation range (base 1; base range 14 m)
	MoveSense    float32 `json:"moveSense"`    // [field] metres: in-view bird movement produces a subtle cue (base 18)
	Peripheral   float32 `json:"peripheral"`   // [field] metres: out-of-view movement produces an edge cue (base 0)
	Settle       float32 `json:"settle"`       // [eco] multiplier on how fast wildlife settles (base 1)
	PerchHint    float32 `json:"perchHint"`    // [field] >=1: clues add where the bird is likely sitting ("high canopy")
	TrackSigns   float32 `json:"trackSigns"`   // [client] metres at which collectibles & signs glint (base 6)
	Instinct     float32 `json:"instinct"`     // [field] >=1: clues flag unusual activity (rare visitors, odd behaviour)

	// --- Knowledge
	IDAssist        float32 `json:"idAssist"`        // [field] 0..3: quality of the candidate list / confidence numbers
	Recognise       float32 `json:"recognise"`       // [field] >=1: identified species are recognised at a glance
	JournalInfo     float32 `json:"journalInfo"`     // [client] 0..3 unlocks deeper species-entry detail
	HabitatKnow     float32 `json:"habitatKnow"`     // [client] >=1: field guide shows where each species is likely found
	SeasonKnow      float32 `json:"seasonKnow"`      // [client] >=1: field guide shows seasonal & daily activity patterns
	BehaviorInsight float32 `json:"behaviorInsight"` // [field][game] 0..1 behaviour evidence faster; bonus XP for unique behaviour
	EcoKnow         float32 `json:"ecoKnow"`         // [game][client] >=1: species relationships shown; research XP bonus
	RareID          float32 `json:"rareId"`          // [field] 0..1 confidence boost for rare / difficult species

	// --- Fieldcraft
	Stealth     float32 `json:"stealth"`     // [eco] multiplier on flush distance, lower is better (base 1)
	CrouchBonus float32 `json:"crouchBonus"` // [eco] extra multiplier while crouched / sitting (base 0.75)
	MoveSpeed   float32 `json:"moveSpeed"`   // [client] walk speed multiplier (base 1)
	Stamina     float32 `json:"stamina"`     // [client] sprint seconds (base 6)
	Terrain     float32 `json:"terrain"`     // [client] 0..1 reduction of slope / shrub / shallow-water slowdown (base 0)
	Forecast    float32 `json:"forecast"`    // [client] hours of weather forecast shown (base 0)
	TrailSense  float32 `json:"trailSense"`  // [game][client] metres at which hidden trails & secret places reveal (base 12)
	Camp        float32 `json:"camp"`        // [eco via game] 0..1 effectiveness of sit-and-wait setups (base 0)
	Familiarity float32 `json:"familiarity"` // [eco] multiplier on habituation rate (base 1)
	RainProof   float32 `json:"rainProof"`   // [client][field] 0..1 fraction of rain penalties ignored (base 0)

	// --- Pack, navigation, general
	Capacity    float32 `json:"capacity"`    // [game] inventory slots (base 8)
	PackW       float32 `json:"packW"`       // [game][client] backpack grid width in cells (base 5)
	PackH       float32 `json:"packH"`       // [game][client] backpack grid height in cells (base 4)
	Compass     float32 `json:"compass"`     // [client] 0 = 8-point strip, 1 = degrees, 2 = landmark bearings
	MapDetail   float32 `json:"mapDetail"`   // [client] 0 = landmarks only, 1 = trails, 2 = habitats
	LensInspect float32 `json:"lensInspect"` // [game] >=1: inspecting feathers & signs yields extra clues (Explorer's Lens)
	XPMult      float32 `json:"xpMult"`      // [game] XP multiplier (base 1)
	CreditMult  float32 `json:"creditMult"`  // [game] Field Credit multiplier (base 1)
	Discount    float32 `json:"discount"`    // [game] 0..0.5 shop discount
}

// BaseStats returns the capabilities of a brand-new amateur before any equipment.
func BaseStats() Stats {
	return Stats{
		HearRange: 1, FocusBonus: 0.35, DirAccuracy: 0.25, DistAcc: 0.15, ClueSlots: 2,
		RecRange: 25, RecQuality: 0.4,
		BinoZoom: 6, BinoFOV: 48, BinoStability: 0.35, BinoFocus: 1.2, BinoClarity: 0.5, BinoWeight: 0.6, LowLight: 0.2,
		CamZoom: 3, CamStability: 0.4, CamFocus: 1.0, CamQuality: 0.5, CamBurst: 1, CamNoise: 0.5, CamReady: 0.6, FilmCap: 12,
		ObserveSpeed: 1, NakedEye: 1, MoveSense: 18, Settle: 1, TrackSigns: 6,
		Stealth: 1, CrouchBonus: 0.75, MoveSpeed: 1, Stamina: 6, TrailSense: 12, Familiarity: 1,
		Capacity: 8, PackW: 5, PackH: 4, XPMult: 1, CreditMult: 1,
	}
}
