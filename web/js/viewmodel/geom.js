// Tiny geometry kit for the held tools: low-poly primitives merged into one indexed,
// vertex-coloured BufferGeometry per moving part. Built once per equipped item; the
// temporaries made here are dropped right after the merge.
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/** Matrix from position [x,y,z], euler [x,y,z] (radians, XYZ) and scale (number or [x,y,z]). */
export function xf(pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
  _p.set(pos[0], pos[1], pos[2]);
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], 'XYZ'));
  if (Array.isArray(scale)) _s.set(scale[0], scale[1], scale[2]); else _s.set(scale, scale, scale);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/**
 * A box with rounded (bevelled) edges: segments per axis 2 gives a soft chamfer,
 * normals point out of the rounded core so it shades smoothly.
 */
export function roundBox(w, h, d, r = 0.3, seg = 2) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = g.attributes.position, nor = g.attributes.normal;
  const hx = w / 2, hy = h / 2, hz = d / 2;
  const rad = Math.min(hx, hy, hz) * Math.min(0.95, Math.max(0, r)) * 2;
  const ix = Math.max(0, hx - rad), iy = Math.max(0, hy - rad), iz = Math.max(0, hz - rad);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const cx = Math.max(-ix, Math.min(ix, x)), cy = Math.max(-iy, Math.min(iy, y)), cz = Math.max(-iz, Math.min(iz, z));
    _v.set(x - cx, y - cy, z - cz);
    const len = _v.length();
    if (len > 1e-6) {
      _v.multiplyScalar(1 / len);
      // Pull corners in onto the rounding radius, keep face centres flat.
      const k = Math.min(len, rad);
      pos.setXYZ(i, cx + _v.x * k, cy + _v.y * k, cz + _v.z * k);
      nor.setXYZ(i, _v.x, _v.y, _v.z);
    }
  }
  return g;
}

export const cyl = (rTop, rBot, h, seg = 10, open = false) => new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
export const sphere = (r, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs);
export const capsule = (r, len, cap = 3, rad = 8) => new THREE.CapsuleGeometry(r, len, cap, rad);
export const torus = (r, tube, rs = 6, ts = 12, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, rs, ts, arc);
/** An open bowl (parabolic dish): a sphere cap facing -Z. */
export const bowl = (r, depth = 0.5, ws = 14) => {
  const g = new THREE.SphereGeometry(r, ws, 4, 0, Math.PI * 2, 0, Math.PI * depth);
  return g;
};

/** Turn a geometry inside out (normals and winding), for the inner face of a shell. */
export function flipFaces(g) {
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  if (g.index) {
    const idx = g.index;
    for (let k = 0; k < idx.count; k += 3) { const t = idx.getX(k + 1); idx.setX(k + 1, idx.getX(k + 2)); idx.setX(k + 2, t); }
  }
  return g;
}

/**
 * Collects primitives and merges them into one indexed geometry with vertex colours.
 * add(geometry, color, matrix?, shade?) — `shade(x, y, z) → [r,g,b] multiplier` is an
 * optional per-vertex tint (in the primitive's local space) for mottling, gradients.
 */
export function createBuilder() {
  const parts = [];
  return {
    add(geo, color, matrix = null, shade = null) {
      parts.push({ geo, color, matrix, shade });
      return this;
    },
    get count() { return parts.length; },
    build() {
      let nv = 0, ni = 0;
      for (const p of parts) {
        nv += p.geo.attributes.position.count;
        ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
      }
      const position = new Float32Array(nv * 3);
      const normal = new Float32Array(nv * 3);
      const color = new Float32Array(nv * 3);
      const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let vo = 0, io = 0;
      for (const p of parts) {
        const pos = p.geo.attributes.position, nor = p.geo.attributes.normal;
        const m = p.matrix || _m.identity();
        _n.getNormalMatrix(m);
        _c.set(p.color);
        for (let i = 0; i < pos.count; i++) {
          const lx = pos.getX(i), ly = pos.getY(i), lz = pos.getZ(i);
          _v.set(lx, ly, lz).applyMatrix4(m);
          position[(vo + i) * 3] = _v.x; position[(vo + i) * 3 + 1] = _v.y; position[(vo + i) * 3 + 2] = _v.z;
          _v.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(_n).normalize();
          normal[(vo + i) * 3] = _v.x; normal[(vo + i) * 3 + 1] = _v.y; normal[(vo + i) * 3 + 2] = _v.z;
          let r = _c.r, g = _c.g, b = _c.b;
          if (p.shade) { const s = p.shade(lx, ly, lz); r *= s[0]; g *= s[1]; b *= s[2]; }
          color[(vo + i) * 3] = r; color[(vo + i) * 3 + 1] = g; color[(vo + i) * 3 + 2] = b;
        }
        // A mirrored part (negative determinant) would turn inside out: flip its winding.
        const flip = m.determinant() < 0;
        const count = p.geo.index ? p.geo.index.count : pos.count;
        const at = p.geo.index ? (k) => p.geo.index.getX(k) : (k) => k;
        for (let k = 0; k < count; k += 3) {
          index[io + k] = at(k) + vo;
          index[io + k + 1] = at(flip ? k + 2 : k + 1) + vo;
          index[io + k + 2] = at(flip ? k + 1 : k + 2) + vo;
        }
        io += count;
        vo += pos.count;
        p.geo.dispose();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(position, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      g.setAttribute('color', new THREE.BufferAttribute(color, 3));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      g.computeBoundingSphere();
      parts.length = 0;
      return g;
    },
  };
}

/** Deterministic cheap mottle (camouflage, fur, wood grain): a multiplier per vertex. */
export function mottle(amount = 0.15, freq = 40, seed = 1) {
  const out = [1, 1, 1];
  return (x, y, z) => {
    const n = Math.sin(x * freq * 1.7 + seed) * Math.sin(y * freq * 1.3 + seed * 2.1) + Math.sin(z * freq * 1.1 + seed * 0.7) * 0.5;
    const k = 1 + n * amount;
    out[0] = k; out[1] = k; out[2] = k;
    return out;
  };
}

/** Vertical gradient: brighter on top (soft painted look). */
export function topLight(lo = 0.82, hi = 1.08, h = 0.05) {
  const out = [1, 1, 1];
  return (x, y) => {
    const t = Math.max(0, Math.min(1, y / (2 * h) + 0.5));
    const k = lo + (hi - lo) * t;
    out[0] = k; out[1] = k; out[2] = k;
    return out;
  };
}
