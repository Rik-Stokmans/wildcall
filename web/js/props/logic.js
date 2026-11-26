// Props pure logic: per-id variation, POI/trail bookkeeping, interactable rules,
// landmark styles, region palettes, walkable surfaces (platforms, ramps, stairs),
// NPC facing, glint and streaming distances. Pure: no three.js, no DOM.
//
// Local frame of a prop: its front faces local −Z, and the prop is rotated so that
// front points along the POI's compass heading yaw, i.e. world direction
// (sin yaw, 0, −cos yaw) — exactly what three.js gives with rotation.y = −yaw.

export const REGION = Object.freeze({
  GREENHOLLOW: 0, MARSH: 1, WINDPEAK: 2, COAST: 3, AMBERWOOD: 4, FROSTVEIL: 5, NONE: 255,
});
const REGION_KEYS = ['greenhollow', 'murmur_marsh', 'windpeak', 'whispering_coast', 'amberwood', 'frostveil'];

/** Props farther than this (XZ metres) from the player are dropped. */
export const DROP_DIST = 900;
/** Known POIs closer than this are (re)built. Hysteresis against DROP_DIST. */
export const BUILD_DIST = 780;

// ---------------------------------------------------------------------------
// Determinism

/** FNV-1a 32-bit hash of a string. */
export function hashString(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 generator returning floats in [0, 1). */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic random stream for a POI id (same id → same prop forever). */
export const rngFor = (id, salt = 0) => rng(hashString(id) ^ Math.imul(salt + 1, 0x9e3779b1));

// ---------------------------------------------------------------------------
// Local ↔ world

/** Local (lx, lz) of a prop at (cx, cz) with heading yaw → world [x, z]. */
export function localToWorld(cx, cz, yaw, lx, lz) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [cx + lx * c - lz * s, cz + lx * s + lz * c];
}

/** World (x, z) → local [lx, lz] of a prop at (cx, cz) with heading yaw. */
export function worldToLocal(cx, cz, yaw, x, z) {
  const dx = x - cx, dz = z - cz;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [dx * c + dz * s, -dx * s + dz * c];
}

// ---------------------------------------------------------------------------
// POI / trail bookkeeping

/**
 * Merges a PoisMsg ({pois, trails}) into ctx.state: state.pois is an id → POI map,
 * state.trails an array; both de-duplicated by id (a re-sent POI replaces the old
 * copy). Returns the POIs of the message (all of them: a re-sent POI may need its
 * prop rebuilt).
 */
export function mergePois(state, msg) {
  if (!state) return [];
  if (!state.pois || typeof state.pois !== 'object') state.pois = {};
  if (!Array.isArray(state.trails)) state.trails = [];
  const pois = [];
  for (const p of msg?.pois || []) {
    if (!p || typeof p.id !== 'string') continue;
    state.pois[p.id] = p;
    pois.push(p);
  }
  if (Array.isArray(msg?.trails) && msg.trails.length) {
    const at = new Map();
    state.trails.forEach((t, i) => { if (t && t.id) at.set(t.id, i); });
    for (const t of msg.trails) {
      if (!t || typeof t.id !== 'string') continue;
      if (at.has(t.id)) state.trails[at.get(t.id)] = t;
      else { at.set(t.id, state.trails.length); state.trails.push(t); }
    }
  }
  return pois;
}

/** XZ distance between a POI and a point. */
export function distXZ(p, x, z) {
  const dx = (p?.pos?.x ?? 0) - x, dz = (p?.pos?.z ?? 0) - z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Streaming decision for one POI: 'build' when it is not built and close enough,
 * 'drop' when it is built and too far, otherwise null.
 */
export function streamAction(built, dist) {
  if (!built && dist <= BUILD_DIST) return 'build';
  if (built && dist > DROP_DIST) return 'drop';
  return null;
}

// ---------------------------------------------------------------------------
// Interaction rules

const COLLECTIBLE = new Set(['feather', 'page', 'relic']);

/** True when the profile records this POI as taken/opened (flag `taken:<poi id>`). */
export function isTaken(poiId, flags) {
  return !!(flags && flags['taken:' + poiId]);
}

/**
 * Interaction offered by a POI, or null when it offers none right now.
 * npc → Talk, cabin → Enter, shop → Browse, feather/page/relic → Pick up (until
 * taken), cache → Open (until opened), sign → Read. Hidden POIs are interactable too:
 * they are found by exploring.
 * @param {object} poi core.POI
 * @param {object} [flags] profile.flags
 * @param {object} [npcs] state.npcs (id → NPCDef) for NPC names
 * @returns {{label:string, verb:string} | null}
 */
export function interactionFor(poi, flags, npcs) {
  if (!poi || typeof poi.kind !== 'string') return null;
  const label = poi.name || '';
  switch (poi.kind) {
    case 'npc': {
      const def = npcs?.[poi.data?.npc];
      return { label: def?.name || label, verb: 'Talk' };
    }
    case 'cabin': return { label, verb: 'Enter' };
    case 'shop': return { label, verb: 'Browse' };
    case 'sign': return { label, verb: 'Read' };
    case 'cache': return isTaken(poi.id, flags) ? null : { label, verb: 'Open' };
    default:
      if (COLLECTIBLE.has(poi.kind)) return isTaken(poi.id, flags) ? null : { label, verb: 'Pick up' };
      return null;
  }
}

/** Interaction radius: small for the things you reach out to. */
export function interactRadius(poi) {
  switch (poi?.kind) {
    case 'cabin': return 4;
    case 'shop': return 4;
    case 'npc': return 3.5;
    case 'sign': return 3;
    default: return Math.max(2, Math.min(3, +poi?.radius || 3));
  }
}

/**
 * Filters entries ({poi, ...}) down to the currently valid interactables.
 * @returns {{id, kind, pos, radius, label, verb}[]}
 */
export function filterInteractables(entries, flags, npcs, out = []) {
  out.length = 0;
  for (const e of entries) {
    const it = interactionFor(e.poi, flags, npcs);
    if (!it) continue;
    out.push({ id: e.poi.id, kind: e.poi.kind, pos: e.pos, radius: e.radius ?? interactRadius(e.poi), label: it.label, verb: it.verb });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Looks

/** Region key ('greenhollow' …) from a region id; unknown → greenhollow. */
export const regionKey = (r) => REGION_KEYS[r] || 'greenhollow';

// Data.landmark values sent by the world generator → dressing style.
const LANDMARK_DATA = {
  timber_arch: 'arch', giant_tree: 'giant_tree', stepping_stones: 'stepping_stones',
  fern_hollow: 'ferns', meadow: 'flowers', standing_stones: 'standing_stones',
  waterfall_rocks: 'waterfall_rocks', sea_arch: 'sea_arch', lighthouse: 'lighthouse',
  boardwalk: 'boardwalk', cairn: 'cairn', frozen_falls: 'frozen_falls',
};

/** Every landmark style the props module can dress. */
export const LANDMARK_STYLES = Object.freeze([
  'arch', 'old_oak', 'giant_tree', 'stepping_stones', 'ferns', 'flowers', 'standing_stones',
  'sea_arch', 'lighthouse', 'boardwalk', 'cairn', 'frozen_falls', 'waterfall_rocks',
]);

/**
 * Landmark dressing for a landmark POI: the pinned home ids first ('old_oak' is
 * dressing only — the world grows the giant oak itself), then the generator's
 * Data.landmark subtype, then keywords in its name, then the region type (rare
 * picks by a per-id roll).
 * @returns {string} one of LANDMARK_STYLES
 */
export function landmarkStyle(poi) {
  switch (poi?.id) {
    case 'woodland_entrance': return 'arch';
    case 'old_oak': return 'old_oak';
    case 'creekside': return 'stepping_stones';
    case 'fern_valley': return 'ferns';
    case 'meadow_clearing': return 'flowers';
    default: break;
  }
  // The world generator names the subtype in Data.landmark; trust it when known.
  const sub = LANDMARK_DATA[poi?.data?.landmark];
  if (sub) return sub;
  const n = String(poi?.name || '').toLowerCase();
  const r = poi?.region;
  if (/lighthouse|beacon|lamp/.test(n)) return 'lighthouse';
  if (/boardwalk|duckboard|walkway/.test(n)) return 'boardwalk';
  if (/frozen|icefall|ice fall|glacier/.test(n)) return 'frozen_falls';
  if (/falls|cascade|waterfall|force\b/.test(n)) return r === REGION.FROSTVEIL ? 'frozen_falls' : 'waterfall_rocks';
  if (/\barch\b|archway/.test(n)) return r === REGION.COAST ? 'sea_arch' : 'arch';
  if (/cairn/.test(n)) return 'cairn';
  if (/stones|standing|circle|menhir|monolith|henge/.test(n)) return 'standing_stones';
  if (/oak|elm|yew|ash|beech|tree|giant|elder|pine/.test(n)) return 'giant_tree';
  const roll = rngFor(poi?.id || '', 7)();
  switch (r) {
    case REGION.COAST: return roll < 0.25 ? 'lighthouse' : roll < 0.7 ? 'sea_arch' : 'standing_stones';
    case REGION.MARSH: return roll < 0.75 ? 'boardwalk' : 'standing_stones';
    case REGION.WINDPEAK: return roll < 0.6 ? 'cairn' : roll < 0.85 ? 'standing_stones' : 'waterfall_rocks';
    case REGION.FROSTVEIL: return roll < 0.6 ? 'frozen_falls' : 'cairn';
    case REGION.AMBERWOOD: return roll < 0.7 ? 'giant_tree' : 'standing_stones';
    default: return roll < 0.55 ? 'giant_tree' : roll < 0.85 ? 'standing_stones' : 'waterfall_rocks';
  }
}

// Region palettes for structures (sRGB hex). Wood warm, roofs mossy; Frostveil gets
// snow caps, the coast a weathered grey.
const PALETTES = {
  greenhollow: { wood: 0x9a6a42, dark: 0x6b4a2f, roof: 0x6f8a4a, stone: 0x9a9384, trim: 0xe8d7b0, canvas: 0xd9c9a0, snow: 0 },
  murmur_marsh: { wood: 0x8c7046, dark: 0x5e4a30, roof: 0x8a8a52, stone: 0x8a8a7a, trim: 0xd8cfa8, canvas: 0xcfc59a, snow: 0 },
  windpeak: { wood: 0x8a6a4c, dark: 0x5a4636, roof: 0x6f7a6a, stone: 0x8f8f8c, trim: 0xd9d2c0, canvas: 0xc9b98f, snow: 0 },
  whispering_coast: { wood: 0x9b928a, dark: 0x6d6862, roof: 0x7d8790, stone: 0xa8a59c, trim: 0xe9e4da, canvas: 0xd6d2c4, snow: 0 },
  amberwood: { wood: 0xa2683a, dark: 0x6d4428, roof: 0xb0703a, stone: 0x9c8c78, trim: 0xf0d6a8, canvas: 0xe0c08c, snow: 0 },
  frostveil: { wood: 0x8a6a50, dark: 0x5a4838, roof: 0x7a8a96, stone: 0xa0a4aa, trim: 0xe8eef2, canvas: 0xd8d8d0, snow: 1 },
};

/** Structure palette for a region id (plus a small per-id wood shade variation). */
export function paletteFor(region, id = '') {
  const base = PALETTES[regionKey(region)];
  const shade = 0.9 + rngFor(id, 3)() * 0.2;
  return { ...base, key: regionKey(region), shade };
}

// ---------------------------------------------------------------------------
// Walkable surfaces
//
// A surface lives in the local frame of its prop:
//   {type:'box',  x0, x1, z0, z1, y}           flat floor at height y
//   {type:'ramp', x0, x1, z0, z1, y0, y1, axis:'z'|'x'}   height runs linearly from
//                                              y0 at the *0 edge to y1 at the *1 edge
// Heights are relative to the prop's base (its seated ground height).

/** Height of a surface at local (lx, lz), or null when outside it. */
export function surfaceHeight(s, lx, lz) {
  if (lx < s.x0 || lx > s.x1 || lz < s.z0 || lz > s.z1) return null;
  if (s.type === 'box') return s.y;
  const t = s.axis === 'x' ? (lx - s.x0) / (s.x1 - s.x0) : (lz - s.z0) / (s.z1 - s.z0);
  return s.y0 + (s.y1 - s.y0) * t;
}

/** How far up a surface may be from the feet and still be stepped onto. */
export const STEP_UP = 0.65;

/**
 * Highest walkable surface under (x, z) that the feet at height y can stand on:
 * at most STEP_UP above the feet (stairs are walked up a step at a time) and not
 * absurdly far below (falling onto a lower floor is fine, but a platform 30 m up
 * does not claim the ground beneath it).
 * @param {{x:number, z:number, yaw:number, base:number, surfaces:object[], reach:number}[]} sets
 * @returns {number|null} world height
 */
export function platformHeightAt(sets, x, z, y) {
  let best = null;
  for (const set of sets) {
    const dx = x - set.x, dz = z - set.z;
    if (dx * dx + dz * dz > set.reach * set.reach) continue;
    const [lx, lz] = worldToLocal(set.x, set.z, set.yaw, x, z);
    for (const s of set.surfaces) {
      const h = surfaceHeight(s, lx, lz);
      if (h === null) continue;
      const wy = set.base + h;
      if (wy > y + STEP_UP) continue;
      if (best === null || wy > best) best = wy;
    }
  }
  return best;
}

/** Bounding radius of a surface list in its local frame (for the cheap reach test). */
export function surfaceReach(surfaces) {
  let r = 0;
  for (const s of surfaces) {
    for (const x of [s.x0, s.x1]) for (const z of [s.z0, s.z1]) r = Math.max(r, Math.hypot(x, z));
  }
  return r + 0.5;
}

/**
 * Stair profile: a straight flight climbing `height` metres at a comfortable
 * pitch, as a single ramp surface (smooth to walk) plus the per-step boxes the
 * renderer draws. The flight runs along local +Z → −Z: it starts on the ground at
 * zTop + run and arrives at zTop.
 * @returns {{run:number, steps:number, rise:number, tread:number, ramp:object}}
 */
export function stairFlight(height, { width = 1.1, x = 0, zTop = 0, pitch = 38 } = {}) {
  const run = height / Math.tan((pitch * Math.PI) / 180);
  const steps = Math.max(2, Math.round(height / 0.22));
  return {
    run, steps, rise: height / steps, tread: run / steps,
    ramp: { type: 'ramp', axis: 'z', x0: x - width / 2, x1: x + width / 2, z0: zTop, z1: zTop + run, y0: height, y1: 0 },
  };
}

/**
 * Watchtower dimensions and walkable surfaces, deterministic per id.
 * The platform is a square of half-size `half` at `height`; a straight stair runs up
 * the back (local +Z) into a gap in the railing. The roof ridge sits at `top`
 * (11.5 m, where the world generator puts the tower's bird perches).
 */
export function towerLayout(id) {
  const r = rngFor(id, 11);
  const height = 7.4 + r() * 0.9;
  const half = 1.9 + r() * 0.45;
  const flight = stairFlight(height, { width: 1.1, x: 0, zTop: half, pitch: 37 + r() * 5 });
  const surfaces = [
    { type: 'box', x0: -half, x1: half, z0: -half, z1: half, y: height },
    flight.ramp,
  ];
  return { height, half, flight, surfaces, top: 11.5, legs: 4, splay: 0.35 + r() * 0.25 };
}

/** Hide (bird blind): a raised floor walked into through a short ramp at the back. */
export function hideLayout(id) {
  const r = rngFor(id, 13);
  const w = 3.2 + r() * 1.2, d = 2.4 + r() * 0.6, floor = 0.35 + r() * 0.2;
  return {
    w, d, floor, wallH: 2.1, slitY: 1.25,
    surfaces: [
      { type: 'box', x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2, y: floor },
      { type: 'ramp', axis: 'z', x0: -0.55, x1: 0.55, z0: d / 2, z1: d / 2 + 1.4, y0: floor, y1: 0 },
    ],
  };
}

/**
 * Cabin (and ranger station) body, porch deck and steps. The world puts the cabin
 * door 4 m in front of the POI and Mara at the porch corner, so the porch front
 * edge sits ~4.3 m out. The body itself is a blocker; the porch is walkable.
 */
export function cabinLayout(id, { depth = 5.0, porch = 1.8 } = {}) {
  const r = rngFor(id, 17);
  const w = 7 + r() * 1.0, d = depth, deck = 0.5;
  const front = -d / 2 - porch;
  return {
    w, d, porch, deck,
    surfaces: [
      { type: 'box', x0: -w / 2, x1: w / 2, z0: front, z1: -d / 2, y: deck },
      { type: 'ramp', axis: 'z', x0: -0.9, x1: 0.9, z0: front - 1.1, z1: front, y0: 0, y1: deck },
    ],
  };
}

/**
 * Boardwalk: a zig-zag of plank segments at a fixed height above the base, with
 * ramps at both ends. Returns segments (centre, length, yaw in local frame) and the
 * matching surfaces.
 */
export function boardwalkLayout(id) {
  const r = rngFor(id, 19);
  const n = 3 + Math.floor(r() * 3);
  const h = 0.45, w = 1.4;
  const segs = [];
  const surfaces = [];
  let z = 0, x = 0;
  for (let i = 0; i < n; i++) {
    const len = 6 + r() * 4;
    const side = (i % 2 ? 1 : -1) * (1.5 + r() * 1.5);
    segs.push({ x, z: z - len / 2, len, w });
    surfaces.push({ type: 'box', x0: x - w / 2, x1: x + w / 2, z0: z - len, z1: z, y: h });
    // a square landing joins this segment to the next, offset sideways
    if (i < n - 1) {
      const nx = x + side;
      surfaces.push({ type: 'box', x0: Math.min(x, nx) - w / 2, x1: Math.max(x, nx) + w / 2, z0: z - len - w, z1: z - len, y: h });
      segs.push({ x: (x + nx) / 2, z: z - len - w / 2, len: w, w: Math.abs(nx - x) + w, landing: true });
      x = nx;
    }
    z -= len + (i < n - 1 ? w : 0);
  }
  // shift so the walk is centred on the POI
  const shift = -z / 2;
  for (const s of segs) s.z += shift;
  for (const s of surfaces) { s.z0 += shift; s.z1 += shift; }
  const zStart = shift, zEnd = z + shift, xEnd = x;
  surfaces.push({ type: 'ramp', axis: 'z', x0: -w / 2, x1: w / 2, z0: zStart, z1: zStart + 1.6, y0: h, y1: 0 });
  surfaces.push({ type: 'ramp', axis: 'z', x0: xEnd - w / 2, x1: xEnd + w / 2, z0: zEnd - 1.6, z1: zEnd, y0: 0, y1: h });
  return { h, w, segs, surfaces, ends: [[0, zStart + 0.8], [xEnd, zEnd - 0.8]] };
}

// ---------------------------------------------------------------------------
// Animation helpers

const wrapPi = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

/** Compass heading from (ax, az) towards (bx, bz). */
export function headingTo(ax, az, bx, bz) {
  const h = Math.atan2(bx - ax, -(bz - az));
  return h < 0 ? h + Math.PI * 2 : h;
}

/**
 * NPC facing: turn smoothly towards the player while they are within `near` metres,
 * otherwise drift back to the NPC's resting heading. Returns the new heading.
 */
export function npcFacing(cur, baseYaw, npcX, npcZ, px, pz, dt, near = 7) {
  const d = Math.hypot(px - npcX, pz - npcZ);
  const target = d < near && d > 0.2 ? headingTo(npcX, npcZ, px, pz) : baseYaw;
  const rate = d < near ? 3.2 : 1.2;
  const diff = wrapPi(target - cur);
  const step = diff * Math.min(1, dt * rate);
  let out = cur + step;
  out %= Math.PI * 2;
  if (out < 0) out += Math.PI * 2;
  return out;
}

/** Collectible glint strength 0..1: only within trackSigns metres, soft at the edge. */
export function glintAmount(dist, trackSigns) {
  const r = Math.max(0, +trackSigns || 0);
  if (r <= 0 || dist >= r) return 0;
  const edge = Math.min(1.5, r * 0.3);
  return Math.min(1, (r - dist) / edge);
}

/** Bobbing offset for a collectible (gentle, phase by id). */
export function bob(time, phase) {
  return 0.06 * Math.sin(time * 1.6 + phase) + 0.02 * Math.sin(time * 3.1 + phase * 1.7);
}

/** Night factor 0..1 for lit windows from daylight 0..1. */
export function windowGlow(daylight) {
  const d = Math.max(0, Math.min(1, +daylight || 0));
  const t = Math.max(0, Math.min(1, (0.45 - d) / 0.3));
  return t * t * (3 - 2 * t);
}

/** Feeder position for the garden upgrade: beside the cabin, in local cabin space. */
export function feederSpot(cabinPoi) {
  const p = cabinPoi?.pos || { x: 0, y: 0, z: 0 };
  const [x, z] = localToWorld(p.x, p.z, +cabinPoi?.yaw || 0, 6.5, -4.5);
  return { x, y: p.y, z };
}

// ---------------------------------------------------------------------------
// Blockers

/**
 * Circles (local frame) that make a rectangle's walls solid for ctx.world.collide:
 * a chain of overlapping circles along the perimeter, leaving optional door gaps.
 * @param {number} w width along local X
 * @param {number} d depth along local Z
 * @param {{r?:number, gaps?:{side:'front'|'back'|'left'|'right', at?:number, width:number}[], cx?:number, cz?:number}} [o]
 * @returns {{lx:number, lz:number, r:number}[]}
 */
export function perimeterBlockers(w, d, o = {}) {
  const r = o.r ?? 0.45;
  const cx = o.cx ?? 0, cz = o.cz ?? 0;
  const gaps = o.gaps || [];
  const out = [];
  const step = r * 1.3;
  const edge = (side, ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      // along-edge coordinate measured from the edge's centre
      const along = side === 'front' || side === 'back' ? x - cx : z - cz;
      if (gaps.some((g) => g.side === side && Math.abs(along - (g.at || 0)) < g.width / 2 + r * 0.6)) continue;
      out.push({ lx: x, lz: z, r });
    }
  };
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  edge('front', x0, z0, x1, z0);
  edge('back', x0, z1, x1, z1);
  edge('left', x0, z0, x0, z1);
  edge('right', x1, z0, x1, z1);
  return out;
}

/** True when the world point (x, z) is blocked by any circle of the list (local frame of a prop). */
export function blockedBy(circles, px, pz, yaw, x, z, radius = 0) {
  const [lx, lz] = worldToLocal(px, pz, yaw, x, z);
  for (const c of circles) {
    const rr = c.r + radius;
    const dx = lx - c.lx, dz = lz - c.lz;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Colours

const NAMED = {
  white: 0xffffff, black: 0x222222, red: 0xb5483a, green: 0x4f7a3a, blue: 0x3e5f8a,
  brown: 0x7a5232, tan: 0xc8a878, grey: 0x8a8a8a, gray: 0x8a8a8a, olive: 0x6b6b34,
  orange: 0xd9822b, yellow: 0xe2c044, navy: 0x2e3e5c, teal: 0x2f7a74, cream: 0xf0e4c8,
  khaki: 0xb3a26c, rust: 0xa8532a, moss: 0x6a7f3a, auburn: 0x8a3c22, blonde: 0xe0c07a,
  silver: 0xc8c8c8, ginger: 0xc0642c, chestnut: 0x6e3b22,
};

/**
 * Parses an NPCLook colour: '#rgb', '#rrggbb', '0xrrggbb', 'rrggbb' or a few names.
 * @returns {number} 0xrrggbb, or `fallback` when it cannot be read
 */
export function parseColor(v, fallback = 0x888888) {
  if (typeof v === 'number' && Number.isFinite(v)) return v >>> 0 & 0xffffff;
  if (typeof v !== 'string') return fallback;
  let s = v.trim().toLowerCase();
  if (NAMED[s] !== undefined) return NAMED[s];
  if (s.startsWith('#')) s = s.slice(1);
  else if (s.startsWith('0x')) s = s.slice(2);
  if (/^[0-9a-f]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (/^[0-9a-f]{6}$/.test(s)) return parseInt(s, 16);
  return fallback;
}

/** Multiplies an 0xrrggbb colour's channels by k (clamped). */
export function shadeHex(hex, k) {
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
  return (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
}

/** Mixes two 0xrrggbb colours. */
export function mixHex(a, b, t) {
  const m = (s) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * t));
  return (m(16) << 16) | (m(8) << 8) | m(0);
}

// ---------------------------------------------------------------------------
// NPC proportions

/**
 * Body proportions for an NPCLook: friendly, slightly exaggerated (big head, round
 * torso). Height and build are clamped to sane ranges.
 */
export function npcProportions(look) {
  const height = Math.max(1.45, Math.min(2.05, +look?.height || 1.72));
  const build = Math.max(0.75, Math.min(1.4, +look?.build || 1));
  const s = height / 1.72;
  const leg = 0.74 * s;
  const torso = 0.62 * s;
  const head = 0.17 * (0.92 + 0.08 * s); // head grows less than the body: cute ratio
  return {
    height, build, scale: s, leg, torso, head,
    hip: leg,
    shoulder: leg + torso,
    neck: leg + torso + 0.04 * s,
    headY: leg + torso + 0.04 * s + head * 0.95,
    waist: 0.2 * build * (0.9 + 0.1 * s),
    chest: 0.22 * build * (0.9 + 0.1 * s),
  };
}

// ---------------------------------------------------------------------------
// Lures

/**
 * Applies a LureMsg to a lure map (id → LureMsg). Returns 'add' | 'remove' | null.
 * Inactive lures are removed; an active re-send replaces the entry.
 */
export function applyLure(map, msg) {
  if (!msg || !Number.isFinite(+msg.id)) return null;
  const id = +msg.id;
  if (!msg.active) return map.delete(id) ? 'remove' : null;
  map.set(id, msg);
  return 'add';
}

/** True for a lure kind that is a garden feeder (as opposed to scattered seed). */
export const isFeederLure = (kind) => /feeder|garden/i.test(String(kind || ''));

/** Whether the garden feeder should stand at the cabin (profile owns the upgrade). */
export function hasGarden(profile) {
  return Array.isArray(profile?.cabin) && profile.cabin.includes('garden');
}

// ---------------------------------------------------------------------------
// Seating

/**
 * Where a small item (NPC, cache, collectible, sign) stands: the ground, or a
 * walkable prop surface just above it (a porch deck, a hide floor). The server's
 * own POI height is deliberately ignored — the client's terrain is authoritative for
 * what the player sees, and trusting a coarser height would make things float.
 */
export function seatSmall(ground, platform) {
  return platform !== null && platform !== undefined && platform > ground ? platform : ground;
}

/** Chunk coordinate containing a world coordinate (64 m chunks). */
export const chunkOf = (v) => Math.floor(v / 64);

/** True when a circle (x, z, r) overlaps chunk (cx, cz). */
export function overlapsChunk(x, z, r, cx, cz) {
  const x0 = cx * 64, z0 = cz * 64;
  const nx = Math.max(x0, Math.min(x, x0 + 64)), nz = Math.max(z0, Math.min(z, z0 + 64));
  return (nx - x) * (nx - x) + (nz - z) * (nz - z) <= r * r;
}
