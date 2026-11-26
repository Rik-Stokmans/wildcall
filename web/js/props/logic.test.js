import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashString, rngFor, localToWorld, worldToLocal, mergePois, streamAction, BUILD_DIST, DROP_DIST,
  interactionFor, filterInteractables, landmarkStyle, paletteFor, surfaceHeight, platformHeightAt,
  surfaceReach, stairFlight, towerLayout, hideLayout, cabinLayout, boardwalkLayout, npcFacing,
  headingTo, glintAmount, windowGlow, feederSpot, STEP_UP, REGION, LANDMARK_STYLES,
  perimeterBlockers, blockedBy, parseColor, shadeHex, mixHex, npcProportions, applyLure,
  isFeederLure, hasGarden, seatSmall, overlapsChunk, chunkOf, isTaken,
} from './logic.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('hash and rng are deterministic per id', () => {
  assert.equal(hashString('watchtower@3,-2'), hashString('watchtower@3,-2'));
  assert.notEqual(hashString('watchtower@3,-2'), hashString('watchtower@3,-1'));
  const a = rngFor('x'), b = rngFor('x');
  for (let i = 0; i < 10; i++) { const v = a(); assert.equal(v, b()); assert.ok(v >= 0 && v < 1); }
});

test('local frame: front (−Z) points along the compass heading', () => {
  for (const yaw of [0, Math.PI / 2, 1.1, Math.PI, 4.4]) {
    const [x, z] = localToWorld(0, 0, yaw, 0, -1);
    assert.ok(near(x, Math.sin(yaw)) && near(z, -Math.cos(yaw)));
    const [lx, lz] = worldToLocal(5, -3, yaw, ...localToWorld(5, -3, yaw, 1.5, 2.5));
    assert.ok(near(lx, 1.5) && near(lz, 2.5));
  }
});

test('mergePois de-duplicates POIs and trails by id', () => {
  const state = { pois: { a: { id: 'a', name: 'old' } }, trails: [{ id: 't1', points: [] }] };
  const got = mergePois(state, {
    pois: [{ id: 'a', name: 'new' }, { id: 'b' }, null],
    trails: [{ id: 't1', points: [1] }, { id: 't2' }, { id: 't2' }],
  });
  assert.equal(got.length, 2);
  assert.equal(state.pois.a.name, 'new');
  assert.ok(state.pois.b);
  assert.deepEqual(state.trails.map((t) => t.id), ['t1', 't2']);
  assert.deepEqual(state.trails[0].points, [1]);
  const empty = {};
  mergePois(empty, { pois: [{ id: 'z' }] });
  assert.ok(empty.pois.z && Array.isArray(empty.trails));
});

test('streaming has hysteresis between build and drop', () => {
  assert.equal(streamAction(false, 100), 'build');
  assert.equal(streamAction(false, BUILD_DIST + 10), null);
  assert.equal(streamAction(true, BUILD_DIST + 10), null);
  assert.equal(streamAction(true, DROP_DIST + 1), 'drop');
  assert.ok(DROP_DIST > BUILD_DIST);
});

// Fixture profile flags: the watchtower satchel is opened and page_0 taken.
const flags = { 'taken:cache_watchtower': true, 'taken:page_0': true, 'met:mara': true };
const npcs = { mara: { id: 'mara', name: 'Mara' } };
const P = (id, kind, extra = {}) => ({ id, kind, name: id.toUpperCase(), pos: { x: 0, y: 0, z: 0 }, radius: 3, ...extra });

test('interaction rules per kind and taken flags', () => {
  assert.deepEqual(interactionFor(P('npc_mara', 'npc', { data: { npc: 'mara' } }), flags, npcs), { label: 'Mara', verb: 'Talk' });
  assert.equal(interactionFor(P('npc_x', 'npc', { name: 'Someone' }), flags, npcs).label, 'Someone');
  assert.equal(interactionFor(P('cabin', 'cabin'), flags).verb, 'Enter');
  assert.equal(interactionFor(P('shop_finn', 'shop'), flags).verb, 'Browse');
  assert.equal(interactionFor(P('sign@1,1', 'sign'), flags).verb, 'Read');
  assert.equal(interactionFor(P('cache_watchtower', 'cache'), flags), null);
  assert.equal(interactionFor(P('cache_camp', 'cache'), flags).verb, 'Open');
  assert.equal(interactionFor(P('page_0', 'page'), flags), null);
  assert.equal(interactionFor(P('feather@2,3', 'feather'), flags).verb, 'Pick up');
  assert.equal(interactionFor(P('relic@2,3', 'relic', { hidden: true }), flags).verb, 'Pick up');
  for (const k of ['landmark', 'watchtower', 'pond', 'viewpoint', 'hide', 'ranger_station']) {
    assert.equal(interactionFor(P('x', k), flags), null, k);
  }
  // c-field: a camp's fire opens the field kitchen.
  assert.equal(interactionFor(P('camp_survey', 'camp'), flags).verb, 'Cook');
  assert.equal(interactionFor(P('feather@0,0', 'feather'), undefined).verb, 'Pick up', 'no profile yet');
});

test('filterInteractables returns only currently valid targets with label and verb', () => {
  const pos = { x: 1, y: 2, z: 3 };
  const entries = [
    { poi: P('npc_mara', 'npc', { data: { npc: 'mara' } }), pos },
    { poi: P('cache_watchtower', 'cache'), pos },
    { poi: P('cache_camp', 'cache', { hidden: true }), pos },
    { poi: P('page_0', 'page'), pos },
    { poi: P('old_watchtower', 'watchtower'), pos },
  ];
  const out = filterInteractables(entries, flags, npcs);
  assert.deepEqual(out.map((o) => [o.id, o.verb]), [['npc_mara', 'Talk'], ['cache_camp', 'Open']]);
  assert.equal(out[0].pos, pos);
  assert.equal(out[0].label, 'Mara');
  assert.ok(out[1].radius > 0);
});

test('landmark styles by id, name and region', () => {
  assert.equal(landmarkStyle({ id: 'old_oak', data: { landmark: 'giant_tree' } }), 'old_oak', 'the world grows the oak; props only dress it');
  assert.equal(landmarkStyle({ id: 'landmark@1,1', name: 'Quiet', region: 0, data: { landmark: 'sea_arch' } }), 'sea_arch', 'Data.landmark wins');
  assert.equal(landmarkStyle({ id: 'landmark@1,1', name: 'Quiet', region: 0, data: { landmark: 'fern_hollow' } }), 'ferns');
  assert.equal(landmarkStyle({ id: 'landmark@1,1', name: 'Gull Light', region: 3, data: { landmark: 'unknown_kind' } }), 'lighthouse', 'unknown subtype falls back to the name');
  for (let i = 0; i < 100; i++) assert.ok(LANDMARK_STYLES.includes(landmarkStyle({ id: `landmark@${i},3`, name: 'X', region: i % 6 })));
  assert.equal(landmarkStyle({ id: 'woodland_entrance' }), 'arch');
  assert.equal(landmarkStyle({ id: 'l@1,1', name: 'Gull Point Lighthouse', region: 3 }), 'lighthouse');
  assert.equal(landmarkStyle({ id: 'l@1,1', name: 'Seal Arch', region: 3 }), 'sea_arch');
  assert.equal(landmarkStyle({ id: 'l@1,1', name: 'Rimefall Falls', region: 5 }), 'frozen_falls');
  assert.equal(landmarkStyle({ id: 'l@1,1', name: 'Grey Cairn', region: 2 }), 'cairn');
  assert.equal(landmarkStyle({ id: 'l@1,1', name: 'The Nine Stones', region: 0 }), 'standing_stones');
  const kinds = new Set();
  for (let i = 0; i < 200; i++) kinds.add(landmarkStyle({ id: `landmark@${i},0`, name: 'Quiet Place', region: REGION.MARSH }));
  assert.ok(kinds.has('boardwalk'));
  for (let i = 0; i < 50; i++) {
    assert.ok(['frozen_falls', 'cairn'].includes(landmarkStyle({ id: `landmark@${i},9`, name: 'Hush', region: REGION.FROSTVEIL })));
  }
});

test('region palettes: Frostveil snow caps, unknown → Greenhollow', () => {
  assert.equal(paletteFor(REGION.FROSTVEIL).snow, 1);
  assert.equal(paletteFor(255).wood, paletteFor(0).wood);
  const s = paletteFor(0, 'abc').shade;
  assert.ok(s >= 0.9 && s <= 1.1);
});

test('stair profile climbs from ground to platform at a walkable pitch', () => {
  const f = stairFlight(8, { zTop: 2 });
  assert.ok(f.run > 8 && f.run < 12, 'about 38°');
  assert.ok(near(f.rise * f.steps, 8));
  assert.ok(f.rise <= 0.25);
  assert.ok(near(surfaceHeight(f.ramp, 0, 2), 8), 'top');
  assert.ok(near(surfaceHeight(f.ramp, 0, 2 + f.run), 0), 'bottom');
  assert.ok(near(surfaceHeight(f.ramp, 0, 2 + f.run / 2), 4), 'linear');
  assert.equal(surfaceHeight(f.ramp, 2, 4), null, 'outside the flight');
});

test('a player can walk up the watchtower stair onto the platform', () => {
  const t = towerLayout('watchtower@4,7');
  assert.ok(t.height >= 7 && t.height <= 8.5);
  assert.equal(t.top, 11.5, 'roof ridge where the world puts tower perches');
  const set = { x: 100, z: 50, yaw: 1.2, base: 12, surfaces: t.surfaces, reach: surfaceReach(t.surfaces) };
  // Walk from the bottom of the stair to the platform centre in small steps, feet
  // always on the best surface (or the ground at base when there is none).
  let y = 12;
  const steps = 200;
  const start = [0, t.half + t.flight.run - 0.05], end = [0, 0];
  for (let i = 0; i <= steps; i++) {
    const lz = start[1] + (end[1] - start[1]) * (i / steps);
    const [wx, wz] = localToWorld(set.x, set.z, set.yaw, 0, lz);
    const h = platformHeightAt([set], wx, wz, y);
    assert.ok(h !== null, `surface at step ${i}`);
    assert.ok(h - y <= STEP_UP + 1e-9, 'never a step too tall');
    y = Math.max(12, h);
  }
  assert.ok(near(y, 12 + t.height), 'reached the platform');
  // Under the platform at ground level, the platform is out of reach.
  assert.equal(platformHeightAt([set], set.x, set.z, 12), null);
  // Far away: nothing.
  assert.equal(platformHeightAt([set], 0, 0, 12), null);
});

test('hide floor, cabin porch and boardwalk are walkable from the ground', () => {
  for (const L of [hideLayout('hide_creek'), cabinLayout('cabin')]) {
    const ramp = L.surfaces.find((s) => s.type === 'ramp');
    const low = Math.min(ramp.y0, ramp.y1), high = Math.max(ramp.y0, ramp.y1);
    assert.equal(low, 0);
    assert.ok(high > 0.3 && high < 0.8);
  }
  const b = boardwalkLayout('landmark@1,2');
  const set = { x: 0, z: 0, yaw: 0, base: 0.2, surfaces: b.surfaces, reach: surfaceReach(b.surfaces) };
  for (const [ex, ez] of b.ends) {
    const h = platformHeightAt([set], ex, ez, 0.2);
    assert.ok(h !== null && h <= 0.2 + b.h + 1e-9, 'ends reachable from the ground');
  }
  for (const s of b.segs) {
    assert.ok(near(platformHeightAt([set], s.x, s.z, 0.2 + b.h), 0.2 + b.h), 'deck continuous');
  }
});

test('NPC turns to face a nearby player and back to rest when they leave', () => {
  const rest = 0;
  let yaw = rest;
  // player due east, 3 m away
  for (let i = 0; i < 120; i++) yaw = npcFacing(yaw, rest, 0, 0, 3, 0, 1 / 30);
  assert.ok(near(yaw, Math.PI / 2, 0.02));
  for (let i = 0; i < 600; i++) yaw = npcFacing(yaw, rest, 0, 0, 30, 0, 1 / 30);
  assert.ok(Math.min(yaw, Math.PI * 2 - yaw) < 0.02);
  assert.ok(near(headingTo(0, 0, 0, -5), 0));
  assert.ok(near(headingTo(0, 0, 0, 5), Math.PI));
});

test('glint only within trackSigns, windows glow at night', () => {
  assert.equal(glintAmount(7, 6), 0);
  assert.equal(glintAmount(2, 6), 1);
  assert.ok(glintAmount(5.5, 6) > 0 && glintAmount(5.5, 6) < 1);
  assert.equal(glintAmount(1, 0), 0);
  assert.equal(windowGlow(1), 0);
  assert.equal(windowGlow(0), 1);
});

test('garden feeder sits beside the cabin', () => {
  const s = feederSpot({ pos: { x: 10, y: 4, z: 20 }, yaw: 0 });
  assert.ok(Math.hypot(s.x - 10, s.z - 20) > 5 && Math.hypot(s.x - 10, s.z - 20) < 10);
  assert.equal(s.y, 4);
});

test('perimeter blockers ring a building and leave door gaps', () => {
  const ring = perimeterBlockers(6, 4, { r: 0.5 });
  // every point on the wall line is covered, the middle is free
  for (let x = -3; x <= 3; x += 0.25) {
    assert.ok(blockedBy(ring, 0, 0, 0, x, -2), `front wall at ${x}`);
    assert.ok(blockedBy(ring, 0, 0, 0, x, 2), `back wall at ${x}`);
  }
  for (let z = -2; z <= 2; z += 0.25) assert.ok(blockedBy(ring, 0, 0, 0, 3, z) && blockedBy(ring, 0, 0, 0, -3, z));
  assert.ok(!blockedBy(ring, 0, 0, 0, 0, 0), 'inside is free');
  const door = perimeterBlockers(4, 3, { r: 0.3, gaps: [{ side: 'back', at: 0, width: 1.1 }] });
  assert.ok(!blockedBy(door, 0, 0, 0, 0, 1.5, 0.3), 'player fits through the door');
  assert.ok(blockedBy(door, 0, 0, 0, 1.5, 1.5), 'wall beside the door');
  // rotated: the local front wall follows the heading
  const [wx, wz] = localToWorld(10, 10, 1.3, 0, -2);
  assert.ok(blockedBy(ring, 10, 10, 1.3, wx, wz));
});

test('NPCLook colours parse robustly', () => {
  assert.equal(parseColor('#a0b1c2'), 0xa0b1c2);
  assert.equal(parseColor('A0B1C2'), 0xa0b1c2);
  assert.equal(parseColor('0x123456'), 0x123456);
  assert.equal(parseColor('#abc'), 0xaabbcc);
  assert.equal(parseColor('Grey'), parseColor('gray'));
  assert.equal(parseColor('not a colour', 0x111111), 0x111111);
  assert.equal(parseColor(undefined, 0x222222), 0x222222);
  assert.equal(parseColor(0x445566), 0x445566);
  assert.equal(shadeHex(0x808080, 2), 0xffffff);
  assert.equal(shadeHex(0x804020, 0.5), 0x402010);
  assert.equal(mixHex(0x000000, 0xffffff, 0.5), 0x808080);
});

test('NPC proportions are friendly and clamped', () => {
  const p = npcProportions({ height: 1.72, build: 1 });
  assert.ok(p.headY > p.shoulder && p.shoulder > p.hip && p.hip > 0);
  assert.ok(p.head / p.height > 0.09, 'a slightly big head');
  const tall = npcProportions({ height: 9, build: 9 });
  assert.ok(tall.height <= 2.05 && tall.build <= 1.4);
  const none = npcProportions(undefined);
  assert.ok(Number.isFinite(none.headY));
});

test('lures: active upserts, inactive removes; feeder kinds and garden upgrade', () => {
  const m = new Map();
  assert.equal(applyLure(m, { id: 3, pos: { x: 1, y: 0, z: 2 }, kind: 'seed', active: true }), 'add');
  assert.equal(applyLure(m, { id: 3, pos: { x: 1, y: 0, z: 2 }, kind: 'seed', active: true }), 'add');
  assert.equal(m.size, 1);
  assert.equal(applyLure(m, { id: 3, active: false }), 'remove');
  assert.equal(applyLure(m, { id: 3, active: false }), null);
  assert.equal(applyLure(m, null), null);
  assert.ok(isFeederLure('feeder') && isFeederLure('garden') && !isFeederLure('seed'));
  assert.ok(hasGarden({ cabin: ['photo_wall', 'garden'] }));
  assert.ok(!hasGarden({ cabin: [] }) && !hasGarden(null));
});

test('small props stand on decks above the ground but never float', () => {
  assert.equal(seatSmall(3, null), 3);
  assert.equal(seatSmall(3, 3.5), 3.5);
  assert.equal(seatSmall(3, 2.0), 3, 'a lower surface does not pull it down');
});

test('chunk overlap for re-seating', () => {
  assert.equal(chunkOf(-0.5), -1);
  assert.equal(chunkOf(64), 1);
  assert.ok(overlapsChunk(10, 10, 1, 0, 0));
  assert.ok(overlapsChunk(66, 10, 3, 0, 0), 'reach spills into the neighbour');
  assert.ok(!overlapsChunk(70, 10, 3, 0, 0));
  assert.ok(overlapsChunk(-5, -5, 1, -1, -1));
});

test('taken flags', () => {
  assert.ok(isTaken('cache_camp', { 'taken:cache_camp': true }));
  assert.ok(!isTaken('cache_camp', { 'taken:cache_camp': false }));
  assert.ok(!isTaken('cache_camp', null));
});
