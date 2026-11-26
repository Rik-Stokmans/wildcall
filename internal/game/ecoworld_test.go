package game

import (
	"fmt"
	"math"
	"sort"
	"testing"
	"time"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/eco"
	"github.com/Rik-Stokmans/wildcall/internal/env"
	"github.com/Rik-Stokmans/wildcall/internal/species"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

func checkBirdsAboveGround(t *testing.T, w *world.World, sp []core.Species, birds []core.BirdState, when string) int {
	t.Helper()
	bad := 0
	for _, b := range birds {
		h := w.HeightAt(b.Pos.X, b.Pos.Z)
		floor := h
		if floor < 0 {
			floor = 0 // the water plane: swimming and wading birds sit at y = 0
		}
		if b.Pos.Y < floor-0.25 || math.IsNaN(float64(b.Pos.Y)) {
			bad++
			if bad <= 5 {
				t.Errorf("%s: %s bird %d (%s) at y=%.2f below ground/water %.2f (h=%.2f) at %.1f,%.1f",
					when, sp[b.Species].ID, b.ID, b.Act.Key(), b.Pos.Y, floor, h, b.Pos.X, b.Pos.Z)
			}
		}
	}
	return bad
}

// TestEcosystemOnRealWorld simulates a spring night-to-morning around the cabin for
// five seeds: no bird ends up under ground or water, and the dawn chorus is rich.
func TestEcosystemOnRealWorld(t *testing.T) {
	spp := species.All()
	for _, text := range []string{"eco-one", "eco-two", "eco-three", "eco-four", "eco-five"} {
		seed := world.SeedFromText(text)
		t.Run(text, func(t *testing.T) {
			w := sharedWorld(seed)
			cabin, _ := w.POI("cabin")
			sim := eco.New(w, spp, seed)
			clock := env.New(seed, env.DefaultDayLen)
			clock.Set(3.0, 2) // day 2 of spring: every summer visitor has arrived
			obs := core.Observer{Present: true, Pos: cabin.Pos.Add(core.V(0, core.EyeHeight, 0)), Still: 100,
				Stealth: 1, CrouchBonus: 1, Settle: 1, Familiarity: 1}
			t0 := time.Now()
			sim.Step(0.1, clock.Env(), obs)
			populate := time.Since(t0)
			callers := map[int]int{}
			var worst time.Duration
			steps := 0
			const dt = 0.5
			var buf []core.BirdState
			for clock.Env().Time < 7.5 {
				clock.Advance(dt)
				e := clock.Env()
				ts := time.Now()
				evs := sim.Step(dt, e, obs)
				if d := time.Since(ts); d > worst {
					worst = d
				}
				steps++
				if e.Phase() == core.PhaseDawn {
					for _, ev := range evs {
						if ev.Kind == core.EvCall && ev.Pos.DistXZ(cabin.Pos) < 450 {
							callers[ev.Species]++
						}
					}
				}
				if steps%120 == 0 {
					buf = sim.Near(cabin.Pos, 2000, buf[:0])
					checkBirdsAboveGround(t, w, spp, buf, fmt.Sprintf("%.2fh", e.Time))
				}
			}
			buf = sim.Near(cabin.Pos, 2000, buf[:0])
			checkBirdsAboveGround(t, w, spp, buf, "07:30")
			sim.FastForward(4, clock.Env())
			buf = sim.Near(cabin.Pos, 2000, buf[:0])
			checkBirdsAboveGround(t, w, spp, buf, "after fast-forward")

			var names []string
			for i, n := range callers {
				names = append(names, fmt.Sprintf("%s:%d", spp[i].ID, n))
			}
			sort.Strings(names)
			st := sim.Stats()
			t.Logf("seed %d: %d birds in %d cells (populate %v, %d steps, worst step %v); %d species sang at dawn near the cabin: %v",
				seed, st.Birds, st.Cells, populate, steps, worst, len(callers), names)
			if len(callers) < 12 {
				t.Errorf("only %d species vocalised near the cabin at dawn", len(callers))
			}
		})
	}
}

// landLattice is a 256 m lattice within 9 km of the origin, nearest first.
var landLattice = func() []core.Vec3 {
	var pts []core.Vec3
	for z := -35; z <= 35; z++ {
		for x := -35; x <= 35; x++ {
			p := core.V(float32(x)*256, 0, float32(z)*256)
			if p.Len() <= 9000 && p.Len() > 0 {
				pts = append(pts, p)
			}
		}
	}
	sort.Slice(pts, func(i, j int) bool { return pts[i].Len() < pts[j].Len() })
	return pts
}()

// findLands returns up to n dry-land spots in the middle of patches of a region
// type, at least 1.5 km apart, nearest to the origin first.
func findLands(w *world.World, r core.RegionID, n int) []core.Vec3 {
	var out []core.Vec3
	for _, q := range landLattice {
		if len(out) >= n {
			break
		}
		x, z := q.X, q.Z
		if w.RegionAt(x, z) != r || w.HeightAt(x, z) < 1 {
			continue
		}
		p := core.V(x, w.HeightAt(x, z), z)
		ok := true
		for _, o := range out {
			if o.DistXZ(p) < 1500 {
				ok = false
			}
		}
		for _, d := range []core.Vec3{{X: 150}, {X: -150}, {Z: 150}, {Z: -150}} {
			if ok && w.RegionAt(x+d.X, z+d.Z) != r {
				ok = false
			}
		}
		if ok {
			out = append(out, p)
		}
	}
	return out
}

// presentAt populates an ecosystem around pos in a season and steps it through the
// day phases in calm weather, adding every species seen to found.
func presentAt(w *world.World, spp []core.Species, seed int64, pos core.Vec3, season core.Season, found []int) {
	sim := eco.New(w, spp, seed)
	clock := env.New(seed, env.DefaultDayLen)
	obs := core.Observer{Present: true, Pos: pos.Add(core.V(0, core.EyeHeight, 0)), Stealth: 1, CrouchBonus: 1, Settle: 1, Familiarity: 1}
	for _, hour := range []float32{5.5, 9, 12.5, 16, 19.5, 23} {
		clock.Set(hour, 2) // the second day of the season: every migrant has arrived
		clock.SetSeason(season)
		clock.SetWeather(core.WeatherSunny)
		for i := 0; i < 400 && (clock.Env().Rain > 0.2 || clock.Env().Wind > 0.5); i++ {
			clock.Advance(1)
		}
		for i := 0; i < 30; i++ { // eco services 2 cells per step: a full round
			sim.Step(0.5, clock.Env(), obs)
		}
		if e := clock.Env(); e.Season != season {
			panic(fmt.Sprintf("clock season %v, want %v", e.Season, season))
		}
		for i, n := range sim.Stats().BySpecies {
			if n > 0 && spp[i].Seasons[season] {
				found[i] += n
			}
		}
	}
}

// TestEverySpeciesLives checks that every species of the catalog actually lives
// somewhere in the generated world in a season it is present. Common species must
// show up at the first patch of each of their region types; rare and legendary ones
// (scarce by design, and showing themselves only at their hour, in their core
// habitat and in calm weather) are looked for over up to 30 patches.
func TestEverySpeciesLives(t *testing.T) {
	if testing.Short() {
		t.Skip("slow")
	}
	spp := species.All()
	seed := world.SeedFromText(testSeedText)
	w := sharedWorld(seed)
	found := make([]int, len(spp))
	for r := core.RegionID(0); r < core.RegionCount; r++ {
		lands := findLands(w, r, 1)
		if len(lands) == 0 {
			t.Errorf("no %s land within 10 km", r.Key())
			continue
		}
		for season := core.Season(0); season < 4; season++ {
			presentAt(w, spp, seed, lands[0], season, found)
		}
	}
	patches := 0
	for i := range spp {
		sp := &spp[i]
		if found[i] > 0 || sp.Rarity < core.Rare {
			continue
		}
		season := core.Season(0)
		for season < 3 && !sp.Seasons[season] {
			season++
		}
		for _, pos := range findLands(w, sp.Regions[0], 30) {
			if found[i] > 0 {
				break
			}
			presentAt(w, spp, seed, pos, season, found)
			patches++
		}
		t.Logf("%s (rarity %d): found=%d", sp.ID, sp.Rarity, found[i])
	}
	t.Logf("extra patches searched for rare species: %d", patches)
	var missing []string
	for i, n := range found {
		if n == 0 {
			missing = append(missing, spp[i].ID)
		}
	}
	if len(missing) > 0 {
		t.Errorf("species never found living in the world in their seasons: %v", missing)
	}
}
