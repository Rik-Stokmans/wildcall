import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChunk, peekChunkHeader, encodeChunk, decimateChunk, chunkLayout } from './chunkCodec.js';
import { gridSize } from './constants.js';

// Builds a v2 frame byte by byte straight from contract §2.3, independently of
// encodeChunk, so the parser is checked against the spec rather than against itself.
function handFrame({ cx, cz, lod, veg = [], magic = 'WCHK', version = 2 }) {
  const cell = 2 << lod;
  const n = 64 / cell + 1;
  const nn = n * n;
  let size = 16 + nn * 4 + nn * 3 + nn * 3 + nn + nn;
  const pad = (4 - (size % 4)) % 4;
  size += pad + 4 + veg.length * 20;
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, magic.charCodeAt(i));
  dv.setUint8(4, version);
  dv.setUint8(5, lod);
  dv.setUint16(6, n, true);
  dv.setInt32(8, cx, true);
  dv.setInt32(12, cz, true);
  let o = 16;
  for (let i = 0; i < nn; i++, o += 4) dv.setFloat32(o, i * 0.5 - 3, true);
  for (let i = 0; i < nn; i++) { dv.setInt8(o++, 0); dv.setInt8(o++, 127); dv.setInt8(o++, -5); }
  for (let i = 0; i < nn; i++) { dv.setUint8(o++, 10); dv.setUint8(o++, i & 255); dv.setUint8(o++, 200); }
  for (let i = 0; i < nn; i++) dv.setUint8(o++, i % 7 === 0 ? 255 : 4);
  for (let i = 0; i < nn; i++) dv.setUint8(o++, i % 11);
  o += pad;
  dv.setUint32(o, veg.length, true); o += 4;
  for (const v of veg) {
    dv.setUint8(o, v.kind); dv.setUint8(o + 1, v.variant); dv.setUint16(o + 2, v.rot, true);
    dv.setFloat32(o + 4, v.x, true); dv.setFloat32(o + 8, v.y, true); dv.setFloat32(o + 12, v.z, true);
    dv.setFloat32(o + 16, v.scale, true);
    o += 20;
  }
  return buf;
}

test('parses a hand-built v2 frame with negative coordinates', () => {
  const veg = [
    { kind: 0, variant: 7, rot: 65535, x: -3000.5, y: 4.25, z: -60.75, scale: 1.2 },
    { kind: 17, variant: 255, rot: 0, x: -2990, y: -0.1, z: -40, scale: 0.8 },
  ];
  const c = parseChunk(handFrame({ cx: -47, cz: -1, lod: 0, veg }));
  assert.equal(c.cx, -47);
  assert.equal(c.cz, -1);
  assert.equal(c.lod, 0);
  assert.equal(c.n, 33);
  assert.equal(c.cell, 2);
  assert.equal(c.heights.length, 33 * 33);
  assert.equal(c.heights[0], -3);
  assert.equal(c.heights[33 * 33 - 1], (33 * 33 - 1) * 0.5 - 3);
  assert.equal(c.minY, -3);
  assert.deepEqual([...c.normals.slice(0, 3)], [0, 127, -5]);
  assert.deepEqual([...c.colors.slice(3, 6)], [10, 1, 200]);
  assert.equal(c.region[0], 255);
  assert.equal(c.region[1], 4);
  assert.equal(c.habitat[12], 1);
  assert.equal(c.veg.count, 2);
  assert.equal(c.veg.kind[0], 0);
  assert.equal(c.veg.variant[0], 7);
  assert.ok(Math.abs(c.veg.rot[0] - Math.PI * 2) < 1e-6);
  assert.equal(c.veg.x[0], -3000.5);
  assert.equal(c.veg.z[0], -60.75);
  assert.ok(Math.abs(c.veg.scale[0] - 1.2) < 1e-6);
  assert.equal(c.veg.kind[1], 17);
  assert.equal(c.veg.variant[1], 255);
});

test('every LOD has the documented grid size and layout', () => {
  for (const [lod, n] of [[0, 33], [1, 17], [2, 9]]) {
    assert.equal(gridSize(lod), n);
    const buf = handFrame({ cx: 3, cz: -9, lod });
    assert.equal(chunkLayout(n).veg + 0, buf.byteLength);
    const c = parseChunk(buf);
    assert.equal(c.n, n);
    assert.equal(c.cell, 2 << lod);
    assert.equal(c.veg.count, 0);
  }
});

test('the vegetation count is 4-byte aligned from the frame start', () => {
  for (const n of [33, 17, 9]) assert.equal(chunkLayout(n).vegCount % 4, 0);
});

test('rejects bad magic, version, lod and truncation', () => {
  assert.throws(() => parseChunk(handFrame({ cx: 0, cz: 0, lod: 0, magic: 'XCHK' })), /magic/);
  assert.throws(() => parseChunk(handFrame({ cx: 0, cz: 0, lod: 0, version: 1 })), /version/);
  const good = handFrame({ cx: 0, cz: 0, lod: 1, veg: [{ kind: 0, variant: 0, rot: 0, x: 1, y: 1, z: 1, scale: 1 }] });
  assert.throws(() => parseChunk(good.slice(0, good.byteLength - 4)), /truncated vegetation/);
  assert.throws(() => parseChunk(good.slice(0, 100)), /truncated grid/);
  assert.throws(() => parseChunk(new ArrayBuffer(8)), /too short/);
  const badLod = handFrame({ cx: 0, cz: 0, lod: 0 });
  new DataView(badLod).setUint8(5, 1); // N 33 does not match lod 1
  assert.throws(() => parseChunk(badLod), /grid size/);
  assert.equal(peekChunkHeader(badLod), null);
  assert.equal(peekChunkHeader(new ArrayBuffer(3)), null);
});

test('skips vegetation kinds this client does not know', () => {
  const c = parseChunk(handFrame({
    cx: 0, cz: 0, lod: 0,
    veg: [
      { kind: 40, variant: 0, rot: 0, x: 1, y: 1, z: 1, scale: 1 },
      { kind: 2, variant: 0, rot: 0, x: 2, y: 2, z: 2, scale: 1 },
      { kind: 3, variant: 0, rot: 0, x: 2, y: 2, z: 2, scale: 0 },
    ],
  }));
  assert.equal(c.veg.count, 1);
  assert.equal(c.veg.kind[0], 2);
});

test('peekChunkHeader reads signed coordinates', () => {
  assert.deepEqual(peekChunkHeader(handFrame({ cx: -2147483648, cz: 2147483647, lod: 2 })), { cx: -2147483648, cz: 2147483647, lod: 2, n: 9 });
});

test('encodeChunk round-trips through parseChunk', () => {
  const buf = encodeChunk({
    cx: -2, cz: 5, lod: 1,
    sample: (ix, iz, x, z) => ({ h: x * 0.1 + z * 0.01, region: 2, habitat: 7, color: [ix, iz, 9] }),
    veg: [{ kind: 6, variant: 3, rot: -Math.PI / 2, x: -100, y: 2, z: 330, scale: 1.5 }],
  });
  const c = parseChunk(buf);
  assert.equal(c.cx, -2);
  assert.equal(c.cz, 5);
  assert.ok(Math.abs(c.heights[0] - (-128 * 0.1 + 320 * 0.01)) < 1e-5);
  assert.equal(c.colors[(2 * 17 + 3) * 3], 3);
  assert.ok(Math.abs(c.veg.rot[0] - Math.PI * 1.5) < 1e-3);
});

test('decimateChunk keeps shared vertices and drops fine vegetation', () => {
  const fine = parseChunk(encodeChunk({
    cx: -1, cz: -1, lod: 0,
    sample: (ix, iz) => ({ h: ix * 100 + iz, region: ix % 6, habitat: iz % 11 }),
    veg: [
      { kind: 0, x: -10, y: 0, z: -10 }, // oak: all LODs
      { kind: 4, x: -11, y: 0, z: -10 }, // shrub: lod 0, 1
      { kind: 8, x: -12, y: 0, z: -10 }, // grass: lod 0 only
    ],
  }));
  const mid = decimateChunk(fine, 1);
  assert.equal(mid.n, 17);
  assert.equal(mid.heights[3 * 17 + 5], 10 * 100 + 6);
  assert.equal(mid.region[3 * 17 + 5], fine.region[6 * 33 + 10]);
  assert.equal(mid.veg.count, 2);
  const far = decimateChunk(fine, 2);
  assert.equal(far.n, 9);
  assert.equal(far.heights[8 * 9 + 8], 32 * 100 + 32);
  assert.equal(far.veg.count, 1);
  assert.equal(far.veg.kind[0], 0);
  assert.throws(() => decimateChunk(far, 1));
});
