import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  poseInterval, buildPose, buildPhoto, pickInteractable, regionAllowed, gateStep, GATE_SLACK,
  createSightingTracker, trackSighting, liveMystery, SIGHTING_TTL, filmLeft, outOfFilm,
  carries, cinematicPose, easeYaw,
} from './field.js';

// JSON tags of internal/proto.Pose and proto.Photo, in declaration order.
const POSE_KEYS = ['x', 'y', 'z', 'yaw', 'pitch', 'speed', 'move', 'crouch', 'sit', 'focus', 'tool', 'raised', 'fov', 'zoom', 'sharp', 'noise'];
const PHOTO_KEYS = ['x', 'y', 'z', 'yaw', 'pitch', 'fov', 'aspect', 'sharp', 'shake', 'img'];

test('pose rate: 10 Hz in play, 2 Hz otherwise', () => {
  assert.equal(poseInterval('play'), 0.1);
  assert.equal(poseInterval('ui'), 0.5);
  assert.equal(poseInterval('mainmenu'), 0.5);
});

test('pose message shape matches proto.Pose exactly', () => {
  const p = buildPose({
    eye: { x: 1.23456, y: 2, z: -3 }, yaw: -0.5, pitch: 0.2, speed: 2.4, move: 'walk', crouch: false,
    sit: false, focus: true, tool: 'binoculars', raised: true, fov: 8, zoom: 6, sharp: 0.8, noise: 0,
  });
  assert.deepEqual(Object.keys(p), POSE_KEYS);
  assert.equal(p.x, 1.235);
  assert.ok(p.yaw > 0 && p.yaw < Math.PI * 2, 'yaw normalised to a compass heading');
  assert.equal(p.focus, true);
  assert.equal(typeof p.move, 'string');
  const roundTrip = JSON.parse(JSON.stringify(p));
  assert.deepEqual(roundTrip, p);
});

test('pose sanitises bad values', () => {
  const p = buildPose({ eye: { x: 0, y: 0, z: 0 }, move: 'swim', tool: 'net', sharp: 3, noise: -1, zoom: 0 });
  assert.equal(p.move, 'still');
  assert.equal(p.tool, 'none');
  assert.equal(p.sharp, 1);
  assert.equal(p.noise, 0);
  assert.equal(p.zoom, 1);
  assert.equal(p.crouch, false);
});

test('photo message shape matches proto.Photo exactly', () => {
  const ph = buildPhoto({ eye: { x: 1, y: 2, z: 3 }, yaw: 1, pitch: 0.1, fov: 24, aspect: 1.6, sharp: 0.9, shake: 0.2, img: 'data:image/jpeg;base64,xx' });
  assert.deepEqual(Object.keys(ph), PHOTO_KEYS);
  assert.equal(ph.img, 'data:image/jpeg;base64,xx');
  assert.equal(buildPhoto({ eye: { x: 0, y: 0, z: 0 }, shake: 4 }).shake, 1);
});

test('interaction targeting prefers what is in front and near', () => {
  const eye = { x: 0, y: 1.65, z: 0 };
  const list = [
    { id: 'behind', pos: { x: 0, y: 1, z: 2 }, radius: 3 },
    { id: 'ahead', pos: { x: 0.3, y: 1, z: -2 }, radius: 3 },
    { id: 'far', pos: { x: 0, y: 1, z: -30 }, radius: 3 },
  ];
  assert.equal(pickInteractable(list, eye, 0, 0)?.id, 'ahead');
  assert.equal(pickInteractable(list, eye, Math.PI, 0)?.id, 'behind');
  assert.equal(pickInteractable([list[2]], eye, 0, 0), null);
  assert.equal(pickInteractable([], eye, 0, 0), null);
  assert.equal(pickInteractable(undefined, eye, 0, 0), null);
  // Big radius structures (14 m) reach further.
  assert.equal(pickInteractable([{ id: 'cabin', pos: { x: 0, y: 1, z: -12 }, radius: 14 }], eye, 0, 0)?.id, 'cabin');
});

test('region gate', () => {
  assert.ok(regionAllowed(0, [0]));
  assert.ok(!regionAllowed(1, [0]));
  assert.ok(regionAllowed(255, [0]), 'open water is not a region');
  assert.ok(regionAllowed(3, []), 'no data never traps the player');
  const g = { safe: null };
  gateStep(g, { x: 0, z: 0 }, 0, [0], 0.016);
  assert.deepEqual(g.safe, { x: 0, z: 0 });
  // A few metres in is fine…
  let r = gateStep(g, { x: 3, z: 0 }, 1, [0], 0.016);
  assert.equal(r.x, 3);
  assert.equal(r.blocked, false);
  // …further is held near the slack ring.
  r = gateStep(g, { x: 10, z: 0 }, 1, [0], 0.016);
  assert.ok(r.blocked);
  assert.ok(r.x <= GATE_SLACK && r.x > GATE_SLACK - 0.1);
  // Unlocking lets the player through.
  r = gateStep(g, { x: 10, z: 0 }, 1, [0, 1], 0.016);
  assert.equal(r.x, 10);
});

test('sighting tracker: live mystery only while sightings keep coming', () => {
  const tr = createSightingTracker();
  assert.equal(liveMystery(tr, 0), '');
  trackSighting(tr, { bird: 12, mystery: 'm_a' }, 5);
  assert.equal(liveMystery(tr, 5.5), 'm_a');
  assert.equal(liveMystery(tr, 5 + SIGHTING_TTL + 0.1), '');
  trackSighting(tr, { bird: 0, mystery: '' }, 6);
  assert.equal(liveMystery(tr, 6), '');
  trackSighting(tr, { bird: 3, mystery: '', known: 'eurasian_wren' }, 7);
  assert.equal(liveMystery(tr, 7), '');
});

test('film accounting', () => {
  assert.equal(filmLeft({ used: 3, cap: 12 }), 9);
  assert.equal(filmLeft({ used: 3, cap: 12 }, 2), 7);
  assert.ok(outOfFilm({ used: 12, cap: 12 }));
  assert.ok(outOfFilm({ used: 11, cap: 12 }, 1));
  assert.ok(!outOfFilm({ used: 2, cap: 12 }));
  assert.ok(!outOfFilm(undefined));
});

test('carries', () => {
  const p = { inventory: [{ item: 'seed_mix', qty: 2 }, { item: 'film_roll', qty: 0 }] };
  assert.ok(carries(p, 'seed_mix'));
  assert.ok(!carries(p, 'film_roll'));
  assert.ok(!carries(null, 'seed_mix'));
});

test('cinematic drift is slow, continuous and stays near the centre', () => {
  const c = { x: 10, z: -20 };
  let prev = cinematicPose(0, c);
  for (let t = 0.1; t < 200; t += 0.1) {
    const p = cinematicPose(t, c);
    assert.ok(Math.hypot(p.x - c.x, p.z - c.z) <= 26.001);
    assert.ok(Math.hypot(p.x - prev.x, p.z - prev.z) < 0.2, 'no jumps');
    assert.ok(p.lift > 1.5);
    prev = p;
  }
  const k = easeYaw(6.2, 0.1, 0.5);
  assert.ok(k > 6.2 || k < 0.1);
});
