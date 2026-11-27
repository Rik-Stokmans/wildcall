import test from 'node:test';
import assert from 'node:assert/strict';
import {
  worldToMini, miniToWorld, rimClamp, northMarker, arrowRotation, waypointPips, pinAlpha,
  placeMarkers, placeWaypoints, reachedWaypoints, baseStale, poseChanged, scaleFor, shortDistance, distanceBearing,
} from './mm-math.js';
import { createWaypointStore, sanitize, nextLetter, pickColor, MAX_WAYPOINTS, WAYPOINT_COLORS, storageKey, cleanName } from './waypoints.js';

const D = Math.PI / 180;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('north-up: east is right, north is up, south is down, regardless of heading', () => {
  for (const yaw of [0, 37 * D, 90 * D, 200 * D]) {
    const e = worldToMini(100, 0, yaw, false, 0.5);
    near(e.x, 50); near(e.y, 0);
    const n = worldToMini(0, -100, yaw, false, 0.5);
    near(n.x, 0); near(n.y, -50);
    const s = worldToMini(0, 100, yaw, false, 0.5);
    near(s.y, 50);
  }
});

test('heading-up: what the player faces is at the top', () => {
  // facing east: a waypoint due east is at the TOP
  const e = worldToMini(100, 0, 90 * D, true, 1);
  near(e.x, 0); near(e.y, -100);
  // facing east: north is to the LEFT
  const n = worldToMini(0, -100, 90 * D, true, 1);
  near(n.x, -100); near(n.y, 0);
  // facing north: identical to north-up
  const a = worldToMini(30, -70, 0, true, 1), b = worldToMini(30, -70, 0, false, 1);
  near(a.x, b.x); near(a.y, b.y);
  // facing south: a waypoint due east is on the LEFT
  const s = worldToMini(100, 0, 180 * D, true, 1);
  near(s.x, -100); near(s.y, 0, 1e-6);
  // facing west: due south is on the LEFT, due north on the RIGHT
  const w = worldToMini(0, 100, 270 * D, true, 1);
  near(w.x, -100, 1e-6);
});

test('miniToWorld inverts worldToMini in both modes', () => {
  for (const rotate of [false, true]) {
    for (const yaw of [0, 1.1, -2.5, 4]) {
      const p = worldToMini(-37, 81, yaw, rotate, 0.66);
      const w = miniToWorld(p.x, p.y, yaw, rotate, 0.66);
      near(w.dx, -37, 1e-6); near(w.dz, 81, 1e-6);
    }
  }
});

test('rim clamping keeps direction and pins to the radius', () => {
  assert.deepEqual(rimClamp(10, -20, 80).clamped, false);
  const c = rimClamp(300, 0, 80);
  assert.equal(c.clamped, true);
  near(c.x, 80); near(c.y, 0);
  near(c.angle, Math.PI / 2);
  const d = rimClamp(-300, -400, 50);
  near(Math.hypot(d.x, d.y), 50);
  near(d.x / d.y, 300 / 400);
});

test('N marker and arrow rotation', () => {
  const n0 = northMarker(0, false, 70); near(n0.x, 0); near(n0.y, -70);
  const n1 = northMarker(90 * D, true, 70); near(n1.x, -70); near(n1.y, 0, 1e-9);
  assert.equal(arrowRotation(1.2, true), 0);
  assert.equal(arrowRotation(1.2, false), 1.2);
});

test('placeWaypoints: in range inside, far ones on the rim with their distance', () => {
  const list = [{ id: 'a', x: 60, z: 0 }, { id: 'b', x: 0, z: 2000 }];
  const s = scaleFor(80, 120);
  const out = placeWaypoints(list, 0, 0, 0, false, s, 80);
  assert.equal(out[0].clamped, false); near(out[0].x, 40);
  assert.equal(out[1].clamped, true); near(out[1].y, 80); near(out[1].dist, 2000);
});

test('placeMarkers: only the cabin is clamped; others outside the disc are dropped', () => {
  const markers = [
    { key: 'home', type: 'home', x: 0, z: 900 },
    { key: 'loc:a', type: 'place', x: 20, z: 0 },
    { key: 'loc:b', type: 'place', x: 800, z: 0 },
    { key: 'npc:m', type: 'npc', x: -10, z: 5 },
  ];
  const out = placeMarkers(markers, 0, 0, 0, true, scaleFor(80, 120), 80);
  assert.deepEqual(out.map((o) => o.m.key), ['loc:a', 'npc:m', 'home']);
  assert.equal(out[2].clamped, true);
});

test('compass pins: on-strip only, 4 nearest, selected stronger, alpha fades', () => {
  const half = 80 * D;
  const list = 'ABCDEF'.split('').map((l, i) => ({ id: 'w' + i, letter: l, color: '#C98A50', x: 0, z: -(50 + i * 100) }));
  list.push({ id: 'behind', letter: 'G', x: 0, z: 500 });
  let pins = waypointPips(list, 0, 0, 0, half);
  assert.equal(pins.length, 4);
  assert.deepEqual(pins.map((p) => p.letter), ['A', 'B', 'C', 'D']);
  assert.equal(pins[0].strong, true);
  assert.ok(pins.every((p, i) => i === 0 || !p.strong));
  near(pins[0].offset, 0);
  pins = waypointPips(list, 0, 0, 0, half, { selected: 'w5' });
  assert.ok(pins.some((p) => p.id === 'w5' && p.strong));
  assert.equal(pins.length, 4);
  // due east while facing north: right side of the strip (offset 90/80 > 1 -> off); facing NE -> on, right
  const east = [{ id: 'e', letter: 'A', x: 100, z: 0 }];
  assert.equal(waypointPips(east, 0, 0, 0, half).length, 0);
  const pe = waypointPips(east, 0, 0, 45 * D, half)[0];
  near(pe.offset, 45 / 80, 1e-9);
  assert.ok(pinAlpha(50) > pinAlpha(500) && pinAlpha(500) > pinAlpha(5000));
  assert.equal(pinAlpha(5000), 0.45);
});

test('reached fires once per arrival and not for a waypoint marked where you stand', () => {
  const armed = new Map();
  const list = [{ id: 'a', x: 100, z: 0 }, { id: 'here', x: 1, z: 0 }];
  assert.deepEqual(reachedWaypoints(list, 0, 0, armed), []);
  assert.deepEqual(reachedWaypoints(list, 95, 0, armed).map((w) => w.id), ['a']);
  assert.deepEqual(reachedWaypoints(list, 96, 0, armed), []);
  assert.deepEqual(reachedWaypoints(list, 60, 0, armed), []); // 40 m away: not re-armed yet
  reachedWaypoints(list, 0, 0, armed);                        // 100 m away: re-armed
  assert.deepEqual(reachedWaypoints(list, 99, 0, armed).map((w) => w.id), ['a']);
  reachedWaypoints([], 0, 0, armed);
  assert.equal(armed.size, 0);
});

test('redraw decisions', () => {
  assert.equal(baseStale(null, 0, 0, 1, 20), true);
  const base = { x: 0, z: 0, scale: 0.5 };
  assert.equal(baseStale(base, 5, 0, 0.5, 20), false);
  assert.equal(baseStale(base, 25, 0, 0.5, 20), true);
  assert.equal(baseStale(base, 0, 0, 0.25, 20), true);
  assert.equal(poseChanged({ x: 0, z: 0, yaw: 0 }, { x: 0.1, z: 0, yaw: 0.001 }), false);
  assert.equal(poseChanged({ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0, yaw: 0.02 }), true);
  assert.equal(poseChanged({ x: 0, z: 0, yaw: 6.28 }, { x: 0, z: 0, yaw: 0.0 }), false);
});

test('distance text', () => {
  assert.equal(shortDistance(84.6), '85 m');
  assert.equal(shortDistance(1234), '1.2 km');
  assert.equal(distanceBearing(0, 0, { x: 340, z: 0 }), '340 m · E');
  assert.equal(distanceBearing(0, 0, { x: 3, z: 0 }), 'right here');
});

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

test('waypoint store: naming, palette, limit, rename, remove, nearest', () => {
  const events = [];
  const st = createWaypointStore({ storage: fakeStorage(), onChange: (list, sel) => events.push({ n: list.length, sel }) });
  st.bind('123');
  const a = st.add({ x: 10, z: 20 });
  assert.equal(a.name, 'Waypoint A'); assert.equal(a.letter, 'A'); assert.equal(a.color, WAYPOINT_COLORS[0]);
  const b = st.add({ x: 50, z: 20, name: '  Owl   tree ' });
  assert.equal(b.name, 'Owl tree'); assert.equal(b.letter, 'B'); assert.equal(b.color, WAYPOINT_COLORS[1]);
  for (let i = 2; i < MAX_WAYPOINTS; i++) assert.ok(st.add({ x: i, z: i }));
  assert.equal(st.add({ x: 0, z: 0 }), null);
  assert.equal(st.size, MAX_WAYPOINTS);
  assert.equal(st.list()[11].letter, 'L');
  st.remove(a.id);
  const again = st.add({ x: 1, z: 1 });
  assert.equal(again.letter, 'A'); // the freed letter is reused
  assert.ok(st.rename(b.id, ''));
  assert.equal(st.get(b.id).name, 'Waypoint B');
  st.rename(b.id, 'x'.repeat(80));
  assert.equal(st.get(b.id).name.length, 32);
  assert.equal(st.nearest(49, 21, 5).id, b.id);
  assert.equal(st.nearest(500, 500, 5), null);
  st.select(b.id);
  assert.equal(st.selectedId, b.id);
  st.remove(b.id);
  assert.equal(st.selectedId, null);
  assert.ok(events.length > 14);
  st.clear();
  assert.equal(st.size, 0);
  assert.equal(st.add({ x: NaN, z: 0 }), null);
  // list() returns copies
  const c = st.add({ x: 0, z: 0 });
  st.list()[0].name = 'hacked';
  assert.equal(st.get(c.id).name, 'Waypoint A');
});

test('waypoint store: persists per world seed and survives a reload', () => {
  const storage = fakeStorage();
  const st = createWaypointStore({ storage });
  st.bind(42);
  const a = st.add({ x: 1, z: 2 });
  st.add({ x: 3, z: 4, name: 'Pond' });
  st.recolor(a.id, '#627F9A');
  const st2 = createWaypointStore({ storage });
  st2.bind(42);
  assert.deepEqual(st2.list(), st.list());
  assert.ok(storage.m.has(storageKey(42)));
  // a new waypoint after reload never reuses an id
  const c = st2.add({ x: 9, z: 9 });
  assert.ok(!st.list().some((w) => w.id === c.id));
  // another world is separate
  const st3 = createWaypointStore({ storage });
  st3.bind(7);
  assert.equal(st3.size, 0);
  // broken storage is tolerated
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
  const st4 = createWaypointStore({ storage: bad });
  st4.bind(1);
  assert.ok(st4.add({ x: 0, z: 0 }));
  storage.setItem(storageKey(5), '{not json');
  const st5 = createWaypointStore({ storage });
  st5.bind(5);
  assert.equal(st5.size, 0);
});

test('sanitize drops malformed entries and fixes letters/colours', () => {
  const out = sanitize({ list: [
    { id: 'wp1', x: 1, z: 2, letter: 'A', name: 'One', color: '#C98A50' },
    { id: 'wp1', x: 1, z: 2 },               // duplicate id
    { id: 'wp2', x: 'no', z: 2 },            // bad coords
    { id: 'wp3', x: 5, z: 6, letter: 'A', color: 'red' }, // duplicate letter, bad colour
    null,
  ] });
  assert.equal(out.length, 2);
  assert.equal(out[1].letter, 'B');
  assert.equal(out[1].name, 'Waypoint B');
  assert.ok(WAYPOINT_COLORS.includes(out[1].color));
  assert.equal(nextLetter(out), 'C');
  assert.equal(pickColor([{ color: WAYPOINT_COLORS[0] }]), WAYPOINT_COLORS[1]);
  assert.equal(cleanName(' a\n b '), 'a b');
});

test('rim markers are spread apart and only one label per cluster', async () => {
  const { spreadRim } = await import('./mm-math.js');
  const r = 70;
  const items = [
    { clamped: true, angle: 0.0, dist: 551 },
    { clamped: true, angle: 0.02, dist: 547 },
    { clamped: true, angle: 2.0, dist: 900 },
    { clamped: false, angle: 0.0, dist: 30, x: 1, y: 2 },
  ];
  spreadRim(items, r);
  const diff = Math.abs(items[0].angle - items[1].angle);
  assert.ok(diff >= 0.24 - 1e-9, 'spread ' + diff);
  assert.equal(items[1].label, true);   // nearest keeps its label
  assert.equal(items[0].label, false);  // its neighbour does not
  assert.equal(items[2].label, true);
  near(Math.hypot(items[0].x, items[0].y), r);
  assert.equal(items[3].x, 1);          // markers inside the disc are untouched
});

test('forget(seed): a new adventure on a seed played before starts without the old pins', () => {
  const storage = fakeStorage();
  const seen = [];
  const st = createWaypointStore({ storage, onChange: (list) => seen.push(list.length) });
  st.bind(42);
  st.add({ x: 1, z: 2 });
  st.forget(42);                       // the live list is that world's: emptied and announced
  assert.equal(st.size, 0);
  assert.equal(seen[seen.length - 1], 0);
  assert.ok(!storage.m.has(storageKey(42)));
  st.add({ x: 5, z: 5 });
  st.forget(7);                        // another world's key: the live list is untouched
  assert.equal(st.size, 1);
  const st2 = createWaypointStore({ storage: null });
  st2.forget(1);                       // no storage at all: harmless
  const bad = createWaypointStore({ storage: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } } });
  bad.bind(1); bad.forget(1);          // throwing storage: harmless
});

test('rim markers keep clear of the "N" obstacle, which takes no label', async () => {
  const { spreadRim } = await import('./mm-math.js');
  const items = [
    { clamped: true, angle: 0, dist: -1, noLabel: true },
    { clamped: true, angle: 0.05, dist: 800 },
  ];
  spreadRim(items, 68);
  assert.equal(items[0].angle, 0);
  assert.equal(items[0].label, false);
  assert.ok(Math.abs(items[1].angle) >= 0.24 - 1e-9);
  assert.equal(items[1].label, true);  // the obstacle does not steal the waypoint's label
});
