package field

import (
	"math/rand/v2"
	"testing"

	"github.com/Rik-Stokmans/wildcall/internal/core"
	"github.com/Rik-Stokmans/wildcall/internal/core/coretest"
	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Species indices in the test catalog.
const (
	spRobin = iota
	spWren
	spBuzzard
	spBlackbird
	spGoldcrest
	spDunnock
	spChaffinch
	spGreatTit
	spNightingale
	spOsprey // rare, lives only in Murmur Marsh
)

// testCatalog is the three coretest fixtures plus a handful of realistic species:
// a loud blackbird, a quiet goldcrest, three more small birds (so "small" alone is
// ambiguous), a plain-brown nightingale and a rare osprey from another region.
func testCatalog() []core.Species {
	list := coretest.Species()
	robin := list[spRobin]
	mk := func(id, name string, edit func(s *core.Species)) {
		s := robin
		s.ID, s.Name, s.Sci = id, name, "Testus "+id
		s.Look.Marks = nil
		edit(&s)
		list = append(list, s)
	}
	call := func(loud float32, pitch, pattern string) []core.Call {
		c := robin.Calls[0]
		c.Loud, c.Pitch, c.Pattern = loud, pitch, pattern
		return []core.Call{c}
	}
	mk("test_blackbird", "Test Blackbird", func(s *core.Species) {
		s.Look.Length, s.Look.Wingspan = 0.25, 0.36
		s.Calls = call(0.7, "medium", "melodic")
		s.Traits = core.Traits{Size: "medium", Shape: "thrush", Primary: "black", Secondary: "yellow", Marking: "yellow bill and eye-ring", Bill: "thin", Flight: "direct"}
	})
	mk("test_goldcrest", "Test Goldcrest", func(s *core.Species) {
		s.Look.Length, s.Look.Wingspan = 0.09, 0.14
		s.Calls = call(0.12, "very high", "repeated")
		s.Habitats = []core.HabitatWeight{{Habitat: "conifer", Weight: 0.8}, {Habitat: "woodland", Weight: 0.2}}
		s.Traits = core.Traits{Size: "tiny", Shape: "warbler", Primary: "green", Secondary: "yellow", Marking: "yellow crown stripe", Bill: "thin", Flight: "whirring"}
	})
	mk("test_dunnock", "Test Dunnock", func(s *core.Species) {
		s.Calls = call(0.4, "high", "trill")
		s.Traits = core.Traits{Size: "small", Shape: "songbird", Primary: "brown", Secondary: "grey", Marking: "streaked flanks", Bill: "thin", Flight: "direct"}
	})
	mk("test_chaffinch", "Test Chaffinch", func(s *core.Species) {
		s.Calls = call(0.5, "high", "repeated")
		s.Traits = core.Traits{Size: "small", Shape: "finch", Primary: "pink", Secondary: "blue", Marking: "white wing bars", Bill: "stout", Flight: "undulating"}
	})
	mk("test_great_tit", "Test Great Tit", func(s *core.Species) {
		s.Calls = call(0.5, "high", "repeated")
		s.Traits = core.Traits{Size: "small", Shape: "tit", Primary: "yellow", Secondary: "black", Marking: "black belly stripe", Bill: "short", Flight: "undulating"}
	})
	mk("test_nightingale", "Test Nightingale", func(s *core.Species) {
		s.Look.Length = 0.16
		s.Calls = call(0.75, "medium", "melodic")
		s.Seasons = [4]bool{true, true, false, false}
		s.Traits = core.Traits{Size: "small", Shape: "thrush", Primary: "brown", Secondary: "buff", Marking: "rufous tail", Bill: "thin", Flight: "direct"}
	})
	mk("test_osprey", "Test Osprey", func(s *core.Species) {
		s.Rarity = core.Rare
		s.Regions = []core.RegionID{core.RegionMurmurMarsh}
		s.Look.Length, s.Look.Wingspan = 0.58, 1.6
		s.Move = core.Movement{Flight: "soaring", Ground: "none", Speed: 13, FlapHz: 3}
		s.Behavior.Feeding, s.Behavior.Specials = "plunge", []string{"diving", "hovering"}
		s.Calls = call(0.6, "high", "whistle")
		s.Difficulty = 4
		s.Traits = core.Traits{Size: "large", Shape: "raptor", Primary: "brown", Secondary: "white", Marking: "dark eye mask", Bill: "hooked", Flight: "soaring"}
	})
	for i := range list {
		list[i].Index = i
	}
	return list
}

// newCtx returns a Context on flat ground at midday in calm, clear weather with the
// stats of a beginner and no knowledge.
func newCtx() (*Context, *coretest.Flat) {
	flat := coretest.NewFlat()
	return &Context{
		Terrain: flat,
		Species: testCatalog(),
		Env:     core.Env{Time: 12, Day: 1, Season: core.Spring, Light: 1},
		Stats:   core.BaseStats(),
		Know:    &Memory{},
	}, flat
}

// origin is where the test observer stands (in the fake woodland).
var origin = core.V(200, 5+core.EyeHeight, 200)

// standing returns a naked-eye pose at the origin looking north.
func standing() proto.Pose {
	return proto.Pose{X: origin.X, Y: origin.Y, Z: origin.Z, Move: "still", Tool: "none", FOV: 60, Zoom: 1, Sharp: 1}
}

// lookAt aims a pose at a world point.
func lookAt(p proto.Pose, target core.Vec3) proto.Pose {
	eye := Eye(p)
	p.Yaw = core.HeadingTo(eye, target)
	p.Pitch = elevationOf(eye, target)
	return p
}

// withBinoculars raises binoculars at the given magnification, in focus.
func withBinoculars(p proto.Pose, zoom float32) proto.Pose {
	p.Tool, p.Raised, p.Zoom, p.Sharp = "binoculars", true, zoom, 1
	p.FOV = 48 / zoom
	return p
}

// north returns the point d metres north of the origin, h metres above eye level.
func north(d, h float32) core.Vec3 { return core.V(origin.X, origin.Y+h, origin.Z-d) }

func birdAt(id uint32, species int, pos core.Vec3, act core.BirdAct, cover float32) core.BirdState {
	return core.BirdState{ID: id, Species: species, Act: act, Pos: pos, Cover: cover}
}

func callFrom(b core.BirdState, dur float32) core.EcoEvent {
	return core.EcoEvent{Kind: core.EvCall, Bird: b.ID, Species: b.Species, Call: 0, Repeats: 3, Pos: b.Pos, Dur: dur, Seed: 7}
}

func seeded() *rand.Rand { return rand.New(rand.NewPCG(1, 2)) }

func mustHear(t *testing.T, c *Context, b core.BirdState, p proto.Pose) Heard {
	t.Helper()
	h, ok := Hear(c, callFrom(b, 4), b, p, seeded())
	if !ok {
		t.Fatalf("expected the call of species %d at %.0f m to be audible (range %.0f m)", b.Species, h.Dist, h.Range)
	}
	return h
}
