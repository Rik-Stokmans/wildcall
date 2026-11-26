// Procedural low-poly models for every core.VegKind. Pure: no three.js, no DOM.
//
// Each model is built at scale 1 with its base at the origin (sizes follow the nominal
// sizes documented on core.Veg) in up to three levels of detail:
//   detail 2  near  (lod-0 chunks)   full shape: lobed crowns, branches, undersides
//   detail 1  mid   (lod-1 chunks)   the same silhouette and colours in ~a quarter of the triangles
//   detail 0  far   (lod-2 chunks)   a couple of dozen triangles; trees and snags only
//
// Look (spec §2.3 / §23.1): soft rounded masses, strong distinct silhouettes — a broad
// round oak, a slim airy birch with a pale trunk, a layered pine, a bare forked snag —
// and gentle top-lit colour gradients instead of textures. Crowns are clusters of
// closed lobes with crevices between them: a small bird inside a lobe is hidden, one
// in a crevice shows from the right angle, which is exactly the search the game is about.
import { VEG, VEG_INFO } from './constants.js';
import { hex, mix, scale, rng } from './color.js';
import { MeshBuilder } from './meshgen.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- palettes (sRGB hex) -----------------------------------------------------
const BARK = { low: hex(0x4f3d2d), high: hex(0x6e5843) };
const PINE_BARK = { low: hex(0x4a3527), high: hex(0x6a4a35) };
const BIRCH_BARK = { pale: hex(0xdcd7c6), mark: hex(0x3d372f), base: hex(0x8d8676) };
const DEADWOOD = { low: hex(0x6f675d), high: hex(0xa39a8d) };
const CUT_WOOD = hex(0xb99b6b);
const MOSS = hex(0x5f7d45);

const OAK_LEAF = [{ low: hex(0x2c5527), high: hex(0x5f9440) }];
const BIRCH_LEAF = [{ low: hex(0x4a7a30), high: hex(0x8bb552) }];
const AMBER_OAK_LEAF = [
  { low: hex(0x8a4317), high: hex(0xc9772a) }, // rust
  { low: hex(0xa8651c), high: hex(0xe0a23a) }, // amber
  { low: hex(0x9a3a1c), high: hex(0xd2632c) }, // russet
];
const AMBER_BIRCH_LEAF = [
  { low: hex(0xb98a22), high: hex(0xf0cf52) }, // gold
  { low: hex(0xc29a2c), high: hex(0xf3dc70) },
];
const PINE_NEEDLE = { rim: hex(0x1d4635), tip: hex(0x3f7250), under: hex(0x12301f) };
const SNOW_NEEDLE = { rim: hex(0x2a5443), tip: hex(0xf2f6fa), under: hex(0x16372a) };
const SHRUB_LEAF = { low: hex(0x2b5a30), high: hex(0x5d8f44) };
const REED = { low: hex(0x55713a), tip: hex(0xb1ac6c), head: hex(0x5b3d27) };
const ROCK = { low: hex(0x6d6b65), high: hex(0x9d9a91) };
const GRASS = { low: hex(0x44692d), tip: hex(0x93b259) };
const FERN = { low: hex(0x2a6431), tip: hex(0x66a04a) };
const STEM = hex(0x4c7737);
const PETAL = { centre: hex(0xfff0a8), rim: hex(0xffffff) };
const DRIFT = { low: hex(0xa79c8a), high: hex(0xd4cbb9) };
const SHROOM = { stem: hex(0xe9e1cd), rim: hex(0xd9d2c4), top: hex(0xffffff), gill: hex(0xcfc3a8) };
const PAD = { centre: hex(0x6aa458), rim: hex(0x3b7443), bloom: hex(0xfbeef2) };

// --- helpers -------------------------------------------------------------------
/** Trees bend from just above the root flare; the top moves the most. */
const treeSway = (height) => (x, y) => Math.pow(clamp01((y - height * 0.12) / (height * 0.88)), 1.5);
/** Low plants bend over their whole height. */
const plantSway = (height, power = 1.6) => (x, y) => Math.pow(clamp01(y / height), power);

/** Colour of a crown vertex: darker low down and inside, lighter towards the sky. */
function crownColor(pal, y0, y1, gain) {
  return (x, y, z, up) => {
    const t = clamp01((y - y0) / (y1 - y0)) * 0.75 + (up * 0.5 + 0.5) * 0.25;
    return scale(mix(pal.low, pal.high, Math.pow(t, 0.85)), gain);
  };
}

/**
 * Adds a crown made of lobes.
 * @param {MeshBuilder} b
 * @param {{c:number[], r:number[], sub?:number}[]} lobes
 * @param {{low:number[], high:number[]}[]} palettes  lobes cycle through these
 * @param {number[]} centre  point the shading is blended away from
 * @param {number} seed
 */
function crown(b, lobes, palettes, centre, seed) {
  const R = rng(seed);
  let y0 = Infinity, y1 = -Infinity;
  for (const l of lobes) {
    y0 = Math.min(y0, l.c[1] - l.r[1]);
    y1 = Math.max(y1, l.c[1] + l.r[1]);
  }
  b.season = 1;
  b.tint = 1;
  lobes.forEach((l, i) => {
    const pal = palettes[i % palettes.length];
    const gain = 0.93 + R() * 0.14;
    b.blob(l.c, l.r, l.sub || 0, crownColor(pal, y0, y1, gain), {
      lump: l.sub ? 0.07 : 0.1, seed: seed + i * 7.3, towards: centre, blend: 0.55,
    });
  });
}

/** Lobes evenly spaced on a ring, with a little irregularity. */
function ringLobes(R, count, dist, y, r, turn = 0) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const a = turn + (k + (R() - 0.5) * 0.35) / count * TAU;
    const d = dist * (0.92 + R() * 0.16);
    const s = 0.92 + R() * 0.16;
    out.push({ c: [Math.cos(a) * d, y + (R() - 0.5) * 0.5, Math.sin(a) * d], r: [r[0] * s, r[1] * s, r[2] * s] });
  }
  return out;
}

function barkPart(b) { b.season = 0; b.tint = 0.3; }

// --- trees ---------------------------------------------------------------------
function oak(detail, leaf) {
  const b = new MeshBuilder();
  const R = rng(1101);
  b.swayAt = treeSway(11);
  barkPart(b);
  const bark = (t) => mix(BARK.low, BARK.high, t);
  if (detail === 2) {
    // The trunk starts below ground so it never floats on a slope.
    b.tube([[0, -0.7, 0, 0.64], [0, 0.45, 0, 0.44], [0.06, 2.6, 0.04, 0.37], [-0.04, 4.8, 0, 0.3], [0, 6.8, 0, 0.17]], 7, bark);
    for (let k = 0; k < 3; k++) {
      const a = 0.6 + k * TAU / 3;
      const cx = Math.cos(a), cz = Math.sin(a);
      b.tube([[cx * 0.15, 4.3, cz * 0.15, 0.17], [cx * 1.5, 5.5, cz * 1.5, 0.11], [cx * 2.5, 6.3, cz * 2.5, 0.05]], 4, bark);
    }
    const lobes = [
      ...ringLobes(R, 6, 2.5, 6.3, [2.1, 1.62, 2.1]),
      ...ringLobes(R, 3, 1.35, 8.5, [1.95, 1.55, 1.95], 0.5),
      { c: [0, 7.2, 0], r: [2.25, 1.9, 2.25], sub: 1 },
      { c: [0, 9.56, 0], r: [1.75, 1.44, 1.75], sub: 1 },
    ];
    crown(b, lobes, leaf, [0, 7.0, 0], 1102);
  } else if (detail === 1) {
    b.tube([[0, -0.7, 0, 0.58], [0, 1.2, 0, 0.4], [0, 6.4, 0, 0.2]], 5, bark);
    const lobes = [
      ...ringLobes(R, 3, 1.85, 6.6, [2.75, 2.1, 2.75]),
      { c: [0, 8.85, 0], r: [2.45, 2.15, 2.45] },
    ];
    crown(b, lobes, leaf, [0, 7.0, 0], 1102);
  } else {
    b.tube([[0, -0.7, 0, 0.5], [0, 6, 0, 0.24]], 3, bark);
    crown(b, [{ c: [0, 7.6, 0], r: [4.3, 3.4, 4.3] }], leaf, [0, 7.0, 0], 1102);
  }
  return b.build();
}

function birch(detail, leaf) {
  const b = new MeshBuilder();
  b.swayAt = treeSway(10);
  barkPart(b);
  b.tint = 0.15;
  if (detail === 2) {
    // Alternating rings of pale bark and dark scars read as birch from far away.
    const marks = [0, 0, 1, 0, 0, 1, 0, 1, 0];
    const path = marks.map((m, i) => {
      const t = i / (marks.length - 1);
      const y = -0.5 + t * 9.3;
      return [Math.sin(t * 2.4) * 0.16, y, Math.sin(t * 1.7 + 1) * 0.07, 0.21 - t * 0.17];
    });
    b.tube(path, 6, (t) => {
      const i = Math.round(t * (marks.length - 1));
      return i === 0 ? BIRCH_BARK.base : marks[i] ? BIRCH_BARK.mark : BIRCH_BARK.pale;
    });
    const lobes = [
      { c: [1.0, 4.9, 0.1], r: [1.3, 1.2, 1.3] },
      { c: [-0.85, 5.7, 0.72], r: [1.35, 1.2, 1.35] },
      { c: [-0.3, 6.5, -0.9], r: [1.3, 1.25, 1.3] },
      { c: [0.65, 7.4, 0.5], r: [1.3, 1.25, 1.3] },
      { c: [-0.55, 8.2, 0.05], r: [1.2, 1.2, 1.2] },
      { c: [0.1, 9.0, 0], r: [1.0, 1.0, 1.0] },
    ];
    crown(b, lobes, leaf, [0, 7.0, 0], 1202);
  } else if (detail === 1) {
    b.tube([[0, -0.5, 0, 0.2], [0.12, 4.2, 0.04, 0.13], [0.1, 8.6, 0, 0.05]], 4, (t) => (t < 0.25 ? BIRCH_BARK.base : BIRCH_BARK.pale));
    crown(b, [{ c: [0.1, 6.0, 0.1], r: [2.0, 1.95, 2.0] }, { c: [-0.05, 8.3, 0], r: [1.5, 1.7, 1.5] }], leaf, [0, 7.0, 0], 1202);
  } else {
    b.tube([[0, -0.5, 0, 0.2], [0.1, 7, 0, 0.09]], 3, () => BIRCH_BARK.pale);
    crown(b, [{ c: [0, 7.2, 0], r: [2.05, 2.8, 2.05] }], leaf, [0, 7.0, 0], 1202);
  }
  return b.build();
}

function pine(detail, needle) {
  const b = new MeshBuilder();
  b.swayAt = treeSway(14);
  barkPart(b);
  const bark = (t) => mix(PINE_BARK.low, PINE_BARK.high, t);
  // [rim height, rim radius, tier height]; the last apex is the tree top at 14 m.
  let tiers, sides, ragged, droop;
  if (detail === 2) {
    b.tube([[0, -0.6, 0, 0.44], [0, 1, 0, 0.3], [0, 7, 0, 0.2], [0, 12.5, 0, 0.06]], 6, bark);
    tiers = [[3.4, 2.9, 3.4], [5.6, 2.5, 3.2], [7.7, 2.05, 3.0], [9.6, 1.55, 2.8], [11.3, 1.05, 2.7]];
    sides = 8; ragged = 0.24; droop = 0.4;
  } else if (detail === 1) {
    b.tube([[0, -0.6, 0, 0.4], [0, 8, 0, 0.16]], 4, bark);
    tiers = [[3.6, 2.9, 4.6], [6.9, 2.2, 4.0], [10.0, 1.4, 4.0]];
    sides = 6; ragged = 0.2; droop = 0.4;
  } else {
    b.tube([[0, -0.6, 0, 0.36], [0, 5, 0, 0.2]], 3, bark);
    tiers = [[3.8, 2.8, 6.0], [8.2, 1.8, 5.8]];
    sides = 5; ragged = 0; droop = 0;
  }
  b.season = 1;
  b.tint = 1;
  tiers.forEach(([y, r, h], i) => {
    const shade = 0.88 + i * 0.05; // higher tiers catch more light
    // Only the near model needs undersides: from afar nobody looks up into a pine.
    const under = detail === 2 || (detail === 1 && i === 0) ? needle.under : null;
    b.cone([0, y, 0], r, h, sides, scale(needle.rim, shade), scale(needle.tip, shade), { ragged, droop, under, turn: i * 0.7 });
  });
  return b.build();
}

function snag(detail) {
  const b = new MeshBuilder();
  b.swayAt = treeSway(8);
  b.season = 0;
  b.tint = 0.5;
  const wood = (t) => mix(DEADWOOD.low, DEADWOOD.high, t);
  const limb = (y, heading, reach, rise, r, sides) => {
    const cx = Math.sin(heading), cz = -Math.cos(heading);
    b.tube([
      [cx * 0.1, y, cz * 0.1, r],
      [cx * reach * 0.6, y + rise * 0.35, cz * reach * 0.6, r * 0.6],
      [cx * reach, y + rise, cz * reach, r * 0.2],
    ], sides, (t) => mix(DEADWOOD.low, DEADWOOD.high, 0.4 + t * 0.6));
  };
  if (detail === 2) {
    b.tube([[0, -0.5, 0, 0.42], [0.05, 1.5, 0, 0.3], [0.18, 4, 0.06, 0.24], [0.1, 6.2, 0, 0.17], [0.2, 8, 0.05, 0.07]], 6, wood, { capEnd: DEADWOOD.high });
    limb(3.4, 0.4, 1.9, 1.5, 0.12, 4);
    limb(4.6, 2.6, 1.6, 1.7, 0.1, 4);
    limb(5.7, 4.5, 1.3, 1.2, 0.08, 4);
    limb(6.6, 1.3, 1.0, 1.1, 0.06, 3);
  } else if (detail === 1) {
    b.tube([[0, -0.5, 0, 0.4], [0.15, 4, 0.05, 0.24], [0.2, 8, 0.05, 0.07]], 4, wood);
    limb(3.4, 0.4, 1.9, 1.5, 0.12, 3);
    limb(4.6, 2.6, 1.6, 1.7, 0.1, 3);
  } else {
    b.tube([[0, -0.5, 0, 0.36], [0.2, 8, 0.05, 0.08]], 3, wood);
    limb(3.8, 0.4, 1.8, 1.6, 0.12, 3);
  }
  return b.build();
}

// --- shrubs, reeds, rocks ------------------------------------------------------
function shrub(detail) {
  const b = new MeshBuilder();
  const R = rng(1401);
  b.swayAt = plantSway(1.6, 1.3);
  const lobes = detail === 2
    ? [
      { c: [0, 0.72, 0], r: [0.82, 0.78, 0.82] },
      ...ringLobes(R, 4, 0.56, 0.62, [0.6, 0.55, 0.6]),
      { c: [0.08, 1.1, -0.05], r: [0.55, 0.5, 0.55] },
    ]
    : [{ c: [0, 0.62, 0], r: [1.1, 0.75, 1.1] }, { c: [0.08, 1.05, -0.05], r: [0.7, 0.55, 0.7] }];
  crown(b, lobes, [SHRUB_LEAF], [0, 0.3, 0], 1402);
  return b.build();
}

function reeds(detail) {
  const b = new MeshBuilder();
  const R = rng(1501);
  b.swayAt = plantSway(2, 2);
  b.season = 1;
  b.tint = 1;
  const count = detail === 2 ? 18 : 7;
  for (let i = 0; i < count; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * 0.45;
    const h = 1.25 + R() * 0.75;
    // Blades start under the surface: reeds usually stand in water.
    const base = [Math.cos(a) * d, -0.35, Math.sin(a) * d];
    const width = detail === 2 ? 0.08 + R() * 0.05 : 0.17;
    b.blade(base, R() * TAU, h + 0.35, width, 0.12 + R() * 0.4, detail === 2 && i % 3 === 0 ? 2 : 1, REED.low, REED.tip);
  }
  if (detail === 2) {
    b.season = 0;
    b.tint = 0.3;
    for (let i = 0; i < 3; i++) { // cattail heads
      const a = i * 2.1 + 0.4, d = 0.12 + i * 0.07;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const top = 1.62 + i * 0.14;
      b.blade([x, -0.35, z], a, top + 0.2, 0.03, 0.05, 1, REED.low, REED.tip);
      b.tube([[x, top - 0.34, z, 0.012], [x, top - 0.3, z, 0.04], [x, top - 0.04, z, 0.04], [x, top, z, 0.012]], 4, () => REED.head);
    }
  }
  return b.build();
}

function rock(detail) {
  const b = new MeshBuilder();
  b.season = 0;
  b.tint = 1;
  b.blob([0, 0.3, 0], [0.6, 0.64, 0.52], detail === 2 ? 1 : 0, (x, y, z, up) => {
    // Facets differ a little in tone; upward faces weather lighter and gather moss.
    const tone = 0.92 + (Math.sin(x * 37.1 + y * 17.3 + z * 29.7) * 0.5 + 0.5) * 0.16;
    const lit = mix(ROCK.low, ROCK.high, clamp01(up * 0.5 + 0.5));
    return scale(up > 0.55 ? mix(lit, MOSS, 0.22) : lit, tone);
  }, { lump: 0.17, seed: 1601, flat: true, floor: -0.15 });
  return b.build();
}

// --- ground decoration -----------------------------------------------------------
function flowers() {
  const b = new MeshBuilder();
  const R = rng(1701);
  b.swayAt = plantSway(0.45, 1);
  for (let i = 0; i < 7; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * 0.42;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 0.24 + R() * 0.2;
    const heading = R() * TAU;
    const lean = 0.03 + R() * 0.06;
    b.season = 1;
    b.tint = 0;
    b.blade([x, -0.03, z], heading, h + 0.03, 0.022, lean, 0, STEM, STEM);
    // The head sits on the tip of its stem; the instance colour paints the petals.
    b.season = 0;
    b.tint = 1;
    b.disc([x + Math.sin(heading) * lean, h, z - Math.cos(heading) * lean], 0.055 + R() * 0.02, 5, PETAL.centre, PETAL.rim, { cup: 0.02, turn: R() * TAU, twoSided: true });
  }
  b.season = 1;
  b.tint = 0.6;
  for (let i = 0; i < 4; i++) b.blade([(R() - 0.5) * 0.5, -0.03, (R() - 0.5) * 0.5], R() * TAU, 0.16 + R() * 0.1, 0.06, 0.1, 0, GRASS.low, GRASS.tip);
  return b.build();
}

function grassTuft() {
  const b = new MeshBuilder();
  const R = rng(1801);
  b.swayAt = plantSway(0.7, 1.8);
  b.season = 1;
  b.tint = 1;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + R() * 0.5, d = R() * 0.12;
    b.blade([Math.cos(a) * d, -0.04, Math.sin(a) * d], a + (R() - 0.5), 0.36 + R() * 0.38, 0.05 + R() * 0.02, 0.1 + R() * 0.22, 1, GRASS.low, GRASS.tip);
  }
  return b.build();
}

function log() {
  const b = new MeshBuilder();
  b.season = 0;
  b.tint = 0.4;
  const bark = (t) => mix(BARK.low, BARK.high, 0.3 + 0.5 * Math.sin(t * Math.PI));
  b.tube([[-1.3, 0.2, 0, 0.26], [-0.4, 0.23, 0.03, 0.26], [0.5, 0.21, 0, 0.24], [1.3, 0.18, -0.03, 0.22]], 7, bark, { capStart: CUT_WOOD, capEnd: CUT_WOOD });
  b.tube([[0.3, 0.32, 0.1, 0.07], [0.42, 0.5, 0.3, 0.05], [0.5, 0.62, 0.44, 0.035]], 4, bark, { capEnd: CUT_WOOD });
  // A cushion of moss along the top.
  b.season = 1;
  b.tint = 0.6;
  b.blob([-0.45, 0.42, 0.02], [0.55, 0.09, 0.2], 0, (x, y, z, up) => scale(MOSS, 0.85 + up * 0.2), { lump: 0.12, seed: 1901 });
  return b.build();
}

function stump() {
  const b = new MeshBuilder();
  b.season = 0;
  b.tint = 0.4;
  b.tube([[0, -0.3, 0, 0.54], [0, 0.08, 0, 0.42], [0.01, 0.6, 0, 0.36]], 8, (t) => mix(BARK.low, BARK.high, t), { capEnd: CUT_WOOD });
  b.season = 1;
  b.tint = 0.6;
  b.blob([0.26, 0.06, 0.2], [0.24, 0.1, 0.2], 0, (x, y, z, up) => scale(MOSS, 0.85 + up * 0.2), { lump: 0.1, seed: 2001 });
  return b.build();
}

function fern() {
  const b = new MeshBuilder();
  const R = rng(2101);
  b.swayAt = plantSway(0.75, 1.4);
  b.season = 1;
  b.tint = 1;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + (R() - 0.5) * 0.4;
    // Fronds rise, arch outwards and droop at the tip.
    b.blade([Math.sin(a) * 0.04, -0.03, -Math.cos(a) * 0.04], a, 0.5 + R() * 0.3, 0.2 + R() * 0.06, 0.5 + R() * 0.25, 3, FERN.low, FERN.tip, { belly: 0.45, arch: 0.2 + R() * 0.12 });
  }
  return b.build();
}

function driftwood() {
  const b = new MeshBuilder();
  b.season = 0;
  b.tint = 0.4;
  const wood = (t) => mix(DRIFT.low, DRIFT.high, 0.3 + t * 0.7);
  b.tube([[-1.1, 0.1, 0.1, 0.13], [-0.3, 0.19, 0, 0.15], [0.5, 0.16, -0.1, 0.12], [1.2, 0.3, 0.05, 0.045]], 5, wood, { capStart: DRIFT.high });
  b.tube([[0.15, 0.2, -0.02, 0.08], [0.5, 0.42, 0.25, 0.05], [0.75, 0.6, 0.42, 0.02]], 4, wood);
  b.tube([[-0.5, 0.2, 0.02, 0.06], [-0.75, 0.4, -0.22, 0.02]], 3, wood);
  return b.build();
}

function mushroom() {
  const b = new MeshBuilder();
  const spots = [[0, 0, 0.2, 0.1], [0.11, 0.06, 0.13, 0.07], [-0.07, 0.1, 0.1, 0.06]]; // x, z, height, cap radius
  for (const [x, z, h, r] of spots) {
    b.season = 0;
    b.tint = 0;
    b.tube([[x, -0.03, z, r * 0.3], [x, h, z, r * 0.24]], 5, () => SHROOM.stem);
    b.tint = 1; // the instance colour paints the cap
    b.dome([x, h - 0.005, z], r, r * 0.7, 6, SHROOM.rim, SHROOM.top, SHROOM.gill);
  }
  return b.build();
}

function lilyPads() {
  const b = new MeshBuilder();
  const R = rng(2301);
  b.season = 1;
  b.tint = 0.7;
  const pads = [[0, 0, 0.3], [0.52, 0.2, 0.24], [-0.4, 0.42, 0.26], [0.18, -0.55, 0.2], [-0.5, -0.32, 0.17]];
  pads.forEach(([x, z, r], i) => {
    // Slightly different heights stop overlapping pads from z-fighting.
    b.disc([x, i * 0.004, z], r, 9, PAD.centre, PAD.rim, { notch: 1, turn: R() * TAU });
  });
  b.season = 0;
  b.tint = 0;
  b.disc([0.5, 0.05, 0.22], 0.085, 6, PETAL.centre, PAD.bloom, { cup: 0.05, twoSided: true });
  return b.build();
}

// --- registry --------------------------------------------------------------------
const BUILDERS = [];
BUILDERS[VEG.OAK] = (d) => oak(d, OAK_LEAF);
BUILDERS[VEG.BIRCH] = (d) => birch(d, BIRCH_LEAF);
BUILDERS[VEG.PINE] = (d) => pine(d, PINE_NEEDLE);
BUILDERS[VEG.SNAG] = snag;
BUILDERS[VEG.SHRUB] = shrub;
BUILDERS[VEG.REEDS] = reeds;
BUILDERS[VEG.ROCK] = rock;
BUILDERS[VEG.FLOWERS] = flowers;
BUILDERS[VEG.GRASS_TUFT] = grassTuft;
BUILDERS[VEG.LOG] = log;
BUILDERS[VEG.STUMP] = stump;
BUILDERS[VEG.FERN] = fern;
BUILDERS[VEG.DRIFTWOOD] = driftwood;
BUILDERS[VEG.AMBER_OAK] = (d) => oak(d, AMBER_OAK_LEAF);
BUILDERS[VEG.AMBER_BIRCH] = (d) => birch(d, AMBER_BIRCH_LEAF);
BUILDERS[VEG.SNOW_PINE] = (d) => pine(d, SNOW_NEEDLE);
BUILDERS[VEG.MUSHROOM] = mushroom;
BUILDERS[VEG.LILY_PADS] = lilyPads;

/** Model detail used for a vegetation kind in a chunk of the given LOD. */
export function detailForLod(kind, lod) {
  // A kind is never drawn coarser than the coarsest LOD that still carries it.
  return 2 - Math.min(lod, VEG_INFO[kind].maxLod);
}

const cache = new Map();

/**
 * Builds (and caches) the model of a vegetation kind.
 * @param {number} kind    core.VegKind, 0..17
 * @param {number} detail  2 = near, 1 = mid, 0 = far
 * @returns {{position:Float32Array, normal:Float32Array, color:Float32Array, veg:Float32Array,
 *   index:Uint16Array|Uint32Array, vertexCount:number, triangleCount:number, minY:number, maxY:number, radius:number}}
 */
export function buildVegModel(kind, detail) {
  const build = BUILDERS[kind];
  if (!build) throw new Error(`vegetation: unknown kind ${kind}`);
  const d = Math.max(2 - VEG_INFO[kind].maxLod, Math.min(2, detail | 0));
  const key = kind * 4 + d;
  let model = cache.get(key);
  if (!model) cache.set(key, (model = build(d)));
  return model;
}
