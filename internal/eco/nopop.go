package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// No popping. A bird enters and leaves the world only where the player cannot see
// it happen: arrivals fly in from beyond offstageR metres of the observer, and a
// departing bird flies on until it is that far away before it is taken out
// (nopop_test.go holds the rule: nothing appears or vanishes within 150 m in view,
// or within 60 m at all).

// offstageR: beyond this horizontal distance from the observer a bird may enter or
// leave the world (snapshots reach 260 m, but a bird 200 m off is a speck).
const offstageR = 200

// offstage reports whether a point is out of the observer's sight for the purpose
// of a bird entering or leaving the world.
func (s *Sim) offstage(x, z float32) bool {
	if !s.obs.Present {
		return true
	}
	dx, dz := x-s.obs.Pos.X, z-s.obs.Pos.Z
	return dx*dx+dz*dz >= offstageR*offstageR
}

// arrivalStart is where a bird arriving from afar appears: 160 m from its home in a
// direction of its own, or, if that would be within sight of the observer, on the
// far side of its home from the observer and at least offstageR + 20 m from them.
func (s *Sim) arrivalStart(b *bird) (float32, float32) {
	a := unit(hash2(b.seed, uint64(s.env.Day))) * 2 * math.Pi
	x, z := b.home.X+160*sin32(a), b.home.Z-160*cos32(a)
	if s.offstage(x, z) && s.offstage(lerp(x, b.home.X, 0.5), lerp(z, b.home.Z, 0.5)) || !s.obs.Present {
		return x, z
	}
	ux, uz := b.home.X-s.obs.Pos.X, b.home.Z-s.obs.Pos.Z
	d := sqrt32(ux*ux + uz*uz)
	if d < 0.5 {
		ux, uz, d = sin32(a), -cos32(a), 1
	}
	ux, uz = ux/d, uz/d
	r := max32(160, offstageR+20-d)
	return b.home.X + r*ux, b.home.Z + r*uz
}

// leaveTarget is where a departing bird flies to: 220 m off in its own direction,
// turned away from the observer when that would bring it closer to them.
func (s *Sim) leaveTarget(b *bird) (float32, float32) {
	a := unit(hash2(b.seed, 0x4C454156)) * 2 * math.Pi
	ux, uz := sin32(a), -cos32(a)
	if s.obs.Present {
		ax, az := b.pos.X-s.obs.Pos.X, b.pos.Z-s.obs.Pos.Z
		if l := sqrt32(ax*ax + az*az); l > 0.5 {
			ax, az = ax/l, az/l
			if ux*ax+uz*az < 0.3 {
				// Bend its course away from the observer.
				ux, uz = ux+1.6*ax, uz+1.6*az
				n := sqrt32(ux*ux + uz*uz)
				ux, uz = ux/n, uz/n
			}
		}
	}
	return b.pos.X + 220*ux, b.pos.Z + 220*uz
}

// goneOffstage is the end of a departure flight: the bird leaves the world if it is
// out of the observer's sight; otherwise it flies on (and false is returned).
func (s *Sim) goneOffstage(b *bird) bool {
	if s.offstage(b.pos.X, b.pos.Z) {
		return true
	}
	x, z := s.leaveTarget(b)
	to := core.Perch{Pos: core.V(x, max32(s.t.HeightAt(x, z), 0)+40, z)}
	s.fly(b, &s.prof[b.sp], to, noPerch, core.ActFlying, 1, thenGone)
	return false
}
