// A tiny procedural mesh builder for the vegetation models. Pure: no three.js, no DOM —
// it produces plain typed arrays that vegetation.js wraps in a BufferGeometry.
//
// Every vertex carries, besides position / normal / colour, three weights the foliage
// shader reads (attribute `aVeg`):
//   x  sway    0 = rooted, 1 = moves fully with the wind
//   y  season  1 = foliage that takes the seasonal tint, 0 = bark, stone, …
//   z  tint    how strongly the per-instance colour variation applies
//
// Conventions: Y up, counter-clockwise triangles face outwards.

const TAU = Math.PI * 2;

// --- icospheres --------------------------------------------------------------
const icoCache = [];

/** Unit icosphere with `sub` subdivisions (0 → 20 faces, 1 → 80, 2 → 320). */
export function icosphere(sub) {
  if (icoCache[sub]) return icoCache[sub];
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize3);
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < sub; s++) {
    const mid = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let i = mid.get(key);
      if (i === undefined) {
        const p = verts[a], q = verts[b];
        i = verts.push(normalize3([p[0] + q[0], p[1] + q[1], p[2] + q[2]])) - 1;
        mid.set(key, i);
      }
      return i;
    };
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  // Make sure every face winds counter-clockwise seen from outside.
  for (const f of faces) {
    const a = verts[f[0]], b = verts[f[1]], c = verts[f[2]];
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (nx * (a[0] + b[0] + c[0]) + ny * (a[1] + b[1] + c[1]) + nz * (a[2] + b[2] + c[2]) < 0) {
      const tmp = f[1]; f[1] = f[2]; f[2] = tmp;
    }
  }
  return (icoCache[sub] = { verts, faces });
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Cheap repeatable noise in [-1, 1] from a direction and a seed. */
function lumpNoise(x, y, z, seed) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.123) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.veg = [];
    this.idx = [];
    /** Sway weight for a vertex position; set before adding parts. */
    this.swayAt = () => 0;
    /** Season and tint weights applied to parts added from now on. */
    this.season = 0;
    this.tint = 0;
  }

  get vertexCount() { return this.pos.length / 3; }
  get triangleCount() { return this.idx.length / 3; }

  /** Adds one vertex; the normal is normalised here. Returns its index. */
  vertex(x, y, z, nx, ny, nz, c) {
    const l = Math.hypot(nx, ny, nz) || 1;
    this.pos.push(x, y, z);
    this.nrm.push(nx / l, ny / l, nz / l);
    this.col.push(c[0], c[1], c[2]);
    this.veg.push(Math.max(0, Math.min(1, this.swayAt(x, y, z))), this.season, this.tint);
    return this.pos.length / 3 - 1;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  /**
   * A lumpy ellipsoid: the building block of crowns, bushes and boulders.
   * @param {number[]} c  centre [x, y, z]
   * @param {number[]} r  radii [rx, ry, rz]
   * @param {number} sub  icosphere subdivisions
   * @param {(x:number, y:number, z:number, up:number) => number[]} colorAt
   *        colour for a vertex; `up` is -1 at the bottom of the blob, +1 at the top
   * @param {object} [o]
   * @param {number} [o.lump]   radial noise, fraction of the radius
   * @param {number} [o.seed]
   * @param {number[]} [o.towards]  blend normals towards "away from this point"
   *        (the crown centre) so a cluster of blobs shades as one soft mass
   * @param {number} [o.blend]  0..1 strength of that blend
   * @param {boolean} [o.flat]  faceted shading (rocks) instead of smooth
   * @param {number} [o.floor]  clamp vertices to this height (flat-bottomed boulders)
   */
  blob(c, r, sub, colorAt, o = {}) {
    const { lump = 0, seed = 0, towards = null, blend = 0, flat = false, floor = -Infinity } = o;
    const ico = icosphere(sub);
    const pts = ico.verts.map((u) => {
      const f = 1 + lump * lumpNoise(u[0], u[1], u[2], seed);
      return [c[0] + u[0] * r[0] * f, Math.max(floor, c[1] + u[1] * r[1] * f), c[2] + u[2] * r[2] * f];
    });
    if (flat) {
      for (const f of ico.faces) {
        const a = pts[f[0]], b = pts[f[1]], d = pts[f[2]];
        const nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]);
        const ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
        const nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        if (nx * nx + ny * ny + nz * nz < 1e-12) continue; // collapsed by the floor clamp
        const up = ((a[1] + b[1] + d[1]) / 3 - c[1]) / r[1];
        const col = colorAt((a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3, up);
        const i0 = this.vertex(a[0], a[1], a[2], nx, ny, nz, col);
        const i1 = this.vertex(b[0], b[1], b[2], nx, ny, nz, col);
        const i2 = this.vertex(d[0], d[1], d[2], nx, ny, nz, col);
        this.tri(i0, i1, i2);
      }
      return;
    }
    const base = this.vertexCount;
    ico.verts.forEach((u, i) => {
      const p = pts[i];
      // Normal of an ellipsoid: the unit direction scaled by the inverse radii.
      let nx = u[0] / r[0], ny = u[1] / r[1], nz = u[2] / r[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      if (towards && blend > 0) {
        let tx = p[0] - towards[0], ty = p[1] - towards[1], tz = p[2] - towards[2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        nx += (tx - nx) * blend; ny += (ty - ny) * blend; nz += (tz - nz) * blend;
      }
      this.vertex(p[0], p[1], p[2], nx, ny, nz, colorAt(p[0], p[1], p[2], u[1]));
    });
    for (const f of ico.faces) this.tri(base + f[0], base + f[1], base + f[2]);
  }

  /**
   * A tube of varying radius along a path: trunks, branches, logs, stems.
   * @param {number[][]} path  points [x, y, z, radius]
   * @param {number} sides
   * @param {(t:number) => number[]} colorAt  colour along the path, t = 0..1
   * @param {object} [o]
   * @param {number[]|null} [o.capStart]  colour of a flat cap at the first point
   * @param {number[]|null} [o.capEnd]    colour of a flat cap at the last point
   */
  tube(path, sides, colorAt, o = {}) {
    const { capStart = null, capEnd = null } = o;
    const n = path.length;
    const first = path[0], last = path[n - 1];
    // One reference direction for the whole tube keeps the rings from twisting.
    const axis = normalize3([last[0] - first[0], last[1] - first[1], last[2] - first[2]]);
    const ref = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const base = this.vertexCount;
    const frames = [];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
      const t = normalize3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const u = normalize3([ref[1] * t[2] - ref[2] * t[1], ref[2] * t[0] - ref[0] * t[2], ref[0] * t[1] - ref[1] * t[0]]);
      const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
      frames.push({ t, u, v });
      const p = path[i];
      const col = colorAt(n > 1 ? i / (n - 1) : 0);
      for (let k = 0; k < sides; k++) {
        const ang = k / sides * TAU;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const rx = u[0] * ca + v[0] * sa, ry = u[1] * ca + v[1] * sa, rz = u[2] * ca + v[2] * sa;
        this.vertex(p[0] + rx * p[3], p[1] + ry * p[3], p[2] + rz * p[3], rx, ry, rz, col);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = base + i * sides + k, b = base + i * sides + (k + 1) % sides;
        const c = a + sides, d = b + sides;
        this.tri(a, b, d);
        this.tri(a, d, c);
      }
    }
    const cap = (i, col, sign) => {
      const p = path[i], f = frames[i];
      const centre = this.vertex(p[0], p[1], p[2], f.t[0] * sign, f.t[1] * sign, f.t[2] * sign, col);
      const ring = this.vertexCount;
      for (let k = 0; k < sides; k++) {
        const ang = k / sides * TAU;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        this.vertex(
          p[0] + (f.u[0] * ca + f.v[0] * sa) * p[3],
          p[1] + (f.u[1] * ca + f.v[1] * sa) * p[3],
          p[2] + (f.u[2] * ca + f.v[2] * sa) * p[3],
          f.t[0] * sign, f.t[1] * sign, f.t[2] * sign, col,
        );
      }
      for (let k = 0; k < sides; k++) {
        if (sign > 0) this.tri(centre, ring + k, ring + (k + 1) % sides);
        else this.tri(centre, ring + (k + 1) % sides, ring + k);
      }
    };
    if (capStart) cap(0, capStart, -1);
    if (capEnd) cap(n - 1, capEnd, 1);
  }

  /**
   * One tier of a conifer: a cone with a ragged, drooping rim and a dark underside.
   * @param {number[]} c   centre of the rim [x, y, z]
   * @param {number} r     rim radius
   * @param {number} h     height of the apex above the rim
   * @param {number} sides
   * @param {number[]} rimCol  colour at the rim
   * @param {number[]} tipCol  colour at the apex
   * @param {object} [o]
   * @param {number} [o.ragged]  alternate rim vertices pulled in by this fraction
   * @param {number} [o.droop]   …and pushed down by this many metres
   * @param {number[]|null} [o.under]  colour of the underside (null = open)
   * @param {number} [o.turn]    rotation of the rim in radians
   */
  cone(c, r, h, sides, rimCol, tipCol, o = {}) {
    const { ragged = 0, droop = 0, under = null, turn = 0 } = o;
    const rim = this.vertexCount;
    const slope = Math.atan2(r, h); // tilt of the surface normal above the horizontal
    for (let k = 0; k < sides; k++) {
      const ang = turn + k / sides * TAU;
      const ca = Math.cos(ang), sa = -Math.sin(ang);
      const inner = k % 2 === 1;
      const rr = r * (inner ? 1 - ragged : 1);
      this.vertex(c[0] + ca * rr, c[1] - (inner ? 0 : droop), c[2] + sa * rr,
        ca * Math.cos(slope), Math.sin(slope), sa * Math.cos(slope), rimCol);
    }
    const apex = this.vertex(c[0], c[1] + h, c[2], 0, 1, 0, tipCol);
    for (let k = 0; k < sides; k++) this.tri(rim + k, rim + (k + 1) % sides, apex);
    if (under) {
      const ring = this.vertexCount;
      for (let k = 0; k < sides; k++) {
        const ang = turn + k / sides * TAU;
        const inner = k % 2 === 1;
        const rr = r * (inner ? 1 - ragged : 1);
        this.vertex(c[0] + Math.cos(ang) * rr, c[1] - (inner ? 0 : droop), c[2] - Math.sin(ang) * rr, 0, -1, 0, under);
      }
      const centre = this.vertex(c[0], c[1] + h * 0.12, c[2], 0, -1, 0, under);
      for (let k = 0; k < sides; k++) this.tri(centre, ring + (k + 1) % sides, ring + k);
    }
  }

  /**
   * A tapering, two-sided blade that leans as it rises: grass, reeds, fern fronds.
   * Normals point mostly upwards so blades are lit like the ground they stand on
   * instead of flickering dark and bright as they turn.
   * @param {number[]} base  [x, y, z]
   * @param {number} heading  direction the blade leans towards, radians
   * @param {number} height
   * @param {number} width   at the base
   * @param {number} lean    horizontal offset of the tip in metres
   * @param {number} segs    quads below the tip
   * @param {number[]} lowCol @param {number[]} tipCol
   * @param {object} [o]
   * @param {number} [o.belly]  how much the blade widens before it tapers (fern fronds)
   * @param {number} [o.arch]   the tip droops by this many metres
   */
  blade(base, heading, height, width, lean, segs, lowCol, tipCol, o = {}) {
    const { belly = 0, arch = 0 } = o;
    const dx = Math.sin(heading), dz = -Math.cos(heading); // lean direction
    const sx = -dz, sz = dx;                               // across the blade
    const start = this.vertexCount;
    const ny = 1, nx = dx * 0.35, nz = dz * 0.35;
    for (let s = 0; s <= segs; s++) {
      const t = s / (segs + 1);
      const cx = base[0] + dx * lean * t * t;
      const cy = base[1] + height * t - arch * t * t * t;
      const cz = base[2] + dz * lean * t * t;
      const w = width * 0.5 * (1 - t) * (1 + belly * Math.sin(t * Math.PI) * 2);
      const col = [lowCol[0] + (tipCol[0] - lowCol[0]) * t, lowCol[1] + (tipCol[1] - lowCol[1]) * t, lowCol[2] + (tipCol[2] - lowCol[2]) * t];
      this.vertex(cx - sx * w, cy, cz - sz * w, nx, ny, nz, col);
      this.vertex(cx + sx * w, cy, cz + sz * w, nx, ny, nz, col);
    }
    const tip = this.vertex(base[0] + dx * lean, base[1] + height - arch, base[2] + dz * lean, nx, ny, nz, tipCol);
    const both = (a, b, c) => { this.tri(a, b, c); this.tri(a, c, b); };
    for (let s = 0; s < segs; s++) {
      const a = start + s * 2, b = a + 1, c = a + 2, d = a + 3;
      both(a, b, d);
      both(a, d, c);
    }
    both(start + segs * 2, start + segs * 2 + 1, tip);
  }

  /**
   * A flat fan facing up (lily pads, flower heads, cut wood).
   * @param {number[]} c  centre
   * @param {number} r
   * @param {number} sides
   * @param {number[]} centreCol @param {number[]} rimCol
   * @param {object} [o]
   * @param {number} [o.notch]  leave out this many segments (the slit of a lily pad)
   * @param {number} [o.turn]
   * @param {number} [o.cup]    rim raised by this many metres (flowers)
   * @param {boolean} [o.twoSided]
   */
  disc(c, r, sides, centreCol, rimCol, o = {}) {
    const { notch = 0, turn = 0, cup = 0, twoSided = false } = o;
    const centre = this.vertex(c[0], c[1], c[2], 0, 1, 0, centreCol);
    const ring = this.vertexCount;
    for (let k = 0; k < sides; k++) {
      const ang = turn + k / sides * TAU;
      this.vertex(c[0] + Math.cos(ang) * r, c[1] + cup, c[2] - Math.sin(ang) * r, 0, 1, 0, rimCol);
    }
    for (let k = 0; k < sides - notch; k++) {
      const a = ring + k, b = ring + (k + 1) % sides;
      this.tri(centre, a, b);
      if (twoSided) this.tri(centre, b, a);
    }
  }

  /** A dome with a flat underside: mushroom caps. */
  dome(c, r, h, sides, rimCol, topCol, underCol) {
    this.cone(c, r, h, sides, rimCol, topCol, { under: underCol });
  }

  /** Finishes the mesh. */
  build() {
    const n = this.vertexCount;
    let minY = Infinity, maxY = -Infinity, radius = 0;
    for (let i = 0; i < n; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const d = Math.hypot(x, z);
      if (d > radius) radius = d;
    }
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nrm),
      color: new Float32Array(this.col),
      veg: new Float32Array(this.veg),
      index: n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
      vertexCount: n,
      triangleCount: this.idx.length / 3,
      minY, maxY, radius,
    };
  }
}
