// Package world is WILDCALL's unbounded, seed-generated world (docs/contract.md §2).
//
// Everything is a pure function of (seed, position), evaluated lazily and cached in
// bounded LRUs, so the world has no edges and two Worlds with the same seed are
// identical. The layers, from the bottom up:
//
//   - gen (gen.go): smooth climate fields -> region types, blended terrain height,
//     rivers, lakes, coasts; the home valley's terrain shaping (home.go).
//   - cells (cells.go): a 192 m structure grid; each cell holds zero or one
//     generated feature (structure, hidden place, landmark) with its companions.
//   - trails (trails.go): generated paths linking neighbouring structures, routed
//     around water and steep ground.
//   - overlays (overlay.go): pads, ponds and trail benches edited into the ground.
//   - grids (grid.go): per-chunk 2 m vertex grids of final height, normals, colours,
//     region and habitat; HeightAt/RegionAt/HabitatAt read these.
//   - vegetation, perches, occlusion, chunks and map tiles on top.
package world

import (
	"math"
	"strconv"
	"strings"
	"sync"

	"github.com/Rik-Stokmans/wildcall/internal/core"
)

// Cache capacities. They bound the memory the world can hold no matter how far the
// player travels (contract §2.3: a few hundred chunks' worth of data).
const (
	capCells   = 4096 // structure-grid cells (stage 1: features)
	capTrails  = 4096 // generated trails, one slot per cell
	capPOIs    = 2048 // finished per-cell POI lists
	capGrids   = 512  // chunk vertex grids (~80 KB each)
	capVeg     = 384  // chunk vegetation + foliage shapes
	capPerches = 384  // chunk perch lists
	capChunks  = 2560 // encoded chunk frames (all LODs; the client holds a far ring of coarse chunks)
	capTiles   = 96   // encoded map tiles
)

type cellKey struct{ x, z int }
type chunkKey struct{ x, z int }
type lodKey struct{ x, z, lod int }

// World implements core.Terrain. It is safe for concurrent use.
type World struct {
	seed int64
	g    *gen
	hl   *homeLayout
	home map[string]int // pinned id -> index into hl.pois

	cells   *lru[cellKey, *cell]
	trails  *lru[cellKey, *genTrail]
	pois    *lru[cellKey, []core.POI]
	grids   *lru[chunkKey, *grid]
	veg     *lru[chunkKey, *vegSet]
	perches *lru[chunkKey, *perchSet]
	chunks  *lru[lodKey, []byte]
	tiles   *lru[cellKey, []byte]

	homeForageOnce sync.Once
	homeForageVeg  []core.Veg // guaranteed forage patches in the home valley
}

var _ core.Terrain = (*World)(nil)

// New builds the world for a seed: the climate model and the home valley layout.
// Everything else is generated on demand.
func New(seed int64) *World {
	g := newGen(seed)
	hl := newHomeLayout(g)
	w := &World{
		seed:    seed,
		g:       g,
		hl:      hl,
		home:    make(map[string]int, len(hl.pois)),
		cells:   newLRU[cellKey, *cell](capCells),
		trails:  newLRU[cellKey, *genTrail](capTrails),
		pois:    newLRU[cellKey, []core.POI](capPOIs),
		grids:   newLRU[chunkKey, *grid](capGrids),
		veg:     newLRU[chunkKey, *vegSet](capVeg),
		perches: newLRU[chunkKey, *perchSet](capPerches),
		chunks:  newLRU[lodKey, []byte](capChunks),
		tiles:   newLRU[cellKey, []byte](capTiles),
	}
	for i, p := range hl.pois {
		w.home[p.ID] = i
	}
	w.finishHome()
	return w
}

// SeedFromText turns what the player typed into a world seed: a plain integer is
// used as is, any other text is hashed (FNV-1a, 64 bit). Surrounding spaces are
// ignored. Choosing a random seed for empty input is the caller's job.
func SeedFromText(s string) int64 {
	s = strings.TrimSpace(s)
	if v, err := strconv.ParseInt(s, 10, 64); err == nil {
		return v
	}
	h := uint64(14695981039346656037)
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= 1099511628211
	}
	return int64(h)
}

// Seed returns the world seed.
func (w *World) Seed() int64 { return w.seed }

// Spawn is the new-game start: 6 m in front of the cabin door, facing the
// Woodland Entrance. The position is on the ground (feet, not eyes).
func (w *World) Spawn() (core.Vec3, float32) { return w.hl.spawn, w.hl.spawnYaw }

// HomePOIs returns a copy of the pinned home-valley POIs.
func (w *World) HomePOIs() []core.POI {
	out := make([]core.POI, len(w.hl.pois))
	for i, p := range w.hl.pois {
		out[i] = clonePOI(p)
	}
	return out
}

func clonePOI(p core.POI) core.POI {
	if p.Data != nil {
		d := make(map[string]string, len(p.Data))
		for k, v := range p.Data {
			d[k] = v
		}
		p.Data = d
	}
	return p
}

// chunkOf returns the chunk containing world coordinate v.
func chunkOf(v float64) int { return int(math.Floor(v / core.ChunkSize)) }

// gridAt returns the lod-0 vertex grid of the chunk containing (x, z) and the
// position of the point in grid cells.
func (w *World) gridAt(x, z float64) (gr *grid, fx, fz float64) {
	cx, cz := chunkOf(x), chunkOf(z)
	gr = w.grid(cx, cz)
	fx = (x - float64(cx*core.ChunkSize)) / gridStep
	fz = (z - float64(cz*core.ChunkSize)) / gridStep
	return
}

// HeightAt returns the ground height, bilinearly interpolated from the 2 m chunk
// grid exactly as the client does, so server and client agree on the ground.
func (w *World) HeightAt(x, z float32) float32 {
	gr, fx, fz := w.gridAt(float64(x), float64(z))
	return float32(gr.heightAt(fx, fz))
}

// RegionAt returns the region type at the nearest grid vertex (RegionNone at sea).
func (w *World) RegionAt(x, z float32) core.RegionID {
	gr, fx, fz := w.gridAt(float64(x), float64(z))
	return core.RegionID(gr.v[gr.nearest(fx, fz)].reg)
}

// HabitatAt returns the habitat at the nearest grid vertex.
func (w *World) HabitatAt(x, z float32) core.Habitat {
	gr, fx, fz := w.gridAt(float64(x), float64(z))
	return core.Habitat(gr.v[gr.nearest(fx, fz)].hab)
}

// AmbientNoise returns steady environmental noise (running water, surf), 0..1.
func (w *World) AmbientNoise(x, z float32) float32 {
	gr, fx, fz := w.gridAt(float64(x), float64(z))
	return float32(gr.ambientAt(fx, fz))
}

// finishHome settles the home places on the finished ground: every POI that is not
// on a structure pad gets its final height (the pond keeps its below-water centre),
// and the Old Oak and the stepping stones become vegetation instances.
func (w *World) finishHome() {
	hl := w.hl
	height := func(x, z float64) float64 {
		var s sample
		var r ovResult
		w.g.sample(x, z, &s)
		return hl.ov.apply(x, z, s.h, &r)
	}
	for i := range hl.pois {
		p := &hl.pois[i]
		if p.ID == "hidden_pond" {
			continue
		}
		p.Pos.Y = float32(height(float64(p.Pos.X), float64(p.Pos.Z)))
		if p.ID == "page_0" {
			p.Pos.Y += oldTowerPlatform // up on the tower's platform
		}
	}
	hl.spawn.Y = float32(height(float64(hl.spawn.X), float64(hl.spawn.Z)))
	hl.special = append(hl.special, core.Veg{Kind: core.VegOak, Variant: 6, Pos: vec(hl.oakX, height(hl.oakX, hl.oakZ), hl.oakZ), Scale: 2.6, Rot: quantRot(0.8)})
	for i, st := range hl.stones {
		hl.special = append(hl.special, core.Veg{Kind: core.VegRock, Variant: uint8(40 + i*37), Pos: vec(st[0], height(st[0], st[1]), st[1]), Scale: 0.65, Rot: quantRot(float64(i) * 1.3)})
	}
}
