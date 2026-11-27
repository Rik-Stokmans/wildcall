# Soak test

Plays the game for a long stretch the way a player does and logs, every ~25 s, what
could grow over a session: frame time, CPU per frame by module, JS heap, DOM nodes,
GPU geometries/textures (with a census of what was created after the start), shader
programs, scene objects, Web Audio nodes, bus listeners, timers, WebSocket traffic per
message type, the profile message size and the client's POI/trail/journal sets. The
engine logs its own line every 30 s (tick time, process CPU share, Go heap, every
session map and set, bytes sent per message type).

```sh
go build -o /tmp/wc-soak ./cmd/wildcall
/tmp/wc-soak -dev -addr 127.0.0.1:8251 -save "$(mktemp -d)" -seed soak1 2> /tmp/soak-engine.log &
node tools/soak/make-plan.mjs 13 > /tmp/soak.json          # minutes
ELECTRON_DISABLE_SECURITY_WARNINGS=1 desktop/node_modules/.bin/electron tools/shot/shot.cjs \
  --url http://127.0.0.1:8251 --out /tmp/soak-shots --plan /tmp/soak.json > /tmp/soak-client.log 2>&1
node tools/soak/table.mjs /tmp/soak-client.log /tmp/soak-engine.log
```

- `node tools/soak/make-plan.mjs 13 stances` also changes stance every step (crouch,
  prone and crawling, standing) with the real C / Z keys; each line then ends with the
  stance, the movement mode and what the sound ring shows.
- `instrument.js` is injected as the plan's first step (it installs `window.SOAK`).
- The walker holds W + Shift through real keyboard events and steers along the named
  places of the home valley and then a wide loop (~500 m) around them; when blocked
  for 3 s it hops 4 m on. Every 25 s it also raises a tool, takes a photo, makes a
  9 s recording, or opens the journal or the map. Weather turns to rain at ~5.5 min
  and cloudy at ~10 min. The clock runs at normal speed from 06:00.
- `BENCH-early` (minute 2) and `BENCH-late` (end) stand at the same pose at 08:00
  for 12 s: compare their frame times.
- Engine metrics need `-dev`; with it the engine also serves `/debug/pprof/` (CPU
  profile: `curl -o cpu.pprof 'http://127.0.0.1:8251/debug/pprof/profile?seconds=60'`).
- Wall-clock numbers (frame time, CPU per frame, tick time) include waiting for a core:
  on a busy machine they swing with the load. Compare module shares and the engine's
  `cpuPct`, and record `uptime` alongside a run.
