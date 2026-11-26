// The leaf atlas for the forage plants' leaf cards (task c-field): a 2×2 canvas painted
// once at start-up, near-white so vertex colours stay in charge of colour.
//   cell 0 (top left)     broad leaves: bramble, hazel, elder, dog rose
//   cell 1 (top right)    small leaves: bilberry, thyme, box-like shrublets
//   cell 2 (bottom left)  narrow leaves: sea buckthorn, willowy foliage
//   cell 3 (bottom right) solid white: every non-card surface samples this
import * as THREE from 'three';
import { rng } from './geo.js';

const TAU = Math.PI * 2;
const grey = (v, a = 1) => {
  const c = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgba(${c},${Math.min(255, c + 3)},${Math.max(0, c - 8)},${a})`;
};

function blade(g, x, y, len, wid, ang, tone, serr) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(0, 0);
  if (serr) {
    const n = 7;
    for (let i = 1; i <= n; i++) { const t = i / n; const w = Math.sin(Math.PI * Math.pow(t, 0.7)) * wid * (i % 2 ? 1.08 : 0.9); g.lineTo(w, t * len); }
    for (let i = n - 1; i >= 1; i--) { const t = i / n; const w = Math.sin(Math.PI * Math.pow(t, 0.7)) * wid * (i % 2 ? 1.08 : 0.9); g.lineTo(-w, t * len); }
    g.closePath();
  } else {
    g.bezierCurveTo(wid * 0.95, len * 0.2, wid * 0.7, len * 0.75, 0, len);
    g.bezierCurveTo(-wid * 0.7, len * 0.75, -wid * 0.95, len * 0.2, 0, 0);
  }
  g.fillStyle = grey(tone);
  g.fill();
  g.strokeStyle = grey(tone * 0.82, 0.5);
  g.lineWidth = Math.max(0.6, wid * 0.08);
  g.stroke();
  g.strokeStyle = grey(Math.min(1, tone * 1.1), 0.5);
  g.beginPath(); g.moveTo(0, len * 0.06); g.lineTo(0, len * 0.86); g.stroke();
  g.restore();
}

function clump(g, ox, oy, cell, seed, { n, len, wid, serr, narrow }) {
  const R = rng(seed);
  const cx = ox + cell / 2, cy = oy + cell / 2, rad = cell * 0.4;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = R() * TAU;
    const d = Math.pow(R(), 0.6) * rad;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const L = cell * len * (0.75 + R() * 0.5);
    const W = L * wid * (0.85 + R() * 0.3);
    const ang = a - Math.PI / 2 + (R() - 0.5) * (narrow ? 0.9 : 1.6);
    const tone = 0.6 + t * 0.32 + R() * 0.08 - (d / rad) * 0.05;
    if (x - L < ox + 2 || x + L > ox + cell - 2 || y - L < oy + 2 || y + L > oy + cell - 2) continue;
    blade(g, x, y, L, W, ang, tone, serr);
  }
}

/** Paints the atlas and returns it as a texture. */
export function createLeafAtlas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const cell = size / 2;
  clump(g, 0, 0, cell, 4111, { n: 120, len: 0.17, wid: 0.36, serr: true });
  clump(g, cell, 0, cell, 5227, { n: 260, len: 0.085, wid: 0.42, serr: false });
  clump(g, 0, cell, cell, 6343, { n: 170, len: 0.2, wid: 0.13, serr: false, narrow: true });
  g.fillStyle = '#ffffff';
  g.fillRect(cell, cell, cell, cell);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
