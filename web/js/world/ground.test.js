// Tests of the ground-cover field (groundField.js), the forage-kind plumbing and vegOf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groundCover, vegetatedness, groundOrigin, allocGroundPlanes, fillGroundRows, createCanopyCache,
  latticeHash, latticeLevel, ringLayout, ringHole, ringPatches, drawingRing, levelFade, ringReach,
  GROUND_RES, GROUND_TEXEL, GROUND_SNAP, NO_GROUND, FADE_END,
} from './groundField.js';
import { parseChunk, encodeChunk, decimateChunk, vegList } from './chunkCodec.js';
import { ChunkStore } from './heightfield.js';
import { Collision, solidRadius, crownRadius } from './collision.js';
import { countInstances, keepInstance } from './instances.js';
import {
  HABITAT, REGION, VEG, VEG_KIND_COUNT, FIRST_FORAGE_KIND, WIRE_VEG_KIND_COUNT, GROUND_QUALITY,
  isForageKind, vegInfo, vegVisibleAtLod,
} from './constants.js';
import { tuftGeometry, flowerGeometry, fernGeometry } from './groundModels.js';

const MEADOW_RGB = [138, 176, 76];
const WOOD_RGB = [92, 138, 60];
const EARTH_RGB = [156, 122, 84];
const SAND_RGB = [228, 210, 160];
const SNOW_RGB = [238, 242, 248];
const ROCK_RGB = [132, 124, 112];

const cover = (hab, rgb, { region = REGION.GREENHOLLOW, ny = 1, h = 5, canopy = 0 } = {}) =>
  groundCover(hab, region, rgb[0], rgb[1], rgb[2], ny, h, canopy, [0, 0, 0, 0]);

test('ground cover: long, flowery meadows; shorter, sparser grass and ferns under trees', () => {
  const meadow = cover(HABITAT.MEADOW, MEADOW_RGB);
  const wood = cover(HABITAT.WOODLAND, WOOD_RGB, { canopy: 0.9 });
  assert.ok(meadow[0] > 220, 'meadow grass is dense');
  assert.ok(meadow[1] > 200, 'meadow grass is long');
  assert.ok(meadow[2] > 200, 'meadows carry flowers');
  assert.ok(wood[0] < meadow[0] * 0.5, 'shade thins the grass');
  assert.ok(wood[1] < meadow[1] * 0.5, 'shade shortens the grass');
  assert.ok(wood[3] > 100, 'ferns grow in shaded woodland');
  assert.ok(wood[2] < meadow[2] * 0.2, 'few flowers in deep shade');
  const fernHollow = cover(HABITAT.SHRUB, [66, 112, 64], { canopy: 0.4, h: 1.2 });
  assert.ok(fernHollow[3] > 200, 'the fern valley floor is full of ferns');
});

test('ground cover: nothing on trails, rock, sand, snow, cliffs, steep ground or under water', () => {
  const bare = (c) => [c[0], c[2]];                                                // density, flowers
  assert.deepEqual(bare(cover(HABITAT.MEADOW, EARTH_RGB)), [0, 0]);                // trodden trail
  assert.deepEqual(bare(cover(HABITAT.ALPINE, ROCK_RGB)), [0, 0]);                 // bare rock
  assert.deepEqual(bare(cover(HABITAT.BEACH, SAND_RGB)), [0, 0]);                  // sand
  // Snowfields: only sparse hoar-frosted tufts poking through (gathered into clumps by
  // the shader), no flowers, no ferns.
  const snow = cover(HABITAT.SNOW, SNOW_RGB, { region: REGION.FROSTVEIL });
  assert.ok(snow[0] <= 80 && snow[2] === 0 && snow[3] === 0);
  assert.equal(cover(HABITAT.CLIFF, ROCK_RGB)[0], 0);
  assert.equal(cover(HABITAT.MEADOW, MEADOW_RGB, { ny: 0.6 })[0], 0);              // a steep bank
  const wet = cover(HABITAT.RIVER, MEADOW_RGB, { h: -0.4 });                      // under water
  assert.deepEqual([wet[0], wet[2], wet[3]], [0, 0, 0]);
  assert.deepEqual(cover(HABITAT.MEADOW, MEADOW_RGB, { region: REGION.NONE }), [0, 0, 0, 0]);
  // A trail's edge, where the server blended earth into grass, is sparse but not bare.
  const edge = [0, 1, 2].map((i) => Math.round((EARTH_RGB[i] + MEADOW_RGB[i]) / 2));
  const e = cover(HABITAT.MEADOW, edge)[0];
  assert.ok(e > 0 && e <= cover(HABITAT.MEADOW, MEADOW_RGB)[0]);
});

test('vegetatedness tells Amberwood leaf litter from its trails', () => {
  assert.ok(vegetatedness(186, 118, 56, REGION.AMBERWOOD) > 0.8);   // amber litter
  assert.ok(vegetatedness(206, 164, 80, REGION.AMBERWOOD) > 0.8);   // golden clearing
  assert.ok(vegetatedness(156, 122, 84, REGION.AMBERWOOD) < 0.1);   // trodden earth
  assert.ok(vegetatedness(186, 118, 56, REGION.GREENHOLLOW) < 0.1); // not green anywhere else
});

test('ground cover is a pure function (same input, same bytes)', () => {
  const a = cover(HABITAT.WOODLAND, WOOD_RGB, { canopy: 0.37, h: 2.2, ny: 0.93 });
  const b = cover(HABITAT.WOODLAND, WOOD_RGB, { canopy: 0.37, h: 2.2, ny: 0.93 });
  assert.deepEqual(a, b);
});

function storeWith(chunks) {
  const s = new ChunkStore();
  for (const c of chunks) s.set(c);
  return s;
}

test('ground window: texel centres are lod-0 vertices; unloaded ground is marked', () => {
  const [ox, oz] = groundOrigin(-100, 37);
  assert.equal(Math.abs(ox % GROUND_TEXEL), 0);
  assert.equal(Math.abs(oz % GROUND_TEXEL), 0);
  assert.deepEqual(groundOrigin(-100, 37), groundOrigin(-100 + GROUND_SNAP / 2 - 1, 37)); // stable while walking
  const chunk = parseChunk(encodeChunk({
    cx: Math.floor(ox / 64), cz: Math.floor(oz / 64), lod: 0,
    sample: (ix, iz) => ({ h: 3 + ix * 0.1 + iz, color: MEADOW_RGB, habitat: HABITAT.MEADOW, region: REGION.GREENHOLLOW }),
  }));
  const store = storeWith([chunk]);
  const planes = allocGroundPlanes();
  fillGroundRows(store, createCanopyCache(() => 0.25), ox, oz, planes, 0, GROUND_RES);
  const ix = (ox - chunk.cx * 64) / 2, iz = (oz - chunk.cz * 64) / 2;
  assert.equal(planes.height[0], chunk.heights[iz * 33 + ix]);
  assert.deepEqual([...planes.color.slice(0, 4)], [...MEADOW_RGB, REGION.GREENHOLLOW]);
  assert.ok(planes.cover[0] > 100);
  assert.equal(planes.aux[2], Math.round(0.25 * 255));
  assert.equal(planes.aux[3], HABITAT.MEADOW);
  // The far corner is in a chunk that is not loaded.
  const last = GROUND_RES * GROUND_RES - 1;
  assert.equal(planes.height[last], NO_GROUND);
  assert.equal(planes.cover[last * 4], 0);
});

test('canopy cache computes each chunk once', () => {
  let calls = 0;
  const cache = createCanopyCache(() => { calls++; return 0.5; });
  const chunk = parseChunk(encodeChunk({ cx: 0, cz: 0, lod: 0, sample: () => ({ h: 1 }) }));
  assert.equal(cache.at(chunk, 3, 4), 0.5);
  assert.equal(cache.at(chunk, 30, 1), 0.5);
  assert.equal(calls, 33 * 33);
});

test('lattice hash and level are deterministic and well spread', () => {
  assert.equal(latticeHash(12, -7), latticeHash(12, -7));
  assert.notEqual(latticeHash(12, -7), latticeHash(-7, 12));
  const seen = new Set();
  for (let i = -50; i < 50; i++) seen.add(latticeHash(i, 3) >>> 24);
  assert.ok(seen.size > 60, 'top bytes vary');
  assert.equal(latticeLevel(0, 0, 4), 4);
  assert.equal(latticeLevel(8, -24, 4), 3);
  assert.equal(latticeLevel(6, 4, 4), 1);
  assert.equal(latticeLevel(-3, 4, 4), 0);
});

test('rings: every plant is drawn by exactly one ring, or has faded out', () => {
  for (const q of Object.values(GROUND_QUALITY)) {
    for (const cfg of Object.values(q)) {
      const max = cfg.rings - 1;
      for (const [cx, cz] of [[0.3, -0.2], [1234.56, -987.1], [-40000.2, 31000.7]]) {
        const layout = ringLayout(cfg, cx, cz);
        const outer = ringReach(cfg, max);
        const step = 1 << max;
        const bi0 = Math.round(cx / cfg.base), bj0 = Math.round(cz / cfg.base);
        const span = Math.ceil(outer / cfg.base);
        // Sample the base lattice: every point on a coarse stride plus a dense patch near the eye.
        const pts = [];
        for (let j = -span; j <= span; j += Math.max(1, step >> 1)) for (let i = -span; i <= span; i += Math.max(1, step >> 1)) pts.push([bi0 + i, bj0 + j]);
        for (let j = -12; j <= 12; j++) for (let i = -12; i <= 12; i++) pts.push([bi0 + i, bj0 + j]);
        for (const [bi, bj] of pts) {
          const level = latticeLevel(bi, bj, max);
          const ring = drawingRing(layout, bi, bj);
          const d = Math.hypot(bi * cfg.base - cx, bj * cfg.base - cz);
          if (ring < 0) {
            assert.equal(levelFade(cfg, level, d), 0, `undrawn plant at ${bi},${bj} (level ${level}, ${d.toFixed(1)} m) must be invisible`);
          } else {
            assert.ok(ring <= level, 'a ring only holds plants of its level or coarser');
          }
        }
      }
    }
  }
});

test('rings: the shader hole test matches drawingRing, and patches inside the hole are skipped', () => {
  const cfg = GROUND_QUALITY.high.grass;
  const layout = ringLayout(cfg, 17.3, -5.9);
  for (let k = 1; k < cfg.rings; k++) {
    const hole = ringHole(layout, k);
    const r = layout[k], m = 1 << k;
    // A point of ring k inside the hole belongs to a finer ring; outside it, to ring k.
    for (let j = r.j0; j < r.j0 + r.n; j += 3) {
      for (let i = r.i0; i < r.i0 + r.n; i += 3) {
        const bi = i * m, bj = j * m;
        const inHole = bi >= hole[0] && bj >= hole[1] && bi < hole[2] && bj < hole[3];
        const ring = drawingRing(layout, bi, bj);
        assert.equal(inHole, ring < k);
        if (!inHole) assert.equal(ring, k);
      }
    }
    const patches = ringPatches(cfg, layout, k);
    assert.equal(patches.length, cfg.g * cfg.g);
    const p = cfg.n / cfg.g;
    for (const pa of patches) {
      if (!pa.inside) continue;
      for (const [i, j] of [[pa.i, pa.j], [pa.i + p - 1, pa.j + p - 1]]) assert.ok(drawingRing(layout, i * m, j * m) < k);
    }
  }
});

test('rings snap to their lattice: a small step of the camera never moves a plant', () => {
  const cfg = GROUND_QUALITY.medium.grass;
  const a = ringLayout(cfg, 100, 100).map((r) => ({ ...r }));
  const b = ringLayout(cfg, 100 + cfg.base * 0.3, 100 - cfg.base * 0.3).map((r) => ({ ...r }));
  for (let k = 0; k < cfg.rings; k++) {
    // Ring squares are lattice-aligned, so the same lattice point means the same plant.
    assert.ok(Number.isInteger(a[k].i0) && Number.isInteger(b[k].i0));
    assert.ok(Math.abs(a[k].i0 - b[k].i0) <= 1);
  }
  // Reuse: the output arrays are recycled.
  const out = [];
  assert.equal(ringLayout(cfg, 0, 0, out), out);
  assert.equal(ringLayout(cfg, 5, 5, out)[0], out[0]);
});

test('level fade: denser levels fade nearer, the coarsest reaches farthest', () => {
  const cfg = GROUND_QUALITY.high.grass;
  assert.equal(levelFade(cfg, 0, 0.5), 1);
  assert.equal(levelFade(cfg, 0, ringReach(cfg, 0) * FADE_END), 0);
  assert.ok(levelFade(cfg, cfg.rings - 1, 60) > 0.5);
  for (const q of ['low', 'medium', 'high']) {
    const g = GROUND_QUALITY[q].grass;
    assert.equal(g.n % g.g, 0);
    assert.ok(g.n / g.g <= 256, 'patch cells fit in a byte');
  }
  assert.ok(ringReach(GROUND_QUALITY.high.grass, 4) > ringReach(GROUND_QUALITY.low.grass, 2));
});

test('base geometry: indices in range, blades taper to a tip', () => {
  for (const g of [tuftGeometry(3, 3), tuftGeometry(5, 1), flowerGeometry(), fernGeometry(5), fernGeometry(3)]) {
    const n = g.position.length / 3;
    for (const i of g.index) assert.ok(i < n);
    assert.equal(g.index.length % 3, 0);
  }
  const t = tuftGeometry(1, 3);
  assert.deepEqual([...t.position.slice(-3)], [0, 1, 0]); // the tip
});

// --- forage kinds and vegOf ----------------------------------------------------------

const forageFrame = () => encodeChunk({
  cx: -1, cz: 2, lod: 0, sample: () => ({ h: 2 }),
  veg: [
    { kind: VEG.OAK, variant: 4, x: -60, y: 2, z: 130, scale: 1.2, rot: 1 },
    { kind: 18, variant: 1, x: -50, y: 2, z: 140, scale: 1 },        // bramble
    { kind: VEG.GRASS_TUFT, x: -40, y: 2, z: 150 },
    { kind: 24, variant: 9, x: -30, y: 2, z: 160, scale: 1.1 },      // sweet chestnut
    { kind: 35, x: -20, y: 2, z: 170 },                               // wild thyme
    { kind: 36, x: -10, y: 2, z: 180 },                               // unknown: skipped
  ],
});

test('forage kinds are parsed and kept in wire order, unknown kinds skipped', () => {
  const c = parseChunk(forageFrame());
  assert.deepEqual([...c.veg.kind], [VEG.OAK, 18, VEG.GRASS_TUFT, 24, 35]);
  assert.equal(FIRST_FORAGE_KIND, 18);
  assert.equal(WIRE_VEG_KIND_COUNT, 36);
  assert.ok(isForageKind(18) && isForageKind(35) && !isForageKind(17) && !isForageKind(36));
  // Forage plants survive into lod 1 (contract §12), not into lod 2 (except the chestnut tree).
  assert.deepEqual([...decimateChunk(c, 1).veg.kind], [VEG.OAK, 18, 24, 35]);
  assert.deepEqual([...decimateChunk(c, 2).veg.kind], [VEG.OAK, 24]);
  assert.ok(vegVisibleAtLod(30, 1) && !vegVisibleAtLod(30, 2));
});

test('the world never draws forage kinds', () => {
  const c = parseChunk(forageFrame());
  for (const density of [1, 0.5]) {
    const counts = countInstances(c.veg, density, new Uint32Array(VEG_KIND_COUNT));
    assert.equal(counts.reduce((a, b) => a + b, 0), density === 1 ? 2 : counts[VEG.OAK] + counts[VEG.GRASS_TUFT]);
    for (let k = FIRST_FORAGE_KIND; k < WIRE_VEG_KIND_COUNT; k++) assert.equal(keepInstance(k, 3, 1, 1, density), false);
  }
});

test('the sweet chestnut is a solid tree with a crown; other forage plants are walk-through', () => {
  assert.ok(solidRadius(24, 1) > 0.3);
  assert.ok(crownRadius(24, 1) > 3);
  assert.equal(solidRadius(18, 1), 0);
  assert.equal(crownRadius(29, 1), 0);
  assert.equal(vegInfo(24).name, 'sweet_chestnut');
  const col = new Collision();
  col.setChunk(-1, 2, parseChunk(forageFrame()).veg);
  const p = { x: -30.1, z: 160 };
  assert.ok(col.collide(p, 0.3));
  assert.ok(col.canopyAt(-30, 161) > 0.5);
});

test('vegOf: lod-0 vegetation in wire order, kept when the chunk is coarsened, gone on unload', () => {
  const store = new ChunkStore();
  const c = parseChunk(forageFrame());
  assert.equal(store.vegOf(-1, 2), null);
  store.set(c);
  const list = vegList(store.vegOf(-1, 2));
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((v) => v.kind), [VEG.OAK, 18, VEG.GRASS_TUFT, 24, 35]);
  const oak = list[0];
  assert.equal(oak.variant, 4);
  assert.equal(oak.x, -60);
  assert.equal(oak.y, 2);
  assert.equal(oak.z, 130);
  assert.ok(Math.abs(oak.scale - 1.2) < 1e-6);
  assert.ok(Math.abs(oak.rot - 1) < 1e-3);
  assert.ok(Object.isFrozen(list) && Object.isFrozen(oak));
  store.set(decimateChunk(c, 1)); // drawn coarser now: the full list stays available
  assert.equal(store.vegOf(-1, 2).count, 5);
  store.delete(-1, 2);
  assert.equal(store.vegOf(-1, 2), null);
  // Received only at lod 1: no lod-0 list.
  store.set(decimateChunk(c, 1));
  assert.equal(store.vegOf(-1, 2), null);
  store.clear();
  assert.equal(store.veg0.size, 0);
});
