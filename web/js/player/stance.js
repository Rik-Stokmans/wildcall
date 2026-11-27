// Stance state machine for the first-person controller: standing, crouching, lying
// flat (prone) and sitting, with the eye-height path between them and the crawl.
// Pure: no three.js, no DOM (unit-tested in stance.test.js).
//
//   stand ── C ──▶ crouch ── C ──▶ stand
//   stand ── Z ──▶ prone (down through a brief crouch)
//   crouch ─ Z ──▶ prone
//   prone ── C ──▶ crouch          prone ── Z / jump ──▶ stand (up in two stages)
//   any ──── X ──▶ sit (toggle; sitting and prone exclude each other)

import { EYE_HEIGHT, CROUCH_EYE, SIT_EYE, PRONE_EYE_H, SPEED } from './movement.js';

export const PRONE_EYE = PRONE_EYE_H;    // 0.35 m: eye above the feet on the elbows (internal/game proneEye)
export const CRAWL_SPEED = SPEED.crawl;  // 0.7 m/s straight ahead on the elbows
export const CRAWL_SIDE = 0.6;           // sideways shuffle: fraction of the forward crawl
export const CRAWL_BACK = 0.5;           // pushing backwards: fraction of the forward crawl
export const PRONE_MAX_DEPTH = 0.2;      // no lying down in water deeper than this (m)
export const PRONE_MAX_SLOPE = Math.tan(35 * Math.PI / 180); // steeper ground: slide back to a crouch
export const CRAWL_FREQ = 0.75;          // elbow-crawl cycles per second at full crawl speed
const STAGE_EPS = 0.08;                  // metres from a waypoint before the next stage starts

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Eye height above the feet for a stance. */
export function stanceEye(stance) {
  if (stance === 'prone') return PRONE_EYE;
  if (stance === 'sit') return SIT_EYE;
  if (stance === 'crouch') return CROUCH_EYE;
  return EYE_HEIGHT;
}

/** A fresh stance state: standing, eye settled. */
export function createStance() {
  return { stance: 'stand', path: [], changedAt: -Infinity };
}

/**
 * The eye-height waypoints from one stance to another. Going down to prone from
 * standing passes a crouch first, and so does standing up from prone, so the camera
 * never drops or rises the whole way in one sweep.
 */
export function eyePath(from, to) {
  if (from === to) return [stanceEye(to)];
  if ((from === 'stand' && to === 'prone') || (from === 'prone' && to === 'stand')) {
    return [CROUCH_EYE, stanceEye(to)];
  }
  return [stanceEye(to)];
}

/**
 * Apply a stance key. Returns the new stance name (possibly unchanged).
 * @param {string} cur   stand|crouch|prone|sit
 * @param {string} key   crouch|prone|jump|sit
 * @param {object} w     {grounded, depth (water at the feet, m), slope (ground grade)}
 */
export function nextStance(cur, key, w = {}) {
  const grounded = w.grounded !== false;
  const canProne = grounded && !((w.depth || 0) > PRONE_MAX_DEPTH) && !((w.slope || 0) > PRONE_MAX_SLOPE);
  switch (key) {
    case 'crouch':
      if (cur === 'crouch') return 'stand';
      return 'crouch';                              // stand, sit or prone → crouch
    case 'prone':
      if (cur === 'prone') return 'stand';
      return canProne ? 'prone' : cur;
    case 'jump':
      if (cur === 'prone' || cur === 'crouch' || cur === 'sit') return 'stand';
      return cur;
    case 'sit':
      if (cur === 'sit') return 'stand';
      return grounded ? 'sit' : cur;
  }
  return cur;
}

/**
 * Change to a stance (records the eye path and the time for the indicator).
 * @returns {boolean} true when the stance changed
 */
export function setStance(st, to, now, eyeNow) {
  if (st.stance === to) return false;
  const from = st.stance;
  st.stance = to;
  st.path = eyePath(from, to);
  // Already past the first waypoint (e.g. Z pressed while crouched): skip it.
  if (st.path.length > 1 && Number.isFinite(eyeNow) && Math.abs(eyeNow - st.path[0]) < STAGE_EPS) st.path.shift();
  st.changedAt = now;
  return true;
}

/**
 * Advance the eye height toward the current waypoint. Smooth exponential approach;
 * lying down is a little slower than getting up into a crouch, so it reads as a body
 * lowering itself rather than a camera dropping.
 * @returns {number} the new eye height
 */
export function stepEye(st, eyeH, dt) {
  const goal = st.path.length ? st.path[0] : stanceEye(st.stance);
  const rate = st.stance === 'prone' ? 5 : 7;
  const next = goal + (eyeH - goal) * Math.exp(-rate * Math.max(0, dt));
  if (st.path.length > 1 && Math.abs(next - goal) < STAGE_EPS) st.path.shift();
  return next;
}

/**
 * Camera roll (radians) while the eye is moving between stances: a slight lean that
 * settles as the eye arrives. Positive eye velocity (getting up) leans one way,
 * going down the other; never more than ~1.4 degrees.
 */
export function settleRoll(eyeVel) {
  return clamp(-eyeVel * 0.016, -0.025, 0.025);
}

/**
 * Crawl speed factor for the input direction (f forward, r right; each -1..1):
 * forward is the full crawl, sideways and backwards are slower.
 */
export function crawlDirFactor(f, r) {
  const a = Math.abs(f) + Math.abs(r);
  if (a === 0) return 0;
  const fw = f > 0 ? 1 : f < 0 ? CRAWL_BACK : 0;
  const side = r !== 0 ? CRAWL_SIDE : 0;
  // Diagonals blend the two weighted by how much of each is pressed.
  return (fw * Math.abs(f) + side * Math.abs(r)) / a;
}

/**
 * Elbow-crawl bob: amplitude (m), cycle frequency (Hz) and a roll amplitude (rad) for
 * a crawl at `speed`. Two "steps" (elbow plants) per cycle, like footfalls.
 */
export function crawlBob(speed, raised) {
  if (speed < 0.15) return { amp: 0, freq: 0, roll: 0 };
  const k = clamp(speed / CRAWL_SPEED, 0, 1.3);
  const calm = raised ? 0.3 : 1;
  return { amp: 0.022 * k * calm, freq: CRAWL_FREQ * (0.6 + 0.4 * k), roll: 0.02 * k * calm };
}

/** Is the ground grade too steep to lie on (slide back to a crouch)? */
export function tooSteepToLie(grade) {
  return grade > PRONE_MAX_SLOPE;
}

/**
 * Stance indicator visibility 0..1: fully shown for `hold` seconds after a stance
 * change, then fades out over `fade` seconds.
 */
export function indicatorAlpha(sinceChange, hold = 2.5, fade = 1) {
  if (!(sinceChange >= 0)) return 0;
  if (sinceChange <= hold) return 1;
  return clamp(1 - (sinceChange - hold) / fade, 0, 1);
}
