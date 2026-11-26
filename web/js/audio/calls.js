// Spatial bird calls: one "bout" per net:call message, rendered note by note just ahead
// of time through its own chain:
//
//   notes → input → lowpass (air + occlusion) → fade (distance edge, occlusion, level)
//         → HRTF panner (at the bird, following it) → birdIn
//                                                   └→ send → shared forest reverb
//
// When web/birdsong has recordings for the call (samples.js), a bout plays one of them
// instead: the recording's source nodes feed the same `input`, so the chain below is
// identical (position, roll-off, air + occlusion filter, reverb send, voice cap).
//
// The voice count is capped (MAX_VOICES); the nearest/loudest win (curves.pickVoiceSlot).
// Nothing here shows anything to the player: this is only what the ear gets.
import { scheduleCall } from './schedule.js';
import { renderNote } from './voice.js';
import { mulberry32, hashSeed } from './rng.js';
import { fitBout, MAX_WAIT_S } from './samples.js';
import {
  audibleRange, pannerParams, edgeFade, sourceLevel, occlusionGain, voiceCutoff,
  canopyOcclusion, blendOcclusion, voicePriority, pickVoiceSlot, reverbSend, dist3,
  MAX_VOICES,
} from './curves.js';

/** Notes are created this far ahead of their start time (s). */
const LOOKAHEAD = 0.3;
/** Delay before a fresh bout's first note so it can be scheduled cleanly (s). */
const START_DELAY = 0.06;
/** Overall headroom for bird voices (many may overlap). */
const BIRD_HEADROOM = 0.5;
/** Seconds a stolen / stopped voice takes to fade out. */
const STOP_FADE = 0.06;
/** Voice parameters are refreshed at this rate (Hz) rather than every frame. */
const PARAM_HZ = 20;
/** Level of a recording (the tool normalises them to -16 LUFS) against synthesised notes. */
const SAMPLE_LEVEL = 0.85;
/** Attack ramp on every recording segment (s): a mid-file start must not click. */
const SAMPLE_ATTACK = 0.012;

/**
 * What playCall hands back: stop(), duration (s), playing, and an optional onEnded that
 * fires once, however the sound ends (finished, stopped, or never started).
 */
class PlayHandle {
  constructor(onEnded) {
    this.onEnded = typeof onEnded === 'function' ? onEnded : null;
    this.v = null;
    this.dur = 0;
    this.stopped = false;
    this.ended = false;
    this.manager = null;
  }
  bind(v, manager) { this.v = v; this.manager = manager; v.onEnd = () => this.finish(); }
  get duration() { return this.v ? this.v.plan.duration : this.dur; }
  get playing() { return !this.ended && !this.stopped; }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.v) this.manager.stopVoice(this.v);
    this.finish();
  }
  finish() {
    if (this.ended) return;
    this.ended = true;
    const cb = this.onEnded;
    this.onEnded = null;
    if (cb) { try { cb(); } catch (err) { console.error('[audio] onEnded failed', err); } }
  }
}

export class CallManager {
  /**
   * @param {import('./engine.js').AudioEngine} eng
   * @param {object} ctx the game ctx (state, birds, world, camera)
   */
  constructor(eng, ctx, bank = null) {
    this.eng = eng;
    this.ctx = ctx;
    /** @type {import('./samples.js').SampleBank|null} */
    this.bank = bank;
    /** @type {Bout[]} */
    this.voices = [];
    this.focus = 0; // 0..1 smoothed focus amount (set by the module)
    this.listener = { x: 0, y: 0, z: 0 };
    this.paramClock = 0;
  }

  /** Species call data for a CallMsg, or null. */
  callData(sp, ci) {
    const species = this.ctx.state?.species?.[sp];
    const call = species?.calls?.[ci | 0];
    return call && Array.isArray(call.notes) && call.notes.length ? call : null;
  }

  /** Id of species `sp` (for the recordings manifest), or ''. */
  speciesId(sp) {
    return this.ctx.state?.species?.[sp | 0]?.id || '';
  }

  /** Handle a net:call message (proto.CallMsg: bird, sp, call, reps, x, y, z, occ, seed). */
  onCall(msg) {
    const call = this.callData(msg?.sp, msg?.call);
    if (!call) return;
    const seed = (msg.seed >>> 0) || hashSeed(msg.bird, msg.sp, msg.call, Math.floor(this.eng.now * 10));
    const id = this.bank ? this.speciesId(msg.sp) : '';
    const entry = id ? this.bank.pick(id, msg.call | 0, seed) : null;
    if (!entry) { this.startBout(msg, call, seed, null); return; }
    const buf = this.bank.cached(entry);
    if (buf) { this.startBout(msg, call, seed, { entry, buf }); return; }
    // Decode lazily without blocking: the bout starts when the recording is ready (a few
    // tens of milliseconds for a small file), is dropped when that takes too long, and
    // falls back to synthesis when the recording cannot be loaded.
    const asked = this.eng.now;
    this.bank.prefetch(id, msg.call | 0);
    this.bank.ensure(entry).then((b) => {
      if (this.eng.now - asked > MAX_WAIT_S) return;
      this.startBout(msg, call, seed, b ? { entry, buf: b } : null);
    });
  }

  /** Start a bout now: synthesised notes, or `sample` = {entry, buf} (a recording). */
  startBout(msg, call, seed, sample) {
    const pos = this.birdPos(msg.bird) || { x: +msg.x || 0, y: +msg.y || 0, z: +msg.z || 0 };
    const L = this.listener;
    const d = dist3(pos.x, pos.y, pos.z, L.x, L.y, L.z);
    const range = audibleRange(call.loud, this.ctx.stats, this.focus);
    const occ = clamp01(+msg.occ || 0);
    const pri = voicePriority(call.loud, d, range, occ);

    // One bird sings one bout at a time: a new bout from the same bird replaces the old.
    for (const v of this.voices) if (v.bird === msg.bird && !v.stopping && msg.bird) this.stopVoice(v);

    const slot = pickVoiceSlot(this.voices, pri, MAX_VOICES);
    if (!slot.accept) return;
    if (slot.victim >= 0) this.stopVoice(this.voices[slot.victim]);

    let plan = scheduleCall(call, msg.reps | 0, seed);
    let fit = null;
    if (sample) {
      // The bout's length is what the synthesised bout would last: reps x phrase.
      fit = fitBout(sample.buf.duration, plan.duration, mulberry32(seed ^ 0x2f6e2b1), { gap: call.gap });
      plan = { events: [], duration: fit.duration, repeats: plan.repeats };
    } else if (!plan.events.length) return;
    const bout = this.makeSpatialVoice(call, pos, occ, plan, seed);
    bout.bird = msg.bird;
    bout.priority = pri;
    if (sample) this.playSegments(bout, sample.buf, sample.entry, fit);
    this.voices.push(bout);
    this.refresh(bout, true);
  }

  /**
   * Schedule the segments of a fitted recording into voice `v` (all at once: a bout has
   * at most a handful, and each is one cheap buffer source).
   */
  playSegments(v, buf, entry, fit) {
    const ac = this.eng.ac;
    for (const seg of fit.segments) {
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = seg.rate;
      const env = ac.createGain();
      const level = SAMPLE_LEVEL * entry.gain * seg.gain;
      const t = v.t0 + seg.at;
      const play = seg.len / seg.rate;
      const fo = Math.min(Math.max(0.02, seg.fadeOut), play * 0.5);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(level, t + Math.min(SAMPLE_ATTACK, play * 0.25));
      env.gain.setValueAtTime(level, t + play - fo);
      env.gain.linearRampToValueAtTime(0, t + play);
      src.connect(env);
      env.connect(v.input);
      src.start(t, seg.offset, seg.len);
      src.stop(t + play + 0.02);
      v.sources.add(src);
      src.addEventListener('ended', () => {
        v.sources.delete(src);
        try { src.disconnect(); env.disconnect(); } catch { /* already gone */ }
      });
    }
  }

  makeSpatialVoice(call, pos, occ, plan, seed) {
    const ac = this.eng.ac;
    const input = ac.createGain();
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.value = 20000;
    const fade = ac.createGain();
    fade.gain.value = 0;
    const panner = ac.createPanner();
    panner.panningModel = 'HRTF';
    const pp = pannerParams(audibleRange(call.loud, this.ctx.stats, this.focus));
    panner.distanceModel = pp.distanceModel;
    panner.refDistance = pp.refDistance;
    panner.rolloffFactor = pp.rolloffFactor;
    panner.maxDistance = pp.maxDistance;
    setPannerPos(panner, pos.x, pos.y, pos.z, ac.currentTime, 0);
    const send = ac.createGain();
    send.gain.value = 0;
    input.connect(lp).connect(fade).connect(panner).connect(this.eng.birdIn);
    fade.connect(send).connect(this.eng.revIn);
    const t0 = ac.currentTime + START_DELAY;
    return {
      bird: 0, call, plan, next: 0, t0, endAt: t0 + plan.duration + 0.15,
      rng: mulberry32(seed ^ 0x5bd1e995),
      input, lp, fade, panner, send, spatial: true,
      pos: { x: pos.x, y: pos.y, z: pos.z }, origin: { x: pos.x, y: pos.y, z: pos.z },
      msgOcc: occ, occ, priority: 0, stopping: false, disposeAt: Infinity,
      sources: new Set(), ref: pp.refDistance, gain: 1,
    };
  }

  /**
   * Non-spatial playback of a species' call for the journal / field guide: a recording
   * when there is one, else the synthesised call. Goes through the bird bus (so the
   * spectrogram shows it). Returns a PlayHandle at once, even while a recording loads.
   * @param {number} sp species index
   * @param {number} ci call index
   * @param {{gain?: number, seed?: number, reps?: number, onEnded?: () => void}} opts
   */
  play(sp, ci, opts = {}) {
    const call = this.callData(sp, ci);
    if (!call) return null;
    const seed = (opts.seed >>> 0) || ((Math.random() * 0xffffffff) >>> 0);
    const handle = new PlayHandle(opts.onEnded);
    const id = this.bank ? this.speciesId(sp) : '';
    const entry = id ? this.bank.pick(id, ci | 0, seed) : null;
    const synth = () => handle.bind(this.preview(call, { ...opts, seed }), this);
    if (!entry) { synth(); return handle; }
    // Journal playback of a recording plays it whole unless a bout length was asked for.
    const want = opts.reps > 0 ? scheduleCall(call, opts.reps | 0, seed).duration : 0;
    handle.dur = want > 0 ? want : entry.dur;
    const begin = (buf) => handle.bind(this.previewSample(call, entry, buf, want, opts, seed), this);
    const buf = this.bank.cached(entry);
    if (buf) { begin(buf); return handle; }
    this.bank.ensure(entry).then((b) => {
      if (handle.stopped) return;
      if (b) begin(b); else synth();
    });
    return handle;
  }

  makePreviewVoice(call, plan, opts, seed) {
    const ac = this.eng.ac;
    const input = ac.createGain();
    const fade = ac.createGain();
    fade.gain.value = clamp(opts.gain ?? 1, 0, 2) * 0.7;
    const send = ac.createGain();
    send.gain.value = 0.12;
    input.connect(fade).connect(this.eng.birdIn);
    fade.connect(send).connect(this.eng.revIn);
    const t0 = ac.currentTime + START_DELAY;
    const v = {
      bird: 0, call, plan, next: 0, t0, endAt: t0 + plan.duration + 0.15,
      rng: mulberry32(seed ^ 0x5bd1e995),
      input, lp: null, fade, panner: null, send, spatial: false,
      pos: null, origin: null, msgOcc: 0, occ: 0, priority: Infinity, stopping: false,
      disposeAt: Infinity, sources: new Set(), gain: 1, preview: true,
    };
    this.previews ??= [];
    this.previews.push(v);
    return v;
  }

  previewSample(call, entry, buf, boutDur, opts, seed) {
    const fit = fitBout(buf.duration, boutDur, mulberry32(seed ^ 0x2f6e2b1), { gap: call.gap });
    const v = this.makePreviewVoice(call, { events: [], duration: fit.duration, repeats: 1 }, opts, seed);
    this.playSegments(v, buf, entry, fit);
    return v;
  }

  /**
   * Synthesised non-spatial playback (also the fallback when a recording cannot load).
   * Never stolen by world calls.
   */
  preview(call, opts = {}) {
    const seed = (opts.seed >>> 0) || ((Math.random() * 0xffffffff) >>> 0);
    const plan = scheduleCall(call, opts.reps | 0, seed);
    const v = this.makePreviewVoice(call, plan, opts, seed);
    this.pump(v, this.eng.ac.currentTime);
    return v;
  }

  birdPos(id) {
    if (!id) return null;
    let b;
    try { b = this.ctx.birds?.get?.(id); } catch { b = null; }
    const p = b?.pos;
    return p && Number.isFinite(p.x) ? p : null;
  }

  /** Fade a voice out quickly and release its nodes shortly after. */
  stopVoice(v) {
    if (v.stopping) return;
    v.stopping = true;
    const now = this.eng.now;
    v.fade.gain.cancelScheduledValues(now);
    v.fade.gain.setValueAtTime(v.fade.gain.value, now);
    v.fade.gain.linearRampToValueAtTime(0, now + STOP_FADE);
    for (const s of v.sources) { try { s.stop(now + STOP_FADE + 0.02); } catch { /* not started / done */ } }
    v.next = v.plan.events.length;
    v.disposeAt = now + STOP_FADE + 0.1;
    v.onEnd?.();
  }

  dispose(v) {
    for (const n of [v.input, v.lp, v.fade, v.panner, v.send]) {
      if (n) { try { n.disconnect(); } catch { /* fine */ } }
    }
    v.sources.clear();
  }

  /** Create the notes that start within the look-ahead window. */
  pump(v, now) {
    const ev = v.plan.events;
    const horizon = now + LOOKAHEAD;
    while (v.next < ev.length) {
      const e = ev[v.next];
      const when = v.t0 + e.t;
      if (when > horizon) break;
      v.next++;
      // Skip notes we are already late for (e.g. after the tab was suspended).
      if (when < now - 0.02) continue;
      const r = renderNote(this.eng, e, when, v.input, v.rng);
      for (const s of r.sources) {
        v.sources.add(s);
        // addEventListener leaves renderNote's own onended cleanup in place.
        s.addEventListener('ended', () => v.sources.delete(s));
      }
    }
  }

  /** Recompute position, distance gain, low-pass, reverb send and priority. */
  refresh(v, immediate = false) {
    if (!v.spatial || v.stopping) return;
    const now = this.eng.now;
    const tc = immediate ? 0.005 : 0.06;
    const p = this.birdPos(v.bird);
    if (p) { v.pos.x = p.x; v.pos.y = p.y; v.pos.z = p.z; }
    setPannerPos(v.panner, v.pos.x, v.pos.y, v.pos.z, now, immediate ? 0 : 0.05);

    const L = this.listener;
    const d = dist3(v.pos.x, v.pos.y, v.pos.z, L.x, L.y, L.z);
    const range = audibleRange(v.call.loud, this.ctx.stats, this.focus);
    const pp = pannerParams(range);
    // Changing the panner's distance law is a plain attribute (no automation); only
    // touch it when it moved noticeably (focus gliding in/out).
    if (Math.abs(pp.refDistance - v.ref) / v.ref > 0.01) {
      v.panner.refDistance = pp.refDistance;
      v.panner.rolloffFactor = pp.rolloffFactor;
      v.ref = pp.refDistance;
    }

    // Occlusion: the server's value where the bout started, an estimate from the
    // canopy once the bird moves.
    const moved = dist3(v.pos.x, v.pos.y, v.pos.z, v.origin.x, v.origin.y, v.origin.z);
    if (moved > 1) {
      const w = this.ctx.world;
      let cb = 0, cl = 0;
      try { cb = +w?.canopyAt?.(v.pos.x, v.pos.z) || 0; cl = +w?.canopyAt?.(L.x, L.z) || 0; } catch { /* world not ready */ }
      v.occ = blendOcclusion(v.msgOcc, canopyOcclusion(cb, cl, d), moved);
    }

    const g = sourceLevel(v.call.loud) * occlusionGain(v.occ) * edgeFade(d, range) * BIRD_HEADROOM;
    v.fade.gain.setTargetAtTime(g, now, tc);
    v.lp.frequency.setTargetAtTime(voiceCutoff(d, v.occ), now, tc);
    v.send.gain.setTargetAtTime(reverbSend(d, range), now, tc);
    v.priority = voicePriority(v.call.loud, d, range, v.occ);
  }

  /** Per frame. */
  update(dt) {
    const now = this.eng.now;
    this.paramClock += dt;
    const doParams = this.paramClock >= 1 / PARAM_HZ;
    if (doParams) this.paramClock = 0;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (!v.stopping) {
        this.pump(v, now);
        if (doParams) this.refresh(v);
        if (now > v.endAt && v.next >= v.plan.events.length) { v.stopping = true; v.disposeAt = now + 0.2; }
      }
      if (now >= v.disposeAt) { this.dispose(v); this.voices.splice(i, 1); }
    }
    if (this.previews) {
      for (let i = this.previews.length - 1; i >= 0; i--) {
        const v = this.previews[i];
        if (!v.stopping) {
          this.pump(v, now);
          if (now > v.endAt && v.next >= v.plan.events.length) { v.stopping = true; v.disposeAt = now + 0.2; v.onEnd?.(); }
        }
        if (now >= v.disposeAt) { this.dispose(v); this.previews.splice(i, 1); }
      }
    }
  }

  /** Stop and release everything (e.g. on teardown). */
  stopAll() {
    for (const v of this.voices) this.stopVoice(v);
    for (const v of this.previews || []) this.stopVoice(v);
  }

  get activeCount() {
    let n = 0;
    for (const v of this.voices) if (!v.stopping) n++;
    return n;
  }
}

/** Position a PannerNode (AudioParam API where available, legacy setPosition otherwise). */
export function setPannerPos(p, x, y, z, t, tc) {
  if (p.positionX) {
    if (tc > 0) {
      p.positionX.setTargetAtTime(x, t, tc);
      p.positionY.setTargetAtTime(y, t, tc);
      p.positionZ.setTargetAtTime(z, t, tc);
    } else {
      p.positionX.setValueAtTime(x, t);
      p.positionY.setValueAtTime(y, t);
      p.positionZ.setValueAtTime(z, t);
    }
  } else if (p.setPosition) {
    p.setPosition(x, y, z);
  }
}

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function clamp01(x) { return clamp(x, 0, 1); }

/**
 * @typedef {object} Bout
 * @property {number} bird
 * @property {object} call core.Call
 * @property {{events: object[], duration: number}} plan
 * @property {number} next index of the next event to render
 * @property {number} t0 AudioContext time of the bout start
 * @property {number} priority current perceived loudness (for stealing)
 * @property {boolean} stopping
 */
