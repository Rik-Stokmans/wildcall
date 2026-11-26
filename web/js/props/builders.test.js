// Runs every prop builder against a recording stand-in for mesh.js's Shape (the
// builders never import three.js) and checks that what they produce is sane:
// finite numbers, walkable surfaces that reach the ground, blockers that keep
// doorways open, interaction points in reach, deterministic per id.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCabin, buildRuinedCabin, buildAbandonedStation, buildShop, buildWatchtower,
  buildResearchSite, buildHide, buildCamp, buildViewpoint, buildPond,
} from './structures.js';
import { buildLandmark } from './landmarks.js';
import { buildSign, buildCache, buildCollectible, buildSeedLure, buildFeeder, cacheStyle } from './small.js';
import {
  paletteFor, rngFor, platformHeightAt, surfaceReach, localToWorld, blockedBy, STEP_UP, LANDMARK_STYLES, landmarkStyle,
} from './logic.js';

/** Records primitive calls; every numeric argument must be finite. */
class MockShape {
  constructor(rand) { this.rand = rand || Math.random; this.calls = []; this.maxY = -Infinity; this.minY = Infinity; }
  rec(name, args) {
    const flat = JSON.stringify(args, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? `BAD:${v}` : v));
    if (flat.includes('BAD:')) throw new Error(`${name} got a non-finite number: ${flat}`);
    this.calls.push(name);
    const o = args.find((a) => a && typeof a === 'object' && !Array.isArray(a));
    if (o && Number.isFinite(o.y)) { this.maxY = Math.max(this.maxY, o.y); this.minY = Math.min(this.minY, o.y); }
    for (const a of args) if (Array.isArray(a) && a.length === 3) { this.maxY = Math.max(this.maxY, a[1]); this.minY = Math.min(this.minY, a[1]); }
    return this;
  }
  box(...a) { return this.rec('box', a); }
  block(...a) { return this.rec('block', a); }
  beam(...a) { return this.rec('beam', a); }
  pole(...a) { return this.rec('pole', a); }
  cyl(...a) { return this.rec('cyl', a); }
  cone(...a) { return this.rec('cone', a); }
  ball(...a) { return this.rec('ball', a); }
  stone(...a) { return this.rec('stone', a); }
  gable(...a) { return this.rec('gable', a); }
}

function ctx(poi, groundFn = () => 0, base = 0, loaded = true) {
  const rand = rngFor(poi.id, 1);
  return {
    poi, rand, pal: paletteFor(poi.region, poi.id), base, loaded, complete: true,
    solid: new MockShape(rand), glow: new MockShape(rand),
    ground: groundFn,
  };
}
const P = (id, kind, extra = {}) => ({ id, kind, name: 'Test ' + kind, pos: { x: 0, y: 0, z: 0 }, yaw: 0, region: 0, radius: 14, ...extra });

const STRUCTURES = {
  cabin: (b) => buildCabin(b, { lit: true, smoke: true }),
  ranger_station: (b) => buildCabin(b, { ranger: true }),
  hidden_cabin: buildRuinedCabin,
  abandoned_station: buildAbandonedStation,
  shop: buildShop,
  watchtower: buildWatchtower,
  research_site: buildResearchSite,
  hide: buildHide,
  camp: buildCamp,
  viewpoint: buildViewpoint,
  pond: buildPond,
};

function checkSpec(name, spec) {
  assert.ok(spec && typeof spec === 'object', name);
  assert.ok(Number.isFinite(spec.reach) && spec.reach > 0, `${name} reach`);
  for (const c of spec.blockers || []) assert.ok(Number.isFinite(c.lx + c.lz + c.r) && c.r > 0, `${name} blocker`);
  for (const s of spec.surfaces || []) assert.ok(['box', 'ramp'].includes(s.type), `${name} surface`);
  if (spec.interact) assert.ok(Number.isFinite(spec.interact.lx + spec.interact.ly + spec.interact.lz), `${name} interact`);
}

test('every structure kind builds in every region type, with finite geometry', () => {
  for (const [kind, fn] of Object.entries(STRUCTURES)) {
    for (let region = 0; region < 6; region++) {
      for (const hidden of [false, true]) {
        const poi = P(`${kind}@${region},${hidden ? 1 : 0}`, kind, { region, hidden });
        const b = ctx(poi, (x, z) => 0.3 * Math.sin(x) + 0.2 * Math.cos(z));
        const spec = fn(b);
        checkSpec(`${kind}/${region}`, spec);
        assert.ok(b.solid.calls.length > (kind === 'pond' ? 0 : 10), `${kind} draws something`);
      }
    }
  }
});

test('every landmark style builds, and the style comes from the POI', () => {
  const seen = new Set();
  const subs = ['timber_arch', 'giant_tree', 'stepping_stones', 'fern_hollow', 'meadow', 'standing_stones',
    'waterfall_rocks', 'sea_arch', 'lighthouse', 'boardwalk', 'cairn', 'frozen_falls'];
  for (const [i, sub] of subs.entries()) {
    for (let region = 0; region < 6; region++) {
      const poi = P(`landmark@${i},${region}`, 'landmark', { region, data: { landmark: sub } });
      const b = ctx(poi, (x) => 0.1 * x);
      const spec = buildLandmark(b);
      checkSpec(sub, spec);
      seen.add(spec.style);
    }
  }
  const oak = buildLandmark(ctx(P('old_oak', 'landmark', { data: { landmark: 'giant_tree' } })));
  seen.add(oak.style);
  for (const s of LANDMARK_STYLES) assert.ok(seen.has(s), `style ${s} reachable`);
  assert.equal(landmarkStyle(P('old_oak', 'landmark')), 'old_oak');
});

test('builders are deterministic per id and vary between ids', () => {
  const a = ctx(P('watchtower@1,2', 'watchtower')), b2 = ctx(P('watchtower@1,2', 'watchtower'));
  const sa = buildWatchtower(a), sb = buildWatchtower(b2);
  assert.deepEqual(sa.surfaces, sb.surfaces);
  assert.deepEqual(a.solid.calls, b2.solid.calls);
  const heights = new Set();
  for (let i = 0; i < 20; i++) heights.add(buildWatchtower(ctx(P(`watchtower@${i},0`, 'watchtower'))).surfaces[0].y.toFixed(3));
  assert.ok(heights.size > 10, 'towers differ');
});

test('the watchtower is climbable from its stair foot to the railed platform', () => {
  const poi = P('old_watchtower', 'watchtower');
  const spec = buildWatchtower(ctx(poi));
  const set = { x: 50, z: -20, yaw: 2.2, base: 7, surfaces: spec.surfaces, reach: surfaceReach(spec.surfaces) };
  const ramp = spec.surfaces.find((s) => s.type === 'ramp');
  const top = spec.surfaces.find((s) => s.type === 'box');
  let y = 7;
  for (let i = 0; i <= 300; i++) {
    const lz = ramp.z1 - 0.02 + (0 - (ramp.z1 - 0.02)) * (i / 300);
    const [wx, wz] = localToWorld(set.x, set.z, set.yaw, 0, lz);
    const h = platformHeightAt([set], wx, wz, y);
    assert.ok(h !== null && h - y <= STEP_UP + 1e-9, `step ${i}`);
    y = Math.max(7, h);
  }
  assert.ok(Math.abs(y - (7 + top.y)) < 1e-9);
  // the stair's foot is not walled in by a leg blocker
  const [fx, fz] = localToWorld(0, 0, 0, 0, ramp.z1 - 0.3);
  assert.ok(!blockedBy(spec.blockers, 0, 0, 0, fx, fz, 0.35));
});

test('hide: walk up the back ramp, through the door, onto the floor', () => {
  const b = ctx(P('hide_creek', 'hide'));
  const spec = buildHide(b);
  const set = { x: 0, z: 0, yaw: 0, base: 0, surfaces: spec.surfaces, reach: surfaceReach(spec.surfaces) };
  const ramp = spec.surfaces.find((s) => s.type === 'ramp');
  let y = 0;
  for (let lz = ramp.z1 - 0.05; lz > 0; lz -= 0.1) {
    assert.ok(!blockedBy(spec.blockers, 0, 0, 0, 0, lz, 0.3), `door open at ${lz.toFixed(2)}`);
    const h = platformHeightAt([set], 0, lz, y);
    assert.ok(h !== null && h - y <= STEP_UP);
    y = h;
  }
  assert.ok(y > 0.3, 'on the raised floor');
});

test('cabin: the porch is reachable by its steps and the interaction point is on it', () => {
  const b = ctx(P('cabin', 'cabin'));
  const spec = buildCabin(b, { lit: true, smoke: true });
  assert.equal(spec.smoke.length, 1);
  assert.ok(b.glow.calls.length > 0, 'lit windows go into the glow mesh');
  const set = { x: 0, z: 0, yaw: 0, base: 0, surfaces: spec.surfaces, reach: surfaceReach(spec.surfaces) };
  const deck = spec.surfaces.find((s) => s.type === 'box');
  const ramp = spec.surfaces.find((s) => s.type === 'ramp');
  const h = platformHeightAt([set], 0, (ramp.z0 + ramp.z1) / 2, 0);
  assert.ok(h > 0 && h < deck.y);
  assert.ok(!blockedBy(spec.blockers, 0, 0, 0, spec.interact.lx, spec.interact.lz, 0.3), 'door front is free');
  assert.ok(blockedBy(spec.blockers, 0, 0, 0, 1.0, deck.z1), 'the front wall is solid');
  assert.ok(blockedBy(spec.blockers, 0, 0, 0, 0, -deck.z1), 'the back wall is solid');
  // the world puts the door 4 m out: the porch front must be about there
  assert.ok(Math.abs(deck.z0 + 4.2) < 0.6, `porch front at ${deck.z0}`);
  // the roof ridge where the world assumes cabin perches (4.6 m)
  assert.ok(b.solid.maxY > 4.2);
});

test('pond reeds follow the shoreline only when the terrain is there', () => {
  // a bowl: water inside r < 9 m (ground below y = 0), dry outside
  const base = -1.2;
  const bowl = (x, z) => (Math.hypot(x, z) < 9 ? -1.2 + Math.hypot(x, z) * 0.12 : 0.6) - base;
  const b = ctx(P('hidden_pond', 'pond'), bowl, base, true);
  buildPond(b);
  assert.ok(b.solid.calls.length > 20, 'reeds placed');
  assert.equal(b.complete, true);
  const flat = ctx(P('hidden_pond', 'pond'), () => 0, base, false);
  buildPond(flat);
  assert.equal(flat.complete, false, 'asks to be rebuilt once the terrain loads');
});

test('caches show open/closed, collectibles and lures build', () => {
  assert.equal(cacheStyle({ name: 'Weathered Satchel' }), 'satchel');
  assert.equal(cacheStyle({ name: 'Dusty Leather Case' }), 'case');
  assert.equal(cacheStyle({ name: 'Oilcloth Bundle' }), 'bundle');
  assert.equal(cacheStyle({ name: 'Mossy Strongbox' }), 'case');
  assert.equal(cacheStyle({ name: 'Old Chest' }), 'chest');
  for (const name of ['Weathered Satchel', 'Dusty Leather Case', 'Oilcloth Bundle', 'Old Chest']) {
    for (const open of [false, true]) {
      const b = ctx(P('cache@1,1', 'cache', { name }));
      checkSpec(name, buildCache(b, open));
      assert.ok(b.solid.calls.length > 0);
    }
  }
  for (const kind of ['feather', 'page', 'relic']) {
    for (let region = 0; region < 6; region++) {
      const b = ctx(P(`${kind}@${region},0`, kind, { region }));
      const out = buildCollectible(b, () => new MockShape(b.rand));
      assert.ok(out.item.calls.length > 0 && out.lift > 0.2 && out.lift < 0.6, kind);
    }
  }
  checkSpec('sign', buildSign(ctx(P('sign@0,0', 'sign'))));
  checkSpec('seed', buildSeedLure(ctx(P('lure:1', 'lure'))));
  checkSpec('feeder', buildFeeder(ctx(P('garden_feeder', 'feeder'))));
});
