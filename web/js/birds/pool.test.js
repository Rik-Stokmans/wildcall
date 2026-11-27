import test from 'node:test';
import assert from 'node:assert/strict';
import { SparePool, disposeView, SPARE_CAP } from './pool.js';

test('SparePool keeps at most SPARE_CAP spares over all species, disposing the oldest', () => {
  const disposed = [];
  const pool = new SparePool((v) => disposed.push(v.id));
  // 40 species × 5 released views each: far more than the cap.
  let id = 0;
  for (let sp = 0; sp < 40; sp++) for (let i = 0; i < 5; i++) pool.put('sp' + sp, { id: id++ });
  assert.equal(pool.size, SPARE_CAP);
  assert.equal(disposed.length, 200 - SPARE_CAP);
  assert.deepEqual(disposed.slice(0, 3), [0, 1, 2], 'oldest first');
  assert.equal(pool.take('sp0'), null, 'an evicted species has no spares left');
  // The newest spare of a species comes back first, and only once.
  assert.equal(pool.take('sp39').id, 199);
  assert.equal(pool.take('sp39').id, 198);
  assert.equal(pool.size, SPARE_CAP - 2);
});

test('SparePool: take/put round trips do not dispose and do not grow', () => {
  const disposed = [];
  const pool = new SparePool(() => disposed.push(1), 4);
  const views = [{ id: 1 }, { id: 2 }, { id: 3 }];
  for (let round = 0; round < 1000; round++) {
    for (const v of views) pool.put('a', v);
    for (let i = 0; i < 3; i++) assert.ok(pool.take('a'));
  }
  assert.equal(disposed.length, 0);
  assert.equal(pool.size, 0);
  assert.equal(pool.byKey.size, 0);
});

test('SparePool.clear disposes everything', () => {
  const disposed = [];
  const pool = new SparePool((v) => disposed.push(v), 10);
  pool.put('a', { id: 1 }); pool.put('b', { id: 2 });
  pool.clear();
  assert.equal(disposed.length, 2);
  assert.equal(pool.size, 0);
  assert.equal(pool.take('a'), null);
});

test('disposeView frees the skeleton and the outline material, and detaches the outline', () => {
  const calls = [];
  const view = {
    object: { skeleton: { dispose: () => calls.push('skeleton') } },
    outline: { removeFromParent: () => calls.push('detach'), material: { dispose: () => calls.push('material') } },
  };
  disposeView(view);
  assert.deepEqual(calls.sort(), ['detach', 'material', 'skeleton']);
  assert.equal(view.outline, null);
  disposeView({ object: {} }); // no skeleton, no outline: fine
});
