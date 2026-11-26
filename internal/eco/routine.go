package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// The daily routine: what a bird decides to do when a bout ends, and the small
// steps inside each bout.

// birdPhase is the day phase as this individual feels it: everyone wakes and goes
// to roost a little earlier or later than the clock says.
func (s *Sim) birdPhase(b *bird) core.DayPhase {
	h := s.env.Time + b.jitter
	if h < 0 {
		h += 24
	} else if h >= 24 {
		h -= 24
	}
	return core.PhaseAt(h)
}

// restAct is what a resting bird looks like where it is.
func (s *Sim) restAct(b *bird, p *profile) core.BirdAct {
	switch {
	case b.destKind == core.PerchWater:
		return core.ActSwimming
	case b.destKind == core.PerchShore && p.ground == groundWade:
		return core.ActWading
	}
	return core.ActPerched
}

// rest settles a bird where it is for dur seconds.
func (s *Sim) rest(b *bird, p *profile, dur float32) {
	b.mode = mIdle
	b.act = s.restAct(b, p)
	b.base = b.act
	b.timer = dur
	b.sub = s.rnd(3, 9)
}

// boutEnd decides the next bout.
func (s *Sim) boutEnd(b *bird, p *profile) {
	prev := b.mode
	if !b.airborne() {
		// The bout is over. (A circling or hovering bird keeps its mode until it
		// has flown somewhere else, so it is still known to be in the air.)
		b.mode = mIdle
	}
	s.releaseLure(b)
	b.flags &^= core.FlagHidden
	b.n, b.sub = 0, 0
	ph := s.birdPhase(b)

	if p.asleep[ph] {
		if prev == mRoost && (b.cur == memRoost || b.then == thenRoost && s.onNest(b)) {
			b.mode = mRoost
			b.timer = s.rnd(90, 240) // still night (or still day, for an owl): sleep on
			return
		}
		s.goRoost(b, p)
		return
	}
	// Nest duty comes before everything else the day offers.
	if s.nestBout(b, p) {
		return
	}
	if p.lureEater && b.lureCD <= 0 && s.tryLure(b, p) {
		return
	}
	if l := s.leader(b); l != nil && followable(l) {
		odds := float32(0.85)
		if p.pair {
			odds = 0.5
		}
		if s.chance(odds) {
			s.follow(b, p, l, false)
			return
		}
	}
	if prev == mBathe {
		s.goPerch(b, p, thenPreen) // a bath is always followed by a good preen
		return
	}

	a := p.activity[ph] * s.wxActive
	dawn := s.phase == core.PhaseDawn
	var w [7]float32
	const (
		cFeed = iota
		cSong
		cRest
		cMove
		cPreen
		cBathe
		cSocial
	)
	w[cFeed] = 0.4 + 1.6*a
	if p.boutRate > 0 && b.has(memSong) {
		w[cSong] = 0.6 * a
		if dawn {
			w[cSong] *= 2.5
		}
	}
	w[cRest] = 0.5 + 0.6*(1-a)
	w[cMove] = 0.35
	w[cPreen] = 0.2
	if p.specPreen {
		w[cPreen] = 0.45
	}
	if p.specBathe && b.has(memBath) && s.env.Light > 0.3 && s.env.Rain < 0.3 {
		w[cBathe] = 0.14
	}
	if p.specSocial {
		w[cSocial] = 0.14
	} else if p.flock {
		w[cSocial] = 0.06
	}
	var sum float32
	for _, v := range w {
		sum += v
	}
	u := s.rng.Float32() * sum
	choice := cRest
	for i, v := range w {
		if u < v {
			choice = i
			break
		}
		u -= v
	}

	switch choice {
	case cFeed:
		s.startFeeding(b, p)
	case cSong:
		if b.cur == memSong && !b.airborne() {
			s.rest(b, p, s.rnd(25, 70))
		} else {
			s.fly(b, p, b.mem[memSong], memSong, core.ActFlying, 1, thenSong)
		}
	case cMove:
		s.goPerch(b, p, thenPerch)
	case cPreen:
		if b.airborne() || b.destKind == core.PerchWater && !p.waterBird {
			s.goPerch(b, p, thenPreen)
		} else {
			s.rest(b, p, s.rnd(8, 22))
			b.act = core.ActPreening
		}
	case cBathe:
		s.fly(b, p, b.mem[memBath], memBath, core.ActFlying, 1, thenBathe)
	case cSocial:
		s.social(b, p)
	default:
		if b.airborne() {
			s.goPerch(b, p, thenPerch)
		} else {
			s.rest(b, p, s.rnd(10, 40))
		}
	}
}

// subStep is the next small step within the current bout.
func (s *Sim) subStep(b *bird, p *profile) {
	switch b.mode {
	case mIdle:
		s.idleFidget(b, p)
	case mGround:
		if b.act == core.ActFeeding {
			b.act = b.base
			b.sub = s.rnd(0.5, 1.8)
			return
		}
		if s.chance(0.22) {
			b.act = core.ActFeeding // the catch: a worm, a seed, a beetle
			b.sub = s.rnd(1.5, 4)
			return
		}
		s.groundStep(b, p)
	case mGlean:
		if b.act == core.ActFeeding {
			b.act = b.base
			b.sub = s.rnd(0.4, 1.5)
			return
		}
		switch {
		case s.chance(0.2):
			b.act = core.ActFeeding
			b.sub = s.rnd(1, 3)
		case s.chance(0.12):
			if i := s.pickMem(b, memFeed, maxFeed, int(b.cur)); i >= 0 {
				s.fly(b, p, b.mem[i], int8(i), core.ActFlying, 1, thenGlean)
				return
			}
			s.crownHop(b)
		default:
			s.crownHop(b)
		}
	case mClimb:
		s.climbStep(b, p)
	case mSwim:
		s.swimStep(b, p)
	case mHover:
		s.hoverStep(b, p)
	case mLure:
		if b.act == core.ActFeeding {
			b.act = core.ActForaging
			b.sub = s.rnd(0.6, 1.6)
		} else {
			b.act = core.ActFeeding
			b.sub = s.rnd(2, 5)
		}
	case mNest:
		s.nestStep(b, p)
	}
}

// ---------------------------------------------------------------------------
// Feeding

// startFeeding sends a bird off to feed the way its species does.
func (s *Sim) startFeeding(b *bird, p *profile) {
	feed := p.feed
	// Clinging species creep up trunks a good part of the time whatever they eat.
	if p.ground == groundCling && feed != feedTrunk && s.chance(0.45) && s.pickMem(b, memFeed, maxFeed, -1) >= 0 {
		for i := memFeed; i < memFeed+maxFeed; i++ {
			if b.has(i) && b.mem[i].Kind == core.PerchTrunk {
				s.fly(b, p, b.mem[i], int8(i), core.ActFlying, 1, thenClimb)
				return
			}
		}
	}
	switch feed {
	case feedAerial:
		b.mode, b.anchor = mHawk, b.home
		b.n = int8(4 + s.rng.IntN(5))
		s.hawkLeg(b, p)
		return
	case feedHunt:
		switch {
		case p.soarer && s.thermal > 0.25 && s.chance(0.6):
			s.beginSoar(b, p)
			return
		case p.hoverer:
			if s.hoverAt(b, p, b.home, p.terr*0.6, false) {
				b.n = int8(2 + s.rng.IntN(4))
				return
			}
		}
		// Perch-hunting: watch from a high, open perch, then drop onto prey.
		i := memSong
		if !b.has(i) {
			i = s.pickMem(b, memGen, maxGen, -1)
		}
		if i >= 0 {
			b.n = 1 // one stoop at the end of the watch
			s.fly(b, p, b.mem[i], int8(i), core.ActFlying, 1, thenPerch)
			return
		}
	case feedPlunge:
		for i := memFeed; i < memFeed+maxFeed; i++ {
			if b.has(i) && b.mem[i].Kind == core.PerchWater {
				if s.hoverAt(b, p, b.mem[i].Pos, 15, true) {
					b.n = int8(2 + s.rng.IntN(3))
					return
				}
			}
		}
	}
	pc, i, th, ok := s.feedSpot(b, p)
	if !ok {
		s.rest(b, p, s.rnd(10, 30))
		return
	}
	if !b.airborne() && distXZ2(b.pos, pc.Pos) < 36 && (th == thenForage && b.destKind == core.PerchGround || th == thenSwim && b.destKind == core.PerchWater) {
		// Already there: just start.
		b.dest = int8(i)
		b.then = th
		b.mv = mvGround
		s.arrive(b, p)
		return
	}
	s.fly(b, p, pc, int8(i), core.ActFlying, 1, th)
}

// feedSpot picks where (and how) to feed: a remembered feeding spot, or failing
// that open ground near home.
func (s *Sim) feedSpot(b *bird, p *profile) (core.Perch, int, then, bool) {
	i := s.pickMem(b, memFeed, maxFeed, -1)
	var pc core.Perch
	if i >= 0 {
		pc = b.mem[i]
	} else {
		a := s.rnd(0, 2*math.Pi)
		r := s.rnd(0, min32(p.terr, 25))
		var ok bool
		pc, ok = s.groundAt(p, b.home.X+r*sin32(a), b.home.Z-r*cos32(a), p.waterBird)
		if !ok {
			return core.Perch{}, -1, thenPerch, false
		}
		i = noPerch
	}
	th := thenForage
	switch pc.Kind {
	case core.PerchWater:
		th = thenSwim
	case core.PerchTrunk:
		th = thenClimb
	case core.PerchCanopy, core.PerchBranch, core.PerchShrub, core.PerchReed:
		th = thenGlean
	case core.PerchGround, core.PerchShore:
		th = thenForage
	default:
		th = thenGlean
	}
	return pc, i, th, true
}

func (s *Sim) beginGround(b *bird, p *profile) {
	cont := b.mode == mGround // moving on to the next tree / patch within the same bout
	b.mode = mGround
	b.anchor, b.gy = b.pos, b.pos.Y
	b.base = core.ActForaging
	if p.ground == groundWade || p.feed == feedProbe && b.destKind == core.PerchShore {
		b.base = core.ActWading
	}
	if b.destKind == core.PerchWater {
		b.base = core.ActSwimming
	}
	b.act = b.base
	if !cont {
		b.timer = s.rnd(15, 50)
	}
	b.sub = s.rnd(0.3, 1.5)
}

// groundStep hops or walks to a nearby spot, staying within a few metres of the
// patch it is working.
func (s *Sim) groundStep(b *bird, p *profile) {
	a := s.rnd(0, 2*math.Pi)
	d := p.hopLen * s.rnd(0.6, 1.8)
	x, z := b.pos.X+d*sin32(a), b.pos.Z-d*cos32(a)
	if distXZ2(core.V(x, 0, z), b.anchor) > 7*7 {
		// Wandered too far: head back towards the middle of the patch.
		x, z = lerp(b.pos.X, b.anchor.X, 0.5), lerp(b.pos.Z, b.anchor.Z, 0.5)
	}
	pc, ok := s.groundAt(p, x, z, false)
	if !ok {
		b.sub = s.rnd(0.4, 1.2)
		return
	}
	pc.Cover = b.destCover
	s.stepTo(b, pc, mvGround, p.groundSpeed, thenStep)
	b.act = b.base
}

func (s *Sim) beginGlean(b *bird) {
	cont := b.mode == mGlean // moving on to the next tree / patch within the same bout
	b.mode = mGlean
	b.anchor = b.pos
	b.gy = s.t.HeightAt(b.pos.X, b.pos.Z)
	b.base, b.act = core.ActForaging, core.ActForaging
	if !cont {
		b.timer = s.rnd(15, 45)
	}
	b.sub = s.rnd(0.5, 1.5)
}

// crownHop moves a gleaning bird a little within the crown or bush it is in.
func (s *Sim) crownHop(b *bird) {
	r := float32(1.6)
	if b.destKind == core.PerchShrub || b.destKind == core.PerchReed {
		r = 0.8
	}
	x := b.anchor.X + s.rnd(-r, r)
	z := b.anchor.Z + s.rnd(-r, r)
	y := b.anchor.Y + s.rnd(-1, 0.8)
	// On a slope the ground under the new spot can be higher than under the anchor.
	if g := max32(s.t.HeightAt(x, z), b.gy); y < g+0.3 {
		y = g + 0.3
	}
	if y < b.anchor.Y-1.2 {
		y = b.anchor.Y - 1.2
	}
	to := core.Perch{Pos: core.V(x, max32(y, 0), z), Kind: b.destKind, Cover: b.destCover}
	big := distXZ2(b.pos, to.Pos) > 1
	s.stepTo(b, to, mvGround, 2.5, thenStep)
	b.act = b.base
	if big {
		s.cue(b)
	}
}

func (s *Sim) beginClimb(b *bird) {
	cont := b.mode == mClimb // moving on to the next tree / patch within the same bout
	b.mode = mClimb
	b.anchor = b.pos
	b.base, b.act = core.ActClimbing, core.ActClimbing
	if !cont {
		b.timer = s.rnd(15, 45)
	}
	b.sub = s.rnd(0.5, 1.2)
}

// climbStep creeps up the trunk in jerks, stopping to feed; at the top of its
// climb it drops to the foot of another trunk.
func (s *Sim) climbStep(b *bird, p *profile) {
	if b.act == core.ActFeeding {
		b.act = b.base
		b.sub = s.rnd(0.4, 1.2)
		return
	}
	if s.chance(0.25) {
		b.act = core.ActFeeding
		b.sub = s.rnd(1, 3)
		return
	}
	if b.pos.Y < b.anchor.Y+3 {
		to := core.Perch{Pos: core.V(b.pos.X, b.pos.Y+s.rnd(0.3, 0.7), b.pos.Z), Kind: core.PerchTrunk, Cover: b.destCover}
		s.stepTo(b, to, mvClimb, 0.45, thenStep)
		b.act = core.ActClimbing
		return
	}
	for tries := 0; tries < 3; tries++ {
		if i := s.pickMem(b, memFeed, maxFeed, int(b.cur)); i >= 0 && b.mem[i].Kind == core.PerchTrunk {
			s.fly(b, p, b.mem[i], int8(i), core.ActFlying, 1, thenClimb)
			return
		}
	}
	// Only one trunk to work: drop back down it and start again.
	to := core.Perch{Pos: b.anchor, Kind: core.PerchTrunk, Cover: b.destCover}
	s.fly(b, p, to, noPerch, core.ActFlying, 1, thenClimb)
}

func (s *Sim) beginSwim(b *bird) {
	cont := b.mode == mSwim // moving on to the next tree / patch within the same bout
	b.mode = mSwim
	b.anchor = b.pos
	b.base, b.act = core.ActSwimming, core.ActSwimming
	if !cont {
		b.timer = s.rnd(30, 90)
	}
	b.sub = s.rnd(1, 3)
}

// swimStep paddles about, dabbling or diving now and then.
func (s *Sim) swimStep(b *bird, p *profile) {
	if b.act != b.base {
		b.act = b.base
		b.sub = s.rnd(1, 3)
		return
	}
	if s.chance(0.3) {
		if p.feed == feedDive {
			b.act = core.ActDiving // under for a moment; it surfaces where it went down
		} else {
			b.act = core.ActFeeding
		}
		b.sub = s.rnd(2, 5)
		return
	}
	s.paddle(b, p, 5)
}

// paddle swims to a nearby point of open water.
func (s *Sim) paddle(b *bird, p *profile, r float32) {
	for tries := 0; tries < 2; tries++ {
		a := s.rnd(0, 2*math.Pi)
		d := s.rnd(1, r)
		x, z := b.anchor.X+d*sin32(a), b.anchor.Z-d*cos32(a)
		if s.t.HeightAt(x, z) < -0.1 {
			s.stepTo(b, core.Perch{Pos: core.V(x, 0, z), Kind: core.PerchWater}, mvSwim, p.swimSp, thenStep)
			b.act = b.base
			return
		}
	}
	b.sub = s.rnd(1, 3)
}

// hoverAt takes up a hover over a point near centre (over water if water is true).
func (s *Sim) hoverAt(b *bird, p *profile, centre core.Vec3, r float32, water bool) bool {
	for tries := 0; tries < 3; tries++ {
		a := s.rnd(0, 2*math.Pi)
		d := s.rnd(0, r)
		x, z := centre.X+d*sin32(a), centre.Z-d*cos32(a)
		g := s.t.HeightAt(x, z)
		if water != (g < -0.1) {
			continue
		}
		b.mode = mHover
		b.anchor = core.V(x, max32(g, 0), z)
		at := core.Perch{Pos: core.V(x, b.anchor.Y+p.hoverAlt, z)}
		s.fly(b, p, at, noPerch, core.ActFlying, 1, thenHover)
		return true
	}
	return false
}

// hoverStep: strike, or slide over to another station, or give up.
func (s *Sim) hoverStep(b *bird, p *profile) {
	if s.chance(0.4) {
		kind := core.PerchGround
		if b.anchor.Y <= 0.001 && s.t.HeightAt(b.anchor.X, b.anchor.Z) < 0 {
			kind = core.PerchWater
		}
		s.dive(b, p, core.Perch{Pos: b.anchor, Kind: kind}, thenEat)
		return
	}
	if b.n--; b.n > 0 {
		water := p.feed == feedPlunge
		if s.hoverAt(b, p, b.anchor, 20, water) {
			return
		}
	}
	s.goPerch(b, p, thenPerch)
}

// eat: the stoop or plunge is over. Prey caught on land is eaten there; a fish is
// carried to a perch.
func (s *Sim) eat(b *bird, p *profile) {
	if b.destKind == core.PerchWater && !p.waterBird {
		s.goPerch(b, p, thenEatPerch)
		return
	}
	s.rest(b, p, s.rnd(3, 7))
	b.act = core.ActFeeding
}

// hawkLeg flies the next leg of aerial feeding over the territory.
func (s *Sim) hawkLeg(b *bird, p *profile) {
	if b.n <= 0 {
		s.goPerch(b, p, thenPerch)
		return
	}
	b.n--
	b.mode = mHawk
	a := s.rnd(0, 2*math.Pi)
	d := s.rnd(8, max32(p.terr*0.6, 20))
	x, z := b.anchor.X+d*sin32(a), b.anchor.Z-d*cos32(a)
	g := max32(s.t.HeightAt(x, z), 0)
	to := core.Perch{Pos: core.V(x, g+s.rnd(3, 15), z)}
	s.fly(b, p, to, noPerch, core.ActFlying, 0.9, thenHawk)
}

// beginSoar climbs into a thermal over the territory.
func (s *Sim) beginSoar(b *bird, p *profile) {
	a := s.rnd(0, 2*math.Pi)
	d := s.rnd(0, p.terr*0.5)
	cx, cz := b.home.X+d*sin32(a), b.home.Z-d*cos32(a)
	r := s.rnd(18, 45)
	g := max32(s.t.HeightAt(cx, cz), 0)
	for i := 0; i < 4; i++ {
		ang := float32(i) * math.Pi / 2
		g = max32(g, s.t.HeightAt(cx+r*sin32(ang), cz-r*cos32(ang)))
	}
	b.anchor = core.V(cx, g+p.soarAlt*s.rnd(0.8, 1.2), cz)
	b.sr = r
	b.sph = s.rnd(0, 2*math.Pi)
	s.joinCircle(b, p)
}

func (s *Sim) joinCircle(b *bird, p *profile) {
	b.mode = mSoar
	at := core.Perch{Pos: core.V(b.anchor.X+b.sr*sin32(b.sph), b.anchor.Y, b.anchor.Z-b.sr*cos32(b.sph))}
	s.fly(b, p, at, noPerch, core.ActFlying, 0.8, thenSoar)
}

// ---------------------------------------------------------------------------
// Other bouts

// idleFidget: a resting bird shifts about now and then (a branch hop is a
// conspicuous movement), or drifts on the water.
func (s *Sim) idleFidget(b *bird, p *profile) {
	b.sub = s.rnd(3, 9)
	if b.act != b.base && b.act != core.ActPerched {
		return // preening, displaying, eating: keep at it
	}
	if b.n > 0 && p.feed == feedHunt && s.chance(0.25) {
		// A perch-hunter has spotted something: it drops onto it.
		a := s.rnd(0, 2*math.Pi)
		d := s.rnd(8, 25)
		if pc, ok := s.groundAt(p, b.pos.X+d*sin32(a), b.pos.Z-d*cos32(a), false); ok {
			b.n = 0
			s.dive(b, p, pc, thenEat)
			s.cue(b)
			return
		}
	}
	switch b.destKind {
	case core.PerchCanopy, core.PerchBranch, core.PerchShrub, core.PerchReed:
		if s.chance(0.3) {
			b.anchor = b.pos
			b.gy = s.t.HeightAt(b.pos.X, b.pos.Z)
			s.crownHop(b)
			b.act = b.base
		}
	case core.PerchWater:
		if s.chance(0.5) {
			b.anchor = b.pos
			s.paddle(b, p, 3)
		}
	}
}

// social: a display, a chase, flock chatter; mates close by join in.
func (s *Sim) social(b *bird, p *profile) {
	if b.airborne() {
		s.goPerch(b, p, thenSocial)
		return
	}
	dur := s.rnd(5, 12)
	s.rest(b, p, dur)
	b.act = core.ActSocial
	if b.cell == nil {
		return
	}
	r := b.cell.roster[b.res]
	if r.lead < 0 {
		return
	}
	for i := range b.cell.roster {
		m := &b.cell.roster[i]
		if m.lead != r.lead || m.bird < 0 {
			continue
		}
		o := &s.birds[m.bird]
		if o != b && !o.moving && o.mode == mIdle && distXZ2(o.pos, b.pos) < 15*15 {
			o.act, o.timer = core.ActSocial, dur
		}
	}
}

func (s *Sim) goRoost(b *bird, p *profile) {
	// A bird with eggs or small chicks spends the night (an owl: the day) on them.
	if s.roostOnNest(b, p) {
		return
	}
	if !b.has(memRoost) {
		s.goPerch(b, p, thenRoost)
		return
	}
	s.fly(b, p, b.mem[memRoost], memRoost, core.ActFlying, 1, thenRoost)
}

// goPerch flies to one of the bird's everyday perches.
func (s *Sim) goPerch(b *bird, p *profile, th then) {
	i := s.pickMem(b, memGen, maxGen, int(b.cur))
	if i < 0 {
		i = s.pickMem(b, 0, maxMem, int(b.cur))
	}
	if i < 0 {
		if pc, ok := s.groundAt(p, b.home.X, b.home.Z, true); ok {
			s.fly(b, p, pc, noPerch, core.ActFlying, 1, th)
			return
		}
		// Nowhere to go at all (should not happen): stay put, settled.
		b.moving = false
		b.then = th
		s.arrive(b, p)
		return
	}
	s.fly(b, p, b.mem[i], int8(i), core.ActFlying, 1, th)
}

// pickMem picks one of the remembered perches in [lo, lo+n) at random, avoiding
// skip if there is any other choice. It returns -1 if there are none.
func (s *Sim) pickMem(b *bird, lo, n, skip int) int {
	var idx [maxMem]int8
	k := 0
	// Birds do not choose to land right next to a person: perches inside their
	// comfort distance are passed over while there is any other choice.
	var comfort2 float32
	if s.obs.Present {
		c := s.prof[b.sp].shy * 0.8 * (1 - habitCut*b.habit)
		comfort2 = c * c
	}
	for pass := 0; pass < 2 && k == 0; pass++ {
		for i := lo; i < lo+n && i < maxMem; i++ {
			if b.has(i) && i != skip && (pass == 1 || comfort2 == 0 || distXZ2(b.mem[i].Pos, s.obs.Pos) > comfort2) {
				idx[k] = int8(i)
				k++
			}
		}
	}
	if k == 0 {
		if b.has(skip) && skip >= lo && skip < lo+n {
			return skip
		}
		return -1
	}
	return int(idx[s.rng.IntN(k)])
}

// ---------------------------------------------------------------------------
// Flocks and pairs

// followable: a leader that is calmly going about its day.
func followable(l *bird) bool {
	switch l.mode {
	case mAway, mLeave, mHide, mAlert, mNest, mBathe:
		return false
	}
	return !(l.moving && l.act == core.ActFleeing)
}

// follow joins the leader: the same kind of bout at a spot next to it. With
// teleport it is placed there directly (activation).
func (s *Sim) follow(b *bird, p *profile, l *bird, teleport bool) {
	if l.mode == mSoar || (l.moving && l.then == thenSoar) {
		b.anchor = l.anchor
		b.sr = l.sr * s.rnd(0.8, 1.25)
		b.sph = l.sph + s.rnd(0.6, 2.5)
		b.anchor.Y += s.rnd(-4, 6)
		if teleport {
			b.mode, b.act, b.timer = mSoar, core.ActSoaring, s.rnd(40, 120)
			s.soarTick(b, 0)
			return
		}
		s.joinCircle(b, p)
		return
	}
	target, kind, mode := l.pos, l.destKind, l.mode
	th := thenPerch
	if l.moving {
		target = l.to
		switch l.then {
		case thenForage:
			mode = mGround
		case thenSwim:
			mode = mSwim
		case thenGlean:
			mode = mGlean
		case thenRoost:
			mode = mRoost
		default:
			mode = mIdle
		}
	}
	switch mode {
	case mGround:
		th = thenForage
	case mSwim:
		th = thenSwim
	case mGlean:
		th = thenGlean
	case mRoost:
		th = thenRoost
	}
	spot := s.spotNear(b, p, target, kind)
	if teleport {
		s.teleport(b, spot, noPerch, th)
		return
	}
	if distXZ2(b.pos, spot.Pos) < 4 && !b.airborne() {
		b.then, b.mv = th, mvGround
		b.destKind, b.destCover = spot.Kind, spot.Cover
		s.arrive(b, p)
		return
	}
	s.fly(b, p, spot, noPerch, core.ActFlying, 1, th)
}

// keepUp: a flock member that sees its leader fly off goes with it.
func (s *Sim) keepUp(b *bird, p *profile, dt float32) {
	switch b.mode {
	case mIdle, mGround, mGlean, mSwim:
	default:
		return
	}
	if b.fear >= fearAlert {
		return
	}
	l := s.leader(b)
	if l == nil || !l.moving || l.mv != mvFly || !followable(l) {
		return
	}
	if distXZ2(b.pos, l.to) < 12*12 || !s.chance(1.8*dt) {
		return
	}
	s.releaseLure(b)
	s.follow(b, p, l, false)
}

// spotNear finds a place for a flock member next to target, of the same kind as
// the leader's perch.
func (s *Sim) spotNear(b *bird, p *profile, target core.Vec3, kind core.PerchKind) core.Perch {
	h := hash2(b.seed, 0x464C4F43)
	a := unit(h) * 2 * math.Pi
	r := 1.5 + 3.5*unit(h>>20)
	x, z := target.X+r*sin32(a), target.Z-r*cos32(a)
	switch kind {
	case core.PerchGround, core.PerchShore:
		if pc, ok := s.groundAt(p, x, z, false); ok {
			return pc
		}
	case core.PerchWater:
		if s.t.HeightAt(x, z) < -0.1 {
			return core.Perch{Pos: core.V(x, 0, z), Kind: core.PerchWater}
		}
	default:
		// Another perch of the same kind close by, if the cell knows one.
		if b.cell != nil {
			best, bestD := -1, float32(12*12)
			for i, pc := range b.cell.perches {
				if pc.Kind != kind {
					continue
				}
				if d := distXZ2(pc.Pos, core.V(x, 0, z)); d < bestD {
					best, bestD = i, d
				}
			}
			if best >= 0 {
				return b.cell.perches[best]
			}
		}
	}
	// Right next to the leader on the same perch. Tree perches sit exactly on a drawn
	// limb, so a follower may only shuffle a few centimetres along from the leader or it
	// would hang in the air beside the branch; on the ground or water there is room to
	// spread out.
	j := float32(0.1)
	if kind == core.PerchGround || kind == core.PerchShore || kind == core.PerchWater {
		j = 0.35
	}
	return core.Perch{Pos: core.V(target.X+j*sin32(a), target.Y, target.Z-j*cos32(a)), Kind: kind, Cover: b.destCover}
}

// ---------------------------------------------------------------------------
// Placement

// place puts a bird where its routine has it at this time of day (activation,
// fast-forward). Where it is depends only on who it is and the quarter-hour, so
// coming back to a place finds the bird in a place that makes sense for the hour.
func (s *Sim) place(b *bird) {
	p := &s.prof[b.sp]
	s.releaseLure(b)
	b.moving = false
	b.fear, b.singT, b.quiet, b.away = 0, 0, 0, 0
	b.flags &^= core.FlagSinging | core.FlagWary | core.FlagHidden
	b.n, b.timer, b.sub = 0, 0, 0
	b.callCD = s.rnd(0, 20)

	h := hash2(b.seed, uint64(int64(s.abs*4)))
	if s.placeAtNest(b, p, h) {
		return
	}
	if l := s.leader(b); l != nil && followable(l) && !l.moving {
		s.follow(b, p, l, true)
		return
	}
	if p.asleep[s.birdPhase(b)] {
		i := memRoost
		if !b.has(i) {
			i = s.pickMem(b, 0, maxMem, -1)
		}
		s.placeAt(b, p, i, thenRoost)
		return
	}
	u := unit(h)
	switch {
	case p.soarer && s.thermal > 0.3 && u < 0.2:
		s.beginSoar(b, p)
		b.moving = false
		b.mode, b.act, b.timer = mSoar, core.ActSoaring, s.rnd(40, 150)
		s.soarTick(b, 0)
	case u < 0.55:
		if pc, i, th, ok := s.feedSpot(b, p); ok {
			s.teleport(b, pc, int8(i), th)
			return
		}
		s.placeAt(b, p, s.pickMem(b, memGen, maxGen, -1), thenPerch)
	case u < 0.75 && b.has(memSong):
		s.placeAt(b, p, memSong, thenSong)
	default:
		s.placeAt(b, p, s.pickMem(b, memGen, maxGen, -1), thenPerch)
	}
}

func (s *Sim) placeAt(b *bird, p *profile, i int, th then) {
	if i < 0 {
		i = s.pickMem(b, 0, maxMem, -1)
	}
	if i < 0 {
		pc, ok := s.groundAt(p, b.home.X, b.home.Z, true)
		if !ok {
			pc = core.Perch{Pos: core.V(b.home.X, max32(b.home.Y, 0), b.home.Z)}
		}
		s.teleport(b, pc, noPerch, th)
		return
	}
	s.teleport(b, b.mem[i], int8(i), th)
}
