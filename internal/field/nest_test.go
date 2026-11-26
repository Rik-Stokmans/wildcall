package field

import (
	"math"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// nestAt is a nest of the test robin at pos whose entrance (for holes) faces the
// observer at the origin.
func nestAt(id uint32, site string, stage uint8, pos core.Vec3, size float32) core.Nest {
	return core.Nest{ID: id, Species: spRobin, Site: site, Stage: stage, Pos: pos, Size: size, Yaw: core.HeadingTo(pos, origin)}
}

// noLeak checks that nothing the session forwards names the owner of a nest.
func noLeak(t *testing.T, c *Context, s PhotoScore) {
	t.Helper()
	all := strings.Join(append(append([]string{}, s.Meta.Tags...), s.Notes...), "|")
	for _, sub := range s.Meta.Subjects {
		all += "|" + sub.Species + "|" + sub.Mystery
	}
	for _, sp := range c.Species {
		if strings.Contains(all, sp.ID) || strings.Contains(all, sp.Name) {
			t.Fatalf("photo output names %s: %q", sp.ID, all)
		}
	}
}

func TestPhotoOfANestAlone(t *testing.T) {
	c, _ := newCtx()
	n := nestAt(11, "cup_fork", core.NestChicks, north(6, 0.5), 0.2)
	s := ScorePhotoWith(c, shotAt(n.Pos, 10), nil, []core.Nest{n})
	m := s.Meta
	if m.Stars < 2 || !s.NestSubject || len(s.Nests) != 1 || len(m.Subjects) != 0 || len(s.Birds) != 0 {
		t.Fatalf("a clear nest photo should be a valid subject: %+v (nests %+v)", m, s.Nests)
	}
	if !hasTag(m.Tags, "nest") || !hasTag(m.Tags, "nest:chicks") {
		t.Errorf("nest tags missing: %v", m.Tags)
	}
	for _, tag := range m.Tags {
		if strings.HasPrefix(tag, "behavior:") || tag == "flight" || tag == "rare" {
			t.Errorf("a nest photo carries the bird tag %q", tag)
		}
	}
	if s.Nests[0].ID != 11 || s.Nests[0].Species != spRobin || s.Nests[0].Stage != core.NestChicks {
		t.Errorf("server truth wrong: %+v", s.Nests[0])
	}
	if !hasNote(s.Notes, "A nest full of hungry chicks") {
		t.Errorf("notes %v", s.Notes)
	}
	noLeak(t, c, s)

	// The stage tag follows the nest.
	for st, key := range map[uint8]string{core.NestOld: "nest:old", core.NestBuilding: "nest:building", core.NestEggs: "nest:eggs"} {
		n.Stage = st
		if s := ScorePhotoWith(c, shotAt(n.Pos, 10), nil, []core.Nest{n}); !hasTag(s.Meta.Tags, key) {
			t.Errorf("stage %d: tags %v", st, s.Meta.Tags)
		}
	}
}

func TestPhotoNestBonusWithABird(t *testing.T) {
	c, _ := newCtx()
	c.Stats.CamQuality = 1 // so the camera's own cap does not hide the bonus
	b := birdAt(1, spRobin, north(5, 0), core.ActNesting, 0.2)
	n := nestAt(12, "cup_shrub", core.NestEggs, core.V(b.Pos.X+0.1, b.Pos.Y-0.08, b.Pos.Z), 0.12)
	ph := shotAt(b.Pos, 10)
	ph.Sharp = 0.7 // an ordinary shot, well short of perfect
	plain := ScorePhotoWith(c, ph, []core.BirdState{b}, nil)
	with := ScorePhotoWith(c, ph, []core.BirdState{b}, []core.Nest{n})
	if with.Meta.Score <= plain.Meta.Score {
		t.Errorf("a nest in the shot should add a bonus: %d vs %d", with.Meta.Score, plain.Meta.Score)
	}
	if with.NestSubject || len(with.Meta.Subjects) != 1 {
		t.Errorf("the adult at the nest stays the main subject: %+v", with)
	}
	for _, tag := range []string{"nest", "nest:eggs", "behavior:nesting"} {
		if !hasTag(with.Meta.Tags, tag) {
			t.Errorf("tag %q missing: %v", tag, with.Meta.Tags)
		}
	}
	if hasTag(plain.Meta.Tags, "nest") {
		t.Errorf("no nest, no nest tag: %v", plain.Meta.Tags)
	}
	noLeak(t, c, with)
}

func TestPhotoNestMustBeClearAndInFrame(t *testing.T) {
	c, flat := newCtx()
	// Nothing at all: still 0 stars, even with a nest behind the camera.
	behind := nestAt(13, "cup_fork", core.NestEggs, core.V(origin.X, origin.Y, origin.Z+6), 0.2)
	if s := ScorePhotoWith(c, shotAt(north(30, 0), 20), nil, []core.Nest{behind}); s.Meta.Stars != 0 || len(s.Nests) != 0 || hasTag(s.Meta.Tags, "nest") {
		t.Errorf("empty photo with a nest out of frame: %+v", s.Meta)
	}
	// A tiny nest far away is not in the photo.
	far := nestAt(14, "cup_fork", core.NestEggs, north(120, 0), 0.1)
	if s := ScorePhotoWith(c, shotAt(far.Pos, 20), nil, []core.Nest{far}); s.Meta.Stars != 0 {
		t.Errorf("a speck of a nest at 120 m: %+v", s.Meta)
	}
	// A nest behind a screen of foliage is not either.
	flat.Occ = func(from, to core.Vec3) float32 { return 0.8 }
	hid := nestAt(15, "dome", core.NestEggs, north(6, 0), 0.12)
	if s := ScorePhotoWith(c, shotAt(hid.Pos, 10), nil, []core.Nest{hid}); len(s.Nests) != 0 {
		t.Errorf("a hidden nest counted: %+v", s.Nests)
	}
}

func TestNestViewFollowsTheClarityModel(t *testing.T) {
	c, _ := newCtx()
	p := standing()
	near := nestAt(20, "cup_fork", core.NestEggs, north(5, 0.5), 0.2)
	v := NestView(c, near, lookAt(p, near.Pos))
	if v.Clarity < NestFoundClarity {
		t.Fatalf("an open cup nest 5 m away should be clear: %+v", v)
	}
	// Farther away it fades - and binoculars bring it back.
	farN := nestAt(21, "cup_fork", core.NestEggs, north(40, 2), 0.2)
	naked := NestView(c, farN, lookAt(p, farN.Pos))
	glass := NestView(c, farN, withBinoculars(lookAt(p, farN.Pos), 8))
	if naked.Clarity >= NestFoundClarity || glass.Clarity < NestFoundClarity || naked.Blocked != "distance" {
		t.Errorf("40 m: naked %+v, binoculars %+v", naked, glass)
	}
	// A dome deep in cover is harder to see than an open platform.
	dome := near
	dome.Site = "dome"
	if NestView(c, dome, lookAt(p, dome.Pos)).Clarity >= v.Clarity {
		t.Errorf("a dome should be harder to see than an open cup")
	}
	// A tree hole shows its entrance only from the front.
	hole := nestAt(22, "cavity", core.NestEggs, north(6, 1), 0.12)
	front := NestView(c, hole, lookAt(p, hole.Pos)).Clarity
	hole.Yaw += math.Pi
	if back := NestView(c, hole, lookAt(p, hole.Pos)).Clarity; back >= front*0.6 {
		t.Errorf("a hole facing away: %.2f vs %.2f from the front", back, front)
	}
	// Darkness hides nests like birds.
	c.Env.Light = 0
	if d := NestView(c, near, lookAt(p, near.Pos)); d.Clarity >= v.Clarity {
		t.Errorf("night did not reduce clarity")
	}
}

func TestObservedNestNeedsTheViewOnIt(t *testing.T) {
	c, _ := newCtx()
	p := standing()
	n := nestAt(30, "cup_fork", core.NestChicks, north(6, 0.5), 0.2)
	other := nestAt(31, "cup_fork", core.NestEggs, core.V(origin.X+6, origin.Y+0.5, origin.Z), 0.2)
	nests := []core.Nest{other, n}
	s, ok := ObservedNest(c, lookAt(p, n.Pos), nests)
	if !ok || s.Nest.ID != 30 || s.View.Clarity < NestFoundClarity {
		t.Fatalf("looking straight at a clear nest: %+v %v", s, ok)
	}
	// Looking 30 degrees off: the nest is in the field of view but not observed.
	off := lookAt(p, n.Pos)
	off.Yaw -= 0.5
	if _, ok := ObservedNest(c, off, []core.Nest{n}); ok {
		t.Error("a nest 30 degrees off the axis counted as observed")
	}
	// Dwell: the watch reports a nest only after the view has rested on it, and once.
	var w NestWatch
	aim := lookAt(p, n.Pos)
	reports := 0
	for i := 0; i < 12; i++ { // three seconds at 4 Hz
		if got, ok := w.Tick(c, 0.25, aim, nests); ok {
			reports++
			if got.Nest.ID != 30 || i < 3 {
				t.Fatalf("tick %d: reported %+v too early or wrongly", i, got)
			}
		}
	}
	if reports != 1 {
		t.Fatalf("nest reported %d times during one look", reports)
	}
	// A quick sweep across it finds nothing.
	w.Reset()
	if _, ok := w.Tick(c, 0.25, aim, nests); ok {
		t.Fatal("a glance found the nest")
	}
	if _, ok := w.Tick(c, 0.25, off, nests); ok {
		t.Fatal("found while looking away")
	}
}
