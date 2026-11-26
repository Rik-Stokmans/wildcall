// Tests for generate.mjs against a local fake of the OpenRouter speech API (no network,
// no key). Run: node --test tools/voice/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lineId, parseArgs, splitModelVoice, requestBody, estimateCost, parseDotEnv, sampleLines,
  wavDuration, pcmToWav, STYLE, synthesize,
} from './generate.mjs';

const execFile = promisify(execFileCb);
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'generate.mjs');
const KEY = 'sk-or-test-DO-NOT-PRINT-5f2a';

function hasFfmpeg() {
  for (const p of ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    try { execFileSync(p, ['-version'], { stdio: 'ignore' }); return true; } catch { /* next */ }
  }
  return false;
}

/** A 24 kHz mono 16-bit WAV: 0.3 s silence, a 0.6 s tone, 0.4 s silence. */
function toneWav() {
  const rate = 24000;
  const n = Math.round(rate * 1.3);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const v = t > 0.3 && t < 0.9 ? Math.sin(2 * Math.PI * 220 * t) * 0.4 : 0;
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return pcmToWav(pcm, rate);
}

// ---- the fake server ----
let server, base;
const log = { requests: [], fail429: new Set(), urlDelivery: new Set(), fail400: new Set() };

before(async () => {
  const wav = toneWav();
  server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'google/gemini-3.8-flash-tts', pricing: { prompt: '0.0000005', completion: '0.000009' } },
        { id: 'perchar/tts', pricing: { prompt: '0.00001', completion: '0' } }] }));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/files/')) {
      res.writeHead(200, { 'content-type': 'audio/wav' });
      res.end(wav);
      return;
    }
    if (req.method !== 'POST' || req.url !== '/api/v1/audio/speech') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 404, message: 'not found' } }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      log.requests.push({ auth: req.headers.authorization, body: j });
      if (req.headers.authorization !== `Bearer ${KEY}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 401, message: 'bad key' } }));
        return;
      }
      const id = lineId(j.input);
      if (log.fail400.has(id)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 400, message: 'unsupported' } }));
        return;
      }
      if (log.fail429.has(id)) {
        log.fail429.delete(id);
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        res.end(JSON.stringify({ error: { code: 429, message: 'slow down' } }));
        return;
      }
      if (j.response_format !== 'wav') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 400, message: 'gemini returns pcm or wav' } }));
        return;
      }
      if (log.urlDelivery.has(id)) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ url: `${base.replace('/api/v1', '')}/files/${id}.wav`, expires_at: 'later', media_type: 'audio/wav' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'audio/wav', 'x-generation-id': 'gen-1' });
      res.end(wav);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(() => server?.close());

const LINES = [
  { text: 'Mm. Blackberries. One for the pot, one for me.', kind: 'forage.bramble' },
  { text: 'Well, here we are. Let us listen first.', kind: 'welcome' },
  { text: 'A rippling trill. I don\'t believe we\'ve been introduced.', kind: 'call.new' },
  { text: 'Robins sing almost all year.', kind: 'sp.european_robin.fact' },
  { text: 'A neat hole in the trunk. Somebody\'s front door.', kind: 'nest.cavity' },
  { text: 'Hm. A lovely view of a branch.', kind: 'binoculars.empty' },
].map((l) => ({ ...l, id: lineId(l.text) }));

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'wc-voice-')); }

async function run(args, { key = KEY, cwd } = {}) {
  const dir = cwd || tmpDir();
  const linesFile = path.join(dir, 'lines.json');
  if (!fs.existsSync(linesFile)) fs.writeFileSync(linesFile, JSON.stringify(LINES));
  const env = { ...process.env, OPENROUTER_API_KEY: key, OPENROUTER_BASE_URL: '', WILDCALL_VOICE_NO_DOTENV: '1' };
  try {
    const { stdout, stderr } = await execFile(process.execPath, [SCRIPT, '--lines', linesFile, '--base-url', base, '--rpm', '6000', '--retries', '2', ...args], { env, cwd: dir });
    return { code: 0, stdout, stderr, dir };
  } catch (e) {
    return { code: e.code, stdout: e.stdout || '', stderr: e.stderr || '', dir };
  }
}

// ---- pure helpers ----

test('lineId is the first 16 hex chars of SHA-256 (matches Go narrator.LineID)', () => {
  // Same vector as internal/narrator TestLineIDFormat input; value computed independently.
  const id = lineId('Mm. Blackberries. One for the pot, one for me.');
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(id, execFileSync('shasum', ['-a', '256'], { input: 'Mm. Blackberries. One for the pot, one for me.' }).toString().slice(0, 16));
});

test('parseArgs', () => {
  const o = parseArgs(['--dry-run', '--limit', '5', '--only', 'a,b', '--voice', 'Charon', '--format', 'mp3']);
  assert.equal(o.dryRun, true);
  assert.equal(o.limit, 5);
  assert.deepEqual(o.only, ['a', 'b']);
  assert.equal(o.voice, 'Charon');
  assert.throws(() => parseArgs(['--limit', '0']));
  assert.throws(() => parseArgs(['--bogus']));
  assert.throws(() => parseArgs(['--format', 'flac']));
});

test('splitModelVoice keeps colons inside voice ids', () => {
  assert.deepEqual(splitModelVoice('microsoft/mai-voice-2.1:en-GB-Harry:MAI-Voice-2.1'), { model: 'microsoft/mai-voice-2.1', voice: 'en-GB-Harry:MAI-Voice-2.1' });
  assert.deepEqual(splitModelVoice('heygen/heygen-voice-1-turbo:free:bram'), { model: 'heygen/heygen-voice-1-turbo:free', voice: 'bram' });
});

test('requestBody: Gemini gets wav and the style instruction; others mp3 without it', () => {
  const g = requestBody('Hello.', { model: 'google/gemini-3.8-flash-tts', voice: 'Algenib' });
  assert.deepEqual(g, { model: 'google/gemini-3.8-flash-tts', input: 'Hello.', voice: 'Algenib', response_format: 'wav', instructions: STYLE });
  const m = requestBody('Hello.', { model: 'mistralai/voxtral-mini-tts-3-0', voice: 'gb_oliver_neutral' });
  assert.equal(m.response_format, 'mp3');
  assert.equal(m.instructions, undefined);
});

test('the style instruction directs an original voice and names no one', () => {
  assert.match(STYLE, /original/i);
  assert.match(STYLE, /British/);
  assert.doesNotMatch(STYLE, /\b(like|as|in the style of|impression of)\s+[A-Z][a-z]+ [A-Z]/);
});

test('estimateCost per billing basis', () => {
  const lines = [{ text: 'a'.repeat(100) }, { text: 'b'.repeat(50) }];
  const pc = estimateCost(lines, { prompt: 0.00001, completion: 0 }, 'x/y');
  assert.equal(pc.basis, 'characters');
  assert.ok(Math.abs(pc.usd - 150 * 0.00001) < 1e-12);
  const tok = estimateCost(lines, { prompt: 0.0000005, completion: 0.000009 }, 'google/gemini-3.8-flash-tts');
  assert.equal(tok.basis, 'tokens');
  assert.ok(tok.usd > 0);
  assert.equal(estimateCost(lines, { prompt: 0, completion: 0.0025 }, 'b/seed').basis, 'seconds');
});

test('parseDotEnv', () => {
  const e = parseDotEnv('# c\nOPENROUTER_API_KEY="sk-1"\nexport OTHER=two # note\nBAD LINE\n');
  assert.equal(e.OPENROUTER_API_KEY, 'sk-1');
  assert.equal(e.OTHER, 'two');
});

test('sampleLines picks a dozen varied, distinct lines deterministically', () => {
  const many = [];
  for (const k of ['welcome', 'call.new', 'observe.unknown', 'forage.bramble', 'eat.mint_tea', 'sp.robin.fact', 'nest.reed',
    'identify.certain', 'idle.any', 'time.dusk', 'photo.great', 'shelter', 'call.known', 'binoculars.empty', 'flush']) {
    for (let i = 0; i < 3; i++) { const text = `${k} line ${i}.`; many.push({ id: lineId(text), text, kind: k }); }
  }
  const s = sampleLines(many);
  assert.equal(s.length, 12);
  assert.equal(new Set(s.map((l) => l.id)).size, 12);
  assert.equal(new Set(s.map((l) => l.kind)).size, 12);
  assert.deepEqual(sampleLines(many), s);
});

test('wavDuration reads the header', () => {
  assert.ok(Math.abs(wavDuration(toneWav()) - 1.3) < 0.001);
  assert.equal(wavDuration(Buffer.from('nope')), 0);
});

test('synthesize: raw stream, JSON url delivery, and error JSON', async () => {
  const r = await synthesize(LINES[0].text, { model: 'google/gemini-3.8-flash-tts', voice: 'Algenib', baseUrl: base, key: KEY });
  assert.equal(r.type, 'audio/wav');
  assert.ok(r.bytes.length > 1000);
  log.urlDelivery.add(LINES[1].id);
  const u = await synthesize(LINES[1].text, { model: 'google/gemini-3.8-flash-tts', voice: 'Algenib', baseUrl: base, key: KEY });
  assert.equal(u.type, 'audio/wav');
  assert.ok(u.bytes.length > 1000);
  log.urlDelivery.delete(LINES[1].id);
  await assert.rejects(synthesize('x', { model: 'google/gemini-3.8-flash-tts', voice: 'A', baseUrl: base, key: 'wrong' }), /HTTP 401: bad key/);
});

// ---- the CLI end to end ----

test('--dry-run prints count, characters and estimated cost, needs no key', async () => {
  const r = await run(['--dry-run'], { key: '' });
  assert.equal(r.code, 0, r.stderr);
  const chars = LINES.reduce((s, l) => s + l.text.length, 0);
  assert.match(r.stdout, new RegExp(`lines: ${LINES.length}`));
  assert.match(r.stdout, new RegExp(`${chars} characters`));
  assert.match(r.stdout, /estimated cost \$\d+\.\d\d/);
});

test('no key: clear message, exit 2, no request made', async () => {
  const before = log.requests.length;
  const dir = tmpDir();
  const r = await run([], { key: '', cwd: dir });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /OPENROUTER_API_KEY/);
  assert.equal(log.requests.length, before);
});

for (const ffmpeg of [false, true]) {
  test(`full run, retry, resume, limit, only (${ffmpeg ? 'ffmpeg → Ogg/Opus' : 'no ffmpeg → wav'})`, { skip: ffmpeg && !hasFfmpeg() }, async () => {
    const dir = tmpDir();
    const out = path.join(dir, 'voice');
    const flags = ['--out', out, ...(ffmpeg ? [] : ['--no-ffmpeg'])];
    const n0 = log.requests.length;
    log.fail429.add(LINES[2].id); // first attempt rate-limited
    // --limit 3: three new clips.
    let r = await run([...flags, '--limit', '3'], { cwd: dir });
    assert.equal(r.code, 0, r.stderr);
    let m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(Object.keys(m.lines).length, 3);
    assert.equal(m.model, 'google/gemini-3.8-flash-tts');
    assert.equal(m.voice, 'Algenib');
    assert.equal(log.requests.length - n0, 4, 'three lines plus one retry');
    // Every request carried the style instruction and the key only in the header.
    for (const q of log.requests.slice(n0)) {
      assert.equal(q.body.instructions, STYLE);
      assert.equal(q.body.response_format, 'wav');
      assert.ok(!JSON.stringify(q.body).includes(KEY));
    }
    // Resume: the rest only.
    const n1 = log.requests.length;
    r = await run(flags, { cwd: dir });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(log.requests.length - n1, LINES.length - 3);
    m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(Object.keys(m.lines).sort(), LINES.map((l) => l.id).sort());
    for (const [id, e] of Object.entries(m.lines)) {
      assert.ok(fs.existsSync(path.join(out, e.file)), e.file);
      assert.ok(e.file.startsWith(id + '.'));
      assert.ok(e.file.endsWith(ffmpeg ? '.ogg' : '.wav'));
      assert.ok(e.dur > 0, `duration for ${id}`);
      if (ffmpeg) assert.ok(e.dur < 1.2, `silence trimmed: ${e.dur}`); // source is 1.3 s with 0.7 s of silence
    }
    // Nothing left: no requests.
    const n2 = log.requests.length;
    r = await run(flags, { cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(log.requests.length - n2, 0);
    // A deleted clip is re-voiced on the next run.
    fs.rmSync(path.join(out, m.lines[LINES[0].id].file));
    r = await run(flags, { cwd: dir });
    assert.equal(log.requests.length - n2, 1);
    // --only with --force re-voices exactly those ids.
    const n3 = log.requests.length;
    r = await run([...flags, '--force', '--only', `${LINES[4].id},${LINES[5].id},ffffffffffffffff`], { cwd: dir });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(log.requests.length - n3, 2);
    assert.match(r.stderr, /ffffffffffffffff/);
    // The key never appears in any output.
    for (const s of [r.stdout, r.stderr]) assert.ok(!s.includes(KEY));
  });
}

test('a failing line is reported and the rest still voiced; manifest saved', async () => {
  const dir = tmpDir();
  const out = path.join(dir, 'voice');
  log.fail400.add(LINES[3].id);
  const r = await run(['--out', out, '--no-ffmpeg'], { cwd: dir });
  log.fail400.delete(LINES[3].id);
  assert.equal(r.code, 1);
  assert.match(r.stderr, new RegExp(`${LINES[3].id} failed: HTTP 400`));
  const m = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(Object.keys(m.lines).length, LINES.length - 1);
});

test('wrong key stops the run early with exit 1', async () => {
  const dir = tmpDir();
  const r = await run(['--out', path.join(dir, 'voice'), '--no-ffmpeg', '--concurrency', '1'], { key: 'sk-wrong-zz', cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /stopped: HTTP 401/);
  assert.ok(!r.stdout.includes('sk-wrong-zz') && !r.stderr.includes('sk-wrong-zz'));
});

test('--sample writes a dozen lines per candidate voice and an index page', async () => {
  const dir = tmpDir();
  const samples = path.join(dir, 'samples');
  const r = await run(['--sample', '--samples-dir', samples, '--no-ffmpeg',
    '--sample-voices', 'google/gemini-3.8-flash-tts:Algenib,google/gemini-3.8-flash-tts:Charon'], { cwd: dir });
  assert.equal(r.code, 0, r.stderr);
  const index = JSON.parse(fs.readFileSync(path.join(samples, 'index.json'), 'utf8'));
  assert.equal(index.length, 2);
  for (const v of index) {
    assert.equal(v.clips.length, LINES.length); // fewer than twelve lines available here
    for (const c of v.clips) assert.ok(fs.existsSync(path.join(samples, v.dir, c.file)));
  }
  assert.match(fs.readFileSync(path.join(samples, 'index.html'), 'utf8'), /<audio controls/);
});
