import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleKey, samplePoints, recordSamples, recordLocations, regionLabels, MAX_SAMPLES } from './regions.js';

test('sample keys floor negatives', () => {
  assert.equal(sampleKey(0, 0), '0,0');
  assert.equal(sampleKey(-1, 127), '-1,0');
  assert.equal(sampleKey(128, -129), '1,-2');
});

test('ring of sample points', () => {
  const pts = samplePoints(10, 20);
  assert.equal(pts.length, 17);
  assert.deepEqual(pts[0], { x: 10, z: 20 });
});

test('recordSamples ignores unknown/open water and reports changes', () => {
  const s = new Map();
  const at = (x) => (x < 0 ? 255 : 2);
  assert.ok(recordSamples(s, [{ x: 10, z: 10 }, { x: -10, z: 10 }], at));
  assert.equal(s.size, 1);
  assert.equal(s.get('0,0'), 2);
  assert.ok(!recordSamples(s, [{ x: 10, z: 10 }], at));
});

test('sample memory is bounded', () => {
  const s = new Map();
  for (let i = 0; i < MAX_SAMPLES + 50; i++) recordSamples(s, [{ x: i * 128, z: 0 }], () => 1);
  assert.equal(s.size, MAX_SAMPLES);
});

test('locations contribute samples', () => {
  const s = new Map();
  assert.ok(recordLocations(s, { a: { pos: { x: 300, y: 0, z: -300 }, region: 3 }, b: { region: 1 } }));
  assert.equal(s.get('2,-3'), 3);
  assert.equal(s.size, 1);
});

test('labels: adjacent same-region patches merge, different regions stay apart, fog filters', () => {
  const s = new Map();
  for (let cx = 0; cx < 8; cx++) s.set(`${cx},0`, 0);   // one long patch of region 0 (2 blocks)
  s.set('20,0', 2);                                     // far patch of region 2
  s.set('0,1', 3);                                      // region 3 overlapping block of region 0
  s.set('40,40', 1);                                    // unexplored
  const labels = regionLabels(s, (x, z) => x < 5000 && z < 5000);
  assert.equal(labels.filter((l) => l.region === 0).length, 1);
  assert.equal(labels.filter((l) => l.region === 0)[0].cells, 8);
  assert.equal(labels.filter((l) => l.region === 2).length, 1);
  assert.equal(labels.filter((l) => l.region === 3).length, 1);
  assert.equal(labels.filter((l) => l.region === 1).length, 0);
});

test('labels: separate patches of the same region stay separate', () => {
  const s = new Map([['0,0', 0], ['30,0', 0]]);
  assert.equal(regionLabels(s, () => true).length, 2);
});
