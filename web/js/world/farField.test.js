import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farOffsets, FarPlanner, farChunk, farRadiusOf, sectorOf, FAR_INFLIGHT } from './farField.js';
import { inRing } from './streamer.js';
import { HABITAT, REGION } from './constants.js';

test('the far ring is the annulus between the streaming ring and the far radius, nearest first', () => {
  const list = farOffsets(7, 12);
  assert.ok(list.length > 200);
  for (const o of list) {
    assert.ok(inRing(o.dx, o.dz, 12));
    assert.ok(!inRing(o.dx, o.dz, 7));
  }
  for (let i = 1; i < list.length; i++) assert.ok(list[i].d >= list[i - 1].d);
  assert.ok(farRadiusOf('high') > farRadiusOf('medium') && farRadiusOf('medium') > farRadiusOf('low'));
  assert.equal(sectorOf(-1), -1);
  assert.equal(sectorOf(3), 0);
});

test('the planner asks for a few missing chunks at a time and forgets far ones', () => {
  const p = new FarPlanner();
  const req = p.plan(0, 0, 7, 12, 0);
  assert.equal(req.length, FAR_INFLIGHT);
  assert.equal(p.plan(0, 0, 7, 12, 1).length, 0); // all slots taken
  for (const r of req) assert.ok(p.wants(r.cx, r.cz));
  p.accept({ cx: req[0].cx, cz: req[0].cz });
  assert.equal(p.plan(0, 0, 7, 12, 2).length, 1);
  assert.equal(p.plan(0, 0, 7, 12, 20).length, FAR_INFLIGHT); // timed out requests go again
  const gone = p.evict(100, 100, 12);
  assert.equal(gone.length, 1);
  assert.equal(p.have.size, 0);
});

test('woods become a raised canopy blanket in crown colours; open ground stays', () => {
  const n = 2;
  const chunk = {
    cx: 0, cz: 0, lod: 2, n, cell: 8,
    heights: Float32Array.of(5, 5, 5, -2),
    normals: new Int8Array(12),
    colors: Uint8Array.of(100, 150, 80, 100, 150, 80, 100, 150, 80, 100, 150, 80),
    region: Uint8Array.of(REGION.AMBERWOOD, REGION.GREENHOLLOW, REGION.GREENHOLLOW, REGION.GREENHOLLOW),
    habitat: Uint8Array.of(HABITAT.WOODLAND, HABITAT.CONIFER, HABITAT.MEADOW, HABITAT.WOODLAND),
  };
  const f = farChunk(chunk);
  assert.ok(f.heights[0] > 10 && f.heights[1] > 10);   // crowns raised
  assert.equal(f.heights[2], 5);                         // meadow untouched
  assert.equal(f.heights[3], -2);                        // nothing grows under water
  assert.ok(f.colors[0] > f.colors[1]);                  // amber crowns are warm
  assert.ok(f.blanket[0] > 0.5 && f.blanket[2] === 0);
  assert.equal(chunk.heights[0], 5);                     // the source is not touched
  assert.equal(f.veg.count, 0);
});
