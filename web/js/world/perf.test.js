// Tests for the performance pass: distance bands and cross-fades of the trees, the
// grass gaps around ground birds, kept-short ground, and the debug-stats categories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETAIL } from './trees/treeGeometry.js';
import { TREE_BANDS, SHRUB_BANDS, bandMask, fadeWindow, fadeAt, bandsFor, zoomStep } from './trees/instancing.js';
import { collectGaps, sightCap, gapHeight, mowField, groundCover, MAX_GAPS, NO_SIGHT, SIGHT_BODY } from './groundField.js';
import { HABITAT, REGION } from './constants.js';
import { statCategory, addStat, rollup } from './debugStats.js';

const bit = (d) => 1 << d;

test('bands: every distance is held by the level(s) that draw it', () => {
  for (const bands of [...Object.values(TREE_BANDS), ...Object.values(SHRUB_BANDS)]) {
    for (let d = 0; d < 400; d += 0.5) {
      const mask = bandMask(d, bands, 0);
      for (const det of [DETAIL.FAR, DETAIL.MID, DETAIL.NEAR]) {
        const [fin, fout] = fadeAt(d, fadeWindow(det, bands));
        const drawn = fin > 0 && fout > 0;
        if (drawn) assert.ok(mask & bit(det), `detail ${det} drawn at ${d} m but not in the buffers`);
      }
    }
  }
});

test('bands: the cross-fade of two neighbouring levels is complementary', () => {
  const bands = TREE_BANDS.medium;
  for (const [a, b, edge] of [[DETAIL.NEAR, DETAIL.MID, bands.near], [DETAIL.MID, DETAIL.FAR, bands.mid]]) {
    for (let d = edge - bands.fade; d <= edge + bands.fade; d += 0.25) {
      const out = fadeAt(d, fadeWindow(a, bands))[1];  // the nearer level fading out
      const inn = fadeAt(d, fadeWindow(b, bands))[0];  // the farther level fading in
      // Pixel kept by a: t < out; by b: t >= 1 − inn. Complementary when out = 1 − inn.
      assert.ok(Math.abs(out - (1 - inn)) < 1e-9, `at ${d} m: ${out} vs ${inn}`);
    }
  }
});

test('bands: near only close by, far only beyond mid, margins widen the buffers', () => {
  const b = TREE_BANDS.medium;
  assert.equal(bandMask(5, b), bit(DETAIL.NEAR));
  assert.equal(bandMask((b.near + b.mid) / 2, b), bit(DETAIL.MID));
  assert.equal(bandMask(b.mid + 50, b), bit(DETAIL.FAR));
  assert.equal(bandMask(b.near, b), bit(DETAIL.NEAR) | bit(DETAIL.MID));
  assert.ok(bandMask(b.near + b.fade / 2 + 3, b, 5) & bit(DETAIL.NEAR));
  // low cuts far trees deep in its fog
  const low = TREE_BANDS.low;
  assert.equal(bandMask(low.cut + 20, low), 0);
  assert.equal(fadeAt(low.cut + 1, fadeWindow(DETAIL.FAR, low))[1], 0);
  assert.equal(bandsFor(true, 'nope'), SHRUB_BANDS.medium);
});

test('gaps: nearest ground birds, never airborne ones, the feet last', () => {
  const out = new Float32Array(MAX_GAPS * 4), y = new Float32Array(MAX_GAPS);
  const ground = () => 2;
  const birds = [];
  for (let i = 0; i < 20; i++) birds.push({ pos: { x: i * 3, y: 2.05, z: 0 }, act: 0 });
  birds.push({ pos: { x: 1, y: 2, z: 1 }, act: 9 });                 // airborne (flag below)
  birds.push({ pos: { x: 2, y: 6, z: 1 }, act: 0 });                 // on a branch
  const airborne = (act) => act === 9;
  const n = collectGaps(out, { x: 0, z: 0 }, birds, airborne, ground, [], { x: 0, y: 2, z: 0 }, y);
  assert.equal(n, MAX_GAPS);
  const xs = [];
  for (let i = 0; i < n - 1; i++) { xs.push(out[i * 4]); assert.ok(Math.abs(y[i] - (2.05 + SIGHT_BODY)) < 1e-5); }
  assert.deepEqual(xs.sort((a, b) => a - b), Array.from({ length: MAX_GAPS - 1 }, (_, i) => i * 3));
  assert.equal(y[n - 1], NO_SIGHT);
  // out of range, nothing loaded
  assert.equal(collectGaps(out, { x: 1e4, z: 0 }, birds, airborne, ground, null, null, y), 0);
  assert.equal(collectGaps(out, { x: 0, z: 0 }, birds, airborne, () => NaN, null, null, y), 0);
});

test('gaps: plants shrink at a bird and stay low along the sight line to it', () => {
  assert.equal(gapHeight(0, 1, 0.17), 0.17);
  assert.equal(gapHeight(2, 1, 0.17), 1);
  const cam = { x: 0, y: 1.6, z: 0 };
  // bird 20 m north on flat ground at y 0, body at 0.1
  const cap = (x, z) => sightCap(cam, x, z, 0, 0, 20, 0.1);
  assert.ok(cap(0, 19.5) < 0.12);                 // right in front of the bird: flattened
  assert.ok(cap(0, 10) < 0.9 && cap(0, 10) > 0.7); // half way: below the sight line
  assert.equal(cap(3, 10), Infinity);               // outside the narrow cone
  assert.equal(cap(0, -5), Infinity);               // behind the camera
});

test('kept-short ground around buildings, short woodland floor, long meadow', () => {
  const mow = mowField([{ kind: 'cabin', pos: { x: 0, z: 0 }, radius: 10 }, { kind: 'pond', pos: { x: 99, z: 0 } }]);
  assert.equal(mow(3, 4), 1);
  assert.equal(mow(200, 0), 0);
  assert.equal(mowField([{ kind: 'pond', pos: { x: 0, z: 0 } }]), null);
  const g = (habitat, canopy, m = 0) => groundCover(habitat, REGION.GREENHOLLOW, 90, 150, 60, 1, 5, canopy, [0, 0, 0, 0], 0, m)[1];
  const meadow = g(HABITAT.MEADOW, 0), wood = g(HABITAT.WOODLAND, 0.6), mown = g(HABITAT.MEADOW, 0, 1);
  assert.ok(meadow > 180, 'long meadow grass');
  assert.ok(wood < 30, `short woodland floor (${wood})`);
  assert.ok(mown < 40, `mown turf (${mown})`);
});

test('debug stats: categories and roll-up', () => {
  assert.equal(statCategory({ name: 'terrain' }), 'terrain');
  assert.equal(statCategory({ name: 'tree:oak/3/leaf2' }), 'trees.near.leaf');
  assert.equal(statCategory({ name: 'tree:shrub/1/wood0' }), 'shrubs.wood');
  assert.equal(statCategory({ name: 'tree-shadow:pine/0/leaf' }), 'shadowcasters.trees');
  assert.equal(statCategory({ name: 'ground:grass:3' }), 'ground.grass.r3');
  assert.equal(statCategory({ name: 'veg:rock' }), 'vegetation.rock');
  assert.equal(statCategory({ name: 'x', parent: { name: 'forage' } }), 'forage');
  const t = {};
  addStat(t, 'trees.near.leaf', 1, 100, false);
  addStat(t, 'trees.far.wood', 2, 50, true);
  const r = rollup(t, 1);
  assert.deepEqual(r.trees, { calls: 1, tris: 100, shadowCalls: 2, shadowTris: 50 });
});

test('zoom steps: optics shrink tree LOD distances in a few steps', () => {  assert.equal(zoomStep(1), 1);
  assert.equal(zoomStep(0.9), 1);
  assert.equal(zoomStep(0.65), 0.7);
  assert.equal(zoomStep(12 / 70), 0.25);
});
