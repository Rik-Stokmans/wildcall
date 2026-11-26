// Low-poly geometry kit for props. A Shape accumulates primitives (boxes, beams,
// cylinders, puffs, slabs…) in a prop's local frame, each with its own vertex
// colour, and merges them into ONE non-indexed BufferGeometry with flat normals —
// one draw call per prop with the shared vertex-coloured material, which is what keeps
// hundreds of streamed structures cheap.
//
// Local frame: metres, y up from the prop's seated base, front of the prop = −Z.
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Unit templates, cloned per use (cheap; props are built rarely and in a budget).
const T = {
  box: new THREE.BoxGeometry(1, 1, 1),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dodec: new THREE.DodecahedronGeometry(1, 0),
};
const cylCache = new Map();
function cylTemplate(rTop, seg, open) {
  const key = rTop.toFixed(3) + ':' + seg + ':' + (open ? 1 : 0);
  let g = cylCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rTop, 1, 1, seg, 1, open);
    cylCache.set(key, g);
  }
  return g;
}

/** sRGB hex → linear THREE.Color (vertex colours live in the linear working space). */
export function linear(hex, out = new THREE.Color()) {
  return out.setHex(hex >>> 0);
}

/**
 * Accumulates coloured primitives and merges them.
 * Each primitive option object accepts: x, y, z (centre), rx, ry, rz (Euler XYZ
 * radians), sx, sy, sz (extra scale), shade (multiplier, default the shape's shade).
 */
export class Shape {
  /**
   * @param {() => number} [rand] per-prop random stream, for gentle colour jitter
   * @param {number} [shade] brightness multiplier applied to every colour (per-id wood shade)
   */
  constructor(rand, shade = 1) {
    this.rand = rand || Math.random;
    this.shade = shade;
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.count = 0;
  }

  /** Adds an arbitrary geometry with a transform matrix and a colour. */
  addGeometry(geo, matrix, hex, shade) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    const p = g.attributes.position.array;
    linear(hex, _c);
    // A soft per-part jitter keeps planks and stones from looking stamped out.
    const k = (shade ?? this.shade) * (0.94 + this.rand() * 0.12);
    const r = _c.r * k, gg = _c.g * k, b = _c.b * k;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.col.push(r, gg, b);
    }
    this.count += p.length / 3;
    g.dispose();
    return this;
  }

  _matrix(o = {}, sx = 1, sy = 1, sz = 1) {
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ');
    _q.setFromEuler(_e);
    _p.set(o.x || 0, o.y || 0, o.z || 0);
    _s.set(sx * (o.sx ?? 1), sy * (o.sy ?? 1), sz * (o.sz ?? 1));
    return _m.compose(_p, _q, _s);
  }

  /** Box of size w×h×d centred at (x, y, z). */
  box(w, h, d, hex, o = {}) {
    return this.addGeometry(T.box, this._matrix(o, w, h, d), hex, o.shade);
  }

  /** Box standing on y (its bottom face at o.y). No rotation other than ry. */
  block(w, h, d, hex, o = {}) {
    return this.box(w, h, d, hex, { ...o, y: (o.y || 0) + h / 2 });
  }

  /** Square-section beam of thickness t from point a to point b ([x,y,z] arrays). */
  beam(a, b, t, hex, o = {}) {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    const len = _a.distanceTo(_b);
    if (len < 1e-4) return this;
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    _b.sub(_a).normalize();
    _q.setFromUnitVectors(_up, _b);
    if (o.roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_up, o.roll));
    _s.set(o.w ?? t, len, o.d ?? t);
    _m.compose(_p, _q, _s);
    return this.addGeometry(T.box, _m, hex, o.shade);
  }

  /** Round post (cylinder) from a to b. */
  pole(a, b, r, hex, o = {}) {
    _a.set(a[0], a[1], a[2]);
    _b.set(b[0], b[1], b[2]);
    const len = _a.distanceTo(_b);
    if (len < 1e-4) return this;
    _p.addVectors(_a, _b).multiplyScalar(0.5);
    _b.sub(_a).normalize();
    _q.setFromUnitVectors(_up, _b);
    _s.set(r, len, r);
    _m.compose(_p, _q, _s);
    return this.addGeometry(cylTemplate(o.taper ?? 1, o.seg || 6, false), _m, hex, o.shade);
  }

  /**
   * Cylinder (or truncated cone: rTop/rBot) of height h centred at (x, y, z).
   * o.seg sets the segment count (default 8).
   */
  cyl(rTop, rBot, h, hex, o = {}) {
    const rb = Math.max(rBot, 1e-4);
    return this.addGeometry(cylTemplate(rTop / rb, o.seg || 8, !!o.open), this._matrix(o, rb, h, rb), hex, o.shade);
  }

  /** Cone of radius r and height h centred at (x, y, z) (tip up). */
  cone(r, h, hex, o = {}) {
    return this.cyl(0.0001, r, h, hex, o);
  }

  /** Low-poly ball / puff of radius r (ellipsoid via sx, sy, sz). o.detail 0|1. */
  ball(r, hex, o = {}) {
    const tpl = o.detail === 0 ? T.ico0 : o.dodec ? T.dodec : T.ico1;
    return this.addGeometry(tpl, this._matrix(o, r, r, r), hex, o.shade);
  }

  /** A rough stone: a squashed dodecahedron with a random tilt. */
  stone(r, hex, o = {}) {
    const k = this.rand;
    return this.addGeometry(T.dodec, this._matrix({
      ...o, rx: (o.rx || 0) + (k() - 0.5) * 0.6, ry: (o.ry || 0) + k() * 6.28, rz: (o.rz || 0) + (k() - 0.5) * 0.6,
    }, r * (0.9 + k() * 0.3), r * (o.flat ?? 0.7), r * (0.85 + k() * 0.3)), hex, o.shade);
  }

  /**
   * Gable roof: two slabs meeting at a ridge along local X.
   * @param {number} w  ridge length (along X), overhang included
   * @param {number} d  eave-to-eave depth (along Z) at the eaves
   * @param {number} rise ridge height above the eaves
   * @param {number} y  eave height
   * @param {number} hex colour
   */
  gable(w, d, rise, y, hex, o = {}) {
    const half = d / 2;
    const slope = Math.atan2(rise, half);
    const len = Math.hypot(half, rise) + 0.12;
    const t = o.t ?? 0.18;
    const cx = o.x || 0, cz = o.z || 0;
    for (const side of [-1, 1]) {
      this.box(w, t, len, hex, {
        x: cx, y: y + rise / 2 + t / 2, z: cz + side * half / 2, rx: side * slope, shade: o.shade,
      });
    }
    // gable-end triangles approximated by stacked boards (reads as cladding)
    if (o.ends !== false) {
      const ends = o.endHex ?? hex;
      const steps = 3;
      for (const sx of [-1, 1]) {
        for (let i = 0; i < steps; i++) {
          const f = (i + 0.5) / steps;
          const bw = d * (1 - f) * 0.92;
          this.box(0.1, rise / steps, bw, ends, { x: cx + sx * (w / 2 - (o.inset ?? 0.35)), y: y + rise * f, z: cz });
        }
      }
    }
    return this;
  }

  /** Builds the merged geometry (null when empty). */
  build() {
    if (this.count === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals(); // non-indexed → flat facets, the stylised look
    g.computeBoundingSphere();
    this.pos = this.nor = this.col = null;
    return g;
  }
}

// ---------------------------------------------------------------------------
// Shared materials and textures (created once per page)

let shared = null;

/** Shared materials: one vertex-coloured solid, one window glow, sprite textures. */
export function materials() {
  if (shared) return shared;
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  solid.name = 'props-solid';
  // Windows and lanterns: an unlit material whose colour the props module sets every
  // frame from the daylight (dark glass by day, warm glow at night).
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x2c3640 });
  glow.name = 'props-glow';
  const soft = radialTexture(64, 0.0);
  const spark = sparkleTexture(64);
  const smoke = new THREE.SpriteMaterial({ map: soft, color: 0xdedad2, transparent: true, depthWrite: false, opacity: 0.5 });
  smoke.name = 'props-smoke';
  shared = { solid, glow, soft, spark, smoke };
  return shared;
}

/** A soft round alpha blob, white, as a DataTexture (no DOM). */
export function radialTexture(n, hard = 0) {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5, dy = (y + 0.5) / n - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.max(0, 1 - r);
      const v = Math.pow(a, 1.6 - hard);
      const o = (y * n + x) * 4;
      data[o] = 255; data[o + 1] = 255; data[o + 2] = 255;
      data[o + 3] = Math.round(255 * Math.min(1, v * 1.2));
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** A four-pointed glint star, as a DataTexture. */
export function sparkleTexture(n) {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = Math.abs((x + 0.5) / n - 0.5) * 2, dy = Math.abs((y + 0.5) / n - 0.5) * 2;
      const core = Math.max(0, 1 - Math.hypot(dx, dy) * 2.2);
      const rays = Math.max(0, 1 - dx * 8) * Math.max(0, 1 - dy) + Math.max(0, 1 - dy * 8) * Math.max(0, 1 - dx);
      const a = Math.min(1, core + rays * 0.8);
      const o = (y * n + x) * 4;
      data[o] = 255; data[o + 1] = 250; data[o + 2] = 230;
      data[o + 3] = Math.round(255 * a);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/** Mesh for a merged geometry with the shared solid material (shadows set by caller). */
export function solidMesh(geo, name) {
  const m = new THREE.Mesh(geo, materials().solid);
  m.name = name || 'prop';
  m.castShadow = true;
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/** Mesh for window/lantern geometry with the shared glow material. */
export function glowMesh(geo, name) {
  const m = new THREE.Mesh(geo, materials().glow);
  m.name = name || 'prop-glow';
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}
