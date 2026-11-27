// Procedural held-tool models: binoculars, cameras, recorders/microphones, mitten-like
// hands and sleeved forearms. Each tool model is a THREE.Group in "tool space" (metres,
// -Z forward, +Y up) with a few named moving parts and the poses the hands take on it.
// One shared vertex-coloured material does almost everything; LEDs get their own.
import * as THREE from 'three';
import { createBuilder, roundBox, cyl, sphere, capsule, torus, bowl, xf, mottle, topLight, flipFaces } from './geom.js';
import { C, binoLook, cameraLook, audioLook } from './looks.js';

const PI = Math.PI;
const ALONG_Z = [PI / 2, 0, 0];      // cylinder axis (Y) → +Z
const ALONG_X = [0, 0, -PI / 2];     // cylinder axis (Y) → +X

function mesh(geo, mat, name) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name || '';
  m.castShadow = false;
  m.receiveShadow = false;
  m.frustumCulled = false;     // tiny, always in view; skip the per-frame sphere test
  m.renderOrder = 1000;
  return m;
}

/** Strap hanging from two lugs, as a half ring dropping back towards the chest. */
function strap(b, color, x, y, z, drop = 0.1, tilt = 0.9) {
  // Lower half ring (Rz π), swung back towards the player (negative X tilt → +Z).
  b.add(torus(x, 0.0042, 4, 14, PI), color, xf([0, y, z], [-tilt, 0, PI], [1, drop / x, 1]));
}

// ---------------------------------------------------------------------------------
// Hands

/**
 * A stylised mitten hand. Space: wrist at the origin, fingers along -Z, palm facing +X
 * (a LEFT hand; mirror X for the right). `grip` 0..1 curls the finger block inwards.
 */
export function buildHand(look, mirror = false, grip = 0.6, opts = {}) {
  const b = createBuilder();
  const sx = mirror ? -1 : 1;
  const skin = look.skin, shade = look.skinShade;
  const tl = topLight(0.9, 1.05, 0.04);
  // Palm / back of the hand.
  b.add(roundBox(0.03, 0.074, 0.075, 0.45), skin, xf([0, 0, -0.04], [0, 0, 0], [sx, 1, 1]), tl);
  // Finger block, curled around whatever it holds.
  const curl = 0.35 + grip * 0.9;
  b.add(roundBox(0.026, 0.07, 0.05, 0.5), skin,
    xf([0.008 * sx + Math.sin(curl) * 0.012 * sx, -0.002, -0.088 + (1 - Math.cos(curl)) * 0.01], [0, curl * sx * 0.9, 0], [sx, 1, 1]), tl);
  // Knuckle line hint.
  b.add(roundBox(0.03, 0.068, 0.012, 0.5), shade, xf([-0.002 * sx, 0, -0.072], [0, 0, 0], [sx, 1, 1]));
  // Thumb: along the top, pointing forward and in.
  if (!opts.noThumb) {
    b.add(capsule(0.0105, 0.034, 2, 6), skin, xf([0.012 * sx, 0.036, -0.045], [PI / 2 - 0.25, 0, -0.35 * sx], 1));
  }
  // Wrist.
  b.add(cyl(0.024, 0.026, 0.03, 8), skin, xf([0, 0, 0.0], ALONG_Z, [1, 1, 1]));
  return b.build();
}

/** A separate index finger (for the shutter): pivot at its base, pointing -Z. */
export function buildFinger(look) {
  const b = createBuilder();
  b.add(capsule(0.0085, 0.034, 2, 6), look.skin, xf([0, 0, -0.022], [PI / 2, 0, 0], 1));
  return b.build();
}

/** Forearm: wrist at the origin, the sleeve running along +Z (towards the shoulder). */
export function buildForearm(look) {
  const b = createBuilder();
  b.add(cyl(0.026, 0.03, 0.06, 8), look.skin, xf([0, 0, 0.025], ALONG_Z));
  b.add(cyl(0.033, 0.031, 0.03, 9), look.cuff, xf([0, 0, 0.06], ALONG_Z));
  const sh = look.mottle ? mottle(0.18, 55, 3) : topLight(0.86, 1.05, 0.04);
  b.add(cyl(0.041, 0.032, 0.42, 9, true), look.sleeve, xf([0, 0, 0.285], ALONG_Z), sh);
  if (look.mottle) {
    // Camouflage blotches.
    for (let i = 0; i < 5; i++) {
      const a = i * 2.4, z = 0.1 + i * 0.07;
      b.add(sphere(0.016, 5, 4), look.mottle[i % 2], xf([Math.cos(a) * 0.036, Math.sin(a) * 0.036, z], [0, 0, a], [1, 1.6, 2.4]));
    }
  }
  return b.build();
}

// ---------------------------------------------------------------------------------
// Binoculars

function barrel(b, L, x, y, zc, r, len, rubber) {
  const sh = topLight(0.82, 1.08, r);
  // Main tube with a slightly wider objective end.
  b.add(cyl(r, r * 0.94, len, 9), L.armour, xf([x, y, zc], ALONG_Z), rubber ? mottle(0.05, 140, x * 50) : null);
  b.add(cyl(r * 1.1, r * 1.08, len * 0.22, 9), L.body, xf([x, y, zc - len * 0.42], ALONG_Z), sh);
  if (L.ring) b.add(cyl(r * 1.12, r * 1.12, 0.004, 9), L.ring, xf([x, y, zc - len * 0.3], ALONG_Z));
  // Objective glass.
  b.add(cyl(r * 0.88, r * 0.88, 0.003, 9), C.glass, xf([x, y, zc - len * 0.53], ALONG_Z));
  b.add(sphere(r * 0.25, 5, 4), C.glassHi, xf([x + r * 0.35, y + r * 0.35, zc - len * 0.535], [0, 0, 0], [1, 1, 0.2]));
  // Eyepiece and eyecup.
  b.add(cyl(r * 0.7, r * 0.78, 0.016, 8), C.black, xf([x, y, zc + len * 0.5 + 0.008], ALONG_Z));
}

export function buildBinoculars(id, def, mat) {
  const L = binoLook(id, def);
  const s = L.size;
  const group = new THREE.Group();
  group.name = 'vm-binoculars';
  const b = createBuilder();
  const tl = topLight(0.84, 1.08, 0.02);
  let wheelPos, hands, lugX, lugZ;
  if (L.kind === 'scope') {
    // A long spotting scope held like a short telescope.
    const r = 0.028 * s, len = 0.2 * L.length;
    b.add(cyl(r, r * 0.9, len, 9), L.armour, xf([0, 0, 0], ALONG_Z), mottle(0.05, 120, 2));
    b.add(cyl(r * 1.25, r * 1.1, len * 0.25, 9), L.body, xf([0, 0, -len * 0.55], ALONG_Z), tl);
    b.add(cyl(r * 1.26, r * 1.26, 0.005, 9), L.ring, xf([0, 0, -len * 0.4], ALONG_Z));
    b.add(cyl(r * 1.08, r * 1.08, 0.003, 9), C.glass, xf([0, 0, -len * 0.68], ALONG_Z));
    b.add(cyl(r * 0.5, r * 0.62, 0.05, 8), C.black, xf([0, 0.004, len * 0.52], ALONG_Z));
    b.add(roundBox(0.03, 0.02, 0.05, 0.4), L.trim, xf([0, -r - 0.006, 0.01]));
    wheelPos = [0, r * 1.02, len * 0.1];
    hands = {
      left: { pos: [-0.006, r + 0.008, -len * 0.05], rot: [0.05, 0.1, -1.35], grip: 0.6 },
      right: { pos: [0.006, -r - 0.008, len * 0.32], rot: [0.05, 0.0, 1.9], grip: 0.8 },
    };
    lugX = r * 0.9; lugZ = len * 0.3;
  } else if (L.kind === 'porro') {
    const r = 0.021 * s, len = 0.075 * L.length * s;
    for (const sx of [-1, 1]) {
      // Prism housing (the classic chunky shoulder), objective tube offset outwards.
      b.add(roundBox(0.044 * s, 0.05 * s, 0.056 * s, 0.45), L.armour, xf([sx * 0.04 * s, 0, 0.022 * s]), L.brass ? mottle(0.06, 90, sx * 3) : tl);
      barrel(b, L, sx * 0.052 * s, -0.008 * s, -0.035 * s, r, len, false);
      // Eyepiece tubes sit inboard.
      b.add(cyl(0.012 * s, 0.013 * s, 0.03 * s, 8), L.trim, xf([sx * 0.032 * s, 0.012 * s, 0.062 * s], ALONG_Z));
      b.add(cyl(0.015 * s, 0.014 * s, 0.012 * s, 8), C.black, xf([sx * 0.032 * s, 0.012 * s, 0.08 * s], ALONG_Z));
      if (L.brass) b.add(cyl(r * 1.15, r * 1.15, 0.006, 9), C.brass, xf([sx * 0.052 * s, -0.008 * s, -0.035 * s - len * 0.18], ALONG_Z));
    }
    b.add(roundBox(0.03 * s, 0.014 * s, 0.05 * s, 0.4), L.trim, xf([0, 0.016 * s, 0.03 * s]));
    b.add(cyl(0.008 * s, 0.008 * s, 0.09 * s, 8), L.trim, xf([0, 0.016 * s, 0.02 * s], ALONG_Z));
    wheelPos = [0, 0.028 * s, 0.05 * s];
    hands = {
      left: { pos: [-0.072 * s, -0.004, 0.05 * s], rot: [0.0, -0.06, 0.5], grip: 0.85 },
      right: { pos: [0.072 * s, -0.004, 0.05 * s], rot: [0.0, 0.06, -0.5], grip: 0.85 },
    };
    lugX = 0.064 * s; lugZ = 0.04 * s;
  } else {
    const r = 0.021 * s, len = 0.118 * s * L.length, dx = 0.034 * s;
    for (const sx of [-1, 1]) barrel(b, L, sx * dx, 0, 0, r, len, !!L.rubber);
    // Bridge and hinge.
    b.add(roundBox(0.036 * s, 0.016 * s, len * 0.55, 0.45), L.body, xf([0, 0.006 * s, len * 0.08]), tl);
    b.add(cyl(0.009 * s, 0.009 * s, len * 0.85, 8), L.trim, xf([0, 0.004 * s, 0], ALONG_Z));
    if (L.rubber) {
      // Thumb indents / armour ridges along the underside.
      for (const sx of [-1, 1]) b.add(roundBox(0.014, 0.008, len * 0.4, 0.5), L.trim, xf([sx * (dx + r * 0.6), -r * 0.8, len * 0.08]));
    }
    wheelPos = [0, 0.02 * s, len * 0.24];
    hands = {
      left: { pos: [-(dx + r + 0.01), -0.004, len * 0.22], rot: [0.0, -0.06, 0.55], grip: 0.8 },
      right: { pos: [dx + r + 0.01, -0.004, len * 0.22], rot: [0.0, 0.06, -0.55], grip: 0.8 },
    };
    lugX = dx + r * 0.9; lugZ = len * 0.4;
  }
  // Strap lugs and the strap falling back towards the chest.
  for (const sx of [-1, 1]) b.add(torus(0.006, 0.0022, 4, 8), C.steel, xf([sx * lugX, 0.004, lugZ], [0, PI / 2, 0]));
  strap(b, L.strap, lugX, 0.004, lugZ + 0.01, 0.12, 1.2);
  const body = mesh(b.build(), mat, 'body');
  group.add(body);

  // Focus wheel (rotates): ridged drum.
  const w = createBuilder();
  w.add(cyl(0.0105 * s, 0.0105 * s, 0.018 * s, 8), L.brass ? C.brass : C.black, xf([0, 0, 0], ALONG_X));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    w.add(roundBox(0.019 * s, 0.003, 0.003, 0.3), L.brass ? C.brassDark : C.charcoal, xf([0, Math.cos(a) * 0.0105 * s, Math.sin(a) * 0.0105 * s], [a, 0, 0]));
  }
  const wheel = mesh(w.build(), mat, 'wheel');
  wheel.position.set(wheelPos[0], wheelPos[1], wheelPos[2]);
  group.add(wheel);

  const scope = L.kind === 'scope';
  return {
    tool: 'binoculars', group, wheel, hands, twoHanded: true,
    // Poses in camera space: lowered at the chest, and at the eyes. The long scope is
    // carried across the body, pointing down and to the left, clear of the view centre.
    low: scope ? { pos: [0.03, -0.235, -0.34], rot: [-0.35, 0.65, 0.1] } : { pos: [0, -0.215, -0.35], rot: [0.32, 0, 0] },
    eye: { pos: [0, -0.012, -0.075 - (scope ? 0.12 : 0.05) * s], rot: [0, 0, 0] },
    lowRun: scope ? { pos: [0.05, -0.26, -0.32], rot: [-0.6, 0.7, 0.2] } : { pos: [0.03, -0.25, -0.33], rot: [0.05, 0.12, 0.14] },
  };
}

// ---------------------------------------------------------------------------------
// Camera

export function buildCamera(id, def, mat) {
  const L = cameraLook(id, def);
  const s = L.size;
  const group = new THREE.Group();
  group.name = 'vm-camera';
  const b = createBuilder();
  const tl = topLight(0.82, 1.06, 0.045);
  let bodyW, bodyH, bodyD, shutter;
  if (L.style === 'rangefinder') {
    bodyW = 0.14 * s; bodyH = 0.074 * s; bodyD = 0.04 * s;
    b.add(roundBox(bodyW, bodyH * 0.62, bodyD, 0.4), L.body, xf([0, -bodyH * 0.19, 0]), mottle(0.06, 200, 4));
    b.add(roundBox(bodyW, bodyH * 0.4, bodyD, 0.4), L.top, xf([0, bodyH * 0.3, 0]), tl);
    // Rangefinder windows.
    b.add(roundBox(0.018, 0.012, 0.004, 0.3), C.glass, xf([-bodyW * 0.36, bodyH * 0.3, -bodyD * 0.5]));
    b.add(roundBox(0.012, 0.012, 0.004, 0.3), C.glass, xf([bodyW * 0.18, bodyH * 0.3, -bodyD * 0.5]));
    b.add(roundBox(0.014, 0.01, 0.004, 0.3), C.glass, xf([-bodyW * 0.33, bodyH * 0.3, bodyD * 0.5]));
    b.add(cyl(0.01, 0.01, 0.008, 8), L.top, xf([-bodyW * 0.3, bodyH * 0.5 + 0.004, 0]));
    shutter = [bodyW * 0.32, bodyH * 0.5 + 0.003, -0.004];
  } else if (L.style === 'compact') {
    bodyW = 0.118 * s; bodyH = 0.07 * s; bodyD = 0.045 * s;
    b.add(roundBox(bodyW, bodyH, bodyD, 0.5), L.body, xf([0, 0, 0]), tl);
    b.add(roundBox(bodyW * 0.98, bodyH * 0.28, bodyD * 1.02, 0.5), L.top, xf([0, bodyH * 0.36, 0]));
    b.add(roundBox(0.024, bodyH * 0.9, bodyD * 1.2, 0.5), C.charcoal, xf([bodyW * 0.42, -0.002, -0.004]));
    b.add(roundBox(0.03, 0.016, 0.006, 0.3), C.glass, xf([-bodyW * 0.28, bodyH * 0.28, -bodyD * 0.5]));
    b.add(roundBox(0.06 * s, 0.038 * s, 0.003, 0.2), 0x1b242b, xf([-0.01, 0, bodyD * 0.5 + 0.001]));
    shutter = [bodyW * 0.34, bodyH * 0.5 + 0.003, -0.004];
  } else {
    bodyW = 0.135 * s; bodyH = 0.085 * s; bodyD = 0.068 * s;
    b.add(roundBox(bodyW, bodyH, bodyD, 0.4), L.body, xf([0, 0, 0]), tl);
    // Grip, prism hump with the viewfinder eyepiece, dials.
    b.add(roundBox(0.034 * s, bodyH * 1.02, bodyD * 1.18, 0.6), C.charcoal, xf([bodyW * 0.42, -0.002, -0.006]), mottle(0.05, 160, 7));
    b.add(roundBox(0.05 * s, 0.034 * s, 0.05 * s, 0.4), L.top, xf([0, bodyH * 0.5 + 0.012 * s, 0.002]), tl);
    b.add(roundBox(0.03 * s, 0.022 * s, 0.014, 0.5), C.black, xf([0, bodyH * 0.5 + 0.01 * s, bodyD * 0.5 + 0.006]));
    b.add(cyl(0.012, 0.012, 0.008, 8), C.charcoal, xf([-bodyW * 0.3, bodyH * 0.5 + 0.004, 0]));
    b.add(roundBox(bodyW * 0.42, bodyH * 0.45, 0.003, 0.2), 0x1b242b, xf([-0.016, -0.008, bodyD * 0.5 + 0.001]));
    if (L.grip) b.add(roundBox(bodyW * 0.95, 0.03, bodyD, 0.5), C.charcoal, xf([0, -bodyH * 0.5 - 0.014, 0]));
    shutter = [bodyW * 0.4, bodyH * 0.5 + 0.004, -0.012];
  }
  // Shutter button.
  b.add(cyl(0.0068, 0.0075, 0.006, 8), L.style === 'compact' ? C.metal : L.ring === C.red ? C.charcoal : C.metal, xf(shutter));
  // Lens mount and fixed barrel.
  const lr = 0.031 * L.lensR * s, mountZ = -bodyD * 0.5;
  const fixedLen = 0.028 * L.lens * s;
  b.add(cyl(lr * 1.1, lr * 1.12, 0.01, 9), L.style === 'rangefinder' ? C.metal : C.steel, xf([-0.008, -0.004, mountZ - 0.004], ALONG_Z));
  b.add(cyl(lr, lr * 1.05, fixedLen, 9), L.lensColor, xf([-0.008, -0.004, mountZ - 0.008 - fixedLen / 2], ALONG_Z), topLight(0.86, 1.08, 0.02));
  b.add(cyl(lr * 1.02, lr * 1.02, 0.004, 9), L.ring, xf([-0.008, -0.004, mountZ - 0.01 - fixedLen * 0.85], ALONG_Z));
  // Strap lugs + strap.
  for (const sx of [-1, 1]) b.add(torus(0.005, 0.002, 4, 8), C.steel, xf([sx * bodyW * 0.5, bodyH * 0.3, 0], [0, 0, PI / 2]));
  strap(b, C.strap, bodyW * 0.5, bodyH * 0.3, 0.01, 0.12, 1.25);
  group.add(mesh(b.build(), mat, 'body'));

  // Extending lens: inner tube with focus ring, glass and (maybe) a hood. Pivot at its rear.
  const lb = createBuilder();
  const innerLen = 0.032 * L.lens * s;
  lb.add(cyl(lr * 0.9, lr * 0.9, innerLen, 9), L.lensColor, xf([0, 0, -innerLen / 2], ALONG_Z), topLight(0.86, 1.08, 0.02));
  lb.add(cyl(lr * 0.96, lr * 0.96, innerLen * 0.35, 9), C.charcoal, xf([0, 0, -innerLen * 0.55], ALONG_Z), mottle(0.1, 400, 2));
  if (L.hood) lb.add(cyl(lr * 1.25, lr * 0.95, 0.022 * s, 9, true), C.black, xf([0, 0, -innerLen - 0.009], ALONG_Z));
  lb.add(cyl(lr * 0.8, lr * 0.8, 0.003, 9), C.glass, xf([0, 0, -innerLen - 0.001], ALONG_Z));
  lb.add(sphere(lr * 0.22, 5, 4), C.glassHi, xf([lr * 0.3, lr * 0.3, -innerLen - 0.003], [0, 0, 0], [1, 1, 0.2]));
  const lens = mesh(lb.build(), mat, 'lens');
  lens.position.set(-0.008, -0.004, mountZ - 0.006 - fixedLen);
  group.add(lens);

  return {
    tool: 'camera', group, lens, lensBase: lens.position.z, lensTravel: innerLen * 0.9 + 0.01 * L.lens,
    shutter, twoHanded: true,
    hands: {
      // Right hand wraps the grip; the left cradles the lens from below.
      right: { pos: [bodyW * 0.5 + 0.014, -0.006, 0.03], rot: [0.0, 0.08, -0.1], grip: 0.85, finger: true },
      left: { pos: [-0.01, -lr - 0.016, mountZ + 0.035], rot: [0.0, 0.0, PI / 2], grip: 0.7 },
    },
    low: { pos: [0.06, -0.205, -0.36], rot: [0.12, 0.6, 0.05] },
    eye: { pos: [0.028, -0.04, -0.07], rot: [0, 0, 0] },
    lowRun: { pos: [0.07, -0.25, -0.33], rot: [0.0, 0.6, 0.14] },
  };
}

// ---------------------------------------------------------------------------------
// Recorder / microphones

function furBall(b, color, pos, r, stretch = [1, 1, 1]) {
  b.add(sphere(r, 7, 5), color, xf(pos, [0, 0, 0], stretch), mottle(0.1, 380, pos[1] * 100));
  // Wisps.
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05, e = (i % 3) * 0.6 - 0.6;
    b.add(sphere(r * 0.35, 4, 3), color, xf([
      pos[0] + Math.cos(a) * Math.cos(e) * r * 0.85 * stretch[0],
      pos[1] + Math.sin(e) * r * 0.85 * stretch[1],
      pos[2] + Math.sin(a) * Math.cos(e) * r * 0.85 * stretch[2],
    ]), mottle(0.2, 300, i));
  }
}

export function buildRecorder(id, def, mat, ledMats) {
  const L = audioLook(id, def);
  const s = L.size;
  const group = new THREE.Group();
  group.name = 'vm-recorder';
  const b = createBuilder();
  const tl = topLight(0.84, 1.06, 0.06);
  let ledAt, ledStep, ledDir, hands, dotAt;
  // The device's own "forward" (where the mic points) is -Z in every variant.
  if (L.kind === 'shotgun' || L.kind === 'dish') {
    // Pistol grip under a horizontal boom: a fur blimp, or a parabolic dish.
    b.add(capsule(0.017, 0.07, 2, 8), C.charcoal, xf([0, -0.05, 0.03], [0.25, 0, 0]), mottle(0.05, 200, 1));
    b.add(roundBox(0.03, 0.03, 0.12, 0.4), L.body, xf([0, 0.0, -0.01]), tl);
    // Small level box on the back (facing the player) with LEDs.
    b.add(roundBox(0.046, 0.04, 0.02, 0.4), L.face, xf([0, 0.026, 0.045]));
    ledAt = [-0.015, 0.03, 0.0556]; ledStep = [0.01, 0, 0]; ledDir = [0, 0, 0];
    dotAt = [0.016, 0.016, 0.0556];
    if (L.kind === 'shotgun') {
      b.add(capsule(0.026, 0.17, 3, 10), L.fur, xf([0, 0.03, -0.11], [PI / 2, 0, 0]), mottle(0.16, 300, 3));
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7, z = -0.2 + i * 0.022;
        b.add(sphere(0.012, 4, 3), C.fur, xf([Math.cos(a) * 0.024, 0.03 + Math.sin(a) * 0.024, z]));
      }
    } else {
      // Dish: a sphere cap with its pole just ahead of the grip, opening forwards; an
      // inner face so it reads from any angle; the mic sits at the focus facing back.
      const dr = 0.12, th = PI * 0.36, poleZ = -0.075, cz = poleZ - dr, cy = 0.03;
      b.add(bowl(dr, 0.36, 14), L.dish, xf([0, cy, cz], [PI / 2, 0, 0]), topLight(0.82, 1.05, 0.1));
      b.add(flipFaces(bowl(dr * 0.985, 0.36, 14)), 0xbdb8aa, xf([0, cy, cz], [PI / 2, 0, 0]));
      b.add(torus(dr * Math.sin(th), 0.0045, 3, 16), C.charcoal, xf([0, cy, cz + dr * Math.cos(th)]));
      b.add(cyl(0.005, 0.005, 0.06, 6), C.steel, xf([0, cy, poleZ - 0.03], ALONG_Z));
      furBall(b, L.fur, [0, cy, poleZ - 0.065], 0.014);
    }
    hands = { right: { pos: [0.004, -0.05, 0.03], rot: [0.25 + PI / 2, 0, PI / 2], grip: 0.95 } };
  } else if (L.kind === 'vintage') {
    // A wooden case with a metal face, a carrying handle and a round mic on a stalk.
    b.add(roundBox(0.09, 0.075, 0.05, 0.25), L.body, xf([0, 0, 0]), mottle(0.12, 90, 5));
    b.add(roundBox(0.08, 0.06, 0.004, 0.2), L.face, xf([0, 0, 0.026]), tl);
    for (const sx of [-1, 1]) {
      b.add(cyl(0.013, 0.013, 0.004, 8), C.charcoal, xf([sx * 0.02, 0.012, 0.029], ALONG_Z));
      b.add(cyl(0.004, 0.004, 0.006, 6), L.trim, xf([sx * 0.02, 0.012, 0.031], ALONG_Z));
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) b.add(sphere(0.006, 5, 4), L.trim, xf([sx * 0.045, sy * 0.037, 0.022]));
    b.add(torus(0.022, 0.0045, 4, 10, PI), C.leather, xf([0, 0.037, 0], [0, 0, 0]));
    // Mic on a short stalk from the top front corner, pointing forwards and a bit up.
    b.add(cyl(0.004, 0.004, 0.056, 6), C.steel, xf([0.0, 0.058, -0.04], [-0.85, 0, 0]));
    b.add(cyl(0.016, 0.019, 0.034, 9), C.metal, xf([0, 0.08, -0.068], [-(PI / 2 - 0.3), 0, 0]), topLight(0.8, 1.1, 0.02));
    b.add(cyl(0.0165, 0.0165, 0.003, 9), C.charcoal, xf([0, 0.085, -0.085], [-(PI / 2 - 0.3), 0, 0]));
    ledAt = [-0.024, -0.018, 0.029]; ledStep = [0.012, 0, 0]; ledDir = [0, 0, 0];
    dotAt = [0.03, -0.018, 0.029];
    hands = { right: { pos: [0.004, 0.066, 0.052], rot: [0.3, 0, PI / 2], grip: 0.9 } };
  } else {
    // Hand-held recorder, upright, screen and LEDs facing the player, fur mic on top.
    const w = 0.052 * s, h = 0.12 * s, d = 0.026 * s;
    b.add(roundBox(w, h, d, 0.45), L.body, xf([0, 0, 0]), tl);
    b.add(roundBox(w * 0.8, h * 0.3, 0.003, 0.2), C.glass, xf([0, h * 0.12, d * 0.5 + 0.001]));
    for (let i = 0; i < 3; i++) b.add(cyl(0.004, 0.004, 0.003, 8), L.face, xf([(i - 1) * 0.013, -h * 0.18, d * 0.5 + 0.001], ALONG_Z));
    // Mic head(s) with a fur windshield.
    if (L.twin) {
      for (const sx of [-1, 1]) b.add(cyl(0.007, 0.007, 0.03, 8), C.metal, xf([sx * 0.008, h * 0.55, -0.004], [-0.4, 0, sx * 0.5]));
      furBall(b, L.fur, [0, h * 0.5 + 0.026, -0.006], 0.028, [1.15, 0.95, 1]);
    } else {
      b.add(cyl(0.008, 0.01, 0.02, 8), C.charcoal, xf([0, h * 0.5 + 0.006, 0]));
      furBall(b, L.fur, [0, h * 0.5 + 0.024, -0.002], 0.024);
    }
    ledAt = [-w * 0.3, h * 0.36, d * 0.5 + 0.0015]; ledStep = [w * 0.2, 0, 0]; ledDir = [0, 0, 0];
    dotAt = [w * 0.32, -h * 0.34, d * 0.5 + 0.0015];
    hands = { right: { pos: [w * 0.5 + 0.022, -h * 0.16, -d * 0.5 - 0.013], rot: [0, PI / 2, 0], grip: 0.9 } };
  }
  group.add(mesh(b.build(), mat, 'body'));

  // LEDs (4 level + a record dot), each its own tiny material so it can glow.
  const leds = [];
  const ledGeo = new THREE.SphereGeometry(0.0032, 6, 4);
  ledGeo.scale(1, 1, 0.5);
  for (let i = 0; i < 4; i++) {
    const m = mesh(ledGeo, ledMats[i], 'led' + i);
    m.position.set(ledAt[0] + ledStep[0] * i, ledAt[1] + ledStep[1] * i, ledAt[2] + ledStep[2] * i);
    group.add(m); leds.push(m);
  }
  const dot = mesh(ledGeo, ledMats[4], 'recdot');
  dot.position.set(dotAt[0], dotAt[1], dotAt[2]);
  group.add(dot);

  const upright = L.kind === 'handheld';
  if (L.kind === 'vintage') {
    // Carried by its handle; held out a little when recording, mic towards the view.
    return {
      tool: 'recorder', group, leds, dot, ledGeo, hands, twoHanded: false,
      low: { pos: [0.21, -0.26, -0.38], rot: [-0.15, -0.35, 0.05] },
      eye: { pos: [0.17, -0.22, -0.43], rot: [-0.12, -0.15, 0.0] },
      lowRun: { pos: [0.23, -0.29, -0.36], rot: [-0.3, -0.4, -0.1] },
    };
  }
  return {
    tool: 'recorder', group, leds, dot, ledGeo, hands, twoHanded: false,
    // Idle: down at the right side. Recording: held forward, mic towards the view.
    low: upright
      ? { pos: [0.2, -0.235, -0.38], rot: [-0.55, -0.25, -0.15] }
      : { pos: [0.21, -0.215, -0.4], rot: [-0.25, 0.05, -0.05] },
    eye: upright
      ? { pos: [0.13, -0.135, -0.42], rot: [-1.05, -0.12, -0.05] }
      : { pos: [0.165, -0.135, -0.38], rot: [0.02, 0.06, 0] },
    lowRun: upright
      ? { pos: [0.22, -0.26, -0.36], rot: [-0.8, -0.3, -0.25] }
      : { pos: [0.22, -0.24, -0.38], rot: [-0.45, 0.1, -0.1] },
  };
}
