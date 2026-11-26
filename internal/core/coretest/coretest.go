// Package coretest provides small deterministic fakes of the contract interfaces so
// packages can be tested without depending on each other's implementations.
package coretest

import (
	"errors"
	"math"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Flat is a fake core.Terrain: unbounded level ground at height H with a regular
// grid of trees, shrubs and ground perches. West of x = 1024 is woodland, east of it
// meadow, and a pond (water perches, HabRiver) lies in a 40 m circle around
// (512, 1536). Everything is in RegionGreenhollow unless Reg is set.
type Flat struct {
	H     float32
	Noise float32                          // AmbientNoise everywhere
	Hab   func(x, z float32) core.Habitat  // optional override
	Reg   func(x, z float32) core.RegionID // optional override
	Occ   func(from, to core.Vec3) float32 // optional override; default 0
	Pois  []core.POI
	trees []core.Perch
}

// TreeSpacing is the distance between trees in the fake woodland.
const TreeSpacing = 16

// NewFlat returns a Flat terrain at height 5.
func NewFlat() *Flat { return &Flat{H: 5} }

func (f *Flat) Seed() int64 { return 1 }

func (f *Flat) inWorld(x, z float32) bool { return true }

func (f *Flat) pond(x, z float32) bool {
	dx, dz := x-512, z-1536
	return dx*dx+dz*dz < 40*40
}

func (f *Flat) HeightAt(x, z float32) float32 {
	if f.pond(x, z) {
		return -0.6
	}
	return f.H
}

func (f *Flat) HabitatAt(x, z float32) core.Habitat {
	if f.Hab != nil {
		return f.Hab(x, z)
	}
	if !f.inWorld(x, z) {
		return core.HabOcean
	}
	if f.pond(x, z) {
		return core.HabRiver
	}
	if x < 1024 {
		return core.HabWoodland
	}
	return core.HabMeadow
}

func (f *Flat) RegionAt(x, z float32) core.RegionID {
	if f.Reg != nil {
		return f.Reg(x, z)
	}
	if !f.inWorld(x, z) {
		return core.RegionNone
	}
	return core.RegionGreenhollow
}

func (f *Flat) Cover(x, z float32) float32 {
	if f.HabitatAt(x, z) == core.HabWoodland {
		return 0.7
	}
	return 0.1
}

func (f *Flat) AmbientNoise(x, z float32) float32 { return f.Noise }

// PerchesNear returns, on a grid: in woodland every TreeSpacing metres a tree with a
// canopy perch (H+8, cover 0.8), an exposed branch perch (H+10, cover 0.2) and a trunk
// perch (H+4); a shrub perch (H+1, cover 0.6) offset by half the spacing; and ground
// perches every 8 m everywhere on land. The pond offers water and shore perches.
func (f *Flat) PerchesNear(x, z, radius float32, buf []core.Perch) []core.Perch {
	r2 := radius * radius
	add := func(p core.Perch) {
		dx, dz := p.Pos.X-x, p.Pos.Z-z
		if dx*dx+dz*dz <= r2 && f.inWorld(p.Pos.X, p.Pos.Z) {
			buf = append(buf, p)
		}
	}
	lo := func(v float32, step float32) float32 { return float32(math.Floor(float64((v-radius)/step))) * step }
	for gx := lo(x, 8); gx <= x+radius; gx += 8 {
		for gz := lo(z, 8); gz <= z+radius; gz += 8 {
			if f.pond(gx, gz) {
				add(core.Perch{Pos: core.V(gx, 0, gz), Kind: core.PerchWater})
				continue
			}
			if f.pond(gx+8, gz) || f.pond(gx-8, gz) || f.pond(gx, gz+8) || f.pond(gx, gz-8) {
				add(core.Perch{Pos: core.V(gx, f.H, gz), Kind: core.PerchShore})
			}
			add(core.Perch{Pos: core.V(gx, f.H, gz), Kind: core.PerchGround, Cover: 0.1})
		}
	}
	for gx := lo(x, TreeSpacing); gx <= x+radius; gx += TreeSpacing {
		for gz := lo(z, TreeSpacing); gz <= z+radius; gz += TreeSpacing {
			if f.HabitatAt(gx, gz) != core.HabWoodland {
				continue
			}
			add(core.Perch{Pos: core.V(gx, f.H+8, gz), Kind: core.PerchCanopy, Cover: 0.8})
			add(core.Perch{Pos: core.V(gx+1.5, f.H+10, gz), Kind: core.PerchBranch, Cover: 0.2})
			add(core.Perch{Pos: core.V(gx+0.3, f.H+4, gz), Kind: core.PerchTrunk, Cover: 0.3})
			add(core.Perch{Pos: core.V(gx+0.35, f.H+5, gz), Kind: core.PerchCavity, Cover: 0.9})
			add(core.Perch{Pos: core.V(gx-0.8, f.H+6.5, gz+0.4), Kind: core.PerchFork, Cover: 0.5})
			add(core.Perch{Pos: core.V(gx+TreeSpacing/2, f.H+1, gz+TreeSpacing/2), Kind: core.PerchShrub, Cover: 0.6})
		}
	}
	return buf
}

func (f *Flat) Occlusion(from, to core.Vec3) float32 {
	if f.Occ != nil {
		return f.Occ(from, to)
	}
	return 0
}

func (f *Flat) HomePOIs() []core.POI { return f.Pois }

func (f *Flat) POIsNear(x, z, radius float32, buf []core.POI) []core.POI {
	for _, p := range f.Pois {
		dx, dz := p.Pos.X-x, p.Pos.Z-z
		if dx*dx+dz*dz <= radius*radius {
			buf = append(buf, p)
		}
	}
	return buf
}

func (f *Flat) POI(id string) (core.POI, bool) {
	for _, p := range f.Pois {
		if p.ID == id {
			return p, true
		}
	}
	return core.POI{}, false
}

func (f *Flat) TrailsNear(x, z, radius float32, buf []core.Trail) []core.Trail { return buf }

func (f *Flat) Spawn() (core.Vec3, float32) { return core.V(600, f.H+core.EyeHeight, 600), 0 }

func (f *Flat) Chunk(cx, cz, lod int) ([]byte, error) { return nil, errors.New("coretest: no chunks") }

func (f *Flat) MapTile(tx, tz int) ([]byte, error) { return nil, errors.New("coretest: no map") }

var _ core.Terrain = (*Flat)(nil)

// Birds is a fake core.Ecosystem holding a fixed, settable list of birds.
type Birds struct {
	List     []core.BirdState
	Events   []core.EcoEvent // returned (and cleared) by the next Step
	Lures    []core.Lure
	NestList []core.Nest
}

func (b *Birds) Step(dt float32, env core.Env, obs core.Observer) []core.EcoEvent {
	ev := b.Events
	b.Events = nil
	return ev
}

func (b *Birds) Near(center core.Vec3, radius float32, buf []core.BirdState) []core.BirdState {
	for _, s := range b.List {
		if s.Pos.Dist(center) <= radius {
			buf = append(buf, s)
		}
	}
	return buf
}

func (b *Birds) Get(id uint32) (core.BirdState, bool) {
	for _, s := range b.List {
		if s.ID == id {
			return s, true
		}
	}
	return core.BirdState{}, false
}

func (b *Birds) Nests(center core.Vec3, radius float32, buf []core.Nest) []core.Nest {
	for _, n := range b.NestList {
		if n.Pos.Dist(center) <= radius {
			buf = append(buf, n)
		}
	}
	return buf
}

func (b *Birds) Count() int                              { return len(b.List) }
func (b *Birds) AddLure(l core.Lure)                     { b.Lures = append(b.Lures, l) }
func (b *Birds) FastForward(hours float32, env core.Env) {}

var _ core.Ecosystem = (*Birds)(nil)

// Species returns three small, contract-valid species for tests:
// index 0 "test_robin" (small, tame, ground/shrub, melodic high song),
// index 1 "test_wren" (tiny skulker in shrubs, loud very-high trill),
// index 2 "test_buzzard" (large soaring raptor, low mewing call, shy).
func Species() []core.Species {
	note := func(dur, f0, f1 float32, wave string) core.Note {
		return core.Note{Dur: dur, Gap: 0.05, F0: f0, F1: f1, Wave: wave, Amp: 0.8}
	}
	pal := core.Palette{Back: "#7a5c3c", Belly: "#e8e0d0", Head: "#7a5c3c", Wing: "#6b4f33", Tail: "#5c4430", Bill: "#3a3027", Legs: "#8a6a50", Eye: "#111111"}
	robin := core.Species{
		ID: "test_robin", Name: "Test Robin", Sci: "Testus rubecula", Family: "Chats",
		Desc: "A small, confiding bird.", IDTips: "Orange breast.", Fact: "Sings in winter.",
		Rarity: core.Common, Regions: []core.RegionID{core.RegionGreenhollow},
		Habitats: []core.HabitatWeight{{Habitat: "woodland", Weight: 0.7}, {Habitat: "shrub", Weight: 0.3}},
		Seasons:  [4]bool{true, true, true, true},
		Look: core.Appearance{Length: 0.14, Wingspan: 0.21, Plump: 1.2, Tail: 0.6, TailShape: "square", Bill: 0.5, BillShape: "thin", WingShape: "rounded", Colors: pal,
			Marks: []core.Mark{{Kind: "breast", Color: "#d9702e"}}},
		Move: core.Movement{Flight: "direct", Ground: "hop", Speed: 8, FlapHz: 12},
		Behavior: core.Behavior{Perches: []string{"shrub", "branch", "ground"}, Feeding: "ground",
			Activity: [6]float32{1, 0.8, 0.4, 0.6, 0.9, 0.05}, Sociality: "solitary", FlockMin: 1, FlockMax: 1,
			Territory: 40, Shyness: 6, Vocal: 4, Density: 1, Camo: 0.2, Skulking: 0.3, Habituate: 0.9, Specials: []string{"bathing"}},
		Calls: []core.Call{{Kind: "song", Notes: []core.Note{note(0.2, 3200, 4200, "whistle"), note(0.15, 4200, 3000, "whistle"), note(0.3, 3600, 5000, "whistle")},
			Repeat: [2]int{2, 4}, Gap: 1.2, Loud: 0.45, Pitch: "high", Pattern: "melodic"}},
		Traits:     core.Traits{Size: "small", Shape: "songbird", Primary: "brown", Secondary: "orange", Marking: "orange-red breast", Bill: "thin", Flight: "direct"},
		Difficulty: 1,
	}
	wren := robin
	wren.ID, wren.Name, wren.Sci = "test_wren", "Test Wren", "Testus troglodytes"
	wren.Habitats = []core.HabitatWeight{{Habitat: "shrub", Weight: 0.6}, {Habitat: "woodland", Weight: 0.4}}
	wren.Look.Length, wren.Look.Wingspan, wren.Look.TailShape, wren.Look.Marks = 0.1, 0.15, "cocked", nil
	wren.Move = core.Movement{Flight: "whirring", Ground: "hop", Speed: 6, FlapHz: 18}
	wren.Behavior.Perches = []string{"shrub", "ground"}
	wren.Behavior.Feeding, wren.Behavior.Shyness, wren.Behavior.Skulking, wren.Behavior.Habituate, wren.Behavior.Camo = "glean", 9, 0.9, 0.4, 0.6
	wren.Calls = []core.Call{{Kind: "song", Notes: []core.Note{{Dur: 0.9, Gap: 0.1, F0: 6500, F1: 7200, Wave: "trill", Rate: 28, Depth: 0.5, Amp: 0.9}},
		Repeat: [2]int{1, 3}, Gap: 1.5, Loud: 0.6, Pitch: "very high", Pattern: "trill"}}
	wren.Traits = core.Traits{Size: "tiny", Shape: "songbird", Primary: "brown", Secondary: "buff", Marking: "cocked tail", Bill: "thin", Flight: "whirring"}
	wren.Difficulty = 3
	buzz := robin
	buzz.ID, buzz.Name, buzz.Sci, buzz.Family = "test_buzzard", "Test Buzzard", "Testus buteo", "Hawks"
	buzz.Rarity = core.Uncommon
	buzz.Habitats = []core.HabitatWeight{{Habitat: "woodland", Weight: 0.5}, {Habitat: "meadow", Weight: 0.5}}
	buzz.Look.Length, buzz.Look.Wingspan, buzz.Look.BillShape, buzz.Look.WingShape, buzz.Look.TailShape, buzz.Look.Marks = 0.54, 1.2, "hooked", "broad", "fan", nil
	buzz.Move = core.Movement{Flight: "soaring", Ground: "walk", Speed: 12, FlapHz: 3}
	buzz.Behavior.Perches = []string{"snag", "branch"}
	buzz.Behavior.Feeding, buzz.Behavior.Shyness, buzz.Behavior.Territory, buzz.Behavior.Vocal, buzz.Behavior.Density = "hunt", 60, 300, 1, 0.1
	buzz.Behavior.Skulking, buzz.Behavior.Habituate, buzz.Behavior.Specials = 0, 0.1, []string{"soaring"}
	buzz.Calls = []core.Call{{Kind: "call", Notes: []core.Note{{Dur: 0.8, Gap: 0.2, F0: 1900, F1: 1300, Wave: "whistle", Amp: 0.9}},
		Repeat: [2]int{1, 3}, Gap: 2, Loud: 0.8, Pitch: "medium", Pattern: "single"}}
	buzz.Traits = core.Traits{Size: "large", Shape: "raptor", Primary: "brown", Secondary: "white", Marking: "pale breast band", Bill: "hooked", Flight: "soaring"}
	buzz.Difficulty = 2
	list := []core.Species{robin, wren, buzz}
	for i := range list {
		list[i].Index = i
	}
	return list
}
