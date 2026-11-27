package eco

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Lying flat (Observer.Prone): crawling and lying still are the gentlest postures.
func TestProneObserverFactors(t *testing.T) {
	s, _ := newTestSim(1, nil)
	base := observerAt(woodPos)
	base.CrouchBonus = 0.5

	o := base
	o.Prone, o.Move, o.Speed, o.Vel = true, "crawl", 0.7, core.V(0.7, 0, 0)
	s.setObserver(o)
	if s.oMove != moveCrawl || !s.oMoving || s.oPosture != 0.5 || !s.oCalm {
		t.Errorf("crawl: factor %v moving %v posture %v calm %v", s.oMove, s.oMoving, s.oPosture, s.oCalm)
	}
	if s.oAware >= awareBand*0.85 {
		t.Errorf("prone awareness band %v not ~20%% shorter than %v", s.oAware, awareBand)
	}

	o = base
	o.Prone, o.Move, o.Still = true, "still", 10
	s.setObserver(o)
	if s.oMove != moveProne || s.oMoving || s.oPosture != 0.5 {
		t.Errorf("prone still: factor %v moving %v posture %v", s.oMove, s.oMoving, s.oPosture)
	}
	proneDecay := s.oDecay

	o = base
	o.Sitting, o.Move, o.Still = true, "still", 10
	s.setObserver(o)
	if proneDecay < s.oDecay {
		t.Errorf("lying still calms birds slower (%v) than sitting (%v)", proneDecay, s.oDecay)
	}
	if s.oAware != awareBand {
		t.Errorf("sitting awareness band %v", s.oAware)
	}

	// An old client that only says "crawl" still counts as prone.
	o = base
	o.Move, o.Speed = "crawl", 0.7
	s.setObserver(o)
	if s.oMove != moveCrawl || s.oAware != awareBand*proneAware {
		t.Errorf("crawl without Prone: factor %v aware %v", s.oMove, s.oAware)
	}
}

// approachFlush walks straight at a freshly spawned robin at speed in the given
// posture and returns the distance at which it flushed (0 if it never did).
func approachFlush(t *testing.T, seed int64, speed float32, move string, crouch, prone bool, eyeH float32) float32 {
	t.Helper()
	s, tr := newTestSim(seed, nil)
	env := envAt(1, 10)
	obs := observerAt(core.V(woodPos.X, 5, woodPos.Z-300))
	s.Step(0.1, env, obs)
	id := s.SpawnNear(spRobin, woodPos)
	if id == 0 {
		t.Fatal("SpawnNear failed")
	}
	start := s.find(id).pos
	obs.Pos = core.V(start.X-40, 5+eyeH, start.Z)
	obs.Crouch, obs.Prone = crouch, prone
	obs.Move, obs.Still = "still", 30
	for i := 0; i < 50; i++ {
		s.Step(0.1, env, obs)
	}
	for i := 0; i < 1500; i++ {
		d := s.find(id).pos.Sub(obs.Pos)
		d.Y = 0
		if d.Len() < 0.5 {
			return 0
		}
		obs.Vel = d.Norm().Scale(speed)
		obs.Speed, obs.Move, obs.Still = speed, move, 0
		obs.Pos = obs.Pos.Add(obs.Vel.Scale(0.1))
		obs.Pos.Y = tr.HeightAt(obs.Pos.X, obs.Pos.Z) + eyeH
		for _, e := range s.Step(0.1, env, obs) {
			if e.Kind == core.EvFlush && e.Bird == id {
				return e.Pos.DistXZ(obs.Pos)
			}
		}
	}
	return 0
}

func TestProneApproachFlushesClosestOfAll(t *testing.T) {
	var walk, crouch, crawl float32
	for seed := int64(1); seed <= 6; seed++ {
		walk += approachFlush(t, seed, 2.4, "walk", false, false, core.EyeHeight)
		crouch += approachFlush(t, seed, 1.2, "crouch", true, false, 1.0)
		crawl += approachFlush(t, seed, 0.7, "crawl", false, true, 0.35)
	}
	t.Logf("flush distance (sum of 6): walk %.1f, crouch %.1f, crawl %.1f", walk, crouch, crawl)
	if !(crouch < walk*0.8) || !(crawl < crouch*0.8) {
		t.Fatalf("want walk > crouch > crawl clearly: walk %.1f crouch %.1f crawl %.1f", walk, crouch, crawl)
	}
}

// A robin made wary by a walk calms down while the observer lies still, at least as
// quickly as for one who sits down.
func TestLyingStillSettlesBirds(t *testing.T) {
	calmAfter := func(seed int64, sit, prone bool) (float32, bool) {
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
			return 0, false
		}
		id := target.id
		obs := observerAt(core.V(target.pos.X-40, 5, target.pos.Z))
		for i := 0; i < 600; i++ {
			bb := s.find(id)
			if bb.mode == mAway || bb.flags&core.FlagWary != 0 {
				break
			}
			obs.Pos.X += 0.1
			obs.Vel, obs.Speed, obs.Move, obs.Still = core.V(1, 0, 0), 1, "walk", 0
			s.Step(0.1, env, obs)
		}
		if s.find(id).mode == mAway {
			return 0, false
		}
		// Make it properly alarmed (just short of fleeing) so calming takes a while.
		bb := s.find(id)
		bb.fear = 0.75
		bb.flags |= core.FlagWary
		obs.Sitting, obs.Prone = sit, prone
		for i := 0; i < 3000; i++ {
			obs.Vel, obs.Speed, obs.Move = core.Vec3{}, 0, "still"
			obs.Still += 0.1
			s.Step(0.1, env, obs)
			if s.find(id).flags&core.FlagWary == 0 {
				return float32(i) * 0.1, true
			}
		}
		return 300, true
	}
	n := 0
	var tSit, tProne float32
	for seed := int64(1); seed <= 6; seed++ {
		a, ok1 := calmAfter(seed, true, false)
		b, ok2 := calmAfter(seed, false, true)
		if !ok1 || !ok2 {
			continue
		}
		n++
		tSit += a
		tProne += b
	}
	if n == 0 {
		t.Fatal("no wary robin to settle")
	}
	t.Logf("%d robins: calm after sitting %.1f s, lying still %.1f s (sums)", n, tSit, tProne)
	if tProne >= 300*float32(n) {
		t.Fatal("lying still never settled the robin")
	}
	if tProne > tSit+0.5 {
		t.Fatalf("lying still settled birds slower (%.1f s) than sitting (%.1f s)", tProne, tSit)
	}
}
