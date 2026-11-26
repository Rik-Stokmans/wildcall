// The loaded terrain as a queryable height field. Pure: no three.js, no DOM.
//
// One ChunkData is held per chunk coordinate — whatever LOD is currently meshed there —
// so "the finest loaded LOD" for a point is simply the chunk that covers it.
import { CHUNK_SIZE, HABITAT, REGION, SEA_LEVEL } from './constants.js';

// Chunk keys pack two signed coordinates into one double so lookups allocate nothing.
// 2^25 chunks each way is ±2 million km — far beyond where float32 vertex data is still
// usable, so this is not a world bound in any practical sense.
const KEY_BIAS = 0x2000000;
const KEY_SPAN = 0x4000000;

/** Stable numeric map key for a signed chunk coordinate pair. */
export function chunkKey(cx, cz) { return (cx + KEY_BIAS) * KEY_SPAN + (cz + KEY_BIAS); }

/** Inverse of chunkKey: the x chunk coordinate packed into a key. */
export function keyCx(key) { return Math.floor(key / KEY_SPAN) - KEY_BIAS; }
/** Inverse of chunkKey: the z chunk coordinate packed into a key. */
export function keyCz(key) { return key % KEY_SPAN - KEY_BIAS; }

/** Chunk coordinate containing a world coordinate (floor, so negatives work). */
export function chunkCoord(v) { return Math.floor(v / CHUNK_SIZE); }

/**
 * Footstep surface for a point, from what the chunk says about it.
 * @param {number} habitat  core.Habitat
 * @param {number} height   ground height in metres
 * @param {number} region   core.RegionID (255 = open water)
 * @returns {'grass'|'leaf'|'sand'|'rock'|'snow'|'water'|'mud'}
 */
export function surfaceFor(habitat, height, region) {
  // Frostveil's frozen lakes sit above the water plane, so anything below it is wet.
  if (height < SEA_LEVEL - 0.05) return 'water';
  if (region === REGION.FROSTVEIL || habitat === HABITAT.SNOW) return 'snow';
  switch (habitat) {
    case HABITAT.BEACH:
    case HABITAT.OCEAN: return 'sand';
    case HABITAT.ALPINE:
    case HABITAT.CLIFF: return 'rock';
    case HABITAT.MARSH: return 'mud';
    // River banks are soft right at the waterline and ordinary turf above it.
    case HABITAT.RIVER: return height < SEA_LEVEL + 0.35 ? 'mud' : 'grass';
    case HABITAT.WOODLAND:
    case HABITAT.CONIFER:
    case HABITAT.SHRUB: return 'leaf';
    default: return 'grass';
  }
}

export class ChunkStore {
  constructor() {
    /** @type {Map<number, import('./chunkCodec.js').ChunkData>} */
    this.chunks = new Map();
    this._last = null; // most queries hit the same chunk as the previous one
    /** Bumped whenever the set of loaded chunks (or a chunk's LOD) changes. */
    this.version = 0;
  }

  get size() { return this.chunks.size; }

  /** Stores (or replaces) the chunk at its coordinate. */
  set(chunk) {
    this.chunks.set(chunkKey(chunk.cx, chunk.cz), chunk);
    this._last = null;
    this.version++;
  }

  /** Removes the chunk at a coordinate; returns whether there was one. */
  delete(cx, cz) {
    const had = this.chunks.delete(chunkKey(cx, cz));
    if (had) { this._last = null; this.version++; }
    return had;
  }

  clear() {
    this.chunks.clear();
    this._last = null;
    this.version++;
  }

  /** @returns {import('./chunkCodec.js').ChunkData | undefined} */
  get(cx, cz) { return this.chunks.get(chunkKey(cx, cz)); }

  /** LOD loaded at a chunk coordinate, or -1. */
  lodOf(cx, cz) {
    const c = this.chunks.get(chunkKey(cx, cz));
    return c ? c.lod : -1;
  }

  /** The chunk covering a world position, or undefined. */
  chunkAt(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const last = this._last;
    if (last && last.cx === cx && last.cz === cz) return last;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) this._last = c;
    return c;
  }

  isLoaded(x, z) { return this.chunkAt(x, z) !== undefined; }

  /**
   * Bilinear ground height, or NaN where no chunk is loaded.
   * @returns {number}
   */
  sampleHeight(x, z) {
    const c = this.chunkAt(x, z);
    if (!c) return NaN;
    const n = c.n, last = n - 2;
    let fx = (x - c.cx * CHUNK_SIZE) / c.cell;
    let fz = (z - c.cz * CHUNK_SIZE) / c.cell;
    let ix = Math.floor(fx), iz = Math.floor(fz);
    // Clamp so the far edge interpolates inside the last cell (rounding can put a
    // point a hair outside its own chunk).
    if (ix < 0) ix = 0; else if (ix > last) ix = last;
    if (iz < 0) iz = 0; else if (iz > last) iz = last;
    fx -= ix; fz -= iz;
    if (fx < 0) fx = 0; else if (fx > 1) fx = 1;
    if (fz < 0) fz = 0; else if (fz > 1) fz = 1;
    const h = c.heights;
    const i = iz * n + ix;
    const a = h[i], b = h[i + 1], d = h[i + n], e = h[i + n + 1];
    const top = a + (b - a) * fx;
    const bottom = d + (e - d) * fx;
    return top + (bottom - top) * fz;
  }

  /** Bilinear ground height; 0 (sea level) where nothing is loaded. */
  heightAt(x, z) {
    const h = this.sampleHeight(x, z);
    return h === h ? h : 0;
  }

  /** Depth of standing water above the ground: max(0, -height). */
  waterDepthAt(x, z) {
    const h = this.sampleHeight(x, z);
    return h === h && h < SEA_LEVEL ? SEA_LEVEL - h : 0;
  }

  /** Index of the grid vertex nearest to a world position inside chunk c. */
  _nearest(c, x, z) {
    const max = c.n - 1;
    let ix = Math.round((x - c.cx * CHUNK_SIZE) / c.cell);
    let iz = Math.round((z - c.cz * CHUNK_SIZE) / c.cell);
    if (ix < 0) ix = 0; else if (ix > max) ix = max;
    if (iz < 0) iz = 0; else if (iz > max) iz = max;
    return iz * c.n + ix;
  }

  /** core.RegionID at a point (nearest vertex); 255 if open water or not loaded. */
  regionAt(x, z) {
    const c = this.chunkAt(x, z);
    return c ? c.region[this._nearest(c, x, z)] : REGION.NONE;
  }

  /** core.Habitat at a point (nearest vertex); 0 if not loaded. */
  habitatAt(x, z) {
    const c = this.chunkAt(x, z);
    return c ? c.habitat[this._nearest(c, x, z)] : 0;
  }

  /** Footstep surface at a point; 'grass' where nothing is loaded. */
  surfaceAt(x, z) {
    const c = this.chunkAt(x, z);
    if (!c) return 'grass';
    const i = this._nearest(c, x, z);
    return surfaceFor(c.habitat[i], this.sampleHeight(x, z), c.region[i]);
  }

  /**
   * Marches a ray across the loaded terrain and writes the first hit into out.
   * The step grows with distance (fine near the eye, coarse far away) and the crossing
   * is refined by bisection. Unloaded ground cannot be hit.
   * @param {number} ox @param {number} oy @param {number} oz  origin
   * @param {number} dx @param {number} dy @param {number} dz  direction (any length)
   * @param {number} maxDist  metres
   * @param {{x:number, y:number, z:number}} out  receives the hit point
   * @returns {boolean} whether the ray hit the ground within maxDist
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 1e-9) || !(maxDist > 0)) return false;
    dx /= len; dy /= len; dz /= len;
    let h = this.sampleHeight(ox, oz);
    if (h === h && oy <= h) { // already at or under the surface
      out.x = ox; out.y = h; out.z = oz;
      return true;
    }
    let prev = 0;
    let t = 0;
    while (t < maxDist) {
      t = Math.min(maxDist, t + Math.max(0.75, t * 0.02));
      const x = ox + dx * t, z = oz + dz * t, y = oy + dy * t;
      h = this.sampleHeight(x, z);
      if (h === h && y <= h) {
        let lo = prev, hi = t;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) * 0.5;
          const mh = this.sampleHeight(ox + dx * mid, oz + dz * mid);
          // An unloaded midpoint counts as open air so the search stays on loaded ground.
          if (mh === mh && oy + dy * mid <= mh) hi = mid; else lo = mid;
        }
        const hx = ox + dx * hi, hz = oz + dz * hi;
        const hh = this.sampleHeight(hx, hz);
        out.x = hx; out.z = hz;
        out.y = hh === hh ? hh : oy + dy * hi;
        return true;
      }
      prev = t;
    }
    return false;
  }
}
