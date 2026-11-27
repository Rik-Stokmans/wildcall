package eco

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// testRound is a round of four low, exposed posts about 6 m apart in the fixture wood.
func testRound() []core.Perch {
	g := float32(5) // coretest.Flat ground height
	c := woodPos
	return []core.Perch{
		{Pos: core.V(c.X, g+0.6, c.Z), Kind: core.PerchSnag},
		{Pos: core.V(c.X+6, g+1.1, c.Z), Kind: core.PerchShrub, Cover: 0.2},
		{Pos: core.V(c.X+6, g+0.5, c.Z+6), Kind: core.PerchSnag},
		{Pos: core.V(c.X, g+1.4, c.Z+6), Kind: core.PerchShrub, Cover: 0.25},
	}
}

func onPost(b core.BirdState, posts []core.Perch) int {
	for i, pc := range posts {
		if b.Pos.Dist(pc.Pos) < 0.05 {
			return i
		}
	}
	return -1
}

// A circuit resident sings every 8-14 s by day, holds its posts, and is the same
// bird (same id) every time it is added with the same key.
func TestCircuitSingsAndHolds(t *testing.T) {
	s, _ := newTestSim(11, nil)
	env := envAt(1, 9)
	far := observerAt(woodPos.Add(core.V(80, 0, 0)))
	s.Step(0.1, env, far)
	posts := testRound()
	id := s.AddCircuit(Circuit{Species: spWren, Key: 42, Posts: posts})
	if id == 0 {
		t.Fatal("AddCircuit returned 0")
	}
	if again := s.AddCircuit(Circuit{Species: spWren, Key: 42, Posts: posts}); again != id {
		t.Fatalf("same key, different bird: %d vs %d", again, id)
	}
	s2, _ := newTestSim(11, nil)
	s2.Step(0.1, env, far)
	if id2 := s2.AddCircuit(Circuit{Species: spWren, Key: 42, Posts: posts}); id2 != id {
		t.Fatalf("a new sim gives the resident another id: %d vs %d", id2, id)
	}

	var calls []float32
	var silentMax, quietFor float32
	offPost := 0
	const dt = 0.1
	for i := 0; i < 6000; i++ { // 10 minutes
		evs := s.Step(dt, env, far)
		quietFor += dt
		for _, ev := range evs {
			if ev.Kind == core.EvCall && ev.Bird == id {
				calls = append(calls, float32(i)*dt)
				quietFor = 0
			}
		}
		silentMax = max32(silentMax, quietFor)
		b, ok := s.Get(id)
		if !ok {
			t.Fatal("the resident vanished")
		}
		if info, _ := s.CircuitOf(id); !info.Moving && onPost(b, posts) < 0 {
			offPost++
		}
	}
	info, _ := s.CircuitOf(id)
	t.Logf("10 min: %d phrases, longest silence %.1f s, %d moves, %d pushes", len(calls), silentMax, info.Moves, info.Pushes)
	if len(calls) < 40 || len(calls) > 80 {
		t.Errorf("%d phrases in 10 minutes, want one every 8-14 s", len(calls))
	}
	if silentMax > 16 {
		t.Errorf("silent for %.1f s by day", silentMax)
	}
	if info.Moves < 4 || info.Moves > 11 {
		t.Errorf("%d moves between posts in 10 minutes (holds 60-120 s each)", info.Moves)
	}
	if offPost > 0 {
		t.Errorf("perched off its posts for %d ticks", offPost)
	}

	// At night it still sings, less often, never silent for more than ~40 s.
	night := envAt(1, 1.5)
	quietFor, silentMax = 0, 0
	n := 0
	for i := 0; i < 3000; i++ {
		evs := s.Step(dt, night, far)
		quietFor += dt
		for _, ev := range evs {
			if ev.Kind == core.EvCall && ev.Bird == id {
				n++
				quietFor = 0
			}
		}
		silentMax = max32(silentMax, quietFor)
	}
	if n < 6 || silentMax > 40 {
		t.Errorf("night: %d phrases in 5 min, longest silence %.1f s", n, silentMax)
	}
}

// Pushed by a walking observer it flits to another post of its round (in the
// open, a short flight), never out of its territory, and sings again soon.
func TestCircuitPushedMovesAlongItsRound(t *testing.T) {
	s, tr := newTestSim(12, nil)
	env := envAt(1, 10)
	posts := testRound()
	far := observerAt(woodPos.Add(core.V(80, 0, 0)))
	s.Step(0.1, env, far)
	id := s.AddCircuit(Circuit{Species: spWren, Key: 7, Posts: posts})

	b, _ := s.Get(id)
	start := onPost(b, posts)
	// Walk straight at it from 20 m.
	from := b.Pos.Add(core.V(0, 0, -20))
	from.Y = 5
	pushedAt, sangAfter := -1.0, -1.0
	var lastDist float32
	for i := 0; i < 600; i++ {
		cur, _ := s.Get(id)
		dir := cur.Pos.Sub(from)
		dir.Y = 0
		d := dir.Len()
		obs := observerAt(from)
		obs.Move, obs.Speed = "walk", 1.4
		if pushedAt < 0 && d > 1 {
			obs.Vel = dir.Scale(1.4 / d)
			from = from.Add(obs.Vel.Scale(0.1))
		}
		if pushedAt >= 0 {
			obs.Move, obs.Speed, obs.Vel = "still", 0, core.Vec3{}
		}
		evs := s.Step(0.1, env, obs)
		info, _ := s.CircuitOf(id)
		if pushedAt < 0 && info.Pushes > 0 {
			pushedAt = float64(i) * 0.1
			lastDist = d
		}
		for _, ev := range evs {
			if ev.Kind == core.EvCall && ev.Bird == id && pushedAt >= 0 && sangAfter < 0 {
				sangAfter = float64(i)*0.1 - pushedAt
			}
		}
		validPos(t, tr, cur)
	}
	if pushedAt < 0 {
		t.Fatal("a walking observer never pushed it on")
	}
	if lastDist > 6.5 || lastDist < 4 {
		t.Errorf("pushed at %.1f m by a walker, want about 6 m", lastDist)
	}
	end, _ := s.Get(id)
	if k := onPost(end, posts); k < 0 || k == start {
		t.Errorf("after the push it is on post %d (started on %d)", k, start)
	}
	if sangAfter < 0 || sangAfter > 15 {
		t.Errorf("sang again %.1f s after being pushed", sangAfter)
	}

	// A crouching observer gets within 3 m.
	info, _ := s.CircuitOf(id)
	pushes := info.Pushes
	cur, _ := s.Get(id)
	obs := observerAt(cur.Pos.Add(core.V(0, 0, 3)).Sub(core.V(0, cur.Pos.Y-5, 0)))
	obs.Move, obs.Crouch, obs.Speed = "crouch", true, 0.8
	for i := 0; i < 100; i++ {
		s.Step(0.1, env, obs)
	}
	if info, _ := s.CircuitOf(id); info.Pushes != pushes {
		t.Errorf("a crouching observer at 3 m pushed it on")
	}

	// Released, it leaves once nobody is near, never in front of the observer.
	s.ReleaseCircuit(id)
	s.Step(0.1, env, obs)
	if _, ok := s.Get(id); !ok {
		t.Fatal("released resident vanished in front of the observer")
	}
	s.Step(0.1, env, far)
	if _, ok := s.Get(id); ok {
		t.Fatal("released resident still here with nobody about")
	}
}

// FastForward puts it back on one of its posts.
func TestCircuitFastForward(t *testing.T) {
	s, _ := newTestSim(13, nil)
	env := envAt(1, 8)
	s.Step(0.1, env, core.Observer{})
	posts := testRound()
	id := s.AddCircuit(Circuit{Species: spWren, Key: 9, Posts: posts})
	s.FastForward(5, advanceEnv(env, 5))
	b, ok := s.Get(id)
	if !ok || onPost(b, posts) < 0 {
		t.Fatalf("after a rest the resident is not on a post: %v %+v", ok, b.Pos)
	}
}

// Ordinary birds a person is quietly closing in on do not relocate more than
// every 30-45 s, and their moves stay short (nest duty, flocks and flushed birds
// excepted).
func TestBirdsLingerForACalmObserver(t *testing.T) {
	type track struct {
		last  core.Vec3
		moved float32 // time of the last relocation
	}
	watched, violations, long := 0, 0, 0
	for spot := 0; spot < 6; spot++ {
		s, _ := newTestSim(int64(21+spot), extraSpecies())
		env := envAt(1, 10)
		at := woodPos.Add(core.V(float32(spot%3)*90-90, 0, float32(spot/3)*90-45))
		obs := observerAt(at)
		obs.Move = "still"
		for i := 0; i < 300; i++ { // let things settle with the observer present
			s.Step(0.1, env, obs)
		}
		tr := map[uint32]*track{}
		for i := 0; i < 1800; i++ {
			s.Step(0.1, env, obs)
			now := float32(i) * 0.1
			for _, b := range s.Near(obs.Pos, 28, nil) {
				// Nest duty (ferrying material or food) is left alone, and so are flocks,
				// swimmers and anything flushed.
				if b.Act.Airborne() || b.Act == core.ActFleeing || b.Act == core.ActHiding || b.Act == core.ActNesting ||
					s.prof[b.Species].flock || b.Act == core.ActSwimming {
					continue
				}
				k := tr[b.ID]
				if k == nil {
					tr[b.ID] = &track{last: b.Pos, moved: now}
					continue
				}
				if d := b.Pos.DistXZ(k.last); d > lingerHop+0.5 {
					if now-k.moved < lingerHoldMin-1 {
						violations++
						t.Logf("early: bird %d sp %d act %s moved %.1f m after %.1f s", b.ID, b.Species, b.Act.Key(), d, now-k.moved)
					}
					if d > lingerMax+2 {
						long++
						t.Logf("long: bird %d sp %d act %s moved %.1f m", b.ID, b.Species, b.Act.Key(), d)
					}
					k.moved = now
				}
				k.last = b.Pos
			}
		}
		watched += len(tr)
	}
	t.Logf("%d birds watched, %d early relocations, %d long moves", watched, violations, long)
	if watched < 6 {
		t.Fatalf("only %d birds near the observer: the test proves little", watched)
	}
	if violations > 0 || long > 0 {
		t.Errorf("birds near a calm observer relocated too often (%d) or too far (%d)", violations, long)
	}
}
