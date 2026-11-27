// Flight you can follow: the pure side (no three.js, no DOM, allocation-free per frame).
//
// The owner: "can I also see birds flying around? I want them to be able to fly away
// if you scare one off, but then be able to follow it to see where it lands." The
// engine really flies its birds (internal/eco move.go, followflight.go); this module
// makes a flight something the eye picks up and keeps, the way a birder does it:
// "there it goes - over the path - into the top of that birch".
//
//   * flightScale — one combined drawn scale: the perched exaggeration of
//     visibility.js, raised in flight to an apparent-size floor on the wingspan
//     (FLOOR: a flying songbird stays >= ~13 px across within 60 m on a 720-px-tall
//     view, tapering beyond). It is a max(), never a product, so a bird is never
//     enlarged twice; it is measured in apparent size, so binoculars need no floor.
//   * visibleFlapHz — a wingbeat never faster than the frame rate can show (a 20 Hz
//     whirr at 30 fps would strobe into random wing positions).
//   * createFlightState / trackFlight — per bird: smoothed airborne weight, take-off
//     and landing moments (with the interpolator's look-ahead: a bird crouches before
//     it springs and flares before it lands), the flush (ActFleeing) and the ~10 s
//     after a flushed bird lands, and the continuity guard that turns any residual
//     discontinuity of the sampled position into a short glide instead of a snap.
//   * overlayPose — take-off (crouch, push, burst of deep beats), landing (flare,
//     wings up, settle with a little bounce, one wing shuffle) written over the pose.
//   * trail / glow numbers — the faint dabs behind a flushed bird and the stronger
//     outline after it lands.
//
// Nothing here names a bird or shows one through anything: every visual it drives is
// depth-tested, and the only things that react are the bird's own drawing and sound.

import { ACT, isAirborneAct } from './constants.js';
import { CHANNELS } from './pose.js';
import { visibleFlapHz } from './flight.js';

export { visibleFlapHz };

/** Pose channel names (pose.js), listed once. */
const KEYS = Object.keys(CHANNELS);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Radians per pixel of a 720-px-tall view for a vertical FOV (degrees). */
export function refPixel(fovDeg) {
  return (2 * Math.tan(((fovDeg > 0.1 ? fovDeg : 70) * Math.PI) / 360)) / 720;
}

/**
 * Apparent-size floor of a flying bird's wingspan, in pixels of a 720-px-tall view:
 * `px` out to `near` metres, easing to `midPx` at `mid` and `farPx` at `far`.
 * `maxScale` caps how much a tiny bird may be enlarged (it is still a few pixels).
 */
export const FLOOR = Object.freeze({ px: 13, near: 60, midPx: 9, mid: 150, farPx: 6, far: 260, maxScale: 12 });

/** The wingspan floor (px at 720p) for a flying bird at `dist` metres. */
export function floorPx(dist) {
  if (dist <= FLOOR.near) return FLOOR.px;
  if (dist <= FLOOR.mid) return FLOOR.px + (FLOOR.midPx - FLOOR.px) * smooth(FLOOR.near, FLOOR.mid, dist);
  return FLOOR.midPx + (FLOOR.farPx - FLOOR.midPx) * smooth(FLOOR.mid, FLOOR.far, dist);
}

/**
 * The one drawn scale of a bird. `exag` is visibility.js exaggeration() (the perched
 * enlargement); in flight (air → 1) it is raised so the wingspan reaches floorPx().
 * Never multiplied: max(exag, floor) blended by the airborne weight.
 * @param {number} exag  perched exaggeration (≥ 1)
 * @param {number} span  true wingspan (m)
 * @param {number} dist  metres from the camera
 * @param {number} fovDeg current vertical FOV (narrow through optics)
 * @param {number} air   0 grounded … 1 airborne (smoothed)
 */
export function flightScale(exag, span, dist, fovDeg, air) {
  if (!(air > 0)) return exag;
  const need = (floorPx(dist) * refPixel(fovDeg) * Math.max(dist, 0.05)) / Math.max(span, 0.05);
  const floor = Math.min(need, FLOOR.maxScale);
  if (floor <= exag) return exag;
  return exag + (floor - exag) * clamp(air, 0, 1);
}

/** Drawn wingspan (px at 720p) for a scale. */
export function drawnSpanPx(span, scale, dist, fovDeg) {
  return (span * scale) / Math.max(dist, 0.05) / refPixel(fovDeg);
}

// --- per-bird state ----------------------------------------------------------------

/** Seconds a flushed bird's landing stays a little easier to see (stronger outline). */
export const LAND_GLOW = 10;
/** Take-off and landing phase lengths (seconds). */
export const PHASE = Object.freeze({ crouch: 0.16, burst: 0.4, flare: 0.3, settle: 0.55, shuffleAt: 0.85, shuffle: 0.3 });

export function createFlightState() {
  return {
    air: 0, // smoothed airborne weight
    act: -1, // last act seen
    airborne: false,
    flushed: false, // this flight is a flush (ActFleeing)
    sinceUp: 1e3, // seconds since take-off
    sinceDown: 1e3, // seconds since landing
    landedFlushed: false, // the last landing ended a flush
    glow: 0, // seconds of landing glow left
    peak: 0, // peak speed of this flight (m/s)
    flare: 0, // 0..1 flare weight (approaching a landing)
    crouch: 0, // 0..1 crouch before take-off
    phase: 0, // wingbeat phase for silhouettes (beats)
    trailAcc: 0, // trail emission accumulator
    has: false, // continuity guard initialised
    rx: 0, ry: 0, rz: 0, // last raw (sampled) position
    px: 0, py: 0, pz: 0, pValid: false, // last drawn position (trail dabs fill the gap)
    ox: 0, oy: 0, oz: 0, // continuity offset (decays to 0)
    events: 0, // bit field of this frame's events (EV)
    seed: 0,
  };
}

/** Events reported by trackFlight for the current frame (bits). */
export const EV = Object.freeze({ TAKEOFF: 1, FLUSH: 2, LAND: 4, LAND_FLUSHED: 8 });

export function resetFlightState(fl, seed = 0) {
  fl.air = 0; fl.act = -1; fl.airborne = false; fl.flushed = false;
  fl.sinceUp = 1e3; fl.sinceDown = 1e3; fl.landedFlushed = false; fl.glow = 0;
  fl.peak = 0; fl.flare = 0; fl.crouch = 0; fl.phase = (seed % 997) / 997 * 4; fl.trailAcc = 0;
  fl.has = false; fl.ox = fl.oy = fl.oz = 0; fl.events = 0; fl.seed = seed >>> 0; fl.pValid = false;
}

/**
 * Whether the bird is moving through the air: an airborne act, or a fast move under an
 * act the engine also uses for flights (a dash into cover flies with ActHiding).
 */
export function inFlight(act, speed) {
  if (isAirborneAct(act)) return true;
  return (act === ACT.HIDING || act === ACT.NESTING) && speed > 2.2;
}

/**
 * The act the animator should play: a fast dash into cover (ActHiding at flight speed)
 * is animated as a flight, everything else as the engine says.
 */
export function animAct(act, speed) {
  return act === ACT.HIDING && speed > 2.2 ? ACT.FLEEING : act;
}

/** Residual position discontinuities glide out over about this long (s). */
export const GLIDE_TAU = 0.16;

/**
 * Per frame, for every bird with a valid sample `s` (interp.js createSample()):
 * advances fl, writes this frame's events into fl.events, and applies the continuity
 * guard to s.x/y/z in place (a step the sampled motion cannot explain — a late
 * snapshot catching up, a re-stamped timeline — becomes a short glide; true jumps are
 * left to the interpolator's cross-fade). Returns fl.events.
 */
export function trackFlight(fl, s, dt) {
  dt = clamp(dt, 0, 0.1);
  fl.events = 0;
  const flying = inFlight(s.act, s.speed);
  if (fl.act < 0) {
    // First frame of this bird: no events, start in the right state.
    fl.airborne = flying; fl.air = flying ? 1 : 0; fl.flushed = flying && s.act === ACT.FLEEING;
  } else if (flying && !fl.airborne) {
    fl.airborne = true; fl.sinceUp = 0; fl.peak = 0; fl.flushed = s.act === ACT.FLEEING;
    fl.events |= EV.TAKEOFF | (fl.flushed ? EV.FLUSH : 0);
  } else if (!flying && fl.airborne) {
    fl.airborne = false; fl.sinceDown = 0;
    fl.landedFlushed = fl.flushed;
    if (fl.flushed) fl.glow = LAND_GLOW;
    fl.events |= EV.LAND | (fl.flushed ? EV.LAND_FLUSHED : 0);
    fl.flushed = false;
  } else if (flying && s.act === ACT.FLEEING && !fl.flushed) {
    // A flight that turns into a flight from the player (flock mates catch the fear).
    fl.flushed = true; fl.events |= EV.FLUSH;
  }
  fl.act = s.act;
  fl.sinceUp += dt; fl.sinceDown += dt;
  if (fl.glow > 0) fl.glow = Math.max(0, fl.glow - dt);
  if (fl.airborne && fl.glow > 0) fl.glow = 0; // flushed again: the glow belongs to a landing
  // Airborne weight: quick to rise (the burst), a little slower to fall (the settle).
  const target = fl.airborne ? 1 : 0;
  fl.air += (target - fl.air) * (1 - Math.exp(-dt * (fl.airborne ? 9 : 5)));
  if (Math.abs(fl.air - target) < 1e-3) fl.air = target;

  // Before take-off: crouch (the look-ahead sees the take-off coming).
  const upNext = !flying && s.nextAct >= 0 && inFlight(s.nextAct, 3);
  fl.crouch = upNext ? 1 - smooth(0, PHASE.crouch, s.nextIn) : 0;

  // Approaching a landing: flare when the look-ahead sees it, or as the engine's
  // flight eases off to its perch (speed falling well below this flight's peak).
  if (flying) {
    const v = Math.hypot(s.vx, s.vy, s.vz) || s.speed;
    if (v > fl.peak) fl.peak = v;
    const downNext = s.nextAct >= 0 && !inFlight(s.nextAct, 0);
    const byLook = downNext ? 1 - smooth(0, PHASE.flare, s.nextIn) : 0;
    const byEase = fl.sinceUp > 0.6 && fl.peak > 2 && s.vy <= 0.5 ? 1 - smooth(0.3, 0.5, v / fl.peak) : 0;
    fl.flare = Math.max(byLook, byEase * 0.85);
  } else fl.flare = 0;

  // Continuity guard.
  if (!fl.has || s.fade < 0.999) {
    fl.has = true; fl.ox = fl.oy = fl.oz = 0;
  } else {
    const dx = s.x - fl.rx, dy = s.y - fl.ry, dz = s.z - fl.rz;
    const step = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const v = Math.max(Math.hypot(s.vx, s.vy, s.vz), s.speed);
    const allowed = 0.08 + v * dt * 2.5;
    if (step > allowed && step < 30) {
      // Keep the drawn bird where it was; the offset glides out.
      fl.ox -= dx - (dx / step) * v * dt; fl.oy -= dy - (dy / step) * v * dt; fl.oz -= dz - (dz / step) * v * dt;
    }
    const k = Math.exp(-dt / GLIDE_TAU);
    fl.ox *= k; fl.oy *= k; fl.oz *= k;
    if (Math.abs(fl.ox) + Math.abs(fl.oy) + Math.abs(fl.oz) < 1e-4) fl.ox = fl.oy = fl.oz = 0;
  }
  fl.rx = s.x; fl.ry = s.y; fl.rz = s.z;
  s.x += fl.ox; s.y += fl.oy; s.z += fl.oz;
  return fl.events;
}

/** Strength 0..1 of the landing glow (full for most of LAND_GLOW, fading over the last 3 s). */
export function landGlow(fl) {
  return fl.glow > 0 ? smooth(0, 3, fl.glow) : 0;
}

/**
 * The airborne weight flightScale() uses for the drawn size. A flushed bird keeps its
 * in-flight size floor on its landing perch while the landing glow lasts, easing back
 * to the perched exaggeration over its last 3 s: the eye that followed it in does not
 * see it shrink by a third the moment it touches down (play-test: a robin went from
 * ~20 to ~5 visible px at 35 m on landing and was lost). Still depth-tested.
 */
export function scaleWeight(fl) {
  return TUNE.holdLanding ? Math.max(fl.air, landGlow(fl)) : fl.air;
}

/** Debug / A-B switches (set from the console or a test harness; not saved). */
export const TUNE = { holdLanding: true, landWindow: true };

/** Leaf-window reach (m) for a flushed bird during its landing glow. */
export const LAND_WINDOW_RANGE = 80;

/**
 * How far away a bird may still get a leaf window (visibility.js WINDOW.range is the
 * everyday reach). A flushed bird that has just landed keeps one out to
 * LAND_WINDOW_RANGE while its landing glow lasts: it usually drops onto an outer branch
 * 30-60 m off, and at that range the outer needles of the same crown bury it on screen
 * (play-test: a blackbird seen landing in a pine 44 m off had 0 visible pixels through
 * binoculars). The window is the same slim, leaves-only cone that opens only while the
 * player looks near the bird; trunks, limbs and terrain still hide it.
 */
export function windowRange(fl, base) {
  return TUNE.landWindow && fl.glow > 0 ? Math.max(base, LAND_WINDOW_RANGE) : base;
}

/**
 * Outline alpha after a flushed bird lands: at least `min` (fading with the glow), so
 * the eye that followed it can hold it on its new perch. The outline stays depth-tested
 * (outline.js): this never shows a bird through anything.
 */
export function glowAlpha(alpha, fl, min = 0.5) {
  const g = landGlow(fl);
  return g > 0 ? Math.max(alpha, min * g) : alpha;
}

/**
 * Take-off and landing written over an animated pose (pose.js channels), into `out`
 * (a separate pose object, so the animator's own smoothing state is untouched).
 * @param fl     createFlightState()
 * @param pose   the animator's pose (read only)
 * @param out    pose-shaped object to write
 * @param length body length (m), for the bounce
 */
export function overlayPose(fl, pose, out, length) {
  for (let i = 0; i < KEYS.length; i++) out[KEYS[i]] = pose[KEYS[i]];
  // Crouch before the spring: legs bent, body low and leaning in, tail up.
  if (fl.crouch > 0) {
    const c = fl.crouch;
    out.crouch = Math.max(out.crouch, 0.85 * c);
    out.bodyPitch -= 0.3 * c;
    out.tailPitch += 0.25 * c;
    out.coverLiftL += 0.25 * c; out.coverLiftR += 0.25 * c;
    out.fluff *= 1 - 0.05 * c;
  }
  // The push and the burst: legs still reaching down, steep climb, deep hard beats.
  if (fl.airborne && fl.sinceUp < PHASE.burst) {
    const b = 1 - smooth(0, PHASE.burst, fl.sinceUp);
    out.legTuck = Math.min(out.legTuck, 1 - b);
    out.bodyPitch += 0.4 * b;
    out.tailSpread = Math.max(out.tailSpread, 0.7 * b);
    const mid = 0.15;
    out.flapL = mid + (out.flapL - mid) * (1 + 0.45 * b);
    out.flapR = mid + (out.flapR - mid) * (1 + 0.45 * b);
    out.fold = Math.min(out.fold, 1 - b);
  }
  // The flare: wings up and forward, body upright, tail fanned, legs reaching out.
  if (fl.flare > 0) {
    const f = fl.flare;
    out.fold *= 1 - f;
    out.flapL += (0.95 - out.flapL) * f; out.flapR += (0.95 - out.flapR) * f;
    out.sweep *= 1 - f;
    out.bodyPitch += (0.85 - out.bodyPitch) * f;
    out.tailSpread += (1 - out.tailSpread) * f;
    out.tailPitch -= 0.3 * f;
    out.legTuck *= 1 - f;
  }
  // Touch-down and settle: wings held up then folded, a little bounce of the perch,
  // then one wing shuffle.
  if (!fl.airborne && fl.sinceDown < PHASE.shuffleAt + PHASE.shuffle) {
    const t = fl.sinceDown;
    if (t < PHASE.settle) {
      const u = 1 - smooth(0, PHASE.settle, t);
      out.fold = Math.min(out.fold, 1 - 0.85 * u);
      out.flapL = Math.max(out.flapL, 0.9 * u); out.flapR = Math.max(out.flapR, 0.9 * u);
      out.tailSpread = Math.max(out.tailSpread, u);
      out.bodyPitch += 0.35 * u;
      // Damped bounce: the perch gives under the landing weight.
      out.lift += -0.12 * length * Math.sin(t * 22) * Math.exp(-t * 7);
      out.crouch = Math.max(out.crouch, 0.5 * u);
    }
    const sh = (t - PHASE.shuffleAt) / PHASE.shuffle;
    if (sh > 0 && sh < 1) {
      const e = Math.sin(sh * Math.PI) * 0.4;
      if (fl.seed & 1) out.coverLiftL += e; else out.coverLiftR += e;
    }
  }
  return out;
}

// --- trails --------------------------------------------------------------------------

/**
 * The motion streak behind a flushed bird: a few soft dabs a second, each gone within
 * half a second. Sizes are in pixels of a 720-px-tall view (they are drawn at the
 * bird's distance, so they are as small as it looks and hidden by whatever hides it).
 */
export const TRAIL = Object.freeze({ rate: 22, life: 0.45, alpha: 0.4, minPx: 4, maxPx: 11, spanFrac: 0.55, maxDist: 160 });

/** Dabs to emit this frame for a flying bird (rate × dt with a carried fraction). */
export function trailCount(fl, dt, on) {
  if (!on) { fl.trailAcc = 0; return 0; }
  const acc = fl.trailAcc + TRAIL.rate * dt;
  const n = Math.floor(acc);
  fl.trailAcc = acc - n;
  return n;
}

/** Opacity of a dab at life progress p (0..1): soft in, long fade out. */
export function dabAlpha(p) {
  if (!(p >= 0) || p >= 1) return 0;
  return TRAIL.alpha * Math.min(1, p * 10) * (1 - p) * (1 - p);
}

/** Dab diameter (m) for a bird drawn `spanPx` across at `dist` m (px at 720p). */
export function dabSize(spanPx, dist, fovDeg) {
  return Math.min(Math.max(spanPx * TRAIL.spanFrac, TRAIL.minPx), TRAIL.maxPx) * refPixel(fovDeg) * dist;
}
