// A tiny geometry kit for the stylised plant and nest models (task c-field): small
// primitives (lumpy blobs, tubes, leaves, spheres, lathed shapes) are transformed,
// coloured per vertex and merged into one BufferGeometry, so a whole plant is a single
// instanced draw.
//
// Attributes of the built geometry: position, normal, color (linear RGB) and aSway
// (0 at the ground … 1 at the tips: how much the wind moves a vertex).
//
// Soft shading: foliage masses get normals blended towards "outwards from the mass
// centre" and "up", so each mass reads as one soft rounded form (contract §10), and
// a vertical colour gradient from a warm lit top to a cool shaded underside.
import * as THREE from 'three';

/** Deterministic PRNG (mulberry32) → () => [0, 1). */
export function rng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tmpC = new THREE.Color();
/** sRGB hex → linear [r, g, b] (vertex colours are linear). */
export function lin(hex) {
  tmpC.setHex(hex, THREE.SRGBColorSpace);
  return [tmpC.r, tmpC.g, tmpC.b];
}
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mulc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** Atlas uv of the opaque white cell that solid geometry samples. */
const SOLID_UV = [0.75, 0.25];
const UP = V(0, 1, 0);
const m4 = new THREE.Matrix4();
const nm = new THREE.Matrix3();
const pv = new THREE.Vector3();
const nv = new THREE.Vector3();
const ov = new THREE.Vector3();

/** Accumulates coloured triangles and builds a BufferGeometry. */
export class Geo {
  constructor() {
    this.pos = []; this.nrm = []; this.col = []; this.sway = [];
    // uv into the leaf atlas (solid geometry samples its opaque white corner) and the
    // camera-facing corner offset of leaf cards (0 for solid geometry)
    this.uv = []; this.card = [];
    // how much a vertex is foliage (1) rather than wood, fruit or soil (0): seasonal
    // tints apply to foliage only
    this.leafw = [];
    this.leafNext = 0;
  }

  _solid(n, leaf = this.leafNext) {
    for (let i = 0; i < n; i++) { this.uv.push(SOLID_UV[0], SOLID_UV[1]); this.card.push(0, 0); this.leafw.push(leaf); }
  }

  get vertexCount() { return this.pos.length / 3; }

  /**
   * Adds a three.js geometry.
   * @param {THREE.BufferGeometry} geom   disposed afterwards
   * @param {THREE.Matrix4} matrix
   * @param {number[]|((p:THREE.Vector3, n:THREE.Vector3, local:THREE.Vector3)=>number[])} color
   * @param {number|((p:THREE.Vector3)=>number)} sway
   * @param {{soft?: number, centre?: THREE.Vector3, up?: number}} [opts]
   */
  add(geom, matrix, color, sway = 0, opts = {}) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal;
    nm.getNormalMatrix(matrix);
    const soft = opts.soft || 0, upW = opts.up || 0, centre = opts.centre;
    const local = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      local.set(P.getX(i), P.getY(i), P.getZ(i));
      pv.copy(local).applyMatrix4(matrix);
      nv.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nm).normalize();
      if (soft > 0 && centre) {
        ov.copy(pv).sub(centre).normalize();
        nv.lerp(ov, soft).normalize();
      }
      if (upW > 0) nv.lerp(UP, upW).normalize();
      this.pos.push(pv.x, pv.y, pv.z);
      this.nrm.push(nv.x, nv.y, nv.z);
      const c = typeof color === 'function' ? color(pv, nv, local) : color;
      this.col.push(c[0], c[1], c[2]);
      this.sway.push(typeof sway === 'function' ? sway(pv) : sway);
    }
    this._solid(P.count);
    if (g !== geom) g.dispose();
    geom.dispose();
    return this;
  }

  /** Raw triangle list helper: verts [[x,y,z]...], tris [[a,b,c]...], per-vertex colour and sway. */
  tris(verts, tris, color, sway = 0, normals = null) {
    for (const [a, b, c] of tris) {
      const A = verts[a], B = verts[b], C = verts[c];
      let n;
      if (!normals) {
        const e1 = V(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
        const e2 = V(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
        n = e1.cross(e2).normalize();
      }
      for (const [k, p] of [[a, A], [b, B], [c, C]]) {
        this.pos.push(p[0], p[1], p[2]);
        const nn = normals ? normals[k] : [n.x, n.y, n.z];
        this.nrm.push(nn[0], nn[1], nn[2]);
        const col = typeof color === 'function' ? color(p, k) : color;
        this.col.push(col[0], col[1], col[2]);
        this.sway.push(typeof sway === 'function' ? sway(p, k) : sway);
      }
    }
    this._solid(tris.length * 3);
    return this;
  }

  /**
   * A lumpy soft mass (foliage clump, moss cushion, thyme mat).
   * @param {THREE.Vector3} c centre
   * @param {number[]} r radii [x, y, z]
   * @param {number[]} top lit colour (linear)
   * @param {number[]} bottom shaded colour (linear)
   */
  blob(c, r, top, bottom, { seed = 1, detail = 1, lump = 0.16, sway = 0, soft = 0.55, rotY = 0, flatBottom = false, leaf = 0 } = {}) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const R = rng(seed * 7919 + 13);
    const P = g.attributes.position;
    // lumps: a few random bumps per blob, stable per vertex direction
    const bumps = [];
    for (let i = 0; i < 5; i++) bumps.push([V(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize(), (R() - 0.3) * lump]);
    for (let i = 0; i < P.count; i++) {
      pv.set(P.getX(i), P.getY(i), P.getZ(i)).normalize();
      let k = 1;
      for (const [d, a] of bumps) k += a * Math.max(0, pv.dot(d)) ** 3;
      // hashed per-direction jitter keeps facets from looking like a perfect sphere
      const h = Math.sin(pv.x * 12.9898 + pv.y * 78.233 + pv.z * 37.719 + seed) * 43758.5453;
      k += (h - Math.floor(h) - 0.5) * lump * 0.5;
      let y = pv.y * k;
      if (flatBottom && y < -0.25) y = -0.25 + (y + 0.25) * 0.2;
      P.setXYZ(i, pv.x * k, y, pv.z * k);
    }
    g.computeVertexNormals();
    m4.compose(c, new THREE.Quaternion().setFromAxisAngle(UP, rotY), V(r[0], r[1], r[2]));
    const y0 = c.y - r[1], span = 2 * r[1];
    this.leafNext = leaf;
    this.add(g, m4, (p, n) => {
      const t = Math.max(0, Math.min(1, (p.y - y0) / span));
      const lit = 0.5 + 0.5 * Math.max(0, n.y);
      return mixc(bottom, top, Math.min(1, t * 0.75 + lit * 0.35));
    }, typeof sway === 'function' ? sway : (p) => sway * Math.max(0, Math.min(1, (p.y - y0) / span + 0.3)), { soft, centre: c });
    this.leafNext = 0;
    return this;
  }

  /** A sphere (berry, egg); `squash` scales Y. */
  sphere(c, r, color, { detail = 1, squash = 1, sway = 0, shade = 0.25 } = {}) {
    const g = detail < 0 ? new THREE.OctahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, detail);
    m4.compose(c, new THREE.Quaternion(), V(r, r * squash, r));
    const dark = mulc(color, 1 - shade);
    return this.add(g, m4, (p, n) => mixc(dark, color, 0.5 + 0.5 * n.y), sway);
  }

  /** An ellipsoid with an orientation (hip, nut, egg). */
  ellipsoid(c, r, quat, color, { detail = 1, sway = 0, shade = 0.25 } = {}) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    m4.compose(c, quat, V(r[0], r[1], r[2]));
    const dark = mulc(color, 1 - shade);
    return this.add(g, m4, (p, n) => mixc(dark, color, 0.5 + 0.5 * n.y), sway);
  }

  /**
   * A tapered tube along a polyline (stem, cane, branch, twig).
   * @param {THREE.Vector3[]} pts
   * @param {number} r0 radius at the start, r1 at the end
   */
  tube(pts, r0, r1, color, { sides = 5, sway = 0, colorEnd = null } = {}) {
    if (pts.length < 2) return this;
    const n = pts.length;
    const rings = [];
    let prevN = null;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const d = (i < n - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
      let side = prevN ? prevN.clone() : (Math.abs(d.y) > 0.9 ? V(1, 0, 0) : UP.clone());
      side.sub(d.clone().multiplyScalar(side.dot(d))).normalize();
      if (side.lengthSq() < 1e-6) side = V(1, 0, 0);
      prevN = side;
      const bi = d.clone().cross(side).normalize();
      const r = r0 + (r1 - r0) * t;
      const ring = [];
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const dir = side.clone().multiplyScalar(Math.cos(a)).add(bi.clone().multiplyScalar(Math.sin(a)));
        ring.push({ p: pts[i].clone().add(dir.clone().multiplyScalar(r)), n: dir, t });
      }
      rings.push(ring);
    }
    const col = (t) => (colorEnd ? mixc(color, colorEnd, t) : color);
    const sw = (p, t) => (typeof sway === 'function' ? sway(p, t) : sway * t);
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = rings[i][s], b = rings[i][(s + 1) % sides], c = rings[i + 1][(s + 1) % sides], d = rings[i + 1][s];
        for (const v of [a, b, c, a, c, d]) {
          this.pos.push(v.p.x, v.p.y, v.p.z);
          this.nrm.push(v.n.x, v.n.y, v.n.z);
          const cc = col(v.t);
          this.col.push(cc[0], cc[1], cc[2]);
          this.sway.push(sw(v.p, v.t));
        }
      }
    }
    this._solid((n - 1) * sides * 6);
    return this;
  }

  /**
   * A flat leaf: a lens-shaped strip from `base` along `dir`, curving down by `droop`,
   * with a slight fold along the midrib. Double-sided material assumed.
   * shape: 'oval' | 'lance' | 'round' | 'heart' | 'needle'
   */
  leaf(base, dir, len, width, colBase, colTip, { droop = 0.25, sway = 0, segs = 4, shape = 'oval', fold = 0.18, roll = 0, serrate = 0 } = {}) {
    const d = dir.clone().normalize();
    let side = Math.abs(d.y) > 0.95 ? V(1, 0, 0) : UP.clone().cross(d).normalize();
    if (roll) side.applyAxisAngle(d, roll);
    const up = side.clone().cross(d).normalize();
    const widthAt = (t) => {
      switch (shape) {
        case 'lance': return Math.sin(Math.PI * Math.pow(t, 0.8)) * (1 - 0.2 * t);
        case 'round': return Math.sin(Math.PI * Math.pow(t, 0.65));
        case 'heart': return Math.sin(Math.PI * Math.pow(t, 0.55)) * (t < 0.12 ? 0.75 + t * 2 : 1);
        case 'needle': return 0.5 * (1 - t) + 0.1;
        default: return Math.sin(Math.PI * Math.pow(t, 0.75));
      }
    };
    const verts = [], cols = [], sw = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const along = d.clone().multiplyScalar(len * t);
      const dropV = up.clone().multiplyScalar(-droop * len * t * t);
      const mid = base.clone().add(along).add(dropV);
      let w = width * 0.5 * widthAt(t);
      if (serrate && i > 0 && i < segs) w *= (i % 2 ? 1 + serrate : 1 - serrate * 0.5);
      const foldV = up.clone().multiplyScalar(fold * w);
      verts.push(mid.clone().add(side.clone().multiplyScalar(-w)).add(foldV), mid.clone(), mid.clone().add(side.clone().multiplyScalar(w)).add(foldV));
      const c = mixc(colBase, colTip, t);
      cols.push(mulc(c, 0.92), mixc(c, [1, 1, 1], 0.04), mulc(c, 0.92));
      const s = typeof sway === 'function' ? sway(mid) : sway * (0.4 + 0.6 * t);
      sw.push(s, s, s);
    }
    const normal = up;
    for (let i = 0; i < segs; i++) {
      const o = i * 3, q = o + 3;
      // wound counter-clockwise seen from the side the normal points to, so a
      // double-sided material lights the upper face as the front face
      for (const [a, b, c] of [[o, q + 1, o + 1], [o, q, q + 1], [o + 1, q + 2, o + 2], [o + 1, q + 1, q + 2]]) {
        for (const k of [a, b, c]) {
          const p = verts[k];
          this.pos.push(p.x, p.y, p.z);
          // tilt normals a little towards up so leaves catch the sky light softly
          const nn = normal.clone().lerp(UP, 0.35).normalize();
          this.nrm.push(nn.x, nn.y, nn.z);
          this.col.push(cols[k][0], cols[k][1], cols[k][2]);
          this.sway.push(sw[k]);
        }
      }
    }
    this._solid(segs * 12, 1);
    return this;
  }

  /**
   * Leaf cards: camera-facing quads painted with a clump of leaves from the atlas,
   * scattered through an ellipsoid (denser towards its surface). They make soft,
   * leafy masses with ragged silhouettes, like the world's own shrubs.
   * @param {number} cell atlas cell 0..2 (broad, small, narrow leaves)
   */
  cards(c, r, n, top, bottom, { R, cell = 0, size = 0.4, sway = 0, up = 0.45, bright = 1 } = {}) {
    const y0 = c.y - r[1], span = 2 * r[1];
    const u0 = (cell % 2) * 0.5, v0 = cell < 2 ? 0.5 : 0; // cells: 0 TL, 1 TR, 2 BL (v up)
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const yy = -0.55 + R() * 1.5;
      const y = Math.max(-1, Math.min(1, yy));
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const d = 0.55 + 0.45 * Math.sqrt(R());
      const p = V(c.x + Math.cos(a) * ring * r[0] * d, c.y + y * r[1] * d, c.z + Math.sin(a) * ring * r[2] * d);
      const nrm = V(Math.cos(a) * ring, y, Math.sin(a) * ring).normalize().lerp(UP, up).normalize();
      const t = Math.max(0, Math.min(1, (p.y - y0) / span));
      const k = (0.86 + R() * 0.24) * bright;
      const col = mulc(mixc(bottom, top, Math.min(1, t * 0.8 + 0.2 + Math.max(0, nrm.y) * 0.25)), k);
      const sz = size * (0.75 + R() * 0.5);
      const rot = R() * Math.PI * 2;
      const cs = Math.cos(rot) * sz * 0.5, sn = Math.sin(rot) * sz * 0.5;
      const corners = [[-cs + sn, -sn - cs, 0, 0], [cs + sn, sn - cs, 1, 0], [cs - sn, sn + cs, 1, 1], [-cs - sn, -sn + cs, 0, 1]];
      const sw = typeof sway === 'function' ? sway(p) : sway * t;
      for (const k2 of [0, 1, 2, 0, 2, 3]) {
        const [ox, oy, uu, vv] = corners[k2];
        this.pos.push(p.x, p.y, p.z);
        this.nrm.push(nrm.x, nrm.y, nrm.z);
        this.col.push(col[0], col[1], col[2]);
        this.sway.push(sw);
        this.uv.push(u0 + 0.02 + uu * 0.46, v0 + 0.02 + vv * 0.46);
        this.card.push(ox, oy);
        this.leafw.push(1);
      }
    }
    return this;
  }

  /** A lathed (rotationally symmetric) shape: profile [[radius, y], ...] bottom to top. */
  lathe(c, profile, color, { sides = 10, scale = 1, sway = 0, quat = null } = {}) {
    const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), sides);
    m4.compose(c, quat || new THREE.Quaternion(), V(scale, scale, scale));
    return this.add(g, m4, typeof color === 'function' ? color : (p, n, l) => color, sway);
  }

  /** A cone (spike, pine tier). */
  cone(c, r, h, color, { sides = 6, quat = null, sway = 0, colorTop = null, open = false } = {}) {
    const g = new THREE.ConeGeometry(r, h, sides, 1, open);
    g.translate(0, h / 2, 0);
    m4.compose(c, quat || new THREE.Quaternion(), V(1, 1, 1));
    const y0 = c.y;
    return this.add(g, m4, (p, n, l) => (colorTop ? mixc(color, colorTop, Math.max(0, Math.min(1, l.y / h))) : color), sway);
  }

  /** Builds the BufferGeometry. */
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCard', new THREE.Float32BufferAttribute(this.card, 2));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(this.leafw, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Quaternion that turns +Y towards a direction. */
export function quatTo(dir) {
  return new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
}

/** Point on a quadratic Bézier. */
export function bez(a, b, c, t) {
  const u = 1 - t;
  return V(u * u * a.x + 2 * u * t * b.x + t * t * c.x, u * u * a.y + 2 * u * t * b.y + t * t * c.y, u * u * a.z + 2 * u * t * b.z + t * t * c.z);
}

export { V };
