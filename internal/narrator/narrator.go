// Package narrator is WILDCALL's narrator: an original, warm, unhurried and gently wry
// natural-history voice that thinks aloud as the player explores (docs/contract.md §8).
//
// It has two halves:
//
//   - an authored line bank (lines_*.go, species_lines.go): short spoken lines grouped
//     in pools, with {slot} templates filled from what the player has perceived;
//   - a director (this file): decides whether anything is worth saying right now,
//     paces the voice so it never chatters, and never repeats itself.
//
// The session calls Offer when something happens and Idle about once a second; either
// may return a proto.Narration to send to the client as a "narrate" message.
//
// # The non-spoiler rule
//
// For a bird the player has not identified, lines may use only what the player has
// perceived: the clue's pitch, pattern, habitat, perch, direction, distance and
// elevation, and the evidence gathered so far. This is structural: Event.Known is the
// ONLY way a species reaches the narrator, the session sets it only when the player has
// identified that species, and the unknown-bird path builds its slots from a
// `perceived` value that has no species in it at all. Lines that name a bird live in
// species pools and {name} templates, which are unreachable without Event.Known.
// Free-text perception values (markings, perch phrases) are additionally screened for
// bird-group words. Rarity is never announced.
//
// # Time
//
// Every call takes `now`: monotonic real seconds of the play session (not game time,
// not wall-clock time). All pacing is in real seconds. After Restore, the first call's
// `now` is taken to continue from the saved moment, so cooldowns survive a save even
// though the session clock restarts.
package narrator

import (
	"math/rand/v2"
	"strconv"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Kind names the moment an Event describes.
type Kind string

const (
	// CallHeard: a call was heard. Fill Clue (the proto.Clue sent to the client) and
	// Subject (the mystery id, or "" — Clue.Mystery is used). Set Known only if the
	// player has identified this bird's species (e.g. Clue.Known != "").
	CallHeard Kind = "call"
	// FocusBegin: the player started focus-listening (pose.Focus went true).
	FocusBegin Kind = "focus"
	// Watching: a bird came under observation (Sighting.Bird changed to a new non-zero
	// id). Fill Evidence, Behavior, Blocked, Clarity from the Sighting, Subject = the
	// mystery id, Known if Sighting.Known != "".
	Watching Kind = "watch"
	// NewEvidence: Sighting.NewKey != "". Fill NewKey, Evidence, Subject (mystery id).
	NewEvidence Kind = "evidence"
	// Behaviour: an uncommon behaviour (core.BirdAct.UncommonBehaviour) is being
	// watched. Behavior = the act key. Known if identified, else Evidence/Subject.
	Behaviour Kind = "behaviour"
	// Flushed: the player scared a bird off (an EvFlush caused by the player's approach).
	Flushed Kind = "flush"
	// Settled: a wary or flushed bird settled or returned because the player waited.
	Settled Kind = "settle"
	// Identified: an identify result. Outcome = certain|probable|wrong|insufficient.
	// Known = the identified species for certain/probable (ignored otherwise).
	// Mismatch = an evidence key that did not fit (wrong), if the session has one.
	Identified Kind = "identify"
	// Photographed: a photo result. Stars (0 = nothing in frame), Tags, Known if the
	// subject is identified.
	Photographed Kind = "photo"
	// Recorded: a recording result. Stars (0 = nothing usable), Quality 0..100.
	Recorded Kind = "record"
	// PlaceFound: a POI was discovered. POIKind, POIName, Hidden, Subject = POI id.
	PlaceFound Kind = "place"
	// RegionEntered: first entry into an unlocked region type. Region.
	RegionEntered Kind = "region"
	// RegionLocked: the player was turned back at a locked region type. Region.
	RegionLocked Kind = "locked"
	// CabinReturn: the player arrived back at the cabin (the base screen opened).
	CabinReturn Kind = "cabin"
	// Rested: the player rested at the cabin (time skipped).
	Rested Kind = "rest"
	// RareFind: a proto.RareDiscovery happened. RareKind = its Kind
	// (unusual_plumage|out_of_range|rare_species|…). Never announced as "rare".
	RareFind Kind = "rare"
	// RankReached: a new naturalist rank. Rank, RankName (e.g. "Observer").
	RankReached Kind = "rank"
	// NewAdventure: the player steps out of the cabin at the start of a new game.
	NewAdventure Kind = "welcome"
	// Resumed: a saved adventure was continued.
	Resumed Kind = "resume"

	// Activity mumbles (§13). Item names what was involved; see each kind.

	// Foraged: the player picked a forage plant. Item = plant id (§12, e.g. "bramble");
	// Yield = the ingredient id received, optional (tells elderflower from elderberry);
	// First = the plant is new to the herbarium.
	Foraged Kind = "forage"
	// Cooked: a recipe was prepared. Item = food id (§12); First = first time cooking it.
	Cooked Kind = "cook"
	// Ate: the player ate or drank something. Item = food id, or an ingredient id when
	// eaten raw (berries, nuts).
	Ate Kind = "eat"
	// PackFull: a pick or pick-up failed because the pack is full.
	PackFull Kind = "packfull"
	// Collected: a collectible was picked up or opened. Item = feather|page|relic|cache
	// (POI kinds; "journal_page" and "old_cache" are accepted too).
	Collected Kind = "collect"
	// Climbed: the player climbed something. Item = "watchtower" (or another POI kind).
	Climbed Kind = "climb"
	// Waded: the player stepped into water deep enough to wade.
	Waded Kind = "wade"
	// Sheltered: the player took shelter from rain (under a roof or dense canopy).
	Sheltered Kind = "shelter"
	// SatDown: the player sat down to wait.
	SatDown Kind = "sit"
	// EmptyView: the binoculars were raised and held on nothing in particular.
	EmptyView Kind = "emptyview"
	// OutOfFilm: the camera was fired with no film left.
	OutOfFilm Kind = "nofilm"
	// NestFound: the player found a nest. Item = core.NestInfo.Site (cavity, cup_shrub…);
	// Stage = old|building|eggs|chicks (optional); Subject = the nest id (cooldown);
	// Known = the owner species ONLY if the player has identified it.
	NestFound Kind = "nest"
)

// aboutBird reports whether the event concerns one particular bird.
func (k Kind) aboutBird() bool {
	switch k {
	case CallHeard, Watching, NewEvidence, Behaviour, Flushed, Settled, Identified, Photographed, Recorded, RareFind:
		return true
	}
	return false
}

// Event is something that just happened, in terms the session already has. Only the
// fields relevant to Kind need to be filled; see the Kind constants.
type Event struct {
	Kind Kind

	// Known is the bird's species ONLY when the player has identified it (it is in the
	// journal and recognised). Leave nil for every unidentified bird: that is what
	// keeps the narrator from spoiling anything.
	Known *core.Species
	// Subject is a stable id for cooldowns: the mystery id for an unidentified bird,
	// the POI id for a place. Optional; species ids come from Known.
	Subject string

	// Hearing.
	Clue *proto.Clue

	// Observation (copy from proto.Sighting — never pass its Candidates).
	Evidence map[string]string
	NewKey   string
	Behavior string  // core.BirdAct key
	Blocked  string  // ""|foliage|distance|dark|rain|motion
	Clarity  float32 // 0..1

	// Identification.
	Outcome  string // certain|probable|wrong|insufficient
	Mismatch string // evidence key that did not fit the guess (wrong), optional

	// Photo / recording.
	Stars   int
	Tags    []string
	Quality int

	// Places and regions.
	POIKind string
	POIName string
	Hidden  bool
	Region  core.RegionID

	// Rare discoveries and milestones.
	RareKind string
	Rank     int
	RankName string

	// Activities (Foraged, Cooked, Ate, Collected, Climbed, NestFound).
	Item  string // plant, food, ingredient, collectible or nest-site id
	Yield string // Foraged: the ingredient received (optional)
	Stage string // NestFound: old|building|eggs|chicks (optional)
	First bool   // Foraged/Cooked: the first time ever

	// Where is optional flavour (region, weather) for a few templates.
	Where *Context
}

// Context is the player's situation, passed to Idle about once a second.
type Context struct {
	Region  core.RegionID
	Habitat core.Habitat // under the player's feet (core.HabCount if unknown)
	Env     core.Env
	// Still is the number of seconds the player has been motionless (Observer.Still).
	Still float32
	// Moving is true while the player walks or runs.
	Moving bool
	// AtCabin is true while the player is at the cabin / in the home-base screen.
	AtCabin bool
	// Busy is true while the player is focus-listening, recording, or in a dialogue
	// or screen: no unprompted lines then (transitions are kept briefly and said later).
	Busy bool
}

// Pacing constants (real seconds).
var priorityGap = [4]float64{35, 18, 8, 0}

const (
	budgetWindow = 90.0  // seconds
	budgetLines  = 3     // at most this many lines (priority < 3) per window
	longWindow   = 600.0 // seconds
	longLines    = 8     // priority 0/1 only while fewer lines than this came in the long window
	longLines2   = 12    // priority 2 (results, discoveries) only while fewer than this
	maxWords     = 25
	pendingTTL   = 60.0
	firstMuse    = 120.0
)

// Narrator is the director. Not safe for concurrent use (call it from the session
// goroutine).
type Narrator struct {
	st     State
	pcg    *rand.PCG
	rng    *rand.Rand
	rebase bool
}

// State is the JSON-serialisable memory of the narrator, for the save file.
type State struct {
	Seq      uint32             `json:"seq"`
	RNG      []byte             `json:"rng"`
	Clock    float64            `json:"clock"`    // last `now` seen
	Last     float64            `json:"last"`     // when the last line was spoken
	Window   []float64          `json:"window"`   // when lines (priority < 3) were spoken in the last 10 min
	Cool     map[string]float64 `json:"cool"`     // topic → time it may come up again
	Recent   map[string][]int   `json:"recent"`   // pool → recently used line indices, oldest first
	LastText string             `json:"lastText"` // the last line spoken
	NextMuse float64            `json:"nextMuse"` // earliest next idle musing (0 = not scheduled)
	Activity float64            `json:"activity"` // last time anything bird-related happened
	Env      EnvMemo            `json:"env"`
	Pending  []Pending          `json:"pending"`
	Welcomed bool               `json:"welcomed"`
	// Facts: species id → indices of its Species.Facts said in the current round.
	// FactRounds: species id → completed rounds through all of its facts.
	Facts      map[string][]int `json:"facts,omitempty"`
	FactRounds map[string]int   `json:"factRounds,omitempty"`
}

// EnvMemo remembers the environment so Idle can notice transitions.
type EnvMemo struct {
	Init    bool `json:"init"`
	Phase   int  `json:"phase"`
	Season  int  `json:"season"`
	Weather int  `json:"weather"`
	Raining bool `json:"raining"`
	Windy   bool `json:"windy"`
	Misty   bool `json:"misty"`
}

// Pending is a transition line waiting for a quiet moment.
type Pending struct {
	Cat    string  `json:"cat"`  // time|weather|season (one pending per category)
	Pool   string  `json:"pool"` // line pool
	Prio   int     `json:"prio"`
	Kind   string  `json:"kind"`
	Expiry float64 `json:"expiry"`
}

// New returns a narrator seeded for deterministic line choice.
func New(seed int64) *Narrator {
	pcg := rand.NewPCG(uint64(seed), uint64(seed)^0x9e3779b97f4a7c15)
	return &Narrator{
		st:  State{Cool: map[string]float64{}, Recent: map[string][]int{}, Facts: map[string][]int{}, FactRounds: map[string]int{}},
		pcg: pcg,
		rng: rand.New(pcg),
	}
}

// State returns a copy of the narrator's memory for saving.
func (n *Narrator) State() State {
	s := n.st
	s.RNG, _ = n.pcg.MarshalBinary()
	s.Window = append([]float64(nil), n.st.Window...)
	s.Pending = append([]Pending(nil), n.st.Pending...)
	s.Cool = make(map[string]float64, len(n.st.Cool))
	for k, v := range n.st.Cool {
		s.Cool[k] = v
	}
	s.Recent = make(map[string][]int, len(n.st.Recent))
	for k, v := range n.st.Recent {
		s.Recent[k] = append([]int(nil), v...)
	}
	s.Facts = make(map[string][]int, len(n.st.Facts))
	for k, v := range n.st.Facts {
		s.Facts[k] = append([]int(nil), v...)
	}
	s.FactRounds = make(map[string]int, len(n.st.FactRounds))
	for k, v := range n.st.FactRounds {
		s.FactRounds[k] = v
	}
	return s
}

// Restore loads a saved memory. The next call's `now` is treated as the moment the
// save was taken, so all cooldowns carry over.
func (n *Narrator) Restore(s State) {
	if len(s.RNG) > 0 {
		_ = n.pcg.UnmarshalBinary(s.RNG)
	}
	s.RNG = nil
	if s.Cool == nil {
		s.Cool = map[string]float64{}
	}
	if s.Recent == nil {
		s.Recent = map[string][]int{}
	}
	if s.Facts == nil {
		s.Facts = map[string][]int{}
	}
	if s.FactRounds == nil {
		s.FactRounds = map[string]int{}
	}
	n.st = s
	n.rebase = true
}

// advance moves the narrator's clock, rebasing saved times after a Restore.
func (n *Narrator) advance(now float64) {
	if n.rebase {
		n.rebase = false
		d := now - n.st.Clock
		if d != 0 {
			n.st.Last += d
			n.st.Activity += d
			if n.st.NextMuse != 0 {
				n.st.NextMuse += d
			}
			for i := range n.st.Window {
				n.st.Window[i] += d
			}
			for k := range n.st.Cool {
				n.st.Cool[k] += d
			}
			for i := range n.st.Pending {
				n.st.Pending[i].Expiry += d
			}
		}
	}
	if now > n.st.Clock {
		n.st.Clock = now
	}
	// Forget expired cooldowns so the save stays small.
	for k, v := range n.st.Cool {
		if v <= now {
			delete(n.st.Cool, k)
		}
	}
	w := n.st.Window[:0]
	for _, t := range n.st.Window {
		if now-t < longWindow {
			w = append(w, t)
		}
	}
	n.st.Window = w
}

// allowed applies the priority gaps and the global budget.
func (n *Narrator) allowed(prio int, now float64) bool {
	if prio >= 3 {
		return true
	}
	if prio < 0 {
		prio = 0
	}
	if n.st.Seq > 0 && now-n.st.Last < priorityGap[prio] {
		return false
	}
	short, long := 0, 0
	for _, t := range n.st.Window {
		if now-t < budgetWindow {
			short++
		}
		if now-t < longWindow {
			long++
		}
	}
	if short >= budgetLines {
		return false
	}
	// A long-run average keeps him calm; results of the player's own actions and
	// discoveries (priority 2) get a little more room.
	if prio >= 2 {
		return long < longLines2
	}
	return long < longLines
}

type topic struct {
	key string
	dur float64
}

func (n *Narrator) cooling(ts []topic, now float64) bool {
	for _, t := range ts {
		if until, ok := n.st.Cool[t.key]; ok && until > now {
			return true
		}
	}
	return false
}

func (n *Narrator) cool(ts []topic, now float64, cap float64) {
	for _, t := range ts {
		d := t.dur
		if cap > 0 && d > cap {
			d = cap
		}
		if d > 0 && n.st.Cool[t.key] < now+d {
			n.st.Cool[t.key] = now + d
		}
	}
}

// plan is the director's decision about one moment.
type plan struct {
	prio   int
	kind   string
	ttl    float32
	chance float64    // probability of speaking at all (1 = always)
	topics []topic    // cooldown keys checked before and set after speaking
	groups [][]string // pool groups, tried in order until one yields a line
	slots  slots
	// facts are the species facts behind the factPool pseudo-pool (identified birds).
	facts  []string
	factSp string
}

// Offer considers an event and returns a line if one is worth saying now.
func (n *Narrator) Offer(ev Event, now float64) (proto.Narration, bool) {
	n.advance(now)
	if ev.Kind.aboutBird() {
		n.st.Activity = now
	}
	if ev.Kind == NewAdventure {
		if n.st.Welcomed {
			return proto.Narration{}, false
		}
		n.st.Welcomed = true
	}
	p, ok := n.planEvent(ev)
	if !ok {
		return proto.Narration{}, false
	}
	return n.attempt(p, now)
}

// attempt applies pacing, cooldowns and chance, then picks and commits a line.
func (n *Narrator) attempt(p plan, now float64) (proto.Narration, bool) {
	if !n.allowed(p.prio, now) || n.cooling(p.topics, now) {
		return proto.Narration{}, false
	}
	if p.chance < 1 && n.rng.Float64() >= p.chance {
		// Considered and let go: don't reconsider the same thing for a little while.
		n.cool(p.topics, now, 45)
		return proto.Narration{}, false
	}
	c, ok := n.pickGroups(p)
	if !ok {
		return proto.Narration{}, false
	}
	n.commit(c, p)
	n.cool(p.topics, now, 0)
	return n.speak(c.text, p, now), true
}

func (n *Narrator) speak(text string, p plan, now float64) proto.Narration {
	n.st.Seq++
	n.st.Last = now
	if p.prio < 3 {
		n.st.Window = append(n.st.Window, now)
	}
	n.st.LastText = text
	ttl := p.ttl
	if ttl == 0 {
		ttl = [4]float32{15, 10, 15, 30}[clampPrio(p.prio)]
	}
	return proto.Narration{ID: n.st.Seq, Text: text, Kind: p.kind, Priority: clampPrio(p.prio), TTL: ttl}
}

func clampPrio(p int) int {
	if p < 0 {
		return 0
	}
	if p > 3 {
		return 3
	}
	return p
}

// ---------------------------------------------------------------------------
// Event planning

func (n *Narrator) planEvent(ev Event) (plan, bool) {
	// Wrong or insufficient identifications must never name anything.
	if ev.Kind == Identified && ev.Outcome != "certain" && ev.Outcome != "probable" {
		ev.Known = nil
	}
	var sl slots
	if ev.Kind.aboutBird() {
		if ev.Known != nil {
			sl = n.knownSlots(ev.Known, perceive(ev.Clue, ev.Evidence, ev.Behavior, ev.Blocked))
		} else {
			// The unknown path sees only what the player perceived.
			sl = n.unknownSlots(perceive(ev.Clue, ev.Evidence, ev.Behavior, ev.Blocked))
		}
	} else {
		sl = slots{}
	}
	if ev.Where != nil {
		n.contextSlots(sl, *ev.Where)
	}
	subj := ev.Subject
	if subj == "" && ev.Clue != nil {
		if ev.Clue.Mystery != "" {
			subj = ev.Clue.Mystery
		} else {
			subj = "clue" + strconv.FormatUint(uint64(ev.Clue.ID), 10)
		}
	}
	about := "m:" + subj
	var spID, shape string
	if ev.Known != nil {
		spID = ev.Known.ID
		shape = ev.Known.Traits.Shape
		about = "sp:" + spID
	}
	r := n.rng.Float64 // shorthand: deterministic rolls

	switch ev.Kind {
	case CallHeard:
		var c proto.Clue
		if ev.Clue != nil {
			c = *ev.Clue
		}
		if ev.Known != nil {
			ch := 0.45
			if c.Strength >= 0.6 {
				ch = 0.75
			}
			g := [][]string{{"sp." + spID + ".hear"}, {"call.known"}}
			if r() < 0.25 {
				g = [][]string{{"call.known"}, {"sp." + spID + ".hear"}}
			}
			return plan{prio: 1, kind: "sound", chance: ch, slots: sl, groups: g,
				topics: []topic{{"k:callknown", 90}, {about + ":call", 480}}}, true
		}
		if c.Unusual {
			return plan{prio: 2, kind: "sound", chance: 1, slots: sl,
				groups: [][]string{{"call.unusual"}},
				topics: []topic{{"k:unusual", 120}, {about + ":unusual", 1200}}}, true
		}
		if c.New {
			var g [][]string
			switch {
			case c.Strength > 0 && c.Strength < 0.25:
				g = [][]string{{"call.faint"}, {"call.new"}}
			case c.Strength > 0.72:
				g = [][]string{{"call.close"}, {"call.new"}}
			case r() < 0.4:
				g = [][]string{{"call.new." + normPattern(c.Pattern)}, {"call.new"}}
			default:
				g = [][]string{{"call.new"}}
			}
			return plan{prio: 1, kind: "sound", chance: 1, slots: sl, groups: g,
				topics: []topic{{"k:callnew", 40}, {about + ":new", 900}}}, true
		}
		if c.Strength > 0 && c.Strength < 0.12 {
			return plan{}, false
		}
		g := [][]string{{"call.again"}}
		ch := 0.3
		if c.Strength > 0.72 {
			g = [][]string{{"call.close"}, {"call.again"}}
			ch = 0.5
		}
		return plan{prio: 1, kind: "sound", chance: ch, slots: sl, groups: g,
			topics: []topic{{"k:callagain", 150}, {about + ":again", 300}}}, true

	case FocusBegin:
		return plan{prio: 1, kind: "advice", chance: 0.6, ttl: 6, slots: sl,
			groups: [][]string{{"focus"}}, topics: []topic{{"k:focus", 300}}}, true

	case Watching:
		if ev.Blocked != "" && ev.Clarity < 0.35 {
			b := ev.Blocked
			return plan{prio: 1, kind: "sighting", chance: 0.6, slots: sl,
				groups: [][]string{{"observe.blocked." + b}},
				topics: []topic{{"k:blocked", 120}, {"k:blocked:" + b, 300}}}, true
		}
		if ev.Known != nil {
			g := [][]string{{"sp." + spID + ".watch", "sp." + spID + ".note"}, {"shape." + shape}, {"observe.known"}}
			if r() < 0.25 {
				g = [][]string{{"observe.known"}, {"sp." + spID + ".watch"}}
			}
			p := plan{prio: 1, kind: "sighting", chance: 0.6, slots: sl,
				topics: []topic{{"k:watch", 90}, {about + ":watch", 600}}}
			// Facts first, while there are facts not yet said; after a full round
			// they mix in with the watch lines.
			if facts := SpeciesFacts(ev.Known); len(facts) > 0 {
				ch := 0.85
				if n.st.FactRounds[spID] > 0 {
					ch = 0.35
				}
				if r() < ch {
					g = append([][]string{{factPool}}, g...)
				}
				p.facts, p.factSp = facts, spID
			}
			p.groups = g
			return p, true
		}
		return plan{prio: 1, kind: "sighting", chance: 0.7, slots: sl,
			groups: [][]string{{"observe.unknown"}},
			topics: []topic{{"k:watch", 90}, {about + ":watch", 240}}}, true

	case NewEvidence:
		if ev.Known != nil || ev.NewKey == "" {
			return plan{}, false
		}
		key := ev.NewKey
		if key == "primary" || key == "secondary" {
			key = "colour"
		}
		ch := 0.5
		if key == "marking" {
			ch = 0.85
		}
		return plan{prio: 1, kind: "sighting", chance: ch, slots: sl,
			groups: [][]string{{"evidence." + key}, {"evidence.generic"}},
			topics: []topic{{"k:evidence", 30}, {about + ":ev:" + key, 3600}}}, true

	case Behaviour:
		act := ev.Behavior
		switch act {
		case "feeding", "bathing", "nesting", "social", "hovering", "diving", "preening":
		default:
			return plan{}, false
		}
		g := [][]string{{"behaviour." + act}, {"behaviour.generic"}}
		if ev.Known != nil && r() < 0.3 {
			g = [][]string{{"sp." + spID + ".note"}, {"behaviour." + act}}
		}
		return plan{prio: 2, kind: "sighting", chance: 1, slots: sl, groups: g,
			topics: []topic{{"k:behaviour", 60}, {about + ":act:" + act, 900}}}, true

	case Flushed:
		return plan{prio: 1, kind: "advice", chance: 0.7, slots: sl,
			groups: [][]string{{"flush"}}, topics: []topic{{"k:flush", 150}}}, true

	case Settled:
		return plan{prio: 1, kind: "sighting", chance: 0.7, slots: sl,
			groups: [][]string{{"settle"}}, topics: []topic{{"k:settle", 180}}}, true

	case Identified:
		switch ev.Outcome {
		case "certain", "probable", "insufficient":
			return plan{prio: 3, kind: "identify", chance: 1, slots: sl,
				groups: [][]string{{"identify." + ev.Outcome}}}, true
		case "wrong":
			g := [][]string{{"identify.wrong"}}
			if w := mismatchWord(ev.Mismatch); w != "" {
				sl["mismatch"] = w
				if r() < 0.5 {
					g = [][]string{{"identify.mismatch"}, {"identify.wrong"}}
				}
			}
			return plan{prio: 3, kind: "identify", chance: 1, slots: sl, groups: g}, true
		}
		return plan{}, false

	case Photographed:
		var g [][]string
		ch := 0.8
		behaviour := ""
		golden, exceptional := false, false
		for _, t := range ev.Tags {
			switch {
			case strings.HasPrefix(t, "behavior:"):
				behaviour = strings.TrimPrefix(t, "behavior:")
			case t == "golden hour":
				golden = true
			case t == "exceptional":
				exceptional = true
			}
		}
		if behaviour != "" && sl["act"] == "" {
			if a := actPhrase(behaviour); a != "" {
				sl["act"] = a
			}
		}
		switch {
		case ev.Stars <= 0:
			g, ch = [][]string{{"photo.empty"}}, 0.6
		case exceptional || ev.Stars >= 5:
			g = [][]string{{"photo.great"}}
		case ev.Stars >= 3 && behaviour != "" && r() < 0.6:
			g = [][]string{{"photo.behaviour"}, {"photo.good"}}
		case ev.Stars >= 3 && golden && r() < 0.6:
			g = [][]string{{"photo.golden"}, {"photo.good"}}
		case ev.Stars >= 3:
			g = [][]string{{"photo.good"}}
		default:
			g = [][]string{{"photo.poor"}}
		}
		return plan{prio: 2, kind: "discovery", chance: ch, slots: sl, groups: g,
			topics: []topic{{"k:photo", 45}}}, true

	case Recorded:
		stars := ev.Stars
		if stars == 0 && ev.Quality > 0 {
			stars = 1 + ev.Quality/25
		}
		pool := "rec.none"
		switch {
		case stars >= 5:
			pool = "rec.great"
		case stars >= 3:
			pool = "rec.good"
		case stars >= 1:
			pool = "rec.poor"
		}
		return plan{prio: 2, kind: "discovery", chance: 0.85, slots: sl,
			groups: [][]string{{pool}}, topics: []topic{{"k:rec", 45}}}, true

	case PlaceFound:
		kind := ev.POIKind
		switch kind {
		case "npc", "sign", "shop", "cabin", "":
			return plan{}, false
		}
		key := ev.Subject
		if key == "" {
			key = kind + ":" + ev.POIName
		}
		g := [][]string{{"place." + kind}, {"place.generic"}}
		if ev.Hidden && r() < 0.5 {
			g = [][]string{{"place.hidden"}, {"place." + kind}}
		}
		return plan{prio: 2, kind: "place", chance: 1, slots: sl, groups: g,
			topics: []topic{{"place:" + key, 86400}}}, true

	case RegionEntered:
		k := ev.Region.Key()
		sl["region"] = ev.Region.Name()
		return plan{prio: 3, kind: "discovery", chance: 1, slots: sl,
			groups: [][]string{{"region." + k}}, topics: []topic{{"region:" + k, 600}}}, true

	case RegionLocked:
		k := ev.Region.Key()
		return plan{prio: 2, kind: "advice", chance: 1, slots: sl,
			groups: [][]string{{"region.locked"}}, topics: []topic{{"locked:" + k, 300}, {"k:locked", 90}}}, true

	case CabinReturn:
		return plan{prio: 1, kind: "base", chance: 1, slots: sl,
			groups: [][]string{{"cabin"}}, topics: []topic{{"k:cabin", 600}}}, true

	case Rested:
		return plan{prio: 2, kind: "base", chance: 1, slots: sl,
			groups: [][]string{{"rest"}}, topics: []topic{{"k:rest", 120}}}, true

	case RareFind:
		rk := ev.RareKind
		switch rk {
		case "unusual_plumage", "out_of_range", "rare_species":
		default:
			rk = "generic"
		}
		return plan{prio: 2, kind: "rare", chance: 1, ttl: 20, slots: sl,
			groups: [][]string{{"rare." + rk}, {"rare.generic"}},
			topics: []topic{{"k:rare", 45}, {about + ":rare:" + rk, 1800}}}, true

	case RankReached:
		if t := rankTitle(ev.RankName); t != "" {
			sl["title"] = t
		}
		return plan{prio: 3, kind: "quest", chance: 1, slots: sl, groups: [][]string{{"rank"}}}, true

	case NewAdventure:
		return plan{prio: 3, kind: "ambient", chance: 1, ttl: 40, slots: sl, groups: [][]string{{"welcome"}}}, true

	case Resumed:
		return plan{prio: 2, kind: "ambient", chance: 1, ttl: 30, slots: sl,
			groups: [][]string{{"resume"}}, topics: []topic{{"k:resume", 600}}}, true
	}
	return n.planActivity(ev, sl)
}

// ---------------------------------------------------------------------------
// Idle: transitions, stillness, wandering and musings

// Idle is called about once a second with the player's situation. It notices dawn,
// dusk, nightfall, weather turning and season changes, remarks on long stillness or
// long quiet walks, and now and then muses about the place, hour, weather or season.
func (n *Narrator) Idle(ctx Context, now float64) (proto.Narration, bool) {
	n.advance(now)
	n.noticeEnv(ctx.Env, now)
	if n.st.NextMuse == 0 {
		n.st.NextMuse = now + firstMuse + n.rng.Float64()*60
	}
	if n.st.Activity == 0 {
		n.st.Activity = now
	}
	if ctx.Busy {
		return proto.Narration{}, false
	}
	sl := slots{}
	n.contextSlots(sl, ctx)

	// 1. Pending transitions (dawn, rain, a new season…), highest priority first.
	keep := n.st.Pending[:0]
	best := -1
	for _, p := range n.st.Pending {
		if p.Expiry <= now {
			continue
		}
		keep = append(keep, p)
	}
	n.st.Pending = keep
	for i, p := range n.st.Pending {
		if best < 0 || p.Prio > n.st.Pending[best].Prio {
			best = i
		}
	}
	if best >= 0 {
		p := n.st.Pending[best]
		pl := plan{prio: p.Prio, kind: p.Kind, ttl: 20, chance: 1, slots: sl,
			groups: [][]string{{p.Pool}}, topics: []topic{{"k:" + p.Cat, 150}}}
		if n.allowed(pl.prio, now) && !n.cooling(pl.topics, now) {
			n.st.Pending = append(n.st.Pending[:best], n.st.Pending[best+1:]...)
			if line, ok := n.attempt(pl, now); ok {
				return line, true
			}
		}
	}

	// 2. Long stillness.
	if ctx.Still >= 75 && !ctx.AtCabin {
		pl := plan{prio: 0, kind: "ambient", chance: 1, slots: sl,
			groups: [][]string{{"stillness"}}, topics: []topic{{"k:still", 600}}}
		if line, ok := n.attempt(pl, now); ok {
			return line, true
		}
	}

	// 3. A long walk with nothing happening.
	if ctx.Moving && ctx.Still == 0 && now-n.st.Activity >= 180 {
		pl := plan{prio: 0, kind: "ambient", chance: 1, slots: sl,
			groups: [][]string{{"walking"}}, topics: []topic{{"k:walk", 480}}}
		if line, ok := n.attempt(pl, now); ok {
			return line, true
		}
	}

	// 4. An occasional musing.
	if now >= n.st.NextMuse {
		if !n.allowed(0, now) {
			n.st.NextMuse = now + 30
			return proto.Narration{}, false
		}
		n.st.NextMuse = now + 180 + n.rng.Float64()*180
		roll := n.rng.Float64()
		var g [][]string
		switch {
		case roll < 0.3:
			g = [][]string{{"idle." + ctx.Region.Key()}, {"idle.any"}}
		case roll < 0.5:
			g = [][]string{{"idle.phase." + phaseKey(ctx.Env.Phase())}, {"idle.any"}}
		case roll < 0.65:
			g = [][]string{{"idle.weather." + weatherKey(ctx.Env.Weather)}, {"idle.any"}}
		case roll < 0.75:
			g = [][]string{{"idle.season." + seasonKey(ctx.Env.Season)}, {"idle.any"}}
		default:
			g = [][]string{{"idle.any"}}
		}
		pl := plan{prio: 0, kind: "ambient", chance: 1, slots: sl, groups: g}
		return n.attempt(pl, now)
	}
	return proto.Narration{}, false
}

// noticeEnv compares the environment with the last one seen and queues transitions.
func (n *Narrator) noticeEnv(e core.Env, now float64) {
	m := &n.st.Env
	phase := int(e.Phase())
	raining := m.Raining
	if e.Rain >= 0.25 {
		raining = true
	} else if e.Rain < 0.08 {
		raining = false
	}
	windy := m.Windy
	if e.Wind >= 0.6 {
		windy = true
	} else if e.Wind < 0.4 {
		windy = false
	}
	misty := m.Misty
	if e.Mist >= 0.35 {
		misty = true
	} else if e.Mist < 0.15 {
		misty = false
	}
	if !m.Init {
		*m = EnvMemo{Init: true, Phase: phase, Season: int(e.Season), Weather: int(e.Weather),
			Raining: raining, Windy: windy, Misty: misty}
		return
	}
	if phase != m.Phase {
		switch core.DayPhase(phase) {
		case core.PhaseDawn:
			n.queue("time", "time.dawn", 1, "time", now)
		case core.PhaseEvening:
			n.queue("time", "time.dusk", 1, "time", now)
		case core.PhaseNight:
			n.queue("time", "time.night", 1, "time", now)
		default:
			if n.rng.Float64() < 0.35 {
				n.queue("time", "time."+phaseKey(core.DayPhase(phase)), 0, "time", now)
			}
		}
	}
	if int(e.Season) != m.Season {
		n.queue("season", "season."+seasonKey(e.Season), 1, "time", now)
	}
	switch {
	case raining && !m.Raining:
		n.queue("weather", "weather.rain", 1, "weather", now)
	case !raining && m.Raining:
		n.queue("weather", "weather.clear", 1, "weather", now)
	case windy && !m.Windy:
		n.queue("weather", "weather.wind", 1, "weather", now)
	case misty && !m.Misty:
		n.queue("weather", "weather.mist", 1, "weather", now)
	case e.Weather == core.WeatherSunny && core.Weather(m.Weather) != core.WeatherSunny && !raining:
		if n.rng.Float64() < 0.4 {
			n.queue("weather", "weather.sun", 0, "weather", now)
		}
	}
	m.Phase, m.Season, m.Weather = phase, int(e.Season), int(e.Weather)
	m.Raining, m.Windy, m.Misty = raining, windy, misty
}

func (n *Narrator) queue(cat, pool string, prio int, kind string, now float64) {
	p := Pending{Cat: cat, Pool: pool, Prio: prio, Kind: kind, Expiry: now + pendingTTL}
	for i := range n.st.Pending {
		if n.st.Pending[i].Cat == cat {
			n.st.Pending[i] = p
			return
		}
	}
	n.st.Pending = append(n.st.Pending, p)
}

// ---------------------------------------------------------------------------
// Line choice

type cand struct {
	pool string
	idx  int
	text string
}

// factPool is the pseudo-pool of the identified species' own facts (plan.facts).
const factPool = "fact"

// pickGroups tries each group of pools in turn and returns a line from the first
// group that has any line whose slots can all be filled.
func (n *Narrator) pickGroups(p plan) (cand, bool) {
	for _, g := range p.groups {
		if c, ok := n.pick(g, p); ok {
			return c, true
		}
	}
	return cand{}, false
}

// pick chooses a line from the pools: never one used recently (until most of its
// pool has been used), never the line just spoken, uniformly among the rest. Facts
// rotate: none is repeated until all of the species' facts have been said.
func (n *Narrator) pick(pools []string, p plan) (cand, bool) {
	var fresh, stale []cand
	var staleAge []int
	for _, pool := range pools {
		if pool == factPool {
			said := n.st.Facts[p.factSp]
			for i, text := range p.facts {
				if text == n.st.LastText || indexOf(said, i) >= 0 {
					continue
				}
				fresh = append(fresh, cand{pool, i, text})
			}
			continue
		}
		lines := bank[pool]
		if len(lines) == 0 {
			continue
		}
		recent := n.st.Recent[pool]
		for i, tpl := range lines {
			text, ok := fill(tpl, p.slots)
			if !ok || text == n.st.LastText {
				continue
			}
			c := cand{pool, i, text}
			if pos := indexOf(recent, i); pos >= 0 {
				stale = append(stale, c)
				staleAge = append(staleAge, pos)
			} else {
				fresh = append(fresh, c)
			}
		}
	}
	if len(fresh) > 0 {
		return fresh[n.rng.IntN(len(fresh))], true
	}
	if len(stale) > 0 {
		best := 0
		for i := range stale {
			if staleAge[i] < staleAge[best] {
				best = i
			}
		}
		return stale[best], true
	}
	return cand{}, false
}

func (n *Narrator) commit(c cand, p plan) {
	if c.pool == factPool {
		said := n.st.Facts[p.factSp]
		// Drop indices that no longer exist (the species data may have changed).
		kept := said[:0]
		for _, i := range said {
			if i < len(p.facts) {
				kept = append(kept, i)
			}
		}
		kept = append(kept, c.idx)
		if len(kept) >= len(p.facts) {
			delete(n.st.Facts, p.factSp)
			n.st.FactRounds[p.factSp]++
		} else {
			n.st.Facts[p.factSp] = kept
		}
		return
	}
	limit := len(bank[c.pool]) * 3 / 4
	if limit < 1 {
		limit = 1
	}
	r := n.st.Recent[c.pool]
	if pos := indexOf(r, c.idx); pos >= 0 {
		r = append(r[:pos], r[pos+1:]...)
	}
	r = append(r, c.idx)
	if len(r) > limit {
		r = r[len(r)-limit:]
	}
	n.st.Recent[c.pool] = r
}

func indexOf(xs []int, v int) int {
	for i, x := range xs {
		if x == v {
			return i
		}
	}
	return -1
}
