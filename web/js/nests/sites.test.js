import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from './sites.js';

test('site wire order matches proto.NestSites', () => {
  assert.deepEqual([...N.NEST_SITES], ['cavity', 'cup_shrub', 'cup_fork', 'platform', 'dome', 'pendant', 'ground', 'scrape', 'reed', 'floating', 'burrow', 'ledge']);
  for (const s of N.NEST_SITES) assert.ok(N.SITE_WORDS[s], s);
});

test('nests messages parse and bad rows are skipped', () => {
  const list = N.parseNests({ n: [
    [4294967295, 0, 2, 1.5, 6.2, -3, 0.12, 1.57],
    [7, 3, 3, 0, 10, 0, 0.9, 0],
    [8, 99, 1, 0, 0, 0, 0.1, 0],       // unknown site
    [9, 1, 2, 'x', 0, 0, 0.1, 0],      // unreadable
    [10, 1, 2],                        // too short
    [11, 6, 9, 0, 0, 0, 0, 0],         // stage clamped, size defaulted
  ] });
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { id: 4294967295, site: 'cavity', stage: 2, x: 1.5, y: 6.2, z: -3, size: 0.12, yaw: 1.57 });
  assert.equal(list[1].site, 'platform');
  assert.equal(list[2].stage, 3);
  assert.ok(list[2].size > 0);
  assert.deepEqual(N.parseNests(null), []);
});

test('contents: eggs and chicks in open nests, a head at an entrance, nothing in old nests', () => {
  assert.equal(N.contentsOf('cup_shrub', N.STAGE.EGGS), 'eggs');
  assert.equal(N.contentsOf('platform', N.STAGE.CHICKS), 'chicks');
  assert.equal(N.contentsOf('cavity', N.STAGE.EGGS), null, 'eggs in a hole are never seen');
  assert.equal(N.contentsOf('cavity', N.STAGE.CHICKS), 'peek');
  assert.equal(N.contentsOf('burrow', N.STAGE.CHICKS), 'peek');
  assert.equal(N.contentsOf('dome', N.STAGE.CHICKS), 'peek');
  assert.equal(N.contentsOf('cup_fork', N.STAGE.OLD), null);
  assert.equal(N.contentsOf('reed', N.STAGE.BUILDING), null);
  assert.ok(N.isOpenSite('ledge') && !N.isOpenSite('burrow'));
});

test('clutch sizes are stable per nest and plausible per site', () => {
  for (let id = 1; id < 200; id++) {
    const c = N.clutchSize(id, 'cup_shrub');
    assert.ok(c >= 2 && c <= 5);
    assert.equal(c, N.clutchSize(id, 'cup_shrub'));
    const p = N.clutchSize(id, 'platform');
    assert.ok(p >= 1 && p <= 3);
  }
  const h = N.nestHash(12345);
  assert.ok(h >= 0 && h < 1);
});

test('headings follow core.HeadingDir and the model rotation turns −Z to it', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  const e = N.headingDir(Math.PI / 2);
  close(e.x, 1); close(e.z, 0);
  const n = N.headingDir(0);
  close(n.x, 0); close(n.z, -1);
  // three.js: rotation.y = θ maps (0,0,-1) to (-sin θ, 0, -cos θ)
  for (const yaw of [0, 0.7, 2, -1.3]) {
    const th = N.yawToRotY(yaw);
    const h = N.headingDir(yaw);
    close(-Math.sin(th), h.x); close(-Math.cos(th), h.z);
  }
});

test('a cavity entrance sits on the trunk surface, facing the nest heading', () => {
  const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 10, z: 0 };
  const c = N.cavityOnTrunk({ x: 0.1, y: 4, z: 0.2 }, a, b, 0.4, 0.2, Math.PI / 2); // faces east
  assert.ok(Math.abs(c.y - 4) < 1e-9);
  assert.ok(Math.abs(c.r - 0.32) < 1e-9, 'radius tapers along the segment');
  assert.ok(Math.abs(c.x - 0.32) < 1e-9 && Math.abs(c.z) < 1e-9);
  assert.ok(Math.abs(c.nx - 1) < 1e-9);
  // a leaning limb: the entrance stays perpendicular to it
  const d = N.cavityOnTrunk({ x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, 0.2, 0.2, Math.PI / 2);
  assert.ok(Math.abs(d.nx * Math.SQRT1_2 + d.ny * Math.SQRT1_2) < 1e-9, 'normal ⟂ limb');
  assert.equal(N.cavityOnTrunk({ x: 0, y: 0, z: 0 }, a, a, 0.2, 0.2, 0), null);
});

test('segment distance and the tree transform', () => {
  assert.equal(N.distToSegment({ x: 1, y: 5, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }), 1);
  assert.equal(N.distToSegment({ x: 0, y: 12, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }), 2);
  // same as internal/world xform.apply: (px + k(c x + s z), py + k y, pz + k(-s x + c z))
  const w = N.treeToWorld([1, 2, 0], { x: 10, y: 1, z: -4, scale: 2, rot: Math.PI / 2 });
  assert.ok(Math.abs(w.x - 10) < 1e-9 && Math.abs(w.y - 5) < 1e-9 && Math.abs(w.z - (-4 - 2)) < 1e-9);
});

test('journal lines describe site and stage without an owner', () => {
  assert.equal(N.nestLine({ site: 'cup_shrub', stage: 2 }), 'A cup nest in a shrub, with eggs');
  assert.equal(N.nestLine({ site: 'cavity', stage: 0 }), 'An old hole in a tree');
  assert.equal(N.nestLine({ site: 'ledge', stage: 3 }), 'A nest on a ledge, with chicks');
  assert.equal(N.nestLine({ site: 'mystery', stage: 1 }), 'A nest, being built');
});
