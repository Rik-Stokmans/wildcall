package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Predator passes. Now and then a bird of prey that lives nearby (a common buzzard
// in the woods, a marsh harrier over the reeds, a golden eagle in the high country
// - whichever raptor the active cells hold) sweeps low over the area where the
// observer is. The small birds below it give their alarm calls, freeze for a heart
// beat and dive into cover; a little later they come out again and carry on. The
// raptor then goes back to its own business. No new birds are created: an existing
// raptor is steered through the pass.

const (
	passFirstMin = 240  // seconds (real) before the first pass after the observer arrives
	passFirstMax = 720  //
	passGapMin   = 600  // seconds between passes: one every 10-20 minutes at most
	passGapMax   = 1200 //
	passRetry    = 120  // seconds before another try when no raptor was about
	passReach    = 650  // metres: a raptor this close to the observer may make the pass
	passHalf     = 75   // half length of the low leg, metres
	passLow      = 6    // metres above the ground (plus the canopy) on the low leg
	passAlarmR   = 40   // small birds this close to the raptor react
	passScan     = 0.2  // seconds between scans for birds below the raptor
	smallBird    = 0.3  // metres: birds shorter than this fear a passing raptor
)

type predPass struct {
	seq   uint32
	slot  int32
	id    uint32 // the raptor (0 = no pass in progress)
	from  core.Vec3
	entry core.Vec3
	exit  core.Vec3
	leg   int     // 0: approach, 1: the low sweep
	d     float32 // metres flown along the current leg
	scan  float32
}

// predTick starts, flies and ends predator passes. Called once per Step.
func (s *Sim) predTick(dt float32) {
	if s.pass.id == 0 {
		if !s.obs.Present {
			return
		}
		if s.passCD < 0 {
			s.passCD = s.rnd(passFirstMin, passFirstMax)
		}
		if s.passCD -= dt; s.passCD > 0 {
			return
		}
		if !s.startPass() {
			s.passCD = passRetry
		}
		return
	}
	ps := &s.pass
	b := &s.birds[ps.slot]
	if !b.alive || b.id != ps.id || b.mode != mPass {
		s.endPass(nil)
		return
	}
	p := &s.prof[b.sp]
	a, z := ps.from, ps.entry
	if ps.leg == 1 {
		a, z = ps.entry, ps.exit
	}
	dx, dz := z.X-a.X, z.Z-a.Z
	l := sqrt32(dx*dx + dz*dz)
	ps.d += p.speed * dt
	if ps.d >= l {
		if ps.leg == 1 {
			s.endPass(b)
			return
		}
		ps.leg, ps.d = 1, 0
		return
	}
	t := ps.d / max32(l, 0.01)
	x, zz := lerp(a.X, z.X, t), lerp(a.Z, z.Z, t)
	low := s.passHeight(x, zz)
	y := low
	if ps.leg == 0 {
		y = max32(lerp(a.Y, z.Y, t*t*(3-2*t)), low)
	}
	b.pos = core.V(x, y, zz)
	b.yaw = heading(dx, dz)
	b.speed = p.speed
	b.act = core.ActFlying
	if ps.scan -= dt; ps.scan <= 0 {
		ps.scan = passScan
		s.alarmBelow(b)
	}
}

// passHeight is the height of the low sweep over (x, z): just over the bushes in
// the open, just over the crowns in the wood.
func (s *Sim) passHeight(x, z float32) float32 {
	return max32(s.t.HeightAt(x, z), 0) + passLow + 12*s.t.Cover(x, z)
}

// startPass picks a raptor near the observer and sends it on a low sweep past them.
// It reports whether one went.
func (s *Sim) startPass() bool {
	if s.phase == core.PhaseNight {
		return false
	}
	pick, seen := int32(-1), 0
	for i := range s.birds {
		b := &s.birds[i]
		if !b.alive || b.moving && b.act == core.ActFleeing {
			continue
		}
		p := &s.prof[b.sp]
		if !p.raptor || p.asleep[s.birdPhase(b)] || distXZ2(b.pos, s.obs.Pos) > passReach*passReach {
			continue
		}
		switch b.mode {
		case mAway, mLeave, mNest, mRoost, mHide, mAlert:
			continue
		}
		seen++
		if s.rng.IntN(seen) == 0 {
			pick = int32(i)
		}
	}
	if pick < 0 {
		return false
	}
	b := &s.birds[pick]
	// The sweep passes 10-35 m from the observer in a random direction.
	a := s.rnd(0, 2*math.Pi)
	r := s.rnd(10, 35)
	cx, cz := s.obs.Pos.X+r*sin32(a), s.obs.Pos.Z-r*cos32(a)
	h := s.rnd(0, 2*math.Pi)
	ux, uz := sin32(h), -cos32(h)
	ex, ez := cx-passHalf*ux, cz-passHalf*uz
	s.passSeq++
	s.pass = predPass{
		seq: s.passSeq, slot: pick, id: b.id, from: b.pos,
		entry: core.V(ex, s.passHeight(ex, ez), ez),
		exit:  core.V(cx+passHalf*ux, 0, cz+passHalf*uz),
	}
	s.releaseLure(b)
	b.moving = false
	b.mode = mPass
	b.cur, b.cover = noPerch, 0
	b.flags &^= core.FlagHidden
	b.act = core.ActFlying
	return true
}

// endPass ends the pass; the raptor (if still about) flies back to its territory.
func (s *Sim) endPass(b *bird) {
	if b != nil {
		b.mode = mIdle
		s.goPerch(b, &s.prof[b.sp], thenPerch)
	}
	s.pass = predPass{}
	s.passCD = s.rnd(passGapMin, passGapMax)
}

// alarmBelow: the small birds within reach of the low-flying raptor raise the
// alarm and dive for cover.
func (s *Sim) alarmBelow(r *bird) {
	const reach2 = passAlarmR * passAlarmR
	x0, x1 := gridCoord(r.pos.X-passAlarmR), gridCoord(r.pos.X+passAlarmR)
	z0, z1 := gridCoord(r.pos.Z-passAlarmR), gridCoord(r.pos.Z+passAlarmR)
	for gz := z0; gz <= z1; gz++ {
		for gx := x0; gx <= x1; gx++ {
			for i := s.grid[gridSlot(gx, gz)]; i >= 0; i = s.birds[i].gnext {
				o := &s.birds[i]
				if o.passSeq == s.pass.seq || dist2(o.pos, r.pos) > reach2 {
					continue
				}
				s.takeCover(o)
			}
		}
	}
}

// takeCover: one small bird sees the raptor. It gives the alarm, freezes for a
// moment and then dives into the nearest cover (predHide).
func (s *Sim) takeCover(b *bird) {
	p := &s.prof[b.sp]
	if !p.small || !b.alive {
		return
	}
	b.passSeq = s.pass.seq
	switch b.mode {
	case mAway, mLeave, mHide, mRoost, mPass:
		return
	case mNest:
		if b.stage == nsSit {
			return // a sitting bird sits tight
		}
	}
	s.releaseLure(b)
	b.mixed = 0
	ci := p.callAlarm
	if ci < 0 {
		ci = 0
	}
	if ci < len(p.sp.Calls) && b.quiet <= 0 {
		s.voice(b, p, ci, 1)
	}
	b.quiet = max32(b.quiet, s.rnd(15, 30))
	if b.moving && b.mv == mvFly {
		b.dive = 0.01 // already in the air: straight into cover
	} else {
		if b.moving {
			b.moving = false
			b.cur = noPerch
			b.cover = b.destCover
		}
		b.mode = mAlert
		b.act = core.ActAlert
		b.timer = 30 // calmCheck must not release it before it dives
		b.speed = 0
		b.dive = max32(b.singT, 0) + s.rnd(0.15, 0.5)
	}
}

// predHide dives into the nearest cover after a raptor alarm, or flattens itself
// where it is if there is none.
func (s *Sim) predHide(b *bird, p *profile) {
	b.flags &^= core.FlagSinging
	b.singT = 0
	found, dest, bestD := false, int8(noPerch), float32(15*15)
	var pc core.Perch
	for i := 0; i < maxMem; i++ {
		if b.has(i) && b.mem[i].Cover >= 0.45 {
			if d := distXZ2(b.mem[i].Pos, b.pos); d < bestD {
				found, dest, bestD, pc = true, int8(i), d, b.mem[i]
			}
		}
	}
	if !found && b.cell != nil {
		c := b.cell
		for i, cp := range c.perches {
			if cp.Cover < 0.45 || p.perchFit(cp.Kind, c.perchH[i]) <= 0 {
				continue
			}
			if d := distXZ2(cp.Pos, b.pos); d < bestD {
				found, dest, bestD, pc = true, noPerch, d, cp
			}
		}
	}
	b.mode = mHide
	if found {
		s.fly(b, p, pc, dest, core.ActHiding, 1.3, thenHide)
		return
	}
	if b.moving || b.airborne() {
		if g, ok := s.groundAt(p, b.pos.X, b.pos.Z, true); ok {
			s.fly(b, p, g, noPerch, core.ActHiding, 1.3, thenHide)
			return
		}
	}
	// Nowhere to go: freeze flat where it is.
	b.moving = false
	b.act = core.ActHiding
	b.flags |= core.FlagHidden
	b.timer = s.rnd(8, 20)
}

// PredatorPass reports the raptor currently making a low pass near the observer
// (its bird id) and whether a pass is in progress.
func (s *Sim) PredatorPass() (raptorID uint32, active bool) {
	return s.pass.id, s.pass.id != 0
}
