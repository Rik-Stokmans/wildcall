package eco

import (
	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Creeks and ponds. A cell's habitat is sampled on a 4 x 4 grid (32 m apart), which
// sees a lake but misses a creek 3-6 m wide or a small pond. Birds of the water's
// edge - wagtails, ducks, herons, kingfishers - live along exactly those, and their
// flights up and down the water (ducks coming in, a heron lifting off the bank) are
// some of the most noticeable a player sees. So a cell whose perches include a real
// stretch of water's edge counts that stretch as river habitat, and those birds make
// their homes on it.

const (
	creekEdge = 6  // shore, water and bank perches inside the cell that make a creek
	creekPer  = 30 // ...and per this many more, another sample counts as river
	creekMax  = 3
)

// creekSample marks the sample nearest the water's edge as river habitat when the
// grid has missed the water. Called by buildCell before the roster is drawn.
func (s *Sim) creekSample(c *cell) {
	for _, sm := range c.samples {
		if sm.hab == core.HabRiver || sm.hab == core.HabMarsh || sm.hab == core.HabOcean {
			return
		}
	}
	// One sample per creekPer perches of water's edge (a long creek through the cell
	// is more river than a pond's corner), at most creekMax.
	n := s.edgeCount(c)
	if n < creekEdge {
		return
	}
	marks := min(1+n/creekPer, creekMax)
	for m := 0; m < marks; m++ {
		pt, _ := s.creekPoint(c, uint64(m*n/marks))
		best, bestD := -1, float32(1e9)
		for i, sm := range c.samples {
			if sm.hab == core.HabRiver {
				continue
			}
			dx, dz := sm.x-pt.X, sm.z-pt.Z
			if d := dx*dx + dz*dz; d < bestD {
				best, bestD = i, d
			}
		}
		if best < 0 {
			return
		}
		if h := c.samples[best].hab; h < core.HabCount {
			c.hab[h] -= 1.0 / 16
		}
		c.samples[best].hab = core.HabRiver
		c.hab[core.HabRiver] += 1.0 / 16
	}
}

// edgeCount is the number of water's-edge perches inside the cell.
func (s *Sim) edgeCount(c *cell) int {
	x0, z0 := float32(c.key.x)*cellSize, float32(c.key.z)*cellSize
	n := 0
	for i := range c.perches {
		if waterEdge(&c.perches[i], x0, z0) {
			n++
		}
	}
	return n
}

// creekPoint returns the k-th (mod count) water's-edge perch inside the cell, if
// the cell has a creek's worth of them.
func (s *Sim) creekPoint(c *cell, k uint64) (core.Vec3, bool) {
	x0, z0 := float32(c.key.x)*cellSize, float32(c.key.z)*cellSize
	n := s.edgeCount(c)
	if n < creekEdge {
		return core.Vec3{}, false
	}
	want := int(k % uint64(n))
	for i := range c.perches {
		if pc := &c.perches[i]; waterEdge(pc, x0, z0) {
			if want == 0 {
				return pc.Pos, true
			}
			want--
		}
	}
	return core.Vec3{}, false
}

func waterEdge(pc *core.Perch, x0, z0 float32) bool {
	switch pc.Kind {
	case core.PerchShore, core.PerchWater, core.PerchBank:
	default:
		return false
	}
	return pc.Pos.X >= x0 && pc.Pos.X < x0+cellSize && pc.Pos.Z >= z0 && pc.Pos.Z < z0+cellSize
}

// waterHome moves the home of a bird of the water's edge onto the creek when the
// spot homeFor chose is away from the water.
func (s *Sim) waterHome(c *cell, p *profile, home core.Vec3, h uint64) core.Vec3 {
	if p.habW[core.HabRiver]+p.habW[core.HabMarsh] < 0.5 {
		return home
	}
	if hb := s.t.HabitatAt(home.X, home.Z); hb == core.HabRiver || hb == core.HabMarsh {
		return home
	}
	pt, ok := s.creekPoint(c, h)
	if !ok {
		return home
	}
	g := s.t.HeightAt(pt.X, pt.Z)
	if g < 0.05 && !p.waterBird {
		return home
	}
	return core.V(pt.X, max32(g, 0), pt.Z)
}
