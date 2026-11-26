# WILDCALL

> Listen closer. Look further. Discover more.

A cozy first-person naturalist RPG prototype: birds are heard before they are seen,
and every discovery is earned by listening, searching, observing and documenting.

- **Game design:** [`Wildcall Spec.md`](Wildcall%20Spec.md)
- **Architecture & decisions:** [`docs/superpowers/specs/2026-11-26-wildcall-design.md`](docs/superpowers/specs/2026-11-26-wildcall-design.md)
- **Build contract:** [`docs/contract.md`](docs/contract.md)

The Go server generates the island, simulates the bird ecosystem and owns all game
rules; an embedded Three.js + Web Audio client renders it in the browser.

_Status: under construction._
