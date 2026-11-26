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
| `world` | `internal/noise`, `internal/world` | terrain, regions, vegetation, perches, POIs, trails, chunks, map |
| `species-greenhollow` | `internal/species/greenhollow.go`, `greenhollow_test.go` | Greenhollow roster (20 species) |
| `species-regional` | `internal/species/regional.go`, `regional_test.go` | all other regions (18 species) |
| `eco` | `internal/eco`, `internal/env` | bird simulation; clock, seasons, weather, forecast |
| `progress` | `internal/progress` | ranks, skills, items, cabin upgrades, stats, XP, inventory, shop rules |
| `content` | `internal/content` | regions, NPCs + dialogue, quests + quest engine, collectibles, lore |
| `field` | `internal/field` | perception: hearing/clues, movement cues, observation/evidence, ID confidence, photo & recording scoring, rare discoveries |
| `server` (stage 2) | `internal/game`, `internal/server`, `internal/save`, `cmd/wildcall` | session orchestration, WebSocket/HTTP, persistence, main |
| `desktop` | `desktop/`, `.github/workflows/` | Electron shell, packaging for macOS + Windows, CI builds (§7) |

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
`internal/core/types.go`. Summary: metres, Y up, north = −Z, east = +X, world is
`[0,2048]²`, yaw is a compass heading (0 = north, π/2 = east), sea level is `y = 0`
and all standing water is that one plane.

**Client camera mapping:** `camera.rotation.order = 'YXZ'`, `rotation.y = -yaw`,
`rotation.x = pitch`.

### 2.1 Layout (designed, not random)

The island is one fixed, authored world built by a deterministic generator (default
seed `20261126`). Noise adds detail; the large-scale layout below is pinned so content
can reference it. Coordinates are approximate targets (±40 m is fine); the relationships
are what matter. Open sea surrounds the island (RegionNone beyond ~60 m offshore).

| Region | Where | Character |
|---|---|---|
| Greenhollow Woods (0) | centre, roughly x 620–1420, z 820–1560 | temperate broadleaf forest with pine stands, small clearings, a creek, ferny hollow, one meadow clearing, a hidden pond. Gentle terrain 4–40 m. **The fully developed region.** |
| Murmur Marsh (1) | south-east lowland, x 1300–1900, z 1400–1950 | reedbeds, pools and channels at/just below sea level, boardwalk |
| Windpeak Highlands (2) | north, x 600–1500, z 200–800 | mountain to ~220 m, rock, scree, sparse pines on lower slopes, windy pass |
| Whispering Coast (3) | east and north-east shore, x 1500–2000, z 300–1400 | cliffs, beaches, sea stacks, lighthouse |
| Amberwood (4) | west, x 150–620, z 800–1700 | autumn-coloured forest (amber/rust/gold trees), leaf litter |
| Frostveil (5) | far north-west plateau, x 100–600, z 150–780 | snowfields, frozen lake, snow-laden pines |

The creek rises on the south slope of Windpeak, runs south through Greenhollow past
Creekside and Fern Valley, then east into Murmur Marsh and the sea. It is carved below
`y = 0` only in its lower (marsh) reach; inside Greenhollow it is a shallow stream bed
whose water is rendered by the client as a ribbon following the `creek` trail (the
world exposes the creek centre-line as a `Trail` with id `creek`, `Hidden=false`,
name "Greenhollow Creek"; client world module draws water along it, 2–4 m wide, at
terrain height + 0.05).

### 2.2 POI manifest (ids are pinned)

`POI.Kind` vocabulary: `cabin ranger_station watchtower shop research_site
abandoned_station hidden_cabin camp viewpoint hide landmark pond npc feather page relic
cache sign gate`.

| id | kind | name | region | notes |
|---|---|---|---|---|
| `cabin` | cabin | Naturalist Cabin | 0 | player home, ~ (1020, 1240). Spawn is 6 m in front of the door, facing away. |
| `npc_mara` | npc | Mara | 0 | beside the cabin porch. `Data{"npc":"mara"}` |
| `woodland_entrance` | landmark | Woodland Entrance | 0 | timber arch on the main path ~120 m from the cabin |
| `shop_finn` | shop | Finn's Field Supply | 0 | stall beside the Woodland Entrance |
| `npc_finn` | npc | Finn | 0 | at the stall. `Data{"npc":"finn"}` |
| `old_oak` | landmark | The Old Oak | 0 | one giant oak (scale ≥ 2.4) in a small clearing |
| `creekside` | landmark | Creekside | 0 | where the main path meets the creek (stepping stones) |
| `research_creekside` | research_site | Creekside Field Lab | 0 | canvas lab tent by the creek |
| `npc_alder` | npc | Professor Alder | 0 | at the field lab. `Data{"npc":"alder"}` |
| `fern_valley` | landmark | Fern Valley | 0 | damp hollow, dense ferns and shrubs, downstream of Creekside |
| `meadow_clearing` | landmark | Meadow Clearing | 0 | open meadow ~120 m across with wildflowers |
| `ranger_station` | ranger_station | Greenhollow Ranger Station | 0 | on the main path, north side |
| `npc_june` | npc | June | 0 | at the ranger station. `Data{"npc":"june"}` |
| `old_watchtower` | watchtower | Old Watchtower | 0 | abandoned, on a wooded rise off the trail; climbable (client) |
| `hidden_pond` | pond | Hidden Pond | 0 | **Hidden.** small pond (below y=0) ringed by reeds and shrubs, off-trail |
| `hide_creek` | hide | Creek Hide | 0 | wooden bird hide overlooking the creek |
| `viewpoint_lookout` | viewpoint | Lookout Rock | 0 | **Hidden.** rocky outcrop with a long view |
| `hidden_cabin` | hidden_cabin | Trapper's Cabin | 0 | **Hidden.** ruined cabin deep off-trail |
| `camp_survey` | camp | Old Survey Camp | 0 | **Hidden.** abandoned camp in the pines |
| `marsh_boardwalk` | landmark | Murmur Boardwalk | 1 | entry to the marsh |
| `marsh_hide` | hide | Reedbed Hide | 1 | |
| `marsh_station` | abandoned_station | Drowned Research Station | 1 | **Hidden.** |
| `windpeak_pass` | landmark | Windpeak Pass | 2 | |
| `windpeak_tower` | watchtower | Storm Lookout | 2 | |
| `windpeak_summit` | viewpoint | Summit Cairn | 2 | **Hidden.** highest point |
| `coast_lighthouse` | landmark | Whisper Point Light | 3 | |
| `coast_cliffs` | viewpoint | Seabird Cliffs | 3 | |
| `coast_cove` | landmark | Driftwood Cove | 3 | **Hidden.** |
| `amber_grove` | landmark | The Amber Grove | 4 | |
| `amber_camp` | camp | Leaf-Fall Camp | 4 | **Hidden.** |
| `frost_hut` | abandoned_station | Frostveil Hut | 5 | |
| `frost_lake` | landmark | Mirror Lake | 5 | frozen lake |
| `gate_marsh` `gate_windpeak` `gate_coast` `gate_amber` `gate_frost` | gate | "… Trailhead" | on the Greenhollow side of each border | signposted trailhead where the main trail leaves Greenhollow. `Data{"region":"<key>"}` |
| `cache_watchtower` | cache | Weathered Satchel | 0 | at the Old Watchtower. `Data{"item":"forgotten_journal"}` |
| `cache_hidden_cabin` | cache | Dusty Leather Case | 0 | at Trapper's Cabin. `Data{"item":"historical_binoculars"}` |
| `cache_camp` | cache | Oilcloth Bundle | 0 | at Old Survey Camp. `Data{"item":"vintage_recorder"}` |
| `cache_marsh` | cache | Sealed Specimen Tin | 1 | at the Drowned Station. `Data{"item":"explorers_lens"}` |
| `cache_windpeak` | cache | Cairn Box | 2 | at the Summit Cairn. `Data{"item":"naturalists_compass"}` |
| `cache_coast` | cache | Sea Chest | 3 | at Driftwood Cove. `Data{"item":"research_backpack"}` |
| `feather_0` … `feather_11` | feather | (named by content) | 0:×6, 1:×2, 2:×1, 3:×1, 4:×1, 5:×1 | off-trail spots in fitting habitat. `Data{"collectible":"<same id>"}` |
| `page_0` … `page_7` | page | Forgotten journal page | 0:×4 (`page_0` is inside the Old Watchtower), 1,2,3,4:×1 | `Data{"collectible":"<same id>"}` |
| `relic_0` … `relic_2` | relic | (named by content) | 0, 3, 5 | `Data{"collectible":"<same id>"}` |

`Radius`: 14 m for landmarks/structures (discovery), 3 m for npc/cache/collectibles
(interaction). The world package gives collectibles and caches generic names; the
`content` package owns their real names and text via `CollectibleDef` (same id).

Trails (`core.Trail`): `main` "Greenhollow Trail" (cabin → Woodland Entrance → Old Oak
→ Creekside → Ranger Station, with spurs to Meadow Clearing and each gate), `creek`
(the creek line, see above), plus **hidden** trails `secret_pond`, `secret_cabin`,
`secret_lookout`, `secret_camp`, and one trail per outer region (`marsh`, `windpeak`,
`coast`, `amber`, `frost`). Terrain is flattened slightly and coloured as trodden earth
along non-hidden trails; hidden trails are only a faint colour change.

### 2.3 Chunk binary format

`Terrain.Chunk(cx, cz, lod)` returns one binary WebSocket frame. Little endian.
`cx, cz ∈ [0, 32)`. LOD cell size = `2 << lod` metres (lod 0 → 2 m, 1 → 4 m, 2 → 8 m);
`N = 64 / cell + 1` vertices per side (33, 17, 9).

```
offset size  field
0      4     magic  = 0x4B484357  ("WCHK" as bytes 'W','C','H','K')
4      1     version = 1
5      1     lod
6      2     cx (uint16)
8      2     cz (uint16)
10     2     N  (uint16)
12     N*N*4 heights   float32   row-major: index = iz*N + ix, world x = cx*64 + ix*cell, z = cz*64 + iz*cell
…      N*N*3 normals   int8 ×3   (x,y,z) * 127
…      N*N*3 colors    uint8 ×3  sRGB vertex colour (biome/region palette, trails, shoreline already blended in)
…      pad to a multiple of 4 bytes from the start of the frame
…      4     vegCount (uint32)
…      vegCount*20   each: kind u8, variant u8, rot u16 (radians = rot/65535*2π), x f32, y f32, z f32, scale f32
```

Vegetation by LOD: lod 0 → everything; lod 1 → trees, snags, shrubs, rocks, reeds;
lod 2 → trees and snags only. Vegetation positions are identical across LODs.
Chunks are edge-consistent: shared border vertices have identical heights/normals/colours.

### 2.4 Perches and occlusion

Perches are derived deterministically from vegetation and terrain: tree crowns
(`canopy`, cover 0.6–0.9, at 55–90 % of tree height), outer branches and tops (`branch`,
cover 0.1–0.35), snags and posts (`snag`, cover 0), shrubs (`shrub`, cover 0.5–0.8),
reeds (`reed`, cover 0.5–0.7), open `ground` (cover from ground vegetation, 0–0.3),
`rock`, `water` (points on the sea/pond/marsh surface, y = 0), `shore` (water's edge),
`trunk` (on tree trunks at 2–8 m), `structure` (roofs, rails). `PerchesNear` must be
fast (spatial grid) — the ecosystem calls it constantly.

`Occlusion(from, to)`: 1.0 if terrain blocks the segment; otherwise accumulate partial
occlusion from every tree crown (sphere/cone, ~0.35 each for a centre hit, scaled by
path length through it), shrub and reed bed crossed, clamped to 0..0.95.

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

- Population is persistent and independent of the player: roughly 450–650 birds
  world-wide, placed by species `Regions`/`Habitats`/`Density`; each has a home
  territory (centre + `Behavior.Territory`), favourite perches and feeding spots found
  with `Terrain.PerchesNear`, and a daily routine driven by `Behavior.Activity[phase]`.
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
  bird of a species from another region placed in suitable habitat elsewhere with
  `FlagVagrant` (always at least one vagrant somewhere in Greenhollow during
  autumn). `Rare`/`Legendary` species follow strict conditions from their data
  (phase, weather, habitat) and exist in very small numbers.
- `EvMove` is emitted for conspicuous movement (take-off, landing, branch-to-branch
  hop) of birds within 60 m of the observer — it feeds the movement cues.
- Lures (`AddLure`): seed-eating and ground-feeding species within `Radius` visit in
  turn and show `ActFeeding` at the lure.
- Performance budget: `Step` for 600 birds in < 1 ms on a laptop core. Use a spatial
  grid for `Near`. Simulate birds far from the observer at a reduced rate if needed,
  but they must keep living (positions change, calls happen).
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
   wrong-ish for similar colours); habitat and season give a mild prior; species in
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

- `Regions() []proto.RegionInfo` — gating: Greenhollow rank 1; Murmur Marsh rank 2;
  Amberwood rank 2; Windpeak rank 3; Whispering Coast rank 3; Frostveil rank 4.
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
  quest per outer region that motivates the unlock, and 4+ repeat-free cabin research
  contracts with `Giver:"board"`), plus the hidden quest unlocked by the watchtower.
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
- Collectibles: `feather_0…11` (set "Feathers of the Island", each from a specific
  catalog species, named e.g. "Jay Wing Covert"), `page_0…7` (set "The Forgotten
  Field Journal": an earlier naturalist's diary, each page hints at a hidden place or
  a rare bird's conditions — environmental storytelling), `relic_0…2`, and awarded
  `badge_*` collectibles. Lore entries (`proto.LoreDef`) for Natural History.

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
- Region gating: entering a locked region sends `region {unlocked:false, reason}` once
  and the client turns the player back at the border; entering an unlocked region for
  the first time sends `region {unlocked:true}` (Region Discovery screen) + XP.
- Pinned profile flags: `cache:<poi id>` (cache opened), `met:<npc id>`, `tutorial:<step>`.
  Opening a cache gives its `Data["item"]` and sends `rareItem`. Picking up a
  collectible records it in `journal.collectibles` (+ XP, lore for pages).
- POI discovery: within `Radius` → journal location + 25 XP (+ toast). Hidden POIs
  also reveal on the map when within `Stats.TrailSense`. Fog of war: cells within 48 m
  are marked explored.
- The cabin (`interact` with `cabin`) opens the home base (`base` message). Resting
  advances time (`Ecosystem.FastForward`).
- `debug` commands work only with `-dev`.

---

## 4. Protocol semantics

Shapes: `internal/proto/messages.go` and `defs.go`. Envelope `{"t","d"}`.

| Client → Server | When |
|---|---|
| `hello` | once after connect (`newGame:true` wipes the save) → `welcome` |
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

**`ctx.world`** (c-world) — streams chunks around the player with LOD rings
(quality-dependent radius: low 4 / medium 6 / high 8 chunks; lod 0 within 2 chunks,
lod 1 to 4, lod 2 beyond), builds terrain meshes (vertex colours, flat-ish stylised
shading, skirts to hide LOD cracks), instanced vegetation with gentle wind sway,
the sea/water plane with soft shoreline, the creek ribbon. API:
`heightAt(x, z) → number` (bilinear on the finest loaded chunk; falls back to 0),
`isLoaded(x, z) → bool`, `regionAt(x, z) → region id | 255` (from the welcome grid),
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

**`ctx.props`** (c-sky task) — builds every POI from the welcome message as stylised
low-poly geometry: cabin (with porch, chimney smoke, lit window at night), Finn's
stall, ranger station, watchtowers (with a climbable stair/ladder volume: register a
ramp so the player can reach the platform), field-lab tent, hides, camps, ruined
cabins/stations, lighthouse, gates/signposts, the Old Oak dressing, boardwalk,
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
sit and wait (X), swim-proof (deep water pushes back gently — no survival mechanics),
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
| `mainmenu` | c-menu | boot | Continue (if `welcome.hasSave`), New Adventure (confirm → `net.send('hello',{newGame:true})` then `location.assign('?play=1')` after the new `net:welcome`), Journal, Equipment, Skills, Map, Quests, Collection, Settings, and Quit (only when `window.wildcallDesktop` exists → `wildcallDesktop.quit()`); live forest behind it; `closable:false`. Starting play: `ui.close('mainmenu')` then `bus.emit('game:start', {fresh})`. |
| `menu` | c-menu | Tab / K / I / Esc | tabs `character` (level, XP bar, rank, skill points, progression unlocks, currency, reputation, totals), `skills` (five-discipline tree, node states locked/available/purchased, tier requirements, costs, buy), `inventory` (item grid, rarity, description, stats, equip/unequip, sort, filter, capacity, use supplies), `equipment` (six slots, current gear stats, comparison vs. selected, upgrade options), `rank` (current/next rank, requirements with progress, unlocks), `settings` (all of `state.settings`, a fullscreen toggle and "Quit to desktop" when `window.wildcallDesktop` exists, "Return to main menu"); data `{tab}`. |
| `journal` | c-journal | J | sections `species` (grid by discovery level incl. mysteries with their evidence and an "Identify" button → `ui.open('identify', {mystery})`; species page: illustration, name, rarity, discovery status, habitat, locations, activity patterns from the player's own `phases`, vocalizations with playback, behaviours, photos, observations, identification confidence, editable personal notes), `photos`, `recordings` (playback + spectrogram), `locations`, `history` (Natural History lore), `rare` (Rare Discoveries); data `{section, species}`. Field-guide view of all species of unlocked regions (silhouette until identified; "compare similar"). |
| `map` | c-journal | M | `welcome.world.mapUrl` image with fog of war from `profile.explored`, player arrow, trails (per `stats.mapDetail`; hidden trails only if in `profile.trails`), discovered landmarks, NPCs, tracked-quest markers, region borders and lock state. Never birds. |
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

`go run ./cmd/wildcall [-addr 127.0.0.1:8080] [-seed 20261126] [-save <dir>]
[-daylen 1440] [-dev] [-open] [-parent-stdin]` — serves the embedded `web/` at `/`,
the WebSocket at `/ws`, the map at `/map.png`, photos at `/photos/<id>.jpg`.

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
