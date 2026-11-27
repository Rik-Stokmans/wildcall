package field

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Following a flushed bird with the glasses keeps it under observation all the way,
// adds what only flight shows (its flight style), and hands over to the landed bird
// without a break. (With the naked eye a small bird 20 m off is beyond study range:
// the session follows it with InSight instead.)
func TestFollowFlyingBird(t *testing.T) {
	for _, tc := range []struct {
		name string
		bino float32
	}{{"binoculars 6x", 6}, {"binoculars 8x", 8}} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := newCtx()
			var w Watch
			from := north(16, 0)
			to := core.V(origin.X+22, origin.Y+3, origin.Z-38)
			const id = 77
			b := birdAt(id, spChaffinch, from, core.ActPerched, 0.1)
			step := func(dt float32) WatchResult {
				p := lookAt(standing(), b.Pos)
				p = lookAt(withBinoculars(p, tc.bino), b.Pos)
				return w.Tick(c, dt, p, []core.BirdState{b})
			}
			// Watch it perched for a moment, then it is flushed.
			for i := 0; i < 8; i++ {
				step(0.25)
			}
			if w.Target() != id {
				t.Fatalf("bird not under observation before the flush")
			}
			dur := float32(3.2)
			lost := 0
			var last WatchResult
			for tt := float32(0.25); tt <= dur; tt += 0.25 {
				u := tt / dur
				b.Act = core.ActFleeing
				b.Pos = core.V(from.X+(to.X-from.X)*u, from.Y+(to.Y-from.Y)*u+6*4*u*(1-u), from.Z+(to.Z-from.Z)*u)
				b.Speed = 9
				last = step(0.25)
				if last.Sighting.Bird != id {
					lost++
				}
			}
			if lost > 0 {
				t.Errorf("sighting dropped for %d of the flight's ticks", lost)
			}
			if _, ok := last.Sighting.Evidence["flight"]; !ok {
				t.Errorf("following the flight revealed no flight evidence: %v", last.Sighting.Evidence)
			}
			// Landed: the same bird, still under observation.
			b.Pos, b.Act, b.Speed = to, core.ActAlert, 0
			for i := 0; i < 4; i++ {
				if r := step(0.25); r.Sighting.Bird != id {
					t.Fatalf("sighting did not hand over to the landed bird")
				}
			}
		})
	}
}

func TestInSight(t *testing.T) {
	c, _ := newCtx()
	p := lookAt(standing(), north(30, 4))
	if !InSight(c, p, north(30, 4)) {
		t.Errorf("a bird straight ahead is not in sight")
	}
	if InSight(c, p, core.V(origin.X, origin.Y, origin.Z+30)) {
		t.Errorf("a bird behind the player is in sight")
	}
}
