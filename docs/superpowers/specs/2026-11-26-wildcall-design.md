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
- Efficient rendering.

## Non-goals (spec §33)

Multiplayer, combat, survival mechanics, crafting, breeding simulation, a full
migration simulation, hundreds of species, huge quest chains, advanced cabin
customisation. The five outer regions exist and are explorable but are deliberately
thinner than Greenhollow Woods.

## Anti-goals

- Bird markers, automatic species reveals, or a "detective vision" (rules 1, 2, 7).
- Punishing difficulty: wrong identifications and flushed birds cost time, never
  progress (rule 8).
- Grinding: repeat sightings must not pay out (spec §7.4, §22).

## Approaches considered

**A. Go server + browser client (Three.js / WebGL2 + Web Audio) — chosen.**
The Go binary generates the world, runs the ecosystem and owns all rules; the embedded
web client only renders, plays audio and shows UI. They talk over a local WebSocket.
- Web Audio gives HRTF spatial audio, per-voice filters for occlusion and a built-in
  analyser for the spectrogram — the spec's central mechanic — and lets every call be
  *synthesized* from data, so there are no audio assets to source.
- HTML/CSS makes the 20 field-journal screens fast to build and good-looking.
- WebGL2 with instanced vegetation and LOD chunk streaming is efficient on integrated
  GPUs; the renderer is replaceable because it only speaks the protocol.
- One `go run` starts everything; nothing to install for a player beyond a browser.
- Cost: a network hop between simulation and view (negligible on localhost), and JS
  on the client rather than Go.

**B. Single native Go binary with raylib-go.** Lowest overhead and one language, but
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

- **Designed generation.** Spec §33 puts "procedural maps" out of scope and §17 calls
  for handcrafted regions, while the brief asks for terrain generation in Go. The world
  is therefore a single authored island produced by a deterministic Go generator: the
  region layout, the nine Greenhollow locations, trails and every point of interest are
  pinned (contract §2), and noise only supplies natural detail.
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
- **Single player, one session.** The server keeps one world and one save.

## Architecture

```
cmd/wildcall ── flags, wiring, HTTP + WebSocket
internal/core      shared types: Vec3, habitats, regions, Species, BirdState, Stats, Terrain & Ecosystem interfaces
internal/proto     wire messages, content definitions, Profile (JSON names are the protocol)
internal/noise     simplex / fBm
internal/world     island generator: heights, regions, habitats, vegetation, perches, POIs, trails, chunks, map
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
```

Server loop at 10 Hz: clock → ecosystem step → perception → messages. The client
interpolates birds, streams terrain chunks by LOD around the player, and synthesizes
every sound.

## What is left to the builders

Tuning values, visual and audio craft, the exact skill/item numbers, quest writing,
bird data. The contract pins every id and interface they share; within their own
package or module they decide.

## Calls made without the user

The stack (approach A), the vanilla-JS/no-bundler client, real European species,
the island layout and all ids, 38 species instead of the first-mockup five, building
the outer regions thin rather than omitting them, and a 24-minute day.
