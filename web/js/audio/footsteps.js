// Footstep recipes. Pure data + a tiny function that picks one step's parameters, so
// the per-surface character and the movement scaling are testable; sfx.js renders them.
//
// Each step is a short filtered noise burst (the scuff/crunch) plus optional extras:
// `grains` micro-bursts for crunchy surfaces (dry leaves, snow), a `tone` knock for
// hard or hollow ground (rock, wood), a `splash` for water and a downward `squelch`
// sweep for mud.

/** Footstep surface vocabulary (ctx.world.surfaceAt). */
export const SURFACES = ['grass', 'leaf', 'sand', 'rock', 'snow', 'water', 'mud', 'wood'];

/**
 * filter: 'bandpass' | 'lowpass' | 'highpass'; freq/q: noise filter; dur: burst length
 * (s); gain: relative level; grains: crunch grain count; tone: knock Hz (0 = none);
 * splash: 0..1; squelch: 0..1.
 */
export const FOOTSTEP = {
  grass: { filter: 'bandpass', freq: 2600, q: 0.8, dur: 0.12, gain: 0.55, grains: 0, tone: 0, splash: 0, squelch: 0 },
  leaf: { filter: 'highpass', freq: 1800, q: 0.7, dur: 0.16, gain: 0.6, grains: 7, tone: 0, splash: 0, squelch: 0 },
  sand: { filter: 'lowpass', freq: 1400, q: 0.6, dur: 0.15, gain: 0.5, grains: 0, tone: 0, splash: 0, squelch: 0 },
  rock: { filter: 'bandpass', freq: 3200, q: 1.4, dur: 0.05, gain: 0.5, grains: 1, tone: 230, splash: 0, squelch: 0 },
  snow: { filter: 'bandpass', freq: 1500, q: 0.9, dur: 0.2, gain: 0.55, grains: 10, tone: 0, splash: 0, squelch: 0 },
  water: { filter: 'bandpass', freq: 1200, q: 0.7, dur: 0.3, gain: 0.7, grains: 0, tone: 0, splash: 1, squelch: 0 },
  mud: { filter: 'lowpass', freq: 700, q: 1.2, dur: 0.22, gain: 0.6, grains: 0, tone: 0, splash: 0.2, squelch: 1 },
  wood: { filter: 'bandpass', freq: 1800, q: 1.0, dur: 0.06, gain: 0.55, grains: 0, tone: 165, splash: 0, squelch: 0 },
};

/** Loudness of a step by movement mode: crouch-walking is nearly silent. */
export const MOVE_GAIN = { still: 0, crouch: 0.28, walk: 0.55, run: 0.8, sprint: 1 };

/** Stride length in metres by movement mode (fallback stepping when no events arrive). */
export const STRIDE = { crouch: 0.55, walk: 0.75, run: 1.1, sprint: 1.45 };

/**
 * Parameters for one step.
 * @param {string} surface one of SURFACES (unknown → grass)
 * @param {string} move 'still'|'crouch'|'walk'|'run'|'sprint' (unknown → walk)
 * @param {() => number} rng variation source
 * @param {number} [foot] 0 / 1: left and right feet differ a little (pitch, weight)
 * @returns {null | object} null when the step makes no sound
 */
export function footstepParams(surface, move, rng = Math.random, foot = 0) {
  const base = FOOTSTEP[surface] || FOOTSTEP.grass;
  const mg = MOVE_GAIN[move] ?? MOVE_GAIN.walk;
  if (mg <= 0) return null;
  const vary = (k) => 1 + (rng() * 2 - 1) * k;
  // Faster steps strike harder: brighter, a touch shorter.
  const bright = move === 'sprint' ? 1.25 : move === 'run' ? 1.12 : move === 'crouch' ? 0.8 : 1;
  // A heel strike then the toe settling: only a walking step has the time and weight for
  // it, and soft ground swallows it. Sprinting is a single hit.
  const hard = base.tone > 0 || base.grains > 0 || base.dur < 0.1;
  const toe = (move === 'walk' || move === 'run') && !(base.squelch || base.splash)
    ? { delay: (move === 'run' ? 0.045 : 0.07) * vary(0.15), gain: (hard ? 0.4 : 0.28) * vary(0.2) }
    : null;
  const side = foot ? 1 : -1;
  return {
    surface: FOOTSTEP[surface] ? surface : 'grass',
    filter: base.filter,
    toe,
    freq: base.freq * bright * vary(0.15) * (1 + 0.04 * side),
    q: base.q,
    dur: base.dur * (move === 'crouch' ? 1.2 : 1) * vary(0.12),
    gain: base.gain * mg * vary(0.12) * (1 - 0.06 * side),
    grains: base.grains ? Math.max(1, Math.round(base.grains * (0.7 + 0.6 * rng()) * (move === 'crouch' ? 0.6 : 1))) : 0,
    tone: base.tone ? base.tone * vary(0.08) : 0,
    splash: base.splash * mg,
    squelch: base.squelch,
  };
}
