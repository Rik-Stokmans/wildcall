// Colour helpers shared by the pure geometry builders. No three.js, no DOM.
// Everything the GPU receives is linear RGB (three.js's working colour space); colours
// are written as sRGB hex in the source because that is how one thinks about them.

/** sRGB 8-bit value → linear 0..1, as a lookup table. */
export const SRGB_TO_LINEAR = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

/** 0xRRGGBB (sRGB) → [r, g, b] linear. */
export function hex(rgb) {
  return [SRGB_TO_LINEAR[(rgb >> 16) & 255], SRGB_TO_LINEAR[(rgb >> 8) & 255], SRGB_TO_LINEAR[rgb & 255]];
}

/** Linear interpolation between two colours. */
export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Multiplies a colour by a scalar. */
export function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

/**
 * Small deterministic PRNG (mulberry32). Models are generated from fixed seeds so
 * every client builds identical geometry.
 * @returns {() => number} uniform in [0, 1)
 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scrambles a byte into another well-mixed value in [0, 1). */
export function hashByte(v, salt) {
  let h = Math.imul((v + 1) | 0, 0x9e3779b1) ^ Math.imul((salt + 1) | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
