// Pure maths for the sound ring (no DOM, no three). Headings follow the world convention
// in internal/core/types.go: radians, 0 = north (-Z), +PI/2 = east (+X), clockwise.
// Ring angles use the same sense: 0 = top of the ring, +PI/2 = right, PI = bottom.
//
// Everything here is driven by what the player PERCEIVES (proto.Clue's bearing, spread,
// elevation, which already contain the listener's error), never by a bird's position.

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Wrap an angle to (-PI, PI]. */
export function wrapPi(a) {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

/** Signed angle of a compass bearing relative to the view heading: + = to the right. */
export function relAngle(bearing, yaw) { return wrapPi((bearing || 0) - (yaw || 0)); }

/** Shortest-way interpolation between two angles. */
export function lerpAngle(a, b, t) { return wrapPi(a + wrapPi(b - a) * t); }

/** Frame-rate independent exponential ease toward a target (tau = time constant, s). */
export function ease(cur, target, dt, tau) {
  if (!(tau > 0) || !(dt > 0)) return dt > 0 ? target : cur;
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

/** Same as ease() for angles: turns the shortest way and returns a wrapped angle. */
export function easeAngle(cur, target, dt, tau) {
  if (!(tau > 0) || !(dt > 0)) return dt > 0 ? wrapPi(target) : cur;
  return wrapPi(cur + wrapPi(target - cur) * (1 - Math.exp(-dt / tau)));
}

export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

export function smoothstep(e0, e1, x) {
  if (e1 === e0) return x < e0 ? 0 : 1;
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Half-width of an arc (radians on the ring) from the clue's ± spread: never thinner
 *  than a tick, never wider than most of a quadrant. */
export function arcHalfWidth(spread, min = 4 * DEG, max = 80 * DEG) {
  const s = Math.abs(Number(spread) || 0);
  return s < min ? min : s > max ? max : s;
}

// Words the engine sends while it has no elevation angle: a source more than 12 degrees
// above / below the ear is "above" / "below" (internal/field/hearing.go).
const WORD_ELEV = {
  above: { angle: 26 * DEG, spread: 14 * DEG },
  level: { angle: 0, spread: 12 * DEG },
  below: { angle: -22 * DEG, spread: 10 * DEG },
};

/**
 * The perceived elevation of a clue: {angle, spread} in radians (+ = up, from the
 * listener's ear), or null when the player cannot tell. Prefers a numeric angle when the
 * engine sends one (elevAngle / elev, with elevSpread), else the above|level|below word.
 * Writes into `out` when given (no allocation).
 */
export function clueElevation(clue, out) {
  if (!clue) return null;
  let angle = null, spread = null;
  // proto.Clue: elev (rad, + up) with elevSpread > 0; elevSpread 0 = cannot tell, and a
  // level voice arrives with elev omitted (0) but a spread.
  const hasSpread = typeof clue.elevSpread === 'number' && clue.elevSpread > 0;
  const num = typeof clue.elevAngle === 'number' ? clue.elevAngle
    : typeof clue.elev === 'number' ? clue.elev
      : typeof clue.elevation === 'number' ? clue.elevation
        : hasSpread ? 0 : null;
  if (num != null && Number.isFinite(num)) {
    angle = num;
    const s = hasSpread ? clue.elevSpread : typeof clue.elevErr === 'number' ? clue.elevErr : 8 * DEG;
    spread = Math.max(2 * DEG, Math.abs(s));
  } else {
    const w = WORD_ELEV[clue.elevation];
    if (!w) return null;
    angle = w.angle; spread = w.spread;
  }
  const o = out || {};
  o.angle = angle; o.spread = spread;
  return o;
}

/** 0..1 how near the source sounds: from the distance band when known, else loudness. */
export function nearness(clue) {
  const hi = Number(clue?.distMax) || 0, lo = Number(clue?.distMin) || 0;
  if (hi > 0) {
    const mid = (Math.max(0, lo) + hi) / 2;
    return 1 - smoothstep(6, 60, mid);
  }
  return clamp01(Number(clue?.strength) || 0);
}

/**
 * How strongly and thickly to draw an arc.
 * @param strength 0..1 perceived loudness
 * @param near     0..1 nearness
 * @param half     arc half-width (rad)
 * @param fade     0..1 life left
 * @param pulse    0..1 just called
 * Writes {alpha, width} into out (line width in CSS px at the "normal" ring size).
 */
export function arcStyle(strength, near, half, fade, pulse, out) {
  const loud = clamp01(strength), n = clamp01(near), p = clamp01(pulse);
  // A wide smear is faint, a tight tick is bright.
  const vague = smoothstep(10 * DEG, 70 * DEG, half);
  let alpha = (0.72 + 0.18 * loud + 0.1 * n) * (1 - 0.22 * vague);
  alpha = clamp01(alpha * clamp01(fade) + 0.35 * p * clamp01(fade + 0.3));
  const width = 3 + 3 * n + 1.5 * loud - 1.2 * vague + 2.5 * p;
  const o = out || {};
  o.alpha = alpha;
  o.width = width < 1.4 ? 1.4 : width;
  return o;
}

/**
 * Where a perceived direction sits relative to the view.
 * @param rel   bearing relative to the heading (rad, + right)
 * @param elev  perceived elevation from the ear (rad, + up), or null if unknown
 * @param pitch view pitch (rad, + up)
 * @param halfH half horizontal FOV (rad); halfV half vertical FOV (rad, kept for callers)
 * Writes into out:
 *   flat    ring angle when the source is NOT in view: just the relative bearing
 *   screen  ring angle of the direction on screen (from the centre toward the source)
 *   front   0..1 how far inside the view's width the source lies (1 = well inside)
 *   angle   the ring angle to draw: flat blended into screen by `front`
 *   offset  angle between the line of sight and the perceived direction (rad); with an
 *           unknown elevation only the horizontal part counts
 *   up      perceived elevation relative to the line of sight (rad, + above), 0 if unknown
 */
export function viewPlacement(rel, elev, pitch, halfH, halfV, out) {
  const o = out || {};
  const p = pitch || 0;
  const known = elev != null && Number.isFinite(elev);
  const e = known ? elev : p; // unknown: assume level with the gaze
  const ce = Math.cos(e), se = Math.sin(e);
  const dx = Math.sin(rel) * ce;            // right
  const dy = se;                            // world up
  const dz = Math.cos(rel) * ce;            // ahead (yaw frame)
  const cp = Math.cos(p), sp = Math.sin(p);
  const fwd = dz * cp + dy * sp;
  const up = dy * cp - dz * sp;
  const right = dx;
  o.flat = wrapPi(rel);
  // "In front" is judged on the horizontal angle only: a voice ahead but below the view
  // (looking up into the canopy while it sings low) still homes to the bottom of the ring.
  const front = 1 - smoothstep(0.6 * halfH, 0.95 * halfH, Math.abs(wrapPi(rel)));
  o.front = front;
  // Straight ahead the screen direction is undefined: fall back to the flat angle.
  const r2 = right * right + up * up;
  o.screen = r2 > 1e-10 ? Math.atan2(right, up) : o.flat;
  o.angle = front > 0 ? lerpAngle(o.flat, o.screen, front) : o.flat;
  const c = Math.max(-1, Math.min(1, fwd));
  o.offset = known ? Math.acos(c) : Math.abs(wrapPi(rel));
  o.up = known ? wrapPi(e - p) : 0;
  return o;
}

/**
 * 0..1 "you are looking the right way": 1 while the line of sight is inside the clue's
 * uncertainty around the perceived direction, fading out to 1.6 x that.
 * tol = the larger of the bearing and elevation spreads, never below 3 degrees.
 */
export function onTarget(offset, spread, elevSpread = 0) {
  const tol = Math.max(3 * DEG, Math.abs(spread) || 0, Math.abs(elevSpread) || 0);
  return 1 - smoothstep(tol, tol * 1.6 + 2 * DEG, Math.abs(offset));
}

/** Life left of a clue: 1 right after a call, ~0.45 at the end of its ttl, then out over
 *  the last `tail` seconds. */
export function lifeFade(left, ttl, tail = 1.2) {
  if (!(left > 0)) return 0;
  const t = ttl > 0 ? clamp01(left / ttl) : 0;
  return (0.45 + 0.55 * t) * Math.min(1, left / tail);
}

/** Ring radius in CSS px for a viewport height and the size setting. */
export const RING_SIZES = { small: 0.14, normal: 0.175, large: 0.21 };
export function ringRadius(viewH, size, focus = false, slim = false) {
  const f = RING_SIZES[size] || RING_SIZES.normal;
  let r = viewH * f;
  if (focus) r *= 1.18;
  if (slim) r *= 1.35; // inside the binocular / camera mask the view is busier at the centre
  return r;
}

/**
 * Pick the indices of the `max` most important sources into `outIdx` (no allocation):
 * quest quarry first, then strength. `items[i]` has {score}; a negative score is skipped.
 * Returns the count.
 */
export function pickTop(items, count, max, outIdx, key = 'score') {
  let n = 0;
  for (let i = 0; i < count; i++) {
    const s = items[i][key];
    if (!(s >= 0)) continue; // free slots carry a negative score
    let j = n < max ? n : max;
    if (j === max && !(s > items[outIdx[max - 1]][key])) continue;
    if (j === max) j = max - 1;
    while (j > 0 && items[outIdx[j - 1]][key] < s) { outIdx[j] = outIdx[j - 1]; j--; }
    outIdx[j] = i;
    if (n < max) n++;
  }
  return n;
}

/** The layer to look in, as words, from the clue (an explicit layer the engine sends, or
 *  Habitat Reading's perch hint), or ''. */
const LAYER_WORDS = {
  ground: 'low, near the ground',
  low: 'low, near the ground',
  head: 'about head height',
  mid: 'up in the branches',
  branches: 'up in the branches',
  high: 'high up in the trees',
  canopy: 'high up in the canopy',
  air: 'in flight',
  water: 'out on the water',
};
const PERCH_LAYER = {
  'on or near the ground': 'low, near the ground',
  'low in dense cover': 'low, in dense cover',
  'on a low perch': 'about head height',
  'among mid-level foliage': 'up in the branches',
  'on an open branch': 'up on an open branch',
  'high in the canopy': 'high up in the canopy',
  'on a high, open perch': 'high, on an open perch',
  'on the wing': 'in flight',
  'out on the water': 'out on the water',
  "at the water's edge": "at the water's edge",
  'on a trunk': 'on a tree trunk',
};
export function layerText(clue) {
  if (!clue) return '';
  const l = typeof clue.layer === 'string' ? clue.layer.trim() : '';
  if (l) return LAYER_WORDS[l.toLowerCase()] || l;
  const p = typeof clue.perch === 'string' ? clue.perch.trim() : '';
  if (p) return PERCH_LAYER[p.toLowerCase()] || p;
  return '';
}

/** The numeric perceived elevation of a clue (rad, + up), or undefined when the engine
 *  sent none (then only its above|level|below word is known). */
export function clueElevAngle(clue) {
  if (!clue) return undefined;
  if (typeof clue.elevAngle === 'number' && Number.isFinite(clue.elevAngle)) return clue.elevAngle;
  if (typeof clue.elevSpread === 'number' && clue.elevSpread > 0) return Number(clue.elev) || 0;
  return undefined;
}
