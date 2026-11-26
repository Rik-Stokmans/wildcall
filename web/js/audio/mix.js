// Ambience mix: from the environment (state.env), the region type under the player,
// tree cover and nearby water, derive the target level of every ambience layer. Pure:
// the engine (ambience.js) samples the world and feeds the numbers in, then glides
// its gains towards what this returns.
import { clamp01, smoothstep } from './curves.js';

/** core.RegionID values. */
export const REGION = {
  greenhollow: 0, marsh: 1, windpeak: 2, coast: 3, amberwood: 4, frostveil: 5, none: 255,
};

/** Wind is stronger on exposed ground. */
const WIND_MUL = { 0: 1, 1: 1.1, 2: 1.5, 3: 1.3, 4: 1, 5: 1.25, 255: 1.4 };
/** Insect life per region type (summer daytime). */
const INSECT_MUL = { 0: 1, 1: 1.25, 2: 0.3, 3: 0.4, 4: 0.75, 5: 0, 255: 0 };
/** Insects by season: spring, summer, autumn, winter. */
const INSECT_SEASON = [0.3, 1, 0.2, 0];

/** Daylight 0..1: env.light when the server sends it, else from the clock. */
export function daylight(env) {
  if (env && Number.isFinite(+env.light)) return clamp01(+env.light);
  const h = +env?.time;
  if (!Number.isFinite(h)) return 1;
  return smoothstep(5, 8, h) * (1 - smoothstep(19, 21.5, h));
}

/**
 * @param {object} p
 * @param {object} p.env core.Env ({time, season, wind, rain, light, …})
 * @param {number} p.region core.RegionID under the player (255 = open water / unknown)
 * @param {number} p.canopy 0..1 tree cover above the listener
 * @param {number} p.creekDist metres to running water (creek trail / river), Infinity if none
 * @param {number} p.waterDist metres to any standing water, Infinity if none
 * @param {number} p.seaDist metres to deep open water, Infinity if none
 * @param {number} p.altitude listener height above sea level (m)
 * @returns {{wind:number, windHowl:number, leaves:number, creek:number, lap:number,
 *   surf:number, rainOpen:number, rainCanopy:number, insects:number, crickets:number,
 *   night:number, canopy:number, leafDry:number}} target levels 0..1 (canopy, leafDry: character) (before the per-layer gain trims in ambience.js)
 */
export function ambienceMix(p) {
  const env = p.env || {};
  const region = Number.isFinite(p.region) ? p.region : 0;
  const canopy = clamp01(p.canopy || 0);
  const windIn = clamp01(+env.wind || 0);
  const rain = clamp01(+env.rain || 0);
  const season = (+env.season | 0) & 3;
  const light = daylight(env);
  const alt = Math.max(0, +p.altitude || 0);

  // Wind: always a breath of air, gusting with env.wind; trees shelter, height exposes.
  const exposure = (WIND_MUL[region] ?? 1) * (1 + Math.min(0.4, alt / 250));
  const wind = clamp01((0.1 + 0.9 * windIn) * exposure * (1 - 0.35 * canopy));
  // High, whistling component only in strong wind on exposed ground.
  const windHowl = clamp01(smoothstep(0.45, 1, windIn) * (exposure - 0.9) * (1 - 0.6 * canopy));

  // Leaves rustle only where there are trees; bare in winter, crisp in autumn.
  const leafSeason = [0.9, 1, 1.15, 0.35][season];
  const leafRegion = region === REGION.frostveil ? 0.4 : region === REGION.amberwood ? 1.2 : 1;
  const leaves = clamp01(canopy * (0.12 + 0.88 * windIn) * leafSeason * leafRegion);

  // Water: running water babbles and carries; still water only laps close by.
  const creek = finiteExp(p.creekDist, 22);
  const lap = 0.45 * finiteExp(p.waterDist, 12) * (0.5 + 0.5 * windIn);
  const seaish = region === REGION.coast || region === REGION.none ? 1 : 0.3;
  const surf = clamp01(finiteExp(p.seaDist, 70) * seaish * (0.55 + 0.45 * windIn));

  // Rain: open hiss vs. muffled patter and drips under the canopy.
  const rainOpen = clamp01(rain * (1 - 0.7 * canopy));
  const rainCanopy = clamp01(rain * canopy);

  // Insects: summer days; crickets on warm evenings and nights.
  const calm = (1 - rain) * (1 - 0.6 * windIn);
  const insectBase = INSECT_SEASON[season] * (INSECT_MUL[region] ?? 0.5) * calm;
  const insects = clamp01(insectBase * smoothstep(0.35, 0.75, light));
  const cricketSeason = [0.15, 1, 0.55, 0][season];
  const crickets = clamp01(cricketSeason * (INSECT_MUL[region] ?? 0.5) * calm * (1 - smoothstep(0.08, 0.4, light)));

  // Quiet night air.
  const night = clamp01((1 - smoothstep(0.05, 0.45, light)) * (1 - 0.5 * rain));

  // Character, not level: under a canopy the wind is dulled by the leaves; autumn leaves
  // are dry and crisp, summer ones soft.
  const leafDry = [0.25, 0.1, 0.9, 0.55][season];

  return { wind, windHowl, leaves, creek, lap, surf, rainOpen, rainCanopy, insects, crickets, night, canopy, leafDry };
}

/** Sum of the squared layer levels (noise layers add in power, not in amplitude). */
export function ambienceLoad(mix, trim) {
  let p = 0;
  for (const k of Object.keys(trim)) {
    const v = (+mix?.[k] || 0) * trim[k];
    p += v * v;
  }
  return p;
}

/**
 * Gain that keeps a pile-up of layers (storm + surf + creek...) from swamping the birds:
 * 1 up to `limit` (power), then falling with the square root, so the stacked sum stays
 * level instead of growing.
 */
export function loadCompensation(load, limit = 0.16) {
  return load > limit ? Math.sqrt(limit / load) : 1;
}

function finiteExp(d, k) {
  if (!Number.isFinite(d)) return 0;
  return Math.exp(-Math.max(0, d) / k);
}

/** Shortest XZ distance from (x, z) to a polyline of {x, z} points (Infinity if empty). */
export function distToPolyline(points, x, z) {
  if (!points || !points.length) return Infinity;
  if (points.length === 1) return Math.hypot(points[0].x - x, points[0].z - z);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const abx = b.x - a.x, abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    let t = len2 > 0 ? ((x - a.x) * abx + (z - a.z) * abz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(a.x + abx * t - x, a.z + abz * t - z);
    if (d < best) best = d;
  }
  return best;
}

/** Ring of probe offsets used to look for water around the listener. */
export const WATER_PROBES = (() => {
  const out = [];
  const radii = [0, 6, 14, 26, 42, 64, 95];
  for (const r of radii) {
    const n = r === 0 ? 1 : 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r * 0.13;
      out.push({ r, dx: Math.sin(a) * r, dz: -Math.cos(a) * r });
    }
  }
  return out;
})();

/**
 * Probe water depth around the listener.
 * @param {(x:number, z:number) => number} depthAt e.g. ctx.world.waterDepthAt
 * @returns {{waterDist:number, seaDist:number, dirX:number, dirZ:number}} distances to
 *   any water (depth > 0.05 m) and to deep water (depth > 1.5 m), and a unit XZ vector
 *   pointing at the water weighted by closeness (0,0 if none or under the listener).
 */
export function probeWater(depthAt, x, z) {
  let waterDist = Infinity, seaDist = Infinity, vx = 0, vz = 0;
  if (typeof depthAt !== 'function') return { waterDist, seaDist, dirX: 0, dirZ: 0 };
  for (const p of WATER_PROBES) {
    let d = 0;
    try { d = +depthAt(x + p.dx, z + p.dz) || 0; } catch { d = 0; }
    if (d > 0.05) {
      if (p.r < waterDist) waterDist = p.r;
      if (p.r > 0) {
        const w = 1 / (1 + p.r);
        vx += (p.dx / p.r) * w; vz += (p.dz / p.r) * w;
      }
    }
    if (d > 1.5 && p.r < seaDist) seaDist = p.r;
  }
  const len = Math.hypot(vx, vz);
  return { waterDist, seaDist, dirX: len > 1e-6 ? vx / len : 0, dirZ: len > 1e-6 ? vz / len : 0 };
}

/**
 * Distance to water that should babble. A creek trail is certain; otherwise shallow
 * water with no deep water near it is most likely a creek or river channel (the world
 * carves rivers just below sea level), except in the marsh where pools are still.
 */
export function runningWaterDist(creekTrailDist, probe, region) {
  let d = Number.isFinite(creekTrailDist) ? creekTrailDist : Infinity;
  if (probe && region !== REGION.marsh && !Number.isFinite(probe.seaDist) && Number.isFinite(probe.waterDist)) {
    d = Math.min(d, probe.waterDist + 8);
  }
  return d;
}

/**
 * Distance to the nearest running-water trail (any trail whose id mentions "creek" or
 * "river", e.g. the home valley's 'creek'). Returns Infinity if there is none.
 */
export function creekDistance(trails, x, z) {
  let best = Infinity;
  for (const t of trails || []) {
    const id = String(t?.id || '');
    if (!/creek|river|stream/i.test(id)) continue;
    const d = distToPolyline(t.points, x, z);
    if (d < best) best = d;
  }
  return best;
}
