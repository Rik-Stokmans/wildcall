package eco

import (
	"fmt"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// ---------------------------------------------------------------------------
// Observer movement mode (core.Observer.Move)

func TestObserverMoveModeOverridesSpeed(t *testing.T) {
	s, _ := newTestSim(1, nil)
	base := observerAt(woodPos)
	cases := []struct {
		move   string
		speed  float32
		crouch bool
		sit    bool
		want   float32
		moving bool
	}{
		// Named mode: used as is, whatever the speed says.
		{"sprint", 2.0, false, false, moveSprint, true}, // a sprint slowed by rough ground
		{"run", 1.0, false, false, moveRun, true},
		{"walk", 6.5, false, false, moveWalk, true},
		{"crouch", 2.2, false, false, moveCrouch, true},
		{"still", 1.0, false, false, moveStill, false},
		{"sprint", 6.5, false, true, moveStill, false}, // sitting is always still
		// Empty: inferred from the speed.
		{"", 0, false, false, moveStill, false},
		{"", 2.2, false, false, moveWalk, true},
		{"", 4.2, false, false, moveRun, true},
		{"", 6.5, false, false, moveSprint, true},
		{"", 1.1, true, false, moveCrouch, true},
		{"bogus", 4.2, false, false, moveRun, true},
	}
	for _, c := range cases {
		o := base
		o.Move, o.Speed, o.Crouch, o.Sitting = c.move, c.speed, c.crouch, c.sit
		s.setObserver(o)
		if s.oMove != c.want || s.oMoving != c.moving {
			t.Errorf("Move %q speed %.1f crouch %v sit %v: factor %v moving %v, want %v %v", c.move, c.speed, c.crouch, c.sit, s.oMove, s.oMoving, c.want, c.moving)
		}
	}
	// A named crouch counts as crouching for the posture bonus too.
	o := base
	o.Move, o.Speed, o.CrouchBonus = "crouch", 1, 0.5
	s.setObserver(o)
	if s.oPosture != 0.5 {
		t.Errorf("crouch mode posture %v", s.oPosture)
	}
}

// A sprinting player slowed to a walk's pace by rough ground still flushes birds at
// sprint distance.
func TestSlowSprintFlushesLikeASprint(t *testing.T) {
	flushes := func(move string) int {
		s, _ := newTestSim(3, nil)
		env := envAt(1, 10)
		obs := observerAt(core.V(woodPos.X-150, 5, woodPos.Z))
		s.Step(0.1, env, obs)
		n := 0
		for i := 0; i < 1500; i++ { // 150 m at 1 m/s through the wood
			obs.Pos.X += 0.1
			obs.Vel, obs.Speed, obs.Move = core.V(1, 0, 0), 1, move
			for _, e := range s.Step(0.1, env, obs) {
				if e.Kind == core.EvFlush {
					n++
				}
			}
		}
		return n
	}
	walk, sprint := flushes("walk"), flushes("sprint")
	t.Logf("flushes: walk %d, sprint %d", walk, sprint)
	if sprint <= walk {
		t.Fatalf("a slow sprint flushed %d birds, a walk at the same speed %d", sprint, walk)
	}
}

// ---------------------------------------------------------------------------
// Mixed feeding flocks

type flockSeen struct {
	id      uint32
	at      int // step it was first seen
	species map[int]bool
	members []uint32
	dist    float32 // from the observer when it formed
}

// watchMixed runs a sim at the cabin from env for steps of 0.1 s and returns the
// mixed flocks seen.
func watchMixed(t *testing.T, text string, env core.Env, steps int) ([]flockSeen, *Sim) {
	s, w, _ := realSim(t, text)
	cabin := cabinPos(t, w)
	obs := stillObserver(w, cabin)
	var out []flockSeen
	for i := 0; i < steps; i++ {
		s.Step(0.1, env, obs)
		env = advanceEnv(env, 0.1/60)
		if s.mixed.id == 0 || len(out) > 0 && out[len(out)-1].id == s.mixed.id {
			continue
		}
		f := flockSeen{id: s.mixed.id, at: i, species: map[int]bool{}, dist: s.mixed.pos.DistXZ(cabin)}
		for j := range s.birds {
			b := &s.birds[j]
			if b.alive && s.MixedFlock(b.id) == f.id {
				f.species[int(b.sp)] = true
				f.members = append(f.members, b.id)
			}
		}
		out = append(out, f)
	}
	return out, s
}

func TestMixedFlockFormsInAutumnWoodland(t *testing.T) {
	for _, tc := range []struct {
		text string
		day  int
	}{{"mixed-one", 10}, {"mixed-two", 10}, {"mixed-three", 14}} { // autumn, autumn, winter
		flocks, s := watchMixed(t, tc.text, envAt(tc.day, 8.5), 10*60*10)
		if len(flocks) == 0 {
			t.Fatalf("%s day %d: no mixed flock in ten minutes", tc.text, tc.day)
		}
		f := flocks[0]
		t.Logf("%s day %d: first flock after %.0f s, %.0f m from the cabin, %d birds of %d species; %d flocks in ten minutes",
			tc.text, tc.day, float32(f.at)/10, f.dist, len(f.members), len(f.species), len(flocks))
		if float32(f.at)/10 > 180 {
			t.Errorf("%s: the first flock took %.0f s to form", tc.text, float32(f.at)/10)
		}
		if f.dist > 450 {
			t.Errorf("%s: the flock formed %.0f m from the observer", tc.text, f.dist)
		}
		for _, fl := range flocks {
			if len(fl.species) < mixedMinSp {
				t.Errorf("%s: flock of %d species", tc.text, len(fl.species))
			}
			for sp := range fl.species {
				if !s.prof[sp].mixed {
					t.Errorf("%s: %s joined a mixed flock", tc.text, s.species[sp].ID)
				}
			}
		}
		if len(flocks) > 4 {
			t.Errorf("%s: %d mixed flocks in ten minutes", tc.text, len(flocks))
		}
	}
}

func TestMixedFlockTravelsTogetherAndDisperses(t *testing.T) {
	s, w, _ := realSim(t, "mixed-one")
	cabin := cabinPos(t, w)
	obs := stillObserver(w, cabin)
	env := envAt(10, 8.5)
	for i := 0; i < 3000 && s.mixed.id == 0; i++ {
		s.Step(0.1, env, obs)
		env = advanceEnv(env, 0.1/60)
	}
	id := s.mixed.id
	if id == 0 {
		t.Fatal("no mixed flock formed")
	}
	var members []uint32
	for j := range s.birds {
		if b := &s.birds[j]; b.alive && b.mixed == id {
			members = append(members, b.id)
		}
	}
	if s.MixedFlocks(s.mixed.pos, 5) != 1 || s.MixedFlocks(core.V(s.mixed.pos.X+5000, 0, s.mixed.pos.Z), 100) != 0 {
		t.Fatal("MixedFlocks does not count the flock")
	}
	near, samples := 0, 0
	for i := 0; s.mixed.id == id && i < 6000; i++ {
		s.Step(0.1, env, obs)
		env = advanceEnv(env, 0.1/60)
		if i%50 == 0 && s.mixed.id == id {
			for _, m := range members {
				if b := s.find(m); b != nil && b.mixed == id {
					samples++
					if b.pos.DistXZ(s.mixed.pos) < 30 {
						near++
					}
				}
			}
		}
	}
	if s.mixed.id == id {
		t.Fatal("the mixed flock never dispersed")
	}
	if samples == 0 || float32(near) < 0.7*float32(samples) {
		t.Fatalf("members near the shared target only %d of %d samples", near, samples)
	}
	for _, m := range members {
		if s.MixedFlock(m) == id {
			t.Fatalf("bird %d still in the dispersed flock", m)
		}
	}
	if s.MixedFlock(0xFFFFFFFF) != 0 {
		t.Fatal("MixedFlock of an unknown bird")
	}
}

func TestNoMixedFlocksInSpringOrSummer(t *testing.T) {
	for _, day := range []int{2, 6} {
		s, w, _ := realSim(t, "mixed-one")
		cabin := cabinPos(t, w)
		obs := stillObserver(w, cabin)
		env := envAt(day, 8.5)
		for i := 0; i < 6000; i++ {
			s.Step(0.1, env, obs)
			env = advanceEnv(env, 0.1/60)
			if s.mixed.id != 0 || s.MixedFlocks(cabin, 1e5) != 0 {
				t.Fatalf("day %d (%v): a mixed flock formed", day, env.Season)
			}
		}
		for j := range s.birds {
			if s.birds[j].alive && s.birds[j].mixed != 0 {
				t.Fatalf("day %d: a bird belongs to a mixed flock", day)
			}
		}
	}
}

func TestMixedFlocksDeterministic(t *testing.T) {
	a, _ := watchMixed(t, "mixed-two", envAt(10, 8.5), 4000)
	b, _ := watchMixed(t, "mixed-two", envAt(10, 8.5), 4000)
	if len(a) == 0 || len(a) != len(b) {
		t.Fatalf("flock counts %d vs %d", len(a), len(b))
	}
	for i := range a {
		if a[i].id != b[i].id || a[i].at != b[i].at || fmt.Sprint(a[i].members) != fmt.Sprint(b[i].members) {
			t.Fatalf("flock %d differs: %+v vs %+v", i, a[i], b[i])
		}
	}
}

// ---------------------------------------------------------------------------
// Predator passes

// passRun forces a predator pass in the fixture wood and records how the small
// birds below react.
type passLog struct {
	raptor          uint32
	alarmed         map[uint32]bool // small birds that reacted
	hid             map[uint32]bool // ...and were seen hiding
	alarmCalls      int
	stillHiding     int // reacting birds still hiding 90 s after the pass
	passSteps       int
	trace           []string
	minHeightOK     bool
	flushedObserver bool
}

func passRun(t *testing.T, seed int64) passLog {
	s, tr := newTestSim(seed, nil)
	env := envAt(1, 10)
	obs := observerAt(woodPos)
	obs.Still, obs.Move = 100, "still"
	s.Step(0.1, env, obs)
	s.passCD = 0.05 // the next tick
	lg := passLog{alarmed: map[uint32]bool{}, hid: map[uint32]bool{}, minHeightOK: true}
	ended := -1
	for i := 0; i < 3000; i++ {
		for _, e := range s.Step(0.1, env, obs) {
			if e.Kind == core.EvCall && s.pass.id != 0 {
				if b := s.find(e.Bird); b != nil && b.passSeq == s.pass.seq && b.mode == mAlert {
					lg.alarmCalls++ // the alarm given just before diving for cover
				}
			}
			if e.Kind == core.EvFlush {
				lg.flushedObserver = true
			}
			lg.trace = append(lg.trace, fmt.Sprintf("%d %d %d %.2f", e.Kind, e.Bird, e.Call, e.Pos.X))
		}
		id, active := s.PredatorPass()
		if active {
			lg.raptor = id
			lg.passSteps++
			r := s.find(id)
			if r == nil || r.pos.Y < tr.HeightAt(r.pos.X, r.pos.Z) {
				lg.minHeightOK = false
			}
		} else if lg.raptor != 0 && ended < 0 {
			ended = i
		}
		for j := range s.birds {
			b := &s.birds[j]
			if !b.alive || b.passSeq == 0 {
				continue
			}
			lg.alarmed[b.id] = true
			if b.mode == mHide || b.act == core.ActHiding {
				lg.hid[b.id] = true
			}
		}
		if ended >= 0 && i == ended+900 {
			for id := range lg.alarmed {
				if b := s.find(id); b != nil && (b.mode == mHide || b.act == core.ActHiding || b.mode == mAlert) {
					lg.stillHiding++
				}
			}
			break
		}
	}
	return lg
}

func TestPredatorPassSendsSmallBirdsIntoCover(t *testing.T) {
	lg := passRun(t, 5)
	if lg.raptor == 0 {
		t.Fatal("no predator pass")
	}
	t.Logf("raptor %d: %d steps of pass, %d small birds reacted, %d hid, %d alarm calls, %d still hiding after 90 s",
		lg.raptor, lg.passSteps, len(lg.alarmed), len(lg.hid), lg.alarmCalls, lg.stillHiding)
	if len(lg.alarmed) < 3 || len(lg.hid) < len(lg.alarmed)/2 {
		t.Fatalf("%d small birds reacted, %d hid", len(lg.alarmed), len(lg.hid))
	}
	if lg.alarmCalls == 0 {
		t.Fatal("no alarm calls")
	}
	if lg.stillHiding > 0 {
		t.Fatalf("%d birds still hiding 90 s after the pass", lg.stillHiding)
	}
	if !lg.minHeightOK {
		t.Fatal("the raptor flew below the ground")
	}
	if lg.flushedObserver {
		t.Fatal("the pass flushed birds from a still observer")
	}
}

func TestPredatorPassDeterministic(t *testing.T) {
	a, b := passRun(t, 9), passRun(t, 9)
	if a.raptor != b.raptor || len(a.trace) != len(b.trace) {
		t.Fatalf("passes differ: raptor %d vs %d, %d vs %d events", a.raptor, b.raptor, len(a.trace), len(b.trace))
	}
	for i := range a.trace {
		if a.trace[i] != b.trace[i] {
			t.Fatalf("event %d differs: %s vs %s", i, a.trace[i], b.trace[i])
		}
	}
}

func TestPredatorPassesAreRare(t *testing.T) {
	s, _ := newTestSim(11, nil)
	env := envAt(2, 7)
	obs := observerAt(woodPos)
	obs.Still = 100
	passes, was := 0, false
	for i := 0; i < 40*60*4; i++ { // forty real minutes
		s.Step(0.25, env, obs)
		env = advanceEnv(env, 0.25/60/3) // keep it daytime
		_, active := s.PredatorPass()
		if active && !was {
			passes++
		}
		was = active
	}
	t.Logf("%d passes in forty minutes", passes)
	if passes < 1 || passes > 4 {
		t.Fatalf("%d predator passes in forty minutes", passes)
	}
}

// ---------------------------------------------------------------------------
// Settling signal

// approachAndWait walks the observer up to one bird until it is wary (or, with
// untilFlee, until it flees), then stands still, and reports what Settled said
// about it.
func approachAndWait(t *testing.T, s *Sim, b *bird, env core.Env, speed float32, move string, untilFlee bool) (settled, fled bool, others int) {
	t.Helper()
	id := b.id
	target := b.pos
	obs := observerAt(core.V(target.X-40, 5, target.Z))
	for i := 0; i < 600; i++ {
		bb := s.find(id)
		if bb == nil {
			t.Fatal("the bird left")
		}
		if bb.mode == mAway || bb.flags&core.FlagWary != 0 && !untilFlee {
			fled = bb.mode == mAway
			break
		}
		if obs.Pos.DistXZ(target) < 2 {
			break
		}
		obs.Pos.X += speed * 0.1
		obs.Vel, obs.Speed, obs.Move, obs.Still = core.V(speed, 0, 0), speed, move, 0
		s.Step(0.1, env, obs)
		if len(s.Settled()) != 0 {
			t.Fatalf("birds settled while the observer was walking at them: %v", s.Settled())
		}
	}
	for i := 0; i < 2500 && !settled; i++ {
		obs.Vel, obs.Speed, obs.Move = core.Vec3{}, 0, "still"
		obs.Still += 0.1
		s.Step(0.1, env, obs)
		for _, sid := range s.Settled() {
			sb, ok := s.Get(sid)
			if !ok || sb.Pos.DistXZ(obs.Pos) > settleR+1 {
				t.Fatalf("settled bird %d at %v m", sid, sb.Pos.DistXZ(obs.Pos))
			}
			if sb.Flags&core.FlagWary != 0 {
				t.Fatalf("settled bird %d is still wary", sid)
			}
			if sid == id {
				settled = true
			} else {
				others++
			}
		}
	}
	return settled, fled, others
}

func TestSettledAfterPatience(t *testing.T) {
	calmed, returned := 0, 0
	for seed := int64(1); seed <= 6; seed++ {
		s, _ := newTestSim(seed, nil)
		env := envAt(1, 10)
		s.Step(0.1, env, observerAt(woodPos))
		var target *bird
		for j := range s.birds {
			b := &s.birds[j]
			if b.alive && b.sp == spRobin && !b.moving && b.mode == mIdle && b.pos.DistXZ(woodPos) < 200 {
				target = b
				break
			}
		}
		if target == nil {
			continue
		}
		// A creeping approach: the robin grows wary, then calms down again.
		settled, fled, others := approachAndWait(t, s, target, env, 1.0, "walk", false)
		t.Logf("seed %d: robin settled %v (fled %v), %d other birds settled", seed, settled, fled, others)
		if settled {
			if fled {
				returned++
			} else {
				calmed++
			}
		}
	}
	if calmed == 0 {
		t.Fatal("no wary bird was reported settling while the observer stood still")
	}
	// Nothing is reported while nobody is about.
	s, _ := newTestSim(2, nil)
	for i := 0; i < 100; i++ {
		s.Step(0.1, envAt(1, 10), core.Observer{})
		if len(s.Settled()) != 0 {
			t.Fatal("settled birds without an observer")
		}
	}
}

func TestSettledAfterFleeingComesHome(t *testing.T) {
	found := 0
	for seed := int64(1); seed <= 8 && found == 0; seed++ {
		s, _ := newTestSim(seed, nil)
		env := envAt(1, 10)
		s.Step(0.1, env, observerAt(woodPos))
		var target *bird
		for j := range s.birds {
			b := &s.birds[j]
			if b.alive && b.sp == spRobin && !b.moving && b.mode == mIdle && b.pos.DistXZ(woodPos) < 200 && b.pos.DistXZ(b.home) < 15 {
				target = b
				break
			}
		}
		if target == nil {
			continue
		}
		// A run straight at it flushes it; once the observer stands still it comes back.
		settled, fled, _ := approachAndWait(t, s, target, env, 6.5, "sprint", true)
		t.Logf("seed %d: robin fled %v, settled back home %v", seed, fled, settled)
		if fled && settled {
			found++
		}
	}
	if found == 0 {
		t.Fatal("no flushed bird was reported settling back in its territory")
	}
}

// ---------------------------------------------------------------------------
// Migrant arrivals on the real world

func TestMigrantsArriveNearTheCabin(t *testing.T) {
	s, w, spp := realSim(t, "arrive-one")
	cabin := cabinPos(t, w)
	obs := stillObserver(w, cabin)
	env := envAt(1, 0.5) // the first night of spring: summer visitors are on their way
	seen := map[uint32]int{}
	migrants, vagrants, rares, near := 0, 0, 0, 0
	for i := 0; i < 9*60*2; i++ { // nine game hours
		for _, e := range s.Step(0.5, env, obs) {
			if e.Kind != core.EvArrive {
				continue
			}
			seen[e.Bird]++
			if seen[e.Bird] > 1 {
				t.Fatalf("bird %d announced %d times", e.Bird, seen[e.Bird])
			}
			b, ok := s.Get(e.Bird)
			if !ok || b.Pos != e.Pos {
				t.Fatalf("EvArrive at %v but the bird is at %+v", e.Pos, b)
			}
			sp := &spp[e.Species]
			switch {
			case b.Flags&core.FlagVagrant != 0:
				vagrants++
			case !sp.Seasons[core.Winter] && sp.Seasons[core.Spring]:
				migrants++
				if e.Pos.DistXZ(cabin) < 400 {
					near++
				}
			case sp.Rarity >= core.Rare:
				rares++
			default:
				t.Fatalf("EvArrive for resident %s", sp.ID)
			}
		}
		env = advanceEnv(env, 0.5/60)
	}
	t.Logf("arrivals: %d migrants (%d within 400 m of the cabin), %d vagrants, %d rare visitors", migrants, near, vagrants, rares)
	if migrants == 0 || near == 0 {
		t.Fatal("no spring migrants arrived near the cabin")
	}
}
