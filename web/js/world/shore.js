// The ground-height texture the water shader reads to find the shallows: a small grid
// of bytes around the player, rebuilt a few rows per frame. Pure: no three.js, no DOM.
//
// A byte encodes ground height in [-SHORE_RANGE, +SHORE_RANGE] metres; unloaded ground
// is written as deep water so no foam appears where the shore is not known yet.

/** Texels per side. */
export const SHORE_RES = 128;
/** Metres per texel. */
export const SHORE_TEXEL = 4;
/** Heights beyond ±this many metres are clamped. */
export const SHORE_RANGE = 4;

/** Height (metres) → byte. */
export function encodeShore(h) {
  if (!(h === h)) return 0;
  const t = (h + SHORE_RANGE) / (2 * SHORE_RANGE);
  return t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * 255);
}

/** Byte → height (metres); the shader does the same. */
export function decodeShore(b) { return b / 255 * 2 * SHORE_RANGE - SHORE_RANGE; }

/** Grid origin (world x/z of texel 0's centre) for a player position, snapped to 64 m. */
export function shoreOrigin(px, pz) {
  const half = SHORE_RES * SHORE_TEXEL / 2;
  return [Math.round(px / 64) * 64 - half + SHORE_TEXEL / 2, Math.round(pz / 64) * 64 - half + SHORE_TEXEL / 2];
}

/**
 * Fills rows [row0, row1) of a shore grid.
 * @param {{sampleHeight(x:number, z:number):number}} store
 * @param {number} ox @param {number} oz  world position of texel (0, 0)
 * @param {Uint8Array} out  SHORE_RES² bytes, row-major (row = z)
 */
export function fillShoreRows(store, ox, oz, out, row0, row1) {
  for (let r = row0; r < row1; r++) {
    const z = oz + r * SHORE_TEXEL;
    const o = r * SHORE_RES;
    for (let c = 0; c < SHORE_RES; c++) out[o + c] = encodeShore(store.sampleHeight(ox + c * SHORE_TEXEL, z));
  }
}
