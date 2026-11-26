package eco

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/core/coretest"
)

// A skulking wren approached at a walk ducks into cover rather than flying off.
func TestSkulkerHidesInsteadOfFleeing(t *testing.T) {
	hid, fled := 0, 0
	for seed := int64(1); seed <= 6; seed++ {
		s, tr := newTestSim(seed, nil)
		env := envAt(1, 10)
		obs := observerAt(core.V(woodPos.X, 5, woodPos.Z-300))
		s.Step(0.1, env, obs)
		id := s.SpawnNear(spWren, woodPos)
		p0 := s.find(id).pos
		obs.Pos = core.V(p0.X-30, 5+core.EyeHeight, p0.Z)
		done := false
		for i := 0; i < 600 && !done; i++ {
			b := s.find(id)
			d := b.pos.Sub(obs.Pos)
			d.Y = 0
			if d.Len() > 3 {
				obs.Vel = d.Norm().Scale(2.2)
				obs.Speed = 2.2
				obs.Pos = obs.Pos.Add(obs.Vel.Scale(0.1))
				obs.Pos.Y = tr.HeightAt(obs.Pos.X, obs.Pos.Z) + core.EyeHeight
			}
			for _, e := range s.Step(0.1, env, obs) {
				if e.Kind == core.EvFlush && e.Bird == id {
					fled++
					done = true
				}
			}
			if b := s.find(id); b.flags&core.FlagHidden != 0 && b.act == core.ActHiding {
				hid++
				done = true
			}
		}
	}
	if hid == 0 || hid < fled {
		t.Fatalf("wrens hid %d times and fled %d times", hid, fled)
	}
}

// A rare species only shows itself under its conditions: here, at dawn.
func TestRareSpeciesKeepsToItsConditions(t *testing.T) {
	species := coretest.Species()
	rare := species[spWren]
	rare.ID, rare.Name = "test_rarity", "Test Rarity"
	rare.Rarity = core.Rare
	rare.Behavior.Activity = [6]float32{1, 0.3, 0.1, 0.2, 0.3, 0}
	rare.Behavior.Density = 1 // as common as the wren on paper; rarity makes it scarce
	rare.Index = len(species)
	species = append(species, rare)
	idx := rare.Index

	s, _ := newTestSim(3, species)
	obs := observerAt(woodPos)
	env := envAt(1, 11)
	for i := 0; i < 400; i++ {
		s.Step(0.1, env, obs)
	}
	if n := s.Stats().BySpecies[idx]; n != 0 {
		t.Fatalf("%d dawn rarities about at 11:00", n)
	}
	env = envAt(2, 4.6)
	arrived := 0
	for i := 0; i < 1200; i++ {
		for _, e := range s.Step(0.1, env, obs) {
			if e.Kind == core.EvArrive && e.Species == idx {
				arrived++
			}
		}
		env = advanceEnv(env, 0.1/60)
	}
	n := s.Stats().BySpecies[idx]
	if n == 0 || arrived == 0 {
		t.Fatalf("no rarities at dawn (present %d, arrivals %d)", n, arrived)
	}
	common := s.Stats().BySpecies[spWren]
	if n*3 >= common {
		t.Fatalf("a rare species (%d) as numerous as a common one (%d) despite its density", n, common)
	}
	// Rain sends them back into hiding.
	env.Rain, env.Weather = 0.8, core.WeatherRain
	for i := 0; i < 1500; i++ {
		s.Step(0.1, env, obs)
	}
	if n := s.Stats().BySpecies[idx]; n != 0 {
		t.Fatalf("%d rarities out in the rain", n)
	}
}

// Rain and strong wind suppress song.
func TestWeatherSuppressesCalls(t *testing.T) {
	count := func(e core.Env) int {
		s, _ := newTestSim(4, nil)
		obs := observerAt(woodPos)
		n := 0
		for i := 0; i < 3000; i++ {
			for _, ev := range s.Step(0.1, e, obs) {
				if ev.Kind == core.EvCall {
					n++
				}
			}
		}
		return n
	}
	fair := envAt(1, 9)
	wet := fair
	wet.Weather, wet.Rain, wet.Cloud = core.WeatherRain, 0.9, 1
	windy := fair
	windy.Weather, windy.Wind = core.WeatherWind, 0.95
	f, r, w := count(fair), count(wet), count(windy)
	if r*2 > f || w*2 > f {
		t.Fatalf("calls in fair weather %d, rain %d, gale %d: bad weather should quieten the woods", f, r, w)
	}
}

// Fear decays when the observer stands still, faster with a higher Settle.
func TestSettleSpeedsCalming(t *testing.T) {
	calm := func(settle float32) int {
		s, _ := newTestSim(5, nil)
		env := envAt(1, 10)
		obs := observerAt(core.V(woodPos.X, 5, woodPos.Z-300))
		s.Step(0.1, env, obs)
		id := s.SpawnNear(spRobin, woodPos)
		b := s.find(id)
		b.fear = fearAlert + 0.05
		obs.Pos = core.V(b.pos.X-14, 5+core.EyeHeight, b.pos.Z)
		obs.Settle = settle
		for i := 1; i < 2000; i++ {
			obs.Still += 0.1
			s.Step(0.1, env, obs)
			if s.find(id).fear == 0 {
				return i
			}
		}
		return 2000
	}
	slow, fast := calm(1), calm(2.5)
	if fast >= slow || slow >= 2000 {
		t.Fatalf("calming took %d ticks at Settle 1 and %d at Settle 2.5", slow, fast)
	}
}
