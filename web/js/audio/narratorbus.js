// The narrator bus: a public way to play his (pregenerated) clips through the engine's
// master limiter and volume structure, and the ducking that makes room for him.
//
//   clip → gain(opts.gain) → narIn → narUser(volNarrator) → master(volMaster) → limiter
//
// While he speaks (a clip is playing here, or the narrator module reports speech
// synthesis via setSpeaking) music steps back ~8 dB and ambience ~3 dB, over 250 ms;
// they come back more slowly after a short hold so a pause between two lines does not
// pump. The bird bus is never ducked: bird sound is gameplay.
//
// The pure part (DUCK, duckTargets, ramp timing) is unit tested; the class runs on any
// Web Audio API, including the strict fake in fakeaudio.js.
import { dbToGain } from './curves.js';

export const DUCK = {
  musicDb: -8,
  ambienceDb: -3,
  birdsDb: 0,
  /** Seconds to reach the ducked level. */
  attackS: 0.25,
  /** Seconds to come back. */
  releaseS: 0.5,
  /** Seconds he must have been quiet before the release starts. */
  holdS: 0.35,
};

/** dB targets for the music / ambience / bird buses while the narrator is (not) speaking. */
export function duckTargets(speaking) {
  return speaking
    ? { musicDb: DUCK.musicDb, ambienceDb: DUCK.ambienceDb, birdsDb: DUCK.birdsDb }
    : { musicDb: 0, ambienceDb: 0, birdsDb: 0 };
}

/** Linear gain targets (same shape as duckTargets, in gain). */
export function duckGains(speaking) {
  const t = duckTargets(speaking);
  return { music: dbToGain(t.musicDb), ambience: dbToGain(t.ambienceDb), birds: dbToGain(t.birdsDb) };
}

/** Ramp timing for a change of speaking state: {delay, dur} in seconds. */
export function duckTiming(speaking) {
  return speaking ? { delay: 0, dur: DUCK.attackS } : { delay: DUCK.holdS, dur: DUCK.releaseS };
}

/** Glide an AudioParam from where it is to `v` over `dur` s after `delay` s. */
function rampParam(param, v, now, delay, dur) {
  const cur = Number.isFinite(param.value) ? param.value : v;
  param.cancelScheduledValues(now);
  param.setValueAtTime(cur, now);
  if (delay > 0) param.setValueAtTime(cur, now + delay);
  param.linearRampToValueAtTime(v, now + delay + dur);
}

export class NarratorBus {
  /**
   * @param {import('./engine.js').AudioEngine|null} eng may be set later with attach()
   * @param {{fetchBytes?: (url:string)=>Promise<ArrayBuffer>, canPlay?: ()=>boolean}} [io]
   */
  constructor(eng = null, io = {}) {
    this.eng = null;
    this.io = io;
    this.clips = new Set();
    this.external = false; // speech synthesis (setSpeaking)
    this.applied = null;   // last speaking state pushed to the buses
    if (eng) this.attach(eng);
  }

  /** Bind to the engine once it exists; applies a speaking state reported earlier. */
  attach(eng) {
    this.eng = eng;
    this.applied = null;
    this.sync();
  }

  get speaking() { return this.clips.size > 0 || this.external; }

  /** The narrator module reports speech synthesis (no clip of ours is playing). */
  setSpeaking(on) {
    this.external = !!on;
    this.sync();
  }

  /** Push the duck to the buses if the speaking state changed. */
  sync() {
    const eng = this.eng;
    if (!eng) return;
    const sp = this.speaking;
    if (sp === this.applied) return;
    this.applied = sp;
    const g = duckGains(sp);
    const tm = duckTiming(sp);
    const now = eng.now;
    rampParam(eng.musVo.gain, g.music, now, tm.delay, tm.dur);
    rampParam(eng.ambVo.gain, g.ambience, now, tm.delay, tm.dur);
  }

  /**
   * Play a clip on the narrator bus.
   * @param {ArrayBuffer|AudioBuffer|string} source encoded bytes, a decoded buffer or a URL
   * @param {{gain?: number, onEnded?: () => void}} [opts]
   * @returns {{stop(): void, readonly duration: number, readonly playing: boolean}}
   *   duration is 0 until the clip has been decoded (an AudioBuffer: known at once).
   */
  play(source, opts = {}) {
    opts = opts || {};
    const bus = this;
    const h = {
      dur: 0, ended: false, stopped: false, src: null, g: null, onEnded: typeof opts.onEnded === 'function' ? opts.onEnded : null,
      get duration() { return this.dur; },
      get playing() { return !this.ended; },
      stop() {
        if (this.ended) return;
        this.stopped = true;
        const s = this.src;
        if (s) { try { s.onended = null; s.stop(); } catch { /* already stopped */ } }
        this.finish();
      },
      finish() {
        if (this.ended) return;
        this.ended = true;
        bus.clips.delete(this);
        if (this.src) { try { this.src.disconnect(); this.g?.disconnect(); } catch { /* ignore */ } }
        bus.sync();
        const cb = this.onEnded;
        this.onEnded = null;
        if (cb) { try { cb(); } catch (err) { console.error('[audio] voice onEnded failed', err); } }
      },
    };
    const eng = this.eng;
    if (!eng || (this.io.canPlay && !this.io.canPlay())) {
      queueMicrotask(() => h.finish());
      return h;
    }
    if (source && typeof source === 'object' && typeof source.getChannelData === 'function') {
      this.start(h, source, opts);
    } else {
      this.decode(source).then((buf) => {
        if (h.stopped || h.ended) return;
        if (!buf) { h.finish(); return; }
        this.start(h, buf, opts);
      }, () => h.finish());
    }
    return h;
  }

  async decode(source) {
    const eng = this.eng;
    let bytes = source;
    if (typeof source === 'string') {
      const get = this.io.fetchBytes;
      if (!get) return null;
      bytes = await get(source);
    }
    if (!bytes) return null;
    if (typeof bytes.slice === 'function' && !(bytes instanceof ArrayBuffer) && bytes.buffer) {
      bytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    return eng.ac.decodeAudioData(bytes);
  }

  start(h, buf, opts) {
    const eng = this.eng;
    const ac = eng.ac;
    const src = ac.createBufferSource();
    const g = ac.createGain();
    const gain = Number.isFinite(+opts.gain) ? Math.max(0, +opts.gain) : 1;
    g.gain.value = gain;
    src.buffer = buf;
    src.connect(g);
    g.connect(eng.narIn);
    h.src = src; h.g = g;
    h.dur = buf.duration || 0;
    src.onended = () => h.finish();
    this.clips.add(h);
    src.start(ac.currentTime + 0.01);
    this.sync();
  }
}
