// The ground cover field: what grows where, and how the GPU scatter layers (grass,
// wildflowers, ferns; groundCover.js) are laid out around the camera. Pure: no
// three.js, no DOM.
//
// Two halves:
//
//  1. A small window of textures around the player, one texel per lod-0 terrain vertex
//     (2 m), filled from the loaded chunks a few rows per frame:
//       height  float32           ground height (NO_GROUND where nothing is loaded)
//       color   rgba8  rgb, a     the terrain's sRGB vertex colour, region id
//       cover   rgba8             grass density, grass height, flowers, ferns (0..255)
//       aux     rgba8             normal x, normal z (128 ± 127), canopy, habitat id
//       style   rgba8             soft region weights: marsh, highland, coast, frost (blurStyle)
//     Blades read their root height, colour and density from it, so they always sit
//     on and match the ground, wherever the chunk data says so.
//
//  2. The scatter lattice. Every layer is an infinite square lattice of candidate
//     plants at spacing `base`, fixed in world space (a plant is a pure function of
//     its integer lattice index — it never swims or pops when the camera moves).
//     The lattice is drawn in nested rings: ring k draws every 2^k-th point (spacing
//     base·2^k) in a square of n×n points centred on the camera, minus the square of
//     ring k−1. A point's LEVEL is how many times both its indices divide by two; a
//     level-L point exists in rings 0..L, and fades out with distance before it
//     leaves ring L's square. So density falls smoothly with distance, every visible
//     plant is drawn exactly once, and nothing has to be rebuilt as the camera moves:
//     ring squares just snap to their own spacing.
//
// The shader in groundCover.js implements the same rules (hash, level, fade, inner
// hole); the functions here mirror it for tests and for CPU-side culling.
import { CHUNK_SIZE, HABITAT, REGION, SEA_LEVEL } from './constants.js';

/** Metres per ground-window texel (one lod-0 vertex). */
export const GROUND_TEXEL = 2;
/** Ground-window texels per side (covers ±128 m around its centre). */
export const GROUND_RES = 128;
/** The window re-centres in steps of this many metres. */
export const GROUND_SNAP = 32;
/** Height written where no ground is loaded (blades there are culled). */
export const NO_GROUND = -1000;

/**
 * Window origin (world x/z of texel (0, 0)) for a camera position. Texel centres sit
 * exactly on lod-0 vertices (multiples of 2 m), and the origin moves in GROUND_SNAP steps.
 * @returns {[number, number]}
 */
export function groundOrigin(px, pz) {
  const half = GROUND_RES * GROUND_TEXEL / 2;
  return [Math.round(px / GROUND_SNAP) * GROUND_SNAP - half, Math.round(pz / GROUND_SNAP) * GROUND_SNAP - half];
}

// --- what grows where -------------------------------------------------------------

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Per habitat: [grass density, grass height, flowers, ferns], 0..1.
const HABITAT_COVER = [];
HABITAT_COVER[HABITAT.OCEAN] = [0, 0, 0, 0];
HABITAT_COVER[HABITAT.BEACH] = [0.3, 0.6, 0.05, 0];
HABITAT_COVER[HABITAT.MEADOW] = [1, 0.9, 1, 0.03];
// Woodland and conifer floors keep short (ankle-high) grass so foraging blackbirds and
// robins read clearly; long flowing grass is for open meadow interiors.
HABITAT_COVER[HABITAT.WOODLAND] = [0.62, 0.12, 0.16, 0.42];
HABITAT_COVER[HABITAT.CONIFER] = [0.45, 0.08, 0.05, 0.3];
HABITAT_COVER[HABITAT.MARSH] = [0.85, 0.85, 0.22, 0];
HABITAT_COVER[HABITAT.RIVER] = [0.85, 0.62, 0.3, 0.35];
HABITAT_COVER[HABITAT.ALPINE] = [0.8, 0.32, 0.4, 0.04];
HABITAT_COVER[HABITAT.CLIFF] = [0.12, 0.2, 0.05, 0];
HABITAT_COVER[HABITAT.SNOW] = [0, 0, 0, 0];
HABITAT_COVER[HABITAT.SHRUB] = [0.78, 0.6, 0.16, 0.95];

/**
 * How much a terrain colour reads as living ground cover (0 = bare: trodden earth,
 * rock, sand, snow, mud) from its sRGB bytes. Trails are only a colour in the chunk
 * data, so this is also what keeps grass off them — with a soft edge, because the
 * server blends the trail colour into its surroundings.
 */
export function vegetatedness(r, g, b, region) {
  const green = smooth(10, 28, g - (r + b) / 2) * (1 - smooth(500, 580, r + g + b));
  if (region !== REGION.AMBERWOOD) return green;
  // Amberwood's floor is gold and rust, not green: tell its saturated leaf litter and
  // golden clearings from the duller trodden earth by saturation.
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0;
  return Math.max(green, smooth(0.5, 0.6, sat) * smooth(220, 300, r + g + b));
}

/**
 * Ground cover at one point.
 * @param {number} habitat  core.Habitat
 * @param {number} region   core.RegionID (255 = open water)
 * @param {number} r @param {number} g @param {number} b  sRGB terrain colour bytes
 * @param {number} ny       up component of the ground normal (1 = flat)
 * @param {number} h        ground height (m)
 * @param {number} canopy   tree cover overhead, 0..1
 * @param {number[]|Uint8Array} out  receives [grass, height, flowers, ferns] as bytes at offset o
 * @param {number} [o]
 * @param {number} [mow]  0..1: kept-short ground (around the cabin and other buildings)
 */
export function groundCover(habitat, region, r, g, b, ny, h, canopy, out, o = 0, mow = 0) {
  const base = HABITAT_COVER[habitat] || HABITAT_COVER[HABITAT.MEADOW];
  let grass = base[0], tall = base[1], flower = base[2], fern = base[3];
  if (region === REGION.NONE) grass = tall = flower = fern = 0;

  const living = vegetatedness(r, g, b, region);
  // Nothing grows under water; the wet margin is sparse and short.
  const dry = smooth(SEA_LEVEL + 0.04, SEA_LEVEL + 0.3, h);
  const flat = smooth(0.7, 0.86, ny);
  const k = living * dry * flat;
  grass *= k;
  flower *= k * smooth(0.25, 0.6, h);
  fern *= living * dry * smooth(0.62, 0.8, ny);
  tall *= 0.55 + 0.45 * dry;

  // Trail verges: the grass shortens towards the trodden earth (birds on a path's
  // edge stay visible), not just thins.
  tall *= 0.3 + 0.7 * smooth(0.55, 0.95, living);
  // Shade: shorter, sparser grass and few flowers under dense trees; ferns like it.
  grass *= 1 - 0.55 * canopy;
  tall *= 1 - 0.7 * canopy;
  flower *= 1 - 0.75 * canopy;
  // (Fern hollows and thickets are fern country even in the open.)
  if (habitat !== HABITAT.SHRUB) fern *= 0.4 + 0.6 * Math.min(1, canopy * 1.6);
  // Damp ground near water suits ferns in the woods.
  if (habitat === HABITAT.WOODLAND || habitat === HABITAT.RIVER || habitat === HABITAT.SHRUB) {
    fern = Math.min(1, fern + 0.25 * (1 - smooth(0.6, 3, h)) * living * dry);
  }

  switch (region) {
    case REGION.WINDPEAK: {
      // Wind-cropped turf; the fern layer draws heather cushions here (groundCover.js).
      tall *= 0.6;
      const open = smooth(0.72, 0.86, ny) * dry * (1 - 0.6 * canopy);
      fern = (habitat === HABITAT.CLIFF ? 0.15 : 0.62) * open * smooth(0.15, 0.5, living + 0.25);
      break;
    }
    case REGION.WHISPERING_COAST: {
      tall *= 0.85; fern *= 0.3;
      // Marram on the dunes and the upper beach: it grows from sand, which the colour
      // test above reads as bare. The shader gathers it into tussocks.
      if (habitat === HABITAT.BEACH || habitat === HABITAT.MEADOW) {
        const dune = smooth(0.9, 1.8, h) * smooth(0.8, 0.92, ny);
        grass = Math.max(grass, 0.75 * dune);
        tall = Math.max(tall, 0.55 * dune);
      }
      break;
    }
    case REGION.FROSTVEIL: {
      // Hoar-frosted tufts poking through the snow, in sparse clumps (shader).
      grass = Math.max(grass * 0.45, 0.3 * dry * smooth(0.8, 0.92, ny) * (1 - 0.7 * canopy));
      tall *= 0.5; tall = Math.max(tall, 0.22);
      flower *= 0.4; fern = 0;
      break;
    }
    case REGION.MURMUR_MARSH:
      // Reedbeds and sedge: dense and tall on the wet flats (the shader makes stands
      // of reed and lawns of sedge from it).
      fern = 0;
      if (habitat === HABITAT.MARSH || habitat === HABITAT.RIVER) { grass = Math.max(grass, 0.95 * k); tall = Math.max(tall, 0.95 * dry * living); }
      flower *= 0.5;
      break;
    case REGION.AMBERWOOD: tall *= 0.8; flower *= 0.45; break;
    default: break;
  }

  // Where ferns crowd in, the grass between them is thinner and shorter.
  grass *= 1 - 0.35 * fern;
  tall *= 1 - 0.45 * fern;
  // Mown ground around buildings: short turf, a few flowers, no ferns.
  if (mow > 0) {
    tall *= 1 - 0.85 * mow;
    flower *= 1 - 0.5 * mow;
    fern *= 1 - mow;
  }

  out[o] = toByte(grass);
  out[o + 1] = toByte(tall);
  out[o + 2] = toByte(flower);
  out[o + 3] = toByte(fern);
  return out;
}

function toByte(v) { return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); }

// --- the ground window ----------------------------------------------------------------

/**
 * Canopy cover per lod-0 vertex of a chunk, computed once per chunk object and cached.
 * @param {(x:number, z:number) => number} canopyAt
 */
export function createCanopyCache(canopyAt) {
  const cache = new WeakMap();
  return {
    /** Canopy at grid vertex (ix, iz) of a chunk (any LOD). */
    at(chunk, ix, iz) {
      let grid = cache.get(chunk);
      if (!grid) {
        const n = chunk.n, cell = chunk.cell;
        grid = new Float32Array(n * n);
        const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cz * CHUNK_SIZE;
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) grid[j * n + i] = canopyAt(x0 + i * cell, z0 + j * cell) || 0;
        }
        cache.set(chunk, grid);
      }
      return grid[iz * chunk.n + ix];
    },
  };
}

/**
 * The four byte/float planes of a ground window.
 * @returns {{height:Float32Array, color:Uint8Array, cover:Uint8Array, aux:Uint8Array}}
 */
export function allocGroundPlanes(res = GROUND_RES) {
  return {
    height: new Float32Array(res * res).fill(NO_GROUND),
    color: new Uint8Array(res * res * 4),
    cover: new Uint8Array(res * res * 4),
    aux: new Uint8Array(res * res * 4),
    style: new Uint8Array(res * res * 4),
  };
}

/** Style channel (0..3) of a region id: marsh, highland, coast, frost; -1 for the others. */
export function styleChannel(region) {
  switch (region) {
    case REGION.MURMUR_MARSH: return 0;
    case REGION.WINDPEAK: return 1;
    case REGION.WHISPERING_COAST: return 2;
    case REGION.FROSTVEIL: return 3;
    default: return -1;
  }
}

/**
 * Softens the one-hot style plane written by fillGroundRows into region weights that
 * fade over ~12 m (a separable box blur, radius `r` texels), so plant styles blend
 * where region types meet. In place; `tmp` is scratch of the same size.
 */
export function blurStyle(style, res = GROUND_RES, r = 3, tmp = new Uint8Array(style.length)) {
  const w = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? style : tmp, dst = pass === 0 ? tmp : style;
    for (let a = 0; a < res; a++) {
      for (let ch = 0; ch < 4; ch++) {
        let sum = 0;
        const at = (b) => (pass === 0 ? (a * res + b) : (b * res + a)) * 4 + ch;
        for (let b = -r; b <= r; b++) sum += src[at(Math.min(res - 1, Math.max(0, b)))];
        for (let b = 0; b < res; b++) {
          dst[at(b)] = Math.round(sum / w);
          sum += src[at(Math.min(res - 1, b + r + 1))] - src[at(Math.max(0, b - r))];
        }
      }
    }
  }
  return style;
}

/**
 * Fills rows [row0, row1) of a ground window from the loaded chunks.
 * @param {{chunkAt(x:number, z:number):object|undefined, sampleHeight(x:number, z:number):number}} store
 * @param {{at(chunk:object, ix:number, iz:number):number}} canopy  see createCanopyCache
 * @param {number} ox @param {number} oz  world position of texel (0, 0)
 * @param {ReturnType<typeof allocGroundPlanes>} planes
 * @param {number} [res]
 * @param {((x:number, z:number) => number)|null} [mowAt]  kept-short ground, 0..1 (see mowField)
 */
export function fillGroundRows(store, canopy, ox, oz, planes, row0, row1, res = GROUND_RES, mowAt = null) {
  const { height, color, cover, aux, style } = planes;
  for (let r = row0; r < row1; r++) {
    const z = oz + r * GROUND_TEXEL;
    for (let c = 0; c < res; c++) {
      const x = ox + c * GROUND_TEXEL;
      const t = r * res + c, o = t * 4;
      const chunk = store.chunkAt(x, z);
      if (!chunk) {
        height[t] = NO_GROUND;
        color[o] = color[o + 1] = color[o + 2] = 0; color[o + 3] = REGION.NONE;
        cover[o] = cover[o + 1] = cover[o + 2] = cover[o + 3] = 0;
        aux[o] = 128; aux[o + 1] = 128; aux[o + 2] = 0; aux[o + 3] = 0;
        if (style) style[o] = style[o + 1] = style[o + 2] = style[o + 3] = 0;
        continue;
      }
      // Texel centres are lod-0 vertices; coarser chunks give their nearest vertex for
      // colour and cover, and a bilinear height.
      const fx = (x - chunk.cx * CHUNK_SIZE) / chunk.cell, fz = (z - chunk.cz * CHUNK_SIZE) / chunk.cell;
      const ix = Math.min(chunk.n - 1, Math.max(0, Math.round(fx)));
      const iz = Math.min(chunk.n - 1, Math.max(0, Math.round(fz)));
      const v = iz * chunk.n + ix;
      const h = chunk.lod === 0 ? chunk.heights[v] : store.sampleHeight(x, z);
      height[t] = h === h ? h : NO_GROUND;
      const cr = chunk.colors[v * 3], cg = chunk.colors[v * 3 + 1], cb = chunk.colors[v * 3 + 2];
      const region = chunk.region[v], habitat = chunk.habitat[v];
      color[o] = cr; color[o + 1] = cg; color[o + 2] = cb; color[o + 3] = region;
      const nx = chunk.normals[v * 3] / 127, ny = chunk.normals[v * 3 + 1] / 127, nz = chunk.normals[v * 3 + 2] / 127;
      const cv = canopy.at(chunk, ix, iz);
      groundCover(habitat, region, cr, cg, cb, ny, height[t], cv, cover, o, mowAt ? mowAt(x, z) : 0);
      aux[o] = toSigned(nx); aux[o + 1] = toSigned(nz); aux[o + 2] = toByte(cv); aux[o + 3] = habitat;
      if (style) {
        style[o] = style[o + 1] = style[o + 2] = style[o + 3] = 0;
        const sc = styleChannel(region);
        if (sc >= 0) style[o + sc] = 255;
      }
    }
  }
}

function toSigned(v) { return Math.max(1, Math.min(255, Math.round(128 + v * 127))); }

// --- the scatter lattice ------------------------------------------------------------

/**
 * Integer hash of a lattice index; the shader computes the same thing with uints.
 * Indices are biased to stay non-negative (GLSL int→uint of a negative is undefined).
 * @returns {number} uint32
 */
export function latticeHash(ix, iz) {
  let h = (Math.imul((ix + LATTICE_BIAS) >>> 0, 0x8da6b343) ^ Math.imul((iz + LATTICE_BIAS) >>> 0, 0xd8163841)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
/** Keeps lattice indices positive for hashing (±4 M points each way). */
export const LATTICE_BIAS = 4194304;

/** Level of a lattice point: how many times both indices divide by two (capped). */
export function latticeLevel(ix, iz, maxLevel) {
  let level = 0;
  let m = 2;
  while (level < maxLevel && mod(ix, m) === 0 && mod(iz, m) === 0) { level++; m *= 2; }
  return level;
}

function mod(a, m) { return ((a % m) + m) % m; }

/** Half-size (m) of ring k's square: the distance a level-k plant may live at. */
export function ringReach(cfg, k) { return cfg.n / 2 * cfg.base * (1 << k); }

/** Fraction of the reach at which a level's plants start and finish fading out. */
export const FADE_START = 0.6;
export const FADE_END = 0.92;

/**
 * Visibility (0..1) of a plant of a given level at a distance from the camera: plants
 * of level L shrink away between FADE_START and FADE_END of ring L's reach.
 */
export function levelFade(cfg, level, dist) {
  const reach = ringReach(cfg, level);
  return 1 - smooth(reach * FADE_START, reach * FADE_END, dist);
}

/**
 * Where every ring of a layer sits for a camera position.
 * cfg: {base, n, rings, g}: lattice spacing (m), points per ring side, ring count,
 * patches per ring side (n must be divisible by g).
 * @param {object[]} [out]  reused between calls (no allocation once warm)
 * @returns {{k:number, spacing:number, i0:number, j0:number, n:number}[]}  ring k covers
 *   lattice indices (in its own spacing) [i0, i0+n) × [j0, j0+n)
 */
export function ringLayout(cfg, camX, camZ, out = []) {
  out.length = cfg.rings;
  for (let k = 0; k < cfg.rings; k++) {
    const spacing = cfg.base * (1 << k);
    const r = out[k] || (out[k] = { k: 0, spacing: 0, n: 0, i0: 0, j0: 0 });
    r.k = k; r.spacing = spacing; r.n = cfg.n;
    if (k === 0) {
      r.i0 = Math.round(camX / spacing) - cfg.n / 2;
      r.j0 = Math.round(camZ / spacing) - cfg.n / 2;
    } else {
      // Each coarser ring is centred on the finer ring's square (not on the camera), so
      // the hole is exactly its central n/2 × n/2 points: with g = 4 the four central
      // patches lie wholly inside it and are skipped instead of culled per plant. The
      // offset from the camera stays under half a coarse cell per level.
      const f = out[k - 1];
      r.i0 = Math.ceil(f.i0 / 2) - cfg.n / 4;
      r.j0 = Math.ceil(f.j0 / 2) - cfg.n / 4;
    }
  }
  return out;
}

/**
 * The inner hole of ring k (ring k−1's square) in base-lattice units, as the shader
 * receives it: [minI, minJ, maxI, maxJ) — or null for ring 0.
 * @param {number[]} [out]
 */
export function ringHole(layout, k, out = [0, 0, 0, 0]) {
  if (k === 0) return null;
  const r = layout[k - 1], m = 1 << (k - 1);
  out[0] = r.i0 * m; out[1] = r.j0 * m; out[2] = (r.i0 + r.n) * m; out[3] = (r.j0 + r.n) * m;
  return out;
}

/**
 * Which ring draws the base-lattice point (bi, bj), or -1: the finest ring whose square
 * contains it, if the point lies on that ring's lattice. Mirrors the shader.
 */
export function drawingRing(layout, bi, bj) {
  for (const r of layout) {
    const m = 1 << r.k;
    if (mod(bi, m) !== 0 || mod(bj, m) !== 0) return -1; // coarser rings only hold coarser points
    const i = bi / m, j = bj / m;
    if (i >= r.i0 && i < r.i0 + r.n && j >= r.j0 && j < r.j0 + r.n) return r.k;
  }
  return -1;
}

/**
 * Patches of one ring: g×g blocks of (n/g)² points, each an instanced draw. A patch that
 * lies entirely inside the finer ring's square draws nothing and is skipped.
 * @param {object[]} [out]  reused between calls
 * @returns {{i:number, j:number, inside:boolean}[]}  patch origins in ring-lattice units
 */
export function ringPatches(cfg, layout, k, out = []) {
  const r = layout[k];
  const p = cfg.n / cfg.g;
  const hole = k > 0 ? ringHole(layout, k, HOLE) : null;
  const m = 1 << k;
  out.length = cfg.g * cfg.g;
  for (let pj = 0, q = 0; pj < cfg.g; pj++) {
    for (let pi = 0; pi < cfg.g; pi++, q++) {
      const i = r.i0 + pi * p, j = r.j0 + pj * p;
      const o = out[q] || (out[q] = { i: 0, j: 0, inside: false });
      o.i = i; o.j = j;
      // Its points are i .. i + p − 1: all of them inside the hole?
      o.inside = !!hole && i * m >= hole[0] && j * m >= hole[1] && (i + p - 1) * m < hole[2] && (j + p - 1) * m < hole[3];
    }
  }
  return out;
}
const HOLE = [0, 0, 0, 0];

// --- kept-short ground and gaps around birds -------------------------------------------

/** POI kinds with a building or camp whose surroundings are kept short. */
const MOWN_KINDS = new Set(['cabin', 'ranger_station', 'watchtower', 'shop', 'research_site', 'abandoned_station', 'hidden_cabin', 'camp', 'hide']);

/**
 * A mowAt(x, z) function for fillGroundRows from the POIs (state.pois values): 1 within
 * `inner` metres of a building, fading to 0 by `inner + 12`.
 * @param {Iterable<{kind:string, pos:{x:number, z:number}, radius?:number}>} pois
 */
export function mowField(pois) {
  // state.pois keeps every POI ever streamed (the map shows them), so the spots are
  // bucketed on a coarse grid: a sample only tests the buildings that can reach it,
  // and the cost per sample stays flat however far the player has travelled.
  const cells = new Map(); // cell key → flat [x, z, inner, …]
  let n = 0;
  for (const p of pois || []) {
    if (!p || !MOWN_KINDS.has(p.kind) || !p.pos) continue;
    const inner = Math.max(14, Math.min(30, (p.radius || 0) * 1.5));
    const reach = inner + MOW_FADE;
    const x0 = Math.floor((p.pos.x - reach) / MOW_CELL), x1 = Math.floor((p.pos.x + reach) / MOW_CELL);
    const z0 = Math.floor((p.pos.z - reach) / MOW_CELL), z1 = Math.floor((p.pos.z + reach) / MOW_CELL);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = mowKey(cx, cz);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(p.pos.x, p.pos.z, inner);
      }
    }
    n++;
  }
  if (!n) return null;
  const field = (x, z) => {
    const spots = cells.get(mowKey(Math.floor(x / MOW_CELL), Math.floor(z / MOW_CELL)));
    if (!spots) return 0;
    let m = 0;
    for (let i = 0; i < spots.length; i += 3) {
      const d = Math.hypot(x - spots[i], z - spots[i + 1]);
      const v = 1 - smooth(spots[i + 2], spots[i + 2] + MOW_FADE, d);
      if (v > m) m = v;
    }
    return m;
  };
  field.spots = n;
  field.cells = cells.size;
  return field;
}

/** Metres over which mown ground fades back to full cover. */
const MOW_FADE = 12;
/** Bucket size of mowField's spatial index (m). */
const MOW_CELL = 64;
const mowKey = (cx, cz) => cx * 65536 + cz;

/** Most gaps the ground-cover shaders take (uniform array size). */
export const MAX_GAPS = 12;
/** Gaps are only made for things this close to the camera (m). */
export const GAP_RANGE = 70;
/** A bird counts as on the ground within this height of the terrain (m). */
export const GROUND_BIRD_EPS = 0.35;

/** Height above a ground bird's feet that must stay in sight (its body), m. */
export const SIGHT_BODY = 0.1;
/** y written for a gap without a sight line (the player's feet). */
export const NO_SIGHT = -1e4;

/**
 * Gaps the grass parts around: ground-level birds (nearest first), ground nests and the
 * player's feet. Writes vec4s (x, z, radius scale, height kept) into `out`, and into
 * `outY` the height the camera must see over the plants (bird body; NO_SIGHT for the
 * feet), and returns the count. No allocations.
 * @param {Float32Array} out  MAX_GAPS × 4
 * @param {{x:number, z:number}} cam
 * @param {Iterable<{pos:{x:number,y:number,z:number}, act:number}>} birds
 * @param {(act:number) => boolean} airborne
 * @param {(x:number, z:number) => number} heightAt
 * @param {Iterable<{x:number, y:number, z:number}>} [nests]
 * @param {{x:number, y:number, z:number}|null} [feet]
 * @param {Float32Array} [outY]  MAX_GAPS sight heights
 */
export function collectGaps(out, cam, birds, airborne, heightAt, nests, feet, outY = Y_SCRATCH, lane = null) {
  let n = 0;
  const scratch = SCRATCH;
  const r2 = GAP_RANGE * GAP_RANGE;
  // Keep the nearest candidates (one slot stays for the feet, PRONE_LANE.length more
  // for a prone player's sight lane).
  const useLane = !!(feet && lane && Number.isFinite(lane.dx) && Number.isFinite(lane.dz));
  const cap = MAX_GAPS - (feet ? 1 : 0) - (useLane ? PRONE_LANE.length : 0);
  const consider = (x, y, z, scale, keep) => {
    const dx = x - cam.x, dz = z - cam.z, d2 = dx * dx + dz * dz;
    if (!(d2 <= r2)) return;
    const g = heightAt(x, z);
    if (!(Math.abs(y - g) <= GROUND_BIRD_EPS)) return;
    let slot = n;
    if (n >= cap) { // replace the farthest if this one is nearer
      let far = 0;
      for (let i = 1; i < n; i++) if (scratch[i] > scratch[far]) far = i;
      if (scratch[far] <= d2) return;
      slot = far;
    } else n++;
    scratch[slot] = d2;
    out[slot * 4] = x; out[slot * 4 + 1] = z; out[slot * 4 + 2] = scale; out[slot * 4 + 3] = keep;
    outY[slot] = y + SIGHT_BODY;
  };
  if (birds) for (const b of birds) { const p = b?.pos; if (p && !airborne(b.act)) consider(p.x, p.y, p.z, 1, 0.17); }
  if (nests) for (const ne of nests) if (ne && Number.isFinite(ne.x)) consider(ne.x, ne.y, ne.z, 1.3, 0.2);
  if (feet && Number.isFinite(feet.x)) {
    out[n * 4] = feet.x; out[n * 4 + 1] = feet.z; out[n * 4 + 2] = 0.9; out[n * 4 + 3] = 0.55;
    outY[n] = NO_SIGHT;
    n++;
    // Prone sight lane (player module, the prone stance): lying flat with the eye at
    // ~0.35 m, meadow grass would fill the whole view. A short chain of wider, lower
    // gaps ahead along the view heading opens a low sight line through it; the grass
    // either side (and beyond ~4 m) still frames the view.
    if (useLane) {
      for (const [ahead, scale, keep] of PRONE_LANE) {
        out[n * 4] = feet.x + lane.dx * ahead; out[n * 4 + 1] = feet.z + lane.dz * ahead;
        out[n * 4 + 2] = scale; out[n * 4 + 3] = keep;
        outY[n] = NO_SIGHT;
        n++;
      }
    }
  }
  return n;
}
/** Prone sight lane: [metres ahead of the feet, radius scale, height kept]. */
export const PRONE_LANE = Object.freeze([[0.45, 1.2, 0.22], [1.7, 1.4, 0.34], [3.1, 1.6, 0.5]]);
const Y_SCRATCH = new Float32Array(MAX_GAPS);
const SCRATCH = new Float32Array(MAX_GAPS);

/**
 * Height factor a gap leaves at distance d (mirrors the shader): `keep` within
 * 0.5·scale m, back to 1 by 1.2·scale m.
 */
export function gapHeight(d, scale, keep) {
  return keep + (1 - keep) * smooth(0.5 * scale, 1.2 * scale, d);
}

/**
 * The tallest a plant part may stand at p so it does not hide a gap's sight point from the
 * camera (mirrors the shader's cone): Infinity outside the cone.
 * @param {{x:number, y:number, z:number}} cam
 * @param {number} px @param {number} pz @param {number} gy  plant root and its ground height
 * @param {number} bx @param {number} bz @param {number} by  the sight point
 */
export function sightCap(cam, px, pz, gy, bx, bz, by) {
  const cx = bx - cam.x, cz = bz - cam.z;
  const D = Math.hypot(cx, cz);
  if (D <= 1) return Infinity;
  const dx = cx / D, dz = cz / D;
  const rx = px - cam.x, rz = pz - cam.z;
  const t = (rx * dx + rz * dz) / D;
  if (!(t > 0 && t < 1.08)) return Infinity;
  const lat = Math.abs(rx * dz - rz * dx);
  const w = 0.12 + 0.38 * t;
  if (lat >= w) return Infinity;
  const allow = Math.max(0, cam.y + (by - cam.y) * Math.min(t, 1) - 0.05 - gy);
  const soft = smooth(w * 0.6, w, lat);
  return soft >= 1 ? Infinity : allow + (1e4 - allow) * soft;
}
