package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// A flush you can follow (spec 6.4, 12.4). A real bird scared off does not vanish:
// it bursts away from the intruder, settles into a steady flight that rises clear of
// the trees, and drops onto a perch not far off - usually an open one, where it
// turns and looks back, flicks its tail and gives an alarm or contact note before
// it relaxes, maybe slips into the leaves of the same tree, and eventually drifts
// home. A birder follows it: "there it goes - over the path - into the top of that
// birch". So the refuge is chosen like that:
//
//   - not far: small songbirds 12-35 m, medium birds 25-60 m, big wary ones (herons,
//     ducks, raptors) 50-120 m; flushed again within four minutes it goes farther
//     (from the far end of that band to 1.8 times it), and a third time it leaves
//     the area (150-240 m) for a good while;
//   - away from the observer, within about 60 degrees of straight away, so it
//     crosses the view instead of disappearing behind them;
//   - onto a perch the player can see from where they stand (Terrain.Occlusion)
//     whenever one exists, an exposed one first (the top of a crown or a bush, an
//     outer branch, a post, a reed top, open water for ducks), of a kind and height
//     the species uses;
//   - flock mates go with it to the same tree or patch, a fraction of a second
//     apart, onto neighbouring perches.
//
// Flushing stays a mistake: the bird is wary for a while and a second flush sends
// it farther. The recovery - follow it, wait, approach more carefully - is what the
// landing makes possible.

// fleeKind is the size class that sets how far a flushed bird goes.
type fleeKind uint8

const (
	fleeSmall  fleeKind = iota // small songbirds: 12-35 m
	fleeMedium                 // thrush, jay, woodpecker sized: 25-60 m
	fleeBig                    // herons, ducks, raptors, big wary birds: 50-120 m
)

// fleeRange is the [near, far] distance band of a first flush per class.
var fleeRange = [3][2]float32{{12, 35}, {25, 60}, {50, 120}}

func fleeClass(p *profile) fleeKind {
	switch {
	case p.raptor || p.length >= 0.45 || p.shy >= 40 || (p.waterBird && p.length >= 0.3) || p.ground == groundWade:
		return fleeBig
	case p.length >= 0.2 || p.shy >= 20:
		return fleeMedium
	}
	return fleeSmall
}

const (
	// streakTicks: a flush within this many ticks (0.1 s) of the last one counts as
	// a repeat: the bird goes farther each time.
	streakTicks = 2400
	// A third flush in a row: it leaves the area for a while.
	leaveNear, leaveFar = 150, 240
	leaveAwayMin        = 150
	leaveAwayMax        = 300

	// The escape flight: a burst of burstGain x the steady speed at take-off,
	// fading out over burstTime seconds, then steady; over the last landTime
	// seconds it brakes to (1 - landCut) of it for the landing.
	burstGain = 0.6
	burstTime = 1.5
	landTime  = 0.7
	landCut   = 0.6

	// After landing at its refuge it looks back, in view, for lookMin..lookMax
	// seconds and calls within callMin..callMax seconds.
	lookMin, lookMax = 8, 15
	callMin, callMax = 0.8, 3.5
	// Then it may slip into the cover of the same tree (more likely for a skulker).
	slipBase, slipSkulk = 0.25, 0.6
	slipR               = 4.5

	// A skulker that dived into cover shows itself on top of it (or at its edge)
	// this long after its hiding bout ran out, if the danger has not passed.
	peekMin, peekMax = 3, 7

	// Candidate refuges: at most this many get the (costlier) line-of-sight test.
	refugeShort = 10

	// woodShort scales a small or medium bird's escape band when it starts in woodland.
	woodShort = 0.75
	// A duck flushed off the water may settle back on it this close (metres).
	waterNear = 15
)

// Refuge stages.
const (
	ffNone    uint8 = iota
	ffFlying        // on its way to the refuge
	ffLooking       // landed, looking back at the observer
	ffSettled       // sitting out its wariness at the refuge
)

// followState is a bird's follow-flight bookkeeping.
type followState struct {
	streak   uint8  // flushes in a row
	stage    uint8  // ffNone...
	burst    bool   // the current flight is an escape (burstEase)
	announce bool   // an EvFlush went out for this flight: report the landing (EvLand)
	peeked   bool   // a hidden skulker has already shown itself this hiding bout
	last     uint32 // Sim.tick of the last flush
	look     float32
	call     float32
	peek     float32
	from     core.Vec3 // where the escape began
}

// followFlight switches the follow-flight rules on. Tests turn it off to measure the
// old behaviour (legacyFlush) for comparison.
var followFlight = true

// flushAway sends a flushed bird to a refuge it can be followed to, with its flock,
// and reports the flush. It is the second half of flee (fear.go).
func (s *Sim) flushAway(b *bird, p *profile) {
	if !followFlight {
		s.legacyFlush(b, p)
		return
	}
	f := &b.ff
	if f.last != 0 && s.tick-f.last < streakTicks {
		if f.streak < 255 {
			f.streak++
		}
	} else {
		f.streak = 1
	}
	f.last = s.tick
	if f.last == 0 {
		f.last = 1
	}

	lo, hi := fleeRange[fleeClass(p)][0], fleeRange[fleeClass(p)][1]
	away := s.rnd(40, 110)
	switch {
	case f.streak == 2:
		lo, hi = hi, hi*1.8 // beyond where the first one went
		away *= 1.4
	case f.streak >= 3:
		lo, hi = max32(leaveNear, hi*2), max32(leaveFar, hi*2+90)
		away = s.rnd(leaveAwayMin, leaveAwayMax)
	}
	if f.streak < 3 && fleeClass(p) != fleeBig {
		switch s.t.HabitatAt(b.pos.X, b.pos.Z) {
		case core.HabWoodland, core.HabConifer:
			// Under trees the next cover is close, and a long flight would be behind the
			// crowns for most of the way (play-test: woodland flights of 40-65 m were
			// lost behind the leaves): it goes a shorter way.
			lo, hi = lo*woodShort, hi*woodShort
		}
	}
	dirX, dirZ := s.awayDir(b)
	to := s.pickRefuge(b, p, dirX, dirZ, lo, hi)

	b.mode = mAway
	b.away = away
	s.escape(b, p, to, 0)
	mates := s.flockAway(b, to, away)
	if !s.silent {
		f.announce = true
		s.events = append(s.events, core.EcoEvent{Kind: core.EvFlush, Bird: b.id, Species: int(b.sp),
			Pos: b.pos, From: f.from, To: b.to, Dur: b.mdur, Repeats: mates})
	}
}

// awayDir is the unit direction straight away from the observer (or a random one).
func (s *Sim) awayDir(b *bird) (float32, float32) {
	dx, dz := b.pos.X-s.obs.Pos.X, b.pos.Z-s.obs.Pos.Z
	if l := sqrt32(dx*dx + dz*dz); s.obs.Present && l > 0.01 {
		return dx / l, dz / l
	}
	a := s.rnd(0, 2*math.Pi)
	return sin32(a), -cos32(a)
}

// refugeCand is a candidate landing place.
type refugeCand struct {
	pc    core.Perch
	score float32
}

// pickRefuge scores the perches between lo and hi metres away in the direction
// (dirX, dirZ) (within about 60 degrees of it) and returns the best: the right
// distance, straight away rather than sideways, a kind and height the species uses,
// exposed, and in sight of the observer.
//
// A bird that also uses raised perches is not sent down into tall grass (meadow,
// marsh, scrub, a grassy bank): the grass swallows a small bird whole, so the
// player could never find it again. If that is all the band offers, it looks a
// little farther on for a bush, a branch or a post (play-test: a robin flushed in
// the meadow dropped into the grass 40 m off and was gone).
func (s *Sim) pickRefuge(b *bird, p *profile, dirX, dirZ, lo, hi float32) core.Perch {
	pc := s.pickRefugeIn(b, p, dirX, dirZ, lo, hi)
	if s.lostInGrass(p, pc) && hi < 150 {
		if alt := s.pickRefugeIn(b, p, dirX, dirZ, hi, hi*2); !s.lostInGrass(p, alt) {
			return alt
		}
	}
	return pc
}

// usesRaised: the species perches up off the ground (branches, bushes, posts...).
func usesRaised(p *profile) bool {
	for _, k := range [...]core.PerchKind{core.PerchBranch, core.PerchCanopy, core.PerchShrub, core.PerchSnag, core.PerchStructure, core.PerchRock, core.PerchReed} {
		if p.showPref[k] > 0 || p.perchPref[k] > 0 {
			return true
		}
	}
	return false
}

// tallGrass: habitats whose ground the client covers in grass tall enough to hide a
// bird on it from a standing player more than a few metres away
// (web/js/world/groundField.js HABITAT_COVER).
func tallGrass(h core.Habitat) bool {
	switch h {
	case core.HabMeadow, core.HabMarsh, core.HabShrub, core.HabRiver:
		return true
	}
	return false
}

// lostInGrass: a landing on the ground in tall grass by a bird that could have
// perched up instead.
func (s *Sim) lostInGrass(p *profile, pc core.Perch) bool {
	return pc.Kind == core.PerchGround && usesRaised(p) && tallGrass(s.t.HabitatAt(pc.Pos.X, pc.Pos.Z))
}

func (s *Sim) pickRefugeIn(b *bird, p *profile, dirX, dirZ, lo, hi float32) core.Perch {
	var short [refugeShort]refugeCand
	n := 0
	eye := s.obs.Pos
	bd := b.pos.DistXZ(eye)
	perchesUp := usesRaised(p)
	// A duck flushed off open water settles back on it if there is room (the far end
	// of the pond), rather than leaving for somewhere out of sight.
	onWater := p.waterBird && b.destKind == core.PerchWater
	consider := func(pc core.Perch, h, fit float32) {
		dx, dz := pc.Pos.X-b.pos.X, pc.Pos.Z-b.pos.Z
		d := sqrt32(dx*dx + dz*dz)
		lo := lo
		if onWater && pc.Kind == core.PerchWater {
			lo = min32(lo, 2*waterNear)
		}
		if d < 0.7*lo || d > 1.3*hi || d < 3 {
			return
		}
		c := (dx*dirX + dz*dirZ) / d
		if onWater && pc.Kind == core.PerchWater {
			// Ducks swing round and drop back onto the water: sideways is fine, as
			// long as it ends farther from the observer (below).
			if c < -0.35 {
				return
			}
		} else if c < 0.26 { // more than ~75 degrees off straight away
			return
		}
		if s.obs.Present && pc.Pos.DistXZ(eye) < bd+0.4*d {
			return // it would not be getting away
		}
		switch pc.Kind {
		case core.PerchShrub, core.PerchReed:
			pc = s.topOf(pc) // it lands on top of the bush and looks about
		}
		wd := float32(1)
		if d < lo {
			wd = (d / lo) * (d / lo)
		} else if d > hi {
			wd = (hi / d) * (hi / d)
		}
		wa := 1 - 0.45*smooth(0.94, 0.5, c) // 1 straight away, 0.55 at 60 degrees
		wv := 0.2 + 0.8*(1-clamp(pc.Cover, 0, 1))
		// Up off the ground where it can: a bird on a branch or the top of a bush
		// stands out against the sky or the leaves; one on the ground sinks into the
		// grass. (Birds that only ever stand on the ground or water are not asked.)
		switch {
		case pc.Kind == core.PerchGround && perchesUp:
			wv *= 0.4
			if tallGrass(s.t.HabitatAt(pc.Pos.X, pc.Pos.Z)) {
				wv *= 0.25 // in the long grass it is simply gone
			}
		case pc.Kind != core.PerchWater && pc.Kind != core.PerchShore:
			wv *= 0.85 + 0.3*smooth(0.5, 3, h)
		}
		sc := fit * wd * wa * wv * s.rnd(0.85, 1.15)
		if n < refugeShort {
			short[n] = refugeCand{pc, sc}
			n++
		} else {
			worst := 0
			for i := 1; i < n; i++ {
				if short[i].score < short[worst].score {
					worst = i
				}
			}
			if sc <= short[worst].score {
				return
			}
			short[worst] = refugeCand{pc, sc}
		}
	}

	// Perches from the active cells around the target area (cells keep their perch
	// lists in memory: no terrain queries).
	mid := (lo + hi) / 2
	cx, cz := b.pos.X+dirX*mid, b.pos.Z+dirZ*mid
	reach := hi*0.9 + 8
	k0, k1 := keyAt(cx-reach, cz-reach), keyAt(cx+reach, cz+reach)
	seen := 0
	for kz := k0.z; kz <= k1.z; kz++ {
		for kx := k0.x; kx <= k1.x; kx++ {
			c := s.cells[cellKey{kx, kz}]
			if c == nil {
				continue
			}
			// A cell's perch list reaches past its edges: take only the perches that
			// lie inside it, so none is scored twice.
			x0, z0 := float32(kx)*cellSize, float32(kz)*cellSize
			for i := range c.perches {
				pc := &c.perches[i]
				if pc.Pos.X < x0 || pc.Pos.X >= x0+cellSize || pc.Pos.Z < z0 || pc.Pos.Z >= z0+cellSize {
					continue
				}
				fit := max32(p.perchPref[pc.Kind], p.showPref[pc.Kind])
				if fit <= 0 {
					continue
				}
				fit *= p.heightFit(c.perchH[i])
				if fit < suitFit*0.5 {
					continue
				}
				seen++
				consider(*pc, c.perchH[i], fit)
			}
		}
	}
	// Open ground, shallows and open water along the way, for the birds that use them.
	for _, deg := range [...]float32{0, -20, 20, -40, 40, -55, 55, -80, 80, -105, 105} {
		if (deg > 60 || deg < -60) && !onWater {
			break
		}
		a := deg * math.Pi / 180
		ca, sa := cos32(a), sin32(a)
		ux, uz := dirX*ca-dirZ*sa, dirX*sa+dirZ*ca
		ds := [...]float32{lo + (hi-lo)*0.3, lo + (hi-lo)*0.7, 0, 0}
		if onWater {
			ds[2], ds[3] = 1.5*waterNear, 2.4*waterNear
		}
		for _, d := range ds {
			if d <= 0 {
				continue
			}
			pc, ok := s.groundAt(p, b.pos.X+ux*d, b.pos.Z+uz*d, true)
			if !ok || p.perchPref[pc.Kind] <= 0 {
				continue
			}
			consider(pc, 0, p.perchPref[pc.Kind])
		}
	}
	if n == 0 {
		// Nowhere it likes in that direction: the old way, somewhere near a point
		// straight away.
		a := heading(dirX, dirZ) + s.rnd(-0.5, 0.5)
		d := mid * s.rnd(0.85, 1.15)
		return s.refuge(p, b.pos.X+d*sin32(a), b.pos.Z-d*cos32(a))
	}
	_ = seen
	best, bestS := -1, float32(-1)
	for i := 0; i < n; i++ {
		c := &short[i]
		w := c.score
		if s.obs.Present {
			// Terrain.Occlusion counts crowns only partially (a crown crossed through
			// its centre is ~0.35) and trunks not at all, while on screen a crown
			// hides a bird completely: so the preference for a clear line is steep.
			occ := clamp(s.t.Occlusion(eye, core.V(c.pc.Pos.X, c.pc.Pos.Y+0.12, c.pc.Pos.Z)), 0, 1)
			los := 0.03 + 0.97*(1-occ)*(1-occ)*(1-occ)
			if occ >= 0.95 {
				los = 0.01 // behind the hill
			}
			w *= los * s.pathSeen(b, c.pc.Pos, eye)
		}
		if w > bestS {
			best, bestS = i, w
		}
	}
	return short[best].pc
}

// pathSeen (0.2..1) is how much of the way to a refuge the observer can follow: the
// flight seen against the sky or across a clearing, rather than behind the crowns.
// It samples fly's arc (roughly) at half and four-fifths of the way.
func (s *Sim) pathSeen(b *bird, to, eye core.Vec3) float32 {
	hl := to.DistXZ(b.pos)
	if hl < 6 {
		return 1
	}
	rise := clamp(0.12*hl, 2, 12)
	w := float32(1)
	for _, u := range [...]float32{0.5, 0.8} {
		p := core.V(b.pos.X+(to.X-b.pos.X)*u, b.pos.Y+(to.Y-b.pos.Y)*u+4*rise*u*(1-u), b.pos.Z+(to.Z-b.pos.Z)*u)
		occ := clamp(s.t.Occlusion(eye, p), 0, 1)
		w *= 0.45 + 0.55*(1-occ)*(1-occ)
	}
	return w
}

// escape starts the escape flight to the refuge: a fast take-off that settles into a
// steady flight, on an arc that rises clear of the trees (and, where it can, stays in
// the observer's sight), taking off after delay seconds (flock mates follow the
// first a fraction of a second later).
func (s *Sim) escape(b *bird, p *profile, to core.Perch, delay float32) {
	b.ff.from = b.pos
	// fly's everyday arc (clear of the ground, over the tree tops on long flights),
	// with a steadier line than its usual wobble.
	s.fly(b, p, to, noPerch, core.ActFlying, 1, thenRefuge)
	if !b.moving {
		return
	}
	b.act = core.ActFleeing
	b.wob *= 0.5
	b.ff.stage = ffFlying
	dx, dy, dz := b.to.X-b.from.X, b.to.Y-b.from.Y, b.to.Z-b.from.Z
	hl := sqrt32(dx*dx + dz*dz)
	l := sqrt32(dx*dx + dy*dy + dz*dz)
	steady := p.speed
	if fleeClass(p) == fleeBig {
		steady *= 1.05
	}
	if hl < 8 {
		steady = min32(steady, 3+0.9*hl)
	}
	b.mdur = escapeTime(l, steady)
	b.speed = l / b.mdur
	b.ff.burst = true
	b.mt = -delay

	// Up and away: the arc peaks well above both ends.
	rise := clamp(0.12*hl, 2, 12)
	if need := rise + abs32(dy)*0.5; b.lift < need {
		b.lift = need
	}
	// Where the straight arc would go through the crowns between the observer and
	// the bird, lift it until it shows against the sky (a few rays, flushes only).
	if s.obs.Present && hl > 10 {
		for k := 0; k < 3; k++ {
			mx, mz := b.from.X+dx*0.5, b.from.Z+dz*0.5
			my := b.from.Y + dy*0.5 + b.lift
			if s.t.Occlusion(s.obs.Pos, core.V(mx, my, mz)) < 0.4 {
				break
			}
			b.lift = min32(b.lift+4, 60)
		}
	}
}

// escapeAvgMax caps an escape's average speed (as a multiple of the species' steady
// flight): short escapes are mostly burst, so their steady part is slowed to keep
// them readable.
const escapeAvgMax = 1.12

// escapeTime is how long an escape of length l at steady speed v takes with the
// burst and the landing, its average speed capped at escapeAvgMax x v.
func escapeTime(l, v float32) float32 {
	w := v
	t := escapeTimeAt(l, w)
	for i := 0; i < 4 && l/t > escapeAvgMax*v; i++ {
		w *= escapeAvgMax * v / (l / t)
		t = escapeTimeAt(l, w)
	}
	return max32(t, l/(escapeAvgMax*v))
}

// escapeTimeAt is the fixed point of the distance integral (see burstDist).
func escapeTimeAt(l, v float32) float32 {
	base := l / max32(v, 0.5)
	t := base
	for i := 0; i < 6; i++ {
		tb := min32(t, burstTime)
		tl := min32(landTime, 0.35*t)
		t = base - burstGain*(tb-tb*tb/(2*burstTime)) + landCut*tl/2
		if t < 0.35 {
			t = 0.35
		}
	}
	return t
}

// burstDist is the distance flown after tau seconds of an escape lasting T, in
// units of the steady speed.
func burstDist(tau, T float32) float32 {
	tb := min32(tau, burstTime)
	d := tau + burstGain*(tb-tb*tb/(2*burstTime))
	tl := min32(landTime, 0.35*T)
	if u := tau - (T - tl); u > 0 && tl > 0 {
		d -= landCut * u * u / (2 * tl)
	}
	return d
}

// burstEase is the escape's progress along the path (e) and the normalised time
// for the height arc (t), both 0..1.
func burstEase(b *bird) (e, t float32) {
	T := max32(b.mdur, 0.05)
	tau := clamp(b.mt, 0, T)
	return burstDist(tau, T) / max32(burstDist(T, T), 1e-3), tau / T
}

// flockAway sends the leader's flock mates after it, to neighbouring perches of the
// same tree or patch, each a fraction of a second behind the one before. It returns
// how many went.
func (s *Sim) flockAway(b *bird, to core.Perch, away float32) int {
	if b.cell == nil || b.res < 0 || int(b.res) >= len(b.cell.roster) {
		return 0
	}
	lead := b.cell.roster[b.res].lead
	if lead < 0 {
		return 0
	}
	went := 0
	var taken [16]core.Vec3
	nt := 1
	taken[0] = to.Pos
	delay := float32(0)
	for i := range b.cell.roster {
		m := &b.cell.roster[i]
		if m.lead != lead || m.bird < 0 {
			continue
		}
		o := &s.birds[m.bird]
		if o == b || !o.alive || o.mode == mAway || o.mode == mLeave || o.mode == mPass || o.mode == mNest || distXZ2(o.pos, b.pos) > 40*40 {
			continue
		}
		op := &s.prof[o.sp]
		pc := s.besidePerch(op, to, taken[:nt])
		if nt < len(taken) {
			taken[nt] = pc.Pos
			nt++
		}
		delay += s.rnd(0.12, 0.45)
		s.releaseLure(o)
		o.flags &^= core.FlagSinging | core.FlagHidden
		o.singT = 0
		o.quiet = max32(o.quiet, s.rnd(40, 90))
		o.habit *= 0.6
		o.fear = max32(o.fear, fearFlee)
		o.fled = s.obs.Present
		o.ff.streak, o.ff.last, o.ff.announce = b.ff.streak, b.ff.last, false
		o.mode = mAway
		o.away = away + s.rnd(-4, 10)
		s.escape(o, op, pc, delay)
		went++
	}
	return went
}

// besidePerch finds a perch within a few metres of the leader's refuge for a flock
// mate, apart from the ones already taken; failing that, a spot right beside it.
func (s *Sim) besidePerch(p *profile, to core.Perch, taken []core.Vec3) core.Perch {
	s.scratch = s.t.PerchesNear(to.Pos.X, to.Pos.Z, 7, s.scratch[:0])
	best, bestW := -1, float32(0)
	for i, c := range s.scratch {
		fit := max32(p.perchPref[c.Kind], p.showPref[c.Kind])
		if fit <= 0 || !s.perchValid(c) {
			continue
		}
		free := true
		for _, t := range taken {
			if dist2(t, c.Pos) < 0.7*0.7 {
				free = false
				break
			}
		}
		if !free {
			continue
		}
		w := fit / (1 + dist2(c.Pos, to.Pos)/9) * s.rnd(0.8, 1.2)
		if w > bestW {
			best, bestW = i, w
		}
	}
	if best >= 0 {
		pc := s.scratch[best]
		if pc.Kind == core.PerchShrub || pc.Kind == core.PerchReed {
			pc = s.topOf(pc)
		}
		return pc
	}
	// Right beside the leader: on the ground or water it lands on, or a short way
	// along the same branch.
	pc := to
	a := s.rnd(0, 2*math.Pi)
	r := s.rnd(0.5, 1.6)
	pc.Pos.X += r * sin32(a)
	pc.Pos.Z -= r * cos32(a)
	if g := s.t.HeightAt(pc.Pos.X, pc.Pos.Z); to.Kind == core.PerchGround || to.Kind == core.PerchWater || to.Kind == core.PerchShore {
		pc.Pos.Y = max32(g, 0)
	} else if pc.Pos.Y < g {
		pc.Pos.Y = g
	}
	return pc
}

// refugeLanded: the escape has ended (move.go arrive, thenRefuge). The bird turns
// to look back at the observer, in the open, and calls soon.
func (s *Sim) refugeLanded(b *bird, p *profile) {
	f := &b.ff
	f.burst = false
	if f.stage != ffFlying || !followFlight {
		return // a hop at the refuge (slipping into cover): just sit
	}
	f.stage = ffLooking
	f.look = s.rnd(lookMin, lookMax)
	if fleeClass(p) == fleeBig {
		f.look *= 1.3
	}
	f.call = s.rnd(callMin, callMax)
	if b.destKind != core.PerchWater {
		b.act = core.ActAlert
	}
	if s.obs.Present {
		b.yaw = heading(s.obs.Pos.X-b.pos.X, s.obs.Pos.Z-b.pos.Z)
	}
	if f.announce {
		f.announce = false
		if !s.silent {
			s.events = append(s.events, core.EcoEvent{Kind: core.EvLand, Bird: b.id, Species: int(b.sp),
				Pos: b.pos, From: f.from, To: b.pos})
		}
	}
}

// refugeTick runs every tick a bird is away (mAway) and not moving: the landing
// call, looking back, and afterwards perhaps slipping into cover nearby.
func (s *Sim) refugeTick(b *bird, p *profile, dt float32) {
	f := &b.ff
	if b.moving {
		return
	}
	if f.call > 0 {
		if f.call -= dt; f.call <= 0 {
			f.call = 0
			ci := p.callAlarm
			if ci < 0 {
				ci = p.callContact
			}
			if ci >= 0 && b.flags&core.FlagSinging == 0 {
				s.voice(b, p, ci, 1+s.rng.IntN(2))
			}
		}
	}
	if f.stage != ffLooking {
		return
	}
	if s.obs.Present && b.destKind != core.PerchWater {
		b.yaw = heading(s.obs.Pos.X-b.pos.X, s.obs.Pos.Z-b.pos.Z)
	}
	if f.look -= dt; f.look > 0 {
		return
	}
	f.stage = ffSettled
	b.act = s.restAct(b, p)
	if b.cover >= 0.5 || !s.chance(slipBase+slipSkulk*p.skulk) {
		return
	}
	switch b.destKind {
	case core.PerchCanopy, core.PerchBranch, core.PerchShrub, core.PerchReed:
	default:
		return
	}
	if pc, ok := s.coverNear(b, p, slipR); ok {
		s.fly(b, p, pc, noPerch, core.ActFlying, 1, thenRefuge)
	}
}

// coverNear finds a covered perch (cover >= 0.55) the species uses within r metres.
func (s *Sim) coverNear(b *bird, p *profile, r float32) (core.Perch, bool) {
	s.scratch = s.t.PerchesNear(b.pos.X, b.pos.Z, r, s.scratch[:0])
	best, bestW := -1, float32(0)
	for i, c := range s.scratch {
		if c.Cover < 0.55 || abs32(c.Pos.Y-b.pos.Y) > 4 {
			continue
		}
		fit := p.perchPref[c.Kind]
		if fit <= 0 || !s.perchValid(c) {
			continue
		}
		w := fit * c.Cover / (1 + dist2(c.Pos, b.pos)/4)
		if w > bestW {
			best, bestW = i, w
		}
	}
	if best < 0 {
		return core.Perch{}, false
	}
	return s.scratch[best], true
}

// hidePeek: a skulker hiding in cover whose hiding bout has run out while the danger
// is still about shows itself - on top of the bush or reeds, or at the edge of the
// foliage - and watches. It returns true when it started to move.
func (s *Sim) hidePeek(b *bird, p *profile, dt float32) bool {
	f := &b.ff
	if f.peeked || b.moving || !followFlight {
		return false
	}
	if f.peek == 0 {
		f.peek = s.rnd(peekMin, peekMax)
		return false
	}
	if f.peek -= dt; f.peek > 0 {
		return false
	}
	f.peek, f.peeked = 0, true
	b.flags &^= core.FlagHidden
	b.base = core.ActAlert
	cur := core.Perch{Pos: b.pos, Kind: b.destKind, Cover: b.destCover}
	switch cur.Kind {
	case core.PerchShrub, core.PerchReed, core.PerchGround:
		top := cur
		if cur.Kind == core.PerchGround {
			// From the ground under the brambles up onto them.
			if pc, ok := s.exposedNear(b, p, 5); ok {
				s.stepTo(b, pc, mvGround, 1.5, thenStep)
				b.act = core.ActAlert
				return true
			}
			top.Cover *= 0.5
		} else {
			top = s.topOf(cur)
		}
		s.stepTo(b, top, mvGround, 1.2, thenStep)
	default:
		if pc, ok := s.exposedNear(b, p, 5); ok {
			s.stepTo(b, pc, mvGround, 1.5, thenStep)
		} else {
			edge := cur
			edge.Cover *= 0.5
			s.stepTo(b, edge, mvGround, 1, thenStep)
		}
	}
	b.act = core.ActAlert
	return true
}

func abs32(v float32) float32 {
	if v < 0 {
		return -v
	}
	return v
}

// legacyFlush is the flush before the follow-flight rules: a refuge somewhere in a
// rough direction away, preferably in cover, at 1.5x cruise. Kept only so the tests
// can measure the difference (followFlight).
func (s *Sim) legacyFlush(b *bird, p *profile) {
	dx, dz := b.pos.X-s.obs.Pos.X, b.pos.Z-s.obs.Pos.Z
	if !s.obs.Present || dx*dx+dz*dz < 1e-4 {
		a := s.rnd(0, 2*math.Pi)
		dx, dz = sin32(a), -cos32(a)
	}
	a := heading(dx, dz) + s.rnd(-0.7, 0.7)
	dist := p.fleeDist * s.rnd(0.8, 1.3)
	refuge := s.refuge(p, b.pos.X+dist*sin32(a), b.pos.Z-dist*cos32(a))
	if !s.silent {
		s.events = append(s.events, core.EcoEvent{Kind: core.EvFlush, Bird: b.id, Species: int(b.sp), Pos: b.pos})
	}
	b.mode = mAway
	b.away = s.rnd(40, 110)
	s.fly(b, p, refuge, noPerch, core.ActFleeing, 1.5, thenRefuge)
}
