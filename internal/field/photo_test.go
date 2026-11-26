package field

import (
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// shotAt aims a sharp, steady camera at a point with the given vertical FOV.
func shotAt(target core.Vec3, fov float32) proto.Photo {
	p := lookAt(standing(), target)
	return proto.Photo{X: p.X, Y: p.Y, Z: p.Z, Yaw: p.Yaw, Pitch: p.Pitch, FOV: fov, Aspect: 1.5, Sharp: 1, Shake: 0}
}

func hasTag(tags []string, tag string) bool { return contains(tags, tag) }

func hasNote(notes []string, note string) bool { return contains(notes, note) }

func TestPhotoEmptySky(t *testing.T) {
	c, _ := newCtx()
	s := ScorePhoto(c, shotAt(north(30, 20), 20), nil)
	if s.Meta.Stars != 0 || s.Meta.Score != 0 || len(s.Meta.Subjects) != 0 || len(s.Birds) != 0 {
		t.Errorf("empty sky should score 0 stars: %+v", s.Meta)
	}
	// A bird outside the frame does not count either.
	b := birdAt(1, spRobin, core.V(origin.X+20, origin.Y, origin.Z), core.ActPerched, 0.1)
	if s := ScorePhoto(c, shotAt(north(30, 0), 20), []core.BirdState{b}); s.Meta.Stars != 0 {
		t.Errorf("bird outside the frame: %d stars", s.Meta.Stars)
	}
}

func TestPhotoGoodShot(t *testing.T) {
	c, _ := newCtx()
	c.Stats.CamQuality = 0.8
	b := birdAt(1, spRobin, north(4, 0), core.ActFeeding, 0.1)
	s := ScorePhoto(c, shotAt(b.Pos, 8), []core.BirdState{b})
	m := s.Meta
	if m.Stars < 4 {
		t.Errorf("centred, sharp, close bird in good light: %d stars (%+v)", m.Stars, m)
	}
	if !hasTag(m.Tags, "behavior:feeding") {
		t.Errorf("behaviour tag missing: %v", m.Tags)
	}
	if len(m.Subjects) != 1 || m.Subjects[0].Species != "" || m.Subjects[0].Behavior != "feeding" {
		t.Errorf("unidentified subject must not be named: %+v", m.Subjects)
	}
	if s.Birds[0].Species != spRobin {
		t.Errorf("server-side truth missing")
	}
	for _, v := range []int{m.Focus, m.Composition, m.Distance, m.Lighting, m.Visibility} {
		if v < 0 || v > 100 {
			t.Errorf("sub-score out of range: %+v", m)
		}
	}
	// Identified species are named.
	c.Know = &Memory{Known: map[string]bool{"test_robin": true}}
	if s := ScorePhoto(c, shotAt(b.Pos, 8), []core.BirdState{b}); s.Meta.Subjects[0].Species != "test_robin" {
		t.Errorf("identified subject should carry its id")
	}
	// A flying subject is tagged flight.
	f := b
	f.Act = core.ActFlying
	if s := ScorePhoto(c, shotAt(f.Pos, 8), []core.BirdState{f}); !hasTag(s.Meta.Tags, "flight") {
		t.Errorf("flight tag missing: %v", s.Meta.Tags)
	}
}

func TestPhotoCamQualityCaps(t *testing.T) {
	c, _ := newCtx()
	b := birdAt(1, spRobin, north(4, 0), core.ActPerched, 0.1)
	ph := shotAt(b.Pos, 8)
	c.Stats.CamQuality = 1
	best := ScorePhoto(c, ph, []core.BirdState{b})
	c.Stats.CamQuality = 0.5
	capped := ScorePhoto(c, ph, []core.BirdState{b})
	if capped.Meta.Score > 70 || !capped.Capped {
		t.Errorf("CamQuality 0.5 caps at 70: score %d capped %v", capped.Meta.Score, capped.Capped)
	}
	if best.Meta.Score <= capped.Meta.Score {
		t.Errorf("better camera should score higher: %d <= %d", best.Meta.Score, capped.Meta.Score)
	}
	c.Stats.CamQuality = 0
	if s := ScorePhoto(c, ph, []core.BirdState{b}); s.Meta.Score > 40 {
		t.Errorf("CamQuality 0 caps at 40: %d", s.Meta.Score)
	}
}

func TestPhotoNotesAndTags(t *testing.T) {
	c, _ := newCtx()
	c.Stats.CamQuality = 1
	b := birdAt(1, spRobin, north(4, 0), core.ActPerched, 0.1)

	soft := shotAt(b.Pos, 8)
	soft.Sharp = 0.6
	if s := ScorePhoto(c, soft, []core.BirdState{b}); !hasNote(s.Notes, "Slightly soft - let the focus settle") {
		t.Errorf("soft focus note missing: %v", s.Notes)
	}

	eve := *c
	eve.Env.Time, eve.Env.Light = 19.5, 0.5
	s := ScorePhoto(&eve, shotAt(b.Pos, 8), []core.BirdState{b})
	if !hasNote(s.Notes, "Lovely evening light") || !hasTag(s.Meta.Tags, "golden hour") {
		t.Errorf("golden hour: notes %v tags %v", s.Notes, s.Meta.Tags)
	}

	far := birdAt(2, spRobin, north(40, 0), core.ActPerched, 0.1)
	if s := ScorePhoto(c, shotAt(far.Pos, 20), []core.BirdState{far}); !hasNote(s.Notes, "Too far for detail") || s.Meta.Stars == 0 {
		t.Errorf("far bird: stars %d notes %v", s.Meta.Stars, s.Notes)
	}

	hid := birdAt(3, spWren, north(4, -0.6), core.ActPerched, 0.9)
	if s := ScorePhoto(c, shotAt(hid.Pos, 8), []core.BirdState{hid}); !hasNote(s.Notes, "Hidden behind foliage") {
		t.Errorf("hidden bird: %v (vis %d)", s.Notes, s.Meta.Visibility)
	}

	// Score ordering: a sharp shot beats a shaky one.
	shaky := shotAt(b.Pos, 8)
	shaky.Shake = 1
	if a, z := ScorePhoto(c, shotAt(b.Pos, 8), []core.BirdState{b}), ScorePhoto(c, shaky, []core.BirdState{b}); z.Meta.Score >= a.Meta.Score {
		t.Errorf("shake should cost score")
	}

	// Exceptional + rare tag only for an identified rare subject.
	r := b
	r.Flags = core.FlagRarePlumage
	s = ScorePhoto(c, shotAt(r.Pos, 8), []core.BirdState{r})
	if !s.Rare || hasTag(s.Meta.Tags, "rare") {
		t.Errorf("rare plumage of an unknown species: Rare=%v tags=%v", s.Rare, s.Meta.Tags)
	}
	c.Know = &Memory{Known: map[string]bool{"test_robin": true}}
	s = ScorePhoto(c, shotAt(r.Pos, 8), []core.BirdState{r})
	if !hasTag(s.Meta.Tags, "rare") {
		t.Errorf("identified rare subject should be tagged rare: %v", s.Meta.Tags)
	}
	if s.Meta.Score >= 90 && !hasTag(s.Meta.Tags, "exceptional") {
		t.Errorf("score %d without exceptional tag", s.Meta.Score)
	}
}

func TestPhotoMomentBonus(t *testing.T) {
	c, _ := newCtx()
	c.Stats.CamQuality = 1
	b := birdAt(1, spRobin, north(6, 0), core.ActBathing, 0.1)
	ph := shotAt(b.Pos, 8)
	ph.Sharp = 0.8
	base := ScorePhoto(c, ph, []core.BirdState{b}).Meta.Score
	c.Stats.MomentBonus = 1
	if got := ScorePhoto(c, ph, []core.BirdState{b}).Meta.Score; got <= base {
		t.Errorf("MomentBonus should add to behaviour photos: %d <= %d", got, base)
	}
}
