package world

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Map tiles (contract §2.5): 128 px covering 512 m, north (-Z) up, in a soft
// parchment style - region tints, hillshade, faint contours, water, beaches and
// visible trails; no labels or icons.
//
// Seamlessness: colours and hillshade come from a lattice of samples at pixel
// CORNERS (x = tx*512 + i*4, i = 0..128), so two neighbouring tiles share their
// border lattice line, and trails and paper grain are evaluated in world space.

const (
	tilePx   = core.MapTilePx
	tileM    = core.MapTileSize
	tileStep = float64(tileM) / tilePx // 4 m per pixel
	tileL    = tilePx + 1              // lattice points per side
)

var (
	mPaper   = rgb{238, 225, 194}
	mWater   = rgb{156, 186, 196}
	mDeep    = rgb{116, 150, 172}
	mShore   = rgb{110, 132, 140}
	mSand    = rgb{234, 214, 168}
	mIce     = rgb{216, 232, 240}
	mTrail   = rgb{146, 104, 66}
	mForest  = rgb{150, 168, 118}
	mContour = rgb{150, 128, 96}
)

var mRegion = [core.RegionCount]rgb{
	core.RegionGreenhollow:     {190, 204, 150},
	core.RegionMurmurMarsh:     {178, 188, 146},
	core.RegionWindpeak:        {204, 192, 170},
	core.RegionWhisperingCoast: {218, 210, 172},
	core.RegionAmberwood:       {226, 190, 136},
	core.RegionFrostveil:       {234, 238, 240},
}

// MapTile renders (or returns the cached) PNG for tile (tx, tz).
func (w *World) MapTile(tx, tz int) ([]byte, error) {
	var err error
	b := w.tiles.get(cellKey{tx, tz}, func() []byte {
		var out []byte
		out, err = w.renderTile(tx, tz)
		return out
	})
	if b == nil && err == nil {
		// A concurrent caller's render failed; render again for this caller.
		return w.renderTile(tx, tz)
	}
	return b, err
}

// tilePoint is what the map needs from one lattice point.
type tilePoint struct {
	h   float64
	col rgb
	ice bool
}

func (w *World) renderTile(tx, tz int) ([]byte, error) {
	x0, z0 := float64(tx*tileM), float64(tz*tileM)
	var ov overlays
	w.overlaysFor(x0-tileStep, z0-tileStep, x0+tileM+tileStep, z0+tileM+tileStep, &ov)

	// Lattice with a one-point apron (for the slope used by the habitat tint).
	const la = tileL + 2
	hs := make([]float64, la*la)
	pts := make([]tilePoint, tileL*tileL)
	ss := make([]sample, tileL*tileL)
	var s sample
	var r ovResult
	for j := 0; j < la; j++ {
		for i := 0; i < la; i++ {
			x, z := x0+float64(i-1)*tileStep, z0+float64(j-1)*tileStep
			li, lj := i-1, j-1
			if li >= 0 && lj >= 0 && li < tileL && lj < tileL {
				p := &ss[lj*tileL+li]
				w.g.sample(x, z, p)
				hs[j*la+i] = ov.apply(x, z, p.h, &r)
				continue
			}
			w.g.sample(x, z, &s)
			hs[j*la+i] = ov.apply(x, z, s.h, &r)
		}
	}
	for j := 0; j < tileL; j++ {
		for i := 0; i < tileL; i++ {
			a := (j+1)*la + i + 1
			h := hs[a]
			slope := hypot(hs[a+1]-hs[a-1], hs[a+la]-hs[a-la]) / (2 * tileStep)
			p := &ss[j*tileL+i]
			x, z := x0+float64(i)*tileStep, z0+float64(j)*tileStep
			pts[j*tileL+i] = w.tilePointColor(x, z, h, slope, p)
		}
	}

	img := image.NewNRGBA(image.Rect(0, 0, tilePx, tilePx))
	for py := 0; py < tilePx; py++ {
		for px := 0; px < tilePx; px++ {
			k := py*tileL + px
			c00, c10, c01, c11 := &pts[k], &pts[k+1], &pts[k+tileL], &pts[k+tileL+1]
			x := x0 + (float64(px)+0.5)*tileStep
			z := z0 + (float64(py)+0.5)*tileStep
			col := c00.col.add(c10.col, 1).add(c01.col, 1).add(c11.col, 1).scale(0.25)
			wet := 0
			for _, c := range [4]*tilePoint{c00, c10, c01, c11} {
				if c.h < 0 && !c.ice {
					wet++
				}
			}
			if wet > 0 && wet < 4 {
				col = col.mix(mShore, 0.55) // an inked shoreline
			} else if wet == 0 {
				// Hillshade from the corner gradient, light from the north-west.
				gx := ((c10.h - c00.h) + (c11.h - c01.h)) / (2 * tileStep)
				gz := ((c01.h - c00.h) + (c11.h - c10.h)) / (2 * tileStep)
				const zf = 2.2
				nx, ny, nz := -gx*zf, 1.0, -gz*zf
				nl := math.Sqrt(nx*nx + ny*ny + nz*nz)
				lx, ly, lz := -0.5, 0.7071, -0.5
				shade := (nx*lx + ny*ly + nz*lz) / nl
				col = col.scale(1 + 0.55*(shade-0.7071))
				// Faint contour every 25 m.
				lo := math.Min(math.Min(c00.h, c10.h), math.Min(c01.h, c11.h))
				hi := math.Max(math.Max(c00.h, c10.h), math.Max(c01.h, c11.h))
				if math.Floor(lo/25) != math.Floor(hi/25) && lo > 2 {
					col = col.mix(mContour, 0.22)
				}
			}
			// Visible trails, drawn in world space so they join across tiles.
			if d := ov.visibleTrailDist(x, z); d < 4 {
				col = col.mix(mTrail, 0.85*(1-smoothstep(1.4, 3.6, d)))
			}
			// Paper grain.
			col = col.scale(1 + 0.025*w.g.n[lGrain].Eval(x/11, z/11) + 0.02*w.g.n[lColor].Eval(x/90, z/90))
			img.SetNRGBA(px, py, color.NRGBA{to8(col.r), to8(col.g), to8(col.b), 255})
		}
	}
	var out bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&out, img); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// tilePointColor is the map colour of one lattice point.
func (w *World) tilePointColor(x, z, h, slope float64, s *sample) tilePoint {
	tp := tilePoint{h: h, ice: s.ice > 0.5}
	if h < 0 && !tp.ice {
		tp.col = mWater.mix(mDeep, smoothstep(-0.5, -14, h))
		return tp
	}
	var tint rgb
	tot := 0.0
	for i := range mRegion {
		if wt := s.w[i]; wt > 0 {
			tint = tint.add(mRegion[i], wt)
			tot += wt
		}
	}
	col := mPaper
	if tot > 0 {
		col = col.mix(tint.scale(1/tot), 0.7)
	}
	switch habitatOf(s, h, slope) {
	case core.HabWoodland, core.HabConifer:
		if s.w[core.RegionFrostveil] < 0.5 && s.w[core.RegionAmberwood] < 0.5 {
			col = col.mix(mForest, 0.28)
		} else {
			col = col.scale(0.95)
		}
	case core.HabCliff:
		col = col.scale(0.88)
	case core.HabBeach:
		col = col.mix(mSand, 0.8)
	}
	if tp.ice {
		col = col.mix(mIce, 0.8)
	}
	tp.col = col
	return tp
}

// visibleTrailDist is the distance to the nearest visible trail segment.
func (o *overlays) visibleTrailDist(x, z float64) float64 {
	best := math.Inf(1)
	for i := range o.segs {
		s := &o.segs[i]
		if s.hidden || x < math.Min(s.ax, s.bx)-4 || x > math.Max(s.ax, s.bx)+4 || z < math.Min(s.az, s.bz)-4 || z > math.Max(s.az, s.bz)+4 {
			continue
		}
		if d, _ := distSeg(x, z, s.ax, s.az, s.bx, s.bz); d < best {
			best = d
		}
	}
	return best
}
