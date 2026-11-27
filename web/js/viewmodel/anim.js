// Pure animation logic for the held-tool view (no three.js, no DOM): easing, the
// holster state machine (put the old tool away, then draw the new one), raise/fade
// mapping that matches the tool overlays, stride bob, idle breathing, turn lag and the
// short one-shot clips (shutter press, recoil). Everything here is tested in
// anim.test.js; index.js only turns these numbers into transforms.

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const easeIn = (t) => { t = clamp(t); return t * t; };
export const easeOut = (t) => { t = clamp(t); return 1 - (1 - t) * (1 - t); };
/** Overshoots by ~6 % and settles: the small "settle" at the end of drawing a tool. */
export const easeOutBack = (t, s = 1.25) => {
  t = clamp(t) - 1;
  return 1 + t * t * ((s + 1) * t + s);
};
/** Frame-rate independent exponential approach factor. */
export const damp = (rate, dt) => 1 - Math.exp(-rate * Math.max(0, dt));

// ---------------------------------------------------------------------------------
// Holster: which tool is in the hands and how far it is drawn.

export const DRAW_TIME = 0.34;   // seconds to bring a tool up from below the view
export const STOW_TIME = 0.2;    // seconds to put it away (quicker: arms drop)

/**
 * State: {shown, draw} where `shown` is the key of the model in the hands ('none' or
 * e.g. 'camera|starter_camera') and `draw` is 0 (below the view) .. 1 (in the hands).
 */
export function createHolster() {
  return { shown: 'none', draw: 0 };
}

/**
 * Advance the holster towards `want`. A different tool is only drawn once the current
 * one is fully put away, so selections queue naturally: pressing 1 then 2 quickly
 * stows nothing twice and draws only the last choice.
 * Mutates and returns `h`. Returns via h.changed = true on the frame `shown` switched.
 */
export function stepHolster(h, want, dt, drawTime = DRAW_TIME, stowTime = STOW_TIME) {
  want = want || 'none';
  h.changed = false;
  if (h.shown !== want) {
    if (h.shown === 'none' || h.draw <= 0) {
      h.shown = want; h.draw = 0; h.changed = true;
    } else {
      h.draw = Math.max(0, h.draw - dt / Math.max(0.01, stowTime));
      if (h.draw <= 0) { h.shown = want; h.changed = true; }
      return h;
    }
  }
  if (h.shown !== 'none') h.draw = Math.min(1, h.draw + dt / Math.max(0.01, drawTime));
  else h.draw = 0;
  return h;
}

/**
 * Eased "in the hands" amount. Drawing overshoots and settles; stowing starts slowly
 * and drops away fast (away = (1 - draw)²).
 */
export function drawCurve(draw, stowing) {
  return stowing ? easeOut(draw) : easeOutBack(draw);
}

/** Offset of the whole hand rig for a draw amount: {y, z, rx} (metres, radians). */
export function drawOffset(draw, stowing = false) {
  const e = drawCurve(draw, stowing);
  const away = 1 - e;
  return { y: -0.34 * away, z: 0.06 * away, rx: -0.55 * away };
}

// ---------------------------------------------------------------------------------
// Raising to the eye. tools.js raises the optic by `raiseAmount` 0..1 at the speed of
// the equipment (raiseTime, binoWeight, camReady, prone) and fades its overlay in with
// opacity = raiseAmount. The hands follow the same number, so both always agree.

export const FADE_START = 0.3;   // the rig starts to fade as the mask comes in
export const FADE_END = 0.68;    // fully gone before tools.js can shoot (isRaised ≥ 0.9)
export const POSE_END = 0.72;    // the lift reaches the eye a touch after the fade

/** How far along the lift-to-the-eye path the tool is, 0..1 (eased). */
export function liftAmount(raise) {
  return easeInOut(clamp(raise) / POSE_END);
}

/** Rig opacity for a raise amount: 1 lowered, 0 at the eye. */
export function rigAlpha(raise) {
  return 1 - smoothstep(FADE_START, FADE_END, clamp(raise));
}

/** The overlay's opacity for the same raise (tools.js / overlay.js: opacity = amount). */
export function overlayAlpha(raise) {
  return clamp(raise);
}

/**
 * Raise stepping for the tools that tools.js does not raise (the recorder: up while
 * recording or RMB held). Same shape as optics.stepRaise: lowering takes 60 % of the time.
 */
export function stepRaise(amount, up, seconds, dt) {
  const t = Math.max(0.05, seconds);
  return clamp(up ? amount + dt / t : amount - dt / (t * 0.6));
}

// ---------------------------------------------------------------------------------
// Motion: stride bob, idle breathing, turn lag.

/**
 * Stride frequency (cycles/s, two footfalls per cycle) for a ground speed in m/s.
 * Mirrors player/movement.js bobParams so the hands step with the head bob.
 */
export function strideFreq(speed) {
  if (!(speed > 0.15)) return 0;
  return speed / (2 * (0.55 + 0.26 * speed));
}

/** Bob amplitude (metres) of the hands for a speed: walk ~6 mm, run ~12, sprint ~16. */
export function bobAmp(speed, { crouching = false, prone = false, raised = 0 } = {}) {
  if (!(speed > 0.15)) return 0;
  let a = clamp(0.0035 + speed * 0.0021, 0, 0.018);
  if (crouching) a *= 0.7;
  if (prone) a *= 0.5;
  return a * (1 - 0.8 * clamp(raised));
}

/**
 * Hand offset for a stride phase (0..1) and amplitude: a soft figure-of-eight, lowest at
 * each footfall (phase 0 and 0.5, like the head bob) with a sideways swing per cycle.
 * Writes into `out` {x, y, rz} and returns it (no allocation).
 */
export function bobOffsetHands(phase, amp, out) {
  const w = phase * Math.PI * 2;
  out.x = Math.sin(w) * amp * 0.9;
  out.y = (Math.abs(Math.sin(w)) - 0.5) * amp;   // same footfall timing as the head bob
  out.rz = Math.sin(w) * amp * 1.6;
  return out;
}

/** Gentle breathing sway when standing still: {y, rx} into out. */
export function breathe(time, amount, out) {
  const b = Math.sin(time * (Math.PI * 2) / 4.4);
  const c = Math.sin(time * (Math.PI * 2) / 7.3 + 1.1);
  out.y = (b * 0.0026 + c * 0.0008) * amount;
  out.rx = (b * 0.006 + c * 0.003) * amount;
  out.x = c * 0.0012 * amount;
  return out;
}

/** Wrap an angle difference into -π..π. */
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * Turn lag target from look velocity (rad/s): the hands trail the view a little.
 * Returns radians, clamped so a fast flick never throws the tool out of frame.
 */
export function lagTarget(angularVel, gain = 0.035, max = 0.09) {
  return clamp(-angularVel * gain, -max, max);
}

// ---------------------------------------------------------------------------------
// One-shot clips (time since start in seconds → 0..1).

export const PRESS_TIME = 0.26;

/** Index finger on the shutter: quick press, slower release. */
export function pressCurve(t) {
  if (!(t >= 0) || t >= PRESS_TIME) return 0;
  if (t < 0.05) return t / 0.05;
  return 1 - easeOut((t - 0.05) / (PRESS_TIME - 0.05));
}

/** Tiny recoil of the camera after the shutter: a damped kick. */
export function recoilCurve(t) {
  if (!(t >= 0) || t > 0.5) return 0;
  return Math.exp(-t * 11) * Math.sin(Math.min(1, t / 0.035) * Math.PI * 0.5);
}

// ---------------------------------------------------------------------------------
// Recorder LEDs: a level 0..1 lights 0..n LEDs with a soft top one.

export function ledLevels(level, n, out) {
  const v = clamp(level) * n;
  for (let i = 0; i < n; i++) out[i] = clamp(v - i);
  return out;
}
