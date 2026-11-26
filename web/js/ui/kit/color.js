// Tiny pure colour helpers for the bird art (no DOM).

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const h2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export function toHex([r, g, b]) { return '#' + h2(r) + h2(g) + h2(b); }

/** Linear blend of two hex colours: t = 0 → a, t = 1 → b. */
export function mix(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
}
export const lighten = (hex, t) => mix(hex, '#ffffff', t);
export const darken = (hex, t) => mix(hex, '#1f1710', t);

/** rgba() string from a hex colour. */
export function rgba(hex, alpha = 1) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Relative luminance 0..1 (for choosing outline / highlight strength). */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Colour words used by Traits.Primary/Secondary → soft crayon swatches for the generic sketch. */
export const COLOR_WORD_SWATCH = {
  brown: '#8a6a4b', black: '#3f3a36', grey: '#8c9094', gray: '#8c9094', white: '#f1ece2', blue: '#5d86b0',
  green: '#6f9a55', yellow: '#e2c24c', red: '#c5533f', orange: '#d98a3d', buff: '#d2b585', pink: '#d99aa6',
};
