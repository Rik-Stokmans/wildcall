package eco

import (
	"testing"
	"time"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

func TestPopulationSizeMixAndPlacement(t *testing.T) {
	s, tr := newTestSim(7, nil)
	env := envAt(1, 8)
	obs := observerAt(woodPos)
	s.Step(0.1, env, obs)
	st := s.Stats()
	if st.Birds < 120 || st.Birds > 700 {
		t.Fatalf("active population %d, want a few hundred", st.Birds)
	}
	if st.Cells < 40 || st.Cells > 80 {
		t.Fatalf("%d active cells around the observer", st.Cells)
	}
	if st.BySpecies[spRobin] <= st.BySpecies[spBuzzard] || st.BySpecies[spWren] == 0 || st.BySpecies[spBuzzard] == 0 {
		t.Fatalf("species mix %v: common robins should outnumber scarce buzzards, all present", st.BySpecies)
	}
	if st.Birds != s.Count() {
		t.Fatalf("Stats %d != Count %d", st.Birds, s.Count())
	}
	var buf []core.BirdState
	for tick := 0; tick < 1200; tick++ { // two minutes
		s.Step(0.1, env, obs)
		buf = s.Near(obs.Pos, 2000, buf[:0])
		if len(buf) != s.Count() {
			t.Fatalf("Near(everything) returned %d of %d birds", len(buf), s.Count())
		}
		for _, b := range buf {
			validPos(t, tr, b)
			if d := b.Pos.DistXZ(obs.Pos); d > 760 {
				t.Fatalf("bird %d is %v m from the observer, outside the active cells", b.ID, d)
			}
		}
	}
	// Near with a small radius agrees with a brute-force filter.
	all := s.Near(obs.Pos, 5000, nil)
	near := s.Near(obs.Pos, 60, nil)
	want := 0
	for _, b := range all {
		if b.Pos.Dist(obs.Pos) <= 60 {
			want++
		}
	}
	if len(near) != want {
		t.Fatalf("Near(60) found %d birds, brute force %d", len(near), want)
	}
	for _, b := range near {
		if g, ok := s.Get(b.ID); !ok || g != b {
			t.Fatalf("Get(%d) disagrees with Near", b.ID)
		}
	}
}

func TestWalkAwayAndBackRestoresTheSameBirds(t *testing.T) {
	s, tr := newTestSim(11, nil)
	env := envAt(1, 9)
	start := woodPos
	obs := observerAt(start)
	s.Step(0.1, env, obs)
	for i := 0; i < 50; i++ {
		s.Step(0.1, env, obs)
	}
	before := map[uint32]core.BirdState{}
	for _, b := range s.Near(obs.Pos, 150, nil) {
		if b.Flags&core.FlagVagrant == 0 {
			before[b.ID] = b
		}
	}
	if len(before) < 10 {
		t.Fatalf("only %d birds near the start", len(before))
	}

	slow := 0
	walk := func(to core.Vec3) {
		const speed = 6
		for {
			d := to.Sub(obs.Pos)
			d.Y = 0
			l := d.Len()
			if l < 1 {
				return
			}
			step := d.Norm().Scale(min32(speed*0.1, l))
			obs.Pos = obs.Pos.Add(step)
			obs.Pos.Y = tr.HeightAt(obs.Pos.X, obs.Pos.Z) + core.EyeHeight
			obs.Vel = d.Norm().Scale(speed)
			obs.Speed = speed
			t0 := time.Now()
			s.Step(0.1, env, obs)
			if el := time.Since(t0); el > 5*time.Millisecond && !raceEnabled {
				// One isolated spike can be the OS or another process on a busy
				// machine; a real activation hitch repeats with every cell.
				slow++
				if slow > 1 || el > 20*time.Millisecond {
					t.Fatalf("Step took %v while travelling (%d slow steps): activation must be spread out", el, slow)
				}
			}
			env = advanceEnv(env, 0.1/60)
		}
	}
	far := core.V(start.X, 5, start.Z+2000) // still in the fixture woodland
	walk(far)
	for _, id := range keys(before) {
		if _, ok := s.Get(id); ok {
			t.Fatalf("bird %d from the start is still simulated 2 km away", id)
		}
	}
	if n := s.Count(); n < 100 {
		t.Fatalf("only %d birds around the far point", n)
	}
	walk(start)
	for i := 0; i < 100; i++ { // let pending cells finish
		s.Step(0.1, env, obs)
	}
	back := 0
	for id, b0 := range before {
		b, ok := s.Get(id)
		if !ok {
			continue
		}
		back++
		if b.Species != b0.Species {
			t.Fatalf("bird %d came back as species %d, was %d", id, b.Species, b0.Species)
		}
		if b.Flags&core.FlagRarePlumage != b0.Flags&core.FlagRarePlumage {
			t.Fatalf("bird %d changed plumage", id)
		}
		bb := s.find(id)
		r := max32(s.prof[bb.sp].terr, 30) + 80
		if d := b.Pos.DistXZ(bb.home); d > r && bb.mode != mAway {
			t.Fatalf("bird %d is %v m from its home (allowed %v)", id, d, r)
		}
		validPos(t, tr, b)
	}
	if back < len(before)*9/10 {
		t.Fatalf("only %d of %d birds came back", back, len(before))
	}
}

func keys(m map[uint32]core.BirdState) []uint32 {
	out := make([]uint32, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestMemoryBoundedOnALongWalk(t *testing.T) {
	s, tr := newTestSim(3, nil)
	env := envAt(1, 10)
	obs := observerAt(woodPos)
	s.Step(0.1, env, obs)
	maxCells, maxBirds := 0, 0
	// 20 km in a winding line at a brisk 8 m per tick.
	for i := 0; i < 2500; i++ {
		dir := core.V(1, 0, 0.3)
		if (i/400)%2 == 1 {
			dir = core.V(0.3, 0, 1)
		}
		obs.Vel = dir.Norm().Scale(80)
		obs.Speed = 6.5
		obs.Pos = obs.Pos.Add(dir.Norm().Scale(8))
		obs.Pos.Y = tr.HeightAt(obs.Pos.X, obs.Pos.Z) + core.EyeHeight
		s.Step(0.1, env, obs)
		if n := len(s.cells); n > maxCells {
			maxCells = n
		}
		if n := s.Count(); n > maxBirds {
			maxBirds = n
		}
	}
	if maxCells > 110 {
		t.Fatalf("%d cells alive at once", maxCells)
	}
	if len(s.cellList) != len(s.cells) || len(s.byID) != s.Count() {
		t.Fatalf("bookkeeping out of step: cells %d/%d, ids %d/%d", len(s.cellList), len(s.cells), len(s.byID), s.Count())
	}
	if len(s.birds) > 2*maxBirds+64 {
		t.Fatalf("bird slots grew to %d for at most %d birds", len(s.birds), maxBirds)
	}
	if len(s.cellPool) > maxPooled || len(s.forced) > 8 {
		t.Fatalf("pools grew: %d cells, %d forced", len(s.cellPool), len(s.forced))
	}
	live := 0
	for i := range s.birds {
		if s.birds[i].alive {
			live++
		}
	}
	if live+len(s.free) != len(s.birds) || live != s.Count() {
		t.Fatalf("slot accounting: %d live + %d free != %d", live, len(s.free), len(s.birds))
	}
}

func TestDawnChorusAndNightSilence(t *testing.T) {
	s, _ := newTestSim(5, nil)
	env := envAt(2, 0)
	obs := core.Observer{} // nobody about: the home valley lives on its own
	var perHour [24]int
	const dt = 0.5
	for i := 0; i < int(24*3600/60/dt); i++ { // one day at one game hour per real minute
		for _, e := range s.Step(dt, env, obs) {
			if e.Kind == core.EvCall {
				perHour[int(env.Time)]++
			}
		}
		env = advanceEnv(env, dt/60)
	}
	rate := func(from, to float32) float32 {
		n := 0
		for h := int(from); h < int(to); h++ {
			n += perHour[h]
		}
		return float32(n) / (to - from)
	}
	dawn := rate(5, 7)
	for _, other := range [][2]float32{{7, 11}, {11, 14}, {14, 18}, {18, 21}} {
		if r := rate(other[0], other[1]); r >= dawn {
			t.Fatalf("calls per hour at %v-%v (%v) not below dawn (%v): %v", other[0], other[1], r, dawn, perHour)
		}
	}
	if night := perHour[23] + perHour[0] + perHour[1] + perHour[2] + perHour[3]; night != 0 {
		t.Fatalf("day birds called %d times in the middle of the night: %v", night, perHour)
	}
	if dawn < 50 {
		t.Fatalf("a feeble dawn chorus: %v calls per hour", dawn)
	}
}

// flushDistance approaches one freshly spawned robin and returns the distance at
// which it flushed (0 if it never did). direct: sprint straight at it; otherwise
// creep crouched in a tightening spiral (a tangential approach).
func flushDistance(t *testing.T, seed int64, direct bool, settle func(s *Sim, obs *core.Observer, env core.Env, id uint32)) float32 {
	s, tr := newTestSim(seed, nil)
	env := envAt(1, 10)
	obs := observerAt(core.V(woodPos.X, 5, woodPos.Z-300))
	s.Step(0.1, env, obs)
	id := s.SpawnNear(spRobin, woodPos)
	if id == 0 {
		t.Fatal("SpawnNear failed")
	}
	start := s.find(id).pos
	obs.Pos = core.V(start.X-35, 5+core.EyeHeight, start.Z)
	obs.Still = 30
	for i := 0; i < 50; i++ {
		s.Step(0.1, env, obs)
	}
	if settle != nil {
		settle(s, &obs, env, id)
	}
	angle := float32(0)
	for i := 0; i < 3000; i++ {
		target := s.find(id).pos // slots may move as the population grows: look it up each time
		d := target.Sub(obs.Pos)
		d.Y = 0
		r := d.Len()
		if r < 0.5 {
			return 0
		}
		var vel core.Vec3
		if direct {
			vel = d.Norm().Scale(6.5)
			obs.Speed, obs.Crouch = 6.5, false
		} else {
			// Mostly sideways, slowly closing in.
			tang := core.V(-d.Z, 0, d.X).Norm()
			vel = tang.Scale(1.05).Add(d.Norm().Scale(0.3))
			obs.Speed, obs.Crouch = 1.1, true
			angle += 0.01
		}
		obs.Vel = vel
		obs.Still = 0
		obs.Pos = obs.Pos.Add(vel.Scale(0.1))
		obs.Pos.Y = tr.HeightAt(obs.Pos.X, obs.Pos.Z) + core.EyeHeight
		for _, e := range s.Step(0.1, env, obs) {
			if e.Kind == core.EvFlush && e.Bird == id {
				return e.Pos.DistXZ(obs.Pos)
			}
		}
	}
	return 0
}

func TestSprintFlushesFartherThanACrouchedTangentialApproach(t *testing.T) {
	var sprint, creep float32
	for seed := int64(1); seed <= 4; seed++ {
		sprint += flushDistance(t, seed, true, nil)
		creep += flushDistance(t, seed, false, nil)
	}
	if sprint < 2*creep || sprint < 4*8 {
		t.Fatalf("sprint flush distance %v (sum of 4) should be far beyond a crouched creep %v", sprint, creep)
	}
}

func TestFlushedBirdReturnsToItsTerritory(t *testing.T) {
	s, tr := newTestSim(21, nil)
	env := envAt(1, 10)
	obs := observerAt(core.V(woodPos.X, 5, woodPos.Z-300))
	s.Step(0.1, env, obs)
	id := s.SpawnNear(spRobin, woodPos)
	p0 := s.find(id).pos
	obs.Pos = core.V(p0.X-40, 5+core.EyeHeight, p0.Z)
	flushed := false
	for i := 0; i < 400 && !flushed; i++ {
		d := s.find(id).pos.Sub(obs.Pos)
		d.Y = 0
		obs.Vel = d.Norm().Scale(6.5)
		obs.Speed = 6.5
		obs.Pos = obs.Pos.Add(obs.Vel.Scale(0.1))
		for _, e := range s.Step(0.1, env, obs) {
			if e.Kind == core.EvFlush && e.Bird == id {
				flushed = true
			}
		}
	}
	if !flushed {
		t.Fatal("sprinting at the robin did not flush it")
	}
	// It must go silent and stay away for a while.
	for i := 0; i < 100; i++ {
		for _, e := range s.Step(0.1, env, obs) {
			if e.Kind == core.EvCall && e.Bird == id {
				t.Fatal("a just-flushed bird called")
			}
		}
	}
	// The observer walks off 300 m.
	obs.Pos = core.V(woodPos.X, 5+core.EyeHeight, woodPos.Z-300)
	obs.Vel, obs.Speed = core.Vec3{}, 0
	r := max32(s.prof[spRobin].terr, 30) + 2
	for i := 0; i < 1500; i++ {
		s.Step(0.1, env, obs)
		b := s.find(id)
		if b.mode != mAway && !b.moving && b.pos.DistXZ(b.home) <= r {
			validPos(t, tr, b.state())
			return
		}
	}
	b := s.find(id)
	t.Fatalf("still away 150 s after the observer left: mode %d, %v m from home", b.mode, b.pos.DistXZ(b.home))
}

func TestStillObserverHabituatesAndShrinksFlushDistance(t *testing.T) {
	sit := func(s *Sim, obs *core.Observer, env core.Env, id uint32) {
		b := s.find(id)
		obs.Pos = core.V(b.home.X-6, 5+core.EyeHeight, b.home.Z)
		obs.Vel, obs.Speed = core.Vec3{}, 0
		obs.Sitting = true
		for i := 0; i < 3000; i++ { // five minutes sitting quietly
			obs.Still += 0.1
			s.Step(0.1, env, *obs)
		}
		obs.Sitting, obs.Still = false, 0
		b = s.find(id)
		if b.flags&core.FlagHabituated == 0 {
			t.Fatalf("the robin did not habituate to a still, seated observer (habit %v)", b.habit)
		}
		// Step back to the usual starting distance for the approach.
		obs.Pos = core.V(b.pos.X-35, 5+core.EyeHeight, b.pos.Z)
	}
	var fresh, used float32
	for seed := int64(1); seed <= 4; seed++ {
		fresh += flushDistance(t, seed, true, nil)
		used += flushDistance(t, seed, true, sit)
	}
	if used >= fresh*0.85 {
		t.Fatalf("habituated flush distance %v not clearly below the fresh %v", used, fresh)
	}
}
