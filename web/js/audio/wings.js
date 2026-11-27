// Wing sounds in 3D: a take-off or landing heard where the bird is (recipes in
// wingmodel.js; bursts rendered with the Sfx noise helpers). Used through
// ctx.audio.wings(kind, x, y, z, opts) by the birds module.
import { wingRecipe } from './wingmodel.js';
import { mulberry32 } from './rng.js';
import { setPannerPos } from './calls.js';

/** At most this many wing sounds at once; a flock bursting off together is one sound. */
const MAX_LIVE = 6;
const MERGE_S = 0.15, MERGE_M = 10;

export class WingSounds {
  /**
   * @param {import('./engine.js').AudioEngine} eng
   * @param {import('./sfx.js').Sfx} sfx  provides burst() / sweepNoise()
   */
  constructor(eng, sfx, seed = 11) {
    this.eng = eng;
    this.sfx = sfx;
    this.rng = mulberry32(seed);
    this.live = 0;
    this.last = { t: -1, x: 0, y: 0, z: 0 };
    /** ac.currentTime of the last sound played (the cue flutter defers to it). */
    this.lastAt = -1;
  }

  /**
   * @param {string} kind wingKind()
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {{landing?: boolean, flush?: boolean, water?: boolean, size?: number, gain?: number}} [o]
   * @returns {boolean} played
   */
  play(kind, x, y, z, o = {}) {
    const ac = this.eng.ac;
    const now = ac.currentTime;
    const L = this.last;
    if (now - L.t < MERGE_S && Math.hypot(x - L.x, y - L.y, z - L.z) < MERGE_M) return false;
    if (this.live >= MAX_LIVE) return false;
    L.t = now; L.x = x; L.y = y; L.z = z;
    this.lastAt = now;
    const r = wingRecipe(kind, o, this.rng);
    const panner = ac.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.rolloffFactor = 1.1;
    setPannerPos(panner, x, y, z, now, 0);
    const bus = ac.createGain();
    bus.gain.value = r.gain * 0.5 * (o.gain ?? 1);
    bus.connect(panner).connect(this.eng.birdIn);
    const t0 = now + 0.01;
    for (const b of r.beats) {
      this.sfx.burst('pink', b.type, b.freq, b.q, t0 + b.t, 0.003, b.dur, b.gain, bus);
    }
    if (r.whistle) {
      // A duck's wings whistle: a narrow band of noise pulsing with the beats.
      const w = r.whistle;
      const n = Math.max(1, Math.round(w.dur * w.am));
      for (let i = 0; i < n; i++) {
        const t = t0 + i / w.am;
        this.sfx.sweepNoise('white', w.f0, w.f1, 14, t, 0.02, 0.6 / w.am, w.gain * (1 - 0.5 * i / n), bus);
      }
    }
    if (r.splash) {
      this.sfx.sweepNoise('pink', 700, 2400, 0.7, t0, 0.015, r.splash.dur, r.splash.gain, bus);
      this.sfx.sweepNoise('brown', 900, 260, 1.2, t0 + 0.03, 0.02, r.splash.dur * 0.8, r.splash.gain * 0.6, bus, 'lowpass');
    }
    this.live++;
    setTimeout(() => {
      this.live--;
      try { bus.disconnect(); panner.disconnect(); } catch { /* fine */ }
    }, (r.length + 0.5) * 1000);
    return true;
  }
}
