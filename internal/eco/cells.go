package eco

import (
	"math"
	"slices"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Population cells: who lives where, and which part of the world is alive.
const (
	cellSize  = 128
	activeR   = 520             // cells whose centre is this close to the observer are simulated
	retireR   = activeR + 160   // ...and are only retired beyond this (hysteresis)
	scanMoved = 16              // the active set is re-evaluated after the centre moves this far
	perchR    = cellSize * 0.75 // perch query radius around a cell centre (covers its corners)

	// baseDensity is the expected number of birds per cell for a species with Density
	// 1 whose habitat weights fully match the cell. With a typical regional roster that
	// gives 6-14 birds a cell, 350-600 in the ~52 active cells.
	baseDensity = 3.2
	maxRoster   = 48

	rareShare      = 0.12  // a Rare species is this much scarcer than its Density says
	legendaryShare = 0.12  // integration fix (was 0.04): with Density 0.02 no snowy owl lived in 30 Frostveil patches in winter
	rarePlumage    = 0.015 // share of individuals with leucistic plumage

	arriveSpread = 8 // in-game hours over which migrants arrive / leave at a season change
	maxPooled    = 24
)

type cellKey struct{ x, z int32 }

func keyAt(x, z float32) cellKey {
	return cellKey{int32(math.Floor(float64(x) / cellSize)), int32(math.Floor(float64(z) / cellSize))}
}

func (k cellKey) centre() (float32, float32) {
	return (float32(k.x) + 0.5) * cellSize, (float32(k.z) + 0.5) * cellSize
}

func (k cellKey) hash(seed uint64) uint64 {
	return hash2(seed, uint64(uint32(k.x))|uint64(uint32(k.z))<<32)
}

// resident is one individual that lives in a cell. Everything here is derived from
// (seed, cell) and never from runtime state, so the same bird comes back every time
// the cell is activated.
type resident struct {
	sp      int16
	lead    int16 // roster index of its flock / pair leader; -1 = none; own index = it leads
	bird    int32 // slot in Sim.birds while it is in the world, else -1
	debug   bool  // placed by SpawnNear: ignores seasons and gates
	vagrant bool
	plumage bool    // rare leucistic plumage
	arrive  float32 // in-game hours into a season at which it arrives / leaves
	day     int     // vagrants: the day of their visit
	home    core.Vec3
	seed    uint64
	id      uint32
}

type cell struct {
	key     cellKey
	region  core.RegionID // dominant region type
	samples [16]sample    // habitat and region on a 4 x 4 grid
	hab     [core.HabCount]float32
	perches []core.Perch // every usable perch in and around the cell
	roster  []resident
	vagTry  int // last (day*6 + 4-hour block) for which a vagrant was rolled
}

type sample struct {
	hab core.Habitat
	reg core.RegionID
	x   float32
	z   float32
}

// forced remembers a vagrant placed by the autumn guarantee, so it is still there
// if its cell is retired and activated again the same day.
type forced struct {
	key cellKey
	day int
	res resident
}

func idFrom(h uint64) uint32 {
	id := uint32(h ^ h>>32)
	if id == 0 {
		id = 1
	}
	return id
}

// regionOK reports whether a species lives in a region type. Open water counts as
// coast for seabirds.
func regionOK(p *profile, r core.RegionID) bool {
	if r == core.RegionNone {
		return p.regions[core.RegionWhisperingCoast] && p.habW[core.HabOcean] > 0
	}
	return r < core.RegionCount && p.regions[r]
}

// ---------------------------------------------------------------------------
// Activation and retirement

// scanCells queues the cells that should be alive and retires the ones that should
// not, whenever the centre has moved enough to matter.
func (s *Sim) scanCells() {
	if s.scanned && distXZ2(s.centre, s.lastScan) < scanMoved*scanMoved {
		return
	}
	s.scanned, s.lastScan = true, s.centre
	cx, cz := s.centre.X, s.centre.Z

	// Retire first so a long jump frees slots before new birds need them.
	for i := 0; i < len(s.cellList); {
		c := s.cellList[i]
		x, z := c.key.centre()
		dx, dz := x-cx, z-cz
		if dx*dx+dz*dz > retireR*retireR {
			s.retire(c)
			continue // retire swapped another cell into slot i
		}
		i++
	}

	s.pending = s.pending[:0]
	k0, k1 := keyAt(cx-activeR, cz-activeR), keyAt(cx+activeR, cz+activeR)
	for kz := k0.z; kz <= k1.z; kz++ {
		for kx := k0.x; kx <= k1.x; kx++ {
			k := cellKey{kx, kz}
			if s.cells[k] != nil {
				continue
			}
			x, z := k.centre()
			dx, dz := x-cx, z-cz
			if dx*dx+dz*dz <= activeR*activeR {
				s.pending = append(s.pending, k)
			}
		}
	}
	slices.SortFunc(s.pending, func(a, b cellKey) int {
		ax, az := a.centre()
		bx, bz := b.centre()
		da := (ax-cx)*(ax-cx) + (az-cz)*(az-cz)
		db := (bx-cx)*(bx-cx) + (bz-cz)*(bz-cz)
		switch {
		case da < db:
			return -1
		case da > db:
			return 1
		case a.z != b.z:
			return int(a.z - b.z)
		}
		return int(a.x - b.x)
	})
}

func (s *Sim) activateNext() {
	k := s.pending[0]
	s.pending = s.pending[1:]
	if s.cells[k] == nil {
		s.activate(k)
	}
}

// activate builds a cell and puts its present residents into the world where their
// routines have them at this hour.
func (s *Sim) activate(k cellKey) *cell {
	var c *cell
	if n := len(s.cellPool); n > 0 {
		c = s.cellPool[n-1]
		s.cellPool = s.cellPool[:n-1]
	} else {
		c = &cell{}
	}
	c.key, c.vagTry = k, -1
	c.roster = c.roster[:0]
	s.buildCell(c)
	s.cells[k] = c
	s.cellList = append(s.cellList, c)
	for _, f := range s.forced {
		if f.key == k && f.day == s.env.Day {
			c.roster = append(c.roster, f.res)
		}
	}
	was := s.silent
	s.silent = true
	for i := range c.roster {
		if s.wantIn(c, &c.roster[i]) {
			s.spawn(c, int16(i), false)
		}
	}
	s.silent = was
	return c
}

func (s *Sim) retire(c *cell) {
	for i := range c.roster {
		if r := &c.roster[i]; r.bird >= 0 {
			s.despawn(r.bird)
		}
	}
	delete(s.cells, c.key)
	for i, o := range s.cellList {
		if o == c {
			last := len(s.cellList) - 1
			s.cellList[i] = s.cellList[last]
			s.cellList[last] = nil
			s.cellList = s.cellList[:last]
			break
		}
	}
	if len(s.cellPool) < maxPooled {
		c.roster = c.roster[:0]
		c.perches = c.perches[:0]
		s.cellPool = append(s.cellPool, c)
	}
}

// ---------------------------------------------------------------------------
// Who lives here

// buildCell samples the land, gathers perches and draws the resident roster. It
// depends only on (seed, cell) and the terrain, never on the season or the observer.
func (s *Sim) buildCell(c *cell) {
	x0, z0 := float32(c.key.x)*cellSize, float32(c.key.z)*cellSize
	var regN [core.RegionCount + 1]int
	c.hab = [core.HabCount]float32{}
	for i := range c.samples {
		x := x0 + (float32(i%4)+0.5)*cellSize/4
		z := z0 + (float32(i/4)+0.5)*cellSize/4
		h, r := s.t.HabitatAt(x, z), s.t.RegionAt(x, z)
		c.samples[i] = sample{hab: h, reg: r, x: x, z: z}
		if h < core.HabCount {
			c.hab[h] += 1.0 / 16
		}
		if r < core.RegionCount {
			regN[r]++
		} else {
			regN[core.RegionCount]++
		}
	}
	best := 0
	for r, n := range regN {
		if n > regN[best] {
			best = r
		}
	}
	c.region = core.RegionID(best)
	if best == int(core.RegionCount) {
		c.region = core.RegionNone
	}

	cx, cz := c.key.centre()
	c.perches = s.t.PerchesNear(cx, cz, perchR, c.perches[:0])
	// Keep only perches a bird may really occupy: never inside the ground, never
	// under water (except floating on it).
	n := 0
	for _, p := range c.perches {
		if s.perchValid(p) {
			c.perches[n] = p
			n++
		}
	}
	c.perches = c.perches[:n]

	ch := c.key.hash(s.seed)
	s.loc.Seed(ch, 0x524F53544552) // "ROSTER"
	for i := range s.prof {
		p := &s.prof[i]
		var suit float32
		for _, sm := range c.samples {
			if sm.hab < core.HabCount && regionOK(p, sm.reg) {
				suit += p.habW[sm.hab] / 16
			}
		}
		if suit <= 0 {
			continue
		}
		exp := suit * p.density * baseDensity
		if p.gated {
			share := float32(rareShare)
			if p.legendary {
				share = legendaryShare
			}
			exp *= share
		}
		u := s.lr.Float32()
		group := 1
		switch {
		case p.flock:
			group = (p.flockMin + p.flockMax + 1) / 2
		case p.pair:
			group = 2
		}
		groups := int(exp/float32(group) + u)
		if p.gated && groups > 1 {
			groups = 1 // rare species live in very small numbers, never in colonies
		}
		for g := 0; g < groups && len(c.roster) < maxRoster; g++ {
			size := 1
			switch {
			case p.flock:
				size = p.flockMin + s.lr.IntN(p.flockMax-p.flockMin+1)
			case p.pair:
				size = 2
			}
			s.addGroup(c, i, size)
		}
	}
}

// addGroup adds a flock (or pair, or single bird) of one species sharing a home.
func (s *Sim) addGroup(c *cell, sp, size int) {
	p := &s.prof[sp]
	hs := s.lr.Uint64()
	x0, z0 := float32(c.key.x)*cellSize, float32(c.key.z)*cellSize
	home, ok := s.homeFor(p, x0+cellSize/2, z0+cellSize/2, cellSize/2, hs)
	if !ok {
		return
	}
	arrive := s.lr.Float32() * arriveSpread
	lead := int16(len(c.roster))
	for m := 0; m < size && len(c.roster) < maxRoster; m++ {
		g := hash2(hs, uint64(m))
		r := resident{sp: int16(sp), lead: -1, bird: -1, home: home, seed: g, id: idFrom(hash2(c.key.hash(s.seed), uint64(len(c.roster))))}
		if size > 1 {
			r.lead = lead
		}
		r.plumage = unit(hash2(g, 0x504C554D)) < rarePlumage
		// Flock mates travel together; a pair's arrival is a few minutes apart at most.
		r.arrive = arrive + float32(m)*0.05
		c.roster = append(c.roster, r)
	}
}

// homeFor picks the centre of a territory near (x, z) within spread metres: the
// best-suited of a few hashed candidate spots. Water birds may live over water;
// everyone else needs land.
func (s *Sim) homeFor(p *profile, x, z, spread float32, h uint64) (core.Vec3, bool) {
	best, bestW := core.Vec3{}, float32(-1)
	tries := 6
	if spread == 0 {
		tries = 1
	}
	for i := 0; i < tries; i++ {
		hx, hz := x, z
		if spread > 0 {
			hx += (unit(hash2(h, uint64(2*i))) - 0.5) * 2 * spread
			hz += (unit(hash2(h, uint64(2*i+1))) - 0.5) * 2 * spread
		}
		g := s.t.HeightAt(hx, hz)
		if g < 0.05 && !p.waterBird {
			continue
		}
		w := float32(0.01)
		if hb := s.t.HabitatAt(hx, hz); hb < core.HabCount {
			w += p.habW[hb]
		}
		if w > bestW {
			best, bestW = core.V(hx, max32(g, 0), hz), w
		}
	}
	return best, bestW >= 0
}

// perchValid: never inside the ground or under the water plane (floating excepted).
func (s *Sim) perchValid(p core.Perch) bool {
	g := s.t.HeightAt(p.Pos.X, p.Pos.Z)
	if p.Kind == core.PerchWater {
		return g < -0.05 && p.Pos.Y >= -0.01
	}
	return p.Pos.Y >= g-0.05 && p.Pos.Y >= -0.01
}

// ---------------------------------------------------------------------------
// Presence over time: seasons, rare-bird conditions, vagrants

// wantIn says whether a resident should be in the world now.
func (s *Sim) wantIn(c *cell, r *resident) bool {
	if r.debug {
		return true
	}
	if r.vagrant {
		return r.day == s.env.Day
	}
	p := &s.prof[r.sp]
	prev := p.seasons[(s.season+3)&3]
	if !p.seasons[s.season] {
		// Out of season: it may not have left yet.
		return prev && s.seasonAge < r.arrive
	}
	if !prev && s.seasonAge < r.arrive {
		return false // not arrived yet
	}
	if p.gated && !s.gateOpen(p, r) {
		return false
	}
	return true
}

// gateOpen: rare species only show themselves at their hour, in their habitat, and
// (unless they are birds of wild, windy places) in calm, dry weather.
func (s *Sim) gateOpen(p *profile, r *resident) bool {
	if !p.gatePhase[s.phase] {
		return false
	}
	if hb := s.t.HabitatAt(r.home.X, r.home.Z); hb >= core.HabCount || !p.gateHab[hb] {
		return false
	}
	if s.env.Rain > 0.25 {
		return false
	}
	if !p.windProof && s.env.Wind > 0.55 {
		return false
	}
	if p.legendary && s.env.Weather != core.WeatherSunny && s.env.Mist < 0.3 {
		return false // the legendary ones want a clear day or a misty dawn
	}
	return true
}

func (s *Sim) serviceCells(n int) {
	for ; n > 0 && len(s.cellList) > 0; n-- {
		if s.service >= len(s.cellList) {
			s.service = 0
		}
		s.serviceCell(s.cellList[s.service])
		s.service++
	}
}

// serviceCell brings one cell up to date with the calendar and the weather: birds
// arrive and leave, rare birds come out or withdraw, vagrants drop in.
func (s *Sim) serviceCell(c *cell) {
	s.rollVagrant(c)
	for i := 0; i < len(c.roster); i++ {
		r := &c.roster[i]
		want := s.wantIn(c, r)
		switch {
		case want && r.bird < 0:
			s.spawn(c, int16(i), !s.silent)
		case !want && r.bird >= 0:
			b := &s.birds[r.bird]
			if s.silent || !s.obs.Present || distXZ2(b.pos, s.obs.Pos) > farRadius*farRadius {
				s.despawn(r.bird)
			} else if b.mode != mLeave {
				s.leave(b)
			}
		}
		if r.vagrant && r.day != s.env.Day && r.bird < 0 {
			// The visit is over: forget it.
			c.roster = append(c.roster[:i], c.roster[i+1:]...)
			s.reindex(c, i)
			i--
		}
	}
}

// reindex fixes the birds' roster indices after a removal at i.
func (s *Sim) reindex(c *cell, from int) {
	for j := from; j < len(c.roster); j++ {
		r := &c.roster[j]
		if r.lead > int16(from) {
			r.lead--
		} else if r.lead == int16(from) {
			r.lead = -1
		}
		if r.bird >= 0 {
			s.birds[r.bird].res = int16(j)
		}
	}
}

// vagrantChance is the chance that a cell receives a vagrant in one 4-hour block.
func (s *Sim) vagrantChance() float32 {
	c := float32(0.0015)
	if s.env.Wind > 0.5 || s.postRain > 0 {
		c *= 5 // blown off course, or brought down by the rain
	}
	if s.seasonAge < 24 {
		c *= 4 // migration is on the move at a season change
	}
	if s.season == core.Autumn {
		c *= 3
	}
	return c
}

func (s *Sim) rollVagrant(c *cell) {
	try := s.env.Day*6 + int(s.env.Time/4)
	if c.vagTry == try {
		return
	}
	c.vagTry = try
	for i := range c.roster {
		if c.roster[i].vagrant && c.roster[i].day == s.env.Day {
			return // one visitor a day is plenty
		}
	}
	h := hash2(c.key.hash(s.seed), uint64(try)*0x56414752)
	if unit(h) >= s.vagrantChance() {
		return
	}
	s.addVagrant(c, h)
}

// addVagrant places a bird of a species from another region type in suitable habitat
// here. It returns the roster index, or -1 if no species fits.
func (s *Sim) addVagrant(c *cell, h uint64) int {
	var total float32
	pick := func(i int) float32 {
		p := &s.prof[i]
		if p.gated || !p.seasons[s.season] || regionOK(p, c.region) {
			return 0
		}
		var suit float32
		for _, sm := range c.samples {
			if sm.hab < core.HabCount {
				suit += p.habW[sm.hab] / 16
			}
		}
		return suit * max32(p.density, 0.05)
	}
	for i := range s.prof {
		total += pick(i)
	}
	if total <= 0 {
		return -1
	}
	u := unit(hash2(h, 1)) * total
	sp := -1
	for i := range s.prof {
		w := pick(i)
		if w > 0 {
			sp = i
			if u < w {
				break
			}
			u -= w
		}
	}
	if sp < 0 {
		return -1
	}
	x0, z0 := float32(c.key.x)*cellSize, float32(c.key.z)*cellSize
	home, ok := s.homeFor(&s.prof[sp], x0+cellSize/2, z0+cellSize/2, cellSize/2, hash2(h, 2))
	if !ok {
		return -1
	}
	g := hash2(h, 3)
	c.roster = append(c.roster, resident{
		sp: int16(sp), lead: -1, bird: -1, vagrant: true, day: s.env.Day,
		home: home, seed: g, id: idFrom(g),
		plumage: unit(hash2(g, 0x504C554D)) < rarePlumage,
	})
	return len(c.roster) - 1
}

// guaranteeVagrant: during autumn there is always at least one vagrant among the
// active cells. If chance has not provided one, one turns up in a deterministic cell.
func (s *Sim) guaranteeVagrant() {
	if s.season != core.Autumn || len(s.cellList) == 0 || len(s.pending) > 0 {
		return
	}
	for i := range s.birds {
		if b := &s.birds[i]; b.alive && b.flags&core.FlagVagrant != 0 {
			return
		}
	}
	// Forget guarantees of earlier days.
	n := 0
	for _, f := range s.forced {
		if f.day == s.env.Day {
			s.forced[n] = f
			n++
		}
	}
	s.forced = s.forced[:n]
	h := hash2(s.seed, uint64(s.env.Day)*0x4155544D)
	start := int(h % uint64(len(s.cellList)))
	// Prefer a cell out of sight of the observer, so the visitor is found, not seen
	// popping in.
	for pass := 0; pass < 2; pass++ {
		for j := range s.cellList {
			c := s.cellList[(start+j)%len(s.cellList)]
			x, z := c.key.centre()
			if pass == 0 && s.obs.Present && distXZ2(core.V(x, 0, z), s.obs.Pos) < 200*200 {
				continue
			}
			if i := s.addVagrant(c, hash2(h, uint64(j))); i >= 0 {
				s.forced = append(s.forced, forced{key: c.key, day: s.env.Day, res: c.roster[i]})
				if len(s.forced) > 8 {
					s.forced = s.forced[1:]
				}
				s.spawn(c, int16(i), !s.silent)
				return
			}
		}
	}
}
