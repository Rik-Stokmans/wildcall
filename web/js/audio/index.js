// ctx.audio — WILDCALL's Web Audio engine (contract §5.2, spec §5 and §24).
//
// Bird calls are the game's signature system: every call is synthesized from the
// species data and placed in 3D where the bird is, fading with distance and muffled by
// foliage, so the player can hear direction, distance, elevation, movement and
// obstruction. Focused listening ducks everything else and widens what the ear can
// reach; it never shows anything.
//
// Files: engine.js (graph, buses), schedule.js + voice.js (call synthesis), calls.js
// (spatial voices), ambience.js + mix.js (soundscape), sfx.js (footsteps, flutter,
// gear, UI), music.js + composer.js (generative music). Pure logic is unit tested.
import { AudioEngine, FFT_SIZE } from './engine.js';
import { CallManager } from './calls.js';
import { Ambience } from './ambience.js';
import { Sfx } from './sfx.js';
import { Music } from './music.js';
import { ambienceMix, probeWater, creekDistance, runningWaterDist } from './mix.js';
import { STRIDE } from './footsteps.js';
import {
  focusDuckDb, FOCUS_BIRD_BOOST_DB, levelFromRms, musicCallDuck, reverbReturn, dbToGain,
} from './curves.js';

/** UI screens open in-game: the world steps back a little so UI sounds read clearly. */
const UI_MODE_DB = -4;
const ENV_SAMPLE_S = 0.25;
const WATER_SAMPLE_S = 0.5;

let ctx = null;
let eng = null;
let calls = null;
let ambience = null;
let sfx = null;
let music = null;
let readyEmitted = false;
let unavailable = false;
let startedAt = 0;

let focusOn = false;
let focusAmt = 0;
let level = 0;
const listener = { x: 0, y: 0, z: 0 };
let envClock = 0, waterClock = 0;
let probe = { waterDist: Infinity, seaDist: Infinity, dirX: 0, dirZ: 0 };
let region = 0, canopy = 0;
const trails = new Map();
let footstepEvents = 0;
let stepAcc = 0;
let lastTool = { active: 'none', raised: false };
let lastRecording = false;
let lastZoomSound = 0;
const emptySpectrum = new Uint8Array(FFT_SIZE / 2);

/** Create (once) and resume the AudioContext. Must run inside a user gesture in browsers. */
function start() {
  if (unavailable) return Promise.resolve(false);
  if (!eng) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) { unavailable = true; console.warn('[audio] Web Audio is not available'); return Promise.resolve(false); }
    try {
      eng = new AudioEngine(AC);
    } catch (err) {
      unavailable = true;
      console.error('[audio] could not create the audio engine', err);
      return Promise.resolve(false);
    }
    calls = new CallManager(eng, ctx);
    ambience = new Ambience(eng, ((ctx.state?.welcome?.seed ?? 1) >>> 0) || 1);
    sfx = new Sfx(eng);
    music = new Music(eng);
    eng.applySettings(ctx.state?.settings, 0.01);
    applyDucks(0.01);
    eng.ac.onstatechange = checkReady;
  }
  const ac = eng.ac;
  if (ac.state !== 'running') startedAt = nowMs();
  const p = ac.state === 'running' ? Promise.resolve() : ac.resume().catch(() => {});
  return p.then(() => { checkReady(); return ac.state === 'running'; });
}

function nowMs() { return globalThis.performance?.now?.() ?? Date.now(); }

/**
 * May a one-shot be queued now? Yes while running, and in the short moment after a
 * gesture-triggered resume. A context that stays suspended (no gesture yet) must not
 * pile up sounds that would all burst out when it finally resumes.
 */
function canPlay() {
  if (!eng) return false;
  return eng.ac.state === 'running' || nowMs() - startedAt < 400;
}

function checkReady() {
  if (!readyEmitted && eng?.ac.state === 'running') {
    readyEmitted = true;
    ctx.bus?.emit('audio:ready');
  }
}

function onGesture() {
  start().then((ok) => {
    if (ok) {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    }
  });
}

/** Ambience/music/bird bus levels from focus, noise reduction and screen mode. */
function applyDucks(tc = 0.25) {
  if (!eng) return;
  const uiDb = ctx.state?.mode === 'ui' ? UI_MODE_DB : 0;
  const nr = ctx.stats?.noiseReduce ?? 0;
  eng.glideDb(eng.ambDuck, (focusOn ? focusDuckDb(nr) : 0) + uiDb, tc);
  eng.glideDb(eng.birdFocus, (focusOn ? FOCUS_BIRD_BOOST_DB : 0) + uiDb, tc);
}

function setFocus(on) {
  on = !!on;
  if (on === focusOn) return;
  focusOn = on;
  applyDucks(on ? 0.2 : 0.4);
}

function updateListener() {
  const cam = ctx.camera;
  if (!cam) return;
  cam.updateMatrixWorld?.();
  const e = cam.matrixWorld?.elements;
  if (!e) return;
  listener.x = e[12]; listener.y = e[13]; listener.z = e[14];
  let fx = -e[8], fy = -e[9], fz = -e[10];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  let ux = e[4], uy = e[5], uz = e[6];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const L = eng.ac.listener;
  const t = eng.now;
  if (L.positionX) {
    L.positionX.setTargetAtTime(listener.x, t, 0.02);
    L.positionY.setTargetAtTime(listener.y, t, 0.02);
    L.positionZ.setTargetAtTime(listener.z, t, 0.02);
    L.forwardX.setTargetAtTime(fx, t, 0.02);
    L.forwardY.setTargetAtTime(fy, t, 0.02);
    L.forwardZ.setTargetAtTime(fz, t, 0.02);
    L.upX.setTargetAtTime(ux, t, 0.02);
    L.upY.setTargetAtTime(uy, t, 0.02);
    L.upZ.setTargetAtTime(uz, t, 0.02);
  } else {
    L.setPosition?.(listener.x, listener.y, listener.z);
    L.setOrientation?.(fx, fy, fz, ux, uy, uz);
  }
  calls.listener.x = listener.x; calls.listener.y = listener.y; calls.listener.z = listener.z;
}

/** Sample the world around the listener and feed the ambience mix. */
function sampleEnvironment(dt) {
  envClock += dt;
  waterClock += dt;
  if (envClock < ENV_SAMPLE_S) return;
  envClock = 0;
  const w = ctx.world;
  const { x, z } = listener;
  let loaded = false;
  try { loaded = !!w?.isLoaded?.(x, z); } catch { loaded = false; }
  if (loaded) {
    try {
      const r = w.regionAt?.(x, z);
      if (Number.isFinite(r)) region = r;
      const c = w.canopyAt?.(x, z);
      if (Number.isFinite(c)) canopy = c;
    } catch { /* keep the last values */ }
    if (waterClock >= WATER_SAMPLE_S) {
      waterClock = 0;
      probe = probeWater(w.waterDepthAt?.bind(w), x, z);
    }
  }
  const creek = runningWaterDist(creekDistance(trails.values(), x, z), probe, region);
  const mix = ambienceMix({
    env: ctx.state?.env || {}, region, canopy,
    creekDist: creek, waterDist: probe.waterDist, seaDist: probe.seaDist, altitude: listener.y,
  });
  ambience.setInputs(mix, listener, { x: probe.dirX, z: probe.dirZ });
  eng.revReturn.gain.setTargetAtTime(0.55 * reverbReturn(canopy, region), eng.now, 1);
}

/** Footsteps when the player module does not emit 'footstep' events itself. */
function fallbackFootsteps(dt) {
  if (footstepEvents > 0 || ctx.state?.mode !== 'play') return;
  const p = ctx.player;
  if (!p) return;
  const move = p.move;
  const speed = +p.speed || 0;
  if (!move || move === 'still' || speed < 0.3 || p.sitting) { stepAcc = 0.6; return; }
  stepAcc += (speed * dt) / (STRIDE[move] || 0.75);
  if (stepAcc < 1) return;
  stepAcc -= 1;
  const f = p.feet || p.pos;
  let surface = 'grass';
  try {
    if (f) {
      surface = ctx.world?.surfaceAt?.(f.x, f.z) || 'grass';
      if ((+ctx.world?.waterDepthAt?.(f.x, f.z) || 0) > 0.05) surface = 'water';
    }
  } catch { /* default */ }
  sfx.footstep(surface, move);
}

function watchTools() {
  const rec = !!ctx.tools?.recording;
  if (rec !== lastRecording) {
    lastRecording = rec;
    sfx.gear(rec ? 'recStart' : 'recStop');
  }
}

function onTool(t) {
  if (!sfx || !t) return;
  const active = t.active || 'none';
  const raised = !!t.raised;
  if (active !== lastTool.active) sfx.gear('select');
  else if (raised !== lastTool.raised) sfx.gear(raised ? 'raise' : 'lower');
  lastTool = { active, raised };
}

function addTrails(list) {
  for (const t of list || []) if (t?.id && Array.isArray(t.points)) trails.set(t.id, t);
}

const api = {
  /** Create/resume the AudioContext (call from a user gesture). Resolves true when running. */
  resume: () => start(),
  /** Focused listening on/off: ducks ambience (~12 dB + noiseReduce) and music, lifts birds a little, widens range. */
  setFocus,
  /**
   * Non-spatial playback of a species' call (journal / field guide).
   * @param {number} spIndex species index
   * @param {number} callIndex index into species.calls
   * @param {{gain?: number, seed?: number, reps?: number}} [opts] reps ≤ 0 / missing →
   *   the call's own repeat range (seeded)
   * @returns {{stop(): void, duration: number, readonly playing: boolean}}
   */
  playCall(spIndex, callIndex, opts = {}) {
    const silent = { stop() {}, duration: 0, get playing() { return false; } };
    start();
    if (!eng || !calls || !canPlay()) return silent;
    const call = calls.callData(spIndex, callIndex);
    if (!call) return silent;
    const v = calls.preview(call, opts || {});
    return {
      stop() { calls.stopVoice(v); },
      duration: v.plan.duration,
      get playing() { return !v.stopping; },
    };
  },
  /** 512-bin byte spectrum of the bird-call bus. The array is reused: copy it to keep it. */
  getSpectrum() {
    return eng ? eng.readSpectrum() : emptySpectrum;
  },
  /** UI one-shot: click page open close reward discover shutter error level equip coin. */
  uiSound(name) {
    if (!eng) start();
    if (!sfx || !canPlay()) return;
    if (!sfx.ui(name)) console.warn('[audio] unknown ui sound', name);
  },
  /** Current bird-bus loudness 0..1 (fast attack, slow release). */
  get level() { return level; },
  /** True once the AudioContext is running. */
  get ready() { return !!eng && eng.ac.state === 'running'; },
  /** Whether focused listening is engaged. */
  get focus() { return focusOn; },
  /** Number of spatial bird voices currently sounding (diagnostics). */
  get voices() { return calls ? calls.activeCount : 0; },
  /** The AudioContext, or null before the first gesture. */
  get context() { return eng ? eng.ac : null; },
};

export default {
  name: 'audio',

  init(c) {
    ctx = c;
    ctx.audio = api;
    const bus = ctx.bus;
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    // The desktop shell allows autoplay: start straight away so the main menu's forest
    // is audible before the first click.
    if (window.wildcallDesktop) start();

    const live = () => !!eng && eng.ac.state === 'running';
    bus.on('net:call', (m) => { if (live()) calls.onCall(m); });
    bus.on('net:cue', (cue) => { if (live() && cue) sfx.flutter(cue, listener); });
    bus.on('footstep', (f) => {
      footstepEvents++;
      if (live() && f) sfx.footstep(f.surface, f.move);
    });
    bus.on('tool', (t) => { if (live()) onTool(t); else if (t) lastTool = { active: t.active || 'none', raised: !!t.raised }; });
    bus.on('photo:taken', () => { if (live()) sfx.shutter(); });
    bus.on('focus', (f) => setFocus(!!f?.on));
    bus.on('mouse:wheel', () => {
      if (!live() || ctx.tools?.active !== 'camera' || !ctx.tools?.raised) return;
      if (eng.now - lastZoomSound > 0.15) { lastZoomSound = eng.now; sfx.gear('zoom'); }
    });
    bus.on('settings', () => eng?.applySettings(ctx.state.settings));
    bus.on('mode', () => applyDucks());
    bus.on('profile', () => { if (focusOn) applyDucks(); }); // noiseReduce may have changed
    bus.on('welcome', (w) => { trails.clear(); addTrails(w?.trails); });
    bus.on('net:pois', (m) => addTrails(m?.trails));
  },

  lateUpdate(dt) {
    if (!eng || eng.ac.state !== 'running') return;
    updateListener();
    // Smooth focus for the audible range (attack faster than release).
    const target = focusOn ? 1 : 0;
    const rate = focusOn ? 4 : 2;
    focusAmt += (target - focusAmt) * Math.min(1, dt * rate);
    calls.focus = focusAmt;
    calls.update(dt);
    sampleEnvironment(dt);
    ambience.update(dt);
    fallbackFootsteps(dt);
    watchTools();

    const l = levelFromRms(eng.birdRms() * 2);
    level = l > level ? l : level + (l - level) * Math.min(1, dt * 3);
    const mode = ctx.state?.mode;
    const musicGain = (1 - focusAmt) * musicCallDuck(level) * (mode === 'ui' ? dbToGain(-3) : 1);
    eng.musDuck.gain.setTargetAtTime(musicGain, eng.now, musicGain < eng.musDuck.gain.value ? 0.4 : 2.5);
    music.update(ctx.state?.env);
  },
};
