package eco

import (
	"math"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// No popping: a bird is never created or removed within 150 m of the player in front
// of him, or within 60 m at all. Arrivals and departures near the player happen by
// flight (from and to well beyond that range). Scene cuts are exempt: a new or
// loaded game and resting (FastForward) happen behind the loading screen or the
// fade, and SpawnNear is a debug command.

const (
	popNear   = 60
	popFar    = 150
	popHalfFO = 50 * math.Pi / 180 // half the horizontal view, with a margin
)

type popWatch struct {
	t      *testing.T
	s      *Sim
	prev   map[uint32]core.Vec3
	pops   int
	checks int
	what   string
}

func newPopWatch(t *testing.T, s *Sim) *popWatch {
	return &popWatch{t: t, s: s, prev: map[uint32]core.Vec3{}}
}

// seen reports whether a position counts as in plain view of an observer at eye
// looking along yaw.
func popSeen(eye core.Vec3, yaw float32, pos core.Vec3) bool {
	d := pos.DistXZ(eye)
	if d <= popNear {
		return true
	}
	if d > popFar {
		return false
	}
	a := heading(pos.X-eye.X, pos.Z-eye.Z) - yaw
	for a > math.Pi {
		a -= 2 * math.Pi
	}
	for a < -math.Pi {
		a += 2 * math.Pi
	}
	return abs32(a) <= popHalfFO
}

// step checks what changed since the last call: the observer at eye looking along
// yaw.
func (w *popWatch) step(eye core.Vec3, yaw float32) {
	now := make(map[uint32]core.Vec3, len(w.prev))
	for i := range w.s.birds {
		b := &w.s.birds[i]
		if b.alive {
			now[b.id] = b.pos
		}
	}
	if w.checks > 0 {
		for id, p := range now {
			if _, ok := w.prev[id]; !ok && popSeen(eye, yaw, p) {
				w.pops++
				if w.pops <= 5 {
					w.t.Errorf("%s: bird %d (%s) appeared %.0f m from the player", w.what, id, w.s.species[w.s.birds[w.s.byID[id]].sp].ID, p.DistXZ(eye))
				}
			}
		}
		for id, p := range w.prev {
			if _, ok := now[id]; !ok && popSeen(eye, yaw, p) {
				w.pops++
				if w.pops <= 5 {
					w.t.Errorf("%s: bird %d vanished %.0f m from the player", w.what, id, p.DistXZ(eye))
				}
			}
		}
	}
	w.prev = now
	w.checks++
}

// TestNoPopping walks, waits and watches through the ways birds enter and leave the
// world: cells waking and retiring on a long walk, a whole day and night going by,
// a season change with its migrants, an autumn with its vagrants, and a lure.
func TestNoPopping(t *testing.T) {
	if testing.Short() {
		t.Skip("real world")
	}
	_, w, _ := realSim(t, "nopop")
	cabin := cabinPos(t, w)

	t.Run("walk", func(t *testing.T) {
		s, _, _ := realSim(t, "nopop")
		pw := newPopWatch(t, s)
		pw.what = "walk"
		env := envAt(1, 9)
		pos := cabin
		yaw := float32(0)
		for i := 0; i < 9000; i++ { // 15 minutes, out and back over 2.5 km
			leg := float32(1)
			if i >= 4500 {
				leg = -1
			}
			a := float32(i) / 9000 * 2.2
			pos.X += 0.28 * leg * cos32(a)
			pos.Z -= 0.28 * leg * sin32(a)
			pos.Y = max32(w.HeightAt(pos.X, pos.Z), 0)
			o := observerAt(pos)
			o.Move, o.Speed = "walk", 2.8
			yaw = heading(cos32(a)*leg, -sin32(a)*leg) + 0.6*sin32(float32(i)*0.01) // looking about
			s.Step(0.1, env, o)
			pw.step(o.Pos, yaw)
			env = advanceEnv(env, 0.1/60)
		}
		t.Logf("walk: %d steps checked, %d pops", pw.checks, pw.pops)
	})

	day := func(name string, startDay int, hour, hours float32, setup func(s *Sim, env core.Env)) {
		t.Run(name, func(t *testing.T) {
			s, _, _ := realSim(t, "nopop")
			pw := newPopWatch(t, s)
			pw.what = name
			env := envAt(startDay, hour)
			o := stillObserver(w, cabin)
			s.Step(0.1, env, o)
			if setup != nil {
				setup(s, env)
			}
			steps := int(hours * 60 * 10 / 20) // the clock runs 20x: one game hour in 3 real seconds of steps
			for i := 0; i < steps; i++ {
				o.Still += 0.1
				s.Step(0.1, env, o)
				pw.step(o.Pos, float32(i)*0.002) // slowly turning on the spot
				env = advanceEnv(env, 20*0.1/60)
			}
			t.Logf("%s: %d steps checked, %d pops", name, pw.checks, pw.pops)
		})
	}
	day("day and night", 1, 4, 24, nil)
	day("season change", 4, 18, 20, nil) // spring -> summer at midnight of day 5
	day("autumn vagrants", 9, 6, 30, nil)
	day("lure", 2, 7, 3, func(s *Sim, env core.Env) {
		s.AddLure(core.Lure{Pos: core.V(cabin.X+8, cabin.Y, cabin.Z), Radius: 40, TTL: 600, Kind: "seed"})
	})
}
