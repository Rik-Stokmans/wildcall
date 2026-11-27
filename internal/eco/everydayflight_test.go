package eco

import (
	"os"
	"strconv"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// Everyday flight a player notices: how many flights pass within 60 m of a player
// standing still in the forest, on the meadow and at the creek on a spring morning,
// and how long each is in the open (in the air, with a clear line from the eye).

type flightCount struct {
	flights  int     // distinct flights that came within 60 m
	open     float32 // seconds of flight in the open within 60 m (all flights)
	longOpen int     // flights seen in the open for at least 1.5 s
	minutes  float32
	kinds    map[core.BirdAct]int
}

func (f flightCount) perMin() float32 { return float32(f.flights) / f.minutes }

// spotNear finds a dry spot of habitat h within r metres of c (nearest first).
func spotNear(w *world.World, c core.Vec3, h core.Habitat, r float32) (core.Vec3, bool) {
	for d := float32(0); d <= r; d += 8 {
		for a := 0; a < 32; a++ {
			ang := float32(a) / 32 * 6.2832
			x, z := c.X+d*sin32(ang), c.Z-d*cos32(ang)
			if w.HabitatAt(x, z) == h && w.HeightAt(x, z) > 0.3 {
				// Prefer the middle of the patch.
				ok := true
				for _, o := range [...][2]float32{{12, 0}, {-12, 0}, {0, 12}, {0, -12}} {
					if w.HabitatAt(x+o[0], z+o[1]) != h {
						ok = false
					}
				}
				if ok || h == core.HabRiver {
					return core.V(x, w.HeightAt(x, z), z), true
				}
			}
		}
	}
	return core.Vec3{}, false
}

func countFlights(t *testing.T, text string, at core.Vec3, hour float32, minutes float32) flightCount {
	t.Helper()
	s, w, _ := realSim(t, text)
	env := envAt(1, hour)
	obs := stillObserver(w, at)
	s.Step(0.1, env, obs)
	for i := 0; i < 600; i++ { // a minute to settle in
		obs.Still += 0.1
		s.Step(0.1, env, obs)
		env = advanceEnv(env, 0.1/60)
	}
	eye := obs.Pos
	type cur struct {
		start float32 // the move's start time key (mt reset marks a new flight)
		open  float32
	}
	live := map[uint32]*cur{}
	fc := flightCount{minutes: minutes, kinds: map[core.BirdAct]int{}}
	steps := int(minutes * 600)
	for i := 0; i < steps; i++ {
		obs.Still += 0.1
		s.Step(0.1, env, obs)
		env = advanceEnv(env, 0.1/60)
		for j := range s.birds {
			b := &s.birds[j]
			if !b.alive {
				continue
			}
			c := live[b.id]
			// A flight is a journey of 10 m or more, or circling / hovering: the hops
			// within a crown or along the ground do not count.
			air := b.moving && b.mv == mvFly && b.to.DistXZ(b.from) >= 10 || b.mode == mSoar || b.mode == mHover
			if !air || b.pos.DistXZ(eye) > 60 {
				if c != nil && !air {
					if c.open >= 1.5 {
						fc.longOpen++
					}
					delete(live, b.id)
				}
				continue
			}
			if c == nil || (b.moving && b.mt < c.start) {
				if c != nil && c.open >= 1.5 {
					fc.longOpen++
				}
				c = &cur{}
				live[b.id] = c
				fc.flights++
				fc.kinds[b.act]++
			}
			if b.moving {
				c.start = b.mt
			}
			if s.t.Occlusion(eye, b.pos) < 0.5 {
				c.open += 0.1
				fc.open += 0.1
			}
		}
	}
	for _, c := range live {
		if c.open >= 1.5 {
			fc.longOpen++
		}
	}
	return fc
}

// TestEverydayFlight reports flights per minute (and asserts a floor) at three
// places in the home valley on a spring morning.
func TestEverydayFlight(t *testing.T) {
	if testing.Short() {
		t.Skip("real world")
	}
	w, _ := realWorld("followflight")
	cabin := cabinPos(t, w)
	mins := float32(3)
	if v, err := strconv.ParseFloat(os.Getenv("WC_FLIGHT_MIN"), 32); err == nil && v > 0 {
		mins = float32(v)
	}
	for _, tc := range []struct {
		name string
		hab  core.Habitat
		min  float32 // flights per minute within 60 m, at least
	}{
		{"forest", core.HabWoodland, 2},
		{"meadow", core.HabMeadow, 1},
		{"creek", core.HabRiver, 1},
	} {
		at, ok := spotNear(w, cabin, tc.hab, 600)
		if !ok {
			t.Logf("%s: no spot", tc.name)
			continue
		}
		fc := countFlights(t, "followflight", at, 8, mins)
		t.Logf("%-6s at %.0f,%.0f: %.1f flights/min within 60 m, %.1f s in the open per minute, %d flights seen >= 1.5 s in the open (%.1f/min); acts %v",
			tc.name, at.X, at.Z, fc.perMin(), fc.open/fc.minutes, fc.longOpen, float32(fc.longOpen)/fc.minutes, fc.kinds)
		if fc.perMin() < tc.min {
			t.Errorf("%s: only %.1f flights a minute within 60 m, want >= %.1f", tc.name, fc.perMin(), tc.min)
		}
	}
}
