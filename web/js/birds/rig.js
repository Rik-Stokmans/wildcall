// Bird model parameter derivation: everything about a species' 3D shape that is plain
// maths (no three.js). model.js turns these numbers into geometry.
//
// Conventions (bird-local space, metres): the bird faces -Z, +X is its right, +Y up.
// All dimensions are derived from core.Appearance (species.look): Length/Wingspan set
// real scale, the ratios shape it, and the shape words pick profiles below. The
// silhouette class (species.traits.shape, the same word the field guide uses) only
// tunes posture and head size so owls, raptors, herons, ducks… read instantly.

import { BILL_SHAPES, TAIL_SHAPES, WING_SHAPES } from './constants.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Elevation (radians) of a songbird's head above the body axis, seen from the side. */
const HEAD_ELEVATION = 0.62;
/** Length of the slotted primaries of broad wings, as a fraction of the wing surface. */
export const FINGER_FRACTION = 0.16;
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * Bill profiles. Widths/heights are fractions of the head radius; droop/hook are
 * fractions of the bill length the tip bends down; lowerLen is the lower mandible's
 * length relative to the upper; taper shapes the narrowing (1 linear, <1 stays wide
 * longer); tip is the width left at the tip (flat duck bills stay broad).
 */
export const BILL_PROFILES = Object.freeze({
  cone: { baseW: 0.56, baseH: 0.56, taper: 1.0, tip: 0.06, droop: 0.0, hook: 0.0, lowerLen: 0.95, lowerH: 0.46 },
  thin: { baseW: 0.27, baseH: 0.25, taper: 0.8, tip: 0.05, droop: 0.0, hook: 0.0, lowerLen: 0.96, lowerH: 0.45 },
  dagger: { baseW: 0.34, baseH: 0.38, taper: 1.0, tip: 0.02, droop: 0.0, hook: 0.0, lowerLen: 0.98, lowerH: 0.45 },
  hooked: { baseW: 0.5, baseH: 0.62, taper: 0.85, tip: 0.06, droop: 0.12, hook: 0.38, lowerLen: 0.68, lowerH: 0.34 },
  flat: { baseW: 0.66, baseH: 0.24, taper: 0.22, tip: 0.48, droop: 0.0, hook: 0.05, lowerLen: 0.96, lowerH: 0.4 },
  curved: { baseW: 0.26, baseH: 0.26, taper: 0.85, tip: 0.04, droop: 0.34, hook: 0.0, lowerLen: 0.96, lowerH: 0.45 },
  chisel: { baseW: 0.36, baseH: 0.42, taper: 0.6, tip: 0.24, droop: 0.0, hook: 0.0, lowerLen: 0.92, lowerH: 0.45 },
});

/**
 * Tail profiles. Tail length at lateral position s (-1..1) =
 *   len · (1 − fork·(1−|s|) − point·|s| − round·s²).
 * widthMul scales the tail's width at the tip vs the body; spread is the extra width
 * when fanned (landing, display, hover); restPitch raises it (radians) at rest.
 */
export const TAIL_PROFILES = Object.freeze({
  square: { widthMul: 1.0, spread: 1.25, fork: 0.0, point: 0.0, round: 0.06, restPitch: 0.0 },
  forked: { widthMul: 1.0, spread: 1.3, fork: 0.34, point: 0.0, round: 0.0, restPitch: 0.0 },
  fan: { widthMul: 1.3, spread: 1.7, fork: 0.0, point: 0.0, round: 0.24, restPitch: 0.0 },
  pointed: { widthMul: 0.62, spread: 1.15, fork: 0.0, point: 0.5, round: 0.0, restPitch: 0.0 },
  cocked: { widthMul: 0.9, spread: 1.2, fork: 0.0, point: 0.0, round: 0.22, restPitch: 1.05 },
});

/**
 * Wing profiles. chord is the inner-wing chord as a fraction of the wing length;
 * tipW the chord left at the tip (fraction of the inner chord); knee where the taper
 * starts (fraction of span); sweep how far the leading edge sweeps back at the tip
 * (fraction of the wing length); fingers adds slotted primaries (broad soaring wings).
 */
export const WING_PROFILES = Object.freeze({
  rounded: { chord: 0.44, tipW: 0.5, knee: 0.55, sweep: 0.1, fingers: 0 },
  pointed: { chord: 0.34, tipW: 0.08, knee: 0.35, sweep: 0.3, fingers: 0 },
  broad: { chord: 0.5, tipW: 0.72, knee: 0.7, sweep: 0.05, fingers: 1 },
  long: { chord: 0.25, tipW: 0.12, knee: 0.45, sweep: 0.2, fingers: 0 },
});

/**
 * Silhouette archetypes: head size, perched body pitch (radians, nose up), neck carriage
 * (angle of the neck above horizontal), body width, facial disc, wading stance.
 */
export const ARCHETYPES = Object.freeze({
  songbird: { head: 1.0, pitch: 0.45, neckAngle: 1.2, wide: 0.92 },
  finch: { head: 1.02, pitch: 0.4, neckAngle: 1.2, wide: 0.94 },
  tit: { head: 1.12, pitch: 0.38, neckAngle: 1.2, wide: 0.95 },
  thrush: { head: 0.95, pitch: 0.36, neckAngle: 1.1, wide: 0.92 },
  warbler: { head: 0.95, pitch: 0.36, neckAngle: 1.2, wide: 0.88 },
  wagtail: { head: 0.92, pitch: 0.1, neckAngle: 1.0, wide: 0.86 },
  lark: { head: 0.95, pitch: 0.2, neckAngle: 1.0, wide: 0.92 },
  swallow: { head: 0.95, pitch: 0.3, neckAngle: 1.0, wide: 0.9 },
  treecreeper: { head: 0.9, pitch: 0.5, neckAngle: 1.0, wide: 0.86 },
  woodpecker: { head: 0.95, pitch: 0.95, neckAngle: 0.9, wide: 0.9 },
  corvid: { head: 0.92, pitch: 0.3, neckAngle: 1.0, wide: 0.9 },
  pigeon: { head: 0.78, pitch: 0.18, neckAngle: 1.1, wide: 1.0 },
  kingfisher: { head: 1.32, pitch: 0.55, neckAngle: 1.2, wide: 0.95 },
  owl: { head: 1.38, pitch: 1.25, neckAngle: 1.4, wide: 1.0, disc: true },
  raptor: { head: 0.95, pitch: 0.95, neckAngle: 1.2, wide: 0.95 },
  duck: { head: 0.95, pitch: 0.0, neckAngle: 1.25, wide: 1.12 },
  gull: { head: 0.88, pitch: 0.12, neckAngle: 1.1, wide: 0.95 },
  seabird: { head: 1.0, pitch: 0.55, neckAngle: 1.0, wide: 1.0 },
  heron: { head: 0.75, pitch: 0.7, neckAngle: 1.25, wide: 0.85 },
  wader: { head: 0.88, pitch: 0.1, neckAngle: 1.0, wide: 0.95 },
  rail: { head: 0.9, pitch: 0.15, neckAngle: 1.1, wide: 0.88 },
  grouse: { head: 0.78, pitch: 0.08, neckAngle: 1.1, wide: 1.05 },
});

/**
 * The silhouette archetype for a species: its field-guide shape word when known,
 * otherwise inferred from the look so that any authored species gets a sensible body.
 */
export function archetypeOf(species) {
  const s = species?.traits?.shape;
  if (s && ARCHETYPES[s]) return s;
  const l = species?.look || {};
  const bill = l.billShape, legs = num(l.legs, 0.3), neck = num(l.neck, 0.1);
  if (bill === 'hooked' && neck < 0.1 && num(l.plump, 1) >= 1.2) return 'owl';
  if (bill === 'hooked') return l.wingShape === 'long' ? 'gull' : 'raptor';
  if (bill === 'flat') return 'duck';
  if (bill === 'chisel') return 'woodpecker';
  if (legs >= 0.8 && neck >= 0.6) return 'heron';
  if (legs >= 0.55 && num(l.bill, 0.5) >= 1.4) return 'wader';
  if (species?.move?.ground === 'swim') return 'duck';
  if (num(l.length, 0.15) >= 0.3) return 'corvid';
  return 'songbird';
}

/** Leading-edge offset (backwards, fraction of wing length) and chord (fraction of wing
 *  length) at span position u (0 shoulder … 1 tip). */
export function wingOutline(profile, u, out = { le: 0, chord: 0 }) {
  const p = WING_PROFILES[profile] || WING_PROFILES.rounded;
  u = clamp(u, 0, 1);
  let k = 1;
  if (u > p.knee) {
    const t = (u - p.knee) / (1 - p.knee);
    // Smoothly ease the chord down to the tip width; rounded tips curve, pointed ones don't.
    k = 1 + (p.tipW - 1) * Math.pow(t, profile === 'rounded' ? 2.2 : 1.3);
  }
  out.le = p.sweep * u * u;
  out.chord = p.chord * k;
  return out;
}

/** Tail length factor (0..1) at lateral position s (-1..1) for a tail shape. */
export function tailLengthAt(shape, s) {
  const p = TAIL_PROFILES[shape] || TAIL_PROFILES.square;
  const a = Math.abs(clamp(s, -1, 1));
  return clamp(1 - p.fork * (1 - a) - p.point * a - p.round * a * a, 0.15, 1);
}

/** Bill centreline drop (fraction of bill length) at t (0 base … 1 tip). */
export function billDropAt(shape, t) {
  const p = BILL_PROFILES[shape] || BILL_PROFILES.cone;
  t = clamp(t, 0, 1);
  const hookT = t > 0.7 ? (t - 0.7) / 0.3 : 0;
  return p.droop * t * t + p.hook * hookT * hookT * hookT;
}

/** Bill half-width factor (fraction of the base width) at t. */
export function billWidthAt(shape, t) {
  const p = BILL_PROFILES[shape] || BILL_PROFILES.cone;
  t = clamp(t, 0, 1);
  return p.tip + (1 - p.tip) * Math.pow(1 - t, p.taper);
}

/**
 * Derive every dimension of a species' model from its look. Returns plain numbers in
 * metres (bird-local space, origin = body centre).
 */
export function deriveRig(species) {
  const look = species?.look || {};
  const arch = archetypeOf(species);
  const A = ARCHETYPES[arch];
  const L = clamp(num(look.length, 0.15), 0.07, 1.6);
  const span = clamp(num(look.wingspan, L * 1.6), 0.1, 2.6);
  const plump = clamp(num(look.plump, 1), 0.6, 1.4);
  const neck = clamp(num(look.neck, 0.1), 0, 1);
  const legs = clamp(num(look.legs, 0.3), 0, 1);
  const tail = clamp(num(look.tail, 0.6), 0.1, 1.6);
  const bill = clamp(num(look.bill, 0.5), 0.1, 3.2);
  const billShape = BILL_PROFILES[look.billShape] ? look.billShape : 'cone';
  const tailShape = TAIL_PROFILES[look.tailShape] ? look.tailShape : 'square';
  const wingShape = WING_PROFILES[look.wingShape] ? look.wingShape : 'rounded';

  const headR = (L * 0.13 * A.head) / (1 + 1.2 * neck);
  const billLen = headR * (0.3 + 1.0 * bill);
  const tailLen = L * clamp(0.06 + 0.3 * tail, 0.06, 0.55);
  const neckLen = neck < 0.12 ? 0 : L * 0.33 * Math.pow(neck, 1.1);
  const bodyLen = Math.max(L * 0.3, L - billLen - headR * 1.6 - neckLen - tailLen * 0.9);
  const rz = bodyLen * 0.54;
  const ry = rz * 0.62 * plump * (A.disc ? 1.12 : 1);
  const rx = ry * A.wide;

  // Head: on a neck when there is one, otherwise snug against the front of the body.
  // Geometry is built with the body horizontal and the perched pose then pitches it up
  // by A.pitch, so upright birds (owls, raptors, woodpeckers) carry the head further
  // along the body axis here; after pitching it sits on top, not behind.
  const tilt = Math.max(0, A.pitch - 0.45) * 0.85;
  const neckBase = { x: 0, y: ry * 0.45, z: -rz * 0.72 };
  let head;
  if (neckLen > 0) {
    const a = Math.max(0.15, A.neckAngle - A.pitch * 0.9); // neck carriage measured from the ground
    head = { x: 0, y: neckBase.y + Math.sin(a) * neckLen, z: neckBase.z - Math.cos(a) * neckLen };
  } else {
    const beta = HEAD_ELEVATION - tilt;
    const reach = A.disc ? 0.8 : 0.86;
    head = {
      x: 0,
      y: ry * 0.62 * (Math.sin(beta) / Math.sin(HEAD_ELEVATION)),
      z: -rz * reach * (Math.cos(beta) / Math.cos(HEAD_ELEVATION)),
    };
  }

  const halfSpan = span / 2;
  const wp = WING_PROFILES[wingShape];
  // Slotted primaries stick out past the wing outline, so the surface is shortened to
  // keep the overall span true to Wingspan.
  const fingerLen = wp.fingers ? FINGER_FRACTION : 0;
  const wingLen = Math.max(halfSpan - rx * 0.75, rz * 0.9) / (1 + fingerLen);
  // Real wings fold at the wrist; folded they only reach roughly to the tail base.
  const foldedLen = clamp((rz * 1.55 + tailLen * 0.35) / wingLen, 0.25, 1);

  const legLen = L * (0.06 + 0.5 * legs);
  const tp = TAIL_PROFILES[tailShape];

  return {
    arch,
    length: L,
    span,
    body: { rx, ry, rz },
    neck: neckLen > 0 ? { len: neckLen, r: headR * 0.62, base: neckBase, top: { ...head } } : null,
    head: { r: headR, ...head, disc: !!A.disc },
    bill: { len: billLen, shape: billShape, baseW: BILL_PROFILES[billShape].baseW * headR, baseH: BILL_PROFILES[billShape].baseH * headR },
    tail: {
      len: tailLen,
      width: rx * 1.15 * tp.widthMul,
      shape: tailShape,
      spread: tp.spread,
      restPitch: tp.restPitch,
      root: { x: 0, y: ry * 0.12, z: rz * 0.82 },
    },
    wing: {
      len: wingLen,
      chord: wingLen * wp.chord,
      shape: wingShape,
      fingers: wp.fingers,
      fingerLen: fingerLen * wingLen,
      foldedLen,
      shoulder: { x: rx * 0.62, y: ry * 0.42, z: -rz * 0.3 },
    },
    legs: {
      len: legLen,
      r: Math.max(L * 0.011, 0.0018) * (legs > 0.7 ? 0.8 : 1),
      hip: { x: rx * 0.34, y: -ry * 0.55, z: rz * 0.05 },
      toe: Math.max(L * 0.06, legLen * 0.35) * (species?.move?.ground === 'swim' ? 1.4 : 1),
      webbed: species?.move?.ground === 'swim',
    },
    crest: look.crest ? { len: headR * 0.95 } : null,
    eye: A.disc
      ? { r: headR * 0.2, s: 0.4, y: 0.16, f: 0.86 }
      : { r: headR * (L < 0.2 ? 0.17 : 0.13), s: 0.7, y: 0.22, f: 0.56 },
    perchPitch: A.pitch,
    // Height of the body centre above the feet when standing at the archetype pitch.
    standHeight: legLen + ry * 0.62,
  };
}

/** Exposed for tests: every vocabulary word has a profile. */
export function profilesComplete() {
  return BILL_SHAPES.every((s) => BILL_PROFILES[s]) &&
    TAIL_SHAPES.every((s) => TAIL_PROFILES[s]) &&
    WING_SHAPES.every((s) => WING_PROFILES[s]);
}
