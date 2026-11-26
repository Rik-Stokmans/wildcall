// Seasonal foliage colours. Pure: no three.js, no DOM.
//
// The vegetation models carry their deep-summer colours. For the other seasons the
// foliage shader blends each leaf vertex towards a seasonal colour — one of two per
// class, mixed per plant, so an autumn wood is a patchwork of gold and rust rather
// than one flat orange. Amberwood's trees and Frostveil's snow pines have no class:
// they look the same all year (that is what makes those regions what they are).
import { hex } from './color.js';

/** core.Season */
export const SEASON = Object.freeze({ SPRING: 0, SUMMER: 1, AUTUMN: 2, WINTER: 3 });

// [spring, summer, autumn, winter]; a/b are the two colours plants vary between
// (sRGB hex), amt is how far foliage moves towards them.
const TABLE = {
  broadleaf: [
    { a: 0x7dbb48, b: 0x93c558, amt: 0.5 },
    { a: 0x3d7a34, b: 0x3d7a34, amt: 0 },
    { a: 0xdba534, b: 0xbd5c29, amt: 0.82 },
    { a: 0x7d7358, b: 0x69694f, amt: 0.75 },
  ],
  evergreen: [
    { a: 0x4f8f5a, b: 0x4f8f5a, amt: 0.18 },
    { a: 0x2f5f44, b: 0x2f5f44, amt: 0 },
    { a: 0x49694a, b: 0x49694a, amt: 0.1 },
    { a: 0x3e5d52, b: 0x3e5d52, amt: 0.28 },
  ],
  shrub: [
    { a: 0x74b24a, b: 0x86bb55, amt: 0.45 },
    { a: 0x3f7a3a, b: 0x3f7a3a, amt: 0 },
    { a: 0xb98a35, b: 0x9a562c, amt: 0.65 },
    { a: 0x70684f, b: 0x5f6048, amt: 0.65 },
  ],
  grass: [
    { a: 0x86c04a, b: 0x94c653, amt: 0.4 },
    { a: 0x5d8a3a, b: 0x5d8a3a, amt: 0 },
    { a: 0xc2b060, b: 0xa99a50, amt: 0.55 },
    { a: 0xa59d74, b: 0x8f8a66, amt: 0.7 },
  ],
  herb: [
    { a: 0x6fb44c, b: 0x7fbe55, amt: 0.4 },
    { a: 0x3f7f3c, b: 0x3f7f3c, amt: 0 },
    { a: 0xb39a45, b: 0x8f6a35, amt: 0.6 },
    { a: 0x8a7a55, b: 0x756a4c, amt: 0.7 },
  ],
  reed: [
    { a: 0x7fae52, b: 0x8cb85a, amt: 0.35 },
    { a: 0x6f8a45, b: 0x6f8a45, amt: 0 },
    { a: 0xc9b06a, b: 0xb89655, amt: 0.6 },
    { a: 0xcdbb86, b: 0xb5a070, amt: 0.8 },
  ],
  pad: [
    { a: 0x6fb05a, b: 0x6fb05a, amt: 0.2 },
    { a: 0x4f8a4c, b: 0x4f8a4c, amt: 0 },
    { a: 0x8f9a4a, b: 0x8f9a4a, amt: 0.35 },
    { a: 0x6f7550, b: 0x6f7550, amt: 0.6 },
  ],
};

const NONE = Object.freeze({ a: [0, 0, 0], b: [0, 0, 0], amt: 0 });
const LINEAR = {};
for (const [cls, rows] of Object.entries(TABLE)) {
  LINEAR[cls] = rows.map((r) => Object.freeze({ a: hex(r.a), b: hex(r.b), amt: r.amt }));
}

/**
 * Seasonal tint of a foliage class.
 * @param {string} cls     VEG_INFO[kind].season ('' = never tinted)
 * @param {number} season  core.Season, 0..3
 * @returns {{a:number[], b:number[], amt:number}} linear RGB colours and blend amount
 */
export function seasonTint(cls, season) {
  const rows = LINEAR[cls];
  if (!rows) return NONE;
  return rows[((season | 0) % 4 + 4) % 4];
}

/**
 * Eases the live tint values towards a target so a change of season washes over the
 * land instead of popping.
 * @param {{a:number[], b:number[], amt:number}} cur  mutated
 * @param {{a:number[], b:number[], amt:number}} target
 * @param {number} k  0..1 fraction of the remaining distance to cover
 */
export function easeTint(cur, target, k) {
  // While nothing is tinted the colour is invisible, so jump straight to the new one;
  // otherwise spring would briefly flash through whatever colour was left behind.
  const snap = cur.amt < 0.01;
  for (let i = 0; i < 3; i++) {
    cur.a[i] = snap ? target.a[i] : cur.a[i] + (target.a[i] - cur.a[i]) * k;
    cur.b[i] = snap ? target.b[i] : cur.b[i] + (target.b[i] - cur.b[i]) * k;
  }
  cur.amt += (target.amt - cur.amt) * k;
  if (Math.abs(target.amt - cur.amt) < 0.001) cur.amt = target.amt;
  return cur;
}
