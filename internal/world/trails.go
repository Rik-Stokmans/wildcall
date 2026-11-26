package world

import (
	"container/heap"
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/noise"
)

// Generated trails (contract §2.2): every visible generated feature is linked to
// its nearest visible neighbour within linkRange by a path routed around water and
// steep ground. A trail belongs to the cell of the feature it starts from and has
// the id "trail@<cellX>,<cellZ>". Hidden features sometimes get a faint hidden
// trail from the nearest visible one.

const (
	linkRange   = 420.0
	linkCells   = 3    // cells to search around a feature for link targets
	trailCells  = 4    // a cell's trail never reaches further than this many cells
	routeStep   = 10.0 // A* lattice spacing in metres
	routeMargin = 100.0
	hiddenLink  = 0.5 // chance that a hidden feature gets a hidden trail
)

// genTrail is a generated trail plus what the generator needs to apply it.
type genTrail struct {
	t              core.Trail
	segs           []trailSeg
	x0, z0, x1, z1 float64 // bounding box of the points
}

// linkNode is a visible feature that trails connect.
type linkNode struct {
	x, z float64
	c    cellKey
	home bool
}

// homeAnchors are the home places generated trails may lead to: the far end of
// the Greenhollow Trail and the Woodland Entrance, so paths out of the valley
// start where the player already walks.
func (w *World) homeAnchors() []linkNode {
	var out []linkNode
	for _, id := range [...]string{"ranger_station", "woodland_entrance"} {
		p := w.hl.pois[w.home[id]]
		out = append(out, linkNode{x: float64(p.Pos.X), z: float64(p.Pos.Z), home: true})
	}
	return out
}

// visibleNode returns the cell's main feature as a link node, if it is visible.
func (w *World) visibleNode(cx, cz int) (linkNode, bool) {
	p, ok := w.cell(cx, cz).mainPOI()
	if !ok || p.Hidden {
		return linkNode{}, false
	}
	return linkNode{x: float64(p.Pos.X), z: float64(p.Pos.Z), c: cellKey{cx, cz}}, true
}

// keyLess orders cells (row-major) for deterministic tie-breaks.
func keyLess(a, b cellKey) bool {
	if a.z != b.z {
		return a.z < b.z
	}
	return a.x < b.x
}

// nearestNode finds the nearest visible link node within linkRange of (x, z),
// excluding the feature of cell self.
func (w *World) nearestNode(x, z float64, self cellKey) (linkNode, bool) {
	var bestN linkNode
	bestD := linkRange
	found := false
	for dz := -linkCells; dz <= linkCells; dz++ {
		for dx := -linkCells; dx <= linkCells; dx++ {
			k := cellKey{self.x + dx, self.z + dz}
			if k == self {
				continue
			}
			n, ok := w.visibleNode(k.x, k.z)
			if !ok {
				continue
			}
			d := hypot(n.x-x, n.z-z)
			if d < bestD || (d == bestD && found && !bestN.home && keyLess(k, bestN.c)) {
				bestN, bestD, found = n, d, true
			}
		}
	}
	if hypot(x, z) < homeR+linkRange+200 {
		for _, n := range w.homeAnchors() {
			if d := hypot(n.x-x, n.z-z); d < bestD {
				bestN, bestD, found = n, d, true
			}
		}
	}
	return bestN, found
}

// trail returns the generated trail owned by a cell, or nil.
func (w *World) trail(cx, cz int) *genTrail {
	return w.trails.get(cellKey{cx, cz}, func() *genTrail { return w.buildTrail(cx, cz) })
}

func (w *World) buildTrail(cx, cz int) *genTrail {
	self := cellKey{cx, cz}
	c := w.cell(cx, cz)
	p, ok := c.mainPOI()
	if !ok {
		return nil
	}
	px, pz := float64(p.Pos.X), float64(p.Pos.Z)
	if p.Kind == "pond" {
		// Lead to the pond's rim, not into the water.
		px += 18
	}
	t, ok := w.nearestNode(px, pz, self)
	if !ok {
		return nil
	}
	hidden := p.Hidden
	if hidden {
		r := noise.NewRNG(noise.Hash2(uint64(w.seed)^0x7a11, int64(cx), int64(cz)))
		if !r.Chance(hiddenLink) {
			return nil
		}
	} else if !t.home {
		// Mutual nearest neighbours would build the same path twice; the cell that
		// comes first owns it.
		if back, ok := w.nearestNode(t.x, t.z, t.c); ok && !back.home && back.c == self && keyLess(t.c, self) {
			return nil
		}
	}
	ax, az, bx, bz := px, pz, t.x, t.z
	if hidden {
		ax, az, bx, bz = t.x, t.z, px, pz // hidden trails lead from the visible place
	}
	pts := w.route(ax, az, bx, bz)
	if pts == nil {
		return nil
	}
	id := genID("trail", cx, cz)
	gt := &genTrail{t: core.Trail{ID: id, Name: trailName(w.seed, id, p.Region, hidden), Hidden: hidden}}
	pads := w.padsNear(ax, az, bx, bz)
	gt.t.Points = make([]core.Vec3, len(pts))
	gt.x0, gt.z0, gt.x1, gt.z1 = math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
	for i, q := range pts {
		y := w.g.height(q[0], q[1])
		for j := range pads {
			if ny, wt := pads[j].apply(q[0], q[1], y); wt > 0 {
				y = ny
			}
		}
		gt.t.Points[i] = vec(q[0], y, q[1])
		gt.x0, gt.z0 = math.Min(gt.x0, q[0]), math.Min(gt.z0, q[1])
		gt.x1, gt.z1 = math.Max(gt.x1, q[0]), math.Max(gt.z1, q[1])
	}
	gt.segs = segsOfTrail(gt.t.Points, hidden)
	return gt
}

// padsNear returns the pads at a trail's two ends.
func (w *World) padsNear(ax, az, bx, bz float64) []pad {
	var out []pad
	for _, e := range [2][2]float64{{ax, az}, {bx, bz}} {
		if hypot(e[0], e[1]) < homeR+60 {
			out = append(out, w.hl.ov.pads...)
		}
		out = append(out, w.cell(cellOf(e[0]), cellOf(e[1])).ov.pads...)
	}
	return out
}

// route finds a walkable path from a to b on a routeStep lattice with A*: water
// deeper than a shallow ford is impassable, fords and steep grades are expensive.
// The result is smoothed and resampled every ~6 m; nil if no path exists.
func (w *World) route(ax, az, bx, bz float64) [][2]float64 {
	x0 := math.Min(ax, bx) - routeMargin
	z0 := math.Min(az, bz) - routeMargin
	nx := int((math.Max(ax, bx)+routeMargin-x0)/routeStep) + 1
	nz := int((math.Max(az, bz)+routeMargin-z0)/routeStep) + 1
	n := nx * nz
	hs := make([]float32, n)
	for i := range hs {
		hs[i] = float32(math.NaN())
	}
	hAt := func(i int) float64 {
		if v := hs[i]; v == v {
			return float64(v)
		}
		x, z := x0+float64(i%nx)*routeStep, z0+float64(i/nx)*routeStep
		h := w.g.height(x, z)
		hs[i] = float32(h)
		return h
	}
	idx := func(x, z float64) int {
		ix := int(math.Round((x - x0) / routeStep))
		iz := int(math.Round((z - z0) / routeStep))
		return min(max(iz, 0), nz-1)*nx + min(max(ix, 0), nx-1)
	}
	start, goal := idx(ax, az), idx(bx, bz)
	gx, gz := goal%nx, goal/nx
	gScore := make([]float32, n)
	from := make([]int32, n)
	closed := make([]bool, n)
	for i := range gScore {
		gScore[i] = float32(math.Inf(1))
		from[i] = -1
	}
	gScore[start] = 0
	h0 := func(i int) float64 {
		return hypot(float64(i%nx-gx), float64(i/nx-gz)) * routeStep
	}
	pq := &routeHeap{}
	heap.Push(pq, routeItem{start, float32(h0(start))})
	found := false
	for pq.Len() > 0 {
		it := heap.Pop(pq).(routeItem)
		cur := it.i
		if closed[cur] {
			continue
		}
		if cur == goal {
			found = true
			break
		}
		closed[cur] = true
		cx, cz := cur%nx, cur/nx
		hc := hAt(cur)
		for _, d := range routeDirs {
			ex, ez := cx+d[0], cz+d[1]
			if ex < 0 || ez < 0 || ex >= nx || ez >= nz {
				continue
			}
			ni := ez*nx + ex
			if closed[ni] {
				continue
			}
			hn := hAt(ni)
			if hn < -0.35 && ni != goal {
				continue
			}
			l := routeStep * math.Sqrt(float64(d[0]*d[0]+d[1]*d[1]))
			grade := math.Abs(hn-hc) / l
			if grade > 0.75 {
				continue
			}
			cost := l * (1 + 4*grade + 40*math.Max(0, grade-0.25))
			if hn < 0.4 || hc < 0.4 {
				cost += l * 6 // a ford: allowed, but only where nothing better exists
			}
			if g := gScore[cur] + float32(cost); g < gScore[ni] {
				gScore[ni] = g
				from[ni] = int32(cur)
				heap.Push(pq, routeItem{ni, g + float32(h0(ni))})
			}
		}
	}
	if !found {
		return nil
	}
	var rev [][2]float64
	for i := goal; i >= 0; i = int(from[i]) {
		rev = append(rev, [2]float64{x0 + float64(i%nx)*routeStep, z0 + float64(i/nx)*routeStep})
		if i == start {
			break
		}
	}
	pts := make([][2]float64, 0, len(rev)+2)
	pts = append(pts, [2]float64{ax, az})
	for i := len(rev) - 2; i >= 1; i-- {
		pts = append(pts, rev[i])
	}
	pts = append(pts, [2]float64{bx, bz})
	// Rounding corners can cut across a bay; fall back to the raw lattice path
	// where it would.
	smooth := resample(chaikin(chaikin(pts)), 6)
	for _, q := range smooth {
		if w.g.height(q[0], q[1]) < -0.4 {
			return resample(pts, 6)
		}
	}
	return smooth
}

var routeDirs = [8][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}}

type routeItem struct {
	i int
	f float32
}

type routeHeap []routeItem

func (h routeHeap) Len() int { return len(h) }
func (h routeHeap) Less(a, b int) bool {
	if h[a].f != h[b].f {
		return h[a].f < h[b].f
	}
	return h[a].i < h[b].i
}
func (h routeHeap) Swap(a, b int) { h[a], h[b] = h[b], h[a] }
func (h *routeHeap) Push(x any)   { *h = append(*h, x.(routeItem)) }
func (h *routeHeap) Pop() any {
	old := *h
	it := old[len(old)-1]
	*h = old[:len(old)-1]
	return it
}

// chaikin rounds the corners of a polyline, keeping its end points.
func chaikin(pts [][2]float64) [][2]float64 {
	if len(pts) < 3 {
		return pts
	}
	out := make([][2]float64, 0, 2*len(pts))
	out = append(out, pts[0])
	for i := 0; i+1 < len(pts); i++ {
		a, b := pts[i], pts[i+1]
		if i > 0 {
			out = append(out, [2]float64{0.75*a[0] + 0.25*b[0], 0.75*a[1] + 0.25*b[1]})
		}
		if i+2 < len(pts) {
			out = append(out, [2]float64{0.25*a[0] + 0.75*b[0], 0.25*a[1] + 0.75*b[1]})
		}
	}
	return append(out, pts[len(pts)-1])
}

// TrailsNear appends every trail with a point within radius of (x, z): the home
// trails and generated ones alike.
func (w *World) TrailsNear(x, z, radius float32, buf []core.Trail) []core.Trail {
	fx, fz, r := float64(x), float64(z), float64(radius)
	near := func(t *core.Trail) bool {
		for _, p := range t.Points {
			if hypot(float64(p.X)-fx, float64(p.Z)-fz) <= r {
				return true
			}
		}
		return false
	}
	for i := range w.hl.trails {
		if near(&w.hl.trails[i]) {
			buf = append(buf, cloneTrail(w.hl.trails[i]))
		}
	}
	c0x, c1x := cellOf(fx-r)-trailCells, cellOf(fx+r)+trailCells
	c0z, c1z := cellOf(fz-r)-trailCells, cellOf(fz+r)+trailCells
	for cz := c0z; cz <= c1z; cz++ {
		for cx := c0x; cx <= c1x; cx++ {
			gt := w.trail(cx, cz)
			if gt == nil || gt.x0 > fx+r || gt.x1 < fx-r || gt.z0 > fz+r || gt.z1 < fz-r {
				continue
			}
			if near(&gt.t) {
				buf = append(buf, cloneTrail(gt.t))
			}
		}
	}
	return buf
}

func cloneTrail(t core.Trail) core.Trail {
	t.Points = append([]core.Vec3(nil), t.Points...)
	return t
}
