// Tests of the pure tree builders: model preparation, wood chains and joint
// continuity, foliage cards, bounds, LOD budgets, shrub models and — against
// models exported from the Go server — the instance placement (rotation sense and
// exact scale), so a bird the server puts on a branch stands on the drawn branch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, INSTANCE, PLACED } from './fixture.test-data.js';
import {
  prepareModel, woodChains, buildWood, buildFoliage, placePoint, writeInstanceMatrix,
  DETAIL, ROOT_DEPTH, sidesFor, cardPlan, ellipsoidArea, woodDistance, unplacePoint,
} from './treeGeometry.js';
import { treeStyle, isModelKind, TREE_KINDS, CHESTNUT } from './treeStyle.js';
import { shrubModel, SHRUB_VARIANTS } from './shrubModels.js';
import { detailFor, modelVariant, treeTint, modelReach, GIANT_SCALE } from './instancing.js';
import { seasonThin } from '../season.js';
import { VEG } from '../constants.js';

const models = MODELS.map(prepareModel);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const vtx = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];

test('fixture models are the server format: parents first, children start at the parent end', () => {
  for (const m of models) {
    assert.equal(m.branches[0].parent, -1);
    for (let i = 1; i < m.branches.length; i++) {
      const b = m.branches[i];
      assert.ok(b.parent >= 0 && b.parent < i);
      assert.ok(dist(b.a, m.branches[b.parent].b) < 1e-6);
    }
  }
});

test('prepareModel: snags without leaves, broken parents rejected', () => {
  const snag = models.find((m) => m.kind === VEG.SNAG);
  assert.ok(snag);
  assert.deepEqual(snag.leaves, []);
  assert.throws(() => prepareModel({ kind: 0, variant: 0, branches: [{ a: [0, 0, 0], b: [0, 1, 0], ra: 0.2, rb: 0.1, parent: -1 }, { a: [0, 1, 0], b: [0, 2, 0], ra: 0.1, rb: 0.05, parent: 3 }] }));
  assert.throws(() => prepareModel({ kind: 0, variant: 0, branches: [] }));
});

test('wood chains cover every segment exactly once and follow the thickest child', () => {
  for (const m of models) {
    const chains = woodChains(m);
    const seen = new Uint8Array(m.branches.length);
    for (const c of chains) {
      for (let k = 0; k < c.segs.length; k++) {
        seen[c.segs[k]]++;
        if (k > 0) assert.equal(m.branches[c.segs[k]].parent, c.segs[k - 1]);
      }
      if (c.from >= 0) { // a side chain sprouts from a segment of its parent chain
        const parent = m.branches[c.segs[0]].parent;
        assert.ok(chains[c.from].segs.includes(parent));
      }
    }
    assert.ok(seen.every((n) => n === 1));
    assert.equal(chains[0].segs[0], 0);
  }
});

test('wood joints: one shared ring per joint, centred on the segment ends, at the limb radius', () => {
  const style = treeStyle(VEG.OAK);
  for (const m of models) {
    const st = treeStyle(m.kind);
    const wood = buildWood(m, st || style, DETAIL.NEAR);
    const chains = woodChains(m);
    for (let ci = 0; ci < chains.length; ci++) {
      const rings = wood.rings.filter((r) => r.chain === ci);
      const segs = chains[ci].segs;
      // Trunk: one extra ring below the ground. Every chain: start + one per segment end,
      // so consecutive segments share the ring at their joint (no doubled rings).
      const extra = ci === 0 ? 1 : 0;
      assert.equal(rings.length, segs.length + 1 + extra, `chain ${ci}`);
      if (ci === 0) assert.ok(Math.abs(rings[0].c[1] - (m.branches[0].a[1] - ROOT_DEPTH)) < 1e-9);
      assert.ok(dist(rings[extra].c, m.branches[segs[0]].a) < 1e-9);
      segs.forEach((si, k) => {
        const ring = rings[extra + k + 1];
        assert.ok(dist(ring.c, m.branches[si].b) < 1e-9);
        // The ring's vertices sit around the joint at about the segment's radius.
        for (let j = 0; j < ring.sides; j++) {
          const d = dist(vtx(wood.position, ring.start + j), ring.c);
          assert.ok(d >= ring.r * 0.99 && d <= ring.r * 1.35 * 1.4 + 1e-4, `ring radius ${d} vs ${ring.r}`);
        }
      });
      // Both segments at a joint index the very same ring vertices.
      for (let k = 1; k < rings.length - 1; k++) {
        const s = rings[k].start;
        let usedBefore = false, usedAfter = false;
        for (let t = 0; t < wood.index.length; t += 3) {
          const tri = [wood.index[t], wood.index[t + 1], wood.index[t + 2]];
          if (!tri.includes(s)) continue;
          if (tri.some((v) => v >= rings[k - 1].start && v < rings[k].start)) usedBefore = true;
          if (tri.some((v) => v >= rings[k + 1].start && v < rings[k + 1].start + rings[k + 1].sides + 1)) usedAfter = true;
        }
        assert.ok(usedBefore && usedAfter, `joint ${k} of chain ${ci} not shared`);
      }
    }
  }
});

test('side limbs start on the parent axis, inside the parent wood', () => {
  for (const m of models) {
    const wood = buildWood(m, treeStyle(m.kind), DETAIL.NEAR);
    const chains = woodChains(m);
    for (let ci = 1; ci < chains.length; ci++) {
      const first = m.branches[chains[ci].segs[0]];
      const parent = m.branches[first.parent];
      const start = wood.rings.find((r) => r.chain === ci);
      assert.ok(dist(start.c, parent.b) < 1e-9);
      assert.ok(start.r <= parent.rb + 1e-6); // pipe rule: no ring wider than the parent end
    }
  }
});

test('wood stays within the limbs it draws; leaf cards stay inside their masses', () => {
  for (const m of models) {
    const st = treeStyle(m.kind);
    const wood = buildWood(m, st, DETAIL.NEAR);
    let maxR = 0;
    for (const b of m.branches) maxR = Math.max(maxR, b.ra);
    for (let i = 0; i < wood.vertexCount; i++) {
      const p = vtx(wood.position, i);
      assert.ok(p.every(Number.isFinite));
      assert.ok(p[1] >= -ROOT_DEPTH - maxR * 1.6 && p[1] <= m.height + maxR + 0.1);
    }
    for (const v of wood.index) assert.ok(v < wood.vertexCount);
    const leaf = buildFoliage(m, st, DETAIL.NEAR);
    assert.equal(leaf.masses.length, m.leaves.length);
    for (const mass of leaf.masses) {
      for (let i = mass.start; i < mass.start + mass.count * 4; i++) {
        const p = vtx(leaf.position, i);
        const q = (p[0] - mass.c[0]) ** 2 / mass.r[0] ** 2 + (p[1] - mass.c[1]) ** 2 / mass.r[1] ** 2 + (p[2] - mass.c[2]) ** 2 / mass.r[2] ** 2;
        assert.ok(q <= 1.0001, `card centre outside its mass (${q})`);
      }
    }
    for (let i = 0; i < leaf.tree.length; i += 4) {
      assert.ok(leaf.tree[i] >= 0 && leaf.tree[i] <= 1);
      assert.equal(leaf.tree[i + 1], 1);
      assert.ok(leaf.tree[i + 3] >= 0 && leaf.tree[i + 3] < 1);
    }
    for (const v of leaf.color) assert.ok(v > 0.005 && v < 1.5, 'foliage never black');
  }
});

test('rotation sense and scale match the server (fixture placed by the Go transform)', () => {
  for (const p of PLACED) {
    const got = placePoint(p.model, INSTANCE);
    assert.ok(dist(got, p.world) < 1e-6, `${p.kind}/${p.variant}: ${got} vs ${p.world}`);
    // The instance matrix the GPU gets places it identically (column-major 4x4).
    const m = new Float64Array(16);
    writeInstanceMatrix(m, 0, INSTANCE.x, INSTANCE.y, INSTANCE.z, INSTANCE.scale, INSTANCE.rot);
    const [x, y, z] = p.model;
    const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
    assert.ok(dist(w, p.world) < 1e-6);
  }
  // Uniform scale: never jittered per axis.
  const m = new Float32Array(16);
  writeInstanceMatrix(m, 0, 0, 0, 0, 1.3, 0.7);
  assert.ok(Math.abs(Math.hypot(m[0], m[1], m[2]) - 1.3) < 1e-6);
  assert.ok(Math.abs(Math.hypot(m[8], m[9], m[10]) - 1.3) < 1e-6);
  assert.equal(m[5], Math.fround(1.3));
});

test('levels of detail: fewer triangles further away, giant cards denser', () => {
  for (const m of models) {
    const st = treeStyle(m.kind);
    const tri = (d) => buildWood(m, st, d).triangleCount + buildFoliage(m, st, d).triangleCount;
    assert.ok(tri(DETAIL.GIANT) >= tri(DETAIL.NEAR));
    assert.ok(tri(DETAIL.NEAR) > tri(DETAIL.MID));
    assert.ok(tri(DETAIL.MID) > tri(DETAIL.FAR));
    assert.ok(tri(DETAIL.FAR) < 400, `${m.kind}/${m.variant} far ${tri(DETAIL.FAR)}`);
    assert.ok(tri(DETAIL.NEAR) < 4000, `${m.kind}/${m.variant} near ${tri(DETAIL.NEAR)}`);
  }
  assert.ok(sidesFor(0.5, DETAIL.NEAR) > sidesFor(0.5, DETAIL.FAR));
  const r = [1.6, 1.0, 1.4];
  assert.ok(cardPlan(r, treeStyle(VEG.OAK), DETAIL.NEAR).count > cardPlan(r, treeStyle(VEG.OAK), DETAIL.MID).count);
  assert.ok(Math.abs(ellipsoidArea([1, 1, 1]) - 4 * Math.PI) < 1e-9);
});

test('shrub models are valid branching models of a 1.6 m mound', () => {
  for (let v = 0; v < SHRUB_VARIANTS; v++) {
    const m = prepareModel(shrubModel(v));
    assert.equal(m.kind, VEG.SHRUB);
    for (let i = 1; i < m.branches.length; i++) assert.ok(dist(m.branches[i].a, m.branches[m.branches[i].parent].b) < 1e-9);
    assert.ok(m.height > 1.3 && m.height < 2.1);
    assert.ok(m.leaves.length >= 5);
    assert.ok(buildFoliage(m, treeStyle(VEG.SHRUB), DETAIL.NEAR).triangleCount > 0);
  }
  assert.deepEqual(shrubModel(2), shrubModel(2)); // deterministic
});

test('instancing rules: kinds, model variants, detail by LOD and scale, tints', () => {
  for (const k of TREE_KINDS) assert.ok(isModelKind(k) && treeStyle(k));
  assert.ok(isModelKind(CHESTNUT));
  assert.ok(isModelKind(VEG.SHRUB));
  assert.ok(!isModelKind(VEG.ROCK) && !isModelKind(18));
  assert.equal(modelVariant(VEG.OAK, 6), 0); // the Old Oak's variant 6 is model 0
  assert.equal(modelVariant(VEG.OAK, 251), 5);
  assert.equal(modelVariant(VEG.SHRUB, 7), 3);
  assert.equal(detailFor(0, 1), DETAIL.NEAR);
  assert.equal(detailFor(0, GIANT_SCALE + 0.8), DETAIL.GIANT);
  assert.equal(detailFor(1, 3), DETAIL.MID);
  assert.equal(detailFor(2, 1), DETAIL.FAR);
  const out = new Float32Array(3);
  for (let v = 0; v < 256; v += 13) {
    treeTint(VEG.SNOW_PINE, v, v * 1.7, -v, out, 0);
    assert.ok(Math.abs(out[0] - out[2]) < 0.04, 'snow stays white');
    treeTint(VEG.OAK, v, v, v, out, 0);
    for (const c of out) assert.ok(c > 0.75 && c < 1.25);
  }
  for (const m of models) assert.ok(modelReach(m) > 0.5 && modelReach(m) < 16);
});

test('seasons thin broadleaves and shrubs, never evergreens or the fixed palettes', () => {
  assert.equal(seasonThin('broadleaf', 1), 0);
  assert.ok(seasonThin('broadleaf', 3) > 0.5);
  assert.ok(seasonThin('broadleaf', 2) < seasonThin('broadleaf', 3));
  assert.equal(seasonThin('evergreen', 3), 0);
  assert.equal(seasonThin('', 3), 0);
  assert.equal(seasonThin('broadleaf', 7), seasonThin('broadleaf', 3));
});

test('wood distance diagnostics: a point on a limb top is on the bark, unplace inverts place', () => {
  for (const m of models) {
    const b = m.branches[Math.floor(m.branches.length / 2)];
    const mid = [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2 + (b.ra + b.rb) / 2, (b.a[2] + b.b[2]) / 2];
    // Straight above the axis by the radius: on (or just inside, for a sloping limb) the surface.
    assert.ok(woodDistance(m, mid).d <= 1e-6 && woodDistance(m, mid).d > -(b.ra + b.rb) / 2);
    const w = placePoint(mid, INSTANCE);
    const back = unplacePoint(w, INSTANCE);
    assert.ok(dist(back, mid) < 1e-9);
  }
});
