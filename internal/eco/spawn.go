package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Putting residents into the world and taking them out again.

// spawn brings roster entry ri of cell c into the world and returns its slot, or -1.
// With announce the bird flies in from outside (a migrant arriving, a vagrant, a
// rare bird coming out) and an EvArrive is emitted; otherwise it is simply placed
// where its routine has it now.
func (s *Sim) spawn(c *cell, ri int16, announce bool) int32 {
	r := &c.roster[ri]
	if r.bird >= 0 {
		return r.bird
	}
	p := &s.prof[r.sp]

	// Ids are hashes; on the (very rare) clash with a bird already in the world,
	// derive another one deterministically.
	id := r.id
	for {
		if _, taken := s.byID[id]; !taken {
			break
		}
		id = idFrom(mix(uint64(id) + 1))
	}

	var idx int32
	if n := len(s.free); n > 0 {
		idx = s.free[n-1]
		s.free = s.free[:n-1]
	} else {
		s.birds = append(s.birds, bird{})
		idx = int32(len(s.birds) - 1)
	}
	b := &s.birds[idx]
	*b = bird{
		alive: true, id: id, sp: r.sp, res: ri, cell: c,
		home: r.home, seed: r.seed, cur: noPerch, dest: noPerch,
		gnext: -1, gprev: -1,
	}
	b.jitter = (unit(hash2(r.seed, 0x4A495454)) - 0.5) * 0.8
	b.sdir = 1
	if hash2(r.seed, 0x53444952)&1 == 0 {
		b.sdir = -1
	}
	if r.plumage {
		b.flags |= core.FlagRarePlumage
	}
	if r.vagrant {
		b.flags |= core.FlagVagrant
	}
	r.bird = idx
	s.byID[id] = idx
	s.count++
	s.buildMemory(b, p, c)

	was := s.silent
	s.silent = true
	s.place(b)
	s.silent = was

	if announce && !s.silent {
		s.arriveFromAfar(b, p)
		s.events = append(s.events, core.EcoEvent{Kind: core.EvArrive, Bird: b.id, Species: int(b.sp), Pos: b.pos})
	}
	s.gridInsert(b, idx)
	return idx
}

// arriveFromAfar starts the bird well outside its territory, high up, flying in to
// one of its perches.
func (s *Sim) arriveFromAfar(b *bird, p *profile) {
	a := unit(hash2(b.seed, uint64(s.env.Day))) * 2 * math.Pi
	x, z := b.home.X+160*sin32(a), b.home.Z-160*cos32(a)
	b.pos = core.V(x, max32(s.t.HeightAt(x, z), 0)+35, z)
	b.mode = mIdle
	b.cur = noPerch
	i := s.pickMem(b, memGen, maxGen, -1)
	if i < 0 {
		i = s.pickMem(b, 0, maxMem, -1)
	}
	if i >= 0 {
		s.fly(b, p, b.mem[i], int8(i), core.ActFlying, 1, thenPerch)
		return
	}
	pc, ok := s.groundAt(p, b.home.X, b.home.Z, true)
	if !ok {
		pc = core.Perch{Pos: core.V(b.home.X, max32(b.home.Y, 0), b.home.Z)}
	}
	s.fly(b, p, pc, noPerch, core.ActFlying, 1, thenPerch)
}

// despawn takes a bird out of the world (its resident entry stays in the roster).
func (s *Sim) despawn(idx int32) {
	b := &s.birds[idx]
	if !b.alive {
		return
	}
	s.releaseLure(b)
	s.gridRemove(b)
	delete(s.byID, b.id)
	if c := b.cell; c != nil && b.res >= 0 && int(b.res) < len(c.roster) && c.roster[b.res].bird == idx {
		c.roster[b.res].bird = -1
	}
	b.alive = false
	b.cell = nil
	s.free = append(s.free, idx)
	s.count--
}

// leave flies a bird out of the world: a migrant departing, a rare bird withdrawing.
func (s *Sim) leave(b *bird) {
	p := &s.prof[b.sp]
	s.releaseLure(b)
	a := unit(hash2(b.seed, 0x4C454156)) * 2 * math.Pi
	x, z := b.pos.X+220*sin32(a), b.pos.Z-220*cos32(a)
	to := core.Perch{Pos: core.V(x, max32(s.t.HeightAt(x, z), 0)+40, z)}
	b.mode = mLeave
	b.flags &^= core.FlagHidden
	s.fly(b, p, to, noPerch, core.ActFlying, 1, thenGone)
}

// ---------------------------------------------------------------------------
// Perch memory

// memCand is a candidate perch in a weighted random selection without replacement:
// the k smallest keys -ln(u)/w win (exponential-key sampling). Unsuitable
// candidates (bad) only win where there are not enough suitable ones.
type memCand struct {
	key float32
	i   int32
	bad bool
}

func (a memCand) less(b memCand) bool {
	if a.bad != b.bad {
		return !a.bad
	}
	return a.key < b.key
}

func insertCand(list []memCand, n *int, key float32, i int32, bad bool) {
	c := memCand{key, i, bad}
	k := *n
	if k < len(list) {
		list[k] = c
		k++
		*n = k
	} else if !c.less(list[k-1]) {
		return
	} else {
		list[k-1] = c
	}
	for j := k - 1; j > 0 && list[j].less(list[j-1]); j-- {
		list[j], list[j-1] = list[j-1], list[j]
	}
}

// trimBad drops the unsuitable candidates from a sorted selection as long as at
// least keep remain, and returns the new length.
func trimBad(list []memCand, keep int) int {
	n := len(list)
	for n > keep && list[n-1].bad {
		n--
	}
	return n
}

func expKey(u uint64, w float32) float32 {
	f := (float64(u&0xFFFF) + 0.5) / 65536
	return float32(-math.Log(f)) / w
}

// buildMemory chooses the bird's remembered places from the perches around its
// home: a song post (prominent), a roost (sheltered), a bathing spot at the water's
// edge, feeding spots and everyday perches. Every choice respects the species' perch
// kinds (most preferred first) and its height habit: a wren remembers brambles,
// ferns and low branches, not the crowns above them. The choice depends only on who
// the bird is and the terrain, so it is the same every time the bird comes back.
func (s *Sim) buildMemory(b *bird, p *profile, c *cell) {
	b.memOK = 0
	s.loc.Seed(b.seed, 0x4D454D4F5259)
	r := max32(p.terr, 30)
	r2 := r * r
	var gen [maxGen]memCand
	var feed [maxFeed]memCand
	var song, roost, bath [1]memCand
	var nGen, nFeed, nSong, nRoost, nBath int
	limited := p.hiMax < noHeightLimit
	for i, pc := range c.perches {
		d2 := distXZ2(pc.Pos, b.home)
		if d2 > r2 {
			continue
		}
		u := s.loc.Uint64()
		near := 1 - 0.85*sqrt32(d2)/r // territories have a heart: most perches are near home
		h := c.perchH[i]
		hf := p.heightFit(h)
		pref := p.perchPref[pc.Kind]
		if pref > 0 {
			fit := pref * hf
			bad := fit < suitFit
			insertCand(gen[:], &nGen, expKey(u, fit*near), int32(i), bad)
			// Song posts: prominent perches it likes. A bird of the tree tops sings
			// from high and open; a low-living one from the top of its thicket.
			var hi float32
			if limited {
				hi = 1 + 0.5*clamp(h/p.hiMax, 0, 1)
			} else {
				hi = 1 + clamp((pc.Pos.Y-b.home.Y)/8, 0, 1.5)
			}
			insertCand(song[:], &nSong, expKey(u>>16, fit*near*hi*(1.15-pc.Cover)), int32(i), bad)
			// Roosts: sheltered.
			insertCand(roost[:], &nRoost, expKey(u>>32, fit*near*(0.15+pc.Cover)), int32(i), bad)
		}
		if p.feedSpot[pc.Kind] {
			// It forages where it likes to be: kinds outside its perch list only when
			// the territory offers nothing else.
			w := float32(0.03)
			if pref > 0 {
				w = 0.3 + pref
			}
			insertCand(feed[:], &nFeed, expKey(u>>48, w*hf*near), int32(i), pref == 0 || hf < 0.4)
		}
		if pc.Kind == core.PerchShore && p.specBathe {
			insertCand(bath[:], &nBath, expKey(u>>40, near), int32(i), false)
		}
	}
	// Unsuitable perches only make up the numbers when there are too few good ones.
	nGen = trimBad(gen[:nGen], 2)
	nFeed = trimBad(feed[:nFeed], 1)
	set := func(slot int, i int32) {
		pc := c.perches[i]
		// Birds sharing a tree do not sit on exactly the same twig.
		switch pc.Kind {
		case core.PerchCanopy, core.PerchBranch, core.PerchShrub, core.PerchReed:
			h := hash2(b.seed, uint64(slot))
			pc.Pos.X += (unit(h) - 0.5) * 0.7
			pc.Pos.Z += (unit(h>>24) - 0.5) * 0.7
		}
		b.mem[slot] = pc
		b.memOK |= 1 << uint(slot)
	}
	for k := 0; k < nGen; k++ {
		set(memGen+k, gen[k].i)
	}
	for k := 0; k < nFeed; k++ {
		set(memFeed+k, feed[k].i)
	}
	if nSong > 0 {
		set(memSong, song[0].i)
	}
	if nRoost > 0 {
		set(memRoost, roost[0].i)
	}
	if nBath > 0 {
		set(memBath, bath[0].i)
	}
	if nGen == 0 {
		// The territory offers none of its favourite perches: it makes do with the
		// ground (or water) at home.
		if pc, ok := s.groundAt(p, b.home.X, b.home.Z, true); ok {
			b.mem[memGen] = pc
			b.memOK |= 1 << memGen
		}
	}
	if !b.has(memSong) && b.has(memGen) {
		b.mem[memSong] = b.mem[memGen]
		b.memOK |= 1 << memSong
	}
	if !b.has(memRoost) && b.has(memGen) {
		b.mem[memRoost] = b.mem[memGen]
		b.memOK |= 1 << memRoost
	}
}
