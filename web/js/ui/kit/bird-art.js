// Field-guide bird painter. All proportions come from bird-geometry.js; this file only
// paints them onto a CanvasRenderingContext2D (so it can also be driven by a recording
// mock in tests). Deterministic: no Math.random anywhere.
import { deriveBirdGeometry, GENERIC_LOOK, placeBill, wingPoint, normalizeLook } from './bird-geometry.js';
import { mix, darken, rgba, luminance, COLOR_WORD_SWATCH } from './color.js';

export const INK = '#3a3027';
const GRAPHITE = '#6b5d4f';
const PAPER_LIGHT = '#f1e8d3';
const BARK = '#6d5a47';
const FONT_HAND = '"Bradley Hand","Segoe Print","Comic Sans MS",cursive';

/* ------------------------------------------------------------- reveal state */

/**
 * Normalise opts.reveal. `null`/`undefined` means "show everything" (a fully known
 * species); an array/Set (even empty) means "only what the player has seen".
 */
export function resolveReveal(reveal) {
  if (reveal == null || reveal === false) {
    return { active: false, size: true, shape: true, primary: true, secondary: true, marking: true, bill: true };
  }
  const set = reveal instanceof Set ? reveal : new Set(Array.isArray(reveal) ? reveal : Object.keys(reveal).filter((k) => reveal[k]));
  return { active: true, size: set.has('size'), shape: set.has('shape'), primary: set.has('primary'), secondary: set.has('secondary'), marking: set.has('marking'), bill: set.has('bill') };
}

/**
 * Which colour areas are known, and their colours.
 * primary → head/back/wing/tail, secondary → belly, marking → field marks, eye and legs, bill → bill.
 */
export function partPalette(look, rv) {
  const c = normalizeLook(look).colors;
  const part = (color, known) => ({ color, known });
  return {
    head: part(c.head, rv.primary), back: part(c.back, rv.primary), wing: part(c.wing, rv.primary), tail: part(c.tail, rv.primary),
    belly: part(c.belly, rv.secondary), bill: part(c.bill, rv.bill), legs: part(c.legs, rv.marking), eye: part(c.eye, rv.marking),
    marks: rv.marking,
  };
}

/** Stable small hash → 0..1 sequence (for jitter that must not change between renders). */
export function hashSeq(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

/* ------------------------------------------------------------------- painter */

function polyPath(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}
function boundsOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
}
function ellipseBounds(cx, cy, rx, ry, rot) {
  const ex = Math.hypot(rx * Math.cos(rot), ry * Math.sin(rot)), ey = Math.hypot(rx * Math.sin(rot), ry * Math.cos(rot));
  return [cx - ex, cy - ey, cx + ex, cy + ey];
}

class Painter {
  constructor(g, scale, o) {
    this.g = g; this.s = scale; this.sil = !!o.silhouette; this.dashed = !!o.dashed; this.rv = o.rv;
  }
  px(v) { return v / this.s; }

  /** Fill the current path with a colour, optional light shading, hatching if unknown, and an outline. */
  part(path, bounds, color, known, o = {}) {
    const g = this.g;
    if (this.sil) { path(); g.fillStyle = INK; g.fill(); return; }
    if (this.dashed) { // generic "I don't know the shape yet" sketch
      path();
      if (o.wash) { g.fillStyle = rgba(o.wash, 0.3); g.fill(); }
      if (!o.noOutline) this.outline(path, GRAPHITE, 1.1);
      return;
    }
    path();
    g.fillStyle = known ? color : PAPER_LIGHT;
    g.fill();
    if (known) this.shade(path, bounds, color);
    else this.hatch(path, bounds);
    if (!o.noOutline) this.outline(path, known ? INK : GRAPHITE, o.lw || 1.25);
  }

  shade(path, [x0, y0, x1, y1], color) {
    const g = this.g;
    g.save();
    path();
    g.clip();
    const grd = g.createLinearGradient(x0, y0, x1, y1 + (y1 - y0) * 0.2);
    grd.addColorStop(0, rgba('#ffffff', luminance(color) > 0.6 ? 0.18 : 0.26));
    grd.addColorStop(0.5, rgba('#ffffff', 0));
    grd.addColorStop(1, rgba('#1a120a', 0.3));
    g.fillStyle = grd;
    g.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
    g.restore();
  }

  hatch(path, [x0, y0, x1, y1]) {
    const g = this.g;
    g.save();
    path();
    g.clip();
    g.strokeStyle = rgba(GRAPHITE, 0.5);
    g.lineWidth = this.px(0.8);
    const step = this.px(3.6);
    g.beginPath();
    for (let x = x0 - (y1 - y0); x < x1; x += step) { g.moveTo(x, y1); g.lineTo(x + (y1 - y0), y0); }
    g.stroke();
    g.restore();
  }

  /** A double pencil line: one firm stroke and a faint offset echo. */
  outline(path, color, lw = 1.25) {
    const g = this.g;
    if (this.sil) return; // a silhouette is one flat shape
    g.save();
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (this.dashed) g.setLineDash([this.px(4), this.px(3)]);
    path();
    g.strokeStyle = color; g.lineWidth = this.px(lw); g.globalAlpha = 0.92; g.stroke();
    if (!this.dashed) {
      g.translate(this.px(0.7), this.px(0.5));
      path();
      g.lineWidth = this.px(0.7); g.globalAlpha = 0.22; g.stroke();
    }
    g.restore();
  }

  /** Run `draw` with the part's path as the clip (for marks that must stay inside it). */
  clipped(path, draw) {
    const g = this.g;
    g.save(); path(); g.clip(); draw(); g.restore();
  }

  fillShape(pts, color, alpha = 1) {
    const g = this.g;
    polyPath(g, pts); g.globalAlpha = alpha; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
  }
  fillEllipse(cx, cy, rx, ry, rot, color, alpha = 1) {
    const g = this.g;
    g.beginPath(); g.ellipse(cx, cy, Math.max(rx, 0.001), Math.max(ry, 0.001), rot, 0, Math.PI * 2);
    g.globalAlpha = alpha; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
  }
  stroke(pts, color, w, alpha = 1) {
    const g = this.g;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.globalAlpha = alpha; g.stroke(); g.globalAlpha = 1;
  }
}

/* ------------------------------------------------------------------ marks */

/** Paint every mark that belongs to `which` (body|head|neck|tail|wing); the caller has set the clip. */
function paintMarks(P, geo, species, which) {
  const look = normalizeLook(species?.look);
  const { head, body, tail } = geo;
  const hr = head.r;
  const a = geo.anchors;
  const rnd = hashSeq(String(species?.id || 'bird'));
  const tailAt = (u, v) => {
    const nx = -tail.t[1], ny = tail.t[0];
    return [tail.root[0] + tail.t[0] * u * tail.len + nx * v, tail.root[1] + tail.t[1] * u * tail.len + ny * v];
  };
  const wingBand = (u0, u1, col, alpha) => {
    const w = geo.wing, v0 = w.vMid - 1.2, v1 = w.vMid + 1.2;
    P.fillShape([wingPoint(w, u0, v0), wingPoint(w, u1, v0), wingPoint(w, u1, v1), wingPoint(w, u0, v1)], col, alpha);
  };
  for (const m of look.marks) {
    const col = m.color;
    switch (m.kind) {
      case 'breast':
        if (which === 'body') P.fillEllipse(...geo.bodyPt(0.6, 0.3), body.rx * 0.4, body.ry * 0.75, body.rot, col, 0.95);
        break;
      case 'bib':
        if (which === 'head') P.fillEllipse(a.throat[0], a.throat[1] + hr * 0.1, hr * 0.5, hr * 0.5, 0, col, 0.95);
        if (which === 'body') P.fillEllipse(...geo.bodyPt(0.78, -0.1), body.rx * 0.2, body.ry * 0.55, body.rot, col, 0.95);
        break;
      case 'throat':
        if (which === 'head') P.fillEllipse(a.throat[0], a.throat[1], hr * 0.46, hr * 0.38, 0, col, 0.95);
        break;
      case 'cheek':
        if (which === 'head') P.fillEllipse(a.cheek[0], a.cheek[1], hr * 0.44, hr * 0.36, 0, col, 0.95);
        break;
      case 'nape':
        if (which === 'head') P.fillEllipse(a.nape[0], a.nape[1], hr * 0.36, hr * 0.5, 0.3, col, 0.95);
        break;
      case 'cap':
        if (which === 'head') P.fillShape([[head.cx - hr * 2, head.cy - hr * 2], [head.cx + hr * 2, head.cy - hr * 2], [head.cx + hr * 2, head.cy - hr * 0.12], [head.cx - hr * 2, head.cy - hr * 0.4]], col, 0.97);
        break;
      case 'mask':
        if (which === 'head') P.fillShape([[head.cx - hr * 2, head.cy - hr * 0.42], [head.cx + hr * 2, head.cy - hr * 0.38], [head.cx + hr * 2, head.cy + hr * 0.24], [head.cx - hr * 2, head.cy + hr * 0.2]], col, 0.97);
        break;
      case 'eyestripe':
        if (which === 'head') P.stroke([[head.cx + hr * 1.3, head.cy + hr * 0.08], [head.cx + hr * 0.38, head.cy - hr * 0.12], [head.cx - hr * 1.2, head.cy - hr * 0.02]], col, hr * 0.2, 0.97);
        break;
      case 'collar':
        if (which === 'neck') {
          const sp = geo.neck.spine, i = Math.floor(sp.length * 0.72), p = sp[i], q = sp[Math.min(sp.length - 1, i + 1)];
          P.fillEllipse(p[0], p[1], hr * 0.2, hr * 1.4, Math.atan2(q[1] - p[1], q[0] - p[0]), col, 0.97);
        }
        break;
      case 'rump':
        if (which === 'body') P.fillEllipse(a.rump[0], a.rump[1], body.rx * 0.24, body.ry * 0.55, body.rot, col, 0.97);
        break;
      case 'spots':
        if (which === 'body') {
          for (let i = 0; i < 14; i++) {
            const u = 0.05 + rnd() * 0.85, v = 0.05 + rnd() * 0.8;
            P.fillEllipse(...geo.bodyPt(u, v), body.rx * 0.045, body.rx * 0.045, 0, col, 0.95);
          }
        }
        break;
      case 'streaks':
        if (which === 'body') {
          for (let i = 0; i < 7; i++) {
            const u = i * 0.13 + rnd() * 0.04;
            P.stroke([geo.bodyPt(u + 0.05, 0.08 + rnd() * 0.1), geo.bodyPt(u, 0.5 + rnd() * 0.2)], col, 0.016, 0.95);
          }
        }
        break;
      case 'tailtip':
        if (which === 'tail') { const big = tail.w1 * 2; P.fillShape([tailAt(0.76, -big), tailAt(1.1, -big), tailAt(1.1, big), tailAt(0.76, big)], col, 0.97); }
        break;
      case 'wingbar':
        if (which === 'wing') wingBand(0.5, 0.6, col, 0.97);
        break;
      case 'wingpatch':
        if (which === 'wing') {
          const w = geo.wing, c = wingPoint(w, 0.4, w.vMid);
          P.fillEllipse(c[0], c[1], w.lenU * 0.2, w.depthU * 0.3, Math.atan2(w.ax[1], w.ax[0]), col, 0.97);
        }
        break;
      case 'bars':
        if (which === 'wing') for (const u of [0.26, 0.42, 0.58, 0.74]) wingBand(u, u + 0.05, col, 0.9);
        if (which === 'tail') { const big = tail.w1 * 2; for (const u of [0.35, 0.6]) P.fillShape([tailAt(u, -big), tailAt(u + 0.07, -big), tailAt(u + 0.07, big), tailAt(u, big)], col, 0.9); }
        break;
      default:
    }
  }
}

/* --------------------------------------------------------------- bird parts */

function drawLegs(g, P, geo, pal) {
  const L = geo.legs;
  if (!L?.visible) return;
  const col = P.sil ? INK : (pal.legs.known ? pal.legs.color : GRAPHITE);
  const leg = (dx, alpha) => {
    const hip = [L.hip[0] + dx, L.hip[1]], foot = [L.foot[0] + dx, L.foot[1]];
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = Math.max(L.width, P.px(1.6));
    g.beginPath(); g.moveTo(hip[0], hip[1]);
    if (L.knee) g.quadraticCurveTo(L.knee[0] + dx, L.knee[1], foot[0], foot[1]);
    else g.lineTo(foot[0], foot[1]);
    g.stroke();
    g.lineWidth = Math.max(L.width * 0.8, P.px(1.3));
    g.beginPath();
    const t = L.toe;
    if (L.kind === 'stand' || L.kind === 'cling') {
      g.moveTo(foot[0] - t * 0.5, foot[1] + 0.004); g.lineTo(foot[0], foot[1]); g.lineTo(foot[0] + t, foot[1] + 0.004);
      g.moveTo(foot[0], foot[1]); g.lineTo(foot[0] + t * 0.55, foot[1] - 0.012);
    } else {
      g.moveTo(foot[0], foot[1]); g.lineTo(foot[0] - t, foot[1] + 0.01); g.moveTo(foot[0], foot[1]); g.lineTo(foot[0] - t * 0.8, foot[1] - 0.012);
    }
    g.stroke();
    g.restore();
  };
  if (L.kind === 'stand' || L.kind === 'cling') leg(-0.045, 0.7);
  leg(0, 1);
}

function drawPerch(g, P, geo) {
  const p = geo.perch;
  if (!p) return;
  const bark = P.sil ? INK : BARK;
  if (p.kind === 'branch') {
    const w = p.w;
    const pts = [[p.x0, p.y + w * 0.2], [p.x0 + 0.3, p.y - w * 0.5], [p.x1 - 0.2, p.y - w * 0.55], [p.x1, p.y - w * 0.1], [p.x1, p.y + w * 0.5], [p.x1 - 0.2, p.y + w * 1.0], [p.x0 + 0.3, p.y + w * 1.1], [p.x0, p.y + w * 0.9]];
    const path = () => polyPath(g, pts);
    path(); g.fillStyle = bark; g.fill();
    if (!P.sil) {
      P.outline(path, INK, 1);
      P.stroke([[p.x1 - 0.18, p.y - w * 0.4], [p.x1 + 0.02, p.y - 0.12], [p.x1 + 0.1, p.y - 0.2]], bark, 0.016, 1);
      for (const [lx, ly, la] of [[p.x1 + 0.1, p.y - 0.2, -0.5], [p.x0 + 0.12, p.y - w * 0.5, -2.2]]) {
        g.beginPath(); g.ellipse(lx + Math.cos(la) * 0.06, ly + Math.sin(la) * 0.06, 0.075, 0.032, la, 0, Math.PI * 2);
        g.fillStyle = P.dashed ? 'rgba(124,154,112,.3)' : '#7c9a70'; g.fill();
        g.strokeStyle = INK; g.lineWidth = P.px(0.9); g.globalAlpha = 0.6; g.stroke(); g.globalAlpha = 1;
      }
    }
  } else if (p.kind === 'ground') {
    g.beginPath(); g.moveTo(p.x0, p.y + 0.02);
    g.quadraticCurveTo((p.x0 + p.x1) / 2, p.y - 0.045, p.x1, p.y + 0.02);
    g.lineTo(p.x1, p.y + 0.09); g.lineTo(p.x0, p.y + 0.09); g.closePath();
    g.fillStyle = P.sil ? INK : '#8a9a64'; g.fill();
    if (!P.sil) {
      g.strokeStyle = INK; g.lineWidth = P.px(1); g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1;
      for (const x of [p.x0 + 0.15, p.x0 + 0.5, p.x1 - 0.3, p.x1 - 0.05]) P.stroke([[x, p.y + 0.01], [x - 0.02, p.y - 0.07], [x, p.y + 0.01], [x + 0.03, p.y - 0.06]], '#5f7a4a', P.px(1.3), 0.9);
    }
  } else if (p.kind === 'trunk') {
    g.beginPath(); g.rect(p.x, p.y0, p.w, p.y1 - p.y0);
    g.fillStyle = bark; g.fill();
    if (!P.sil) {
      g.strokeStyle = INK; g.lineWidth = P.px(1); g.globalAlpha = 0.7; g.stroke(); g.globalAlpha = 1;
      for (let i = 0; i < 6; i++) P.stroke([[p.x + p.w * (0.15 + 0.14 * i), p.y0 + 0.05], [p.x + p.w * (0.15 + 0.14 * i) + 0.01, p.y1 - 0.05]], darken(BARK, 0.35), P.px(1.1), 0.7);
    }
  }
}

function drawWaterOverlay(g, P, geo) {
  const p = geo.perch;
  if (p?.kind !== 'water') return;
  g.beginPath(); g.moveTo(p.x0, p.y);
  const n = 8, dx = (p.x1 - p.x0) / n;
  for (let i = 0; i < n; i++) g.quadraticCurveTo(p.x0 + dx * (i + 0.5), p.y + (i % 2 ? 0.03 : -0.03), p.x0 + dx * (i + 1), p.y);
  g.lineTo(p.x1, p.y + 0.16); g.lineTo(p.x0, p.y + 0.16); g.closePath();
  g.fillStyle = P.sil ? INK : 'rgba(98,127,154,.45)'; g.fill();
  if (!P.sil) { g.strokeStyle = 'rgba(58,48,39,.55)'; g.lineWidth = P.px(1.2); g.lineJoin = 'round'; g.stroke(); }
}

function drawBird(g, scale, geo, species, o) {
  const P = new Painter(g, scale, o);
  const pal = partPalette(species?.look, o.rv);
  const wash = o.wash;
  const flying = geo.pose === 'flying';
  const look = normalizeLook(species?.look);
  const bodyPath = () => { g.beginPath(); g.ellipse(geo.body.cx, geo.body.cy, geo.body.rx, geo.body.ry, geo.body.rot, 0, Math.PI * 2); };
  const headPath = () => { g.beginPath(); g.arc(geo.head.cx, geo.head.cy, geo.head.r, 0, Math.PI * 2); };
  const poly = (pts) => () => polyPath(g, pts);
  const bodyB = ellipseBounds(geo.body.cx, geo.body.cy, geo.body.rx, geo.body.ry, geo.body.rot);
  const headB = [geo.head.cx - geo.head.r, geo.head.cy - geo.head.r, geo.head.cx + geo.head.r, geo.head.cy + geo.head.r];
  const showMarks = pal.marks && !P.sil && !P.dashed;
  const headInk = !P.sil && pal.head.known ? INK : GRAPHITE;

  const wasDashed = P.dashed;
  P.dashed = false; // the twig is real even when the bird is only a guess
  drawPerch(g, P, geo);
  P.dashed = wasDashed;
  if (flying && geo.farWing) {
    P.part(poly(geo.farWing.outline), boundsOf(geo.farWing.outline), darken(pal.wing.color, 0.28), pal.wing.known, { wash });
  }
  drawLegs(g, P, geo, pal);

  // tail
  const tailP = poly(geo.tail.polygon);
  P.part(tailP, boundsOf(geo.tail.polygon), pal.tail.color, pal.tail.known, { wash });
  if (showMarks) P.clipped(tailP, () => paintMarks(P, geo, species, 'tail'));

  // neck, then body (the body overlaps the neck base)
  const neckP = poly(geo.neck.polygon);
  P.part(neckP, boundsOf(geo.neck.polygon), pal.head.color, pal.head.known, { wash, noOutline: true });
  if (showMarks) P.clipped(neckP, () => paintMarks(P, geo, species, 'neck'));
  if (!P.sil) P.outline(neckP, headInk, 1.1);

  P.part(bodyPath, bodyB, pal.back.color, pal.back.known, { wash, noOutline: true });
  if (!P.sil && !P.dashed) {
    // belly: the lower part of the body in the belly colour
    const b = geo.body;
    const under = [b.cx + geo.nrm[0] * b.ry * 1.05 + geo.dir[0] * b.rx * 0.12, b.cy + geo.nrm[1] * b.ry * 1.05 + geo.dir[1] * b.rx * 0.12];
    const bellyPath = () => { g.beginPath(); g.ellipse(under[0], under[1], b.rx * 1.08, b.ry * 0.92, b.rot, 0, Math.PI * 2); };
    P.clipped(bodyPath, () => {
      bellyPath();
      g.fillStyle = pal.belly.known ? pal.belly.color : PAPER_LIGHT; g.fill();
      if (pal.belly.known) { bellyPath(); g.strokeStyle = rgba(darken(pal.belly.color, 0.4), 0.25); g.lineWidth = P.px(1); g.stroke(); }
      else P.hatch(bellyPath, bodyB);
    });
    P.shade(bodyPath, bodyB, pal.belly.known ? mix(pal.back.color, pal.belly.color, 0.5) : pal.back.color);
    if (showMarks) P.clipped(bodyPath, () => paintMarks(P, geo, species, 'body'));
  }
  P.outline(bodyPath, !P.sil && pal.back.known ? INK : GRAPHITE, 1.3);

  // wing
  const wingP = poly(geo.wing.outline);
  P.part(wingP, boundsOf(geo.wing.outline), pal.wing.color, pal.wing.known, { wash });
  if (!P.sil && !P.dashed && pal.wing.known) {
    P.clipped(wingP, () => {
      const w = geo.wing;
      for (const v of (flying ? [0.3, 0.5, 0.7] : [-0.2, 0.05, 0.3])) {
        P.stroke([wingPoint(w, 0.12, v), wingPoint(w, 0.55, v + 0.05), wingPoint(w, 0.98, v + 0.1)], rgba(darken(pal.wing.color, 0.5), 0.55), P.px(0.9));
      }
      if (showMarks) paintMarks(P, geo, species, 'wing');
    });
    P.outline(wingP, INK, 1.1);
  }

  // bill (a generic cone until the player has seen the bill), then head
  const billGeo = o.rv.bill || P.sil || P.dashed ? geo.bill : placeBill(geo, 'cone', 0.9);
  P.part(poly(billGeo.polygon), boundsOf(billGeo.polygon), pal.bill.color, pal.bill.known, { lw: 1.1 });
  if (!P.sil && !P.dashed && pal.bill.known) {
    const mid = billGeo.upper.map((u, i) => [(u[0] + billGeo.lower[i][0]) / 2, (u[1] + billGeo.lower[i][1]) / 2]);
    P.stroke(mid.slice(0, Math.ceil(mid.length * 0.88)), rgba(INK, 0.5), P.px(0.9));
  }
  const paintHead = () => {
    P.part(headPath, headB, pal.head.color, pal.head.known, { wash, noOutline: true });
    if (showMarks) P.clipped(headPath, () => paintMarks(P, geo, species, 'head'));
    P.outline(headPath, headInk, 1.3);
  };

  // crest feathers grow out from behind the head
  if (geo.crest && !P.dashed) {
    const c = geo.crest, hc = P.sil ? INK : (pal.head.known ? pal.head.color : PAPER_LIGHT);
    for (let i = 0; i < c.count; i++) {
      const k = i - (c.count - 1) / 2;
      const ang = c.angle + k * 0.32, len = c.len * (1 - Math.abs(k) * 0.16);
      const x0 = c.x + k * 0.012, y0 = c.y + 0.02;
      const cs = Math.cos(ang), sn = Math.sin(ang), nx = -sn * len * 0.16, ny = cs * len * 0.16;
      g.beginPath(); g.moveTo(x0 - nx, y0 - ny);
      g.quadraticCurveTo(x0 + cs * len * 0.55 + nx * 1.4, y0 + sn * len * 0.55 + ny * 1.4, x0 + cs * len, y0 + sn * len);
      g.quadraticCurveTo(x0 + cs * len * 0.4 - nx, y0 + sn * len * 0.4 - ny, x0 + nx, y0 + ny); g.closePath();
      g.fillStyle = hc; g.fill();
      if (!P.sil) { g.strokeStyle = headInk; g.lineWidth = P.px(1); g.globalAlpha = 0.85; g.stroke(); g.globalAlpha = 1; }
    }
  }
  paintHead();

  // eye
  if (!P.sil) {
    const e = geo.eye;
    const eyeCol = P.dashed ? GRAPHITE : (pal.eye.known ? pal.eye.color : INK);
    const darkFace = !P.dashed && pal.marks && look.marks.some((m) => (m.kind === 'mask' || m.kind === 'eyestripe') && luminance(m.color) < 0.3);
    if (darkFace || (!P.dashed && pal.head.known && luminance(pal.head.color) < 0.2)) {
      g.beginPath(); g.arc(e.x, e.y, e.r * 1.5, 0, Math.PI * 2); g.fillStyle = 'rgba(242,235,221,.85)'; g.fill();
    }
    g.beginPath(); g.arc(e.x, e.y, e.r, 0, Math.PI * 2); g.fillStyle = eyeCol; g.fill();
    if (!P.dashed) { g.beginPath(); g.arc(e.x + e.r * 0.3, e.y - e.r * 0.35, e.r * 0.32, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.9)'; g.fill(); }
  }
  drawWaterOverlay(g, P, geo);
}

/* ------------------------------------------------------------------ entry */

/** Paper vignette behind the bird. */
export function paintBackground(g, W, H) {
  g.save();
  g.fillStyle = '#e8dcc0'; g.fillRect(0, 0, W, H);
  const grd = g.createRadialGradient(W / 2, H * 0.48, W * 0.08, W / 2, H / 2, Math.max(W, H) * 0.72);
  grd.addColorStop(0, 'rgba(250,244,230,1)');
  grd.addColorStop(0.65, 'rgba(236,224,196,1)');
  grd.addColorStop(1, 'rgba(196,175,130,1)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(124,100,70,.07)'; g.lineWidth = 1; // faint ruled lines like a notebook page
  g.beginPath();
  for (let y = H * 0.14; y < H; y += H * 0.09) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  g.restore();
}

/**
 * Paint a bird into a W x H area of a 2D context (already scaled to CSS pixels).
 * opts: pose, silhouette, reveal, background, relativeScale (metres across the frame,
 * for size comparisons; otherwise every bird is fitted to the frame like a plate).
 * Returns the layout it used ({scale, tx, ty, geometry, generic}).
 */
export function drawBirdArt(g, W, H, species, opts = {}) {
  const pose = opts.pose === 'flying' ? 'flying' : 'perched';
  const rv = resolveReveal(opts.reveal);
  const sil = !!opts.silhouette;
  const generic = rv.active && !rv.shape && !sil;
  const sp = generic ? { id: species?.id, look: GENERIC_LOOK, traits: { shape: 'songbird' }, move: {} } : species;
  const geo = deriveBirdGeometry(sp, pose);
  if (opts.background) paintBackground(g, W, H);

  const m = Math.min(W, H) * 0.1;
  const bb = geo.bbox;
  let s = Math.min((W - 2 * m) / bb.w, (H - 2 * m) / bb.h);
  if (opts.relativeScale > 0 && !generic) s = Math.min(s, (W / opts.relativeScale) * geo.metersPerUnit);
  const tx = W / 2 - (bb.minX + bb.w / 2) * s;
  const ty = H / 2 - (bb.minY + bb.h / 2) * s;

  g.save();
  g.translate(tx, ty);
  g.scale(s, s);
  const wash = generic && rv.primary ? (COLOR_WORD_SWATCH[species?.traits?.primary] || species?.look?.colors?.back) : undefined;
  drawBird(g, s, geo, sp, { silhouette: sil, dashed: generic, rv, wash });
  g.restore();

  const handFont = (px) => `${Math.round(px)}px ${FONT_HAND}`;
  if (generic) {
    g.save();
    g.font = handFont(Math.min(W, H) * 0.3);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = rgba(GRAPHITE, 0.55);
    g.fillText('?', tx + geo.body.cx * s, ty + geo.body.cy * s);
    g.restore();
  }
  // The size note is unreadable on thumbnails and lands on the perch: big sketches only.
  if (rv.active && rv.size && !sil && species?.traits?.size && Math.min(W, H) >= 120) {
    g.save();
    g.font = handFont(Math.max(10, Math.min(W, H) * 0.075));
    g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.fillStyle = rgba(GRAPHITE, 0.85);
    g.fillText(`size: ${species.traits.size}`, W - m * 0.6, H - m * 0.5);
    g.restore();
  }
  return { scale: s, tx, ty, geometry: geo, generic };
}
