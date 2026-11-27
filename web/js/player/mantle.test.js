import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findLedge, mantlePose, mantleDuration, pushClimb, collectTops, topAt, weatherSlow, windSway, MANTLE_MAX, MANTLE_HOLD,
} from './mantle.js';
import { toolSlot, missingToolText } from './field.js';

// A world that is flat at 0 with a step of height `h` starting `at` metres north (-z).
const step = (h, at = 0.6, depth = 3) => (x, z) => (-z >= at && -z < at + depth ? h : 0);
const north = { x: 0, z: -1 };
const feet = { x: 0, y: 0, z: 0 };

test('mantle: climbs a ledge between a step and ~1.2 m with room on top', () => {
  const to = findLedge(feet, north, step(1.0));
  assert.ok(to);
  assert.ok(Math.abs(to.y - 1.0) < 1e-9);
  assert.ok(to.z < -0.6, 'lands on top, beyond the edge');
  assert.ok(Math.abs(to.rise - 1.0) < 1e-9);
  assert.equal(findLedge(feet, north, step(0.4)), null, 'a step is just walked up');
  assert.equal(findLedge(feet, north, step(MANTLE_MAX + 0.2)), null, 'too high');
  assert.equal(findLedge(feet, north, step(1.0, 0.6, 0.3)), null, 'a thin wall has no standing room');
  assert.equal(findLedge(feet, { x: 0, z: 0 }, step(1)), null);
  assert.equal(findLedge(feet, north, null), null);
});

test('mantle: never climbs a cliff or a steady steep slope', () => {
  // a ledge whose top keeps rising: a cliff face
  const cliff = (x, z) => Math.max(0, (-z - 0.5) * 2.2);
  assert.equal(findLedge(feet, north, cliff), null);
  // the probes must not see far above the reach
  const seen = [];
  findLedge(feet, north, (x, z, y) => { seen.push(y); return 0; });
  assert.ok(seen.every((y) => y < MANTLE_MAX + 0.1));
  // unloaded ground ahead
  assert.equal(findLedge(feet, north, () => NaN), null);
});

test('mantle pose rises first, then rolls over the top', () => {
  const from = { x: 0, y: 0, z: 0 }, to = { x: 0, y: 1, z: -1.2 };
  const a = mantlePose(0, from, to), mid = mantlePose(0.6, from, to), end = mantlePose(1, from, to);
  assert.deepEqual(a, { x: 0, y: 0, z: 0 });
  assert.ok(mid.y > 1 && mid.z > -0.4, 'up first, barely forward');
  assert.ok(Math.abs(end.y - 1) < 1e-9 && Math.abs(end.z + 1.2) < 1e-9);
  assert.ok(mantleDuration(0.6) < mantleDuration(1.2));
});

test('holding forward against a ledge starts the climb after a moment', () => {
  let s = { pushT: 0, go: false };
  for (let i = 0; i < 10 && !s.go; i++) s = pushClimb(s.pushT, 1, 0.1, true, 0.05);
  assert.equal(s.go, true);
  assert.ok(s.pushT >= MANTLE_HOLD);
  assert.deepEqual(pushClimb(0.3, 1, 2.4, true, 0.05), { pushT: 0, go: false }, 'walking freely resets');
  assert.deepEqual(pushClimb(0.3, 0, 0, true, 0.05), { pushT: 0, go: false }, 'not pushing forward');
  assert.deepEqual(pushClimb(0.3, 1, 0, false, 0.05), { pushT: 0, go: false }, 'airborne');
});

test('rock and stump tops: only the solid ones, at their model heights', () => {
  const veg = [
    { kind: 6, x: 2, y: 1, z: 0, scale: 1 },     // boulder
    { kind: 6, x: 3, y: 0, z: 0, scale: 0.6 },   // pebble: walked through, not stood on
    { kind: 10, x: -2, y: 0, z: 0, scale: 1 },   // stump
    { kind: 0, x: 0, y: 0, z: 2, scale: 1 },     // oak: never
    { kind: 6, x: 50, y: 0, z: 0, scale: 1 },    // too far
  ];
  const tops = collectTops(veg, 0, 0, 10);
  assert.equal(tops.length, 2);
  assert.ok(Math.abs(tops[0].y - 1.84) < 1e-9);
  assert.equal(topAt(tops, 2, 0, 1.5).x, 2);
  assert.equal(topAt(tops, 2, 0, 0.5), null, 'out of step reach from the ground');
  assert.equal(topAt(tops, 2.6, 0, 1.5), null, 'off the edge');
  // a boulder is climbable by findLedge through a support that includes its top
  const support = (x, z, y) => Math.max(0, topAt(tops, x, z, y)?.y ?? 0);
  const onto = findLedge({ x: 1.15, y: 1, z: 0 }, { x: 1, z: 0 }, (x, z, y) => Math.max(1, support(x, z, y)));
  assert.ok(onto && Math.abs(onto.y - 1.84) < 1e-9);
});

test('weather slows the walk slightly unless rain gear covers it; wind sways optics', () => {
  assert.equal(weatherSlow({ rain: 0, wind: 0.2 }), 1);
  assert.ok(Math.abs(weatherSlow({ rain: 0.8 }) - 0.92) < 1e-9);
  assert.ok(Math.abs(weatherSlow({ wind: 0.9 }) - 0.92) < 1e-9);
  assert.equal(weatherSlow({ rain: 0.8 }, 1), 1);
  assert.ok(weatherSlow({ rain: 0.8 }, 0.5) > 0.95);
  assert.equal(weatherSlow(null), 1);
  assert.equal(windSway(0), 1);
  assert.ok(windSway(1) > 1.8 && windSway(0.5) < windSway(1));
});

test('instruments need their equipment slot', () => {
  assert.equal(toolSlot('binoculars'), 'optics');
  assert.equal(toolSlot('recorder'), 'audio');
  assert.equal(toolSlot('none'), '');
  assert.match(missingToolText('camera'), /No camera equipped/);
});
