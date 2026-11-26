// Small props: signposts, caches (closed / opened), the collectible models that bob
// and glint (feather, journal page, relic), seed lures and the garden feeder.
// Same BuildSpec as structures.js; collectibles put their model in `item` (a Shape
// drawn around the origin) so the module can bob it without rebuilding.
import { shadeHex, mixHex, hashString } from './logic.js';
import { signpost, crate, IRON, ROPE, SNOW, LEAF } from './parts.js';

export function buildSign(b) {
  const { solid: s, rand, pal } = b;
  signpost(s, 0, 0, 0, pal.dark, pal.trim, rand, { boards: 2 + Math.floor(rand() * 2), angle: rand() * 6.28 });
  s.stone(0.3, pal.stone, { x: 0.25, y: 0.05, z: 0.2 });
  if (pal.snow) s.ball(0.16, SNOW, { x: 0, y: 2.0, z: 0, sy: 0.5, detail: 0 });
  return {
    blockers: [{ lx: 0, lz: 0, r: 0.2 }],
    interact: { lx: 0, ly: 1.4, lz: 0 },
    reach: 2,
  };
}

/** Cache look from its name: satchel, case, bundle, or a small iron-banded chest. */
export function cacheStyle(poi) {
  const n = String(poi?.name || '').toLowerCase();
  if (/satchel|bag|pack|haversack/.test(n)) return 'satchel';
  if (/case|box|tin/.test(n)) return 'case';
  if (/bundle|oilcloth|roll|wrap/.test(n)) return 'bundle';
  return 'chest';
}

/**
 * A cache in its closed or opened state (opened = profile flag taken:<id>).
 * @param {boolean} open
 */
export function buildCache(b, open) {
  const { solid: s, pal } = b;
  const style = cacheStyle(b.poi);
  const leather = 0x7a4a2c, dark = 0x4e3020, brass = 0xc9a24a;
  switch (style) {
    case 'satchel': {
      s.block(0.5, 0.36, 0.2, leather, { x: 0, y: 0, z: 0, ry: 0.3 });
      if (open) {
        s.box(0.5, 0.03, 0.3, shadeHex(leather, 0.9), { x: -0.07, y: 0.37, z: 0.23, ry: 0.3, rx: -0.3 });
        s.box(0.3, 0.02, 0.22, 0xe8dcc0, { x: 0.3, y: 0.02, z: -0.3, ry: 0.8 }); // a slipped-out paper
      } else {
        s.box(0.52, 0.2, 0.04, shadeHex(leather, 0.9), { x: 0, y: 0.28, z: -0.11, ry: 0.3 });
        s.box(0.06, 0.06, 0.03, brass, { x: 0, y: 0.2, z: -0.14, ry: 0.3 });
      }
      s.beam([-0.22, 0.3, 0], [0.1, 0.02, -0.4], 0.03, dark);
      break;
    }
    case 'case': {
      s.block(0.62, 0.22, 0.38, dark, { x: 0, y: 0, z: 0, ry: -0.2 });
      for (const dx of [-0.2, 0.2]) s.block(0.04, 0.23, 0.39, brass, { x: dx * Math.cos(0.2), y: 0, z: dx * Math.sin(0.2), ry: -0.2 });
      if (open) s.box(0.62, 0.04, 0.38, shadeHex(dark, 1.1), { x: 0, y: 0.4, z: 0.2, ry: -0.2, rx: -1.2 });
      else s.block(0.62, 0.06, 0.38, shadeHex(dark, 1.1), { x: 0, y: 0.22, z: 0, ry: -0.2 });
      s.box(0.2, 0.04, 0.04, brass, { x: 0, y: 0.3, z: -0.2, ry: -0.2 });
      break;
    }
    case 'bundle': {
      const cloth = 0x5a6a4a;
      if (open) {
        s.box(0.9, 0.03, 0.8, cloth, { x: 0, y: 0.02, z: 0, ry: 0.4 });
        s.beam([-0.4, 0.04, 0.1], [0.3, 0.04, 0.4], 0.02, ROPE);
      } else {
        s.cyl(0.18, 0.2, 0.7, cloth, { x: 0, y: 0.2, z: 0, rz: Math.PI / 2, ry: 0.4, seg: 8 });
        for (const t of [-0.2, 0.2]) s.cyl(0.205, 0.205, 0.04, ROPE, { x: t * Math.cos(0.4), y: 0.2, z: -t * Math.sin(0.4), rz: Math.PI / 2, ry: 0.4, seg: 8 });
      }
      break;
    }
    default: {
      const wood = shadeHex(pal.wood, 0.95);
      crate(s, 0, 0, 0, 0.5, wood);
      for (const dx of [-0.17, 0.17]) s.block(0.05, 0.51, 0.51, IRON, { x: dx, y: 0, z: 0 });
      if (open) s.box(0.52, 0.06, 0.52, shadeHex(wood, 1.1), { x: 0, y: 0.72, z: 0.3, rx: -1.3 });
      else s.block(0.54, 0.08, 0.54, shadeHex(wood, 1.1), { x: 0, y: 0.5, z: 0 });
      s.box(0.08, 0.1, 0.04, brass, { x: 0, y: 0.42, z: -0.27 });
    }
  }
  if (pal.snow && !open) s.ball(0.25, SNOW, { x: 0, y: 0.4, z: 0, sy: 0.25, detail: 0 });
  return { interact: { lx: 0, ly: 0.3, lz: 0 }, reach: 1.5 };
}

// Feather colours by region type: the actual species is the session's business, so
// the model only hints at the place (a woodland brown, a gull grey, a russet…).
const FEATHER_COLS = {
  greenhollow: [0x8a6a4a, 0x3e6a9a, 0xc4a070],
  murmur_marsh: [0x6a5a44, 0x9a8a6a, 0x4a6a8a],
  windpeak: [0x5a4a3a, 0x8a7a6a, 0x3a3a3a],
  whispering_coast: [0xb8bcc0, 0xe8e8e4, 0x4a4e52],
  amberwood: [0xb0602c, 0xd09040, 0x6a4a2c],
  frostveil: [0xe8ecf0, 0xa8b4c0, 0x6a7480],
};

/**
 * Collectible model around the origin (it bobs above its seat).
 * @returns {{item: import('./mesh.js').Shape, lift: number}}
 */
export function buildCollectible(b, makeShape) {
  const item = makeShape();
  const k = hashString(b.poi.id);
  switch (b.poi.kind) {
    case 'feather': {
      const cols = FEATHER_COLS[b.pal.key] || FEATHER_COLS.greenhollow;
      const c = cols[k % cols.length], tip = cols[(k >> 3) % cols.length];
      item.cyl(0.008, 0.012, 0.34, 0xf0eadc, { x: 0, y: 0, z: 0, rz: 0.25, seg: 4 });
      item.ball(0.15, c, { x: 0.02, y: 0.05, z: 0, sx: 0.32, sy: 1, sz: 0.06, rz: 0.25 });
      item.ball(0.06, mixHex(c, tip, 0.7), { x: 0.045, y: 0.16, z: 0, sx: 0.5, sy: 0.9, sz: 0.1, rz: 0.25 });
      return { item, lift: 0.4, tilt: 1.2 };
    }
    case 'page': {
      const paper = 0xeee2c6;
      item.box(0.22, 0.004, 0.3, paper, { x: -0.005, y: 0, z: 0, rz: 0.06 });
      item.box(0.2, 0.004, 0.28, shadeHex(paper, 0.96), { x: 0.03, y: 0.01, z: 0.01, rz: -0.12, ry: 0.15 });
      for (let i = 0; i < 5; i++) item.box(0.15, 0.002, 0.008, 0x6a5a4a, { x: -0.005, y: 0.004, z: -0.1 + i * 0.045 });
      item.ball(0.025, 0x8a3a2a, { x: 0.08, y: 0.008, z: 0.12, sy: 0.3, detail: 0 }); // a wax seal
      return { item, lift: 0.35, tilt: 0.9 };
    }
    default: {
      // relic: a little carved token of old bronze on a cord
      const bronze = 0xa8803a;
      item.cyl(0.09, 0.09, 0.03, bronze, { x: 0, y: 0, z: 0, rx: Math.PI / 2, seg: 8 });
      item.cyl(0.055, 0.055, 0.035, shadeHex(bronze, 0.8), { x: 0, y: 0, z: 0, rx: Math.PI / 2, seg: 6 });
      item.ball(0.025, 0x4a9a8a, { x: 0, y: 0, z: -0.02, detail: 0 });
      item.cyl(0.015, 0.015, 0.06, bronze, { x: 0, y: 0.1, z: 0, seg: 4 });
      return { item, lift: 0.45, tilt: 0 };
    }
  }
}

/** A scatter of seed on the ground with a little open sack (a placed seed lure). */
export function buildSeedLure(b) {
  const { solid: s, rand } = b;
  for (let i = 0; i < 26; i++) {
    const a = rand() * 6.28, r = Math.sqrt(rand()) * 0.55;
    s.ball(0.025, rand() < 0.5 ? 0xd8b878 : 0x8a6a3a, { x: Math.cos(a) * r, y: 0.015, z: Math.sin(a) * r, detail: 0 });
  }
  s.cyl(0.12, 0.16, 0.26, 0xc4ae82, { x: 0.65, y: 0.13, z: 0.2, seg: 7 });
  s.ball(0.11, 0xd8b878, { x: 0.65, y: 0.27, z: 0.2, sy: 0.35, detail: 0 });
  return { reach: 1 };
}

/** The observation-garden feeder: post, roofed tray, a hanging seed tube. */
export function buildFeeder(b) {
  const { solid: s, pal } = b;
  const wood = shadeHex(pal.wood, 1.05);
  s.block(0.12, 1.7, 0.12, pal.dark, { x: 0, y: -0.3, z: 0 });
  s.block(0.7, 0.05, 0.7, wood, { x: 0, y: 1.4, z: 0 });
  for (const [x, z] of [[-0.33, -0.33], [0.33, -0.33], [-0.33, 0.33], [0.33, 0.33]]) {
    s.block(0.04, 0.4, 0.04, wood, { x, y: 1.45, z });
  }
  for (const side of [-1, 1]) s.box(0.85, 0.05, 0.5, pal.roof, { x: 0, y: 1.98, z: side * 0.2, rx: side * 0.55 });
  for (let i = 0; i < 14; i++) s.ball(0.02, i % 2 ? 0xd8b878 : 0x8a6a3a, { x: (i % 5) * 0.1 - 0.2, y: 1.44, z: Math.floor(i / 5) * 0.12 - 0.12, detail: 0 });
  // hanging seed tube on an arm
  s.block(0.6, 0.05, 0.05, pal.dark, { x: 0.3, y: 1.15, z: 0 });
  s.beam([0.55, 1.15, 0], [0.55, 0.95, 0], 0.01, IRON);
  s.cyl(0.06, 0.06, 0.38, 0xa8c4d4, { x: 0.55, y: 0.75, z: 0, seg: 8 });
  s.cyl(0.07, 0.07, 0.03, 0x3e6a4a, { x: 0.55, y: 0.95, z: 0, seg: 8 });
  s.cyl(0.07, 0.07, 0.03, 0x3e6a4a, { x: 0.55, y: 0.56, z: 0, seg: 8 });
  s.ball(0.25, LEAF, { x: -0.25, y: 0.15, z: 0.2, sy: 0.7, detail: 0 });
  return { blockers: [{ lx: 0, lz: 0, r: 0.25 }], reach: 1.5 };
}
