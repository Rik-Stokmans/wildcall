// The far field: low-detail terrain drawn beyond the streaming ring, so that from high
// ground the world reads as layered scenery fading into the haze instead of ending at
// the edge of the loaded chunks. Pure planning and data shaping (no three.js, no DOM);
// farTerrain.js draws it.
//
//   * Chunks between the streaming ring and FAR_RADIUS are requested at lod 2 (8 m
//     cells) — a few at a time and only while the near ring has nothing in flight, so
//     the world around the player always comes first.
//   * Their vegetation is dropped; woods become a "canopy blanket" instead: the ground
//     under them is raised to crown height and painted the colour of the crowns (by
//     region type), so ridges carry tree lines and forests read as dark masses.
//   * Chunks are merged into sectors of SECTOR × SECTOR chunks (one draw call each),
//     leaving out every chunk the near ring holds itself.
import { CHUNK_SIZE, HABITAT, REGION } from './constants.js';
import { chunkKey } from './heightfield.js';
import { inRing } from './streamer.js';

/** Far ring radius in chunks per quality (0 = no far field). */
export const FAR_RADIUS = Object.freeze({ low: 8, medium: 12, high: 16 });
/** Chunks per sector side. */
export const SECTOR = 8;
/** Far requests allowed in flight at once. */
export const FAR_INFLIGHT = 3;
/** Seconds before an unanswered far request may be sent again. */
export const FAR_TIMEOUT = 8;

/** The far ring radius for a settings.quality name. */
export function farRadiusOf(quality) { return FAR_RADIUS[quality] ?? FAR_RADIUS.medium; }

const ringCache = new Map();
/**
 * Chunk offsets of the far annulus (inside `far`, outside `near`), nearest first.
 * @returns {{dx:number, dz:number, d:number}[]}
 */
export function farOffsets(near, far) {
  const key = near * 1000 + far;
  let list = ringCache.get(key);
  if (list) return list;
  list = [];
  const r = Math.ceil(far + 0.5);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (inRing(dx, dz, far) && !inRing(dx, dz, near)) list.push({ dx, dz, d: Math.hypot(dx, dz) });
    }
  }
  list.sort((a, b) => a.d - b.d || Math.atan2(a.dz, a.dx) - Math.atan2(b.dz, b.dx));
  ringCache.set(key, list);
  return list;
}

/** Sector coordinate of a chunk coordinate. */
export function sectorOf(c) { return Math.floor(c / SECTOR); }

/**
 * Request bookkeeping for the far field.
 */
export class FarPlanner {
  constructor() {
    /** key → chunk data held */
    this.have = new Map();
    /** key → time requested */
    this.inflight = new Map();
  }

  reset() { this.have.clear(); this.inflight.clear(); }

  /**
   * Requests to send now (at most `cap` − in flight), nearest missing chunks first.
   * @param {number} pcx @param {number} pcz  player chunk
   * @returns {{cx:number, cz:number}[]}
   */
  plan(pcx, pcz, near, far, now, cap = FAR_INFLIGHT) {
    const out = [];
    for (const [k, t] of this.inflight) if (now - t > FAR_TIMEOUT) this.inflight.delete(k);
    let budget = cap - this.inflight.size;
    if (budget <= 0 || far <= near) return out;
    for (const o of farOffsets(near, far)) {
      const cx = pcx + o.dx, cz = pcz + o.dz;
      const k = chunkKey(cx, cz);
      if (this.have.has(k) || this.inflight.has(k)) continue;
      this.inflight.set(k, now);
      out.push({ cx, cz });
      if (--budget <= 0) break;
    }
    return out;
  }

  /** True if a frame for this chunk was asked for by the far field. */
  wants(cx, cz) { return this.inflight.has(chunkKey(cx, cz)); }

  /** Stores arrived data; returns its key. */
  accept(chunk) {
    const k = chunkKey(chunk.cx, chunk.cz);
    this.inflight.delete(k);
    this.have.set(k, chunk);
    return k;
  }

  /**
   * Drops chunks outside the far ring (plus one chunk of slack).
   * @returns {object[]} the chunks dropped
   */
  evict(pcx, pcz, far) {
    const gone = [];
    const r = far + 1.5;
    for (const [k, c] of this.have) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > r * r) { this.have.delete(k); gone.push(c); }
    }
    return gone;
  }
}

// --- the canopy blanket -------------------------------------------------------------

const rgb = (r, g, b) => [r, g, b];
/** Crown colour seen from afar (sRGB) per region type: broadleaf woods, pine stands. */
const CROWN = {
  [REGION.GREENHOLLOW]: [rgb(62, 92, 44), rgb(44, 72, 50)],
  [REGION.MURMUR_MARSH]: [rgb(92, 106, 56), rgb(70, 84, 56)],
  [REGION.WINDPEAK]: [rgb(54, 76, 58), rgb(44, 66, 56)],
  [REGION.WHISPERING_COAST]: [rgb(66, 90, 58), rgb(50, 74, 56)],
  [REGION.AMBERWOOD]: [rgb(168, 92, 38), rgb(80, 78, 46)],
  [REGION.FROSTVEIL]: [rgb(118, 138, 140), rgb(104, 126, 130)],
};
/** How tall the blanket stands (m) and how densely it covers, per habitat. */
function canopyOf(habitat) {
  switch (habitat) {
    case HABITAT.WOODLAND: return { lift: 8, cover: 0.9, pine: 0 };
    case HABITAT.CONIFER: return { lift: 10, cover: 0.85, pine: 1 };
    case HABITAT.SHRUB: return { lift: 2.5, cover: 0.55, pine: 0 };
    default: return null;
  }
}

/**
 * A copy of a lod-2 chunk shaped for the far field: wooded vertices raised to crown
 * height and coloured like crowns; `blanket` (0..1 per vertex) marks them for the
 * terrain shader (no grass, no litter). Vegetation is dropped.
 * @param {import('./chunkCodec.js').ChunkData} chunk
 */
export function farChunk(chunk) {
  const n = chunk.n, nn = n * n;
  const heights = Float32Array.from(chunk.heights);
  const colors = Uint8Array.from(chunk.colors);
  const blanket = new Float32Array(nn);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < nn; i++) {
    const c = canopyOf(chunk.habitat[i]);
    const reg = chunk.region[i];
    if (c && heights[i] > 0.6 && CROWN[reg]) {
      const crown = CROWN[reg][c.pine];
      // A little variety from vertex to vertex, like crowns of different trees.
      const jitter = 0.88 + 0.24 * (((i * 2654435761) >>> 0) % 1000) / 1000;
      for (let k = 0; k < 3; k++) {
        colors[i * 3 + k] = Math.round(colors[i * 3 + k] + (crown[k] * jitter - colors[i * 3 + k]) * c.cover);
      }
      heights[i] += c.lift * c.cover;
      blanket[i] = c.cover;
    }
    if (heights[i] < minY) minY = heights[i];
    if (heights[i] > maxY) maxY = heights[i];
  }
  return {
    cx: chunk.cx, cz: chunk.cz, lod: chunk.lod, n, cell: chunk.cell,
    heights, normals: chunk.normals, colors, region: chunk.region, habitat: chunk.habitat,
    blanket, minY, maxY, veg: { count: 0 },
  };
}

/** World x/z of a sector's origin (its first chunk's corner). */
export function sectorOrigin(sx, sz) { return [sx * SECTOR * CHUNK_SIZE, sz * SECTOR * CHUNK_SIZE]; }
