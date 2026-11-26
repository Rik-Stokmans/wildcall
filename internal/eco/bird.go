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
	mNest               // carrying material between a gathering spot and the nest
	mRoost              // asleep
	mAlert              // frozen, watching the observer
	mHide               // tucked into cover until the danger has passed
	mAway               // flushed: flying to, or waiting at, a refuge before returning
	mLeave              // flying out of the world (migration, a rare bird withdrawing)
	modeCount
)

// timed lists the modes whose bout ends when the decision timer runs out. The
// others end on their own terms (a counted series of steps, the fear level, an
// arrival).
var timed = [modeCount]bool{mIdle: true, mGround: true, mGlean: true, mClimb: true, mSwim: true, mSoar: true, mLure: true, mBathe: true, mRoost: true}

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
	thenNestPick              // pick up nest material
	thenNestBuild             // add it to the nest
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
	memRoost = 1  // where it sleeps (and nests)
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
	cur    int8 // remembered perch the bird is on, or noPerch
	dest   int8 // remembered perch the current move ends on, or noPerch
	n      int8 // steps left in the current bout (trips, hover stations, flight legs)
	stage  uint8

	destKind core.PerchKind
	sp       int16
	res      int16 // index into cell.roster
	memOK    uint16
	lure     uint32 // id of the lure it is visiting (0 = none)
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
	gy     float32 // ground height under the bout's anchor

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
	p := &s.prof[b.sp]

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
			// The countdown only runs once the bird has calmed down at its refuge.
			if b.fear < fearAlert {
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
		if !b.moving && p.flock {
			s.keepUp(b, p, dt)
		}
	}

	if b.callCD > 0 {
		b.callCD -= dt
	} else if b.quiet <= 0 && b.fear < fearWary {
		if f := s.voiceFactor(b, p); f > 0 && s.rng.Float32() < s.rate[b.sp]*f*dt {
			s.sing(b, p)
		}
	}

	s.gridUpdate(b, idx)
}
