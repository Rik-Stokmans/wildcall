// Song sight — pure logic (no three.js, no DOM): how big a ripple is, when a bout
// emits ripples, which singers qualify, and the fixed-size pools that hold it all.
//
// Fairness rules (spec §5, §6, §29.1; contract §3.3) live here so they are testable:
//   - only while playing (no screen open, not on the title screen) and with the setting on;
//   - only birds within RANGE m, or within CLUE_RANGE m when the player holds a live
//     hearing clue for that bird; nothing beyond;
//   - no species information: every ripple looks the same apart from how loud the
//     sound was (song vs. soft contact call).
// Depth testing (never through terrain, trunks or foliage) is the renderer's job.

/** Ripples for any singer this close (m). */
export const RANGE = 35;
/** Ripples reach this far (m) for a bird the player has a live hearing clue for. */
export const CLUE_RANGE = 45;
/** Lifetime of one ring (s). */
export const RING_LIFE = 1.15;
/** Delay between the rings of one burst (s). */
export const STAGGER = 0.17;
/** Within a long phrase, one more ring this often (s). */
export const PHRASE_PULSE = 0.7;
/** Longest bout we schedule for (s); longer songs simply stop rippling. */
export const MAX_BOUT = 9;
/** Emission times per bout are capped at this many. */
export const MAX_EMITS = 18;
/** Final ring radius as a fraction of the view height at full distance factor. */
export const SCREEN_FRAC = 0.032;
/** Upper bound for that fraction (binoculars at high zoom). */
export const MAX_FRAC = 0.11;
/** "There!" beat: the singer is within this many degrees of the crosshair (naked eye). */
export const THERE_DEG = 4.5;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * World-space radius (m) of a ring at its fullest, sized in apparent (screen) terms.
 * The ring covers SCREEN_FRAC of the view height at 25 m and beyond, shrinking a little
 * for close birds (so it is not huge at 5 m) and growing with the square root of the
 * optical zoom (so through binoculars it follows the bird's apparent size somewhat
 * without filling the view).
 * @param {number} dist      metres from the eye to the bird
 * @param {number} fovDeg    current vertical FOV of the camera (degrees)
 * @param {number} nakedDeg  naked-eye vertical FOV (degrees, settings.fov)
 * @param {number} strength  0.6 (soft call) .. 1 (loud song), 1.6 for the "there!" beat
 */
export function ringRadius(dist, fovDeg, nakedDeg, strength = 1) {
  const d = Math.max(0.5, dist);
  const zoom = Math.max(1, nakedDeg / Math.max(0.5, fovDeg));
  const near = clamp(Math.pow(d / 25, 0.4), 0.55, 1);
  const loud = 0.85 + 0.3 * clamp(strength, 0, 1.6);
  const frac = Math.min(MAX_FRAC, SCREEN_FRAC * near * loud * Math.sqrt(zoom));
  const viewH = 2 * d * Math.tan((Math.max(0.5, fovDeg) * Math.PI) / 360);
  return frac * viewH;
}

/** Strength 0.6..1 of a vocalization: loud songs a little stronger than soft calls. */
export function callStrength(call) {
  const loud = clamp(Number(call?.loud) || 0, 0, 1);
  const song = call?.kind === 'song' || call?.kind === 'drum' || call?.kind === 'boom';
  return clamp(0.6 + 0.3 * loud + (song ? 0.12 : 0), 0.6, 1);
}

/** Length (s) of one phrase of a call. */
export function phraseDur(call) {
  let d = 0;
  const notes = call?.notes || [];
  for (let i = 0; i < notes.length; i++) d += (Number(notes[i].dur) || 0) + (Number(notes[i].gap) || 0);
  return d > 0 ? d : 0.5;
}

/**
 * Plan the ripple times (s from the bout's start) of one bout into `out`
 * (a Float32Array of at least MAX_EMITS). Each phrase starts with a burst of `burst`
 * rings STAGGER apart; a phrase longer than ~0.9 s adds one ring every PHRASE_PULSE.
 * Returns the number of times written (sorted ascending).
 */
export function planBout(call, reps, burst, out) {
  const phrase = phraseDur(call);
  const gap = Math.max(0, Number(call?.gap) || 0);
  const n = Math.max(1, Math.round(Number(reps) || 1));
  let k = 0;
  for (let r = 0; r < n && k < out.length; r++) {
    const t0 = r * (phrase + gap);
    if (t0 > MAX_BOUT) break;
    for (let b = 0; b < burst && k < out.length; b++) out[k++] = t0 + b * STAGGER;
    for (let t = t0 + PHRASE_PULSE + (burst - 1) * STAGGER; t < t0 + phrase - 0.2 && k < out.length; t += PHRASE_PULSE) {
      if (t > MAX_BOUT) break;
      out[k++] = t;
    }
  }
  return k;
}

/** Total length (s) of a bout of `reps` phrases (capped at MAX_BOUT). */
export function boutDur(call, reps) {
  const n = Math.max(1, Math.round(Number(reps) || 1));
  const gap = Math.max(0, Number(call?.gap) || 0);
  return Math.min(MAX_BOUT, n * phraseDur(call) + (n - 1) * gap);
}

/**
 * May this bird's song be made visible right now?
 * @param {{enabled:boolean, mode:string, dist:number, hasClue:boolean}} o
 */
export function eligible({ enabled, mode, dist, hasClue }) {
  if (!enabled || mode !== 'play') return false;
  if (!(dist >= 0)) return false;
  return dist <= RANGE || (hasClue && dist <= CLUE_RANGE);
}

/** Crosshair threshold (radians) for the "there!" beat at the current FOV. */
export function thereThreshold(fovDeg) {
  const deg = Math.min(THERE_DEG, Math.max(1, fovDeg * 0.065));
  return (deg * Math.PI) / 180;
}

/** Ease-out for the ring's growth (0..1 → 0..1). */
export const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);

/** Ring opacity over its life (t 0..1): quick fade-in, long soft fade-out. */
export function lifeAlpha(t) {
  if (t <= 0 || t >= 1) return 0;
  const inn = Math.min(1, t / 0.1);
  return inn * Math.pow(1 - t, 1.4);
}

/**
 * Fixed-capacity pool of live rings in parallel typed arrays. spawn() returns a slot
 * index (or -1 when full, the oldest ring is then recycled), kill(i) swap-removes.
 * No allocations after construction.
 */
export class RingPool {
  constructor(cap = 96) {
    this.cap = cap;
    this.n = 0;
    this.bird = new Float64Array(cap);   // bird id (ids are uint32)
    this.age = new Float32Array(cap);    // s
    this.life = new Float32Array(cap);   // s
    this.str = new Float32Array(cap);    // strength
    this.seed = new Float32Array(cap);   // 0..1 shape variation
    this.x = new Float32Array(cap);      // last known emitter position
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
  }
  /** Add a ring; when full, the oldest one is replaced. Returns its slot. */
  spawn(bird, x, y, z, str, seed, life = RING_LIFE) {
    let i = this.n;
    if (i >= this.cap) {
      let oldest = 0;
      for (let j = 1; j < this.n; j++) if (this.age[j] / this.life[j] > this.age[oldest] / this.life[oldest]) oldest = j;
      i = oldest;
    } else this.n++;
    this.bird[i] = bird; this.age[i] = 0; this.life[i] = life; this.str[i] = str; this.seed[i] = seed;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    return i;
  }
  kill(i) {
    const last = --this.n;
    if (i !== last) {
      this.bird[i] = this.bird[last]; this.age[i] = this.age[last]; this.life[i] = this.life[last];
      this.str[i] = this.str[last]; this.seed[i] = this.seed[last];
      this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.z[i] = this.z[last];
    }
  }
  /** Age every ring by dt and drop the finished ones. */
  step(dt) {
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) this.kill(i);
    }
  }
  clear() { this.n = 0; }
}

/**
 * Fixed-capacity table of singing bouts: one per bird, replaced when the same bird
 * starts a new bout. Each holds its planned emission times.
 */
export class BoutTable {
  constructor(cap = 24) {
    this.cap = cap;
    this.n = 0;
    this.bird = new Float64Array(cap);
    this.t = new Float32Array(cap);       // time since the bout started (s)
    this.dur = new Float32Array(cap);
    this.str = new Float32Array(cap);
    this.next = new Uint8Array(cap);      // index of the next emission time
    this.count = new Uint8Array(cap);
    this.times = [];
    for (let i = 0; i < cap; i++) this.times.push(new Float32Array(MAX_EMITS));
  }
  indexOf(bird) {
    for (let i = 0; i < this.n; i++) if (this.bird[i] === bird) return i;
    return -1;
  }
  /** Start (or restart) a bout for `bird`; returns its slot. */
  start(bird, call, reps, startDelay = 0.06) {
    let i = this.indexOf(bird);
    if (i < 0) {
      if (this.n < this.cap) i = this.n++;
      else { // replace the bout that is furthest along
        i = 0;
        for (let j = 1; j < this.n; j++) if (this.t[j] - this.dur[j] > this.t[i] - this.dur[i]) i = j;
      }
    }
    const str = callStrength(call);
    this.bird[i] = bird;
    this.t[i] = -startDelay;
    this.dur[i] = boutDur(call, reps);
    this.str[i] = str;
    this.next[i] = 0;
    this.count[i] = planBout(call, reps, str >= 0.8 ? 3 : 2, this.times[i]);
    return i;
  }
  /** Is bout i still sounding (with a little tail)? */
  active(i) { return this.t[i] >= 0 && this.t[i] <= this.dur[i] + 0.3; }
  /** Remove bout i (swap-remove; the times array is swapped too, no allocation). */
  remove(i) {
    const last = --this.n;
    if (i !== last) {
      this.bird[i] = this.bird[last]; this.t[i] = this.t[last]; this.dur[i] = this.dur[last];
      this.str[i] = this.str[last]; this.next[i] = this.next[last]; this.count[i] = this.count[last];
      const tmp = this.times[i]; this.times[i] = this.times[last]; this.times[last] = tmp;
    }
  }
  clear() { this.n = 0; }
}
