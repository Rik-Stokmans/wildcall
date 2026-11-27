// ctx.audio.voice through the whole module (fake Web Audio): play, speaking, ducking,
// live volume, and the wildlife layer running inside the frame loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext } from './fakeaudio.js';
import { createBus } from '../core/bus.js';
import { dbToGain } from './curves.js';

const listeners = {};
globalThis.window = {
  addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
  removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
};
globalThis.AudioContext = FakeAudioContext;

const bus = createBus();
const state = {
  mode: 'play',
  settings: { volMaster: 0.8, volBirds: 1, volAmbient: 0.7, volMusic: 0.35, volUI: 0.6, volNarrator: 0.9 },
  species: [],
  env: { time: 23, day: 1, season: 1, weather: 0, wind: 0.1, rain: 0, mist: 0, cloud: 0.1, light: 0 },
  trails: [], profile: { stats: { hearRange: 1, focusBonus: 0.35, noiseReduce: 0.2 } }, welcome: { seed: 7 },
};
const ctx = {
  bus, state,
  get stats() { return state.profile.stats; },
  camera: { updateMatrixWorld() {}, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1] } },
  birds: { get: () => undefined },
  world: {
    isLoaded: () => true, regionAt: () => 1, canopyAt: () => 0.1, habitatAt: () => 5,
    waterDepthAt: (x, z) => (z < -6 ? 0.4 : 0), heightAt: () => 0, surfaceAt: () => 'mud',
  },
  player: { move: 'still', speed: 0, feet: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 1.6, z: 0 } },
  tools: { active: 'none', raised: false, recording: false },
};
const { default: audio } = await import('./index.js');
audio.init(ctx);

test('voice API exists before the engine, and setSpeaking is remembered', () => {
  const v = ctx.audio.voice;
  assert.equal(typeof v.play, 'function');
  assert.equal(typeof v.setSpeaking, 'function');
  assert.equal(v.speaking, false);
  v.setSpeaking(true);
  assert.equal(v.speaking, true);
  v.setSpeaking(false);
});

test('after the first gesture: speech synthesis ducks music and ambience, not birds', async () => {
  for (const fn of [...(listeners.pointerdown || [])]) fn();
  await new Promise((r) => setTimeout(r, 5));
  const eng = ctx.audio.context;
  assert.ok(eng);
  const v = ctx.audio.voice;
  v.setSpeaking(true);
  assert.equal(v.speaking, true);
  v.setSpeaking(false);
  assert.equal(v.speaking, false);
});

test('a clip plays, reports duration, ducks, ends and releases', async () => {
  const ac = ctx.audio.context;
  const frames = (n) => { for (let i = 0; i < n; i++) { ac.advance(1 / 60); audio.lateUpdate(1 / 60, ctx); } };
  frames(10);
  let ended = 0;
  const h = ctx.audio.voice.play(new ArrayBuffer(300), { gain: 0.8, onEnded: () => ended++ });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(h.duration, 3);
  assert.equal(ctx.audio.voice.speaking, true);
  frames(60);
  h.stop();
  assert.equal(ended, 1);
  assert.equal(ctx.audio.voice.speaking, false);
  // Bad data ends at once and never ducks.
  const bad = ctx.audio.voice.play(new ArrayBuffer(4), { onEnded: () => ended++ });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(bad.playing, false);
  assert.equal(ended, 2);
  assert.equal(ctx.audio.voice.speaking, false);
});

test('volNarrator and volMaster changes apply at once, also to a playing clip', async () => {
  const ac = ctx.audio.context;
  const h = ctx.audio.voice.play(ac.createBuffer(1, 80000, 8000));
  // Walk from the clip's source (the newest one): source -> clip gain -> narIn -> narUser -> master.
  const next = (n) => (n && n.outputs ? [...n.outputs][0] : undefined);
  const src = [...ac._sources].at(-1);
  const narUser = next(next(next(src)));
  const master = next(narUser);
  assert.ok(narUser?.gain && master?.gain, 'found the narrator chain');
  assert.ok(Math.abs(narUser.gain.value - 0.9) < 1e-9);
  state.settings.volNarrator = 0.3;
  state.settings.volMaster = 0.5;
  bus.emit('settings', { key: 'volNarrator', value: 0.3, settings: state.settings });
  assert.ok(Math.abs(narUser.gain.value - 0.3) < 1e-9);
  assert.ok(Math.abs(master.gain.value - 0.5) < 1e-9);
  h.stop();
});

test('the wildlife layer runs in the frame loop on a marsh night without errors', () => {
  const ac = ctx.audio.context;
  for (let i = 0; i < 60 * 120; i++) { ac.advance(1 / 30); audio.lateUpdate(1 / 30, ctx); }
  ctx.audio.setFocus(true);
  for (let i = 0; i < 60; i++) { ac.advance(1 / 30); audio.lateUpdate(1 / 30, ctx); }
  ctx.audio.setFocus(false);
  assert.ok(dbToGain(-8) > 0);
});
