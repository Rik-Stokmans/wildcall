package world

import (
	"math"
	"sync"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Tree models (contract §11). Every tree kind has core.TreeVariants branching
// models, grown once by a deterministic algorithm with fixed seeds: they are
// species shapes, identical in every world. The client builds the visible trees
// from the same data (welcome.trees) and the world derives its tree perches from
// it, so a bird reported on a branch stands on a limb that is really drawn there.
//
// Model space: metres at scale 1, Y up, trunk base at the origin. An instance
// places a model with its uniform scale, then its rotation about Y (three.js
// convention, the same matrix the client builds from the chunk record:
// x' = x·cos(rot) + z·sin(rot), z' = −x·sin(rot) + z·cos(rot)), then its position.

const (
	treeMaxSegs   = 70
	treeMinSegs   = 25
	treeMaxLeaves = 18
	treeMinLeaves = 6
)

// v3 is a small float64 vector for the model builder.
type v3 struct{ x, y, z float64 }

func (a v3) add(b v3) v3             { return v3{a.x + b.x, a.y + b.y, a.z + b.z} }
func (a v3) sub(b v3) v3             { return v3{a.x - b.x, a.y - b.y, a.z - b.z} }
func (a v3) scale(k float64) v3      { return v3{a.x * k, a.y * k, a.z * k} }
func (a v3) dot(b v3) float64        { return a.x*b.x + a.y*b.y + a.z*b.z }
func (a v3) len() float64            { return math.Sqrt(a.dot(a)) }
func (a v3) lerp(b v3, t float64) v3 { return a.add(b.sub(a).scale(t)) }
func (a v3) cross(b v3) v3 {
	return v3{a.y*b.z - a.z*b.y, a.z*b.x - a.x*b.z, a.x*b.y - a.y*b.x}
}
func (a v3) norm() v3 {
	l := a.len()
	if l < 1e-12 {
		return v3{0, 1, 0}
	}
	return a.scale(1 / l)
}
func (a v3) f32() [3]float32 { return [3]float32{float32(a.x), float32(a.y), float32(a.z)} }

var vUp = v3{0, 1, 0}

// dirAE is the unit direction with compass azimuth az (model space: 0 = +Z,
// π/2 = +X) and elevation el above the horizontal.
func dirAE(az, el float64) v3 {
	c := math.Cos(el)
	return v3{c * math.Sin(az), math.Sin(el), c * math.Cos(az)}
}

// azOf is the azimuth of a direction's horizontal part.
func azOf(d v3) float64 { return math.Atan2(d.x, d.z) }

// elOf is the elevation of a direction above the horizontal.
func elOf(d v3) float64 { return math.Asin(clamp(d.norm().y, -1, 1)) }

// perpUp is the unit direction perpendicular to axis d that points most upwards
// (the top of a limb's cross-section). For a vertical axis it falls back to side.
func perpUp(d, side v3) v3 {
	d = d.norm()
	p := vUp.sub(d.scale(d.dot(vUp)))
	if p.len() < 1e-3 {
		p = side.sub(d.scale(d.dot(side)))
	}
	return p.norm()
}

// perpTowards is the unit direction perpendicular to axis d closest to w.
func perpTowards(d, w v3) v3 {
	d = d.norm()
	p := w.sub(d.scale(d.dot(w)))
	if p.len() < 1e-6 {
		p = perpUp(d, v3{1, 0, 0})
	}
	return p.norm()
}

// segDist is the shortest distance between segments p1-q1 and p2-q2.
func segDist(p1, q1, p2, q2 v3) float64 {
	d1, d2, r := q1.sub(p1), q2.sub(p2), p1.sub(p2)
	a, e, f := d1.dot(d1), d2.dot(d2), d2.dot(r)
	var s, t float64
	switch {
	case a <= 1e-12 && e <= 1e-12:
		return r.len()
	case a <= 1e-12:
		t = clamp01(f / e)
	default:
		c := d1.dot(r)
		if e <= 1e-12 {
			s = clamp01(-c / a)
		} else {
			b := d1.dot(d2)
			den := a*e - b*b
			if den > 1e-12 {
				s = clamp01((b*f - c*e) / den)
			}
			t = (b*s + f) / e
			if t < 0 {
				t, s = 0, clamp01(-c/a)
			} else if t > 1 {
				t, s = 1, clamp01((b-c)/a)
			}
		}
	}
	return p1.add(d1.scale(s)).sub(p2.add(d2.scale(t))).len()
}

// pointSeg returns the distance from p to segment a-b and the parameter of the
// closest point.
func pointSeg(p, a, b v3) (float64, float64) {
	d := b.sub(a)
	l2 := d.dot(d)
	t := 0.0
	if l2 > 1e-12 {
		t = clamp01(p.sub(a).dot(d) / l2)
	}
	return p.sub(a.add(d.scale(t))).len(), t
}

// tseg is one limb segment while a model is built (and after, in float64).
type tseg struct {
	a, b   v3
	ra, rb float64
	parent int
	order  int     // 0 trunk, 1 primary limb, 2 secondary branch, 3 twig
	est    float64 // radius estimate used for collision tests while growing
}

func (s *tseg) dir() v3               { return s.b.sub(s.a).norm() }
func (s *tseg) at(t float64) v3       { return s.a.lerp(s.b, t) }
func (s *tseg) rAt(t float64) float64 { return lerp(s.ra, s.rb, t) }

// tleaf is a foliage mass: an axis-aligned ellipsoid.
type tleaf struct{ c, r v3 }

// leafAnchor is a branch end that may carry a foliage mass.
type leafAnchor struct {
	p, out v3
	w      float64 // preference when choosing which ends carry foliage
}

// tBuilder grows one model.
type tBuilder struct {
	rng     noise.RNG
	segs    []tseg
	kids    [][]int
	leaves  []tleaf
	anchors []leafAnchor
	estR    [4]float64
}

// grow appends a chain of up to n equal segments of total length from the end of
// segment parent (from p when parent < 0). steer turns the direction before each
// segment after the first. The chain stops early when a segment would pass
// through existing wood, dip towards the ground or the segment budget is spent.
// It returns the indices of the segments added.
func (b *tBuilder) grow(parent int, p, dir v3, length float64, n, order int, steer func(i int, d v3) v3) []int {
	var out []int
	step := length / float64(n)
	d := dir.norm()
	for i := 0; i < n; i++ {
		if len(b.segs) >= treeMaxSegs {
			break
		}
		if i > 0 && steer != nil {
			d = steer(i, d).norm()
		}
		q := p.add(d.scale(step))
		if q.y < 0.6 || !b.clear(p, q, b.estR[order], parent) {
			break
		}
		idx := len(b.segs)
		b.segs = append(b.segs, tseg{a: p, b: q, parent: parent, order: order, est: b.estR[order]})
		b.kids = append(b.kids, nil)
		if parent >= 0 {
			b.kids[parent] = append(b.kids[parent], idx)
		}
		out = append(out, idx)
		parent, p = idx, q
	}
	return out
}

// branch grows a side chain from the end of segment parent, retrying a few
// directions (pick returns one per attempt) when the first segment is blocked.
func (b *tBuilder) branch(parent int, pick func(attempt int) v3, length float64, n, order int, steer func(i int, d v3) v3) []int {
	if parent < 0 || len(b.segs) >= treeMaxSegs {
		return nil
	}
	p := b.segs[parent].b
	for k := 0; k < 5; k++ {
		if c := b.grow(parent, p, pick(k), length, n, order, steer); len(c) > 0 {
			return c
		}
	}
	return nil
}

// clear reports whether a new segment p-q of radius r growing from parent keeps
// clear of all existing wood: siblings from the same node must diverge, other
// segments must not come closer than the sum of the radii (the first part of the
// new segment, still inside its parent's junction, is not tested).
func (b *tBuilder) clear(p, q v3, r float64, parent int) bool {
	d := q.sub(p)
	l := d.len()
	gp, pr := -1, 0.0
	if parent >= 0 {
		gp, pr = b.segs[parent].parent, b.segs[parent].est
	}
	t0 := math.Min(0.5, (pr+r)/l)
	p0 := p.add(d.scale(t0))
	for j := range b.segs {
		if j == parent || j == gp {
			continue
		}
		s := &b.segs[j]
		if parent >= 0 && s.parent == parent {
			if math.Acos(clamp(d.norm().dot(s.dir()), -1, 1)) < 0.42 {
				return false
			}
			continue
		}
		if segDist(p0, q, s.a, s.b) < r+s.est+0.04 {
			return false
		}
	}
	return true
}

// anchor records a branch end as a candidate foliage site.
func (b *tBuilder) anchor(seg int, w float64) {
	if seg < 0 {
		return
	}
	s := &b.segs[seg]
	out := v3{s.b.x, 0, s.b.z}
	if out.len() < 0.2 {
		out = s.dir()
		out.y = 0
	}
	b.anchors = append(b.anchors, leafAnchor{p: s.b, out: out.norm(), w: w})
}

func last(ix []int) int {
	if len(ix) == 0 {
		return -1
	}
	return ix[len(ix)-1]
}

// wobble returns a steering function: a pull towards up (negative = droop), a
// turn about the vertical (spiralling), and random wander.
func (b *tBuilder) wobble(tropism, twist, wander float64) func(int, v3) v3 {
	return func(_ int, d v3) v3 {
		if twist != 0 {
			az, el := azOf(d), elOf(d)
			d = dirAE(az+twist, el)
		}
		return d.add(vUp.scale(tropism)).add(v3{b.rng.Range(-wander, wander), b.rng.Range(-wander, wander) * 0.5, b.rng.Range(-wander, wander)})
	}
}

// placeLeaves chooses up to k well-spread anchors (farthest-point sampling,
// starting from the highest) and puts a foliage mass around each, with the
// branch end inside it towards the lower, inner side so the twig carries it.
func (b *tBuilder) placeLeaves(k int, rx, ry [2]float64, lift, outward float64) {
	if len(b.anchors) == 0 {
		return
	}
	chosen := make([]bool, len(b.anchors))
	dist := make([]float64, len(b.anchors))
	first := 0
	for i, a := range b.anchors {
		if a.p.y > b.anchors[first].p.y {
			first = i
		}
		dist[i] = math.Inf(1)
	}
	pick := first
	for n := 0; n < k && pick >= 0; n++ {
		chosen[pick] = true
		a := b.anchors[pick]
		r := v3{b.rng.Range(rx[0], rx[1]), b.rng.Range(ry[0], ry[1]), 0}
		r.z = r.x * b.rng.Range(0.85, 1.15)
		c := a.p.add(a.out.scale(outward * r.x)).add(vUp.scale(lift * r.y))
		b.leaves = append(b.leaves, tleaf{c: c, r: r})
		pick = -1
		best := -1.0
		for i, o := range b.anchors {
			if chosen[i] {
				continue
			}
			d := o.p.sub(a.p).len()
			if d < dist[i] {
				dist[i] = d
			}
			if s := dist[i] * o.w; s > best {
				best, pick = s, i
			}
		}
	}
}

// emergentTop makes sure the highest twig pokes out above the foliage: a song
// post on the very top of the tree.
func (b *tBuilder) emergentTop() {
	top := -1.0
	for _, l := range b.leaves {
		top = math.Max(top, l.c.y+l.r.y)
	}
	hi := 0
	for i := range b.segs {
		if b.segs[i].b.y > b.segs[hi].b.y && len(b.kids[i]) == 0 {
			hi = i
		}
	}
	tip := b.segs[hi].b
	if tip.y >= top+0.15 || len(b.segs) >= treeMaxSegs {
		return
	}
	d := v3{b.rng.Range(-0.08, 0.08), 1, b.rng.Range(-0.08, 0.08)}.norm()
	l := (top + 0.3 - tip.y) / d.y
	idx := len(b.segs)
	b.segs = append(b.segs, tseg{a: tip, b: tip.add(d.scale(l)), parent: hi, order: 3, est: b.estR[3]})
	b.kids = append(b.kids, nil)
	b.kids[hi] = append(b.kids[hi], idx)
}

// treeParams are the per-kind constants of a model.
type treeParams struct {
	height float64 // nominal height at scale 1
	baseR  float64 // trunk radius just above the root flare
	minR   float64 // thinnest wood (twig tips; broken ends on snags)
}

var treeKindParams = map[core.VegKind]treeParams{
	core.VegOak:      {height: 11, baseR: 0.44, minR: 0.02},
	core.VegBirch:    {height: 10, baseR: 0.21, minR: 0.014},
	core.VegPine:     {height: 14, baseR: 0.31, minR: 0.02},
	core.VegSnag:     {height: 8, baseR: 0.31, minR: 0.045},
	core.VegChestnut: {height: 13, baseR: 0.5, minR: 0.022},
}

// treeBase maps every tree kind to the kind whose structure it shares.
func treeBase(k core.VegKind) core.VegKind {
	switch k {
	case core.VegAmberOak:
		return core.VegOak
	case core.VegAmberBirch:
		return core.VegBirch
	case core.VegSnowPine:
		return core.VegPine
	}
	return k
}

// treeKinds lists the tree kinds in wire order.
var treeKinds = func() []core.VegKind {
	var out []core.VegKind
	for k := core.VegKind(0); k < core.VegKindCount; k++ {
		if k.IsTree() {
			out = append(out, k)
		}
	}
	return out
}()

// buildTree grows the model for a base kind and variant.
func buildTree(kind core.VegKind, variant int) (segs []tseg, leaves []tleaf) {
	b := &tBuilder{rng: noise.NewRNG(noise.Hash2(0x7ee5eed, int64(kind), int64(variant)))}
	switch kind {
	case core.VegOak:
		b.estR = [4]float64{0.42, 0.17, 0.08, 0.035}
		b.oak(variant)
	case core.VegBirch:
		b.estR = [4]float64{0.18, 0.06, 0.03, 0.018}
		b.birch(variant)
	case core.VegPine:
		b.estR = [4]float64{0.28, 0.07, 0.035, 0.02}
		b.pine(variant)
	case core.VegSnag:
		b.estR = [4]float64{0.3, 0.1, 0.06, 0.045}
		b.snag(variant)
	case core.VegChestnut:
		b.estR = [4]float64{0.46, 0.18, 0.08, 0.035}
		b.chestnut(variant)
	}
	p := treeKindParams[kind]
	h := p.height * (0.93 + 0.14*b.rng.Float64())
	b.finish(h, p.baseR*h/p.height, p.minR)
	return b.segs, b.leaves
}

// oak: short stout bole, heavy limbs spreading from a low crown break, secondary
// branches and twigs carrying a broad dome of foliage clumps.
func (b *tBuilder) oak(variant int) {
	r := &b.rng
	lean := dirAE(r.Range(0, 2*math.Pi), math.Pi/2-r.Range(0.02, 0.07))
	bole := r.Range(2.9, 3.7)
	trunk := b.grow(-1, v3{}, lean, bole, 3, 0, b.wobble(0.04, 0, 0.05))
	if len(trunk) < 3 {
		return
	}
	az0 := r.Range(0, 2*math.Pi)
	type limb struct {
		node   int
		az, el float64
		length float64
		leader bool
	}
	var limbs []limb
	// Variant 0 is the grand, wide-spreading oak (the Old Oak uses it).
	spread := 1.0
	if variant%core.TreeVariants == 0 {
		spread = 1.12
	}
	// Low heavy limbs reaching out sideways give the crown its broad dome.
	low := 1 + r.Intn(2)
	if variant%core.TreeVariants == 0 {
		low = 2
	}
	for k := 0; k < low; k++ {
		limbs = append(limbs, limb{node: trunk[1], az: az0 + math.Pi + float64(k)*2.3 + r.Range(-0.4, 0.4), el: r.Range(0.36, 0.56), length: r.Range(3.4, 4.1) * spread})
	}
	limbs = append(limbs, limb{node: trunk[2], az: az0 + r.Range(-0.5, 0.5), el: r.Range(1.15, 1.35), length: r.Range(5.0, 6.0), leader: true})
	n := 3 + r.Intn(2)
	for k := 0; k < n; k++ {
		az := az0 + float64(k+1)*2*math.Pi/float64(n+1) + r.Range(-0.3, 0.3)
		limbs = append(limbs, limb{node: trunk[2], az: az, el: r.Range(0.6, 0.9), length: r.Range(3.9, 4.8) * spread})
	}
	var ends [][]int
	for _, l := range limbs {
		l := l
		c := b.branch(l.node, func(k int) v3 { return dirAE(l.az+float64(k)*0.45*sgn(k), l.el+float64(k)*0.06) }, l.length, 3, 1, b.wobble(0.13, 0, 0.1))
		if len(c) > 0 {
			ends = append(ends, c)
		}
	}
	// Secondary branches from the first two limb nodes, alternating sides, grown
	// breadth first so every limb gets its share of the segment budget.
	var sites []twigSite
	for i := 0; i < 2; i++ {
		for li, c := range ends {
			if i >= len(c)-1 {
				continue
			}
			d := b.segs[c[i]].dir()
			side := sgn(i + li)
			az, el := azOf(d), elOf(d)
			length := r.Range(2.0, 2.9) * (1 - 0.18*float64(i))
			sec := b.branch(c[i], func(k int) v3 {
				return dirAE(az+side*(r.Range(0.7, 1.1)+0.25*float64(k)), math.Min(el*0.5+r.Range(-0.05, 0.25), 1.0))
			}, length, 2, 2, b.wobble(0.12, 0, 0.12))
			if len(sec) > 0 {
				sites = append(sites, twigSite{last(sec), 0.8, 1.2, 0.1})
			}
		}
	}
	for _, c := range ends {
		sites = append(sites, twigSite{last(c), 0.9, 1.4, 0.35})
	}
	b.twigRounds(sites, 2)
	b.placeLeaves(14+r.Intn(5), [2]float64{1.6, 2.1}, [2]float64{1.05, 1.4}, 0.2, 0.25)
	b.emergentTop()
}

// birch: slim, slightly leaning stem running nearly to the top, ascending limbs
// that arch over into fine drooping ends, a narrow oval crown.
func (b *tBuilder) birch(variant int) {
	r := &b.rng
	leanAz := r.Range(0, 2*math.Pi)
	lean := dirAE(leanAz, math.Pi/2-r.Range(0.05, 0.12))
	trunk := b.grow(-1, v3{}, lean, r.Range(8.4, 9.0), 7, 0, func(_ int, d v3) v3 {
		return d.add(v3{r.Range(-0.04, 0.04), 0.02, r.Range(-0.04, 0.04)})
	})
	if len(trunk) < 6 {
		return
	}
	az := r.Range(0, 2*math.Pi)
	for i := 2; i < len(trunk); i++ {
		h := b.segs[trunk[i]].b.y
		u := h / 9
		count := 1
		if u > 0.35 && u < 0.8 {
			count = 2
		}
		for c := 0; c < count; c++ {
			az += 2.4 + r.Range(-0.25, 0.25)
			a := az
			length := (1.0 + 1.5*math.Sin(math.Pi*math.Min(u*1.1, 1))) * r.Range(0.85, 1.1)
			el := r.Range(0.75, 1.05)
			limb := b.branch(trunk[i], func(k int) v3 { return dirAE(a+float64(k)*0.5*sgn(k), el-0.05*float64(k)) }, length, 2, 1, func(_ int, d v3) v3 {
				return d.add(vUp.scale(-0.45)).add(v3{r.Range(-0.08, 0.08), 0, r.Range(-0.08, 0.08)})
			})
			if len(limb) == 0 {
				continue
			}
			// Fine drooping ends.
			b.droop(last(limb), 1+r.Intn(2), 0.8, 1.25)
			if len(limb) > 1 && r.Chance(0.5) {
				b.droop(limb[0], 1, 0.6, 0.9)
			}
		}
	}
	b.anchor(last(trunk), 1.3)
	b.placeLeaves(9+r.Intn(5), [2]float64{0.72, 1.0}, [2]float64{1.0, 1.35}, -0.15, 0.1)
	b.emergentTop()
}

// pine: straight stem, whorls of near-horizontal branches from part-way up
// (bare lower trunk), flat foliage pads that layer the crown.
func (b *tBuilder) pine(variant int) {
	r := &b.rng
	trunk := b.grow(-1, v3{}, dirAE(r.Range(0, 2*math.Pi), math.Pi/2-r.Range(0, 0.03)), 13.4, 8, 0, func(_ int, d v3) v3 {
		return d.add(v3{r.Range(-0.025, 0.025), 0.02, r.Range(-0.025, 0.025)})
	})
	if len(trunk) < 8 {
		return
	}
	// Variants 0-3 are mature trees (high, flat-topped crowns), 4-5 younger
	// conical ones with branches lower down.
	young := variant%core.TreeVariants >= 4
	first := 3 + r.Intn(2)
	if young {
		first = 2
	}
	az := r.Range(0, 2*math.Pi)
	type pad struct {
		seg    []int
		length float64
	}
	var pads []pad
	for i := first; i < len(trunk); i++ {
		u := (float64(i) - float64(first)) / float64(len(trunk)-1-first)
		var length float64
		if young {
			length = 3.3*(1-u) + 0.7
		} else {
			length = 2.4 + 1.1*math.Sin(math.Pi*math.Min(0.25+u*0.85, 1)) - 0.9*u*u
		}
		if i == len(trunk)-1 {
			length *= 0.6
		}
		n := 3
		if r.Chance(0.35) && i < len(trunk)-1 {
			n = 4
		}
		az += 2.4
		for k := 0; k < n; k++ {
			a := az + float64(k)*2*math.Pi/float64(n) + r.Range(-0.3, 0.3)
			el := r.Range(-0.14, 0.12) + 0.12*u
			l := 0.85 * length * r.Range(0.85, 1.12)
			br := b.branch(trunk[i], func(t int) v3 { return dirAE(a+float64(t)*0.4*sgn(t), el) }, l, 2, 1, b.wobble(0.1, 0, 0.06))
			if len(br) == 0 {
				continue
			}
			pads = append(pads, pad{br, l})
			if len(b.segs) < treeMaxSegs-1 {
				d := b.segs[last(br)].dir()
				b.branch(last(br), func(t int) v3 { return dirAE(azOf(d)+r.Range(-0.3, 0.3), elOf(d)+0.3) }, r.Range(0.45, 0.75), 1, 3, nil)
			}
		}
	}
	// Pads: one per branch (the longest ones first when there are too many),
	// plus a tuft at the top that the leader pokes out of.
	for i := 1; i < len(pads); i++ {
		for j := i; j > 0 && pads[j].length > pads[j-1].length; j-- {
			pads[j], pads[j-1] = pads[j-1], pads[j]
		}
	}
	if len(pads) > treeMaxLeaves-1 {
		pads = pads[:treeMaxLeaves-1]
	}
	for _, p := range pads {
		s0, s1 := &b.segs[p.seg[0]], &b.segs[last(p.seg)]
		c := s0.a.lerp(s1.b, 0.68)
		rx := 0.42*p.length + 0.55
		b.leaves = append(b.leaves, tleaf{c: c.add(vUp.scale(0.22)), r: v3{rx, r.Range(0.45, 0.68), rx * r.Range(0.85, 1.15)}})
	}
	top := b.segs[last(trunk)].b
	b.leaves = append(b.leaves, tleaf{c: top.sub(v3{0, 1.15, 0}), r: v3{0.95, 1.0, 0.95}})
}

// snag: a dead stem with a broken top, a few bare broken limbs and stubs.
func (b *tBuilder) snag(variant int) {
	r := &b.rng
	trunk := b.grow(-1, v3{}, dirAE(r.Range(0, 2*math.Pi), math.Pi/2-r.Range(0.03, 0.1)), r.Range(7.0, 7.8), 5, 0, b.wobble(0, 0, 0.06))
	if len(trunk) < 5 {
		return
	}
	az := r.Range(0, 2*math.Pi)
	var limbs [][]int
	n := 3 + r.Intn(3)
	for k := 0; k < n; k++ {
		node := trunk[1+k%4]
		az += 2.2 + r.Range(-0.4, 0.4)
		a := az
		el := r.Range(0.1, 0.8)
		c := b.branch(node, func(t int) v3 { return dirAE(a+float64(t)*0.5*sgn(t), el) }, r.Range(2.0, 3.6), 2+r.Intn(2), 1, b.wobble(-0.03, 0, 0.18))
		if len(c) > 0 {
			limbs = append(limbs, c)
		}
	}
	// Stubs of fallen twigs and branches until the model is detailed enough.
	for tries := 0; len(b.segs) < treeMinSegs+2+r.Intn(4) && tries < 80; tries++ {
		var node int
		if len(limbs) > 0 && r.Chance(0.6) {
			l := limbs[r.Intn(len(limbs))]
			node = l[r.Intn(len(l))]
		} else {
			node = trunk[1+r.Intn(len(trunk)-1)]
		}
		d := b.segs[node].dir()
		a := azOf(d) + r.Range(-2.4, 2.4)
		el := r.Range(-0.1, 0.8)
		order := min(b.segs[node].order+1, 3)
		b.branch(node, func(t int) v3 { return dirAE(a+float64(t)*0.6, el) }, r.Range(0.35, 0.9), 1, order, nil)
	}
}

// chestnut: tall bole, a leader with limbs spiralling up around it, limbs that
// twist as they grow, and a big rounded crown.
func (b *tBuilder) chestnut(variant int) {
	r := &b.rng
	twist := r.Range(0.12, 0.2)
	if variant%2 == 1 {
		twist = -twist
	}
	trunk := b.grow(-1, v3{}, dirAE(r.Range(0, 2*math.Pi), math.Pi/2-r.Range(0.02, 0.06)), r.Range(3.9, 4.6), 2, 0, nil)
	if len(trunk) < 2 {
		return
	}
	lead := b.grow(last(trunk), b.segs[last(trunk)].b, dirAE(r.Range(0, 2*math.Pi), math.Pi/2-0.08), r.Range(4.6, 5.4), 3, 0, b.wobble(0.05, twist, 0.05))
	nodes := append([]int{trunk[1]}, lead...)
	az := r.Range(0, 2*math.Pi)
	var limbs [][]int
	for i, node := range nodes {
		count := 2
		if i == len(nodes)-1 {
			count = 1
		}
		for c := 0; c < count; c++ {
			az += 2.4 + twist
			a := az
			u := float64(i) / float64(len(nodes))
			el := r.Range(0.45, 0.75) + 0.25*u
			length := r.Range(4.6, 6.0) * (1 - 0.3*u)
			l := b.branch(node, func(t int) v3 { return dirAE(a+float64(t)*0.45*sgn(t), el) }, length, 3, 1, b.wobble(0.1, twist, 0.08))
			if len(l) > 0 {
				limbs = append(limbs, l)
			}
		}
	}
	var sites []twigSite
	for _, l := range limbs {
		if len(l) > 1 {
			d := b.segs[l[1]].dir()
			side := sgn(len(b.segs))
			sec := b.branch(l[0], func(t int) v3 { return dirAE(azOf(d)+side*(0.75+0.3*float64(t)), elOf(d)+0.3) }, r.Range(2.0, 2.8), 2, 2, b.wobble(0.1, twist, 0.1))
			if len(sec) > 0 {
				sites = append(sites, twigSite{last(sec), 0.8, 1.2, 0.3})
			}
		}
		sites = append(sites, twigSite{last(l), 0.9, 1.3, 0.3})
	}
	b.twigRounds(sites, 2)
	b.anchor(last(lead), 1.2)
	b.placeLeaves(14+r.Intn(5), [2]float64{1.9, 2.5}, [2]float64{1.35, 1.75}, 0.3, 0.25)
	b.emergentTop()
}

// twigSite is a branch end that sprouts twigs.
type twigSite struct {
	seg    int
	lo, hi float64 // twig length range
	lift   float64 // radians above the branch's own elevation
}

// twigRounds adds one-segment twigs to the sites, fanned out around each
// branch's direction, one per site per round (so the budget is shared evenly),
// up to perSite each. Every twig end, or the bare site when it got none, is
// recorded as a foliage site.
func (b *tBuilder) twigRounds(sites []twigSite, perSite int) {
	got := make([]bool, len(sites))
	for k := 0; k < perSite; k++ {
		side := sgn(k)
		for i, s := range sites {
			d := b.segs[s.seg].dir()
			a := azOf(d) + side*b.rng.Range(0.25, 0.75)
			el := math.Min(elOf(d)+s.lift+b.rng.Range(-0.15, 0.15), 1.3)
			t := b.branch(s.seg, func(t int) v3 { return dirAE(a+float64(t)*0.4*side, el) }, b.rng.Range(s.lo, s.hi), 1, 3, nil)
			if len(t) > 0 {
				b.anchor(t[0], 1)
				got[i] = true
			}
		}
	}
	for i, s := range sites {
		if !got[i] {
			b.anchor(s.seg, 0.9)
		}
	}
}

// droop adds up to n fine twigs hanging down from the end of seg (birch).
func (b *tBuilder) droop(seg, n int, lo, hi float64) {
	d := b.segs[seg].dir()
	added := false
	for k := 0; k < n; k++ {
		a := azOf(d) + b.rng.Range(-0.6, 0.6)
		el := -b.rng.Range(0.35, 0.95)
		t := b.branch(seg, func(t int) v3 { return dirAE(a+float64(t)*0.5, el+float64(t)*0.15) }, b.rng.Range(lo, hi), 1, 3, nil)
		if len(t) > 0 {
			b.anchor(t[0], 1)
			added = true
		}
	}
	if !added {
		b.anchor(seg, 1)
	}
}

func sgn(k int) float64 {
	if k%2 == 1 {
		return -1
	}
	return 1
}

// finish scales the model to height h and assigns radii by a pipe model: the
// cross-section entering a node equals the sum of the cross-sections leaving it
// (da Vinci's rule), with a gentle taper along each segment, scaled so the trunk
// base has radius baseR and clamped to at least minR.
func (b *tBuilder) finish(h, baseR, minR float64) {
	top := 0.0
	for _, s := range b.segs {
		top = math.Max(top, s.b.y)
	}
	for _, l := range b.leaves {
		top = math.Max(top, l.c.y+l.r.y)
	}
	k := h / top
	for i := range b.segs {
		b.segs[i].a = b.segs[i].a.scale(k)
		b.segs[i].b = b.segs[i].b.scale(k)
	}
	for i := range b.leaves {
		b.leaves[i].c = b.leaves[i].c.scale(k)
		b.leaves[i].r = b.leaves[i].r.scale(k)
	}
	// Children always come after their parent, so one backward pass suffices.
	for i := len(b.segs) - 1; i >= 0; i-- {
		s := &b.segs[i]
		if len(b.kids[i]) == 0 {
			s.rb = 1
		} else {
			sum := 0.0
			for _, c := range b.kids[i] {
				sum += b.segs[c].ra * b.segs[c].ra
			}
			s.rb = math.Sqrt(sum)
		}
		s.ra = s.rb * (1 + 0.05*s.b.sub(s.a).len())
	}
	sc := baseR / b.segs[0].ra
	for i := range b.segs {
		s := &b.segs[i]
		s.ra = math.Max(s.ra*sc, minR)
		s.rb = math.Max(s.rb*sc, minR)
	}
	b.segs[0].ra *= 1.22 // root flare
	// Millimetre precision: plenty for the client, and the wire models stay
	// compact. Rounding is monotone, so tapering and the pipe rule survive it.
	for i := range b.segs {
		s := &b.segs[i]
		s.a, s.b, s.ra, s.rb = s.a.mm(), s.b.mm(), mm(s.ra), mm(s.rb)
	}
	for i := 1; i < len(b.segs); i++ {
		b.segs[i].a = b.segs[b.segs[i].parent].b
	}
	for i := range b.leaves {
		b.leaves[i].c, b.leaves[i].r = b.leaves[i].c.mm(), b.leaves[i].r.mm()
	}
}

func mm(v float64) float64 { return math.Round(v*1000) / 1000 }
func (a v3) mm() v3        { return v3{mm(a.x), mm(a.y), mm(a.z)} }

// treeModel is a finished model with everything the world derives from it.
type treeModel struct {
	wire   proto.TreeModel
	segs   []tseg
	leaves []tleaf
	height float64

	// Crown envelope (model space) for occlusion and cover.
	crown          v3
	crownR, crownH float64

	// Perch templates (model space), see treeperch.go.
	canopy, branch, trunk, fork, cavity, tips []perchTmpl
	top                                       perchTmpl
}

var (
	treeOnce  sync.Once
	treeTable [core.VegKindCount][core.TreeVariants]*treeModel
	treeWire  []proto.TreeModel
)

func initTrees() {
	treeOnce.Do(func() {
		var base [core.VegKindCount][core.TreeVariants]*treeModel
		for _, k := range treeKinds {
			bk := treeBase(k)
			for v := 0; v < core.TreeVariants; v++ {
				if base[bk][v] == nil {
					segs, leaves := buildTree(bk, v)
					base[bk][v] = newTreeModel(bk, v, segs, leaves)
				}
				m := *base[bk][v]
				m.wire.Kind = int(k)
				treeTable[k][v] = &m
				treeWire = append(treeWire, m.wire)
			}
		}
	})
}

// newTreeModel wraps a grown model: wire form, crown envelope, perch templates.
func newTreeModel(kind core.VegKind, variant int, segs []tseg, leaves []tleaf) *treeModel {
	m := &treeModel{segs: segs, leaves: leaves}
	m.wire = proto.TreeModel{Kind: int(kind), Variant: variant}
	for _, s := range segs {
		m.height = math.Max(m.height, s.b.y)
		m.wire.Branches = append(m.wire.Branches, proto.TreeBranch{A: s.a.f32(), B: s.b.f32(), RA: float32(s.ra), RB: float32(s.rb), Parent: s.parent})
	}
	lo, hi := v3{math.Inf(1), math.Inf(1), math.Inf(1)}, v3{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	for _, l := range leaves {
		m.height = math.Max(m.height, l.c.y+l.r.y)
		m.wire.Leaves = append(m.wire.Leaves, proto.TreeLeaf{C: l.c.f32(), R: l.r.f32()})
		lo = v3{math.Min(lo.x, l.c.x-l.r.x), math.Min(lo.y, l.c.y-l.r.y), math.Min(lo.z, l.c.z-l.r.z)}
		hi = v3{math.Max(hi.x, l.c.x+l.r.x), math.Max(hi.y, l.c.y+l.r.y), math.Max(hi.z, l.c.z+l.r.z)}
	}
	m.wire.Height = float32(m.height)
	if len(leaves) > 0 {
		m.crown = lo.lerp(hi, 0.5)
		// Clumps leave gaps: the envelope that really hides things is a little
		// smaller than the bounding box.
		m.crownR = 0.85 * math.Max(hi.x-lo.x, hi.z-lo.z) / 2
		m.crownH = 0.9 * (hi.y - lo.y) / 2
	}
	m.buildPerchTemplates(kind)
	return m
}

// treeModelFor returns the model an instance of kind with this variant byte uses.
func treeModelFor(k core.VegKind, variant uint8) *treeModel {
	initTrees()
	return treeTable[k][int(variant)%core.TreeVariants]
}

// TreeModels returns every tree model (contract §11): core.TreeVariants models
// for each tree kind, in VegKind order then variant order. The models are the
// same for every world. The result is a fresh copy the caller may keep.
func (w *World) TreeModels() []proto.TreeModel { return TreeModels() }

// TreeModels is the package-level form of (*World).TreeModels.
func TreeModels() []proto.TreeModel {
	initTrees()
	out := make([]proto.TreeModel, len(treeWire))
	for i, m := range treeWire {
		m.Branches = append([]proto.TreeBranch(nil), m.Branches...)
		m.Leaves = append([]proto.TreeLeaf(nil), m.Leaves...)
		out[i] = m
	}
	return out
}
