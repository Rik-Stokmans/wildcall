package eco

import (
	"math"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/core/coretest"
	"github.com/Rik-Stokmans/wildcall/internal/species"
)

// nestTerrain is the flat fixture plus the nest sites the plain fixture lacks: reeds
// and a steep earth bank round the pond, and a small crag with ledges and boulders
// on its western shore.
type nestTerrain struct{ *coretest.Flat }

const pondX, pondZ = 512, 1536

func (t nestTerrain) PerchesNear(x, z, radius float32, buf []core.Perch) []core.Perch {
	buf = t.Flat.PerchesNear(x, z, radius, buf)
	add := func(p core.Perch) {
		dx, dz := p.Pos.X-x, p.Pos.Z-z
		if dx*dx+dz*dz <= radius*radius {
			buf = append(buf, p)
		}
	}
	for a := 0; a < 48; a++ {
		s, c := float32(math.Sin(float64(a)*math.Pi/24)), float32(math.Cos(float64(a)*math.Pi/24))
		add(core.Perch{Pos: core.V(pondX+37*s, 0.8, pondZ-37*c), Kind: core.PerchReed, Cover: 0.7})
		add(core.Perch{Pos: core.V(pondX+39.5*s, 1.2, pondZ-39.5*c), Kind: core.PerchBank, Cover: 0.3})
	}
	for i := 0; i < 6; i++ {
		fi := float32(i)
		add(core.Perch{Pos: core.V(452+3*fi, t.H+8+fi, 1524), Kind: core.PerchLedge, Cover: 0.2})
		add(core.Perch{Pos: core.V(452+3*fi, t.H+1, 1530), Kind: core.PerchRock, Cover: 0.1})
	}
	return buf
}

// nestingSpecies are the fixture species with real-looking nest habits.
func nestingSpecies() []core.Species {
	list := coretest.Species()
	ss := [4]bool{true, true, false, false}
	list[spRobin].Nest = core.NestInfo{Site: "cup_shrub", Perches: []string{"shrub", "ground"}, HeightMin: 0, HeightMax: 3, Seasons: ss, Size: 0.12, Desc: "A cup low in cover."}
	list[spWren].Nest = core.NestInfo{Site: "dome", Perches: []string{"shrub", "ground"}, HeightMin: 0, HeightMax: 3, Seasons: ss, Size: 0.12, Desc: "A domed ball."}
	list[spBuzzard].Nest = core.NestInfo{Site: "platform", Perches: []string{"fork", "canopy"}, HeightMin: 6, HeightMax: 20, Seasons: ss, Size: 0.9, Desc: "A stick platform."}
	return list
}

func nestKey(n core.Nest) [4]float32 { return [4]float32{float32(n.ID), n.Pos.X, n.Pos.Y, n.Pos.Z} }

// Every species of the real catalog that breeds finds a nest site on the fixture
// terrain in spring, on one of its own perch kinds and inside its height range.
func TestEveryBreedingSpeciesFindsANestSite(t *testing.T) {
	cat := species.All()
	tr := nestTerrain{coretest.NewFlat()}
	s := New(tr, cat, 1)
	s.Step(0.1, envAt(1, 10), observerAt(woodPos))
	home := core.V(pondX-46, tr.H, pondZ) // woodland on the western shore, by the crag
	c := &cell{key: keyAt(home.X, home.Z)}
	s.buildCell(c)
	breeders := 0
	for i := range cat {
		sp := &cat[i]
		p := &s.prof[i]
		if sp.Nest.Site == "none" {
			if p.nest.ok {
				t.Errorf("%s: a non-breeder has a nest profile", sp.ID)
			}
			continue
		}
		breeders++
		if !p.nest.ok {
			t.Errorf("%s: breeds but has no nest profile", sp.ID)
			continue
		}
		if _, ok := p.nest.stageAt(core.Spring, 10, 0); !ok {
			t.Errorf("%s: no nest in spring", sp.ID)
		}
		pi, ok := s.nestSite(c, p, home, hash2(uint64(i), 7), nil)
		if !ok {
			t.Errorf("%s: no nest site found (perches %v)", sp.ID, sp.Nest.Perches)
			continue
		}
		pc := c.perches[pi]
		allowed := false
		for _, k := range sp.Nest.Perches {
			if k == pc.Kind.Key() {
				allowed = true
			}
		}
		if !allowed {
			t.Errorf("%s: nest on a %s perch, allowed %v", sp.ID, pc.Kind.Key(), sp.Nest.Perches)
		}
		h := s.perchHeight(pc)
		if p.nest.ground && (pc.Kind == core.PerchRock || pc.Kind == core.PerchShrub) {
			h = 0
		}
		if h < sp.Nest.HeightMin-nestHeightSlack || h > sp.Nest.HeightMax+nestHeightSlack {
			t.Errorf("%s: nest %.1f m up, range %.1f-%.1f", sp.ID, h, sp.Nest.HeightMin, sp.Nest.HeightMax)
		}
	}
	if breeders < 30 {
		t.Fatalf("only %d breeding species in the catalog", breeders)
	}
}

// In a living population every breeding fixture species has nests in spring, each on
// a valid spot, and the nests are reported to the session's radius query.
func TestPopulationNestsInSpring(t *testing.T) {
	s, tr := newTestSim(2, nestingSpecies())
	obs := observerAt(woodPos)
	s.Step(0.1, envAt(1, 10), obs)
	nests := s.Nests(woodPos, 400, nil)
	bySp := map[int]int{}
	ids := map[uint32]bool{}
	for _, n := range nests {
		bySp[n.Species]++
		if ids[n.ID] {
			t.Fatalf("duplicate nest id %d", n.ID)
		}
		ids[n.ID] = true
		if n.Stage != core.NestBuilding && n.Stage != core.NestEggs {
			t.Errorf("nest %d in stage %d on the first morning of spring", n.ID, n.Stage)
		}
		if g := tr.HeightAt(n.Pos.X, n.Pos.Z); n.Pos.Y < g || n.Pos.Y > g+21 {
			t.Errorf("nest %d at %v, ground %v", n.ID, n.Pos, g)
		}
		want := map[int]string{spRobin: "cup_shrub", spWren: "dome", spBuzzard: "platform"}[n.Species]
		if n.Site != want || n.Size <= 0 {
			t.Errorf("nest %+v: want site %s", n, want)
		}
	}
	t.Logf("nests per species %v", bySp)
	if bySp[spRobin] < 3 || bySp[spWren] < 2 || bySp[spBuzzard] < 1 {
		t.Fatalf("nests per species %v", bySp)
	}
	// Every pair member can find its nest.
	found := 0
	for _, b := range s.Near(woodPos, 400, nil) {
		if n, ok := s.NestOf(b.ID); ok {
			found++
			if n.Species != b.Species {
				t.Fatalf("bird of species %d owns a nest of species %d", b.Species, n.Species)
			}
		}
	}
	if found < len(nests) {
		t.Fatalf("%d birds know their nest, %d nests", found, len(nests))
	}
}

// Winter visitors never nest, whatever the season.
func TestWinterVisitorsNeverNest(t *testing.T) {
	cat := species.All()
	visitors := map[int]bool{}
	for i := range cat {
		if !cat[i].Seasons[core.Spring] && !cat[i].Seasons[core.Summer] {
			visitors[i] = true
			if cat[i].Nest.Site != "none" {
				t.Errorf("%s visits only in winter but has a nest site %q", cat[i].ID, cat[i].Nest.Site)
			}
		}
	}
	if len(visitors) < 3 {
		t.Fatalf("expected the redwing, brambling and snowy owl as winter visitors, got %d", len(visitors))
	}
	flat := coretest.NewFlat()
	flat.Reg = func(x, z float32) core.RegionID { return core.RegionAmberwood }
	s := New(flat, cat, 3)
	obs := observerAt(woodPos)
	for _, day := range []int{1, 6, 10, 14} { // spring, summer, autumn, winter
		s.FastForward(1, envAt(day, 11))
		s.Step(0.1, envAt(day, 11), obs)
		for _, n := range s.Nests(woodPos, 500, nil) {
			if visitors[n.Species] {
				t.Fatalf("day %d: a %s nest", day, cat[n.Species].ID)
			}
		}
	}
	if n := len(s.Nests(woodPos, 500, nil)); n == 0 {
		t.Fatal("no nests at all in Amberwood")
	}
}

// The same nests (ids and places) are found when a cell comes back to life, and two
// worlds with the same seed have the same nests.
func TestNestsStableAndDeterministic(t *testing.T) {
	run := func() ([]core.Nest, []core.Nest) {
		s, _ := newTestSim(5, nestingSpecies())
		obs := observerAt(woodPos)
		env := envAt(2, 9)
		s.Step(0.1, env, obs)
		before := s.Nests(woodPos, 250, nil)
		// Walk far away so every cell here is retired, then come back.
		obs.Pos.X += 4000
		for i := 0; i < 400; i++ {
			s.Step(0.1, env, obs)
		}
		if n := len(s.Nests(woodPos, 250, nil)); n != 0 {
			t.Fatalf("%d nests reported in retired cells", n)
		}
		obs.Pos = observerAt(woodPos).Pos
		for i := 0; i < 400; i++ {
			s.Step(0.1, env, obs)
		}
		return before, s.Nests(woodPos, 250, nil)
	}
	a1, a2 := run()
	b1, _ := run()
	if len(a1) == 0 || len(a1) != len(a2) || len(a1) != len(b1) {
		t.Fatalf("nest counts %d / %d / %d", len(a1), len(a2), len(b1))
	}
	set := func(l []core.Nest) map[[4]float32]core.Nest {
		m := map[[4]float32]core.Nest{}
		for _, n := range l {
			m[nestKey(n)] = n
		}
		return m
	}
	m1, m2, m3 := set(a1), set(a2), set(b1)
	for k, n := range m1 {
		if o, ok := m2[k]; !ok || o.Site != n.Site || o.Species != n.Species || o.Yaw != n.Yaw {
			t.Fatalf("nest %d changed after the cell was re-activated", n.ID)
		}
		if _, ok := m3[k]; !ok {
			t.Fatalf("nest %d differs between two runs with the same seed", n.ID)
		}
	}
}

// Nests go from building to eggs to chicks through the breeding window, become old
// nests afterwards and stay until the next spring, when new nests are built.
func TestNestStagesAdvanceThroughTheSeason(t *testing.T) {
	s, _ := newTestSim(6, nestingSpecies())
	obs := observerAt(woodPos)
	env := envAt(1, 6)
	s.Step(0.1, env, obs)
	first := map[uint32]bool{}
	for _, n := range s.Nests(woodPos, 250, nil) {
		first[n.ID] = true
	}
	if len(first) == 0 {
		t.Fatal("no nests")
	}
	last := map[uint32]uint8{}
	order := map[uint8]int{core.NestBuilding: 0, core.NestEggs: 1, core.NestChicks: 2, core.NestOld: 3}
	seen := map[uint8]bool{}
	for h := 0; h < 16*24; h++ { // one in-game year, an hour per step
		for i := 0; i < 3; i++ {
			s.Step(0.1, env, obs)
		}
		env = advanceEnv(env, 1)
		for _, n := range s.Nests(woodPos, 250, nil) {
			if !first[n.ID] {
				continue
			}
			seen[n.Stage] = true
			if p, ok := last[n.ID]; ok && order[n.Stage] < order[p] {
				t.Fatalf("day %d %.0fh: nest %d went back from stage %d to %d", env.Day, env.Time, n.ID, p, n.Stage)
			}
			last[n.ID] = n.Stage
			if env.Season >= core.Autumn && n.Stage != core.NestOld {
				t.Fatalf("nest %d still active (stage %d) in %v", n.ID, n.Stage, env.Season)
			}
		}
	}
	for _, st := range []uint8{core.NestBuilding, core.NestEggs, core.NestChicks, core.NestOld} {
		if !seen[st] {
			t.Errorf("never saw stage %d", st)
		}
	}
	// Winter ends: the old nests are gone in the new spring and new ones are built.
	if env.Season != core.Spring {
		t.Fatalf("expected spring again, got %v", env.Season)
	}
	s.Step(0.1, env, obs)
	fresh := 0
	for _, n := range s.Nests(woodPos, 250, nil) {
		if first[n.ID] {
			t.Fatalf("last year's nest %d still there in the new spring", n.ID)
		}
		if n.Stage != core.NestBuilding && n.Stage != core.NestEggs {
			t.Fatalf("new spring nest %d in stage %d", n.ID, n.Stage)
		}
		fresh++
	}
	if fresh == 0 {
		t.Fatal("no new nests in the new spring")
	}
}

// Adults show ActNesting: building trips, sitting on eggs (deep in cover) and feeding
// chicks.
func TestNestingBehaviour(t *testing.T) {
	for _, tc := range []struct {
		day   int
		stage uint8
	}{{1, core.NestBuilding}, {3, core.NestEggs}, {6, core.NestChicks}} {
		s, tr := newTestSim(7, nestingSpecies())
		obs := observerAt(core.V(woodPos.X, 5, woodPos.Z-250))
		env := envAt(tc.day, 8)
		nesting, sitting, atNest := 0, 0, 0
		for i := 0; i < 3000; i++ {
			s.Step(0.1, env, obs)
			if i%10 != 0 {
				continue
			}
			for _, b := range s.Near(woodPos, 250, nil) {
				validPos(t, tr, b)
				if b.Act != core.ActNesting {
					continue
				}
				nesting++
				n, ok := s.NestOf(b.ID)
				if !ok {
					t.Fatalf("a nesting bird without a nest")
				}
				if n.Pos.Dist(b.Pos) < 0.1 {
					atNest++
					if tc.stage == core.NestEggs && n.Stage == core.NestEggs && b.Cover >= 0.8 {
						sitting++
					}
				}
			}
		}
		t.Logf("day %d: %d nesting sightings, %d at the nest, %d sitting tight", tc.day, nesting, atNest, sitting)
		if nesting == 0 || atNest == 0 {
			t.Errorf("day %d: %d nesting sightings, %d at the nest", tc.day, nesting, atNest)
		}
		if tc.stage == core.NestEggs && sitting == 0 {
			t.Errorf("no bird sat tight on eggs")
		}
	}
}

// Coming too close to a nest makes the adults scold and stay away; once the
// observer withdraws they come back to it.
func TestNestDisturbanceWithdrawAndReturn(t *testing.T) {
	s, tr := newTestSim(8, nestingSpecies())
	env := envAt(3, 9) // eggs
	far := observerAt(core.V(woodPos.X, 5, woodPos.Z-260))
	var target core.Nest
	var sitterID uint32
	for i := 0; i < 6000 && sitterID == 0; i++ {
		s.Step(0.1, env, far)
		for _, b := range s.Near(woodPos, 200, nil) {
			if b.Act != core.ActNesting {
				continue
			}
			if n, ok := s.NestOf(b.ID); ok && n.Stage == core.NestEggs && n.Pos.Dist(b.Pos) < 0.1 && n.Species == spRobin {
				target, sitterID = n, b.ID
				break
			}
		}
	}
	if sitterID == 0 {
		t.Fatal("found no robin sitting on eggs")
	}
	alarmR := s.prof[target.Species].nest.alarmR
	mates := func() []*bird {
		var out []*bird
		for i := range s.birds {
			b := &s.birds[i]
			if !b.alive {
				continue
			}
			if n, ok := s.NestOf(b.id); ok && n.ID == target.ID {
				out = append(out, b)
			}
		}
		return out
	}
	alarmCall := s.prof[target.Species].callAlarm
	if alarmCall < 0 {
		alarmCall = s.prof[target.Species].callContact
	}
	if alarmCall < 0 {
		alarmCall = 0
	}

	// Walk up to the nest and stand beside it for two minutes.
	obs := observerAt(core.V(target.Pos.X-3*alarmR, tr.H, target.Pos.Z))
	scolds := 0
	isMate := func(id uint32) bool {
		for _, m := range mates() {
			if m.id == id {
				return true
			}
		}
		return false
	}
	for i := 0; i < 3000; i++ {
		d := target.Pos.Sub(obs.Pos)
		d.Y = 0
		if d.Len() > 0.6*alarmR {
			obs.Vel = d.Norm().Scale(1.1)
			obs.Speed, obs.Crouch = 1.1, true
			obs.Pos = obs.Pos.Add(obs.Vel.Scale(0.1))
		} else {
			obs.Vel, obs.Speed = core.Vec3{}, 0
			obs.Still += 0.1
		}
		for _, e := range s.Step(0.1, env, obs) {
			if e.Kind == core.EvCall && e.Call == alarmCall && isMate(e.Bird) {
				scolds++
			}
		}
		if d.Len() <= 0.6*alarmR && i%10 == 0 {
			for _, m := range mates() {
				if !m.moving && m.pos.Dist(target.Pos) < 0.3 {
					t.Fatalf("an adult sits on the nest with the observer %.1f m away", d.Len())
				}
			}
		}
	}
	t.Logf("alarm radius %.1f m, %d scolding bouts, %d adults", alarmR, scolds, len(mates()))
	if scolds == 0 {
		t.Fatal("the adults never scolded")
	}
	// Withdraw well away and wait: an adult returns to the nest.
	obs = far
	back := false
	for i := 0; i < 12000 && !back; i++ {
		s.Step(0.1, env, obs)
		for _, m := range mates() {
			if !m.moving && m.act == core.ActNesting && m.pos.Dist(target.Pos) < 0.1 {
				back = true
			}
		}
	}
	t.Logf("back at the nest: %v", back)
	if !back {
		t.Fatal("no adult came back to the nest after the observer left")
	}
}

// Nests answers radius queries exactly.
func TestNestsRadiusQuery(t *testing.T) {
	s, _ := newTestSim(9, nestingSpecies())
	s.Step(0.1, envAt(2, 10), observerAt(woodPos))
	all := s.Nests(woodPos, 2000, nil)
	if len(all) < 5 {
		t.Fatalf("only %d nests", len(all))
	}
	for _, r := range []float32{0, 20, 60, 150} {
		got := s.Nests(woodPos, r, nil)
		want := 0
		for _, n := range all {
			if n.Pos.Dist(woodPos) <= r {
				want++
			}
		}
		if len(got) != want {
			t.Errorf("radius %v: %d nests, want %d", r, len(got), want)
		}
		for _, n := range got {
			if n.Pos.Dist(woodPos) > r {
				t.Errorf("radius %v: nest at %v m", r, n.Pos.Dist(woodPos))
			}
		}
	}
	// Appends to the buffer it is given.
	buf := make([]core.Nest, 1, 8)
	if got := s.Nests(woodPos, 60, buf); len(got) < 1 || got[0] != buf[0] {
		t.Fatal("Nests must append to buf")
	}
}

// With nests, the whole simulation stays deterministic.
func TestNestingDeterministic(t *testing.T) {
	run := func() []core.BirdState {
		s, _ := newTestSim(10, nestingSpecies())
		obs := observerAt(woodPos)
		env := envAt(3, 8)
		for i := 0; i < 1500; i++ {
			if i == 700 {
				obs.Pos.X += 20 // a walk through the wood disturbs a few nests
			}
			s.Step(0.1, env, obs)
		}
		return s.Near(woodPos, 300, nil)
	}
	a, b := run(), run()
	if len(a) != len(b) {
		t.Fatalf("%d vs %d birds", len(a), len(b))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("bird %d differs: %+v vs %+v", i, a[i], b[i])
		}
	}
}

func BenchmarkStepNesting(b *testing.B) {
	sp := nestingSpecies()
	for i := range sp {
		sp[i].Behavior.Density *= 3.3
	}
	s := New(coretest.NewFlat(), sp, 1)
	env := envAt(3, 9)
	obs := observerAt(woodPos)
	for i := 0; i < 600; i++ {
		s.Step(0.1, env, obs)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		dir := float32(1)
		if (i/2000)%2 == 1 {
			dir = -1
		}
		obs.Pos.X += 0.1 * dir
		obs.Vel = core.V(dir, 0, 0)
		obs.Speed = 1
		s.Step(0.1, env, obs)
	}
	b.ReportMetric(float64(s.Count()), "birds")
}

// BenchmarkBuildNests measures pairing and siting the nests of one cell with the
// full catalog (done lazily once per cell and breeding year).
func BenchmarkBuildNests(b *testing.B) {
	cat := species.All()
	s := New(nestTerrain{coretest.NewFlat()}, cat, 1)
	s.Step(0.1, envAt(1, 10), observerAt(woodPos))
	c := s.cells[keyAt(woodPos.X, woodPos.Z)]
	if c == nil {
		b.Fatal("no cell")
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		s.buildNests(c, int32(i))
	}
	b.ReportMetric(float64(len(c.nests)), "nests")
	b.ReportMetric(float64(len(c.perches)), "perches")
}
