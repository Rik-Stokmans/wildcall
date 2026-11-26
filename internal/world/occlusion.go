package world

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

const (
	occStep     = 1.5  // ray-march step over the terrain, metres
	occEndSkip  = 1.2  // ignore the terrain this close to either end (perches sit on it)
	occTerrainT = 0.2  // the line must pass this far below the ground to count
	occMax      = 0.95 // foliage alone never blocks completely
	occReach    = 12.0 // the widest crown: how far beyond a chunk its foliage can reach
)

// Occlusion returns how blocked the straight line from -> to is: 1 if the terrain
// cuts it, otherwise the summed partial occlusion of every tree crown, shrub and
// reed clump it passes through (a centre hit through a crown adds ~0.35, scaled by
// the length of the path inside it), clamped to 0..0.95.
func (w *World) Occlusion(from, to core.Vec3) float32 {
	ox, oy, oz := float64(from.X), float64(from.Y), float64(from.Z)
	dx, dy, dz := float64(to.X)-ox, float64(to.Y)-oy, float64(to.Z)-oz
	l := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if l < 1e-3 {
		return 0
	}
	if w.terrainBlocks(ox, oy, oz, dx, dy, dz, l) {
		return 1
	}
	return float32(w.foliageOcclusion(ox, oy, oz, dx, dy, dz))
}

// terrainBlocks ray-marches the segment over the chunk grids.
func (w *World) terrainBlocks(ox, oy, oz, dx, dy, dz, l float64) bool {
	n := int(math.Ceil(l / occStep))
	var gr *grid
	for i := 1; i < n; i++ {
		t := float64(i) / float64(n)
		along := t * l
		if along < occEndSkip || l-along < occEndSkip {
			continue
		}
		x, y, z := ox+dx*t, oy+dy*t, oz+dz*t
		cx, cz := chunkOf(x), chunkOf(z)
		if gr == nil || gr.cx != cx || gr.cz != cz {
			gr = w.grid(cx, cz)
		}
		fx, fz := gr.local(x, z)
		if y < gr.heightAt(fx, fz)-occTerrainT {
			return true
		}
	}
	return false
}

// foliageOcclusion sums the occlusion of every foliage ellipsoid the segment
// o + t*d (t in 0..1) passes through.
func (w *World) foliageOcclusion(ox, oy, oz, dx, dy, dz float64) float64 {
	x0, x1 := math.Min(ox, ox+dx)-occReach, math.Max(ox, ox+dx)+occReach
	z0, z1 := math.Min(oz, oz+dz)-occReach, math.Max(oz, oz+dz)+occReach
	ax, az, bx, bz := ox, oz, ox+dx, oz+dz
	occ := 0.0
	for cz := chunkOf(z0); cz <= chunkOf(z1); cz++ {
		for cx := chunkOf(x0); cx <= chunkOf(x1); cx++ {
			// Skip chunks the segment does not come near (long diagonal rays).
			mx, mz := float64(cx*core.ChunkSize)+32, float64(cz*core.ChunkSize)+32
			if d, _ := distSeg(mx, mz, ax, az, bx, bz); d > 45.3+occReach {
				continue
			}
			vs := w.vegetation(cx, cz)
			for i := range vs.shapes {
				s := &vs.shapes[i]
				if d, _ := distSeg(s.x, s.z, ax, az, bx, bz); d >= s.rx {
					continue
				}
				occ += s.occ * chordFraction(s, ox, oy, oz, dx, dy, dz)
				if occ >= occMax {
					return occMax
				}
			}
		}
	}
	return occ
}

// chordFraction is the length of the segment inside an ellipsoid relative to the
// ellipsoid's diameter along that direction (1 for a full pass through the centre).
func chordFraction(s *foliage, ox, oy, oz, dx, dy, dz float64) float64 {
	// Scale space so the ellipsoid becomes a unit sphere.
	px, py, pz := (ox-s.x)/s.rx, (oy-s.y)/s.ry, (oz-s.z)/s.rx
	qx, qy, qz := dx/s.rx, dy/s.ry, dz/s.rx
	a := qx*qx + qy*qy + qz*qz
	b := 2 * (px*qx + py*qy + pz*qz)
	c := px*px + py*py + pz*pz - 1
	disc := b*b - 4*a*c
	if disc <= 0 || a < 1e-12 {
		return 0
	}
	sd := math.Sqrt(disc)
	t0 := math.Max((-b-sd)/(2*a), 0)
	t1 := math.Min((-b+sd)/(2*a), 1)
	if t1 <= t0 {
		return 0
	}
	// In unit-sphere space the full centre chord has length 2.
	return math.Min((t1-t0)*math.Sqrt(a)/2, 1)
}
