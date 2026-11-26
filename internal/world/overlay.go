package world

import "math"

// Trail footprint (metres from the centre line).
const (
	trailCore    = 1.25 // fully trodden earth
	trailEdge    = 2.6  // colour and flattening fade out here
	trailClear   = 3.2  // no trees or shrubs closer than this to a visible trail
	hiddenCore   = 0.5  // hidden trails are only a faint colour change
	hiddenEdge   = 1.3
	trailFlatten = 0.6 // how strongly a visible trail levels the ground across it
)

// trailSeg is one segment of a trail polyline with the ground height the trail
// was laid at on both ends.
type trailSeg struct {
	ax, az, ay float64
	bx, bz, by float64
	hidden     bool
}

func (s *trailSeg) bounds() (x0, z0, x1, z1 float64) {
	return math.Min(s.ax, s.bx), math.Min(s.az, s.bz), math.Max(s.ax, s.bx), math.Max(s.az, s.bz)
}

// overlays are the local terrain edits made by places and paths: trails level and
// tread the ground, ponds are carved, structure pads are flattened. They are applied
// on top of the climate terrain, in that order (pads win).
type overlays struct {
	pads   []pad
	ponds  []pond
	segs   []trailSeg
	glades []circle // vegetation-free clearings (no height change)
}

// ovResult describes what the overlays did at one point.
type ovResult struct {
	trail  float64 // 0..1 visible trail tread
	hidden float64 // 0..1 hidden trail tread
	pad    float64 // 0..1 structure pad / yard
	pond   float64 // 0..1 inside a carved pond's rim
	clear  float64 // 0..1 keep vegetation away (trail verge, pads)
}

// apply returns the edited height at (x, z) given the climate height h.
func (o *overlays) apply(x, z, h float64, r *ovResult) float64 {
	*r = ovResult{}
	if len(o.segs) > 0 {
		bestD, bestY := math.MaxFloat64, 0.0
		hidD := math.MaxFloat64
		for i := range o.segs {
			s := &o.segs[i]
			// Cheap reject before the exact distance.
			if x < math.Min(s.ax, s.bx)-trailClear || x > math.Max(s.ax, s.bx)+trailClear ||
				z < math.Min(s.az, s.bz)-trailClear || z > math.Max(s.az, s.bz)+trailClear {
				continue
			}
			d, t := distSeg(x, z, s.ax, s.az, s.bx, s.bz)
			if s.hidden {
				if d < hidD {
					hidD = d
				}
				continue
			}
			if d < bestD {
				bestD, bestY = d, lerp(s.ay, s.by, t)
			}
		}
		if bestD < trailClear {
			w := 1 - smoothstep(trailCore, trailEdge, bestD)
			h = lerp(h, bestY, trailFlatten*(1-smoothstep(trailCore*0.6, trailEdge+0.6, bestD)))
			r.trail = w
			r.clear = 1 - smoothstep(trailEdge, trailClear, bestD)
		}
		if hidD < hiddenEdge {
			r.hidden = 1 - smoothstep(hiddenCore, hiddenEdge, hidD)
		}
	}
	for i := range o.ponds {
		p := &o.ponds[i]
		if math.Abs(x-p.x) > p.rRim || math.Abs(z-p.z) > p.rRim {
			continue
		}
		nh := p.apply(x, z, h)
		if nh != h {
			r.pond = math.Max(r.pond, 1-smoothstep(p.rWater, p.rRim, hypot(x-p.x, z-p.z)))
		}
		h = nh
	}
	for i := range o.pads {
		p := &o.pads[i]
		if math.Abs(x-p.x) > p.r+p.blend || math.Abs(z-p.z) > p.r+p.blend {
			continue
		}
		var w float64
		h, w = p.apply(x, z, h)
		if w > 0 {
			k := 1 - smoothstep(p.r*0.8, p.r+2.5, hypot(x-p.x, z-p.z))
			r.pad = math.Max(r.pad, k)
			r.clear = math.Max(r.clear, 1-smoothstep(p.r+1.5, p.r+4, hypot(x-p.x, z-p.z)))
		}
	}
	for i := range o.glades {
		c := &o.glades[i]
		if d := c.dist(x, z); d < c.r+4 {
			r.clear = math.Max(r.clear, 1-smoothstep(c.r, c.r+4, d))
		}
	}
	return h
}

// clip returns the overlays that can affect the rectangle [x0,x1]x[z0,z1].
func (o *overlays) clip(x0, z0, x1, z1 float64, dst *overlays) {
	for i := range o.pads {
		p := &o.pads[i]
		e := p.r + p.blend
		if p.x+e >= x0 && p.x-e <= x1 && p.z+e >= z0 && p.z-e <= z1 {
			dst.pads = append(dst.pads, *p)
		}
	}
	for i := range o.ponds {
		p := &o.ponds[i]
		if p.x+p.rRim >= x0 && p.x-p.rRim <= x1 && p.z+p.rRim >= z0 && p.z-p.rRim <= z1 {
			dst.ponds = append(dst.ponds, *p)
		}
	}
	for i := range o.glades {
		c := &o.glades[i]
		e := c.r + 4
		if c.x+e >= x0 && c.x-e <= x1 && c.z+e >= z0 && c.z-e <= z1 {
			dst.glades = append(dst.glades, *c)
		}
	}
	dst.addSegs(o.segs, x0, z0, x1, z1)
}

func (o *overlays) addSegs(segs []trailSeg, x0, z0, x1, z1 float64) {
	for i := range segs {
		a, b, c, d := segs[i].bounds()
		if c+trailClear >= x0 && a-trailClear <= x1 && d+trailClear >= z0 && b-trailClear <= z1 {
			o.segs = append(o.segs, segs[i])
		}
	}
}
