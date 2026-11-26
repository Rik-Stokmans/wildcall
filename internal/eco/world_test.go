package eco

import (
	"fmt"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

func indexOf(list []core.Species, id string) int {
	for i := range list {
		if list[i].ID == id {
			return i
		}
	}
	panic("no species " + id)
}

func TestMigrantAbsentInWinterArrivesInSpring(t *testing.T) {
	species := extraSpecies()
	warbler := indexOf(species, "test_warbler")
	s, tr := newTestSim(9, species)
	obs := observerAt(woodPos)
	env := envAt(14, 10) // winter
	if env.Season != core.Winter {
		t.Fatalf("fixture env is %v", env.Season)
	}
	for i := 0; i < 100; i++ {
		s.Step(0.1, env, obs)
	}
	if n := s.Stats().BySpecies[warbler]; n != 0 {
		t.Fatalf("%d summer migrants present in winter", n)
	}
	// Spring arrives at midnight; over the following hours the migrants come back.
	env = envAt(17, 0)
	if env.Season != core.Spring {
		t.Fatalf("day 17 is %v", env.Season)
	}
	arrivals := 0
	for i := 0; i < 12*60*2; i++ { // twelve game hours in half-minute steps
		for _, e := range s.Step(0.5, env, obs) {
			if e.Kind == core.EvArrive && e.Species == warbler {
				arrivals++
				if b, ok := s.Get(e.Bird); !ok || b.Pos != e.Pos {
					t.Fatalf("EvArrive position %v does not match bird %+v", e.Pos, b)
				}
			}
		}
		env = advanceEnv(env, 0.5/60)
		if i == 30 {
			if n := s.Stats().BySpecies[warbler]; n > arrivals {
				t.Fatalf("migrants appeared without arriving")
			}
		}
	}
	n := s.Stats().BySpecies[warbler]
	if arrivals == 0 || n == 0 {
		t.Fatalf("no spring arrivals (events %d, present %d)", arrivals, n)
	}
	for _, b := range s.Near(woodPos, 1000, nil) {
		validPos(t, tr, b)
	}
	// And they leave again in winter (over the first hours of the season).
	env = envAt(13, 0)
	for i := 0; i < 12*60*2; i++ {
		s.Step(0.5, env, obs)
		env = advanceEnv(env, 0.5/60)
	}
	if n := s.Stats().BySpecies[warbler]; n != 0 {
		t.Fatalf("%d migrants still here twelve hours into winter", n)
	}
}

func TestAutumnAlwaysHasAVagrant(t *testing.T) {
	for seed := int64(1); seed <= 5; seed++ {
		species := extraSpecies()
		pipit := indexOf(species, "test_pipit")
		s, tr := newTestSim(seed, species)
		obs := observerAt(woodPos)
		env := envAt(10, 9) // autumn
		for i := 0; i < 120; i++ {
			s.Step(0.1, env, obs)
		}
		st := s.Stats()
		if st.Vagrants < 1 {
			t.Fatalf("seed %d: no vagrant in autumn", seed)
		}
		for _, b := range s.Near(woodPos, 2000, nil) {
			if b.Flags&core.FlagVagrant != 0 {
				if b.Species != pipit {
					t.Fatalf("vagrant of species %d, which belongs here", b.Species)
				}
				validPos(t, tr, b)
			}
		}
	}
	// Without any out-of-region species there is nothing to stray in.
	s, _ := newTestSim(1, nil)
	for i := 0; i < 120; i++ {
		s.Step(0.1, envAt(10, 9), observerAt(woodPos))
	}
	if n := s.Stats().Vagrants; n != 0 {
		t.Fatalf("%d vagrants with a single-region catalogue", n)
	}
}

func TestRarePlumageIsRareButExists(t *testing.T) {
	total, rare := 0, 0
	for seed := int64(1); seed <= 12; seed++ {
		s, _ := newTestSim(seed, nil)
		s.Step(0.1, envAt(1, 9), observerAt(woodPos))
		st := s.Stats()
		total += st.Birds
		rare += st.RarePlumage
	}
	if rare == 0 || float32(rare)/float32(total) > 0.05 {
		t.Fatalf("%d of %d birds with rare plumage", rare, total)
	}
}

func TestLureDrawsGroundFeeders(t *testing.T) {
	s, _ := newTestSim(4, nil)
	env := envAt(1, 9)
	lurePos := core.V(woodPos.X, 5, woodPos.Z)
	obs := observerAt(core.V(lurePos.X-30, 5, lurePos.Z))
	obs.Sitting, obs.Still = true, 60
	s.Step(0.1, env, obs)
	s.AddLure(core.Lure{Pos: lurePos, Radius: 40, TTL: 600, Kind: "seed"})
	maxAt := 0
	for i := 0; i < 2400; i++ { // four minutes
		s.Step(0.1, env, obs)
		at := 0
		for _, b := range s.Near(lurePos, 2.5, nil) {
			if b.Act == core.ActFeeding || b.Act == core.ActForaging {
				if b.Species == spBuzzard {
					t.Fatal("a raptor came to the seed")
				}
				at++
			}
		}
		if at > maxAt {
			maxAt = at
		}
		if at > lureVisitors {
			t.Fatalf("%d birds at once at the lure", at)
		}
	}
	if maxAt == 0 {
		t.Fatal("no bird came to feed at the lure")
	}
	if s.Stats().Lures != 1 {
		t.Fatal("lure vanished early")
	}
	// It runs out.
	for i := 0; i < 6000; i++ {
		s.Step(0.1, env, obs)
	}
	if s.Stats().Lures != 0 {
		t.Fatal("lure outlived its TTL")
	}
}

func trace(seed int64, species []core.Species) []string {
	s, tr := newTestSim(seed, species)
	env := envAt(1, 5.5)
	obs := observerAt(woodPos)
	var out []string
	var buf []core.BirdState
	for i := 0; i < 1500; i++ {
		obs.Pos.X += 0.25
		obs.Pos.Y = tr.HeightAt(obs.Pos.X, obs.Pos.Z) + core.EyeHeight
		obs.Vel = core.V(2.5, 0, 0)
		obs.Speed = 2.5
		if i == 700 {
			s.AddLure(core.Lure{Pos: obs.Pos, Radius: 30, TTL: 100, Kind: "seed"})
		}
		for _, e := range s.Step(0.1, env, obs) {
			out = append(out, fmt.Sprintf("%d %d %d %d %d %.3f %.3f %.3f %.2f %d", e.Kind, e.Bird, e.Species, e.Call, e.Repeats, e.Pos.X, e.Pos.Y, e.Pos.Z, e.Dur, e.Seed))
		}
		if i%100 == 0 {
			buf = s.Near(obs.Pos, 300, buf[:0])
			h := uint64(len(buf))
			for _, b := range buf {
				h = hash2(h, uint64(b.ID)^uint64(b.Act)<<32^uint64(int64(b.Pos.X*100))<<40)
			}
			out = append(out, fmt.Sprintf("snap %d %x", len(buf), h))
		}
		env = advanceEnv(env, 0.1/60)
	}
	s.FastForward(3, advanceEnv(env, 3))
	out = append(out, fmt.Sprintf("ff %d", s.Count()))
	return out
}

func TestDeterministicForSeedAndCalls(t *testing.T) {
	species := extraSpecies()
	a, b := trace(77, species), trace(77, species)
	if len(a) != len(b) {
		t.Fatalf("traces differ in length: %d vs %d", len(a), len(b))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("traces diverge at %d:\n%s\n%s", i, a[i], b[i])
		}
	}
	c := trace(78, species)
	same := len(a) == len(c)
	for i := 0; same && i < len(a); i++ {
		same = a[i] == c[i]
	}
	if same {
		t.Fatal("different seeds gave identical traces")
	}
	if len(a) < 100 {
		t.Fatalf("suspiciously quiet trace: %d entries", len(a))
	}
}

func TestFastForwardPutsBirdsWhereTheirRoutineSays(t *testing.T) {
	s, tr := newTestSim(6, nil)
	env := envAt(1, 10)
	obs := observerAt(woodPos)
	for i := 0; i < 50; i++ {
		s.Step(0.1, env, obs)
	}
	s.AddLure(core.Lure{Pos: woodPos, Radius: 30})
	night := envAt(1, 23.5)
	s.FastForward(13.5, night)
	st := s.Stats()
	if st.ByAct[core.ActRoosting] < st.Birds*9/10 {
		t.Fatalf("after resting until 23:30 only %d of %d day birds roost: %v", st.ByAct[core.ActRoosting], st.Birds, st.ByAct)
	}
	if st.Lures != 0 {
		t.Fatal("a lure survived 13 hours")
	}
	for _, b := range s.Near(woodPos, 1000, nil) {
		validPos(t, tr, b)
		if b.Fear != 0 || b.Flags&core.FlagSinging != 0 {
			t.Fatalf("bird %d still afraid or singing after a fast-forward", b.ID)
		}
	}
	morning := envAt(2, 9)
	s.FastForward(9.5, morning)
	st = s.Stats()
	if st.ByAct[core.ActRoosting] > st.Birds/10 {
		t.Fatalf("%d of %d birds still asleep at 09:00", st.ByAct[core.ActRoosting], st.Birds)
	}
	if evs := s.Step(0.1, morning, obs); len(evs) > 40 {
		t.Fatalf("first step after a fast-forward produced %d events", len(evs))
	}
}

// TestBehaviourRepertoire runs a varied catalogue through a day around the pond and
// the woods and checks that the whole repertoire shows up.
func TestBehaviourRepertoire(t *testing.T) {
	species := extraSpecies()
	s, tr := newTestSim(12, species)
	pond := core.V(512, 5, 1536)
	obs := observerAt(core.V(pond.X+60, 5, pond.Z))
	obs.Still, obs.Sitting = 100, true
	env := envAt(2, 4)
	seen := map[core.BirdAct]bool{}
	bySp := map[string]bool{}
	var buf []core.BirdState
	moves, flushes := 0, 0
	for i := 0; i < 20*60*4; i++ { // 20 game hours at 4 ticks a second
		evs := s.Step(0.25, env, obs)
		for _, e := range evs {
			switch e.Kind {
			case core.EvMove:
				moves++
				if e.Pos.DistXZ(obs.Pos) > moveCueRadius+1 {
					t.Fatalf("EvMove %v m from the observer", e.Pos.DistXZ(obs.Pos))
				}
			case core.EvFlush:
				flushes++
			case core.EvCall:
				b, ok := s.Get(e.Bird)
				if !ok || b.Pos != e.Pos {
					t.Fatalf("call reported at %v but the bird is at %v", e.Pos, b.Pos)
				}
				if b.Act == core.ActFleeing || b.Act == core.ActHiding || b.Flags&core.FlagSinging == 0 {
					t.Fatalf("calling bird in act %s, flags %b", b.Act.Key(), b.Flags)
				}
				c := species[e.Species].Calls[e.Call]
				if e.Repeats < 1 || e.Repeats > max(c.Repeat[1], 1) || e.Dur <= 0 {
					t.Fatalf("bad call bout %+v", e)
				}
			}
		}
		if i%8 == 0 {
			buf = s.Near(obs.Pos, 400, buf[:0])
			for _, b := range buf {
				seen[b.Act] = true
				bySp[fmt.Sprintf("%s/%s", species[b.Species].ID, b.Act.Key())] = true
				validPos(t, tr, b)
				if b.Act == core.ActSwimming && b.Pos.Y != 0 {
					t.Fatalf("swimming bird at height %v", b.Pos.Y)
				}
			}
		}
		env = advanceEnv(env, 0.25/60)
	}
	for _, a := range []core.BirdAct{core.ActPerched, core.ActForaging, core.ActFeeding, core.ActFlying, core.ActSoaring,
		core.ActHovering, core.ActSwimming, core.ActClimbing, core.ActRoosting, core.ActPreening, core.ActSocial,
		core.ActNesting, core.ActBathing, core.ActDiving} {
		if !seen[a] {
			t.Errorf("never saw %s", a.Key())
		}
	}
	for _, k := range []string{"test_nuthatch/climbing", "test_duck/swimming", "test_buzzard/soaring", "test_kestrel/hovering", "test_robin/bathing"} {
		if !bySp[k] {
			t.Errorf("never saw %s", k)
		}
	}
	if moves == 0 {
		t.Error("no movement cues near the observer")
	}
	if flushes != 0 {
		t.Errorf("a seated, still observer flushed %d birds", flushes)
	}
}

func TestFlocksStayTogether(t *testing.T) {
	species := extraSpecies()
	finch := indexOf(species, "test_finch")
	s, _ := newTestSim(15, species)
	env := envAt(1, 9)
	obs := observerAt(woodPos)
	near, total := 0, 0
	for i := 0; i < 3000; i++ {
		s.Step(0.1, env, obs)
		if i%50 != 0 {
			continue
		}
		for j := range s.birds {
			b := &s.birds[j]
			if !b.alive || int(b.sp) != finch {
				continue
			}
			l := s.leader(b)
			if l == nil {
				continue
			}
			total++
			if b.pos.Dist(l.pos) < 30 {
				near++
			}
		}
	}
	if total == 0 {
		t.Fatal("no flock followers")
	}
	if float32(near)/float32(total) < 0.7 {
		t.Fatalf("flock members near their leader only %d of %d samples", near, total)
	}
}

func TestSpawnNear(t *testing.T) {
	s, _ := newTestSim(2, nil)
	env := envAt(1, 10)
	s.Step(0.1, env, observerAt(woodPos))
	n := s.Count()
	id := s.SpawnNear(spWren, core.V(woodPos.X+10, 5, woodPos.Z))
	if id == 0 || s.Count() != n+1 {
		t.Fatal("SpawnNear did not add a bird")
	}
	b, ok := s.Get(id)
	if !ok || b.Species != spWren || b.Pos.DistXZ(woodPos) > 60 {
		t.Fatalf("spawned bird %+v", b)
	}
	if s.SpawnNear(-1, woodPos) != 0 || s.SpawnNear(99, woodPos) != 0 {
		t.Fatal("invalid species index accepted")
	}
	// A land bird cannot be put in the middle of the pond.
	if s.SpawnNear(spRobin, core.V(512, 0, 1536)) != 0 {
		t.Fatal("robin spawned on open water")
	}
}

func TestNoObserverKeepsTheHomeValleyAlive(t *testing.T) {
	s, _ := newTestSim(8, nil)
	s.Step(0.1, envAt(1, 8), core.Observer{})
	if s.Count() < 100 {
		t.Fatalf("%d birds with nobody about", s.Count())
	}
	for _, b := range s.Near(core.Vec3{}, 1000, nil) {
		if b.Pos.DistXZ(core.Vec3{}) > 760 {
			t.Fatalf("bird %v m from home", b.Pos.DistXZ(core.Vec3{}))
		}
	}
}
