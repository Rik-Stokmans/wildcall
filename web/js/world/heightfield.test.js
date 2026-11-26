import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChunk, encodeChunk } from './chunkCodec.js';
import { ChunkStore, chunkKey, keyCx, keyCz, chunkCoord, surfaceFor } from './heightfield.js';
import { REGION, HABITAT } from './constants.js';

// A planar height field h = 0.5x − 0.25z + 3 is reproduced exactly by bilinear
// interpolation, so every query has a closed-form expected value.
const plane = (x, z) => 0.5 * x - 0.25 * z + 3;

function chunk(cx, cz, lod, extra = {}) {
  return parseChunk(encodeChunk({
    cx, cz, lod,
    sample: (ix, iz, x, z) => ({ h: plane(x, z), region: extra.region ?? 0, habitat: extra.habitat ?? HABITAT.MEADOW }),
    veg: [],
  }));
}

test('chunk keys round-trip signed coordinates', () => {
  for (const [cx, cz] of [[0, 0], [-1, -1], [-300000, 12], [7, -1000000]]) {
    const k = chunkKey(cx, cz);
    assert.equal(keyCx(k), cx);
    assert.equal(keyCz(k), cz);
  }
  assert.notEqual(chunkKey(1, 0), chunkKey(0, 1));
});

test('chunkCoord floors negative coordinates', () => {
  assert.equal(chunkCoord(-0.01), -1);
  assert.equal(chunkCoord(-64), -1);
  assert.equal(chunkCoord(-64.01), -2);
  assert.equal(chunkCoord(63.99), 0);
});

test('heightAt is bilinear inside and across chunk borders, incl. negative coordinates', () => {
  const s = new ChunkStore();
  s.set(chunk(-1, -1, 0));
  s.set(chunk(0, -1, 0));
  s.set(chunk(-1, 0, 1));
  s.set(chunk(0, 0, 2));
  for (const [x, z] of [[-0.3, -0.7], [-63.9, -1], [-32.25, -17.5], [0, 0], [-1e-9, 5], [10.3, 20.7], [-5, 63.99], [63.99, -63.99]]) {
    assert.ok(Math.abs(s.heightAt(x, z) - plane(x, z)) < 1e-4, `at ${x},${z}: ${s.heightAt(x, z)} vs ${plane(x, z)}`);
  }
  // Exactly on a border both neighbours agree (the contract's edge consistency).
  assert.ok(Math.abs(s.heightAt(0, -10) - plane(0, -10)) < 1e-4);
  assert.ok(Math.abs(s.heightAt(-0.0001, -10) - plane(-0.0001, -10)) < 1e-3);
});

test('heightAt falls back to 0 and isLoaded is false where nothing is loaded', () => {
  const s = new ChunkStore();
  s.set(chunk(-1, 0, 0));
  assert.equal(s.isLoaded(-10, 10), true);
  assert.equal(s.isLoaded(10, 10), false);
  assert.equal(s.heightAt(10, 10), 0);
  assert.ok(Number.isNaN(s.sampleHeight(10, 10)));
  // −0.5 lies in chunk −1, which a truncating lookup would miss.
  assert.equal(s.isLoaded(-0.5, 3), true);
});

test('waterDepthAt is max(0, −height)', () => {
  const s = new ChunkStore();
  s.set(parseChunk(encodeChunk({ cx: -3, cz: 2, lod: 0, sample: () => ({ h: -1.5 }) })));
  assert.equal(s.waterDepthAt(-150, 150), 1.5);
  assert.equal(s.waterDepthAt(150, 150), 0);
});

test('regionAt / habitatAt use the nearest vertex and the not-loaded defaults', () => {
  const s = new ChunkStore();
  s.set(parseChunk(encodeChunk({
    cx: -1, cz: -1, lod: 0,
    sample: (ix) => ({ h: 1, region: ix < 16 ? REGION.MURMUR_MARSH : REGION.NONE, habitat: ix < 16 ? HABITAT.MARSH : HABITAT.OCEAN }),
  })));
  assert.equal(s.regionAt(-60, -10), REGION.MURMUR_MARSH);
  assert.equal(s.habitatAt(-60, -10), HABITAT.MARSH);
  assert.equal(s.regionAt(-2, -10), REGION.NONE);
  assert.equal(s.habitatAt(-2, -10), HABITAT.OCEAN);
  assert.equal(s.regionAt(5, 5), 255);
  assert.equal(s.habitatAt(5, 5), 0);
});

test('surfaceFor follows habitat, height and region', () => {
  assert.equal(surfaceFor(HABITAT.MEADOW, -0.5, 0), 'water');
  assert.equal(surfaceFor(HABITAT.MEADOW, 4, REGION.FROSTVEIL), 'snow');
  assert.equal(surfaceFor(HABITAT.SNOW, 4, REGION.WINDPEAK), 'snow');
  assert.equal(surfaceFor(HABITAT.BEACH, 0.5, REGION.WHISPERING_COAST), 'sand');
  assert.equal(surfaceFor(HABITAT.ALPINE, 80, REGION.WINDPEAK), 'rock');
  assert.equal(surfaceFor(HABITAT.CLIFF, 30, REGION.WHISPERING_COAST), 'rock');
  assert.equal(surfaceFor(HABITAT.MARSH, 0.2, REGION.MURMUR_MARSH), 'mud');
  assert.equal(surfaceFor(HABITAT.WOODLAND, 9, 0), 'leaf');
  assert.equal(surfaceFor(HABITAT.CONIFER, 9, 0), 'leaf');
  assert.equal(surfaceFor(HABITAT.MEADOW, 9, 0), 'grass');
  // Frostveil's frozen lakes are flat ice at 0.3 m: snow underfoot, not water.
  assert.equal(surfaceFor(HABITAT.RIVER, 0.3, REGION.FROSTVEIL), 'snow');
});

test('raycast hits the ground and refines the crossing', () => {
  const s = new ChunkStore();
  s.set(parseChunk(encodeChunk({ cx: -1, cz: -1, lod: 0, sample: () => ({ h: 2 }) })));
  const out = { x: 0, y: 0, z: 0 };
  assert.equal(s.raycast(-10, 12, -10, -1, -1, 0, 100, out), true);
  assert.ok(Math.abs(out.y - 2) < 1e-6);
  assert.ok(Math.abs(out.x - -20) < 0.01);
  assert.equal(out.z, -10);
  // Looking up, or over unloaded ground, finds nothing.
  assert.equal(s.raycast(-10, 12, -10, 0, 1, 0, 100, out), false);
  assert.equal(s.raycast(10, 12, 10, 0, -1, 0, 100, out), false);
  // Too short to reach.
  assert.equal(s.raycast(-10, 12, -10, 0, -1, 0, 5, out), false);
});
