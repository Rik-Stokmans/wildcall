// Wingbeat and flight-style curves. Pure module (no three.js).
//
// A bird's wing phase is measured in wingbeats (it advances by flapHz × dt each frame,
// so changing flapHz never makes the wings jump). flightPose() turns that phase into a
// wing angle and body motion for each of the catalog's flight styles, so a woodpecker's
// bounding, a buzzard's circling and a wren's whirr are recognisable at a glance —
// flight pattern is identification evidence in this game.

import { ACT } from './constants.js';

const TAU = Math.PI * 2;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Wing angle (radians, + = tips up) of a plain flapping stroke at phase p. */
export function flapAngle(p, mid = 0.15, amp = 0.75) {
  return mid + amp * Math.sin(TAU * p);
}

/**
 * Each style as {flaps, pause, ...}: one cycle is `flaps` wingbeats then `pause`
 * beat-units of the held pose. pauseFlap is the wing angle held during the pause and
 * pauseFold how folded the wing is (1 = closed against the body).
 */
export const FLIGHT_CYCLES = Object.freeze({
  direct: { flaps: 1, pause: 0, amp: 0.75, mid: 0.15, pauseFlap: 0, pauseFold: 0, bob: 0.04 },
  whirring: { flaps: 7, pause: 3, amp: 0.45, mid: 0.05, pauseFlap: -0.28, pauseFold: 0.12, bob: 0.02 },
  undulating: { flaps: 3, pause: 2.2, amp: 0.85, mid: 0.15, pauseFlap: 0, pauseFold: 1, bob: 0 },
  soaring: { flaps: 2, pause: 14, amp: 0.38, mid: 0.12, pauseFlap: 0.12, pauseFold: 0, bob: 0 },
  hover: { flaps: 1, pause: 0, amp: 0.85, mid: 0.25, pauseFlap: 0, pauseFold: 0, bob: 0.03 },
  flapglide: { flaps: 4, pause: 5, amp: 0.7, mid: 0.12, pauseFlap: 0.1, pauseFold: 0, bob: 0.03 },
  darting: { flaps: 3, pause: 1, amp: 0.8, mid: 0.15, pauseFlap: 0, pauseFold: 0.85, bob: 0.05 },
  buoyant: { flaps: 1, pause: 0, amp: 0.85, mid: 0.2, pauseFlap: 0, pauseFold: 0, bob: 0.14 },
});

/** Reusable output object. */
export function createFlightPose() {
  return { flap: 0, fold: 0, bob: 0, sway: 0, tailSpread: 0, flapping: true };
}

/**
 * Flight pose for a style at wing phase p (in wingbeats). Writes into out:
 *  flap        wing angle (radians, + up) for the shoulder
 *  fold        0 spread … 1 closed against the body
 *  bob         vertical body offset in body lengths (undulation, recoil)
 *  sway        sideways jink in body lengths (darting)
 *  tailSpread  0..1 tail fanned
 *  flapping    false while gliding / bounding / soaring (no wing whirr)
 */
export function flightPose(style, p, out = createFlightPose()) {
  const c = FLIGHT_CYCLES[style] || FLIGHT_CYCLES.direct;
  const cyc = c.flaps + c.pause;
  const ph = ((p % cyc) + cyc) % cyc;
  out.sway = 0;
  out.tailSpread = style === 'soaring' || style === 'hover' ? 1 : style === 'flapglide' ? 0.5 : 0.15;
  if (ph < c.flaps || c.pause === 0) {
    out.flap = flapAngle(ph, c.mid, c.amp);
    out.fold = 0;
    out.flapping = true;
    // The body recoils against each downstroke (strongest in buoyant, gull-like flight).
    out.bob = -c.bob * Math.sin(TAU * ph);
    if (c.pause > 0) {
      // Ease from the held pose into the first beat so cycles join smoothly.
      const e = smooth(ph / 0.35);
      out.flap = c.pauseFlap + (out.flap - c.pauseFlap) * e;
      out.fold = c.pauseFold * (1 - e);
    }
  } else {
    const g = ph - c.flaps; // time into the pause, beat units
    const e = smooth(g / 0.3); // settle into the held pose
    const last = flapAngle(0, c.mid, c.amp);
    out.flap = last + (c.pauseFlap - last) * e;
    out.fold = c.pauseFold * e;
    out.flapping = false;
    out.bob = 0;
  }
  if (style === 'undulating') {
    // Bounding flight: climb while flapping, fall on closed wings — a smooth wave.
    out.bob = 0.55 * Math.sin(TAU * (ph / cyc) - Math.PI * 0.1);
  } else if (style === 'darting') {
    out.sway = 0.25 * Math.sin(TAU * (ph / cyc)) * (ph >= c.flaps ? 1 : 0.4);
  }
  return out;
}

/**
 * Which flight style to animate for an airborne act. Soaring species travel with
 * flap-and-glide; hovering only happens in ActHovering; panicked birds beat hard.
 */
export function flightStyleFor(act, flight) {
  if (act === ACT.SOARING) return 'soaring';
  if (act === ACT.HOVERING) return 'hover';
  const f = FLIGHT_CYCLES[flight] ? flight : 'direct';
  if (act === ACT.FLEEING) {
    return f === 'undulating' || f === 'whirring' || f === 'darting' ? f : 'direct';
  }
  if (f === 'soaring') return 'flapglide';
  if (f === 'hover') return 'direct';
  return f;
}

/** Wingbeat rate multiplier per act (fleeing birds beat faster). */
export function flapRateFor(act) {
  if (act === ACT.FLEEING) return 1.3;
  if (act === ACT.HOVERING) return 1.1;
  if (act === ACT.SOARING) return 0.8;
  return 1;
}
