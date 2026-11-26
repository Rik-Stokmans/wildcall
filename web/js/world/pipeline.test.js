import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldPipeline } from './pipeline.js';
import { encodeChunk } from './chunkCodec.js';
import { chunkKey } from './heightfield.js';

// A fake server that answers chunkReq with synthetic frames, and a fake mesher that
// records what is drawn. Together they run the full streaming flow in node.
function rig({ radius = 4, inflight = 6, steps = 2 } = {}) {
  const sent = [];
  const drawn = new Map();
  const events = { chunks: [], errors: [], begun: 0, cancelled: 0, removed: 0 };
  const mesher = {
    begin(chunk) {
      events.begun++;
      let left = steps;
      return {
        step: () => --left <= 0,
        commit: () => drawn.set(chunkKey(chunk.cx, chunk.cz), chunk.lod),
        cancel: () => { events.cancelled++; },
      };
    },
    remove(cx, cz) { if (drawn.delete(chunkKey(cx, cz))) events.removed++; },
    clear() { drawn.clear(); },
  };
  const p = new WorldPipeline({
    request: (cx, cz, lod) => sent.push({ cx, cz, lod }),
    mesher,
    onChunk: (cx, cz, lod) => events.chunks.push({ cx, cz, lod }),
    onError: (e) => events.errors.push(e),
    quality: { radius, inflight },
  });
  const serve = () => {
    for (const r of sent.splice(0)) {
      p.receive(encodeChunk({
        cx: r.cx, cz: r.cz, lod: r.lod,
        sample: (ix, iz, x, z) => ({ h: 1 + x * 0.01, region: 0, habitat: 3 }),
        veg: [{ kind: 0, x: r.cx * 64 + 20, y: 1, z: r.cz * 64 + 20, scale: 1 }],
      }));
    }
  };
  let t = 0;
  const frame = (x, z, vx = 0, vz = 0) => {
    t += 0.1;
    p.tick(x, z, vx, vz, t);
    serve();
    p.work(1e9, (() => { let n = 0; return () => (n++ < 6 ? 0 : 1e10); })()); // ≈6 steps a frame
  };
  return { p, sent, drawn, events, frame };
}

test('streams the 3×3 around a negative spawn at lod 0 and reports ready', () => {
  const { p, drawn, events, frame } = rig();
  p.watchReady(-100, -300);
  assert.equal(p.readyNow(), false);
  let frames = 0;
  while (!p.readyNow() && frames < 200) { frame(-100, -300); frames++; }
  assert.ok(p.readyNow(), 'never became ready');
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) assert.equal(drawn.get(chunkKey(-2 + dx, -5 + dz)), 0);
  assert.equal(events.errors.length, 0);
  // Height data is live for queries, with floor semantics on negatives.
  assert.ok(Math.abs(p.store.heightAt(-100, -300) - (1 - 1)) < 1e-5);
  assert.equal(p.collision.collide({ x: -2 * 64 + 20.1, z: -5 * 64 + 20 }, 0.3), true);
  assert.ok(events.chunks.length >= 9);
});

test('walking kilometres keeps memory flat and everything drawn is in range', () => {
  const { p, drawn, events, frame } = rig({ radius: 4 });
  let maxStore = 0, maxDrawn = 0;
  for (let i = 0; i < 1500; i++) {
    const x = -i * 3; // 4.5 km west
    frame(x, 50, -30, 0);
    maxStore = Math.max(maxStore, p.store.size);
    maxDrawn = Math.max(maxDrawn, drawn.size);
  }
  // A disc of radius 4 is 49 chunks; the hysteresis band adds a ring.
  assert.ok(maxStore <= 81, `store grew to ${maxStore}`);
  assert.ok(maxDrawn <= 81, `drawn grew to ${maxDrawn}`);
  assert.ok(events.removed > 100);
  const pcx = Math.floor(-1499 * 3 / 64);
  for (const key of drawn.keys()) {
    const cx = Math.floor(key / 0x4000000) - 0x2000000;
    assert.ok(Math.abs(cx - pcx) <= 6, `stale chunk ${cx} drawn near ${pcx}`);
  }
  assert.equal(events.errors.length, 0);
});

test('walking away coarsens drawn chunks without asking the server', () => {
  const { p, drawn, sent, frame } = rig({ radius: 6 });
  p.watchReady(10, 10);
  for (let i = 0; i < 300 && !p.readyNow(); i++) frame(10, 10);
  assert.equal(drawn.get(chunkKey(0, 0)), 0);
  for (let i = 0; i < 40; i++) frame(64 * 4 + 10, 10);
  assert.equal(drawn.get(chunkKey(0, 0)), 1);
  assert.equal(p.store.get(0, 0).lod, 1);
  assert.equal(sent.filter((r) => r.cx === 0 && r.cz === 0).length, 0);
});

test('a broken frame is reported, never thrown, and does not block streaming', () => {
  const { p, events, frame } = rig();
  p.receive(new ArrayBuffer(4));
  const bad = encodeChunk({ cx: 0, cz: 0, lod: 0, sample: () => ({ h: 0 }) });
  new DataView(bad).setUint32(bad.byteLength - 4, 999999, true); // corrupt vegCount (no veg follows)
  p.tick(0, 0, 0, 0, 0); // request (0,0) so the bad frame is accepted
  p.receive(bad);
  p.work(1e9, (() => { let n = 0; return () => (n++ < 4 ? 0 : 1e10); })());
  assert.equal(events.errors.length, 2);
  for (let i = 0; i < 50; i++) frame(100, 100);
  assert.ok(p.meshed.size > 0);
});

test('reset forgets the old world', () => {
  const { p, drawn, frame } = rig();
  for (let i = 0; i < 30; i++) frame(0, 0);
  assert.ok(drawn.size > 0);
  p.reset();
  assert.equal(drawn.size, 0);
  assert.equal(p.store.size, 0);
  assert.equal(p.readyNow(), false);
});

test('rebuildAll re-meshes every held chunk from its data', () => {
  const { p, events, frame } = rig();
  for (let i = 0; i < 60; i++) frame(0, 0);
  const before = events.begun;
  const held = p.store.size;
  p.rebuildAll();
  assert.equal(p.backlog, held);
  for (let i = 0; i < 200 && p.backlog; i++) p.work(1e9, (() => { let n = 0; return () => (n++ < 6 ? 0 : 1e10); })());
  assert.ok(events.begun - before >= held);
});
