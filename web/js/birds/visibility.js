// Making birds findable: the pure maths (no three.js, no DOM, allocation-free where it
// runs per frame). The owner's brief: a bird the game says you can see must be visible,
// and a player who looks in the right place finds it within seconds — without a
// wall-hack: nothing shows a bird through terrain, trunks or dense foliage from far
// away, nothing names it.
//
//   * exaggeration — the world is stylised, so are its birds: every bird is drawn larger
//     than life, more so the smaller it appears on screen (apparent size, so binocular
//     magnification never double-exaggerates). Large birds barely change.
//   * plumageLift — slightly lighter, richer plumage values so birds separate from dark
//     foliage while species colours stay recognisable.
//   * outlineStyle — strength and width of the soft cream edge (setting birdOutline):
//     a touch stronger where a bird is small, gone close up where it is not needed.
//   * leafCut — the leaf window (setting leafFade): how much a leaf card between the
//     camera and a nearby bird is thinned out. The GLSL in world/trees/leafWindows.js
//     mirrors this function exactly; keep them in step.
//   * windowStrength / pickNearest — which birds get a window, and how open it is.

import { ACT, FLAG, isAirborneAct } from './constants.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Vertical FOV (deg) → radians per pixel of a 720-pixel-tall view (the reference screen). */
export function refPixelAngle(fovDeg) {
  return (2 * Math.tan(((fovDeg > 0.1 ? fovDeg : 70) * Math.PI) / 360)) / 720;
}

/** True length of a bird on a 720-px-tall screen (pixels) at `dist` m through a camera of `fovDeg`. */
export function apparentPx(length, dist, fovDeg) {
  return length / Math.max(dist, 0.05) / refPixelAngle(fovDeg);
}

/** Exaggeration close up / far away, and the apparent sizes (true length in px at 720p) between which it ramps. */
export const EXAG = Object.freeze({ near: 1.35, far: 2.3, pxNear: 15, pxFar: 2.3, smallLen: 0.2, bigLen: 0.75, bigKeep: 0.12 });

/**
 * How much larger than life a bird is drawn. Smoothly 1.35× when it already looks big
 * (a robin within ~5 m with the naked eye, or far off through binoculars) rising to
 * 2.3× when it looks tiny (a robin beyond ~30 m). Birds longer than ~20 cm get
 * progressively less; a heron or a buzzard is drawn nearly true to size.
 * @param {number} length true body length (m)
 * @param {number} dist   distance from the camera (m)
 * @param {number} fovDeg current vertical FOV (narrow through optics)
 */
export function exaggeration(length, dist, fovDeg) {
  const p = apparentPx(length, dist, fovDeg);
  // Ramp on a log scale of apparent size: halving the size always adds the same amount.
  const t = smooth(Math.log(EXAG.pxNear), Math.log(EXAG.pxFar), Math.log(Math.max(p, 1e-3)));
  const e = EXAG.near + (EXAG.far - EXAG.near) * t;
  const small = 1 - smooth(EXAG.smallLen, EXAG.bigLen, length);
  return 1 + (e - 1) * (EXAG.bigKeep + (1 - EXAG.bigKeep) * small);
}

/**
 * Gentle plumage lift (sRGB in/out, 0..1): dark values rise a little, colours get a
 * touch richer. Whites stay white, blacks become a soft near-black, hues are kept.
 */
export function plumageLift(rgb, out = [0, 0, 0]) {
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const lift = 0.13 * (1 - y);
  for (let k = 0; k < 3; k++) {
    const sat = y + (rgb[k] - y) * 1.12; // richer
    out[k] = clamp(sat + (1 - sat) * lift, 0, 1);
  }
  return out;
}

/**
 * The outline of a bird: { alpha 0..1, px (width in pixels of a 720-px-tall screen) }.
 * @param {number} drawnPx drawn length of the bird on a 720-px-tall screen
 * @param {number} dist    metres
 * @param {number} daylight 0..1 (night keeps a faint edge only)
 * @param {boolean} airborne flying birds read against the sky by themselves
 */
export function outlineStyle(drawnPx, dist, daylight = 1, airborne = false, out = { alpha: 0, px: 0 }) {
  // Verifier tuning (human trials at 15-35 m): 0.55 left a robin at 25-30 m a faint
  // speck a player only found by knowing where to look; a tiny bird now gets a clearer
  // (still thin, still depth-tested) rim, a bird that already looks big keeps the old one.
  let a = (0.55 + 0.2 * (1 - smooth(6, 16, drawnPx))) * (1 - smooth(22, 55, drawnPx)); // gone close up, where it is not needed
  a *= 1 - smooth(70, 90, dist); // and far beyond the leaf windows' reach
  a *= 0.22 + 0.78 * clamp(daylight, 0, 1); // only a faint moonlit edge at night
  if (airborne) a *= 0.45;
  out.alpha = a;
  out.px = 0.8 + 0.45 * (1 - smooth(5, 24, drawnPx)); // a touch wider when the bird is tiny
  return out;
}

/**
 * Leaf window shape: radius at the bird (minimum) and at the camera end of the window,
 * its depth in front of the bird (minimum, per metre of distance, maximum; m), the
 * depth of the camera-end pinhole (m), the reach (m) and how many birds get one.
 */
export const WINDOW = Object.freeze({ rBird: 0.25, rFar: 0.45, depth: 2.2, depthPerM: 0.35, depthMax: 9, near: 4, range: 45, max: 12 });

/**
 * How deep (m, in front of the bird) its leaf window reaches. A bird in a crown is
 * often buried by the outer foliage of the same crown several metres in front of it,
 * so the window deepens with distance (a slim 0.25-0.6 m cone, leaves only; trunks,
 * limbs and terrain are never opened), and with the window's strength.
 */
export function windowDepth(dist, strength) {
  const d = clamp(dist * WINDOW.depthPerM, WINDOW.depth, WINDOW.depthMax);
  return Math.min(d * (0.75 + 0.25 * clamp(strength, 0, 1)), Math.max(dist - 1.5, WINDOW.depth));
}

/**
 * How much of a leaf is cut away (0 = kept … 1 = gone) by one bird's window: per pixel
 * with cardR = 0 (the fragment stage), or "may this card overlap the window" with the
 * card's half-size (the vertex stage's broad test). The
 * window is a slim cone on the sight line from the camera to the bird: radius rBird at
 * the bird growing to rFar (0.45 m) `depth` metres in front of it, nothing behind the bird and
 * nothing further towards the camera (a tree in between stays solid).
 * @param {number[]} card  pixel (or card centre) [x, y, z]
 * @param {number} cardR   0, or the card's half-size (m) for the broad test
 * @param {number[]} cam   camera [x, y, z]
 * @param {number[]} bird  bird body centre [x, y, z]
 * @param {number} rBird   window radius at the bird
 * @param {number} depth   window depth in front of the bird
 * @param {number} strength 0..1
 * @param {number} [nearD] depth of the camera-end pinhole (m from the camera; 0 = none)
 * @param {number} [jit]   per-card radius jitter (0.95..1.4; the vertex stage tests with 1.4)
 */
export function leafCut(card, cardR, cam, bird, rBird, depth, strength, nearD = 0, jit = 1) {
  const bx = bird[0] - cam[0], by = bird[1] - cam[1], bz = bird[2] - cam[2];
  const L = Math.hypot(bx, by, bz);
  if (!(L > 1e-4)) return 0;
  const dx = bx / L, dy = by / L, dz = bz / L;
  const px = card[0] - cam[0], py = card[1] - cam[1], pz = card[2] - cam[2];
  const s = px * dx + py * dy + pz * dz;
  const ahead = L - s;
  const qx = px - dx * s, qy = py - dy * s, qz = pz - dz * s;
  const d = Math.hypot(qx, qy, qz) - cardR;
  let cut = 0;
  if (ahead >= -0.1 - cardR && ahead <= depth + cardR) {
    const u = clamp(ahead / depth, 0, 1);
    const r = (rBird + (Math.max(WINDOW.rFar, rBird * 1.5) - rBird) * u) * jit;
    cut = (1 - smooth(r * 0.6, r, d)) * smooth(-0.1 - cardR, 0.05, ahead) * (1 - smooth(depth * 0.8, depth + cardR, ahead));
  }
  // The camera-end pinhole: angular, 1.6x the bird's apparent radius.
  if (s > -cardR && s < nearD + cardR) {
    const rn = ((Math.max(s, 0) / L) * rBird * 1.6 + 0.02) * jit;
    cut = Math.max(cut, (1 - smooth(rn * 0.6, rn, d)) * (1 - smooth(nearD * 0.75, nearD + cardR, s)));
  }
  return cut * clamp(strength, 0, 1);
}

/**
 * Depth (m from the camera) of a window's camera-end pinhole: the leaves within a few
 * metres of the player, never overlapping the bird-end window.
 */
export function nearDepth(dist, depth) {
  return clamp(dist - depth - 0.5, 0, WINDOW.near);
}

/** Window strengths: partial for every bird in reach, full once the player has looked near it. */
export const STRENGTH = Object.freeze({ partial: 0.7, full: 1, roost: 0.35, lookIn: 0.7, lookOut: 6 });

/**
 * How open a bird's leaf window is. Birds the engine reports hiding (ActHiding,
 * FlagHidden) get none: they are meant to be tucked away. Roosting and nest-sitting birds
 * get a little (a sitting bird must not turn its hidden nest into a lit-up target).
 * Every other bird gets a partial window (a skulker in a crown still feels tucked in),
 * opening fully after the player has looked near it for `lookIn` seconds and closing
 * back `lookOut` seconds after they looked away.
 * @param {number} act
 * @param {number} flags
 * @param {number} look  seconds of recent looking near this bird (see updateLook)
 */
export function windowStrength(act, flags, look) {
  if (act === ACT.HIDING || (flags & FLAG.HIDDEN) !== 0 || isAirborneAct(act)) return 0;
  const base = act === ACT.ROOSTING || act === ACT.NESTING ? STRENGTH.roost : STRENGTH.partial;
  const k = smooth(0, STRENGTH.lookIn, look);
  return base + (STRENGTH.full - base) * k;
}

/**
 * Accumulate "looked near it": grows while the bird lies within `cone` radians of the
 * view centre, drains slowly otherwise. Returns the new value (seconds, capped).
 */
export function updateLook(look, angle, cone, dt) {
  if (angle <= cone) return Math.min(look + dt, STRENGTH.lookIn);
  return Math.max(0, look - dt * (STRENGTH.lookIn / STRENGTH.lookOut));
}

/**
 * Indices of the k smallest keys among the first n (ascending), written to outIdx;
 * returns how many. Allocation-free (insertion into a k-long list; k is small).
 */
export function pickNearest(keys, n, k, outIdx) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const v = keys[i];
    if (!(v < Infinity)) continue;
    if (m === k && v >= keys[outIdx[m - 1]]) continue;
    let j = m < k ? m++ : m - 1;
    while (j > 0 && keys[outIdx[j - 1]] > v) { outIdx[j] = outIdx[j - 1]; j--; }
    outIdx[j] = i;
  }
  return m;
}

/**
 * How much to enlarge idle movements (head turns, tail flicks, wing shuffles) for a bird
 * drawn `drawnPx` long on a 720-px-tall screen: 1 when it is big on screen, up to 1.6
 * when it is a few pixels, so small movements still catch the eye at distance.
 */
export function motionBoost(drawnPx) {
  return 1 + 0.6 * (1 - smooth(8, 30, drawnPx));
}
