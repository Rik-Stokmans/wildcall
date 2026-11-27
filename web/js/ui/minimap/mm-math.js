// Pure minimap maths (no DOM). World convention (internal/core/types.go): metres, north =
// -Z, east = +X, yaw is a compass heading in radians (0 = north, PI/2 = east, clockwise).
// Minimap pixels: origin at the centre of the disc, +x right, +y down.
//   north-up:    world +X is right, world -Z (north) is up.
//   heading-up:  the direction the player faces is up (the map turns by -yaw).

import { stripOffset, headingTo } from '../hud/compass.js';
import { formatDistance, compassName } from '../journal/format.js';

/** Two ranges (metres from the centre to the rim): near and far. */
export const ZOOMS = [120, 300];

/** Rotation applied to the map, in radians (canvas/CSS convention: + = clockwise). */
export function mapRotation(yaw, rotate) { return rotate ? -(yaw || 0) : 0; }

/** World offset (dx, dz) from the player -> minimap pixels, at `scale` px per metre. */
export function worldToMini(dx, dz, yaw, rotate, scale) {
  const a = mapRotation(yaw, rotate);
  const c = Math.cos(a), s = Math.sin(a);
  return { x: (dx * c - dz * s) * scale, y: (dx * s + dz * c) * scale };
}

/** Inverse of worldToMini: minimap pixels -> world offset from the player. */
export function miniToWorld(x, y, yaw, rotate, scale) {
  const a = -mapRotation(yaw, rotate);
  const c = Math.cos(a), s = Math.sin(a);
  return { dx: (x * c - y * s) / scale, dz: (x * s + y * c) / scale };
}

/**
 * Pin a point to the rim of a disc of radius r when it lies outside it.
 * Returns {x, y, clamped, angle} with angle in radians (0 = up, clockwise).
 */
export function rimClamp(x, y, r) {
  const d = Math.hypot(x, y);
  const angle = Math.atan2(x, -y);
  if (d <= r) return { x, y, clamped: false, angle };
  const k = r / d;
  return { x: x * k, y: y * k, clamped: true, angle };
}

/** Where the little "N" sits on the rim (radius r) in minimap pixels. */
export function northMarker(yaw, rotate, r) {
  const p = worldToMini(0, -1, yaw, rotate, r);
  return { x: p.x, y: p.y };
}

/** Rotation of the player arrow: it always points up in heading-up mode, else at yaw. */
export function arrowRotation(yaw, rotate) { return rotate ? 0 : (yaw || 0); }

/** Pixels per metre for a disc of `radiusPx` showing `rangeM` metres to the rim. */
export function scaleFor(radiusPx, rangeM) { return radiusPx / Math.max(1, rangeM); }

/**
 * Decide whether the expensive base layer must be redrawn: data changed, or the player has
 * moved so far that the pre-drawn margin no longer covers the disc.
 */
export function baseStale(base, px, pz, scale, marginPx) {
  if (!base) return true;
  if (base.scale !== scale) return true;
  return Math.hypot(px - base.x, pz - base.z) * scale > marginPx * 0.5;
}

/** Has the pose moved enough to redraw the marker layer? */
export function poseChanged(prev, cur, minMove = 0.25, minTurn = 0.006) {
  if (!prev) return true;
  if (Math.hypot(cur.x - prev.x, cur.z - prev.z) > minMove) return true;
  const dy = Math.abs(((cur.yaw - prev.yaw) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return dy > minTurn;
}

/** Opacity of a compass waypoint pin: strong close by, fading to a whisper far away. */
export function pinAlpha(dist) {
  const d = Math.max(0, dist || 0);
  if (d <= 80) return 1;
  if (d >= 2000) return 0.45;
  return 1 - 0.55 * Math.log(d / 80) / Math.log(2000 / 80);
}

/** "85 m", "1.2 km" — compact distance for pins. */
export function shortDistance(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.max(1, Math.round(m))} m`;
  return formatDistance(m);
}

/** "340 m · NE" from the player to a waypoint. */
export function distanceBearing(px, pz, w) {
  const d = Math.hypot(w.x - px, w.z - pz);
  if (d < 12) return 'right here';
  return `${formatDistance(d)} · ${compassName(headingTo(px, pz, w.x, w.z))}`;
}

/**
 * Waypoint pins for the compass strip: of the waypoints that fall on the strip, the
 * `limit` nearest. The selected one (else the nearest) is marked strong.
 * Returns [{id, letter, color, name, dist, bearing, offset, alpha, strong}], nearest first.
 */
export function waypointPips(list, px, pz, yaw, halfSpan, { limit = 4, selected = null, minDist = 3 } = {}) {
  const all = [];
  for (const w of list || []) {
    if (!w || !Number.isFinite(w.x) || !Number.isFinite(w.z)) continue;
    const dist = Math.hypot(w.x - px, w.z - pz);
    if (dist < minDist) continue;
    const bearing = headingTo(px, pz, w.x, w.z);
    const offset = stripOffset(bearing, yaw, halfSpan);
    if (offset == null) continue;
    all.push({ id: w.id, letter: w.letter || '', color: w.color, name: w.name || '', dist, bearing, offset, alpha: pinAlpha(dist), strong: false });
  }
  all.sort((a, b) => a.dist - b.dist);
  const out = all.slice(0, limit);
  const sel = selected ? all.find((p) => p.id === selected) : null;
  if (sel && !out.includes(sel)) out[out.length - 1] = sel;
  const strong = sel || out[0];
  if (strong) strong.strong = true;
  return out;
}

/**
 * Markers for the minimap from the big map's marker list (map-data.buildMarkers): places,
 * met NPCs and quest targets only when inside the disc; the cabin always (on the rim when far).
 * Returns [{m, x, y, clamped, angle, dist}] in minimap pixels.
 */
export function placeMarkers(markers, px, pz, yaw, rotate, scale, r) {
  const out = [];
  for (const m of markers || []) {
    const p = worldToMini(m.x - px, m.z - pz, yaw, rotate, scale);
    const c = rimClamp(p.x, p.y, r);
    if (c.clamped && m.type !== 'home') continue;
    out.push({ m, x: c.x, y: c.y, clamped: c.clamped, angle: c.angle, dist: Math.hypot(m.x - px, m.z - pz) });
  }
  // Draw order: places, people, quest targets, then the cabin on top.
  const rank = { place: 0, npc: 1, quest: 2, home: 3 };
  return out.sort((a, b) => (rank[a.m.type] ?? 0) - (rank[b.m.type] ?? 0));
}

/** Waypoints in minimap pixels; out of range ones pinned to the rim (radius r) with their distance. */
export function placeWaypoints(list, px, pz, yaw, rotate, scale, r) {
  const out = [];
  for (const w of list || []) {
    const p = worldToMini(w.x - px, w.z - pz, yaw, rotate, scale);
    const c = rimClamp(p.x, p.y, r);
    out.push({ w, x: c.x, y: c.y, clamped: c.clamped, angle: c.angle, dist: Math.hypot(w.x - px, w.z - pz) });
  }
  return out;
}

/**
 * The "Reached Waypoint A" line: fires once per arrival within `reach` metres, re-arms only
 * after walking `rearm` metres away. A waypoint first seen while close (e.g. "Mark here")
 * does not fire. `armed` is a Map id -> bool kept by the caller. Returns the waypoints reached.
 */
export function reachedWaypoints(list, px, pz, armed, reach = 12, rearm = 60) {
  const hit = [];
  const ids = new Set();
  for (const w of list || []) {
    ids.add(w.id);
    const d = Math.hypot(w.x - px, w.z - pz);
    if (!armed.has(w.id)) { armed.set(w.id, d > reach * 2); continue; }
    if (armed.get(w.id)) {
      if (d <= reach) { armed.set(w.id, false); hit.push(w); }
    } else if (d >= rearm) armed.set(w.id, true);
  }
  for (const id of [...armed.keys()]) if (!ids.has(id)) armed.delete(id);
  return hit;
}

/**
 * Keep rim markers (clamped waypoints and the cabin) from sitting on top of each other:
 * nearest first, each is nudged along the rim (radius r) until it is `gap` radians from the
 * ones already placed. Distance labels are kept only for one marker per `labelGap` radians.
 * An item with `noLabel` (e.g. the "N" with dist -1, placed first) is only an obstacle.
 * Mutates and returns the items ({x, y, angle, clamped, dist}); sets item.label (bool).
 */
export function spreadRim(items, r, gap = 0.24, labelGap = 0.7) {
  const rim = items.filter((it) => it.clamped).sort((a, b) => a.dist - b.dist);
  const placed = [], labelled = [];
  const diff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (const it of rim) {
    let a = it.angle;
    for (let k = 1; k <= 6 && placed.some((p) => diff(p, a) < gap); k++) a = it.angle + Math.ceil(k / 2) * gap * (k % 2 ? 1 : -1);
    placed.push(a);
    it.angle = a;
    it.x = Math.sin(a) * r;
    it.y = -Math.cos(a) * r;
    if (it.noLabel) { it.label = false; continue; } // an obstacle only (the rim's "N")
    it.label = !labelled.some((p) => diff(p, a) < labelGap);
    if (it.label) labelled.push(a);
  }
  return items;
}
