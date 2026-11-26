# birdsong: real recordings for WILDCALL

The audio engine plays a real recording instead of the synthesised call when
`web/birdsong/manifest.json` lists one for that species and call index. This tool finds
openly licensed recordings, lets a human approve them, and builds the files.

## Workflow

```sh
go run ./tools/birdsong/species                 # (re)writes tools/birdsong/species.json from the catalog
node tools/birdsong/fetch.mjs --plan            # reads metadata only; writes plan.json + plan.md. Downloads no audio.
# read tools/birdsong/plan.md: licences, recordists, sizes, flagged NON-COMMERCIAL / SHARE-ALIKE terms
node tools/birdsong/fetch.mjs --fetch           # ONLY after approval: downloads, converts, writes web/birdsong/
node tools/birdsong/fetch.mjs --selftest        # checks the ffmpeg pipeline on a synthetic clip, no network
node --test tools/birdsong/lib.test.js                    # unit tests
```

Node 22 built-ins only. `--fetch` needs ffmpeg and ffprobe (found in `/opt/homebrew/bin`, `/usr/local/bin`,
`/usr/bin`, or set `FFMPEG` / `FFPROBE`). Downloads are cached in `tools/birdsong/.cache/` (git-ignored), so
a re-run does not download again. `--species a,b` limits a run; a partial `--fetch` keeps the manifest entries
of the other species.

## Archives

| Archive | API | Used |
|---|---|---|
| xeno-canto (API v3) | free, **needs a key** (every registered member with a verified e-mail has one) | `--source xeno-canto`; best: has the A-E quality rating and the recordist's "animal seen / playback used" fields |
| Wikimedia Commons | open, **no key** | default when there is no key; carries a large mirror of xeno-canto recordings under CC BY / CC BY-SA with the type (song, call...) in the description, but no quality rating |
| Macaulay Library, Freesound, iNaturalist | not used: Macaulay licences do not allow redistribution; Freesound has few labelled bird songs; iNaturalist's sounds are mostly NC | |

### Supplying an xeno-canto key

1. Register at https://xeno-canto.org and verify the e-mail address.
2. Copy the key from https://xeno-canto.org/account.
3. Either `export XC_API_KEY=...` or put a line `XC_API_KEY=...` in the git-ignored `.env` at the repo root.
   The tool never prints or writes the key (it is scrubbed from any error text). Do not commit it.

Then `node tools/birdsong/fetch.mjs --plan --source xeno-canto`.

## Licence rules

- Never used: anything with ND (no derivatives): every file is trimmed and re-encoded.
- Used by default: CC0, public domain, CC BY, CC BY-SA.
- **CC BY-SA** is flagged: the converted excerpts must be redistributed under the same licence (the audio files, not the game code).
- **NC (non-commercial)** is excluded unless `--allow-nc`; if allowed, every such line is flagged NON-COMMERCIAL in the plan and CREDITS.md.
- Recordings made with playback are skipped (the bird was provoked).

## What the converter does

Per recording: decode, high-pass at 200 Hz and find the loudest vocalisation (frame energy against the noise floor),
keep 3-10 s around it (length by call kind), 0.3 s lead-in and 0.5 s tail, fade, EBU R128 two-pass loudness
normalisation to -16 LUFS (true peak -1.5 dB), mono 48 kHz Opus at 48 kbps. A recording less than 12 dB above its own
noise floor is replaced by the next alternate from the plan.

Output names: `web/birdsong/<species id>/<call index>-<kind>-<n>.ogg`, plus `manifest.json` and `CREDITS.md`.
