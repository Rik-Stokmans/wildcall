// Reusable low-poly building parts drawn into a Shape (see mesh.js): log and plank
// walls, windows, doors, railings, stair flights, crates, barrels, lanterns, moss and
// snow caps, reeds, benches, signposts. Everything is in the prop's local frame.
import { mixHex, shadeHex } from './logic.js';

export const GLASS = 0x2e3a44;
export const IRON = 0x4a4a48;
export const ROPE = 0xc9b48a;
export const MOSS = 0x6f8f3e;
export const MOSS_DARK = 0x56732f;
export const SNOW = 0xf4f7fb;
export const ICE = 0xbfe0f0;
export const REED = 0x9aa457;
export const REED_DRY = 0xc4b072;
export const CATTAIL = 0x6a4128;
export const LEAF = 0x5f8a3a;

/**
 * Horizontal log wall along X (front/back) or Z (left/right).
 * @param {import('./mesh.js').Shape} s
 * @param {'x'|'z'} axis direction of the logs
 * @param {number} len log length (ends overlap at corners)
 * @param {number} at the wall line (z for axis 'x', x for axis 'z')
 * @param {number} y0 bottom of the wall
 * @param {number} h wall height
 * @param {number} hex log colour
 * @param {{rows?:number, skipTop?:number, rand?:()=>number, broken?:number}} [o]
 */
export function logWall(s, axis, len, at, y0, h, hex, o = {}) {
  const r = 0.17;
  const rows = o.rows ?? Math.max(3, Math.round(h / (r * 1.85)));
  const dy = h / rows;
  for (let i = 0; i < rows; i++) {
    let L = len;
    let off = 0;
    // A ruined wall loses logs from the top and has shortened ones.
    if (o.broken && o.rand) {
      const keep = 1 - o.broken * (i / rows);
      if (o.rand() > keep + 0.25) continue;
      if (o.rand() < o.broken * 0.6) { L = len * (0.35 + o.rand() * 0.5); off = (o.rand() - 0.5) * (len - L); }
    }
    const y = y0 + dy * (i + 0.5);
    const tone = shadeHex(hex, i % 2 ? 0.95 : 1.04);
    if (axis === 'x') s.cyl(r, r, L, tone, { x: off, y, z: at, rz: Math.PI / 2, seg: 7 });
    else s.cyl(r, r, L, tone, { x: at, y, z: off, rx: Math.PI / 2, seg: 7 });
  }
}

/** Vertical plank cladding as one block with board seams (thin darker strips). */
export function plankWall(s, axis, len, at, y0, h, hex, seamHex, o = {}) {
  const t = o.t ?? 0.16;
  if (axis === 'x') s.block(len, h, t, hex, { x: o.c || 0, y: y0, z: at });
  else s.block(t, h, len, hex, { x: at, y: y0, z: o.c || 0 });
  const n = Math.floor(len / 0.32);
  const outward = o.out ?? 1; // which face gets the seams (+1 / −1)
  for (let i = 1; i < n; i++) {
    const p = -len / 2 + (len / n) * i + (o.c || 0);
    if (axis === 'x') s.block(0.03, h * 0.98, 0.03, seamHex, { x: p, y: y0, z: at + outward * (t / 2 + 0.005) });
    else s.block(0.03, h * 0.98, 0.03, seamHex, { x: at + outward * (t / 2 + 0.005), y: y0, z: p });
  }
}

/**
 * A framed window on a wall face. `face` is the outward normal: 'front' (−Z),
 * 'back' (+Z), 'left' (−X), 'right' (+X). Lit windows go into the glow shape.
 */
export function windowOn(s, glow, face, along, wallAt, y, w, h, frameHex, o = {}) {
  const out = face === 'front' || face === 'left' ? -1 : 1;
  const onX = face === 'front' || face === 'back';
  const depth = 0.12;
  const pos = (a, n) => (onX ? { x: along + a, z: wallAt + out * n } : { x: wallAt + out * n, z: along + a });
  const box = (sh, bw, bh, bd, hex, a, yy, n) => {
    const p = pos(a, n);
    if (onX) sh.box(bw, bh, bd, hex, { x: p.x, y: yy, z: p.z });
    else sh.box(bd, bh, bw, hex, { x: p.x, y: yy, z: p.z });
  };
  // glass pane (glowing at night when lit)
  if (o.lit && glow) box(glow, w, h, 0.04, 0xffffff, 0, y, 0.1);
  else box(s, w, h, 0.04, o.glass ?? GLASS, 0, y, 0.1);
  // frame
  box(s, w + 0.16, 0.1, depth, frameHex, 0, y + h / 2 + 0.05, 0.12);
  box(s, w + 0.22, 0.1, depth + 0.08, frameHex, 0, y - h / 2 - 0.05, 0.14); // sill
  box(s, 0.08, h, depth, frameHex, -w / 2 - 0.04, y, 0.12);
  box(s, 0.08, h, depth, frameHex, w / 2 + 0.04, y, 0.12);
  // cross mullion
  box(s, 0.05, h, 0.05, frameHex, 0, y, 0.14);
  box(s, w, 0.05, 0.05, frameHex, 0, y, 0.14);
  if (o.shutters) {
    box(s, w * 0.5, h + 0.06, 0.05, o.shutters, -w * 0.78, y, 0.13);
    box(s, w * 0.5, h + 0.06, 0.05, o.shutters, w * 0.78, y, 0.13);
  }
  if (o.box) {
    // flower box under the window
    box(s, w + 0.1, 0.2, 0.26, frameHex, 0, y - h / 2 - 0.25, 0.25);
    const k = o.rand || Math.random;
    for (let i = 0; i < 5; i++) {
      const p = pos(-w / 2 + (w / 4) * i, 0.27);
      const col = [0xe86a7a, 0xf2c94c, 0xf4f0e8, 0xb07ad6][Math.floor(k() * 4)];
      s.ball(0.09, LEAF, { x: p.x, y: y - h / 2 - 0.08, z: p.z, detail: 0 });
      s.ball(0.06, col, { x: p.x, y: y - h / 2 + 0.02, z: p.z, detail: 0 });
    }
  }
  if (o.boarded) {
    // two crossed planks nailed over an abandoned window
    const p = pos(0, 0.18);
    const tilt = 0.5;
    if (onX) {
      s.box(w + 0.3, 0.12, 0.04, o.boarded, { x: p.x, y, z: p.z, rz: tilt });
      s.box(w + 0.3, 0.12, 0.04, shadeHex(o.boarded, 0.9), { x: p.x, y, z: p.z + out * 0.03, rz: -tilt });
    } else {
      s.box(0.04, 0.12, w + 0.3, o.boarded, { x: p.x, y, z: p.z, rx: tilt });
      s.box(0.04, 0.12, w + 0.3, shadeHex(o.boarded, 0.9), { x: p.x + out * 0.03, y, z: p.z, rx: -tilt });
    }
  }
}

/** A plank door on the front face (−Z) of a wall at z = wallAt. */
export function doorFront(s, x, wallAt, y0, w, h, hex, frameHex, o = {}) {
  const z = wallAt - 0.09;
  if (o.open) {
    // ajar: swung inwards ~70°
    s.block(w, h, 0.07, hex, { x: x - w / 2 + Math.cos(1.2) * w / 2, y: y0, z: wallAt + Math.sin(1.2) * w / 2, ry: -1.2 });
    s.block(w, h, 0.03, 0x2a2520, { x, y: y0, z: wallAt - 0.06 });
  } else {
    s.block(w, h, 0.07, hex, { x, y: y0, z });
    for (let i = 1; i < 4; i++) s.block(0.025, h * 0.96, 0.02, shadeHex(hex, 0.8), { x: x - w / 2 + (w / 4) * i, y: y0 + h * 0.02, z: z - 0.04 });
    s.block(w * 0.9, 0.09, 0.03, shadeHex(hex, 0.85), { x, y: y0 + h * 0.25, z: z - 0.05 });
    s.block(w * 0.9, 0.09, 0.03, shadeHex(hex, 0.85), { x, y: y0 + h * 0.72, z: z - 0.05 });
    s.ball(0.045, 0xc9a24a, { x: x + w * 0.36, y: y0 + h * 0.5, z: z - 0.07, detail: 0 });
  }
  s.block(w + 0.22, 0.12, 0.14, frameHex, { x, y: y0 + h, z: wallAt - 0.08 });
  s.block(0.1, h, 0.14, frameHex, { x: x - w / 2 - 0.05, y: y0, z: wallAt - 0.08 });
  s.block(0.1, h, 0.14, frameHex, { x: x + w / 2 + 0.05, y: y0, z: wallAt - 0.08 });
}

/**
 * Railing around (part of) a rectangle at height y. `sides` lists 'front' 'back'
 * 'left' 'right'; `gap` leaves an opening {side, at, width}.
 */
export function railing(s, x0, x1, z0, z1, y, hex, sides, gap, o = {}) {
  const h = o.h ?? 1.0;
  const post = o.post ?? 0.1;
  const runs = {
    front: [[x0, z0], [x1, z0]], back: [[x0, z1], [x1, z1]],
    left: [[x0, z0], [x0, z1]], right: [[x1, z0], [x1, z1]],
  };
  for (const side of sides) {
    const [a, b] = runs[side];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let segs = [[0, len]];
    if (gap && gap.side === side) {
      const c = len / 2 + (gap.at || 0);
      segs = [[0, c - gap.width / 2], [c + gap.width / 2, len]];
    }
    const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
    for (const [s0, s1] of segs) {
      if (s1 - s0 < 0.05) continue;
      const p0 = [a[0] + dx * s0, a[1] + dz * s0], p1 = [a[0] + dx * s1, a[1] + dz * s1];
      s.beam([p0[0], y + h, p0[1]], [p1[0], y + h, p1[1]], 0.08, hex);
      s.beam([p0[0], y + h * 0.5, p0[1]], [p1[0], y + h * 0.5, p1[1]], 0.06, shadeHex(hex, 0.95));
      const n = Math.max(1, Math.round((s1 - s0) / 1.1));
      for (let i = 0; i <= n; i++) {
        const t = s0 + ((s1 - s0) * i) / n;
        s.block(post, h, post, shadeHex(hex, 0.92), { x: a[0] + dx * t, y, z: a[1] + dz * t });
      }
    }
  }
}

/**
 * Stair flight drawn from a stairFlight() profile: two stringers and treads. The
 * flight climbs towards −Z, arriving at zTop at `height`.
 */
export function stairs(s, flight, x, width, hex, o = {}) {
  const top = flight.ramp.y0;
  const zTop = flight.ramp.z0, zBot = flight.ramp.z1;
  for (const sx of [-1, 1]) {
    s.beam([x + sx * (width / 2 + 0.05), 0, zBot], [x + sx * (width / 2 + 0.05), top, zTop], 0.12, shadeHex(hex, 0.9), { w: 0.08, d: 0.22 });
  }
  for (let i = 1; i <= flight.steps; i++) {
    const y = flight.rise * i;
    const z = zBot - flight.tread * i + flight.tread / 2;
    s.box(width, 0.06, flight.tread + 0.06, hex, { x, y: y - 0.03, z });
  }
  if (o.handrail) {
    for (const sx of [-1, 1]) {
      const px = x + sx * (width / 2 + 0.1);
      s.beam([px, 1.0, zBot], [px, top + 1.0, zTop], 0.07, hex);
      const n = Math.max(2, Math.round(flight.run / 1.6));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        s.block(0.07, 1.0, 0.07, hex, { x: px, y: top * t, z: zBot + (zTop - zBot) * t });
      }
    }
  }
}

/** Wooden crate with corner battens. */
export function crate(s, x, y, z, size, hex, o = {}) {
  s.block(size, size, size, hex, { x, y, z, ry: o.ry || 0 });
  const dark = shadeHex(hex, 0.78);
  const e = size / 2 + 0.01;
  const ry = o.ry || 0, c = Math.cos(ry), sn = Math.sin(ry);
  for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const lx = ax * (e - 0.03), lz = az * (e - 0.03);
    s.block(0.07, size + 0.02, 0.07, dark, { x: x + lx * c + lz * sn, y: y - 0.01, z: z - lx * sn + lz * c, ry });
  }
}

/** Barrel with two hoops. */
export function barrel(s, x, y, z, r, h, hex) {
  s.cyl(r * 0.9, r * 0.9, h, hex, { x, y: y + h / 2, z, seg: 9 });
  s.cyl(r, r, h * 0.5, shadeHex(hex, 1.06), { x, y: y + h / 2, z, seg: 9 });
  s.cyl(r * 1.01, r * 1.01, 0.06, IRON, { x, y: y + h * 0.22, z, seg: 9 });
  s.cyl(r * 1.01, r * 1.01, 0.06, IRON, { x, y: y + h * 0.78, z, seg: 9 });
}

/** Hanging or standing lantern: dark iron frame, glowing body. */
export function lantern(s, glow, x, y, z, size = 0.18) {
  s.box(size * 1.2, 0.04, size * 1.2, IRON, { x, y: y + size * 0.6, z });
  s.cone(size * 0.7, size * 0.5, IRON, { x, y: y + size * 0.85, z, seg: 4, ry: Math.PI / 4 });
  s.box(size * 1.1, 0.04, size * 1.1, IRON, { x, y: y - size * 0.55, z });
  if (glow) glow.box(size * 0.9, size, size * 0.9, 0xffffff, { x, y, z });
  else s.box(size * 0.9, size, size * 0.9, 0xd9c48a, { x, y, z });
}

/** Clumps of moss puffs scattered over a roof slope (gable from mesh.js). */
export function mossOnRoof(s, w, d, rise, eave, rand, hex = MOSS, count = 10) {
  const half = d / 2;
  const slope = Math.atan2(rise, half);
  for (let i = 0; i < count; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const t = 0.15 + rand() * 0.75; // 0 ridge … 1 eave
    const z = side * half * t;
    const y = eave + rise * (1 - t) + 0.16;
    const x = (rand() - 0.5) * (w - 0.6);
    s.ball(0.25 + rand() * 0.3, rand() < 0.5 ? hex : shadeHex(hex, 0.85), {
      x, y, z, sy: 0.35, rx: side * slope, detail: 0,
    });
  }
}

/** Thick snow cap lying on both roof slopes, with a soft rounded ridge. */
export function snowOnRoof(s, w, d, rise, eave, t = 0.18) {
  const half = d / 2;
  const slope = Math.atan2(rise, half);
  const len = Math.hypot(half, rise) * 0.96;
  for (const side of [-1, 1]) {
    s.box(w * 0.98, 0.14, len, SNOW, { x: 0, y: eave + rise / 2 + t + 0.07, z: side * half / 2, rx: side * slope });
  }
  s.cyl(0.16, 0.16, w * 0.98, SNOW, { y: eave + rise + t * 0.9, rz: Math.PI / 2, seg: 6 });
}

/** A reed clump: several thin blades and a cattail or two. */
export function reedClump(s, x, y, z, rand, o = {}) {
  const n = o.n ?? 5 + Math.floor(rand() * 4);
  const h = o.h ?? 1.3 + rand() * 0.9;
  const dry = o.dry ?? 0.3;
  for (let i = 0; i < n; i++) {
    const a = rand() * 6.283, r = rand() * 0.35;
    const hh = h * (0.6 + rand() * 0.5);
    const tilt = (rand() - 0.5) * 0.35;
    const col = mixHex(REED, REED_DRY, rand() * dry + (o.tint ?? 0));
    s.cone(0.05, hh, col, { x: x + Math.cos(a) * r, y: y + hh / 2, z: z + Math.sin(a) * r, rx: tilt, rz: (rand() - 0.5) * 0.35, seg: 3 });
    if (i < 2 && rand() < 0.7) {
      s.cyl(0.045, 0.045, 0.22, CATTAIL, { x: x + Math.cos(a) * r + tilt * 0.1, y: y + hh * 0.88, z: z + Math.sin(a) * r, seg: 5 });
    }
  }
}

/** A fern: a ring of drooping fronds. */
export function fern(s, x, y, z, size, rand, hex = 0x4f8a36) {
  const n = 6 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + rand() * 0.4;
    const L = size * (0.8 + rand() * 0.4);
    s.box(0.16 * size, 0.03, L, i % 2 ? hex : shadeHex(hex, 1.1), {
      x: x + Math.sin(a) * L * 0.45, y: y + size * 0.3, z: z + Math.cos(a) * L * 0.45, ry: a, rx: -0.55,
    });
  }
}

/** A simple bench (seat facing −Z). */
export function bench(s, x, y, z, ry, hex, o = {}) {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const P = (lx, lz) => ({ x: x + lx * c + lz * sn, z: z - lx * sn + lz * c });
  const len = o.len ?? 1.6;
  let p = P(0, 0);
  s.block(len, 0.08, 0.42, hex, { x: p.x, y: y + 0.42, z: p.z, ry });
  p = P(0, 0.22);
  if (o.back !== false) s.block(len, 0.32, 0.06, hex, { x: p.x, y: y + 0.62, z: p.z, ry, rx: 0.15 });
  for (const lx of [-len / 2 + 0.15, len / 2 - 0.15]) {
    p = P(lx, 0);
    s.block(0.1, 0.42, 0.38, shadeHex(hex, 0.85), { x: p.x, y, z: p.z, ry });
  }
}

/** A cairn: a tapering stack of flat stones. */
export function cairn(s, x, y, z, height, rand, hex) {
  let yy = y;
  let r = height * 0.32;
  while (yy < y + height && r > 0.08) {
    const h = r * 0.55;
    s.stone(r, rand() < 0.5 ? hex : shadeHex(hex, 0.9), { x: x + (rand() - 0.5) * r * 0.3, y: yy + h * 0.5, z: z + (rand() - 0.5) * r * 0.3, flat: 0.5 });
    yy += h * 0.85;
    r *= 0.8 + rand() * 0.08;
  }
}

/** A signpost with one to three arrow boards and a little cap. */
export function signpost(s, x, y, z, hex, boardHex, rand, o = {}) {
  const h = o.h ?? 2.1;
  s.block(0.14, h, 0.14, hex, { x, y: y - 0.4, z });
  s.cone(0.14, 0.18, shadeHex(hex, 0.85), { x, y: y + h - 0.31, z, seg: 4, ry: Math.PI / 4 });
  const n = o.boards ?? 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = (o.angle ?? 0) + (i === 0 ? 0 : (rand() - 0.5) * 2.6);
    const yy = y + h - 0.6 - i * 0.32;
    const L = 0.9 + rand() * 0.3;
    const dx = Math.cos(a) * L * 0.42, dz = -Math.sin(a) * L * 0.42;
    s.box(L, 0.22, 0.05, i % 2 ? boardHex : shadeHex(boardHex, 1.06), { x: x + dx, y: yy, z: z + dz, ry: a });
    // arrow point
    s.cone(0.13, 0.22, boardHex, { x: x + Math.cos(a) * (L * 0.92), y: yy, z: z - Math.sin(a) * (L * 0.92), rz: -Math.PI / 2, ry: a, seg: 3, sz: 0.25 });
  }
}

/** Stone foundation skirt reaching below the base so slopes never show a gap. */
export function foundation(s, w, d, top, hex, o = {}) {
  s.block(w, top + (o.below ?? 1.5), d, hex, { x: o.x || 0, y: -(o.below ?? 1.5), z: o.z || 0 });
}

/** Woodpile: stacked log ends. */
export function woodpile(s, x, z, len, rows, hex, rand) {
  for (let r = 0; r < rows; r++) {
    const n = rows - r + 2;
    for (let i = 0; i < n; i++) {
      s.cyl(0.13, 0.13, len, rand() < 0.5 ? hex : shadeHex(hex, 1.1), {
        x: x + (i - (n - 1) / 2) * 0.27, y: 0.14 + r * 0.24, z, rx: Math.PI / 2, seg: 6,
      });
    }
  }
}
