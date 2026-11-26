package game

import (
	"encoding/json"
	"math"
	"sort"
	"strings"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/field"
	"github.com/Rik-Stokmans/wildcall/internal/progress"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// binoPose is the player at feet with the binoculars raised, aimed at a point.
func binoPose(feet, at core.Vec3) proto.Pose {
	p := standPose(feet, 0)
	eye := core.V(p.X, p.Y, p.Z)
	p.Yaw, p.Pitch = aim(eye, at)
	p.Tool, p.Raised, p.Zoom, p.FOV = "binoculars", true, 6, 70.0/6
	return p
}

type nestSpot struct {
	n       core.Nest
	feet    core.Vec3
	clarity float32
}

// visibleNests finds nests around the cabin together with a place to stand from
// which each is seen clearly through binoculars, best first.
func visibleNests(h *harness) []nestSpot {
	s := h.s
	cabin, _ := s.world.POI("cabin")
	ctx := s.fieldCtx()
	var out []nestSpot
	for _, n := range s.sim.Nests(cabin.Pos, 450, nil) {
		best := nestSpot{n: n}
		for _, r := range []float32{6, 8, 11, 15} {
			for a := 0; a < 16; a++ {
				f := n.Pos.Add(core.HeadingDir(float32(a) * math.Pi / 8).Scale(r))
				f.Y = s.world.HeightAt(f.X, f.Z)
				if f.Y < 0.2 {
					continue
				}
				if v := field.NestView(ctx, n, binoPose(f, n.Pos)); v.Clarity > best.clarity {
					best.feet, best.clarity = f, v.Clarity
				}
			}
		}
		if best.clarity >= 0.65 {
			out = append(out, best)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].clarity > out[j].clarity })
	return out
}

// lookAt holds the binoculars on a point for a number of ticks.
func (h *harness) lookAt(feet, at core.Vec3, ticks int) {
	h.stand(feet, core.HeadingTo(feet, at))
	for i := 0; i < ticks; i++ {
		h.send(proto.CPose, binoPose(feet, at))
		h.tick(1)
	}
}

// springWithNests sets the season to spring and lets the ecosystem build its nests.
func springWithNests(t *testing.T, h *harness) []nestSpot {
	t.Helper()
	h.s.clock.SetSeason(core.Spring)
	h.s.clock.Set(10, h.s.clock.Env().Day)
	h.s.clock.SetSeason(core.Spring)
	h.s.clock.SetWeather(core.WeatherSunny)
	h.standNear("cabin", 6)
	h.tick(5)
	spots := visibleNests(h)
	if len(spots) < 2 {
		t.Fatalf("only %d clearly visible nests around the cabin in spring (%d nests)", len(spots), len(h.s.sim.Nests(h.ground(0, 0), 2000, nil)))
	}
	return spots
}

func TestNestFoundByObservation(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	spots := springWithNests(t, h)
	sp := spots[0]
	owner := s.spAt(sp.n.Species)
	t.Logf("watching %s (%s, %s) from %.1f m, clarity %.2f; owner %s", nestKey(sp.n.ID), sp.n.Site,
		field.NestStageKey(sp.n.Stage), sp.feet.Dist(sp.n.Pos), sp.clarity, owner.ID)
	h.take()
	xp0 := s.p.XPTotal
	h.lookAt(sp.feet, sp.n.Pos, 25)
	ms := h.take()

	// The nests message streams it, without its owner.
	d, ok := lastOf(ms, proto.SNests)
	if !ok {
		t.Fatal("no nests message")
	}
	nm := decodeAs[struct {
		N [][]float64 `json:"n"`
	}](t, d)
	found := false
	for _, row := range nm.N {
		if len(row) != 8 {
			t.Fatalf("nest row %v", row)
		}
		if uint32(row[0]) == sp.n.ID {
			found = true
			if proto.NestSites[int(row[1])] != sp.n.Site || uint8(row[2]) != sp.n.Stage {
				t.Fatalf("row %v for %+v", row, sp.n)
			}
		}
	}
	if !found {
		t.Fatalf("nest %d not streamed (%d rows)", sp.n.ID, len(nm.N))
	}

	e := s.nestEntry(nestKey(sp.n.ID))
	if e == nil {
		t.Fatal("watching a nest clearly did not find it")
	}
	if e.Site != sp.n.Site || e.Species != owner.ID {
		t.Fatalf("entry %+v", e)
	}
	if s.p.XPTotal-xp0 < progress.XPBehavior {
		t.Fatalf("nest found paid %d XP", s.p.XPTotal-xp0)
	}
	toast := false
	for _, m := range ms {
		if m.T == proto.SToast && strings.Contains(string(m.D), "Nest found") {
			toast = true
		}
	}
	if !toast {
		t.Fatal("no Nest found toast")
	}
	// The client sees no owner while the species is unidentified.
	view := s.clientView()
	for _, ne := range view.Journal.Nests {
		if ne.ID == e.ID && ne.Species != "" {
			t.Fatalf("client view names the owner of %s", ne.ID)
		}
	}
	leakScan(t, h, owner)

	// A second nest of the same species pays nothing more.
	xp1 := s.p.XPTotal
	other := sp.n
	other.ID ^= 0x5a5a5a5a
	s.foundNest(other, "", 0)
	if s.p.XPTotal != xp1 || s.nestEntry(nestKey(other.ID)) == nil {
		t.Fatalf("second nest of %s: +%d XP", owner.ID, s.p.XPTotal-xp1)
	}

	// Once the owner is identified, the journal names it.
	if _, err := s.Debug("identify", owner.ID); err != nil {
		t.Fatal(err)
	}
	named := false
	for _, ne := range s.clientView().Journal.Nests {
		named = named || ne.ID == e.ID && ne.Species == owner.ID
	}
	if !named {
		t.Fatal("nest owner not filled in after identification")
	}
}

func TestNestFoundByPhoto(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	spots := springWithNests(t, h)
	var sp nestSpot
	for _, c := range spots {
		if c.n.Stage != core.NestOld {
			sp = c
			break
		}
	}
	if sp.n.ID == 0 {
		sp = spots[0]
	}
	owner := s.spAt(sp.n.Species)
	h.stand(sp.feet, core.HeadingTo(sp.feet, sp.n.Pos))
	h.tick(2)
	h.take()
	eye := sp.feet.Add(core.V(0, core.EyeHeight, 0))
	yaw, pitch := aim(eye, sp.n.Pos)
	xp0 := s.p.XPTotal
	h.send(proto.CPhoto, proto.Photo{X: eye.X, Y: eye.Y, Z: eye.Z, Yaw: yaw, Pitch: pitch, FOV: 18, Aspect: 1.5, Sharp: 1, Img: testJPEG})
	d, ok := h.last(proto.SPhoto)
	if !ok {
		t.Fatal("no photo result")
	}
	res := decodeAs[proto.PhotoResult](t, d)
	t.Logf("photo of %s (%s): %d stars, tags %v, notes %v, xp %d", nestKey(sp.n.ID), sp.n.Site, res.Photo.Stars, res.Photo.Tags, res.Notes, res.XP)
	if !containsStr(res.Photo.Tags, "nest") {
		t.Fatalf("photo not tagged with the nest: %v", res.Photo.Tags)
	}
	e := s.nestEntry(nestKey(sp.n.ID))
	if e == nil || e.Photo != res.Photo.ID {
		t.Fatalf("photo did not record the nest: %+v", e)
	}
	if res.Photo.Stars > 0 && progress.Awarded(s.p, progress.SrcPhoto, "nest/"+owner.ID) == 0 {
		t.Fatal("first nest photo paid no photo XP")
	}
	if s.p.XPTotal <= xp0 {
		t.Fatal("no XP for a first nest photo")
	}
	for _, n := range res.Notes {
		if strings.Contains(strings.ToLower(n), strings.ToLower(owner.Name)) {
			t.Fatalf("photo note names the owner: %q", n)
		}
	}
	// A nest photo can go to the research board.
	if len(res.Photo.Subjects) == 0 && res.Photo.Stars > 0 {
		h.standNear("cabin", 6)
		h.take()
		h.send(proto.CCabin, proto.CabinAction{Action: "submit", ID: res.Photo.ID})
		if msg, bad := hasError(h.take()); bad {
			t.Fatalf("submit a nest photo: %s", msg)
		}
	}
	leakScan(t, h, owner)
}

// leakScan checks that nothing the session sent (outside the welcome's catalogs and
// the candidate tables) names the owner of a nest the player has not identified.
func leakScan(t *testing.T, h *harness, owner *core.Species) {
	t.Helper()
	h.take()
	if h.s.identified(owner.ID) {
		t.Fatal("leak scan with an identified owner proves nothing")
	}
	name, id := strings.ToLower(owner.Name), owner.ID
	for _, m := range h.all {
		if m.T == proto.SWelcome {
			continue
		}
		js := strings.ToLower(stripCandidates(string(m.D)))
		if strings.Contains(js, id) || strings.Contains(js, name) {
			i := strings.Index(js, id)
			if i < 0 {
				i = strings.Index(js, name)
			}
			t.Fatalf("%s message names the nest owner %s: …%s…", m.T, id, js[max(0, i-80):min(len(js), i+80)])
		}
	}
	// Raw nests frames never carry a species index either: 8 numbers per nest.
	for _, m := range h.all {
		if m.T != proto.SNests {
			continue
		}
		var nm map[string]json.RawMessage
		if err := json.Unmarshal(m.D, &nm); err != nil || len(nm) != 1 {
			t.Fatalf("nests payload %s", m.D)
		}
	}
}

// TestNestNarrationNeverNamesOwner: the narrator's nest and foraging lines never name
// an unidentified species (contract §8), over many finds.
func TestNestNarrationNeverNamesOwner(t *testing.T) {
	h := newHarness(t, true)
	s := h.s
	spots := springWithNests(t, h)
	for i, sp := range spots {
		if i >= 6 {
			break
		}
		h.lookAt(sp.feet, sp.n.Pos, 18)
		h.tick(600) // let the narrator's pacing recover
	}
	h.take()
	var lines []proto.Narration
	for _, m := range h.all {
		if m.T == proto.SNarrate {
			lines = append(lines, decodeAs[proto.Narration](t, m.D))
		}
	}
	nestLines := 0
	for _, n := range lines {
		t.Logf("narrator [%s]: %s", n.Kind, n.Text)
		if n.Kind == "discovery" {
			nestLines++
		}
		low := strings.ToLower(n.Text)
		for i := range s.species {
			sp := &s.species[i]
			if !s.identified(sp.ID) && (strings.Contains(low, strings.ToLower(sp.Name)) || strings.Contains(low, sp.ID)) {
				t.Errorf("narrator names unidentified %s: %q", sp.ID, n.Text)
			}
		}
	}
	if len(s.p.Journal.Nests) == 0 {
		t.Fatal("no nests found")
	}
	if nestLines == 0 {
		t.Errorf("the narrator said nothing about %d nests found", len(s.p.Journal.Nests))
	}
}

// narrationSpoilers fails if any narrator line sent so far names a species the
// player has not identified; it returns the lines.
func narrationSpoilers(t *testing.T, h *harness) []proto.Narration {
	t.Helper()
	h.take()
	var lines []proto.Narration
	for _, m := range h.all {
		if m.T != proto.SNarrate {
			continue
		}
		n := decodeAs[proto.Narration](t, m.D)
		lines = append(lines, n)
		low := strings.ToLower(n.Text)
		for i := range h.s.species {
			sp := &h.s.species[i]
			if !h.s.identified(sp.ID) && (strings.Contains(low, strings.ToLower(sp.Name)) || strings.Contains(low, sp.ID)) {
				t.Errorf("narrator names unidentified %s: %q", sp.ID, n.Text)
			}
		}
	}
	return lines
}
