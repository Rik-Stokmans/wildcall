// Procedural illustration of the Naturalist Cabin interior, drawn on a 2D canvas context
// in an 800 x 600 logical space. No DOM access here (the caller owns the canvas), so the
// drawing can be exercised in tests with a recording mock context.
//
// scene = {
//   sky:       logic.skyScene(...)          what the window shows
//   features:  logic.cabinFeatures(profile) owned cabin upgrades (they change the room)
//   slots:     6 | 12                        photo-wall frames
//   equipped:  { optics: true, ... }         gear hanging on the pegboard
//   books:     number                        how full the journal shelf looks
//   active:    station id                    for a soft highlight
// }
import { wallLayout, WALL_AREA, mixHex } from './logic.js';

export const ART_W = 800;
export const ART_H = 600;

/** Where the clickable stations sit (logical px). A station may have several rects. */
export const HOTSPOTS = [
  { station: 'equipment', label: 'Equipment pegboard', x: 22, y: 66, w: 156, h: 196 },
  { station: 'equipment', label: 'Workshop corner', x: 22, y: 274, w: 214, h: 130, needs: 'workshop' },
  { station: 'upgrades', label: 'Cabin plans', x: 184, y: 66, w: 56, h: 130 },
  { station: 'journal', label: 'Journal shelf', x: 256, y: 284, w: 204, h: 84 },
  { station: 'photos', label: 'Photography wall', x: 478, y: 52, w: 304, h: 244 },
  { station: 'research', label: 'Research desk', x: 478, y: 330, w: 236, h: 152 },
  { station: 'research', label: 'Audio laboratory', x: 722, y: 306, w: 70, h: 176, needs: 'audioLab' },
  { station: 'storage', label: 'Storage crates', x: 24, y: 414, w: 200, h: 112 },
  { station: 'rest', label: 'Bed', x: 478, y: 498, w: 308, h: 96 },
];

// Deterministic hash noise so the grain and knots never shimmer between redraws.
function rnd(i, salt = 0) {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const C = {
  wallA: '#a97b4e', wallB: '#94683f', seam: '#6f4b2c', grain: 'rgba(80,50,25,.18)',
  beam: '#4b3626', beamLite: '#5d4533', floorA: '#76533a', floorB: '#684730', floorSeam: '#4d3322',
  ink: '#3a3027', bark: '#554537', cream: '#f2ebdd', paper: '#d9c7a0', paperLite: '#e8dcc0',
  forest: '#355c43', forestDeep: '#24402f', moss: '#7c9a70', amber: '#c98a50', amberSoft: '#e3b685',
  sky: '#627f9a', brass: '#b58a3c', iron: '#5d6168', ironLite: '#8a8f96',
};

function rect(g, x, y, w, h, fill, stroke, lw = 1) {
  if (fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.strokeRect(x, y, w, h); }
}
function rrect(g, x, y, w, h, r, fill, stroke, lw = 1) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function circle(g, x, y, r, fill, stroke, lw = 1) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
}
function line(g, x1, y1, x2, y2, stroke, lw = 1) {
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
  g.strokeStyle = stroke; g.lineWidth = lw; g.stroke();
}
function poly(g, pts, fill) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = fill; g.fill();
}
function vgrad(g, x, y, w, h, top, bottom) {
  const gr = g.createLinearGradient(x, y, x, y + h);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
}

/* ------------------------------------------------------------------ room shell */

function drawShell(g) {
  // timber wall
  vgrad(g, 0, 0, ART_W, 470, C.wallA, C.wallB);
  for (let x = 0; x < ART_W; x += 40) {
    line(g, x, 0, x, 470, C.seam, 1.5);
    for (let k = 0; k < 6; k++) {
      const gx = x + 6 + rnd(x + k, 1) * 28;
      const gy = rnd(x * 3 + k, 2) * 440;
      line(g, gx, gy, gx + (rnd(k + x, 3) - 0.5) * 3, gy + 24 + rnd(k, 4) * 60, C.grain, 1);
    }
    if (rnd(x, 5) > 0.55) {
      const ky = 40 + rnd(x, 6) * 380;
      circle(g, x + 20, ky, 4, '#7d5232', C.seam);
      circle(g, x + 20, ky, 1.6, '#5b3a22');
    }
  }
  // ceiling beams and corner posts
  rect(g, 0, 0, ART_W, 30, C.beam);
  rect(g, 0, 24, ART_W, 6, '#352719');
  for (const bx of [140, 400, 660]) rect(g, bx - 9, 0, 18, 30, C.beamLite);
  rect(g, 0, 0, 14, 470, C.beam);
  rect(g, ART_W - 14, 0, 14, 470, C.beam);
  // floor
  vgrad(g, 0, 470, ART_W, 130, C.floorA, C.floorB);
  for (let r = 0; r < 6; r++) {
    const y = 478 + r * 22 + r * r * 0.6;
    line(g, 0, y, ART_W, y, C.floorSeam, 1.2);
    for (let x = (r % 2) * 90; x < ART_W; x += 180) line(g, x, y, x, y + 22 + r, C.floorSeam, 1);
  }
  rect(g, 0, 462, ART_W, 12, '#4a3220');
  rect(g, 0, 462, ART_W, 2, 'rgba(255,230,190,.25)');
}

/* ------------------------------------------------------------------ window + sky */

function drawWindow(g, sky, features) {
  const x = 262, y = 64, w = 190, h = 190;
  const ix = x + 12, iy = y + 12, iw = w - 24, ih = h - 24;
  rect(g, x - 8, y - 8, w + 16, h + 16, '#5a4230'); // outer frame
  g.save();
  g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
  vgrad(g, ix, iy, iw, ih, sky.top, sky.bottom);
  // stars
  if (sky.stars > 0.02) {
    g.fillStyle = `rgba(255,252,235,${0.85 * sky.stars})`;
    for (let i = 0; i < 34; i++) g.fillRect(ix + rnd(i, 7) * iw, iy + rnd(i, 8) * ih * 0.7, 1.6, 1.6);
  }
  // sun / moon
  if (sky.sun) {
    const sx = ix + sky.sun.x * iw, sy = iy + sky.sun.y * ih;
    const glow = g.createRadialGradient(sx, sy, 2, sx, sy, 46);
    glow.addColorStop(0, 'rgba(255,240,190,.7)'); glow.addColorStop(1, 'rgba(255,240,190,0)');
    g.fillStyle = glow; g.fillRect(ix, iy, iw, ih);
    circle(g, sx, sy, 11, sky.sunColor);
  }
  if (sky.moon) {
    const mx = ix + sky.moon.x * iw, my = iy + sky.moon.y * ih;
    circle(g, mx, my, 10, '#f3efdc');
    circle(g, mx + 4, my - 2, 9, mixHex(sky.top, sky.bottom, 0.3));
    circle(g, mx, my, 10, null, 'rgba(255,255,255,.25)');
  }
  // clouds: count and opacity follow the cloud cover
  const clouds = Math.round(sky.cloud * 6);
  for (let i = 0; i < clouds; i++) {
    const cx = ix + ((rnd(i, 9) * iw * 1.2 + sky.wind * 14 * (i + 1)) % (iw + 40)) - 10;
    const cy = iy + 14 + rnd(i, 10) * ih * 0.4;
    const shade = sky.night ? '70,80,100' : sky.rain > 0.3 ? '150,158,166' : '255,255,255';
    g.fillStyle = `rgba(${shade},${0.55 + sky.cloud * 0.3})`;
    for (const [dx, dy, r] of [[0, 0, 13], [14, 3, 11], [-14, 4, 10], [5, -6, 10]]) {
      g.beginPath(); g.arc(cx + dx, cy + dy, r, 0, Math.PI * 2); g.fill();
    }
  }
  // distant tree line and hills, tinted by the light
  const dusk = sky.night ? 0.7 : 0;
  const hill = mixHex('#4a7459', '#14202a', dusk);
  const near = mixHex('#355c43', '#0f1a1e', dusk);
  g.fillStyle = hill;
  g.beginPath(); g.moveTo(ix, iy + ih);
  for (let i = 0; i <= 10; i++) g.lineTo(ix + (iw / 10) * i, iy + ih * (0.66 + 0.08 * Math.sin(i * 1.3) - 0.03 * rnd(i, 11)));
  g.lineTo(ix + iw, iy + ih); g.closePath(); g.fill();
  g.fillStyle = near;
  for (let i = 0; i < 9; i++) {
    const tx = ix + 8 + i * (iw / 8.6), ty = iy + ih - 10 - rnd(i, 12) * 12, th = 22 + rnd(i, 13) * 18;
    poly(g, [[tx, ty - th], [tx + 9, ty], [tx - 9, ty]], near);
  }
  rect(g, ix, iy + ih - 12, iw, 12, near);
  // observation garden: flower bed and a feeder, only once built
  if (features.garden) {
    rect(g, ix, iy + ih - 18, iw, 18, mixHex('#5c8a4f', '#16251c', dusk));
    const cols = ['#e8c15a', '#d9704f', '#f2ebdd', '#a47bc4'];
    for (let i = 0; i < 18; i++) {
      const fx = ix + 6 + i * 9.6, fy = iy + ih - 12 - rnd(i, 14) * 6;
      line(g, fx, fy, fx, iy + ih - 4, '#2f5b36', 1.2);
      circle(g, fx, fy, 2.6, mixHex(cols[i % 4], '#1c2430', dusk * 0.7));
    }
    line(g, ix + iw * 0.7, iy + ih - 40, ix + iw * 0.7, iy + ih - 12, '#4b3626', 2.2);
    rrect(g, ix + iw * 0.7 - 9, iy + ih - 52, 18, 12, 3, '#c98a50');
    circle(g, ix + iw * 0.7 + 12, iy + ih - 46, 3, '#8a5a32'); // a visitor on the perch
  }
  // rain streaks
  if (sky.rain > 0.05) {
    g.strokeStyle = `rgba(210,225,240,${0.25 + sky.rain * 0.4})`; g.lineWidth = 1;
    const n = Math.round(14 + sky.rain * 36);
    for (let i = 0; i < n; i++) {
      const rx = ix + rnd(i, 15) * iw, ry = iy + rnd(i, 16) * ih;
      g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx - 3, ry + 11); g.stroke();
    }
  }
  if (sky.mist > 0.05) {
    const m = g.createLinearGradient(0, iy + ih * 0.5, 0, iy + ih);
    m.addColorStop(0, 'rgba(235,240,240,0)'); m.addColorStop(1, `rgba(235,240,240,${0.2 + sky.mist * 0.5})`);
    g.fillStyle = m; g.fillRect(ix, iy + ih * 0.5, iw, ih * 0.5);
  }
  g.restore();
  // mullions, sill, curtains
  rect(g, ix + iw / 2 - 3, iy, 6, ih, '#5a4230');
  rect(g, ix, iy + ih / 2 - 3, iw, 6, '#5a4230');
  rect(g, x - 14, y + h + 4, w + 28, 9, '#6b4f38');
  rect(g, x - 14, y + h + 4, w + 28, 2, 'rgba(255,230,190,.3)');
  for (const [cx, dir] of [[x - 6, 1], [x + w + 6, -1]]) {
    g.fillStyle = 'rgba(201,138,80,.85)';
    g.beginPath(); g.moveTo(cx, y - 10); g.lineTo(cx + dir * 34, y - 10); g.lineTo(cx + dir * 22, y + h + 6); g.lineTo(cx, y + h + 6); g.closePath(); g.fill();
    line(g, cx + dir * 8, y - 8, cx + dir * 5, y + h + 4, 'rgba(110,66,34,.5)', 1.5);
    line(g, cx + dir * 20, y - 8, cx + dir * 14, y + h + 4, 'rgba(110,66,34,.5)', 1.5);
  }
  rect(g, x - 20, y - 16, w + 40, 6, '#4a3220');
}

/* ------------------------------------------------------------------ pegboard + plans */

function hook(g, x, y) { circle(g, x, y, 2.4, C.ironLite, C.iron); }

function drawPegboard(g, equipped) {
  const x = 26, y = 70, w = 148, h = 188;
  rrect(g, x, y, w, h, 6, '#b99567', '#6b4f38', 3);
  g.fillStyle = 'rgba(80,55,30,.35)';
  for (let r = 0; r < 9; r++) for (let c = 0; c < 7; c++) g.fillRect(x + 12 + c * 20, y + 12 + r * 20, 2, 2);
  // optics
  const slot = (key, fn) => { fn(!!equipped?.[key]); };
  slot('optics', (on) => {
    const a = on ? C.ink : 'rgba(58,48,39,.25)';
    hook(g, x + 38, y + 18);
    line(g, x + 38, y + 18, x + 30, y + 42, '#6b4f38', 1.5); line(g, x + 38, y + 18, x + 52, y + 42, '#6b4f38', 1.5);
    rrect(g, x + 22, y + 40, 16, 34, 6, a); rrect(g, x + 46, y + 40, 16, 34, 6, a);
    rect(g, x + 36, y + 50, 12, 6, a);
    if (on) { circle(g, x + 30, y + 72, 5, '#2b2f38'); circle(g, x + 54, y + 72, 5, '#2b2f38'); }
  });
  slot('camera', (on) => {
    const a = on ? C.ink : 'rgba(58,48,39,.25)';
    hook(g, x + 112, y + 18);
    line(g, x + 112, y + 18, x + 108, y + 38, '#6b4f38', 1.5);
    rrect(g, x + 88, y + 38, 44, 28, 5, a);
    rect(g, x + 96, y + 32, 14, 7, a);
    if (on) { circle(g, x + 110, y + 53, 9, '#2b2f38'); circle(g, x + 110, y + 53, 4, '#627f9a'); }
  });
  slot('navigation', (on) => {
    hook(g, x + 38, y + 98);
    circle(g, x + 38, y + 124, 17, on ? C.brass : 'rgba(58,48,39,.25)', C.ink, 2);
    if (on) { circle(g, x + 38, y + 124, 12, C.cream); poly(g, [[x + 38, y + 114], [x + 42, y + 124], [x + 34, y + 124]], '#a8553f'); }
  });
  slot('audio', (on) => {
    const a = on ? C.ink : 'rgba(58,48,39,.25)';
    hook(g, x + 104, y + 98);
    g.strokeStyle = a; g.lineWidth = 4;
    g.beginPath(); g.arc(x + 104, y + 118, 15, Math.PI, 0); g.stroke();
    rrect(g, x + 86, y + 116, 9, 18, 3, a); rrect(g, x + 113, y + 116, 9, 18, 3, a);
  });
  slot('clothing', (on) => {
    const a = on ? C.forest : 'rgba(58,48,39,.25)';
    hook(g, x + 38, y + 160);
    poly(g, [[x + 26, y + 164], [x + 38, y + 158], [x + 50, y + 164], [x + 54, y + 184], [x + 22, y + 184]], a);
  });
  slot('backpack', (on) => {
    const a = on ? C.amber : 'rgba(58,48,39,.25)';
    hook(g, x + 104, y + 160);
    rrect(g, x + 90, y + 160, 30, 26, 8, a, on ? C.bark : null, 2);
    if (on) rect(g, x + 98, y + 170, 14, 8, C.bark);
  });
}

function drawPlans(g) {
  // rolled blueprint pinned beside the pegboard + a hanging "plans" sign
  rrect(g, 190, 76, 44, 96, 3, '#35597a', '#1f3850', 2);
  g.strokeStyle = 'rgba(220,235,250,.7)'; g.lineWidth = 1;
  for (let i = 0; i < 5; i++) line(g, 198, 92 + i * 14, 226, 92 + i * 14, 'rgba(220,235,250,.5)', 1);
  rect(g, 206, 100, 12, 14, null, 'rgba(220,235,250,.7)');
  circle(g, 212, 78, 3, '#a8553f'); circle(g, 212, 170, 3, '#a8553f');
  line(g, 196, 176, 228, 176, '#6b4f38', 3);
}

/* ------------------------------------------------------------------ workshop */

function drawWorkshop(g, owned) {
  const x = 24, y = 290, w = 212, h = 118;
  if (!owned) {
    g.save(); g.setLineDash?.([6, 6]);
    rect(g, x + 8, y + 36, w - 16, 74, null, 'rgba(60,40,24,.35)', 2);
    g.restore();
    rect(g, x + 14, y + 98, 22, 12, '#6b4f38'); // a lonely stool leg
    return;
  }
  rect(g, x, y + 66, w, 12, '#8a6340'); rect(g, x, y + 66, w, 3, 'rgba(255,230,190,.35)');
  rect(g, x + 10, y + 78, 10, 40, '#5d4533'); rect(g, x + w - 20, y + 78, 10, 40, '#5d4533');
  rect(g, x + 10, y + 100, w - 20, 8, '#6b4f38');
  // wall tool rack
  rect(g, x + 6, y + 8, w - 12, 8, '#5d4533');
  for (let i = 0; i < 6; i++) {
    const tx = x + 22 + i * 32;
    line(g, tx, y + 16, tx, y + 44 + (i % 3) * 6, C.ironLite, 3);
    rect(g, tx - 4, y + 44 + (i % 3) * 6, 8, 8, i % 2 ? C.amber : C.forest);
  }
  // vice, little brass lamp, pencil jar
  rect(g, x + 22, y + 52, 26, 14, C.iron); rect(g, x + 28, y + 44, 14, 10, C.ironLite);
  circle(g, x + 120, y + 58, 8, C.brass, C.ink, 1.5); rect(g, x + 117, y + 60, 6, 6, C.brass);
  rrect(g, x + 160, y + 48, 16, 18, 3, '#8aa0a4', C.ink); line(g, x + 164, y + 48, x + 160, y + 36, C.bark, 2); line(g, x + 170, y + 48, x + 174, y + 34, C.amber, 2);
}

/* ------------------------------------------------------------------ journal shelf */

function drawShelf(g, books) {
  const x = 262, y = 296, w = 190;
  rect(g, x, y + 56, w, 9, '#6b4f38'); rect(g, x, y + 56, w, 2, 'rgba(255,230,190,.3)');
  rect(g, x + 14, y + 65, 6, 12, '#4b3626'); rect(g, x + w - 20, y + 65, 6, 12, '#4b3626');
  const palette = ['#355c43', '#a8553f', '#c98a50', '#627f9a', '#554537', '#7c9a70', '#8e6ba8'];
  const n = Math.max(3, Math.min(14, books | 0));
  let bx = x + 8;
  for (let i = 0; i < n; i++) {
    const bw = 8 + rnd(i, 20) * 7, bh = 30 + rnd(i, 21) * 20;
    rect(g, bx, y + 56 - bh, bw, bh, palette[i % palette.length], 'rgba(0,0,0,.25)');
    rect(g, bx + 1, y + 56 - bh + 6, bw - 2, 2, 'rgba(255,240,200,.5)');
    bx += bw + 1;
    if (bx > x + w - 66) break;
  }
  // the open "display" journal on a small stand and a pressed-leaf jar
  poly(g, [[x + w - 62, y + 54], [x + w - 34, y + 46], [x + w - 6, y + 54], [x + w - 34, y + 58]], '#4b3626');
  poly(g, [[x + w - 60, y + 50], [x + w - 34, y + 42], [x + w - 34, y + 54], [x + w - 60, y + 54]], C.paperLite);
  poly(g, [[x + w - 34, y + 42], [x + w - 8, y + 50], [x + w - 8, y + 54], [x + w - 34, y + 54]], C.paper);
  rrect(g, x + w - 98, y + 30, 22, 26, 4, 'rgba(190,220,210,.5)', C.ink);
  poly(g, [[x + w - 90, y + 50], [x + w - 87, y + 38], [x + w - 82, y + 50]], C.moss);
}

/* ------------------------------------------------------------------ map room */

function drawMapTable(g, owned) {
  const cx = 357, cy = 462;
  // rug
  g.beginPath(); g.ellipse(cx, cy + 34, 98, 30, 0, 0, Math.PI * 2);
  g.fillStyle = '#7a3f31'; g.fill();
  g.beginPath(); g.ellipse(cx, cy + 34, 80, 22, 0, 0, Math.PI * 2);
  g.strokeStyle = C.amberSoft; g.lineWidth = 2; g.stroke();
  if (!owned) {
    rect(g, cx - 12, cy - 4, 24, 36, '#6b4f38'); rrect(g, cx - 28, cy - 10, 56, 8, 3, '#8a6340'); // plain stool
    return;
  }
  // table with an unrolled map
  rect(g, cx - 82, cy - 22, 164, 10, '#8a6340'); rect(g, cx - 82, cy - 22, 164, 2, 'rgba(255,230,190,.35)');
  rect(g, cx - 74, cy - 12, 8, 48, '#5d4533'); rect(g, cx + 66, cy - 12, 8, 48, '#5d4533');
  poly(g, [[cx - 62, cy - 24], [cx + 62, cy - 24], [cx + 54, cy - 46], [cx - 54, cy - 46]], C.paperLite);
  g.strokeStyle = 'rgba(85,69,55,.5)'; g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    g.beginPath(); g.ellipse(cx - 10 + i * 8, cy - 36, 30 - i * 6, 6 - i, 0, 0, Math.PI * 2); g.stroke();
  }
  line(g, cx - 40, cy - 28, cx - 6, cy - 40, 'rgba(168,85,63,.8)', 1.5);
  circle(g, cx + 30, cy - 38, 2.5, '#a8553f'); circle(g, cx - 40, cy - 28, 2.5, C.forest);
  circle(g, cx + 46, cy - 30, 7, C.brass, C.ink, 1.2); // pocket compass resting on the map
}

/* ------------------------------------------------------------------ storage */

function drawStorage(g) {
  // stacked crates and a banded chest
  rect(g, 34, 442, 80, 62, '#8a6340', '#4b3626', 2);
  for (let i = 1; i < 4; i++) line(g, 34, 442 + i * 15.5, 114, 442 + i * 15.5, 'rgba(60,40,24,.5)', 1.5);
  line(g, 54, 442, 54, 504, 'rgba(60,40,24,.5)', 1.5); line(g, 94, 442, 94, 504, 'rgba(60,40,24,.5)', 1.5);
  rect(g, 46, 392 + 20, 56, 30, '#9a7048', '#4b3626', 2);
  line(g, 46, 442, 102, 412, 'rgba(60,40,24,.35)', 1.5);
  rrect(g, 120, 462, 96, 48, 6, '#6f4b2c', '#3d2a1b', 2);
  rect(g, 120, 478, 96, 5, '#8a8f96'); rect(g, 120, 492, 96, 5, '#8a8f96');
  rect(g, 162, 474, 12, 14, C.brass, C.ink, 1);
  // sack of seed
  g.beginPath(); g.ellipse(196, 444, 20, 24, 0, 0, Math.PI * 2); g.fillStyle = '#c9b585'; g.fill();
  line(g, 186, 424, 206, 424, '#7a6a5b', 3);
}

/* ------------------------------------------------------------------ desk + audio lab */

function drawDesk(g) {
  const x = 484, y = 392;
  // chair back peeking out
  rrect(g, x + 60, 372, 54, 70, 8, '#6f4b2c', '#3d2a1b', 2);
  rect(g, x, y, 232, 12, '#8a6340'); rect(g, x, y, 232, 3, 'rgba(255,230,190,.4)');
  rect(g, x + 8, y + 12, 216, 70, '#6b4f38', '#3d2a1b', 2);
  for (const dx of [14, 124]) {
    rrect(g, x + dx, y + 20, 92, 24, 3, '#7a5a40', '#3d2a1b', 1.5); circle(g, x + dx + 46, y + 32, 3.2, C.brass);
    rrect(g, x + dx, y + 48, 92, 28, 3, '#7a5a40', '#3d2a1b', 1.5); circle(g, x + dx + 46, y + 62, 3.2, C.brass);
  }
  rect(g, x + 8, y + 82, 10, 14, '#4b3626'); rect(g, x + 214, y + 82, 10, 14, '#4b3626');
  // papers, open notebook, magnifier, mug
  poly(g, [[x + 70, y], [x + 146, y], [x + 152, y - 14], [x + 76, y - 14]], C.paperLite);
  line(g, x + 100, y - 14, x + 96, y, 'rgba(85,69,55,.5)', 1);
  for (let i = 0; i < 3; i++) line(g, x + 82 + i * 3, y - 10 + i * 3, x + 124 + i * 3, y - 10 + i * 3, 'rgba(85,69,55,.4)', 1);
  poly(g, [[x + 154, y], [x + 190, y], [x + 192, y - 4], [x + 158, y - 4]], '#a8553f');
  circle(g, x + 36, y - 10, 9, null, C.brass, 2.5); line(g, x + 42, y - 4, x + 54, y, C.brass, 3);
  rrect(g, x + 204, y - 18, 16, 18, 3, C.cream, C.ink, 1.2);
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(x + 210, y - 24); g.quadraticCurveTo(x + 206, y - 30, x + 210, y - 36); g.stroke();
}

function drawLamp(g) {
  const x = 520, y = 392;
  rect(g, x - 12, y - 4, 24, 5, C.iron);
  line(g, x, y - 4, x + 6, y - 40, C.iron, 3); line(g, x + 6, y - 40, x + 26, y - 56, C.iron, 3);
  poly(g, [[x + 16, y - 66], [x + 42, y - 52], [x + 30, y - 40], [x + 8, y - 54]], C.forest);
  circle(g, x + 26, y - 50, 3, '#ffe9a8');
}

function drawAudioRack(g, owned) {
  const x = 728, y = 312, w = 60, h = 156;
  if (!owned) {
    // a coat hook where the lab will one day stand
    rect(g, x + 10, y + 20, 40, 6, '#5d4533'); hook(g, x + 22, y + 30); hook(g, x + 38, y + 30);
    poly(g, [[x + 14, y + 34], [x + 30, y + 34], [x + 30, y + 78], [x + 14, y + 90]], 'rgba(53,92,67,.7)');
    return;
  }
  rrect(g, x, y, w, h, 4, '#3b3f45', '#1f2226', 2);
  rect(g, x + 6, y + 10, w - 12, 44, '#0f1b16', '#1f2226', 1.5);
  g.strokeStyle = '#7ee0a0'; g.lineWidth = 1.5; g.beginPath();
  for (let i = 0; i <= 24; i++) {
    const px = x + 8 + i * ((w - 16) / 24), py = y + 32 + Math.sin(i * 0.9) * (6 + rnd(i, 30) * 10);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.stroke();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) circle(g, x + 14 + c * 16, y + 70 + r * 20, 5, C.ironLite, '#1f2226', 1.2);
  rect(g, x + 8, y + 132, w - 16, 6, '#e3b685');
  // headphones on top
  g.strokeStyle = C.ink; g.lineWidth = 3.5; g.beginPath(); g.arc(x + w / 2, y - 6, 14, Math.PI, 0); g.stroke();
  rrect(g, x + 10, y - 8, 8, 14, 3, C.ink); rrect(g, x + w - 18, y - 8, 8, 14, 3, C.ink);
}

/* ------------------------------------------------------------------ photo wall */

function drawPhotoWall(g, slots) {
  const x = 478, y = 52, w = 304, h = 244;
  rrect(g, x, y, w, h, 8, '#8a6a45', '#4b3626', 4);
  g.fillStyle = 'rgba(40,25,12,.18)';
  for (let i = 0; i < 40; i++) g.fillRect(x + 8 + rnd(i, 40) * (w - 16), y + 8 + rnd(i, 41) * (h - 16), 2, 2);
  // twine with string lights along the top
  g.strokeStyle = 'rgba(70,50,30,.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 10, y + 8);
  g.quadraticCurveTo(x + w / 2, y + 22, x + w - 10, y + 8); g.stroke();
  for (let i = 1; i < 9; i++) {
    const t = i / 9, bx = x + 10 + (w - 20) * t, by = y + 8 + Math.sin(Math.PI * t) * 7 + 3;
    circle(g, bx, by, 2.6, '#ffe9a8');
  }
  // empty slots: a nail and a pencilled outline, DOM frames sit on top of the used ones
  for (const f of wallLayout(slots)) {
    g.save();
    g.translate(f.x + f.w / 2, f.y + f.h / 2); g.rotate(f.tilt);
    rect(g, -f.w / 2, -f.h / 2, f.w, f.h, 'rgba(232,220,192,.13)', 'rgba(232,220,192,.35)', 1.2);
    g.restore();
    circle(g, f.x + f.w / 2, f.y + 3, 1.8, C.ironLite);
  }
}

/* ------------------------------------------------------------------ bed */

function drawBed(g) {
  const x = 490, y = 508;
  rect(g, x - 6, y - 8, 296, 12, '#5d4533'); // frame head board
  rrect(g, x, y, 284, 54, 10, '#c9b585', C.ink, 1.5);
  rrect(g, x + 8, y - 10, 70, 28, 12, C.cream, '#a0937d', 1.5); // pillow
  rrect(g, x + 84, y + 4, 196, 48, 8, C.forest, C.forestDeep, 2);
  g.strokeStyle = 'rgba(242,235,221,.4)'; g.lineWidth = 1.5;
  for (let i = 1; i < 6; i++) line(g, x + 84 + i * 32.6, y + 4, x + 84 + i * 32.6, y + 52, 'rgba(242,235,221,.4)', 1.5);
  for (let i = 1; i < 2; i++) line(g, x + 84, y + 4 + i * 24, x + 280, y + 4 + i * 24, 'rgba(242,235,221,.4)', 1.5);
  rect(g, x + 84, y + 4, 196, 8, 'rgba(255,255,255,.12)');
  rect(g, x + 4, y + 54, 10, 16, '#4b3626'); rect(g, x + 270, y + 54, 10, 16, '#4b3626');
}

/* ------------------------------------------------------------------ lighting */

function drawLighting(g, sky) {
  const dark = Math.max(0, (1 - sky.light) * 0.5);
  if (dark > 0.01) {
    g.fillStyle = `rgba(14,20,48,${dark})`;
    g.fillRect(0, 0, ART_W, ART_H);
  }
  // the desk lamp always glows, more when the day is dim
  const strength = 0.22 + dark * 0.9;
  const glow = g.createRadialGradient(550, 346, 4, 550, 346, 190);
  glow.addColorStop(0, `rgba(255,214,140,${Math.min(0.75, strength)})`);
  glow.addColorStop(1, 'rgba(255,214,140,0)');
  g.fillStyle = glow; g.fillRect(340, 160, 460, 440);
  // a gentle sunbeam from the window by day
  if (sky.sun && sky.light > 0.25) {
    g.fillStyle = `rgba(255,236,190,${0.09 * sky.light * (1 - sky.cloud * 0.7)})`;
    poly(g, [[270, 250], [452, 250], [480, 470], [250, 470]], 'rgba(255,236,190,' + (0.09 * sky.light * (1 - sky.cloud * 0.7)) + ')');
  }
  // vignette
  const v = g.createRadialGradient(400, 300, 260, 400, 300, 520);
  v.addColorStop(0, 'rgba(20,10,0,0)'); v.addColorStop(1, 'rgba(20,10,0,.32)');
  g.fillStyle = v; g.fillRect(0, 0, ART_W, ART_H);
}

/**
 * Draw the whole cabin. `g` must already be scaled so that 800 x 600 fills the canvas.
 */
export function drawCabin(g, scene) {
  const features = scene.features || {};
  drawShell(g);
  drawWindow(g, scene.sky, features);
  drawPegboard(g, scene.equipped);
  drawPlans(g);
  drawWorkshop(g, !!features.workshop);
  drawShelf(g, scene.books);
  drawMapTable(g, !!features.mapRoom);
  drawStorage(g);
  drawPhotoWall(g, scene.slots || 6);
  drawDesk(g);
  drawLamp(g);
  drawAudioRack(g, !!features.audioLab);
  drawBed(g);
  drawLighting(g, scene.sky);
}

export { WALL_AREA };
