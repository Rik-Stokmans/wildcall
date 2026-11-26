// Map view maths: world <-> screen transforms with pan / zoom (unbounded), scale-bar
// picking, edge arrows for off-screen targets. The map is north-up: world +x is screen
// right, world +z (south) is screen down. View = { cx, cz, scale } where (cx, cz) is the
// world point at the screen centre and scale is pixels per metre.

import { clamp } from './format.js';

export const MIN_SCALE = 0.04;   // 25 m per pixel: a whole region fits on screen
export const MAX_SCALE = 4;      // 0.25 m per pixel

export function worldToScreen(view, w, h, x, z) {
  return { x: w / 2 + (x - view.cx) * view.scale, y: h / 2 + (z - view.cz) * view.scale };
}

export function screenToWorld(view, w, h, sx, sy) {
  return { x: view.cx + (sx - w / 2) / view.scale, z: view.cz + (sy - h / 2) / view.scale };
}

/** World rectangle {x0, z0, x1, z1} visible in a w x h viewport. */
export function viewRect(view, w, h, margin = 0) {
  const hw = (w / 2 + margin) / view.scale, hh = (h / 2 + margin) / view.scale;
  return { x0: view.cx - hw, z0: view.cz - hh, x1: view.cx + hw, z1: view.cz + hh };
}

/** Drag by (dx, dy) screen pixels: the world follows the cursor. */
export function panBy(view, dx, dy) {
  return { ...view, cx: view.cx - dx / view.scale, cz: view.cz - dy / view.scale };
}

/** Zoom by `factor` keeping the world point under screen (sx, sy) fixed. */
export function zoomAt(view, w, h, sx, sy, factor) {
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const before = screenToWorld(view, w, h, sx, sy);
  const next = { ...view, scale };
  const after = screenToWorld(next, w, h, sx, sy);
  next.cx += before.x - after.x;
  next.cz += before.z - after.z;
  return next;
}

/** Wheel delta -> zoom factor (smooth, symmetric). */
export function wheelFactor(deltaY) { return Math.exp(-clamp(deltaY, -400, 400) * 0.0016); }

/**
 * A "nice" scale-bar length in metres whose on-screen width is close to targetPx.
 * Returns { metres, px, label }.
 */
export function scaleBar(scale, targetPx = 110) {
  const raw = targetPx / scale;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  let metres = pow;
  for (const m of [1, 2, 5, 10]) { if (m * pow <= raw) metres = m * pow; }
  return { metres, px: metres * scale, label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` };
}

/**
 * Where an off-screen point should be pinned: the intersection of the ray from the screen
 * centre towards (sx, sy) with the rectangle inset by `margin`. Returns null when the
 * point is inside that rectangle. Includes the pointing angle (radians, 0 = up, clockwise).
 */
export function edgeArrow(sx, sy, w, h, margin = 30) {
  const cx = w / 2, cy = h / 2;
  const dx = sx - cx, dy = sy - cy;
  const hx = cx - margin, hy = cy - margin;
  if (Math.abs(dx) <= hx && Math.abs(dy) <= hy) return null;
  const t = Math.min(dx === 0 ? Infinity : hx / Math.abs(dx), dy === 0 ? Infinity : hy / Math.abs(dy));
  return { x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dx, -dy) };
}

/** Fit a world radius (metres) into the viewport and return a view centred on (x, z). */
export function viewFor(x, z, w, h, radiusMetres) {
  const scale = clamp(Math.min(w, h) / 2 / Math.max(1, radiusMetres), MIN_SCALE, MAX_SCALE);
  return { cx: x, cz: z, scale };
}
