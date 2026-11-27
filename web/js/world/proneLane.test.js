// The prone sight lane in collectGaps (player prone stance; see groundField.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectGaps, MAX_GAPS, NO_SIGHT, PRONE_LANE } from './groundField.js';

test('a prone sight lane adds gaps ahead of the feet along the view', () => {
  const out = new Float32Array(MAX_GAPS * 4), y = new Float32Array(MAX_GAPS);
  const feet = { x: 10, y: 0, z: 5 };
  const n0 = collectGaps(out, { x: 10, z: 5 }, [], () => false, () => 0, null, feet, y);
  assert.equal(n0, 1);
  const n = collectGaps(out, { x: 10, z: 5 }, [], () => false, () => 0, null, feet, y, { dx: 0, dz: -1 });
  assert.equal(n, 1 + PRONE_LANE.length);
  for (let i = 1; i < n; i++) {
    assert.equal(out[i * 4], 10);
    assert.ok(out[i * 4 + 1] < 5);            // north = -z: ahead
    assert.ok(out[i * 4 + 3] > 0.2);          // grass is lowered, not removed
    assert.equal(y[i], NO_SIGHT);
  }
  // Birds still fit: the lane only takes its own reserved slots.
  const birds = Array.from({ length: 20 }, (_, i) => ({ pos: { x: 10 + i, y: 0, z: 5 }, act: 0 }));
  assert.equal(collectGaps(out, { x: 10, z: 5 }, birds, () => false, () => 0, null, feet, y, { dx: 1, dz: 0 }), MAX_GAPS);
});
