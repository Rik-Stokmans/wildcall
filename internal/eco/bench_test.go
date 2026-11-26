package eco

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/core/coretest"
)

// benchSim builds a population of about 600 active birds: the fixture species at
// three times their density.
func benchSim(b *testing.B) (*Sim, core.Env, core.Observer) {
	species := coretest.Species()
	for i := range species {
		species[i].Behavior.Density *= 3.3
	}
	s := New(coretest.NewFlat(), species, 1)
	env := envAt(1, 6)
	obs := observerAt(woodPos)
	s.Step(0.1, env, obs)
	for i := 0; i < 600; i++ { // let everyone get going
		s.Step(0.1, env, obs)
	}
	if n := s.Count(); n < 550 || n > 700 {
		b.Fatalf("benchmark population %d, want ~600", n)
	}
	return s, env, obs
}

func BenchmarkStep(b *testing.B) {
	s, env, obs := benchSim(b)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		// A slow stroll so the observer matters but no new cells are needed.
		dir := float32(1)
		if (i/2000)%2 == 1 {
			dir = -1
		}
		obs.Pos.X += 0.1 * dir
		obs.Vel = core.V(dir, 0, 0)
		obs.Speed = 1
		s.Step(0.1, env, obs)
	}
	b.ReportMetric(float64(s.Count()), "birds")
}

func BenchmarkNear(b *testing.B) {
	s, _, obs := benchSim(b)
	var buf []core.BirdState
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		buf = s.Near(obs.Pos, 260, buf[:0])
	}
}
