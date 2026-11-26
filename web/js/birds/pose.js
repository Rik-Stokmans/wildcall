// Bird animation: turns a bird's behaviour (act, flags, motion) into a pose — a flat set
// of numbers the renderer writes onto the skeleton. Pure module (no three.js, no DOM),
// allocation-free per frame.
//
// Behaviour is identification evidence in WILDCALL, so each act has a distinct body
// language: a robin's tail flick, a wagtail's pumping, a wren's cocked tail, a heron's
// slow stalk and folded neck in flight, a woodpecker's bounding flight, a kestrel's
// hover. Everything here is driven by the server's act + flags; the client never
// invents behaviour that would mislead the player (it only adds idle life: head turns,
// breathing, hops between server positions).
//
// Pose channels (radians unless noted):
//   air 0..1 airborne weight · lift m (vertical offset) · bodyPitch (+ nose up) ·
//   bodyRoll (+ right wing down) · fluff (body scale) · crouch 0..1 (legs bent) ·
//   swim 0..1 · climb 0..1 · neckPitch (+ tips the neck back) · neckScale ·
//   headYaw (+ turns right) · headPitch (+ looks up) · headRoll · jaw (bill gape) ·
//   throat (bulge scale) · tailPitch (+ raised) · tailYaw · tailSpread 0..1 ·
//   flapL/flapR (+ wing up) · sweep 0..1 (wings swept back) · hand (wingtip flex) ·
//   fold 0..1 (1 = wings closed) · coverLiftL/R (folded wing raised/drooped) ·
//   legTuck 0..1 · strideL/strideR · twig 0/1 · splash 0..1 · wake 0..1

import { ACT, FLAG, isAirborneAct, FLIGHT_STYLES, GROUND_MODES } from './constants.js';
import { flightPose, flightStyleFor, flapRateFor, createFlightPose } from './flight.js';
import { ARCHETYPES, clamp } from './rig.js';

const TAU = Math.PI * 2;

/** Channels and their smoothing rates (1/s). Higher = snappier. */
export const CHANNELS = Object.freeze({
  air: 7, lift: 22, bodyPitch: 9, bodyRoll: 8, fluff: 4, crouch: 7, swim: 6, climb: 6,
  neckPitch: 10, neckScale: 8, headYaw: 26, headPitch: 22, headRoll: 12,
  jaw: 30, throat: 20, tailPitch: 16, tailYaw: 10, tailSpread: 8,
  flapL: 0, flapR: 0, sweep: 10, hand: 0, fold: 14, coverLiftL: 14, coverLiftR: 14,
  legTuck: 8, strideL: 30, strideR: 30, twig: 0, splash: 5, wake: 3,
});
const CH = Object.keys(CHANNELS);

/** Rest values: the pose of a calm perched bird. */
const REST = Object.freeze({
  air: 0, lift: 0, bodyPitch: 0.4, bodyRoll: 0, fluff: 1, crouch: 0.15, swim: 0, climb: 0,
  neckPitch: 0, neckScale: 1, headYaw: 0, headPitch: 0, headRoll: 0,
  jaw: 0, throat: 0.85, tailPitch: 0, tailYaw: 0, tailSpread: 0,
  flapL: 0, flapR: 0, sweep: 0, hand: 0, fold: 1, coverLiftL: 0, coverLiftR: 0,
  legTuck: 0, strideL: 0, strideR: 0, twig: 0, splash: 0, wake: 0,
});

export function createPose() { return { ...REST }; }

/** Per-species animation constants (computed once per species). */
export function animProfile(species, rig) {
  const look = species?.look || {};
  const move = species?.move || {};
  const arch = rig.arch;
  const A = ARCHETYPES[arch] || ARCHETYPES.songbird;
  const L = rig.length;
  const flight = FLIGHT_STYLES.includes(move.flight) ? move.flight : 'direct';
  const ground = GROUND_MODES.includes(move.ground) ? move.ground : 'hop';
  const big = L >= 0.3;
  const tailShape = look.tailShape;
  // Tail-flicking is a strong field character of chats, thrushes, wrens and warblers.
  let flick = 0.12;
  if (tailShape === 'cocked') flick = 0.5;
  else if (arch === 'songbird' || arch === 'thrush' || arch === 'warbler') flick = 0.32;
  else if (arch === 'finch' || arch === 'tit') flick = 0.2;
  return {
    arch, flight, ground,
    flapHz: clamp(typeof move.flapHz === 'number' && move.flapHz > 0 ? move.flapHz : 8, 1, 30),
    length: L,
    perchPitch: rig.perchPitch,
    neckAngle: A.neckAngle,
    hasNeck: !!rig.neck,
    headRange: arch === 'owl' ? 2.6 : arch === 'heron' ? 0.9 : 1.25,
    // Small birds move their heads in quick jerks, big ones more slowly.
    headHold: big ? [1.2, 3.5] : [0.35, 1.8],
    flick,
    wag: arch === 'wagtail',
    neckFold: arch === 'heron',
    legsTrail: (typeof look.legs === 'number' ? look.legs : 0.3) >= 0.6,
    restTail: rig.tail.restPitch,
    hopH: 0.18 * L + 0.012,
    hopDur: 0.16 + 0.25 * Math.sqrt(L),
    stride: Math.max(rig.legs.len * 1.3, 0.03),
    swimFloat: arch === 'seabird' && (look.neck || 0) > 0.5 ? -0.15 : arch === 'duck' ? 0.3 : 0.2,
    dabbler: arch === 'duck' || arch === 'rail',
    drummer: look.billShape === 'chisel',
    owl: arch === 'owl',
    soarer: flight === 'soaring',
  };
}

// --- per-bird state ---------------------------------------------------------------

export function createAnimState() {
  return {
    rng: 1, t: 0, act: -1, actTime: 0,
    phase: 0, // wingbeat phase (beats)
    walk: 0, // stride phase (cycles)
    headTimer: 0, headYawT: 0, headPitchT: 0,
    flickTimer: 1, flick: 0,
    hop: -1, hopTimer: 0.5,
    peck: -1, peckTimer: 1,
    preenTimer: 0, preenSide: 1, rouse: -1, rouseTimer: 6,
    strike: -1, strikeTimer: 6,
    dabble: -1, dabbleTimer: 5,
    sing: 0, singSeed: 0, roostSide: 1,
    tgt: createPose(),
    fp: createFlightPose(),
  };
}

/** Re-initialise a pooled state for a new bird (deterministic per id). */
export function resetAnimState(st, seed, pose) {
  st.rng = (seed >>> 0) || 1;
  st.t = 0; st.act = -1; st.actTime = 0;
  st.phase = rand(st) * 4; st.walk = rand(st);
  st.headTimer = rand(st); st.headYawT = 0; st.headPitchT = 0;
  st.flickTimer = 1 + rand(st) * 3; st.flick = 0;
  st.hop = -1; st.hopTimer = rand(st);
  st.peck = -1; st.peckTimer = rand(st) * 2;
  st.preenTimer = 0; st.preenSide = rand(st) < 0.5 ? -1 : 1;
  st.rouse = -1; st.rouseTimer = 4 + rand(st) * 8;
  st.strike = -1; st.strikeTimer = 4 + rand(st) * 8;
  st.dabble = -1; st.dabbleTimer = 2 + rand(st) * 6;
  st.sing = 0; st.singSeed = rand(st) * TAU; st.roostSide = rand(st) < 0.5 ? -1 : 1;
  Object.assign(st.tgt, REST);
  if (pose) Object.assign(pose, REST);
}

/** Deterministic PRNG (mulberry32) on the state. */
export function rand(st) {
  let t = (st.rng = (st.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (st, a, b) => a + (b - a) * rand(st);

/** Input record (reuse one per renderer). */
export function createAnimInput() {
  return { act: 0, flags: 0, speed: 0, vx: 0, vy: 0, vz: 0, yawRate: 0, lookYaw: NaN, y: 0, groundDy: 0 };
}

// --- behaviour pieces ------------------------------------------------------------

function idleHead(st, P, T, dt, wary, look) {
  st.headTimer -= dt;
  if (st.headTimer <= 0) {
    const range = P.headRange * (wary ? 0.8 : 1);
    if (wary && Number.isFinite(look) && rand(st) < 0.55) st.headYawT = clamp(look, -range, range);
    else st.headYawT = (rand(st) * 2 - 1) * range * (rand(st) < 0.3 ? 0.25 : 1);
    st.headPitchT = (rand(st) * 2 - 1) * 0.22;
    const [a, b] = P.headHold;
    st.headTimer = between(st, a, b) * (wary ? 0.6 : 1);
  }
  T.headYaw = st.headYawT;
  T.headPitch += st.headPitchT;
}

function tailLife(st, P, T, dt, nervous) {
  st.flickTimer -= dt * (nervous ? 2 : 1);
  if (st.flickTimer <= 0) { st.flick = 1; st.flickTimer = between(st, 1.4, 5); }
  st.flick = Math.max(0, st.flick - dt * 5);
  // A flick is a fast raise then a slower fall: sin of the decaying envelope.
  T.tailPitch += P.flick * Math.sin(st.flick * Math.PI) * (st.flick > 0 ? 1 : 0);
  if (P.wag) T.tailPitch += 0.32 * Math.sin(st.t * TAU * 2.6); // wagtails never stop pumping
}

function doHops(st, P, T, dt, moving, peckAfter) {
  if (st.hop >= 0) {
    st.hop += dt / P.hopDur;
    if (st.hop >= 1) {
      st.hop = -1;
      st.hopTimer = moving ? between(st, 0.12, 0.45) : between(st, 0.6, 2.4);
      if (peckAfter && rand(st) < 0.45) st.peck = 0;
    } else {
      T.lift += P.hopH * Math.sin(st.hop * Math.PI);
      T.crouch = 0;
      T.tailPitch += 0.25 * Math.sin(st.hop * Math.PI);
    }
  } else {
    st.hopTimer -= dt;
    if (st.hopTimer <= 0 && st.peck < 0) { st.hop = 0; T.crouch = 0.45; } // crouch to spring
  }
}

function doPeck(st, T, dt, depth, rate) {
  if (st.peck >= 0) {
    st.peck += dt * rate;
    if (st.peck >= 1) st.peck = -1;
    else {
      const s = Math.sin(st.peck * Math.PI);
      T.headPitch -= depth * s;
      T.neckPitch -= 0.35 * depth * s;
      T.bodyPitch -= 0.25 * depth * s;
      T.jaw = Math.max(T.jaw, 0.12 * s);
    }
  }
}

function doWalk(st, P, T, dt, speed) {
  // Walkers stride continuously and thrust the head (pigeons, rails, waders, corvids).
  // Cap the cadence so small walkers' legs stay readable (real birds also lengthen
  // their stride rather than step ever faster).
  st.walk += dt * Math.min(Math.max(speed, 0.12) / P.stride, 4.5);
  const s = Math.sin(st.walk * TAU);
  T.strideL = 0.45 * s;
  T.strideR = -0.45 * s;
  T.lift += Math.abs(s) * P.length * 0.015;
  T.bodyRoll += 0.05 * s;
  T.neckPitch += 0.14 * Math.sin(st.walk * TAU * 2);
}

function flying(st, P, T, inp, act, dt, styleOverride) {
  const style = styleOverride || flightStyleFor(act, P.flight);
  st.phase += dt * P.flapHz * flapRateFor(act);
  const fp = flightPose(style, st.phase, st.fp);
  T.air = 1;
  T.fold = fp.fold;
  T.flapL = T.flapR = fp.flap;
  T.hand = (fp.flap - 0.15) * 0.45 - (fp.flapping ? 0 : 0.1);
  T.tailSpread = fp.tailSpread;
  T.legTuck = 1;
  T.crouch = 0;
  const hs = Math.hypot(inp.vx, inp.vz);
  // Climb/descent tilts the body; turning banks it (coordinated turn: tan φ = v·ω/g).
  T.bodyPitch = clamp(Math.atan2(inp.vy, Math.max(hs, 0.5)) * 0.7, -0.7, 0.7);
  T.bodyRoll = clamp(Math.atan((hs * inp.yawRate) / 9.81), -0.95, 0.95) + fp.sway * 1.4;
  T.lift = fp.bob * P.length;
  T.sweep = act === ACT.FLEEING ? 0.2 : 0;
  if (style === 'soaring') {
    // Slow, lazy banking while circling on spread wings.
    T.bodyRoll += 0.16 * Math.sin(st.t * 0.35 + st.singSeed);
    T.hand = -0.08;
  } else if (style === 'hover') {
    T.bodyPitch = 0.75;
    T.tailPitch = -0.45;
    T.tailSpread = 1;
  }
  // Necks: herons fold theirs into an S, others stretch forward.
  if (P.neckFold) { T.neckPitch = 0.9; T.neckScale = 0.6; } else if (P.hasNeck) T.neckPitch = -(P.neckAngle - 0.2);
  T.headPitch = -T.bodyPitch - T.neckPitch + (style === 'hover' ? -0.5 : 0);
  T.headYaw = 0;
}

// --- main -------------------------------------------------------------------------

/**
 * Advance a bird's animation by dt and write the smoothed pose into out.
 * @param st createAnimState()
 * @param P animProfile()
 * @param inp createAnimInput() filled by the renderer: act, flags, speed (m/s),
 *   vx/vy/vz (m/s), yawRate (rad/s), lookYaw (bearing to the viewer relative to the
 *   bird's heading, NaN if unknown), y (render height), groundDy (ground height minus
 *   the bird's y, ≤ 0, used when wading)
 */
export function updateAnim(st, P, inp, dt, out) {
  dt = clamp(dt, 0, 0.1);
  st.t += dt;
  const act = inp.act >= 0 && inp.act < 18 ? inp.act : ACT.PERCHED;
  if (act !== st.act) { st.act = act; st.actTime = 0; st.hop = -1; st.peck = -1; st.strike = -1; st.dabble = -1; }
  st.actTime += dt;
  const flags = inp.flags | 0;
  const wary = (flags & FLAG.WARY) !== 0;
  const speed = inp.speed;
  const T = st.tgt;
  Object.assign(T, REST);
  T.bodyPitch = P.perchPitch;
  T.tailPitch = P.restTail;
  const breathe = Math.sin(st.t * TAU * (P.length < 0.3 ? 1.3 : 0.6) + st.singSeed);
  T.fluff = 1 + 0.012 * breathe;

  switch (act) {
    case ACT.FLYING: case ACT.FLEEING: case ACT.SOARING: case ACT.HOVERING:
      flying(st, P, T, inp, act, dt);
      break;
    case ACT.DIVING:
      if (inp.y > 0.35) {
        // Plunge: wings swept back and half closed, bill first.
        flying(st, P, T, inp, act, dt);
        T.fold = 0.65; T.sweep = 1; T.bodyPitch = -1.25; T.headPitch = 0; T.tailSpread = 0;
        T.flapL = T.flapR = 0.25;
      } else {
        // Under water (cormorants, puffins, ducks diving): slip below the surface.
        T.swim = 1; T.legTuck = 1; T.crouch = 0;
        T.bodyPitch = -0.7;
        T.lift = -P.length * 1.2 * clamp(st.actTime / 0.6, 0, 1);
        T.splash = st.actTime < 0.5 ? 1 : 0;
      }
      break;
    case ACT.SWIMMING:
      swimming(st, P, T, dt, speed, false);
      break;
    case ACT.FORAGING: case ACT.FEEDING: {
      const feeding = act === ACT.FEEDING;
      if (inp.y < 0.2 && (P.ground === 'swim' || P.dabbler)) { swimming(st, P, T, dt, speed, true); break; }
      if (P.ground === 'wade' || P.arch === 'heron') { wading(st, P, T, inp, dt, speed, feeding); break; }
      if (P.ground === 'cling' && inp.groundDy < -0.5) { climbing(st, P, T, dt, feeding); break; }
      idleHead(st, P, T, dt, wary, inp.lookYaw);
      tailLife(st, P, T, dt, wary);
      T.bodyPitch = Math.min(P.perchPitch, 0.25); // foraging birds lean forward
      if (feeding) {
        // Rapid pecks: the "perfect moment" for a photo.
        st.peckTimer -= dt;
        if (st.peck < 0 && st.peckTimer <= 0) { st.peck = 0; st.peckTimer = between(st, 0.12, 0.4); }
        doPeck(st, T, dt, 0.95, 5.5);
        T.headYaw *= 0.3;
      } else {
        if (P.ground === 'walk') doWalk(st, P, T, dt, speed);
        else doHops(st, P, T, dt, speed > 0.15, true);
        st.peckTimer -= dt;
        if (st.peck < 0 && st.hop < 0 && st.peckTimer <= 0) { st.peck = 0; st.peckTimer = between(st, 0.6, 2.2); }
        doPeck(st, T, dt, 0.8, 4);
      }
      break;
    }
    case ACT.WADING:
      wading(st, P, T, inp, dt, speed, false);
      break;
    case ACT.CLIMBING:
      climbing(st, P, T, dt, false);
      break;
    case ACT.ALERT:
      // Frozen upright, sleeked, eyes on the player.
      T.bodyPitch = P.perchPitch + 0.25;
      T.neckScale = 1.12;
      T.fluff = 0.93;
      T.crouch = 0;
      st.headTimer -= dt;
      if (st.headTimer <= 0) {
        st.headYawT = Number.isFinite(inp.lookYaw) ? clamp(inp.lookYaw, -P.headRange, P.headRange) : st.headYawT;
        st.headPitchT = 0.05;
        st.headTimer = between(st, 1.5, 3.5);
      }
      T.headYaw = st.headYawT;
      tailLife(st, P, T, dt, true);
      break;
    case ACT.HIDING:
      T.crouch = 0.85; T.fluff = 0.97; T.bodyPitch = 0.12; T.neckScale = 0.75;
      T.headYaw = st.headYawT * 0.3;
      break;
    case ACT.ROOSTING:
      T.fluff = 1.17 + 0.02 * breathe; T.crouch = 1; T.neckScale = 0.65;
      if (P.owl) {
        // Owls roost upright, head drifting slowly; eyes half closed is beyond our scale.
        T.bodyPitch = P.perchPitch;
        T.headYaw = 0.5 * Math.sin(st.t * 0.15 + st.singSeed);
      } else {
        // Head turned back and tucked into the mantle feathers.
        T.headYaw = st.roostSide * 2.6; T.headPitch = -0.35; T.bodyPitch = Math.min(P.perchPitch, 0.3);
      }
      break;
    case ACT.PREENING:
      preening(st, P, T, dt);
      break;
    case ACT.BATHING: {
      const f = Math.sin(st.t * TAU * 15);
      T.crouch = 0.7; T.fluff = 1.12;
      T.bodyPitch = -0.2 + 0.3 * Math.sin(st.t * TAU * 2.2);
      T.coverLiftL = T.coverLiftR = 0.45 + 0.25 * f;
      T.tailSpread = 0.6; T.tailPitch = 0.15;
      T.headPitch = -0.3 + 0.3 * Math.sin(st.t * TAU * 2.2 + 1);
      T.splash = 1;
      if (inp.y < 0.2) { T.swim = P.ground === 'swim' ? 1 : 0; }
      break;
    }
    case ACT.SOCIAL:
      if (speed > 2.2) flying(st, P, T, inp, ACT.FLYING, dt, P.flight === 'soaring' ? 'flapglide' : 'darting');
      else if (inp.y < 0.2 && P.ground === 'swim') swimming(st, P, T, dt, speed, false);
      else {
        // Courtship / rivalry display: fanned raised tail, quivering drooped wings, bowing.
        T.tailSpread = 0.85; T.tailPitch = P.restTail + 0.4;
        const q = 0.1 * Math.sin(st.t * TAU * 12);
        T.coverLiftL = T.coverLiftR = -0.25 + q;
        T.bodyPitch = P.perchPitch + 0.3 * Math.sin(st.t * TAU * 0.8);
        T.headPitch = 0.25;
        T.fluff = 1.08;
        if (speed > 0.2) doHops(st, P, T, dt, true, false);
      }
      break;
    case ACT.NESTING:
      T.twig = 1;
      if (speed > 1.2) flying(st, P, T, inp, ACT.FLYING, dt);
      else {
        idleHead(st, P, T, dt, wary, inp.lookYaw);
        doHops(st, P, T, dt, speed > 0.15, false);
      }
      break;
    default: // PERCHED
      idleHead(st, P, T, dt, wary, inp.lookYaw);
      tailLife(st, P, T, dt, wary);
      if (speed > 0.25) doHops(st, P, T, dt, true, false);
      break;
  }

  // Keep the head roughly level while the body pitches (birds stabilise their gaze).
  if (T.air < 0.5 && T.climb < 0.5 && act !== ACT.ROOSTING) T.headPitch -= (T.bodyPitch - 0.0) * 0.85 + T.neckPitch * 0.8;

  // Singing: gaping bill, pulsing throat, head up, a slight pump of the body.
  const singing = (flags & FLAG.SINGING) !== 0 && act !== ACT.HIDING;
  st.sing += ((singing ? 1 : 0) - st.sing) * (1 - Math.exp(-dt * 10));
  if (st.sing > 0.01) {
    const s = st.sing;
    const gape = P.owl ? 0.06 : 0.16 + 0.24 * Math.abs(Math.sin(st.t * TAU * 6.5 + st.singSeed));
    T.jaw = Math.max(T.jaw, s * gape);
    T.throat = 0.85 + s * (P.owl ? 0.55 : 0.3) * (0.6 + 0.4 * Math.sin(st.t * TAU * 5.5));
    if (T.air < 0.5) {
      T.headPitch += s * 0.32;
      T.bodyPitch += s * 0.045 * Math.sin(st.t * TAU * 2.3);
      T.tailPitch -= s * 0.1;
    }
  }

  // FlagHidden: tucked into deep cover — stay low and still.
  if ((flags & FLAG.HIDDEN) !== 0 && T.air < 0.5) T.crouch = Math.max(T.crouch, 0.6);

  // Smooth every channel towards its target (critically damped-ish exponential).
  for (let i = 0; i < CH.length; i++) {
    const c = CH[i];
    const r = CHANNELS[c];
    if (r === 0) out[c] = T[c];
    else out[c] += (T[c] - out[c]) * (1 - Math.exp(-r * dt));
  }
  return out;
}

function swimming(st, P, T, dt, speed, feeding) {
  T.swim = 1; T.legTuck = 1; T.crouch = 0;
  T.bodyPitch = 0.02;
  T.lift = P.length * 0.025 * Math.sin(st.t * TAU * 0.7 + st.singSeed);
  T.wake = clamp(speed / 0.5, 0, 1);
  T.tailPitch = P.restTail * 0.5 + 0.1;
  idleHead(st, P, T, dt, false, NaN);
  if (feeding) {
    if (P.dabbler) {
      // Up-ending: dabbling ducks tip forward, tail to the sky.
      st.dabbleTimer -= dt;
      if (st.dabble < 0 && st.dabbleTimer <= 0) { st.dabble = 0; st.dabbleTimer = between(st, 3, 8); }
      if (st.dabble >= 0) {
        st.dabble += dt / 2.2;
        if (st.dabble >= 1) st.dabble = -1;
        else {
          const e = clamp(Math.sin(st.dabble * Math.PI) * 1.6, 0, 1);
          T.bodyPitch = -1.35 * e;
          T.lift -= P.length * 0.25 * e;
          T.tailPitch += 0.4 * e;
          T.headYaw = 0;
          T.splash = e > 0.8 ? 0.3 : 0;
        }
      }
    }
    st.peckTimer -= dt;
    if (st.peck < 0 && st.dabble < 0 && st.peckTimer <= 0) { st.peck = 0; st.peckTimer = between(st, 0.5, 1.8); }
    doPeck(st, T, dt, 0.7, 3);
  }
}

function wading(st, P, T, inp, dt, speed, feeding) {
  // Slow deliberate stalk with the neck held forward, frozen between steps, and a
  // lightning jab now and then.
  T.bodyPitch = Math.min(P.perchPitch, 0.35);
  T.neckPitch = -0.45;
  T.crouch = 0.1;
  T.lift += clamp(inp.groundDy, -P.length * 0.75, 0);
  if (speed > 0.05) {
    st.walk += dt * 0.6;
    const s = Math.sin(st.walk * TAU);
    T.strideL = 0.5 * Math.max(0, s);
    T.strideR = 0.5 * Math.max(0, -s);
  }
  st.strikeTimer -= dt * (feeding ? 3 : 1);
  if (st.strike < 0 && st.strikeTimer <= 0) { st.strike = 0; st.strikeTimer = between(st, 5, 12); }
  if (st.strike >= 0) {
    st.strike += dt / 0.45;
    if (st.strike >= 1) st.strike = -1;
    else {
      const e = Math.sin(st.strike * Math.PI);
      T.neckPitch -= 0.9 * e;
      T.headPitch -= 0.7 * e;
      T.jaw = 0.15 * e;
    }
  }
  st.headTimer -= dt;
  if (st.headTimer <= 0) { st.headYawT = (rand(st) * 2 - 1) * 0.5; st.headTimer = between(st, 1.5, 4); }
  T.headYaw = st.headYawT;
}

function climbing(st, P, T, dt, feeding) {
  T.climb = 1;
  T.bodyPitch = 1.35;
  T.crouch = 0.5;
  T.tailPitch = -0.35; // pressed against the bark as a prop
  // Jerky upward hitches.
  doHops(st, P, T, dt, true, false);
  st.peckTimer -= dt;
  if (st.peck < 0 && st.peckTimer <= 0) {
    st.peck = 0;
    st.peckTimer = feeding && P.drummer ? between(st, 0.06, 0.12) : between(st, 0.8, 2.5);
  }
  doPeck(st, T, dt, 0.5, P.drummer ? 10 : 5);
  st.headTimer -= dt;
  if (st.headTimer <= 0) { st.headYawT = (rand(st) * 2 - 1) * 0.6; st.headTimer = between(st, 0.4, 1.4); }
  T.headYaw = st.headYawT;
}

function preening(st, P, T, dt) {
  st.preenTimer -= dt;
  if (st.preenTimer <= 0) {
    st.preenSide = rand(st) < 0.15 ? 0 : rand(st) < 0.5 ? -1 : 1; // 0 = breast
    st.preenTimer = between(st, 1.1, 3);
  }
  const side = st.preenSide;
  const nibble = 0.1 * Math.sin(st.t * TAU * 8);
  T.headYaw = side * 2.1;
  T.headPitch = (side === 0 ? -0.9 : -0.55) + nibble;
  if (side < 0) T.coverLiftL = 0.35; else if (side > 0) T.coverLiftR = 0.35;
  T.fluff = 1.06;
  st.rouseTimer -= dt;
  if (st.rouse < 0 && st.rouseTimer <= 0) { st.rouse = 0; st.rouseTimer = between(st, 5, 12); }
  if (st.rouse >= 0) {
    // The rouse: a quick all-over feather shake.
    st.rouse += dt / 0.5;
    if (st.rouse >= 1) st.rouse = -1;
    else {
      const e = Math.sin(st.rouse * Math.PI);
      T.fluff = 1.06 + 0.2 * e;
      T.bodyRoll = 0.22 * e * Math.sin(st.t * TAU * 14);
      T.tailSpread = 0.6 * e;
      T.headYaw = 0;
    }
  }
}

// --- stance -----------------------------------------------------------------------

/**
 * Body-bone position that keeps the feet on the contact point (mesh origin) for a body
 * pitched by `pitch` with legs bent by `crouch`, blended towards swimming (floating at
 * the surface), climbing (belly to the trunk) and flight (body centre on the point).
 * Writes {y, z} into out.
 */
export function stanceOffset(rig, P, pose, out = { y: 0, z: 0 }) {
  const f = pose.fluff;
  const legLen = rig.legs.len * legBend(pose.crouch) * f;
  const hy = rig.legs.hip.y * f, hz = rig.legs.hip.z * f;
  const c = Math.cos(pose.bodyPitch), s = Math.sin(pose.bodyPitch);
  // Hip after pitching the body about X (+ = nose up): y' = y·c − z·s, z' = y·s + z·c.
  let gy = legLen - (hy * c - hz * s);
  let gz = -(hy * s + hz * c);
  const sw = clamp(pose.swim, 0, 1), cl = clamp(pose.climb, 0, 1), air = clamp(pose.air, 0, 1);
  const floatY = rig.body.ry * f * P.swimFloat;
  gy += (floatY - gy) * sw; gz += (0 - gz) * sw;
  gy += (rig.body.rz * 0.15 - gy) * cl; gz += (rig.body.ry * f * 1.05 - gz) * cl;
  out.y = gy * (1 - air) + pose.lift;
  out.z = gz * (1 - air);
  return out;
}

/** Leg length factor for a crouch amount (bent legs). */
export function legBend(crouch) { return 1 - 0.45 * clamp(crouch, 0, 1); }

/** Is this act grounded on a surface the feet should touch? */
export function isGroundedAct(act) { return !isAirborneAct(act); }
