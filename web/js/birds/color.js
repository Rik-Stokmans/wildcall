// Colour helpers for bird vertex colours. Pure module (no three.js).
//
// Palette colours arrive as "#rrggbb" sRGB. three.js treats vertex colours as linear
// (ColorManagement is on and the renderer outputs sRGB), so painted colours are
// converted to linear before they are written into geometry.

const FALLBACK = [0.5, 0.45, 0.4];

/** Parse "#rrggbb" (or "#rgb") into an sRGB triple 0..1. Invalid input → neutral brown-grey. */
export function parseHex(hex) {
  if (typeof hex !== 'string') return FALLBACK.slice();
  let h = hex.trim();
  if (h[0] === '#') h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return FALLBACK.slice();
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB component → linear component. */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Write the linear version of an sRGB triple into out (or a new array). */
export function toLinear(rgb, out = [0, 0, 0]) {
  out[0] = srgbToLinear(rgb[0]);
  out[1] = srgbToLinear(rgb[1]);
  out[2] = srgbToLinear(rgb[2]);
  return out;
}

/** Linear blend a→b by t into out. */
export function mix(a, b, t, out = [0, 0, 0]) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

const CREAM = parseHex('#f2ede0');

/**
 * Leucistic tint for FlagRarePlumage: plumage washes out towards cream while keeping a
 * ghost of its pattern (so the bird is still recognisable, just strikingly pale).
 * Bare parts (eye, bill, legs) keep most of their colour, as in real leucism.
 * @param {number[]} rgb sRGB triple
 * @param {boolean} bare true for eye / bill / legs
 */
export function leucistic(rgb, bare = false, out = [0, 0, 0]) {
  return mix(rgb, CREAM, bare ? 0.25 : 0.72, out);
}

/** Relative luminance-ish brightness of an sRGB triple (0..1); used for speck tinting. */
export function brightness(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
