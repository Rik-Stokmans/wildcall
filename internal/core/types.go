// Package core holds the shared contract types every Wildcall package builds on.
//
// Coordinate system (pinned, used by server AND client):
//   - Units are metres. Y is up. The world is unbounded in x and z; it is generated
//     on demand from the seed (chunk coordinates are signed). The player's home
//     valley is centred near the origin.
//   - North is -Z, east is +X.
//   - Yaw is a compass heading in radians: 0 = north (-Z), +pi/2 = east (+X).
//     The unit direction for heading h is (sin h, 0, -cos h).
//   - Pitch is radians, positive = looking up.
//   - Sea level is y = 0. All standing water (sea, river, marsh pools, lake) is the
//     single global water plane at y = 0; terrain below 0 is under water.
package core

import (
	"fmt"
	"math"
	"strconv"
)

const (
	ChunkSize   = 64  // metres per chunk side
	SeaLevel    = 0.0 // every body of standing water is the plane y = 0
	TickHz      = 10  // simulation ticks per second
	EyeHeight   = 1.65
	MapTileSize = 512 // metres covered by one map tile (8 x 8 chunks)
	MapTilePx   = 128 // pixels per map tile side (4 m per pixel)
	FogCell     = 32  // metres per fog-of-war cell (16 x 16 cells per map tile)
	HomeRadius  = 450 // metres: the home valley around the origin is always Greenhollow Woods
)

// Vec3 is a world-space position or direction in metres.
type Vec3 struct {
	X float32 `json:"x"`
	Y float32 `json:"y"`
	Z float32 `json:"z"`
}

func V(x, y, z float32) Vec3        { return Vec3{x, y, z} }
func (a Vec3) Add(b Vec3) Vec3      { return Vec3{a.X + b.X, a.Y + b.Y, a.Z + b.Z} }
func (a Vec3) Sub(b Vec3) Vec3      { return Vec3{a.X - b.X, a.Y - b.Y, a.Z - b.Z} }
func (a Vec3) Scale(s float32) Vec3 { return Vec3{a.X * s, a.Y * s, a.Z * s} }
func (a Vec3) Dot(b Vec3) float32   { return a.X*b.X + a.Y*b.Y + a.Z*b.Z }
func (a Vec3) Len() float32 {
	return float32(math.Sqrt(float64(a.X*a.X + a.Y*a.Y + a.Z*a.Z)))
}
func (a Vec3) Dist(b Vec3) float32 { return a.Sub(b).Len() }
func (a Vec3) DistXZ(b Vec3) float32 {
	dx, dz := a.X-b.X, a.Z-b.Z
	return float32(math.Sqrt(float64(dx*dx + dz*dz)))
}
func (a Vec3) Norm() Vec3 {
	l := a.Len()
	if l < 1e-6 {
		return Vec3{}
	}
	return a.Scale(1 / l)
}

// HeadingDir returns the horizontal unit direction for a compass heading.
func HeadingDir(yaw float32) Vec3 {
	return Vec3{float32(math.Sin(float64(yaw))), 0, -float32(math.Cos(float64(yaw)))}
}

// HeadingTo returns the compass heading (0..2pi) from a towards b.
func HeadingTo(a, b Vec3) float32 {
	h := float32(math.Atan2(float64(b.X-a.X), float64(-(b.Z - a.Z))))
	if h < 0 {
		h += 2 * math.Pi
	}
	return h
}

// LookDir returns the unit view direction for a yaw/pitch pair.
func LookDir(yaw, pitch float32) Vec3 {
	cp := float32(math.Cos(float64(pitch)))
	return Vec3{
		float32(math.Sin(float64(yaw))) * cp,
		float32(math.Sin(float64(pitch))),
		-float32(math.Cos(float64(yaw))) * cp,
	}
}

// Compass8 names a heading on an 8-point compass ("N","NE",...).
func Compass8(yaw float32) string {
	names := [8]string{"N", "NE", "E", "SE", "S", "SW", "W", "NW"}
	t := float64(yaw) / (2 * math.Pi)
	t -= math.Floor(t)
	return names[int(t*8+0.5)%8]
}

// Compass16 names a heading on a 16-point compass ("N","NNE",...).
func Compass16(yaw float32) string {
	names := [16]string{"N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"}
	t := float64(yaw) / (2 * math.Pi)
	t -= math.Floor(t)
	return names[int(t*16+0.5)%16]
}

// ---------------------------------------------------------------------------
// Habitats & regions

// Habitat classifies ground for vegetation, bird placement and audio clues.
type Habitat uint8

const (
	HabOcean    Habitat = iota // open sea
	HabBeach                   // sand, shingle, tidal flats
	HabMeadow                  // open grassland, wildflowers, hedgerows
	HabWoodland                // broadleaf forest
	HabConifer                 // pine forest
	HabMarsh                   // reedbeds, wet ground, shallow pools
	HabRiver                   // river channel, lake, and their banks
	HabAlpine                  // rock, scree, high grass above the treeline
	HabCliff                   // steep coastal or mountain rock faces
	HabSnow                    // snowfield / frozen ground (Frostveil)
	HabShrub                   // dense scrub, thickets, hedgerows, fern valley floor
	HabCount
)

var habitatKeys = [...]string{"ocean", "beach", "meadow", "woodland", "conifer", "marsh", "river", "alpine", "cliff", "snow", "shrub"}
var habitatLabels = [...]string{"Open sea", "Shoreline", "Open meadow", "Woodland canopy", "Pine forest", "Reedbed", "Riverside", "Mountain slope", "Cliff face", "Snowfield", "Dense shrubs"}

// Key is the stable snake_case identifier used in JSON and species data.
func (h Habitat) Key() string {
	if int(h) < len(habitatKeys) {
		return habitatKeys[h]
	}
	return "unknown"
}

// Label is the player-facing phrase used in audio clues ("Woodland canopy").
func (h Habitat) Label() string {
	if int(h) < len(habitatLabels) {
		return habitatLabels[h]
	}
	return "Unknown"
}

// HabitatFromKey resolves a key back to a Habitat; ok is false if unknown.
func HabitatFromKey(k string) (Habitat, bool) {
	for i, s := range habitatKeys {
		if s == k {
			return Habitat(i), true
		}
	}
	return 0, false
}

// RegionID identifies a region TYPE (spec §17.2). The generated world is a patchwork
// of large areas of these types; the home valley around the origin is always
// Greenhollow Woods.
type RegionID uint8

const (
	RegionGreenhollow     RegionID = iota // start: temperate forest, cabin, the fully developed prototype region
	RegionMurmurMarsh                     // wetland: reeds, waterways, ponds
	RegionWindpeak                        // highlands: rock, wind, mountain trails
	RegionWhisperingCoast                 // cliffs, beaches, seabirds
	RegionAmberwood                       // autumn forest
	RegionFrostveil                       // winter region: snow
	RegionCount
	RegionNone RegionID = 255 // open water away from any shore
)

var regionKeys = [...]string{"greenhollow", "murmur_marsh", "windpeak", "whispering_coast", "amberwood", "frostveil"}
var regionNames = [...]string{"Greenhollow Woods", "Murmur Marsh", "Windpeak Highlands", "Whispering Coast", "Amberwood", "Frostveil"}

func (r RegionID) Key() string {
	if int(r) < len(regionKeys) {
		return regionKeys[r]
	}
	return "none"
}
func (r RegionID) Name() string {
	if int(r) < len(regionNames) {
		return regionNames[r]
	}
	return "Open Sea"
}

// MarshalJSON writes a RegionID as a plain number. Without it encoding/json would
// treat []RegionID as a byte string and send base64 instead of a JSON array.
func (r RegionID) MarshalJSON() ([]byte, error) { return []byte(strconv.Itoa(int(r))), nil }

// UnmarshalJSON reads a RegionID from a plain number.
func (r *RegionID) UnmarshalJSON(b []byte) error {
	n, err := strconv.Atoi(string(b))
	if err != nil || n < 0 || n > 255 {
		return fmt.Errorf("core: bad region id %s", b)
	}
	*r = RegionID(n)
	return nil
}

// RegionFromKey resolves a region key; ok is false if unknown.
func RegionFromKey(k string) (RegionID, bool) {
	for i, s := range regionKeys {
		if s == k {
			return RegionID(i), true
		}
	}
	return RegionNone, false
}

// ---------------------------------------------------------------------------
// Vegetation & perches

// VegKind is a renderable scenery instance type. The numeric value is the wire value
// in the binary chunk format, so NEVER reorder; append only.
type VegKind uint8

const (
	VegOak        VegKind = iota // broadleaf tree, round canopy
	VegBirch                     // slim broadleaf tree, pale trunk
	VegPine                      // conifer, layered cones
	VegSnag                      // dead tree, bare branches (great exposed perch)
	VegShrub                     // rounded bush / hedgerow segment
	VegReeds                     // reed clump (marsh)
	VegRock                      // boulder
	VegFlowers                   // wildflower patch (decor)
	VegGrassTuft                 // tall grass tuft (decor)
	VegLog                       // fallen log
	VegStump                     // tree stump
	VegFern                      // fern cluster (woodland floor decor)
	VegDriftwood                 // beach decor
	VegAmberOak                  // autumn-coloured broadleaf (Amberwood)
	VegAmberBirch                // autumn-coloured birch (Amberwood)
	VegSnowPine                  // snow-laden conifer (Frostveil)
	VegMushroom                  // woodland floor decor
	VegLilyPads                  // pond surface decor
	VegKindCount
)

// Veg is one scenery instance. Scale 1.0 is the kind's nominal size
// (oak ~11 m tall, birch ~10 m, pine ~14 m, snag ~8 m, shrub ~1.6 m, reeds ~2 m, rock ~1 m).
type Veg struct {
	Kind    VegKind
	Variant uint8   // 0..255 random per-instance variation seed
	Pos     Vec3    // base position on the ground
	Scale   float32 // uniform scale
	Rot     float32 // radians about Y
}

// PerchKind describes where a bird can sit / stand.
type PerchKind uint8

const (
	PerchCanopy    PerchKind = iota // inside a tree crown (high cover)
	PerchBranch                     // exposed outer branch or treetop (low cover)
	PerchSnag                       // dead tree top / fence post (no cover)
	PerchShrub                      // in or on a bush
	PerchReed                       // reed stem
	PerchGround                     // open ground
	PerchRock                       // boulder / cliff ledge
	PerchWater                      // floating on water
	PerchShore                      // water's edge: mud, sand, shallows
	PerchTrunk                      // clinging to a trunk (woodpeckers, nuthatch)
	PerchStructure                  // roof, tower rail, signpost
	PerchKindCount
)

var perchKeys = [...]string{"canopy", "branch", "snag", "shrub", "reed", "ground", "rock", "water", "shore", "trunk", "structure"}

func (p PerchKind) Key() string {
	if int(p) < len(perchKeys) {
		return perchKeys[p]
	}
	return "unknown"
}

// PerchKindFromKey resolves a perch key; ok is false if unknown.
func PerchKindFromKey(k string) (PerchKind, bool) {
	for i, s := range perchKeys {
		if s == k {
			return PerchKind(i), true
		}
	}
	return 0, false
}

// Perch is a concrete spot a bird may occupy.
type Perch struct {
	Pos   Vec3
	Kind  PerchKind
	Cover float32 // 0 = fully exposed, 1 = buried in foliage (hard to see)
}

// POI is a point of interest: structures, NPC spots, collectibles, viewpoints.
// Home-valley POIs have the ids pinned by docs/contract.md §2.2 so quests can
// reference them; generated POIs elsewhere have deterministic ids of the form
// "<kind>@<cellX>,<cellZ>" (structure-grid cell) so they can be resolved again later.
type POI struct {
	ID     string            `json:"id"`
	Kind   string            `json:"kind"` // cabin|ranger_station|watchtower|shop|research_site|abandoned_station|hidden_cabin|camp|viewpoint|hide|landmark|pond|npc|feather|page|relic|cache|sign
	Name   string            `json:"name"`
	Pos    Vec3              `json:"pos"`
	Yaw    float32           `json:"yaw"`
	Region RegionID          `json:"region"`
	Radius float32           `json:"radius"` // discovery / interaction radius in metres
	Hidden bool              `json:"hidden"` // secret: not on the map until discovered
	Data   map[string]string `json:"data,omitempty"`
}

// Terrain is the read-only world query surface, implemented by internal/world.
// All methods must be safe for concurrent use and deterministic for a given seed.
type Terrain interface {
	Seed() int64
	// HeightAt returns ground height in metres (negative = under water).
	HeightAt(x, z float32) float32
	HabitatAt(x, z float32) Habitat
	// RegionAt returns RegionNone for open sea outside the island.
	RegionAt(x, z float32) RegionID
	// Cover returns 0..1 vegetation density (canopy/reeds) at a point; used for
	// stealth, lighting and visibility.
	Cover(x, z float32) float32
	// AmbientNoise returns 0..1 steady environmental noise at a point (river rush,
	// surf, waterfall). Weather noise is added separately from Env.
	AmbientNoise(x, z float32) float32
	// PerchesNear appends every perch within radius (XZ distance) of (x,z) to buf.
	PerchesNear(x, z, radius float32, buf []Perch) []Perch
	// Occlusion returns 0..1: how blocked the straight line from → to is by terrain
	// and foliage. 1 = terrain (or solid structure) fully blocks; partial values come
	// from tree crowns, shrubs and reeds crossed along the way.
	Occlusion(from, to Vec3) float32
	// HomePOIs returns the fixed set of home-valley POIs (pinned ids).
	HomePOIs() []POI
	// POIsNear appends every POI within radius (XZ distance) of (x,z) to buf: home
	// POIs and generated ones alike. Deterministic; cheap enough to call every second.
	POIsNear(x, z, radius float32, buf []POI) []POI
	// POI resolves an id (pinned or generated) back to its POI.
	POI(id string) (POI, bool)
	// TrailsNear appends every trail with a point within radius of (x,z) to buf.
	TrailsNear(x, z, radius float32, buf []Trail) []Trail
	// Spawn is the new-game player start (just outside the cabin) and its heading.
	Spawn() (pos Vec3, yaw float32)
	// Chunk returns the encoded binary chunk message (see docs/contract.md §2.3).
	// cx, cz are signed. lod 0 = 2 m cells, lod 1 = 4 m, lod 2 = 8 m. Results are
	// cached (bounded LRU).
	Chunk(cx, cz, lod int) ([]byte, error)
	// MapTile renders the stylised top-down map tile (tx, tz) as PNG bytes:
	// MapTilePx square, covering MapTileSize metres from (tx*MapTileSize, tz*MapTileSize),
	// north (-Z) up. Cached.
	MapTile(tx, tz int) ([]byte, error)
}

// Trail is a named footpath. Hidden trails are only drawn on the map once walked
// (or revealed by Trail Sense).
type Trail struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Hidden bool   `json:"hidden"`
	Points []Vec3 `json:"points"`
}
