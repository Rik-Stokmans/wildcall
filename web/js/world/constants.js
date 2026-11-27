// Shared numbers for the world module. Pure data: no three.js, no DOM.
//
// Wire values (vegetation kinds, region and habitat ids) mirror internal/core/types.go
// and must never be reordered here either.

/** Metres per chunk side (core.ChunkSize). */
export const CHUNK_SIZE = 64;
/** Sea level: every body of standing water is the plane y = 0. */
export const SEA_LEVEL = 0;
/** Coarsest level of detail the server produces. */
export const MAX_LOD = 2;

/** Cell size in metres for a LOD (lod 0 → 2 m, 1 → 4 m, 2 → 8 m). */
export function cellSize(lod) { return 2 << lod; }
/** Vertices per chunk side for a LOD (33, 17, 9). */
export function gridSize(lod) { return CHUNK_SIZE / cellSize(lod) + 1; }

// --- regions (core.RegionID) -------------------------------------------------
export const REGION = Object.freeze({
  GREENHOLLOW: 0, MURMUR_MARSH: 1, WINDPEAK: 2, WHISPERING_COAST: 3, AMBERWOOD: 4, FROSTVEIL: 5,
  NONE: 255, // open water away from any shore; also "not loaded"
});

// --- habitats (core.Habitat) -------------------------------------------------
export const HABITAT = Object.freeze({
  OCEAN: 0, BEACH: 1, MEADOW: 2, WOODLAND: 3, CONIFER: 4, MARSH: 5, RIVER: 6, ALPINE: 7, CLIFF: 8,
  SNOW: 9, SHRUB: 10,
});

// --- vegetation (core.VegKind) -------------------------------------------------
export const VEG = Object.freeze({
  OAK: 0, BIRCH: 1, PINE: 2, SNAG: 3, SHRUB: 4, REEDS: 5, ROCK: 6, FLOWERS: 7, GRASS_TUFT: 8, LOG: 9,
  STUMP: 10, FERN: 11, DRIFTWOOD: 12, AMBER_OAK: 13, AMBER_BIRCH: 14, SNOW_PINE: 15, MUSHROOM: 16,
  LILY_PADS: 17,
});
/**
 * Kinds the world module itself draws (0..17). Forage plants (kinds 18+) are parsed and
 * kept in the chunk data — for collision, ctx.world.vegOf and the forage module — but
 * the world never renders them (contract §12).
 */
export const VEG_KIND_COUNT = 18;
/** First forage plant kind (core.FirstForageKind). */
export const FIRST_FORAGE_KIND = 18;
/** Every kind this client understands on the wire (core.VegKindCount); others are skipped. */
export const WIRE_VEG_KIND_COUNT = 36;

/** True for forage plant kinds (never drawn by the world module). */
export function isForageKind(kind) { return kind >= FIRST_FORAGE_KIND && kind < WIRE_VEG_KIND_COUNT; }

/**
 * Per-kind facts the renderer, the collision grid and canopyAt agree on. Sizes are in
 * metres at scale 1 (the nominal sizes of core.Veg: oak ~11 m, birch ~10 m, pine ~14 m,
 * snag ~8 m, shrub ~1.6 m, reeds ~2 m, rock ~1 m).
 *
 *   maxLod   coarsest chunk LOD that still carries the kind (contract §2.3)
 *   trunk    radius of the solid trunk / body the player collides with (0 = walk through)
 *   minSolid smallest instance scale that is solid (lets the player step over pebbles)
 *   crown    crown radius used for canopy cover (0 = no canopy)
 *   cover    how much sky a crown hides at its centre, 0..1
 *   season   seasonal tint class, see season.js ('' = never tinted)
 *   bend     whole-plant wind bend at the tip in metres at full wind
 *   flutter  small fast leaf movement in metres at full wind
 *   freq     sway frequency in rad/s
 *   shadow   casts a shadow on 'high' quality
 *   decor    small ground decoration: thinned out on lower quality settings
 */
export const VEG_INFO = Object.freeze([
  /* 0 oak         */ { name: 'oak', maxLod: 2, height: 11, trunk: 0.42, minSolid: 0, crown: 4.6, cover: 0.9, season: 'broadleaf', bend: 0.22, flutter: 0.045, freq: 1.1, shadow: true, decor: false },
  /* 1 birch       */ { name: 'birch', maxLod: 2, height: 10, trunk: 0.17, minSolid: 0, crown: 2.3, cover: 0.7, season: 'broadleaf', bend: 0.38, flutter: 0.06, freq: 1.5, shadow: true, decor: false },
  /* 2 pine        */ { name: 'pine', maxLod: 2, height: 14, trunk: 0.3, minSolid: 0, crown: 2.9, cover: 0.82, season: 'evergreen', bend: 0.3, flutter: 0.02, freq: 0.9, shadow: true, decor: false },
  /* 3 snag        */ { name: 'snag', maxLod: 2, height: 8, trunk: 0.3, minSolid: 0, crown: 0, cover: 0, season: '', bend: 0.03, flutter: 0, freq: 1.3, shadow: true, decor: false },
  /* 4 shrub       */ { name: 'shrub', maxLod: 1, height: 1.6, trunk: 0, minSolid: 0, crown: 0, cover: 0, season: 'shrub', bend: 0.07, flutter: 0.03, freq: 1.9, shadow: true, decor: false },
  /* 5 reeds       */ { name: 'reeds', maxLod: 1, height: 2, trunk: 0, minSolid: 0, crown: 0, cover: 0, season: 'reed', bend: 0.34, flutter: 0.04, freq: 1.7, shadow: false, decor: false },
  /* 6 rock        */ { name: 'rock', maxLod: 1, height: 1, trunk: 0.5, minSolid: 0.9, crown: 0, cover: 0, season: '', bend: 0, flutter: 0, freq: 1, shadow: true, decor: false },
  /* 7 flowers     */ { name: 'flowers', maxLod: 0, height: 0.45, trunk: 0, minSolid: 0, crown: 0, cover: 0, season: 'herb', bend: 0.1, flutter: 0.025, freq: 2.4, shadow: false, decor: true },
  /* 8 grass tuft  */ { name: 'grass', maxLod: 0, height: 0.7, trunk: 0, minSolid: 0, crown: 0, cover: 0, season: 'grass', bend: 0.16, flutter: 0.03, freq: 2.2, shadow: false, decor: true },
  /* 9 log         */ { name: 'log', maxLod: 0, height: 0.5, trunk: 0, minSolid: 0, crown: 0, cover: 0, season: '', bend: 0, flutter: 0, freq: 1, shadow: true, decor: false },
  /* 10 stump      */ { name: 'stump', maxLod: 0, height: 0.6, trunk: 0.38, minSolid: 0.8, crown: 0, cover: 0, season: '', bend: 0, flutter: 0, freq: 1, shadow: true, decor: false },
  /* 11 fern       */ { name: 'fern', maxLod: 0, height: 0.75, trunk: 0, minSolid: 0, crown: 0, cover: 0, season: 'herb', bend: 0.07, flutter: 0.03, freq: 2.0, shadow: false, decor: true },
  /* 12 driftwood  */ { name: 'driftwood', maxLod: 0, height: 0.5, trunk: 0, minSolid: 0, crown: 0, cover: 0, season: '', bend: 0, flutter: 0, freq: 1, shadow: true, decor: false },
  /* 13 amber oak  */ { name: 'amber_oak', maxLod: 2, height: 11, trunk: 0.42, minSolid: 0, crown: 4.6, cover: 0.85, season: '', bend: 0.22, flutter: 0.05, freq: 1.1, shadow: true, decor: false },
  /* 14 amber birch*/ { name: 'amber_birch', maxLod: 2, height: 10, trunk: 0.17, minSolid: 0, crown: 2.3, cover: 0.65, season: '', bend: 0.38, flutter: 0.06, freq: 1.5, shadow: true, decor: false },
  /* 15 snow pine  */ { name: 'snow_pine', maxLod: 2, height: 14, trunk: 0.3, minSolid: 0, crown: 2.9, cover: 0.85, season: '', bend: 0.18, flutter: 0.01, freq: 0.8, shadow: true, decor: false },
  /* 16 mushroom   */ { name: 'mushroom', maxLod: 0, height: 0.22, trunk: 0, minSolid: 0, crown: 0, cover: 0, season: '', bend: 0, flutter: 0, freq: 1, shadow: false, decor: true },
  /* 17 lily pads  */ { name: 'lily_pads', maxLod: 0, height: 0.05, trunk: 0, minSolid: 0, crown: 0, cover: 0, season: 'pad', bend: 0, flutter: 0, freq: 1, shadow: false, decor: false },
]);

/**
 * Facts about the forage plant kinds (18..35) the world needs for collision, canopy and
 * LOD decimation. They are in the chunk vegetation lists at lod 0 and 1 (contract §12).
 * Only the sweet chestnut is a real tree: solid trunk, broad crown.
 */
const FORAGE_PLAIN = { maxLod: 1, trunk: 0, minSolid: 0, crown: 0, cover: 0, forage: true };
export const FORAGE_INFO = Object.freeze([
  /* 18 bramble        */ { ...FORAGE_PLAIN, name: 'bramble' },
  /* 19 strawberry     */ { ...FORAGE_PLAIN, name: 'wild_strawberry' },
  /* 20 bilberry       */ { ...FORAGE_PLAIN, name: 'bilberry' },
  /* 21 elder          */ { ...FORAGE_PLAIN, name: 'elder' },
  /* 22 dog rose       */ { ...FORAGE_PLAIN, name: 'dog_rose' },
  /* 23 hazel          */ { ...FORAGE_PLAIN, name: 'hazel' },
  /* 24 sweet chestnut */ { ...FORAGE_PLAIN, name: 'sweet_chestnut', maxLod: 2, trunk: 0.45, crown: 4.4, cover: 0.85 },
  /* 25 nettle         */ { ...FORAGE_PLAIN, name: 'nettle' },
  /* 26 wild garlic    */ { ...FORAGE_PLAIN, name: 'wild_garlic' },
  /* 27 water mint     */ { ...FORAGE_PLAIN, name: 'water_mint' },
  /* 28 chamomile      */ { ...FORAGE_PLAIN, name: 'chamomile' },
  /* 29 young pine     */ { ...FORAGE_PLAIN, name: 'young_pine' },
  /* 30 chanterelle    */ { ...FORAGE_PLAIN, name: 'chanterelle' },
  /* 31 penny bun      */ { ...FORAGE_PLAIN, name: 'penny_bun' },
  /* 32 sea buckthorn  */ { ...FORAGE_PLAIN, name: 'sea_buckthorn' },
  /* 33 samphire       */ { ...FORAGE_PLAIN, name: 'samphire' },
  /* 34 cloudberry     */ { ...FORAGE_PLAIN, name: 'cloudberry' },
  /* 35 wild thyme     */ { ...FORAGE_PLAIN, name: 'wild_thyme' },
].map(Object.freeze));

/** The info record of any known kind (drawn or forage), or undefined. */
export function vegInfo(kind) {
  return kind < VEG_KIND_COUNT ? VEG_INFO[kind] : FORAGE_INFO[kind - FIRST_FORAGE_KIND];
}

/** True if a vegetation kind is still present in chunks of the given LOD. */
export function vegVisibleAtLod(kind, lod) {
  const info = vegInfo(kind);
  return !!info && info.maxLod >= lod;
}

// --- streaming -----------------------------------------------------------------
/**
 * Per-quality streaming and rendering settings (contract §5.2: ring radius low 5 /
 * medium 7 / high 10 chunks).
 *   radius    ring radius in chunks
 *   inflight  chunk requests allowed in flight at once
 *   decor     fraction of ground decoration kept
 *   shadows   vegetation casts / terrain receives shadows
 *   buildMs   per-frame time budget for meshing, in milliseconds
 *   vegDetail finest model detail of chunk vegetation (rocks, reeds…; 2 = near), default 2
 *   decorFade small chunk decoration (flowers, tufts, ferns, mushrooms) shrinks away
 *             between these distances (m) and is not drawn beyond
 */
export const QUALITY = Object.freeze({
  low: Object.freeze({ radius: 5, inflight: 4, decor: 0.45, shadows: false, buildMs: 2.5, decorFade: Object.freeze([30, 42]), vegDetail: 1 }),
  medium: Object.freeze({ radius: 7, inflight: 6, decor: 0.8, shadows: true, buildMs: 3, decorFade: Object.freeze([45, 65]) }),
  high: Object.freeze({ radius: 10, inflight: 8, decor: 1, shadows: true, buildMs: 4, decorFade: Object.freeze([70, 95]) }),
});

/** Resolves a settings.quality string to its settings, defaulting to medium. */
export function qualityOf(name) { return QUALITY[name] || QUALITY.medium; }

/** Chebyshev chunk distance up to which chunks are wanted at lod 0 and lod 1. */
export const LOD0_RING = 2;
export const LOD1_RING = 4;

// --- ground cover ------------------------------------------------------------------
/**
 * Per-quality layout of the GPU ground-cover layers (groundField.js explains the
 * lattice): base = lattice spacing (m), n = points per ring side, rings = nested rings
 * (each twice as wide and four times as sparse), g = patches per ring side (draw calls),
 * blades = blades per grass tuft, segs = blade segments in the two finest rings.
 * Grass reaches ~0.9·(n/2)·base·2^(rings−1) metres.
 */
export const GROUND_QUALITY = Object.freeze({
  // g = 4: each ring is 16 patches, so patches off screen are frustum-culled and the
  // four central ones (the finer ring's hole) are skipped. (Optional `boost` scales the
  // chance a lattice point holds a plant, for a coarser lattice at the same density.)
  low: Object.freeze({
    grass: Object.freeze({ base: 0.25, n: 64, rings: 3, g: 4, blades: 2, segs: 2 }),     // ~29 m, 12k tufts
    flowers: Object.freeze({ base: 0.5, n: 40, rings: 2, g: 4 }),
    ferns: Object.freeze({ base: 1.0, n: 32, rings: 1, g: 4, segs: 3 }),
  }),
  medium: Object.freeze({
    grass: Object.freeze({ base: 0.125, n: 80, rings: 5, g: 4, blades: 3, segs: 3 }),   // ~74 m, 32k tufts
    flowers: Object.freeze({ base: 0.35, n: 64, rings: 2, g: 4 }),
    ferns: Object.freeze({ base: 0.8, n: 48, rings: 2, g: 4 }),
  }),
  high: Object.freeze({
    grass: Object.freeze({ base: 0.125, n: 96, rings: 5, g: 4, blades: 3, segs: 3 }),   // ~88 m, 46k tufts
    flowers: Object.freeze({ base: 0.3, n: 96, rings: 3, g: 4 }),
    ferns: Object.freeze({ base: 0.8, n: 48, rings: 2, g: 4 }),
  }),
});

/** Ground-cover layout for a settings.quality string (medium by default). */
export function groundQualityOf(name) { return GROUND_QUALITY[name] || GROUND_QUALITY.medium; }
