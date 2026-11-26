package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Lures: seed mix scattered by the player, the cabin garden feeder. Seed-eating and
// ground-feeding birds within the lure's radius come and feed at it, a few at a
// time, each for a short visit (ActFeeding).

const (
	lureVisitors   = 4   // birds feeding at one lure at once
	lureDefaultTTL = 600 // seconds, when the caller gives none
	lureDefaultR   = 30  // metres, when the caller gives none
)

type lure struct {
	id       uint32
	pos      core.Vec3
	radius   float32
	ttl      float32
	feeder   bool
	visitors int
}

// AddLure places an attraction. Lures with a TTL <= 0 last ten minutes; a radius
// <= 0 means 30 m.
func (s *Sim) AddLure(l core.Lure) {
	if l.Pos.X != l.Pos.X || l.Pos.Z != l.Pos.Z {
		return
	}
	s.lureSeq++
	lr := lure{id: s.lureSeq, pos: l.Pos, radius: l.Radius, ttl: l.TTL, feeder: l.Kind == "feeder"}
	if !(lr.radius > 0) {
		lr.radius = lureDefaultR
	}
	if !(lr.ttl > 0) {
		lr.ttl = lureDefaultTTL
	}
	// Seed lies on the ground; a feeder may stand above it.
	if g := s.t.HeightAt(l.Pos.X, l.Pos.Z); !lr.feeder || lr.pos.Y < g {
		lr.pos.Y = max32(g, 0)
	}
	s.lures = append(s.lures, lr)
}

func (s *Sim) tickLures(dt float32) {
	if len(s.lures) == 0 {
		return
	}
	for i := range s.lures {
		s.lures[i].ttl -= dt
	}
	s.pruneLures()
}

// pruneLures drops eaten-up lures. Birds still at one finish their visit.
func (s *Sim) pruneLures() {
	n := 0
	for _, l := range s.lures {
		if l.ttl > 0 {
			s.lures[n] = l
			n++
		}
	}
	s.lures = s.lures[:n]
}

// tryLure sends a seed-eater to a lure in range with a free place. It reports
// whether the bird is on its way.
func (s *Sim) tryLure(b *bird, p *profile) bool {
	for i := range s.lures {
		l := &s.lures[i]
		if l.visitors >= lureVisitors || distXZ2(b.pos, l.pos) > l.radius*l.radius {
			continue
		}
		if !s.chance(0.7) {
			return false
		}
		a := s.rnd(0, 2*math.Pi)
		r := s.rnd(0.3, 1.4)
		x, z := l.pos.X+r*sin32(a), l.pos.Z-r*cos32(a)
		var spot core.Perch
		if l.feeder && l.pos.Y > s.t.HeightAt(x, z)+0.2 {
			// On the feeder tray itself.
			r = s.rnd(0.05, 0.35)
			spot = core.Perch{Pos: core.V(l.pos.X+r*sin32(a), l.pos.Y, l.pos.Z-r*cos32(a)), Kind: core.PerchStructure}
		} else {
			pc, ok := s.groundAt(p, x, z, false)
			if !ok {
				continue
			}
			spot = pc
		}
		l.visitors++
		b.lure = l.id
		s.fly(b, p, spot, noPerch, core.ActFlying, 1, thenLure)
		return true
	}
	return false
}

// releaseLure ends a bird's visit to a lure, if it is on one.
func (s *Sim) releaseLure(b *bird) {
	if b.lure == 0 {
		return
	}
	for i := range s.lures {
		if s.lures[i].id == b.lure {
			if s.lures[i].visitors > 0 {
				s.lures[i].visitors--
			}
			break
		}
	}
	b.lure = 0
	b.lureCD = s.rnd(25, 70)
}
