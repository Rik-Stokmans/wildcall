// The sample path through the whole audio module against the strict fake Web Audio API:
// a recording plays through the same spatial voice as a synthesised call, falls back to
// synthesis when it cannot load, and journal playback reports its end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext } from './fakeaudio.js';
import { createBus } from '../core/bus.js';

const listeners = {};
globalThis.window = {
  addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
  removeEventListener() {},
};
globalThis.AudioContext = FakeAudioContext;

const requested = [];
const files = {
  'birdsong/test_robin/0-song-1.ogg': 500, // 5 s
  'birdsong/test_robin/0-song-2.ogg': 300, // 3 s
  'birdsong/test_robin/1-call-1.ogg': 300,
  'birdsong/test_robin/2-alarm-1.ogg': 'missing',
};
globalThis.fetch = async (url) => {
  requested.push(url);
  if (url === 'birdsong/manifest.json') {
    return { ok: true, json: async () => ({
      version: 1,
      species: { test_robin: {
        0: [{ file: 'test_robin/0-song-1.ogg', dur: 5 }, { file: 'test_robin/0-song-2.ogg', dur: 3 }],
        1: [{ file: 'test_robin/1-call-1.ogg', dur: 3 }],
        2: [{ file: 'test_robin/2-alarm-1.ogg', dur: 3 }],
      } },
    }) };
  }
  const n = files[url];
  if (typeof n !== 'number') return { ok: false, status: 404 };
  return { ok: true, arrayBuffer: async () => new ArrayBuffer(n) };
};

const n = (dur, gap, f0, f1, wave) => ({ dur, gap, f0, f1, wave, rate: 0, depth: 0, amp: 0.8 });
const species = [{
  id: 'test_robin', index: 0, calls: [
    { kind: 'song', loud: 0.45, repeat: [2, 3], gap: 1, pitch: 'high', pattern: 'melodic', notes: [n(0.5, 0.1, 4000, 5000, 'whistle'), n(0.3, 0.1, 3000, 3300, 'sine')] },
    { kind: 'call', loud: 0.2, repeat: [1, 1], gap: 1, pitch: 'high', pattern: 'single', notes: [n(0.05, 0.1, 5000, 4000, 'whistle')] },
    { kind: 'alarm', loud: 0.3, repeat: [1, 1], gap: 1, pitch: 'high', pattern: 'single', notes: [n(0.2, 0.1, 5000, 4000, 'whistle')] },
    { kind: 'call', loud: 0.3, repeat: [1, 1], gap: 1, pitch: 'high', pattern: 'single', notes: [n(0.2, 0.1, 5000, 4000, 'whistle')] },
  ],
}];

const bus = createBus();
const state = { mode: 'play', settings: {}, species, env: { time: 12, season: 1, wind: 0.3, rain: 0, light: 1 }, trails: [], profile: { stats: { hearRange: 1, focusBonus: 0.3, noiseReduce: 0 } }, welcome: { seed: 7 } };
const birds = new Map([[1, { pos: { x: 8, y: 3, z: -4 } }]]);
const ctx = {
  bus, state,
  get stats() { return state.profile.stats; },
  camera: { updateMatrixWorld() {}, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1] } },
  birds: { get: (id) => birds.get(id) },
  world: { isLoaded: () => true, regionAt: () => 0, canopyAt: () => 0.4, waterDepthAt: () => 0, surfaceAt: () => 'grass' },
  player: { move: 'still', speed: 0 },
  tools: { active: 'none', raised: false, recording: false },
};
const { default: audio } = await import('./index.js');
audio.init(ctx);
await ctx.audio.resume();
const ac = ctx.audio.context;

const frames = (count, dt = 1 / 60) => { for (let i = 0; i < count; i++) { ac.advance(dt); audio.lateUpdate(dt, ctx); } };
const settle = () => new Promise((r) => setTimeout(r, 15));

/** Buffer sources created from now on that play a recording (not the shared noise). */
function watchSources() {
  const made = [];
  const orig = ac.createBufferSource.bind(ac);
  ac.createBufferSource = () => { const s = orig(); made.push(s); return s; };
  return { made, restore: () => { ac.createBufferSource = orig; } };
}
const isRecording = (s) => !s.loop && s.startArgs && s.startArgs[1] !== undefined; // the shared noise loops

test('the manifest is requested once the engine starts', () => {
  assert.ok(requested.includes('birdsong/manifest.json'));
});

test('a net:call plays a recording through the spatial voice, lazily decoded', async () => {
  const w = watchSources();
  ctx.bus.emit('net:call', { bird: 1, sp: 0, call: 0, reps: 2, x: 8, y: 3, z: -4, occ: 0.3, seed: 11 });
  assert.equal(ctx.audio.voices, 0, 'the bout waits for the decode instead of blocking');
  await settle();
  frames(3);
  assert.equal(ctx.audio.voices, 1);
  const rec = w.made.filter(isRecording);
  assert.ok(rec.length >= 1, 'recording sources started with an offset/length');
  for (const s of rec) {
    assert.ok(s.buffer.duration >= 3);
    assert.ok(Math.abs(s.playbackRate.value - 1) <= 0.02 + 1e-9, 'pitch variation <= 2%');
    assert.ok(s.startArgs[2] > 0 && s.startArgs[2] <= s.buffer.duration + 1e-9);
  }
  w.restore();
  const spec = ctx.audio.getSpectrum();
  assert.equal(spec.length, 512);
  frames(60 * 12);
  assert.equal(ctx.audio.voices, 0, 'the bout ends and releases its nodes');
});

test('rotation across calls: the second bout uses the other recording', async () => {
  const w = watchSources();
  const urls = [];
  const before = requested.length;
  for (const seed of [21, 22]) {
    ctx.bus.emit('net:call', { bird: 1, sp: 0, call: 0, reps: 2, x: 8, y: 3, z: -4, occ: 0, seed });
    await settle(); frames(2);
    urls.push(w.made.filter(isRecording).map((s) => s.buffer.duration).join(','));
    w.made.length = 0;
  }
  w.restore();
  assert.notEqual(urls[0], urls[1], 'two different takes were used');
  assert.ok(requested.length - before <= 1, 'decoded recordings are cached, not fetched again');
  frames(60 * 12);
});

test('a call with no recording keeps its synthesised voice', async () => {
  const w = watchSources();
  state.species = [{ ...species[0], id: 'no_such_bird' }];
  ctx.bus.emit('net:call', { bird: 1, sp: 0, call: 0, reps: 2, x: 8, y: 3, z: -4, occ: 0, seed: 3 });
  frames(2);
  assert.equal(ctx.audio.voices, 1, 'synthesis starts at once');
  assert.equal(w.made.filter(isRecording).length, 0);
  w.restore();
  state.species = species;
  frames(60 * 12);
});

test('a recording that cannot load falls back to synthesis', async () => {
  ctx.bus.emit('net:call', { bird: 1, sp: 0, call: 2, reps: 1, x: 8, y: 3, z: -4, occ: 0, seed: 4 });
  await settle(); frames(2);
  assert.equal(ctx.audio.voices, 1);
  frames(60 * 6);
  // And from then on that file is not asked for again.
  const before = requested.length;
  ctx.bus.emit('net:call', { bird: 1, sp: 0, call: 2, reps: 1, x: 8, y: 3, z: -4, occ: 0, seed: 5 });
  await settle(); frames(2);
  assert.equal(requested.length, before);
  frames(60 * 6);
});

test('playCall uses the recording, reports its duration and calls onEnded once', async () => {
  let ended = 0;
  const h = ctx.audio.playCall(0, 1, { onEnded: () => ended++ });
  assert.equal(h.duration, 3, 'duration is known at once from the manifest');
  assert.equal(h.playing, true);
  await settle(); frames(5);
  assert.equal(h.playing, true);
  assert.equal(ended, 0);
  frames(60 * 5);
  assert.equal(h.playing, false);
  assert.equal(ended, 1);
  h.stop();
  assert.equal(ended, 1, 'onEnded never fires twice');
});

test('playCall stop() ends it at once, also before the recording has loaded', async () => {
  let ended = 0;
  const h = ctx.audio.playCall(0, 0, { onEnded: () => ended++, seed: 99 });
  h.stop();
  assert.equal(ended, 1);
  assert.equal(h.playing, false);
  await settle(); frames(10);
  assert.equal(ctx.audio.voices, 0);
  const h2 = ctx.audio.playCall(0, 0, { onEnded: () => ended++, seed: 3 });
  await settle(); frames(10);
  h2.stop(); frames(10);
  assert.equal(ended, 2);
});

test('playCall with reps fits the recording to that bout; synthesis and unknown calls still report their end', async () => {
  const h = ctx.audio.playCall(0, 0, { reps: 1, seed: 8 });
  assert.ok(h.duration > 0 && h.duration < 3, `bout length ${h.duration}`);
  h.stop();
  let ended = 0;
  state.species = [{ ...species[0], id: 'no_such_bird' }];
  const s = ctx.audio.playCall(0, 0, { onEnded: () => ended++, seed: 2 });
  assert.ok(s.duration > 0);
  frames(60 * 12);
  assert.equal(ended, 1);
  state.species = species;
  const none = ctx.audio.playCall(9, 9, { onEnded: () => ended++ });
  await settle();
  assert.equal(none.playing, false);
  assert.equal(ended, 2);
});
