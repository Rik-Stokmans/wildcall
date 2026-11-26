# WILDCALL

> Listen closer. Look further. Discover more.

A cozy first-person naturalist RPG. You start as an amateur birdwatcher in a big,
seed-generated wilderness. Birds are heard before they are seen, and every discovery
is earned: follow an unfamiliar call, find the bird in the branches, watch it through
binoculars, work out what it is, photograph or record it, and write it into your
field journal.

**Status: playable prototype.** Game design: [`Wildcall Spec.md`](Wildcall%20Spec.md).

## Play

**macOS / Windows app.** Every push builds both apps on GitHub Actions; download the
`wildcall-mac` or `wildcall-windows` artifact from the latest green run under
**Actions**. The apps are unsigned: on macOS right-click → Open the first time; on
Windows choose "More info → Run anyway". See [`desktop/README.md`](desktop/README.md).

**Build the app yourself** (needs Go 1.26+ and Node 22+):

```sh
cd desktop
npm ci
npm run dist:mac     # → desktop/dist/…/Wildcall.app and .dmg
npm run dist:win     # → desktop/dist/Wildcall-*.exe and .zip
```

**Run from source** (development; opens in your browser instead of the app window):

```sh
go run ./cmd/wildcall -dev -open
```

### Controls

| | |
|---|---|
| Move / look | `W A S D`, mouse |
| Run / sprint | hold `Shift` / double-tap `Shift` and hold |
| Crouch / sit and wait | `C` / `X` |
| Listen closely | hold `F` |
| Binoculars / camera / recorder | `1` / `2` / `3`, hold right mouse to raise, wheel to zoom, left mouse to shoot or record |
| Identify the bird you are watching | `T` |
| Interact, pick plants, talk | `E` |
| Journal / map / quests / skills / inventory | `J` / `M` / `L` / `K` / `I` |
| Menu | `Tab` or `Esc` |

## What is in it

- **A generated world.** An unbounded landscape grown from a seed — forest, marsh,
  highlands, coast, autumn woods, snowfields — streamed in as you walk. Every world
  has a home valley with your cabin, four characters and the opening quests.
- **A living ecosystem.** 40 real European bird species with their real habits:
  daily routines, territories, flocks, seasons, shyness. They perch on the actual
  branches of the trees, and in spring they nest where the real species nests.
- **Sound first.** Spatial audio, focused listening, clues that never name the bird.
- **Identification by evidence.** Watching reveals size, shape, colours, field marks;
  a confidence table narrows the candidates; you make the call.
- **A naturalist's RPG.** Levels, five skill disciplines, equipment with real
  tradeoffs, rare finds, quests, a field journal, a home cabin.
- **Foraging and a field kitchen.** 18 wild plants with real seasons; teas, snacks and
  meals that give a gentle, timed bonus.
- **A narrator.** The naturalist's own muttered thoughts as you explore.

## How it is built

A Go engine generates the world, simulates the ecosystem and owns every rule; a
Three.js + Web Audio client renders it; an Electron shell packages both into one app.

- Architecture and decisions: [`docs/superpowers/specs/2026-11-26-wildcall-design.md`](docs/superpowers/specs/2026-11-26-wildcall-design.md)
- Interfaces between the parts: [`docs/contract.md`](docs/contract.md)
- Tests: `go test ./...` and `cd web && node --test $(find js -name '*.test.js')`
- Screenshots without a window: [`tools/shot/shot.cjs`](tools/shot/shot.cjs)

## Optional asset packs

- **Narrator voice** — `tools/voice/` pregenerates every narrator line into
  `web/voice/` (needs an OpenRouter API key in `.env`). Without it the narrator uses
  the system's speech synthesis.
- **Real bird recordings** — `tools/birdsong/` plans and fetches openly licensed
  recordings into `web/birdsong/` with full credits. Without them calls are
  synthesised.
