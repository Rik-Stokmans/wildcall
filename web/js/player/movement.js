// Pure locomotion rules for the first-person controller: move modes, the sprint /
// stamina state machine, terrain slowdown and smooth acceleration. No three.js, no DOM,
// so it can be unit-tested with node --test.
//
// Speeds are pinned by docs/contract.md §5.2 (ctx.player).

export const SPEED = Object.freeze({
  crawl: 0.7,                          // prone, on the elbows (stance.js CRAWL_SPEED)
  crouch: 1.2,
  walk: 2.4,
  run: 4.4,
  sprint: 6.5,
});

export const EYE_HEIGHT = 1.65;        // core.EyeHeight
export const CROUCH_EYE = 1.0;
export const SIT_EYE = 0.85;
export const PRONE_EYE_H = 0.35;       // lying flat (stance.js PRONE_EYE)
export const MAX_WADE = 1.2;           // metres of water the player can wade through
export const STEP_UP = 0.55;           // obstacles this high are stepped onto without a jump
export const MAX_GRADE = 0.62;         // ~32°: steeper uphill ground cannot be walked up
export const JUMP_SPEED = 4.2;         // m/s initial upward velocity
export const GRAVITY = 14;             // m/s²: a little above 9.81 so jumps feel snappy, not floaty
export const DOUBLE_TAP = 0.32;        // seconds between Shift taps that arm a sprint
export const FOCUS_SLOW = 0.4;         // focused listening: movement at 40 %
export const RAISED_SLOW = 0.55;       // looking through an instrument: careful steps
export const STILL_SPEED = 0.2;        // below this horizontal speed the player counts as still

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Initial sprint/stamina state. stamina is 0..1 (fraction of stats.stamina seconds). */
export function createSprintState() {
  return { stamina: 1, sprinting: false, lastRunTap: -Infinity, armed: false, exhausted: false, restT: 0 };
}

/**
 * Register a press of the run key at time `now` (seconds). Two presses within
 * DOUBLE_TAP arm the sprint, which lasts while the key stays held.
 */
export function runKeyDown(s, now) {
  s.armed = now - s.lastRunTap <= DOUBLE_TAP;
  s.lastRunTap = now;
}

/** The run key was released: the sprint ends. */
export function runKeyUp(s) {
  s.armed = false;
}

/**
 * Advance the stamina state machine.
 * @param {object} s       sprint state (mutated)
 * @param {object} intent  {moving, runHeld, crouching, prone, canSprint}
 * @param {number} dt      seconds
 * @param {number} sprintSeconds stats.stamina (seconds of sprint from full)
 * @returns {'walk'|'run'|'sprint'|'crouch'|'crawl'} the gait the player wants this frame
 */
export function stepGait(s, intent, dt, sprintSeconds) {
  const cap = Math.max(1, sprintSeconds || 6);
  const wantsSprint = intent.moving && intent.runHeld && s.armed && !intent.crouching && !intent.prone && intent.canSprint !== false;
  // Exhaustion: once empty, sprinting is unavailable until stamina has recovered a
  // third (and the key must be double-tapped again) — no penalty, just a breather.
  if (s.exhausted && s.stamina >= 0.33) s.exhausted = false;
  s.sprinting = wantsSprint && !s.exhausted && s.stamina > 0;
  if (s.sprinting) {
    s.stamina = Math.max(0, s.stamina - dt / cap);
    s.restT = 0;
    if (s.stamina <= 0) { s.exhausted = true; s.armed = false; s.sprinting = false; }
  } else {
    s.restT += dt;
    // Short pause before recovering; recovery is gentle but quicker when standing.
    if (s.restT > 0.6) {
      const rate = intent.moving ? 1 / (cap * 1.6) : 1 / (cap * 0.9);
      s.stamina = Math.min(1, s.stamina + dt * rate);
    }
  }
  if (intent.prone) return 'crawl';
  if (intent.crouching) return 'crouch';
  if (s.sprinting) return 'sprint';
  if (intent.runHeld && intent.moving) return 'run';
  return 'walk';
}

/**
 * Target horizontal speed for a gait with every multiplier applied.
 * @param {string} gait     walk|run|sprint|crouch
 * @param {object} m        {moveSpeed, terrainFactor, focus, raised}
 */
export function targetSpeed(gait, m = {}) {
  let v = SPEED[gait] ?? SPEED.walk;
  v *= m.moveSpeed > 0 ? m.moveSpeed : 1;
  v *= m.terrainFactor ?? 1;
  if (m.focus) v *= FOCUS_SLOW;
  if (m.raised) v = Math.min(v, SPEED.walk * RAISED_SLOW);
  return v;
}

/**
 * Terrain slowdown 0..1 (1 = no slowdown) from uphill grade, dense shrub and water
 * depth. stats.terrain (0..1) removes that fraction of the slowdown.
 * @param {object} t {grade, shrub, depth, terrain}
 *   grade: rise/run in the direction of travel (negative = downhill)
 *   shrub: 0..1 density of scrub underfoot
 *   depth: water depth at the feet in metres
 */
export function terrainFactor({ grade = 0, shrub = 0, depth = 0, terrain = 0 } = {}) {
  const slope = clamp((grade - 0.12) / (MAX_GRADE - 0.12), 0, 1) * 0.55;
  const scrub = clamp(shrub, 0, 1) * 0.35;
  const water = clamp(depth / MAX_WADE, 0, 1) * 0.6;
  // Combine multiplicatively so several difficulties stack without going negative.
  const raw = (1 - slope) * (1 - scrub) * (1 - water);
  const keep = clamp(terrain, 0, 1);
  return clamp(1 - (1 - raw) * (1 - keep), 0.2, 1);
}

/** Is the uphill grade too steep to walk up? */
export function tooSteep(grade) {
  return grade > MAX_GRADE;
}

/**
 * Exponential approach of a velocity component (frame-rate independent). Speeding up
 * is a little slower than stopping, which reads as weight without feeling sluggish.
 */
export function approachVelocity(current, target, dt, accelerating) {
  const rate = accelerating ? 7 : 10;
  return target + (current - target) * Math.exp(-rate * dt);
}

/**
 * Classify the pose move mode (proto.Pose.Move: still|crouch|crawl|walk|run|sprint)
 * from the actual horizontal speed and the gait.
 */
export function moveMode(speed, gait, crouching, sitting, prone = false) {
  if (sitting || speed < STILL_SPEED) return 'still';
  if (prone) return 'crawl';
  if (crouching) return 'crouch';
  // The gait (what the legs are doing) decides how disturbing the movement is, even
  // when terrain slows the actual pace: crashing through scrub at a sprint is loud.
  if (gait === 'sprint') return 'sprint';
  if (gait === 'run') return 'run';
  return 'walk';
}

/** Eye height above the feet for the current posture. */
export function eyeHeightFor(crouching, sitting, prone = false) {
  if (prone) return PRONE_EYE_H;
  if (sitting) return SIT_EYE;
  if (crouching) return CROUCH_EYE;
  return EYE_HEIGHT;
}

/**
 * Head-bob amplitude (metres) and stride frequency (Hz) for a horizontal speed.
 * Subtle by design: cozy, never nauseating.
 */
export function bobParams(speed, crouching, raised) {
  if (speed < STILL_SPEED) return { amp: 0, freq: 0 };
  const amp = clamp(0.018 + speed * 0.0065, 0, 0.06) * (crouching ? 0.6 : 1) * (raised ? 0.25 : 1);
  // Cadence follows distance covered, not time: each footfall covers a stride that
  // lengthens with speed (about 1.2 m at a walk, 1.7 m at a run, 2.2 m at a sprint), so
  // a stroll gives ~2 steps a second, a run ~2.6, a sprint ~2.9, and creeping along
  // gives a step only now and then. Two footfalls per bob cycle.
  const freq = speed / (2 * (0.55 + 0.26 * speed));
  return { amp, freq };
}

/**
 * Deep water: given the depth at the feet, return the speed (m/s) at which the player is
 * eased back towards shallower water. Zero while wading depth is fine.
 */
export function waterPushBack(depth) {
  if (depth <= MAX_WADE) return 0;
  return clamp((depth - MAX_WADE) * 2.5 + 0.6, 0, 2.5);
}

/**
 * Should a horizontal step from depth `from` to depth `to` be refused? Moving deeper
 * than the wading limit is refused; moving out of deep water is always allowed.
 */
export function refuseWaterStep(from, to) {
  return to > MAX_WADE && to > from + 1e-4;
}

/**
 * Advance the stride phase (in cycles; two footfalls per cycle at 0.5 and 1.0) and
 * report whether a foot came down this frame. Returns {phase, step}.
 */
export function advanceStride(phase, freq, dt) {
  if (!(freq > 0) || !(dt > 0)) return { phase, step: false };
  const next = phase + freq * dt;
  const step = Math.floor(next * 2) !== Math.floor(phase * 2);
  return { phase: next - Math.floor(next), step };
}

/**
 * Vertical head-bob offset (metres) for a stride phase: lowest at each footfall
 * (phase 0 and 0.5), highest mid-stride; centred on zero so it never drifts the eye.
 */
export function bobOffset(phase, amp) {
  return amp * Math.abs(Math.sin(phase * Math.PI * 2)) - amp * 0.5;
}

/** Transient noise 0..1 from landing a fall at vertical speed vy (m/s, negative = down). */
export function landingNoise(vy) {
  return clamp((-vy - 2.5) / 6, 0, 1);
}
