package world

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Tree trunks in the line of sight. Occlusion (occlusion.go) counts terrain and
// foliage only, so a bird standing squarely behind a trunk the client draws used to
// read as clearly visible and handed out evidence through solid wood. TrunkOcclusion
// tests the same trunk segments the client draws (the tree models, treemodel.go) and
// is used by the clarity model (internal/field, through an optional interface) so
// "you can see it" agrees with what is on the screen.

const (
	trunkSearch = 1.6  // XZ prefilter: trees whose base is this close to the line (m, at scale 1 the widest trunk is ~0.6 m)
	trunkEdge   = 0.05 // a line grazing the bark within this of the surface is half hidden (m)
	trunkEndGap = 0.35 // ignore the wood this close to the bird (a bird perched on the near side of the trunk)
)

// TrunkOcclusion returns how much of a bird-sized target at `to` the tree trunks
// between `from` and `to` hide: 1 when the sight line passes through a trunk, easing
// to 0 when it clears the bark by trunkEdge. Only order-0 wood (the trunk and the
// stems of a snag) counts; limbs and twigs are thin and stay part of the crown.
func (w *World) TrunkOcclusion(from, to core.Vec3) float32 {
	ox, oy, oz := float64(from.X), float64(from.Y), float64(from.Z)
	ex, ey, ez := float64(to.X), float64(to.Y), float64(to.Z)
	dx, dy, dz := ex-ox, ey-oy, ez-oz
	l := math.Sqrt(dx*dx + dy*dy + dz*dz)
	if l < 0.5 {
		return 0
	}
	x0, x1 := math.Min(ox, ex)-trunkSearch*3, math.Max(ox, ex)+trunkSearch*3
	z0, z1 := math.Min(oz, ez)-trunkSearch*3, math.Max(oz, ez)+trunkSearch*3
	best := 0.0
	for cz := chunkOf(z0); cz <= chunkOf(z1); cz++ {
		for cx := chunkOf(x0); cx <= chunkOf(x1); cx++ {
			mx, mz := float64(cx*core.ChunkSize)+32, float64(cz*core.ChunkSize)+32
			if d, _ := distSeg(mx, mz, ox, oz, ex, ez); d > 45.3+trunkSearch*3 {
				continue
			}
			vs := w.vegetation(cx, cz)
			for i := range vs.veg {
				v := &vs.veg[i]
				if !v.Kind.IsTree() {
					continue
				}
				k := float64(v.Scale)
				if d, _ := distSeg(float64(v.Pos.X), float64(v.Pos.Z), ox, oz, ex, ez); d > trunkSearch*k {
					continue
				}
				m := treeModelFor(v.Kind, v.Variant)
				x := instanceXform(v)
				for s := range m.segs {
					sg := &m.segs[s]
					if sg.order != 0 {
						continue
					}
					a, b := x.apply(sg.a), x.apply(sg.b)
					d, tl, tw := segSegDist(ox, oy, oz, dx, dy, dz, a, b)
					if (1-tl)*l < trunkEndGap || tl*l < 0.5 {
						continue // at the bird itself, or at the player's own shoulder
					}
					r := lerp(sg.ra, sg.rb, tw) * k
					// Fully hidden inside the bark, half at the surface, clear trunkEdge beyond.
					o := 1 - smoothstep(r-trunkEdge, r+trunkEdge, d)
					if o > best {
						best = o
						if best >= 0.999 {
							return 1
						}
					}
				}
			}
		}
	}
	return float32(best)
}

// segSegDist is the closest distance between the sight segment o + t·d (t in 0..1)
// and the wood segment a-b, with the parameters of the closest points on each.
func segSegDist(ox, oy, oz, dx, dy, dz float64, a, b v3) (dist, t, u float64) {
	ex, ey, ez := b.x-a.x, b.y-a.y, b.z-a.z
	rx, ry, rz := ox-a.x, oy-a.y, oz-a.z
	A := dx*dx + dy*dy + dz*dz
	E := ex*ex + ey*ey + ez*ez
	F := ex*rx + ey*ry + ez*rz
	C := dx*rx + dy*ry + dz*rz
	B := dx*ex + dy*ey + dz*ez
	den := A*E - B*B
	if den > 1e-12 {
		t = clamp01((B*F - C*E) / den)
	}
	if E > 1e-12 {
		u = (B*t + F) / E
		if u < 0 {
			u = 0
			t = clamp01(-C / A)
		} else if u > 1 {
			u = 1
			t = clamp01((B - C) / A)
		}
	} else {
		t = clamp01(-C / A)
	}
	px, py, pz := ox+dx*t-(a.x+ex*u), oy+dy*t-(a.y+ey*u), oz+dz*t-(a.z+ez*u)
	return math.Sqrt(px*px + py*py + pz*pz), t, u
}
