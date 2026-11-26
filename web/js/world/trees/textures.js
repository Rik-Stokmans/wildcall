// Procedurally painted textures for the trees (contract: all art is procedural):
// leaf-clump and needle-spray atlases for the foliage cards, and bark detail maps.
// Painted once on a canvas at start-up; everything is near-white grey so the vertex
// colours (species palettes, light and shade, seasons) stay in charge of the colour.
import * as THREE from 'three';
import { rng } from '../color.js';

const TAU = Math.PI * 2;

function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

const grey = (v, a = 1) => {
  const c = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgba(${c},${Math.min(255, c + 4)},${Math.max(0, c - 6)},${a})`;
};

/** One leaf: an ovate blade with a pointed tip and a faint midrib. */
function leaf(g, x, y, len, wid, ang, tone) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(wid * 0.9, len * 0.18, wid * 0.75, len * 0.72, 0, len);
  g.bezierCurveTo(-wid * 0.75, len * 0.72, -wid * 0.9, len * 0.18, 0, 0);
  g.fillStyle = grey(tone);
  g.fill();
  g.strokeStyle = grey(tone * 1.12, 0.55);
  g.lineWidth = Math.max(0.6, wid * 0.08);
  g.beginPath();
  g.moveTo(0, len * 0.08);
  g.lineTo(0, len * 0.85);
  g.stroke();
  g.restore();
}

/**
 * A 2×2 atlas of leaf clumps: in each cell a rounded cluster of overlapping leaves,
 * darker deep inside, lighter on top, thinning out towards a ragged rim so the
 * silhouette of a crown is made of leaves, not of cards.
 */
function paintBroadleaf(size) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const cell = size / 2;
  for (let k = 0; k < 4; k++) {
    const R = rng(911 + k * 131);
    const ox = (k & 1) * cell, oy = (k >> 1) * cell;
    const cx = ox + cell / 2, cy = oy + cell / 2;
    const rad = cell * 0.43;
    const n = 150;
    for (let i = 0; i < n; i++) {
      const t = i / n; // later leaves are on top: lighter
      const a = R() * TAU;
      // Dense in the middle, sparse at the rim.
      const d = Math.pow(R(), 0.62) * rad * (0.6 + 0.4 * Math.sin(a * 3 + k) * 0.25 + 0.4);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      const len = cell * (0.085 + R() * 0.05);
      const wid = len * (0.42 + R() * 0.14);
      // Leaves point outwards from the clump centre, with some scatter.
      const ang = a - Math.PI / 2 + (R() - 0.5) * 1.6;
      const rim = d / rad;
      const tone = 0.62 + t * 0.3 + R() * 0.1 - rim * 0.06;
      if (x - len < ox + 2 || x + len > ox + cell - 2 || y - len < oy + 2 || y + len > oy + cell - 2) continue;
      leaf(g, x, y, len, wid, ang, tone);
    }
  }
  return c;
}

/**
 * A 2×2 atlas of needle sprays: a twig with dense tufts of needles, brushed
 * outwards and slightly forward, lighter at the tips.
 */
function paintNeedles(size) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const cell = size / 2;
  g.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const R = rng(577 + k * 97);
    const ox = (k & 1) * cell, oy = (k >> 1) * cell;
    const cx = ox + cell / 2, cy = oy + cell / 2;
    // Several overlapping sprays: twigs with tufts of needles brushed forwards, so a
    // card reads as soft layered foliage rather than as a single star.
    for (let sp = 0; sp < 3; sp++) {
      const sx = cx + (R() - 0.5) * cell * 0.22, sy = cy + (R() - 0.5) * cell * 0.22;
      const twigs = 3 + Math.floor(R() * 2);
      const turn = R() * TAU;
      for (let t = 0; t < twigs; t++) {
        const a = turn + (t / twigs) * TAU + (R() - 0.5) * 0.6;
        const L = cell * (0.22 + R() * 0.12);
        const bend = (R() - 0.5) * 0.6;
        for (let s2 = 0; s2 < 26; s2++) {
          const f = s2 / 26;
          const ta = a + bend * f;
          const px = sx + Math.cos(ta) * L * f, py = sy + Math.sin(ta) * L * f;
          for (const side of [-1, 1]) {
            const na = ta + side * (0.5 + R() * 0.35);
            const nl = cell * (0.06 + R() * 0.03) * (1 - f * 0.3);
            const ex = px + Math.cos(na) * nl, ey = py + Math.sin(na) * nl;
            if (ex < ox + 3 || ex > ox + cell - 3 || ey < oy + 3 || ey > oy + cell - 3) continue;
            g.strokeStyle = grey(0.66 + f * 0.22 + sp * 0.03 + R() * 0.1);
            g.lineWidth = 1.8 + R() * 1.2;
            g.beginPath();
            g.moveTo(px, py);
            g.lineTo(ex, ey);
            g.stroke();
          }
        }
      }
    }
    // Fill the heart of the card so it hides what is behind it.
    for (let i = 0; i < 120; i++) {
      const a = R() * TAU, d = Math.pow(R(), 0.7) * cell * 0.24;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, l = cell * (0.05 + R() * 0.04), b = a + (R() - 0.5) * 2;
      g.strokeStyle = grey(0.6 + R() * 0.16);
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l);
      g.stroke();
    }
  }
  return c;
}

/** Bark detail: 'furrow' (oak), 'spiral' (chestnut), 'plates' (pine), 'birch'. Tiles in both directions. */
function paintBark(kind, size) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const R = rng(kind.length * 1013 + 7);
  if (kind === 'birch') {
    g.fillStyle = grey(0.97);
    g.fillRect(0, 0, size, size);
    // Faint warm horizontal banding and the dark lenticel dashes birch is known for.
    for (let i = 0; i < 22; i++) {
      const y = R() * size, w = size * (0.05 + R() * 0.16), x = R() * size, h = 1 + R() * 2.5;
      g.fillStyle = grey(0.25 + R() * 0.2, 0.85);
      for (const dx of [0, -size, size]) g.fillRect(x + dx, y, w, h);
    }
    for (let i = 0; i < 6; i++) { // a few bigger dark scars
      const y = R() * size, x = R() * size, w = size * (0.15 + R() * 0.2), h = 5 + R() * 9;
      g.fillStyle = grey(0.12, 0.85);
      for (const dx of [0, -size, size]) {
        g.beginPath();
        g.ellipse(x + dx, y, w / 2, h / 2, 0, 0, TAU);
        g.fill();
      }
    }
    return c;
  }
  g.fillStyle = grey(0.86);
  g.fillRect(0, 0, size, size);
  if (kind === 'plates') {
    // Irregular plates separated by dark cracks.
    for (let i = 0; i < 220; i++) {
      const x = R() * size, y = R() * size, w = size * (0.03 + R() * 0.04), h = size * (0.05 + R() * 0.07);
      g.fillStyle = grey(0.78 + R() * 0.22, 0.85);
      for (const dx of [0, -size, size]) {
        for (const dy of [0, -size, size]) {
          g.beginPath();
          g.ellipse(x + dx, y + dy, w, h, 0, 0, TAU);
          g.fill();
        }
      }
    }
    g.strokeStyle = grey(0.45, 0.7);
    g.lineWidth = 1.5;
    for (let i = 0; i < 60; i++) {
      const x = R() * size, y = R() * size;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 14, y + size * 0.15); g.stroke();
    }
    return c;
  }
  // Furrows running up the stem (twisting for chestnut).
  const twist = kind === 'spiral' ? 0.5 : 0; // half a tile across per tile up
  // A spiral shifts by half a tile per tile up, so its pattern repeats every half tile.
  const period = twist ? size / 2 : size;
  const furrows = twist ? 17 : 34;
  for (let i = 0; i < furrows; i++) {
    const x0 = (i / furrows) * period + R() * 6;
    g.strokeStyle = grey(0.55 + R() * 0.15, 0.8);
    g.lineWidth = 1.5 + R() * 2.5;
    // Drawn three times, a tile apart, so the furrows wrap around the stem seamlessly.
    for (let dx = -size; dx <= size; dx += period) {
      g.beginPath();
      for (let y = -8; y <= size + 8; y += 8) {
        // The twist completes whole tile widths over the tile height: it tiles vertically too.
        const x = x0 + dx + Math.sin((y / size) * TAU * 2 + i) * 4 + y * twist;
        if (y === -8) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  for (let i = 0; i < 300; i++) { // speckle
    g.fillStyle = grey(0.7 + R() * 0.35, 0.5);
    g.fillRect(R() * size, R() * size, 2, 2 + R() * 4);
  }
  return c;
}

let cache = null;

/** The shared tree textures (created on first use). */
export function treeTextures() {
  if (cache) return cache;
  const tex = (cnv, wrap) => {
    const t = new THREE.CanvasTexture(cnv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  // Atlases with transparent gaps: the colour under alpha 0 must not be black, or
  // the mipmaps would draw dark rims around every leaf at a distance.
  const cutout = (cnv) => {
    const w = cnv.width, h = cnv.height;
    const img = cnv.getContext('2d').getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) { d[i] = 170; d[i + 1] = 172; d[i + 2] = 160; d[i + 3] = 0; }
    }
    const t = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), w, h, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  cache = {
    broad: cutout(paintBroadleaf(512)),
    needle: cutout(paintNeedles(512)),
    bark: {
      furrow: tex(paintBark('furrow', 256), true),
      spiral: tex(paintBark('spiral', 256), true),
      plates: tex(paintBark('plates', 256), true),
      birch: tex(paintBark('birch', 256), true),
    },
  };
  return cache;
}
