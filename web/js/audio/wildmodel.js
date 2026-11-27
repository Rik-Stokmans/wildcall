// Other animals in the soundscape (spec §24.1 "animal movement", §12.3): the pure half.
//
// Non-bird wildlife and the small sounds of living ground: frogs, squirrels, leaf-litter
// rustles, bees, grasshoppers, a distant deer or fox, wavelets, creaking branches and
// drips. Nothing here touches Web Audio: given the place, time, season and weather it
// says how often each thing happens (events per minute), where it may happen (a spot
// around the listener, validated against the world), and how loud it is. wildlife.js
// turns an event into sound. All of it is sparse and quiet by design: it is a bed for
// the birds, never a clue and never a mask.
import { clamp01, smoothstep } from './curves.js';
import { daylight } from './mix.js';

/** core.Habitat values. */
export const HAB = {
  ocean: 0, beach: 1, meadow: 2, woodland: 3, conifer: 4, marsh: 5, river: 6,
  alpine: 7, cliff: 8, snow: 9, shrub: 10,
};
const H = HAB;
/** core.RegionID values (as in mix.js). */
const R = { marsh: 1, windpeak: 2, coast: 3, frostveil: 5 };

const SEASON = (env) => (+env?.season | 0) & 3; // 0 spring 1 summer 2 autumn 3 winter

/** The kinds of events, in a fixed order. */
export const KINDS = ['frog', 'squirrel', 'rustle', 'bee', 'grasshopper', 'deer', 'fox', 'lap', 'creak', 'drip'];

/**
 * Per-kind constants.
 *  peak      amplitude of the loudest moment at `ref` metres, on the ambience bus input
 *  ref, roll the panner's inverse-distance law (same numbers are given to the PannerNode)
 *  near, far where an event may be placed (m)
 *  minGap    seconds between two events of the same kind
 *  maxRate   events per minute at the best conditions (a hard cap on the rate)
 *  maxVoices simultaneous events of this kind
 */
export const KIND = {
  frog:        { peak: 0.085, ref: 3,   roll: 1.0, near: 6,   far: 48,  minGap: 3,   maxRate: 7,    maxVoices: 2 },
  squirrel:    { peak: 0.07,  ref: 3,   roll: 1.0, near: 5,   far: 28,  minGap: 12,  maxRate: 1.5,  maxVoices: 1 },
  rustle:      { peak: 0.05,  ref: 2,   roll: 1.1, near: 2,   far: 12,  minGap: 5,   maxRate: 3,    maxVoices: 1 },
  bee:         { peak: 0.045, ref: 2,   roll: 1.2, near: 4,   far: 14,  minGap: 10,  maxRate: 2.5,  maxVoices: 1 },
  grasshopper: { peak: 0.05,  ref: 3,   roll: 1.0, near: 3,   far: 20,  minGap: 6,   maxRate: 3,    maxVoices: 1 },
  deer:        { peak: 0.12,  ref: 20,  roll: 1.0, near: 70,  far: 160, minGap: 70,  maxRate: 0.35, maxVoices: 1 },
  fox:         { peak: 0.14,  ref: 20,  roll: 1.0, near: 80,  far: 190, minGap: 100, maxRate: 0.25, maxVoices: 1 },
  lap:         { peak: 0.06,  ref: 2,   roll: 1.0, near: 2,   far: 16,  minGap: 1.5, maxRate: 10,   maxVoices: 2 },
  creak:       { peak: 0.07,  ref: 4,   roll: 1.0, near: 6,   far: 30,  minGap: 6,   maxRate: 4,    maxVoices: 1 },
  drip:        { peak: 0.045, ref: 1.5, roll: 1.2, near: 1.5, far: 9,   minGap: 0.35, maxRate: 28,  maxVoices: 3 },
};

/** Hard cap on events sounding at once, across all kinds (CPU and clarity). */
export const MAX_ACTIVE = 5;

/** Inverse-distance gain of a kind at distance d (what its PannerNode does). */
export function distanceGain(kind, d) {
  const k = KIND[kind];
  const dd = Math.max(d, k.ref);
  return k.ref / (k.ref + k.roll * (dd - k.ref));
}

/** Loudest amplitude a kind can reach at distance d. */
export function peakAt(kind, d) {
  return KIND[kind].peak * distanceGain(kind, d);
}

const HABS = {
  frog: new Map([[H.marsh, 1.5], [H.river, 1], [H.meadow, 0.7], [H.woodland, 0.6], [H.shrub, 0.7], [H.conifer, 0.4], [H.beach, 0.2]]),
  squirrel: new Map([[H.woodland, 1], [H.conifer, 0.7], [H.shrub, 0.4]]),
  rustle: new Map([[H.woodland, 1], [H.conifer, 0.8], [H.shrub, 1.1], [H.meadow, 0.7], [H.marsh, 0.6], [H.river, 0.5], [H.alpine, 0.3], [H.beach, 0.2]]),
  bee: new Map([[H.meadow, 1], [H.shrub, 0.6], [H.beach, 0.25], [H.woodland, 0.15]]),
  grasshopper: new Map([[H.meadow, 1], [H.shrub, 0.6], [H.beach, 0.4], [H.alpine, 0.3]]),
  deer: new Map([[H.woodland, 1], [H.conifer, 0.9], [H.meadow, 0.8], [H.shrub, 0.8], [H.marsh, 0.4], [H.alpine, 0.3]]),
  fox: new Map([[H.meadow, 1], [H.woodland, 0.8], [H.shrub, 0.8], [H.marsh, 0.5], [H.alpine, 0.4], [H.snow, 0.6], [H.conifer, 0.7]]),
  creak: new Map([[H.woodland, 1], [H.conifer, 1], [H.shrub, 0.4]]),
};
/** Habitats a rustle, a squirrel... may be placed in (same tables as the rates). */
export function habitatWeight(kind, habitat) {
  return HABS[kind]?.get(habitat) ?? 0;
}

const exp = (d, k) => (Number.isFinite(d) ? Math.exp(-Math.max(0, d) / k) : 0);
/** 0 by day, 1 deep night, via the light level. */
const nightness = (light) => 1 - smoothstep(0.08, 0.5, light);
/** Dusk and dawn: the middle light levels. */
const twilightness = (light) => smoothstep(0.02, 0.2, light) * (1 - smoothstep(0.3, 0.6, light));

/**
 * Wet ground after rain, 0..1: rises with rain, dries over about ten minutes, and ground
 * mist keeps a floor under it. Pure step so it can be tested.
 */
export function stepWetness(w, rain, dt, mist = 0) {
  rain = clamp01(+rain || 0);
  dt = Math.max(0, +dt || 0);
  let v = clamp01(+w || 0);
  if (rain > 0.05) v += rain * dt / 45;
  else v *= Math.exp(-dt / 420);
  return Math.max(clamp01(v), 0.45 * clamp01(+mist || 0));
}

/**
 * Events per minute of every kind for the current place and weather. Each is 0 when the
 * thing could not plausibly be heard, and never above KIND[k].maxRate.
 *
 * @param {object} p
 * @param {object} p.env core.Env
 * @param {number} p.region core.RegionID under the listener
 * @param {number} p.habitat core.Habitat under the listener (-1 / undefined = unknown)
 * @param {number} p.canopy 0..1
 * @param {number} p.waterDist m to any standing water (Infinity = none within the probes)
 * @param {number} p.seaDist m to deep water
 * @param {number} p.creekDist m to running water
 * @param {number} p.wetness 0..1 (stepWetness)
 * @returns {Record<string, number>}
 */
export function wildlifeRates(p) {
  const env = p.env || {};
  const season = SEASON(env);
  const light = daylight(env);
  const wind = clamp01(+env.wind || 0);
  const rain = clamp01(+env.rain || 0);
  const cloud = clamp01(+env.cloud || 0);
  const canopy = clamp01(p.canopy || 0);
  const region = Number.isFinite(p.region) ? p.region : 0;
  const hab = Number.isFinite(p.habitat) ? p.habitat : -1;
  const night = nightness(light);
  const calm = (1 - 0.8 * rain) * (1 - 0.6 * wind);
  const frost = region === R.frostveil;
  const out = Object.fromEntries(KINDS.map((k) => [k, 0]));

  // Frogs: still water, spring and summer, from dusk through the night, loud after rain.
  {
    const water = exp(Math.max(0, p.waterDist - 4), 38) * (1 - 0.85 * exp(p.creekDist, 10));
    const hw = hab >= 0 ? habitatWeight('frog', hab) : 0.6;
    const season_ = [0.9, 1, 0.15, 0][season];
    const time = 0.08 + 0.92 * Math.max(night, twilightness(light) * 0.8);
    const wet = 0.8 + 0.5 * clamp01(p.wetness) + 0.4 * rain;
    const windMask = 1 - 0.7 * wind;
    out.frog = frost ? 0 : KIND.frog.maxRate * water * Math.min(1.5, hw) / 1.5 * season_ * time * wet * windMask * (region === R.marsh ? 1 : 0.7);
  }

  // Squirrels: woodland by day, busiest in autumn (stores), not in rain or a gale.
  {
    const hw = hab >= 0 ? habitatWeight('squirrel', hab) : (canopy > 0.5 ? 0.6 : 0);
    const treed = smoothstep(0.15, 0.55, canopy);
    const day = smoothstep(0.45, 0.8, light);
    const s = [1, 1, 1.4, 0.35][season] * (frost ? 0.5 : 1);
    out.squirrel = KIND.squirrel.maxRate * hw * treed * day * s * (1 - rain) * (1 - 0.7 * wind) / 1.4;
  }

  // Rustles in leaf litter and undergrowth: any time, more at dusk and night.
  {
    const hw = hab >= 0 ? habitatWeight('rustle', hab) : 0.3;
    const s = [1, 1, 1.2, 0.3][season];
    const t = 0.55 + 0.45 * Math.max(night, twilightness(light));
    out.rustle = KIND.rustle.maxRate * Math.min(1.1, hw) / 1.1 * s * t * (1 - 0.85 * rain) * (1 - 0.7 * wind) * (hab === H.snow || frost ? 0.3 : 1);
  }

  // Bees and hoverflies: flowery open ground, warm and sunny, calm.
  {
    const hw = hab >= 0 ? habitatWeight('bee', hab) : 0;
    const sun = smoothstep(0.55, 0.9, light) * (1 - 0.8 * cloud);
    const s = [0.7, 1, 0.3, 0][season];
    out.bee = KIND.bee.maxRate * hw * sun * s * (1 - rain) * Math.max(0, 1 - 1.4 * wind) * (frost ? 0 : 1);
  }

  // Grasshoppers: summer meadows at midday (the bed's soft insect buzz stays underneath).
  {
    const hw = hab >= 0 ? habitatWeight('grasshopper', hab) : 0;
    const hot = smoothstep(0.7, 0.95, light) * (1 - 0.6 * cloud);
    const s = [0.12, 1, 0.45, 0][season];
    out.grasshopper = KIND.grasshopper.maxRate * hw * hot * s * (1 - rain) * Math.max(0, 1 - 1.2 * wind) * (frost ? 0 : 1);
  }

  // A distant deer's bark: dusk, dawn and night, rare; the rut makes it likelier.
  {
    const hw = hab >= 0 ? habitatWeight('deer', hab) : 0;
    const t = Math.max(twilightness(light), 0.4 * night);
    const s = [0.6, 0.6, 1, 0.4][season];
    out.deer = KIND.deer.maxRate * hw * t * s * (1 - rain) * (1 - 0.8 * wind) * (region === R.coast ? 0.3 : 1);
  }

  // A fox's call: night and dusk, rarer still, most in winter.
  {
    const hw = hab >= 0 ? habitatWeight('fox', hab) : 0;
    const t = Math.max(0.6 * twilightness(light), night);
    const s = [0.7, 0.6, 0.9, 1][season];
    out.fox = KIND.fox.maxRate * hw * t * s * (1 - rain) * (1 - 0.8 * wind) * (region === R.coast ? 0.3 : 1);
  }

  // Wavelets lapping the shore of a lake, pond or sea; running water drowns them.
  {
    const near = exp(p.waterDist, 9);
    const sea = Number.isFinite(p.seaDist) && p.seaDist < 90 ? 1 : 0.7;
    const masked = 1 - 0.85 * exp(p.creekDist, 14);
    out.lap = KIND.lap.maxRate * near * sea * masked * (0.35 + 0.65 * wind) * (1 - 0.6 * rain);
  }

  // Branches creak in strong wind, among trees.
  {
    const hw = hab >= 0 ? habitatWeight('creak', hab) : (canopy > 0.5 ? 0.6 : 0);
    const w = smoothstep(0.5, 0.9, wind);
    out.creak = KIND.creak.maxRate * hw * smoothstep(0.3, 0.7, canopy) * w * (frost ? 0.5 : 1) * ([1, 1, 1.1, 0.7][season]);
  }

  // Drips after rain (the rain bed has its own canopy drips while it falls).
  {
    const wet = clamp01(p.wetness);
    const dripping = wet > 0.06 && rain < 0.2 ? wet * (1 - rain / 0.2) : 0;
    out.drip = KIND.drip.maxRate * dripping * (0.2 + 0.8 * canopy) * (frost && season === 3 ? 0.2 : 1);
  }

  for (const k of KINDS) {
    const v = out[k];
    out[k] = Number.isFinite(v) ? Math.min(KIND[k].maxRate, Math.max(0, v)) : 0;
    if (out[k] < 0.02 * KIND[k].maxRate) out[k] = 0;
  }
  return out;
}

/**
 * Does an event of this kind start during `dt` seconds? A Poisson process with the
 * rate (events per minute) and a minimum gap, so rates can change smoothly.
 */
export function shouldFire(rate, dt, sinceLast, minGap, rng) {
  if (!(rate > 0) || sinceLast < minGap) return false;
  const p = 1 - Math.exp(-rate * Math.max(0, dt) / 60);
  return rng() < p;
}

/**
 * Where may an event of `kind` happen? Tries a few random spots in the kind's distance
 * band around the listener and returns the first the world allows, or null.
 *
 * @param {string} kind
 * @param {() => number} rng
 * @param {{x:number, z:number}} L the listener
 * @param {{habitatAt?: Function, waterDepthAt?: Function, canopyAt?: Function, heightAt?: Function, listenerY?: number}} w
 *   world accessors (any may be missing)
 * @returns {{x:number, y:number, z:number, d:number, ang:number} | null}
 */
export function pickSpot(kind, rng, L, w = {}) {
  const k = KIND[kind];
  if (!k) return null;
  const call = (fn, x, z) => { try { const v = fn?.(x, z); return Number.isFinite(v) ? v : undefined; } catch { return undefined; } };
  const depth = (x, z) => call(w.waterDepthAt, x, z);
  const hab = (x, z) => call(w.habitatAt, x, z);
  const can = (x, z) => call(w.canopyAt, x, z);
  const ground = (x, z) => {
    const h = call(w.heightAt, x, z);
    return h !== undefined ? h : (Number.isFinite(w.listenerY) ? w.listenerY - 1.6 : 0);
  };
  const tries = kind === 'frog' || kind === 'lap' ? 10 : 6;
  for (let i = 0; i < tries; i++) {
    const ang = rng() * Math.PI * 2;
    const d = k.near + (k.far - k.near) * Math.pow(rng(), kind === 'deer' || kind === 'fox' ? 1 : 1.4);
    const x = L.x + Math.sin(ang) * d;
    const z = L.z - Math.cos(ang) * d;
    const dep = depth(x, z);
    const h = hab(x, z);
    const c = can(x, z);
    const dry = dep === undefined || dep < 0.05;
    let y = ground(x, z);
    switch (kind) {
      case 'frog':
        if (dep === undefined) { if (h !== H.marsh) continue; }
        else if (!((dep > 0.03 && dep < 1.6) || h === H.marsh)) continue;
        y = Math.max(y, 0) + 0.1;
        break;
      case 'lap':
        if (dep === undefined || !(dep > 0.02 && dep < 0.7)) continue;
        y = 0.05;
        break;
      case 'squirrel':
        if (c !== undefined ? c < 0.3 : h === undefined) continue;
        if (!dry) continue;
        y += 1.5 + rng() * 4;
        break;
      case 'creak':
        if (c !== undefined ? c < 0.35 : false) continue;
        if (!dry) continue;
        y += 3 + rng() * 6;
        break;
      case 'bee':
        if (h !== undefined && habitatWeight('bee', h) === 0) continue;
        if (h === undefined) continue;
        if (!dry) continue;
        y += 0.8 + rng() * 1.2;
        break;
      case 'grasshopper':
        if (h === undefined || habitatWeight('grasshopper', h) === 0) continue;
        if (!dry) continue;
        y += 0.15;
        break;
      case 'rustle':
        if (!dry) continue;
        if (h !== undefined && habitatWeight('rustle', h) === 0) continue;
        y += 0.05;
        break;
      case 'deer':
      case 'fox':
        if (!dry) continue;
        if (h !== undefined && habitatWeight(kind, h) === 0) continue;
        y += 0.6;
        break;
      case 'drip':
        y += 0.05;
        break;
      default:
        return null;
    }
    return { x, y, z, d, ang };
  }
  return null;
}

/**
 * Worst-case amplitude (peak, on the ambience bus input) of everything that could be
 * sounding at once for these rates: the nearest placement of every enabled kind. Used by
 * the mix check; deliberately pessimistic (events are sparse, so this is rarely reached).
 */
export function wildlifeWorstCase(rates) {
  let power = 0;
  const parts = {};
  for (const k of KINDS) {
    if (!(rates[k] > 0)) continue;
    const a = peakAt(k, KIND[k].near);
    parts[k] = a;
    power += (a * 0.5) * (a * 0.5) * Math.min(KIND[k].maxVoices, 2);
  }
  return { rms: Math.sqrt(power), parts };
}
