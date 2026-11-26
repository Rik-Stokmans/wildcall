import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Streamer, lodForRing, wantedLod, settledLod, shouldUnload, ringOffsets, inRing } from './streamer.js';
import { QUALITY, qualityOf } from './constants.js';

const plan = () => ({ requests: [], downgrades: [], unloads: [] });

test('LOD rings: lod 0 within 2 chunks, lod 1 to 4, lod 2 beyond', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(lodForRing), [0, 0, 0, 1, 1, 2, 2]);
  assert.equal(wantedLod(-2, 2, 7), 0);
  assert.equal(wantedLod(3, -1, 7), 1);
  assert.equal(wantedLod(0, -6, 7), 2);
  assert.equal(wantedLod(7, 7, 7), -1); // corners of the square are outside the disc
});

test('quality presets match the contract ring radii', () => {
  assert.equal(QUALITY.low.radius, 5);
  assert.equal(QUALITY.medium.radius, 7);
  assert.equal(QUALITY.high.radius, 10);
  assert.equal(qualityOf('nonsense'), QUALITY.medium);
});

test('ring offsets are sorted near to far and stay inside the disc', () => {
  const r = ringOffsets(7);
  assert.deepEqual([r.dx[0], r.dz[0]], [0, 0]);
  for (let i = 1; i < r.count; i++) {
    assert.ok(r.dist[i] >= r.dist[i - 1]);
    assert.ok(inRing(r.dx[i], r.dz[i], 7));
  }
});

test('requests go out nearest first, capped by the in-flight budget, around negative chunks', () => {
  const s = new Streamer({ radius: 7, inflight: 6 });
  const p = s.plan(-100, -100, 0, 0, 0, 0, plan());
  assert.equal(p.requests.length, 6);
  assert.deepEqual(p.requests[0], { cx: -2, cz: -2, lod: 0 }); // the player's own chunk
  for (const r of p.requests) assert.equal(r.lod, 0);
  // Nothing more until those are answered.
  assert.equal(s.plan(-100, -100, 0, 0, 0.1, 0, plan()).requests.length, 0);
  // Arrived-but-unbuilt chunks count against the budget too.
  for (const r of p.requests) s.receive(r.cx, r.cz, r.lod);
  assert.equal(s.plan(-100, -100, 0, 0, 0.2, 6, plan()).requests.length, 0);
  assert.equal(s.plan(-100, -100, 0, 0, 0.3, 2, plan()).requests.length, 4);
});

test('loading is biased towards the direction of travel', () => {
  const s = new Streamer({ radius: 7, inflight: 40 });
  // Fill the first two rings so only further chunks remain.
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) s.receive(dx, dz, 0);
  const p = s.plan(32, 32, 6, 0, 0, 0, plan()); // running east
  const east = p.requests.filter((r) => r.cx > 0).length;
  const west = p.requests.filter((r) => r.cx < 0).length;
  assert.ok(east > west, `east ${east} west ${west}`);
});

test('a stationary player eventually gets the whole ring at the right LODs', () => {
  const s = new Streamer({ radius: 5, inflight: 8 });
  for (let t = 0; t < 200; t++) {
    const p = s.plan(10, -10, 0, 0, t, 0, plan());
    for (const r of p.requests) s.receive(r.cx, r.cz, r.lod);
  }
  const ring = ringOffsets(5);
  assert.equal(s.have.size, ring.count);
  for (let i = 0; i < ring.count; i++) {
    assert.equal(s.lodOf(ring.dx[i], -1 + ring.dz[i]), lodForRing(Math.max(Math.abs(ring.dx[i]), Math.abs(ring.dz[i]))));
  }
});

test('unloading and coarsening lag one chunk behind (hysteresis)', () => {
  assert.equal(shouldUnload(7, 0, 7), false);
  assert.equal(shouldUnload(8, 0, 7), false);
  assert.equal(shouldUnload(9, 0, 7), true);
  assert.equal(settledLod(3, 0, 0), 0);  // one chunk past the lod-0 ring: kept
  assert.equal(settledLod(4, 0, 0), 1);  // two past: coarsened
  assert.equal(settledLod(6, 0, 1), 2);
  assert.equal(settledLod(1, 0, 2), 2);  // never refined here: refining needs the server

  const s = new Streamer({ radius: 7, inflight: 6 });
  s.receive(8, 0, 2); // at the very edge of the hysteresis band
  s.pcx = 0;
  // Pacing back and forth across one border does not drop it...
  for (const x of [60, 70, 60, 70]) assert.equal(s.plan(x, 10, 0, 0, 0, 6, plan()).unloads.length, 0);
  // ...walking away does.
  const p = s.plan(-70, 10, 0, 0, 1, 6, plan());
  assert.deepEqual(p.unloads, [{ cx: 8, cz: 0 }]);
  assert.equal(s.lodOf(8, 0), -1);
});

test('downgrades are planned locally as the player walks away', () => {
  const s = new Streamer({ radius: 7, inflight: 6 });
  s.receive(0, 0, 0);
  const p = s.plan(64 * 4 + 10, 10, 0, 0, 0, 6, plan());
  assert.deepEqual(p.downgrades, [{ cx: 0, cz: 0, lod: 1 }]);
  assert.equal(s.lodOf(0, 0), 1);
});

test('receive drops stale chunks and coarsens late arrivals', () => {
  const s = new Streamer({ radius: 7, inflight: 6 });
  s.plan(0, 0, 0, 0, 0, 0, plan());
  assert.equal(s.receive(0, 0, 0), 0);
  assert.equal(s.receive(0, 0, 1), -1);  // coarser than what is held
  assert.equal(s.receive(40, 0, 2), -1); // far outside the ring
  s.pcx = 0; s.pcz = 0;
  assert.equal(s.receive(5, 0, 0), 2);   // requested at lod 0, but the player moved: lod 2
});

test('timed-out requests are retried and failures back off', () => {
  const s = new Streamer({ radius: 3, inflight: 1, timeout: 5 });
  assert.equal(s.plan(0, 0, 0, 0, 0, 0, plan()).requests.length, 1);
  assert.equal(s.plan(0, 0, 0, 0, 4, 0, plan()).requests.length, 0);
  assert.deepEqual(s.plan(0, 0, 0, 0, 6, 0, plan()).requests[0], { cx: 0, cz: 0, lod: 0 });
  s.fail(0, 0, 6, -1, 10);
  const next = s.plan(0, 0, 0, 0, 7, 0, plan()).requests;
  assert.equal(next.length, 0); // the failed chunk is blocking the only slot, as designed
  const later = s.plan(0, 0, 0, 0, 17, 0, plan()).requests;
  assert.deepEqual(later[0], { cx: 0, cz: 0, lod: 0 });
});
