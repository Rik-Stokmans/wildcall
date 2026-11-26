// Procedural drawings for the field kitchen and the herbarium (task c-field):
//   drawPlantArt(plantId, opts)   a pressed-plant specimen on paper (herbarium, "New
//                                 plant" card); opts.faint draws a pale pencil outline
//                                 for plants not found yet
//   drawItemArt(itemId, size)     a small painted picture of an ingredient or food
//   cropColors(itemId)            colours of the bits that fly when it is picked
// Pure canvas 2D, deterministic per id (no randomness between redraws).

const TAU = Math.PI * 2;

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  c.style.width = w + 'px'; c.style.height = h + 'px';
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, g };
}

// ------------------------------------------------------------------ ink and paint

const INK = 'rgba(58, 46, 34, 0.78)';

/** Paint style: watercolour-ish fill with a darker ink edge; in faint mode only a pencil line. */
function style(g, ctxs) {
  return {
    fill(col, alpha = 0.92) {
      if (ctxs.faint) return;
      g.globalAlpha = alpha; g.fillStyle = col; g.fill(); g.globalAlpha = 1;
    },
    ink(w = 1) {
      g.lineWidth = w * ctxs.k;
      g.strokeStyle = ctxs.faint ? 'rgba(90, 80, 64, 0.32)' : INK;
      g.stroke();
    },
  };
}

function leafShape(g, len, w, shape, serr, R) {
  // drawn along +x from the origin
  const n = 14;
  const half = (t) => {
    switch (shape) {
      case 'lance': return Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - 0.25 * t);
      case 'round': return Math.sin(Math.PI * Math.pow(t, 0.6));
      case 'heart': return Math.sin(Math.PI * Math.pow(t, 0.5)) * (t < 0.1 ? 0.7 : 1);
      case 'needle': return 0.18 * (1 - t);
      default: return Math.sin(Math.PI * Math.pow(t, 0.72));
    }
  };
  g.beginPath();
  g.moveTo(0, 0);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const s = serr && i < n ? (i % 2 ? 1 + serr : 1 - serr * 0.4) : 1;
    g.lineTo(t * len, -half(t) * w * 0.5 * s);
  }
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    const s = serr ? (i % 2 ? 1 + serr : 1 - serr * 0.4) : 1;
    g.lineTo(t * len, half(t) * w * 0.5 * s * (0.94 + R() * 0.06));
  }
  g.closePath();
}

function leaf(g, S, x, y, ang, len, w, col, { shape = 'oval', serr = 0, R, veins = true } = {}) {
  g.save();
  g.translate(x, y); g.rotate(ang);
  leafShape(g, len, w, shape, serr, R);
  const grad = g.createLinearGradient(0, -w / 2, 0, w / 2);
  grad.addColorStop(0, col[0]); grad.addColorStop(1, col[1]);
  S.fill(grad);
  S.ink(0.8);
  if (veins && shape !== 'needle') {
    g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.92, 0);
    for (let i = 1; i < 5; i++) { const t = i / 5.5; g.moveTo(t * len, 0); g.lineTo(t * len + len * 0.12, -w * 0.28); g.moveTo(t * len, 0); g.lineTo(t * len + len * 0.12, w * 0.28); }
    g.lineWidth = 0.5; g.strokeStyle = 'rgba(40, 52, 30, 0.35)'; g.stroke();
  }
  g.restore();
}

function stem(g, S, pts, w, col) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const l = pts[pts.length - 1];
  g.lineTo(l[0], l[1]);
  g.lineCap = 'round';
  if (!S.faintMode) { g.lineWidth = w + 1.2; g.strokeStyle = S.faintInk || INK; g.stroke(); }
  g.lineWidth = w; g.strokeStyle = S.faintMode ? 'rgba(90, 80, 64, 0.3)' : col; g.stroke();
}

function berry(g, S, x, y, r, col, shine = true) {
  g.beginPath(); g.arc(x, y, r, 0, TAU);
  S.fill(col);
  S.ink(0.6);
  if (shine && !S.faintMode) { g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.28, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill(); }
}

function flower(g, S, x, y, r, petals, col, centre, ang = 0) {
  for (let i = 0; i < petals; i++) {
    const a = ang + (i / petals) * TAU;
    g.beginPath();
    g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.3, a, 0, TAU);
    S.fill(col); S.ink(0.5);
  }
  if (centre) { g.beginPath(); g.arc(x, y, r * 0.28, 0, TAU); S.fill(centre); S.ink(0.5); }
}

// ------------------------------------------------------------------ the specimens
// Each draws in a 200 x 260 box: the stem base near (100, 240).

const G = {
  dark: ['#4f7a3a', '#2f5226'], mid: ['#6e9a48', '#3e6a2e'], light: ['#8fbc5a', '#5a8a3a'],
  silver: ['#b3c2a8', '#7d9278'], blue: ['#7a9468', '#4a6644'],
};

const SPECIMENS = {
  bramble(g, S, R) {
    stem(g, S, [[92, 248], [84, 190], [96, 120], [130, 70], [160, 52]], 4, '#7a3a48');
    for (let i = 0; i < 14; i++) { const t = 0.1 + i / 16; const x = 92 + (160 - 92) * t * t - 8 * Math.sin(t * 3), y = 248 - 196 * t; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 5, y - 3); S.ink(0.8); }
    for (const [x, y, a] of [[86, 190, 2.6], [96, 140, 0.4], [112, 100, 2.9]]) {
      for (const k of [-0.7, 0, 0.7]) leaf(g, S, x, y, a + k, 42, 24, G.dark, { serr: 0.16, R });
    }
    for (const [x, y] of [[150, 64], [160, 78], [142, 80]]) for (let d = 0; d < 7; d++) berry(g, S, x + Math.cos(d) * 4.5 * (d ? 1 : 0), y + Math.sin(d) * 4.5 * (d ? 1 : 0), 3.6, '#2a1a30');
    berry(g, S, 168, 60, 7, '#a2283a');
    flower(g, S, 132, 52, 11, 5, '#f6e4ee', '#e8c86a', 0.3);
  },
  wild_strawberry(g, S, R) {
    stem(g, S, [[70, 250], [80, 200], [90, 150], [96, 120]], 2, '#6a8a3a');
    for (const k of [-0.9, 0, 0.9]) leaf(g, S, 96, 120, -Math.PI / 2 + k, 40, 30, G.mid, { serr: 0.2, R });
    stem(g, S, [[120, 250], [124, 210], [138, 180], [150, 172]], 1.6, '#6a8a3a');
    for (const [x, y] of [[150, 182], [136, 196]]) {
      g.beginPath(); g.moveTo(x, y - 9); g.quadraticCurveTo(x + 9, y, x, y + 10); g.quadraticCurveTo(x - 9, y, x, y - 9);
      S.fill('#d42a30'); S.ink(0.7);
      if (!S.faintMode) for (let d = 0; d < 6; d++) { g.beginPath(); g.arc(x - 3 + (d % 3) * 3, y - 3 + Math.floor(d / 3) * 5, 0.7, 0, TAU); g.fillStyle = '#f2d080'; g.fill(); }
      leaf(g, S, x, y - 9, -Math.PI / 2, 6, 8, G.mid, { R, veins: false });
    }
    flower(g, S, 60, 150, 12, 5, '#fbf8f0', '#e8c440');
    stem(g, S, [[78, 250], [70, 200], [60, 160]], 1.4, '#6a8a3a');
    stem(g, S, [[100, 250], [130, 246], [176, 240]], 1.2, '#7a8a4a');
  },
  bilberry(g, S, R) {
    stem(g, S, [[100, 250], [102, 190], [96, 140], [104, 90], [110, 60]], 3, '#5e8f2e');
    stem(g, S, [[102, 190], [130, 160], [150, 140]], 2.2, '#5e8f2e');
    stem(g, S, [[98, 140], [70, 110], [56, 92]], 2.2, '#5e8f2e');
    for (const [x, y, a] of [[104, 100, -0.4], [100, 120, 3.4], [126, 164, -0.8], [146, 142, 0.2], [74, 114, 3.6], [60, 96, 3.0], [108, 70, -1.2]]) leaf(g, S, x, y, a, 26, 15, G.light, { serr: 0.06, R });
    for (const [x, y] of [[118, 178], [90, 150], [132, 152], [80, 124], [112, 82]]) {
      berry(g, S, x, y, 6.5, '#2e3868');
      if (!S.faintMode) { g.beginPath(); g.arc(x, y, 6.5, 0, TAU); g.fillStyle = 'rgba(160, 175, 220, 0.25)'; g.fill(); }
    }
  },
  elder(g, S, R) {
    stem(g, S, [[100, 250], [98, 180], [104, 110], [100, 60]], 4, '#9a8a70');
    for (const [y, side] of [[190, -1], [150, 1]]) {
      const x0 = 100;
      stem(g, S, [[x0, y], [x0 + side * 40, y - 20], [x0 + side * 74, y - 30]], 1.6, '#6e8a40');
      for (let i = 0; i < 3; i++) {
        const lx = x0 + side * (24 + i * 22), ly = y - 14 - i * 6;
        leaf(g, S, lx, ly, side > 0 ? -1.9 : -1.2, 28, 13, G.mid, { shape: 'lance', serr: 0.1, R });
        leaf(g, S, lx, ly, side > 0 ? 0.5 : 2.6, 28, 13, G.mid, { shape: 'lance', serr: 0.1, R });
      }
      leaf(g, S, x0 + side * 74, y - 30, side > 0 ? -0.4 : 3.5, 30, 14, G.mid, { shape: 'lance', serr: 0.1, R });
    }
    // the flower plate on one stalk and berries on the other
    for (let i = 0; i < 9; i++) stem(g, S, [[100, 62], [70 + i * 7, 40 + Math.abs(i - 4) * 2]], 0.8, '#7a9a4a');
    for (let i = 0; i < 46; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 34; g.beginPath(); g.arc(98 + Math.cos(a) * r, 36 + Math.sin(a) * r * 0.32, 2.6, 0, TAU); S.fill('#fbf5dc'); S.ink(0.3); }
    stem(g, S, [[104, 110], [140, 104], [156, 120]], 1.4, '#a8343e');
    for (let i = 0; i < 18; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 16; berry(g, S, 158 + Math.cos(a) * r, 130 + Math.sin(a) * r * 0.8, 3, '#2a1630'); }
  },
  dog_rose(g, S, R) {
    stem(g, S, [[110, 250], [100, 200], [92, 150], [100, 100], [124, 60]], 3.2, '#5e6e32');
    for (let i = 0; i < 10; i++) { const y = 240 - i * 18, x = 104 - Math.sin(i * 0.5) * 8; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x - 5, y - 2, x - 7, y - 7); S.ink(1); }
    for (const [x, y, s] of [[96, 190, -1], [94, 140, 1], [102, 100, -1]]) {
      stem(g, S, [[x, y], [x + s * 50, y - 22]], 1.2, '#6e8a40');
      for (let i = 1; i <= 3; i++) { leaf(g, S, x + s * i * 14, y - i * 6, s > 0 ? -1.6 : -1.5 + Math.PI * 0.0 - 0.1, 16, 10, G.mid, { serr: 0.2, R }); leaf(g, S, x + s * i * 14, y - i * 6, s > 0 ? 0.4 : 2.7, 16, 10, G.mid, { serr: 0.2, R }); }
    }
    flower(g, S, 132, 56, 18, 5, '#f4c2cc', '#e8c060', 0.2);
    for (const [x, y] of [[60, 120], [70, 136], [150, 160]]) {
      g.beginPath(); g.ellipse(x, y, 7, 10, 0.3, 0, TAU); S.fill('#d02a22'); S.ink(0.7);
      if (!S.faintMode) { g.beginPath(); g.ellipse(x - 2.5, y - 3, 2, 3, 0.3, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fill(); }
      g.beginPath(); g.moveTo(x + 3, y + 9); g.lineTo(x + 6, y + 15); g.moveTo(x + 1, y + 10); g.lineTo(x - 2, y + 16); S.ink(0.8);
    }
  },
  hazel(g, S, R) {
    stem(g, S, [[100, 250], [104, 180], [98, 110], [104, 50]], 3.4, '#8a7458');
    for (const [x, y, a] of [[104, 190, -0.5], [100, 150, 3.5], [100, 112, -0.3], [102, 74, 3.3]]) leaf(g, S, x, y, a, 56, 46, G.mid, { shape: 'round', serr: 0.1, R });
    for (const [x, y] of [[132, 226], [148, 232]]) {
      g.beginPath(); g.ellipse(x, y, 9, 11, 0, 0, TAU); S.fill('#b08a4a'); S.ink(0.8);
      g.beginPath(); g.moveTo(x - 12, y - 4); for (let i = 0; i <= 8; i++) g.lineTo(x - 12 + i * 3, y - 12 - (i % 2) * 5); g.lineTo(x + 12, y - 4); g.closePath(); S.fill('#88a850'); S.ink(0.6);
    }
    stem(g, S, [[104, 200], [132, 214]], 1.4, '#8a7458');
    for (const x of [70, 80]) { g.beginPath(); g.moveTo(x, 60); g.quadraticCurveTo(x - 8, 90, x - 2, 118); g.lineWidth = 5; g.strokeStyle = S.faintMode ? 'rgba(90,80,64,0.3)' : '#d8c070'; g.stroke(); }
  },
  sweet_chestnut(g, S, R) {
    stem(g, S, [[110, 250], [106, 190], [100, 130]], 2.6, '#7a5a40');
    leaf(g, S, 100, 130, -1.7, 110, 30, G.mid, { shape: 'lance', serr: 0.22, R });
    leaf(g, S, 104, 170, -0.6, 90, 26, G.mid, { shape: 'lance', serr: 0.22, R });
    const cx = 70, cy = 210;
    g.beginPath(); g.arc(cx, cy, 22, 0, TAU); S.fill('#a8b850'); S.ink(0.8);
    for (let i = 0; i < 46; i++) { const a = (i / 46) * TAU; g.beginPath(); g.moveTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20); g.lineTo(cx + Math.cos(a + 0.1) * 31, cy + Math.sin(a + 0.1) * 31); S.ink(0.6); }
    for (const [x, y] of [[142, 220], [160, 230]]) { g.beginPath(); g.moveTo(x - 10, y + 8); g.quadraticCurveTo(x - 10, y - 10, x, y - 12); g.quadraticCurveTo(x + 10, y - 10, x + 10, y + 8); g.closePath(); S.fill('#6a3a1c'); S.ink(0.8); }
  },
  nettle(g, S, R) {
    stem(g, S, [[100, 250], [100, 180], [100, 110], [100, 40]], 3, '#4f7030');
    for (let i = 0; i < 4; i++) {
      const y = 210 - i * 44, len = 52 - i * 7;
      leaf(g, S, 100, y, Math.PI + 0.35, len, len * 0.7, G.dark, { shape: 'heart', serr: 0.24, R });
      leaf(g, S, 100, y - 8, -0.35, len, len * 0.7, G.dark, { shape: 'heart', serr: 0.24, R });
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(100, y - 2); g.quadraticCurveTo(100 + s * 14, y + 12, 100 + s * 18, y + 30); g.lineWidth = 3; g.strokeStyle = S.faintMode ? 'rgba(90,80,64,0.25)' : 'rgba(150, 168, 110, 0.9)'; g.stroke(); }
    }
    for (const k of [-0.6, 0.6]) leaf(g, S, 100, 42, -Math.PI / 2 + k, 22, 16, G.light, { shape: 'heart', serr: 0.22, R });
    for (let i = 0; i < 30; i++) { const y = 240 - R() * 200; g.beginPath(); g.moveTo(100, y); g.lineTo(100 + (R() < 0.5 ? -4 : 4), y - 3); S.ink(0.4); }
  },
  wild_garlic(g, S, R) {
    g.beginPath(); g.ellipse(100, 244, 9, 6, 0, 0, TAU); S.fill('#f2ecd8'); S.ink(0.8);
    for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(96 + i, 248); g.lineTo(90 + i * 2.5, 258); S.ink(0.5); }
    leaf(g, S, 100, 238, -1.95, 170, 40, G.mid, { shape: 'lance', R });
    leaf(g, S, 100, 238, -1.25, 150, 36, G.light, { shape: 'lance', R });
    stem(g, S, [[100, 238], [104, 150], [108, 60]], 2, '#6a9a40');
    for (let i = 0; i < 14; i++) { const a = -Math.PI / 2 + (i / 13 - 0.5) * 2.4; const x = 108 + Math.cos(a) * 26, y = 54 + Math.sin(a) * 22; stem(g, S, [[108, 60], [x, y]], 0.8, '#7aa04a'); flower(g, S, x, y, 7, 6, '#ffffff', '#e8eec8', a); }
  },
  water_mint(g, S, R) {
    stem(g, S, [[100, 250], [100, 170], [100, 70]], 3, '#5a3a48');
    for (let i = 0; i < 4; i++) {
      const y = 220 - i * 40, len = 40 - i * 4;
      leaf(g, S, 100, y, Math.PI + 0.3, len, len * 0.62, ['#5e7a50', '#3a5034'], { serr: 0.14, R });
      leaf(g, S, 100, y - 6, -0.3, len, len * 0.62, ['#5e7a50', '#3a5034'], { serr: 0.14, R });
    }
    for (let i = 0; i < 40; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 20; g.beginPath(); g.arc(100 + Math.cos(a) * r, 52 + Math.sin(a) * r * 0.9, 3, 0, TAU); S.fill(R() < 0.5 ? '#b89ad8' : '#cdb4e8'); S.ink(0.3); }
    for (let i = 0; i < 14; i++) { const a = R() * TAU; g.beginPath(); g.arc(100 + Math.cos(a) * 14, 104 + Math.sin(a) * 5, 2.4, 0, TAU); S.fill('#b89ad8'); S.ink(0.3); }
  },
  chamomile(g, S, R) {
    for (const [x0, top] of [[90, [74, 70]], [104, [118, 54]], [112, [146, 92]]]) stem(g, S, [[100, 250], [x0, 160], top], 1.6, '#6a9a40');
    for (let i = 0; i < 24; i++) {
      const y = 240 - R() * 150, x = 98 + (R() - 0.5) * 30;
      leaf(g, S, x, y, -Math.PI / 2 + (R() - 0.5) * 2.4, 18 + R() * 10, 4, G.light, { shape: 'needle', R, veins: false });
    }
    for (const [x, y] of [[74, 66], [118, 50], [146, 88]]) {
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; g.beginPath(); g.ellipse(x + Math.cos(a) * 10, y + Math.sin(a) * 10, 7, 2.6, a, 0, TAU); S.fill('#fdfdf6'); S.ink(0.4); }
      g.beginPath(); g.arc(x, y, 6.5, 0, TAU); S.fill('#f0c030'); S.ink(0.6);
    }
  },
  young_pine(g, S, R) {
    stem(g, S, [[100, 250], [100, 160], [100, 60]], 4.5, '#7a5a40');
    for (let i = 0; i < 46; i++) {
      const y = 236 - i * 4, side = i % 2 ? 1 : -1;
      const len = 40 - Math.abs(i - 20) * 0.5;
      g.beginPath(); g.moveTo(100, y); g.quadraticCurveTo(100 + side * len * 0.6, y - 6, 100 + side * len, y - 16);
      g.lineWidth = 1.8; g.strokeStyle = S.faintMode ? 'rgba(90,80,64,0.3)' : (i % 3 ? '#2e5a36' : '#3e6e44'); g.stroke();
    }
    g.beginPath(); g.moveTo(94, 60); g.lineTo(100, 16); g.lineTo(106, 60); g.closePath(); S.fill('#c8e080'); S.ink(0.7);
    g.beginPath(); g.ellipse(150, 210, 12, 18, 0.5, 0, TAU); S.fill('#8a6440'); S.ink(0.8);
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(140 + i * 2, 196 + i * 6); g.lineTo(160 + i * 1, 200 + i * 6); S.ink(0.5); }
  },
  chanterelle(g, S, R) {
    for (const [x, s] of [[80, 1], [130, 0.8]]) {
      g.save(); g.translate(x, 236); g.scale(s, s);
      g.beginPath(); g.moveTo(-8, 0); g.quadraticCurveTo(-10, -60, -46, -96); g.quadraticCurveTo(-20, -106, 0, -98); g.quadraticCurveTo(24, -108, 44, -94); g.quadraticCurveTo(10, -60, 8, 0); g.closePath();
      S.fill('#f0b43a'); S.ink(1);
      for (let i = -4; i <= 4; i++) { g.beginPath(); g.moveTo(i * 1.6, -6); g.quadraticCurveTo(i * 5, -60, i * 9.5, -94); g.lineWidth = 0.7; g.strokeStyle = S.faintMode ? 'rgba(90,80,64,0.2)' : 'rgba(150, 90, 20, 0.6)'; g.stroke(); }
      g.restore();
    }
  },
  penny_bun(g, S, R) {
    g.beginPath(); g.moveTo(84, 248); g.quadraticCurveTo(66, 200, 82, 150); g.lineTo(120, 150); g.quadraticCurveTo(136, 200, 118, 248); g.closePath(); S.fill('#e8dcc0'); S.ink(1);
    if (!S.faintMode) for (let i = 0; i < 16; i++) { g.beginPath(); g.moveTo(86 + (i % 4) * 8, 160 + Math.floor(i / 4) * 18); g.lineTo(92 + (i % 4) * 8, 170 + Math.floor(i / 4) * 18); g.lineTo(98 + (i % 4) * 8, 160 + Math.floor(i / 4) * 18); g.lineWidth = 0.5; g.strokeStyle = 'rgba(140,110,70,0.5)'; g.stroke(); }
    g.beginPath(); g.moveTo(36, 150); g.quadraticCurveTo(40, 72, 100, 66); g.quadraticCurveTo(162, 72, 166, 150); g.quadraticCurveTo(100, 160, 36, 150); g.closePath(); S.fill('#7a4824'); S.ink(1.2);
    g.beginPath(); g.moveTo(38, 150); g.quadraticCurveTo(100, 166, 164, 150); g.quadraticCurveTo(100, 156, 38, 150); S.fill('#e6d49a'); S.ink(0.6);
    if (!S.faintMode) { g.beginPath(); g.ellipse(80, 92, 22, 9, -0.3, 0, TAU); g.fillStyle = 'rgba(255, 230, 190, 0.22)'; g.fill(); }
  },
  sea_buckthorn(g, S, R) {
    stem(g, S, [[100, 250], [96, 180], [104, 110], [98, 40]], 3.2, '#6a5a4a');
    for (let i = 0; i < 12; i++) { const y = 230 - i * 16, s = i % 2 ? 1 : -1; leaf(g, S, 100, y, s > 0 ? -0.5 : Math.PI + 0.5, 50, 8, G.silver, { shape: 'lance', R }); }
    for (let i = 0; i < 34; i++) { const y = 210 - R() * 150; berry(g, S, 100 + (R() - 0.5) * 16, y, 5, R() < 0.7 ? '#f08a1a' : '#f4a42c'); }
    g.beginPath(); g.moveTo(100, 140); g.lineTo(124, 126); S.ink(1.4);
  },
  samphire(g, S, R) {
    const branch = (x, y, a, len, depth) => {
      const segs = 4;
      let px = x, py = y;
      for (let i = 0; i < segs; i++) {
        const nx = px + Math.cos(a) * len / segs, ny = py + Math.sin(a) * len / segs;
        g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.lineCap = 'round';
        if (!S.faintMode) { g.lineWidth = 10 - depth * 2.5; g.strokeStyle = INK; g.stroke(); }
        g.lineWidth = 8 - depth * 2.5; g.strokeStyle = S.faintMode ? 'rgba(90,80,64,0.3)' : '#7aaa52'; g.stroke();
        if (!S.faintMode) { g.beginPath(); g.arc(nx, ny, (8 - depth * 2.5) / 2, 0, TAU); g.fillStyle = '#5a8a3e'; g.fill(); }
        if (depth < 2 && i === 1) { branch(nx, ny, a - 0.7, len * 0.55, depth + 1); branch(nx, ny, a + 0.7, len * 0.55, depth + 1); }
        px = nx; py = ny;
      }
    };
    branch(100, 250, -Math.PI / 2, 200, 0);
  },
  cloudberry(g, S, R) {
    stem(g, S, [[86, 250], [84, 190], [76, 150]], 2, '#5c7a3a');
    g.save(); g.translate(76, 150);
    g.beginPath();
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * TAU; const r = 44 * (0.82 + 0.18 * Math.cos(a * 5)) * (0.96 + 0.04 * Math.sin(a * 23)); g.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.86); }
    g.closePath(); S.fill(G.mid[1]); S.ink(0.9);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 38, Math.sin(a) * 32); g.lineWidth = 0.6; g.strokeStyle = 'rgba(30,50,20,0.4)'; g.stroke(); }
    g.restore();
    stem(g, S, [[110, 250], [116, 160], [128, 90]], 1.6, '#6a7a3a');
    for (let i = 0; i < 16; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 10; berry(g, S, 128 + Math.cos(a) * r, 76 + Math.sin(a) * r, 4.6, R() < 0.6 ? '#f0a43a' : '#e88a30'); }
  },
  wild_thyme(g, S, R) {
    stem(g, S, [[40, 240], [80, 236], [120, 232], [166, 226]], 2, '#6a5a3a');
    for (let k = 0; k < 6; k++) {
      const x0 = 50 + k * 22, top = 140 + R() * 50;
      stem(g, S, [[x0, 238], [x0 + (R() - 0.5) * 10, (238 + top) / 2], [x0 + (R() - 0.5) * 14, top]], 1.4, '#6a5a3a');
      for (let i = 0; i < 8; i++) { const y = 230 - i * ((238 - top) / 9); leaf(g, S, x0, y, (i % 2 ? -0.5 : Math.PI + 0.5), 8, 5, G.dark, { R, veins: false }); }
      for (let i = 0; i < 12; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 8; g.beginPath(); g.arc(x0 + Math.cos(a) * r, top - 6 + Math.sin(a) * r, 2.6, 0, TAU); S.fill(R() < 0.5 ? '#b67ab8' : '#d4a0d2'); S.ink(0.3); }
    }
  },
};

/**
 * A pressed-plant specimen drawing.
 * @param {string} plantId
 * @param {{size?: number, height?: number, faint?: boolean, paper?: boolean}} opts
 */
export function drawPlantArt(plantId, opts = {}) {
  const w = opts.size || 200, h = opts.height || Math.round(w * 1.3);
  const { c, g } = makeCanvas(w, h);
  c.className = 'frg-plant-art' + (opts.faint ? ' faint' : '');
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', opts.alt || (opts.faint ? 'An unknown plant' : 'Pressed plant'));
  const k = Math.min(w / 200, h / 260);
  if (opts.paper !== false) {
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#f6efdd'); grad.addColorStop(1, '#ece2c8');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    const R = rng(hashStr(plantId) ^ 0x51);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(120, 96, 60, ${0.03 + R() * 0.04})`; g.fillRect(R() * w, R() * h, 1 + R() * 2, 1); }
  }
  const draw = SPECIMENS[plantId];
  g.save();
  g.translate((w - 200 * k) / 2, (h - 260 * k) / 2);
  g.scale(k, k);
  const S = style(g, { faint: !!opts.faint, k: 1 });
  S.faintMode = !!opts.faint;
  if (opts.faint) g.setLineDash([3, 3]);
  if (draw) draw(g, S, rng(hashStr(plantId)));
  else { g.beginPath(); g.arc(100, 130, 40, 0, TAU); S.fill('#8fbc5a'); S.ink(1); }
  g.restore();
  if (opts.paper !== false && !opts.faint) {
    // two strips of tape hold the specimen down
    const tape = (x, y, a) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = 'rgba(236, 222, 180, 0.78)'; g.fillRect(-16 * k, -6 * k, 32 * k, 12 * k); g.restore(); };
    tape(w * 0.5, h * 0.9, -0.1);
    tape(w * 0.3, h * 0.42, 0.5);
  }
  return c;
}

// ------------------------------------------------------------------ items

const ITEM_LOOK = {
  blackberry: { t: 'berries', c: '#2a1a30' }, wild_strawberry: { t: 'strawberry', c: '#d42a30' }, bilberry: { t: 'berries', c: '#2e3868' },
  elderflower: { t: 'umbel', c: '#fbf5dc' }, elderberry: { t: 'berries', c: '#2a1630', small: true }, rosehip: { t: 'hips', c: '#d02a22' },
  hazelnut: { t: 'nuts', c: '#b08a4a' }, chestnut: { t: 'nuts', c: '#6a3a1c' }, nettle: { t: 'leaves', c: '#4f7a3a', shape: 'heart' },
  wild_garlic: { t: 'leaves', c: '#5fa83e', shape: 'lance' }, water_mint: { t: 'leaves', c: '#5e7a50' }, chamomile: { t: 'daisies', c: '#fdfdf6' },
  pine_tips: { t: 'tips', c: '#c8e080' }, chanterelle: { t: 'funnel', c: '#f0b43a' }, penny_bun: { t: 'bolete', c: '#7a4824' },
  sea_buckthorn: { t: 'berries', c: '#f08a1a' }, samphire: { t: 'shoots', c: '#7aaa52' }, cloudberry: { t: 'berries', c: '#f0a43a', big: true },
  wild_thyme: { t: 'sprig', c: '#b67ab8' },
  oats: { t: 'sack', c: '#d8c49a' }, honey: { t: 'jar', c: '#e8a83a' }, flour: { t: 'sack', c: '#f2eee4' },
  pine_tip_tea: { t: 'mug', c: '#c8c070' }, mint_tea: { t: 'mug', c: '#9cbc78' }, chamomile_tea: { t: 'mug', c: '#e8c860' },
  thyme_honey_tea: { t: 'mug', c: '#d8a050' }, nettle_tea: { t: 'mug', c: '#6a8a40' },
  elderflower_cordial: { t: 'bottle', c: '#f0e6b0' }, elderberry_syrup: { t: 'bottle', c: '#4a1838' }, rosehip_syrup: { t: 'bottle', c: '#b8402a' },
  sea_buckthorn_juice: { t: 'bottle', c: '#f08a1a' },
  berry_oat_bars: { t: 'bars', c: '#b8925a' }, hazelnut_trail_mix: { t: 'bowl', c: '#b08a4a', bits: true }, roasted_chestnuts: { t: 'pan', c: '#6a3a1c' },
  cloudberry_preserve: { t: 'jar', c: '#f0a43a' }, bilberry_tart: { t: 'tart', c: '#3a2c5a' },
  nettle_soup: { t: 'bowl', c: '#5a8a34' }, wild_garlic_flatbread: { t: 'bread', c: '#e0c07a' }, mushroom_broth: { t: 'bowl', c: '#a8743a' },
  forager_stew: { t: 'bowl', c: '#8a5a2e', bits: true }, samphire_salad: { t: 'plate', c: '#7aaa52' },
};

/** Colours of the bits that fly off when an item is picked. */
export function cropColors(itemId) {
  const l = ITEM_LOOK[itemId];
  const base = l ? l.c : '#7fb04a';
  return [base, '#5c8a36', base, '#7fb04a'];
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

/** A small painted picture of an ingredient or food (size x size CSS px). */
export function drawItemArt(itemId, size = 48, def = null) {
  const { c, g } = makeCanvas(size, size);
  c.className = 'frg-item-art';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', def?.name || itemId);
  const look = ITEM_LOOK[itemId] || { t: def?.kind === 'food' ? 'bowl' : 'leaves', c: '#7fb04a' };
  const R = rng(hashStr(itemId));
  g.scale(size / 48, size / 48);
  const S = style(g, { faint: false, k: 1 });
  const col = look.c;
  const lineOnly = (w = 1) => { g.lineWidth = w; g.strokeStyle = INK; g.stroke(); };
  switch (look.t) {
    case 'berries': {
      const r = look.big ? 6 : look.small ? 3.4 : 4.6;
      const n = look.big ? 5 : look.small ? 16 : 9;
      for (let i = 0; i < n; i++) { const a = R() * TAU, d = Math.sqrt(R()) * 12; berry(g, S, 24 + Math.cos(a) * d, 26 + Math.sin(a) * d * 0.8, r, col); }
      leaf(g, S, 22, 14, -2.4, 14, 9, G.mid, { R, veins: false });
      break;
    }
    case 'strawberry':
      for (const [x, y] of [[18, 26], [30, 30]]) {
        g.beginPath(); g.moveTo(x, y - 9); g.quadraticCurveTo(x + 9, y, x, y + 11); g.quadraticCurveTo(x - 9, y, x, y - 9); S.fill(col); S.ink(0.7);
        leaf(g, S, x, y - 9, -1.57, 5, 7, G.mid, { R, veins: false });
      }
      break;
    case 'umbel':
      for (let i = 0; i < 7; i++) { g.beginPath(); g.moveTo(24, 40); g.lineTo(10 + i * 4.6, 20); g.lineWidth = 0.8; g.strokeStyle = '#7a9a4a'; g.stroke(); }
      for (let i = 0; i < 34; i++) { const a = R() * TAU, r = Math.sqrt(R()) * 16; g.beginPath(); g.arc(24 + Math.cos(a) * r, 18 + Math.sin(a) * r * 0.4, 2.2, 0, TAU); S.fill(col); S.ink(0.3); }
      break;
    case 'hips':
      for (const [x, y, a] of [[18, 26, -0.4], [30, 24, 0.3], [24, 34, 0]]) { g.beginPath(); g.ellipse(x, y, 5, 7.5, a, 0, TAU); S.fill(col); S.ink(0.7); }
      break;
    case 'nuts':
      for (const [x, y] of [[17, 28], [31, 28], [24, 18]]) { g.beginPath(); g.ellipse(x, y, 7, 8, 0, 0, TAU); S.fill(col); S.ink(0.8); g.beginPath(); g.ellipse(x - 2, y - 3, 2, 3, 0, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill(); }
      break;
    case 'leaves':
      for (const [a, s] of [[-2.0, 1], [-1.2, 0.9], [-2.7, 0.8]]) leaf(g, S, 22, 42, a, 30 * s, look.shape === 'lance' ? 10 : 16, [shade(col, 1.15), shade(col, 0.8)], { shape: look.shape || 'oval', serr: look.shape === 'heart' ? 0.2 : 0.08, R });
      break;
    case 'daisies':
      for (const [x, y] of [[16, 20], [32, 18], [24, 32]]) { flower(g, S, x, y, 9, 12, col, '#f0c030'); }
      break;
    case 'tips':
      for (const [x, a] of [[16, -0.25], [26, 0], [34, 0.25]]) { g.save(); g.translate(x, 42); g.rotate(a); g.beginPath(); g.moveTo(-4, 0); g.lineTo(0, -30); g.lineTo(4, 0); g.closePath(); S.fill(col); S.ink(0.7); g.restore(); }
      break;
    case 'funnel':
      g.beginPath(); g.moveTo(21, 44); g.quadraticCurveTo(20, 24, 6, 12); g.quadraticCurveTo(24, 6, 42, 12); g.quadraticCurveTo(28, 24, 27, 44); g.closePath(); S.fill(col); S.ink(0.9);
      break;
    case 'bolete':
      g.beginPath(); g.moveTo(18, 44); g.quadraticCurveTo(14, 32, 19, 24); g.lineTo(29, 24); g.quadraticCurveTo(34, 32, 30, 44); g.closePath(); S.fill('#e8dcc0'); S.ink(0.8);
      g.beginPath(); g.moveTo(6, 26); g.quadraticCurveTo(8, 6, 24, 6); g.quadraticCurveTo(40, 6, 42, 26); g.quadraticCurveTo(24, 30, 6, 26); g.closePath(); S.fill(col); S.ink(0.9);
      break;
    case 'shoots':
      for (const x of [16, 24, 32]) { g.beginPath(); g.moveTo(x, 44); g.lineTo(x + (x - 24) * 0.3, 10); g.lineCap = 'round'; g.lineWidth = 6; g.strokeStyle = INK; g.stroke(); g.lineWidth = 4.4; g.strokeStyle = col; g.stroke(); }
      break;
    case 'sprig':
      g.beginPath(); g.moveTo(14, 42); g.quadraticCurveTo(22, 26, 32, 10); lineOnly(1.4);
      for (let i = 0; i < 7; i++) { const t = i / 7; leaf(g, S, 14 + t * 18, 42 - t * 32, i % 2 ? -0.4 : 2.6, 7, 4, G.dark, { R, veins: false }); }
      for (let i = 0; i < 9; i++) { const a = R() * TAU; g.beginPath(); g.arc(32 + Math.cos(a) * 4, 10 + Math.sin(a) * 4, 2.2, 0, TAU); S.fill(col); S.ink(0.3); }
      break;
    case 'sack':
      g.beginPath(); g.moveTo(12, 44); g.quadraticCurveTo(8, 24, 16, 14); g.lineTo(32, 14); g.quadraticCurveTo(40, 24, 36, 44); g.closePath(); S.fill(col); S.ink(1);
      g.beginPath(); g.moveTo(16, 14); g.quadraticCurveTo(24, 8, 32, 14); S.ink(1);
      g.beginPath(); g.moveTo(14, 18); g.lineTo(34, 18); g.lineWidth = 2; g.strokeStyle = '#8a6a40'; g.stroke();
      break;
    case 'jar':
      g.beginPath(); g.roundRect(12, 14, 24, 30, 6); S.fill(col); S.ink(1);
      g.beginPath(); g.roundRect(13, 8, 22, 8, 2); S.fill('#f0e6cc'); S.ink(0.8);
      g.beginPath(); g.roundRect(16, 22, 6, 14, 3); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fill();
      break;
    case 'mug':
      g.beginPath(); g.roundRect(10, 18, 24, 24, 4); S.fill('#e8dcc4'); S.ink(1);
      g.beginPath(); g.arc(35, 28, 6, -1.2, 1.2); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
      g.beginPath(); g.ellipse(22, 19, 11, 3, 0, 0, TAU); S.fill(col); S.ink(0.6);
      for (const x of [17, 23, 29]) { g.beginPath(); g.moveTo(x, 14); g.quadraticCurveTo(x - 3, 10, x, 6); g.quadraticCurveTo(x + 3, 3, x, 0); g.lineWidth = 1; g.strokeStyle = 'rgba(120, 110, 100, 0.45)'; g.stroke(); }
      break;
    case 'bottle':
      g.beginPath(); g.moveTo(19, 4); g.lineTo(29, 4); g.lineTo(29, 14); g.quadraticCurveTo(38, 18, 37, 28); g.lineTo(37, 42); g.quadraticCurveTo(24, 46, 11, 42); g.lineTo(11, 28); g.quadraticCurveTo(10, 18, 19, 14); g.closePath();
      S.fill(col); S.ink(1);
      g.beginPath(); g.rect(18, 1, 12, 5); S.fill('#a08060'); S.ink(0.7);
      g.beginPath(); g.roundRect(15, 26, 18, 10, 2); S.fill('#f4ecd8'); S.ink(0.5);
      break;
    case 'bars':
      for (const [x, y] of [[8, 22], [20, 16], [26, 28]]) { g.beginPath(); g.roundRect(x, y, 16, 11, 2); S.fill(col); S.ink(0.8); for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(x + 3 + i * 3.5, y + 4 + (i % 2) * 3, 1.3, 0, TAU); g.fillStyle = '#3a1f3a'; g.fill(); } }
      break;
    case 'bowl':
      g.beginPath(); g.ellipse(24, 24, 18, 6, 0, 0, TAU); S.fill(col); S.ink(0.8);
      if (look.bits) for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(14 + R() * 20, 22 + R() * 4, 2, 0, TAU); g.fillStyle = shade(col, 0.6 + R() * 0.8); g.fill(); }
      g.beginPath(); g.moveTo(6, 24); g.quadraticCurveTo(8, 42, 24, 42); g.quadraticCurveTo(40, 42, 42, 24); g.quadraticCurveTo(24, 31, 6, 24); S.fill('#d8c8a8'); S.ink(1);
      if (look.t === 'bowl' && !look.bits) for (const x of [18, 26]) { g.beginPath(); g.moveTo(x, 16); g.quadraticCurveTo(x - 3, 11, x, 7); g.lineWidth = 1; g.strokeStyle = 'rgba(120,110,100,0.45)'; g.stroke(); }
      break;
    case 'pan':
      g.beginPath(); g.moveTo(30, 30); g.lineTo(46, 42); g.lineWidth = 4; g.strokeStyle = '#3a3a3a'; g.stroke();
      g.beginPath(); g.ellipse(20, 28, 17, 9, 0, 0, TAU); S.fill('#4a4a4a'); S.ink(1);
      for (const [x, y] of [[13, 26], [21, 24], [27, 30], [17, 32]]) { g.beginPath(); g.ellipse(x, y, 4.5, 3.6, 0.4, 0, TAU); S.fill(col); S.ink(0.6); }
      break;
    case 'tart':
      g.beginPath(); g.ellipse(24, 28, 19, 10, 0, 0, TAU); S.fill('#d8a860'); S.ink(1);
      g.beginPath(); g.ellipse(24, 26, 14, 7, 0, 0, TAU); S.fill(col); S.ink(0.6);
      for (let i = 0; i < 10; i++) { g.beginPath(); g.arc(14 + R() * 20, 23 + R() * 6, 1.6, 0, TAU); g.fillStyle = 'rgba(160,170,230,0.6)'; g.fill(); }
      break;
    case 'bread':
      g.beginPath(); g.ellipse(24, 26, 19, 13, -0.2, 0, TAU); S.fill(col); S.ink(1);
      for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(12 + R() * 24, 18 + R() * 16, 2.6, 1.2, R() * 3, 0, TAU); g.fillStyle = i % 2 ? '#5fa83e' : 'rgba(150, 100, 40, 0.6)'; g.fill(); }
      break;
    case 'plate':
      g.beginPath(); g.ellipse(24, 30, 20, 9, 0, 0, TAU); S.fill('#f2ece0'); S.ink(1);
      for (let i = 0; i < 12; i++) { const x = 12 + R() * 24, y = 24 + R() * 8; g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x + (R() - 0.5) * 6, y - 6); g.lineCap = 'round'; g.lineWidth = 3; g.strokeStyle = col; g.stroke(); }
      break;
    default:
      g.beginPath(); g.arc(24, 24, 12, 0, TAU); S.fill(col); S.ink(1);
  }
  return c;
}
