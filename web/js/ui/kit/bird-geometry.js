// Pure geometry derivation for the field-guide bird drawing (no DOM, no canvas).
//
// deriveBirdGeometry(species, pose) turns a species' `look` (core.Appearance) plus the
// couple of facts that affect posture (traits.shape, move.ground) into plain numbers and
// polygons in "bird units": the body is 1.0 long, +x points the way the bird faces, +y is
// down and y = 0 is the perch / waterline. bird-art.js only paints what is computed here,
// so every proportion rule lives in one testable place.

/* Vocabularies (internal/species/catalog.go Validate). */
export const TAIL_SHAPES = ['square', 'forked', 'fan', 'pointed', 'cocked'];
export const BILL_SHAPES = ['cone', 'thin', 'dagger', 'hooked', 'flat', 'curved', 'chisel'];
export const WING_SHAPES = ['rounded', 'pointed', 'broad', 'long'];
export const MARK_KINDS = ['breast', 'cap', 'mask', 'eyestripe', 'wingbar', 'bib', 'collar', 'rump', 'cheek', 'spots', 'streaks', 'tailtip', 'bars', 'throat', 'nape', 'wingpatch'];
export const REVEAL_KEYS = ['size', 'shape', 'primary', 'secondary', 'marking', 'bill'];
export const POSES = ['perched', 'flying'];

export const DEFAULT_COLORS = {
  back: '#7a6a5b', belly: '#cbbfa8', head: '#7a6a5b', wing: '#6b5d4f', tail: '#5f5246', bill: '#4a4036', legs: '#7b6b5a', eye: '#1c1612',
};

/** A plain songbird: the "I have not worked out the shape yet" sketch. */
export const GENERIC_LOOK = {
  length: 0.15, wingspan: 0.22, plump: 1, neck: 0.1, legs: 0.25, tail: 0.65, tailShape: 'square',
  bill: 0.9, billShape: 'cone', crest: false, wingShape: 'rounded', colors: DEFAULT_COLORS, marks: [],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const pick = (v, set, d) => (set.includes(v) ? v : d);
const P = (x, y) => [x, y];

/** Clamp and default a look so the geometry never sees NaN or an unknown word. */
export function normalizeLook(look) {
  const l = look || {};
  const length = clamp(num(l.length, 0.15), 0.05, 2);
  const colors = { ...DEFAULT_COLORS };
  for (const k of Object.keys(DEFAULT_COLORS)) {
    if (typeof l.colors?.[k] === 'string' && /^#[0-9a-f]{6}$/i.test(l.colors[k])) colors[k] = l.colors[k];
  }
  return {
    length,
    wingspan: clamp(num(l.wingspan, length * 1.6), length * 0.5, length * 4),
    plump: clamp(num(l.plump, 1), 0.6, 1.5),
    neck: clamp(num(l.neck, 0), 0, 1),
    legs: clamp(num(l.legs, 0.3), 0, 1.2),
    tail: clamp(num(l.tail, 0.6), 0.1, 1.8),
    tailShape: pick(l.tailShape, TAIL_SHAPES, 'square'),
    bill: clamp(num(l.bill, 1), 0.15, 3.4),
    billShape: pick(l.billShape, BILL_SHAPES, 'cone'),
    crest: !!l.crest,
    wingShape: pick(l.wingShape, WING_SHAPES, 'rounded'),
    colors,
    marks: (Array.isArray(l.marks) ? l.marks : []).filter((m) => m && MARK_KINDS.includes(m.kind))
      .map((m) => ({ kind: m.kind, color: /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '#f2ebdd' })),
  };
}

/* ------------------------------------------------------------------ splines */

/** Open Catmull-Rom spline through pts (endpoints included), `per` samples per segment. */
export function catmullRom(pts, per = 6) {
  if (pts.length < 3) return pts.map((p) => p.slice());
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

/** Sample a cubic Bézier (4 control points) into n+1 points. */
export function cubic(p0, p1, p2, p3, n = 14) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]));
  }
  return out;
}

/* -------------------------------------------------------------- bill profile */

/**
 * The bill as a closed polygon in its own frame: origin at the base, +x along the bill,
 * +y towards the lower mandible. kind ∈ BILL_SHAPES.
 */
export function billProfile(kind, len, depth, n = 18) {
  const upper = [], lower = [];
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let bend = 0, h = depth / 2, lowF = 0.9;
    switch (kind) {
      case 'thin': bend = len * 0.03 * t; h = (depth / 2) * (1 - 0.9 * t); lowF = 0.85; break;
      case 'dagger': h = (depth / 2) * Math.pow(1 - t, 0.9); break;
      case 'hooked': bend = len * 0.34 * t * t * t; h = (depth / 2) * Math.pow(1 - t, 0.55) * (1 - 0.25 * smooth(0.6, 1, t)); lowF = 0.8; break;
      case 'flat': h = (depth / 2) * (0.82 + 0.18 * (1 - t)) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.9) / 0.1, 2))); lowF = 0.75; break;
      case 'curved': bend = len * 0.42 * t * t; h = (depth / 2) * (1 - 0.82 * t); lowF = 0.9; break;
      case 'chisel': h = (depth / 2) * (1 - 0.4 * t); lowF = 1; break;
      default: h = (depth / 2) * Math.pow(1 - t, 0.72); lowF = 0.85; // cone
    }
    upper.push(P(t * len, bend - h));
    lower.push(P(t * len, bend + h * lowF));
  }
  return { upper, lower, polygon: [...upper, ...lower.reverse()] };
}

/* -------------------------------------------------------------- tail polygon */

/** Tail polygon (world coordinates) from {root, t, len, w0, w1, notch, kind}. */
export function tailPolygon(tail) {
  const { root, t, len, w0, w1, notch, kind } = tail;
  const nx = -t[1], ny = t[0];
  const at = (u, v) => P(root[0] + t[0] * u * len + nx * v, root[1] + t[1] * u * len + ny * v);
  const pts = [at(0, -w0 / 2)];
  if (kind === 'fan') {
    pts.push(at(0.55, -w1 * 0.46), at(0.9, -w1 * 0.36), at(1.0, -w1 * 0.15), at(1.0, w1 * 0.15), at(0.9, w1 * 0.36), at(0.55, w1 * 0.46));
  } else if (kind === 'pointed') {
    pts.push(at(0.6, -w1 * 0.3 - w0 * 0.12), at(1, 0), at(0.6, w1 * 0.3 + w0 * 0.12));
  } else if (kind === 'forked') {
    pts.push(at(0.8, -w1 / 2), at(1, -w1 / 2), at(1 - notch / len, -w1 * 0.06), at(1, w1 / 2), at(0.8, w1 / 2));
  } else { // square, cocked
    pts.push(at(0.85, -w1 / 2), at(1, -w1 * 0.42), at(1, w1 * 0.42), at(0.85, w1 / 2));
  }
  pts.push(at(0, w0 / 2));
  return pts;
}

/* -------------------------------------------------------------- wing outlines */

// Perched wing: keys are [u along the folded wing, v across it in wing-depth units].
const PERCHED_WING = {
  rounded: { up: [[0, -0.45], [0.25, -0.62], [0.6, -0.5], [0.92, -0.16], [1, 0.1]], low: [[0.92, 0.36], [0.6, 0.55], [0.28, 0.52], [0.04, 0.3]], depth: 1.1, len: 0.62 },
  pointed: { up: [[0, -0.4], [0.3, -0.55], [0.65, -0.4], [1, 0.02]], low: [[0.65, 0.2], [0.3, 0.45], [0.05, 0.35]], depth: 0.9, len: 0.84 },
  broad: { up: [[0, -0.5], [0.25, -0.76], [0.6, -0.66], [0.93, -0.3], [1, 0.1]], low: [[0.93, 0.42], [0.76, 0.56], [0.5, 0.7], [0.25, 0.7], [0.04, 0.42]], depth: 1.25, len: 0.7 },
  long: { up: [[0, -0.35], [0.3, -0.46], [0.7, -0.3], [1, -0.02]], low: [[0.7, 0.14], [0.3, 0.36], [0.05, 0.3]], depth: 0.8, len: 1.0 },
};

// Flying wing (raised): v runs from the leading edge (0) back to the trailing edge (~1).
const FLYING_WING = {
  rounded: { lead: [[0, 0], [0.3, -0.02], [0.7, 0.03], [0.96, 0.14], [1, 0.3]], trail: [[0.95, 0.55], [0.7, 0.8], [0.4, 0.95], [0.1, 0.95], [0, 0.75]], chord: 0.42, sweep: 0.35 },
  broad: { lead: [[0, 0], [0.3, -0.04], [0.7, 0], [0.95, 0.08], [1, 0.2]], trail: [[0.98, 0.5], [0.88, 0.6], [0.75, 0.86], [0.5, 1.0], [0.2, 1.0], [0, 0.8]], chord: 0.62, sweep: 0.15 },
  pointed: { lead: [[0, 0], [0.4, -0.02], [0.75, 0.06], [1, 0.26]], trail: [[0.7, 0.55], [0.4, 0.8], [0.1, 0.9], [0, 0.7]], chord: 0.3, sweep: 0.85 },
  long: { lead: [[0, 0], [0.3, -0.1], [0.6, -0.14], [0.85, -0.04], [1, 0.15]], trail: [[0.8, 0.15], [0.55, 0.3], [0.3, 0.5], [0.08, 0.62], [0, 0.6]], chord: 0.27, sweep: 0.25 },
};

function wingFramePoint(w, u, v) {
  return P(w.origin[0] + w.ax[0] * u * w.lenU + w.ay[0] * v * w.depthU, w.origin[1] + w.ax[1] * u * w.lenU + w.ay[1] * v * w.depthU);
}
/** Map wing-frame coordinates (u along, v across) to bird units. */
export function wingPoint(w, u, v) { return wingFramePoint(w, u, v); }

function wingOutline(w, table, flying) {
  const spec = table[w.shape];
  const upKeys = flying ? spec.lead : spec.up;
  const lowKeys = flying ? spec.trail : spec.low;
  const toWorld = (keys) => keys.map(([u, v]) => wingFramePoint(w, u, v));
  const upper = catmullRom(toWorld(upKeys), 6);
  const tip = upper[upper.length - 1];
  const lower = catmullRom([tip, ...toWorld(lowKeys)], 6);
  return [...upper, ...lower.slice(1)];
}

/**
 * Build a bill of the given shape on a head. `rel` is the length relative to the head
 * radius (core.Appearance.Bill). Used for the real bill and for the generic cone drawn
 * while the player has not yet worked out the bill.
 */
export function placeBill(g, kind, rel) {
  const hr = g.head.r;
  const flying = g.pose === 'flying';
  const angle = ({ hooked: 0.2, curved: 0.28, dagger: 0.14, flat: 0.06, chisel: 0.06, thin: 0.12, cone: 0.14 }[kind] ?? 0.14) * (flying ? 0.4 : 1);
  const len = Math.max(0.05, rel * hr * 1.05);
  const depth = hr * ({ cone: 0.62, thin: 0.2, dagger: 0.4, hooked: 0.62, flat: 0.5, curved: 0.26, chisel: 0.46 }[kind] ?? 0.5);
  const base = P(g.head.cx + hr * 0.8, g.head.cy + hr * 0.12);
  const prof = billProfile(kind, len, depth);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const place = ([x, y]) => P(base[0] + x * ca - y * sa, base[1] + x * sa + y * ca);
  return {
    kind, base, angle, len, depth,
    polygon: prof.polygon.map(place), upper: prof.upper.map(place), lower: prof.lower.map(place),
    tip: place(P(len, prof.upper[prof.upper.length - 1][1])),
  };
}

/* --------------------------------------------------------------------- build */


/**
 * @param species  { look, traits?, move? }
 * @param pose     'perched' | 'flying'
 */
export function deriveBirdGeometry(species, pose = 'perched') {
  const look = normalizeLook(species?.look);
  const shape = species?.traits?.shape || '';
  const ground = species?.move?.ground || '';
  const flying = pose === 'flying';
  const swim = ground === 'swim';
  const cling = ground === 'cling';
  const g = { pose: flying ? 'flying' : 'perched', look, shape };

  // --- body
  const rx = 0.5;
  const ry = (flying ? 0.2 : 0.22) * look.plump;
  let tilt;
  if (flying) tilt = 0.1;
  else if (cling) tilt = 1.2;
  else if (swim) tilt = 0.1 + look.neck * 0.2;
  else if (['duck', 'gull', 'seabird'].includes(shape)) tilt = 0.25;
  else tilt = 0.6 + look.neck * 0.35 + look.legs * 0.2 + (shape === 'owl' ? 0.25 : 0);
  tilt = clamp(tilt, 0.05, 1.25);
  const dir = P(Math.cos(tilt), -Math.sin(tilt)); // towards the head
  const nrm = P(Math.sin(tilt), Math.cos(tilt)); // "down" across the body
  const low = Math.hypot(rx * Math.sin(tilt), ry * Math.cos(tilt));
  const legLen = swim || cling || flying ? 0 : 0.06 + Math.min(look.legs, 1) * 0.8 + Math.max(0, look.legs - 1) * 0.5;
  const cy = flying ? 0 : swim ? -low * 0.62 : cling ? -low - 0.25 : -(legLen + low * 0.88);
  const C = P(0, cy);
  const bodyPt = (u, v) => P(C[0] + dir[0] * rx * u + nrm[0] * ry * v, C[1] + dir[1] * rx * u + nrm[1] * ry * v);
  g.body = { cx: C[0], cy: C[1], rx, ry, rot: -tilt };
  g.tilt = tilt;
  g.dir = dir;
  g.nrm = nrm;
  g.bodyPt = bodyPt;

  // --- head & neck
  const hr = 0.175 * (0.85 + 0.15 * look.plump) * (shape === 'owl' ? 1.3 : 1) * (look.neck > 0.6 ? 0.85 : 1);
  const N0 = bodyPt(0.78, -0.35);
  let H;
  const nl = 0.03 + look.neck * (flying ? (look.neck > 0.6 ? 0.3 : 0.45) : 0.95);
  if (flying) {
    H = P(N0[0] + nl + hr * 0.7, N0[1] - 0.02 - hr * 0.1);
  } else {
    const lean = swim ? 0.9 : cling ? 0.15 : 0.3 + 0.1 * look.neck;
    const reach = nl + hr * 0.55;
    H = P(N0[0] + Math.sin(lean) * reach, N0[1] - Math.cos(lean) * reach);
  }
  g.head = { cx: H[0], cy: H[1], r: hr };
  const nw0 = hr * (1.7 - 0.6 * look.neck), nw1 = hr * (1.15 - 0.3 * look.neck);
  const nStart = P(N0[0] - dir[0] * 0.08, N0[1] - dir[1] * 0.08);
  const nEnd = P(H[0] - hr * 0.1, H[1] + hr * 0.3);
  const span = Math.hypot(nEnd[0] - nStart[0], nEnd[1] - nStart[1]);
  const spine = flying
    ? cubic(nStart, P(nStart[0] + span * 0.35, nStart[1] + span * 0.1), P(nEnd[0] - span * 0.35, nEnd[1] + span * 0.12), nEnd, 12)
    : cubic(nStart, P(nStart[0] - 0.22 * look.neck, nStart[1] - span * 0.55), P(nEnd[0] - 0.12 * look.neck, nEnd[1] + span * 0.4), nEnd, 14);
  g.neck = { spine, w0: nw0, w1: nw1, length: nl, polygon: ribbon(spine, nw0, nw1) };
  g.eye = { x: H[0] + hr * 0.38, y: H[1] - hr * 0.12, r: Math.max(hr * 0.2, 0.012) };

  // --- bill
  g.bill = placeBill(g, look.billShape, look.bill);

  // --- tail
  const tl = look.tail * 0.7;
  const tRoot = bodyPt(-0.9, 0);
  let tvec;
  if (look.tailShape === 'cocked' && !flying) tvec = P(-0.5, -0.87);
  else if (flying) tvec = P(-Math.cos(0.08), Math.sin(0.08));
  else tvec = P(-Math.cos(tilt * 0.85), Math.sin(tilt * 0.85));
  const tw0 = ry * 0.68 * (flying ? 1.2 : 1);
  const tw1 = { square: 1.05, forked: 1.25, fan: 1.9, pointed: 0.25, cocked: 0.95 }[look.tailShape] * tw0 * (flying && look.tailShape !== 'pointed' ? 1.15 : 1);
  g.tail = { kind: look.tailShape, root: tRoot, t: tvec, len: tl, w0: tw0, w1: tw1, notch: look.tailShape === 'forked' ? tl * 0.28 : 0 };
  g.tail.polygon = tailPolygon(g.tail);
  g.tail.tip = P(tRoot[0] + tvec[0] * tl, tRoot[1] + tvec[1] * tl);

  // --- wings
  if (flying) {
    const semi = clamp((look.wingspan / 2) * (totalUnits(look, nl, hr) / look.length), 0.7, 4.6);
    const spec = FLYING_WING[look.wingShape];
    const root = bodyPt(0.22, -0.6);
    const vis = semi * 0.78; // raised wings are foreshortened in side view
    const chord = vis * spec.chord * 0.6;
    const make = (ang, scale, dark) => {
      const ax = P(-Math.sin(ang), -Math.cos(ang)); // root → tip, up and back
      const ay = P(-Math.cos(ang), Math.sin(ang)); // towards the trailing edge
      const w = { shape: look.wingShape, origin: root, ax, ay, lenU: vis * scale, depthU: chord * scale, vMid: 0.5, dark };
      w.outline = wingOutline(w, FLYING_WING, true);
      return w;
    };
    g.wing = make(spec.sweep + 0.35, 1, false);
    g.farWing = make(spec.sweep * 0.4 - 0.15, 0.88, true);
    g.semiSpan = semi;
  } else {
    const spec = PERCHED_WING[look.wingShape];
    const S = bodyPt(0.3, -0.15);
    const a = tilt * 0.9;
    const tw = P(-Math.cos(a), Math.sin(a));
    const wn = P(Math.sin(a), Math.cos(a));
    const w = { shape: look.wingShape, origin: S, ax: tw, ay: wn, lenU: spec.len, depthU: ry * spec.depth * 1.25, vMid: 0 };
    w.outline = wingOutline(w, PERCHED_WING, false);
    g.wing = w;
  }

  // --- legs
  const legW = 0.016 + 0.01 * Math.min(1, look.plump - 0.6);
  if (flying) {
    if (look.legs > 0.45) {
      const hip = bodyPt(-0.75, 0.4);
      g.legs = { visible: true, kind: 'trail', hip, knee: null, foot: P(hip[0] - (legLenFor(look) * 0.9 + 0.1), hip[1] + 0.06), width: legW, toe: 0.06 };
    } else {
      const hip = bodyPt(-0.25, 0.85);
      g.legs = { visible: true, kind: 'tuck', hip, knee: null, foot: P(hip[0] - 0.12, hip[1] + 0.05), width: legW, toe: 0.04 };
    }
  } else if (swim) {
    g.legs = { visible: false, kind: 'hidden', hip: C, knee: null, foot: C, width: legW, toe: 0 };
  } else if (cling) {
    const hip = bodyPt(0.15, 0.85);
    g.legs = { visible: true, kind: 'cling', hip, knee: null, foot: P(hip[0] + 0.1, hip[1] + 0.07), width: legW, toe: 0.06 };
  } else {
    const hip = P(C[0] + 0.04, C[1] + low * 0.8);
    g.legs = { visible: true, kind: 'stand', hip, knee: P(hip[0] - 0.05 - 0.04 * look.legs, hip[1] + (0 - hip[1]) * 0.55), foot: P(hip[0] + 0.015, 0), width: legW, toe: 0.07 + 0.05 * Math.min(1, look.legs) };
  }

  // --- crest
  g.crest = look.crest ? { x: H[0] - hr * 0.2, y: H[1] - hr * 0.88, len: hr * 1.35, angle: -2.25, count: 4 } : null;

  // --- perch
  if (flying) g.perch = null;
  else if (swim) g.perch = { kind: 'water', y: 0, x0: -0.85, x1: 1.15 };
  else if (cling) g.perch = { kind: 'trunk', x: C[0] + ry * nrm[0] + 0.07, y0: C[1] - 0.95, y1: C[1] + 0.75, w: 0.38 };
  else if (ground === 'walk' || ground === 'wade') g.perch = { kind: 'ground', y: 0, x0: -0.85, x1: 1.0 };
  else g.perch = { kind: 'branch', y: 0, x0: -0.45, x1: 0.7, w: 0.04 };

  // --- anchors for the field marks
  g.anchors = {
    crown: P(H[0] - hr * 0.05, H[1] - hr * 0.55),
    throat: P(H[0] + hr * 0.25, H[1] + hr * 0.72),
    cheek: P(H[0] - hr * 0.05, H[1] + hr * 0.28),
    nape: P(H[0] - hr * 0.7, H[1] + hr * 0.05),
    breast: bodyPt(0.55, 0.3),
    belly: bodyPt(0.0, 0.7),
    flank: bodyPt(-0.3, 0.3),
    rump: bodyPt(-0.85, -0.3),
    back: bodyPt(-0.1, -0.7),
    tailTip: g.tail.tip,
  };

  g.unitsTotal = totalUnits(look, nl, hr);
  g.metersPerUnit = look.length / g.unitsTotal;
  g.bbox = computeBBox(g);
  return g;
}

function legLenFor(look) { return 0.06 + Math.min(look.legs, 1) * 0.8 + Math.max(0, look.legs - 1) * 0.5; }

/** Length of the bird in bird units when stretched out: bill tip to tail tip. */
function totalUnits(look, nl, hr) {
  return Math.max(1, look.bill * hr * 1.05 + hr * 1.7 + nl * 0.6 + 1 + look.tail * 0.7 * 0.95);
}

/** A tapered ribbon polygon around a polyline (for the neck). */
export function ribbon(spine, w0, w1) {
  const left = [], right = [];
  for (let i = 0; i < spine.length; i++) {
    const a = spine[Math.max(0, i - 1)], b = spine[Math.min(spine.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const w = (w0 + (w1 - w0) * (i / (spine.length - 1))) / 2;
    left.push(P(spine[i][0] - dy * w, spine[i][1] + dx * w));
    right.push(P(spine[i][0] + dy * w, spine[i][1] - dx * w));
  }
  return [...left, ...right.reverse()];
}

/** Axis-aligned bounds of everything the drawing paints. */
export function computeBBox(g) {
  const pts = [];
  const add = (poly) => { for (const p of poly) pts.push(p); };
  const circle = (cx, cy, r) => { pts.push(P(cx - r, cy - r), P(cx + r, cy + r)); };
  const b = g.body;
  const ex = Math.hypot(b.rx * Math.cos(b.rot), b.ry * Math.sin(b.rot));
  const ey = Math.hypot(b.rx * Math.sin(b.rot), b.ry * Math.cos(b.rot));
  pts.push(P(b.cx - ex, b.cy - ey), P(b.cx + ex, b.cy + ey));
  circle(g.head.cx, g.head.cy, g.head.r);
  add(g.neck.polygon);
  add(g.bill.polygon);
  add(g.tail.polygon);
  add(g.wing.outline);
  if (g.farWing) add(g.farWing.outline);
  if (g.legs?.visible) pts.push(g.legs.foot, g.legs.hip);
  if (g.crest) pts.push(P(g.crest.x + Math.cos(g.crest.angle) * g.crest.len, g.crest.y + Math.sin(g.crest.angle) * g.crest.len));
  if (g.perch?.kind === 'branch' || g.perch?.kind === 'ground' || g.perch?.kind === 'water') pts.push(P(g.perch.x0, g.perch.y + 0.04), P(g.perch.x1, g.perch.y));
  if (g.perch?.kind === 'trunk') pts.push(P(g.perch.x, g.perch.y0), P(g.perch.x + g.perch.w, g.perch.y1));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
