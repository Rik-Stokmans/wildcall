package world

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// Perches (contract §2.4) are derived per chunk from its vegetation, terrain and
// structures, cached, and searched chunk by chunk.

// perchSet is a chunk's perches with their XZ bounding box: tree perches can
// overhang the chunk (a limb reaching over the border), so searches prune by the
// box rather than by the chunk square.
type perchSet struct {
	ps             []core.Perch
	x0, z0, x1, z1 float64
}

// perchOverhang bounds how far outside its chunk a perch can lie (the widest
// crown of the largest tree).
const perchOverhang = occReach

func (w *World) chunkPerchSet(cx, cz int) *perchSet {
	return w.perches.get(chunkKey{cx, cz}, func() *perchSet {
		s := &perchSet{ps: w.buildPerches(cx, cz), x0: math.Inf(1), z0: math.Inf(1), x1: math.Inf(-1), z1: math.Inf(-1)}
		for _, p := range s.ps {
			s.x0, s.x1 = math.Min(s.x0, float64(p.Pos.X)), math.Max(s.x1, float64(p.Pos.X))
			s.z0, s.z1 = math.Min(s.z0, float64(p.Pos.Z)), math.Max(s.z1, float64(p.Pos.Z))
		}
		return s
	})
}

func (w *World) chunkPerches(cx, cz int) []core.Perch { return w.chunkPerchSet(cx, cz).ps }

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

	// Tree perches sit on the drawn wood: one below the ground (a low limb on a
	// slope) is dropped rather than moved off its limb.
	treeEmit := func(p v3, k core.PerchKind, cover float64) bool {
		if p.y < groundAt(p.x, p.z)+0.05 || p.y < 0 {
			return false
		}
		out = append(out, core.Perch{Pos: vec(p.x, p.y, p.z), Kind: k, Cover: float32(clamp01(cover))})
		return true
	}
	for i := range vs.veg {
		v := &vs.veg[i]
		x, y, z, s := float64(v.Pos.X), float64(v.Pos.Y), float64(v.Pos.Z), float64(v.Scale)
		sh := shapes[v.Kind]
		switch {
		case v.Kind.IsTree():
			treePerches(v, &r, treeEmit)
		case isForage(v.Kind) && sh.rx > 0:
			// Bramble, elder, dog rose, hazel and sea buckthorn are bushes too.
			add(core.PerchShrub, x+r.Range(-0.3, 0.3)*s, y+sh.height*s*r.Range(0.45, 0.8), z+r.Range(-0.3, 0.3)*s, r.Range(0.5, 0.8))
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
	rt := noise.NewRNG(noise.Hash2(uint64(w.seed)^0xba4c1ed, int64(cx), int64(cz)))
	for iz := 0; iz < gridN-1; iz++ {
		for ix := 0; ix < gridN-1; ix++ {
			k := iz*gridN + ix
			v := &gr.v[k]
			h := float64(v.h)
			x, z := bx+float64(ix)*gridStep, bz+float64(iz)*gridStep
			// Banks: steep earth just above the water (kingfisher burrows).
			if ix%2 == 1 && iz%2 == 1 && h >= 0.4 && h <= 2.0 && v.slope >= bankSlope && bankGround(v) && waterNear(gr, ix, iz, 2) && rt.Chance(0.75) {
				add(core.PerchBank, x, h, z, 0.15)
			}
			// Ledges: cliff and crag faces, sea stacks.
			if ix%3 == 0 && iz%3 == 0 && ledgeGround(v, h) && rt.Chance(0.6) {
				add(core.PerchLedge, x, h+0.05, z, 0.05)
			}
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

// bankSlope is the steepness (rise over run) that makes a waterside slope a bank.
const bankSlope = 0.3

// bankGround reports whether a vertex is earth a bird could dig into: not sand,
// rock, snow or ice.
func bankGround(v *gvert) bool {
	switch core.Habitat(v.hab) {
	case core.HabBeach, core.HabCliff, core.HabSnow, core.HabOcean:
		return false
	}
	return v.flags&(vfIce|vfSea) == 0 && v.rock < 0.45 && v.reg != uint8(core.RegionNone) &&
		!(v.reg == uint8(core.RegionWhisperingCoast) && v.seaDist < 40)
}

// waterNear reports whether open water lies within d vertices of (ix, iz).
func waterNear(gr *grid, ix, iz, d int) bool {
	for jz := max(iz-d, 0); jz <= min(iz+d, gridN-1); jz++ {
		for jx := max(ix-d, 0); jx <= min(ix+d, gridN-1); jx++ {
			if u := &gr.v[jz*gridN+jx]; u.h < -0.05 && u.flags&vfIce == 0 {
				return true
			}
		}
	}
	return false
}

// ledgeGround reports whether a vertex is a cliff or crag face in the highlands
// or on the coast, or the rock of a sea stack.
func ledgeGround(v *gvert, h float64) bool {
	if h < 0.4 {
		return false
	}
	reg := core.RegionID(v.reg)
	if reg != core.RegionWindpeak && reg != core.RegionWhisperingCoast {
		return false
	}
	return v.hab == uint8(core.HabCliff) || v.slope > 0.85
}

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
	const m = perchOverhang
	for cz := chunkOf(fz - r - m); cz <= chunkOf(fz+r+m); cz++ {
		for cx := chunkOf(fx - r - m); cx <= chunkOf(fx+r+m); cx++ {
			nx := clamp(fx, float64(cx*core.ChunkSize)-m, float64((cx+1)*core.ChunkSize)+m)
			nz := clamp(fz, float64(cz*core.ChunkSize)-m, float64((cz+1)*core.ChunkSize)+m)
			if sq(nx-fx)+sq(nz-fz) > r2 {
				continue
			}
			set := w.chunkPerchSet(cx, cz)
			nx, nz = clamp(fx, set.x0, set.x1), clamp(fz, set.z0, set.z1)
			if sq(nx-fx)+sq(nz-fz) > r2 {
				continue
			}
			ps := set.ps
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
	const reach = occReach // the widest crown footprint
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
