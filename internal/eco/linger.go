package eco

import "github.com/Rik-Stokmans/wildcall/internal/core"

// Birds that do not vanish while you search. A bird a person is quietly closing in
// on (walking, creeping or standing still within lingerNear metres) does not fly off
// to the far side of its territory every time a bout ends: it stays where it is for
// at least lingerHoldMin..+lingerHoldVar seconds after its last move, and when it
// does move it makes a short, visible hop of at most lingerMax metres to an open
// perch close by. Being flushed (fear: hiding, fleeing) is unaffected, and so are
// flocks, nest duty, lures and anything airborne: this only tames the everyday
// "fly somewhere else" of a bird going about its day.
const (
	lingerHop     = 3  // m: a flight longer than this counts as a relocation (resets bird.since)
	lingerNear    = 30 // m from the observer
	lingerMax     = 8  // m: the longest move such a bird makes
	lingerHoldMin = 30 // s since its last relocation before it moves again
	lingerHoldVar = 15 // s: per-bird extra (30-45 s in all)
)

// lingerHold is how long this bird stays put after a relocation while someone is
// closing in on it.
func lingerHold(b *bird) float32 {
	return lingerHoldMin + lingerHoldVar*unit(hash2(b.seed, 0x4C494E47))
}

// linger is called at the start of every flight (fly). It may shorten the flight to
// a hop to an exposed perch close by (rewriting to and dest), or cancel it: then the
// bird has already been settled where it is with the flight's follow-up (th) and
// linger reports true. It also keeps bird.since, the time since the last relocation.
func (s *Sim) linger(b *bird, p *profile, to *core.Perch, dest *int8, act core.BirdAct, th then) bool {
	hl := sqrt32(distXZ2(b.pos, to.Pos))
	if hl > lingerHop && s.lingerApplies(b, p, act, th) {
		if b.since < lingerHold(b) {
			s.stayPut(b, p, th)
			return true
		}
		if hl > lingerMax {
			pc, ok := s.exposedNear(b, p, lingerMax-1)
			if !ok {
				s.stayPut(b, p, th)
				return true
			}
			*to, *dest = pc, noPerch
			hl = sqrt32(distXZ2(b.pos, pc.Pos))
		}
	}
	if hl > lingerHop {
		b.since = 0
	}
	return false
}

// lingerApplies: an everyday flight of a lone (or paired) bird, on its own business,
// with a calm observer close by.
func (s *Sim) lingerApplies(b *bird, p *profile, act core.BirdAct, th then) bool {
	if s.silent || !s.obs.Present || act != core.ActFlying || b.circ != 0 || b.moving || b.airborne() {
		return false
	}
	if p.flock || b.mixed != 0 || b.fled || b.lure != 0 || s.oMove > moveWalk {
		return false
	}
	switch b.mode {
	case mIdle, mGround, mGlean, mClimb:
	default:
		return false
	}
	switch th {
	case thenPerch, thenSong, thenPreen, thenForage, thenGlean, thenSocial, thenClimb:
	default:
		return false
	}
	return distXZ2(b.pos, s.obs.Pos) <= lingerNear*lingerNear
}

// stayPut settles the bird where it is and starts what the cancelled flight was
// for, as far as it makes sense on this perch.
func (s *Sim) stayPut(b *bird, p *profile, th then) {
	switch th {
	case thenForage:
		if k := b.destKind; k != core.PerchGround && k != core.PerchShore && k != core.PerchWater {
			th = thenPerch // no ground to forage on up here: it rests a while instead
		}
	case thenClimb:
		if b.destKind != core.PerchTrunk {
			th = thenPerch
		}
	}
	b.dest = b.cur
	b.moving, b.mv, b.then = false, mvGround, th
	b.speed = 0
	s.arrive(b, p)
}
