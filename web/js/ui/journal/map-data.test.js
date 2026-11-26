import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleTrails, buildMarkers, trailSegments } from './map-data.js';
import { createTileCache } from './tile-cache.js';

const T = (id, hidden = false, n = 3) => ({ id, hidden, points: Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 0, z: 0 })) });

test('trails follow mapDetail and the revealed list', () => {
  const trails = [T('main'), T('secret_pond', true), T('short', false, 1)];
  assert.deepEqual(visibleTrails(trails, 0, ['secret_pond']), []);
  assert.deepEqual(visibleTrails(trails, 1, []).map((t) => t.id), ['main']);
  assert.deepEqual(visibleTrails(trails, 2, ['secret_pond']).map((t) => t.id), ['main', 'secret_pond']);
});

const npcs = { mara: { id: 'mara', name: 'Mara', role: 'Veteran', poi: 'npc_mara' }, finn: { id: 'finn', name: 'Finn', role: 'Shop', poi: 'npc_finn' } };
const pois = new Map([
  ['npc_mara', { id: 'npc_mara', pos: { x: 5, y: 0, z: 5 } }],
  ['npc_finn', { id: 'npc_finn', pos: { x: 100, y: 0, z: 100 } }],
  ['old_watchtower', { id: 'old_watchtower', kind: 'watchtower', hidden: false, pos: { x: 200, y: 0, z: -200 } }],
  ['hidden_pond', { id: 'hidden_pond', kind: 'pond', hidden: true, pos: { x: -50, y: 0, z: 90 } }],
]);
const quests = {
  q1: { id: 'q1', name: 'Watch', ordered: false, objectives: [
    { id: 'a', kind: 'discover', target: 'old_watchtower', count: 1, text: 'Find the tower' },
    { id: 'b', kind: 'discover', target: 'hidden_pond', count: 1, text: 'Find the pond' },
    { id: 'c', kind: 'talk', target: 'finn', count: 1, text: 'Talk to Finn' },
    { id: 'd', kind: 'discover', target: 'kind:watchtower', count: 1, text: 'Any tower' },
    { id: 'e', kind: 'photo', target: 'any', count: 1, text: 'Photograph' },
  ] },
};
const base = { npcs, pois, quests, home: { x: 0, y: 0, z: 0 }, locations: {}, flags: {}, questStates: {}, isExplored: () => false };

test('cabin is always on the map; nothing else without discovery', () => {
  const m = buildMarkers(base);
  assert.deepEqual(m.map((x) => x.key), ['home']);
});

test('discovered places and met NPCs appear', () => {
  const m = buildMarkers({ ...base, locations: { old_watchtower: { name: 'Old Watchtower', kind: 'watchtower', pos: { x: 200, z: -200 } } }, flags: { 'met:mara': true } });
  assert.deepEqual(m.map((x) => x.key).sort(), ['home', 'loc:old_watchtower', 'npc:mara']);
  assert.equal(m.find((x) => x.key === 'loc:old_watchtower').icon, 'tower');
});

test('quest markers: only tracked quests, only known targets, never secret places or kind targets', () => {
  const untracked = buildMarkers({ ...base, questStates: { q1: { status: 'active', tracked: false, progress: {} } }, isExplored: () => true });
  assert.ok(!untracked.some((x) => x.type === 'quest'));
  const tracked = buildMarkers({ ...base, questStates: { q1: { status: 'active', tracked: true, progress: {} } }, isExplored: () => true });
  const q = tracked.filter((x) => x.type === 'quest').map((x) => x.key).sort();
  assert.deepEqual(q, ['quest:q1:a', 'quest:q1:c'], 'hidden pond and kind: targets are not revealed');
  const unexplored = buildMarkers({ ...base, questStates: { q1: { status: 'active', tracked: true, progress: {} } } });
  assert.ok(!unexplored.some((x) => x.type === 'quest'), 'unexplored ground reveals nothing');
});

test('discovered hidden place gets a quest marker; finished objectives do not', () => {
  const m = buildMarkers({
    ...base, locations: { hidden_pond: { name: 'Hidden Pond', kind: 'pond', pos: { x: -50, z: 90 }, hidden: true } },
    questStates: { q1: { status: 'active', tracked: true, progress: { a: 1 } } },
  });
  const q = m.filter((x) => x.type === 'quest').map((x) => x.key);
  assert.ok(q.includes('quest:q1:b'));
  assert.ok(!q.includes('quest:q1:a'));
});

test('talk marker for a met NPC even on unexplored ground', () => {
  const m = buildMarkers({ ...base, flags: { 'met:finn': true }, questStates: { q1: { status: 'active', tracked: true, progress: {} } } });
  assert.ok(m.some((x) => x.key === 'quest:q1:c'));
});

test('trail segments break at unexplored ground', () => {
  const trail = { points: [0, 10, 20, 30, 40, 50].map((x) => ({ x, z: 0 })) };
  const segs = trailSegments(trail, (x) => x !== 30);
  assert.deepEqual(segs.map((s) => s.length), [3, 2]);
});

class FakeImage { constructor() { FakeImage.all.push(this); } set src(v) { this._src = v; } get src() { return this._src; } }
FakeImage.all = [];

test('tile cache: bounded concurrency, LRU eviction, error backoff', () => {
  FakeImage.all = [];
  let t = 0, changes = 0;
  const c = createTileCache({ max: 3, maxLoading: 2, retryMs: 1000, makeImage: () => new FakeImage(), now: () => t, onChange: () => changes++ });
  assert.equal(c.get('a', '/a'), null);
  assert.equal(c.get('b', '/b'), null);
  assert.equal(c.get('c', '/c'), null);
  assert.equal(FakeImage.all.length, 2, 'only two requests in flight');
  assert.equal(c.loading, 2);
  FakeImage.all[0].onload();
  assert.equal(changes, 1);
  assert.ok(c.get('a', '/a'), 'loaded tile is returned');
  assert.equal(c.get('c', '/c'), null);
  assert.equal(FakeImage.all.length, 3, 'queued tile starts once a slot frees up');
  FakeImage.all[1].onerror();
  assert.equal(c.get('b', '/b'), null);
  assert.equal(FakeImage.all.length, 3, 'failed tile is not retried immediately');
  t = 2000;
  c.get('b', '/b');
  assert.equal(FakeImage.all.length, 4, 'retried after the pause');
  // eviction: touching d pushes out the least recently used
  c.get('d', '/d');
  assert.equal(c.size, 3);
});

test('tile cache never loads anything it is not asked for', () => {
  FakeImage.all = [];
  const c = createTileCache({ makeImage: () => new FakeImage() });
  assert.equal(c.size, 0);
  assert.equal(FakeImage.all.length, 0);
});
