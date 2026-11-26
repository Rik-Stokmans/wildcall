// Tests of the pure data builders behind the three.js side: terrain arrays, instance
// transforms, vegetation models and seasonal tints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChunk, encodeChunk } from './chunkCodec.js';
import { buildTerrainArrays, skirtDrop, chunkSphere } from './terrainMesh.js';
import { fillInstances, countInstances, keepInstance, instanceTint } from './instances.js';
import { buildVegModel, detailForLod } from './vegModels.js';
import { seasonTint, easeTint, SEASON } from './season.js';
import { VEG, VEG_INFO, VEG_KIND_COUNT } from './constants.js';

test('terrain arrays: grid, skirts and indices stay in range', () => {
  for (const lod of [0, 1, 2]) {
    const c = parseChunk(encodeChunk({ cx: -5, cz: 9, lod, sample: (ix, iz) => ({ h: ix - iz, color: [255, 0, 128] }) }));
    const t = buildTerrainArrays(c);
    const n = c.n;
    assert.equal(t.vertexCount, n * n + 4 * n);
    for (const i of t.index) assert.ok(i < t.vertexCount);
    // Chunk-local XZ, absolute Y.
    assert.equal(t.position[0], 0);
    assert.equal(t.position[(n * n - 1) * 3], 64);
    assert.equal(t.position[(n * n - 1) * 3 + 2], 64);
    assert.equal(t.position[1], 0);
    // First north skirt vertex hangs below grid vertex 0.
    assert.equal(t.position[n * n * 3 + 1], -skirtDrop(c.cell));
    assert.equal(t.color[0], 1);
    assert.equal(t.color[1], 0);
    assert.equal(t.index.length, ((n - 1) * (n - 1) + 4 * (n - 1)) * 6);
  }
});

test('chunkSphere encloses the footprint', () => {
  const s = chunkSphere(-2, 10, 3);
  assert.equal(s.x, 32);
  assert.equal(s.y, 4);
  assert.ok(s.r >= Math.hypot(35, 35));
});

function vegOf(list) {
  const n = list.length;
  const v = {
    count: n, kind: new Uint8Array(n), variant: new Uint8Array(n), rot: new Float32Array(n),
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), scale: new Float32Array(n),
  };
  list.forEach((o, i) => {
    v.kind[i] = o.kind; v.variant[i] = o.variant ?? 0; v.rot[i] = o.rot ?? 0;
    v.x[i] = o.x; v.y[i] = o.y ?? 0; v.z[i] = o.z; v.scale[i] = o.scale ?? 1;
  });
  return v;
}

test('instances: chunk-local matrices, tree heights kept exactly, lily pads float', () => {
  const veg = vegOf([
    { kind: VEG.OAK, variant: 9, x: -60, y: 5, z: -10, scale: 1.3, rot: Math.PI / 2 },
    { kind: VEG.LILY_PADS, x: -50, y: -0.6, z: -20 },
    { kind: VEG.OAK, variant: 200, x: -40, y: 2, z: -30 },
  ]);
  const model = buildVegModel(VEG.OAK, 2);
  const m = new Float32Array(32), col = new Float32Array(6), b = {};
  const n = fillInstances(veg, VEG.OAK, -64, -64, 1, model, m, col, b);
  assert.equal(n, 2);
  assert.ok(Math.abs(m[12] - 4) < 1e-5);
  assert.equal(m[13], 5);
  assert.ok(Math.abs(m[14] - 54) < 1e-5);
  assert.ok(Math.abs(m[5] - 1.3) < 1e-6); // sy = scale for trees
  assert.ok(b.maxY > 5 + 11 * 1.2);
  assert.ok(col.every((v) => v > 0.6 && v < 1.4));
  const pm = new Float32Array(16), pc = new Float32Array(3), pb = {};
  fillInstances(veg, VEG.LILY_PADS, -64, -64, 1, buildVegModel(VEG.LILY_PADS, 2), pm, pc, pb);
  assert.ok(pm[13] > 0 && pm[13] < 0.1);
});

test('decor thinning never removes trees, shrubs, reeds or rocks', () => {
  const list = [];
  for (let i = 0; i < 400; i++) list.push({ kind: i % VEG_KIND_COUNT, variant: i & 255, x: i * 0.37, z: i * 0.11 });
  const veg = vegOf(list);
  const all = countInstances(veg, 1, new Uint32Array(VEG_KIND_COUNT));
  const few = countInstances(veg, 0.3, new Uint32Array(VEG_KIND_COUNT));
  for (const k of [VEG.OAK, VEG.PINE, VEG.SHRUB, VEG.REEDS, VEG.ROCK, VEG.SNAG]) assert.equal(few[k], all[k]);
  assert.ok(few[VEG.GRASS_TUFT] < all[VEG.GRASS_TUFT]);
  assert.equal(keepInstance(VEG.OAK, 3, 1, 1, 0), true);
});

test('snow pines keep their white', () => {
  const out = new Float32Array(3);
  for (let v = 0; v < 256; v += 17) {
    instanceTint(VEG.SNOW_PINE, v, out);
    assert.ok(Math.abs(out[0] - out[2]) < 0.01);
  }
});

test('every vegetation kind builds valid models at every detail', () => {
  for (let k = 0; k < VEG_KIND_COUNT; k++) {
    for (const d of [0, 1, 2]) {
      const m = buildVegModel(k, d);
      assert.ok(m.triangleCount > 0, `${VEG_INFO[k].name}/${d}`);
      assert.equal(m.position.length, m.vertexCount * 3);
      assert.equal(m.veg.length, m.vertexCount * 3);
      for (const i of m.index) assert.ok(i < m.vertexCount);
      for (const v of m.position) assert.ok(Number.isFinite(v));
      for (const v of m.veg) assert.ok(v >= 0 && v <= 1);
    }
  }
  // Trees are their nominal height, near models are richer than far ones.
  assert.ok(Math.abs(buildVegModel(VEG.OAK, 2).maxY - 11) < 1.2);
  assert.ok(Math.abs(buildVegModel(VEG.PINE, 2).maxY - 14) < 1.2);
  assert.ok(buildVegModel(VEG.OAK, 2).triangleCount > buildVegModel(VEG.OAK, 0).triangleCount * 4);
  // Distinct silhouettes: the oak crown is broad, the birch slim, the pine narrows to a point.
  assert.ok(buildVegModel(VEG.OAK, 2).radius > buildVegModel(VEG.BIRCH, 2).radius * 1.5);
});

test('detail follows chunk LOD but never exceeds what the kind supports', () => {
  assert.equal(detailForLod(VEG.OAK, 0), 2);
  assert.equal(detailForLod(VEG.OAK, 2), 0);
  assert.equal(detailForLod(VEG.SHRUB, 2), 1);
  assert.equal(detailForLod(VEG.GRASS_TUFT, 1), 2);
});

test('seasonal tints: summer untinted, autumn warm, amber and snow kinds never tinted', () => {
  assert.equal(seasonTint('broadleaf', SEASON.SUMMER).amt, 0);
  const autumn = seasonTint('broadleaf', SEASON.AUTUMN);
  assert.ok(autumn.amt > 0.5 && autumn.a[0] > autumn.a[2]);
  assert.equal(seasonTint(VEG_INFO[VEG.AMBER_OAK].season, SEASON.WINTER).amt, 0);
  assert.equal(seasonTint(VEG_INFO[VEG.SNOW_PINE].season, SEASON.SPRING).amt, 0);
  assert.equal(seasonTint('broadleaf', 6), seasonTint('broadleaf', 2));
  const cur = { a: [0, 0, 0], b: [0, 0, 0], amt: 0 };
  easeTint(cur, autumn, 0.5);
  assert.deepEqual(cur.a, [...autumn.a]); // snaps colour while invisible
  assert.ok(cur.amt > 0 && cur.amt < autumn.amt);
  for (let i = 0; i < 60; i++) easeTint(cur, autumn, 0.5);
  assert.equal(cur.amt, autumn.amt);
});

import { encodeShore, decodeShore, shoreOrigin, fillShoreRows, SHORE_RES, SHORE_TEXEL, SHORE_RANGE } from './shore.js';

test('shore grid: encoding, snapping and unloaded ground as deep water', () => {
  assert.equal(encodeShore(-SHORE_RANGE - 3), 0);
  assert.equal(encodeShore(SHORE_RANGE + 3), 255);
  assert.equal(encodeShore(NaN), 0);
  assert.ok(Math.abs(decodeShore(encodeShore(-0.4)) + 0.4) < 0.02);
  const [ox, oz] = shoreOrigin(-1000, 2000);
  assert.equal(ox, Math.round(-1000 / 64) * 64 - SHORE_RES * SHORE_TEXEL / 2 + SHORE_TEXEL / 2);
  assert.deepEqual(shoreOrigin(-1000, 2000), shoreOrigin(-1010, 2010)); // stable while walking
  const out = new Uint8Array(SHORE_RES * SHORE_RES).fill(77);
  const store = { sampleHeight: (x) => (x < ox + 10 ? 0 : NaN) };
  fillShoreRows(store, ox, oz, out, 0, 2);
  assert.equal(out[0], encodeShore(0));
  assert.equal(out[SHORE_RES - 1], 0);
  assert.equal(out[2 * SHORE_RES], 77); // rows outside the slice untouched
});
