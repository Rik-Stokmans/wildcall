package world

import (
	"math"
	"strconv"
	"strings"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

const (
	featherChance   = 1.0 / 3 // a feather lies in about one cell in three
	featherOffTrail = 12.0    // feathers lie at least this far from any trail
	featherFromMain = 25.0    // ...and from the cell's feature
)

// overlaysFor gathers every ground edit that can affect the rectangle
// [x0,x1]x[z0,z1]: home pads/ponds/trails, generated pads/ponds/glades, generated
// trails. The order is global (home first, then cells row-major), so two
// rectangles that share a point apply that point's edits identically - which is
// what keeps chunk borders seamless.
func (w *World) overlaysFor(x0, z0, x1, z1 float64, dst *overlays) {
	if x1 > -homeR-300 && x0 < homeR+300 && z1 > -homeR-300 && z0 < homeR+300 {
		w.hl.ov.clip(x0, z0, x1, z1, dst)
	}
	const reach = 60 // the largest pad, pond or glade plus its blend
	for cz := cellOf(z0 - reach); cz <= cellOf(z1+reach); cz++ {
		for cx := cellOf(x0 - reach); cx <= cellOf(x1+reach); cx++ {
			w.cell(cx, cz).ov.clip(x0, z0, x1, z1, dst)
		}
	}
	for cz := cellOf(z0) - trailCells; cz <= cellOf(z1)+trailCells; cz++ {
		for cx := cellOf(x0) - trailCells; cx <= cellOf(x1)+trailCells; cx++ {
			gt := w.trail(cx, cz)
			if gt == nil || gt.x0 > x1+trailClear || gt.x1 < x0-trailClear || gt.z0 > z1+trailClear || gt.z1 < z0-trailClear {
				continue
			}
			dst.addSegs(gt.segs, x0, z0, x1, z1)
		}
	}
}

// finalHeight is the exact ground height at a point, with every overlay applied
// (the chunk grids hold exactly these values at their vertices).
func (w *World) finalHeight(x, z float64) float64 {
	var ov overlays
	w.overlaysFor(x-1, z-1, x+1, z+1, &ov)
	var s sample
	var r ovResult
	w.g.sample(x, z, &s)
	return ov.apply(x, z, s.h, &r)
}

// cellPOIs returns a cell's finished POIs: the stage-1 features with their final
// heights, plus the cell's feather (which needs the trails around it).
func (w *World) cellPOIs(cx, cz int) []core.POI {
	return w.pois.get(cellKey{cx, cz}, func() []core.POI { return w.buildCellPOIs(cx, cz) })
}

func (w *World) buildCellPOIs(cx, cz int) []core.POI {
	c := w.cell(cx, cz)
	out := make([]core.POI, 0, len(c.pois)+1)
	for i, p := range c.pois {
		p = clonePOI(p)
		if !c.onPad[i] {
			p.Pos.Y = float32(w.finalHeight(float64(p.Pos.X), float64(p.Pos.Z)))
		}
		out = append(out, p)
	}
	r := noise.NewRNG(noise.Hash2(uint64(w.seed)^0xfea7e5, int64(cx), int64(cz)))
	if !r.Chance(featherChance) {
		return out
	}
	x0, z0 := float64(cx)*cellSize, float64(cz)*cellSize
	var ov overlays
	w.overlaysFor(x0, z0, x0+cellSize, z0+cellSize, &ov)
	start := r.Intn(len(c.cands))
	for k := range c.cands {
		cd := &c.cands[(start+k)%len(c.cands)]
		if cd.region >= core.RegionCount || cd.h < 1.0 || cd.hab == core.HabCliff || cd.hab == core.HabOcean || cd.slope > 0.6 {
			continue
		}
		if cd.home && !w.hl.clearOf(cd.x, cd.z, 40, featherOffTrail) {
			continue
		}
		if p, ok := c.mainPOI(); ok && hypot(float64(p.Pos.X)-cd.x, float64(p.Pos.Z)-cd.z) < featherFromMain {
			continue
		}
		if ov.trailDist(cd.x, cd.z) < featherOffTrail {
			continue
		}
		// Nudge the feather off the candidate point so it does not sit on a
		// lattice; it stays within the cell margin.
		x := cd.x + r.Range(-6, 6)
		z := cd.z + r.Range(-6, 6)
		var s sample
		w.g.sample(x, z, &s)
		if s.region != cd.region || s.h < 1.0 {
			x, z = cd.x, cd.z
		}
		h := w.finalHeight(x, z)
		if h < 0.8 {
			continue
		}
		id := genID("feather", cx, cz)
		out = append(out, core.POI{ID: id, Kind: "feather", Name: poiName(w.seed, id, "feather", "", cd.region),
			Pos: vec(x, h, z), Yaw: float32(r.Range(0, 2*math.Pi)), Region: cd.region,
			Radius: poiRadius("feather"), Data: map[string]string{"region": cd.region.Key()}})
		break
	}
	return out
}

// trailDist is the distance to the nearest trail segment (visible or hidden).
func (o *overlays) trailDist(x, z float64) float64 {
	best := math.Inf(1)
	for i := range o.segs {
		s := &o.segs[i]
		if d, _ := distSeg(x, z, s.ax, s.az, s.bx, s.bz); d < best {
			best = d
		}
	}
	return best
}

// POIsNear appends every POI within radius (XZ) of (x, z): home and generated.
func (w *World) POIsNear(x, z, radius float32, buf []core.POI) []core.POI {
	fx, fz, r := float64(x), float64(z), float64(radius)
	in := func(p *core.POI) bool { return hypot(float64(p.Pos.X)-fx, float64(p.Pos.Z)-fz) <= r }
	for i := range w.hl.pois {
		if in(&w.hl.pois[i]) {
			buf = append(buf, clonePOI(w.hl.pois[i]))
		}
	}
	for cz := cellOf(fz - r); cz <= cellOf(fz+r); cz++ {
		for cx := cellOf(fx - r); cx <= cellOf(fx+r); cx++ {
			// Skip cells whose square lies wholly outside the circle.
			nx := clamp(fx, float64(cx)*cellSize, float64(cx+1)*cellSize)
			nz := clamp(fz, float64(cz)*cellSize, float64(cz+1)*cellSize)
			if hypot(nx-fx, nz-fz) > r {
				continue
			}
			ps := w.cellPOIs(cx, cz)
			for i := range ps {
				if in(&ps[i]) {
					buf = append(buf, clonePOI(ps[i]))
				}
			}
		}
	}
	return buf
}

// POI resolves a pinned or generated id ("<kind>@<cellX>,<cellZ>").
func (w *World) POI(id string) (core.POI, bool) {
	if i, ok := w.home[id]; ok {
		return clonePOI(w.hl.pois[i]), true
	}
	cx, cz, ok := parseGenID(id)
	if !ok {
		return core.POI{}, false
	}
	for _, p := range w.cellPOIs(cx, cz) {
		if p.ID == id {
			return clonePOI(p), true
		}
	}
	return core.POI{}, false
}

// parseGenID extracts the cell from "<kind>@<cellX>,<cellZ>".
func parseGenID(id string) (cx, cz int, ok bool) {
	at := strings.IndexByte(id, '@')
	if at <= 0 {
		return 0, 0, false
	}
	xs, zs, found := strings.Cut(id[at+1:], ",")
	if !found {
		return 0, 0, false
	}
	x, err1 := strconv.Atoi(xs)
	z, err2 := strconv.Atoi(zs)
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return x, z, true
}
