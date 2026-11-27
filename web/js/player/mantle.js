// Climbing small obstacles (spec §19.1): a comfortable mantle onto a ledge, rock, stump,
// low wall or platform edge up to ~1.2 m high with standing room on top. Pure maths: the
// controller passes a `support(x, z, probeY)` function (terrain, prop platforms and rock
// tops) and plays back the pose. No three.js, no DOM.
//
// What is NOT climbable falls out of the geometry: a tree trunk has no top to stand on,
// a cliff keeps rising past the reach, and anything above MANTLE_MAX is out of reach.
import { STEP_UP } from './movement.js';

export const MANTLE_MAX = 1.25;     // highest ledge (m above the feet) the player can climb onto
export const MANTLE_TIME = 0.62;    // seconds for the whole climb
export const MANTLE_HOLD = 0.32;    // seconds of pushing forward against a ledge before climbing by itself
export const TOP_TOLERANCE = 0.28;  // how uneven the top may be and still count as standing room

const LOOK = [0.4, 0.55, 0.7, 0.85, 1.0];

/**
 * Look for a ledge straight ahead.
 * @param {{x:number, y:number, z:number}} feet  current feet position
 * @param {{x:number, z:number}} dir            unit heading in XZ
 * @param {(x:number, z:number, probeY:number) => number} support  walkable height at a
 *        point for feet arriving from probeY (must ignore platforms above probeY + STEP_UP)
 * @returns {{x:number, y:number, z:number, rise:number}|null} where the player ends up
 */
export function findLedge(feet, dir, support) {
  if (!feet || !dir || typeof support !== 'function') return null;
  const len = Math.hypot(dir.x, dir.z);
  if (!(len > 1e-6)) return null;
  const dx = dir.x / len, dz = dir.z / len;
  const probeY = feet.y + MANTLE_MAX - STEP_UP + 0.05; // lets support() report surfaces up to MANTLE_MAX
  const at = (d, side = 0) => support(feet.x + dx * d - dz * side, feet.z + dz * d + dx * side, probeY);
  for (const d of LOOK) {
    const h = at(d);
    if (!Number.isFinite(h)) return null;
    const rise = h - feet.y;
    if (rise <= STEP_UP) continue;          // still walkable: look a little further
    if (rise > MANTLE_MAX) return null;     // a wall, a cliff or a trunk-high rock: out of reach
    // Standing room: the top must carry on, roughly level, for a body's width and depth.
    const land = d + 0.42;
    const probes = [at(d + 0.18), at(land), at(land + 0.22), at(land, 0.2), at(land, -0.2)];
    for (const p of probes) {
      if (!Number.isFinite(p) || Math.abs(p - h) > TOP_TOLERANCE) return null; // drops away or keeps climbing
    }
    const y = Math.max(h, probes[1]);
    return { x: feet.x + dx * land, y, z: feet.z + dz * land, rise: y - feet.y };
  }
  return null;
}

const easeOut = (t) => 1 - (1 - t) * (1 - t);
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Pose along a climb at progress t (0..1): first the body rises (hands on the edge, a
 * little forward), then it rolls over the top to the landing point.
 * @returns {{x:number, y:number, z:number}}
 */
export function mantlePose(t, from, to) {
  const k = Math.max(0, Math.min(1, t));
  const lift = Math.min(1, k / 0.6);
  const y = from.y + (to.y + 0.04 - from.y) * easeOut(lift) - (k > 0.6 ? 0.04 * smooth((k - 0.6) / 0.4) : 0);
  const fwd = k < 0.6 ? 0.22 * smooth(lift) : 0.22 + 0.78 * smooth((k - 0.6) / 0.4);
  return { x: from.x + (to.x - from.x) * fwd, y, z: from.z + (to.z - from.z) * fwd };
}

/** Seconds a climb of `rise` metres takes (a little quicker for low steps). */
export function mantleDuration(rise) {
  return MANTLE_TIME * (0.75 + 0.25 * Math.max(0, Math.min(1, rise / MANTLE_MAX)));
}

/**
 * Should holding forward start a climb by itself? Pushing forward against something for
 * MANTLE_HOLD seconds while barely moving.
 */
export function pushClimb(pushT, forward, speed, grounded, dt) {
  if (!grounded || !(forward > 0) || speed > 0.5) return { pushT: 0, go: false };
  const t = pushT + dt;
  return { pushT: t, go: t >= MANTLE_HOLD };
}

// ---------------------------------------------------------------------------------------
// Rock and stump tops (vegetation kinds from internal/world: 6 rock, 10 stump). Only the
// solid ones (the player collides with them) can be stood on. Heights follow the models
// in web/js/world/vegModels.js: a boulder's crown is ~0.84 × scale above its base, a
// stump's cut ~0.63 × scale.
const TOPS = {
  6: { minScale: 0.9, top: 0.84, r: 0.44 },
  10: { minScale: 0.8, top: 0.63, r: 0.33 },
};

/** Climbable tops from a vegetation list near (x, z): [{x, z, y, r}] (y = top height). */
export function collectTops(veg, x, z, radius, out = []) {
  for (const v of veg || []) {
    const t = TOPS[v.kind];
    if (!t || !(v.scale >= t.minScale)) continue;
    if (Math.abs(v.x - x) > radius || Math.abs(v.z - z) > radius) continue;
    out.push({ x: v.x, z: v.z, y: (v.y || 0) + t.top * v.scale, r: t.r * v.scale });
  }
  return out;
}

/** The highest top under (x, z) reachable from feet height y (null if none). */
export function topAt(tops, x, z, y) {
  let best = null;
  for (const t of tops || []) {
    const dx = x - t.x, dz = z - t.z;
    if (dx * dx + dz * dz > t.r * t.r) continue;
    if (t.y > y + STEP_UP) continue;
    if (!best || t.y > best.y) best = t;
  }
  return best;
}

/**
 * Walking speed multiplier from the weather (spec §20.2): rain and strong wind slow the
 * player a little (down to ×0.92); rain gear (stats.rainProof) removes that fraction.
 */
export function weatherSlow(env, rainProof = 0) {
  const ss = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const sev = Math.max(ss(0.2, 0.5, env?.rain || 0), ss(0.55, 0.8, env?.wind || 0));
  const keep = Math.max(0, Math.min(1, rainProof || 0));
  return 1 - 0.08 * sev * (1 - keep);
}

/** Extra hand sway for raised optics in wind: ×1 when still, up to ×1.9 in a gale. */
export function windSway(wind) {
  const w = Math.max(0, Math.min(1, wind || 0));
  return 1 + 0.9 * Math.pow(w, 1.5);
}
