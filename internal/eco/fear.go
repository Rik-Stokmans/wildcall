package eco

import (
	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Player disturbance (spec 6.4, 12.4). Each bird has a flush distance that depends
// on how the observer moves and how they approach; inside twice that distance fear
// builds (faster the closer they are), outside it fear decays, faster when the
// observer is still. Low fear makes a bird wary, more makes it freeze and watch, and
// at the top it either ducks into cover (skulkers) or flies off to a refuge, from
// which it returns once things are quiet again. Time spent near a calm observer
// habituates a bird, shrinking its flush distance. The aim is to reward patience,
// never to punish.
const (
	fearWary  = 0.15 // FlagWary from here
	fearAlert = 0.4  // freeze and watch (ActAlert)
	fearFlee  = 0.8  // hide or flee
	fearRise  = 0.9  // fear per second at the flush distance (it grows with pressure squared)
	fearDecay = 0.07 // base decay per second once the observer is outside the awareness band

	// awareBand: fear starts building at this multiple of the flush distance.
	awareBand = 2.0

	habitOn   = 0.5      // FlagHabituated from this habituation level
	habitOff  = 0.3      // ...and is lost again below this
	habitRate = 1.0 / 80 // habituation per second near a calm observer (times Habituate x Familiarity)
	habitCut  = 0.55     // a fully habituated bird's flush distance is this much shorter
)

// approach is the approach factor for this bird: 1.3 when the observer is heading
// straight at it, 0.8 when passing by or moving away, 1 when not moving at all.
func (s *Sim) approach(b *bird) float32 {
	if !s.oMoving || (s.oDirX == 0 && s.oDirZ == 0) {
		return 1
	}
	dx, dz := b.pos.X-s.obs.Pos.X, b.pos.Z-s.obs.Pos.Z
	l := sqrt32(dx*dx + dz*dz)
	if l < 0.01 {
		return approachDirect
	}
	c := (dx*s.oDirX + dz*s.oDirZ) / l
	return approachTangential + (approachDirect-approachTangential)*smooth(0.35, 0.9, c)
}

// flushDist is the distance at which this bird flushes from the observer as they
// are moving right now.
func (s *Sim) flushDist(b *bird, p *profile) float32 {
	fd := p.shy * s.oMove * s.approach(b) * s.obs.Stealth * s.oPosture * (1 - habitCut*b.habit)
	switch {
	case b.mode == mHide:
		fd *= 0.5 // feels safe in deep cover
	case b.mode == mRoost:
		fd *= 0.7
	case b.airborne():
		fd *= 0.6 // a bird on the wing is less bothered by someone on the ground
	}
	return fd
}

// disturb updates a bird's fear, habituation and reaction for this tick.
func (s *Sim) disturb(b *bird, p *profile, dt float32) {
	if !s.obs.Present {
		if b.fear > 0 {
			b.fear = max32(0, b.fear-2*fearDecay*dt)
			s.react(b, p, 1e9, 1)
		}
		return
	}
	d2 := dist2(b.pos, s.obs.Pos)
	if d2 > p.senseR2 && b.fear == 0 {
		return // too far away to matter: the common case, kept cheap
	}
	d := sqrt32(d2)
	fd := s.flushDist(b, p)

	band := s.oAware // awareBand, shorter for a prone observer
	if !(band > 1) {
		band = awareBand
	}
	// The ramp keeps the upright slope, so a prone observer is simply noticed later.
	if pr := (band*fd - d) / ((awareBand - 1) * fd); pr > 0 {
		pr = min32(pr, 2.5)
		b.fear += pr * pr * fearRise * dt
		if s.oMoving && d < 0.5*fd && !b.airborne() {
			b.fear = max32(b.fear, fearFlee+0.05) // startled at close quarters
		}
	} else if b.fear > 0 {
		decay := s.oDecay
		if d > 1.5*band*fd {
			decay *= 2 // well out of the way
		}
		b.fear -= decay * dt
	}
	if s.obs.Noise > 0 && d < p.noiseR {
		b.fear += s.obs.Noise * 0.7 * (1 - d/p.noiseR)
	}
	b.fear = clamp(b.fear, 0, 1)

	// Habituation: time near a calm observer, without being frightened.
	if s.oCalm && d2 < p.habitR2 && b.fear < fearAlert {
		r := habitRate * p.habituate * s.obs.Familiarity
		if s.obs.Sitting || (s.obs.Prone && !s.oMoving) {
			r *= 1.4 // settled down: sitting, or lying still
		}
		b.habit = min32(1, b.habit+r*dt)
	} else if s.oMove >= moveRun && d < band*fd {
		b.habit = max32(0, b.habit-0.04*dt)
	}
	if b.habit >= habitOn {
		b.flags |= core.FlagHabituated
	} else if b.habit < habitOff {
		b.flags &^= core.FlagHabituated
	}
	s.react(b, p, d, fd)
}

// react turns the fear level into behaviour.
func (s *Sim) react(b *bird, p *profile, d, fd float32) {
	if b.fear >= fearWary {
		b.flags |= core.FlagWary
	} else if b.fear < fearWary*0.7 && b.flags&core.FlagWary != 0 {
		b.flags &^= core.FlagWary
		if s.obs.Present && !s.oMoving && b.mode != mAway {
			s.noteSettled(b) // calm again while the observer kept still
		}
	}
	switch b.mode {
	case mLeave, mPass:
		return
	case mAway:
		// Already flushed. Only a renewed close approach to its refuge moves it on.
		if !b.moving && b.fear >= fearFlee+0.1 {
			s.flee(b, p)
		}
		return
	}
	if b.moving && b.act == core.ActFleeing {
		return
	}
	switch {
	case b.fear >= fearFlee:
		if b.mode == mHide {
			if d < 0.6*fd {
				s.flee(b, p) // found out: off it goes
			}
			return
		}
		if p.skulk >= 0.5 && d > 0.35*fd && !b.airborne() && s.hide(b, p) {
			return
		}
		s.flee(b, p)
	case b.fear >= fearAlert && b.mode != mAlert && b.mode != mHide && !b.airborne():
		s.alert(b, p)
	}
}

// alert: freeze, face the observer, stop calling.
func (s *Sim) alert(b *bird, p *profile) {
	s.releaseLure(b)
	if b.moving {
		// Stop where it is: a hop or a few steps are simply cut short.
		b.moving = false
		b.cur = noPerch
		b.cover = b.destCover
	}
	b.mode = mAlert
	b.act = core.ActAlert
	b.timer = s.rnd(2, 5)
	b.sub = 0
	b.speed = 0
	b.yaw = heading(s.obs.Pos.X-b.pos.X, s.obs.Pos.Z-b.pos.Z)
	if b.flags&core.FlagSinging != 0 {
		b.flags &^= core.FlagSinging
		b.singT = 0
	}
	// A sharp alarm note is often the first thing the player hears of a bird.
	if p.callAlarm >= 0 && b.quiet <= 0 && s.chance(0.35) {
		s.voice(b, p, p.callAlarm, 1)
	}
	b.quiet = max32(b.quiet, s.rnd(20, 45))
}

// calmCheck lets an alert or hiding bird go back to what it was doing once its fear
// has subsided.
func (s *Sim) calmCheck(b *bird, p *profile, dt float32) {
	b.timer -= dt
	if b.timer > 0 {
		return
	}
	// An alert bird watching a quietly standing observer gives up after a while too.
	if b.fear < fearWary || (b.mode == mAlert && b.fear < fearAlert && b.timer < -12) {
		b.flags &^= core.FlagHidden
		b.quiet = max32(b.quiet, s.rnd(10, 25))
		s.boutEnd(b, p)
		return
	}
	if b.mode == mHide {
		s.hidePeek(b, p, dt) // still uneasy: it shows itself on top of its cover (followflight.go)
	}
}

// hide ducks into the nearest deep cover the species uses: one of its remembered
// perches, or failing that a covered perch of a kind (and height) it likes. It
// returns false if there is none close.
func (s *Sim) hide(b *bird, p *profile) bool {
	found, dest, bestD := false, int8(noPerch), float32(9*9)
	var pc core.Perch
	for i := 0; i < maxMem; i++ {
		if b.has(i) && b.mem[i].Cover >= 0.5 && p.perchPref[b.mem[i].Kind] > 0 {
			if d := distXZ2(b.mem[i].Pos, b.pos); d < bestD {
				found, dest, bestD, pc = true, int8(i), d, b.mem[i]
			}
		}
	}
	if !found && b.cell != nil {
		c := b.cell
		bestC := float32(9 * 9)
		for i, cp := range c.perches {
			if cp.Cover < 0.5 {
				continue
			}
			fit := p.perchFit(cp.Kind, c.perchH[i])
			if fit < suitFit*0.5 {
				continue
			}
			// Nearest wins, but a perch that suits it better may be a little further.
			if d := distXZ2(cp.Pos, b.pos); d < bestD {
				if cost := d / fit; cost < bestC {
					found, dest, bestC, pc = true, noPerch, cost, cp
				}
			}
		}
	}
	if !found {
		return false
	}
	s.releaseLure(b)
	b.flags &^= core.FlagSinging
	b.singT = 0
	b.quiet = max32(b.quiet, s.rnd(30, 60))
	b.mode = mHide
	b.ff.peek, b.ff.peeked = 0, false
	s.fly(b, p, pc, dest, core.ActHiding, 1.2, thenHide)
	return true
}

// flee flushes the bird: off to a refuge away from the observer, with the rest of
// its flock.
func (s *Sim) flee(b *bird, p *profile) {
	s.releaseLure(b)
	b.flags &^= core.FlagSinging | core.FlagHidden
	b.singT = 0
	b.quiet = max32(b.quiet, s.rnd(40, 90))
	b.habit *= 0.6
	b.fear = max32(b.fear, fearFlee)
	b.fled = s.obs.Present

	// Off to a refuge the observer can follow it to, with its flock, reporting the
	// flush (followflight.go).
	s.flushAway(b, p)

	// Flock mates that did not go with it (on a nest, say) are alarmed all the same.
	if b.cell == nil || b.res < 0 {
		return
	}
	lead := b.cell.roster[b.res].lead
	if lead < 0 {
		return
	}
	for i := range b.cell.roster {
		m := &b.cell.roster[i]
		if m.lead != lead || m.bird < 0 {
			continue
		}
		o := &s.birds[m.bird]
		if o != b && o.mode != mAway && o.mode != mLeave && distXZ2(o.pos, b.pos) < 40*40 {
			o.fear = max32(o.fear, fearFlee+0.1)
		}
	}
}

// refuge finds somewhere to sit out a disturbance near (x, z): a perch the species
// likes, at a height that suits it, preferably in cover, or failing that open ground.
func (s *Sim) refuge(p *profile, x, z float32) core.Perch {
	s.scratch = s.t.PerchesNear(x, z, 20, s.scratch[:0])
	best, bestW := -1, float32(0)
	limited := p.hiMax < noHeightLimit
	for i, c := range s.scratch {
		w := p.perchPref[c.Kind] * (0.5 + c.Cover)
		if w <= bestW {
			continue
		}
		if limited {
			w *= p.heightFit(c.Pos.Y - max32(s.t.HeightAt(c.Pos.X, c.Pos.Z), 0))
		}
		if w > bestW && s.perchValid(c) {
			best, bestW = i, w
		}
	}
	if best >= 0 && (!p.lowLiving || bestW >= 0.5*suitFit) {
		return s.scratch[best]
	}
	if pc, ok := s.groundAt(p, x, z, true); ok {
		return pc
	}
	if best >= 0 {
		return s.scratch[best]
	}
	// Over deep water with nowhere to land: circle back over land at a safe height.
	return core.Perch{Pos: core.V(x, max32(s.t.HeightAt(x, z), 0)+20, z)}
}

// comeHome: the disturbance is over; back to the territory, unless the observer is
// still standing right there.
func (s *Sim) comeHome(b *bird, p *profile) {
	i := s.pickMem(b, memGen, maxGen, -1)
	if i < 0 {
		i = s.pickMem(b, 0, maxMem, -1)
	}
	var to core.Perch
	if i >= 0 {
		to = b.mem[i]
	} else if pc, ok := s.groundAt(p, b.home.X, b.home.Z, true); ok {
		to = pc
	} else {
		to = core.Perch{Pos: b.home}
	}
	if s.obs.Present && s.oMoving && distXZ2(to.Pos, s.obs.Pos) < sq(p.shy*1.5) {
		b.away = s.rnd(10, 20)
		return
	}
	b.fear = min32(b.fear, fearWary*0.5)
	b.mode = mIdle
	s.fly(b, p, to, int8(i), core.ActFlying, 1, thenPerch)
}

func sq(v float32) float32 { return v * v }

// settleR: Settled reports birds this close to the observer.
const settleR = 60

// noteSettled records that the bird has visibly settled this Step (Settled).
func (s *Sim) noteSettled(b *bird) {
	if s.silent || !s.obs.Present || distXZ2(b.pos, s.obs.Pos) > settleR*settleR {
		return
	}
	for _, id := range s.settled {
		if id == b.id {
			return
		}
	}
	s.settled = append(s.settled, b.id)
}

// Settled returns the ids of the birds within about 60 m of the observer that,
// during the last Step, visibly settled thanks to the player's patience: a bird that
// had fled from the observer landed back in its territory, or a wary or alert bird
// calmed down while the observer stood still or sat. It is empty most steps. The
// slice is reused (and overwritten) by the next Step: copy what you keep.
func (s *Sim) Settled() []uint32 { return s.settled }
