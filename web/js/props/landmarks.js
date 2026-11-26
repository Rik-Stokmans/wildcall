// Landmark dressings, chosen by landmarkStyle() (logic.js): the home valley's timber
// arch, Old Oak roots, stepping stones, fern hollow and meadow flowers, and the
// generated kinds — giant tree, standing stones, sea arch, lighthouse, boardwalk,
// cairn, frozen falls and waterfall rocks. Same BuildSpec as structures.js.
import { boardwalkLayout, landmarkStyle, shadeHex, mixHex } from './logic.js';
import {
  railing, lantern, signpost, reedClump, fern, cairn,
  IRON, MOSS, MOSS_DARK, SNOW, ICE, LEAF,
} from './parts.js';

const CANOPY = {
  greenhollow: [0x5f8f3a, 0x6e9e44, 0x4f7f32],
  murmur_marsh: [0x6a8f42, 0x789a4c, 0x5a7f38],
  windpeak: [0x4f7a46, 0x5a8650, 0x46703e],
  whispering_coast: [0x6a8a4a, 0x7a9658, 0x5c7a42],
  amberwood: [0xe0a33a, 0xc9682c, 0xd88a34],
  frostveil: [0x4a6a5a, 0x56766a, 0x3e5e50],
};

export function buildLandmark(b) {
  const style = landmarkStyle(b.poi);
  const fn = STYLES[style] || STYLES.standing_stones;
  const spec = fn(b) || {};
  spec.style = style;
  return spec;
}

const STYLES = {
  // Woodland Entrance: a timber arch over the trail with a carved board.
  arch(b) {
    const { solid: s, rand, pal } = b;
    const span = 3.6, h = 3.6;
    const wood = shadeHex(pal.wood, pal.shade);
    for (const sx of [-1, 1]) {
      const x = sx * span / 2;
      s.cyl(0.2, 0.26, h + 0.8, wood, { x, y: (h + 0.8) / 2 - 0.8 + b.ground(x, 0), z: 0, seg: 8 });
      s.stone(0.45, pal.stone, { x: x + sx * 0.2, y: b.ground(x, 0) + 0.15, z: 0.3 });
      s.beam([x, h - 1.2, 0], [x - sx * 0.9, h - 0.1, 0], 0.14, shadeHex(wood, 0.92)); // knee brace
    }
    s.cyl(0.22, 0.22, span + 1.2, wood, { x: 0, y: h, z: 0, rz: Math.PI / 2, seg: 8 });
    s.cyl(0.17, 0.17, span + 0.8, shadeHex(wood, 0.9), { x: 0, y: h + 0.4, z: 0, rz: Math.PI / 2, seg: 8 });
    s.block(2.2, 0.55, 0.1, pal.trim, { x: 0, y: h - 0.75, z: -0.05 });
    s.block(2.35, 0.08, 0.14, pal.dark, { x: 0, y: h - 0.22, z: -0.05 });
    for (const dx of [-0.6, 0.6]) s.beam([dx, h - 0.2, -0.05], [dx, h, -0.05], 0.03, IRON);
    // carved leaf and bird emblems in the board
    s.ball(0.14, 0x4f7a3a, { x: -0.6, y: h - 0.48, z: -0.12, sz: 0.25, detail: 0 });
    s.ball(0.12, 0x8a5a3a, { x: 0.6, y: h - 0.48, z: -0.12, sz: 0.25, detail: 0 });
    // ivy and moss along the beam, lanterns either side
    for (let i = 0; i < 9; i++) s.ball(0.16 + rand() * 0.12, rand() < 0.5 ? MOSS : LEAF, { x: -span / 2 - 0.3 + rand() * (span + 0.6), y: h + 0.2, z: (rand() - 0.5) * 0.3, sy: 0.6, detail: 0 });
    lantern(s, b.glow, -span / 2 + 0.35, h - 0.55, -0.32, 0.14);
    s.beam([-span / 2 + 0.35, h - 0.1, -0.32], [-span / 2 + 0.35, h - 0.42, -0.32], 0.015, IRON);
    return { blockers: [{ lx: -span / 2, lz: 0, r: 0.35 }, { lx: span / 2, lz: 0, r: 0.35 }], reach: 4 };
  },

  // The Old Oak itself is world vegetation; this dresses its clearing: buttress roots,
  // mossy stones, a fairy ring of mushrooms and a little carved plaque.
  old_oak(b) {
    const { solid: s, rand, pal } = b;
    const roots = 7;
    for (let i = 0; i < roots; i++) {
      const a = (i / roots) * 6.283 + rand() * 0.4;
      const L = 2.6 + rand() * 1.8;
      const x0 = Math.cos(a) * 1.1, z0 = Math.sin(a) * 1.1;
      const x1 = Math.cos(a) * (1.1 + L), z1 = Math.sin(a) * (1.1 + L);
      s.pole([x0, b.ground(x0, z0) + 0.55, z0], [x1, b.ground(x1, z1) - 0.15, z1], 0.32, shadeHex(0x5e4a36, 0.95 + rand() * 0.1), { taper: 0.35, seg: 6 });
    }
    for (let i = 0; i < 6; i++) {
      const a = rand() * 6.28, r = 5 + rand() * 3;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      s.stone(0.35 + rand() * 0.3, pal.stone, { x, y: b.ground(x, z) + 0.1, z });
      s.ball(0.3, MOSS, { x, y: b.ground(x, z) + 0.35, z, sy: 0.4, detail: 0 });
    }
    const ring = 11, rr = 4.2;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * 6.283;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const y = b.ground(x, z);
      s.cyl(0.03, 0.04, 0.14, 0xf0e6d0, { x, y: y + 0.07, z, seg: 5 });
      s.ball(0.09, i % 3 ? 0xc0603a : 0xd8b070, { x, y: y + 0.16, z, sy: 0.5, detail: 0 });
    }
    const px = 2.4, pz = -3.0;
    s.block(0.1, 0.9, 0.1, pal.dark, { x: px, y: b.ground(px, pz) - 0.2, z: pz });
    s.box(0.6, 0.35, 0.05, pal.trim, { x: px, y: b.ground(px, pz) + 0.75, z: pz - 0.06, rx: -0.4 });
    return { reach: 9 };
  },

  // A generated giant: massive flared trunk and a towering soft crown.
  giant_tree(b) {
    const { solid: s, rand, pal } = b;
    const leaves = CANOPY[pal.key] || CANOPY.greenhollow;
    const H = 14 + rand() * 5, R = 1.4 + rand() * 0.5;
    const bark = pal.key === 'frostveil' ? 0x5a4c42 : 0x5e4a36;
    s.cyl(R * 0.55, R, H * 0.6, bark, { x: 0, y: H * 0.3 - 0.5, z: 0, seg: 9 });
    s.cyl(R * 0.35, R * 0.55, H * 0.3, shadeHex(bark, 1.05), { x: 0, y: H * 0.75 - 0.5, z: 0, seg: 8 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.283 + rand() * 0.5;
      const x1 = Math.cos(a) * (R + 1.8 + rand()), z1 = Math.sin(a) * (R + 1.8 + rand());
      s.pole([Math.cos(a) * R * 0.6, 1.6, Math.sin(a) * R * 0.6], [x1, b.ground(x1, z1) - 0.2, z1], 0.5, shadeHex(bark, 0.95), { taper: 0.3, seg: 6 });
    }
    // big limbs carrying the crown
    const puffs = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.283 + rand();
      const y0 = H * (0.45 + rand() * 0.2);
      const ex = Math.cos(a) * (4 + rand() * 2), ez = Math.sin(a) * (4 + rand() * 2), ey = y0 + 3 + rand() * 2;
      s.pole([0, y0, 0], [ex, ey, ez], 0.45, bark, { taper: 0.45, seg: 6 });
      puffs.push([ex, ey + 1.5, ez]);
    }
    puffs.push([0, H + 1, 0]);
    for (const [x, y, z] of puffs) {
      for (let k = 0; k < 4; k++) {
        s.ball(3.0 + rand() * 1.8, leaves[Math.floor(rand() * leaves.length)], {
          x: x + (rand() - 0.5) * 3, y: y + (rand() - 0.3) * 2, z: z + (rand() - 0.5) * 3, sy: 0.8,
        });
      }
      if (pal.snow) s.ball(2.6, SNOW, { x, y: y + 2.2, z, sy: 0.35 });
    }
    for (let i = 0; i < 5; i++) {
      const a = rand() * 6.28;
      s.ball(0.5, MOSS_DARK, { x: Math.cos(a) * R * 0.9, y: 0.8 + rand() * 3, z: Math.sin(a) * R * 0.9, sy: 0.5, detail: 0 });
    }
    return { blockers: [{ lx: 0, lz: 0, r: R + 0.3 }], reach: 10 };
  },

  // Creekside: flat stones across the ford (local −Z towards the far bank) and a marker.
  stepping_stones(b) {
    const { solid: s, rand, pal } = b;
    for (let i = 0; i < 7; i++) {
      const z = -1.5 - i * 1.05, x = (rand() - 0.5) * 0.6;
      const top = Math.max(b.ground(x, z), -b.base) + 0.14;
      s.stone(0.42 + rand() * 0.1, shadeHex(pal.stone, 0.95 + rand() * 0.1), { x, y: top - 0.08, z, flat: 0.45 });
    }
    signpost(s, 1.3, b.ground(1.3, 0.8), 0.8, pal.dark, pal.trim, rand, { boards: 2, angle: Math.PI / 2 });
    for (let i = 0; i < 4; i++) reedClump(s, (rand() - 0.5) * 6, b.ground(0, -2), -2 - rand() * 4, rand, { h: 1.1, n: 4 });
    return { blockers: [{ lx: 1.3, lz: 0.8, r: 0.25 }], reach: 9 };
  },

  // Fern Valley: lush fern clusters and a mossy log.
  ferns(b) {
    const { solid: s, rand, pal } = b;
    for (let i = 0; i < 14; i++) {
      const a = rand() * 6.28, r = rand() * 9;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      fern(s, x, b.ground(x, z), z, 0.9 + rand() * 0.6, rand, rand() < 0.5 ? 0x4f8a36 : 0x5f9a3e);
    }
    s.cyl(0.32, 0.36, 4.5, shadeHex(pal.wood, 0.85), { x: 1.5, y: b.ground(1.5, 1) + 0.3, z: 1, rz: Math.PI / 2, ry: 0.6, seg: 8 });
    for (let i = 0; i < 4; i++) s.ball(0.32, MOSS, { x: 1.5 + (i - 1.5) * 0.9 * Math.cos(0.6), y: b.ground(1.5, 1) + 0.6, z: 1 - (i - 1.5) * 0.9 * Math.sin(0.6), sy: 0.45, detail: 0 });
    return { reach: 10 };
  },

  // Meadow Clearing: drifts of wildflowers and a sun-warmed stone.
  flowers(b) {
    const { solid: s, rand, pal } = b;
    const cols = [0xf2c94c, 0xe86a7a, 0xf4f0e8, 0xb07ad6, 0x6aa0e0];
    for (let p = 0; p < 9; p++) {
      const a = rand() * 6.28, r = 3 + rand() * 18;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const col = cols[Math.floor(rand() * cols.length)];
      for (let i = 0; i < 9; i++) {
        const x = cx + (rand() - 0.5) * 2.5, z = cz + (rand() - 0.5) * 2.5;
        const y = b.ground(x, z);
        const hh = 0.25 + rand() * 0.25;
        s.cyl(0.015, 0.015, hh, LEAF, { x, y: y + hh / 2, z, seg: 3 });
        s.ball(0.07, col, { x, y: y + hh, z, sy: 0.6, detail: 0 });
      }
    }
    s.stone(0.9, pal.stone, { x: 0, y: b.ground(0, 0) + 0.25, z: 0, flat: 0.55 });
    return { blockers: [{ lx: 0, lz: 0, r: 0.8 }], reach: 22 };
  },

  // A ring of weathered standing stones with lichen, one fallen.
  standing_stones(b) {
    const { solid: s, rand, pal } = b;
    const n = 5 + Math.floor(rand() * 5), R = 4 + rand() * 2.5;
    const stone = mixHex(pal.stone, 0x8a8a80, 0.3);
    const blockers = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283 + rand() * 0.2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const y = b.ground(x, z);
      const h = 1.8 + rand() * 1.6;
      if (i === 0) {
        s.box(0.9, 0.6, h, shadeHex(stone, 0.95), { x, y: y + 0.25, z, ry: a + 0.3, rx: 0.08 });
        continue;
      }
      s.box(0.9 + rand() * 0.3, h, 0.55, shadeHex(stone, 0.9 + rand() * 0.15), { x, y: y + h / 2 - 0.3, z, ry: -a + Math.PI / 2, rz: (rand() - 0.5) * 0.15 });
      s.box(0.5, 0.2, 0.35, MOSS_DARK, { x, y: y + h - 0.32, z, ry: -a + Math.PI / 2, sx: 1.2 });
      if (pal.snow) s.box(0.9, 0.12, 0.55, SNOW, { x, y: y + h - 0.25, z, ry: -a + Math.PI / 2 });
      blockers.push({ lx: x, lz: z, r: 0.5 });
    }
    s.box(1.6, 0.35, 1.0, shadeHex(stone, 0.85), { x: 0, y: b.ground(0, 0) + 0.1, z: 0, ry: rand() * 3 });
    return { blockers, reach: R + 3 };
  },

  // Sea arch: two rock pillars joined by a lintel, with a stack and gull-white streaks.
  sea_arch(b) {
    const { solid: s, rand, pal } = b;
    const rock = mixHex(pal.stone, 0x7a746a, 0.3);
    const span = 5 + rand() * 2, H = 7 + rand() * 3;
    for (const sx of [-1, 1]) {
      const x = sx * span / 2;
      for (let k = 0; k < 4; k++) {
        const r = 2.0 - k * 0.3;
        s.stone(r, shadeHex(rock, 0.9 + rand() * 0.15), { x: x + (rand() - 0.5) * 0.6, y: b.ground(x, 0) + k * (H / 4) + r * 0.3, z: (rand() - 0.5) * 0.6, flat: 0.9 });
      }
    }
    for (let k = -2; k <= 2; k++) {
      s.stone(1.5, shadeHex(rock, 0.95 + rand() * 0.1), { x: (k * span) / 5, y: b.ground(0, 0) + H + (2 - Math.abs(k)) * 0.35, z: 0, flat: 0.7 });
    }
    s.ball(1.4, 0xf0eee6, { x: 0.6, y: b.ground(0, 0) + H + 1.1, z: -0.3, sy: 0.12, detail: 0 });
    s.ball(1.8, 0x6a8a4a, { x: -0.8, y: b.ground(0, 0) + H + 1.2, z: 0.2, sy: 0.2, detail: 0 }); // turf on top
    const sx = span / 2 + 5, sz = -3;
    for (let k = 0; k < 3; k++) s.stone(1.4 - k * 0.3, rock, { x: sx, y: b.ground(sx, sz) + k * 1.6 + 0.6, z: sz, flat: 1 });
    return {
      blockers: [{ lx: -span / 2, lz: 0, r: 1.9 }, { lx: span / 2, lz: 0, r: 1.9 }, { lx: sx, lz: sz, r: 1.4 }],
      reach: span + 8,
    };
  },

  // Lighthouse: white tower with red bands, gallery, a lantern room that glows at night.
  lighthouse(b) {
    const { solid: s, glow: g, rand, pal } = b;
    const H = 14 + rand() * 3;
    const bands = 4;
    for (let i = 0; i < bands; i++) {
      const y0 = (H / bands) * i, y1 = (H / bands) * (i + 1);
      const r0 = 2.2 - (0.8 * y0) / H, r1 = 2.2 - (0.8 * y1) / H;
      s.cyl(r1, r0, y1 - y0, i % 2 ? 0xb5483a : 0xf2eee4, { x: 0, y: (y0 + y1) / 2, z: 0, seg: 12 });
    }
    s.cyl(2.5, 2.6, 1.2, pal.stone, { x: 0, y: -0.4, z: 0, seg: 12 });
    s.cyl(1.9, 1.9, 0.2, IRON, { x: 0, y: H + 0.1, z: 0, seg: 12 });
    railing(s, -1.75, 1.75, -1.75, 1.75, H + 0.2, IRON, ['front', 'back', 'left', 'right'], null, { h: 0.8, post: 0.05 });
    g.cyl(0.95, 0.95, 1.5, 0xffffff, { x: 0, y: H + 1.0, z: 0, seg: 8 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 6.283;
      s.block(0.07, 1.5, 0.07, IRON, { x: Math.cos(a) * 1.0, y: H + 0.25, z: Math.sin(a) * 1.0 });
    }
    s.cone(1.3, 1.1, 0xb5483a, { x: 0, y: H + 2.3, z: 0, seg: 8 });
    s.ball(0.18, IRON, { x: 0, y: H + 2.95, z: 0, detail: 0 });
    // door and little windows
    s.block(0.9, 1.9, 0.1, 0x3e5f6a, { x: 0, y: 0, z: -2.18 });
    for (let k = 1; k <= 3; k++) s.box(0.35, 0.5, 0.08, 0x2e3a44, { x: 0, y: (H * k) / 4, z: -(2.2 - (0.8 * (H * k) / 4) / H) - 0.02 });
    // keeper's cottage
    const cx = 4.2, cz = 1.0;
    s.block(3.4, 2.2, 2.8, 0xf2eee4, { x: cx, y: b.ground(cx, cz) - 0.6, z: cz });
    s.gable(3.8, 3.2, 1.1, b.ground(cx, cz) + 1.6, 0x7d8790, { x: cx, z: cz, endHex: 0xf2eee4, inset: 0.3 });
    s.box(0.6, 0.6, 0.06, 0x2e3a44, { x: cx, y: b.ground(cx, cz) + 0.9, z: cz - 1.42 });
    return {
      blockers: [{ lx: 0, lz: 0, r: 2.4 }, { lx: cx - 0.9, lz: cz, r: 1.4 }, { lx: cx + 0.9, lz: cz, r: 1.4 }],
      reach: 9,
    };
  },

  // Marsh boardwalk: zig-zag deck on piles with low rails; walkable.
  boardwalk(b) {
    const { solid: s, rand, pal } = b;
    const L = boardwalkLayout(b.poi.id);
    const wood = shadeHex(mixHex(pal.wood, 0x8a7a5a, 0.3), pal.shade);
    for (const seg of L.segs) {
      const along = seg.landing ? 'x' : 'z';
      const len = seg.landing ? seg.w : seg.len;
      const wid = seg.landing ? seg.len : seg.w;
      const n = Math.max(2, Math.round(len / 0.3));
      for (let i = 0; i < n; i++) {
        const t = -len / 2 + (len / n) * (i + 0.5);
        const x = along === 'x' ? seg.x + t : seg.x, z = along === 'z' ? seg.z + t : seg.z;
        if (along === 'z') s.box(wid, 0.06, len / n - 0.03, i % 2 ? wood : shadeHex(wood, 1.06), { x, y: L.h - 0.03, z });
        else s.box(len / n - 0.03, 0.06, wid, i % 2 ? wood : shadeHex(wood, 1.06), { x, y: L.h - 0.03, z });
      }
      // piles every ~2 m down to the real ground (or the pool bottom)
      const piles = Math.max(1, Math.round(len / 2));
      for (let i = 0; i <= piles; i++) {
        const t = -len / 2 + (len / piles) * i;
        for (const side of [-1, 1]) {
          const x = along === 'z' ? seg.x + side * (wid / 2 - 0.08) : seg.x + t;
          const z = along === 'z' ? seg.z + t : seg.z + side * (wid / 2 - 0.08);
          const gy = Math.min(b.ground(x, z), 0) - 0.4;
          s.block(0.12, L.h - 0.06 - gy, 0.12, pal.dark, { x, y: gy, z });
        }
      }
      if (!seg.landing) {
        for (const side of [-1, 1]) {
          const x = seg.x + side * (seg.w / 2 - 0.04);
          s.beam([x, L.h + 0.45, seg.z - len / 2], [x, L.h + 0.45, seg.z + len / 2], 0.06, shadeHex(wood, 0.9));
          for (let i = 0; i <= Math.round(len / 1.5); i++) {
            s.block(0.06, 0.45, 0.06, shadeHex(wood, 0.85), { x, y: L.h, z: seg.z - len / 2 + (len / Math.round(len / 1.5)) * i });
          }
        }
      }
    }
    // reeds hugging the walk and an end-post signboard
    for (let i = 0; i < 14; i++) {
      const sg = L.segs[Math.floor(rand() * L.segs.length)];
      const x = sg.x + (rand() < 0.5 ? -1 : 1) * (sg.w / 2 + 0.6 + rand()), z = sg.z + (rand() - 0.5) * sg.len;
      reedClump(s, x, Math.max(b.ground(x, z), -b.base - 0.1), z, rand, {});
    }
    const [ex, ez] = L.ends[0];
    s.block(0.12, 1.3, 0.12, pal.dark, { x: ex + 1.0, y: b.ground(ex + 1, ez + 1) - 0.2, z: ez + 1.0 });
    s.box(0.6, 0.4, 0.05, pal.trim, { x: ex + 1.0, y: b.ground(ex + 1, ez + 1) + 1.0, z: ez + 0.95 });
    // footstep patches so the deck sounds like wood
    const patches = [];
    for (const seg of L.segs) {
      const len = seg.landing ? seg.w : seg.len;
      const n = Math.max(1, Math.round(len / 1.2));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len / n) * i;
        patches.push(seg.landing ? { lx: seg.x + t, lz: seg.z, r: 0.9 } : { lx: seg.x, lz: seg.z + t, r: 0.9 });
      }
    }
    return {
      surfaces: L.surfaces,
      patches,
      reach: Math.max(...L.surfaces.map((q) => Math.hypot(Math.max(Math.abs(q.x0), Math.abs(q.x1)), Math.max(Math.abs(q.z0), Math.abs(q.z1))))) + 1,
    };
  },

  // A tall highland cairn with smaller waymarkers around it.
  cairn(b) {
    const { solid: s, rand, pal } = b;
    cairn(s, 0, b.ground(0, 0), 0, 2.4 + rand(), rand, pal.stone);
    for (let i = 0; i < 3; i++) {
      const a = rand() * 6.28, r = 3 + rand() * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      cairn(s, x, b.ground(x, z), z, 0.6 + rand() * 0.4, rand, shadeHex(pal.stone, 0.92));
    }
    if (pal.snow) s.ball(0.5, SNOW, { x: 0, y: b.ground(0, 0) + 2.3, z: 0, sy: 0.4, detail: 0 });
    return { blockers: [{ lx: 0, lz: 0, r: 0.9 }], reach: 6 };
  },

  // Frozen falls: a rock face hung with a curtain of icicles over a frozen pool.
  frozen_falls(b) {
    const { solid: s, rand, pal } = b;
    const W = 7 + rand() * 3, H = 6 + rand() * 3;
    const rock = mixHex(pal.stone, 0x6e7278, 0.3);
    for (let i = 0; i < 6; i++) {
      const x = -W / 2 + (W / 5) * i;
      s.stone(2.0 + rand(), shadeHex(rock, 0.9 + rand() * 0.15), { x, y: b.ground(x, 2) + H * (0.3 + rand() * 0.4), z: 2.2, flat: 1.3 });
    }
    for (let i = 0; i < 16; i++) {
      const x = -W / 2 + 0.6 + rand() * (W - 1.2);
      const len = H * (0.35 + rand() * 0.6);
      s.cone(0.25 + rand() * 0.3, len, mixHex(ICE, 0xffffff, rand() * 0.5), { x, y: b.ground(x, 1) + H - len / 2, z: 1.0 + rand() * 0.3, rx: Math.PI });
    }
    s.cyl(W * 0.55, W * 0.6, 0.18, mixHex(ICE, 0xdfeef6, 0.5), { x: 0, y: b.ground(0, -1.5) + 0.05, z: -1.5, seg: 10, sz: 0.6 });
    for (let i = 0; i < 6; i++) s.ball(0.6 + rand() * 0.5, SNOW, { x: (rand() - 0.5) * W, y: b.ground(0, -3) + 0.15, z: -3 - rand() * 2, sy: 0.4, detail: 0 });
    return { blockers: [{ lx: -W / 4, lz: 2.4, r: W / 4 }, { lx: W / 4, lz: 2.4, r: W / 4 }], reach: W + 2 };
  },

  // Waterfall rocks: a mossy tumble of boulders with ferns in the spray.
  waterfall_rocks(b) {
    const { solid: s, rand, pal } = b;
    const blockers = [];
    for (let i = 0; i < 9; i++) {
      const a = rand() * 3.14 + Math.PI * 0.0, r = 1.5 + rand() * 3;
      const x = Math.cos(a) * r, z = Math.abs(Math.sin(a)) * r * 0.8;
      const rr = 0.8 + rand() * 1.0;
      s.stone(rr, shadeHex(pal.stone, 0.85 + rand() * 0.2), { x, y: b.ground(x, z) + rr * 0.3 + (z > 2 ? 1 : 0), z, flat: 0.8 });
      s.ball(rr * 0.6, MOSS, { x, y: b.ground(x, z) + rr * 0.8 + (z > 2 ? 1 : 0), z, sy: 0.3, detail: 0 });
      if (rr > 1.1) blockers.push({ lx: x, lz: z, r: rr * 0.8 });
    }
    for (let i = 0; i < 6; i++) {
      const x = (rand() - 0.5) * 7, z = -1 - rand() * 2;
      fern(s, x, b.ground(x, z), z, 0.8, rand);
    }
    if (pal.snow) for (let i = 0; i < 3; i++) s.ball(0.8, SNOW, { x: (rand() - 0.5) * 4, y: b.ground(0, 2) + 1.6, z: 2, sy: 0.4, detail: 0 });
    return { blockers, reach: 7 };
  },
};
