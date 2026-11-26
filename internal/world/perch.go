package world

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// Perches (contract §2.4) are derived per chunk from its vegetation, terrain and
// structures, cached, and searched chunk by chunk.

func (w *World) chunkPerches(cx, cz int) []core.Perch {
	return w.perches.get(chunkKey{cx, cz}, func() []core.Perch { return w.buildPerches(cx, cz) })
}

func (w *World) buildPerches(cx, cz int) []core.Perch {
	gr := w.grid(cx, cz)
	vs := w.vegetation(cx, cz)
	r := noise.NewRNG(noise.Hash2(uint64(w.seed)^0x9e5c4e, int64(cx), int64(cz)))
	out := make([]core.Perch, 0, len(vs.veg)*3+200)
	groundAt := func(x, z float64) float64 {
		fx, fz := gr.local(x, z)
		return gr.heightAt(fx, fz)
	}
	add := func(k core.PerchKind, x, y, z, cover float64) {
		// Never below the ground; only water perches sit on the water plane.
		if k != core.PerchWater {
			y = math.Max(y, groundAt(x, z)+0.05)
			y = math.Max(y, 0)
		}
		out = append(out, core.Perch{Pos: vec(x, y, z), Kind: k, Cover: float32(clamp01(cover))})
	}

	for i := range vs.veg {
		v := &vs.veg[i]
		x, y, z, s := float64(v.Pos.X), float64(v.Pos.Y), float64(v.Pos.Z), float64(v.Scale)
		sh := shapes[v.Kind]
		switch {
		case sh.isTree:
			H := sh.height * s
			cy := y + H*sh.crownY
			rx, ry := sh.rx*s, sh.ry*s
			// Inside the crown: hard to see.
			for k := 0; k < 3; k++ {
				py := y + H*r.Range(0.55, 0.9)
				edge := rx * math.Sqrt(math.Max(0, 1-sq((py-cy)/ry)))
				f := r.Range(0.2, 0.7)
				dx, dz := headingDir(r.Range(0, 2*math.Pi))
				add(core.PerchCanopy, x+dx*edge*f, py, z+dz*edge*f, 0.6+0.3*(1-f)/0.8)
			}
			// An outer branch and the very top: exposed.
			py := y + H*r.Range(0.66, 0.86)
			edge := rx * math.Sqrt(math.Max(0, 1-sq((py-cy)/ry)))
			dx, dz := headingDir(r.Range(0, 2*math.Pi))
			add(core.PerchBranch, x+dx*edge*0.95, py, z+dz*edge*0.95, r.Range(0.15, 0.35))
			add(core.PerchBranch, x, cy+ry*0.95, z, r.Range(0.1, 0.18))
			// The trunk, for climbers.
			ty := y + math.Min(r.Range(2, 8), H*0.5)
			dx, dz = headingDir(r.Range(0, 2*math.Pi))
			add(core.PerchTrunk, x+dx*0.3*s, ty, z+dz*0.3*s, 0.3)
		case sh.snag:
			H := sh.height * s
			add(core.PerchSnag, x, y+H*0.96, z, 0)
			dx, dz := headingDir(r.Range(0, 2*math.Pi))
			add(core.PerchSnag, x+dx*1.1*s, y+H*0.72, z+dz*1.1*s, 0)
		case v.Kind == core.VegShrub:
			add(core.PerchShrub, x+r.Range(-0.3, 0.3)*s, y+1.6*s*r.Range(0.45, 0.8), z+r.Range(-0.3, 0.3)*s, r.Range(0.5, 0.8))
		case v.Kind == core.VegReeds:
			add(core.PerchReed, x, math.Max(y, 0)+r.Range(0.9, 1.6)*s, z, r.Range(0.5, 0.7))
		case v.Kind == core.VegRock:
			add(core.PerchRock, x, y+0.85*s, z, 0)
		case v.Kind == core.VegLog:
			add(core.PerchSnag, x, y+0.45*s, z, 0)
		case v.Kind == core.VegStump:
			add(core.PerchSnag, x, y+0.55*s, z, 0)
		case v.Kind == core.VegDriftwood:
			add(core.PerchShore, x, y+0.3*s, z, 0)
		case v.Kind == core.VegLilyPads:
			if groundAt(x, z) < -0.05 {
				add(core.PerchWater, x, 0, z, 0.1)
			}
		}
	}

	// Terrain: open ground and ledges every 6 m, water every 8 m, the water's edge
	// every 4 m.
	bx, bz := float64(cx*core.ChunkSize), float64(cz*core.ChunkSize)
	for iz := 0; iz < gridN-1; iz++ {
		for ix := 0; ix < gridN-1; ix++ {
			k := iz*gridN + ix
			v := &gr.v[k]
			h := float64(v.h)
			x, z := bx+float64(ix)*gridStep, bz+float64(iz)*gridStep
			switch {
			case ix%4 == 1 && iz%4 == 1 && h < -0.3:
				jx, jz := x+r.Range(-1.5, 1.5), z+r.Range(-1.5, 1.5)
				if groundAt(jx, jz) > -0.1 {
					jx, jz = x, z // the jitter reached the bank
				}
				add(core.PerchWater, jx, 0, jz, 0)
			case ix%2 == 0 && iz%2 == 0 && h > -0.3 && h < 0.5 && v.flags&vfIce == 0 && edgeVertex(gr, ix, iz):
				add(core.PerchShore, x, math.Max(h, 0), z, 0.05)
			case ix%3 == 1 && iz%3 == 1 && h > 0.15:
				jx, jz := x+r.Range(-2, 2), z+r.Range(-2, 2)
				if v.slope > 0.75 || v.hab == uint8(core.HabCliff) {
					add(core.PerchRock, jx, groundAt(jx, jz)+0.1, jz, 0)
				} else {
					add(core.PerchGround, jx, groundAt(jx, jz), jz, groundCover(core.Habitat(v.hab), v))
				}
			}
		}
	}

	// Structures: roofs, rails, tower tops.
	addStruct := func(st *structure) {
		if chunkOf(st.x) != cx || chunkOf(st.z) != cz {
			return
		}
		add(core.PerchStructure, st.x, st.y+st.height, st.z, 0)
		for k := 0; k < 2; k++ {
			dx, dz := headingDir(r.Range(0, 2*math.Pi))
			add(core.PerchStructure, st.x+dx*st.r, st.y+st.height*0.78, st.z+dz*st.r, 0.05)
		}
	}
	for i := range w.hl.structs {
		addStruct(&w.hl.structs[i])
	}
	for dz := -1; dz <= 1; dz++ {
		for dx := -1; dx <= 1; dx++ {
			c := w.cell(cellOf(bx+32)+dx, cellOf(bz+32)+dz)
			for i := range c.structs {
				addStruct(&c.structs[i])
			}
		}
	}
	return out
}

func sq(v float64) float64 { return v * v }

// edgeVertex reports whether a vertex lies on a shoreline (water on one side,
// land on another).
func edgeVertex(gr *grid, ix, iz int) bool {
	wet, dry := false, false
	for _, d := range [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}} {
		jx, jz := ix+d[0], iz+d[1]
		if jx < 0 || jz < 0 || jx >= gridN || jz >= gridN {
			continue
		}
		h := gr.v[jz*gridN+jx].h
		wet = wet || h < -0.05
		dry = dry || h > 0.05
	}
	return wet && dry
}

// groundCover is the cover low ground vegetation gives a bird on the ground.
func groundCover(h core.Habitat, v *gvert) float64 {
	switch h {
	case core.HabShrub:
		return 0.3
	case core.HabMarsh:
		return 0.26
	case core.HabWoodland:
		return 0.18
	case core.HabMeadow:
		return 0.12 + 0.08*float64(v.meadow)
	case core.HabConifer:
		return 0.1
	case core.HabRiver:
		return 0.08
	case core.HabAlpine:
		return 0.05
	}
	return 0
}

// PerchesNear appends every perch within radius (XZ) of (x, z) to buf.
func (w *World) PerchesNear(x, z, radius float32, buf []core.Perch) []core.Perch {
	fx, fz, r := float64(x), float64(z), float64(radius)
	r2 := r * r
	for cz := chunkOf(fz - r); cz <= chunkOf(fz+r); cz++ {
		for cx := chunkOf(fx - r); cx <= chunkOf(fx+r); cx++ {
			nx := clamp(fx, float64(cx*core.ChunkSize), float64((cx+1)*core.ChunkSize))
			nz := clamp(fz, float64(cz*core.ChunkSize), float64((cz+1)*core.ChunkSize))
			if sq(nx-fx)+sq(nz-fz) > r2 {
				continue
			}
			ps := w.chunkPerches(cx, cz)
			for i := range ps {
				dx, dz := float64(ps[i].Pos.X)-fx, float64(ps[i].Pos.Z)-fz
				if dx*dx+dz*dz <= r2 {
					buf = append(buf, ps[i])
				}
			}
		}
	}
	return buf
}

// Cover returns 0..1 vegetation density over a point: tree crowns, shrubs and
// reeds whose footprint covers it, combined as independent layers.
func (w *World) Cover(x, z float32) float32 {
	fx, fz := float64(x), float64(z)
	const reach = 12 // the widest crown footprint
	open := 1.0
	for cz := chunkOf(fz - reach); cz <= chunkOf(fz+reach); cz++ {
		for cx := chunkOf(fx - reach); cx <= chunkOf(fx+reach); cx++ {
			vs := w.vegetation(cx, cz)
			for i := range vs.shapes {
				s := &vs.shapes[i]
				dx, dz := s.x-fx, s.z-fz
				if math.Abs(dx) > s.rx || math.Abs(dz) > s.rx {
					continue
				}
				d := math.Sqrt(dx*dx+dz*dz) / s.rx
				if d < 1 {
					open *= 1 - s.cover*(1-smoothstep(0.55, 1, d))
				}
			}
		}
	}
	return float32(clamp01(1 - open))
}
