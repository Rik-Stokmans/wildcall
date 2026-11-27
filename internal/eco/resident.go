package eco

import (
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Circuit residents: a bird that holds a small territory and works a short round of
// exposed song posts, singing a full phrase every few seconds whatever the hour,
// holding each post a minute or two, and moving on to the next post of its round,
// across the open, when someone comes too close. It is an ordinary bird in every
// other respect (species, flags, snapshot, calls, evidence) and the same Circuit
// always gives the same bird id, so a session can recreate it after a reload.
//
// The facility exists for quests that need one particular, findable bird (the
// tutorial's singer); it does not live in a population cell, is not touched by cell
// activation or seasons, and stays until it is released or removed.

// Circuit describes a circuit resident.
type Circuit struct {
	Species  int          // species index
	Key      uint64       // identity: the same key always gives the same bird id
	Posts    []core.Perch // 1..maxCircuitPosts song posts, in the order it works them
	SongGap  [2]float32   // seconds between phrases by day (default 8-14)
	NightGap [2]float32   // ... at night (default 24-36; never silent for long)
	Hold     [2]float32   // seconds on each post before moving on (default 60-120)
	// Flush distances (m): an observer closer than this pushes it on to the next post.
	FlushWalk   float32 // walking (default 6); running and sprinting scale it up
	FlushCrouch float32 // crouching or creeping (default 2.5)
	FlushStill  float32 // standing still, sitting or lying (default 1.8)
}

const (
	maxCircuitPosts = 4
	circuitRelease  = 70 // m: a released resident leaves once the observer is this far away
	circuitOffPost  = 8  // s: off its posts (ducked into cover from a raptor) at most this long
	circuitSongPush = 11 // s: after being pushed on it sings again within this (plus the flight)
	circuitCool     = 15 // s for one push's worth of "being chased" to wear off
)

// circuit is the live state of a circuit resident.
type circuit struct {
	def     Circuit
	id      uint32
	slot    int32
	post    int     // the post it is on or flying to
	hold    float32 // seconds left on this post
	songT   float32 // seconds to the next phrase
	offT    float32 // seconds spent off its posts
	pushed  bool    // the current flight was forced by the observer
	heat    float32 // recent pushes (decays one per circuitCool seconds): a chased bird scolds
	release bool

	// Counters for tests and the debug overlay.
	songs, pushes, moves int
	lastSong             float32 // seconds since the last phrase
}

// CircuitInfo is a snapshot of a circuit resident (tests, debug).
type CircuitInfo struct {
	ID       uint32
	Post     int          // the post it is on or flying to
	Posts    []core.Perch // its round
	Moving   bool
	Songs    int     // phrases sung since it was added
	Pushes   int     // times the observer pushed it on
	Moves    int     // moves between posts in all
	LastSong float32 // seconds since its last phrase
	Released bool
}

// AddCircuit puts a circuit resident into the world (or returns the id of the one
// already living with the same Key). It returns 0 for an invalid species or no posts.
func (s *Sim) AddCircuit(c Circuit) uint32 {
	if c.Species < 0 || c.Species >= len(s.prof) || len(c.Posts) == 0 {
		return 0
	}
	if len(c.Posts) > maxCircuitPosts {
		c.Posts = c.Posts[:maxCircuitPosts]
	}
	c.Posts = append([]core.Perch(nil), c.Posts...)
	def2 := func(v *[2]float32, lo, hi float32) {
		if !(v[0] > 0) || v[1] < v[0] {
			*v = [2]float32{lo, hi}
		}
	}
	def2(&c.SongGap, 8, 14)
	def2(&c.NightGap, 24, 36)
	def2(&c.Hold, 60, 120)
	if !(c.FlushWalk > 0) {
		c.FlushWalk = 6
	}
	if !(c.FlushCrouch > 0) {
		c.FlushCrouch = 2.5
	}
	if !(c.FlushStill > 0) {
		c.FlushStill = 1.8
	}
	for _, ex := range s.circuits {
		if ex != nil && ex.def.Key == c.Key {
			ex.release = false
			return ex.id
		}
	}

	seed := hash2(s.seed^0x43495243554954, c.Key)
	id := idFrom(seed)
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
	var home core.Vec3
	for _, pc := range c.Posts {
		home = home.Add(pc.Pos)
	}
	home = home.Scale(1 / float32(len(c.Posts)))

	ci := -1
	for i, ex := range s.circuits {
		if ex == nil {
			ci = i
			break
		}
	}
	st := &circuit{def: c, id: id, slot: idx}
	if ci < 0 {
		s.circuits = append(s.circuits, st)
		ci = len(s.circuits) - 1
	} else {
		s.circuits[ci] = st
	}

	b := &s.birds[idx]
	*b = bird{
		alive: true, id: id, sp: int16(c.Species), res: -1, home: home, seed: seed,
		cur: noPerch, dest: noPerch, gnext: -1, gprev: -1, circ: uint16(ci + 1), sdir: 1,
	}
	for k, pc := range c.Posts {
		b.mem[memGen+k] = pc
		b.memOK |= 1 << uint(memGen+k)
	}
	b.mem[memSong], b.mem[memRoost] = c.Posts[0], c.Posts[0]
	b.memOK |= 1<<memSong | 1<<memRoost
	s.byID[id] = idx
	s.count++
	was := s.silent
	s.silent = true
	s.placeCircuit(b)
	s.silent = was
	s.gridInsert(b, idx)
	return id
}

// ReleaseCircuit ends a resident's special status: it leaves the world as soon as
// the observer is out of sight of it (circuitRelease metres), never in front of them.
func (s *Sim) ReleaseCircuit(id uint32) {
	if c := s.circuitByID(id); c != nil {
		c.release = true
	}
}

// RemoveCircuit takes a circuit resident out of the world at once.
func (s *Sim) RemoveCircuit(id uint32) {
	c := s.circuitByID(id)
	if c == nil {
		return
	}
	if i, ok := s.byID[id]; ok {
		s.despawn(i)
	}
	for k, ex := range s.circuits {
		if ex == c {
			s.circuits[k] = nil
		}
	}
}

// CircuitOf reports on a circuit resident.
func (s *Sim) CircuitOf(id uint32) (CircuitInfo, bool) {
	c := s.circuitByID(id)
	if c == nil {
		return CircuitInfo{}, false
	}
	info := CircuitInfo{ID: c.id, Post: c.post, Posts: append([]core.Perch(nil), c.def.Posts...),
		Songs: c.songs, Pushes: c.pushes, Moves: c.moves, LastSong: c.lastSong, Released: c.release}
	if i, ok := s.byID[id]; ok {
		info.Moving = s.birds[i].moving
	}
	return info, true
}

func (s *Sim) circuitByID(id uint32) *circuit {
	for _, c := range s.circuits {
		if c != nil && c.id == id {
			return c
		}
	}
	return nil
}

// placeCircuit puts a resident on one of its posts (activation, fast-forward):
// which one depends on who it is and the quarter-hour.
func (s *Sim) placeCircuit(b *bird) {
	c := s.circuits[b.circ-1]
	b.moving = false
	b.fear, b.singT, b.quiet, b.away, b.dive, b.callCD = 0, 0, 0, 0, 0, 0
	b.fled = false
	b.flags &^= core.FlagSinging | core.FlagWary | core.FlagHidden
	n := len(c.def.Posts)
	k := int(hash2(b.seed, uint64(int64(s.abs*4))) % uint64(n))
	c.post, c.offT, c.pushed = k, 0, false
	c.hold = s.rnd(c.def.Hold[0], c.def.Hold[1])
	c.songT = s.rnd(0.5, 4)
	s.teleport(b, c.def.Posts[k], int8(memGen+k), thenPerch)
}

// circuitFlush is the distance at which the observer, moving as they are now,
// pushes the resident on.
func (s *Sim) circuitFlush(c *circuit) float32 {
	d := c.def
	var fd float32
	switch {
	case s.oMove <= moveStill:
		fd = d.FlushStill
	case s.oMove <= moveCrouch:
		fd = d.FlushCrouch
	default:
		fd = d.FlushWalk * s.oMove // walk 1, run 1.5, sprint 2.2
	}
	return fd * s.obs.Stealth
}

// stepCircuit advances a circuit resident by dt seconds.
func (s *Sim) stepCircuit(b *bird, idx int32, dt float32) {
	c := s.circuits[b.circ-1]
	p := &s.prof[b.sp]
	if b.singT > 0 {
		if b.singT -= dt; b.singT <= 0 {
			b.singT = 0
			b.flags &^= core.FlagSinging
		}
	}
	if b.callCD > 0 {
		b.callCD -= dt
	}
	b.dive, b.fear, b.quiet = 0, 0, 0
	c.lastSong += dt
	c.songT -= dt // the song clock runs on through its flights: it sings as soon as it lands if due
	c.heat = max32(0, c.heat-dt/circuitCool)

	if c.release && (!s.obs.Present || distXZ2(b.pos, s.obs.Pos) > circuitRelease*circuitRelease) {
		s.RemoveCircuit(c.id)
		return
	}
	if b.moving {
		s.advance(b, p, dt)
		if !b.moving {
			s.circuitLanded(b, c)
		}
		s.gridUpdate(b, idx)
		return
	}

	n := len(c.def.Posts)
	if int(b.cur) < memGen || int(b.cur) >= memGen+n {
		// Off its round (it dived into cover from a raptor): back up soon.
		if c.offT += dt; c.offT >= circuitOffPost {
			s.circuitGo(b, c, s.nearestPost(b, c), false)
		}
		s.gridUpdate(b, idx)
		return
	}
	c.offT = 0

	// Song first: even a bird that is about to be pushed on proclaims its post when
	// a phrase is due.
	if c.songT <= 0 && b.singT <= 0 {
		gap := c.def.SongGap
		if s.phase == core.PhaseNight {
			gap = c.def.NightGap
		}
		c.songT = s.rnd(gap[0], gap[1])
		if !(s.env.Rain > 0.85 && s.env.Wind > 0.75) { // only a storm silences it
			b.yaw = s.rnd(0, 2*math.Pi) // it turns about on its post as it sings
			s.voice(b, p, 0, 1)
			if !s.silent {
				c.songs++
				c.lastSong = 0
			}
		}
	}

	if s.obs.Present {
		d := sqrt32(dist2(b.pos, s.obs.Pos))
		fd := s.circuitFlush(c)
		if d < fd {
			s.circuitPushed(b, c, fd)
			s.gridUpdate(b, idx)
			return
		}
		if d < 2*fd {
			b.flags |= core.FlagWary
		} else {
			b.flags &^= core.FlagWary
		}
	}

	if c.hold -= dt; c.hold <= 0 && b.singT <= 0 {
		k := (c.post + 1) % n
		if n > 1 && (!s.obs.Present || distXZ2(c.def.Posts[k].Pos, s.obs.Pos) > sq(1.3*s.circuitFlush(c))) {
			s.circuitGo(b, c, k, false)
			s.gridUpdate(b, idx)
			return
		}
		c.hold = s.rnd(20, 40) // the next post is crowded: stay a while longer
	}

	s.gridUpdate(b, idx)
}

// circuitPushed: the observer came too close. It flits to the next post of its
// round, or, if that one is too near the observer as well, to the post farthest
// from them.
func (s *Sim) circuitPushed(b *bird, c *circuit, fd float32) {
	n := len(c.def.Posts)
	k := (c.post + 1) % n
	clear2 := sq(fd + 1.5)
	if n > 1 && distXZ2(c.def.Posts[k].Pos, s.obs.Pos) < clear2 {
		best, bestD := -1, float32(-1)
		for i, pc := range c.def.Posts {
			if i == c.post {
				continue
			}
			if d := distXZ2(pc.Pos, s.obs.Pos); d > bestD {
				best, bestD = i, d
			}
		}
		if best >= 0 {
			k = best
		}
	}
	if n == 1 || k == c.post {
		// Nowhere else to go on its round: a hop up and back down on the same post.
		k = c.post
	}
	c.pushes++
	c.heat++
	s.circuitGo(b, c, k, true)
}

// circuitGo flies to post k of the round.
func (s *Sim) circuitGo(b *bird, c *circuit, k int, pushed bool) {
	p := &s.prof[b.sp]
	c.post, c.pushed = k, pushed
	c.moves++
	if b.flags&core.FlagSinging != 0 {
		b.flags &^= core.FlagSinging
		b.singT = 0
	}
	s.fly(b, p, c.def.Posts[k], int8(memGen+k), core.ActFlying, 1, thenPerch)
}

// circuitLanded starts the stint on the post just reached.
func (s *Sim) circuitLanded(b *bird, c *circuit) {
	c.hold = s.rnd(c.def.Hold[0], c.def.Hold[1])
	if c.pushed {
		c.songT = min32(c.songT, s.rnd(4, circuitSongPush)) // a pushed singer soon proclaims its new post
		if p := &s.prof[b.sp]; c.heat >= 2 && p.callAlarm >= 0 && b.singT <= 0 && c.songT > 0 {
			// Chased about: it scolds from the new post (the dry churr), which also
			// tells the chaser where it went.
			s.voice(b, p, p.callAlarm, 1)
			c.lastSong = 0
		}
	} else {
		c.songT = min32(c.songT, s.rnd(1.5, 5))
	}
	c.pushed = false
	b.flags &^= core.FlagHidden
}

// nearestPost is the post of the round closest to the bird, preferring ones away
// from the observer.
func (s *Sim) nearestPost(b *bird, c *circuit) int {
	best, bestD := 0, float32(math.MaxFloat32)
	for i, pc := range c.def.Posts {
		d := distXZ2(pc.Pos, b.pos)
		if s.obs.Present && distXZ2(pc.Pos, s.obs.Pos) < sq(s.circuitFlush(c)+1) {
			d += 1e4
		}
		if d < bestD {
			best, bestD = i, d
		}
	}
	return best
}
