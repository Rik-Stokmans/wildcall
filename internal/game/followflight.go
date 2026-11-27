package game

import (
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/narrator"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Following a flushed bird (eco followflight.go). The client is told the moment a
// bird the player flushed takes off and the moment it lands (proto.FlightMsg), so it
// can play the wing-clatter and let the eye follow the arc. The session watches
// whether the player keeps the bird in sight on the way: if they do, all the way to
// its landing, the narrator says so ("There it goes. And down, just there.")
// instead of the usual "too hasty" remark - following it is the recovery, and it
// is acknowledged, never rewarded with XP.

const (
	flightSendR   = snapshotR // FlightMsg only for flushes the player could see
	flushNarrateR = 80        // flushes this close are the player's doing (Totals.Flushed)
	followMax     = 4         // flushes followed at once
	followTTL     = 30        // seconds before an unfinished follow is dropped
	followShare   = 0.6       // share of the flight in sight that counts as followed
)

// followed is one flushed bird the session is watching the player follow.
type followed struct {
	bird    uint32
	sp      int
	t0      float64
	seen    int  // samples with the bird in sight
	samples int  // samples taken during the flight
	near    bool // the player flushed it (narration is about it)
	told    bool // the narrator has had its say
	first   bool // in sight when it took off
}

type followWatch struct {
	list    []followed
	watched int // flushes the player followed to the landing (tests, dev stats)
}

// onFlush handles an EvFlush: tells the client, counts it, and starts following.
// Called from onEvent with a pose.
func (s *Session) onFlush(ctx *field.Context, ev core.EcoEvent, eye core.Vec3) {
	d := ev.Pos.Dist(eye)
	if d <= flightSendR {
		s.send(proto.SFlight, proto.FlightMsg{Bird: ev.Bird, Phase: "flush", From: vec3(ev.From), To: vec3(ev.To), Dur: ev.Dur, Flock: ev.Repeats})
	}
	near := d < flushNarrateR
	if near {
		s.p.Totals.Flushed++
		s.minor = true
	}
	if !near && d > flightSendR {
		return
	}
	f := followed{bird: ev.Bird, sp: ev.Species, t0: s.now, near: near, first: field.InSight(ctx, s.pose, ev.Pos)}
	if near && !f.first {
		// Flushed behind the player's back: they hear it go, there is nothing to follow.
		f.told = true
		s.narrate(narrator.Event{Kind: narrator.Flushed, Known: s.knownSp(s.spAt(ev.Species))})
	}
	w := &s.follow
	for i := range w.list {
		if w.list[i].bird == ev.Bird {
			w.list[i] = f // flushed again from its refuge
			return
		}
	}
	if len(w.list) >= followMax {
		s.followLost(&w.list[0])
		w.list = w.list[1:]
	}
	w.list = append(w.list, f)
}

// onLand handles an EvLand: tells the client and, if the player followed the bird
// all the way, gives the narrator the moment.
func (s *Session) onLand(ctx *field.Context, ev core.EcoEvent, eye core.Vec3) {
	if ev.Pos.Dist(eye) <= flightSendR {
		s.send(proto.SFlight, proto.FlightMsg{Bird: ev.Bird, Phase: "land", From: vec3(ev.From), To: vec3(ev.To)})
	}
	w := &s.follow
	for i := range w.list {
		f := &w.list[i]
		if f.bird != ev.Bird {
			continue
		}
		f.samples++
		landSeen := field.InSight(ctx, s.pose, ev.Pos)
		if landSeen {
			f.seen++
		}
		if f.near && !f.told {
			f.told = true
			if landSeen && f.first && float32(f.seen) >= followShare*float32(f.samples) {
				w.watched++
				s.narrate(narrator.Event{Kind: narrator.FlushWatched, Known: s.knownSp(s.spAt(f.sp))})
			} else {
				s.narrate(narrator.Event{Kind: narrator.Flushed, Known: s.knownSp(s.spAt(f.sp))})
			}
		}
		w.list = append(w.list[:i], w.list[i+1:]...)
		return
	}
}

// followTick samples, every tick, whether the player still has each flushed bird in
// sight.
func (s *Session) followTick(ctx *field.Context) {
	w := &s.follow
	if len(w.list) == 0 || !s.havePose {
		return
	}
	n := 0
	for i := range w.list {
		f := w.list[i]
		b, ok := s.sim.Get(f.bird)
		if !ok || s.now-f.t0 > followTTL {
			s.followLost(&f)
			continue
		}
		f.samples++
		if field.InSight(ctx, s.pose, b.Pos) {
			f.seen++
		}
		w.list[n] = f
		n++
	}
	w.list = w.list[:n]
}

// followLost: a follow ended without a landing seen (the bird left the world, or it
// took too long). The flush still gets its remark.
func (s *Session) followLost(f *followed) {
	if f.near && !f.told {
		f.told = true
		s.narrate(narrator.Event{Kind: narrator.Flushed, Known: s.knownSp(s.spAt(f.sp))})
	}
}

func vec3(v core.Vec3) [3]float32 { return [3]float32{v.X, v.Y, v.Z} }
