package world

import (
	"math"
	"sync"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// The lod-0 vertex grid of a chunk: 33 x 33 vertices at 2 m. Every LOD, the
// vegetation, perches and the point queries (HeightAt, RegionAt...) are derived
// from it, so a vertex shared by two chunks or two LODs has one set of values.
//
// Each vertex is a pure function of its integer world position: the climate
// sample there, the overlays that reach it (gathered in a global order), and the
// heights at +-2 m for the normal. That is what makes borders match exactly.

const (
	gridN    = core.ChunkSize/2 + 1 // 33
	gridStep = 2.0
	apron    = gridN + 2 // vertices per side including a one-vertex apron
)

// Vertex flags.
const (
	vfSea     = 1 << iota // seaward of the shoreline
	vfFlowing             // a river holds water here
	vfIce                 // frozen water surface
)

// gvert is everything the generator keeps about one grid vertex.
type gvert struct {
	h       float32
	slope   float32 // rise over run
	nrm     [3]int8
	col     [3]uint8
	reg     uint8 // core.RegionID (255 = open sea)
	hab     uint8 // core.Habitat
	flags   uint8
	clear   float32 // woodland structure fields, roughly -1..1
	thicket float32
	conifer float32
	rock    float32 // 0..1 rocky outcrop / scree
	trail   float32 // 0..1 visible trail tread
	htrail  float32 // 0..1 hidden trail tread
	keep    float32 // 0..1 keep vegetation away (trail verges, pads, glades)
	pond    float32 // 0..1 inside a carved pond's rim
	meadow  float32 // home dressing weights
	fern    float32
	ambient float32
	riverD  float32
	seaDist float32
}

// grid is a chunk's lod-0 vertex grid.
type grid struct {
	cx, cz int
	v      [gridN * gridN]gvert
}

// scratch buffers for building grids (the sample struct is large).
type gridScratch struct {
	h [apron * apron]float64
	s [gridN * gridN]sample
	r [gridN * gridN]ovResult
}

var scratchPool = sync.Pool{New: func() any { return new(gridScratch) }}

func (w *World) grid(cx, cz int) *grid {
	return w.grids.get(chunkKey{cx, cz}, func() *grid { return w.buildGrid(cx, cz) })
}

func (w *World) buildGrid(cx, cz int) *grid {
	gr := &grid{cx: cx, cz: cz}
	bx, bz := cx*core.ChunkSize, cz*core.ChunkSize
	var ov overlays
	w.overlaysFor(float64(bx)-gridStep, float64(bz)-gridStep, float64(bx+core.ChunkSize)+gridStep, float64(bz+core.ChunkSize)+gridStep, &ov)
	sc := scratchPool.Get().(*gridScratch)
	defer scratchPool.Put(sc)

	var tmp sample
	var tr ovResult
	for az := 0; az < apron; az++ {
		for ax := 0; ax < apron; ax++ {
			// Integer world coordinates: identical in every chunk that shares them.
			x := float64(bx + (ax-1)*gridStep)
			z := float64(bz + (az-1)*gridStep)
			ix, iz := ax-1, az-1
			if ix >= 0 && iz >= 0 && ix < gridN && iz < gridN {
				k := iz*gridN + ix
				w.g.sample(x, z, &sc.s[k])
				sc.h[az*apron+ax] = ov.apply(x, z, sc.s[k].h, &sc.r[k])
				continue
			}
			w.g.sample(x, z, &tmp)
			sc.h[az*apron+ax] = ov.apply(x, z, tmp.h, &tr)
		}
	}
	for iz := 0; iz < gridN; iz++ {
		for ix := 0; ix < gridN; ix++ {
			a := (iz+1)*apron + ix + 1
			h := sc.h[a]
			dx := (sc.h[a+1] - sc.h[a-1]) / (2 * gridStep)
			dz := (sc.h[a+apron] - sc.h[a-apron]) / (2 * gridStep)
			k := iz*gridN + ix
			w.fillVertex(&gr.v[k], float64(bx+ix*gridStep), float64(bz+iz*gridStep), h, dx, dz, &sc.s[k], &sc.r[k])
		}
	}
	return gr
}

// fillVertex derives a vertex's stored attributes from its sample, final height
// and height gradient (dx, dz).
func (w *World) fillVertex(v *gvert, x, z, h, dx, dz float64, s *sample, r *ovResult) {
	slope := hypot(dx, dz)
	inv := 1 / math.Sqrt(dx*dx+1+dz*dz)
	v.h = float32(h)
	v.slope = float32(slope)
	v.nrm = [3]int8{int8(math.Round(-dx * inv * 127)), int8(math.Round(inv * 127)), int8(math.Round(-dz * inv * 127))}
	v.reg = uint8(s.region)
	// Carved ponds are water whatever the climate said.
	hab := habitatOf(s, h, slope)
	if r.pond > 0.3 && h < 0.6 && s.region != core.RegionNone {
		hab = core.HabRiver
	}
	v.hab = uint8(hab)
	if s.sea {
		v.flags |= vfSea
	}
	if s.flowing {
		v.flags |= vfFlowing
	}
	if s.ice > 0.5 {
		v.flags |= vfIce
	}
	v.clear, v.thicket, v.conifer, v.rock = float32(s.clear), float32(s.thicket), float32(s.conifer), float32(s.rock)
	v.trail, v.htrail, v.keep, v.pond = float32(r.trail), float32(r.hidden), float32(r.clear), float32(r.pond)
	v.meadow, v.fern = float32(s.hMeadow), float32(s.hFern)
	v.ambient = float32(s.ambient)
	v.riverD, v.seaDist = float32(s.riverD), float32(s.seaDist)
	v.col = w.g.vertexColor(x, z, h, slope, hab, s, r)
}

// heightAt bilinearly interpolates the grid at fractional grid coordinates.
func (gr *grid) heightAt(fx, fz float64) float64 {
	ix := min(max(int(math.Floor(fx)), 0), gridN-2)
	iz := min(max(int(math.Floor(fz)), 0), gridN-2)
	tx := clamp01(fx - float64(ix))
	tz := clamp01(fz - float64(iz))
	k := iz*gridN + ix
	h00, h10 := float64(gr.v[k].h), float64(gr.v[k+1].h)
	h01, h11 := float64(gr.v[k+gridN].h), float64(gr.v[k+gridN+1].h)
	return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz)
}

func (gr *grid) ambientAt(fx, fz float64) float64 {
	ix := min(max(int(math.Floor(fx)), 0), gridN-2)
	iz := min(max(int(math.Floor(fz)), 0), gridN-2)
	tx := clamp01(fx - float64(ix))
	tz := clamp01(fz - float64(iz))
	k := iz*gridN + ix
	a00, a10 := float64(gr.v[k].ambient), float64(gr.v[k+1].ambient)
	a01, a11 := float64(gr.v[k+gridN].ambient), float64(gr.v[k+gridN+1].ambient)
	return lerp(lerp(a00, a10, tx), lerp(a01, a11, tx), tz)
}

// nearest returns the index of the vertex nearest to fractional grid coordinates.
func (gr *grid) nearest(fx, fz float64) int {
	ix := min(max(int(math.Round(fx)), 0), gridN-1)
	iz := min(max(int(math.Round(fz)), 0), gridN-1)
	return iz*gridN + ix
}

// local returns the fractional grid coordinates of world (x, z) in this chunk.
func (gr *grid) local(x, z float64) (fx, fz float64) {
	return (x - float64(gr.cx*core.ChunkSize)) / gridStep, (z - float64(gr.cz*core.ChunkSize)) / gridStep
}
