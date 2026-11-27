package eco

import (
	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// mode is what a bird is in the middle of: a finer-grained plan than the public
// core.BirdAct, which only says what it looks like right now.
type mode uint8

const (
	mIdle   mode = iota // perched / resting / preening / displaying: decides afresh when its timer runs out
	mGround             // foraging on the ground or in the shallows, step by step
	mGlean              // working through foliage, branch to branch
	mClimb              // creeping up a trunk
	mSwim               // on the water, paddling and feeding
	mHover              // hovering over a target, about to stoop or move on
	mHawk               // feeding on the wing, leg after leg
	mSoar               // circling
	mLure               // feeding at a lure
	mBathe              // splashing at the water's edge
	mNest               // at or busy with its nest: building, sitting, feeding chicks (nest.go)
	mRoost              // asleep
	mAlert              // frozen, watching the observer
	mHide               // tucked into cover until the danger has passed
	mAway               // flushed: flying to, or waiting at, a refuge before returning
	mLeave              // flying out of the world (migration, a rare bird withdrawing)
	mPass               // a raptor sweeping low past the observer (predator.go)
	modeCount
)

// timed lists the modes whose bout ends when the decision timer runs out. The
// others end on their own terms (a counted series of steps, the fear level, an
// arrival).
var timed = [modeCount]bool{mIdle: true, mGround: true, mGlean: true, mClimb: true, mSwim: true, mSoar: true, mLure: true, mBathe: true, mRoost: true, mNest: true}

// then says what a bird does when the move it is making completes.
type then uint8

const (
	thenPerch     then = iota // rest where it lands
	thenStep                  // a step within the current bout: carry on with it
	thenSong                  // settle on the song post
	thenPreen                 // preen where it lands
	thenForage                // start foraging on the ground / in the shallows
	thenGlean                 // start working through the foliage here
	thenClimb                 // start creeping up this trunk
	thenSwim                  // start paddling and feeding on the water
	thenHover                 // hover here
	thenEat                   // the stoop or plunge ended: eat the catch
	thenEatPerch              // eat the catch on the perch it carried it to
	thenHawk                  // one leg of aerial feeding done
	thenSoar                  // start circling
	thenLure                  // feed at the lure
	thenBathe                 // bathe
	thenNestPick              // pick up nest material, or catch food for the chicks
	thenNestBuild             // add it to the nest, or feed the chicks
	thenNestSit               // settle on the nest: incubating or brooding
	thenNestVisit             // a short visit to the nest (feeding the sitting mate)
	thenSocial                // display / chatter
	thenRoost                 // go to sleep
	thenHide                  // tuck into cover
	thenRefuge                // wait out the disturbance
	thenGone                  // it has flown out of the world
)

// moveKind is how a bird gets from one place to the next.
type moveKind uint8

const (
	mvFly    moveKind = iota // flight along a terrain-clearing arc
	mvGround                 // a hop or a few steps; height follows the ground
	mvSwim                   // paddling on the water plane
	mvClimb                  // creeping along a trunk
	mvDive                   // a stoop or plunge: accelerating straight line down
)

// Perch memory layout: every bird remembers a handful of places in its territory.
const (
	memSong  = 0  // the song post
	memRoost = 1  // where it sleeps
	memBath  = 2  // a spot at the water's edge, if the territory has one
	memFeed  = 3  // memFeed..memFeed+maxFeed-1: feeding spots
	maxFeed  = 4  //
	memGen   = 7  // memGen..memGen+maxGen-1: everyday perches
	maxGen   = 6  //
	maxMem   = 13 //
	noPerch  = -1 // "not on a remembered perch"
)

type bird struct {
	alive  bool
	moving bool
	flat   bool // the current flight uses the flat-topped (cruise) height profile
	act    core.BirdAct
	base   core.BirdAct // the act of the current bout between its sub-steps
	flags  uint8
	mode   mode
	then   then
	mv     moveKind
	style  flightKind
	cur    int8  // remembered perch the bird is on, or noPerch
	dest   int8  // remembered perch the current move ends on, or noPerch
	n      int8  // steps left in the current bout (trips, hover stations, flight legs)
	stage  uint8 // nest bouts: what the trips are for (nsGather / nsFood / nsSit / nsVisit)
	singer bool  // holding a breeding territory (refreshed at every bout end): sings more
	held   bool  // this rest bout has already been stretched for a song (voice.go)

	destKind core.PerchKind
	sp       int16
	res      int16 // index into cell.roster
	memOK    uint16
	lure     uint32 // id of the lure it is visiting (0 = none)
	mixed    uint32 // id of the mixed feeding flock it travels with (0 = none)
	passSeq  uint32 // the last predator pass it reacted to
	id       uint32

	pos   core.Vec3
	yaw   float32
	speed float32
	cover float32
	fear  float32

	home core.Vec3
	seed uint64
	cell *cell

	timer  float32 // seconds until the current bout ends
	sub    float32 // seconds until the next step within the bout
	singT  float32 // seconds of the current vocal bout left
	callCD float32 // seconds before it may start another bout
	quiet  float32 // seconds of silence after a disturbance
	away   float32 // seconds before a flushed bird heads home
	lureCD float32
	habit  float32 // 0..1 habituation to the observer
	jitter float32 // personal offset (hours) on when it wakes and roosts
	dive   float32 // seconds until it dives for cover from a passing raptor (0 = not pending)
	fled   bool    // flushed by the observer and not yet back home (Settled)
	gy     float32 // ground height under the bout's anchor
	since  float32 // seconds since its last relocation (a flight of more than lingerHop metres; linger.go)
	circ   uint16  // 1 + index into Sim.circuits for a circuit resident (resident.go); 0 = an ordinary bird

	ff followState // escapes, refuges and flush streaks (followflight.go)

	// The move in progress: from -> to along an arc, with a per-style wobble.
	from, to     core.Vec3
	lift         float32
	mt, mdur     float32
	wob, wfreq   float32
	perpX, perpZ float32
	destCover    float32

	// The centre of the current bout: a foraging patch, the perch a creeper started
	// from, a soaring circle (x, altitude, z), the point under a hover.
	anchor core.Vec3
	sr     float32 // soaring radius
	sph    float32 // soaring phase angle
	sdir   float32 // +1 / -1 circling direction

	mem [maxMem]core.Perch

	gnext, gprev int32 // spatial grid bucket links
	gslot        int32
}

func (b *bird) state() core.BirdState {
	return core.BirdState{
		ID: b.id, Species: int(b.sp), Act: b.act, Flags: b.flags,
		Pos: b.pos, Yaw: b.yaw, Speed: b.speed, Cover: b.cover, Fear: b.fear,
	}
}

func (b *bird) has(i int) bool { return i >= 0 && i < maxMem && b.memOK&(1<<uint(i)) != 0 }

// airborne reports whether the bird is in the air right now (flying, circling or
// hovering), which is when alertness on a perch does not apply.
func (b *bird) airborne() bool {
	if b.moving {
		return b.mv == mvFly || b.mv == mvDive
	}
	return b.mode == mSoar || b.mode == mHover
}

// leader returns the flock or pair leader this bird follows, or nil if it has none,
// is the leader itself, or the leader is not in the world.
func (s *Sim) leader(b *bird) *bird {
	if b.res < 0 || b.cell == nil || int(b.res) >= len(b.cell.roster) {
		return nil
	}
	lr := b.cell.roster[b.res].lead
	if lr < 0 || lr == b.res || int(lr) >= len(b.cell.roster) {
		return nil
	}
	li := b.cell.roster[lr].bird
	if li < 0 {
		return nil
	}
	l := &s.birds[li]
	if !l.alive {
		return nil
	}
	return l
}

// stepBird advances one bird by dt seconds.
func (s *Sim) stepBird(b *bird, idx int32, dt float32) {
	if b.circ != 0 {
		s.stepCircuit(b, idx, dt) // a circuit resident lives by its own round (resident.go)
		return
	}
	p := &s.prof[b.sp]
	b.since += dt

	if b.singT > 0 {
		if b.singT -= dt; b.singT <= 0 {
			b.singT = 0
			b.flags &^= core.FlagSinging
		}
	}
	if b.quiet > 0 {
		b.quiet -= dt
	}
	if b.lureCD > 0 {
		b.lureCD -= dt
	}
	if b.mode == mPass {
		// The pass itself is flown by predTick; the raptor may call as it goes.
		s.voiceTick(b, p, dt)
		s.gridUpdate(b, idx)
		return
	}
	if b.dive > 0 {
		if b.dive -= dt; b.dive <= 0 {
			b.dive = 0
			if b.mode == mAlert || b.moving && b.mv == mvFly && b.mode != mAway && b.mode != mLeave {
				s.predHide(b, p)
			}
		}
	}

	if b.mode != mLeave {
		s.disturb(b, p, dt)
	}

	// The bout clock runs through the small moves inside a bout too; otherwise a bird
	// whose steps follow each other back to back would never finish its bout.
	if timed[b.mode] {
		b.timer -= dt
	}
	if b.moving {
		s.advance(b, p, dt)
		if !b.alive {
			return // it flew out of the world
		}
	} else {
		switch b.mode {
		case mSoar:
			s.soarTick(b, dt)
		case mHover:
			s.hoverTick(b, dt)
		case mAway:
			s.refugeTick(b, p, dt) // looking back, the landing call, slipping into cover
			// The countdown only runs once the bird has calmed down at its refuge.
			if !b.moving && b.fear < fearAlert && !s.nestBlocked(b) {
				if b.away -= dt; b.away <= 0 {
					s.comeHome(b, p)
				}
			}
		case mAlert, mHide:
			s.calmCheck(b, p, dt)
		}
		if !b.moving && b.sub > 0 {
			if b.sub -= dt; b.sub <= 0 {
				s.subStep(b, p)
			}
		}
		if !b.moving && timed[b.mode] && b.timer <= 0 {
			s.boutEnd(b, p)
		}
		if !b.moving {
			if b.mixed != 0 {
				s.mixedKeepUp(b, p, dt)
			} else if p.flock {
				s.keepUp(b, p, dt)
			}
		}
	}

	s.voiceTick(b, p, dt)
	s.gridUpdate(b, idx)
}

// voiceTick may start a vocal bout.
func (s *Sim) voiceTick(b *bird, p *profile, dt float32) {
	if b.callCD > 0 {
		b.callCD -= dt
	} else if b.quiet <= 0 && b.fear < fearWary {
		if f := s.voiceFactor(b, p); f > 0 && s.rng.Float32() < s.rate[b.sp]*f*dt {
			// Song posts are exposed: a bird about to sing deep in the leaves first
			// hops out to an open perch close by and sings from there (thenSong).
			if (b.mode == mIdle || b.mode == mGlean) && s.showOff(b, p, singShow, thenSong) {
				return
			}
			s.sing(b, p)
		}
	}
}
