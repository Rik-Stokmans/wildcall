# WILDCALL Prototype Implementation Plan

> **For agentic workers:** this plan is executed by a managed fleet. Each task below is
> one agent's brief. The binding interfaces live in `docs/contract.md` and in the
> compiled contract packages `internal/core` and `internal/proto`; a task's
> "Interfaces" entry names the contract sections it must satisfy.

**Goal:** a playable WILDCALL prototype covering the whole spec at prototype depth.

**Architecture:** a standalone desktop app (macOS, Windows): a Go engine generates the island, simulates the ecosystem and owns
all game rules; an embedded Three.js + Web Audio browser client renders, plays sound
and shows the UI, talking to the server over one WebSocket.

**Tech Stack:** Go 1.26 (stdlib + gorilla/websocket), three.js r170 (vendored),
vanilla ES modules, Web Audio, HTML/CSS, Electron shell + electron-builder for
packaging. No bundler, no external assets.

**Spec:** `Wildcall Spec.md` · **Design:** `docs/superpowers/specs/2026-11-26-wildcall-design.md`

## Global Constraints

- File ownership, no git writes, no new dependencies: contract "Rules for parallel work".
- Discovery must be earned: no bird markers, no species name before identification
  (spec §5.2, §29.1, rules 1 and 7).
- UI palette: Forest `#355C43`, Moss `#7C9A70`, Paper `#D9C7A0`, Amber `#C98A50`,
  Sky `#627F9A`, Bark `#554537`, Cream `#F2EBDD` (spec §2.4) via `css/base.css` variables.
- XP table and anti-grind rules: spec §7.3–§7.4, contract §3.4.
- Cozy: no punishment mechanics (spec rule 8).
- 60 fps on an integrated GPU at medium quality; ecosystem step < 1 ms for 600 birds.

## Review Focus

1. A bird that is audible but never findable (perch inside terrain, call position
   drifting from the model) — the core loop dead-ends. Expect: every calling bird can
   be walked to and seen.
2. Save files from an older build or a half-written file — expect a clean new game or
   a migrated profile, never a crash on start.
3. A client module that throws during init or a frame — expect the rest of the game to
   keep running (main.js isolates modules).
4. Profile actions sent out of context (buying without credits, equipping an item not
   owned, cabin actions away from the cabin, identify with a stale mystery id) —
   expect an `error` message and an unchanged profile.
5. The player reaching world edges, deep water, locked regions or the tower platform —
   expect gentle containment, never falling through the world or getting stuck.

---

## Stage 0 — Contract (lead, done)

`internal/core`, `internal/proto`, `internal/species/catalog.go`, `web/index.html`,
`web/css/base.css`, `web/js/main.js`, `web/js/core/*`, `web/js/ui/kit.js` (stub),
`docs/contract.md`.

## Stage 1 — Parallel build (19 agents)

| # | Task | Files | Interfaces | Tests that prove it |
|---|---|---|---|---|
| 1 | world | `internal/noise`, `internal/world` | `core.Terrain`; contract §2 | determinism per seed; every pinned POI id present, on land, in its region; chunk byte layout and edge consistency across neighbours and LODs; perches sit on/above ground; occlusion 1 through a hill, 0 in the open; region grid matches `RegionAt`; map PNG decodes |
| 2 | species-greenhollow | `internal/species/greenhollow.go` | `core.Species`; `Validate` | `Validate` passes; the five prototype species and the seven "future" species of spec §25 are present; ids pinned (`european_robin`, `blue_tit`, `great_tit`, `common_blackbird`, `eurasian_wren`, …); no two species share the full trait tuple |
| 3 | species-regional | `internal/species/regional.go` | same | `Validate` passes; every outer region has ≥ 3 resident species; at least 2 rare and 1 legendary species with distinctive calls |
| 4 | eco | `internal/eco`, `internal/env` | `core.Ecosystem`; contract §3.1–§3.2 | population within range and inside home regions; calls cluster at dawn; sprinting flushes at a larger distance than crouching; flushed birds return; still observer habituates; seasonal absence; vagrant in autumn; lure produces `ActFeeding`; determinism; step time budget (benchmark) |
| 5 | progress | `internal/progress` | contract §3.4 | level curve; anti-grind (second identical photo pays 0); tier gates; every skill changes a stat; every tier ≥ 2 item has a negative mod; capacity enforced; rank thresholds; starting kit |
| 6 | content | `internal/content` | contract §3.5 | every quest objective uses the pinned vocabulary and references existing POI/NPC/item/species ids (species checked against a pinned id list, see task); ordered quests advance only in order; turn-in pays once; dialogue never dead-ends |
| 7 | field | `internal/field` | contract §3.3 | louder/closer calls are heard farther; focus extends range but adds no species; clue never names an unidentified species; clarity falls with distance, cover, darkness; evidence order; candidate table sums to ~100 and ranks the true species first with full evidence; photo of empty sky = 0 stars; centred close bird in good light ≥ 4 stars; recording quality falls with distance and wind |
| 8 | c-world | `web/js/world/` | contract §2.3, §5.2 `ctx.world` | chunk parser against a synthetic frame; bilinear `heightAt`; LOD ring selection |
| 9 | c-sky | `web/js/sky/`, `web/js/props/` | §5.2 `ctx.sky`, `ctx.props` | sun direction by hour; interactable filtering by profile |
| 10 | c-birds | `web/js/birds/` | §5.2 `ctx.birds` | snapshot interpolation (position, yaw wrap); model builder returns geometry for every vocabulary value |
| 11 | c-player | `web/js/player/`, `web/css/tools.css` | §5.2 `ctx.player`, `ctx.tools` | movement speed table; yaw/pitch ↔ camera mapping; binocular FOV/sway maths; pose message shape |
| 12 | c-audio | `web/js/audio/` | §5.2 `ctx.audio` | note schedule from a call (timing, repeats); gain/low-pass curves vs. distance and occlusion |
| 13 | c-kit | `web/js/ui/kit.js` bodies, `web/js/ui/kit/`, `web/css/kit.css` | kit signatures | icon vocabulary complete; `formatStat`/`formatMod`/`formatClock`/`label` |
| 14 | c-hud | `web/js/ui/hud/`, `web/css/hud.css` | §5.4 | clue upsert + TTL expiry; compass maths |
| 15 | c-encounter | `web/js/ui/encounter/`, `web/css/encounter.css` | §5.3 | field-guide filter logic; reward line building |
| 16 | c-menu | `web/js/ui/menu/`, `web/css/menu.css` | §5.3 | skill node state (locked/available/purchased) from profile + tiers; inventory sort/filter; stat comparison |
| 17 | c-journal | `web/js/ui/journal/`, `web/css/journal.css` | §5.3 | fog-of-war cell lookup; world ↔ map coordinates; quest grouping |
| 18 | c-base | `web/js/ui/base/`, `web/css/base-screen.css` | §5.3 | shop affordability/requirement logic; rest-until hour maths |

| 19 | desktop | `desktop/`, `.github/workflows/` | contract §6 (engine CLI), §7 | shell starts a stand-in engine, waits for `WILDCALL_LISTENING`, loads it, exits cleanly and leaves no orphan process; `electron-builder --dir` produces a runnable macOS app |

## Stage 2 — Server integration (1 agent, after tasks 1–7)

`internal/game`, `internal/save`, `internal/server`, `cmd/wildcall`. Wires the real
packages per contract §3.6 and §6. Tests: an end-to-end test that starts the server
on a random port, connects a WebSocket client, receives `welcome`, a chunk, bird
snapshots and call events, walks the tutorial with debug assistance (hear → record →
observe → identify → photo → turn in), buys a skill and an item, rests at the cabin,
reconnects and finds the save intact; every Review Focus item 2 and 4.

## Stage 3 — Play-through and fixes (lead, in the browser)

Run the server, play the first scenario of spec §27 in Chrome, read the console, fix
integration faults between client modules and the server.

## Stage 4 — Review fleet

Independent reviewers per dimension (spec coverage against §31 acceptance criteria and
all 20 screens, Go correctness, client correctness, protocol mismatches between Go and
JS, performance), each finding adversarially verified, then fixed.
