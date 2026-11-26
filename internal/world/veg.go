package world

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// Vegetation is scattered per chunk on three jittered lattices - trees (5.3 m),
// understory and ground decor (4 m), waterside reeds and lily pads (3.2 m) - with
// densities from the habitat and region type at each spot. It is a pure function
// of (seed, cx, cz) and the chunk's vertex grid, generated once for all LODs.

// LOD classes: the coarsest LOD that still shows an instance.
const (
	lodDecor = 0 // flowers, grass, ferns, mushrooms, logs, stumps, lily pads, driftwood
	lodMid   = 1 // shrubs, rocks, reeds
	lodTrees = 2 // trees and snags
)

// foliage is a soft occluder: a tree crown, a shrub or a reed clump, modelled as
// an axis-aligned ellipsoid.
type foliage struct {
	x, y, z float64 // centre
	rx, ry  float64 // horizontal / vertical semi-axes
	occ     float64 // occlusion added by a line through the centre
	cover   float64 // cover (0..1) directly under the centre
}

type vegSet struct {
	veg    []core.Veg
	lod    []uint8
	shapes []foliage
}

// treeShape is a vegetation kind's nominal geometry at scale 1.
type treeShape struct {
	height       float64
	crownY       float64 // crown centre as a fraction of height
	rx, ry       float64 // crown semi-axes in metres
	occ, cover   float64
	isTree, snag bool
}

var shapes = [core.VegKindCount]treeShape{
	core.VegOak:        {height: 11, crownY: 0.64, rx: 3.7, ry: 3.1, occ: 0.35, cover: 0.85, isTree: true},
	core.VegAmberOak:   {height: 11, crownY: 0.64, rx: 3.7, ry: 3.1, occ: 0.35, cover: 0.8, isTree: true},
	core.VegBirch:      {height: 10, crownY: 0.66, rx: 2.5, ry: 3.0, occ: 0.3, cover: 0.7, isTree: true},
	core.VegAmberBirch: {height: 10, crownY: 0.66, rx: 2.5, ry: 3.0, occ: 0.3, cover: 0.65, isTree: true},
	core.VegPine:       {height: 14, crownY: 0.56, rx: 2.9, ry: 5.4, occ: 0.35, cover: 0.8, isTree: true},
	core.VegSnowPine:   {height: 14, crownY: 0.56, rx: 2.9, ry: 5.4, occ: 0.35, cover: 0.8, isTree: true},
	core.VegSnag:       {height: 8, snag: true},
	core.VegShrub:      {height: 1.6, crownY: 0.5, rx: 1.15, ry: 0.85, occ: 0.25, cover: 0.75},
	core.VegReeds:      {height: 2, crownY: 0.5, rx: 0.85, ry: 1.0, occ: 0.2, cover: 0.6},
}

func vegLOD(k core.VegKind) uint8 {
	switch k {
	case core.VegOak, core.VegBirch, core.VegPine, core.VegSnag, core.VegAmberOak, core.VegAmberBirch, core.VegSnowPine:
		return lodTrees
	case core.VegShrub, core.VegRock, core.VegReeds:
		return lodMid
	}
	return lodDecor
}

func (w *World) vegetation(cx, cz int) *vegSet {
	return w.veg.get(chunkKey{cx, cz}, func() *vegSet { return w.buildVeg(cx, cz) })
}

type option struct {
	k core.VegKind
	p float64
}

func (w *World) buildVeg(cx, cz int) *vegSet {
	gr := w.grid(cx, cz)
	vs := &vegSet{veg: make([]core.Veg, 0, 320)}
	r := noise.NewRNG(noise.Hash2(uint64(w.seed)^0x7e6e7a, int64(cx), int64(cz)))
	bx, bz := float64(cx*core.ChunkSize), float64(cz*core.ChunkSize)

	add := func(k core.VegKind, x, y, z, scale float64) {
		vs.veg = append(vs.veg, core.Veg{Kind: k, Variant: uint8(r.Intn(256)), Pos: vec(x, y, z), Scale: float32(scale), Rot: float32(r.Range(0, 2*math.Pi))})
		vs.lod = append(vs.lod, vegLOD(k))
	}
	lookup := func(x, z float64) (*gvert, float64) {
		fx, fz := gr.local(x, z)
		return &gr.v[gr.nearest(fx, fz)], gr.heightAt(fx, fz)
	}

	// Special instances: the Old Oak, stepping stones, landmark trees and rocks.
	inChunk := func(p core.Vec3) bool {
		return chunkOf(float64(p.X)) == cx && chunkOf(float64(p.Z)) == cz
	}
	for _, v := range w.hl.special {
		if inChunk(v.Pos) {
			vs.veg = append(vs.veg, v)
			vs.lod = append(vs.lod, vegLOD(v.Kind))
		}
	}
	for dz := -1; dz <= 1; dz++ {
		for dx := -1; dx <= 1; dx++ {
			c := w.cell(cellOf(bx+32)+dx, cellOf(bz+32)+dz)
			for _, v := range c.special {
				if inChunk(v.Pos) {
					fx, fz := gr.local(float64(v.Pos.X), float64(v.Pos.Z))
					v.Pos.Y = float32(gr.heightAt(fx, fz))
					vs.veg = append(vs.veg, v)
					vs.lod = append(vs.lod, vegLOD(v.Kind))
				}
			}
		}
	}

	// --- trees -----------------------------------------------------------------
	const tn = 12
	ts := core.ChunkSize / float64(tn)
	for j := 0; j < tn; j++ {
		for i := 0; i < tn; i++ {
			x := bx + (float64(i)+0.1+0.8*r.Float64())*ts
			z := bz + (float64(j)+0.1+0.8*r.Float64())*ts
			roll, pick, sc := r.Float64(), r.Float64(), r.Float64()
			v, h := lookup(x, z)
			p := treeDensity(v, h)
			if roll >= p {
				continue
			}
			k, lo, hi := treeKind(core.RegionID(v.reg), core.Habitat(v.hab), v, pick)
			add(k, x, h, z, lerp(lo, hi, sc))
		}
	}
	// --- understory and ground decor ----------------------------------------------
	const un = 16
	us := core.ChunkSize / float64(un)
	var opts [10]option
	for j := 0; j < un; j++ {
		for i := 0; i < un; i++ {
			x := bx + (float64(i)+r.Float64())*us
			z := bz + (float64(j)+r.Float64())*us
			roll, sc := r.Float64(), r.Float64()
			v, h := lookup(x, z)
			if h < 0.05 || v.keep > 0.35 || v.trail > 0.2 {
				continue
			}
			n := groundOptions(v, h, opts[:0])
			for _, o := range n {
				if roll < o.p {
					lo, hi := decorScale(o.k)
					add(o.k, x, h, z, lerp(lo, hi, sc))
					break
				}
				roll -= o.p
			}
		}
	}
	// --- waterside: reeds and lily pads ----------------------------------------
	const wn = 20
	ws := core.ChunkSize / float64(wn)
	for j := 0; j < wn; j++ {
		for i := 0; i < wn; i++ {
			x := bx + (float64(i)+r.Float64())*ws
			z := bz + (float64(j)+r.Float64())*ws
			roll, sc := r.Float64(), r.Float64()
			v, h := lookup(x, z)
			if v.keep > 0.35 || v.flags&(vfSea|vfIce) != 0 || v.reg == uint8(core.RegionNone) {
				continue
			}
			marsh := v.reg == uint8(core.RegionMurmurMarsh)
			calm := marsh || v.pond > 0 || v.flags&vfFlowing == 0
			wet := marsh || v.pond > 0 || v.hab == uint8(core.HabRiver) || v.hab == uint8(core.HabMarsh)
			switch {
			case wet && h > -0.55 && h < 0.55:
				p := 0.42
				if marsh {
					p = 0.6
				}
				if v.reg == uint8(core.RegionFrostveil) || v.reg == uint8(core.RegionWindpeak) {
					p *= 0.4
				}
				if roll < p {
					add(core.VegReeds, x, h, z, lerp(0.75, 1.3, sc))
				}
			case calm && h <= -0.3 && h > -1.6 && (marsh || v.pond > 0 || v.hab == uint8(core.HabRiver)):
				if roll < 0.16 {
					add(core.VegLilyPads, x, 0, z, lerp(0.7, 1.3, sc))
				}
			}
		}
	}

	// Foliage shapes for occlusion and cover.
	for i := range vs.veg {
		v := &vs.veg[i]
		sh := shapes[v.Kind]
		if sh.rx == 0 {
			continue
		}
		s := float64(v.Scale)
		vs.shapes = append(vs.shapes, foliage{
			x: float64(v.Pos.X), y: float64(v.Pos.Y) + sh.height*sh.crownY*s, z: float64(v.Pos.Z),
			rx: sh.rx * s, ry: sh.ry * s, occ: sh.occ, cover: sh.cover,
		})
	}
	return vs
}

// treeDensity is the chance that a tree-lattice cell holds a tree.
func treeDensity(v *gvert, h float64) float64 {
	if h < 0.5 || v.slope > 0.85 || v.keep > 0.15 || v.trail > 0.05 || v.flags&vfIce != 0 {
		return 0
	}
	reg := core.RegionID(v.reg)
	var p float64
	switch core.Habitat(v.hab) {
	case core.HabWoodland:
		p = 0.8
	case core.HabConifer:
		p = 0.78
		if reg == core.RegionFrostveil || reg == core.RegionWindpeak {
			p = 0.55
		}
	case core.HabShrub:
		p = 0.16
	case core.HabMeadow:
		p = 0.035
		if reg == core.RegionWhisperingCoast {
			p = 0.02
		}
	case core.HabMarsh:
		if h > 0.9 {
			p = 0.06
		}
	case core.HabRiver:
		if h > 0.7 {
			p = 0.22
		}
	case core.HabAlpine:
		p = 0.05 * (1 - smoothstep(80, 130, h))
	case core.HabSnow:
		p = 0.04
	}
	// Clearings thin the trees out smoothly, the fern hollow keeps a few.
	p *= 1 - 0.9*smoothstep(0.35, 0.6, float64(v.clear))
	p *= 1 - 0.95*float64(v.meadow)
	p *= 1 - 0.7*float64(v.fern)
	p *= 1 - smoothstep(0.55, 0.85, float64(v.slope))
	return p
}

// treeKind picks a tree species and scale range for a region and habitat.
func treeKind(reg core.RegionID, hab core.Habitat, v *gvert, u float64) (core.VegKind, float64, float64) {
	switch reg {
	case core.RegionAmberwood:
		switch {
		case hab == core.HabConifer && u < 0.7, u < 0.08:
			return core.VegPine, 0.8, 1.2
		case u < 0.15:
			return core.VegSnag, 0.8, 1.15
		case u < 0.62:
			return core.VegAmberOak, 0.8, 1.3
		}
		return core.VegAmberBirch, 0.8, 1.2
	case core.RegionFrostveil:
		if u < 0.06 {
			return core.VegSnag, 0.7, 1.0
		}
		return core.VegSnowPine, 0.7, 1.15
	case core.RegionWindpeak:
		if u < 0.14 {
			return core.VegSnag, 0.6, 0.95
		}
		return core.VegPine, 0.6, 1.0
	case core.RegionWhisperingCoast:
		switch {
		case u < 0.1:
			return core.VegSnag, 0.6, 0.9
		case u < 0.6:
			return core.VegPine, 0.6, 0.95
		}
		return core.VegOak, 0.6, 0.9
	case core.RegionMurmurMarsh:
		switch {
		case u < 0.3:
			return core.VegSnag, 0.6, 0.95
		case u < 0.8:
			return core.VegBirch, 0.6, 0.9
		}
		return core.VegOak, 0.6, 0.85
	}
	// Greenhollow Woods.
	if hab == core.HabConifer || v.conifer > 0.45 {
		switch {
		case u < 0.84:
			return core.VegPine, 0.8, 1.25
		case u < 0.94:
			return core.VegBirch, 0.8, 1.1
		}
		return core.VegSnag, 0.8, 1.1
	}
	switch {
	case u < 0.56:
		return core.VegOak, 0.8, 1.3
	case u < 0.84:
		return core.VegBirch, 0.8, 1.2
	case u < 0.93:
		return core.VegPine, 0.8, 1.2
	}
	return core.VegSnag, 0.75, 1.1
}

// groundOptions lists the understory kinds possible at a vertex with their
// per-lattice-cell probabilities (the remainder is bare ground).
func groundOptions(v *gvert, h float64, o []option) []option {
	reg := core.RegionID(v.reg)
	frost := reg == core.RegionFrostveil
	amber := reg == core.RegionAmberwood
	switch core.Habitat(v.hab) {
	case core.HabWoodland:
		mush := 0.05
		if amber {
			mush = 0.1
		}
		o = append(o, option{core.VegShrub, 0.15}, option{core.VegFern, 0.2}, option{core.VegMushroom, mush},
			option{core.VegLog, 0.035}, option{core.VegStump, 0.035}, option{core.VegRock, 0.025},
			option{core.VegGrassTuft, 0.05}, option{core.VegFlowers, 0.02})
	case core.HabConifer:
		if frost {
			o = append(o, option{core.VegRock, 0.06}, option{core.VegShrub, 0.03}, option{core.VegLog, 0.03})
			break
		}
		o = append(o, option{core.VegFern, 0.1}, option{core.VegShrub, 0.08}, option{core.VegMushroom, 0.05},
			option{core.VegLog, 0.05}, option{core.VegStump, 0.04}, option{core.VegRock, 0.05})
	case core.HabShrub:
		fern := 0.25 + 0.4*float64(v.fern)
		o = append(o, option{core.VegShrub, 0.5 - 0.2*float64(v.fern)}, option{core.VegFern, fern}, option{core.VegMushroom, 0.03})
	case core.HabMeadow:
		if reg == core.RegionWhisperingCoast {
			o = append(o, option{core.VegGrassTuft, 0.4}, option{core.VegFlowers, 0.1}, option{core.VegShrub, 0.05}, option{core.VegRock, 0.03})
			break
		}
		o = append(o, option{core.VegGrassTuft, 0.36}, option{core.VegFlowers, 0.3}, option{core.VegShrub, 0.04}, option{core.VegRock, 0.02})
	case core.HabRiver:
		if h < 0.9 {
			break // the waterside pass handles the wet margin
		}
		o = append(o, option{core.VegGrassTuft, 0.22}, option{core.VegShrub, 0.1}, option{core.VegFlowers, 0.05}, option{core.VegRock, 0.04})
	case core.HabMarsh:
		o = append(o, option{core.VegGrassTuft, 0.16}, option{core.VegShrub, 0.05})
	case core.HabAlpine:
		o = append(o, option{core.VegRock, 0.18 + 0.2*float64(v.rock)}, option{core.VegGrassTuft, 0.15}, option{core.VegShrub, 0.03}, option{core.VegFlowers, 0.02})
	case core.HabCliff:
		o = append(o, option{core.VegRock, 0.12})
	case core.HabBeach:
		if v.seaDist < 40 {
			o = append(o, option{core.VegDriftwood, 0.07}, option{core.VegRock, 0.02})
		} else {
			o = append(o, option{core.VegGrassTuft, 0.12}, option{core.VegDriftwood, 0.015})
		}
	case core.HabSnow:
		o = append(o, option{core.VegRock, 0.05}, option{core.VegShrub, 0.015})
	}
	if frost {
		// No flowers or ferns under the snow.
		for i := range o {
			if o[i].k == core.VegFlowers || o[i].k == core.VegFern || o[i].k == core.VegMushroom {
				o[i].k = core.VegRock
				o[i].p *= 0.2
			}
		}
	}
	return o
}

// decorScale is the scale range of an understory kind.
func decorScale(k core.VegKind) (float64, float64) {
	switch k {
	case core.VegShrub:
		return 0.7, 1.35
	case core.VegRock:
		return 0.5, 1.4
	case core.VegLog:
		return 0.8, 1.3
	case core.VegFern:
		return 0.7, 1.3
	}
	return 0.75, 1.25
}
