package world

import (
	"math"
	"sort"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// Tree perches (contract §11) come from the tree models. Each model precomputes
// its perch templates once - points on the surface of its own limbs, in model
// space, with the cover the foliage around them gives - and each instance only
// transforms a handful of them by its scale, rotation and position.

// perchTmpl is a perch in model space.
type perchTmpl struct {
	p     v3
	kind  core.PerchKind
	cover float64
	r     float64 // local wood radius (cavities need a thick trunk or limb)
}

// leafDepth is the smallest normalised ellipsoid distance from p to a foliage
// mass: < 1 inside a mass, 1 on its surface.
func (m *treeModel) leafDepth(p v3) float64 {
	best := math.Inf(1)
	for _, l := range m.leaves {
		d := p.sub(l.c)
		n := math.Sqrt(sq(d.x/l.r.x) + sq(d.y/l.r.y) + sq(d.z/l.r.z))
		if n < best {
			best = n
		}
	}
	return best
}

// surfaceDist is the signed distance from p to the wood surface of the model:
// 0 on a limb's surface, negative inside wood.
func (m *treeModel) surfaceDist(p v3) float64 {
	best := math.Inf(1)
	for i := range m.segs {
		s := &m.segs[i]
		d, t := pointSeg(p, s.a, s.b)
		if v := d - s.rAt(t); v < best {
			best = v
		}
	}
	return best
}

// onSurface reports whether a template point sits on the wood without being
// buried in another limb (junctions).
func (m *treeModel) onSurface(p v3) bool { return m.surfaceDist(p) > -0.004 }

// cavityKinds are the trees old enough to hold nest holes (contract §11).
func cavityKind(k core.VegKind) bool {
	switch treeBase(k) {
	case core.VegOak, core.VegBirch, core.VegSnag, core.VegChestnut:
		return true
	}
	return false
}

func (m *treeModel) buildPerchTemplates(kind core.VegKind) {
	rng := noise.NewRNG(noise.Hash2(0x9e7c4, int64(kind), int64(m.wire.Variant)))
	snag := len(m.leaves) == 0
	kids := make([]int, len(m.segs))
	for _, s := range m.segs {
		if s.parent >= 0 {
			kids[s.parent]++
		}
	}
	// Outer crown: how far from the trunk axis a limb must reach to count as an
	// outer branch.
	reach := 0.0
	for _, s := range m.segs {
		reach = math.Max(reach, math.Hypot(s.b.x, s.b.z))
	}
	for i := range m.segs {
		s := &m.segs[i]
		d := s.dir()
		side := perpTowards(d, v3{s.b.x - s.a.x + 1e-3, 0, s.b.z - s.a.z})
		switch {
		case s.order == 0:
			// Trunk: three faces at three heights per segment; cavities on thick wood.
			for _, t := range [...]float64{0.25, 0.5, 0.75} {
				az := rng.Range(0, 2*math.Pi)
				n := perpTowards(d, dirAE(az, 0))
				p := s.at(t).add(n.scale(s.rAt(t)))
				if !m.onSurface(p) {
					continue
				}
				ld := m.leafDepth(p)
				m.trunk = append(m.trunk, perchTmpl{p: p, kind: core.PerchTrunk, cover: 0.15 + 0.35*clamp01((2.2-ld)/1.2), r: s.rAt(t)})
				m.addCavity(p, s.rAt(t), ld)
			}
		default:
			for _, t := range [...]float64{0.3, 0.62, 0.9} {
				r := s.rAt(t)
				p := s.at(t).add(perpUp(d, side).scale(r))
				if !m.onSurface(p) {
					continue
				}
				ld := m.leafDepth(p)
				out := math.Hypot(p.x, p.z) >= 0.3*reach
				switch {
				case !snag && s.order >= 2 && ld < 0.85 && r >= 0.012:
					m.canopy = append(m.canopy, perchTmpl{p: p, kind: core.PerchCanopy, cover: 0.62 + 0.28*clamp01((0.85-ld)/0.6)})
				case !snag && ld >= 1.0 && r >= 0.03 && math.Abs(d.y) <= 0.75 && out && t < 0.95:
					m.branch = append(m.branch, perchTmpl{p: p, kind: core.PerchBranch, cover: m.branchCover(p, ld)})
				}
				if s.order == 1 && t < 0.7 {
					// Limb side for cavities.
					q := s.at(t).add(perpTowards(d, d.cross(vUp)).scale(r))
					if m.onSurface(q) {
						m.addCavity(q, r, m.leafDepth(q))
					}
				}
			}
		}
		// Bare tips: ends with nothing growing from them, outside the foliage.
		if kids[i] == 0 && s.order > 0 {
			p := s.b.add(vUp.scale(s.rb))
			if m.onSurface(p) && (snag || m.leafDepth(p) > 1.15) && d.y > -0.3 {
				m.tips = append(m.tips, perchTmpl{p: p, kind: core.PerchSnag, cover: 0})
			}
		}
		// Forks: a node where two sturdy limbs part; the perch sits in the crotch,
		// touching both.
		if kids[i] >= 2 && s.rb >= 0.07 && s.b.y >= 1.5 {
			m.addFork(i)
		}
	}
	// Crowns whose foliage hides every outer limb end (pines: pads over every
	// branch) still have bare wood inside, below the foliage, to sit on.
	if !snag && len(m.branch) == 0 {
		for i := range m.segs {
			s := &m.segs[i]
			d := s.dir()
			if s.order == 0 || math.Abs(d.y) > 0.75 {
				continue
			}
			side := perpTowards(d, v3{s.b.x - s.a.x + 1e-3, 0, s.b.z - s.a.z})
			for _, t := range [...]float64{0.2, 0.45} {
				r := s.rAt(t)
				p := s.at(t).add(perpUp(d, side).scale(r))
				if ld := m.leafDepth(p); r >= 0.03 && ld >= 1.0 && m.onSurface(p) {
					m.branch = append(m.branch, perchTmpl{p: p, kind: core.PerchBranch, cover: m.branchCover(p, ld)})
				}
			}
		}
	}
	// The most exposed branch perches first: an instance takes most of its branch
	// perches from the front of the list (treePerches).
	sort.SliceStable(m.branch, func(i, j int) bool { return m.branch[i].cover < m.branch[j].cover })
	// The very top: the highest wood, a song post.
	hi := 0
	for i := range m.segs {
		if m.segs[i].b.y > m.segs[hi].b.y {
			hi = i
		}
	}
	s := &m.segs[hi]
	m.top = perchTmpl{p: s.b.add(vUp.scale(s.rb)), kind: core.PerchBranch, cover: 0.1 + 0.08*clamp01((2.0-m.leafDepth(s.b))/1.0)}
	if snag {
		m.top.kind, m.top.cover = core.PerchSnag, 0
	}
}

// skyDirs are the directions branchCover looks along for open sky: straight up,
// and up-and-out round the compass.
var skyDirs = func() []v3 {
	out := []v3{vUp}
	for k := 0; k < 6; k++ {
		out = append(out, dirAE(float64(k)*math.Pi/3, 0.6))
	}
	return out
}()

// skyOpen is the share of skyDirs along which a 3 m look from p clears every
// foliage mass of the model: 1 for a bare twig standing out of the crown, 0 deep
// under the leaves. (Neighbouring trees are not the model's business.)
func (m *treeModel) skyOpen(p v3) float64 {
	open := 0
	for _, d := range skyDirs {
		clear := true
		for _, l := range m.leaves {
			if rayHitsEllipsoid(p, d, 3, l) {
				clear = false
				break
			}
		}
		if clear {
			open++
		}
	}
	return float64(open) / float64(len(skyDirs))
}

// rayHitsEllipsoid reports whether the segment p + t·d (0 ≤ t ≤ l) enters foliage
// mass e.
func rayHitsEllipsoid(p, d v3, l float64, e tleaf) bool {
	px, py, pz := (p.x-e.c.x)/e.r.x, (p.y-e.c.y)/e.r.y, (p.z-e.c.z)/e.r.z
	qx, qy, qz := d.x/e.r.x, d.y/e.r.y, d.z/e.r.z
	a := qx*qx + qy*qy + qz*qz
	b := 2 * (px*qx + py*qy + pz*qz)
	c := px*px + py*py + pz*pz - 1
	if c <= 0 {
		return true // starts inside
	}
	disc := b*b - 4*a*c
	if disc < 0 || a < 1e-12 {
		return false
	}
	t := (-b - math.Sqrt(disc)) / (2 * a)
	return t >= 0 && t <= l
}

// branchCover is the cover of a branch perch (0.1..0.35): how close the foliage
// is, eased off where the bird has open sky above and beside it, so a bird on a
// bare outer limb end reads as exposed.
func (m *treeModel) branchCover(p v3, ld float64) float64 {
	near := clamp01((2.0 - ld) / 1.0)
	return 0.1 + 0.25*near*(1-0.7*m.skyOpen(p))
}

func (m *treeModel) addCavity(p v3, r, ld float64) {
	if r < 0.14 || p.y < 1.2 {
		return
	}
	m.cavity = append(m.cavity, perchTmpl{p: p, kind: core.PerchCavity, cover: 0.35 + 0.25*clamp01((1.8-ld)/1.2), r: r})
}

// addFork adds the crotch perch at the end of segment i between its two
// thickest children.
func (m *treeModel) addFork(i int) {
	s := &m.segs[i]
	c1, c2 := -1, -1
	for j := i + 1; j < len(m.segs); j++ {
		if m.segs[j].parent != i {
			continue
		}
		switch {
		case c1 < 0 || m.segs[j].ra > m.segs[c1].ra:
			c1, c2 = j, c1
		case c2 < 0 || m.segs[j].ra > m.segs[c2].ra:
			c2 = j
		}
	}
	if c2 < 0 || m.segs[c2].ra < 0.045 {
		return
	}
	d1, d2 := m.segs[c1].dir(), m.segs[c2].dir()
	th := math.Acos(clamp(d1.dot(d2), -1, 1))
	if th < 0.35 || th > 2.4 {
		return
	}
	bis := d1.add(d2).norm()
	if bis.y < 0.2 {
		return // a crotch that opens sideways or down holds nothing
	}
	r := (m.segs[c1].ra + m.segs[c2].ra) / 2
	k := r / math.Sin(th/2)
	p := s.b.add(bis.scale(k))
	// Settle onto the nearest surface (the crotch is where both limbs touch).
	for it := 0; it < 6; it++ {
		sd := m.surfaceDist(p)
		if math.Abs(sd) < 0.002 {
			break
		}
		p = p.sub(bis.scale(sd))
	}
	if math.Abs(m.surfaceDist(p)) > 0.01 {
		return
	}
	m.fork = append(m.fork, perchTmpl{p: p, kind: core.PerchFork, cover: 0.15 + 0.7*clamp01((1.6-m.leafDepth(p))/1.2)})
}

// xform is an instance's placement of a model: scale, then rotation about Y
// (three.js convention), then translation.
type xform struct {
	c, s, k    float64
	px, py, pz float64
}

func instanceXform(v *core.Veg) xform {
	rot := float64(v.Rot)
	return xform{c: math.Cos(rot), s: math.Sin(rot), k: float64(v.Scale), px: float64(v.Pos.X), py: float64(v.Pos.Y), pz: float64(v.Pos.Z)}
}

func (x *xform) apply(p v3) v3 {
	return v3{
		x.px + x.k*(x.c*p.x+x.s*p.z),
		x.py + x.k*p.y,
		x.pz + x.k*(-x.s*p.x+x.c*p.z),
	}
}

// inverse maps a world point back to model space.
func (x *xform) inverse(w v3) v3 {
	dx, dy, dz := (w.x-x.px)/x.k, (w.y-x.py)/x.k, (w.z-x.pz)/x.k
	return v3{x.c*dx - x.s*dz, dy, x.s*dx + x.c*dz}
}

// Per-instance perch counts and chances.
const (
	treeCanopyPerches = 2
	treeBranchPerches = 2 // one from the most exposed half of the model's list, one from anywhere
	pForkLive         = 0.5
	pForkSnag         = 0.35
	pCavityLive       = 0.22
	pCavitySnag       = 0.45
	pBareTip          = 0.5
	cavityMinR        = 0.18 // metres, after scale
	cavityMinY        = 1.5
	cavityMaxY        = 9.0
	trunkMinY         = 2.0
	trunkMaxY         = 8.0
)

// treePerches appends the perches of one tree instance. emit places a world
// point and reports whether it was accepted (above the ground).
func treePerches(v *core.Veg, r *noise.RNG, emit func(p v3, kind core.PerchKind, cover float64) bool) {
	m := treeModelFor(v.Kind, v.Variant)
	x := instanceXform(v)
	put := func(t *perchTmpl) bool { return emit(x.apply(t.p), t.kind, t.cover) }
	pick := func(list []perchTmpl, n int) {
		if len(list) == 0 {
			return
		}
		start := r.Intn(len(list))
		step := 1 + len(list)/max(n, 1)
		for i := 0; i < n && i < len(list); i++ {
			put(&list[(start+i*step)%len(list)])
		}
	}
	snag := len(m.leaves) == 0
	if snag {
		put(&m.top)
		pick(m.tips, 1)
	} else {
		pick(m.canopy, treeCanopyPerches)
		if n := len(m.branch); n > 0 {
			pick(m.branch[:(n+1)/2], treeBranchPerches-1)
			pick(m.branch, 1)
		}
		put(&m.top)
		if r.Chance(pBareTip) {
			pick(m.tips, 1)
		}
	}
	// One trunk perch within the climbing band.
	k := x.k
	if t := pickWhere(m.trunk, r, func(t *perchTmpl) bool { return t.p.y*k >= trunkMinY && t.p.y*k <= trunkMaxY }); t != nil {
		put(t)
	}
	pf := pForkLive
	if snag {
		pf = pForkSnag
	}
	if r.Chance(pf) {
		pick(m.fork, 1)
	}
	pc := pCavityLive
	if snag {
		pc = pCavitySnag
	}
	if r.Chance(pc) && cavityKind(v.Kind) {
		if t := pickWhere(m.cavity, r, func(t *perchTmpl) bool {
			return t.r*k >= cavityMinR && t.p.y*k >= cavityMinY && t.p.y*k <= cavityMaxY
		}); t != nil {
			put(t)
		}
	}
}

// pickWhere returns a random template that satisfies ok, or nil.
func pickWhere(list []perchTmpl, r *noise.RNG, ok func(*perchTmpl) bool) *perchTmpl {
	if len(list) == 0 {
		return nil
	}
	start := r.Intn(len(list))
	for i := range list {
		t := &list[(start+i)%len(list)]
		if ok(t) {
			return t
		}
	}
	return nil
}
