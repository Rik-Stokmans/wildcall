# WILDCALL — Build Contract

This is the binding interface document for everyone building the prototype in parallel.
The game spec is `Wildcall Spec.md` (repo root). The architecture and the reasons behind
it are in `docs/superpowers/specs/2026-11-26-wildcall-design.md`.

**Sources of truth, in order:** the Go types in `internal/core` and `internal/proto`
(compiled, field names are the wire format) → this document (semantics, ownership,
pinned ids) → the game spec (what the player should experience).

**Rules for parallel work**

1. Only create or edit files inside the paths your task owns (§1). Never edit
   `internal/core`, `internal/proto`, `web/js/core`, `web/js/main.js`, `web/index.html`,
   `web/css/base.css`, `go.mod`, or another task's files. If the contract is wrong or
   missing something you need, do the most reasonable thing inside your own files and
   say so in your final report under "Contract issues".
2. Do not run `git add`, `git commit` or any other git write command. The lead commits.
3. Go: build and test only your own package(s) (`go test ./internal/<pkg>/...`). Other
   packages are being written at the same time and may not compile.
4. No new dependencies. Go: standard library only (plus `gorilla/websocket`, server
   only). Client: vanilla ES modules + the vendored `three` (r170) — no npm, no bundler,
   no CDN, no external fonts or assets. All art is procedural (geometry, canvas, SVG,
   Web Audio synthesis).
5. Everything must be deterministic for a given seed where the contract says so.

---

## 1. Ownership

### Go (module `github.com/Rik-Stokmans/wildcall`)

| Task | Owns | Purpose |
|---|---|---|
| lead (done) | `internal/core`, `internal/proto`, `internal/species/catalog.go` | contract types |
| `world` | `internal/noise`, `internal/world` | the unbounded world generator: terrain, region types, vegetation, perches, POIs, trails, chunks, map tiles |
| `species-greenhollow` | `internal/species/greenhollow.go`, `greenhollow_test.go` | Greenhollow roster (20 species) |
| `species-regional` | `internal/species/regional.go`, `regional_test.go` | all other regions (18 species) |
| `eco` | `internal/eco`, `internal/env` | bird simulation; clock, seasons, weather, forecast |
| `progress` | `internal/progress` | ranks, skills, items, cabin upgrades, stats, XP, inventory, shop rules |
| `content` | `internal/content` | regions, NPCs + dialogue, quests + quest engine, collectibles, lore |
| `field` | `internal/field` | perception: hearing/clues, movement cues, observation/evidence, ID confidence, photo & recording scoring, rare discoveries |
| `server` (stage 2) | `internal/game`, `internal/server`, `internal/save`, `cmd/wildcall` | session orchestration, WebSocket/HTTP, persistence, main |
| `desktop` | `desktop/`, `.github/workflows/` | Electron shell, packaging for macOS + Windows, CI builds (§7) |
| `narrator` | `internal/narrator`, `web/js/narrator/`, `web/css/narrator.css` | the narrator: line bank + director (Go), speech + captions (client) (§8) |

### Client (`web/`, embedded into the Go engine binary, shown inside the desktop app window)

| Task | Owns | ctx API |
|---|---|---|
| lead (done) | `index.html`, `css/base.css`, `js/main.js`, `js/core/*`, `js/ui/kit.js` signatures | `ctx.bus net state input ui` |
| `c-world` | `js/world/` | `ctx.world` |
| `c-sky` | `js/sky/`, `js/props/` | `ctx.sky`, `ctx.props` |
| `c-birds` | `js/birds/` | `ctx.birds` |
| `c-player` | `js/player/`, `css/tools.css` | `ctx.player`, `ctx.tools` |
| `c-audio` | `js/audio/` | `ctx.audio` |
| `c-kit` | `js/ui/kit.js` (bodies only), `js/ui/kit/`, `css/kit.css` | `ctx.kit` |
| `c-hud` | `js/ui/hud/`, `css/hud.css` | — |
| `c-encounter` | `js/ui/encounter/`, `css/encounter.css` | — |
| `c-menu` | `js/ui/menu/`, `css/menu.css` | — |
| `c-journal` | `js/ui/journal/`, `css/journal.css` | — |
| `c-base` | `js/ui/base/`, `css/base-screen.css` | — |

A module may add any number of files inside its own directory. Client tests are plain
`node --test` files next to the code (`*.test.js`) covering pure logic (no DOM, no
three.js); every JS file must pass `node --check`.

---

## 2. World

Coordinates, units, yaw/pitch conventions and constants: see the header comment of
`internal/core/types.go`. Summary: metres, Y up, north = −Z, east = +X, yaw is a
compass heading (0 = north, π/2 = east), sea level is `y = 0` and all standing water
(sea, lakes, rivers, marsh pools, ponds) is that one plane.

**Client camera mapping:** `camera.rotation.order = 'YXZ'`, `rotation.y = -yaw`,
`rotation.x = pitch`.

### 2.1 A big generated world

The world is **unbounded and generated on demand from a seed**, Minecraft-style, in
WILDCALL's stylised look. Every query (`HeightAt`, `RegionAt`, chunks, POIs, perches…)
is a deterministic function of the seed and the position; chunk coordinates are
signed; there are no world edges. A new adventure gets a random seed unless the player
types one (text is hashed). The same seed always gives the same world.

- **Region types.** The spec's six regions are the world's biome-like region types.
  They form large patches (typically 600–1600 m across) chosen from smooth climate
  fields (continentalness → sea/coast/inland, elevation/ruggedness → highlands,
  temperature → frost, moisture → marsh, a slow "season drift" field → Amberwood):
  Greenhollow Woods (temperate broadleaf forest with pine stands, clearings, thickets,
  streams, ponds — the most common type), Murmur Marsh (reedbeds, pools and channels
  at/just below sea level), Windpeak Highlands (mountains to 150–300 m, rock, scree,
  sparse pines, cliffs), Whispering Coast (the land within ~150 m of the sea: beaches,
  dunes, sea cliffs, stacks), Amberwood (autumn-coloured forest), Frostveil (cold high
  plateaus: snowfields, frozen lakes treated as flat ice at y = 0.3, snow-laden pines).
  Transitions blend over ~60 m in height and colour; `RegionAt` is a hard classification.
  Land dominates (~75 %); seas and lakes are bounded bodies, so one can travel far on
  foot, but deep water is impassable (the player wades to ~1.2 m).
- **Rivers and creeks.** A river-mask noise carves winding channels to just below
  y = 0 through lowland (base elevation under ~14 m); they widen into lakes and reach
  the sea. In higher ground they fade into dry gullies. Shallow reaches (0.2–0.7 m)
  are wadeable.
- **Terrain detail.** Within a region: rolling hills, hollows, knolls, clearings,
  rocky outcrops; walkable slopes (< ~32°) across most of every region except
  Windpeak's faces and sea cliffs.
- **The home valley.** Within `core.HomeRadius` (450 m) of the origin the region is
  always Greenhollow Woods and the terrain is gentle (2–35 m). The generator lays out
  the starting area of spec §18 there for every seed — arranged differently per seed
  by a deterministic site search — and shapes the ground for it: a creek (channel just
  below y = 0, 3–6 m wide) crossing the valley, a meadow clearing ~120 m across, a
  damp fern hollow downstream, a wooded rise for the watchtower, a small secluded
  pond. Outside the home valley everything is purely procedural.

### 2.2 Points of interest

`POI.Kind` vocabulary: `cabin ranger_station watchtower shop research_site
abandoned_station hidden_cabin camp viewpoint hide landmark pond npc feather page relic
cache sign`.

**Home valley (pinned ids, present in every world):**

| id | kind | name | notes |
|---|---|---|---|
| `cabin` | cabin | Naturalist Cabin | player home, within 60 m of the origin on a flattened pad. Spawn is 6 m in front of the door, facing away towards the Woodland Entrance. |
| `npc_mara` | npc | Mara | beside the cabin porch. `Data{"npc":"mara"}` |
| `woodland_entrance` | landmark | Woodland Entrance | timber arch on the main path ~120 m from the cabin |
| `shop_finn` | shop | Finn's Field Supply | stall beside the Woodland Entrance |
| `npc_finn` | npc | Finn | at the stall. `Data{"npc":"finn"}` |
| `old_oak` | landmark | The Old Oak | one giant oak (scale ≥ 2.4) in a small clearing |
| `creekside` | landmark | Creekside | where the main path meets the creek (stepping stones) |
| `research_creekside` | research_site | Creekside Field Lab | canvas lab tent by the creek |
| `npc_alder` | npc | Professor Alder | at the field lab. `Data{"npc":"alder"}` |
| `fern_valley` | landmark | Fern Valley | damp hollow, dense ferns and shrubs, downstream of Creekside |
| `meadow_clearing` | landmark | Meadow Clearing | open meadow with wildflowers |
| `ranger_station` | ranger_station | Greenhollow Ranger Station | at the far end of the main path |
| `npc_june` | npc | June | at the ranger station. `Data{"npc":"june"}` |
| `old_watchtower` | watchtower | Old Watchtower | abandoned, on a wooded rise off the trail; climbable (client) |
| `hidden_pond` | pond | Hidden Pond | **Hidden.** small pond ringed by reeds and shrubs, off-trail |
| `hide_creek` | hide | Creek Hide | wooden bird hide overlooking the creek |
| `viewpoint_lookout` | viewpoint | Lookout Rock | **Hidden.** rocky outcrop with a long view |
| `hidden_cabin` | hidden_cabin | Trapper's Cabin | **Hidden.** ruined cabin deep off-trail |
| `camp_survey` | camp | Old Survey Camp | **Hidden.** abandoned camp in the pines |
| `cache_watchtower` | cache | Weathered Satchel | at the Old Watchtower. `Data{"item":"forgotten_journal"}` |
| `cache_hidden_cabin` | cache | Dusty Leather Case | at Trapper's Cabin. `Data{"item":"historical_binoculars"}` |
| `cache_camp` | cache | Oilcloth Bundle | at Old Survey Camp. `Data{"item":"vintage_recorder"}` |
| `page_0` | page | Torn Journal Page | inside the Old Watchtower. `Data{"collectible":"page_0"}` |

Hidden home POIs are genuinely off-trail (≥ 60 m from the main trail), tucked into
terrain and vegetation, all inside the home valley.

**Generated POIs (everywhere else, and a few extra inside the home valley).** A
structure grid of 192 m cells; each cell deterministically holds zero or one feature
chosen by region type, terrain and a seeded roll (about 45 % of land cells have one):

| kind | where | notes |
|---|---|---|
| `watchtower` | high ground, any region | climbable; long views |
| `hide` | by water: marsh, rivers, lakes, coast | |
| `camp` | forest, highlands | **Hidden** half the time |
| `hidden_cabin` | deep forest (Greenhollow, Amberwood) | **Hidden**; has a `cache` beside it |
| `abandoned_station` | marsh, highlands, frost, coast | **Hidden** half the time; has a `cache` |
| `viewpoint` | local summits, cliff tops | **Hidden** |
| `pond` | forest hollows | **Hidden**; a real carved pond with reeds |
| `landmark` | anywhere | a notable natural or old human feature fitting the region: giant tree, standing stones, waterfall rocks, sea arch, lighthouse (coast, rare), boardwalk (marsh), cairn (highlands), frozen falls (frost) |
| `ranger_station` | rare (≈ 1 per 2 km²), on gentle ground | a waypoint with a signpost; no NPC |
| `feather` | off-trail spots in fitting habitat (≈ 1 per 3 cells, as an extra) | `Data{"region":"<key>"}` |
| `page` | at some camps / stations / hidden cabins | a journal page lies there |
| `relic` | rare; at landmarks | |
| `cache` | beside hidden cabins and abandoned stations | `Data{"region":"<key>"}` |

Generated ids are `"<kind>@<cellX>,<cellZ>"` (signed cell coordinates; companions such
as the cache of a station use their own kind with the same cell). Names are generated
from region-flavoured word lists ("Heron Reach Hide", "Thornback Tower", "Greywater
Station"), deterministic per id, unique-feeling. Every generated POI sits on land at a
sensible spot (flattened pad for structures), never under water, and
`POI.Region` is the region type at its position.

What a generated `feather`, `page`, `relic` or `cache` actually **contains** is not
the world's business: the session resolves it (§3.6) — feathers belong to a species of
that region, pages are handed out in story order, caches hold the next unique item
for that region type or a modest find.

`Radius`: 14 m for landmarks/structures (discovery), 3 m for npc/cache/collectibles
(interaction).

**Trails** (`core.Trail`): in the home valley `main` "Greenhollow Trail" (cabin →
Woodland Entrance → Old Oak → Creekside → Ranger Station, with a spur to the Meadow
Clearing), and hidden trails `secret_pond`, `secret_cabin`, `secret_lookout`,
`secret_camp`. Elsewhere, each non-hidden generated structure is linked to its
nearest non-hidden neighbour within 420 m by a generated trail (id
`"trail@<cellX>,<cellZ>"`), routed around water and steep ground; hidden POIs
sometimes get a hidden trail from the nearest visible one. Terrain is flattened
slightly and coloured as trodden earth along visible trails; hidden trails are only a
faint colour change.

### 2.3 Chunk binary format

`Terrain.Chunk(cx, cz, lod)` returns one binary WebSocket frame. Little endian.
`cx, cz` are signed. LOD cell size = `2 << lod` metres (lod 0 → 2 m, 1 → 4 m, 2 → 8 m);
`N = 64 / cell + 1` vertices per side (33, 17, 9).

```
offset size  field
0      4     magic  = bytes 'W','C','H','K'
4      1     version = 2
5      1     lod
6      2     N  (uint16)
8      4     cx (int32)
12     4     cz (int32)
16     N*N*4 heights   float32   row-major: index = iz*N + ix, world x = cx*64 + ix*cell, z = cz*64 + iz*cell
…      N*N*3 normals   int8 ×3   (x,y,z) * 127
…      N*N*3 colors    uint8 ×3  sRGB vertex colour (region/habitat palette, trails, shoreline already blended in)
…      N*N   region    uint8     core.RegionID at each vertex (255 = open water)
…      N*N   habitat   uint8     core.Habitat at each vertex
…      pad to a multiple of 4 bytes from the start of the frame
…      4     vegCount (uint32)
…      vegCount*20   each: kind u8, variant u8, rot u16 (radians = rot/65535*2π), x f32, y f32, z f32, scale f32
```

Vegetation by LOD: lod 0 → everything; lod 1 → trees, snags, shrubs, rocks, reeds;
lod 2 → trees and snags only. Vegetation positions are identical across LODs.
Chunks are edge-consistent: shared border vertices have identical heights, normals,
colours, region and habitat, including across LODs at shared vertices.

Generation must be fast and bounded: a lod-0 chunk (heights, colours, vegetation,
perches) in ≤ 4 ms on one laptop core; all caches are bounded LRUs (the world never
holds more than a few hundred chunks' worth of data); everything is safe for
concurrent use.

### 2.4 Perches and occlusion

Perches are derived deterministically from vegetation and terrain: tree crowns
(`canopy`, cover 0.6–0.9, at 55–90 % of tree height), outer branches and tops (`branch`,
cover 0.1–0.35), snags and posts (`snag`, cover 0), shrubs (`shrub`, cover 0.5–0.8),
reeds (`reed`, cover 0.5–0.7), open `ground` (cover from ground vegetation, 0–0.3),
`rock`, `water` (points on the water surface, y = 0), `shore` (water's edge),
`trunk` (on tree trunks at 2–8 m), `structure` (roofs, rails). `PerchesNear` must be
fast (per-chunk perch lists, cached) — the ecosystem calls it constantly.

`Occlusion(from, to)`: 1.0 if terrain blocks the segment; otherwise accumulate partial
occlusion from every tree crown (sphere/cone, ~0.35 each for a centre hit, scaled by
path length through it), shrub and reed bed crossed, clamped to 0..0.95.

### 2.5 Map tiles and fog of war

`Terrain.MapTile(tx, tz)`: a 128 px PNG covering 512 m (4 m per pixel), north up: a
stylised parchment-toned map with soft hillshade, region tints, water, beaches, visible
trails (no labels or icons; the client overlays those). Served at `/map/<tx>/<tz>.png`.
Fog of war is sparse: `Profile.Explored` maps tile keys to 256-bit masks of 32 m cells
(layout documented on the field). The client only ever draws tiles that contain an
explored cell.

---

## 3. Simulation rules

### 3.1 Time, seasons, weather (`internal/env`)

- One in-game day = `dayLen` real seconds (default 1440 → 1 game hour per real minute).
- A new game starts Day 1, 06:30, Spring, Sunny. A season lasts 4 days; year = 16 days.
- Weather changes on a Markov schedule in 2–5 hour blocks; Rain is less likely than
  Sunny/Cloudy; `Wind`, `Rain`, `Cloud`, `Mist` ease towards their targets (no pops).
  Mist forms at dawn and after rain. `Light` follows the sun (season-dependent day length).
- `Forecast` = the already-decided weather for the next 12 hours in 3-hour slots.
- `env.Clock` API: `New(seed int64, dayLen float32) *Clock`, `Advance(dt float32)`,
  `Env() core.Env`, `Forecast() []proto.ForecastSlot`, `SkipTo(hour float32) (hoursSkipped float32)`,
  `Set(time float32, day int)`, `SetWeather(w core.Weather)`, `SetSeason(s core.Season)`,
  `State() / Restore(State)` for saving (State is a JSON-serialisable struct).

### 3.2 Ecosystem (`internal/eco`)

Constructor: `eco.New(t core.Terrain, species []core.Species, seed int64) *Sim`
(`*Sim` implements `core.Ecosystem`). Spec §5, §6.3, §6.4, §11, §12.

- The world is unbounded, so the simulation is **local but persistent**: the land is
  divided into 128 m population cells; every cell's resident birds are a
  deterministic function of (seed, cell, season) — species by the region type and
  habitats found there (`Regions`/`Habitats`/`Density`), each individual with a stable
  id, home territory (centre + `Behavior.Territory`), favourite perches and feeding
  spots found with `Terrain.PerchesNear`, and (rarely) rare plumage. Cells within
  ~520 m of the observer are active and fully simulated (typically 350–600 birds);
  cells are activated/retired with hysteresis as the observer travels. On activation a
  bird is placed where its routine puts it at that time of day, so returning to a place
  finds the same individuals living their lives (design rule 5). Without an observer
  the cells around the home valley stay active. Each bird follows a daily routine
  driven by `Behavior.Activity[phase]`.
- Behaviour states: see `core.BirdAct`. Birds move between perches, forage, feed
  (`ActFeeding`, a few seconds), sing from song posts, preen, bathe, roost at night
  (owls invert), flock (`Sociality == "flock"`: members share a leader/target), soar or
  hover if their flight style says so, and show their `Behavior.Specials`.
- Vocalization: bouts start with probability from `Behavior.Vocal` × activity ×
  weather (rain and strong wind suppress) × dawn-chorus boost, never while fleeing or
  hiding. A bout emits one `EvCall` (`Call`, `Repeats`, `Dur`) and sets `FlagSinging`
  for its duration. A bird that has just been disturbed **stops calling** for a while.
- Player disturbance (spec §6.4 / §12.4 table): each bird accumulates `Fear` from the
  observer within its flush distance = `Shyness × moveFactor × approachFactor ×
  obs.Stealth × (crouch/sit ? obs.CrouchBonus : 1) × habituation`, where moveFactor is
  sprint 2.2, run 1.5, walk 1.0, crouch-walk 0.6, still 0.35; approachFactor is 1.3 for
  a direct approach (velocity pointing at the bird) and 0.8 for a tangential one;
  `obs.Noise` adds a burst. Low fear → `FlagWary`; medium → `ActAlert`; then
  either `ActHiding` (skulkers, cover nearby) or `ActFleeing` (emits `EvFlush`). Fear
  decays with distance and with `obs.Still` × `obs.Settle`; after fleeing, birds
  **return** to their territory after 40–150 s and resume normal behaviour. Birds that
  spend time near a calm observer become `FlagHabituated` (rate × `Habituate` ×
  `obs.Familiarity`).
- Seasons: species with `Seasons[season] == false` are absent (they leave / arrive over
  the first hours of a season, emitting `EvArrive` for arrivals).
- Rare discoveries (spec §11): ~1.5 % of individuals carry `FlagRarePlumage`. On windy
  or post-rain days, and at season changes, a small number of **vagrants** appear: a
  bird of a species from another region type placed in suitable habitat with
  `FlagVagrant` (always at least one vagrant among the active cells during autumn). `Rare`/`Legendary` species follow strict conditions from their data
  (phase, weather, habitat) and exist in very small numbers.
- `EvMove` is emitted for conspicuous movement (take-off, landing, branch-to-branch
  hop) of birds within 60 m of the observer — it feeds the movement cues.
- Lures (`AddLure`): seed-eating and ground-feeding species within `Radius` visit in
  turn and show `ActFeeding` at the lure.
- Performance budget: `Step` for 600 active birds in < 1 ms on a laptop core; cell
  activation must not hitch (spread it over ticks). Use a spatial grid for `Near`.
  Birds far from the observer may tick at a reduced rate, but they keep living
  (positions change, calls happen).
- Must be deterministic given seed + identical call sequence.

### 3.3 Perception (`internal/field`)

Pure, stateless-where-possible functions over `core.Terrain`, `core.Ecosystem`,
`core.Stats`, `core.Env` and the player's `proto.Profile`. The `server` stage wires
them into the session; design the API for that (documented exported funcs + small
state structs the session can hold). Required capabilities:

1. **Hearing → clues (spec §5).** Given an `EvCall`, the player pose (pos, yaw, focus,
   speed) and stats: is it audible? Audible range = `call.AudibleRange() × HearRange ×
   (focus ? 1 + FocusBonus : 1) × (1 − 0.5·occlusion) × (1 − noise·(1 − NoiseReduce))`
   where `noise = max(Terrain.AmbientNoise, env.WeatherNoise())` and moving fast adds
   own-footstep noise. If audible, build a `proto.Clue`: bearing with error and spread
   shrinking with `DirAccuracy` and focus; `Dir` text 8-point at low accuracy, 16-point
   when high; distance band only if `DistAcc` > 0.1 (band width shrinks with it);
   elevation word if `DirAccuracy` ≥ 0.5; pitch/pattern/habitat/perch only with the
   matching stat ≥ 1 (focus listening temporarily grants pitch and pattern);
   `Confidence` from strength; `Known` only if the player has identified the species
   AND (`CallRecognise` ≥ 1, or `CallMemory` ≥ 1 and they hold a recording of it);
   `Unusual` only with `Instinct` ≥ 1 for vagrants/rare species/rare plumage. At most
   `ClueSlots` clues are live at once (strongest win). **Never** put a species name in a
   clue for an unidentified species. Focus listening must not reveal birds — it only
   improves the numbers.
2. **Movement cues.** From `EvMove`/`EvFlush`: a `proto.MoveCue` when the bird is within
   `MoveSense` metres and inside the view cone, or within `Peripheral` metres outside it.
3. **Observation → evidence (spec §6, §13).** Each observation tick, find the bird the
   player is looking at (smallest angle to the view axis, within a cone of ~`FOV/2`
   and at most 3° + 40 % of the half-FOV from the centre for evidence gathering).
   `Clarity` 0..1 combines: apparent size (bird length × zoom / distance; naked-eye
   base range 14 m × `NakedEye`), `Terrain.Occlusion`, perch cover vs. `Skulking`,
   light (`env.Light`, helped by `LowLight`/`BinoClarity`), rain, camouflage (`Camo`,
   strong when the bird is still), motion (airborne birds are harder; `Pose.Sharp`
   optical focus multiplies everything). Evidence accumulates at
   `Clarity × ObserveSpeed`; each time progress fills, reveal the next evidence key the
   current clarity allows, in this order: `size`, `shape` (clarity ≥ 0.2) → `primary`,
   `flight` (if airborne) → `secondary`, `bill` (≥ 0.45) → `marking` (≥ 0.65).
   `behavior` and `habitat` evidence come from what the bird is doing / where it is.
   `Sighting.Blocked` names the dominant reason clarity is low.
   If the species is already identified by the player and `Recognise` ≥ 1 (or after
   ~1.5 s at clarity ≥ 0.35 otherwise) the sighting reports `Known`.
4. **Identification confidence (spec §13.1).** `Candidates(evidence, wrong, region,
   habitat, season, stats, catalog)`: score every species that occurs in the player's
   unlocked regions; each matching evidence key multiplies the score up, each
   mismatching key multiplies it down hard (but not to zero: observation can be
   wrong-ish for similar colours); habitat, region type and season give a mild prior; species in
   `wrong` are excluded. Normalise to percentages, return the top 5 (top 3 with
   IDAssist 0; `IDAssist` and `RareID` sharpen the distribution toward the truth by
   weighting evidence more strongly). Deterministic.
5. **Photo scoring (spec §13.2).** Given a `proto.Photo`, find birds in the frustum;
   for the best subject compute sub-scores 0..100: `Focus` (Photo.Sharp, shake),
   `Composition` (centred-ness, rule-of-thirds bonus, subject size in frame — ideal
   12–45 % of frame height, + `Stats.Composition`), `Distance` (size in frame),
   `Lighting` (env.Light, golden hour bonus at dawn/evening, rain/mist penalty),
   `Visibility` (occlusion, cover). `Score` = weighted mean capped by
   `40 + 60·CamQuality`; `Stars` = 0 if no bird is visible, else 1..5 by score
   (20/40/60/75/90). Tags: `behavior:<key>` for the subject's act, `golden hour`,
   `rare` (rare species, plumage or vagrant), `exceptional` (score ≥ 90), `flight`.
   `MomentBonus` adds to behaviour photos.
6. **Recording scoring (spec §13.2).** Track calls heard during a recording window:
   the best-captured call wins. Quality 0..100 from distance vs `RecRange`, noise
   (ambient + weather, reduced by `NoiseReduce`), on-axis aim (matters more as
   `RecFocus` rises — directional mics reject noise but must be pointed), duration
   (≥ 1 full phrase; more is better up to ~8 s), `RecQuality`. Also provide the live
   meter values for `proto.RecState`.
7. **Rare discovery detection.** Helpers that decide when an observation/photo/ID
   constitutes a `proto.RareDiscovery` (rare species first seen, rare plumage observed
   at clarity ≥ 0.5, vagrant identified, exceptional photo, first uncommon behaviour).

### 3.4 Progression (`internal/progress`)

- **Levels:** `XPForLevel(l) = 200 + 120·(l−1)` XP to go from level l to l+1; cap 40.
  Each level grants 1 skill point.
- **XP sources (spec §7.3) and anti-grind (spec §7.4)** — exported constants:
  discover landmark 25 · first encounter of a species ("spot") 50 · first
  identification 100 (150 uncommon / 250 rare / 400 legendary; probable ID pays half
  now, the rest on confirmation) · photograph 40 for the first photo of a species, then
  only when the star rating beats the player's best for that species (+15 per extra
  star) · recording 35 with the same rule · unique behaviour 75 (first time per
  species + uncommon behaviour) · rare discovery 250 · research quest 300 (from quest
  data). `Profile.XPLog` holds the counters. Everything is multiplied by `XPMult`.
- **Ranks (spec §7.2):** 1 Beginner (start) · 2 Observer: level 3, 5 species, quest
  `unseen_singer` turned in · 3 Naturalist: level 8, 12 species, 6 documented, rep 60 ·
  4 Field Specialist: level 14, 22 species, 14 documented, rep 150 · 5 Master
  Naturalist: level 22, 32 species, 25 documented, rep 300. Reaching a rank grants 2
  bonus skill points. Rank is checked after every profile change.
- **Skills (spec §8):** five disciplines `acoustics observation photography knowledge
  fieldcraft`, the seven skills the spec lists for each, ids = snake_case of the name
  (`keen_ears`, `sound_direction`, `acoustic_memory`, `frequency_awareness`,
  `deep_listening`, `echo_reading`, `natural_recognition`, `sharp_eyes`,
  `movement_recognition`, `patience`, `habitat_reading`, `peripheral_awareness`,
  `tracking`, `natural_instinct`, `steady_hands`, `quick_shot`, `focus_control`,
  `silent_shutter`, `wildlife_composition`, `long_lens_mastery`, `perfect_moment`,
  `field_experience`, `species_recognition`, `habitat_knowledge`, `seasonal_awareness`,
  `behavioral_insight`, `ecological_knowledge`, `master_naturalist`, `quiet_steps`,
  `trail_sense`, `weather_sense`, `concealment`, `campcraft`, `wildlife_familiarity`,
  `woodland_mastery`). Tiers: the first two listed skills are Tier I (max rank 3,
  cost 1), next two Tier II (max rank 2, cost 1), next two Tier III (max rank 2,
  cost 2), the last is Tier IV (max rank 1, cost 3). Tier requirements: II = 3 points
  invested in the discipline, III = 6, IV = 10 **and** naturalist rank ≥ 3. Every skill
  must change at least one `core.Stats` field through `Mods` so it has a real effect.
- **Items (spec §9, §10):** equipment slots `optics camera audio backpack navigation
  clothing`; tiers 1–4; rarity 0–4. Every tier-2+ item has real tradeoffs (negative
  mods and `Cons`). Pinned ids: starting kit `basic_binoculars`, `starter_camera`,
  `canvas_satchel` (backpack), `trail_map` (navigation), `field_clothes` (clothing);
  `basic_recorder` (audio, given by Mara during `unseen_singer`); `explorer_binoculars`
  (the "upgraded binoculars"); the six unique items of §2.2's caches —
  `forgotten_journal` (keepsake), `historical_binoculars` (optics), `vintage_recorder`
  (audio), `explorers_lens` (gadget), `naturalists_compass` (navigation),
  `research_backpack` (backpack); supplies `film_roll` (use `film`: +12 shots this
  expedition) and `seed_mix` (use `seed`: place a lure). Also provide: tier-3
  specialist binoculars and a spotting scope, the camera types of spec §9.6, the audio
  gear of §9.7 (directional/parabolic rigs and advanced recorder are `audio`-slot
  equipment; headphones, audio analyzer and spectrogram device are **gadgets** that
  work while carried), clothing (camouflage smock, rain shell, sturdy boots), better
  backpacks and navigation gear. Gadgets and keepsakes occupy backpack capacity;
  equipped items do not.
- **Stats:** `ComputeStats(p *proto.Profile) core.Stats` = `core.BaseStats()` + equipped
  item mods + their purchased upgrade mods + carried gadget/keepsake mods + skill mods ×
  rank + cabin upgrade mods, then clamped to sane ranges. Starting kit mods must be
  neutral-ish so base stats describe the beginner experience.
- **Cabin upgrades (spec §21.2):** `audio_lab`, `photo_wall`, `workshop`, `map_room`,
  `garden` (observation garden: a permanent feeder lure at the cabin).
- **Economy (spec §22):** Field Credits come from quests, research contracts, submitted
  photos/recordings (once each, modest) and discoveries — never from plain repeat
  sightings. Starting credits 60.
- **API shape:** exported pure functions over `*proto.Profile` that return an error for
  rule violations, e.g. `NewProfile(name) *proto.Profile`, `GrantXP(p, amount) (levels
  int)`, `AwardXP(p, source, speciesID string, amount int) int` (applies the anti-grind
  log), `CheckRank(p, rankFacts) (newRank int, ok bool)`, `BuySkill`, `Buy`,
  `BuyUpgrade`, `Equip`, `Unequip`, `MoveItem`, `AddItem`, `UseItem`, `BuyCabinUpgrade`,
  `ApplyReward(p, proto.Reward) (levels int, newItems []string)`, `Recompute(p)`, plus
  catalog getters `Ranks()`, `Disciplines()`, `SkillTiers()`, `Skills()`, `Items()`,
  `CabinUpgrades()`, `ShopItems()`.

### 3.5 Content (`internal/content`)

- `Regions() []proto.RegionInfo` — the six region TYPES. Gating by naturalist rank
  (a "ranger permit"): Greenhollow rank 1; Murmur Marsh rank 2; Amberwood rank 2;
  Windpeak rank 3; Whispering Coast rank 3; Frostveil rank 4. A locked region type is
  closed wherever it occurs in the generated world.
- `NPCs() []proto.NPCDef` — `mara` (Veteran Naturalist, faction `naturalists`, POI
  `npc_mara`), `finn` (Equipment Specialist, `outfitters`, `npc_finn`), `alder`
  (Researcher, `research`, `npc_alder`), `june` (Park Ranger, `rangers`, `npc_june`).
- Quests: the five from spec §15.2 with pinned ids `unseen_singer` (tutorial, Mara,
  auto-offered at first talk; the mystery singer is the **wren** — id `eurasian_wren`;
  objectives in order: hear the unknown call → investigate (get within 25 m of it /
  observe it) → record it → identify it → photograph it; reward includes
  `explorer_binoculars`-upgrade credit or audio equipment per the spec, XP 300,
  research reputation), `perfect_moment` (photography; photograph a bird feeding),
  `old_watchtower` (exploration, June; discover `old_watchtower`, collect `page_0`,
  open `cache_watchtower`; unlocks a hidden research quest), `familiar_voice`
  (acoustic; identify three species by sound), `visitor_from_afar` (research, Alder;
  document a vagrant: a `rare` objective with target `out_of_range`). Add at least
  nine more across all five categories (including conservation quests from June, one
  quest per outer region type that motivates the unlock, and 4+ repeat-free cabin
  research contracts with `Giver:"board"`), plus the hidden quest unlocked by the
  watchtower. Because the world is generated, quests may reference by id only the
  pinned **home-valley** POIs of §2.2; anything further afield must use kind targets
  with params (`discover` target `kind:watchtower` with `Params{"region":"windpeak"}`,
  `collect` target `kind:feather`, …).
- Quest engine: `content.NewTracker()`-style pure logic over
  `map[string]*proto.QuestState`: `Available(p) []string`, `Accept`, `OnEvent(p,
  Event) []Progress` (advances objectives, honours `Ordered`, marks `complete`),
  `TurnIn` (returns the `proto.Reward` for the session to apply via `progress`).
  `Event` is `content.Event{Kind, Target, Params map[string]string, Count int}` using
  exactly the objective vocabulary documented on `proto.ObjectiveDef`.
- Dialogue: `content.Talk(npcID string, p *proto.Profile) proto.DialogNode` and
  `content.Choose(npcID, choiceID string, p *proto.Profile) (node proto.DialogNode,
  actions []Action)` where actions are data (`accept quest`, `turn in quest`,
  `open shop`, `give item`, `set flag`, `close`) for the session to execute. Mara's
  first conversation is the tutorial (movement, listening with F, binoculars, journal).
  Every NPC has distinct voice, a few "ask about…" topics that teach real mechanics,
  and reacts to rank/reputation.
- Collectibles (`content.Collectibles(species []core.Species)`): one feather per
  species, id `feather_<species id>` (set "Feathers", named e.g. "Jay Wing Covert",
  rarity following the species); `page_0…7` (set "The Forgotten Field Journal": an
  earlier naturalist's diary handed out in order wherever pages are found, each
  hinting at the kinds of hidden places the world contains or a rare bird's
  conditions — environmental storytelling, never coordinates); `relic_0…5`; and
  awarded `badge_*` collectibles. `CollectibleDef.POI` is "" for all of these (the
  session maps found POIs to collectibles). Lore entries (`proto.LoreDef`) for
  Natural History. Also `content.CacheLoot(regionKey string) []string`: the ordered
  unique items a cache of that region type yields (marsh → `explorers_lens`; windpeak
  → `naturalists_compass`; whispering_coast → `research_backpack`; others none), and
  the fallback modest find.

### 3.6 Session rules (`internal/game`, stage 2)

- Tick 10 Hz: clock → ecosystem step (with `Observer` from the latest pose + stats) →
  events to perception → outbound messages. Bird snapshots: all birds within 260 m,
  every tick. `env` every second. Observation ticks 4 Hz. Autosave every 30 s and on
  disconnect to `<save dir>/save.json`; photos as `<save dir>/photos/<id>.jpg`.
- Mystery lifecycle: hearing or seeing an unidentified species creates/updates one
  `Mystery` per species (label "Unknown bird A/B/…"); level 2 heard, 3 encountered.
  `identify`: if the guess is the true species and the top candidate confidence for it
  is ≥ 70 % → `certain`; correct but < 70 % → `probable` (entry flagged, half XP;
  confirmed automatically when confidence later reaches 70 % or a ≥ 2-star photo /
  recording of it exists); wrong → `wrong` with gentle feedback naming one piece of
  evidence that does not fit (if any), the guess is added to `Wrong`, no other penalty;
  fewer than 2 evidence keys → `insufficient`. On identification the mystery becomes a
  `SpeciesEntry` (level 4; level 5 once any photo/recording/typed observation exists;
  level 6 when `Study` reaches 100 via cabin desk research, which needs level 5).
- Film: each photo uses one frame of `Film.Cap` (= `Stats.FilmCap`); arriving at the
  cabin develops the roll (`Film.Used = 0`).
- Region gating: stepping into a locked region type sends `region {unlocked:false,
  reason}` (at most once a minute per type) and the client turns the player back at
  the border; entering an unlocked region type for the first time ever sends `region
  {unlocked:true}` (Region Discovery screen) + XP.
- The world belongs to the save: the save stores the seed; `hello {newGame:true,
  seed}` builds a fresh world + ecosystem for that seed (random when empty).
- POI streaming: every second, POIs and trails within 700 m that have not been sent
  to this connection go out in a `pois` message (the welcome carries the home valley
  and whatever is in range at connect).
- Pinned profile flags: `taken:<poi id>` (a cache opened or a collectible POI picked
  up — the client hides/opens the prop), `met:<npc id>`, `tutorial:<step>`.
  Opening a cache: a pinned home cache gives its `Data["item"]`; a generated cache
  gives the next unique item for its region type that the player does not own yet
  (`content.CacheLoot`), else a modest find (a supply or two, some credits, sometimes
  a lore entry). Unique items are announced with `rareItem`.
  Picking up collectibles: a `feather` POI yields the feather of a species of that
  region type (deterministic per POI id, preferring ones not yet collected); a `page`
  POI yields the lowest-numbered page not yet collected (`page_0` first, at the Old
  Watchtower) plus its lore; a `relic` POI likewise. Recorded in
  `journal.collectibles` with XP.
- POI discovery: within `Radius` → journal location (`LocEntry` copies name, kind,
  region, position) + 25 XP (+ toast). Hidden POIs also reveal on the map when within
  `Stats.TrailSense`. Fog of war: 32 m cells within 48 m of the player are marked
  explored in the sparse `Profile.Explored`.
- The cabin (`interact` with `cabin`) opens the home base (`base` message). Resting
  advances time (`Ecosystem.FastForward`).
- `debug` commands work only with `-dev`.

---

## 4. Protocol semantics

Shapes: `internal/proto/messages.go` and `defs.go`. Envelope `{"t","d"}`.

| Client → Server | When |
|---|---|
| `hello` | once after connect (`newGame:true` wipes the save and generates a new world from `seed`) → `welcome` |
| `pose` | 10 Hz while in `play` mode, 2 Hz otherwise |
| `chunkReq` | whenever the client wants a chunk at a LOD → binary frame |
| `photo` | shutter pressed with the camera raised → `photoResult` (+ `profile`, toasts) |
| `recStart` / `recStop` | recorder toggled → `recState` at 4 Hz while recording, then `recResult` |
| `identify` | from the identification screen → `identifyResult` |
| `interact` | E on a POI/NPC/collectible/cache within range → `dialog` / `base` / `rewards` / `rareItem` / toast |
| `dialogChoice` | a dialogue choice clicked → next `dialog` node, or the dialog closes (server sends `dialog` with empty `lines` and no choices to close) |
| `quest`, `buy`, `upgrade`, `equip`, `unequip`, `move`, `use`, `skill`, `cabin`, `note` | UI actions → `profile` (and `error` on a rule violation) |

Server → client notes: `profile` is always the complete client view (cheap enough);
modules must diff what they care about. `birds` snapshots are authoritative — a bird
missing from a snapshot is gone. `clue` upserts by `id`. `sighting` with `bird: 0`
means nothing is under observation. `rewards` is sent for quest turn-ins and other
big payouts; small gains are `toast`s. `teleport` must be obeyed immediately.

---

## 5. Client

### 5.1 Module contract

Each module's `index.js` default-exports `{ name, init(ctx), update?(dt, ctx),
lateUpdate?(dt, ctx) }`. `init` runs before the welcome message; build world-dependent
things on the bus event `welcome`. Publish your API as `ctx[name]` in `init`. Use
optional chaining for other modules' APIs (`ctx.audio?.uiSound('page')`) — a failed
module must never crash yours.

`ctx` = `{ THREE, renderer, scene, camera, canvas, bus, net, state, input, ui, time,
stats, capture(width, quality) }` plus module APIs. `window.wildcall === ctx`.
`ctx.state`: see `js/core/state.js` (indexes by id for all welcome content,
`state.profile`, `state.env`, `state.mode`, `state.settings`, `state.stats`).

Performance budget: 60 fps on an integrated-GPU laptop at "medium". Use
`InstancedMesh`, merged geometry, shared materials; no per-frame allocations in hot
paths; dispose of GPU resources when chunks unload.

### 5.2 Module APIs

**`ctx.world`** (c-world) — streams the unbounded generated world: chunks around
the player in LOD rings (quality-dependent radius: low 5 / medium 7 / high 10 chunks;
lod 0 within 2 chunks, lod 1 to 4, lod 2 beyond; signed chunk coordinates; load
near-to-far, unload with hysteresis), builds terrain meshes (vertex colours,
flat-ish stylised shading, skirts to hide LOD cracks), instanced vegetation with
gentle wind sway, and the water surface with soft shorelines (rivers, lakes and sea
are all the y = 0 plane showing wherever terrain dips below it). API:
`heightAt(x, z) → number` (bilinear on the finest loaded chunk; falls back to 0),
`isLoaded(x, z) → bool`, `regionAt(x, z) → region id | 255` and `habitatAt(x, z) →
habitat id` (from the chunk's region/habitat bytes; 255/0 if not loaded),
`waterDepthAt(x, z) → number` (max(0, −height)), `collide(pos: Vector3, radius) →
void` (pushes pos out of tree trunks, rocks and registered blockers in XZ),
`addBlocker({x, z, r})` (props call this for buildings), `surfaceAt(x, z) → 'grass'|
'leaf'|'sand'|'rock'|'snow'|'water'|'mud'|'wood'` (for footsteps), `raycastTerrain(origin,
dir, maxDist) → Vector3 | null`, `canopyAt(x, z) → 0..1` (tree cover above, for light
& rain audio). Emits `world:ready` once the chunks around the spawn point are meshed,
and `world:chunk {cx, cz, lod}` on every load.

**`ctx.sky`** (c-sky) — sky dome with time-of-day gradient, sun and moon, stars at
night, drifting stylised clouds, scene fog matched to weather/mist, hemisphere +
directional lighting (soft shadows on "high" only), rain particles, wind-blown leaf
motes / seasonal tint hints, per-region atmosphere (Amberwood warm haze, Frostveil
cold light and snowfall). Driven by `env` events, interpolated between updates.
API: `sunDir → Vector3`, `daylight → 0..1`, `fogColor → Color`.

**`ctx.props`** (c-sky task) — builds POIs as they arrive (the welcome's list, then
`net:pois` as the player travels; drop props farther than ~900 m and rebuild them
when they are sent again) as stylised low-poly geometry, generic per kind so that
generated structures anywhere look right, with per-id variation: cabin (with porch, chimney smoke, lit window at night), Finn's
stall, ranger stations, watchtowers (with a climbable stair/ladder volume: register a
ramp so the player can reach the platform), field-lab tent, hides, camps, ruined
cabins/stations, lighthouse, signposts, standing stones, cairns, the Old Oak dressing, boardwalk,
collectibles (feather / page / relic models that gently bob and glint within
`stats.trackSigns` metres), caches, NPCs (procedural characters from `NPCDef.look`,
idle animation, turn to face the player), seed lures and the garden feeder. API:
`interactables() → [{id, kind, pos: Vector3, radius, label, verb}]` (only currently
available ones — collected collectibles disappear), `npcPos(id) → Vector3`,
`platformHeightAt(x, z, y) → number | null` (walkable surfaces above the terrain such
as tower platforms, boardwalks, hide floors; the player controller uses it).

**`ctx.birds`** (c-birds) — one procedural 3D model per species built from `look`
(body, head, bill by `billShape`, tail by `tailShape`, wings by `wingShape`, legs,
crest, field marks painted via vertex colours or small overlay meshes) — silhouettes,
proportions and colours must be clearly distinguishable between species (spec §2.3).
Renders birds from `net:birds` snapshots with interpolation (snapshots arrive at
10 Hz; render ~120 ms in the past), animations per `act` (perched bob/look-around,
hopping, wing flap at `flapHz`, flight styles: undulating bounding, soaring with
spread wings, hovering, direct; swimming bob, wading stalk, trunk climbing, preening,
bathing splash, feeding peck, alert upright posture, singing with bill open + throat
pulse while `FlagSinging`), pale/leucistic tint for `FlagRarePlumage`. LOD: beyond
~120 m draw a simple 2-triangle "speck"; pool meshes. API: `get(id) → {id, sp, act,
flags, pos: Vector3} | undefined`, `list() → iterable`, `count`.

**`ctx.player`** (c-player) — first-person controller: walk 2.4 m/s, run 4.4 (hold
Shift), sprint 6.5 (double-tap Shift and hold; drains `stats.stamina`), crouch (C /
Ctrl toggle, 1.2 m/s, eye height 1.0), jump, step up small obstacles / climb slopes
with slowdown on steep ground, shrubs and shallow water (reduced by `stats.terrain`),
sit and wait (X), wading up to ~1.2 m deep with deep water pushing back gently (no
swimming, no survival mechanics; there are no world edges),
head bob, smooth camera, collision via `ctx.world.collide` and
`ctx.props.platformHeightAt`. Region gate: refuse to walk more than a few metres into
a region not in `profile.regions` (soft push back + the server's `region` message
explains). Sends `pose`. Interaction: finds the nearest `ctx.props.interactables()`
in front of the player, emits `interact:target {id, label, verb} | null` for the HUD
prompt, sends `interact` on E. In `mainmenu` mode it runs a slow cinematic camera
drift near the cabin instead. API: `pos: Vector3` (eye), `yaw`, `pitch`, `speed`,
`move: 'still'|'crouch'|'walk'|'run'|'sprint'`, `crouching`, `sitting`, `stamina 0..1`,
`teleport(x, y, z, yaw)`, `feet: Vector3`.

**`ctx.tools`** (c-player task, `js/player/tools.js`) — the three instruments (spec
§5.4, §6.2, §9.2):
- *Binoculars* (1, hold RMB to raise): circular twin-barrel mask, magnification by
  wheel between 4× and `stats.binoZoom`, true FOV = `binoFov / zoom`, hand sway that
  grows with zoom and shrinks with `binoStability` (and when crouched/sitting/holding
  breath), focus that must catch up when the distance at the centre changes (speed
  `binoFocus`; blur via CSS filter on the canvas), edge softness from `binoClarity`,
  raise time from `binoWeight`, darker image at night unless `lowLight`.
- *Camera* (2, RMB to raise, LMB shutter, hold for burst at `camBurst`): viewfinder
  frame with focus brackets, zoom 1–`camZoom`, autofocus at `camFocus`, shake from
  `camStability`/`longLens`, shutter sound + brief blackout, film counter; on shutter
  sends `photo` with `ctx.capture(640)` and the current pose/FOV/sharpness/shake.
- *Recorder* (3, LMB start/stop): level meter from `recState`, timer, on-axis
  indicator, live spectrogram when `stats.spectrogram ≥ 1`
  (`ctx.audio.getSpectrum()`); sends `recStart`/`recStop`.
- *Focused listening* (hold F): slows movement to 40 %, dims the HUD, calls
  `ctx.audio.setFocus(true)`; emits `focus {on}`.
API: `active: 'none'|'binoculars'|'camera'|'recorder'`, `raised: bool`, `zoom`,
`fov`, `sharp 0..1`, `recording: bool`, `select(name)`. Emits `tool {active, raised}`.

**`ctx.audio`** (c-audio) — Web Audio engine (created on first user gesture; emits
`audio:ready`). Listener follows the camera. Bird calls from `net:call` are
synthesized from `species.calls[i].notes` (waves: sine, whistle, buzz, trill, noise,
click — see `core.Note`) and played through an HRTF `PannerNode` at the bird's
position (follows the bird while it sings via `ctx.birds.get`), with inverse-distance
rolloff matched to `call.loud` (audible range ≈ `40 + 260·loud` m ×
`stats.hearRange`), air absorption + occlusion as a low-pass (`CallMsg.occ`, updated
with `ctx.world.canopyAt`), light reverb in forest. Ambience layers (spec §24): wind
(env.wind, louder in Windpeak/coast), rustling leaves, creek/water near water, surf on
the coast, rain (muffled under canopy), insects by day in summer, night ambience;
footsteps by `ctx.world.surfaceAt` and player move mode; wing-flap whirr for close
take-offs (`net:cue`); equipment sounds; subtle generative music pads that fade out
during focused listening. Focus mode: ducks ambience by ~12 dB (scaled by
`stats.noiseReduce`), narrows nothing visually. API: `resume()`, `setFocus(on)`,
`playCall(spIndex, callIndex, {gain?, seed?}) → {stop()}` (non-spatial, for journal /
guide playback), `getSpectrum() → Uint8Array` (analyser of the bird-call bus, 512
bins), `uiSound(name)` (`click page open close reward discover shutter error level
equip coin`), `level → 0..1` (current call-bus loudness).

**`ctx.kit`** (c-kit) — see `js/ui/kit.js`; import its functions directly.

### 5.3 Screens (names pinned; registered with `ctx.ui.register`)

| name | owner | opened by | content (spec §28–§30) |
|---|---|---|---|
| `mainmenu` | c-menu | boot | Continue (if `welcome.hasSave`), New Adventure (optional world-seed text field, blank = random; confirm if a save exists → `net.send('hello',{newGame:true, seed})` then `location.assign('?play=1')` after the new `net:welcome`), Journal, Equipment, Skills, Map, Quests, Collection, Settings, and Quit (only when `window.wildcallDesktop` exists → `wildcallDesktop.quit()`); live forest behind it; `closable:false`. Starting play: `ui.close('mainmenu')` then `bus.emit('game:start', {fresh})`. |
| `menu` | c-menu | Tab / K / I / Esc | tabs `character` (level, XP bar, rank, skill points, progression unlocks, currency, reputation, totals), `skills` (five-discipline tree, node states locked/available/purchased, tier requirements, costs, buy), `inventory` (item grid, rarity, description, stats, equip/unequip, sort, filter, capacity, use supplies), `equipment` (six slots, current gear stats, comparison vs. selected, upgrade options), `rank` (current/next rank, requirements with progress, unlocks), `settings` (all of `state.settings`, a fullscreen toggle and "Quit to desktop" when `window.wildcallDesktop` exists, "Return to main menu"); data `{tab}`. |
| `journal` | c-journal | J | sections `species` (grid by discovery level incl. mysteries with their evidence and an "Identify" button → `ui.open('identify', {mystery})`; species page: illustration, name, rarity, discovery status, habitat, locations, activity patterns from the player's own `phases`, vocalizations with playback, behaviours, photos, observations, identification confidence, editable personal notes), `photos`, `recordings` (playback + spectrogram), `locations`, `history` (Natural History lore), `rare` (Rare Discoveries); data `{section, species}`. Field-guide view of all species of unlocked regions (silhouette until identified; "compare similar"). |
| `map` | c-journal | M | a pannable, zoomable map of the unbounded world drawn from map tiles (`welcome.world.mapUrl` with `{tx}`/`{tz}`; only tiles containing explored cells are fetched) under sparse fog of war from `profile.explored`, player arrow, the cabin and a "home" bearing when off-screen, trails (per `stats.mapDetail`; hidden trails only if in `profile.trails`), discovered places from `profile.journal.locations`, NPCs, tracked-quest markers, region names over explored areas with lock state, the world seed. Never birds. |
| `quests` | c-journal | L | active/available/completed quests, objectives + progress, rewards, categories, tracking toggle. |
| `collection` | c-journal | O | collectibles found/missing by set, rarity, progress. |
| `identify` | c-encounter | T while observing, or from the journal | Observation & Identification: sketch built from known evidence (`kit.birdIllustration(…, {reveal})`), evidence list, habitat, behaviour, candidate table with confidence, field-guide browser with filters to compare, "Submit identification" (→ `identify`) and "Keep observing"; shows the `identifyResult`. data `{mystery}`. |
| `dialog` | c-encounter | `net:dialog` | NPC portrait, name/role, lines (click to advance), choices, quest offer with rewards, reputation; `closable:false` until a `bye`-kind choice exists. |
| `rewards` | c-encounter | `net:rewards` | XP, items, credits, journal updates, skill points, reputation, level-up; `overlay:true`. |
| `rareitem` | c-encounter | `net:rareItem` | item artwork, rarity, description, history, special effect; `overlay:true`. |
| `region` | c-encounter | `net:region` | Region Discovery card (name, tagline, habitats, species count, opportunities) or the "trail closed" explanation; `overlay:true`. |
| `rankup` | c-encounter | `net:rankUp` | new rank ceremony with unlocks; `overlay:true`. |
| `base` | c-base | `net:base` | Home Base: cabin illustration with stations — Research Desk (review mysteries/identify, analyze recordings, study species, research contracts board with submit), Equipment Station (equip/upgrade), Journal Display, Photography Wall (pin/unpin own photos), Storage (move items), Cabin Upgrades, Rest until (dawn/morning/midday/evening/night); data `{station}`. |
| `shop` | c-base | dialogue action / Finn | Finn's shop: items for sale, currency, rarity, stats with comparison to equipped, requirements, buy; upgrades tab. |

Screens other than overlays replace each other. A screen must fully re-render from
`ctx.state` on `open()` and on every `profile` event while open.

### 5.4 HUD (c-hud; spec §29.1 — minimal, subtle)

Compass strip (top centre; detail per `stats.compass`; clue bearings appear on it as
soft unlabeled ticks), region name (fades in on change), weather + time (+ forecast
strip when `stats.forecast > 0`), current tool + three quick slots, detection clue
panel (one soft card per live clue: direction, distance band, pitch, pattern, habitat,
confidence; fades by TTL; **never** a species name unless `clue.known`), movement-cue
ripples at the screen edge / in view, observation readout while a `sighting` is live
(clarity ring, evidence gained, "T — identify"), interaction prompt, tracked-quest
objective, stamina arc only when draining, film/recording indicators, toasts (stack in
`#toasts`), first-time hints when `settings.hints`. HUD hides in `mainmenu`, dims
while focus listening, and hides under screens.

### 5.5 Bus events

| event | payload | emitted by |
|---|---|---|
| `welcome` | Welcome | main |
| `profile` | Profile | main (every server profile) |
| `env` | EnvMsg | main (1 Hz) |
| `mode` | `{mode, prev}` | state |
| `net:<type>` | payload | net (every server message) |
| `net:chunk` | ArrayBuffer | net |
| `settings` | `{key, value, settings}` | state |
| `resize` | `{w, h}` | main |
| `action:<name>` / `action-up:<name>` | `{code}` | input |
| `mouse:down` / `mouse:up` / `mouse:wheel` | `{button}` / `{dy}` | input |
| `pointerlock` | `{locked}` | input |
| `ui:open` / `ui:close` | `{name, data}` | ui |
| `game:start` | `{fresh}` | main / main menu |
| `toast` | Toast | main (server toasts) and any module (local toasts) |
| `world:ready`, `world:chunk` | — / `{cx, cz, lod}` | world |
| `interact:target` | `{id, label, verb} \| null` | player |
| `tool` | `{active, raised}` | tools |
| `focus` | `{on}` | tools |
| `region:enter` | `{region}` (client-side, from `world.regionAt`) | player |
| `audio:ready` | — | audio |
| `photo:taken` | `{img}` (local, before the server answers) | tools |

### 5.6 Controls

See `KEYMAP` in `js/core/input.js` (pinned). Mouse: move = look, RMB hold = raise
tool, LMB = primary action, wheel = zoom. `?nolock=1` = drag-to-look without pointer
lock; `?play=1` = skip the main menu.

### 5.7 Look and feel

Stylised, soft, warm (spec §2.3, §23): low-poly rounded forms, flat/toon-ish shading
with vertex colours, gentle gradients, atmospheric fog, no photo textures. UI: spec
§2.4 palette via the CSS variables in `css/base.css` — field-journal paper, rounded
but not bubbly, generous whitespace, soft shadows, illustrated icons, subtle
animation. Class prefixes: `kit-`, `tool-`, `hud-`, `enc-`, `menu-`, `jr-`, `base-`.

---

## 6. Engine binary (stage 2)

`go run ./cmd/wildcall [-addr 127.0.0.1:8080] [-seed <text>] [-save <dir>]
[-daylen 1440] [-dev] [-open] [-parent-stdin]` — serves the embedded `web/` at `/`,
the WebSocket at `/ws`, map tiles at `/map/<tx>/<tz>.png`, photos at
`/photos/<id>.jpg`. `-seed` only sets the seed used when no save exists yet.

- `-addr 127.0.0.1:0` picks a free port. As soon as it is accepting connections the
  engine prints exactly one line to stdout: `WILDCALL_LISTENING http://127.0.0.1:<port>`
  (the desktop shell waits for this line).
- `-save` defaults to the OS user-config directory (`os.UserConfigDir()/Wildcall`).
- `-parent-stdin`: exit cleanly (after saving) when stdin reaches EOF, so the engine
  never outlives the desktop shell. It also saves and exits on SIGINT/SIGTERM.
- `-dev` serves `web/` from disk (edit client files without rebuilding) and enables
  debug commands; `-open` opens the system browser (development only).
- Always binds to loopback unless `-addr` says otherwise. One player session at a
  time (a new connection takes over the world; multiplayer is out of scope, spec §33).
- Pure Go, no cgo: must cross-compile with `GOOS=windows GOARCH=amd64 go build`.

## 7. Desktop app (`desktop/`, task `desktop`)

WILDCALL ships as a **standalone desktop app for macOS and Windows** — players never
see a browser or a URL. `desktop/` is an Electron shell: its main process starts the
engine binary (bundled under the app's resources as `bin/wildcall[.exe]`) with
`-addr 127.0.0.1:0 -parent-stdin -save <app.getPath('userData')>`, waits for the
`WILDCALL_LISTENING` line, then opens a single frameless-chrome-free game window
(1440×900, min 1024×640, dark background `#1c2a22`, title "WILDCALL", no menu bar on
Windows, standard minimal menu on macOS) that loads the printed URL. Quitting the app
closes the engine. If the engine fails to start or dies, show a plain error dialog
with the last lines of its output.

- Window: `contextIsolation: true`, no node integration, `autoplayPolicy:
  'no-user-gesture-required'`, `backgroundThrottling: false`, F11 / Ctrl-Cmd-F
  toggles fullscreen, navigation to anything but the engine origin is blocked.
- Preload exposes `window.wildcallDesktop = { quit(), toggleFullscreen(),
  isFullscreen() → Promise<bool>, platform, version }`. The client must work when it
  is absent (plain-browser development).
- Packaging with electron-builder: macOS `.app` + `.dmg` (arm64 and x64), Windows x64
  portable `.exe` + `.zip`; unsigned. `desktop/scripts/build-engine.mjs` cross-compiles
  the Go engine for each target into `desktop/build/bin/<platform>-<arch>/`.
  `npm run dev` runs the shell against `go run ./cmd/wildcall -dev`;
  `npm run dist:mac`, `npm run dist:win`.
- `.github/workflows/build.yml`: on push to `main` and on tags, run `go vet` + `go
  test ./...`, then build the macOS and Windows apps on native runners and upload them
  as artifacts (and attach them to a GitHub release on `v*` tags).
- The same client also runs in a normal browser for development (`-dev -open`).

## 8. Narrator (task `narrator`)

An original narrator accompanies the player: a warm, unhurried, gently wry
nature-documentary voice that *thinks aloud* as you explore — never an imitation of
any real person's voice or name. It makes the world feel observed and alive without
ever doing the player's work for them.

- `internal/narrator` (Go, pure, depends only on `core` and `proto`): an authored line
  bank plus the director that decides what is worth saying and when. API:
  `narrator.New(seed int64) *Narrator`, `(*Narrator).Offer(ev Event, now float64)
  (proto.Narration, bool)` and `(*Narrator).Idle(ctx Context, now float64)
  (proto.Narration, bool)` for unprompted musings; `State()/Restore()` so recently
  used lines survive a save. `Event` describes what just happened in terms the
  session already has (a heard call with its clue fields, a sighting, an
  identification result, a flushed bird, a photo or recording result, a place or
  region discovered, weather/phase changes, rank/level, cabin arrival, long stillness).
- **Never spoils.** For a bird the player has not identified, lines may only draw on
  what the player has perceived (the clue's pitch/pattern/habitat/distance, the
  evidence gathered so far) — "A high, insistent trill, low in the thicket.
  Something small, I'd wager, with a great deal to say." Species names, families and
  facts appear only for species in the player's journal. Rarity is never announced.
- Pacing: at most one line every ~35 s (priority 0), sooner for higher priorities;
  never repeats a line within a long window; falls quiet when little is happening;
  never comments on every bird. Lines are short (one or two sentences, ≤ 25 words).
- `web/js/narrator/` + `css/narrator.css`: speaks `net:narrate` lines with the Web
  Speech API using the best available British English system voice (prefer a calm
  male voice; `settings.narratorVoice` overrides), rate ~0.92, volume
  `settings.volNarrator × volMaster`, and shows each line as an elegant caption in
  `#narrator` (always shown, even when no voice exists). Honours `settings.narrator`
  (off / sparse / normal / chatty), queues by priority and TTL, and stays silent while
  the player is focus-listening, recording, or in a dialogue. `ctx.narrator = { say(text,
  opts), stop(), voices() }`. The voice backend is isolated behind one small function
  so a recorded or neural voice pack can replace it later.

---

# Phase 2 — lush world, living trees, foraging, a real voice

Everything below was added after the first playable build. The rules for parallel
work at the top still apply. New ownership:

| Task | Owns |
|---|---|
| `world2` | `internal/world` (tree models, perches on real branches, nest-site perches, forage plant placement) |
| `nests` | `internal/species`, `internal/eco`, `internal/field` (nest data, nesting behaviour, nest photos) |
| `larder` | `internal/progress`, `internal/content` (plants, ingredients, food, recipes, buffs) |
| `voice` | `internal/narrator`, `web/js/narrator/`, `web/css/narrator.css`, `tools/voice/`, `web/voice/` |
| `birdsong` | `web/js/audio/`, `tools/birdsong/`, `web/birdsong/` |
| `c-ground` | `web/js/world/` except the three files below (terrain material, grass, ground cover, water, streaming) |
| `c-trees` | `web/js/world/vegModels.js`, `vegetation.js`, `season.js`, new `web/js/world/trees/` |
| `c-skyfx` | `web/js/sky/`, `web/js/fx/` |
| `session2` (stage 2) | `internal/game`, `internal/save`, `internal/server`, `cmd/wildcall` |
| `c-field` (stage 2) | `web/js/forage/`, `web/js/nests/`, `web/css/forage.css`, plus the small hooks it needs in `web/js/ui/journal`, `web/js/ui/base`, `web/js/ui/hud`, `web/js/birds`, `web/js/props` |

## 9. Seeing your own work — the screenshot harness

`tools/shot/shot.cjs` (read its header) renders the running game in a hidden window
and writes PNGs, so visual work can and must be checked by eye:

```
# 1. your own engine (pick your own port and a throwaway save dir; -dev serves web/ from disk)
go build -o /tmp/wc-<you> ./cmd/wildcall && /tmp/wc-<you> -dev -addr 127.0.0.1:<port> -save "$(mktemp -d)" -seed scenic &
# 2. screenshots (default tour of the home valley at several times of day, or your own --plan)
ELECTRON_DISABLE_SECURITY_WARNINGS=1 desktop/node_modules/.bin/electron tools/shot/shot.cjs \
    --url http://127.0.0.1:<port> --out /tmp/shots-<you> [--plan my-plan.json]
# 3. look at the PNGs with your image-reading tool, change code, repeat (the page reloads from disk each run)
```

The harness prints console errors and a frame-rate reading. Stop your engine when you
finish. Never open a visible window or a browser.

## 10. Art direction: lush, scenic, stylised

The target is the look of a hand-painted stylised world — think of the meadows and
forests of a Ghibli film or the best stylised Unreal scenes: **bright, lush, soft and
inviting**. Concretely:

- **Lush ground.** Dense, soft, wind-rippled grass that covers meadows and clearings
  (thousands of blades near the camera, fading smoothly into the terrain colour with
  distance — no visible end), wildflowers in drifts, ferns and leaf litter under
  trees, moss, reeds at the water. The bare flat green carpet must be gone.
- **Trees with real structure** (§11): visible trunks, limbs and branches carrying
  soft, full, layered foliage; believable species silhouettes (spreading oak, slender
  white-barked birch, layered pine); foliage shaded as soft masses (gradient from a
  warm lit top to a cool shaded underside, never faceted black), a little light
  through the leaves at the edges, gentle wind.
- **Light.** Warm golden sunlight, cool sky-blue shade, soft shadows on the ground
  under trees (dappled), long light at dawn and dusk, visible light shafts through
  the canopy and mist in the morning, a soft bloom on the brightest things, a gentle
  filmic grade (rich greens, warm highlights, slightly lifted blacks — never grey,
  never neon). Night is deep blue and readable, with moonlight, stars and fireflies.
- **Depth.** Strong atmospheric perspective: each ridge and tree line a step paler
  and bluer; distant hills readable as layered silhouettes; big soft cumulus clouds
  with lit tops and shaded bases; a real sun and moon.
- **Water.** Clear near the bank with the bed showing, deepening to a rich teal/blue,
  a soft foam line and darker wet edge at the shore, moving highlights, sky colour
  reflected at grazing angles, lily pads and reeds. No milky slabs, no white bands.
- **Shape and colour.** Chunky, rounded, slightly exaggerated shapes; colour does the
  work of detail; palettes per region type stay distinct (Greenhollow lush greens,
  Amberwood gold and rust, Frostveil blue-white, Murmur Marsh olive and ochre,
  Windpeak grey-violet rock and heather, Whispering Coast pale sand and sea-blue).
- **Cohesion.** Terrain, plants, props, birds and UI must look like one world.
- **Performance.** 60 fps at 1280×720 on an integrated-GPU laptop at "medium". The
  harness prints fps on this machine (it reaches ~120 today); stay above 90 here.
  Use instancing, LOD and distance fades; keep draw calls under ~900.

Post-processing: `ctx.post` (module `web/js/fx/`) owns the final render — main.js
calls `ctx.post.render(dt)` when it exists, also for photographs (`ctx.capture`).
`three/addons/` resolves to `web/vendor/three-addons/` (EffectComposer, RenderPass,
ShaderPass, OutputPass, UnrealBloomPass, SMAAPass and their shaders are vendored; ask
in your report if you need another official addon). Post effects must respect the
quality setting (low = none) and must not blur the picture when the binoculars or
camera are raised.

## 11. Trees with branches, birds on them, and nests

**Tree models.** `internal/world` generates `core.TreeVariants` (6) branching models
for every tree kind (`VegKind.IsTree()`: oak, birch, pine, snag, amber oak, amber
birch, snow pine, sweet chestnut): `(*World).TreeModels() []proto.TreeModel`,
deterministic and the same for every seed (they are species shapes, not world
content). An instance uses model `variant % 6` with its scale and Y rotation. Shapes
follow the real trees: oak — short stout trunk, heavy spreading limbs, broad domed
crown; birch — slim, leaning slightly, ascending limbs with fine drooping ends;
pine — straight trunk, whorls of near-horizontal branches, open layered crown, bare
lower trunk on big ones; snag — dead, bare broken limbs; chestnut — tall, spiralling
limbs, big crown. 25–70 branch segments and 6–18 foliage masses per model. The
welcome message carries all models (`welcome.trees`).

**Perches come from the model.** For every tree instance the world derives perches by
transforming points of its model: `branch` perches *on* limb segments in the outer
crown (the bird's feet on the top of the limb; cover from how much foliage surrounds
it), `canopy` perches on twigs inside foliage masses, `trunk` perches on the trunk
surface, `snag` perches on bare tips, `fork` perches where two sturdy limbs meet, and
`cavity` perches on the trunks/limbs of large old trees (oak, birch, snag, chestnut;
radius ≥ 0.18 m; 1.5–9 m up). Elsewhere the world provides `bank` perches (steep
earth banks beside water) and `ledge` perches (cliff and crag ledges, sea stacks).
A bird reported at a branch perch must visibly stand on that branch in the client.

**Client trees** (`c-trees`) build each model once from `welcome.trees` — tapered
limb geometry plus soft stylised foliage around each `TreeLeaf` — and instance it.
The foliage must hide small birds inside it and leave outer branches visible.

**Nests** (`nests` task). Every species carries its real nesting habit in
`Species.Nest` (`core.NestInfo`: site type, perch kinds, height range, season, size,
description) — accurate to the real bird: wren a domed ball low in thick cover; robin
a cup low in a bank or ivy; blackbird and song thrush cups in shrubs and forks; tits,
nuthatch, treecreeper, woodpeckers and tawny owl in cavities; long-tailed tit a domed
lichen ball in bramble; goldcrest a pendant cup under a conifer branch; buzzard,
raven and heron big stick platforms high in trees (or crags); kingfisher a burrow in
a waterside bank; mallard and moorhen on the ground or floating among reeds; reed
warbler woven among reed stems; bittern in reeds; gulls, cormorant and eagle on
ledges; puffin a burrow in turf; ptarmigan a ground scrape; winter visitors `none`.
In the breeding season the ecosystem pairs resident birds; each pair owns a nest on a
suitable perch in its territory (deterministic per population cell), passing through
`NestBuilding` → `NestEggs` → `NestChicks` over the season, with the adults showing
`ActNesting` (carrying material, visiting, sitting). Old nests remain as `NestOld`
until the next spring. `Ecosystem.Nests` reports them; the session streams them
(`nests` message — never the species). Getting too close to a nest makes the adults
alarm and leave until the player backs off (no punishment beyond that).
**Finding a nest** (observing it at clarity ≥ 0.5 or photographing it) records a
`NestEntry` and pays XP once per nest species (as "unique behaviour", 75) — the owner
is named in the journal only if the player has identified that species. **Nest
photos**: `field` adds the tag `nest` (and `nest:chicks` etc.) when a nest is in
frame and reasonably clear, with a score bonus; first nest photo per species pays the
photo XP again.

## 12. Foraging and the field kitchen

Wild plants can be picked and turned into food and drink that give a timed bonus.
Realistic and gentle: real temperate plants with their real seasons and habitats,
honest uses, no magic. Spec rule 8 holds (cozy; nothing harmful, nothing punishing).

**Plants** (`VegKind` 18+, placed by the world in fitting region types and habitats
at natural densities — a handful per forested chunk, clustered, seasonal availability
decided at pick time; they are in the chunk vegetation list at LOD 0 and 1). Pinned
plant ids → ingredient item ids:

| plant id | VegKind | yields (season) |
|---|---|---|
| `bramble` | 18 | `blackberry` (late summer, autumn) |
| `wild_strawberry` | 19 | `wild_strawberry` (summer) |
| `bilberry` | 20 | `bilberry` (summer, early autumn) |
| `elder` | 21 | `elderflower` (spring), `elderberry` (autumn) |
| `dog_rose` | 22 | `rosehip` (autumn, winter) |
| `hazel` | 23 | `hazelnut` (autumn) |
| `sweet_chestnut` | 24 | `chestnut` (autumn) |
| `nettle` | 25 | `nettle` (spring, summer) |
| `wild_garlic` | 26 | `wild_garlic` (spring) |
| `water_mint` | 27 | `water_mint` (spring, summer, autumn) |
| `chamomile` | 28 | `chamomile` (summer) |
| `young_pine` | 29 | `pine_tips` (all year; best in spring) |
| `chanterelle` | 30 | `chanterelle` (summer, autumn) |
| `penny_bun` | 31 | `penny_bun` (autumn) |
| `sea_buckthorn` | 32 | `sea_buckthorn` (autumn, winter) |
| `samphire` | 33 | `samphire` (summer) |
| `cloudberry` | 34 | `cloudberry` (summer) |
| `wild_thyme` | 35 | `wild_thyme` (spring, summer, autumn) |

Pantry staples sold by Finn: `oats`, `honey`, `flour`.

**Food** (pinned ids; `larder` decides inputs, durations and effects within these
bounds: every effect is a modest additive change to existing `core.Stats` fields that
makes sense for the food; drinks 2–3 in-game hours, snacks 2–4, meals 4–6; one active
buff per slot `drink | meal | snack`): teas `pine_tip_tea`, `mint_tea`,
`chamomile_tea`, `thyme_honey_tea`, `nettle_tea`; cordials and syrups
`elderflower_cordial`, `elderberry_syrup`, `rosehip_syrup`, `sea_buckthorn_juice`;
snacks `berry_oat_bars`, `hazelnut_trail_mix`, `roasted_chestnuts`,
`cloudberry_preserve`, `bilberry_tart`; meals `nettle_soup`, `wild_garlic_flatbread`,
`mushroom_broth`, `forager_stew`, `samphire_salad`. Raw berries and nuts can be eaten
as they are for a small, short snack effect. Suggested flavour of effects: pine-tip
tea steadies the hands; mint wakes the ears; chamomile calms (wildlife settles
sooner, quieter approach); bilberries help the eyes at dusk; oat bars and nuts feed
long walks; a hot meal makes rain and cold matter less.

**Rules.**
- Picking: E on a forage plant within 2.5 m sends `forage {id}` (id format on
  `proto.ForageMsg`). The session checks distance, season and regrowth
  (`profile.forage[id]` = day picked; bears again after `PlantDef.Regrow` days) and
  pack capacity, adds 1–3 ingredients (`ForagedMsg`), records the plant in the
  herbarium (`journal.plants`) the first time (+25 XP once per plant — never again),
  and teaches the recipes whose `Learn` is `plant:<id>`.
- Cooking: `cook {recipe, qty}` at the cabin (kettle and stove recipes) or within
  12 m of any `camp` POI (kettle recipes) when the recipe is known and the inputs are
  in the pack. Starting recipes: `pine_tip_tea`, `mint_tea`, `berry_oat_bars`.
- Eating/drinking: `use {item}` on a food or edible ingredient applies its `BuffDef`
  as a `proto.Buff` (replacing the current buff in that slot); `ComputeStats`
  includes active buffs; expired buffs are removed on the tick and the profile pushed.
- No XP or credits for repeat picking or cooking (spec §7.4, §22). First time cooking
  each recipe pays 20 XP once.
- Quests: `content` adds a few foraging/cooking quests using new objective kinds
  `forage` (Target plant id | "any") and `cook` (Target recipe id | "any") and `eat`.

**Client** (`c-field`): renders the forage plants from the chunk vegetation lists
(`ctx.world.vegOf(cx, cz)` → the parsed LOD-0 vegetation array of a loaded chunk, in
wire order, each `{kind, variant, x, y, z, scale, rot}`; the world module must skip
kinds ≥ 18 in its own rendering) as charming recognisable plants with their fruit,
flowers or caps shown only when they can be picked this season and are not in
`profile.forage`; a "Pick" interaction (short crouch-and-pick motion, soft sound);
buff chips on the HUD with time remaining; a `cook` screen (opened from a new
"Kitchen" station in the home base and by interacting with a camp's fire): known
recipes, what you have, what is missing, the effect, cook; a Herbarium section in the
journal (pressed-plant style pages: drawing, names, how to recognise it, uses,
caution, season, where found); ingredients and food in the inventory with "Eat".

## 13. The narrator's voice (task `voice`)

The narrator is the player's own inner voice: the mumbled thoughts of the naturalist
you are playing (§8 still applies: original character, never a real person's voice or
name, never spoils an identification).

- **More to say.** (a) When the player spots a bird they have identified, he may
  mumble one of its `Species.Facts` — every species gets at least six short, true,
  interesting facts (owned by `nests` in the species data; `voice` wires them in,
  rotating without repeats). (b) Activity mumbles: short, in-the-moment, first-person
  asides for doing things — picking each plant (2–3 lines per plant id of §12:
  "Mm. Blackberries. One for the pot, one for me."), cooking and tasting each food,
  filling the pack, finding a feather, opening an old cache, climbing a tower,
  wading the creek, sheltering from rain, sitting down to wait, finding a nest (by
  site type, never naming an unidentified owner), raising the binoculars on nothing,
  running out of film. New `narrator.Event` kinds for these (`Foraged`, `Cooked`,
  `Ate`, `NestFound`, `Collected`, `Climbed`, `Waded`, `Sheltered`, `SatDown`,
  `EmptyView`, `OutOfFilm`…) with an `Item` field for the plant/food/site id.
  Occasional, not constant: the same pacing budget as before.
- **Pregenerated voice.** Every line the narrator can ever say is known ahead of
  time, so the voice is generated once and shipped. `narrator.AllLines()` enumerates
  every final spoken sentence with a stable id (first 16 hex chars of the SHA-256 of
  the exact text); `proto.Narration.ID` stays a counter, and the client keys audio by
  hashing `text` the same way. Templates with slots must be made finite: rewrite
  them so that the number of distinct sentences stays manageable (target ≤ ~2 500
  lines in total) — prefer whole authored sentences over combinatorial slots.
  `tools/voice/generate.mjs` (Node 22, no dependencies) reads the line list (from
  `go run ./cmd/wildcall -narrator-lines` or a small Go tool), calls the OpenRouter
  API to synthesise each line, and writes `web/voice/<id>.<ext>` plus
  `web/voice/manifest.json` (`{voice, model, lines: {id: {file, dur}}}`). It must be
  resumable (skip existing files), rate-limited, retrying, with `--dry-run` (count,
  estimated cost), `--limit N`, `--only <ids>` and `--sample` (a dozen representative
  lines in several candidate voices into `tools/voice/samples/` for the user to
  choose from). The API key comes from the `OPENROUTER_API_KEY` environment variable
  or a git-ignored `.env` file in the repo root; never print it, never commit it.
  Look up the current OpenRouter documentation for audio/speech output before
  writing the client code. Voice direction: a calm, warm, slightly gravelly older
  British man speaking softly to himself, close to the microphone, unhurried, with
  quiet delight — an original voice, not an impression of anyone.
- **Playback.** `web/js/narrator/voice.js` plays the pregenerated file for a line
  when the manifest has it (through the audio engine's bus if available so it obeys
  the volume settings and ducks under focus listening) and falls back to speech
  synthesis only when it does not. `web/voice/` is embedded in the engine binary.

## 14. Real bird sound (task `birdsong`)

So that players really learn birds, every species should be heard as it really
sounds. The audio engine gains a **sample path**: when `web/birdsong/manifest.json`
lists recordings for a species' call (`{species: {<species id>: {<call index>:
[{file, dur, gain}]}}, credits: [...]}`) it plays one of them through the same
spatial chain (position following the bird, distance roll-off, air absorption and
occlusion filters, reverb send) instead of the synthesised call; otherwise it falls
back to synthesis. Recordings are short (2–12 s), trimmed to the vocalisation,
loudness-normalised, mono, Ogg/Opus or MP3. `tools/birdsong/` holds a fetch tool that
finds suitable openly licensed recordings for each species and call type (song /
call / alarm / drumming) from a public archive, records the licence, recordist and
source URL for every file in `web/birdsong/CREDITS.md` and the manifest, and
converts them. **The tool must not download anything by default**: `--plan` writes
the candidate list (species, recording id, licence, length, quality, URL) for the
user to approve; `--fetch` runs only when explicitly invoked. Journal playback
(`ctx.audio.playCall`) uses the same recordings. Only recordings whose licence
permits redistribution with attribution may be used; note any non-commercial terms
prominently in the plan.
