// Small deterministic random helpers shared by the audio code. Pure: no DOM, no
// Web Audio, no three.js, so the schedulers built on it can be unit tested in node.

/**
 * mulberry32: a tiny, fast, well-distributed 32-bit PRNG. The same seed always yields
 * the same sequence, which keeps a bird's bout reproducible from CallMsg.seed.
 * @param {number} seed any number (coerced to uint32)
 * @returns {() => number} generator of floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [a, b). */
export function between(rng, a, b) {
  return a + (b - a) * rng();
}

/** Symmetric jitter: a value in [-amount, +amount). */
export function jitter(rng, amount) {
  return (rng() * 2 - 1) * amount;
}

/** Uniform integer in [a, b] inclusive. */
export function intBetween(rng, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Pick one element of a non-empty array. */
export function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

/**
 * Smooth 1-D value noise in [0, 1): random lattice values one unit apart, joined by a
 * smoothstep. Ambience uses it so gusts, swells and drifts never repeat obviously.
 * @param {number} seed
 * @returns {(t: number) => number}
 */
export function valueNoise1D(seed) {
  const base = hashSeed('vn', seed);
  const lattice = (i) => {
    let h = Math.imul((i | 0) ^ base, 0x27d4eb2d) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };
  return function noise(t) {
    const i = Math.floor(t);
    const f = t - i;
    const s = f * f * (3 - 2 * f);
    const a = lattice(i), b = lattice(i + 1);
    return a + (b - a) * s;
  };
}

/** FNV-1a style hash of a list of numbers/strings into a uint32 seed. */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
