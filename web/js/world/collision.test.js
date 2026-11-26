import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collision, solidRadius, crownRadius } from './collision.js';
import { VEG } from './constants.js';

function vegOf(list) {
  const n = list.length;
  const v = {
    count: n, kind: new Uint8Array(n), variant: new Uint8Array(n), rot: new Float32Array(n),
    x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), scale: new Float32Array(n),
  };
  list.forEach((o, i) => { v.kind[i] = o.kind; v.x[i] = o.x; v.z[i] = o.z; v.scale[i] = o.scale ?? 1; });
  return v;
}

test('solid and crown radii follow the kind table', () => {
  assert.ok(solidRadius(VEG.OAK, 1) > 0.3);
  assert.equal(solidRadius(VEG.SHRUB, 1), 0);
  assert.equal(solidRadius(VEG.ROCK, 0.5), 0); // pebbles are stepped over
  assert.ok(solidRadius(VEG.ROCK, 1.5) > 0);
  assert.ok(crownRadius(VEG.PINE, 1) > 2);
  assert.equal(crownRadius(VEG.SNAG, 1), 0);
});

test('collide pushes out of trunks across a negative chunk border', () => {
  const c = new Collision();
  c.setChunk(-1, -1, vegOf([{ kind: VEG.OAK, x: -0.2, z: -0.2, scale: 1 }]));
  const pos = { x: 0.1, y: 5, z: -0.2 };
  assert.equal(c.collide(pos, 0.3), true);
  const d = Math.hypot(pos.x + 0.2, pos.z + 0.2);
  assert.ok(Math.abs(d - (0.42 + 0.3)) < 1e-5, `distance ${d}`);
  assert.equal(pos.y, 5); // XZ only
  const free = { x: 5, y: 0, z: 5 };
  assert.equal(c.collide(free, 0.3), false);
  c.deleteChunk(-1, -1);
  const again = { x: 0.1, y: 0, z: -0.2 };
  assert.equal(c.collide(again, 0.3), false);
});

test('blockers collide until their owner removes them', () => {
  const c = new Collision();
  const remove = c.addBlocker({ x: -100, z: 2000, r: 3 });
  const pos = { x: -101, y: 0, z: 2000 };
  c.collide(pos, 0.5);
  assert.ok(Math.abs(Math.hypot(pos.x + 100, pos.z - 2000) - 3.5) < 1e-5);
  remove();
  remove(); // idempotent
  const p2 = { x: -101, y: 0, z: 2000 };
  assert.equal(c.collide(p2, 0.5), false);
  assert.equal(typeof c.addBlocker({ x: NaN, z: 0, r: 1 }), 'function');
  c.clearChunks();
  const keep = c.addBlocker({ x: 0, z: 0, r: 1 });
  c.clearChunks(); // vegetation reset keeps blockers
  const p3 = { x: 0.5, y: 0, z: 0 };
  assert.equal(c.collide(p3, 0.2), true);
  keep();
});

test('surface patches override footsteps, latest first', () => {
  const c = new Collision();
  const a = c.addSurfacePatch({ x: 0, z: 0, r: 4, surface: 'wood' });
  assert.equal(c.patchAt(1, 1), 'wood');
  assert.equal(c.patchAt(10, 10), null);
  a();
  assert.equal(c.patchAt(1, 1), null);
});

test('canopyAt is high under a crown, falls off at the rim and is 0 in the open', () => {
  const c = new Collision();
  c.setChunk(0, 0, vegOf([{ kind: VEG.OAK, x: 30, z: 30 }, { kind: VEG.OAK, x: 33, z: 30 }]));
  const under = c.canopyAt(31.5, 30);
  assert.ok(under > 0.9, `under ${under}`);
  assert.ok(c.canopyAt(30, 30 + 4.4) < under);
  assert.equal(c.canopyAt(5, 5), 0);
  assert.ok(under <= 1);
});
