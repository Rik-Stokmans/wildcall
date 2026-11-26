// Geometry of branching trees, built from the server's tree models (welcome.trees,
// proto.TreeModel). Pure: no three.js, no DOM — plain typed arrays that forest.js
// wraps in BufferGeometries.
//
// Model space: metres at scale 1, Y up, trunk base at the origin. Branches[0] is the
// trunk base (parent -1); every other segment starts exactly at its parent's end B.
//
// Wood: segments are joined into chains — each segment continues into its thickest
// child — and every chain is one tube whose rings are shared at the joints, so limbs
// flow into each other without seams. Side chains start on the parent's axis (inside
// the parent's wood) and grow out of it. The rings use parallel-transported frames
// (no twisting) and mitred radii at bends (constant thickness through a bend).
//
// Foliage: every TreeLeaf ellipsoid becomes a cloud of leaf cards — small quads that
// the shader turns to face the camera (attribute `aCard` holds the corner offset in
// card space). Their normals come from the ellipsoid (blended towards the crown's
// centre and the sky), so each mass shades as one soft rounded form.
//
// Extra per-vertex attribute `aTree` (vec4) for the wind/season shader:
//   x  sway   0 at the root flare … 1 at the top of the tree
//   y  leaf   1 = foliage (seasonal tint, flutter), 0 = wood
//   z  phase  per foliage mass, 0..1 (masses move independently)
//   w  rand   per card, 0..1 (winter thinning, shimmer)
//
// Levels of detail (`detail`): 3 giant (the Old Oak: more, smaller cards), 2 near,
// 1 mid, 0 far — the same silhouette and colours with ever fewer, larger cards and
// only the thicker limbs.
import { rng, mix, scale } from '../color.js';
import { barkColor, SNOW } from './treeStyle.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const DETAIL = Object.freeze({ FAR: 0, MID: 1, NEAR: 2, GIANT: 3 });

/** How far below the ground the trunk continues so it never floats on a slope (m). */
export const ROOT_DEPTH = 0.7;

// --- vectors -------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
function norm(a) { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; }

/** Cheap repeatable hash of a position, in [0, 1). */
function hash3(x, y, z, s = 0) {
  const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453;
  return v - Math.floor(v);
}

// --- instance placement ------------------------------------------------------------------
/**
 * A model point in the world, placed like the server places it (internal/world
 * treeperch.go xform.apply): uniform scale, rotation about Y (three.js convention),
 * then translation. x' = x·cos + z·sin, z' = −x·sin + z·cos.
 * @param {number[]} p  model point
 * @param {{x:number, y:number, z:number, scale:number, rot:number}} inst
 * @returns {number[]}
 */
export function placePoint(p, inst) {
  const c = Math.cos(inst.rot), s = Math.sin(inst.rot), k = inst.scale;
  return [inst.x + k * (c * p[0] + s * p[2]), inst.y + k * p[1], inst.z + k * (-s * p[0] + c * p[2])];
}

/**
 * Writes the column-major instance matrix for the same placement (the exact
 * uniform scale — never jittered, or birds would float beside the limbs).
 */
export function writeInstanceMatrix(out, o, x, y, z, scale, rot) {
  const c = Math.cos(rot) * scale, s = Math.sin(rot) * scale;
  out[o] = c; out[o + 1] = 0; out[o + 2] = -s; out[o + 3] = 0;
  out[o + 4] = 0; out[o + 5] = scale; out[o + 6] = 0; out[o + 7] = 0;
  out[o + 8] = s; out[o + 9] = 0; out[o + 10] = c; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

// --- model normalisation -------------------------------------------------------------------
/**
 * Validates a wire model and returns it in a uniform shape (leaves may be null on
 * the wire for snags). Throws on structurally broken data.
 */
export function prepareModel(m) {
  if (!m || !Array.isArray(m.branches) || !m.branches.length) throw new Error('tree model without branches');
  const branches = m.branches.map((b, i) => {
    const parent = i === 0 ? -1 : b.parent | 0;
    if (i > 0 && !(parent >= 0 && parent < i)) throw new Error(`tree model ${m.kind}/${m.variant}: bad parent at ${i}`);
    return { a: [+b.a[0], +b.a[1], +b.a[2]], b: [+b.b[0], +b.b[1], +b.b[2]], ra: Math.max(0.004, +b.ra), rb: Math.max(0.003, +b.rb), parent };
  });
  const leaves = (m.leaves || []).map((l) => ({ c: [+l.c[0], +l.c[1], +l.c[2]], r: [Math.max(0.05, +l.r[0]), Math.max(0.05, +l.r[1]), Math.max(0.05, +l.r[2])] }));
  let height = +m.height || 0;
  for (const b of branches) height = Math.max(height, b.b[1]);
  for (const l of leaves) height = Math.max(height, l.c[1] + l.r[1]);
  return { kind: m.kind | 0, variant: m.variant | 0, height, branches, leaves };
}

/**
 * Splits the segments into chains: each chain follows a segment into its thickest
 * child (ties: the straightest). Returns the chains (arrays of segment indices) with
 * the chain each one sprouts from (-1 for the trunk).
 */
export function woodChains(model) {
  const segs = model.branches;
  const kids = segs.map(() => []);
  for (let i = 1; i < segs.length; i++) kids[segs[i].parent].push(i);
  const dir = (s) => norm(sub(s.b, s.a));
  const chains = [];
  const start = [{ seg: 0, from: -1 }];
  while (start.length) {
    const { seg, from } = start.shift();
    const chain = [];
    let cur = seg;
    for (;;) {
      chain.push(cur);
      const ks = kids[cur];
      if (!ks.length) break;
      const d = dir(segs[cur]);
      let best = ks[0];
      for (const k of ks) {
        const a = segs[k], b = segs[best];
        if (a.ra > b.ra + 1e-6 || (Math.abs(a.ra - b.ra) <= 1e-6 && dot(dir(a), d) > dot(dir(b), d))) best = k;
      }
      const idx = chains.length;
      for (const k of ks) if (k !== best) start.push({ seg: k, from: idx });
      cur = best;
    }
    chains.push({ segs: chain, from });
  }
  return chains;
}

// --- a growable mesh -------------------------------------------------------------------------
class Mesh {
  constructor(cards) {
    this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.tree = []; this.idx = [];
    this.card = cards ? [] : null;
  }
  get count() { return this.pos.length / 3; }
  v(p, n, c, u, v, tree, card) {
    this.pos.push(p[0], p[1], p[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.nrm.push(n[0] / l, n[1] / l, n[2] / l);
    this.col.push(c[0], c[1], c[2]);
    this.uv.push(u, v);
    this.tree.push(tree[0], tree[1], tree[2], tree[3]);
    if (this.card) this.card.push(card[0], card[1]);
    return this.count - 1;
  }
  build(extra = {}) {
    const n = this.count;
    let minY = Infinity, maxY = -Infinity, radius = 0;
    for (let i = 0; i < n; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      // Cards reach half their diagonal beyond their centre.
      const pad = this.card ? Math.hypot(this.card[i * 2], this.card[i * 2 + 1]) : 0;
      if (y - pad < minY) minY = y - pad;
      if (y + pad > maxY) maxY = y + pad;
      const d = Math.hypot(x, z) + pad;
      if (d > radius) radius = d;
    }
    if (!n) { minY = 0; maxY = 0; }
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      color: new Float32Array(this.col),
      uv: new Float32Array(this.uv),
      tree: new Float32Array(this.tree),
      card: this.card ? new Float32Array(this.card) : null,
      index: n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
      vertexCount: n,
      triangleCount: this.idx.length / 3,
      minY, maxY, radius,
      ...extra,
    };
  }
}

/** Sway weight of a point: rooted below a tenth of the height, freest at the top. */
export function swayAt(y, height) {
  return Math.pow(clamp01((y - height * 0.1) / (height * 0.9)), 1.4);
}

// --- wood ----------------------------------------------------------------------------------------
/** Ring sides for a limb radius at a detail level. */
export function sidesFor(r, detail) {
  // Near: a couple more sides on the thick wood (the near band is short now, so the
  // trunk silhouette is smooth up close without costing much).
  if (detail >= DETAIL.NEAR) return r >= 0.3 ? 14 : r >= 0.13 ? 10 : r >= 0.06 ? 7 : r >= 0.025 ? 4 : 3;
  if (detail === DETAIL.MID) return r >= 0.2 ? 6 : r >= 0.08 ? 4 : 3;
  return r >= 0.25 ? 4 : 3;
}

/** Coarse levels stop a chain after the first segment thinner than this (m). */
export function tipCutRadius(detail) {
  return detail >= DETAIL.NEAR ? 0 : detail === DETAIL.MID ? 0.025 : 0.11;
}

/** Thinnest chain (radius at its start) drawn at a detail level. */
export function minChainRadius(detail) {
  return detail >= DETAIL.NEAR ? 0 : detail === DETAIL.MID ? 0.05 : 0.22;
}

/**
 * Builds the wood of a model.
 * @param {ReturnType<typeof prepareModel>} model
 * @param {object} style  treeStyle(kind)
 * @param {number} detail DETAIL.*
 * @returns mesh arrays plus `rings` [{c, r, start, sides, chain}] and `chains`
 */
export function buildWood(model, style, detail) {
  const segs = model.branches;
  const H = model.height || 10;
  const bark = style.bark;
  const trunkR = segs[0].ra;
  const chains = woodChains(model);
  const drawn = new Uint8Array(chains.length);
  const m = new Mesh(false);
  const rings = [];
  const minR = minChainRadius(detail);
  // Moss grows on one side of the lower trunk and on top of big limbs.
  const mossDir = norm([Math.cos(model.variant * 2.1 + 0.7), 0, Math.sin(model.variant * 2.1 + 0.7)]);

  chains.forEach((chain, ci) => {
    const first = segs[chain.segs[0]];
    if (chain.from >= 0 && !drawn[chain.from]) return; // its parent chain was skipped
    if (first.ra < minR) return;
    drawn[ci] = 1;
    // Ring centres and radii: the chain start, then every segment end.
    const pts = [first.a.slice()];
    const rad = [first.ra];
    // Coarser levels end a chain where it thins into twigs (hidden by the foliage there).
    const cut = tipCutRadius(detail);
    for (const si of chain.segs) {
      pts.push(segs[si].b.slice()); rad.push(segs[si].rb);
      if (segs[si].rb < cut) break;
    }
    if (ci === 0) { // the trunk continues below the ground, flared a little
      pts.unshift([first.a[0], first.a[1] - ROOT_DEPTH, first.a[2]]);
      rad.unshift(first.ra * 1.12);
    }
    const n = pts.length;
    const dirs = [];
    for (let i = 0; i < n - 1; i++) dirs.push(norm(sub(pts[i + 1], pts[i])));
    const sides = sidesFor(first.ra, detail);
    // Mean of the inscribed and circumscribed polygon: the drawn surface averages r.
    const polyK = 1 + 0.35 * (1 / Math.cos(Math.PI / sides) - 1);
    // Bark texture: around the limb it repeats every ~1.2 m of circumference.
    const around = Math.max(1, Math.round((TAU * first.ra) / 1.2));
    let u0 = null;
    let vAcc = 0;
    const ringStarts = [];
    for (let i = 0; i < n; i++) {
      const dIn = i > 0 ? dirs[i - 1] : dirs[0];
      const dOut = i < n - 1 ? dirs[i] : dirs[n - 2];
      const t = norm(add(dIn, dOut));
      // Mitre: keep the tube's thickness through a bend.
      const miter = Math.min(1.4, 1 / Math.max(0.3, dot(t, dOut)));
      // Parallel transport of the reference direction.
      if (!u0) {
        const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        u0 = norm(cross(ref, t));
      } else {
        u0 = norm(sub(u0, mul(t, dot(u0, t))));
      }
      const v0 = cross(t, u0);
      if (i > 0) vAcc += len(sub(pts[i], pts[i - 1]));
      const r = rad[i] * polyK * miter;
      const c = pts[i];
      const start = m.count;
      ringStarts.push(start);
      rings.push({ c, r: rad[i], start, sides, chain: ci });
      const baseCol = barkColor(bark, c[1], H, rad[i], trunkR);
      const sway = swayAt(c[1], H);
      for (let k = 0; k <= sides; k++) { // the seam column is duplicated for the texture
        const a = (k % sides) / sides * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nrm = [u0[0] * ca + v0[0] * sa, u0[1] * ca + v0[1] * sa, u0[2] * ca + v0[2] * sa];
        const p = [c[0] + nrm[0] * r, c[1] + nrm[1] * r, c[2] + nrm[2] * r];
        let col = scale(baseCol, 0.93 + 0.14 * hash3(p[0], p[1], p[2], ci));
        if (bark.moss) {
          const low = c[1] < 1.6 && dot(nrm, mossDir) > 0.1 - c[1] * 0.25;
          const top = rad[i] > 0.12 && nrm[1] > 0.55;
          if (low || top) col = mix(col, bark.moss, low ? 0.5 * clamp01(1.2 - c[1] / 1.6) + 0.15 : 0.3);
        }
        m.v(p, nrm, col, k / sides * around, vAcc / 1.2, [sway, 0, 0, 0]);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a0 = ringStarts[i], b0 = ringStarts[i + 1];
      for (let k = 0; k < sides; k++) {
        const a = a0 + k, b = a0 + k + 1, c = b0 + k, d = b0 + k + 1;
        m.idx.push(a, b, d, a, d, c);
      }
    }
    // A short rounded tip closes the chain.
    const lastC = pts[n - 1], lastR = rad[n - 1], lastD = dirs[n - 2];
    const tipP = add(lastC, mul(lastD, Math.max(0.004, lastR * 0.9)));
    const tip = m.v(tipP, lastD, barkColor(bark, tipP[1], H, lastR, trunkR), 0.5 * around, (vAcc + lastR) / 1.2, [swayAt(tipP[1], H), 0, 0, 0]);
    const lastStart = ringStarts[n - 1];
    for (let k = 0; k < sides; k++) m.idx.push(lastStart + k, lastStart + k + 1, tip);
  });
  return m.build({ rings, chains });
}

// --- foliage ------------------------------------------------------------------------------------------
/** Approximate surface area of an ellipsoid (Knud Thomsen). */
export function ellipsoidArea(r) {
  const p = 1.6075;
  const a = Math.pow(r[0], p), b = Math.pow(r[1], p), c = Math.pow(r[2], p);
  return 4 * Math.PI * Math.pow((a * b + a * c + b * c) / 3, 1 / p);
}

/** Card size and count for one mass at a detail level. */
export function cardPlan(r, style, detail) {
  const minR = Math.min(r[0], r[1], r[2]);
  const area = ellipsoidArea(r);
  let size = Math.max(0.42, Math.min(style.card, minR * 1.25 + 0.2));
  let count;
  if (detail === DETAIL.FAR) {
    // Far (beyond the mid band, ~110 m on medium): two or three big cards hold a mass's
    // silhouette at that distance.
    size = Math.max(size * 2.7, (r[0] + r[1] + r[2]) / 3 * 1.45);
    count = area > 30 ? 3 : 2;
  } else {
    count = (area / (size * size)) * style.density * 1.6;
    if (detail === DETAIL.MID) { size *= 1.75; count /= 3.4; }
    if (detail === DETAIL.GIANT) { size /= 1.5; count *= 2.2; }
    const cap = detail === DETAIL.GIANT ? 170 : detail === DETAIL.MID ? 26 : 80;
    count = Math.max(detail === DETAIL.MID ? 4 : 8, Math.min(cap, Math.round(count)));
  }
  return { size, count };
}

/** Weighted centre of a model's foliage (the point masses are shaded away from). */
export function crownCentre(model) {
  let w = 0;
  const c = [0, 0, 0];
  for (const l of model.leaves) {
    const v = l.r[0] * l.r[1] * l.r[2];
    c[0] += l.c[0] * v; c[1] += l.c[1] * v; c[2] += l.c[2] * v; w += v;
  }
  return w > 0 ? mul(c, 1 / w) : [0, model.height * 0.65, 0];
}

/**
 * Builds the leaf cards of a model (empty for snags).
 * @returns mesh arrays (with `card`) plus `masses` [{c, r, start, count}]
 */
export function buildFoliage(model, style, detail) {
  const m = new Mesh(true);
  const masses = [];
  const H = model.height || 10;
  if (!model.leaves.length || !style.leaf.length) return m.build({ masses });
  const R = rng(model.kind * 7919 + model.variant * 104729 + detail * 31 + 17);
  const centre = crownCentre(model);
  const flat = style.leafTex === 'needle';
  model.leaves.forEach((leaf, li) => {
    const { size, count } = cardPlan(leaf.r, style, detail);
    const pal = style.leaf[(li + model.variant) % style.leaf.length];
    const gain = 0.9 + R() * 0.2;
    const warm = (R() - 0.5) * 0.12;
    const phase = R();
    const start = m.count;
    const toCrown = norm(sub(leaf.c, centre));
    for (let i = 0; i < count; i++) {
      // A direction on the sphere, a depth biased towards the shell; far cards sit
      // nearer the middle so a few large cards cover the whole mass.
      let u;
      do { u = [R() * 2 - 1, R() * 2 - 1, R() * 2 - 1]; } while (dot(u, u) > 1 || dot(u, u) < 1e-4);
      u = norm(u);
      // Flat pads (pine) spread their cards out to the rim, not up and down.
      if (flat) u = norm([u[0], u[1] * 0.75, u[2]]);
      const f = detail === DETAIL.FAR ? 0.25 + 0.3 * R() : 0.38 + 0.62 * Math.pow(R(), 0.55);
      const p = [leaf.c[0] + u[0] * leaf.r[0] * f, leaf.c[1] + u[1] * leaf.r[1] * f, leaf.c[2] + u[2] * leaf.r[2] * f];
      // Ellipsoid normal, blended towards the crown's outward direction and the sky.
      let n = norm([u[0] / leaf.r[0], u[1] / leaf.r[1], u[2] / leaf.r[2]]);
      n = norm(add(add(mul(n, 0.62), mul(norm(sub(p, centre)), 0.28)), add(mul(toCrown, 0.1), [0, 0.12, 0])));
      // Colour: a warm lit top, a cooler and darker inside and underside.
      const lit = clamp01(0.5 + n[1] * 0.42 + (f - 0.7) * 0.5 + (p[1] - leaf.c[1]) / (leaf.r[1] * 4));
      let col = mix(pal.low, pal.high, Math.pow(lit, 0.9));
      if (n[1] < -0.1) col = [col[0] * 0.88, col[1] * 0.96, col[2] * 1.12];
      col = scale([col[0] * (1 + warm), col[1], col[2] * (1 - warm)], gain * (0.95 + R() * 0.1));
      if (style.snow) {
        const top = clamp01(((p[1] - leaf.c[1]) / leaf.r[1] + 0.15) * 1.6);
        col = mix(col, SNOW, Math.min(0.92, top * 0.95));
      }
      // Needle sprays stay roughly level and flattened, so a pine's pads read as
      // layered horizontal sprays; broad leaf clumps turn any way.
      const ang = flat ? (R() - 0.5) * 0.5 : R() * TAU;
      const ca = Math.cos(ang) * size * 0.5, sa = Math.sin(ang) * size * 0.5;
      const squash = flat ? 0.62 : 1;
      const cell = Math.floor(R() * 4);
      const cu = (cell & 1) * 0.5, cv = (cell >> 1) * 0.5;
      const rand = R();
      const tree = [swayAt(p[1], H), 1, phase, rand];
      const base = m.count;
      // Corners (-1,-1) (1,-1) (1,1) (-1,1), rotated by `ang` in card space.
      const corner = (x, y) => [x * ca - y * sa, (x * sa + y * ca) * squash];
      m.v(p, n, col, cu, cv, tree, corner(-1, -1));
      m.v(p, n, col, cu + 0.5, cv, tree, corner(1, -1));
      m.v(p, n, col, cu + 0.5, cv + 0.5, tree, corner(1, 1));
      m.v(p, n, col, cu, cv + 0.5, tree, corner(-1, 1));
      m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    masses.push({ c: leaf.c, r: leaf.r, start, count });
  });
  return m.build({ masses });
}

/**
 * Signed distance from a model-space point to the wood surface (negative inside a
 * limb): the distance to the nearest segment axis minus the radius there.
 * @returns {{d:number, seg:number}}
 */
export function woodDistance(model, p) {
  let best = Infinity, seg = -1;
  model.branches.forEach((b, i) => {
    const ab = sub(b.b, b.a), ap = sub(p, b.a);
    const L2 = dot(ab, ab);
    const t = L2 > 0 ? clamp01(dot(ap, ab) / L2) : 0;
    const q = add(b.a, mul(ab, t));
    const d = len(sub(p, q)) - (b.ra + (b.rb - b.ra) * t);
    if (d < best) { best = d; seg = i; }
  });
  return { d: best, seg };
}

/** The inverse of placePoint: a world point in an instance's model space. */
export function unplacePoint(w, inst) {
  const c = Math.cos(inst.rot), s = Math.sin(inst.rot), k = inst.scale;
  const dx = (w[0] - inst.x) / k, dy = (w[1] - inst.y) / k, dz = (w[2] - inst.z) / k;
  return [c * dx - s * dz, dy, s * dx + c * dz];
}
