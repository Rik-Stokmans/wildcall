package field

import (
	"sort"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Observation tuning (spec §6, §13; contract §3.3.3).
//
// With base stats, 8× glasses on a robin on an exposed branch at 25 m (clarity ≈
// 0.79) yield size, shape, primary, secondary, bill and marking in ≈ 9 s (6×
// glasses at 35-40 m: ≈ 10 s); a wren
// deep in a shrub (clarity ≈ 0.38) stops after size, shape and primary until it
// comes out.
const (
	// The player is "looking at" the bird nearest the view axis within
	// evidenceConeBase + evidenceConeShare × half-FOV, capped at evidenceConeMax so
	// the wide naked-eye view does not study birds the player is not facing.
	evidenceConeBase  = 3   // degrees
	evidenceConeShare = 0.4 // of the half field of view
	evidenceConeMax   = 12  // degrees
	watchShortlist    = 6   // birds nearest the axis that get the (costlier) clarity test

	// Discovery must be earned: a bird below noticeClarity produces no sighting at
	// all, and a bird only becomes the subject after the view has rested on it for
	// attentionTime seconds — sweeping the glasses across a wood reveals nothing.
	noticeClarity = 0.12
	attentionTime = 0.5
	// Another bird takes over only when it is clearly nearer the axis.
	switchAngleRatio = 0.6
	// A subject that drops out of sight (hops behind a leaf, glasses wander) is
	// kept for lostGrace seconds before the sighting ends.
	lostGrace    = 1.5
	lostConeMult = 1.2 // … as long as it stays within this × half-FOV of the axis

	// Evidence: progress fills at clarity × ObserveSpeed / revealTime per second.
	revealTime    = 1.2 // seconds of perfect clarity per piece of evidence
	progressCarry = 0.5 // overflow kept after a reveal, so tick length does not waste watching time

	// Clarity gates per evidence key (contract §3.3.3).
	gateSilhouette = 0.20 // size, shape, flight
	gatePrimary    = 0.30
	gateDetail     = 0.45 // secondary, bill
	gateMarking    = 0.65

	// Recognition of an identified species: at a glance with Stats.Recognise >= 1,
	// otherwise after recogniseTime seconds at recogniseClarity.
	glanceClarity    = 0.20
	recogniseClarity = 0.35
	recogniseTime    = 1.5

	// Behaviour: what the bird is doing counts as observed after behaviorHold seconds
	// at behaviorClarity (Stats.BehaviorInsight shortens it).
	behaviorClarity = 0.30
	behaviorHold    = 1.5

	// Rare plumage is noted from this clarity (contract §3.3.7).
	plumageClarity = 0.5
)

// traitOrder is the order in which watching reveals a bird's visible traits.
var traitOrder = [...]string{"size", "shape", "primary", "flight", "secondary", "bill", "marking"}

// EvidenceGate is the clarity needed before watching can reveal a visual evidence
// key; ok is false for keys that are not revealed by watching (pitch, pattern…).
func EvidenceGate(key string) (clarity float32, ok bool) {
	switch key {
	case "size", "shape", "flight":
		return gateSilhouette, true
	case "primary":
		return gatePrimary, true
	case "secondary", "bill":
		return gateDetail, true
	case "marking":
		return gateMarking, true
	}
	return 0, false
}

// Reveal is one piece of evidence the session should persist for the observed
// species (into its mystery, or its journal entry once identified).
type Reveal struct {
	Key   string // core.EvidenceKeys vocabulary
	Value string // raw vocabulary value (see EvidenceText for display)
}

// WatchResult is one observation tick.
type WatchResult struct {
	// Sighting is ready to send. Sighting.Bird == 0 means nothing is under
	// observation. For an unidentified species Sighting.Mystery is the id of its
	// open mystery — empty on the tick the species is first encountered, when the
	// session must create the mystery (see Encounter) and fill it in.
	Sighting proto.Sighting

	// Species is the true species index of the bird under observation, -1 if none.
	// Server-side only: never send it.
	Species int
	Bird    core.BirdState
	View    View

	// Reveals are the evidence keys gained this tick, to be persisted.
	Reveals []Reveal
	// Encounter is true once per continuous observation of a bird, when it is first
	// made out well enough to count as a visual encounter (discovery level 3).
	Encounter bool
	// Recognised is true on the tick an identified species is recognised
	// (Sighting.Known becomes set).
	Recognised bool
	// Behavior is the BirdAct key of a behaviour that has just been watched long
	// enough to count as observed ("" otherwise). Reported once per stretch of the
	// behaviour, for known and unknown species alike.
	Behavior string
	// Rare lists rare discoveries this tick's observation would constitute. They
	// carry stable ids: the session logs each one only once (HasRare).
	Rare []proto.RareDiscovery
}

// Watch is the observation state machine: which bird the player is studying, how far
// along the next piece of evidence is, and what has been revealed. One per player
// session; the zero value is ready to use. Not safe for concurrent use.
type Watch struct {
	target  uint32 // bird under observation (0 = none)
	species int
	lost    float32 // seconds the target has been out of sight

	cand  uint32 // bird the view is resting on, not yet the target
	dwell float32

	encountered bool
	knownT      float32
	recognised  bool

	act     core.BirdAct
	actHold float32
	actDone bool

	mem map[int]*speciesMemory
}

// speciesMemory is what watching has established about a species in this session.
// It mirrors the evidence the session persists, so a reveal is never repeated even
// if the session stores it a tick late.
type speciesMemory struct {
	progress float32
	evidence map[string]string
}

type sight struct {
	bird  core.BirdState
	angle float32
	view  View
}

// Target returns the id of the bird under observation (0 = none).
func (w *Watch) Target() uint32 { return w.target }

// Reset drops the current subject and everything remembered (new game, load).
func (w *Watch) Reset() { *w = Watch{} }

// Forget drops what watching has established about one species (the session calls
// it if it discards that species' evidence).
func (w *Watch) Forget(species int) { delete(w.mem, species) }

// Tick advances the observation by dt seconds (the session runs it at 4 Hz) for the
// player's current pose and the birds around them (Ecosystem.Near(eye,
// MaxSightRange)). It finds the bird the player is looking at, computes its clarity,
// accumulates evidence and reports what the player may now know.
func (w *Watch) Tick(c *Context, dt float32, p proto.Pose, birds []core.BirdState) WatchResult {
	if dt < 0 {
		dt = 0
	}
	eye := Eye(p)
	axis := core.LookDir(p.Yaw, p.Pitch)
	half := halfFOV(p, c.Stats)
	cone := minf(rad(evidenceConeBase)+evidenceConeShare*half, rad(evidenceConeMax))

	// Shortlist the birds nearest the view axis; only they get the clarity test
	// (which casts an occlusion ray).
	var near []sight
	for _, b := range birds {
		d := b.Pos.Sub(eye)
		if dist := d.Len(); dist > MaxSightRange || dist < 0.3 {
			continue
		}
		if a := angleBetween(axis, d); a <= cone {
			near = append(near, sight{bird: b, angle: a})
		}
	}
	sort.SliceStable(near, func(i, j int) bool {
		if near[i].angle != near[j].angle {
			return near[i].angle < near[j].angle
		}
		return near[i].bird.ID < near[j].bird.ID
	})
	if len(near) > watchShortlist {
		near = near[:watchShortlist]
	}
	var best, cur *sight
	for i := range near {
		s := &near[i]
		if c.SpeciesAt(s.bird.Species) == nil {
			continue
		}
		s.view = Clarity(c, s.bird, p)
		if s.view.Clarity < noticeClarity {
			continue
		}
		if best == nil {
			best = s
		}
		if s.bird.ID == w.target {
			cur = s
		}
	}

	switch {
	case cur != nil && (best == cur || best.angle > switchAngleRatio*cur.angle):
		// Still on the subject.
		w.cand, w.dwell = 0, 0
	case best != nil:
		// The view rests on another bird (or on a first one).
		if w.cand != best.bird.ID {
			w.cand, w.dwell = best.bird.ID, 0
		}
		w.dwell += dt
		if w.dwell >= attentionTime {
			w.acquire(best.bird)
			cur = best
		}
	default:
		w.cand, w.dwell = 0, 0
	}

	if cur != nil {
		w.lost = 0
		return w.observe(c, dt, cur)
	}
	return w.linger(c, dt, p, birds, axis, half)
}

func (w *Watch) acquire(b core.BirdState) {
	w.target, w.species = b.ID, b.Species
	w.lost, w.cand, w.dwell = 0, 0, 0
	w.encountered, w.knownT, w.recognised = false, 0, false
	w.act, w.actHold, w.actDone = core.ActCount, 0, false
}

func (w *Watch) drop() {
	w.target, w.lost = 0, 0
}

func emptyResult() WatchResult {
	return WatchResult{
		Species:  -1,
		Sighting: proto.Sighting{Evidence: map[string]string{}, Candidates: []proto.Candidate{}},
	}
}

// linger handles a subject that is momentarily out of sight: the sighting stays up,
// frozen, for a short grace period so a hop behind a leaf does not end it.
func (w *Watch) linger(c *Context, dt float32, p proto.Pose, birds []core.BirdState, axis core.Vec3, half float32) WatchResult {
	if w.target == 0 {
		return emptyResult()
	}
	w.lost += dt
	var tb *core.BirdState
	for i := range birds {
		if birds[i].ID == w.target {
			tb = &birds[i]
			break
		}
	}
	sp := (*core.Species)(nil)
	if tb != nil {
		sp = c.SpeciesAt(tb.Species)
	}
	if tb == nil || sp == nil || w.lost > lostGrace ||
		angleBetween(axis, tb.Pos.Sub(Eye(p))) > half*lostConeMult {
		w.drop()
		return emptyResult()
	}
	view := Clarity(c, *tb, p)
	res := emptyResult()
	res.Species, res.Bird, res.View = tb.Species, *tb, view
	w.fillSighting(c, &res, sp, w.evidenceFor(c, sp, tb.Species), "")
	if res.Sighting.Blocked == "" {
		res.Sighting.Blocked = lowestFactor(view)
	}
	return res
}

// observe runs one tick of active watching on the current subject.
func (w *Watch) observe(c *Context, dt float32, s *sight) WatchResult {
	b, view := s.bird, s.view
	sp := c.SpeciesAt(b.Species)
	st := c.Stats
	know := c.know()
	res := emptyResult()
	res.Species, res.Bird, res.View = b.Species, b, view

	if !w.encountered && view.Clarity >= glanceClarity {
		w.encountered = true
		res.Encounter = true
	}

	identified := know.Identified(sp.ID)
	if identified && !w.recognised {
		if st.Recognise >= 1 && view.Clarity >= glanceClarity {
			w.recognised = true
		} else if view.Clarity >= recogniseClarity {
			w.knownT += dt
			w.recognised = w.knownT >= recogniseTime
		}
		res.Recognised = w.recognised
	}
	// The player may only learn more about a bird they do not know, or one they
	// know and have recognised. A known species not yet recognised shows nothing.
	gather := !identified || w.recognised

	ev := w.evidenceFor(c, sp, b.Species)
	mem := w.memory(b.Species)
	newKey := ""
	reveal := func(key, value string) {
		ev[key], mem.evidence[key] = value, value
		res.Reveals = append(res.Reveals, Reveal{Key: key, Value: value})
		if newKey == "" {
			newKey = key
		}
	}

	if gather {
		// Visible traits, one at a time, in order, as clarity allows.
		key, waiting := nextTrait(ev, sp, view.Clarity, b.Act.Airborne())
		if key != "" || waiting {
			mem.progress += view.Clarity * maxf(st.ObserveSpeed, 0) * dt / revealTime
		}
		if mem.progress >= 1 {
			if key != "" {
				reveal(key, sp.TraitValue(key))
				mem.progress = minf(mem.progress-1, progressCarry)
			} else {
				mem.progress = 1 // full, waiting for a clearer view
			}
		}
		// Where it is: once it is made out on a perch or the ground.
		if _, ok := ev["habitat"]; !ok && view.Clarity >= glanceClarity && !b.Act.Airborne() {
			reveal("habitat", c.Terrain.HabitatAt(b.Pos.X, b.Pos.Z).Key())
		}
	}

	// What it is doing.
	if view.Clarity >= behaviorClarity {
		if b.Act != w.act {
			w.act, w.actHold, w.actDone = b.Act, 0, false
		}
		w.actHold += dt * (1 + clamp01(st.BehaviorInsight))
		if !w.actDone && w.actHold >= behaviorHold {
			w.actDone = true
			res.Behavior = b.Act.Key()
			if gather && behaviorRank(b.Act) > behaviorRankOfKey(ev["behavior"]) {
				reveal("behavior", b.Act.Key())
			}
		}
	} else {
		w.actHold = 0
	}

	w.fillSighting(c, &res, sp, ev, newKey)
	if key, waiting := nextTrait(ev, sp, view.Clarity, b.Act.Airborne()); key == "" && waiting && res.Sighting.Blocked == "" && gather {
		// Evidence is held back by the view even though clarity is decent: say why.
		res.Sighting.Blocked = lowestFactor(view)
	}
	res.Sighting.Moment = st.MomentBonus >= 1 && b.Act.UncommonBehaviour() && view.Clarity >= behaviorClarity

	// Rare discoveries this observation would constitute.
	region := c.Terrain.RegionAt(b.Pos.X, b.Pos.Z)
	res.Rare = RareFromSighting(b, sp, view.Clarity, region, identified && w.recognised)
	if res.Behavior != "" && identified && w.recognised {
		if rd, ok := RareFromBehavior(sp, b.Act); ok {
			res.Rare = append(res.Rare, rd)
		}
	}
	return res
}

// fillSighting writes the client-facing part of a result. Nothing about a species
// the player has not identified — or has identified but not yet recognised in this
// view — may leak here beyond the evidence they have earned.
func (w *Watch) fillSighting(c *Context, res *WatchResult, sp *core.Species, ev map[string]string, newKey string) {
	know := c.know()
	b, view := res.Bird, res.View
	s := proto.Sighting{
		Bird:       b.ID,
		Clarity:    view.Clarity,
		Blocked:    view.Blocked,
		Evidence:   map[string]string{},
		Candidates: []proto.Candidate{},
		NewKey:     newKey,
	}
	if view.Clarity >= glanceClarity {
		s.Behavior = b.Act.Key()
	}
	identified := know.Identified(sp.ID)
	switch {
	case identified && w.recognised:
		s.Known = sp.ID
	case identified:
		res.Sighting = s
		return
	default:
		if m := know.Mystery(sp.ID); m != nil {
			s.Mystery = m.ID
		}
	}
	for k, v := range ev {
		s.Evidence[k] = v
	}
	if _, waiting := nextTrait(ev, sp, 1, b.Act.Airborne()); !waiting {
		s.Progress = 1 // nothing more to learn from this view
	} else if m := w.mem[b.Species]; m != nil {
		s.Progress = clamp01(m.progress)
	}
	if !identified && len(ev) > 0 {
		var wrong []string
		if m := know.Mystery(sp.ID); m != nil {
			wrong = m.Wrong
		}
		s.Candidates = Candidates(ev, wrong, EncounterContext(c, sp, b.Pos), c.Stats, c.Species)
	}
	res.Sighting = s
}

func (w *Watch) memory(species int) *speciesMemory {
	if w.mem == nil {
		w.mem = map[int]*speciesMemory{}
	}
	m := w.mem[species]
	if m == nil {
		m = &speciesMemory{evidence: map[string]string{}}
		w.mem[species] = m
	}
	return m
}

// evidenceFor returns a fresh map of everything known about the species: what the
// session has persisted plus what this Watch has revealed.
func (w *Watch) evidenceFor(c *Context, sp *core.Species, species int) map[string]string {
	ev := map[string]string{}
	for k, v := range w.memory(species).evidence {
		ev[k] = v
	}
	for k, v := range c.know().Evidence(sp.ID) {
		ev[k] = v
	}
	return ev
}

// nextTrait picks the next visible trait to reveal. key is the first unrevealed
// trait the clarity allows; waiting reports whether any trait observable in the
// bird's current state is still unrevealed (so key == "" && waiting means "held back
// by clarity"). Flight style can only be judged while the bird is airborne.
func nextTrait(ev map[string]string, sp *core.Species, clarity float32, airborne bool) (key string, waiting bool) {
	// A bird on the wing shows what only flight can show first: following a flushed
	// bird with the glasses is how its flight style is learned (flight.go).
	if _, have := ev["flight"]; airborne && !have && sp.TraitValue("flight") != "" {
		if gate, _ := EvidenceGate("flight"); clarity >= gate {
			return "flight", true
		}
	}
	for _, k := range traitOrder {
		if _, have := ev[k]; have {
			continue
		}
		if sp.TraitValue(k) == "" || (k == "flight" && !airborne) {
			continue
		}
		waiting = true
		if gate, _ := EvidenceGate(k); clarity >= gate {
			return k, true
		}
	}
	return "", waiting
}

// lowestFactor names the weakest view factor regardless of thresholds.
func lowestFactor(v View) string {
	name, f := "distance", v.Size
	for _, r := range [...]struct {
		name string
		f    float32
	}{{"foliage", v.Foliage}, {"dark", v.Light}, {"rain", v.Weather}, {"motion", v.Motion}} {
		if r.f < f {
			name, f = r.name, r.f
		}
	}
	return name
}

// behaviorRank orders behaviours by how much they tell about a species, so the
// behaviour kept as evidence is the most telling one seen: 3 = diagnostic of a way
// of life, 2 = uncommon, 1 = everyday. Reactions to the player (alert, fleeing,
// hiding) are not evidence at all.
func behaviorRank(a core.BirdAct) int {
	switch a {
	case core.ActAlert, core.ActFleeing, core.ActHiding:
		return 0
	case core.ActSoaring, core.ActHovering, core.ActClimbing, core.ActSwimming, core.ActWading, core.ActDiving:
		return 3
	}
	if a.UncommonBehaviour() {
		return 2
	}
	return 1
}

func behaviorRankOfKey(key string) int {
	if a, ok := actFromKey(key); ok {
		return behaviorRank(a)
	}
	return 0
}

func actFromKey(key string) (core.BirdAct, bool) {
	if key == "" {
		return 0, false
	}
	for a := core.BirdAct(0); a < core.ActCount; a++ {
		if a.Key() == key {
			return a, true
		}
	}
	return 0, false
}
