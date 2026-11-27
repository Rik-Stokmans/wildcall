package eco

import (
	"fmt"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

func TestHeightHabitFromPerchList(t *testing.T) {
	cases := []struct {
		perches []string
		skulk   float32
		low     bool    // strict low-living habit
		maxHi   float32 // hiMax must not exceed this
	}{
		{[]string{"shrub", "ground", "branch"}, 0.9, true, 3}, // wren
		{[]string{"reed", "shrub"}, 0.9, true, 3},             // reed warbler
		{[]string{"shrub", "branch", "ground"}, 0.3, false, 12},
		{[]string{"canopy", "branch"}, 0.6, false, noHeightLimit},
		{[]string{"trunk", "branch"}, 0.2, false, noHeightLimit},
	}
	for _, c := range cases {
		sp := core.Species{ID: "x", Behavior: core.Behavior{Perches: c.perches, Skulking: c.skulk, Feeding: "glean"}}
		p := buildProfile(&sp)
		if p.lowLiving != c.low || p.hiMax > c.maxHi {
			t.Errorf("%v skulk %.1f: lowLiving %v hiMax %v", c.perches, c.skulk, p.lowLiving, p.hiMax)
		}
		if c.low && (p.heightFit(2) != 1 || p.heightFit(10) > 0.05) {
			t.Errorf("%v: heightFit(2)=%v heightFit(10)=%v", c.perches, p.heightFit(2), p.heightFit(10))
		}
	}
}

// TestWrensLiveLow: QA's top complaint was the tutorial wren sitting 9-15 m up in
// the canopy. Across many wrens around the cabin, through a morning with an
// observer wandering about (so they flee, hide and come home too), the large
// majority of perched or singing wren positions are within 3 m of the ground.
func TestWrensLiveLow(t *testing.T) {
	total, low := 0, 0
	for _, text := range []string{"wren-one", "wren-two", "wren-three"} {
		s, w, spp := realSim(t, text)
		wren := indexOf(spp, "eurasian_wren")
		cabin := cabinPos(t, w)
		env := envAt(2, 7)
		obs := stillObserver(w, cabin)
		for i := 0; i < 2400; i++ { // four real minutes = four game hours
			// Walk a slow loop around the cabin, pausing now and then.
			if (i/300)%2 == 1 {
				a := float32(i) * 0.004
				p := core.V(cabin.X+60*sin32(a), 0, cabin.Z-60*cos32(a))
				obs = stillObserver(w, p)
				obs.Move, obs.Still, obs.Speed = "walk", 0, 1.4
				obs.Vel = core.V(1.4*cos32(a), 0, 1.4*sin32(a))
			} else {
				obs.Move, obs.Speed, obs.Vel, obs.Still = "still", 0, core.Vec3{}, obs.Still+0.1
			}
			s.Step(0.1, env, obs)
			env = advanceEnv(env, 0.1/60)
			if i%20 != 0 {
				continue
			}
			for j := range s.birds {
				b := &s.birds[j]
				if !b.alive || int(b.sp) != wren || b.moving || b.pos.DistXZ(cabin) > 500 {
					continue
				}
				switch b.act {
				case core.ActPerched, core.ActPreening, core.ActSocial, core.ActAlert, core.ActHiding, core.ActForaging, core.ActFeeding:
				default:
					if b.flags&core.FlagSinging == 0 {
						continue
					}
				}
				total++
				if heightAbove(w, b.pos) <= 3 {
					low++
				}
			}
		}
	}
	share := float32(low) / float32(max(total, 1))
	t.Logf("%d of %d wren sightings within 3 m of the ground (%.0f%%)", low, total, 100*share)
	if total < 500 || share < 0.85 {
		t.Fatalf("only %d of %d wren positions (%.0f%%) are within 3 m of the ground", low, total, 100*share)
	}
}

// TestBirdsUsePreferredPerchKinds: for every species of the catalog, the perches
// its birds rest on are mostly of the kinds in its Behavior.Perches list, wherever
// such perches exist around its home.
func TestBirdsUsePreferredPerchKinds(t *testing.T) {
	_, w, spp := realSim(t, "perch-kinds")
	inList := make([][core.PerchKindCount]bool, len(spp))
	for i := range spp {
		for _, k := range spp[i].Behavior.Perches {
			if pk, ok := core.PerchKindFromKey(k); ok {
				inList[i][pk] = true
			}
		}
	}
	ok := make([]int, len(spp))
	all := make([]int, len(spp))
	bad := map[string]int{}
	seed := world.SeedFromText("perch-kinds")
	for r := core.RegionID(0); r < core.RegionCount; r++ {
		land, found := regionLand(w, r)
		if !found {
			continue
		}
		for _, day := range []int{2, 14} { // spring and winter
			s := New(w, spp, seed)
			env := envAt(day, 9)
			obs := stillObserver(w, land)
			for i := 0; i < 600; i++ {
				s.Step(0.5, env, obs)
				env = advanceEnv(env, 0.5/60/4) // a slow clock: stay in the morning
				if i < 60 || i%15 != 0 {
					continue
				}
				for j := range s.birds {
					b := &s.birds[j]
					if !b.alive || b.moving || b.mode != mIdle || b.flags&core.FlagVagrant != 0 {
						continue
					}
					if b.act != core.ActPerched && b.act != core.ActPreening && b.act != core.ActSocial {
						continue
					}
					// Resting at its own nest (a cavity, a fork) is nesting, not perching.
					if n := s.nestOf(b); n != nil && b.pos.Dist(n.pos) < 2 {
						continue
					}
					// Only where the territory offers perches of its listed kinds.
					offered := false
					for m := 0; m < maxMem; m++ {
						if b.has(m) && inList[b.sp][b.mem[m].Kind] {
							offered = true
							break
						}
					}
					if !offered {
						continue
					}
					all[b.sp]++
					if inList[b.sp][b.destKind] {
						ok[b.sp]++
					} else {
						bad[fmt.Sprintf("%s:%s:cur%d", spp[b.sp].ID, b.destKind.Key(), b.cur)]++
					}
				}
			}
		}
	}
	checked := 0
	for i := range spp {
		if all[i] < 20 {
			continue
		}
		checked++
		share := float32(ok[i]) / float32(all[i])
		if share < 0.95 {
			t.Logf("%s: %.0f%% of %d on listed kinds", spp[i].ID, 100*share, all[i])
		}
		if share < 0.8 {
			t.Errorf("%s rests on its listed perch kinds %v only %.0f%% of %d sightings", spp[i].ID, spp[i].Behavior.Perches, 100*share, all[i])
		}
	}
	if checked < len(spp)/2 {
		t.Fatalf("only %d of %d species were seen resting often enough to check", checked, len(spp))
	}
	t.Logf("%d species checked; off-list: %v", checked, bad)
}
