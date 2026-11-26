// Pure compass maths (no DOM, no three). Headings follow the world convention in
// internal/core/types.go: radians, 0 = north (-Z), +PI/2 = east (+X), clockwise.
export const TAU = Math.PI * 2;
export const RAD2DEG = 180 / Math.PI;

/** Wrap an angle to (-PI, PI]. */
export function wrapPi(a) {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

/** Wrap an angle to [0, 2PI). */
export function wrap2Pi(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** Signed bearing of `bearing` relative to the player's heading: + = to the right. */
export function relBearing(bearing, yaw) {
  return wrapPi(bearing - yaw);
}

/**
 * Where a bearing sits on a scrolling strip showing +-halfSpan radians around the
 * heading. Returns -1..1 (0 = centre) or null when it is off the strip.
 */
export function stripOffset(bearing, yaw, halfSpan) {
  const rel = relBearing(bearing, yaw);
  return Math.abs(rel) <= halfSpan ? rel / halfSpan : null;
}

/** Compass heading from (fx,fz) to (tx,tz) in world metres. */
export function headingTo(fx, fz, tx, tz) {
  return wrap2Pi(Math.atan2(tx - fx, -(tz - fz)));
}

/** Heading in whole degrees 0..359. */
export function headingDegrees(yaw) {
  return Math.round(wrap2Pi(yaw) * RAD2DEG) % 360;
}

/** Rotation in degrees for an arrow that points up when the sound is dead ahead. */
export function arrowDegrees(bearing, yaw) {
  return Math.round(relBearing(bearing, yaw) * RAD2DEG * 10) / 10;
}

/** Width of a clue tick as a fraction of the strip: its +-spread, never thinner than a hairline. */
export function spreadWidth(spread, halfSpan, min = 0.012) {
  return Math.max(min, Math.min(1, (Math.abs(spread) || 0) / halfSpan));
}

const MARK_LABELS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

/** Fixed tick table: every `stepDeg` degrees, labelled at the eight cardinal points. */
export function tickTable(stepDeg = 15) {
  const out = [];
  for (let deg = 0; deg < 360; deg += stepDeg) {
    out.push({ deg, rad: deg / RAD2DEG, label: MARK_LABELS[deg] || '', major: deg % 90 === 0, mid: deg % 45 === 0 });
  }
  return out;
}

/**
 * Landmark pips for stats.compass >= 2. `locations` is profile.journal.locations
 * (id -> {name, pos:{x,z}}). Only discovered entries exist there, so nothing is leaked.
 * Returns the nearest `limit` landmarks that fall on the strip, nearest first.
 */
export function landmarkPips(locations, px, pz, yaw, halfSpan, limit = 5, maxDist = 900) {
  const out = [];
  for (const [id, loc] of Object.entries(locations || {})) {
    if (!loc || !loc.pos) continue;
    const dx = loc.pos.x - px, dz = loc.pos.z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist > maxDist || dist < 3) continue;
    const bearing = headingTo(px, pz, loc.pos.x, loc.pos.z);
    const offset = stripOffset(bearing, yaw, halfSpan);
    if (offset == null) continue;
    out.push({ id, name: loc.name || '', kind: loc.kind || '', dist, bearing, offset });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out.slice(0, limit);
}

/**
 * Where to draw a movement cue, in 0..1 screen fractions.
 * In view: a shimmer at the bird's direction. Out of view: a ripple pushed to the
 * screen edge along the direction of the bearing (behind = bottom edge).
 * `vfovDeg` is the camera's vertical FOV, `aspect` its width/height.
 */
export function cuePlacement(cue, yaw, pitch, vfovDeg, aspect, margin = 0.05) {
  const rel = relBearing(cue.bearing, yaw);
  const tv = Math.tan((vfovDeg / RAD2DEG) / 2);
  const th = tv * (aspect || 16 / 9);
  const dPitch = (cue.elev || 0) - (pitch || 0);
  if (cue.inView && Math.abs(rel) < Math.PI / 2 && Math.abs(dPitch) < Math.PI / 2) {
    const x = 0.5 + (Math.tan(rel) / th) * 0.5;
    const y = 0.5 - (Math.tan(dPitch) / tv) * 0.5;
    if (x >= margin && x <= 1 - margin && y >= margin && y <= 1 - margin) {
      return { x, y, edge: false, angle: rel };
    }
  }
  const dx = Math.sin(rel), dy = -Math.cos(rel);
  const half = 0.5 - margin;
  const t = Math.min(half / (Math.abs(dx) || 1e-6), half / (Math.abs(dy) || 1e-6));
  return { x: 0.5 + dx * t, y: 0.5 + dy * t, edge: true, angle: rel };
}
