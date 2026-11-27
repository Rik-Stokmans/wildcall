package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Mixed feeding flocks (spec §11, an "Epic" ecological event). In autumn and winter
// the small woodland birds - tits, goldcrests, treecreepers, nuthatches - band
// together: a few individuals of several species travel slowly through the trees
// after one shared, wandering point, each foraging its own way (gleaning the
// crowns, creeping up the trunks), and after some minutes the party breaks up and
// everyone goes back to its own territory.
//
// At most one mixed flock exists at a time. One forms every few in-game hours
// during the day, preferably close to the observer (so the player can find it),
// from whichever member species live there. Everything is drawn from the
// simulation's random stream, so it is deterministic for a seed and call sequence.

// mixedSpecies are the catalog ids that join mixed feeding flocks.
var mixedSpecies = []string{
	"great_tit", "blue_tit", "coal_tit", "marsh_tit", "willow_tit", "long_tailed_tit",
	"goldcrest", "firecrest", "eurasian_treecreeper", "eurasian_nuthatch",
	"lesser_spotted_woodpecker",
}

const (
	mixedMax       = 14   // birds in one mixed flock
	mixedPerSp     = 4    // at most this many of one species
	mixedMinSp     = 3    // distinct species needed for a flock to form
	mixedGather    = 90   // metres around the nucleus from which members join
	mixedSearch    = 220  // metres around the observer where a flock is preferably formed
	mixedSpeed     = 0.45 // m/s: how fast the shared target drifts through the wood
	mixedReach     = 18   // a member further than this from the target moves up
	mixedFirstMin  = 20   // seconds before the first flock of a cold-season stretch may form
	mixedFirstMax  = 90   //
	mixedGapMin    = 150  // seconds between flocks (an in-game day is 24 real minutes)
	mixedGapMax    = 330  //
	mixedRetry     = 20   // seconds before another try when no flock could form
	mixedLifeMin   = 120  // seconds a flock stays together
	mixedLifeMax   = 240  //
	mixedTurnEvery = 4    // seconds between steering checks of the target
)

type mixedFlock struct {
	id      uint32
	pos     core.Vec3 // the shared target the members follow
	dir     float32   // heading of the target's drift
	ttl     float32   // seconds left before the flock disperses
	turn    float32   // seconds until the next steering check
	n       int
	members [mixedMax]int32 // bird slots
	ids     [mixedMax]uint32
}

// mixedTick forms, moves and dissolves mixed flocks. Called once per Step.
func (s *Sim) mixedTick(dt float32) {
	season := s.season == core.Autumn || s.season == core.Winter
	if s.mixed.id != 0 {
		if !season {
			s.disperseMixed()
			return
		}
		s.moveMixed(dt)
		return
	}
	if !season {
		s.mixedCD = -1 // arm the first-flock delay for the next cold season
		return
	}
	if s.mixedCD < 0 {
		s.mixedCD = s.rnd(mixedFirstMin, mixedFirstMax)
	}
	if s.mixedCD -= dt; s.mixedCD > 0 {
		return
	}
	switch s.phase {
	case core.PhaseMorning, core.PhaseMidday, core.PhaseAfternoon:
	default:
		s.mixedCD = mixedRetry
		return
	}
	if !s.formMixed() {
		s.mixedCD = mixedRetry
	}
}

// mixedCandidate: a bird that may join (or stay in) a mixed flock right now.
func (s *Sim) mixedCandidate(b *bird) bool {
	if !b.alive || b.circ != 0 || !s.prof[b.sp].mixed || b.fear >= fearWary || b.lure != 0 {
		return false
	}
	switch b.mode {
	case mIdle, mGround, mGlean, mClimb:
	default:
		return false
	}
	return !(b.moving && b.act == core.ActFleeing)
}

func woodHab(h core.Habitat) bool { return h == core.HabWoodland || h == core.HabConifer }

// formMixed tries to gather a mixed flock: around the observer first (so the
// player can find it), failing that around a random member-species bird anywhere
// in the active area. It reports success.
func (s *Sim) formMixed() bool {
	if s.obs.Present && s.formMixedNear(s.centre, mixedSearch) {
		return true
	}
	return s.formMixedNear(core.Vec3{}, 0) // anywhere
}

// formMixedNear tries to gather a mixed flock around a calm member-species bird
// within r metres of centre (r = 0: anywhere).
func (s *Sim) formMixedNear(centre core.Vec3, r float32) bool {
	// The nucleus: a random calm member-species bird in the wood.
	var cand [64]int32
	k := 0
	seen := 0
	for i := range s.birds {
		b := &s.birds[i]
		if !s.mixedCandidate(b) || r > 0 && distXZ2(b.pos, centre) > r*r {
			continue
		}
		seen++
		if k < len(cand) {
			cand[k] = int32(i)
			k++
		} else if j := s.rng.IntN(seen); j < len(cand) {
			cand[j] = int32(i) // reservoir sampling keeps the choice fair
		}
	}
	if k == 0 {
		return false
	}
	for tries := 0; tries < 4 && k > 0; tries++ {
		j := s.rng.IntN(k)
		nb := &s.birds[cand[j]]
		cand[j] = cand[k-1]
		k--
		if !woodHab(s.t.HabitatAt(nb.pos.X, nb.pos.Z)) {
			continue
		}
		if s.gatherMixed(nb.pos) {
			return true
		}
	}
	return false
}

// gatherMixed collects the flock around nucleus; it reports whether enough species
// joined.
func (s *Sim) gatherMixed(nucleus core.Vec3) bool {
	perSp := s.spCount
	for i := range perSp {
		perSp[i] = 0
	}
	f := mixedFlock{}
	kinds := 0
	for i := range s.birds {
		b := &s.birds[i]
		if !s.mixedCandidate(b) || distXZ2(b.pos, nucleus) > mixedGather*mixedGather {
			continue
		}
		if perSp[b.sp] >= mixedPerSp || f.n >= mixedMax {
			continue
		}
		if perSp[b.sp] == 0 {
			kinds++
		}
		perSp[b.sp]++
		f.members[f.n], f.ids[f.n] = int32(i), b.id
		f.n++
	}
	if kinds < mixedMinSp {
		return false
	}
	s.mixedSeq++
	f.id = idFrom(hash2(s.seed^0x4D49584544, uint64(s.mixedSeq)))
	f.pos = core.V(nucleus.X, max32(s.t.HeightAt(nucleus.X, nucleus.Z), 0), nucleus.Z)
	f.dir = s.rnd(0, 2*math.Pi)
	f.ttl = s.rnd(mixedLifeMin, mixedLifeMax)
	s.mixed = f
	for m := 0; m < f.n; m++ {
		b := &s.birds[f.members[m]]
		b.mixed = f.id
		if !b.moving {
			s.mixedForage(b, &s.prof[b.sp])
		}
	}
	return true
}

// moveMixed drifts the shared target through the wood, keeps the members with it
// and dissolves the flock when its time is up.
func (s *Sim) moveMixed(dt float32) {
	f := &s.mixed
	if f.ttl -= dt; f.ttl <= 0 {
		s.disperseMixed()
		return
	}
	if f.turn -= dt; f.turn <= 0 {
		f.turn = mixedTurnEvery
		f.dir += s.rnd(-0.5, 0.5)
		// Stay in the trees: look ahead and turn away from open ground.
		for tries := 0; tries < 4; tries++ {
			ax, az := f.pos.X+25*sin32(f.dir), f.pos.Z-25*cos32(f.dir)
			if woodHab(s.t.HabitatAt(ax, az)) && s.t.HeightAt(ax, az) > 0.05 {
				break
			}
			f.dir += math.Pi / 2 * float32(1+tries)
		}
		f.pos.Y = max32(s.t.HeightAt(f.pos.X, f.pos.Z), 0)
	}
	f.pos.X += mixedSpeed * dt * sin32(f.dir)
	f.pos.Z -= mixedSpeed * dt * cos32(f.dir)

	// Members that took fright, left or died drop out.
	n := 0
	for m := 0; m < f.n; m++ {
		i := f.members[m]
		b := &s.birds[i]
		if !b.alive || b.id != f.ids[m] || b.mixed != f.id {
			continue
		}
		switch b.mode {
		case mAway, mHide, mAlert, mLeave, mRoost:
			b.mixed = 0
			continue
		}
		f.members[n], f.ids[n] = i, f.ids[m]
		n++
	}
	f.n = n
	if n < 2 {
		s.disperseMixed()
	}
}

// disperseMixed breaks the flock up: everyone heads back to its own territory.
func (s *Sim) disperseMixed() {
	f := &s.mixed
	for m := 0; m < f.n; m++ {
		b := &s.birds[f.members[m]]
		if !b.alive || b.id != f.ids[m] || b.mixed != f.id {
			continue
		}
		b.mixed = 0
		switch b.mode {
		case mIdle, mGround, mGlean, mClimb:
			if !b.moving {
				s.goPerch(b, &s.prof[b.sp], thenPerch)
			}
		}
	}
	*f = mixedFlock{}
	s.mixedCD = s.rnd(mixedGapMin, mixedGapMax)
}

// mixedForage sends a member to forage at a spot near the flock's target, the way
// its species does: creeping up a trunk, gleaning in a crown or bush, or on the
// ground.
func (s *Sim) mixedForage(b *bird, p *profile) {
	f := &s.mixed
	a := s.rnd(0, 2*math.Pi)
	d := s.rnd(0, 9)
	x, z := f.pos.X+d*sin32(a), f.pos.Z-d*cos32(a)
	if c := s.cells[keyAt(x, z)]; c != nil {
		best, bestW := -1, float32(0)
		for i, pc := range c.perches {
			dd := distXZ2(pc.Pos, core.V(x, 0, z))
			if dd > 10*10 {
				continue
			}
			fit := p.perchFit(pc.Kind, c.perchH[i])
			if !p.feedSpot[pc.Kind] {
				fit *= 0.3
			}
			if w := fit / (4 + dd); w > bestW {
				best, bestW = i, w
			}
		}
		if best >= 0 {
			pc := c.perches[best]
			th := thenGlean
			switch pc.Kind {
			case core.PerchTrunk:
				th = thenClimb
			case core.PerchGround, core.PerchShore:
				th = thenForage
			}
			s.fly(b, p, pc, noPerch, core.ActFlying, 1, th)
			return
		}
	}
	if pc, ok := s.groundAt(p, x, z, false); ok {
		s.fly(b, p, pc, noPerch, core.ActFlying, 1, thenForage)
		return
	}
	s.goPerch(b, p, thenPerch)
}

// mixedKeepUp moves a member that has fallen behind the drifting target.
func (s *Sim) mixedKeepUp(b *bird, p *profile, dt float32) {
	switch b.mode {
	case mIdle, mGround, mGlean, mClimb:
	default:
		return
	}
	if distXZ2(b.pos, s.mixed.pos) < mixedReach*mixedReach || !s.chance(0.8*dt) {
		return
	}
	s.mixedForage(b, p)
}

// MixedFlock returns the id of the mixed feeding flock the bird currently belongs
// to, or 0 if it is in none (or is not in the world).
func (s *Sim) MixedFlock(id uint32) uint32 {
	i, ok := s.byID[id]
	if !ok {
		return 0
	}
	return s.birds[i].mixed
}

// MixedFlocks counts the mixed feeding flocks whose shared target lies within
// radius (horizontal distance) of center.
func (s *Sim) MixedFlocks(center core.Vec3, radius float32) int {
	if s.mixed.id != 0 && distXZ2(s.mixed.pos, center) <= radius*radius {
		return 1
	}
	return 0
}
