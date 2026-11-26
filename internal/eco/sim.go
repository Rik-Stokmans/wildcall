// Package eco is the living bird world: a simulation of individual birds with homes,
// routines, voices and nerves that runs whether or not anyone is watching (spec 3.5,
// 12; design rule 5).
//
// The world is unbounded, so the population is local but persistent. The land is cut
// into 128 m population cells; who lives in a cell is a pure function of (seed, cell)
// filtered by the season, so the same individuals - same id, same home, same
// favourite perches, same plumage - are there every time the observer comes back.
// Only the cells around the observer are simulated; they are filled a cell or two per
// tick and retired with hysteresis as the observer travels.
//
// Everything is deterministic for (seed, sequence of calls): runtime decisions come
// from one seeded PCG stream, identities and routines from hashes. Nothing reads the
// wall clock or the global random source.
package eco

import (
	"math"
	"math/rand/v2"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

const (
	// farRadius: beyond this distance from the observer a bird is ticked at a quarter
	// rate with a four times larger step. Snapshots go out to 260 m, so everything the
	// player can see moves at the full rate.
	farRadius = 285
	farEvery  = 4

	moveCueRadius = 60 // EvMove is only reported this close to the observer
)

// Sim implements core.Ecosystem. It is not safe for concurrent use: every method
// must be called from the simulation goroutine.
type Sim struct {
	t       core.Terrain
	species []core.Species
	prof    []profile
	seed    uint64

	rng *rand.Rand // the one stream every runtime decision draws from
	loc *rand.PCG  // re-seeded from hashes for identity rolls (rosters, perch memory)
	lr  *rand.Rand

	birds []bird // stable slots; dead slots are recycled through free
	free  []int32
	count int
	byID  map[uint32]int32
	grid  [gridSlots]int32

	cells    map[cellKey]*cell
	cellList []*cell // deterministic iteration order (maps are not)
	cellPool []*cell
	pending  []cellKey // cells waiting to be activated, nearest first
	service  int       // round-robin cursor over cellList
	forced   []forced  // vagrants placed to honour the autumn guarantee

	events   []core.EcoEvent
	scratch  []core.Perch
	nestUsed []int32 // scratch: perches taken by nests while a cell's nests are built

	lures   []lure
	lureSeq uint32
	dbgSeq  uint32

	// Clock state derived from the Env passed to Step.
	started   bool
	tick      uint32
	env       core.Env
	abs       float64 // absolute in-game hours
	phase     core.DayPhase
	season    core.Season
	seasonAge float32 // in-game hours since the current season began
	postRain  float32 // in-game hours of "just after rain" left
	rainSeen  bool
	wxActive  float32
	thermal   float32
	rate      []float32 // per species song bouts per second, before per-bird factors
	silent    bool      // suppress movement events (placement, fast-forward)

	// The observer and what is derived from it once per Step.
	obs      core.Observer
	centre   core.Vec3 // what the active cells are centred on
	lastScan core.Vec3
	scanned  bool
	oMove    float32 // movement factor on flush distance
	oPosture float32 // crouch / sit bonus
	oDirX    float32 // unit horizontal velocity
	oDirZ    float32
	oMoving  bool
	oCalm    bool
	oDecay   float32 // fear decay per second near the observer
}

// New creates the ecosystem for a world. Nothing is populated yet: the first Step
// (or FastForward) says what time and season it is and where the observer stands,
// and fills the surrounding cells in one go. That first Step is therefore slow
// (tens of milliseconds on a real world, where the terrain has to generate perches);
// run it behind the loading screen. Every later Step is incremental.
func New(t core.Terrain, species []core.Species, seed int64) *Sim {
	s := &Sim{
		t:        t,
		species:  species,
		prof:     buildProfiles(species),
		seed:     mix(uint64(seed) ^ 0x57494C4443414C4C),
		byID:     make(map[uint32]int32, 1024),
		cells:    make(map[cellKey]*cell, 128),
		rate:     make([]float32, len(species)),
		events:   make([]core.EcoEvent, 0, 256),
		scratch:  make([]core.Perch, 0, 1024),
		birds:    make([]bird, 0, 768),
		env:      core.Env{Time: 6.5, Day: 1, Light: 0.6},
		wxActive: 1,
		thermal:  0.5,
	}
	s.rng = rand.New(rand.NewPCG(uint64(seed), 0x9E3779B97F4A7C15))
	s.loc = rand.NewPCG(1, 2)
	s.lr = rand.New(s.loc)
	for i := range s.grid {
		s.grid[i] = -1
	}
	s.centre = homeCentre
	return s
}

var _ core.Ecosystem = (*Sim)(nil)

// homeCentre is what the population is centred on when nobody is in the world: the
// home valley stays alive.
var homeCentre = core.Vec3{}

// Step advances the simulation by dt real seconds and returns the events that
// occurred. The returned slice is reused by the next Step: copy what you keep.
func (s *Sim) Step(dt float32, env core.Env, obs core.Observer) []core.EcoEvent {
	s.events = s.events[:0]
	if !(dt > 0) {
		return s.events
	}
	if dt > 1 {
		dt = 1 // a stalled host must not teleport birds through their flights
	}
	s.tick++
	s.syncEnv(env)
	s.setObserver(obs)

	if !s.started {
		s.started = true
		s.silent = true
		s.scanCells()
		for len(s.pending) > 0 {
			s.activateNext()
		}
		s.silent = false
	} else {
		s.scanCells()
		n := 1
		if len(s.pending) > 6 {
			n = 2
		}
		for ; n > 0 && len(s.pending) > 0; n-- {
			s.activateNext()
		}
	}
	s.tickLures(dt)
	s.nestWatch(dt)

	far2 := float32(farRadius * farRadius)
	sub := s.tick % farEvery
	for i := range s.birds {
		b := &s.birds[i]
		if !b.alive {
			continue
		}
		// Far from the observer (or with nobody around) birds live at a quarter of
		// the tick rate; staggering by slot spreads the work evenly.
		if !obs.Present || distXZ2(b.pos, obs.Pos) > far2 {
			if uint32(i)%farEvery != sub {
				continue
			}
			s.stepBird(b, int32(i), dt*farEvery)
			continue
		}
		s.stepBird(b, int32(i), dt)
	}
	// Arrivals and departures after the birds have moved, so an EvArrive reports
	// where the newcomer really is at the end of this Step.
	s.serviceCells(2)
	if s.tick%50 == 0 {
		s.guaranteeVagrant()
	}
	return s.events
}

// Near appends the state of every bird within radius (3D) of center to buf.
func (s *Sim) Near(center core.Vec3, radius float32, buf []core.BirdState) []core.BirdState {
	if !(radius > 0) {
		return buf
	}
	r2 := radius * radius
	x0, x1 := gridCoord(center.X-radius), gridCoord(center.X+radius)
	z0, z1 := gridCoord(center.Z-radius), gridCoord(center.Z+radius)
	// The grid only pays off for small queries; a window wider than the table would
	// alias, and a huge one visits most birds anyway.
	if x1-x0 >= gridDim || z1-z0 >= gridDim || (x1-x0+1)*(z1-z0+1) > 2*s.count+16 {
		for i := range s.birds {
			if b := &s.birds[i]; b.alive && dist2(b.pos, center) <= r2 {
				buf = append(buf, b.state())
			}
		}
		return buf
	}
	for gz := z0; gz <= z1; gz++ {
		for gx := x0; gx <= x1; gx++ {
			for i := s.grid[gridSlot(gx, gz)]; i >= 0; i = s.birds[i].gnext {
				if b := &s.birds[i]; dist2(b.pos, center) <= r2 {
					buf = append(buf, b.state())
				}
			}
		}
	}
	return buf
}

// Get returns the state of one bird.
func (s *Sim) Get(id uint32) (core.BirdState, bool) {
	i, ok := s.byID[id]
	if !ok {
		return core.BirdState{}, false
	}
	return s.birds[i].state(), true
}

// Count is the number of birds currently simulated.
func (s *Sim) Count() int { return s.count }

// FastForward moves the world on by a number of in-game hours in one coarse step
// (the player rested): migrants that were due have arrived, departures have left,
// nerves have settled, lures have been eaten, and every bird is where its routine
// puts it at env.Time. No events are produced.
func (s *Sim) FastForward(hours float32, env core.Env) {
	if !(hours > 0) {
		hours = 0
	}
	prevSeason := s.season
	s.adoptEnv(env)
	if s.started && env.Season != prevSeason {
		// The boundary fell somewhere inside the skipped stretch; on the natural
		// calendar that is midnight of the season's first day.
		s.seasonAge = min32(hours, naturalSeasonAge(env))
	} else {
		s.seasonAge += hours
	}
	s.postRain = max32(0, s.postRain-hours)
	if !s.started {
		return // nothing lives yet; the first Step populates for this env
	}
	s.silent = true
	for i := range s.lures {
		s.lures[i].ttl -= hours * 3600
	}
	s.pruneLures()
	for _, c := range s.cellList {
		s.serviceCell(c)
	}
	habitFade := clamp(1-hours/6, 0, 1) // a night away and they are wary again
	for i := range s.birds {
		b := &s.birds[i]
		if !b.alive {
			continue
		}
		b.fear, b.quiet, b.away, b.singT, b.callCD, b.lure, b.lureCD = 0, 0, 0, 0, 0, 0, 0
		if b.mode == mLeave || b.mode == mAway {
			b.mode = mIdle // place() decides where it is now
		}
		b.habit *= habitFade
		b.flags &= core.FlagRarePlumage | core.FlagVagrant
		if b.habit >= habitOn {
			b.flags |= core.FlagHabituated
		}
	}
	for i := range s.lures {
		s.lures[i].visitors = 0 // every bird is placed afresh below
	}
	for i := range s.birds {
		if b := &s.birds[i]; b.alive {
			s.place(b)
			s.gridUpdate(b, int32(i))
		}
	}
	s.guaranteeVagrant()
	s.silent = false
	s.events = s.events[:0]
}

// Stats is a census of the simulated population, for tests and debug overlays.
type Stats struct {
	Birds       int                // simulated birds
	Cells       int                // active population cells
	Pending     int                // cells still waiting to be activated
	BySpecies   []int              // indexed by Species.Index
	ByAct       [core.ActCount]int // indexed by core.BirdAct
	Singing     int                // birds with FlagSinging
	Wary        int                // birds with FlagWary
	Vagrants    int                // birds with FlagVagrant
	RarePlumage int                // birds with FlagRarePlumage
	Habituated  int                // birds with FlagHabituated
	Lures       int                // live lures
}

// Stats counts the current population per species and per activity.
func (s *Sim) Stats() Stats {
	st := Stats{Cells: len(s.cellList), Pending: len(s.pending), BySpecies: make([]int, len(s.species)), Lures: len(s.lures)}
	for i := range s.birds {
		b := &s.birds[i]
		if !b.alive {
			continue
		}
		st.Birds++
		st.BySpecies[b.sp]++
		st.ByAct[b.act]++
		f := b.flags
		if f&core.FlagSinging != 0 {
			st.Singing++
		}
		if f&core.FlagWary != 0 {
			st.Wary++
		}
		if f&core.FlagVagrant != 0 {
			st.Vagrants++
		}
		if f&core.FlagRarePlumage != 0 {
			st.RarePlumage++
		}
		if f&core.FlagHabituated != 0 {
			st.Habituated++
		}
	}
	return st
}

// SpawnNear puts one extra bird of the given species into the world with its home at
// pos (debug). It returns the new bird's id, or 0 if the species index is invalid or
// there is no place for that species there (e.g. a land bird over deep water). The
// bird lives, out of any seasonal rules, until its population cell is retired.
func (s *Sim) SpawnNear(speciesIndex int, pos core.Vec3) uint32 {
	if speciesIndex < 0 || speciesIndex >= len(s.prof) {
		return 0
	}
	k := keyAt(pos.X, pos.Z)
	c := s.cells[k]
	if c == nil {
		c = s.activate(k)
	}
	s.dbgSeq++
	g := hash2(s.seed^0xDEB6, uint64(s.dbgSeq))
	r := resident{sp: int16(speciesIndex), lead: -1, bird: -1, debug: true, seed: g, id: idFrom(g)}
	home, ok := s.homeFor(&s.prof[speciesIndex], pos.X, pos.Z, 0, g)
	if !ok {
		return 0
	}
	r.home = home
	c.roster = append(c.roster, r)
	was := s.silent
	s.silent = true
	i := s.spawn(c, int16(len(c.roster)-1), false)
	s.silent = was
	if i < 0 {
		c.roster = c.roster[:len(c.roster)-1]
		return 0
	}
	return s.birds[i].id
}

// ---------------------------------------------------------------------------
// Environment and observer

func absHours(e core.Env) float64 { return float64(e.Day-1)*24 + float64(e.Time) }

// naturalSeasonAge is how far into its season the calendar is (seasons are four days).
func naturalSeasonAge(e core.Env) float32 {
	d := e.Day - 1
	if d < 0 {
		d = 0
	}
	return float32(d%4)*24 + e.Time
}

// adoptEnv takes the environment without advancing any season bookkeeping.
func (s *Sim) adoptEnv(e core.Env) {
	s.env = e
	s.abs = absHours(e)
	s.phase = e.Phase()
	s.season = e.Season & 3
	if e.Rain > 0.3 {
		s.rainSeen = true
	} else if s.rainSeen && e.Rain < 0.1 {
		s.rainSeen = false
		s.postRain = 8 // the washed-clean hours after rain bring vagrants down
	}
	s.wxActive = clamp(1-0.45*e.Rain-0.3*max32(0, e.Wind-0.55), 0.3, 1)
	s.thermal = e.Light * (1 - e.Rain) * (1 - 0.4*e.Cloud)

	// Song bouts per second for each species at this hour and weather, before the
	// per-bird factors (what it is doing, whether it has been disturbed).
	boost := float32(1)
	switch s.phase {
	case core.PhaseDawn:
		boost = 2.2 // the dawn chorus
	case core.PhaseEvening:
		boost = 1.2
	}
	for i := range s.prof {
		p := &s.prof[i]
		v := p.boutRate / 60 * p.activity[s.phase] * boost * (1 - 0.8*e.Rain)
		if !p.windProof {
			v *= 1 - 0.7*clamp((e.Wind-0.3)/0.7, 0, 1)
		}
		s.rate[i] = max32(v, 0)
	}
}

func (s *Sim) syncEnv(e core.Env) {
	prev, prevSeason, had := s.abs, s.season, s.started
	s.adoptEnv(e)
	switch {
	case !had:
		s.seasonAge = naturalSeasonAge(e)
	case e.Season&3 != prevSeason:
		s.seasonAge = 0
	default:
		dh := float32(s.abs - prev)
		if dh > 0 && dh < 6 {
			s.seasonAge += dh
			s.postRain = max32(0, s.postRain-dh)
		}
	}
}

const (
	moveSprint = 2.2
	moveRun    = 1.5
	moveWalk   = 1.0
	moveCrouch = 0.6
	moveStill  = 0.35

	approachDirect     = 1.3
	approachTangential = 0.8
)

func (s *Sim) setObserver(o core.Observer) {
	s.obs = o
	if !o.Present {
		s.centre = homeCentre
		return
	}
	s.centre = o.Pos
	if !(o.Stealth > 0) {
		s.obs.Stealth = 1
	}
	if !(o.CrouchBonus > 0) {
		s.obs.CrouchBonus = 1
	}
	if !(o.Settle > 0) {
		s.obs.Settle = 1
	}
	if !(o.Familiarity > 0) {
		s.obs.Familiarity = 1
	}
	sp := o.Speed
	if hs := float32(math.Hypot(float64(o.Vel.X), float64(o.Vel.Z))); hs > sp {
		sp = hs
	}
	still := o.Sitting || sp < 0.35
	switch {
	case still:
		s.oMove = moveStill
	case sp > 5.4:
		s.oMove = moveSprint
	case sp > 3.2:
		s.oMove = moveRun
	case o.Crouch:
		s.oMove = moveCrouch
	default:
		s.oMove = moveWalk
	}
	s.oPosture = 1
	if o.Crouch || o.Sitting {
		s.oPosture = s.obs.CrouchBonus
	}
	s.oMoving = !still
	s.oDirX, s.oDirZ = 0, 0
	if hl := float32(math.Hypot(float64(o.Vel.X), float64(o.Vel.Z))); hl > 0.2 {
		s.oDirX, s.oDirZ = o.Vel.X/hl, o.Vel.Z/hl
	}
	// Calm: what lets birds get used to a person (sitting, standing quietly, creeping).
	s.oCalm = still || (o.Crouch && sp < 1.5)
	stillBonus := 1 + min32(o.Still, 30)/6
	if o.Sitting {
		stillBonus *= 1.5
	}
	s.oDecay = fearDecay * stillBonus * s.obs.Settle
}
