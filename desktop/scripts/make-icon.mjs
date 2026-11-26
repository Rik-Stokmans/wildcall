// Procedural app icon: a simple bird silhouette on forest green, written as a
// 1024x1024 PNG with nothing but node:zlib. electron-builder derives .icns/.ico from it.
// Usage: node scripts/make-icon.mjs [outfile]   (default build/icon.png)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const SS = 3; // supersampling per axis for smooth edges
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '..', 'build', 'icon.png');

// Shapes live in a 0..1 unit square. Each is a signed-ish test: inside -> true.
const ellipse = (cx, cy, rx, ry, rot = 0) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return (x, y) => {
    const dx = x - cx, dy = y - cy;
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    return (u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1;
  };
};
const tri = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const d = (px, py, qx, qy) => (x - qx) * (py - qy) - (px - qx) * (y - qy);
  const d1 = d(ax, ay, bx, by), d2 = d(bx, by, cx, cy), d3 = d(cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

// A songbird in profile facing left, perched on a twig.
const body = [
  ellipse(0.52, 0.55, 0.20, 0.145, -0.35), // body
  ellipse(0.35, 0.40, 0.095, 0.095), // head
  tri(0.275, 0.375, 0.17, 0.43, 0.275, 0.445), // beak
  tri(0.63, 0.50, 0.88, 0.70, 0.60, 0.68), // tail
];
const wing = ellipse(0.52, 0.53, 0.115, 0.06, -0.55);
const eye = ellipse(0.33, 0.385, 0.017, 0.017);
const twig = ellipse(0.52, 0.715, 0.32, 0.022, 0.03);
const legs = [tri(0.465, 0.64, 0.455, 0.715, 0.485, 0.715), tri(0.545, 0.65, 0.535, 0.717, 0.565, 0.717)];

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const GREEN_TOP = hex(0x2f5d3f), GREEN_BOT = hex(0x16291e);
const CREAM = hex(0xf1e8cf), WING = hex(0xd9a441), DARK = hex(0x1c2a22), BARK = hex(0x6b4a2f);

// Rounded-square mask, in unit coordinates (macOS-style squircle-ish corner).
const R = 0.22;
function inMask(x, y) {
  const m = 0.04; // transparent margin
  if (x < m || x > 1 - m || y < m || y > 1 - m) return false;
  const cx = Math.min(Math.max(x, m + R), 1 - m - R), cy = Math.min(Math.max(y, m + R), 1 - m - R);
  return (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
}

function shade(x, y) {
  if (!inMask(x, y)) return [0, 0, 0, 0];
  const t = y;
  let c = GREEN_TOP.map((v, i) => v + (GREEN_BOT[i] - v) * t);
  const glow = Math.max(0, 1 - Math.hypot(x - 0.5, y - 0.4) / 0.6) * 0.18; // soft light behind the bird
  c = c.map((v, i) => v + (CREAM[i] - v) * glow);
  if (twig(x, y)) c = BARK;
  if (legs.some((f) => f(x, y))) c = DARK.map((v, i) => v + (CREAM[i] - v) * 0.35);
  if (body.some((f) => f(x, y))) c = CREAM;
  if (wing(x, y)) c = WING;
  if (eye(x, y)) c = DARK;
  return [c[0], c[1], c[2], 255];
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let py = 0; py < SIZE; py++) {
  const row = py * (SIZE * 4 + 1);
  raw[row] = 0; // filter: none
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const s = shade((px + (sx + 0.5) / SS) / SIZE, (py + (sy + 0.5) / SS) / SIZE);
        r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3]; // premultiplied accumulate
      }
    }
    const o = row + 1 + px * 4;
    if (a > 0) {
      raw[o] = Math.round(r / a); raw[o + 1] = Math.round(g / a); raw[o + 2] = Math.round(b / a);
      raw[o + 3] = Math.round(a / (SS * SS));
    }
  }
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`icon: ${path.relative(process.cwd(), out)} (${SIZE}x${SIZE}, ${png.length} bytes)`);
