#!/usr/bin/env node
// WILDCALL narrator voice-pack generator (docs/contract.md §13). Node 22, no dependencies.
//
// Every sentence the narrator can ever say is enumerated by the engine
// (narrator.AllLines, printed by `go run ./tools/voice/lines`). This script voices each
// one once through the OpenRouter text-to-speech API and writes
//
//   web/voice/<id>.ogg            one clip per line (id = first 16 hex of SHA-256(text))
//   web/voice/manifest.json       {voice, model, format, instructions, generated, lines: {id: {file, dur}}}
//
// The client (web/js/narrator/voice.js) hashes Narration.text the same way and plays the
// clip when the manifest has it, falling back to system speech synthesis otherwise.
//
// ---------------------------------------------------------------------------------------
// OpenRouter speech API — findings (docs read 2026-11-26):
//   https://openrouter.ai/docs/guides/overview/multimodal/tts
//   https://openrouter.ai/docs/api/api-reference/tts/create-speech
//   GET https://openrouter.ai/api/v1/models?output_modalities=speech     (public: models, voices, pricing)
//   GET https://openrouter.ai/api/v1/audio/speech/models/<author>/<slug>  (public: per-model voices/formats)
//
//   * Endpoint: POST https://openrouter.ai/api/v1/audio/speech, OpenAI-compatible.
//     Auth: "Authorization: Bearer <OPENROUTER_API_KEY>".
//   * Body: {model, input (string | turns), voice, instructions?, response_format?
//     ("mp3" | "pcm" | "wav", default "pcm"), speed?, output_delivery? ("stream" default |
//     "url"), provider?}. No streaming protocol is needed: the default response IS the raw
//     audio byte stream (Content-Type audio/mpeg | audio/pcm | audio/wav). With
//     output_delivery "url" the body is JSON {url, expires_at, media_type} instead; this
//     script asks for the stream but also accepts the JSON form.
//   * `instructions` (tone, pacing, emotion for the whole request) is honoured by OpenAI
//     gpt-4o-mini-tts, Gemini TTS and Fish Audio, and ignored elsewhere.
//   * Formats: Gemini TTS returns only pcm or wav (mp3 → 400); most others give mp3; pcm is
//     16-bit little-endian without a header. We ask Gemini for wav, others for mp3.
//   * Errors: JSON {error: {code, message}}; 400 bad params, 401 key, 402 credits, 429 rate
//     limit, 500/502/503/524/529 temporary. No published rate limit, so we pace requests
//     (--rpm) and retry 429/5xx with exponential backoff (honouring Retry-After).
//   * Pricing: per-character models list the price per input character in pricing.prompt.
//     Gemini TTS is token-priced: pricing.prompt per input token (~4 chars) and
//     pricing.completion per audio output token (Gemini audio = 25 tokens per second).
//     Seed Audio bills per second of audio (pricing.completion, prompt 0).
//
// Chosen default: google/gemini-3.8-flash-tts (ranked first for text-to-speech on
// OpenRouter at the time of writing, steerable with `instructions`, cheap) with voice
// "Algenib" (Google describes it as gravelly; male), asked for wav and converted with
// ffmpeg to Ogg/Opus 32 kbps mono, silence-trimmed and loudness-normalised (-18 LUFS).
// Estimated cost for the whole pack (~2 400 lines, ~140 000 characters): about 3 USD —
// run --dry-run for the current figure. `--sample` voices a dozen lines in several
// candidate voices so a voice can be chosen by ear before the full run.
//
// Voice direction (every request carries STYLE as `instructions`): an ORIGINAL calm,
// warm, slightly gravelly older British man muttering to himself — never an imitation of
// a real person, and no real person's name is ever put in a prompt.
//
// Usage (from the repo root):
//   node tools/voice/generate.mjs --dry-run                 # count, characters, estimated cost
//   node tools/voice/generate.mjs --sample                  # candidate voices → tools/voice/samples/
//   node tools/voice/generate.mjs                           # the full pack → web/voice/
//   node tools/voice/generate.mjs --limit 50                # at most 50 new clips this run
//   node tools/voice/generate.mjs --only 61a20f3fcd5a281a,899a261cbf5339d2
// Options: --lines <json> (default: go run ./tools/voice/lines), --out <dir> (web/voice),
//   --model <id>, --voice <name>, --format opus|mp3 (opus needs ffmpeg), --force
//   (re-voice existing clips), --concurrency N (3), --rpm N (60), --retries N (6),
//   --base-url <url> (https://openrouter.ai/api/v1), --sample-voices model:voice,...,
//   --no-ffmpeg. The API key comes from OPENROUTER_API_KEY or a git-ignored .env in the
//   repo root; it is never printed.
import { createHash } from 'node:crypto';
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFile = promisify(execFileCb);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');

export const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'google/gemini-3.8-flash-tts';
export const DEFAULT_VOICE = 'Algenib';

/** The delivery instruction sent with every request. No real person is named. */
export const STYLE = [
  'Voice an original character: a calm, warm, slightly gravelly older British man,',
  'a field naturalist quietly thinking aloud to himself outdoors.',
  'Speak softly and close to the microphone, unhurried, with quiet delight and a gentle, wry warmth;',
  'relaxed pace with small natural pauses at commas and full stops.',
  'Murmured and intimate, never theatrical, never like an announcer or a narrator on stage.',
  'Read the text exactly as written, adding no words, sounds or music.',
].join(' ');

/** Candidate voices for --sample (model:voice). Original stock voices only. */
export const SAMPLE_VOICES = [
  'google/gemini-3.8-flash-tts:Algenib',
  'google/gemini-3.8-flash-tts:Charon',
  'google/gemini-3.8-flash-tts:Enceladus',
  'google/gemini-3.8-flash-tts:Sadaltager',
  'google/gemini-3.8-flash-tts:Iapetus',
  'google/gemini-3.8-flash-tts:Umbriel',
  'microsoft/mai-voice-2.1:en-GB-Harry:MAI-Voice-2.1',
  'mistralai/voxtral-mini-tts-3-0:gb_oliver_neutral',
  'hexgrad/kokoro-82m:bm_george',
];

/** Fallback pricing when the models API can't be reached (USD, as listed 2026-11-26). */
const KNOWN_PRICING = {
  'google/gemini-3.8-flash-tts': { prompt: 0.0000005, completion: 0.000009 },
  'google/gemini-3.8-flash-lite-tts': { prompt: 0.0000005, completion: 0.000006 },
  'microsoft/mai-voice-2.1': { prompt: 0.000022, completion: 0 },
  'mistralai/voxtral-mini-tts-3-0': { prompt: 0.000013, completion: 0 },
  'hexgrad/kokoro-82m': { prompt: 0.00000099, completion: 0 },
};

// ---------------------------------------------------------------------------------------
// Pure helpers (unit-tested)

/** Line id: first 16 hex chars of SHA-256 of the exact UTF-8 text (same as Go and the client). */
export function lineId(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/** Parse argv into options. */
export function parseArgs(argv) {
  const o = {
    dryRun: false, sample: false, force: false, limit: Infinity, only: null, lines: null,
    out: path.join(REPO, 'web', 'voice'), samplesDir: path.join(HERE, 'samples'),
    model: DEFAULT_MODEL, voice: DEFAULT_VOICE, format: null, concurrency: 3, rpm: 60,
    retries: 6, baseUrl: process.env.OPENROUTER_BASE_URL || DEFAULT_BASE, sampleVoices: null,
    ffmpeg: true, help: false,
  };
  const need = (i) => {
    if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--dry-run': o.dryRun = true; break;
      case '--sample': o.sample = true; break;
      case '--force': o.force = true; break;
      case '--no-ffmpeg': o.ffmpeg = false; break;
      case '-h': case '--help': o.help = true; break;
      case '--limit': o.limit = posInt(need(i), a); i++; break;
      case '--only': o.only = need(i).split(/[\s,]+/).filter(Boolean); i++; break;
      case '--lines': o.lines = path.resolve(need(i)); i++; break;
      case '--out': o.out = path.resolve(need(i)); i++; break;
      case '--samples-dir': o.samplesDir = path.resolve(need(i)); i++; break;
      case '--model': o.model = need(i); i++; break;
      case '--voice': o.voice = need(i); i++; break;
      case '--format': o.format = need(i); i++; if (!['opus', 'mp3'].includes(o.format)) throw new Error('--format is opus or mp3'); break;
      case '--concurrency': o.concurrency = posInt(need(i), a); i++; break;
      case '--rpm': o.rpm = posInt(need(i), a); i++; break;
      case '--retries': o.retries = Number(need(i)); i++; if (!(o.retries >= 0)) throw new Error('--retries must be ≥ 0'); break;
      case '--base-url': o.baseUrl = need(i).replace(/\/+$/, ''); i++; break;
      case '--sample-voices': o.sampleVoices = need(i).split(',').map((s) => s.trim()).filter(Boolean); i++; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  return o;
}

function posInt(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** "model:voice" → {model, voice}; the voice may itself contain colons (Azure ids). */
export function splitModelVoice(s) {
  const i = s.indexOf(':');
  if (i < 0) throw new Error(`expected model:voice, got ${s}`);
  // Model ids have exactly one '/', and may end in ':free'.
  let model = s.slice(0, i);
  let voice = s.slice(i + 1);
  if (voice.startsWith('free:')) { model += ':free'; voice = voice.slice(5); }
  return { model, voice };
}

/** Which format to ask the API for. Gemini TTS rejects mp3. */
export function requestFormat(model) {
  return /^google\/gemini.*tts/.test(model) ? 'wav' : 'mp3';
}

/** Does the model honour the `instructions` field (OpenRouter docs)? */
export function takesInstructions(model) {
  return /^google\/gemini.*tts/.test(model) || /^openai\/gpt-4o-mini-tts/.test(model) || /^fish-audio\//.test(model);
}

/** The JSON body for one line. */
export function requestBody(text, { model, voice }) {
  const body = { model, input: text, voice, response_format: requestFormat(model) };
  if (takesInstructions(model)) body.instructions = STYLE;
  return body;
}

/** Rough spoken length of a line at this unhurried pace (seconds). */
export function estimateSeconds(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const pauses = (text.match(/[.,;:?!]/g) || []).length;
  return words / 2.4 + pauses * 0.25 + 0.3;
}

/**
 * Estimated USD cost of voicing `lines` with this pricing ({prompt, completion} per unit,
 * as the models API lists it). See the header for how each model family bills.
 */
export function estimateCost(lines, pricing, model) {
  const p = Number(pricing?.prompt) || 0;
  const c = Number(pricing?.completion) || 0;
  let chars = 0, secs = 0;
  for (const l of lines) { chars += l.text.length; secs += estimateSeconds(l.text); }
  const instr = takesInstructions(model) ? STYLE.length : 0;
  if (c > 0 && p > 0) {
    // Token-priced (Gemini): input tokens ≈ chars / 4; audio output 25 tokens per second.
    const inTok = (chars + instr * lines.length) / 4;
    return { usd: inTok * p + secs * 25 * c, chars, secs, basis: 'tokens' };
  }
  if (c > 0) return { usd: secs * c, chars, secs, basis: 'seconds' };
  return { usd: chars * p, chars, secs, basis: 'characters' };
}

/** Parse a .env file's KEY=VALUE lines (quotes stripped). */
export function parseDotEnv(src) {
  const out = {};
  for (const raw of String(src).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

export function apiKey(env = process.env, repo = REPO) {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY.trim();
  if (env.WILDCALL_VOICE_NO_DOTENV) return ''; // tests: never pick up a real key
  try {
    return (parseDotEnv(fs.readFileSync(path.join(repo, '.env'), 'utf8')).OPENROUTER_API_KEY || '').trim();
  } catch { return ''; }
}

/** A dozen representative lines: one from each of these pool families, in this order. */
const SAMPLE_KINDS = ['welcome', 'call.new', 'observe.unknown', 'forage.', 'eat.', 'sp.*.fact', 'nest.', 'identify.certain',
  'idle.', 'time.dusk', 'photo.great', 'shelter', 'call.known', 'binoculars.empty'];

export function sampleLines(lines, n = 12) {
  const out = [];
  const used = new Set();
  for (const k of SAMPLE_KINDS) {
    if (out.length >= n) break;
    const match = (l) => (k === 'sp.*.fact' ? /^sp\..*\.fact$/.test(l.kind) : k.endsWith('.') ? l.kind.startsWith(k) : l.kind === k);
    const cands = lines.filter((l) => match(l) && !used.has(l.id));
    if (!cands.length) continue;
    // Deterministic, but not always the first: pick by id order.
    const pick = cands.slice().sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    used.add(pick.id);
    out.push(pick);
  }
  for (const l of lines) { if (out.length >= n) break; if (!used.has(l.id)) { used.add(l.id); out.push(l); } }
  return out;
}

/** WAV duration from its header (PCM), or 0. */
export function wavDuration(buf) {
  try {
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return 0;
    let off = 12, byteRate = 0;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      let size = buf.readUInt32LE(off + 4);
      if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
      if (id === 'data') {
        if (size === 0 || size === 0xffffffff || off + 8 + size > buf.length) size = buf.length - off - 8; // streamed WAV
        return byteRate ? size / byteRate : 0;
      }
      off += 8 + size + (size & 1);
    }
  } catch { /* fall through */ }
  return 0;
}

const round2 = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------------------
// I/O

function loadLines(o) {
  let raw;
  if (o.lines) raw = fs.readFileSync(o.lines, 'utf8');
  else raw = execFileSync('go', ['run', './tools/voice/lines', '-compact'], { cwd: REPO, maxBuffer: 64 << 20, encoding: 'utf8' });
  const lines = JSON.parse(raw);
  if (!Array.isArray(lines)) throw new Error('line list is not a JSON array');
  for (const l of lines) {
    if (typeof l?.text !== 'string' || !l.text) throw new Error('line without text');
    const id = lineId(l.text);
    if (l.id && l.id !== id) throw new Error(`line id ${l.id} does not match its text (${id})`);
    l.id = id;
    l.kind = l.kind || '';
  }
  return lines;
}

export function readManifest(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (m && typeof m.lines === 'object') return m;
  } catch { /* none yet */ }
  return null;
}

function writeManifest(dir, m) {
  const sorted = {};
  for (const k of Object.keys(m.lines).sort()) sorted[k] = m.lines[k];
  const out = { ...m, lines: sorted };
  const tmp = path.join(dir, `.manifest.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(out, null, 1) + '\n');
  fs.renameSync(tmp, path.join(dir, 'manifest.json'));
}

function haveTool(bin) {
  for (const p of [bin, `/opt/homebrew/bin/${bin}`, `/usr/local/bin/${bin}`, `/usr/bin/${bin}`]) {
    try { execFileSync(p, ['-version'], { stdio: 'ignore' }); return p; } catch { /* next */ }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, message, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; }
}

/** Fetch the speech for one line; resolves to {bytes: Buffer, type}. */
export async function synthesize(text, { model, voice, baseUrl, key, fetchImpl = fetch }) {
  const res = await fetchImpl(`${baseUrl}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Title': 'Wildcall voice generator' },
    body: JSON.stringify(requestBody(text, { model, voice })),
  });
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error?.message) msg += `: ${j.error.message}`;
    } catch { /* not JSON */ }
    const ra = Number(res.headers.get('retry-after'));
    throw new HttpError(res.status, msg, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0);
  }
  if (type === 'application/json') {
    const j = await res.json();
    if (!j?.url) throw new HttpError(500, 'JSON response without audio url');
    const r2 = await fetchImpl(j.url);
    if (!r2.ok) throw new HttpError(r2.status, `download HTTP ${r2.status}`);
    const t2 = (j.media_type || r2.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    return { bytes: Buffer.from(await r2.arrayBuffer()), type: t2 };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 64) throw new HttpError(502, `suspiciously short audio (${bytes.length} bytes)`);
  return { bytes, type };
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524, 529]);

async function withRetry(fn, retries, log) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status;
      const retryable = status === undefined || RETRYABLE.has(status); // undefined: network error
      if (!retryable || attempt >= retries) throw err;
      const wait = Math.max(err.retryAfter || 0, Math.min(60000, 1000 * 2 ** attempt)) + Math.random() * 400;
      log(`  retry ${attempt + 1}/${retries} in ${(wait / 1000).toFixed(1)} s (${err.message})`);
      await sleep(wait);
    }
  }
}

/** Space request starts at least 60/rpm seconds apart (shared across workers). */
function pacer(rpm) {
  const gap = 60000 / rpm;
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gap;
    if (at > now) await sleep(at - now);
  };
}

/** Convert raw API audio to the shipped clip. Returns {file, dur}. */
async function encode(raw, type, outBase, o, tools) {
  const ext = type.includes('wav') ? 'wav' : type.includes('pcm') ? 'pcm' : 'mp3';
  if (tools.ffmpeg) {
    const tmp = `${outBase}.src.${ext}`;
    fs.writeFileSync(tmp, raw);
    const fmt = o.format || 'opus';
    const file = `${outBase}.${fmt === 'mp3' ? 'mp3' : 'ogg'}`;
    const input = ext === 'pcm' ? ['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', tmp] : ['-i', tmp];
    // Trim leading/trailing silence, normalise loudness, leave a breath of tail.
    const af = [
      'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04',
      'areverse',
      'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.12',
      'areverse',
      'loudnorm=I=-18:TP=-2:LRA=9',
      'apad=pad_dur=0.08',
    ].join(',');
    const codec = fmt === 'mp3'
      ? ['-c:a', 'libmp3lame', '-b:a', '48k']
      : ['-c:a', 'libopus', '-b:a', '32k', '-application', 'audio', '-vbr', 'on'];
    try {
      await execFile(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...input, '-af', af, '-ac', '1', '-ar', '48000', ...codec, file]);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    let dur = 0;
    if (tools.ffprobe) {
      try {
        const { stdout } = await execFile(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
        dur = Number(stdout.trim()) || 0;
      } catch { /* keep 0 */ }
    }
    return { file: path.basename(file), dur: round2(dur) };
  }
  // No ffmpeg: ship what the API returned (pcm gets a WAV header so browsers can play it).
  let bytes = raw, e = ext;
  if (ext === 'pcm') { bytes = pcmToWav(raw, 24000); e = 'wav'; }
  const file = `${outBase}.${e}`;
  fs.writeFileSync(file, bytes);
  return { file: path.basename(file), dur: round2(e === 'wav' ? wavDuration(bytes) : 0) };
}

export function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function fetchPricing(o, model) {
  try {
    const res = await fetch(`${o.baseUrl}/models?output_modalities=speech`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const j = await res.json();
      const m = (j?.data || []).find((x) => x.id === model);
      if (m?.pricing) return { pricing: { prompt: Number(m.pricing.prompt), completion: Number(m.pricing.completion) }, source: 'models API' };
    }
  } catch { /* offline */ }
  if (KNOWN_PRICING[model]) return { pricing: KNOWN_PRICING[model], source: 'built-in table' };
  return { pricing: null, source: 'unknown' };
}

/** Run a pool of workers over items. */
async function pool(items, n, work) {
  let i = 0;
  const run = async () => { while (i < items.length) { const k = i++; await work(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

// ---------------------------------------------------------------------------------------
// Main

export async function main(argv = process.argv.slice(2), { log = console.log, err = console.error } = {}) {
  const o = parseArgs(argv);
  if (o.help) {
    log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    return 0;
  }
  let lines = loadLines(o);
  if (o.only) {
    const want = new Set(o.only);
    lines = lines.filter((l) => want.has(l.id));
    const missing = o.only.filter((id) => !lines.some((l) => l.id === id));
    if (missing.length) err(`warning: ${missing.length} --only id(s) not in the line list: ${missing.join(', ')}`);
  }

  if (o.dryRun) {
    const targets = o.sample ? (o.sampleVoices || SAMPLE_VOICES).map(splitModelVoice) : [{ model: o.model, voice: o.voice }];
    const set = o.sample ? sampleLines(lines) : lines;
    const existing = o.sample ? null : readManifest(o.out);
    const todo = o.sample ? set : set.filter((l) => o.force || !existing?.lines?.[l.id] || existing.model !== o.model || existing.voice !== o.voice);
    const capped = todo.slice(0, o.limit);
    let total = 0;
    log(`lines: ${lines.length} (${set.length} selected, ${capped.length} to voice${o.sample ? ` × ${targets.length} voices` : ''})`);
    for (const t of targets) {
      const { pricing, source } = await fetchPricing(o, t.model);
      const est = pricing ? estimateCost(capped, pricing, t.model) : null;
      const chars = capped.reduce((s, l) => s + l.text.length, 0);
      if (est) total += est.usd;
      log(`${t.model} / ${t.voice}: ${chars} characters, ~${Math.round(capped.reduce((s, l) => s + estimateSeconds(l.text), 0) / 60)} min of speech, `
        + (est ? `estimated cost $${est.usd.toFixed(2)} (billed by ${est.basis}; pricing from ${source})` : 'cost unknown (no pricing for this model)'));
    }
    if (targets.length > 1) log(`total estimated cost: $${total.toFixed(2)}`);
    return 0;
  }

  const key = apiKey();
  if (!key) {
    err('No OpenRouter API key: set OPENROUTER_API_KEY or put OPENROUTER_API_KEY=... in the repo-root .env (git-ignored).');
    return 2;
  }
  const tools = { ffmpeg: o.ffmpeg ? haveTool('ffmpeg') : null, ffprobe: o.ffmpeg ? haveTool('ffprobe') : null };
  if (!tools.ffmpeg) log('ffmpeg not found: clips are written as returned by the API (no trimming or loudness normalisation).');
  const pace = pacer(o.rpm);
  let fatal = null;
  const voiceOne = async (line, target, outBase) => {
    await pace();
    const audio = await withRetry(() => synthesize(line.text, { ...target, baseUrl: o.baseUrl, key }), o.retries, log);
    return encode(audio.bytes, audio.type || `audio/${requestFormat(target.model)}`, outBase, o, tools);
  };
  const isFatal = (e) => [401, 402, 403].includes(e?.status);

  if (o.sample) {
    const set = sampleLines(lines);
    const targets = (o.sampleVoices || SAMPLE_VOICES).map(splitModelVoice);
    fs.mkdirSync(o.samplesDir, { recursive: true });
    const index = [];
    for (const t of targets) {
      const slug = `${t.model}--${t.voice}`.replace(/[^A-Za-z0-9._-]+/g, '_');
      const dir = path.join(o.samplesDir, slug);
      fs.mkdirSync(dir, { recursive: true });
      log(`sampling ${t.model} / ${t.voice} → ${path.relative(REPO, dir)}`);
      const clips = [];
      await pool(set, o.concurrency, async (line, k) => {
        if (fatal) return;
        const base = path.join(dir, `${String(k + 1).padStart(2, '0')}-${line.id}`);
        try {
          const r = await voiceOne(line, t, base);
          clips[k] = { ...r, text: line.text, kind: line.kind };
        } catch (e) {
          if (isFatal(e)) fatal = e;
          err(`  ${line.id} failed: ${e.message}`);
        }
      });
      index.push({ model: t.model, voice: t.voice, dir: slug, clips: clips.filter(Boolean) });
      if (fatal) break;
    }
    fs.writeFileSync(path.join(o.samplesDir, 'index.json'), JSON.stringify(index, null, 1) + '\n');
    fs.writeFileSync(path.join(o.samplesDir, 'index.html'), samplesPage(index));
    if (fatal) { err(`stopped: ${fatal.message}`); return 1; }
    log(`samples written; open ${path.relative(REPO, path.join(o.samplesDir, 'index.html'))} to listen and compare.`);
    return 0;
  }

  // The full pack.
  fs.mkdirSync(o.out, { recursive: true });
  let manifest = readManifest(o.out);
  if (manifest && (manifest.model !== o.model || manifest.voice !== o.voice)) {
    log(`the existing pack is ${manifest.model} / ${manifest.voice}; starting a new manifest for ${o.model} / ${o.voice} (old clips are re-voiced as they come up)`);
    manifest = null;
  }
  manifest = manifest || { voice: o.voice, model: o.model, lines: {} };
  manifest.voice = o.voice;
  manifest.model = o.model;
  manifest.format = o.format || (tools.ffmpeg ? 'opus' : requestFormat(o.model));
  manifest.instructions = takesInstructions(o.model) ? STYLE : '';
  const exists = (id) => { const e = manifest.lines[id]; return e && fs.existsSync(path.join(o.out, e.file)); };
  const todo = lines.filter((l) => o.force || !exists(l.id)).slice(0, o.limit);
  log(`${lines.length} lines, ${lines.length - lines.filter((l) => !exists(l.id)).length} already voiced, voicing ${todo.length} now with ${o.model} / ${o.voice}`);
  let done = 0, failed = 0, sinceSave = 0;
  const save = () => { manifest.generated = new Date().toISOString(); writeManifest(o.out, manifest); sinceSave = 0; };
  const onSig = () => { try { save(); } catch { /* ignore */ } process.exit(130); };
  process.once('SIGINT', onSig);
  try {
    await pool(todo, o.concurrency, async (line) => {
      if (fatal) return;
      try {
        const old = manifest.lines[line.id];
        const r = await voiceOne(line, { model: o.model, voice: o.voice }, path.join(o.out, line.id));
        if (old && old.file !== r.file) fs.rmSync(path.join(o.out, old.file), { force: true });
        manifest.lines[line.id] = r;
        done++;
        if (++sinceSave >= 20) save();
        if (done % 25 === 0 || done === todo.length) log(`  ${done}/${todo.length}`);
      } catch (e) {
        failed++;
        if (isFatal(e)) fatal = e;
        err(`  ${line.id} failed: ${e.message}`);
      }
    });
  } finally {
    process.removeListener('SIGINT', onSig);
    save();
  }
  log(`done: ${done} voiced, ${failed} failed, ${Object.keys(manifest.lines).length} lines in ${path.relative(REPO, path.join(o.out, 'manifest.json')) || 'manifest.json'}`);
  if (fatal) { err(`stopped: ${fatal.message}`); return 1; }
  return failed ? 1 : 0;
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function samplesPage(index) {
  const rows = index.map((v) => `<section><h2>${esc(v.voice)} <small>${esc(v.model)}</small></h2>${
    v.clips.map((c) => `<p><audio controls preload="none" src="${esc(v.dir)}/${esc(c.file)}"></audio> ${esc(c.text)}</p>`).join('')}</section>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Wildcall narrator voice samples</title>
<style>body{font:15px/1.5 Georgia,serif;max-width:60rem;margin:2rem auto;padding:0 1rem;background:#f6f1e6;color:#2b2a26}
h2{margin-top:2rem;border-bottom:1px solid #c9bfa8}small{font-weight:normal;color:#7a705c}audio{vertical-align:middle;height:2rem}</style>
<h1>Narrator voice candidates</h1><p>Same lines in every voice. Pick one, then run the full pack with <code>--model</code> and <code>--voice</code>.</p>
${rows}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(e?.message || e); process.exitCode = 1; });
}
