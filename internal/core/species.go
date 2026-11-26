package core

// Rarity tiers. Rarity is never announced to the player before identification.
type Rarity uint8

const (
	Common Rarity = iota
	Uncommon
	Rare
	Legendary
)

func (r Rarity) String() string {
	return [...]string{"Common", "Uncommon", "Rare", "Legendary"}[r&3]
}

// Species is one bird species: everything the simulation, the renderer, the audio
// synth, the field guide and the identification game need. The catalog is authored
// in internal/species and sent to the client in the welcome message.
type Species struct {
	ID     string `json:"id"`     // stable snake_case id, e.g. "european_robin"
	Index  int    `json:"index"`  // position in the catalog; used in bird snapshots
	Name   string `json:"name"`   // "European Robin"
	Sci    string `json:"sci"`    // "Erithacus rubecula"
	Family string `json:"family"` // field-guide grouping, e.g. "Thrushes & Chats"
	Desc   string `json:"desc"`   // 2–3 sentence field-guide description
	IDTips string `json:"idTips"` // how to tell it apart (shown in the field guide)
	Fact   string `json:"fact"`   // unlocked journal trivia (shown after identification)

	Rarity   Rarity          `json:"rarity"`
	Regions  []RegionID      `json:"regions"`  // where it lives
	Habitats []HabitatWeight `json:"habitats"` // preferred habitats, weights sum ~1
	Seasons  [4]bool         `json:"seasons"`  // present in spring, summer, autumn, winter (false = migrated away)

	Look     Appearance `json:"look"`
	Move     Movement   `json:"move"`
	Behavior Behavior   `json:"behavior"`
	// Calls[0] is the primary song/call (what the player usually hears).
	// Further entries are optional: contact call, alarm call, drumming…
	Calls  []Call `json:"calls"`
	Traits Traits `json:"traits"`
	// Nest describes where and when the species really nests.
	Nest NestInfo `json:"nest"`
	// Facts are short, true, spoken-length facts (one sentence each) the narrator may
	// mumble when the player spots a bird they have identified.
	Facts []string `json:"facts"`
	// Difficulty is the 1..5 discovery difficulty shown in the journal after identification.
	Difficulty int `json:"difficulty"`
	// Similar lists species ids this one is easily confused with (field-guide "compare").
	Similar []string `json:"similar"`
	// Relations are short ecological notes shown with Ecological Knowledge.
	Relations []string `json:"relations"`
}

// NestInfo is a species' real nesting habit.
type NestInfo struct {
	// Site: cavity (tree hole) | cup_shrub (cup in a bush/low cover) | cup_fork (cup in a
	// tree fork) | platform (big stick nest high in a crown) | dome (domed/ball nest in
	// thick cover) | pendant (hung under a conifer branch) | ground (hidden on the ground) |
	// scrape (bare scrape on open ground/shingle) | reed (woven among reed stems) |
	// floating (mound in shallow water or reeds) | burrow (tunnel in a bank or turf) |
	// ledge (cliff or crag ledge) | none (does not breed here, e.g. winter visitors).
	Site string `json:"site"`
	// Perches are the PerchKind keys the nest can be placed on, most typical first.
	Perches   []string `json:"perches"`
	HeightMin float32  `json:"heightMin"` // metres above the ground / water
	HeightMax float32  `json:"heightMax"`
	Seasons   [4]bool  `json:"seasons"` // when nests are active (spring, summer, autumn, winter)
	Size      float32  `json:"size"`    // outer diameter in metres (wren 0.12, buzzard 0.9)
	Desc      string   `json:"desc"`    // one field-guide sentence about the nest
}

// FirstIDXP is the XP for the first identification of a species (spec §7.3:
// first identification 100, rare encounter 250).
func (s *Species) FirstIDXP() int {
	switch s.Rarity {
	case Uncommon:
		return 150
	case Rare:
		return 250
	case Legendary:
		return 400
	}
	return 100
}

type HabitatWeight struct {
	Habitat string  `json:"habitat"` // Habitat.Key()
	Weight  float32 `json:"weight"`
}

// Appearance drives the procedural bird model. Lengths in metres, ratios unitless.
type Appearance struct {
	Length    float32 `json:"length"`    // bill tip to tail tip (robin 0.14, heron 0.95)
	Wingspan  float32 `json:"wingspan"`  // metres
	Plump     float32 `json:"plump"`     // body roundness: 0.7 slim … 1.3 round
	Neck      float32 `json:"neck"`      // 0 none … 1 very long (heron)
	Legs      float32 `json:"legs"`      // 0 short … 1 very long (wader)
	Tail      float32 `json:"tail"`      // tail length relative to body: 0.2 … 1.5
	TailShape string  `json:"tailShape"` // square|forked|fan|pointed|cocked
	Bill      float32 `json:"bill"`      // bill length relative to head: 0.2 … 3
	BillShape string  `json:"billShape"` // cone|thin|dagger|hooked|flat|curved|chisel
	Crest     bool    `json:"crest"`
	WingShape string  `json:"wingShape"` // rounded|pointed|broad|long
	Colors    Palette `json:"colors"`
	Marks     []Mark  `json:"marks"`
}

// Palette colours are "#rrggbb".
type Palette struct {
	Back  string `json:"back"`
	Belly string `json:"belly"`
	Head  string `json:"head"`
	Wing  string `json:"wing"`
	Tail  string `json:"tail"`
	Bill  string `json:"bill"`
	Legs  string `json:"legs"`
	Eye   string `json:"eye"`
}

// Mark is a field mark painted on the model.
// Kind: breast|cap|mask|eyestripe|wingbar|bib|collar|rump|cheek|spots|streaks|tailtip|bars|throat|nape|wingpatch
type Mark struct {
	Kind  string `json:"kind"`
	Color string `json:"color"`
}

type Movement struct {
	Flight string  `json:"flight"` // direct|undulating|soaring|hover|flapglide|darting|buoyant|whirring
	Ground string  `json:"ground"` // hop|walk|wade|swim|cling|none
	Speed  float32 `json:"speed"`  // cruise flight speed m/s
	FlapHz float32 `json:"flapHz"` // wingbeats per second in flapping flight
}

type Behavior struct {
	Perches   []string   `json:"perches"`   // preferred PerchKind keys, most preferred first
	Feeding   string     `json:"feeding"`   // ground|glean|aerial|dive|dabble|probe|hunt|trunk|seeds|scavenge|plunge
	Activity  [6]float32 `json:"activity"`  // activity 0..1 per DayPhase: dawn, morning, midday, afternoon, evening, night
	Sociality string     `json:"sociality"` // solitary|pair|flock
	FlockMin  int        `json:"flockMin"`
	FlockMax  int        `json:"flockMax"`
	Territory float32    `json:"territory"` // home-range radius in metres
	Shyness   float32    `json:"shyness"`   // flush distance (m) for a walking, visible player
	Vocal     float32    `json:"vocal"`     // phrases per minute at peak activity
	Density   float32    `json:"density"`   // relative abundance (1 = typical common songbird)
	Camo      float32    `json:"camo"`      // 0..1 camouflage: how hard it is to pick out when still
	Skulking  float32    `json:"skulking"`  // 0..1 tendency to stay inside cover (wren 0.9, robin 0.3)
	Habituate float32    `json:"habituate"` // 0..1 how readily it gets used to a quiet observer (robin 0.9)
	Specials  []string   `json:"specials"`  // uncommon behaviours this species shows (BirdAct keys: bathing, social, nesting, hovering, diving…)
}

// Call is a synthesizable vocalization. The client synthesizes it with Web Audio from
// the notes; the server uses Loud/Pitch/Pattern for hearing range and audio clues.
type Call struct {
	Kind    string  `json:"kind"`    // song|call|alarm|drum|boom
	Notes   []Note  `json:"notes"`   // one phrase
	Repeat  [2]int  `json:"repeat"`  // phrase repeats per bout: min, max
	Gap     float32 `json:"gap"`     // seconds between phrase repeats
	Loud    float32 `json:"loud"`    // 0..1. Base audible range (m) = 40 + 260*Loud
	Pitch   string  `json:"pitch"`   // low|medium|high|very high   (clue text)
	Pattern string  `json:"pattern"` // repeated|trill|melodic|single|harsh|drumming|booming|whistle|chatter|laughing
}

// Note is one synthesized sound within a phrase.
type Note struct {
	Dur   float32 `json:"dur"`   // seconds
	Gap   float32 `json:"gap"`   // silence after the note, seconds
	F0    float32 `json:"f0"`    // start frequency Hz
	F1    float32 `json:"f1"`    // end frequency Hz (glide)
	Wave  string  `json:"wave"`  // sine|whistle|buzz|trill|noise|click
	Rate  float32 `json:"rate"`  // trill / vibrato rate Hz (0 = none)
	Depth float32 `json:"depth"` // vibrato depth as a fraction of frequency (0..0.5) or AM depth for trill
	Amp   float32 `json:"amp"`   // 0..1 relative loudness
}

// PhraseDur returns the duration of one phrase of the call in seconds.
func (c Call) PhraseDur() float32 {
	var d float32
	for _, n := range c.Notes {
		d += n.Dur + n.Gap
	}
	return d
}

// AudibleRange is the base distance (m) at which the call can be heard unaided.
func (c Call) AudibleRange() float32 { return 40 + 260*c.Loud }

// Traits are the discrete observable facts used for identification. A player's
// evidence about an unknown bird is a subset of these key/value pairs, and the field
// guide can be filtered by them. Evidence keys (pinned):
//
//	size, shape, primary, secondary, marking, bill, flight, pitch, pattern, habitat, behavior
type Traits struct {
	Size      string `json:"size"`      // tiny|small|medium|large|huge
	Shape     string `json:"shape"`     // silhouette class: songbird|finch|tit|thrush|warbler|woodpecker|owl|raptor|duck|heron|wader|gull|corvid|swallow|kingfisher|rail|seabird|pigeon|lark|wagtail
	Primary   string `json:"primary"`   // dominant colour word: brown|black|grey|white|blue|green|yellow|red|orange|buff|pink
	Secondary string `json:"secondary"` // second colour word
	Marking   string `json:"marking"`   // the key field mark, e.g. "orange-red breast"
	Bill      string `json:"bill"`      // short|thin|stout|dagger|hooked|flat|long curved|chisel
	Flight    string `json:"flight"`    // same vocabulary as Movement.Flight
}

// EvidenceKeys lists every evidence key in display order.
var EvidenceKeys = []string{"size", "shape", "primary", "secondary", "marking", "bill", "flight", "behavior", "pitch", "pattern", "habitat"}

// TraitValue returns the true value of an evidence key for a species ("" for the
// situational keys behavior/habitat, which come from the encounter, not the species).
func (s *Species) TraitValue(key string) string {
	switch key {
	case "size":
		return s.Traits.Size
	case "shape":
		return s.Traits.Shape
	case "primary":
		return s.Traits.Primary
	case "secondary":
		return s.Traits.Secondary
	case "marking":
		return s.Traits.Marking
	case "bill":
		return s.Traits.Bill
	case "flight":
		return s.Traits.Flight
	case "pitch":
		if len(s.Calls) > 0 {
			return s.Calls[0].Pitch
		}
	case "pattern":
		if len(s.Calls) > 0 {
			return s.Calls[0].Pattern
		}
	}
	return ""
}
