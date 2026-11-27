package eco

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// TestNestSitterQuietMateSings: while nesting, the bird on the eggs keeps its song
// down; its mate (the territorial male) does not.
func TestNestSitterQuietMateSings(t *testing.T) {
	s, _ := newTestSim(7, nestingSpecies())
	env := envAt(3, 9) // eggs
	obs := observerAt(core.V(woodPos.X, 5, woodPos.Z-250))
	s.Step(0.1, env, obs)
	sitters, males := 0, 0
	for i := range s.birds {
		b := &s.birds[i]
		if !b.alive {
			continue
		}
		n := s.nestOf(b)
		if n == nil {
			continue
		}
		p := &s.prof[b.sp]
		b.singer = s.territorial(b, p)
		was := b.mode
		b.mode, b.act, b.moving = mNest, core.ActNesting, false
		f := s.voiceFactor(b, p)
		switch {
		case n.sitter() == b.res:
			sitters++
			if f > 0.4 || b.singer {
				t.Fatalf("the sitter sings at factor %v (singer %v)", f, b.singer)
			}
		default:
			males++
			if f < 1 || !b.singer {
				t.Fatalf("the non-incubating mate sings at factor %v (singer %v)", f, b.singer)
			}
		}
		b.mode = was
	}
	if sitters == 0 || males == 0 {
		t.Fatalf("%d sitters, %d non-incubating mates", sitters, males)
	}
}

// TestTutorialWrenSings: a territorial wren near the cabin on a spring morning,
// watched by a still observer 18 m away, sings at least every ~30 s on average and
// stays low (within 3 m of the ground) nearly all the time.
func TestTutorialWrenSings(t *testing.T) {
	var calls, songs, wrens int
	var secs float32
	for _, text := range []string{"wren-one", "wren-two", "wren-three", "wren-four", "wren-five", "wren-six"} {
		s, w, spp := realSim(t, text)
		wi := indexOf(spp, "eurasian_wren")
		cabin := cabinPos(t, w)
		env := envAt(2, 8.25) // three real minutes are three game hours: all morning
		s.Step(0.1, env, stillObserver(w, cabin))
		var target *bird
		best := float32(150)
		for j := range s.birds {
			b := &s.birds[j]
			if b.alive && int(b.sp) == wi && b.singer {
				if d := b.home.DistXZ(cabin); d < best {
					best, target = d, b
				}
			}
		}
		if target == nil {
			t.Fatalf("%s: no territorial wren within 150 m of the cabin", text)
		}
		id := target.id
		obs := stillObserver(w, core.V(target.home.X+18, 0, target.home.Z))
		n, sg, low, seen, flushed := 0, 0, 0, 0, false
		const steps = 3 * 60 * 10 // three real minutes
		for i := 0; i < steps; i++ {
			for _, e := range s.Step(0.1, env, obs) {
				if e.Bird != id {
					continue
				}
				switch e.Kind {
				case core.EvCall:
					n++
					if e.Call == 0 {
						sg++
					}
				case core.EvFlush:
					flushed = true
				}
			}
			env = advanceEnv(env, 0.1/60)
			b := s.find(id)
			if b == nil {
				t.Fatalf("%s: the wren left the world", text)
			}
			if i%10 == 0 && !b.moving {
				seen++
				if heightAbove(w, b.pos) <= 3 {
					low++
				}
			}
		}
		t.Logf("%s: wren %.0f m from the cabin: %d bouts (%d songs) in 3 min, low %d/%d", text, best, n, sg, low, seen)
		if flushed {
			t.Errorf("%s: a still observer 18 m away flushed the wren", text)
		}
		if n < 3 {
			t.Errorf("%s: the wren called only %d times in 3 minutes", text, n)
		}
		if float32(low) < 0.85*float32(seen) {
			t.Errorf("%s: the wren was low only %d of %d samples", text, low, seen)
		}
		calls += n
		songs += sg
		wrens++
		secs += steps * 0.1
	}
	every := secs / float32(max(calls, 1))
	t.Logf("on average a bout every %.1f s (a song every %.1f s)", every, secs/float32(max(songs, 1)))
	if every > 30 {
		t.Fatalf("wrens call only every %.1f s on average", every)
	}
}
