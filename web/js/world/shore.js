// The ground-height texture the water shader reads to find the shallows: a small grid
// of bytes around the player, rebuilt a few rows per frame; and the rocks that break the
// surface nearby (for foam rings). Pure: no three.js, no DOM.
import { CHUNK_SIZE, SEA_LEVEL, VEG } from './constants.js';
//
// A byte encodes ground height in [-SHORE_RANGE, +SHORE_RANGE] metres; unloaded ground
// is written as deep water so no foam appears where the shore is not known yet.

/** Texels per side. */
export const SHORE_RES = 256;
/** Metres per texel (one lod-0 cell: fine enough for a foam line along a 3 m creek). */
export const SHORE_TEXEL = 2;
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

/** Vegetation kinds that break the water surface and gather foam around them. */
const FOAM_KINDS = new Set([VEG.ROCK, VEG.LOG, VEG.DRIFTWOOD, VEG.STUMP]);
/** Footprint radius at scale 1 of each foam kind where it meets the water. */
const FOAM_RADIUS = { [VEG.ROCK]: 0.55, [VEG.LOG]: 0.35, [VEG.DRIFTWOOD]: 0.3, [VEG.STUMP]: 0.4 };

/**
 * The nearest objects standing in water around a point: rocks, logs and stumps whose
 * base is under the surface and whose top is above it.
 * @param {{chunks: Map<number, {cx:number, cz:number, veg:object}>}} store
 * @param {number} px @param {number} pz  around this point
 * @param {number} range  metres
 * @param {Float32Array} out  4 floats per object (x, z, radius, strength), nearest first;
 *        unused slots are zeroed
 * @returns {number} objects written
 */
export function collectWaterRocks(store, px, pz, range, out) {
  const max = out.length >> 2;
  const found = [];
  const reach = Math.ceil(range / CHUNK_SIZE);
  const ccx = Math.floor(px / CHUNK_SIZE), ccz = Math.floor(pz / CHUNK_SIZE);
  for (const chunk of store.chunks.values()) {
    if (Math.abs(chunk.cx - ccx) > reach || Math.abs(chunk.cz - ccz) > reach) continue;
    const v = chunk.veg;
    for (let i = 0; i < v.count; i++) {
      const kind = v.kind[i];
      if (!FOAM_KINDS.has(kind)) continue;
      const y = v.y[i], s = v.scale[i];
      if (y > SEA_LEVEL + 0.15 || y + s * 0.7 < SEA_LEVEL + 0.03) continue;
      const dx = v.x[i] - px, dz = v.z[i] - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > range * range) continue;
      // Deeper bases show a smaller cross-section at the surface.
      const r = FOAM_RADIUS[kind] * s * Math.max(0.45, 1 - Math.max(0, -y) * 0.35);
      found.push({ d2, x: v.x[i], z: v.z[i], r, k: Math.min(1, 0.4 + s * 0.5) });
    }
  }
  found.sort((a, b) => a.d2 - b.d2);
  const n = Math.min(max, found.length);
  out.fill(0);
  for (let i = 0; i < n; i++) {
    const f = found[i];
    out[i * 4] = f.x; out[i * 4 + 1] = f.z; out[i * 4 + 2] = f.r; out[i * 4 + 3] = f.k;
  }
  return n;
}
