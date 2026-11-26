package eco

import (
	"math"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/core/coretest"
)

// Fixture indices in coretest.Species().
const (
	spRobin   = 0
	spWren    = 1
	spBuzzard = 2
)

// woodPos is a spot deep in the fixture woodland (and 850 m from the origin, so the
// home-valley cells are not involved).
var woodPos = core.V(600, 5, 600)

func envAt(day int, hour float32) core.Env {
	season := core.Season(((day - 1) / 4) % 4)
	return core.Env{Time: hour, Day: day, Season: season, Weather: core.WeatherSunny, Wind: 0.1, Cloud: 0.1, Light: light(hour)}
}

// light is a rough daylight curve, good enough for tests.
func light(h float32) float32 {
	if h < 5 || h > 20.5 {
		return 0
	}
	return float32(math.Sin(float64((h - 5) / 15.5 * math.Pi)))
}

// advanceEnv moves an env forward by hours, rolling the day and season over.
func advanceEnv(e core.Env, hours float32) core.Env {
	e.Time += hours
	for e.Time >= 24 {
		e.Time -= 24
		e.Day++
	}
	e.Season = core.Season(((e.Day - 1) / 4) % 4)
	e.Light = light(e.Time)
	return e
}

func observerAt(pos core.Vec3) core.Observer {
	return core.Observer{Present: true, Pos: core.V(pos.X, pos.Y+core.EyeHeight, pos.Z), Stealth: 1, CrouchBonus: 0.75, Settle: 1, Familiarity: 1}
}

func newTestSim(seed int64, species []core.Species) (*Sim, *coretest.Flat) {
	t := coretest.NewFlat()
	if species == nil {
		species = coretest.Species()
	}
	return New(t, species, seed), t
}

// extraSpecies builds a broader catalogue on top of the fixtures: a migrant
// warbler (absent in winter), a flocking finch, a clinging nuthatch, a dabbling duck,
// a hovering kestrel and a highland pipit (a vagrant candidate in the woods).
func extraSpecies() []core.Species {
	list := coretest.Species()
	robin := list[spRobin]

	warbler := robin
	warbler.ID, warbler.Name = "test_warbler", "Test Warbler"
	warbler.Seasons = [4]bool{true, true, true, false}
	warbler.Behavior.Feeding = "glean"
	warbler.Behavior.Perches = []string{"canopy", "branch"}
	warbler.Behavior.Specials = []string{"nesting", "preening"}

	finch := robin
	finch.ID, finch.Name = "test_finch", "Test Finch"
	finch.Behavior.Feeding = "seeds"
	finch.Behavior.Sociality, finch.Behavior.FlockMin, finch.Behavior.FlockMax = "flock", 4, 8
	finch.Behavior.Perches = []string{"branch", "shrub", "ground"}
	finch.Behavior.Specials = []string{"social"}
	finch.Move.Flight = "undulating"

	nuthatch := robin
	nuthatch.ID, nuthatch.Name = "test_nuthatch", "Test Nuthatch"
	nuthatch.Move.Ground = "cling"
	nuthatch.Behavior.Feeding = "trunk"
	nuthatch.Behavior.Perches = []string{"trunk", "branch"}
	nuthatch.Calls = append(append([]core.Call(nil), robin.Calls...), core.Call{Kind: "drum", Notes: []core.Note{{Dur: 0.6, F0: 400, F1: 400, Wave: "click", Rate: 18, Amp: 1}}, Repeat: [2]int{1, 2}, Gap: 1, Loud: 0.6, Pitch: "low", Pattern: "drumming"})

	duck := robin
	duck.ID, duck.Name = "test_duck", "Test Duck"
	duck.Habitats = []core.HabitatWeight{{Habitat: "river", Weight: 1}}
	duck.Move = core.Movement{Flight: "direct", Ground: "swim", Speed: 14, FlapHz: 6}
	duck.Behavior.Feeding = "dabble"
	duck.Behavior.Perches = []string{"water", "shore"}
	duck.Behavior.Density = 6
	duck.Behavior.Shyness = 20
	duck.Behavior.Specials = []string{"preening"}

	kestrel := list[spBuzzard]
	kestrel.ID, kestrel.Name = "test_kestrel", "Test Kestrel"
	kestrel.Move.Flight = "hover"
	kestrel.Behavior.Density = 0.4
	kestrel.Behavior.Habituate = 0.2
	kestrel.Behavior.Specials = []string{"hovering"}

	pipit := robin
	pipit.ID, pipit.Name = "test_pipit", "Test Pipit"
	pipit.Regions = []core.RegionID{core.RegionWindpeak}

	list = append(list, warbler, finch, nuthatch, duck, kestrel, pipit)
	for i := range list {
		list[i].Index = i
	}
	return list
}

// validPos checks the hard placement rule: never inside the ground, never under
// the water plane.
func validPos(t *testing.T, tr core.Terrain, b core.BirdState) {
	t.Helper()
	g := tr.HeightAt(b.Pos.X, b.Pos.Z)
	if b.Pos.Y < g-0.05 || b.Pos.Y < -0.01 || b.Pos.Y != b.Pos.Y {
		t.Fatalf("bird %d (sp %d, act %s) at %+v is below ground %v / water", b.ID, b.Species, b.Act.Key(), b.Pos, g)
	}
}

// find returns the live bird with this id.
func (s *Sim) find(id uint32) *bird {
	i, ok := s.byID[id]
	if !ok {
		return nil
	}
	return &s.birds[i]
}
