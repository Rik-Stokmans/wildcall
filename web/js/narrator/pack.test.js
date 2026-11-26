import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lineId, sha256HexSync, createVoicePack, createNarratorVoice } from './pack.js';
import { createController } from './controller.js';

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const goId = (t) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 16);

const LINE = 'Mm. Blackberries. One for the pot, one for me.';
const OTHER = 'A line with no clip.';

test('lineId matches the Go/Node id (crypto.subtle) and the JS fallback agrees', async () => {
  for (const t of [LINE, '', 'Ünïcödé, naïve café — “quotes”.', 'x'.repeat(200)]) {
    assert.equal(await lineId(t), goId(t));
    assert.equal(sha256HexSync(new TextEncoder().encode(t)).slice(0, 16), goId(t));
  }
});

function fakeFetch(files) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    if (!(url in files)) return { ok: false, status: 404, json: async () => { throw new Error('404'); }, arrayBuffer: async () => new ArrayBuffer(0) };
    const v = files[url];
    return { ok: true, status: 200, json: async () => JSON.parse(v), arrayBuffer: async () => new TextEncoder().encode(String(v)).buffer };
  };
  f.calls = calls;
  return f;
}

function manifestFor(lines) {
  const m = { voice: 'Algenib', model: 'google/gemini-3.8-flash-tts', lines: {} };
  for (const t of lines) m.lines[goId(t)] = { file: `${goId(t)}.ogg`, dur: 2.5 };
  return m;
}

/** A minimal AudioContext: decodes anything, sources end when the test says so. */
function fakeAudioContext({ failDecode = false } = {}) {
  const ac = {
    state: 'running',
    destination: { name: 'destination' },
    sources: [],
    gains: [],
    async decodeAudioData(ab) { if (failDecode) throw new Error('bad data'); return { length: ab.byteLength }; },
    createBufferSource() {
      const s = { started: false, stopped: false, connect(n) { this.out = n; }, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; }, end() { this.onended?.(); } };
      ac.sources.push(s);
      return s;
    },
    createGain() {
      const g = { gain: { value: 1 }, connect(n) { this.out = n; }, disconnect() {} };
      ac.gains.push(g);
      return g;
    },
  };
  return ac;
}

function fakeSpeech() {
  const log = [];
  return {
    log,
    available: true,
    voices: () => [{ name: 'Daniel', lang: 'en-GB' }],
    onVoicesChanged: () => () => {},
    speak(text, opts) {
      let resolve;
      const done = new Promise((r) => { resolve = r; });
      const e = { text, opts, cancelled: false, end: () => resolve({ ok: true, reason: 'end' }) };
      log.push(e);
      return { done, cancel() { e.cancelled = true; resolve({ ok: false, reason: 'cancelled' }); } };
    },
  };
}

test('no manifest: not loaded, info null, everything falls back to speech', async () => {
  const pack = createVoicePack({ fetchImpl: fakeFetch({}) });
  assert.equal(await pack.load(), false);
  assert.equal(pack.info, null);
  assert.equal(await pack.lookup(LINE), null);
  const speech = fakeSpeech();
  const v = createNarratorVoice(speech, pack);
  const h = v.speak(LINE, { volume: 0.5 });
  await flush();
  assert.equal(speech.log.length, 1);
  assert.equal(speech.log[0].opts.volume, 0.5);
  speech.log[0].end();
  assert.deepEqual(await h.done, { ok: true, reason: 'end' });
});

test('manifest loads once; info reports voice, model and line count', async () => {
  const fetchImpl = fakeFetch({ 'voice/manifest.json': JSON.stringify(manifestFor([LINE])) });
  const pack = createVoicePack({ fetchImpl });
  assert.equal(await pack.load(), true);
  assert.equal(await pack.load(), true);
  assert.equal(fetchImpl.calls.filter((u) => u.endsWith('manifest.json')).length, 1);
  assert.deepEqual(pack.info, { voice: 'Algenib', model: 'google/gemini-3.8-flash-tts', lines: 1 });
  assert.deepEqual(await pack.lookup(LINE), { file: `${goId(LINE)}.ogg`, dur: 2.5 });
  assert.equal(await pack.lookup(OTHER), null);
});

test('an empty or broken manifest counts as no pack', async () => {
  for (const body of ['{"lines": {}}', 'not json', '[]']) {
    const pack = createVoicePack({ fetchImpl: fakeFetch({ 'voice/manifest.json': body }) });
    assert.equal(await pack.load(), false, body);
  }
});

test('a line with a clip plays through the game AudioContext at the given volume', async () => {
  const ac = fakeAudioContext();
  const files = { 'voice/manifest.json': JSON.stringify(manifestFor([LINE])), [`voice/${goId(LINE)}.ogg`]: 'OggS…' };
  const pack = createVoicePack({ fetchImpl: fakeFetch(files), getAudio: () => ({ context: ac }) });
  await pack.load();
  const speech = fakeSpeech();
  const v = createNarratorVoice(speech, pack);
  const h = v.speak(LINE, { volume: 0.72, expect: 3 });
  await flush();
  assert.equal(speech.log.length, 0, 'no speech synthesis for a line with a clip');
  assert.equal(h.source, 'pack');
  assert.equal(ac.sources.length, 1);
  assert.ok(ac.sources[0].started);
  assert.equal(ac.gains[0].gain.value, 0.72);
  assert.equal(ac.gains[0].out, ac.destination);
  ac.sources[0].end();
  assert.deepEqual(await h.done, { ok: true, reason: 'end' });
  // A line without a clip uses speech synthesis.
  const h2 = v.speak(OTHER, { volume: 0.72 });
  await flush();
  assert.equal(speech.log.length, 1);
  assert.equal(h2.source, 'speech');
});

test('audio engine voiceOut node is used when present', async () => {
  const ac = fakeAudioContext();
  const out = { name: 'voiceOut' };
  const files = { 'voice/manifest.json': JSON.stringify(manifestFor([LINE])), [`voice/${goId(LINE)}.ogg`]: 'x' };
  const pack = createVoicePack({ fetchImpl: fakeFetch(files), getAudio: () => ({ context: ac, voiceOut: out }) });
  await pack.load();
  createNarratorVoice(fakeSpeech(), pack).speak(LINE, { volume: 1 });
  await flush();
  assert.equal(ac.gains[0].out, out);
});

test('cancel stops the clip', async () => {
  const ac = fakeAudioContext();
  const files = { 'voice/manifest.json': JSON.stringify(manifestFor([LINE])), [`voice/${goId(LINE)}.ogg`]: 'x' };
  const pack = createVoicePack({ fetchImpl: fakeFetch(files), getAudio: () => ({ context: ac }) });
  await pack.load();
  const h = createNarratorVoice(fakeSpeech(), pack).speak(LINE, { volume: 1 });
  await flush();
  h.cancel();
  assert.ok(ac.sources[0].stopped);
  assert.deepEqual(await h.done, { ok: false, reason: 'cancelled' });
});

test('cancel before the clip starts: nothing plays', async () => {
  const ac = fakeAudioContext();
  const files = { 'voice/manifest.json': JSON.stringify(manifestFor([LINE])), [`voice/${goId(LINE)}.ogg`]: 'x' };
  const pack = createVoicePack({ fetchImpl: fakeFetch(files), getAudio: () => ({ context: ac }) });
  await pack.load();
  const speech = fakeSpeech();
  const h = createNarratorVoice(speech, pack).speak(LINE, { volume: 1 });
  h.cancel();
  await flush();
  assert.ok(!ac.sources.some((s) => s.started && !s.stopped));
  assert.equal(speech.log.length, 0);
});

test('a clip that cannot be decoded or fetched falls back to speech for that line', async () => {
  for (const [label, ac, files] of [
    ['decode', fakeAudioContext({ failDecode: true }), { 'voice/manifest.json': JSON.stringify(manifestFor([LINE])), [`voice/${goId(LINE)}.ogg`]: 'x' }],
    ['404', fakeAudioContext(), { 'voice/manifest.json': JSON.stringify(manifestFor([LINE])) }],
  ]) {
    const pack = createVoicePack({ fetchImpl: fakeFetch(files), getAudio: () => ({ context: ac }) });
    await pack.load();
    const speech = fakeSpeech();
    createNarratorVoice(speech, pack).speak(LINE, { volume: 1 });
    await flush();
    assert.equal(speech.log.length, 1, label);
    assert.equal(speech.log[0].text, LINE);
  }
});

test('without a running AudioContext, an HTMLAudioElement plays the clip', async () => {
  const made = [];
  class FakeAudio {
    constructor(src) { this.src = src; this.paused = true; made.push(this); }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
    removeAttribute() {}
    load() {}
  }
  const files = { 'voice/manifest.json': JSON.stringify(manifestFor([LINE])) };
  const pack = createVoicePack({ fetchImpl: fakeFetch(files), getAudio: () => ({ context: { state: 'suspended' } }), win: { Audio: FakeAudio } });
  await pack.load();
  const h = createNarratorVoice(fakeSpeech(), pack).speak(LINE, { volume: 0.4 });
  await flush();
  assert.equal(made.length, 1);
  assert.equal(made[0].src, `voice/${goId(LINE)}.ogg`);
  assert.equal(made[0].volume, 0.4);
  made[0].onended();
  assert.deepEqual(await h.done, { ok: true, reason: 'end' });
});

test('manifest entries cannot point outside the voice folder', async () => {
  const m = { voice: 'v', model: 'm', lines: { [goId(LINE)]: { file: '../../secret.ogg', dur: 1 } } };
  const pack = createVoicePack({ fetchImpl: fakeFetch({ 'voice/manifest.json': JSON.stringify(m) }) });
  await pack.load();
  assert.equal(await pack.lookup(LINE), null);
});

test('controller + voice pack: caption shown, clip played, caption cleared after it ends', async () => {
  const ac = fakeAudioContext();
  const files = { 'voice/manifest.json': JSON.stringify(manifestFor([LINE])), [`voice/${goId(LINE)}.ogg`]: 'x' };
  const pack = createVoicePack({ fetchImpl: fakeFetch(files), getAudio: () => ({ context: ac }) });
  await pack.load();
  const system = { ...fakeSpeech(), available: false }; // no system voices at all
  const speech = createNarratorVoice(system, pack);
  const shown = [];
  const caption = { visible: false, show(t) { shown.push(t); this.visible = true; }, hide() { this.visible = false; } };
  const settings = { volMaster: 0.5, volNarrator: 0.8, narrator: 'normal' };
  const c = createController({ speech, caption, settings: () => settings, blocked: () => ({}) });
  c.receive({ id: 1, text: LINE, kind: 'activity', priority: 1, ttl: 10 });
  await flush();
  assert.deepEqual(shown, [LINE]);
  assert.equal(ac.sources.length, 1);
  assert.ok(Math.abs(ac.gains.at(-1).gain.value - 0.4) < 1e-9, 'volume = volNarrator × volMaster');
  ac.sources[0].end();
  await flush();
  c.tick(1);
  assert.equal(caption.visible, false);
  assert.equal(c.current, null);
});
