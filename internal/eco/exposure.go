package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Being seen. Within its species' habits a bird spends much of its day where a
// patient watcher can see it: song posts are exposed (tree tops, bare twigs, the
// edge of a crown, the top of a bush), birds preen and look about from open
// branches, and gleaners hop out to the edge of the foliage between bouts of work
// inside it. The deep canopy is for foraging, roosting and hiding. How strongly a
// species shows itself follows its Skulking: a wren still keeps to the brambles,
// but may sing from the top of one and dive back in.

// Exposure weights: a perch's weight for a "showing" use is multiplied by
// (1 − cover)^(k × bold), bold = 1 − boldSkulk × Skulking.
const (
	boldSkulk = 0.9
	expoGen   = 1.6 // everyday perches: preening, resting, looking about
	expoSong  = 3.0 // song posts
	expoFeed  = 2.0 // ground feeders' spots: open ground and trail edges over deep vegetation

	// Song from the top of a bush or reed clump: the perch rises by this factor of
	// its height above the ground and keeps this share of its cover.
	topLift  = 1.3
	topCover = 0.45

	// A bird in deep cover (cover ≥ deepCover) about to rest or preen moves out to
	// an exposed perch within showR metres with chance showOdds × bold.
	deepCover = 0.5
	showR     = 9
	showOdds  = 0.75
	exposedAt = 0.35 // "exposed": cover below this

	gleanShow   = 0.1  // per glean step: hop out to an exposed perch nearby
	singShow    = 0.55 // × bold: a bird about to sing in deep cover first moves to an open perch
	songHoldMin = 20   // seconds a perched bird that has started its song stays put, at least
	songHoldMax = 60
)

// buildShowPref works out how much the species likes each perch kind for showing
// itself. A bird of the tree crowns (canopy or branch in its list) uses the open
// branches and bare tops of the same trees for song and rest, whatever order its
// list puts them in. Kinds outside its list stay outside it.
func (p *profile) buildShowPref() {
	p.showPref = p.perchPref
	p.bold = 1 - boldSkulk*p.skulk
	for u, k := range [...]float32{expoGen, expoSong, expoFeed} {
		for i := 0; i <= expoSteps; i++ {
			p.expoTab[u][i] = p.expoExact(float32(i)/expoSteps, k)
		}
	}
	m := max32(p.perchPref[core.PerchCanopy], p.perchPref[core.PerchBranch])
	if m <= 0 {
		return
	}
	lift := func(k core.PerchKind, f float32) {
		if v := f * m; v > p.showPref[k] {
			p.showPref[k] = v
		}
	}
	lift(core.PerchBranch, 0.9)
}

// expo is the exposure weight of a perch with this cover for a use of strength k
// (expoGen, expoSong or expoFeed: looked up in the species' table, interpolated).
func (p *profile) expo(cover, k float32) float32 {
	t := &p.expoTab[expoUse(k)]
	f := clamp(cover, 0, 1) * expoSteps
	i := int(f)
	if i >= expoSteps {
		return t[expoSteps]
	}
	return lerp(t[i], t[i+1], f-float32(i))
}

const expoSteps = 32

func expoUse(k float32) int {
	switch k {
	case expoSong:
		return 1
	case expoFeed:
		return 2
	}
	return 0
}

// expoExact is (1 − cover)^(k·bold), the curve the table samples.
func (p *profile) expoExact(cover, k float32) float32 {
	open := clamp(1-cover, 0.05, 1)
	return float32(math.Pow(float64(open), float64(k*p.bold)))
}

// showFit is how well a perch of kind k, h metres up, suits the species for
// showing itself (song, rest): its show preference times its height habit.
func (p *profile) showFit(k core.PerchKind, h float32) float32 {
	return p.showPref[k] * p.heightFit(h)
}

// topOf raises a bush or reed perch to the top of the bush: a song post. Other
// perches are returned unchanged.
func (s *Sim) topOf(pc core.Perch) core.Perch {
	switch pc.Kind {
	case core.PerchShrub, core.PerchReed:
		g := max32(s.t.HeightAt(pc.Pos.X, pc.Pos.Z), 0)
		if h := pc.Pos.Y - g; h > 0 {
			pc.Pos.Y = g + h*topLift
		}
		pc.Cover *= topCover
	}
	return pc
}

// exposedNear finds an exposed perch (cover < exposedAt) the bird would use within
// r metres of where it is and not far above or below it, chosen at random among
// the suitable ones. ok is false if there is none.
func (s *Sim) exposedNear(b *bird, p *profile, r float32) (core.Perch, bool) {
	c := b.cell
	if c == nil {
		return core.Perch{}, false
	}
	r2 := r * r
	comfort2 := s.comfort2(b)
	var best core.Perch
	bestK := float32(math.MaxFloat32)
	for i := range c.perches {
		pc := &c.perches[i]
		if pc.Cover >= exposedAt {
			continue
		}
		d2 := distXZ2(pc.Pos, b.pos)
		if d2 > r2 || d2 < 0.25 {
			continue
		}
		if dy := pc.Pos.Y - b.pos.Y; dy > 4 || dy < -4 {
			continue
		}
		fit := p.showFit(pc.Kind, c.perchH[i])
		if fit < suitFit {
			continue
		}
		if comfort2 > 0 && distXZ2(pc.Pos, s.obs.Pos) < comfort2 {
			continue
		}
		// Weighted random choice: the smallest exponential key wins.
		if k := expKey(uint64(s.rng.Uint32()), fit*p.expo(pc.Cover, expoGen)); k < bestK {
			best, bestK = *pc, k
		}
	}
	return best, bestK < math.MaxFloat32
}

// showOff moves a resting bird out of deep cover to an exposed perch close by
// (then: what it does there). It reports whether it did.
func (s *Sim) showOff(b *bird, p *profile, odds float32, th then) bool {
	if b.airborne() || b.moving || b.cover < deepCover || b.mixed != 0 || b.destKind == core.PerchTrunk || b.destKind == core.PerchCavity {
		// (A member of a mixed flock keeps up with the flock instead.)
		return false
	}
	if !s.chance(odds * p.bold) {
		return false
	}
	pc, ok := s.exposedNear(b, p, showR)
	if !ok {
		return false
	}
	s.fly(b, p, pc, noPerch, core.ActFlying, 1, th)
	return true
}
