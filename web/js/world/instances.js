// Per-instance transforms and colours for the vegetation of one chunk.
// Pure: no three.js, no DOM — vegetation.js hands these arrays to InstancedMesh.
//
// The server sends position, uniform scale, rotation and a `variant` byte per
// instance; everything else that makes two oaks look different (girth, tone, which
// colour a flower patch is) is derived here from that byte, deterministically.
import { SEA_LEVEL, VEG, VEG_INFO, VEG_KIND_COUNT } from './constants.js';
import { hex, hashByte } from './color.js';

const FLOWER_COLORS = [0xffffff, 0xf6d955, 0x9a7fd6, 0xe58fb0, 0x7fa6e0, 0xe2603c].map(hex);
const MUSHROOM_COLORS = [0xc8452e, 0xa9794d, 0xd8c8a0, 0x8a5a3a].map(hex);

const TREE = 0, BUSH = 1, STONE = 2, SMALL = 3;
const SHAPE = new Uint8Array(VEG_KIND_COUNT).fill(SMALL);
for (const k of [VEG.OAK, VEG.BIRCH, VEG.PINE, VEG.SNAG, VEG.AMBER_OAK, VEG.AMBER_BIRCH, VEG.SNOW_PINE]) SHAPE[k] = TREE;
SHAPE[VEG.SHRUB] = BUSH;
SHAPE[VEG.ROCK] = STONE;

/**
 * Whether the world draws an instance at the quality setting's decoration density. Only small
 * ground decoration is ever thinned: trees, shrubs, reeds and rocks are places birds
 * perch and hide, so every client must draw all of them.
 */
export function keepInstance(kind, variant, x, z, density) {
  // Forage plants (and anything else past the drawn kinds) are the forage module's to draw.
  if (!(kind < VEG_KIND_COUNT)) return false;
  if (density >= 1 || !VEG_INFO[kind].decor) return true;
  return hashByte(variant, (Math.floor(x * 4) * 31 + Math.floor(z * 4) * 17) & 0xffff) < density;
}

/**
 * Counts the instances of every kind that will be drawn.
 * @param {import('./chunkCodec.js').VegData} veg
 * @param {number} density  0..1 fraction of ground decoration kept
 * @param {Uint32Array} counts  length 18, overwritten
 */
export function countInstances(veg, density, counts) {
  counts.fill(0);
  for (let i = 0; i < veg.count; i++) {
    if (keepInstance(veg.kind[i], veg.variant[i], veg.x[i], veg.z[i], density)) counts[veg.kind[i]]++;
  }
  return counts;
}

/**
 * Colour multiplier of an instance (linear RGB, around 1).
 * @param {number} kind @param {number} variant
 * @param {Float32Array|number[]} out  receives r, g, b at offset o
 */
export function instanceTint(kind, variant, out, o = 0) {
  if (kind === VEG.FLOWERS) {
    const c = FLOWER_COLORS[variant % FLOWER_COLORS.length];
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
    return;
  }
  if (kind === VEG.MUSHROOM) {
    const c = MUSHROOM_COLORS[variant % MUSHROOM_COLORS.length];
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
    return;
  }
  const tone = hashByte(variant, 1), warm = hashByte(variant, 5) - 0.5;
  if (kind === VEG.ROCK) {
    const b = 0.8 + tone * 0.35;
    const mossy = hashByte(variant, 9) > 0.7;
    out[o] = b * (1 + warm * 0.1) * (mossy ? 0.92 : 1);
    out[o + 1] = b * (mossy ? 1.02 : 1);
    out[o + 2] = b * (1 - warm * 0.1) * (mossy ? 0.86 : 1);
    return;
  }
  // Snow must stay white; everything else gets a few percent of tone and warmth.
  const range = kind === VEG.SNOW_PINE ? 0.08 : 0.26;
  const shift = kind === VEG.SNOW_PINE ? 0 : kind === VEG.AMBER_OAK || kind === VEG.AMBER_BIRCH ? 0.3 : 0.16;
  const b = 1 - range / 2 + tone * range;
  out[o] = b * (1 + warm * shift);
  out[o + 1] = b;
  out[o + 2] = b * (1 - warm * shift);
}

/**
 * Writes the instance matrices (column-major 4×4, chunk-local) and colours of one
 * vegetation kind.
 * @param {import('./chunkCodec.js').VegData} veg
 * @param {number} kind
 * @param {number} originX  world position of the chunk origin
 * @param {number} originZ
 * @param {number} density
 * @param {{minY:number, maxY:number, radius:number}} model  the kind's model extents at scale 1
 * @param {Float32Array} matrices  16 floats per instance
 * @param {Float32Array} colors    3 floats per instance
 * @param {{minY:number, maxY:number, reach:number}} bounds  receives the extent of what was written
 * @returns {number} instances written
 */
export function fillInstances(veg, kind, originX, originZ, density, model, matrices, colors, bounds) {
  const shape = SHAPE[kind];
  let n = 0, minY = Infinity, maxY = -Infinity, reach = 0;
  for (let i = 0; i < veg.count; i++) {
    if (veg.kind[i] !== kind) continue;
    const variant = veg.variant[i];
    if (!keepInstance(kind, variant, veg.x[i], veg.z[i], density)) continue;
    const s = veg.scale[i];
    const h2 = hashByte(variant, 2), h3 = hashByte(variant, 3), h4 = hashByte(variant, 4);
    let sx, sy, sz;
    if (shape === TREE) {
      // Height stays exactly as sent: the server places perches at fractions of it.
      sx = sz = s * (0.92 + 0.16 * h2); sy = s;
    } else if (shape === BUSH) {
      sx = s * (0.85 + 0.3 * h2); sz = s * (0.85 + 0.3 * h3); sy = s * (0.9 + 0.2 * h4);
    } else if (shape === STONE) {
      sx = s * (0.75 + 0.55 * h2); sz = s * (0.75 + 0.55 * h3); sy = s * (0.65 + 0.6 * h4);
    } else {
      sx = sz = s * (0.85 + 0.3 * h2); sy = s * (0.85 + 0.3 * h3);
    }
    let y = veg.y[i];
    // Lily pads float: whatever height the server gives, they rest on the water.
    if (kind === VEG.LILY_PADS) { y = Math.max(y, SEA_LEVEL) + 0.03; sy = s; }
    const c = Math.cos(veg.rot[i]), sn = Math.sin(veg.rot[i]);
    const o = n * 16;
    matrices[o] = c * sx; matrices[o + 1] = 0; matrices[o + 2] = -sn * sx; matrices[o + 3] = 0;
    matrices[o + 4] = 0; matrices[o + 5] = sy; matrices[o + 6] = 0; matrices[o + 7] = 0;
    matrices[o + 8] = sn * sz; matrices[o + 9] = 0; matrices[o + 10] = c * sz; matrices[o + 11] = 0;
    matrices[o + 12] = veg.x[i] - originX; matrices[o + 13] = y; matrices[o + 14] = veg.z[i] - originZ; matrices[o + 15] = 1;
    instanceTint(kind, variant, colors, n * 3);
    const lo = y + model.minY * sy, hi = y + model.maxY * sy;
    if (lo < minY) minY = lo;
    if (hi > maxY) maxY = hi;
    const r = model.radius * Math.max(sx, sz);
    if (r > reach) reach = r;
    n++;
  }
  bounds.minY = minY; bounds.maxY = maxY; bounds.reach = reach;
  return n;
}
