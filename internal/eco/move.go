package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Movement: flights along terrain-clearing arcs with a per-style wobble, hops and
// walks that follow the ground, paddling on the water plane, creeping up trunks,
// stoops, circling and hovering. Every position a bird is given is on or above the
// ground and never below the water plane.

const (
	takeoffTime = 0.25 // seconds added to every flight for the take-off and landing
	cruiseFlat  = 40   // flights longer than this (m) use the flat-topped cruise profile
)

// fly starts a flight to perch to (memory index dest, or noPerch) showing act on
// the way (ActFlying, ActFleeing...), at the species' cruise speed times mul. When
// it lands the bird does th.
func (s *Sim) fly(b *bird, p *profile, to core.Perch, dest int8, act core.BirdAct, mul float32, th then) {
	b.from, b.to = b.pos, to.Pos
	b.destKind, b.destCover, b.dest = to.Kind, to.Cover, dest
	dx, dy, dz := b.to.X-b.from.X, b.to.Y-b.from.Y, b.to.Z-b.from.Z
	hl := sqrt32(dx*dx + dz*dz)
	l := sqrt32(dx*dx + dy*dy + dz*dz)

	speed := p.speed * mul
	if hl < 8 {
		speed = min32(speed, 2.5+0.8*hl) // a short hop between branches is unhurried
	}
	b.mv, b.style = mvFly, p.flight
	b.moving, b.mt, b.then, b.act = true, 0, th, act
	b.mdur = l/speed + takeoffTime
	b.speed = l / b.mdur
	b.cur, b.cover = noPerch, 0
	if hl > 0.01 {
		b.yaw = heading(dx, dz)
		b.perpX, b.perpZ = -dz/hl, dx/hl
	}

	// Height profile: a parabola for short flights, a flat-topped cruise for long
	// ones, lifted until it clears the ground sampled along the way.
	b.flat = hl > cruiseFlat
	b.wob = p.wobAmp * min32(1, hl/15)
	if act == core.ActFleeing {
		b.wob *= 0.5
	}
	b.wfreq = p.wobFreq
	lift := clamp(hl*0.12, 0.3, 10)
	if act == core.ActFleeing {
		lift *= 1.5
	}
	// Clearance grows with distance: a hop inside a crown needs little, a long
	// flight goes over the tree tops.
	clear := 1.2 + b.wob + clamp((hl-10)/50, 0, 1)*14
	n := int(hl / 18)
	if n > 8 {
		n = 8
	}
	if hl > 3 && n < 1 {
		n = 1
	}
	for i := 1; i <= n; i++ {
		t := float32(i) / float32(n+1)
		g := max32(s.t.HeightAt(b.from.X+dx*t, b.from.Z+dz*t), 0)
		need := g + clear - (b.from.Y + dy*t)
		if a := arcShape(t, b.flat); a > 0.05 && need/a > lift {
			lift = need / a
		}
	}
	b.lift = min32(lift, 80)
	s.cue(b) // take-off
}

// stepTo starts a ground-level move (a hop, a walk, paddling, creeping) of kind mv
// to perch to at speed m/s. The act does not change.
func (s *Sim) stepTo(b *bird, to core.Perch, mv moveKind, speed float32, th then) {
	b.from, b.to = b.pos, to.Pos
	b.destKind, b.destCover, b.dest = to.Kind, to.Cover, noPerch
	dx, dy, dz := b.to.X-b.from.X, b.to.Y-b.from.Y, b.to.Z-b.from.Z
	l := sqrt32(dx*dx + dy*dy + dz*dz)
	b.mv, b.moving, b.mt, b.then = mv, true, 0, th
	b.mdur = max32(l/max32(speed, 0.1), 0.15)
	b.speed = l / b.mdur
	b.lift, b.wob = 0, 0
	if dx*dx+dz*dz > 1e-4 {
		b.yaw = heading(dx, dz)
	}
	b.cur = noPerch
}

// dive starts a stoop or plunge to the point to (on the ground or the water
// surface).
func (s *Sim) dive(b *bird, p *profile, to core.Perch, th then) {
	s.stepTo(b, to, mvDive, p.speed*1.6, th)
	b.act = core.ActDiving
	b.cover = 0
}

func arcShape(t float32, flat bool) float32 {
	if flat {
		return smooth(0, 0.22, t) * (1 - smooth(0.78, 1, t))
	}
	return 4 * t * (1 - t)
}

func smooth(lo, hi, x float32) float32 {
	t := clamp((x-lo)/(hi-lo), 0, 1)
	return t * t * (3 - 2*t)
}

// advance moves a bird along its current move.
func (s *Sim) advance(b *bird, p *profile, dt float32) {
	b.mt += dt
	t := b.mt / b.mdur
	if t >= 1 {
		b.pos = b.to
		b.moving = false
		s.arrive(b, p)
		return
	}
	prev := b.pos
	var x, y, z float32
	switch b.mv {
	case mvFly:
		e := t * t * (3 - 2*t)
		x = lerp(b.from.X, b.to.X, e)
		z = lerp(b.from.Z, b.to.Z, e)
		y = lerp(b.from.Y, b.to.Y, e) + b.lift*arcShape(t, b.flat)
		if b.wob != 0 {
			w := b.wob * 4 * t * (1 - t) * sin32(b.wfreq*b.mt)
			switch b.style {
			case flyDarting:
				x += b.perpX * w
				z += b.perpZ * w
			case flyUndulating:
				// Bounding flight: bursts of wingbeats up, closed-wing swoops down.
				y += w*0.5 + b.wob*0.5*4*t*(1-t)
			default:
				y += w
			}
		}
	case mvDive:
		e := t * t
		x = lerp(b.from.X, b.to.X, e)
		y = lerp(b.from.Y, b.to.Y, e)
		z = lerp(b.from.Z, b.to.Z, e)
	default:
		x = lerp(b.from.X, b.to.X, t)
		y = lerp(b.from.Y, b.to.Y, t)
		z = lerp(b.from.Z, b.to.Z, t)
	}
	if y < 0 {
		y = 0 // never below the water plane
	}
	b.pos = core.Vec3{X: x, Y: y, Z: z}
	if dt > 0 {
		dx, dz := x-prev.X, z-prev.Z
		if dx*dx+dz*dz > 1e-6 {
			b.yaw = heading(dx, dz)
		}
	}
}

// arrive finishes a move and starts whatever comes next.
func (s *Sim) arrive(b *bird, p *profile) {
	b.speed = 0
	b.cur = b.dest
	b.cover = b.destCover
	if b.mv == mvFly {
		s.cue(b) // landing
	}
	switch b.then {
	case thenStep:
		b.act = b.base
		b.sub = s.rnd(0.4, 1.6)
	case thenPerch:
		s.rest(b, p, s.rnd(8, 35))
	case thenSong:
		s.rest(b, p, s.rnd(25, 70))
		if b.callCD > 2 {
			b.callCD = s.rnd(0.5, 2)
		}
	case thenPreen:
		s.rest(b, p, s.rnd(8, 22))
		b.act = core.ActPreening
	case thenForage:
		s.beginGround(b, p)
	case thenGlean:
		s.beginGlean(b)
	case thenClimb:
		s.beginClimb(b)
	case thenSwim:
		s.beginSwim(b)
	case thenHover:
		b.mode, b.act, b.cover = mHover, core.ActHovering, 0
		b.sub = s.rnd(2, 6)
	case thenEat:
		s.eat(b, p)
	case thenEatPerch:
		s.rest(b, p, s.rnd(3, 7))
		b.act = core.ActFeeding
	case thenHawk:
		s.hawkLeg(b, p)
	case thenSoar:
		b.mode, b.act, b.cover = mSoar, core.ActSoaring, 0
		b.timer = s.rnd(40, 150)
	case thenLure:
		b.mode, b.act, b.base = mLure, core.ActFeeding, core.ActForaging
		b.timer = s.rnd(10, 25)
		b.sub = s.rnd(1.5, 4)
	case thenBathe:
		b.mode, b.act = mBathe, core.ActBathing
		b.timer = s.rnd(6, 14)
	case thenNestPick, thenNestBuild:
		b.mode, b.act = mNest, core.ActNesting
		b.stage = uint8(b.then)
		b.sub = s.rnd(1.5, 4)
	case thenSocial:
		s.rest(b, p, s.rnd(5, 12))
		b.act = core.ActSocial
	case thenRoost:
		b.mode, b.act = mRoost, core.ActRoosting
		b.timer = s.rnd(90, 240)
		b.sub = 0
	case thenHide:
		b.mode, b.act = mHide, core.ActHiding
		b.flags |= core.FlagHidden
		b.timer = s.rnd(8, 20)
	case thenRefuge:
		b.mode, b.act = mAway, s.restAct(b, p)
	case thenGone:
		if i, ok := s.byID[b.id]; ok {
			s.despawn(i)
		}
	}
}

// teleport puts a bird straight onto a perch (placement, never in view of a move).
func (s *Sim) teleport(b *bird, to core.Perch, dest int8, th then) {
	p := &s.prof[b.sp]
	b.pos, b.from, b.to = to.Pos, to.Pos, to.Pos
	b.destKind, b.destCover, b.dest = to.Kind, to.Cover, dest
	b.moving, b.mv, b.then = false, mvGround, th
	b.yaw = unit(hash2(b.seed, uint64(s.tick))) * 2 * math.Pi
	s.arrive(b, p)
}

// soarTick moves a circling bird around its thermal.
func (s *Sim) soarTick(b *bird, dt float32) {
	w := s.prof[b.sp].speed * 0.7 / max32(b.sr, 8)
	b.sph += w * dt * b.sdir
	if b.sph > 2*math.Pi {
		b.sph -= 2 * math.Pi
	} else if b.sph < 0 {
		b.sph += 2 * math.Pi
	}
	b.pos = core.Vec3{
		X: b.anchor.X + b.sr*sin32(b.sph),
		Y: b.anchor.Y + 3*sin32(b.sph*0.5+float32(b.id&7)),
		Z: b.anchor.Z - b.sr*cos32(b.sph),
	}
	b.yaw = b.sph + b.sdir*math.Pi/2
	if b.yaw < 0 {
		b.yaw += 2 * math.Pi
	} else if b.yaw >= 2*math.Pi {
		b.yaw -= 2 * math.Pi
	}
	b.speed = w * b.sr
	b.act = core.ActSoaring
}

// hoverTick holds a hovering bird in place with a slight bob.
func (s *Sim) hoverTick(b *bird, dt float32) {
	b.mt += dt
	h := s.prof[b.sp].hoverAlt
	b.pos = core.Vec3{X: b.anchor.X, Y: b.anchor.Y + h + 0.25*sin32(b.mt*3.1), Z: b.anchor.Z}
	b.speed = 0
}

// cue reports a conspicuous movement close to the observer (take-off, landing,
// branch hop) for the movement cues.
func (s *Sim) cue(b *bird) {
	if s.silent || !s.obs.Present || distXZ2(b.pos, s.obs.Pos) > moveCueRadius*moveCueRadius {
		return
	}
	s.events = append(s.events, core.EcoEvent{Kind: core.EvMove, Bird: b.id, Species: int(b.sp), Pos: b.pos})
}

// groundAt returns a standing place at (x, z): on land, or (for birds that may) in
// the shallows or on the water. ok is false if the bird cannot stand there.
func (s *Sim) groundAt(p *profile, x, z float32, water bool) (core.Perch, bool) {
	g := s.t.HeightAt(x, z)
	switch {
	case g >= 0.02:
		return core.Perch{Pos: core.V(x, g, z), Kind: core.PerchGround, Cover: 0.1}, true
	case water && p.waterBird && g < -0.1:
		return core.Perch{Pos: core.V(x, 0, z), Kind: core.PerchWater}, true
	case p.ground == groundWade && g > -0.45:
		return core.Perch{Pos: core.V(x, 0, z), Kind: core.PerchShore}, true
	}
	return core.Perch{}, false
}
