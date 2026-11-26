package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Nesting (contract §11). In the breeding season the resident birds of a population
// cell pair up and every pair owns one nest, built on a perch in its territory that
// suits the species' real nesting habit (core.NestInfo: perch kind and height). Who
// pairs with whom and where the nest goes depend only on (seed, cell, breeding year)
// and the terrain, so the same nest - same id, same place - is there whenever the
// cell comes back to life during that year. The nest's stage follows the calendar:
// building, then eggs, then chicks, then an old, disused nest that stays until the
// next spring.
//
// The adults show it (core.ActNesting): both carry material to the nest while it is
// being built; on eggs one bird sits tight - deep in cover, hard to see - and its
// mate drops by now and then; both fly to and fro with food for the chicks. A walker
// who comes closer than the species' nest-alarm distance makes them scold and keep
// away until they withdraw. Nothing else happens to the nest: the game stays cozy.

const (
	seasonHours = 96 // four in-game days a season (internal/env.SeasonDays)

	// Stage boundaries as a fraction of the species' breeding window.
	stageEggs   = 0.2
	stageChicks = 0.55
	stageOld    = 0.9
	stageJitter = 0.1 // nests in one wood are up to this much of the window apart

	maxPairsPerGroup = 4    // a flock never puts more than this many nests in one cell
	nestHeightSlack  = 0.25 // metres of tolerance on NestInfo.HeightMin/HeightMax
	cliffProbe       = 5    // metres: ledges and banks are measured from the lowest ground this far around
	nestCalmRatio    = 1.3  // the alarm ends once the observer is this many alarm radii away
	nestScoldRate    = 0.12 // alarm calls per second from an adult kept off its nest
	nestTripTimer    = 600  // seconds: a bout of trips ends when its trips are done, not on a timer
)

// Trip kinds of a nest bout (bird.stage).
const (
	nsGather uint8 = iota + 1 // building: material from the ground nearby
	nsFood                    // chicks: food from the feeding grounds
	nsSit                     // incubating or brooding
	nsVisit                   // a short visit
)

// nestProfile is a species' NestInfo boiled down for the simulation.
type nestProfile struct {
	ok          bool                         // the species breeds here
	site        string                       // NestInfo.Site
	kinds       [core.PerchKindCount]float32 // preference by perch kind; 0 = never nests there
	hmin, hmax  float32
	first, last int8 // first and last season of the (contiguous) breeding window
	size        float32
	alarmR      float32 // the adults scold a walker closer than this to the nest
	hidden      bool    // a nest that wants foliage around it
	ground      bool    // the nest lies on the ground / the water (burrow, scrape...)
	precocial   bool    // the chicks leave the nest at once and are not fed in it
	sitCover    float32 // cover of a bird sitting in the nest
	lift        float32 // nest centre above (+) or below (-) its perch, in nest diameters
}

func buildNestProfile(sp *core.Species, shy float32) nestProfile {
	n := sp.Nest
	np := nestProfile{site: n.Site, size: clamp(n.Size, 0.05, 2), hmin: n.HeightMin, hmax: n.HeightMax}
	if n.Site == "" || n.Site == "none" {
		return np
	}
	w := float32(1)
	for _, key := range n.Perches {
		if k, ok := core.PerchKindFromKey(key); ok && np.kinds[k] == 0 {
			np.kinds[k] = w
			w *= 0.75
		}
	}
	np.first, np.last = -1, -1
	for i := 0; i < 4; i++ {
		if n.Seasons[i] {
			if np.first < 0 {
				np.first = int8(i)
			}
			np.last = int8(i)
		} else if np.first >= 0 {
			break // only the first contiguous window counts
		}
	}
	np.ok = np.first >= 0 && w < 1
	np.alarmR = clamp(4+0.9*shy, 8, 70)
	switch n.Site {
	case "cup_shrub", "dome", "pendant", "reed", "cup_fork", "ground":
		np.hidden = true
	}
	switch n.Site {
	case "ground", "scrape", "floating", "burrow":
		np.ground = true
	}
	switch sp.Traits.Shape {
	case "duck", "wader", "rail", "grouse":
		np.precocial = true
	}
	np.sitCover = map[string]float32{
		"cavity": 0.95, "burrow": 0.97, "dome": 0.92, "reed": 0.85, "ground": 0.85, "cup_shrub": 0.82,
		"pendant": 0.8, "cup_fork": 0.72, "scrape": 0.6, "floating": 0.6, "platform": 0.5, "ledge": 0.35,
	}[n.Site]
	switch n.Site {
	case "cavity", "burrow":
		np.lift = 0
	case "pendant":
		np.lift = -0.6
	case "ground", "scrape", "floating":
		np.lift = 0.15
	case "ledge":
		np.lift = 0.2
	default:
		np.lift = 0.3
	}
	return np
}

// stageAt is the stage of a nest at a point of the calendar, and whether the nest
// exists at all then (not before its builders have started this year).
func (np *nestProfile) stageAt(season core.Season, age, off float32) (uint8, bool) {
	si := int8(season & 3)
	switch {
	case !np.ok || si < np.first:
		return 0, false
	case si > np.last:
		return core.NestOld, true
	}
	w := float32(np.last-np.first+1) * seasonHours
	t := (float32(si-np.first)*seasonHours+clamp(age, 0, seasonHours))/w + off
	switch {
	case t < stageEggs:
		return core.NestBuilding, true
	case t < stageChicks:
		return core.NestEggs, true
	case t < stageOld:
		return core.NestChicks, true
	}
	return core.NestOld, true
}

// nestRec is one pair's nest in a cell.
type nestRec struct {
	id    uint32
	sp    int16
	mates [2]int16 // roster indices of the adults; mates[1] is -1 for a bird nesting alone
	pos   core.Vec3
	perch core.Perch // where an adult sits on (in) the nest
	size  float32
	yaw   float32
	off   float32 // this nest's offset in the season's schedule
	alarm bool    // the observer is too close: the adults keep away
}

// sitter is the roster index of the adult that incubates.
func (n *nestRec) sitter() int16 {
	if n.mates[1] >= 0 {
		return n.mates[1]
	}
	return n.mates[0]
}

func (n *nestRec) has(ri int16) bool { return ri >= 0 && (n.mates[0] == ri || n.mates[1] == ri) }

// breedYear identifies the current breeding year: the season-count of the spring that
// began it. It only depends on the calendar, so a cell activated again later in the
// same year finds the same nests.
func (s *Sim) breedYear() int32 {
	since := float64(s.season)*seasonHours + float64(clamp(s.seasonAge, 0, seasonHours))
	return int32(math.Floor((s.abs - since + seasonHours/2) / seasonHours))
}

// stage is the nest's stage now.
func (s *Sim) stage(n *nestRec) (uint8, bool) {
	return s.prof[n.sp].nest.stageAt(s.season, s.seasonAge, n.off)
}

// cellNests returns the nests of a cell for the current breeding year, building
// them first if needed.
func (s *Sim) cellNests(c *cell) []nestRec {
	if y := s.breedYear(); !c.nestOK || c.nestYear != y {
		s.buildNests(c, y)
	}
	return c.nests
}

// buildNests pairs the cell's breeding residents and finds each pair a nest site.
func (s *Sim) buildNests(c *cell, year int32) {
	c.nests, c.nestYear, c.nestOK, c.alarms = c.nests[:0], year, true, 0
	var done [maxRoster]bool
	var pairs [maxRoster]int8 // nests per flock, by leader index
	ch := c.key.hash(s.seed)
	used := s.nestUsed[:0]
	for i := range c.roster {
		r := &c.roster[i]
		if i >= maxRoster || done[i] || r.vagrant || r.debug {
			continue
		}
		p := &s.prof[r.sp]
		np := &p.nest
		if !np.ok {
			continue
		}
		done[i] = true
		mate := int16(-1)
		for j := i + 1; j < len(c.roster) && j < maxRoster; j++ {
			o := &c.roster[j]
			if done[j] || o.sp != r.sp || o.vagrant || o.debug {
				continue
			}
			if r.lead >= 0 {
				if o.lead == r.lead {
					mate = int16(j)
					break
				}
				continue
			}
			// Two lone territory holders of one species pair up if they live close
			// enough together; otherwise each nests on its own (its mate is not one
			// of the simulated birds).
			if o.lead < 0 && distXZ2(o.home, r.home) < sq(max32(2*p.terr, 60)) {
				mate = int16(j)
				break
			}
		}
		if r.lead >= 0 {
			if mate < 0 && pairs[r.lead] > 0 {
				continue // the odd one out of a flock does not breed this year
			}
			if pairs[r.lead] >= maxPairsPerGroup {
				if mate >= 0 {
					done[mate] = true
				}
				continue
			}
			pairs[r.lead]++
		}
		if mate >= 0 {
			done[mate] = true
		}
		h := hash2(ch, uint64(uint32(year))<<16^uint64(i)^0x4E4553540000_0000)
		pi, ok := s.nestSite(c, p, r.home, h, used)
		if !ok {
			continue // nothing suitable nearby: this pair does not nest here
		}
		used = append(used, int32(pi))
		pc := c.perches[pi]
		n := nestRec{
			id:    idFrom(hash2(h, 0x4944)),
			sp:    r.sp,
			mates: [2]int16{int16(i), mate},
			size:  np.size,
			yaw:   unit(hash2(h, 0x594157)) * 2 * math.Pi,
			off:   (unit(hash2(h, 0x4F4646)) - 0.5) * stageJitter,
		}
		n.pos = pc.Pos
		g := max32(s.t.HeightAt(pc.Pos.X, pc.Pos.Z), 0)
		if np.ground && (pc.Kind == core.PerchRock || pc.Kind == core.PerchShrub) {
			// A ground nest "at" a boulder or a bush lies at its foot.
			n.pos = core.V(pc.Pos.X+0.45*sin32(n.yaw), 0, pc.Pos.Z-0.45*cos32(n.yaw))
			n.pos.Y = max32(s.t.HeightAt(n.pos.X, n.pos.Z), 0)
			g = n.pos.Y
		}
		n.pos.Y += np.lift * np.size
		if n.pos.Y < g+0.02 {
			n.pos.Y = g + 0.02
		}
		n.perch = core.Perch{Pos: n.pos, Kind: pc.Kind, Cover: max32(pc.Cover, np.sitCover)}
		c.nests = append(c.nests, n)
	}
	s.nestUsed = used[:0]
}

// nestSite picks the best perch for a nest near home: an allowed perch kind (the
// more typical, the better), inside the species' height range, not taken by
// another nest, close to the heart of the territory, in the species' habitat, with
// foliage around it if the nest wants hiding. ok is false if nothing suits.
func (s *Sim) nestSite(c *cell, p *profile, home core.Vec3, h uint64, used []int32) (int, bool) {
	np := &p.nest
	r := clamp(p.terr*0.5, 20, 70)
	r2 := r * r
	x0, z0 := float32(c.key.x)*cellSize, float32(c.key.z)*cellSize
	best, bestW := -1, float32(0)
	for i, pc := range c.perches {
		kw := np.kinds[pc.Kind]
		if kw == 0 {
			continue
		}
		d2 := distXZ2(pc.Pos, home)
		if d2 > r2 {
			continue
		}
		taken := false
		for _, u := range used {
			if int(u) == i {
				taken = true
				break
			}
		}
		if taken {
			continue
		}
		var hgt float32
		switch {
		case np.ground && (pc.Kind == core.PerchRock || pc.Kind == core.PerchShrub):
			hgt = 0 // the nest goes at its foot
		default:
			hgt = s.perchHeight(pc)
		}
		if hgt < np.hmin-nestHeightSlack || hgt > np.hmax+nestHeightSlack {
			continue
		}
		w := kw * (1 - 0.6*sqrt32(d2)/r)
		if np.hidden {
			w *= 0.4 + pc.Cover
		} else {
			w *= 0.8 + 0.2*pc.Cover
		}
		// Habitat from the cell's own samples (cheap and deterministic).
		sx := int(clamp((pc.Pos.X-x0)/(cellSize/4), 0, 3))
		sz := int(clamp((pc.Pos.Z-z0)/(cellSize/4), 0, 3))
		if hb := c.samples[sz*4+sx].hab; hb < core.HabCount {
			w *= 0.35 + p.habW[hb]
		} else {
			w *= 0.35
		}
		w *= 0.6 + 0.4*unit(hash2(h, uint64(i)))
		if w > bestW {
			best, bestW = i, w
		}
	}
	return best, best >= 0
}

// perchHeight is a perch's height above the ground or the water. Ledges and banks
// are measured from the lowest ground (or water) around them: how high up the cliff
// or above the stream they are.
func (s *Sim) perchHeight(pc core.Perch) float32 {
	g := max32(s.t.HeightAt(pc.Pos.X, pc.Pos.Z), 0)
	if pc.Kind == core.PerchLedge || pc.Kind == core.PerchBank {
		for k := 0; k < 8; k++ {
			a := float32(k) * math.Pi / 4
			g = min32(g, max32(s.t.HeightAt(pc.Pos.X+cliffProbe*sin32(a), pc.Pos.Z-cliffProbe*cos32(a)), 0))
		}
	}
	return pc.Pos.Y - g
}

// nestOf returns the nest of the pair this bird belongs to, or nil.
func (s *Sim) nestOf(b *bird) *nestRec {
	c := b.cell
	if c == nil || b.res < 0 {
		return nil
	}
	if !s.prof[b.sp].nest.ok {
		return nil
	}
	nests := s.cellNests(c)
	for i := range nests {
		if nests[i].has(b.res) {
			return &nests[i]
		}
	}
	return nil
}

// activeNest returns the bird's nest and its stage if the nest is in use now.
func (s *Sim) activeNest(b *bird) (*nestRec, uint8) {
	n := s.nestOf(b)
	if n == nil {
		return nil, 0
	}
	st, ok := s.stage(n)
	if !ok || st == core.NestOld {
		return nil, 0
	}
	return n, st
}

// nestBlocked: the bird is kept away from its nest by the observer.
func (s *Sim) nestBlocked(b *bird) bool {
	if !s.prof[b.sp].nest.ok {
		return false
	}
	n := s.nestOf(b)
	return n != nil && n.alarm
}

// onNest reports whether the bird is sitting on its nest right now.
func (s *Sim) onNest(b *bird) bool {
	if b.moving {
		return false
	}
	n := s.nestOf(b)
	return n != nil && distXZ2(b.pos, n.pos) < 0.04 && absf(b.pos.Y-n.pos.Y) < 0.2
}

func absf(v float32) float32 {
	if v < 0 {
		return -v
	}
	return v
}

// ---------------------------------------------------------------------------
// Behaviour

// nestBout may start a bout of nest duty when the bird's current bout ends: building
// trips, a spell on the eggs, food runs for the chicks. It reports whether it did.
func (s *Sim) nestBout(b *bird, p *profile) bool {
	n, st := s.activeNest(b)
	if n == nil || n.alarm || b.lure != 0 {
		return false
	}
	sitter := n.sitter() == b.res
	var odds float32
	switch {
	case st == core.NestBuilding:
		odds = 0.35
	case st == core.NestEggs || st == core.NestChicks && p.nest.precocial:
		odds = 0.1 // the mate drops by
		if sitter {
			odds = 0.75
		}
	case st == core.NestChicks:
		odds = 0.55
	}
	if !s.chance(odds) {
		return false
	}
	b.mode = mNest
	b.timer = nestTripTimer
	switch {
	case st == core.NestBuilding:
		b.stage, b.n = nsGather, int8(2+s.rng.IntN(3))
		s.nestTrip(b, p, n)
	case st == core.NestChicks && !p.nest.precocial:
		b.stage, b.n = nsFood, int8(2+s.rng.IntN(3))
		s.nestTrip(b, p, n)
	case sitter:
		b.stage = nsSit
		s.toNest(b, p, n, thenNestSit)
	default:
		b.stage = nsVisit
		s.toNest(b, p, n, thenNestVisit)
	}
	return true
}

// nestTrip flies off to fetch the next load: material from the ground close to the
// nest, or food for the chicks from the feeding grounds.
func (s *Sim) nestTrip(b *bird, p *profile, n *nestRec) {
	if b.stage == nsFood {
		if pc, i, _, ok := s.feedSpot(b, p); ok {
			s.fly(b, p, pc, int8(i), core.ActFlying, 1, thenNestPick)
			return
		}
	}
	for tries := 0; tries < 3; tries++ {
		a := s.rnd(0, 2*math.Pi)
		d := s.rnd(4, 14)
		if pc, ok := s.groundAt(p, n.pos.X+d*sin32(a), n.pos.Z-d*cos32(a), p.waterBird); ok {
			s.fly(b, p, pc, noPerch, core.ActFlying, 0.9, thenNestPick)
			return
		}
	}
	s.boutEnd(b, p)
}

// toNest flies to the nest (or, already there, settles straight in).
func (s *Sim) toNest(b *bird, p *profile, n *nestRec, th then) {
	if !b.moving && dist2(b.pos, n.pos) < 0.05 {
		b.then, b.mv, b.dest = th, mvGround, noPerch
		b.destKind, b.destCover = n.perch.Kind, n.perch.Cover
		s.arrive(b, p)
		return
	}
	s.fly(b, p, n.perch, noPerch, core.ActFlying, 1, th)
}

// nestArrive: the bird has landed at the gathering spot or at the nest.
func (s *Sim) nestArrive(b *bird, p *profile) {
	b.mode = mNest
	b.act = core.ActNesting
	switch b.then {
	case thenNestPick:
		if b.stage == nsFood {
			b.act = core.ActFeeding // the catch for the chicks
		}
		b.sub = s.rnd(1.5, 4)
	case thenNestBuild:
		b.sub = s.rnd(2.5, 7) // weaving in a stalk / stuffing the gapes
	case thenNestSit:
		b.timer = s.rnd(90, 300)
		b.sub = s.rnd(10, 30)
	case thenNestVisit:
		b.sub = s.rnd(4, 10)
	}
	if n := s.nestOf(b); n != nil && b.then != thenNestPick {
		b.yaw = n.yaw
	}
}

// nestStep is the next step of a nest bout.
func (s *Sim) nestStep(b *bird, p *profile) {
	n, _ := s.activeNest(b)
	if n == nil || n.alarm {
		s.boutEnd(b, p) // the season moved on, or the observer is here
		return
	}
	switch b.then {
	case thenNestPick:
		s.fly(b, p, n.perch, noPerch, core.ActFlying, 0.9, thenNestBuild)
	case thenNestBuild:
		if b.n--; b.n > 0 {
			s.nestTrip(b, p, n)
			return
		}
		s.boutEnd(b, p)
	case thenNestSit:
		b.sub = s.rnd(10, 30) // shuffles, turns the eggs; the timer ends the spell
	default:
		s.boutEnd(b, p)
	}
}

// roostOnNest sends the incubating bird to spend its sleeping hours on the nest. It
// reports whether it did.
func (s *Sim) roostOnNest(b *bird, p *profile) bool {
	n, st := s.activeNest(b)
	if n == nil || n.alarm || n.sitter() != b.res || st == core.NestBuilding || st == core.NestChicks && p.nest.precocial {
		return false
	}
	b.stage = nsSit
	s.fly(b, p, n.perch, noPerch, core.ActFlying, 1, thenRoost)
	return true
}

// placeAtNest puts a bird at its nest when its routine would have it there at this
// hour (activation, fast-forward). h is the bird's placement hash for the hour.
func (s *Sim) placeAtNest(b *bird, p *profile, h uint64) bool {
	n, st := s.activeNest(b)
	if n == nil || n.alarm {
		return false
	}
	sitter := n.sitter() == b.res
	brood := st == core.NestEggs || st == core.NestChicks && p.nest.precocial
	if p.asleep[s.birdPhase(b)] {
		if sitter && (brood || st == core.NestChicks) {
			b.stage = nsSit
			s.teleport(b, n.perch, noPerch, thenRoost)
			return true
		}
		return false
	}
	u := unit(hash2(h, 0x4E455354))
	var odds float32
	switch {
	case brood && sitter:
		odds = 0.7
	case st == core.NestChicks && !p.nest.precocial:
		odds = 0.25
	case st == core.NestBuilding:
		odds = 0.15
	}
	if u >= odds {
		return false
	}
	b.mode, b.timer = mNest, nestTripTimer
	switch {
	case brood && sitter:
		b.stage = nsSit
		s.teleport(b, n.perch, noPerch, thenNestSit)
	case st == core.NestBuilding:
		b.stage, b.n = nsGather, 1
		s.teleport(b, n.perch, noPerch, thenNestBuild)
	default:
		b.stage, b.n = nsFood, 1
		s.teleport(b, n.perch, noPerch, thenNestBuild)
	}
	return true
}

// ---------------------------------------------------------------------------
// The observer near a nest

// nestWatch raises and lowers the nest alarms around the observer. Only cells close
// to the observer (or with a nest still alarmed) are looked at.
func (s *Sim) nestWatch(dt float32) {
	const reach = cellSize*0.75 + 70 // cell half-diagonal plus the largest alarm radius
	for _, c := range s.cellList {
		near := false
		if s.obs.Present {
			x, z := c.key.centre()
			dx, dz := x-s.obs.Pos.X, z-s.obs.Pos.Z
			near = dx*dx+dz*dz < reach*reach
		}
		if !near && c.alarms == 0 {
			continue
		}
		nests := s.cellNests(c)
		for i := range nests {
			n := &nests[i]
			np := &s.prof[n.sp].nest
			st, ok := s.stage(n)
			active := ok && st != core.NestOld
			d2 := distXZ2(n.pos, s.obs.Pos)
			switch {
			case !n.alarm && active && s.obs.Present && d2 < np.alarmR*np.alarmR:
				n.alarm = true
				c.alarms++
				s.nestAlarm(c, n)
			case n.alarm && (!s.obs.Present || !active || d2 > sq(np.alarmR*nestCalmRatio)):
				n.alarm = false
				c.alarms--
				s.nestCalm(c, n)
			case n.alarm:
				s.nestScold(c, n, dt)
			}
		}
	}
}

// mateBird returns the live bird of a nest's mate slot, or nil.
func (s *Sim) mateBird(c *cell, ri int16) *bird {
	if ri < 0 || int(ri) >= len(c.roster) {
		return nil
	}
	bi := c.roster[ri].bird
	if bi < 0 {
		return nil
	}
	b := &s.birds[bi]
	if !b.alive || b.mode == mLeave {
		return nil
	}
	return b
}

// nestAlarm: the observer has come too close. Adults at or near the nest scold and
// leave it; the others simply stay away.
func (s *Sim) nestAlarm(c *cell, n *nestRec) {
	np := &s.prof[n.sp].nest
	for _, ri := range n.mates {
		b := s.mateBird(c, ri)
		if b == nil {
			continue
		}
		p := &s.prof[b.sp]
		if b.mode == mNest || b.mode == mRoost && s.onNest(b) || distXZ2(b.pos, n.pos) < sq(1.6*np.alarmR) {
			s.scold(b, p)
			s.nestFlee(b, p, n)
		} else if distXZ2(b.pos, n.pos) < sq(3*np.alarmR) {
			s.scold(b, p)
		}
	}
}

// nestFlee takes an adult off and away from its nest, to wait at a safe distance.
func (s *Sim) nestFlee(b *bird, p *profile, n *nestRec) {
	s.releaseLure(b)
	b.flags &^= core.FlagHidden
	b.quiet = max32(b.quiet, s.rnd(20, 40))
	// Away from the observer, beyond the nest.
	dx, dz := n.pos.X-s.obs.Pos.X, n.pos.Z-s.obs.Pos.Z
	l := sqrt32(dx*dx + dz*dz)
	if l < 0.01 {
		a := s.rnd(0, 2*math.Pi)
		dx, dz, l = sin32(a), -cos32(a), 1
	}
	a := heading(dx/l, dz/l) + s.rnd(-0.6, 0.6)
	d := p.nest.alarmR*1.6 + s.rnd(5, 15)
	refuge := s.refuge(p, n.pos.X+d*sin32(a), n.pos.Z-d*cos32(a))
	b.mode = mAway
	b.away = s.rnd(20, 45)
	b.stage = 0
	s.fly(b, p, refuge, noPerch, core.ActFlying, 1.2, thenRefuge)
}

// nestScold: while the observer stays, the adults keep up their alarm calls from
// where they wait, watching.
func (s *Sim) nestScold(c *cell, n *nestRec, dt float32) {
	np := &s.prof[n.sp].nest
	for _, ri := range n.mates {
		b := s.mateBird(c, ri)
		if b == nil || b.moving || b.singT > 0 || distXZ2(b.pos, n.pos) > sq(3*np.alarmR) {
			continue
		}
		if s.chance(nestScoldRate * dt) {
			p := &s.prof[b.sp]
			if b.mode == mAway {
				b.act = core.ActAlert
				b.yaw = heading(s.obs.Pos.X-b.pos.X, s.obs.Pos.Z-b.pos.Z)
			}
			s.scold(b, p)
		}
	}
}

// scold gives one bout of the species' alarm call (or its call, if it has none).
func (s *Sim) scold(b *bird, p *profile) {
	ci := p.callAlarm
	if ci < 0 {
		ci = p.callContact
	}
	if ci < 0 {
		ci = 0
	}
	if ci >= len(p.sp.Calls) {
		return
	}
	s.voice(b, p, ci, 1)
}

// nestCalm: the observer has withdrawn; the adults come back soon.
func (s *Sim) nestCalm(c *cell, n *nestRec) {
	for _, ri := range n.mates {
		b := s.mateBird(c, ri)
		if b == nil || b.mode != mAway {
			continue
		}
		if b.act == core.ActAlert {
			b.act = s.restAct(b, &s.prof[b.sp])
		}
		b.away = min32(b.away, s.rnd(4, 12))
	}
}

// ---------------------------------------------------------------------------
// Queries

func (s *Sim) coreNest(n *nestRec, st uint8) core.Nest {
	return core.Nest{ID: n.id, Species: int(n.sp), Site: s.prof[n.sp].nest.site, Stage: st, Pos: n.pos, Size: n.size, Yaw: n.yaw}
}

// Nests appends every nest within radius (3D) of center to buf: the current nests
// of the breeding pairs of the simulated cells, and last season's old nests until
// the next spring. Species is the owner's species index (server truth: never send).
func (s *Sim) Nests(center core.Vec3, radius float32, buf []core.Nest) []core.Nest {
	if !(radius > 0) {
		return buf
	}
	r2 := radius * radius
	k0, k1 := keyAt(center.X-radius-1, center.Z-radius-1), keyAt(center.X+radius+1, center.Z+radius+1)
	if int64(k1.x-k0.x+1)*int64(k1.z-k0.z+1) > int64(len(s.cellList)) {
		for _, c := range s.cellList {
			buf = s.appendNests(c, center, r2, buf)
		}
		return buf
	}
	for kz := k0.z; kz <= k1.z; kz++ {
		for kx := k0.x; kx <= k1.x; kx++ {
			if c := s.cells[cellKey{kx, kz}]; c != nil {
				buf = s.appendNests(c, center, r2, buf)
			}
		}
	}
	return buf
}

func (s *Sim) appendNests(c *cell, center core.Vec3, r2 float32, buf []core.Nest) []core.Nest {
	nests := s.cellNests(c)
	for i := range nests {
		n := &nests[i]
		if dist2(n.pos, center) > r2 {
			continue
		}
		if st, ok := s.stage(n); ok {
			buf = append(buf, s.coreNest(n, st))
		}
	}
	return buf
}

// NestOf returns the nest owned by the pair a bird belongs to (in any stage,
// including an old nest after the season), or false if it has none.
func (s *Sim) NestOf(birdID uint32) (core.Nest, bool) {
	i, ok := s.byID[birdID]
	if !ok {
		return core.Nest{}, false
	}
	n := s.nestOf(&s.birds[i])
	if n == nil {
		return core.Nest{}, false
	}
	st, ok := s.stage(n)
	if !ok {
		return core.Nest{}, false
	}
	return s.coreNest(n, st), true
}
