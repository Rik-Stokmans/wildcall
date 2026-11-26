// Stylised 3D models of the eighteen forage plants (core.VegKind 18–35, contract §12),
// in the soft, chunky look of contract §10. Every plant is two parts:
//   base  — what is always there (the bush, the leaves, the moss under a mushroom);
//   crops — what can be picked, one geometry per yield item (fruit, flowers, caps,
//           fresh tips), shown only while the plant bears and has not been picked.
// Models are deterministic per (kind, variant); units are metres at scale 1, base at
// the origin, Y up. The sweet chestnut tree itself is drawn by the world module (it is
// a tree kind there): only its fallen husks are modelled here.
import * as THREE from 'three';
import { Geo, V, rng, lin, mixc, mulc, bez, quatTo } from './geo.js';

export const VARIANTS = 2;

const TAU = Math.PI * 2;
const C = {
  leafDeep: lin(0x22421c), leafDark: lin(0x2f5a26), leafMid: lin(0x4d7f34), leafLight: lin(0x7fb04a), leafLime: lin(0xa8d05a),
  leafBlue: lin(0x5d7f5a), leafSilver: lin(0x9fb39a), leafOlive: lin(0x6c7a3a),
  bark: lin(0x6b5a48), barkGrey: lin(0x8a8378), cane: lin(0x6e3040), caneGreen: lin(0x5f7a32), stem: lin(0x5c7d36),
  moss: lin(0x5f8a35), mossDark: lin(0x34521f), litter: lin(0x8a5a2e), litterDark: lin(0x5a3a1e), soil: lin(0x4a3a2a),
};

// ------------------------------------------------------------------ small helpers

/** Scatters leaves over the upper surface of an ellipsoidal mass. */
function leafCoat(g, R, c, r, n, { col = C.leafMid, tip = C.leafLight, len = 0.12, width = 0.07, shape = 'oval', droop = 0.3, sway = 0.6, serrate = 0, minY = -0.35 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = R() * TAU;
    const y = minY + R() * (1 - minY);
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const dir = V(Math.cos(a) * ring, y, Math.sin(a) * ring);
    const p = V(c.x + dir.x * r[0] * 0.92, c.y + dir.y * r[1] * 0.92, c.z + dir.z * r[2] * 0.92);
    const out = dir.clone().add(V((R() - 0.5) * 0.6, 0.35, (R() - 0.5) * 0.6)).normalize();
    const shade = 0.82 + R() * 0.3;
    g.leaf(p, out, len * (0.8 + R() * 0.45), width * (0.8 + R() * 0.4), mulc(col, shade), mulc(tip, shade),
      { droop, sway, shape, serrate, roll: (R() - 0.5) * 0.8 });
  }
}

/**
 * A soft leafy mass: a dark core that fills the gaps plus camera-facing leaf cards
 * (atlas cell: 0 broad, 1 small, 2 narrow leaves).
 */
function foliage(g, R, c, r, { top, bottom, cell = 0, size = 0.35, sway = 0.5, density = 1, core = true } = {}) {
  // the core only fills gaps deep inside: small, and coloured like the shaded leaves
  if (core) g.blob(c, [r[0] * 0.55, r[1] * 0.55, r[2] * 0.55], mixc(bottom, top, 0.45), bottom, { seed: R() * 1e6, sway, lump: 0.25, soft: 0.7, leaf: 1 });
  const vol = (4 / 3) * Math.PI * r[0] * r[1] * r[2];
  const n = Math.max(8, Math.min(120, Math.round((vol / (size * size * size)) * 3.6 * density)));
  g.cards(c, r, n, top, bottom, { R, cell, size, sway, up: 0.55 });
}

/** A scatter of fallen leaves lying on the ground in a ring between r0 and r1. */
function litter(g, R, n, r0, r1, cols, { len = 0.07, y = 0.012 } = {}) {
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, d = r0 + Math.sqrt(R()) * (r1 - r0);
    const p = V(Math.cos(a) * d, y + R() * 0.006, Math.sin(a) * d);
    const col = cols[Math.floor(R() * cols.length)];
    g.leaf(p, V(Math.cos(R() * TAU), 0.04, Math.sin(R() * TAU)), len * (0.7 + R() * 0.6), len * 0.6, col, mulc(col, 1.12), { droop: -0.05, fold: 0.1 });
  }
}

/** Sway weight that grows with height up to `h`. */
const swayH = (h, k = 1) => (p) => Math.max(0, Math.min(1, p.y / h)) * k;

/** A cluster of tiny spheres around `c` (a blackberry, a raspberry-like cloudberry). */
function drupe(g, c, r, col, R, n = 5, sway = 0.6) {
  g.sphere(c, r * 0.8, col, { detail: 0, sway });
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, y = (R() - 0.3) * 0.9;
    const k = Math.sqrt(1 - Math.min(0.9, y * y));
    g.sphere(V(c.x + Math.cos(a) * k * r * 0.6, c.y + y * r * 0.6, c.z + Math.sin(a) * k * r * 0.6), r * 0.5, mulc(col, 0.9 + R() * 0.25), { detail: 0, sway });
  }
}

/** A five-petal or star flower facing `up`. */
function flower(g, c, r, petal, centre, { petals = 5, up = V(0, 1, 0), sway = 0.5, cup = 0.15, centreR = 0.32 } = {}) {
  const q = quatTo(up);
  const verts = [], tris = [], cols = [];
  verts.push([0, cup * r * 0.3, 0]);
  for (let i = 0; i < petals; i++) {
    const a0 = (i / petals) * TAU, a1 = ((i + 0.5) / petals) * TAU, a2 = ((i + 1) / petals) * TAU;
    const base = verts.length;
    verts.push([Math.cos(a0) * r * 0.18, 0, Math.sin(a0) * r * 0.18]);
    verts.push([Math.cos(a1) * r, cup * r, Math.sin(a1) * r]);
    verts.push([Math.cos(a2) * r * 0.18, 0, Math.sin(a2) * r * 0.18]);
    tris.push([0, base + 1, base], [0, base + 2, base + 1]); // counter-clockwise seen from above
  }
  const P = verts.map((v) => V(v[0], v[1], v[2]).applyQuaternion(q).add(c));
  const n = up.clone().normalize();
  g.tris(P.map((p) => [p.x, p.y, p.z]), tris, petal, sway, P.map(() => [n.x * 0.7, n.y * 0.7 + 0.3, n.z * 0.7]));
  if (centre) g.sphere(c.clone().add(n.clone().multiplyScalar(r * 0.12)), r * centreR, centre, { detail: 0, squash: 0.7, sway });
}

/** A rough upright stem polyline with some wobble. */
function stemPts(R, base, top, n = 4, wob = 0.05) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(V(base.x + (top.x - base.x) * t + (i && i < n ? (R() - 0.5) * wob : 0), base.y + (top.y - base.y) * t, base.z + (top.z - base.z) * t + (i && i < n ? (R() - 0.5) * wob : 0)));
  }
  return pts;
}

// ------------------------------------------------------------------ the plants

const BUILDERS = {
  // 18 — bramble: a low, mounded thicket of dark leaves with long arching canes.
  18(R) {
    const base = new Geo(), fruit = new Geo();
    const mounds = 3 + Math.floor(R() * 2);
    for (let i = 0; i < mounds; i++) {
      const a = (i / mounds) * TAU + R();
      const c = V(Math.cos(a) * 0.45, 0.32 + R() * 0.12, Math.sin(a) * 0.45);
      const r = [0.55 + R() * 0.2, 0.36 + R() * 0.1, 0.5 + R() * 0.2];
      foliage(base, R, c, r, { top: lin(0x6a9a3e), bottom: lin(0x2e5224), cell: 0, size: 0.3, sway: 0.3 });
      // fruit trusses all over the outside of the mound
      for (let t = 0; t < 7; t++) {
        const a2 = R() * TAU, y = -0.1 + R() * 0.85;
        const k = Math.sqrt(1 - y * y);
        const fp = V(c.x + Math.cos(a2) * k * r[0] * 1.02, c.y + y * r[1] * 1.02, c.z + Math.sin(a2) * k * r[2] * 1.02);
        const n = 3 + Math.floor(R() * 3);
        for (let j = 0; j < n; j++) {
          const ripe = R() < 0.78;
          drupe(fruit, V(fp.x + (R() - 0.5) * 0.08, fp.y + (R() - 0.5) * 0.06, fp.z + (R() - 0.5) * 0.08), 0.03, ripe ? lin(0x281832) : (R() < 0.5 ? lin(0xa82434) : lin(0x6a1a2e)), R, 5, 0.3);
        }
      }
    }
    const canes = 6 + Math.floor(R() * 3);
    for (let i = 0; i < canes; i++) {
      const a = (i / canes) * TAU + R() * 0.6;
      const reach = 1.15 + R() * 0.5, h = 1.05 + R() * 0.35;
      const s = V(Math.cos(a) * 0.15, 0.25, Math.sin(a) * 0.15);
      const m = V(Math.cos(a) * reach * 0.55, h, Math.sin(a) * reach * 0.55);
      const e = V(Math.cos(a) * reach, 0.12, Math.sin(a) * reach);
      const pts = [];
      for (let k = 0; k <= 8; k++) pts.push(bez(s, m, e, k / 8));
      base.tube(pts, 0.024, 0.01, C.cane, { sides: 4, colorEnd: lin(0x7a4050), sway: (p) => Math.min(1, p.y / 1.2) * 0.8 });
      for (let k = 2; k <= 7; k++) {
        const t = k / 8, p = bez(s, m, e, t);
        const tang = bez(s, m, e, Math.min(1, t + 0.05)).sub(p).normalize();
        if (k % 2 === 0) base.cards(p, [0.09, 0.07, 0.09], 2, lin(0x6a9a40), lin(0x355e2a), { R, cell: 0, size: 0.2, sway: 0.7 });
        if (k >= 4 && R() < 0.8) {
          // fruit trusses hang from the canes
          const fp = p.clone().add(V(0, -0.04, 0));
          const n = 3 + Math.floor(R() * 3);
          for (let j = 0; j < n; j++) {
            const ripe = R() < 0.82;
            const c = V(fp.x + (R() - 0.5) * 0.09, fp.y - R() * 0.06, fp.z + (R() - 0.5) * 0.09);
            drupe(fruit, c, 0.03, ripe ? lin(0x281832) : lin(0xa82434), R, 5, 0.7);
          }
        }
      }
    }
    // a few trusses resting on the mounds too
    for (let i = 0; i < 6; i++) {
      const a = R() * TAU, d = 0.3 + R() * 0.45;
      const c = V(Math.cos(a) * d, 0.62 + R() * 0.12, Math.sin(a) * d);
      for (let j = 0; j < 3; j++) drupe(fruit, V(c.x + (R() - 0.5) * 0.08, c.y + (R() - 0.5) * 0.04, c.z + (R() - 0.5) * 0.08), 0.024, R() < 0.85 ? lin(0x1c1224) : lin(0x7a1a2a), R, 5, 0.3);
    }
    return { base, crops: { blackberry: fruit } };
  },

  // 19 — wild strawberry: a low patch of trefoil leaves with tiny red berries.
  19(R) {
    const base = new Geo(), fruit = new Geo();
    const rosettes = 4 + Math.floor(R() * 3);
    for (let r = 0; r < rosettes; r++) {
      const a = R() * TAU, d = R() * 0.32;
      const o = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      const n = 4 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const la = (i / n) * TAU + R();
        const top = o.clone().add(V(Math.cos(la) * 0.08, 0.12 + R() * 0.07, Math.sin(la) * 0.08));
        base.tube([o.clone(), o.clone().add(V(Math.cos(la) * 0.04, 0.06, Math.sin(la) * 0.04)), top], 0.004, 0.003, C.stem, { sides: 3, sway: 0.4 });
        for (const k of [-1, 0, 1]) {
          const dir = V(Math.cos(la + k * 0.9), 0.25, Math.sin(la + k * 0.9));
          base.leaf(top, dir, 0.08, 0.06, lin(0x5c9a40), lin(0x8cc45a), { serrate: 0.22, droop: 0.15, sway: 0.5, fold: 0.12 });
        }
      }
      // berries hang on thin arching stalks just above the ground
      const berries = 2 + Math.floor(R() * 3);
      for (let i = 0; i < berries; i++) {
        const ba = R() * TAU;
        const tip = o.clone().add(V(Math.cos(ba) * 0.11, 0.1 + R() * 0.04, Math.sin(ba) * 0.11));
        fruit.tube([o.clone().add(V(0, 0.02, 0)), o.clone().add(V(Math.cos(ba) * 0.05, 0.17, Math.sin(ba) * 0.05)), tip], 0.003, 0.002, C.stem, { sides: 3, sway: 0.5 });
        fruit.ellipsoid(tip.clone().add(V(0, -0.012, 0)), [0.016, 0.022, 0.016], new THREE.Quaternion(), lin(R() < 0.85 ? 0xd8202a : 0xf09a6a), { detail: 1, sway: 0.5 });
        fruit.sphere(tip.clone().add(V(0, 0.006, 0)), 0.008, lin(0x4f7a30), { detail: 0, squash: 0.4, sway: 0.5 });
      }
      if (R() < 0.6) flower(base, o.clone().add(V((R() - 0.5) * 0.1, 0.13, (R() - 0.5) * 0.1)), 0.016, lin(0xf4f0e6), lin(0xe8c440), { sway: 0.5 });
    }
    return { base, crops: { wild_strawberry: fruit } };
  },

  // 20 — bilberry: knee-high shrublets of bright green, angled stems and small leaves.
  20(R) {
    const base = new Geo(), fruit = new Geo();
    const clumps = 4 + Math.floor(R() * 3);
    for (let i = 0; i < clumps; i++) {
      const a = R() * TAU, d = R() * 0.45;
      const o = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      const c = o.clone().add(V(0, 0.2 + R() * 0.06, 0));
      const r = [0.2 + R() * 0.08, 0.17, 0.2 + R() * 0.08];
      foliage(base, R, c, r, { top: lin(0x9ccc5a), bottom: lin(0x467a30), cell: 1, size: 0.15, sway: 0.4, core: false, density: 1.3 });
      for (let s = 0; s < 4; s++) {
        const sa = R() * TAU;
        base.tube(stemPts(R, o.clone().add(V(Math.cos(sa) * 0.05, 0, Math.sin(sa) * 0.05)), c.clone().add(V(Math.cos(sa) * r[0] * 0.9, r[1] * 0.8, Math.sin(sa) * r[2] * 0.9)), 3, 0.04), 0.006, 0.004, lin(0x5e8f2e), { sides: 3, sway: 0.4 });
      }
      for (let b = 0; b < 11; b++) {
        const ba = R() * TAU, y = -0.2 + R() * 0.8;
        const k = Math.sqrt(1 - y * y);
        const p = V(c.x + Math.cos(ba) * k * r[0] * 1.02, c.y + y * r[1], c.z + Math.sin(ba) * k * r[2] * 1.02);
        fruit.sphere(p, 0.02, lin(R() < 0.75 ? 0x34407a : 0x4a5290), { detail: 1, sway: 0.4, shade: 0.35 });
      }
    }
    return { base, crops: { bilberry: fruit } };
  },

  // 21 — elder: a many-stemmed shrub with pale corky bark; cream flower plates in
  // spring, drooping purple-black berry clusters in autumn.
  21(R) {
    const base = new Geo(), flowers = new Geo(), berries = new Geo();
    const stems = 4 + Math.floor(R() * 3);
    const tops = [];
    for (let i = 0; i < stems; i++) {
      const a = (i / stems) * TAU + R() * 0.5;
      const top = V(Math.cos(a) * (0.6 + R() * 0.4), 2.1 + R() * 0.6, Math.sin(a) * (0.6 + R() * 0.4));
      const mid = V(Math.cos(a) * 0.25, 1.1, Math.sin(a) * 0.25);
      const pts = [];
      for (let k = 0; k <= 6; k++) pts.push(bez(V(Math.cos(a) * 0.06, -0.05, Math.sin(a) * 0.06), mid, top, k / 6));
      base.tube(pts, 0.05, 0.022, lin(0x9a8a72), { sides: 5, colorEnd: lin(0x7d7058), sway: swayH(2.6, 0.5) });
      tops.push(top);
    }
    const masses = [];
    for (const t of tops) {
      for (let k = 0; k < 2; k++) {
        const c = t.clone().add(V((R() - 0.5) * 0.5, (k ? -0.45 : 0.05) + (R() - 0.5) * 0.2, (R() - 0.5) * 0.5));
        const r = [0.55 + R() * 0.2, 0.38 + R() * 0.1, 0.55 + R() * 0.2];
        foliage(base, R, c, r, { top: lin(0x7aa84a), bottom: lin(0x40682e), cell: 0, size: 0.42, sway: swayH(2.6, 0.6), core: false, density: 1.3 });
        masses.push({ c, r });
      }
    }
    for (const { c, r } of masses) {
      // flat cream umbels held above the leaves
      for (let i = 0; i < 5; i++) {
        const a = R() * TAU, y = 0.15 + R() * 0.75;
        const k = Math.sqrt(1 - y * y);
        const p = V(c.x + Math.cos(a) * k * r[0] * 1.05, c.y + y * r[1] * 1.05 + 0.05, c.z + Math.sin(a) * k * r[2] * 1.05);
        const up = V(Math.cos(a) * k * 0.6, 1, Math.sin(a) * k * 0.6).normalize();
        flowers.lathe(p, [[0.0, -0.04], [0.13, -0.014], [0.17, 0.0], [0.15, 0.022], [0.0, 0.036]], (pp, n) => mixc(lin(0xe0d8b0), lin(0xfffbea), 0.5 + 0.5 * n.y), { sides: 10, quat: quatTo(up), sway: swayH(2.6, 0.8) });
        for (let d = 0; d < 10; d++) {
          const da = R() * TAU, dr = Math.sqrt(R()) * 0.14;
          flowers.sphere(p.clone().add(up.clone().multiplyScalar(0.03)).add(V(Math.cos(da) * dr, 0, Math.sin(da) * dr)), 0.022, lin(0xfffbee), { detail: 0, squash: 0.6, sway: swayH(2.6, 0.8) });
        }
      }
      // drooping clusters of dark berries on red stalks
      for (let i = 0; i < 3; i++) {
        const a = R() * TAU, y = -0.1 + R() * 0.5;
        const k = Math.sqrt(1 - y * y);
        const p = V(c.x + Math.cos(a) * k * r[0] * 0.98, c.y + y * r[1], c.z + Math.sin(a) * k * r[2] * 0.98);
        const out = V(Math.cos(a), 0, Math.sin(a));
        const hang = p.clone().add(out.clone().multiplyScalar(0.06)).add(V(0, -0.16, 0));
        berries.tube([p, p.clone().add(out.clone().multiplyScalar(0.07)).add(V(0, -0.03, 0)), hang], 0.006, 0.004, lin(0xa0303a), { sides: 3, sway: swayH(2.6, 0.9) });
        for (let b = 0; b < 16; b++) {
          const ba = R() * TAU, br = Math.sqrt(R()) * 0.085, by = -R() * 0.07 - br * 0.5;
          berries.sphere(hang.clone().add(V(Math.cos(ba) * br, by, Math.sin(ba) * br)), 0.013, lin(R() < 0.8 ? 0x2e1838 : 0x5a2448), { detail: 0, sway: swayH(2.6, 0.9) });
        }
      }
    }
    return { base, crops: { elderflower: flowers, elderberry: berries } };
  },

  // 22 — dog rose: a loose, arching shrub of thorny canes with scarlet hips.
  22(R) {
    const base = new Geo(), hips = new Geo();
    const canes = 8 + Math.floor(R() * 3);
    for (let i = 0; i < canes; i++) {
      const a = (i / canes) * TAU + R() * 0.4;
      const tall = i % 3 === 0;
      const reach = (tall ? 0.6 : 0.9) + R() * 0.5, h = (tall ? 2.0 : 1.4) + R() * 0.5;
      const s = V(0, 0, 0), m = V(Math.cos(a) * reach * 0.3, h, Math.sin(a) * reach * 0.3), e = V(Math.cos(a) * reach, h * (tall ? 0.85 : 0.5), Math.sin(a) * reach);
      const pts = [];
      for (let k = 0; k <= 7; k++) pts.push(bez(s, m, e, k / 7));
      base.tube(pts, 0.022, 0.009, lin(0x5b6a2e), { sides: 4, colorEnd: lin(0x7a4a34), sway: swayH(2, 0.8) });
      for (let k = 2; k <= 7; k++) {
        const t = k / 7, p = bez(s, m, e, t);
        const c = p.clone().add(V((R() - 0.5) * 0.1, 0.02, (R() - 0.5) * 0.1));
        const r = [0.18 + R() * 0.08, 0.12, 0.18 + R() * 0.08];
        if (R() < 0.6) {
          foliage(base, R, c, r, { top: lin(0x88b456), bottom: lin(0x3e6834), cell: 1, size: 0.2, sway: swayH(2, 0.8), core: false, density: 0.8 });
        }
        if (k >= 3 && R() < 0.9) {
          const n = 2 + Math.floor(R() * 3);
          for (let j = 0; j < n; j++) {
            const hp = p.clone().add(V((R() - 0.5) * 0.2, -0.04 - R() * 0.06, (R() - 0.5) * 0.2));
            const tilt = quatTo(V((R() - 0.5) * 0.6, 1, (R() - 0.5) * 0.6));
            hips.ellipsoid(hp, [0.03, 0.045, 0.03], tilt, lin(R() < 0.85 ? 0xd8261e : 0xe8602a), { detail: 1, sway: swayH(2, 0.9), shade: 0.3 });
            hips.sphere(hp.clone().add(V(0, -0.046, 0)), 0.01, lin(0x2a1a14), { detail: 0, squash: 0.5, sway: swayH(2, 0.9) });
          }
        }
      }
    }
    return { base, crops: { rosehip: hips } };
  },

  // 23 — hazel: a coppice stool of many straight, slender grey-brown stems and soft
  // round leaves; nut clusters in frilly husks.
  23(R) {
    const base = new Geo(), nuts = new Geo();
    const stems = 11 + Math.floor(R() * 4);
    const masses = [];
    for (let i = 0; i < stems; i++) {
      const a = (i / stems) * TAU + (R() - 0.5) * 0.5, lean = 0.28 + R() * 0.22;
      const h = 2.5 + R() * 1.1;
      const s = V(Math.cos(a) * 0.15, -0.05, Math.sin(a) * 0.15);
      const e = V(Math.cos(a) * h * lean, h, Math.sin(a) * h * lean);
      base.tube(stemPts(R, s, e, 5, 0.05), 0.03, 0.01, lin(0x9a8466), { sides: 5, colorEnd: lin(0x7a6a52), sway: swayH(3.4, 0.5) });
      if (i % 2 === 0) masses.push(V(e.x * 0.85, e.y - 0.3 - R() * 0.3, e.z * 0.85));
      if (i % 3 === 0) masses.push(V(e.x * 0.55, e.y * 0.55 + R() * 0.2, e.z * 0.55));
    }
    for (const c0 of masses) {
      for (let k = 0; k < 1; k++) {
        const c = c0.clone().add(V((R() - 0.5) * 0.3, (R() - 0.5) * 0.2, (R() - 0.5) * 0.3));
        const r = [0.52 + R() * 0.2, 0.4 + R() * 0.1, 0.52 + R() * 0.2];
        foliage(base, R, c, r, { top: lin(0x90bc58), bottom: lin(0x46723a), cell: 0, size: 0.4, sway: swayH(3.4, 0.6), core: false, density: 1.3 });
        for (let n = 0; n < 3; n++) {
          if (R() < 0.3) continue;
          const a = R() * TAU, y = -0.6 + R() * 0.8;
          const kk = Math.sqrt(1 - y * y);
          const p = V(c.x + Math.cos(a) * kk * r[0] * 1.02, c.y + y * r[1], c.z + Math.sin(a) * kk * r[2] * 1.02);
          const count = 2 + Math.floor(R() * 2);
          for (let j = 0; j < count; j++) {
            const ja = (j / count) * TAU + R();
            const np = p.clone().add(V(Math.cos(ja) * 0.04, -0.03, Math.sin(ja) * 0.04));
            const tilt = quatTo(V(Math.cos(ja) * 0.5, -1, Math.sin(ja) * 0.5));
            nuts.ellipsoid(np, [0.03, 0.038, 0.03], tilt, lin(R() < 0.6 ? 0xc49a52 : 0xb8bc68), { detail: 1, sway: swayH(3.4, 0.8) });
            // the ragged green husk around the top of each nut
            nuts.lathe(np.clone().add(V(0, 0.018, 0)), [[0.018, -0.008], [0.038, 0.012], [0.044, 0.032], [0.024, 0.038]], lin(0x9cbc5a), { sides: 7, quat: tilt.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI)), sway: swayH(3.4, 0.8) });
          }
        }
      }
    }
    return { base, crops: { hazelnut: nuts } };
  },

  // 24 — sweet chestnut: the tree is the world's; these are the spiky husks on the
  // ground beneath it, some split open on glossy brown nuts. A little leaf litter is
  // the base so a picked spot still looks lived in.
  24(R) {
    const base = new Geo(), husks = new Geo();
    // long, toothed chestnut leaves fallen in the grass, gold to rust
    litter(base, R, 46, 0.9, 3.6, [lin(0xc49a3a), lin(0xb0702a), lin(0x8a5a26), lin(0xa8a040)], { len: 0.16 });
    for (let i = 0; i < 18; i++) {
      const a = R() * TAU, d = 0.9 + R() * 2.4;
      const c = V(Math.cos(a) * d, 0.07, Math.sin(a) * d);
      const open = R() < 0.55;
      const col = open ? lin(0xb4a64c) : lin(0xa4c24c);
      husks.sphere(c, 0.075, col, { detail: 1, squash: 0.85 });
      // spines
      for (let s2 = 0; s2 < 30; s2++) {
        const u = R() * 2 - 1, th = R() * TAU, k = Math.sqrt(1 - u * u);
        const dir = V(Math.cos(th) * k, Math.abs(u) * 0.9 + 0.1 * u, Math.sin(th) * k);
        if (open && dir.y > 0.5) continue;
        husks.cone(c.clone().add(dir.clone().multiplyScalar(0.06)), 0.008, 0.05, mixc(col, lin(0xe8d878), 0.35), { sides: 3, quat: quatTo(dir) });
      }
      if (open) {
        for (let n = 0; n < 2; n++) {
          const na = R() * TAU;
          husks.ellipsoid(c.clone().add(V(Math.cos(na) * 0.022, 0.05, Math.sin(na) * 0.022)), [0.036, 0.03, 0.026], new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), na), lin(0x7a4220), { detail: 1, shade: 0.4 });
        }
      }
    }
    return { base, crops: { chestnut: husks } };
  },

  // 25 — nettle: a bed of upright stems with pairs of toothed, heart-shaped leaves;
  // the soft pale tops are the part worth picking.
  25(R) {
    const base = new Geo(), tops = new Geo();
    const stems = 16 + Math.floor(R() * 6);
    for (let i = 0; i < stems; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * 0.55;
      const o = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      const h = 0.65 + R() * 0.35;
      const top = o.clone().add(V((R() - 0.5) * 0.12, h, (R() - 0.5) * 0.12));
      base.tube(stemPts(R, o, top, 4, 0.03), 0.009, 0.005, lin(0x4f7030), { sides: 4, sway: swayH(1, 0.8) });
      const pairs = 4;
      for (let k = 1; k <= pairs; k++) {
        const t = k / (pairs + 1.5);
        const p = o.clone().lerp(top, t);
        const rot = k * Math.PI / 2 + a;
        for (const s of [0, Math.PI]) {
          const dir = V(Math.cos(rot + s), -0.15, Math.sin(rot + s));
          base.leaf(p, dir, 0.17 - t * 0.05, 0.11 - t * 0.03, lin(0x3a6a2c), lin(0x5e9240), { shape: 'heart', serrate: 0.25, droop: 0.4, sway: swayH(1, 0.9) });
        }
      }
      // the fresh top: a tuft of small, light leaves
      for (let k = 0; k < 4; k++) {
        const dir = V(Math.cos(a + k * 1.6), 0.9, Math.sin(a + k * 1.6));
        tops.leaf(top.clone().add(V(0, -0.03, 0)), dir, 0.08, 0.055, lin(0x7cb24a), lin(0xb0dc6a), { shape: 'heart', serrate: 0.22, droop: 0.1, sway: swayH(1, 1) });
      }
      tops.sphere(top.clone(), 0.024, lin(0xa0d060), { detail: 0, sway: swayH(1, 1) });
    }
    return { base, crops: { nettle: tops } };
  },

  // 26 — wild garlic: a carpet of broad, glossy leaves with balls of white star flowers.
  26(R) {
    const base = new Geo(), bloom = new Geo();
    const plants = 28 + Math.floor(R() * 8);
    for (let i = 0; i < plants; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * 0.85;
      const o = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      const leaves = 2 + Math.floor(R() * 2);
      for (let k = 0; k < leaves; k++) {
        const la = R() * TAU;
        const dir = V(Math.cos(la), 1.3 + R() * 0.6, Math.sin(la));
        const target = k === 0 && i % 3 === 0 ? bloom : base;
        target.leaf(o, dir, 0.28 + R() * 0.08, 0.1, lin(0x4a9a36), lin(0x7cc850), { shape: 'lance', droop: 0.55, sway: 0.6, fold: 0.3 });
      }
      if (i % 2 === 0) {
        const top = o.clone().add(V((R() - 0.5) * 0.06, 0.28 + R() * 0.08, (R() - 0.5) * 0.06));
        bloom.tube([o, top], 0.004, 0.003, lin(0x6a9a40), { sides: 3, sway: 0.8 });
        for (let f = 0; f < 12; f++) {
          const u = R() * 2 - 1, th = R() * TAU, k = Math.sqrt(1 - u * u);
          const dir = V(Math.cos(th) * k, Math.abs(u) * 0.8 + 0.2, Math.sin(th) * k);
          flower(bloom, top.clone().add(dir.clone().multiplyScalar(0.03)), 0.02, lin(0xffffff), lin(0xf0f2d8), { petals: 6, up: dir, sway: 0.9, centreR: 0.2 });
        }
      }
    }
    return { base, crops: { wild_garlic: bloom } };
  },

  // 27 — water mint: upright square stems with oval leaves flushed purple and lilac
  // whorls of flowers at the tips.
  27(R) {
    const base = new Geo(), tips = new Geo();
    const stems = 8 + Math.floor(R() * 5);
    for (let i = 0; i < stems; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * 0.35;
      const o = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      const h = 0.38 + R() * 0.2;
      const top = o.clone().add(V((R() - 0.5) * 0.08, h, (R() - 0.5) * 0.08));
      base.tube(stemPts(R, o, top, 3, 0.02), 0.006, 0.004, lin(0x5a3a48), { sides: 4, sway: swayH(0.6, 0.8) });
      for (let k = 1; k <= 3; k++) {
        const p = o.clone().lerp(top, k / 4.2);
        const rot = a + k * Math.PI / 2;
        for (const s of [0, Math.PI]) base.leaf(p, V(Math.cos(rot + s), 0.1, Math.sin(rot + s)), 0.09, 0.06, lin(0x3a6038), lin(0x6a8050), { serrate: 0.12, droop: 0.3, sway: swayH(0.6, 0.9) });
      }
      for (let k = 0; k < 4; k++) tips.leaf(top.clone().add(V(0, -0.04, 0)), V(Math.cos(a + k * 1.57), 0.5, Math.sin(a + k * 1.57)), 0.05, 0.035, lin(0x4a6a3a), lin(0x6e8a52), { serrate: 0.1, sway: swayH(0.6, 1) });
      tips.sphere(top.clone().add(V(0, 0.02, 0)), 0.032, lin(0xb79ad6), { detail: 1, squash: 1.15, sway: swayH(0.6, 1), shade: 0.3 });
      tips.sphere(top.clone().add(V(0, -0.035, 0)), 0.022, lin(0xa98ac8), { detail: 0, sway: swayH(0.6, 1) });
    }
    return { base, crops: { water_mint: tips } };
  },

  // 28 — chamomile: low, feathery, finely cut foliage and a scatter of daisies.
  28(R) {
    const base = new Geo(), heads = new Geo();
    const clumps = 4 + Math.floor(R() * 3);
    for (let c = 0; c < clumps; c++) {
      const a = R() * TAU, d = Math.sqrt(R()) * 0.32;
      const o = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      for (let i = 0; i < 14; i++) {
        const la = R() * TAU;
        base.leaf(o, V(Math.cos(la), 0.9 + R() * 0.8, Math.sin(la)), 0.12 + R() * 0.06, 0.02, lin(0x4f7e34), lin(0x86b456), { shape: 'needle', droop: 0.4, sway: 0.6, segs: 3 });
      }
      const n = 3 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const fa = R() * TAU, fr = R() * 0.08;
        const top = o.clone().add(V(Math.cos(fa) * fr, 0.2 + R() * 0.12, Math.sin(fa) * fr));
        heads.tube([o.clone(), o.clone().lerp(top, 0.5).add(V((R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.03)), top], 0.003, 0.002, lin(0x6a9a40), { sides: 3, sway: 0.8 });
        const up = V((R() - 0.5) * 0.5, 1, (R() - 0.5) * 0.5).normalize();
        flower(heads, top, 0.026, lin(0xfbfbf4), null, { petals: 12, up, sway: 0.9, cup: -0.1 });
        heads.sphere(top.clone().add(up.clone().multiplyScalar(0.008)), 0.011, lin(0xf2c230), { detail: 1, squash: 0.9, sway: 0.9 });
      }
    }
    return { base, crops: { chamomile: heads } };
  },

  // 29 — young pine: a little conifer in tiers, with pale new candles at the tips.
  29(R) {
    const base = new Geo(), tips = new Geo();
    const h = 1.6 + R() * 0.5;
    base.tube([V(0, -0.05, 0), V(0, h * 0.5, 0), V(0, h, 0)], 0.045, 0.012, lin(0x7a5a40), { sides: 5, sway: swayH(h, 0.4) });
    const whorls = 5;
    for (let t = 0; t < whorls; t++) {
      const y = 0.22 + (t / whorls) * (h - 0.4);
      const len = (0.7 - t * 0.11) * (0.9 + R() * 0.2);
      const k = 5 + Math.floor(R() * 2);
      for (let i = 0; i < k; i++) {
        const a = (i / k) * TAU + R() * 0.5 + t * 0.7;
        const dir = V(Math.cos(a), 0.28 + R() * 0.15, Math.sin(a)).normalize();
        const tip = V(0, y, 0).add(dir.clone().multiplyScalar(len));
        base.tube([V(0, y, 0), V(0, y, 0).lerp(tip, 0.5).add(V(0, -0.03, 0)), tip], 0.016, 0.006, lin(0x6a5038), { sides: 4, sway: swayH(h, 0.5) });
        // tufts of needles along the branch
        for (let n = 1; n <= 3; n++) {
          const p = V(0, y, 0).lerp(tip, 0.3 + n * 0.23);
          base.cards(p, [0.1, 0.07, 0.1], 3, lin(0x4e8048), lin(0x1e4428), { R, cell: 2, size: 0.26, sway: swayH(h, 0.6) });
        }
        // the bright new candle at the tip
        tips.cone(tip.clone().add(dir.clone().multiplyScalar(-0.01)), 0.02, 0.1 + R() * 0.04, lin(0xb8d870), { sides: 5, quat: quatTo(V(dir.x * 0.5, 1, dir.z * 0.5)), colorTop: lin(0xeef6b8), sway: swayH(h, 0.7) });
      }
    }
    base.cards(V(0, h - 0.15, 0), [0.12, 0.18, 0.12], 6, lin(0x5a9050), lin(0x2a5030), { R, cell: 2, size: 0.24, sway: swayH(h, 0.7) });
    tips.cone(V(0, h - 0.02, 0), 0.026, 0.16, lin(0xb8d870), { sides: 5, colorTop: lin(0xeef6b8), sway: swayH(h, 0.7) });
    return { base, crops: { pine_tips: tips } };
  },

    // 30 — chanterelles: golden funnel caps with wavy rims in a cushion of moss.
  30(R) {
    const base = new Geo(), caps = new Geo();
    base.blob(V(0, 0, 0), [0.36, 0.05, 0.3], lin(0x6e9a3e), C.mossDark, { seed: R() * 1e6, lump: 0.3, soft: 0.3, flatBottom: true });
    litter(base, R, 16, 0.15, 0.5, [lin(0x9a6a30), lin(0x7a5a2a), lin(0xa88a3a)], { len: 0.06, y: 0.02 });
    const n = 6 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * 0.3;
      const p = V(Math.cos(a) * d, 0.02, Math.sin(a) * d);
      const s = 0.75 + R() * 0.6;
      const tilt = quatTo(V((R() - 0.5) * 0.4, 1, (R() - 0.5) * 0.4));
      const prof = [[0.006, 0], [0.008, 0.02], [0.014, 0.04], [0.032, 0.058], [0.046, 0.066], [0.044, 0.07], [0.022, 0.064], [0.004, 0.06]];
      caps.lathe(p, prof.map(([r, y]) => [r * s, y * s]), (pp, nn) => mixc(lin(0xd08a1c), lin(0xf6c24a), 0.4 + 0.6 * Math.max(0, nn.y)), { sides: 9, quat: tilt });
    }
    return { base, crops: { chanterelle: caps } };
  },

  // 31 — penny bun: a couple of fat boletes with brown bun caps in leaf litter.
  31(R) {
    const base = new Geo(), caps = new Geo();
    base.blob(V(0.08, 0.0, -0.05), [0.18, 0.04, 0.15], lin(0x6e9a3e), C.mossDark, { seed: R() * 1e6, lump: 0.3, soft: 0.3, flatBottom: true });
    litter(base, R, 22, 0.05, 0.45, [lin(0xb07a30), lin(0x8a5a26), lin(0xc49a3a), lin(0x6a4a22)], { len: 0.06 });
    const n = 2 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + R(), d = 0.08 + R() * 0.12;
      const p = V(Math.cos(a) * d, 0.0, Math.sin(a) * d);
      const s = 0.8 + R() * 0.5;
      // the bulbous, pale netted stem
      caps.lathe(p, [[0.026, 0], [0.036, 0.02], [0.034, 0.05], [0.026, 0.075], [0.022, 0.085]].map(([r, y]) => [r * s, y * s]), (pp, nn) => mixc(lin(0xc8b48a), lin(0xece0c2), 0.5 + 0.5 * nn.y), { sides: 9 });
      // the cap: a fat brown bun over a creamy sponge
      caps.lathe(p.clone().add(V(0, 0.078 * s, 0)), [[0.002, -0.004], [0.04, -0.006], [0.062, 0.004], [0.066, 0.016], [0.056, 0.036], [0.032, 0.05], [0.002, 0.054]].map(([r, y]) => [r * s, y * s]),
        (pp, nn, l) => (l.y < 0 ? lin(0xe6d6a0) : mixc(lin(0x744424), lin(0xb07a44), 0.3 + 0.7 * Math.max(0, nn.y))), { sides: 11 });
    }
    return { base, crops: { penny_bun: caps } };
  },

  // 32 — sea buckthorn: a silvery, thorny coastal shrub with crowded orange berries.
  32(R) {
    const base = new Geo(), berries = new Geo();
    const stems = 6 + Math.floor(R() * 3);
    for (let i = 0; i < stems; i++) {
      const a = (i / stems) * TAU + R() * 0.5;
      const h = 1.5 + R() * 0.6, lean = 0.3 + R() * 0.25;
      const s = V(0, -0.05, 0), e = V(Math.cos(a) * h * lean, h, Math.sin(a) * h * lean);
      const pts = stemPts(R, s, e, 5, 0.08);
      base.tube(pts, 0.03, 0.01, lin(0x6a5a4a), { sides: 4, sway: swayH(2, 0.6) });
      for (let k = 2; k <= 5; k++) {
        const p = pts[k];
        const c = p.clone().add(V((R() - 0.5) * 0.15, 0.05, (R() - 0.5) * 0.15));
        const r = [0.26 + R() * 0.1, 0.2, 0.26 + R() * 0.1];
        foliage(base, R, c, r, { top: lin(0xb4c4a6), bottom: lin(0x5a6e56), cell: 2, size: 0.26, sway: swayH(2, 0.7) });
        // berries packed along the twigs
        for (let b = 0; b < 16; b++) {
          const ba = R() * TAU, by = -0.6 + R() * 1.0;
          const kk = Math.sqrt(Math.max(0, 1 - by * by));
          berries.sphere(V(c.x + Math.cos(ba) * kk * r[0] * 0.98, c.y + by * r[1], c.z + Math.sin(ba) * kk * r[2] * 0.98), 0.017, lin(R() < 0.8 ? 0xf08a1a : 0xf2a42c), { detail: 0, sway: swayH(2, 0.8), shade: 0.2 });
        }
      }
    }
    return { base, crops: { sea_buckthorn: berries } };
  },

  // 33 — samphire: jointed, fleshy, sea-green shoots like tiny candelabra.
  33(R) {
    const base = new Geo(), shoots = new Geo();
    const clumps = 5 + Math.floor(R() * 4);
    for (let c = 0; c < clumps; c++) {
      const a = R() * TAU, d = Math.sqrt(R()) * 0.4;
      const o = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      base.blob(o.clone().add(V(0, 0.015, 0)), [0.06, 0.03, 0.06], lin(0x6a8a4a), lin(0x3e5a30), { seed: R() * 1e6, detail: 0, lump: 0.3 });
      const n = 3 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const sa = R() * TAU;
        const h = 0.14 + R() * 0.1;
        const top = o.clone().add(V(Math.cos(sa) * 0.05, h, Math.sin(sa) * 0.05));
        const joints = 4;
        const pts = [];
        for (let j = 0; j <= joints; j++) pts.push(o.clone().lerp(top, j / joints));
        shoots.tube(pts, 0.011, 0.007, lin(0x6c9e4a), { sides: 5, colorEnd: lin(0x9cc66a), sway: 0.5 });
        for (let j = 1; j < joints; j++) shoots.sphere(pts[j], 0.012, lin(0x5a8a3e), { detail: 0, squash: 0.6, sway: 0.5 });
        for (const s of [-1, 1]) {
          const b0 = pts[2];
          const bt = b0.clone().add(V(Math.cos(sa + s * 1.4) * 0.05, 0.06, Math.sin(sa + s * 1.4) * 0.05));
          shoots.tube([b0, b0.clone().lerp(bt, 0.5).add(V(0, -0.01, 0)), bt], 0.008, 0.006, lin(0x6c9e4a), { sides: 4, colorEnd: lin(0xa0c870), sway: 0.6 });
        }
      }
    }
    return { base, crops: { samphire: shoots } };
  },

  // 34 — cloudberry: round, lobed leaves on single stalks with amber berries.
  34(R) {
    const base = new Geo(), fruit = new Geo();
    const n = 7 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * 0.4;
      const o = V(Math.cos(a) * d, 0, Math.sin(a) * d);
      const top = o.clone().add(V(0, 0.1 + R() * 0.05, 0));
      base.tube([o, top], 0.004, 0.003, lin(0x5c7a3a), { sides: 3, sway: 0.4 });
      // a round, five-lobed leaf held flat
      const la = R() * TAU;
      for (let l = 0; l < 5; l++) base.leaf(top, V(Math.cos(la + l * TAU / 5), -0.05, Math.sin(la + l * TAU / 5)), 0.06, 0.07, lin(0x3e6a30), lin(0x6c9a48), { shape: 'round', serrate: 0.12, droop: 0.15, sway: 0.5 });
      if (i % 2 === 0) {
        const bt = o.clone().add(V((R() - 0.5) * 0.08, 0.17 + R() * 0.04, (R() - 0.5) * 0.08));
        fruit.tube([o.clone(), bt], 0.003, 0.002, lin(0x6a7a3a), { sides: 3, sway: 0.6 });
        drupe(fruit, bt.clone().add(V(0, 0.016, 0)), 0.03, lin(R() < 0.7 ? 0xf0a23a : 0xe8823a), R, 9, 0.6);
        fruit.sphere(bt.clone().add(V(0, 0.002, 0)), 0.012, lin(0x5c7a34), { detail: 0, squash: 0.4, sway: 0.6 });
      }
    }
    return { base, crops: { cloudberry: fruit } };
  },

  // 35 — wild thyme: a low cushion of tiny dark leaves hazed with mauve flowers.
  35(R) {
    const base = new Geo(), bloom = new Geo();
    const mats = 3 + Math.floor(R() * 2);
    for (let m = 0; m < mats; m++) {
      const a = R() * TAU, d = R() * 0.3;
      const c = V(Math.cos(a) * d, 0.015, Math.sin(a) * d);
      const r = [0.26 + R() * 0.12, 0.06, 0.22 + R() * 0.1];
      base.blob(c, r, lin(0x5a7a3e), lin(0x2c4424), { seed: R() * 1e6, lump: 0.35, soft: 0.45, flatBottom: true });
      for (let f = 0; f < 34; f++) {
        const fa = R() * TAU, fr = Math.sqrt(R()) * 0.92;
        const p = V(c.x + Math.cos(fa) * fr * r[0], c.y + r[1] * (0.75 - fr * fr * 0.6) + 0.012, c.z + Math.sin(fa) * fr * r[2]);
        bloom.sphere(p, 0.013 + R() * 0.006, lin(R() < 0.6 ? 0xb67ab8 : 0xd29ad0), { detail: 0, squash: 0.8, sway: 0.2 });
      }
    }
    return { base, crops: { wild_thyme: bloom } };
  },
};

/**
 * Facts the renderer needs per kind:
 *   k        drawing exaggeration: low herbs are drawn larger than life so they read
 *            above the meadow grass (stylised, contract §10); applied to the scale
 *   radius   rough outer radius at scale 1 (interaction reach, culling)
 *   pickY    height of the pickable part at scale 1 (where the player looks to pick)
 *   view     metres beyond which the plant is not drawn
 *   hidden   seasons (0..3) in which nothing is drawn (the plant has died back)
 *   unknown  what the plant looks like to someone who has not found it yet
 */
export const KIND_INFO = {
  18: { k: 1.0, radius: 1.4, pickY: 0.7, view: 150, hidden: [], unknown: 'Thorny thicket' },
  19: { k: 1.8, radius: 0.5, pickY: 0.08, view: 70, hidden: [3], unknown: 'Low trefoil patch' },
  20: { k: 1.3, radius: 0.65, pickY: 0.25, view: 90, hidden: [], unknown: 'Low shrublets' },
  21: { k: 1.0, radius: 1.6, pickY: 1.9, view: 170, hidden: [], unknown: 'Pale-barked shrub' },
  22: { k: 1.0, radius: 1.4, pickY: 1.1, view: 150, hidden: [], unknown: 'Arching thorny shrub' },
  23: { k: 1.0, radius: 1.5, pickY: 2.0, view: 170, hidden: [], unknown: 'Many-stemmed shrub' },
  24: { k: 1.0, radius: 1.2, pickY: 0.05, view: 90, hidden: [], unknown: 'Spiny husks under a tree' },
  25: { k: 1.15, radius: 0.7, pickY: 0.75, view: 100, hidden: [3], unknown: 'Bed of tall, toothed leaves' },
  26: { k: 1.35, radius: 0.9, pickY: 0.2, view: 100, hidden: [2, 3], unknown: 'Carpet of broad leaves' },
  27: { k: 1.45, radius: 0.45, pickY: 0.45, view: 80, hidden: [3], unknown: 'Fragrant waterside plant' },
  28: { k: 1.7, radius: 0.4, pickY: 0.25, view: 70, hidden: [3], unknown: 'Little white daisies' },
  29: { k: 1.0, radius: 0.7, pickY: 1.2, view: 150, hidden: [], unknown: 'Young conifer' },
  30: { k: 2.0, radius: 0.4, pickY: 0.05, view: 60, hidden: [], unknown: 'Mossy patch' },
  31: { k: 1.7, radius: 0.4, pickY: 0.08, view: 60, hidden: [], unknown: 'Patch of leaf litter' },
  32: { k: 1.0, radius: 1.2, pickY: 1.1, view: 150, hidden: [], unknown: 'Silvery thorny shrub' },
  33: { k: 1.6, radius: 0.45, pickY: 0.12, view: 70, hidden: [3], unknown: 'Fleshy green shoots' },
  34: { k: 1.7, radius: 0.45, pickY: 0.15, view: 70, hidden: [3], unknown: 'Low, lobed leaves' },
  35: { k: 1.6, radius: 0.45, pickY: 0.06, view: 70, hidden: [], unknown: 'Low fragrant mat' },
};

/**
 * Per-kind base tint by season (multiplied into the vertex colours): broadleaf shrubs
 * warm up in autumn and go dull in winter; evergreens hardly change.
 */
const SEASON_TINT = {
  deciduous: [[0.98, 1.05, 0.92], [1, 1, 1], [1.75, 1.0, 0.42], [1.05, 0.72, 0.5]],
  semi: [[1, 1.03, 0.95], [1, 1, 1], [1.25, 0.92, 0.7], [1.0, 0.82, 0.74]],
  herb: [[1.02, 1.06, 0.92], [1, 1, 1], [1.35, 0.98, 0.55], [0.95, 0.8, 0.6]],
  ever: [[1, 1.02, 1], [1, 1, 1], [1, 0.97, 0.94], [0.92, 0.94, 0.96]],
  ground: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [0.92, 0.92, 0.94]],
};
const TINT_CLASS = {
  18: 'semi', 19: 'herb', 20: 'deciduous', 21: 'deciduous', 22: 'deciduous', 23: 'deciduous', 24: 'ground',
  25: 'herb', 26: 'herb', 27: 'herb', 28: 'herb', 29: 'ever', 30: 'ground', 31: 'ground', 32: 'semi', 33: 'herb', 34: 'herb', 35: 'ever',
};

/** The base tint [r, g, b] for a kind in a season. */
export function seasonTint(kind, season) {
  return SEASON_TINT[TINT_CLASS[kind] || 'ground'][season & 3];
}

/** Builds the model of a kind + variant: {base: BufferGeometry|null, crops: {item: BufferGeometry}}. */
export function buildPlant(kind, variant) {
  const build = BUILDERS[kind];
  if (!build) return null;
  const R = rng(kind * 1009 + variant * 7907 + 17);
  const { base, crops } = build(R);
  const out = { base: base && base.vertexCount ? base.build() : null, crops: {} };
  for (const [item, g] of Object.entries(crops)) if (g.vertexCount) out.crops[item] = g.build();
  return out;
}

export const PLANT_KINDS = Object.keys(BUILDERS).map(Number);
