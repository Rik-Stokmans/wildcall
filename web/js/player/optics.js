// Pure optics for the field instruments: zoom ranges, field of view, hand sway, optical
// focus and the visual treatment derived from equipment stats (core.Stats [client]
// fields). No three.js, no DOM.
//
// The tradeoffs of spec §6.2 are carried by these functions: more magnification means a
// narrower true field of view (binoFov / zoom), more visible sway and a shallower depth
// of field (focus has to be more exact); stability, weight, focus speed and clarity all
// change what the player feels.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;

export const BINO_MIN_ZOOM = 4;

/** Stats with sensible fallbacks (base values of core.BaseStats). */
export function opticStats(s = {}) {
  const n = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    binoZoom: n(s.binoZoom, 6),
    binoFov: n(s.binoFov, 48),
    binoStability: clamp(n(s.binoStability, 0.35), 0, 1),
    binoFocus: Math.max(0.05, n(s.binoFocus, 1.2)),
    binoClarity: clamp(n(s.binoClarity, 0.5), 0, 1),
    binoWeight: Math.max(0, n(s.binoWeight, 0.6)),
    lowLight: clamp(n(s.lowLight, 0.2), 0, 1),
    camZoom: n(s.camZoom, 3),
    camStability: clamp(n(s.camStability, 0.4), 0, 1),
    camFocus: Math.max(0.05, n(s.camFocus, 1.0)),
    camBurst: Math.max(0.2, n(s.camBurst, 1)),
    camReady: Math.max(0.05, n(s.camReady, 0.6)),
    longLens: clamp(n(s.longLens, 0), 0, 1),
  };
}

/** [min, max] magnification of a tool. */
export function zoomRange(tool, stats) {
  const o = opticStats(stats);
  if (tool === 'binoculars') {
    const max = Math.max(1, o.binoZoom);
    return [Math.min(BINO_MIN_ZOOM, max), max];
  }
  if (tool === 'camera') return [1, Math.max(1, o.camZoom)];
  return [1, 1];
}

/** Clamp a zoom into the tool's range. */
export function clampZoom(tool, zoom, stats) {
  const [a, b] = zoomRange(tool, stats);
  return clamp(zoom, a, b);
}

/** One wheel notch changes magnification by this ratio (feels even across the range). */
export const ZOOM_STEP = 1.12;

/** New zoom after a wheel delta (dy > 0 = scroll down = zoom out). */
export function wheelZoom(tool, zoom, dy, stats) {
  if (!dy) return clampZoom(tool, zoom, stats);
  const notches = clamp(dy / 100, -3, 3);
  return clampZoom(tool, zoom * Math.pow(ZOOM_STEP, -notches), stats);
}

/**
 * Vertical field of view (degrees) for a tool at a magnification.
 *  - none / recorder / lowered: the naked-eye settings.fov
 *  - binoculars: the true field binoFov / zoom (contract §5.2)
 *  - camera: a zoom lens on the naked-eye view, tan(fov/2) / zoom
 */
export function fovFor(tool, zoom, stats, baseFov = 70) {
  const o = opticStats(stats);
  if (tool === 'binoculars') return clamp(o.binoFov / Math.max(1, zoom), 1, baseFov);
  if (tool === 'camera') {
    const z = Math.max(1, zoom);
    return clamp(2 * Math.atan(Math.tan((baseFov * DEG) / 2) / z) / DEG, 1, baseFov);
  }
  return baseFov;
}

/** Mouse sensitivity multiplier so the view moves at the same on-screen rate when zoomed. */
export function sensitivityScale(fov, baseFov) {
  if (!(baseFov > 0)) return 1;
  return clamp(fov / baseFov, 0.02, 1);
}

/** Seconds to bring the instrument up to the eye. Heavier binoculars are slower. */
export function raiseTime(tool, stats) {
  const o = opticStats(stats);
  if (tool === 'binoculars') return clamp(0.18 + o.binoWeight * 0.45, 0.15, 1.4);
  if (tool === 'camera') return clamp(o.camReady, 0.1, 2);
  if (tool === 'recorder') return 0.25;
  return 0.2;
}

/**
 * Posture factor on hand sway: crouching and sitting brace the arms; standing still
 * for a moment settles the breath (the "holding breath" steadying, earned by patience).
 * @param {object} p {crouching, sitting, speed, stillTime}
 */
export function postureFactor({ crouching = false, sitting = false, speed = 0, stillTime = 0 } = {}) {
  let f = sitting ? 0.45 : crouching ? 0.62 : 1;
  if (speed > 0.2) f *= 1 + Math.min(speed, 6.5) * 0.35;            // walking with optics up is wobbly
  else f *= 1 - 0.3 * clamp(stillTime / 2.5, 0, 1);                 // settle over ~2.5 s
  return f;
}

/**
 * Angular hand-sway amplitude in degrees.
 * On screen the sway is magnified further because the field of view is narrower, so
 * visible sway ∝ amplitude / fov grows strongly with zoom — exactly the spec's tradeoff.
 * @param {string} tool binoculars|camera
 * @param {number} zoom
 * @param {object} stats
 * @param {object} posture see postureFactor
 */
export function swayAmplitude(tool, zoom, stats, posture = {}) {
  const o = opticStats(stats);
  const z = Math.max(1, zoom);
  let amp;
  if (tool === 'binoculars') {
    // Heavier glass is harder to hold still (weight above ~0.4 kg adds sway).
    const weight = 1 + Math.max(0, o.binoWeight - 0.4) * 0.6;
    amp = 0.26 * (1 - 0.8 * o.binoStability) * (0.55 + 0.075 * z) * weight;
  } else if (tool === 'camera') {
    // Zoom-induced shake, part of which a long-lens technique removes.
    const zoomGain = 1 + (z - 1) * 0.45 * (1 - o.longLens);
    amp = 0.22 * (1 - 0.8 * o.camStability) * zoomGain;
  } else {
    return 0;
  }
  return amp * postureFactor(posture);
}

/**
 * Smooth pseudo-random sway offsets (degrees) for time t: a few incommensurate sines
 * so the motion never visibly loops. Returns {yaw, pitch}.
 */
export function swayOffset(t, amp, seed = 0) {
  if (!amp) return { yaw: 0, pitch: 0 };
  const yaw = Math.sin(t * 1.9 + seed) * 0.55 + Math.sin(t * 3.7 + seed * 2.1) * 0.3 + Math.sin(t * 7.3 + 1.3) * 0.15;
  const pitch = Math.sin(t * 2.3 + 0.7 + seed) * 0.5 + Math.sin(t * 4.1 + seed * 1.7) * 0.32 + Math.sin(t * 8.9 + 2.1) * 0.18;
  return { yaw: yaw * amp, pitch: pitch * amp };
}

/**
 * Normalised shake 0..1 for a photo: sway relative to the frame plus body movement.
 * @param {number} ampDeg  current sway amplitude (degrees)
 * @param {number} fovDeg  current vertical fov
 * @param {number} speed   horizontal speed m/s
 */
export function shakeAmount(ampDeg, fovDeg, speed = 0) {
  const rel = fovDeg > 0 ? ampDeg / fovDeg : 0;
  return clamp(rel * 9 + Math.max(0, speed - 0.2) * 0.12, 0, 1);
}

// ---------------------------------------------------------------------------
// Optical focus

/** Depth-of-field tolerance in log-distance units: wide at low zoom, tight at high zoom. */
export function focusTolerance(zoom) {
  return 0.55 / Math.sqrt(Math.max(1, zoom));
}

/** Sharpness 0..1 for a lens focused at `focusDist` looking at something at `targetDist`. */
export function sharpness(focusDist, targetDist, zoom) {
  const f = Math.max(0.5, focusDist), d = Math.max(0.5, targetDist);
  const err = Math.abs(Math.log(f / d)) / focusTolerance(zoom);
  return Math.exp(-err * err);
}

/** Log-distance units a full refocus spans (≈ 3 m → 60 m). */
export const FOCUS_SPAN = 3;

/**
 * Move the focused distance toward the target at the stat's speed: speed is
 * "1 / seconds to full focus", so a full FOCUS_SPAN refocus takes 1/speed seconds.
 * Small corrections finish proportionally faster. Returns the new focus distance.
 */
export function stepFocus(focusDist, targetDist, speed, dt) {
  const f = Math.log(Math.max(0.5, focusDist));
  const d = Math.log(Math.max(0.5, targetDist));
  const maxStep = FOCUS_SPAN * Math.max(0.05, speed) * dt;
  const diff = d - f;
  const step = Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;
  return Math.exp(f + step);
}

/** CSS blur radius (px) for a sharpness value while an instrument is raised. */
export function blurPx(sharp, clarity = 0.5) {
  // Poorer glass blurs a little more when out of focus.
  const max = 3.2 + (1 - clamp(clarity, 0, 1)) * 1.6;
  const b = (1 - clamp(sharp, 0, 1)) * max;
  return b < 0.05 ? 0 : Math.round(b * 20) / 20;
}

/**
 * Brightness multiplier through binoculars: optics lose light at dusk and night unless
 * they are good in low light. daylight 0..1.
 */
export function lowLightBrightness(daylight, lowLight) {
  const dark = 1 - clamp(daylight, 0, 1);
  return clamp(1 - dark * 0.45 * (1 - clamp(lowLight, 0, 1)), 0.4, 1);
}

/**
 * Binocular mask geometry, relative to the viewport. Clarity widens the crisp centre;
 * cheap glass has a soft, wide feathered edge.
 * @returns {{radius:number, feather:number, offset:number}} fractions of min(w,h)
 */
export function binoMask(clarity) {
  const c = clamp(clarity, 0, 1);
  return {
    radius: 0.44,
    feather: 0.16 - c * 0.1,   // 0.16 (poor) → 0.06 (superb)
    offset: 0.19,              // half the distance between the two barrels' centres
  };
}

/** Focus-bracket state for the viewfinder from sharpness. */
export function focusState(sharp) {
  if (sharp >= 0.9) return 'locked';
  if (sharp >= 0.55) return 'near';
  return 'hunting';
}

// ---------------------------------------------------------------------------
// Raising and the shutter

/**
 * Advance how far an instrument is raised (0 = lowered, 1 = at the eye). Raising takes
 * `seconds` (raiseTime); lowering is quicker, as arms drop faster than they aim.
 */
export function stepRaise(amount, up, seconds, dt) {
  const t = Math.max(0.05, seconds);
  const next = up ? amount + dt / t : amount - dt / (t * 0.6);
  return clamp(next, 0, 1);
}

/** Is the instrument far enough up to look through / shoot? */
export function isRaised(amount) {
  return amount >= 0.9;
}

/** Seconds between frames while the shutter is held (stats.camBurst shots per second). */
export function burstInterval(camBurst) {
  return 1 / clamp(Number.isFinite(camBurst) ? camBurst : 1, 0.2, 12);
}

/** Log-space interpolation between two fields of view (zooming feels even). */
export function blendFov(baseFov, toolFov, amount) {
  const a = clamp(amount, 0, 1);
  return Math.exp(Math.log(baseFov) + (Math.log(toolFov) - Math.log(baseFov)) * a);
}

/** Seconds a held breath steadies the binoculars before it runs out. */
export const BREATH_HOLD = 4;

/**
 * Sway multiplier while the player holds their breath (LMB with binoculars raised) for
 * `held` seconds: eases in to 0.5 over ~0.3 s, lasts BREATH_HOLD seconds, then eases
 * back to normal over a second. Never worse than normal: holding too long costs nothing.
 */
export function breathFactor(held) {
  if (!(held > 0)) return 1;
  if (held < 0.3) return 1 - 0.5 * (held / 0.3);
  if (held <= BREATH_HOLD) return 0.5;
  return Math.min(1, 0.5 + 0.5 * (held - BREATH_HOLD));
}
