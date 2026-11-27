// Procedural bird mesh: pure geometry generation (no three.js). model.js wraps the
// arrays this produces into a shared, skinned BufferGeometry per species.
//
// The bird is one rigidly-skinned mesh (one draw call per bird) with a small skeleton:
//
//   body ─┬─ neck ── head ─┬─ jaw      (lower mandible, opens for song / pecks)
//         │                ├─ throat   (small bulge that pulses while singing)
//         │                └─ twig     (nest material, shown while nesting)
//         ├─ tail                        (pitch, fan by lateral scale)
//         ├─ wingL ── handL              (spread wing, two bones so tips lag / fold)
//         ├─ wingR ── handR
//         ├─ coverL, coverR              (folded wings: shells hugging the flanks)
//         └─ legL, legR
//
// Spread wings are the flight surfaces; the folded wing seen on a perched bird is a
// separate shell (cover) that conforms to the body, so markings like wingbars read
// correctly at rest. The animator cross-fades them (spread wings collapse to the
// shoulder while the covers grow out of the body), which reads as wings opening.
//
// Mesh space at bind: metres, bird faces -Z, +X is its right, +Y up, body centre at
// the origin. Colours are painted per triangle (crisp low-poly field marks) while
// normals are smooth (soft rounded shading). Every vertex carries a primary and a
// secondary bone index plus the primary weight.

import { deriveRig, billDropAt, billWidthAt, BILL_PROFILES, tailLengthAt, wingOutline, WING_PROFILES, clamp } from './rig.js';
import { preparePalette, paintAt } from './marks.js';
import { parseHex, toLinear, leucistic, mix } from './color.js';
import { plumageLift } from './visibility.js';

export const BONES = Object.freeze([
  'body', 'neck', 'head', 'jaw', 'throat', 'tail',
  'wingL', 'handL', 'wingR', 'handR', 'coverL', 'coverR', 'legL', 'legR', 'twig',
]);
/** Bone name → index. */
export const BONE = Object.freeze(Object.fromEntries(BONES.map((n, i) => [n, i])));
/** Parent of each bone (index into BONES, -1 for the root). */
export const BONE_PARENT = Object.freeze(BONES.map((n) => {
  switch (n) {
    case 'body': return -1;
    case 'head': return BONE.neck;
    case 'jaw': case 'throat': case 'twig': return BONE.head;
    case 'handL': return BONE.wingL;
    case 'handR': return BONE.wingR;
    default: return BONE.body;
  }
}));

const TWIG = parseHex('#7b5b3c');
const MOUTH = parseHex('#c25a5e');
const TAU = Math.PI * 2;

// --- triangle accumulator ---------------------------------------------------------

class Builder {
  constructor(pal, paintCtx) {
    this.pal = pal;
    this.ctx = paintCtx;
    this.pos = []; this.nrm = []; this.col = []; this.leu = [];
    this.b0 = []; this.b1 = []; this.w = [];
    this.parts = {};
    this._rgb = [0, 0, 0];
    this._lin = [0, 0, 0];
    this._pale = [0, 0, 0];
    this._paleLin = [0, 0, 0];
    this._lift = [0, 0, 0];
  }

  /** Colour a triangle from an sRGB triple; bare parts keep more colour when leucistic. */
  _pushColour(rgb, bare) {
    // Plumage is lifted a touch so birds separate from dark foliage (visibility.js);
    // bare parts (eye, bill, legs) keep their true colour.
    if (!bare) rgb = plumageLift(rgb, this._lift);
    toLinear(rgb, this._lin);
    leucistic(rgb, bare, this._pale);
    const pl = toLinear(this._pale, this._paleLin);
    for (let k = 0; k < 3; k++) {
      this.col.push(this._lin[0], this._lin[1], this._lin[2]);
      this.leu.push(pl[0], pl[1], pl[2]);
    }
  }

  /**
   * Emit one triangle. v = {p:[x,y,z], n:[x,y,z], b0, b1, w}. rgb is the sRGB colour.
   */
  tri(part, va, vb, vc, rgb, bare) {
    for (const v of [va, vb, vc]) {
      this.pos.push(v.p[0], v.p[1], v.p[2]);
      this.nrm.push(v.n[0], v.n[1], v.n[2]);
      this.b0.push(v.b0); this.b1.push(v.b1); this.w.push(v.w);
    }
    this._pushColour(rgb, bare);
    this.parts[part] = (this.parts[part] || 0) + 1;
  }

  paint(part, s, y, f) {
    return paintAt(this.pal, part, s, y, f, this.ctx, this._rgb);
  }
}

const BARE = new Set(['bill', 'lowerbill', 'eye', 'legs', 'mouth', 'twig']);

// --- small vector helpers (arrays, build-time only) ---------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/**
 * Grid surface. point(i, j) → { p, c:[s,y,f], b0, b1, w } for i in 0..nu, j in 0..nv.
 * Smooth normals are accumulated per position (so seams and poles shade smoothly), and
 * each quad's two triangles are painted at their centroid in paint coordinates.
 * outward(centroid, faceNormal, avgPaintCoords) → true if the normal points the right
 * way (else the triangle is flipped). colour(c) optionally overrides painting (returns sRGB triple).
 */
function surface(B, { part, nu, nv, point, outward, colour, doubleSided = false, paintPart }) {
  const grid = [];
  for (let i = 0; i <= nu; i++) {
    const row = [];
    for (let j = 0; j <= nv; j++) row.push(point(i, j));
    grid.push(row);
  }
  const tris = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = grid[i][j], b = grid[i + 1][j], c = grid[i + 1][j + 1], d = grid[i][j + 1];
      const q = [a, b, c, d];
      tris.push({ v: [a, b, c], q }, { v: [a, c, d], q });
    }
  }
  // Accumulate area-weighted normals keyed by quantised position.
  const acc = new Map();
  const key = (p) => `${Math.round(p[0] * 2e5)},${Math.round(p[1] * 2e5)},${Math.round(p[2] * 2e5)}`;
  const faces = [];
  for (const { v: t, q } of tris) {
    let n = cross(sub(t[1].p, t[0].p), sub(t[2].p, t[0].p));
    const area = len(n);
    if (area < 1e-12) continue; // degenerate (poles)
    const cen = scale(add(add(t[0].p, t[1].p), t[2].p), 1 / 3);
    const cAvg = [0, 1, 2].map((k) => (q[0].c[k] + q[1].c[k] + q[2].c[k] + q[3].c[k]) / 4);
    let flip = false;
    if (outward && !outward(cen, n, cAvg)) { flip = true; n = scale(n, -1); }
    faces.push({ t, n, flip, q });
    for (const v of t) {
      const k = key(v.p);
      const e = acc.get(k);
      if (e) { e[0] += n[0]; e[1] += n[1]; e[2] += n[2]; } else acc.set(k, [n[0], n[1], n[2]]);
    }
  }
  const pp = paintPart || part;
  for (const { t, flip, q } of faces) {
    // Paint per grid quad (both of its triangles share the quad-centre colour) so marks
    // become clean low-poly blocks and bands instead of sawtooth edges.
    const cs = (q[0].c[0] + q[1].c[0] + q[2].c[0] + q[3].c[0]) / 4;
    const cy = (q[0].c[1] + q[1].c[1] + q[2].c[1] + q[3].c[1]) / 4;
    const cf = (q[0].c[2] + q[1].c[2] + q[2].c[2] + q[3].c[2]) / 4;
    const rgb = colour ? colour(cs, cy, cf) : B.paint(pp, cs, cy, cf);
    const vs = t.map((v) => ({ p: v.p, n: norm(acc.get(key(v.p))), b0: v.b0, b1: v.b1, w: v.w }));
    const bare = BARE.has(pp);
    if (flip) B.tri(part, vs[0], vs[2], vs[1], rgb, bare);
    else B.tri(part, vs[0], vs[1], vs[2], rgb, bare);
    if (doubleSided) {
      const back = vs.map((v) => ({ ...v, n: scale(v.n, -1) }));
      if (flip) B.tri(part, back[0], back[1], back[2], rgb, bare);
      else B.tri(part, back[0], back[2], back[1], rgb, bare);
    }
  }
}

const rigid = (bone) => ({ b0: bone, b1: bone, w: 1 });
const awayFrom = (centre) => (cen, n) => dot(n, sub(cen, centre)) >= 0;

// --- parts ------------------------------------------------------------------------

/** Body taper used by both the body and the folded-wing shells that hug it. */
export function bodyTaper(uz) {
  return uz > 0 ? 1 - 0.28 * uz * uz : 1;
}

function buildBody(B, R) {
  const { rx, ry, rz } = R.body;
  const nu = 12, nv = 16;
  surface(B, {
    part: 'body', nu, nv,
    point(i, j) {
      const a = (i / nu) * Math.PI, b = (j / nv) * TAU;
      const ux = Math.sin(a) * Math.sin(b), uy = Math.sin(a) * Math.cos(b), uz = -Math.cos(a);
      const k = bodyTaper(uz);
      // A slightly fuller breast low at the front gives the classic songbird profile.
      const full = uz < 0 && uy < 0 ? 1 + 0.08 * -uz : 1;
      return { p: [rx * ux * k, ry * uy * k * full, rz * uz], c: [ux, uy, -uz], ...rigid(0) };
    },
    outward: awayFrom([0, 0, 0]),
  });
}

/** Head ellipsoid radii factors: owls have a flat facial disc, others a slightly long face. */
function headShape(R) {
  return R.head.disc ? { wx: 1.05, wy: 1.0, front: 0.8, back: 0.95 } : { wx: 0.92, wy: 1.0, front: 1.08, back: 0.95 };
}

function headPoint(R, ux, uy, uz) {
  const hs = headShape(R), r = R.head.r;
  return [R.head.x + r * hs.wx * ux, R.head.y + r * hs.wy * uy, R.head.z + r * uz * (uz < 0 ? hs.front : hs.back)];
}

function buildHead(B, R) {
  const nu = 10, nv = 12, H = [R.head.x, R.head.y, R.head.z];
  surface(B, {
    part: 'head', nu, nv,
    point(i, j) {
      const a = (i / nu) * Math.PI, b = (j / nv) * TAU;
      const ux = Math.sin(a) * Math.sin(b), uy = Math.sin(a) * Math.cos(b), uz = -Math.cos(a);
      return { p: headPoint(R, ux, uy, uz), c: [ux, uy, -uz], ...rigid(BONE.head) };
    },
    outward: awayFrom(H),
  });
}

function buildNeck(B, R) {
  const n = R.neck;
  if (!n) return;
  const base = [n.base.x, n.base.y, n.base.z], top = [n.top.x, n.top.y, n.top.z];
  const d = norm(sub(top, base));
  const hind = norm([0, -d[2], d[1]]); // perpendicular in the YZ plane, pointing up/back
  const side = [1, 0, 0];
  const L = len(sub(top, base));
  const nu = 4, nv = 8;
  surface(B, {
    part: 'neck', nu, nv,
    point(i, j) {
      const t = i / nu, phi = (j / nv) * TAU;
      const sx = Math.sin(phi), sy = Math.cos(phi);
      const r = n.r * (1.55 - 0.55 * t);
      const ax = add(base, scale(d, L * t));
      const p = add(ax, add(scale(side, r * sx), scale(hind, r * sy)));
      // Upper rings follow the head a little so a turning head drags the neck with it.
      const wHead = t <= 0.5 ? 0 : (t - 0.5) * 1.2;
      return { p, c: [sx, sy, t], b0: BONE.neck, b1: BONE.head, w: 1 - wHead };
    },
    outward: (cen, nn) => {
      const t = clamp(dot(sub(cen, base), d) / L, 0, 1);
      return dot(nn, sub(cen, add(base, scale(d, L * t)))) >= 0;
    },
  });
}

function sphereAt(B, part, centre, rad, bone, nu, nv, colour) {
  surface(B, {
    part, nu, nv,
    point(i, j) {
      const a = (i / nu) * Math.PI, b = (j / nv) * TAU;
      const ux = Math.sin(a) * Math.sin(b), uy = Math.sin(a) * Math.cos(b), uz = -Math.cos(a);
      return { p: [centre[0] + rad[0] * ux, centre[1] + rad[1] * uy, centre[2] + rad[2] * uz], c: [ux, uy, -uz], ...rigid(bone) };
    },
    outward: awayFrom(centre),
    colour,
  });
}

function buildEyes(B, R) {
  const e = R.eye;
  const dir = norm([e.s, e.y, e.f]);
  for (const side of [-1, 1]) {
    const p = headPoint(R, dir[0] * side, dir[1], -dir[2]);
    // Sit the eye slightly into the head so only a bead shows.
    const H = [R.head.x, R.head.y, R.head.z];
    const c = add(H, scale(sub(p, H), 0.985));
    const eyeRgb = B.pal.eye;
    sphereAt(B, 'eye', c, [e.r, e.r, e.r], BONE.head, 3, 6, () => eyeRgb);
    // A tiny catchlight makes the eye read as an eye through binoculars.
    const out = norm(sub(c, H));
    const hl = add(c, add(scale(out, e.r * 0.92), [0, e.r * 0.35, -e.r * 0.25]));
    sphereAt(B, 'eye', hl, [e.r * 0.28, e.r * 0.28, e.r * 0.28], BONE.head, 2, 4, () => [0.96, 0.96, 0.92]);
  }
}

/** Bill base (hinge) position. */
export function billBase(R) {
  const r = R.head.r;
  return R.head.disc
    ? [R.head.x, R.head.y - 0.22 * r, R.head.z - 0.74 * r]
    : [R.head.x, R.head.y - 0.1 * r, R.head.z - 0.9 * r * headShape(R).front];
}

/** Height profile of the bill along its length (fraction of base height). */
export function billHeightAt(shape, t) {
  if (shape === 'flat') return 1 - 0.55 * clamp(t, 0, 1);
  return billWidthAt(shape, t);
}

function buildBill(B, R, arch) {
  const bl = R.bill, shape = bl.shape, P = BILL_PROFILES[shape];
  const base = billBase(R);
  const N = 5;
  const billRgb = B.pal.bill;
  const mouthRgb = mix(MOUTH, billRgb, 0.35);
  // Upper mandible: ridge on top, flat underside (the mouth line).
  const upper = (t) => {
    const c = [base[0], base[1] - billDropAt(shape, t) * bl.len, base[2] - t * bl.len];
    const w = (bl.baseW / 2) * billWidthAt(shape, t);
    const h = bl.baseH * 0.55 * billHeightAt(shape, t);
    return { c, w, h };
  };
  const lowerLen = P.lowerLen;
  const lower = (t) => {
    const tt = t * lowerLen;
    const c = [base[0], base[1] - billDropAt(shape, tt) * bl.len * 0.85, base[2] - tt * bl.len];
    const w = (bl.baseW / 2) * billWidthAt(shape, tt) * 0.95;
    const h = bl.baseH * P.lowerH * billHeightAt(shape, tt);
    return { c, w, h };
  };
  // Each mandible is a three-sided tube: two outer faces meeting at the ridge (upper)
  // or keel (lower), and a flat inner face on the mouth line that shows the gape when
  // the bill opens. c[0] flags vertices on that inner face (1 = left edge, 0.5 = right).
  const ring = (fn, i, j, sign) => {
    const s = fn(i / N), k = j % 3; // j: 0 left edge, 1 ridge/keel, 2 right edge, 3 left edge again
    const x = k === 0 ? -s.w : k === 2 ? s.w : 0;
    const y = k === 1 ? sign * s.h : 0;
    return [s.c[0] + x, s.c[1] + y, s.c[2]];
  };
  for (const [fn, sign, bone, part] of [[upper, 1, BONE.head, 'bill'], [lower, -1, BONE.jaw, 'lowerbill']]) {
    surface(B, {
      part, nu: N, nv: 3,
      point(i, j) {
        const p = ring(fn, i, j, sign);
        // The basal lower mandible of seabirds carries the gular skin (throat colour).
        const throatSac = part === 'lowerbill' && arch === 'seabird' && j >= 1 && j <= 2 && i <= 1;
        return { p, c: [j === 3 ? 1 : j === 2 ? 0.5 : 0, sign, throatSac ? -0.5 : i / N], ...rigid(bone) };
      },
      outward: (cen, n, c) => {
        if (c[0] > 0.5) return n[1] * sign <= 0; // mouth line: faces into the gape
        const t = clamp((base[2] - cen[2]) / (bl.len || 1), 0, 1);
        const ctr = fn(part === 'bill' ? t : t / lowerLen).c;
        return dot(n, sub(cen, ctr)) >= 0;
      },
      colour: (s, y, f) => {
        if (s > 0.5) return mouthRgb;
        return part === 'lowerbill' ? B.paint('lowerbill', 0, y, f) : billRgb;
      },
    });
  }
  return base;
}

function buildCrest(B, R) {
  if (!R.crest) return;
  const r = R.head.r, H = [R.head.x, R.head.y, R.head.z], L = R.crest.len;
  const front = [H[0], H[1] + 0.86 * r, H[2] - 0.25 * r];
  const back = [H[0], H[1] + 0.72 * r, H[2] + 0.55 * r];
  const left = [H[0] - 0.3 * r, H[1] + 0.8 * r, H[2] + 0.1 * r];
  const right = [H[0] + 0.3 * r, H[1] + 0.8 * r, H[2] + 0.1 * r];
  const tip = [H[0], H[1] + 0.8 * r + L * 0.7, H[2] + L * 0.75];
  const faces = [[front, right, tip], [right, back, tip], [back, left, tip], [left, front, tip]];
  const cen = scale(add(add(add(front, back), add(left, right)), tip), 0.2);
  for (const f of faces) {
    let n = cross(sub(f[1], f[0]), sub(f[2], f[0]));
    let tri = f;
    if (dot(n, sub(scale(add(add(f[0], f[1]), f[2]), 1 / 3), cen)) < 0) { tri = [f[0], f[2], f[1]]; n = scale(n, -1); }
    const nn = norm(n);
    const fc = (tri[0][2] + tri[1][2] + tri[2][2]) / 3;
    const rgb = B.paint('crest', 0, 1, clamp(-(fc - H[2]) / r, -1, 1));
    B.tri('crest', ...tri.map((p) => ({ p, n: nn, ...rigid(BONE.head) })), rgb, false);
  }
}

/** Throat bulge centre (bone pivot). */
export function throatCentre(R) {
  const r = R.head.r;
  return [R.head.x, R.head.y - 0.5 * r, R.head.z - 0.36 * r];
}

function buildThroat(B, R) {
  const r = R.head.r, c = throatCentre(R);
  sphereAt(B, 'throat', c, [0.42 * r, 0.36 * r, 0.45 * r], BONE.throat, 4, 6,
    (s, y, f) => B.paint('head', s * 0.4, -0.72 + 0.15 * y, 0.32 + 0.2 * f));
}

function buildTail(B, R) {
  const T = R.tail, root = [T.root.x, T.root.y, T.root.z];
  const nu = 6, nv = 3; // lateral columns × length rows
  const baseHalf = R.body.rx * 0.42, tipHalf = T.width / 2;
  const thick = Math.max(T.len * 0.035, 0.0015);
  for (const top of [1, -1]) {
    surface(B, {
      part: 'tail', nu, nv,
      point(i, j) {
        const s = -1 + (2 * i) / nu, l = j / nv;
        const half = baseHalf + (tipHalf - baseHalf) * l;
        const z = l * T.len * tailLengthAt(T.shape, s);
        const y = -z * 0.12 + top * thick * (1 - s * s * 0.7) * (1 - l * 0.6);
        return { p: [root[0] + s * half, root[1] + y, root[2] + z], c: [s, top, l], ...rigid(BONE.tail) };
      },
      outward: (cen, n) => n[1] * top >= 0,
    });
  }
}

/** Wrist position (bone pivot of the hand) relative to the mesh origin, right side. */
export function wristOf(R) {
  const W = R.wing, p = WING_PROFILES[W.shape];
  const o0 = wingOutline(W.shape, 0), ok = wingOutline(W.shape, p.knee);
  const zLE = (ok.le - o0.chord * 0.25) * W.len;
  return [W.shoulder.x + p.knee * W.len, W.shoulder.y, W.shoulder.z + zLE];
}

function buildWing(B, R, side) {
  const W = R.wing, P = WING_PROFILES[W.shape];
  const S = [W.shoulder.x * side, W.shoulder.y, W.shoulder.z];
  const knee = P.knee;
  const us = [0, knee * 0.5, knee, knee + (1 - knee) / 3, knee + (2 * (1 - knee)) / 3, 1];
  const vs = [0, 1 / 3, 2 / 3, 1];
  const o0 = wingOutline(W.shape, 0);
  const wing = side > 0 ? BONE.wingR : BONE.wingL, hand = side > 0 ? BONE.handR : BONE.handL;
  const at = (u, v, top) => {
    const o = wingOutline(W.shape, u);
    const zLE = (o.le - o0.chord * 0.25) * W.len;
    const chord = o.chord * W.len;
    const camber = chord * 0.07 * 4 * v * (1 - v);
    const th = Math.max(chord * 0.035 * (1 - u * 0.6), 0.0008);
    const y = camber + top * th;
    return [S[0] + side * u * W.len, S[1] + y, S[2] + zLE + v * chord];
  };
  const weights = (u) => (u < knee - 1e-6 ? { b0: wing, b1: wing, w: 1 } : u > knee + 1e-6 ? { b0: hand, b1: hand, w: 1 } : { b0: wing, b1: hand, w: 0.5 });
  for (const top of [1, -1]) {
    surface(B, {
      part: 'wing', nu: us.length - 1, nv: vs.length - 1,
      point(i, j) {
        const u = us[i], v = vs[j];
        return { p: at(u, v, top), c: [u, top, v], ...weights(u) };
      },
      outward: (cen, n) => n[1] * top >= 0,
    });
  }
  if (W.fingers) {
    // Slotted primaries ("fingers") of broad soaring wings: a buzzard/eagle hallmark.
    const o1 = wingOutline(W.shape, 1);
    const tipChord = o1.chord * W.len;
    const zLE1 = (o1.le - o0.chord * 0.25) * W.len;
    const flen = W.fingerLen, fw = Math.max(tipChord * 0.11, 0.003);
    for (let k = 0; k < 5; k++) {
      const v = 0.1 + 0.2 * k;
      const ang = (k - 1.5) * 0.13; // fan the fingers slightly backwards
      const bx = S[0] + side * W.len, bz = S[2] + zLE1 + v * tipChord;
      const dx = side * Math.cos(ang), dz = Math.sin(ang);
      const tipP = [bx + dx * flen, S[1], bz + dz * flen];
      const a = [bx, S[1], bz - fw / 2], b = [bx, S[1], bz + fw / 2];
      const tipA = [tipP[0], tipP[1], tipP[2] - fw * 0.3], tipB = [tipP[0], tipP[1], tipP[2] + fw * 0.3];
      const rgb = B.paint('wing', 1, 1, v);
      const rgbU = B.paint('wing', 1, -1, v);
      for (const [ny, col] of [[1, rgb], [-1, rgbU]]) {
        const quad = [a, tipA, tipB, b].map((p) => ({ p: [p[0], p[1] + ny * 0.0004, p[2]], n: [0, ny, 0], b0: hand, b1: hand, w: 1 }));
        const t1 = [quad[0], quad[1], quad[2]], t2 = [quad[0], quad[2], quad[3]];
        for (const t of [t1, t2]) {
          const n = cross(sub(t[1].p, t[0].p), sub(t[2].p, t[0].p));
          if (n[1] * ny >= 0) B.tri('wing', t[0], t[1], t[2], col, false);
          else B.tri('wing', t[0], t[2], t[1], col, false);
        }
      }
    }
  }
}

/** Pivot of the folded-wing shells (on the body axis at the front of the fold). */
export function coverPivot(R) {
  return [0, 0, R.wing.shoulder.z - R.body.rz * 0.05];
}

function buildCover(B, R, side) {
  const { rx, ry, rz } = R.body, W = R.wing;
  const zF = coverPivot(R)[2];
  const zT = W.shoulder.z + W.foldedLen * W.len;
  const nu = 9, nv = 6;
  const bone = side > 0 ? BONE.coverR : BONE.coverL;
  surface(B, {
    part: 'cover', paintPart: 'wing', nu, nv, doubleSided: true,
    point(i, j) {
      const t = i / nu, v = j / nv;
      const z = zF + (zT - zF) * t;
      const zr = clamp(z / rz, -1, 1);
      const ez = Math.sqrt(Math.max(0, 1 - zr * zr)) * bodyTaper(zr);
      const Rx = Math.max(rx * ez, rx * 0.42 * (1 - 0.5 * t));
      const Ry = Math.max(ry * ez, ry * 0.42 * (1 - 0.5 * t));
      const bm = 0.42 * Math.PI, hw = 0.3 * Math.PI * (1 - 0.55 * Math.pow(t, 1.5));
      const b = bm - hw + 2 * hw * v;
      const p = [side * Rx * 1.07 * Math.sin(b), Ry * 1.07 * Math.cos(b) + ry * 0.04, z];
      return { p, c: [0.2 + 0.8 * t, 1, v], ...rigid(bone) };
    },
    outward: (cen, n) => n[0] * side + n[1] * 0.3 >= 0,
  });
}

function buildLeg(B, R, side, webbed) {
  const Lg = R.legs, bone = side > 0 ? BONE.legR : BONE.legL;
  const hip = [Lg.hip.x * side, Lg.hip.y, Lg.hip.z];
  const L = Lg.len, r = Lg.r;
  // hip → heel (the backward-pointing joint) → foot directly under the hip.
  const pts = [hip, add(hip, [0, -0.5 * L, 0.1 * L]), add(hip, [0, -L, 0])];
  const legRgb = B.pal.legs;
  for (let s = 0; s < 2; s++) {
    const a = pts[s], b = pts[s + 1], d = norm(sub(b, a));
    const u = norm(cross(d, [1, 0, 0]));
    const vv = [1, 0, 0];
    surface(B, {
      part: 'legs', nu: 1, nv: 4,
      point(i, j) {
        const phi = (j / 4) * TAU + Math.PI / 4;
        const c = i ? b : a, rr = r * (i ? 0.85 : 1);
        return { p: add(c, add(scale(u, rr * Math.cos(phi)), scale(vv, rr * Math.sin(phi)))), c: [0, 0, 0], ...rigid(bone) };
      },
      outward: (cen, n) => {
        const t = dot(sub(cen, a), d);
        return dot(n, sub(cen, add(a, scale(d, t)))) >= 0;
      },
      colour: () => legRgb,
    });
  }
  // Toes: three forward, one back; flat double-sided slivers on the ground plane.
  const foot = pts[2], toe = Lg.toe, tw = Math.max(r * 1.1, 0.0012);
  const toeDirs = [[-0.42, toe], [0, toe * 1.1], [0.42, toe], [Math.PI, toe * 0.55]];
  const ends = [];
  for (const [ang, tl] of toeDirs) {
    const dir = [Math.sin(ang) * side, 0, -Math.cos(ang)];
    const perp = [-dir[2], 0, dir[0]];
    const end = add(foot, scale(dir, tl));
    ends.push(end);
    const q = [add(foot, scale(perp, tw)), add(end, scale(perp, tw * 0.4)), add(end, scale(perp, -tw * 0.4)), add(foot, scale(perp, -tw))];
    flatQuad(B, 'legs', q, bone, legRgb);
  }
  if (webbed) {
    // Webbing between the front toes (ducks, gulls, seabirds).
    for (const [i0, i1] of [[0, 1], [1, 2]]) {
      const a = add(foot, scale(sub(ends[i0], foot), 0.95)), b = add(foot, scale(sub(ends[i1], foot), 0.95));
      flatTri(B, 'legs', [foot, a, b], bone, mix(legRgb, [0.2, 0.2, 0.2], 0.15));
    }
  }
}

function flatTri(B, part, p3, bone, rgb) {
  const n = norm(cross(sub(p3[1], p3[0]), sub(p3[2], p3[0])));
  const up = n[1] >= 0 ? n : scale(n, -1);
  const v = (p, nn) => ({ p, n: nn, ...rigid(bone) });
  const ordered = n[1] >= 0 ? p3 : [p3[0], p3[2], p3[1]];
  B.tri(part, v(ordered[0], up), v(ordered[1], up), v(ordered[2], up), rgb, true);
  const dn = scale(up, -1);
  B.tri(part, v(ordered[0], dn), v(ordered[2], dn), v(ordered[1], dn), rgb, true);
}

function flatQuad(B, part, q, bone, rgb) {
  flatTri(B, part, [q[0], q[1], q[2]], bone, rgb);
  flatTri(B, part, [q[0], q[2], q[3]], bone, rgb);
}

/** Twig pivot: held across the bill, a little behind the tip. */
export function twigPivot(R) {
  const b = billBase(R);
  return [b[0], b[1] - R.bill.baseH * 0.1, b[2] - R.bill.len * 0.55];
}

function buildTwig(B, R) {
  const c = twigPivot(R);
  const tl = Math.max(R.bill.len * 2.2, R.length * 0.35, 0.04);
  const r = Math.max(tl * 0.025, 0.0012);
  const pts = [add(c, [-tl * 0.45, 0, 0.0]), add(c, [0, r * 1.5, -r]), add(c, [tl * 0.55, -tl * 0.06, tl * 0.08])];
  for (let s = 0; s < 2; s++) {
    const a = pts[s], b = pts[s + 1], d = norm(sub(b, a));
    const u = norm(cross(d, [0, 1, 0.3])), vv = norm(cross(d, u));
    surface(B, {
      part: 'twig', nu: 1, nv: 4,
      point(i, j) {
        const phi = (j / 4) * TAU;
        const cc = i ? b : a;
        return { p: add(cc, add(scale(u, r * Math.cos(phi)), scale(vv, r * Math.sin(phi)))), c: [0, 0, 0], ...rigid(BONE.twig) };
      },
      outward: (cen, n) => {
        const t = dot(sub(cen, a), d);
        return dot(n, sub(cen, add(a, scale(d, t)))) >= 0;
      },
      colour: () => TWIG,
    });
  }
}

// --- public -----------------------------------------------------------------------

/** Absolute bind positions of every bone (mesh space). */
export function bonePositions(R) {
  const head = [R.head.x, R.head.y, R.head.z];
  const neckBase = R.neck ? [R.neck.base.x, R.neck.base.y, R.neck.base.z] : [0, R.body.ry * 0.45, -R.body.rz * 0.72];
  const wr = wristOf(R);
  const sh = [R.wing.shoulder.x, R.wing.shoulder.y, R.wing.shoulder.z];
  const cp = coverPivot(R);
  const hip = [R.legs.hip.x, R.legs.hip.y, R.legs.hip.z];
  const pos = {
    body: [0, 0, 0], neck: neckBase, head,
    jaw: billBase(R), throat: throatCentre(R), tail: [R.tail.root.x, R.tail.root.y, R.tail.root.z],
    wingL: [-sh[0], sh[1], sh[2]], handL: [-wr[0], wr[1], wr[2]],
    wingR: sh, handR: wr,
    coverL: cp, coverR: cp,
    legL: [-hip[0], hip[1], hip[2]], legR: hip,
    twig: twigPivot(R),
  };
  return BONES.map((n) => pos[n]);
}

/**
 * Build the complete vertex data of a species' bird model.
 * @returns {{ positions, normals, colors, colorsRare, skinIndex, skinWeight, vertexCount,
 *   bones: {name, parent, pos:number[], rel:number[]}[], rig, palette, parts, radius, centre }}
 */
export function buildBirdMesh(species) {
  const R = deriveRig(species);
  const pal = preparePalette(species?.look);
  const B = new Builder(pal, { arch: R.arch, disc: R.head.disc });
  buildBody(B, R);
  buildNeck(B, R);
  buildHead(B, R);
  buildEyes(B, R);
  buildBill(B, R, R.arch);
  buildCrest(B, R);
  buildThroat(B, R);
  buildTail(B, R);
  for (const side of [-1, 1]) {
    buildWing(B, R, side);
    buildCover(B, R, side);
    buildLeg(B, R, side, R.legs.webbed);
  }
  buildTwig(B, R);

  const n = B.pos.length / 3;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    skinIndex[i * 4] = B.b0[i];
    skinIndex[i * 4 + 1] = B.b1[i];
    skinWeight[i * 4] = B.w[i];
    skinWeight[i * 4 + 1] = 1 - B.w[i];
  }
  const abs = bonePositions(R);
  const bones = BONES.map((name, i) => {
    const parent = BONE_PARENT[i];
    const pp = parent >= 0 ? abs[parent] : [0, 0, 0];
    return { name, parent, pos: abs[i], rel: sub(abs[i], pp) };
  });
  // Generous bounds for frustum culling across every pose (wings spread or not).
  let maxR = 0;
  for (let i = 0; i < B.pos.length; i += 3) maxR = Math.max(maxR, Math.hypot(B.pos[i], B.pos[i + 1], B.pos[i + 2]));
  return {
    positions: new Float32Array(B.pos),
    normals: new Float32Array(B.nrm),
    colors: new Float32Array(B.col),
    colorsRare: new Float32Array(B.leu),
    skinIndex, skinWeight,
    vertexCount: n,
    bones,
    rig: R,
    palette: pal,
    parts: B.parts,
    radius: maxR,
  };
}
