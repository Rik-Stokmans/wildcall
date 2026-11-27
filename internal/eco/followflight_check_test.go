package eco

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// checkFollowable holds the measured flushes to the follow-flight rules.
func checkFollowable(t *testing.T, recs []flushRec) {
	t.Helper()
	small := summarize(recs, int(fleeSmall))
	all := summarize(recs, -1)
	if all.landed < 8 {
		t.Fatalf("only %d flushes landed", all.landed)
	}
	if d := med(small.dist); small.landed > 4 && (d < 12 || d > 38) {
		t.Errorf("small birds flee a median %.1f m, want 12-35", d)
	}
	if v := med(small.avgSp); small.landed > 4 && v > 1.15 {
		t.Errorf("small birds escape at %.2fx cruise on average, want <= 1.15x", v)
	}
	if f := float64(all.los) / float64(all.landed); f < 0.75 {
		t.Errorf("only %.0f%% of landings in sight of the observer", 100*f)
	}
	if f := float64(all.inCone) / float64(all.landed); f < 0.85 {
		t.Errorf("only %.0f%% of landings within 60 degrees of where the bird took off", 100*f)
	}
	if f := float64(all.alert8) / float64(all.landed); f < 0.85 {
		t.Errorf("only %.0f%% stay in the open 8 s after landing", 100*f)
	}
	if f := float64(all.called5) / float64(all.landed); f < 0.6 {
		t.Errorf("only %.0f%% call within 5 s of landing", 100*f)
	}
	if all.hid > 0 {
		if f := float64(all.hideShow) / float64(all.hid); f < 0.8 {
			t.Errorf("only %.0f%% of hidden skulkers show themselves again within 25 s", 100*f)
		}
	}
}

// TestEscapeProfile: the escape is fast off the mark, then steady, and lands on
// its perch exactly when the move ends.
func TestEscapeProfile(t *testing.T) {
	for _, l := range []float32{4, 15, 30, 80} {
		v := float32(8)
		T := escapeTime(l, v)
		b := &bird{mdur: T, mt: T}
		if e, tt := burstEase(b); e < 0.999 || tt < 0.999 {
			t.Errorf("l=%v: escape ends at %.3f of the way (t %.3f)", l, e, tt)
		}
		b.mt = -0.3 // a flock mate waiting to take off
		if e, tt := burstEase(b); e != 0 || tt != 0 {
			t.Errorf("l=%v: delayed take-off moves early (%v, %v)", l, e, tt)
		}
		if avg := l / T / v; avg > 1.15 || avg < 0.9 {
			t.Errorf("l=%v: average %.2fx steady speed", l, avg)
		}
		// Monotonic, and quicker at the start than at the end.
		prev := float32(-1)
		for i := 0; i <= 50; i++ {
			d := burstDist(T*float32(i)/50, T)
			if d < prev {
				t.Fatalf("l=%v: escape goes backwards at %d", l, i)
			}
			prev = d
		}
		dt := min32(0.2, T/5)
		early := burstDist(dt, T)
		late := burstDist(T, T) - burstDist(T-dt, T)
		if early <= late {
			t.Errorf("l=%v: first %.1fs covers %.2f, last %.2f: want a fast take-off", l, dt, early, late)
		}
	}
}

// TestFlockFliesTogether: when one of a flock is flushed the others follow it to the
// same tree or patch, a fraction of a second apart, and land beside it.
func TestFlockFliesTogether(t *testing.T) {
	s, w, _ := realSim(t, "followflight")
	pos := cabinPos(t, w)
	env := envAt(1, 8)
	obs := stillObserver(w, pos)
	s.Step(0.1, env, obs)
	for i := 0; i < 200; i++ {
		s.Step(0.1, env, obs)
	}
	tested := 0
	for i := range s.birds {
		b := &s.birds[i]
		p := &s.prof[b.sp]
		if !b.alive || !p.flock || b.moving || b.mode == mAway || b.mode == mNest || b.cell == nil || b.res < 0 {
			continue
		}
		lead := b.cell.roster[b.res].lead
		if lead < 0 || b.pos.DistXZ(pos) > 400 {
			continue
		}
		var mates []*bird
		for j := range b.cell.roster {
			m := b.cell.roster[j]
			if m.lead == lead && m.bird >= 0 && &s.birds[m.bird] != b {
				o := &s.birds[m.bird]
				if o.alive && o.mode != mAway && o.mode != mNest && o.mode != mLeave && o.pos.DistXZ(b.pos) < 40 {
					mates = append(mates, o)
				}
			}
		}
		if len(mates) < 2 {
			continue
		}
		// Flush it with the observer standing 6 m off.
		dx, dz := float32(6), float32(0)
		s.obs = observerAt(core.V(b.pos.X-dx, w.HeightAt(b.pos.X-dx, b.pos.Z-dz), b.pos.Z-dz))
		s.obs.Present = true
		s.flee(b, p)
		if b.mode != mAway || !b.moving {
			t.Fatalf("leader did not flee")
		}
		starts := map[float32]bool{}
		for _, o := range mates {
			if o.mode != mAway || !o.moving {
				t.Errorf("%s flock mate %d stayed behind (mode %d)", p.sp.ID, o.id, o.mode)
				continue
			}
			if o.to.DistXZ(b.to) > 9 {
				t.Errorf("%s flock mate lands %.1f m from the leader's refuge, want beside it", p.sp.ID, o.to.DistXZ(b.to))
			}
			if -o.mt <= 0.05 || -o.mt > 0.5*float32(len(mates))+0.1 {
				t.Errorf("flock mate takes off %.2f s after the leader", -o.mt)
			}
			starts[o.mt] = true
		}
		if len(starts) < len(mates) {
			t.Errorf("flock mates take off all at once")
		}
		tested++
		if tested >= 3 {
			break
		}
	}
	if tested == 0 {
		t.Skip("no flock near the cabin")
	}
}

// TestRepeatFlushGoesFarther: flushed again soon after, a bird goes farther; the
// third time it leaves the area.
func TestRepeatFlushGoesFarther(t *testing.T) {
	s, w, _ := realSim(t, "followflight")
	pos := cabinPos(t, w)
	env := envAt(1, 8)
	obs := stillObserver(w, pos)
	s.Step(0.1, env, obs)
	for i := 0; i < 100; i++ {
		s.Step(0.1, env, obs)
	}
	n := 0
	for i := range s.birds {
		b := &s.birds[i]
		p := &s.prof[b.sp]
		if !b.alive || p.flock || fleeClass(p) != fleeSmall || b.moving || b.mode == mAway || b.mode == mNest || b.pos.DistXZ(pos) > 300 {
			continue
		}
		var dist [3]float32
		for k := 0; k < 3; k++ {
			s.obs = observerAt(core.V(b.pos.X-5, w.HeightAt(b.pos.X-5, b.pos.Z), b.pos.Z))
			from := b.pos
			s.flee(b, p)
			dist[k] = b.to.DistXZ(from)
			b.pos, b.moving = b.to, false // it has landed
			s.tick += 50
		}
		if b.ff.streak != 3 {
			t.Fatalf("streak %d after three flushes", b.ff.streak)
		}
		if dist[2] < leaveNear*0.6 {
			t.Errorf("%s: third flush only %.0f m, want it to leave the area (%v)", p.sp.ID, dist[2], dist)
		}
		if dist[1] < 0.7*fleeRange[fleeSmall][1] {
			t.Errorf("%s: second flush %.0f m not farther than the first %.0f m", p.sp.ID, dist[1], dist[0])
		}
		if n++; n >= 6 {
			break
		}
	}
	if n == 0 {
		t.Skip("no small bird found")
	}
}
