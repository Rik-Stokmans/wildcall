# WILDCALL Prototype — Design

**Date:** 2026-11-26 · **Spec:** `Wildcall Spec.md` (v0.1) · **Contract:** `docs/contract.md`

## Intent

Turn the WILDCALL design spec into a working, playable prototype: a cozy first-person
naturalist RPG in which birds are *heard before they are seen* and discoveries are
earned by listening, searching, observing and documenting. The prototype must make
the spec's core loop (Explore → Listen → Investigate → Spot → Document → Progress)
and its secondary loop (return to base → review → upgrade → head out again) real, and
show the RPG structure around it.

## Goals

- Everything in the spec's first-mockup scope (§26–§32) is playable end to end: the
  nine-stage first scenario, "The Unseen Singer", all 20 screens, the main menu, and
  the acceptance criteria of §31.
- The wider systems of §1–§25 exist at prototype depth rather than as mock-ups: all
  five skill disciplines (35 skills), six equipment slots with tiers, rarity and
  tradeoffs, the six rare items, confidence-based identification, the six-section
  journal with discovery levels, quests in all five categories, the four NPCs with
  reputation, time/weather/seasons, the cabin with its stations and upgrades, Field
  Credits, rare discoveries (rare species, unusual plumage, out-of-range visitors).
- A living ecosystem that runs whether or not the player is watching (design rule 5).
- Go does the heavy lifting: terrain generation and all simulation.
- A big, seed-generated, streaming world (Minecraft-style) in WILDCALL's look.
- Efficient rendering.
- **A standalone desktop app for macOS and Windows** — double-click to play; no
  browser, no URL, no install steps.

## Non-goals (spec §33)

Multiplayer, combat, survival mechanics, crafting, breeding simulation, a full
migration simulation, hundreds of species, huge quest chains, advanced cabin
customisation. The five other region types exist and are explorable but are
deliberately thinner in authored content than Greenhollow Woods.

## Anti-goals

- Bird markers, automatic species reveals, or a "detective vision" (rules 1, 2, 7).
- Punishing difficulty: wrong identifications and flushed birds cost time, never
  progress (rule 8).
- Grinding: repeat sightings must not pay out (spec §7.4, §22).

## Approaches considered

**A. Go engine + WebGL2/Web Audio renderer, shipped as a desktop app — chosen.**
The Go binary generates the world, runs the ecosystem and owns all rules; the
renderer (Three.js + Web Audio + HTML/CSS screens) only draws, plays audio and shows
UI. They talk over a loopback WebSocket. Both are packaged into one desktop app
(Electron shell, the Go engine as a hidden sidecar process) for macOS and Windows.
- Web Audio gives HRTF spatial audio, per-voice filters for occlusion and a built-in
  analyser for the spectrogram — the spec's central mechanic — and lets every call be
  *synthesized* from data, so there are no audio assets to source.
- HTML/CSS makes the 20 field-journal screens fast to build and good-looking.
- WebGL2 with instanced vegetation and LOD chunk streaming is efficient on integrated
  GPUs; the renderer is replaceable because it only speaks the protocol.
- Chromium is the same on both platforms, so pointer lock, WebGL2 and HRTF audio
  behave identically on macOS and Windows; the Go engine is pure Go and cross-compiles.
- Cost: a loopback hop between simulation and view (negligible), JS for the view
  layer, and a ~100 MB app because it carries its own Chromium.

**B. Single native Go binary with raylib-go.** Smallest app and one language, but
raylib has no HRTF or per-voice filtering (elevation and occlusion cues would have to
be hand-built DSP through cgo), immediate-mode UI makes 20 polished screens slow, and
it needs a C toolchain on every machine.

**C. Go simulation as a library inside Godot (GDExtension).** A real engine and
editor, but the Go↔Godot bridge is immature, it splits the project across two build
systems, and the generated world would have to be marshalled across the FFI anyway.

**D. Go compiled to WebAssembly in the browser.** No server, but single-threaded,
slower than native Go and a multi-megabyte download, and it throws away the clean
server/renderer boundary.

## Key decisions

- **A big generated world.** The user asked for a large, seed-generated world in the
  spirit of Minecraft, in WILDCALL's own style. This deliberately overrides spec §33
  ("procedural maps" out of scope) and §17's "handcrafted regions". The world is
  unbounded and generated on demand from a seed: the spec's six regions become the
  region *types* of a procedural patchwork; structures, hidden places, trails and
  collectibles are generated on a structure grid. To keep the spec's first-hour
  experience, every world has a **home valley** at the origin — always Greenhollow
  Woods — where the generator lays out the cabin and the nine locations of spec §18
  (differently per seed), so the tutorial, the NPCs and the first quests always work.
- **Local but persistent wildlife.** An unbounded world cannot simulate every bird, so
  residents are a deterministic function of (seed, 128 m cell, season) and are
  simulated in the cells around the player; return to a place and the same individuals
  are living there.
- **Server-authoritative perception.** What the player can hear and see is decided in
  Go (`internal/field`) from the true world state, stats and weather. The client never
  decides that a bird was identified or photographed, which keeps the rules in one
  place and makes equipment/skill effects real instead of cosmetic.
- **Evidence-based identification.** Watching and listening reveal discrete evidence
  (size, shape, colours, field mark, bill, flight, pitch, pattern, habitat, behaviour).
  A confidence table over the field guide is computed from the evidence; the player
  chooses, and the result is certain, probable or gently wrong (spec §13).
- **Everything procedural.** Bird models, bird illustrations, NPCs, structures,
  icons, sounds and music are generated from data. No external assets, fonts or CDNs.
- **Stats as the single progression currency.** Skills, items, upgrades and cabin
  upgrades are all additive modifiers on one `core.Stats` struct; every consumer reads
  the derived stats, so a new skill is one line of data.
- **Single player, one session.** The engine keeps one world and one save.
- **Desktop shell.** Electron rather than the system webview (Wails): WKWebView's
  pointer-lock support is unreliable, and a first-person game cannot ship without it.
  The shell is ~150 lines; swapping it later does not touch the game.

## Architecture

```
cmd/wildcall ── flags, wiring, HTTP + WebSocket
internal/core      shared types: Vec3, habitats, regions, Species, BirdState, Stats, Terrain & Ecosystem interfaces
internal/proto     wire messages, content definitions, Profile (JSON names are the protocol)
internal/noise     simplex / fBm
internal/world     unbounded world generator: heights, region types, vegetation, perches, POIs, trails, chunks, map tiles
internal/species   authored bird catalog (38 species)
internal/env       clock, seasons, weather, forecast
internal/eco       bird simulation (routines, territories, flocks, calls, fear, vagrants)
internal/field     perception: clues, movement cues, observation, confidence, photo & recording scoring
internal/progress  XP, levels, ranks, skills, items, cabin upgrades, stats, inventory
internal/content   regions, NPCs + dialogue, quests + tracker, collectibles, lore
internal/game      one player session: ties all of the above to the protocol
internal/save      JSON save + photo files
internal/server    HTTP static files, WebSocket transport
web/               embedded client: three.js renderer, Web Audio, HTML/CSS screens
desktop/           Electron shell + packaging for macOS and Windows
```

Server loop at 10 Hz: clock → ecosystem step → perception → messages. The client
interpolates birds, streams terrain chunks by LOD around the player, and synthesizes
every sound.

## What is left to the builders

Tuning values, visual and audio craft, the exact skill/item numbers, quest writing,
bird data. The contract pins every id and interface they share; within their own
package or module they decide.

## Calls made without the user

The stack (approach A; the desktop-app requirement is the user's, Electron as the
shell is mine), the vanilla-JS/no-bundler client, real European species,
the home-valley design and all ids, 40 species instead of the first-mockup five, and a
24-minute day. The generated-world and desktop-app requirements are the user's.
