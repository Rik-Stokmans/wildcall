package game

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/content"
	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
	"github.com/Rik-Stokmans/wildcall/internal/world"
)

// singerSeeds are the worlds the singer tests run on.
var singerSeeds = []string{testSeedText, "alpha", "bramble", "wildcall", "seed-5"}

// The tutorial singer's territory: three or four low, exposed posts, close together,
// in view from the old trail, a short walk from the cabin, in every world.
func TestSingerTerritoryOnManySeeds(t *testing.T) {
	for _, txt := range singerSeeds {
		w := sharedWorld(world.SeedFromText(txt))
		pl := planSinger(w)
		if !pl.ok {
			t.Errorf("%s: no singer territory", txt)
			continue
		}
		cabin, _ := w.POI("cabin")
		trail := trailNearCabin(w, cabin.Pos, cabin.Pos)
		t.Logf("%s: %q, %d posts, %.0f m from the cabin, radius %.0f m, relax %d", txt, pl.name, len(pl.posts), pl.centre.DistXZ(cabin.Pos), pl.radius, pl.relax)
		if len(pl.posts) < 3 {
			t.Errorf("%s: only %d posts", txt, len(pl.posts))
		}
		if d := pl.centre.DistXZ(cabin.Pos); d < 50 || d > 150 {
			t.Errorf("%s: territory %.0f m from the cabin", txt, d)
		}
		for i, pc := range pl.posts {
			h := pc.Pos.Y - w.HeightAt(pc.Pos.X, pc.Pos.Z)
			dt, at := distToPolyline(pc.Pos, trail)
			eye := core.V(at.X, w.HeightAt(at.X, at.Z)+core.EyeHeight, at.Z)
			occ := w.Occlusion(eye, pc.Pos.Add(core.V(0, 0.08, 0)))
			t.Logf("   post %d: %s h %.2f m, cover %.2f, %.1f m from the trail, view occlusion %.2f", i, kindWord(pc.Kind), h, pc.Cover, dt, occ)
			if pl.relax == 0 && (h < singerPostMinH-0.01 || h > singerPostMaxH+0.01 || pc.Cover > singerCover || occ > singerViewOcc) {
				t.Errorf("%s: post %d breaks the strict rules", txt, i)
			}
			next := pl.posts[(i+1)%len(pl.posts)]
			if d := pc.Pos.DistXZ(next.Pos); d > singerLeg+0.01 {
				t.Errorf("%s: leg %d is %.1f m", txt, i, d)
			}
		}
		if again := planSinger(w); len(again.posts) != len(pl.posts) || again.centre != pl.centre {
			t.Errorf("%s: the plan is not deterministic", txt)
		}
	}
}

// The singer exists while the tutorial is open, carries a search area once the
// quest is accepted, survives a reload as the same bird, and stops being special
// once the quest is complete.
func TestSingerLifecycle(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	id := s.SingerID()
	if id == 0 {
		t.Fatal("no singer in a fresh adventure")
	}
	if _, ok := s.sim.Get(id); !ok {
		t.Fatal("singer id not in the ecosystem")
	}
	_, _ = h.talkUntil("npc_mara", "mara", "accept:unseen_singer")
	h.tick(2)
	st := s.p.Quests[content.TutorialQuest]
	if st == nil || st.Status != content.StatusActive || st.Area == nil {
		t.Fatalf("active tutorial without a search area: %+v", st)
	}
	if v := s.clientView(); v.Quests[content.TutorialQuest].Area == nil {
		t.Fatal("the client view lost the search area")
	}
	t.Logf("area: %+v", *st.Area)
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}
	s2 := newSession(t, h.dir, "ignored", true)
	if s2.SingerID() != id {
		t.Fatalf("reloaded singer is another bird: %d vs %d", s2.SingerID(), id)
	}
	// Completing the quest releases him.
	st.Status = content.StatusComplete
	s.syncSinger()
	if s.SingerID() != 0 || st.Area != nil {
		t.Fatalf("singer still special after the quest: id %d area %+v", s.SingerID(), st.Area)
	}
}

// TestSingerFiveMinutes logs where the singer is over five minutes while a scripted
// player approaches: a walk in from 45 m to 12 m, a quiet wait, a crouched creep to
// 3 m, a walk straight at him, then standing still. He must stay in his territory,
// never fall silent for more than ~40 s, and sing again within 15 s of a push.
func TestSingerFiveMinutes(t *testing.T) {
	h := newHarnessSeed(t, "wildcall")
	s := h.s
	_, _ = h.talkUntil("npc_mara", "mara", "accept:unseen_singer")
	id := s.SingerID()
	pl := s.singer.plan
	b, _ := s.sim.Get(id)
	// Start 45 m out on the trail side.
	cabin, _ := s.world.POI("cabin")
	trail := trailNearCabin(s.world, cabin.Pos, cabin.Pos)
	_, at := distToPolyline(pl.centre, trail)
	dir := core.HeadingTo(pl.centre, at)
	feet := pl.centre.Add(core.HeadingDir(dir).Scale(45))
	feet.Y = s.world.HeightAt(feet.X, feet.Z)
	s.Teleport(feet, core.HeadingTo(feet, b.Pos))

	var lastSong, lastPush float32 = 0, -1
	silentMax, pushToSong := float32(0), float32(0)
	pushes := 0
	const dt = 0.1
	for i := 0; i < 3000; i++ {
		now := float32(i) * dt
		b, _ = s.sim.Get(id)
		d := feet.DistXZ(b.Pos)
		var speed float32
		move, crouch := "still", false
		phase := ""
		switch {
		case now < 60:
			phase = "walk in"
			if d > 12 {
				speed, move = 1.4, "walk"
			}
		case now < 120:
			phase = "wait"
		case now < 180:
			phase = "creep"
			if d > 3 {
				speed, move, crouch = 0.8, "crouch", true
			}
		case now < 240:
			phase = "walk at him"
			if d > 1.5 {
				speed, move = 1.4, "walk"
			}
		default:
			phase = "stand"
		}
		yaw := core.HeadingTo(feet, b.Pos)
		if speed > 0 {
			feet = feet.Add(core.HeadingDir(yaw).Scale(speed * dt))
			feet.Y = s.world.HeightAt(feet.X, feet.Z)
		}
		eye := feet.Add(core.V(0, core.EyeHeight, 0))
		if crouch {
			eye.Y -= 0.6
		}
		h.send(proto.CPose, proto.Pose{X: eye.X, Y: eye.Y, Z: eye.Z, Yaw: yaw, Speed: speed, Move: move, Crouch: crouch, Tool: "none", FOV: 70, Zoom: 1, Sharp: 1})
		h.tick(1)
		for _, m := range h.take() {
			if m.T == proto.SCall && decodeAs[proto.CallMsg](t, m.D).Bird == id {
				if lastPush >= 0 {
					pushToSong = max(pushToSong, now-lastPush)
					lastPush = -1
				}
				lastSong = now
			}
		}
		silentMax = max(silentMax, now-lastSong)
		info, _ := s.sim.CircuitOf(id)
		if info.Pushes > pushes {
			pushes = info.Pushes
			lastPush = now
		}
		if c := b.Pos.DistXZ(pl.centre); c > pl.radius {
			t.Errorf("t=%.0f s: he is %.1f m from his territory's centre (radius %.0f)", now, c, pl.radius)
		}
		if i%100 == 0 {
			g := s.world.HeightAt(b.Pos.X, b.Pos.Z)
			t.Logf("t=%3.0f s %-11s player %5.1f m  post %d  at (%.1f, %.1f) %.2f m up  %-8s moving=%-5v songs %d pushes %d",
				now, phase, d, info.Post, b.Pos.X, b.Pos.Z, b.Pos.Y-g, b.Act.Key(), info.Moving, info.Songs, info.Pushes)
		}
	}
	info, _ := s.sim.CircuitOf(id)
	t.Logf("5 min: %d songs, %d pushes, %d moves, longest silence %.1f s, longest push-to-song %.1f s", info.Songs, info.Pushes, info.Moves, silentMax, pushToSong)
	if silentMax > 40 {
		t.Errorf("silent for %.1f s with the player within 60 m", silentMax)
	}
	if info.Pushes == 0 {
		t.Errorf("walking straight at him never pushed him on")
	}
	if pushToSong > 16.5 {
		t.Errorf("after a push he sang again only after %.1f s", pushToSong)
	}
}
