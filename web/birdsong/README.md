# Real bird recordings

This folder is filled by `node tools/birdsong/fetch.mjs --fetch` (see `tools/birdsong/README.md`).
Until then it holds only this file and the game plays its synthesised calls.

After a fetch it contains:

- `manifest.json`: `{version, species: {<species id>: {<call index>: [{file, dur, gain}]}}, credits: [...]}`.
  The audio engine (`web/js/audio/samples.js`) reads it at start-up; when it is missing or
  unreadable every call falls back to synthesis.
- `<species id>/<call index>-<kind>-<n>.ogg`: mono Ogg/Opus, about 48 kbps, 3-10 s, trimmed
  around the loudest vocalisation, high-passed at 200 Hz, loudness-normalised to -16 LUFS.
- `CREDITS.md`: one line per file with species, recordist, licence and source URL.
