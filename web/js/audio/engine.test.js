// Smoke tests of the whole audio module against a strict fake Web Audio API: wiring,
// event handling, voice cap and cleanup. Real sound quality can only be judged by ear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, stats } from './fakeaudio.js';
import { createBus } from '../core/bus.js';
import { MAX_VOICES } from './curves.js';

const listeners = {};
globalThis.window = {
  addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
  removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
};
globalThis.AudioContext = FakeAudioContext;

const n = (dur, gap, f0, f1, wave, amp = 0.8, rate = 0, depth = 0) => ({ dur, gap, f0, f1, wave, rate, depth, amp });
const species = [
  {
    id: 'test_robin', index: 0, calls: [
      { kind: 'song', loud: 0.45, repeat: [2, 3], gap: 1.2, pitch: 'high', pattern: 'melodic', notes: [
        n(0.12, 0.04, 4200, 5100, 'whistle'), n(0.1, 0.03, 6000, 5500, 'trill', 0.6, 40, 0.7),
        n(0.08, 0.05, 3000, 3300, 'sine'), n(0.1, 0.05, 2500, 2200, 'buzz'),
        n(0.15, 0.05, 2000, 3500, 'noise', 0.9), n(0.014, 0.04, 850, 780, 'click', 1),
        n(0.5, 0, 900, 800, 'click', 1, 22, 0),
      ] },
      { kind: 'call', loud: 0.2, repeat: [1, 1], gap: 1, pitch: 'high', pattern: 'single', notes: [n(0.05, 0.1, 5000, 4000, 'whistle')] },
    ],
  },
];

function makeCtx() {
  const bus = createBus();
  const state = {
    mode: 'play',
    settings: { volMaster: 0.8, volBirds: 1, volAmbient: 0.7, volMusic: 0.35, volUI: 0.6 },
    species,
    env: { time: 14, day: 1, season: 1, weather: 2, wind: 0.6, rain: 0.7, mist: 0, cloud: 0.8, light: 0.7 },
    trails: [],
    profile: { stats: { hearRange: 1, focusBonus: 0.35, noiseReduce: 0.2 } },
    welcome: { seed: 42 },
  };
  const birds = new Map();
  const ctx = {
    bus, state,
    get stats() { return state.profile.stats; },
    camera: { updateMatrixWorld() {}, matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.6, 0, 1] } },
    birds: { get: (id) => birds.get(id) },
    world: {
      isLoaded: () => true, regionAt: () => 0, canopyAt: () => 0.6,
      waterDepthAt: (x) => (x > 10 && x < 16 ? 0.4 : 0), surfaceAt: () => 'leaf',
    },
    player: { move: 'walk', speed: 2.4, feet: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 1.6, z: 0 } },
    tools: { active: 'none', raised: false, recording: false },
  };
  return { ctx, birds };
}

const { default: audio } = await import('./index.js');
const { ctx, birds } = makeCtx();
const events = [];
ctx.bus.on('audio:ready', () => events.push('ready'));

function frames(count, dt = 1 / 60) {
  const ac = ctx.audio.context;
  for (let i = 0; i < count; i++) { ac.advance(dt); audio.lateUpdate(dt, ctx); }
}

test('init publishes ctx.audio with the contract API, silent before a gesture', () => {
  audio.init(ctx);
  const a = ctx.audio;
  for (const k of ['resume', 'setFocus', 'playCall', 'getSpectrum', 'uiSound']) assert.equal(typeof a[k], 'function', k);
  assert.equal(a.level, 0);
  assert.equal(a.ready, false);
  assert.equal(a.getSpectrum().length, 512);
  // Calls before the context exists are ignored, not thrown.
  ctx.bus.emit('net:call', { bird: 1, sp: 0, call: 0, reps: 1, x: 5, y: 2, z: -5, occ: 0, seed: 1 });
  audio.lateUpdate(0.016, ctx);
});

test('first user gesture creates the context and emits audio:ready once', async () => {
  for (const fn of [...(listeners.pointerdown || [])]) fn();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(ctx.audio.ready, true);
  assert.deepEqual(events, ['ready']);
  await ctx.audio.resume();
  assert.deepEqual(events, ['ready']);
  assert.equal(ctx.audio.getSpectrum().length, 512);
});

test('a call is synthesized through a spatial voice that follows the bird', () => {
  birds.set(7, { id: 7, sp: 0, pos: { x: 10, y: 4, z: -10 } });
  const before = stats.started;
  ctx.bus.emit('net:call', { bird: 7, sp: 0, call: 0, reps: 2, x: 10, y: 4, z: -10, occ: 0.4, seed: 99 });
  frames(30);
  assert.ok(stats.started > before, 'notes were scheduled');
  birds.set(7, { id: 7, sp: 0, pos: { x: 30, y: 4, z: -30 } }); // it moves while singing
  frames(400);
  assert.ok(ctx.audio.level > 0);
});

test('voice cap: at most MAX_VOICES spatial bouts at once, nearest win', () => {
  for (let i = 0; i < 60; i++) {
    ctx.bus.emit('net:call', { bird: 100 + i, sp: 0, call: 0, reps: 3, x: 2 + i, y: 3, z: 0, occ: 0, seed: i + 1 });
  }
  frames(2);
  assert.equal(ctx.audio.voices, MAX_VOICES);
  // A call far beyond its audible range never takes a voice.
  ctx.bus.emit('net:call', { bird: 999, sp: 0, call: 0, reps: 3, x: 5000, y: 3, z: 0, occ: 0, seed: 5 });
  frames(1);
  assert.equal(ctx.audio.voices, MAX_VOICES);
  frames(60 * 20); // let every bout finish
  assert.equal(ctx.audio.voices, 0);
  assert.ok(stats.liveSources < 60, `sources still live: ${stats.liveSources}`);
});

test('focus, playback, UI, footsteps, cues, tools and settings run without errors', () => {
  ctx.audio.setFocus(true);
  ctx.bus.emit('focus', { on: true });
  frames(30);
  assert.equal(ctx.audio.focus, true);
  ctx.audio.setFocus(false);
  const h = ctx.audio.playCall(0, 0, { gain: 0.8, seed: 3 });
  assert.ok(h.duration > 0);
  assert.equal(h.playing, true);
  frames(10);
  h.stop();
  frames(30);
  assert.equal(h.playing, false);
  const none = ctx.audio.playCall(5, 9);
  none.stop();
  for (const name of ['click', 'page', 'open', 'close', 'reward', 'discover', 'shutter', 'error', 'level', 'equip', 'coin']) ctx.audio.uiSound(name);
  for (const s of ['grass', 'leaf', 'sand', 'rock', 'snow', 'water', 'mud', 'wood', 'weird']) {
    for (const m of ['crouch', 'walk', 'run', 'sprint', 'still']) ctx.bus.emit('footstep', { surface: s, move: m });
  }
  ctx.bus.emit('net:cue', { bearing: 1.2, elev: 0.3, inView: false, strength: 0.8 });
  ctx.bus.emit('tool', { active: 'camera', raised: false });
  ctx.bus.emit('tool', { active: 'camera', raised: true });
  ctx.tools.active = 'camera'; ctx.tools.raised = true;
  ctx.bus.emit('mouse:wheel', { dy: 1 });
  ctx.bus.emit('photo:taken', { img: '' });
  ctx.tools.recording = true; frames(2); ctx.tools.recording = false; frames(2);
  ctx.state.mode = 'ui'; ctx.bus.emit('mode', { mode: 'ui', prev: 'play' });
  ctx.state.settings.volMusic = 0; ctx.bus.emit('settings', { key: 'volMusic', value: 0, settings: ctx.state.settings });
  ctx.bus.emit('welcome', { trails: [{ id: 'creek', points: [{ x: 0, y: 0, z: 5 }, { x: 20, y: 0, z: 5 }] }] });
  frames(60 * 5);
  ctx.state.mode = 'play';
  frames(60 * 70, 1 / 30); // long enough for music and every ambience timer to fire
  frames(60 * 3);
});

test('ambience copes with night, snow, sea and a missing world', () => {
  ctx.state.env = { time: 23, season: 3, weather: 3, wind: 1, rain: 0, light: 0 };
  ctx.world.regionAt = () => 3;
  ctx.world.waterDepthAt = (x, z) => (z < -30 ? 4 : 0);
  frames(120);
  ctx.state.env = { time: 2, season: 1, weather: 0, wind: 0, rain: 0, light: 0 };
  frames(120);
  const w = ctx.world;
  ctx.world = undefined;
  frames(60);
  ctx.world = w;
});
