// Level-of-detail decisions and small view maths for birds. Pure module.
//
// Full skinned models are drawn within LOD_NEAR metres — scaled by the current optical
// zoom, because through 8× binoculars a bird at 200 m fills as much of the screen as
// one at 25 m with the naked eye, and identification depends on seeing it properly.
// Beyond that a bird is a tiny dark camera-facing speck (what a distant bird really
// looks like), and beyond the fog nothing at all. A per-quality budget caps the number
// of full models; the nearest win.

import { LOD_NEAR, LOD_HYST } from './constants.js';

export const LOD = Object.freeze({ NONE: 0, FULL: 1, SPECK: 2 });

/** Full models allowed at once per quality setting. */
export const FULL_BUDGET = Object.freeze({ low: 48, medium: 90, high: 150 });

export function fullBudget(quality) {
  return FULL_BUDGET[quality] || FULL_BUDGET.medium;
}

/**
 * Optical zoom implied by the camera: how much narrower its vertical FOV is than the
 * naked-eye FOV (both in degrees). 1 when not zoomed.
 */
export function zoomFactor(baseFovDeg, camFovDeg) {
  const b = Math.tan(((baseFovDeg > 1 ? baseFovDeg : 70) * Math.PI) / 360);
  const c = Math.tan(((camFovDeg > 0.1 ? camFovDeg : 70) * Math.PI) / 360);
  const z = b / c;
  return Number.isFinite(z) && z > 1 ? z : 1;
}

/** Distance (m) within which full models are drawn at a given zoom. */
export function fullRange(zoom, base = LOD_NEAR) {
  return base * Math.min(Math.max(zoom, 1), 12);
}

/**
 * Choose the LOD for a bird at `dist` metres given its previous LOD. Hysteresis keeps a
 * bird hovering near the boundary from flickering between model and speck.
 * @param far  fog end distance (Infinity if there is no fog): nothing beyond it.
 */
export function chooseLod(prev, dist, near, far = Infinity, hyst = LOD_HYST) {
  if (!(dist <= far)) return LOD.NONE;
  if (prev === LOD.FULL) return dist <= near + hyst ? LOD.FULL : LOD.SPECK;
  return dist <= near ? LOD.FULL : LOD.SPECK;
}

/** Angle subtended by one screen pixel (radians) for a vertical FOV and screen height. */
export function pixelAngle(fovDeg, screenH) {
  const h = screenH > 0 ? screenH : 900;
  return (2 * Math.tan(((fovDeg > 0.1 ? fovDeg : 70) * Math.PI) / 360)) / h;
}

/**
 * World size of a distant-bird speck: its true size, but never thinner than ~0.7 px so
 * it does not shimmer in and out between pixels (a sub-pixel quad aliases badly).
 */
export function speckSize(length, dist, pxAngle) {
  return Math.max(length * 0.9, dist * pxAngle * 0.7);
}

/** Compass heading (0 = north/−Z, π/2 = east/+X) from (ax, az) towards (bx, bz). */
export function headingTo(ax, az, bx, bz) {
  return Math.atan2(bx - ax, -(bz - az));
}

/** Bearing of the viewer relative to a bird's own heading, wrapped to (−π, π]. */
export function relativeBearing(yaw, birdX, birdZ, viewX, viewZ) {
  let a = headingTo(birdX, birdZ, viewX, viewZ) - yaw;
  a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a === -Math.PI ? Math.PI : a;
}

/** Fade-in / fade-out scale with a soft overshoot-free ease (0..1). */
export function fadeScale(age, dur) {
  if (!(dur > 0)) return 1;
  const t = Math.min(Math.max(age / dur, 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The distance below which the k-th nearest bird lies: returns the threshold so that at
 * most `budget` of the given distances are ≤ it. `scratch` is a reusable Float32Array
 * at least as long as n. No allocation.
 */
export function budgetCutoff(dists, n, budget, scratch) {
  if (n <= budget) return Infinity;
  for (let i = 0; i < n; i++) scratch[i] = dists[i];
  const view = scratch.subarray(0, n);
  view.sort();
  return budget > 0 ? view[budget - 1] : -Infinity;
}
