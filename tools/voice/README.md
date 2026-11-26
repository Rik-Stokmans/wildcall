# Narrator voice pack

The narrator (`internal/narrator`) can only ever say a finite, known set of sentences
(`narrator.AllLines`, about 2 400 with the species facts). This folder holds the tools
that voice every one of them ahead of time, so the game ships a real recorded voice
instead of the computer's speech synthesis (docs/contract.md §13).

| File | What it does |
|---|---|
| `lines/main.go` | `go run ./tools/voice/lines` prints every sentence as JSON `[{id, text, kind}]` (`-compact`, `-stats`). |
| `generate.mjs` | Voices the lines through OpenRouter and writes `web/voice/<id>.ogg` + `web/voice/manifest.json`. Node 22, no dependencies. |
| `generate.test.mjs` | `node --test tools/voice/*.test.mjs`: runs the generator against a local fake of the API. |
| `samples/` | Output of `--sample` (git-ignored). |

A line's **id** is the first 16 hex characters of the SHA-256 of its exact UTF-8 text.
The engine sends only the text (`proto.Narration.Text`); the client hashes it the same
way and plays `web/voice/<id>.ogg` if the manifest lists it, else falls back to speech
synthesis for that line. Changing a sentence by one character changes its id, so the
next run of the generator voices just the new or edited lines.

## Making the pack

You need an OpenRouter key (https://openrouter.ai/keys). Put it in the repo-root `.env`
(already git-ignored) or the environment; the script never prints it.

```sh
echo 'OPENROUTER_API_KEY=sk-or-...' >> .env

node tools/voice/generate.mjs --dry-run     # how many lines, characters, estimated cost
node tools/voice/generate.mjs --sample      # 12 lines × 9 candidate voices → tools/voice/samples/index.html (~$0.15)
node tools/voice/generate.mjs               # the whole pack with the default voice (~$3)
```

Listen to `tools/voice/samples/index.html` and pick a voice; to use another one:
`node tools/voice/generate.mjs --model <model> --voice <voice>`.

The run is **resumable** (clips already in the manifest are skipped; re-run after an
interruption or after editing lines), **paced** (`--rpm`, default 60 requests a minute,
`--concurrency` 3), and **retries** rate limits and server errors with backoff. A bad key
or empty credit stops it at once. Other options: `--limit N` (at most N new clips),
`--only <id,id>` (just these lines), `--force` (re-voice even if present), `--format mp3`,
`--no-ffmpeg`, `--lines file.json`, `--out dir`. `--help` prints the script header.

With ffmpeg installed (it is looked up on PATH and in /opt/homebrew/bin) every clip is
trimmed of leading/trailing silence, loudness-normalised to −18 LUFS (true peak −2 dBTP),
and encoded as Ogg/Opus 32 kbps mono 48 kHz: ~15–20 KB per line, ~40 MB for the pack.
Without ffmpeg the clips are kept as the API returns them (WAV for Gemini: much larger).

## OpenRouter speech API (researched 2026-11-26)

Sources: https://openrouter.ai/docs/guides/overview/multimodal/tts,
https://openrouter.ai/docs/api/api-reference/tts/create-speech, and the public model
list `GET https://openrouter.ai/api/v1/models?output_modalities=speech` (voices and
prices per model; `GET /api/v1/audio/speech/models/<author>/<slug>` gives formats).

- `POST https://openrouter.ai/api/v1/audio/speech`, OpenAI-compatible, `Authorization: Bearer <key>`.
- Body: `model`, `input` (text), `voice` (model-specific id), `instructions` (delivery
  style; honoured by Gemini TTS, OpenAI gpt-4o-mini-tts and Fish Audio, ignored by
  others), `response_format` (`mp3` | `pcm` | `wav`, default `pcm`), optional `speed`,
  `output_delivery` (`stream` default | `url`), `provider` routing.
- Response: the raw audio bytes (no streaming protocol needed; `audio/mpeg`, `audio/wav`,
  or `audio/pcm` = 16-bit little-endian). With `output_delivery: "url"` a JSON
  `{url, expires_at, media_type}`; the script handles both.
- Gemini TTS returns only `wav`/`pcm`; most other models return `mp3`.
- Errors are JSON `{error: {code, message}}`: 400, 401, 402 (credits), 429 (rate limit),
  500/502/503/524/529 (temporary). No published rate limit.
- Billing: most models per input character (`pricing.prompt`); Gemini TTS per token:
  `pricing.prompt` per input token, `pricing.completion` per audio output token
  (25 tokens per second of audio).

**Default: `google/gemini-3.8-flash-tts`, voice `Algenib`.** Gemini 3.8 Flash TTS was
ranked first for text-to-speech on OpenRouter, it follows a natural-language
`instructions` direction (the only practical way to get the murmured, close, unhurried
delivery we want), and it is cheap: $0.50 per million input tokens and $9 per million
audio tokens, about **$3 for the whole pack** (`--dry-run` shows the current estimate
from live prices). Algenib is the voice Google describes as gravelly; male.
`--sample` compares it with Charon, Enceladus, Sadaltager, Iapetus and Umbriel (Gemini),
`en-GB-Harry` (Microsoft MAI Voice 2.1), `gb_oliver_neutral` (Mistral Voxtral) and
`bm_george` (Kokoro). Those last three ignore `instructions`, so they read rather than
murmur.

### Voice direction

Every request carries the same instruction (`STYLE` in `generate.mjs`): an **original**
calm, warm, slightly gravelly older British man; a field naturalist quietly thinking
aloud to himself outdoors; soft and close to the microphone, unhurried, with quiet
delight and gentle wry warmth; never theatrical; read the text exactly as written. It is
never an imitation of a real person, and no real person's name goes into any prompt
or voice choice. (Some providers list stock voices named after celebrities; do not
pick those.)
