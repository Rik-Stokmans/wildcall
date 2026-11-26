import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEED, createSprintState, runKeyDown, runKeyUp, stepGait, targetSpeed, terrainFactor,
  tooSteep, approachVelocity, moveMode, eyeHeightFor, bobParams, waterPushBack,
  refuseWaterStep, MAX_WADE, DOUBLE_TAP,
} from './movement.js';

const moving = { moving: true, runHeld: true, crouching: false };

test('pinned speeds', () => {
  assert.equal(SPEED.walk, 2.4);
  assert.equal(SPEED.run, 4.4);
  assert.equal(SPEED.sprint, 6.5);
  assert.equal(SPEED.crouch, 1.2);
});

test('holding run without a double tap runs, never sprints', () => {
  const s = createSprintState();
  runKeyDown(s, 10);
  assert.equal(stepGait(s, moving, 0.1, 6), 'run');
  assert.equal(s.stamina, 1);
});

test('double tap and hold sprints and drains stamina over stats.stamina seconds', () => {
  const s = createSprintState();
  runKeyDown(s, 10); runKeyUp(s); runKeyDown(s, 10 + DOUBLE_TAP * 0.5);
  assert.equal(stepGait(s, moving, 1, 6), 'sprint');
  assert.ok(Math.abs(s.stamina - 5 / 6) < 1e-9);
  // Longer stamina stat drains slower.
  const s2 = createSprintState();
  runKeyDown(s2, 0); runKeyDown(s2, 0.1);
  stepGait(s2, moving, 1, 12);
  assert.ok(s2.stamina > s.stamina);
});

test('slow second tap does not arm the sprint', () => {
  const s = createSprintState();
  runKeyDown(s, 0); runKeyUp(s); runKeyDown(s, DOUBLE_TAP + 0.2);
  assert.equal(stepGait(s, moving, 0.1, 6), 'run');
});

test('empty stamina falls back to run, recovers, and needs a new double tap', () => {
  const s = createSprintState();
  runKeyDown(s, 0); runKeyDown(s, 0.1);
  let g;
  for (let i = 0; i < 70; i++) g = stepGait(s, moving, 0.1, 6);
  assert.equal(g, 'run');
  assert.ok(s.stamina < 0.1, 'drained (a little recovery while jogging on is fine)');
  assert.ok(s.exhausted);
  // Resting recovers stamina.
  for (let i = 0; i < 60; i++) stepGait(s, { moving: false, runHeld: false }, 0.1, 6);
  assert.ok(s.stamina > 0.33);
  // Still holding Shift (no new tap) keeps running.
  assert.equal(stepGait(s, moving, 0.1, 6), 'run');
  runKeyUp(s); runKeyDown(s, 50); runKeyDown(s, 50.1);
  assert.equal(stepGait(s, moving, 0.1, 6), 'sprint');
});

test('stamina does not recover instantly after sprinting', () => {
  const s = createSprintState();
  runKeyDown(s, 0); runKeyDown(s, 0.1);
  stepGait(s, moving, 1, 6);
  const after = s.stamina;
  runKeyUp(s);
  stepGait(s, { moving: true, runHeld: false }, 0.3, 6);
  assert.equal(s.stamina, after);
});

test('crouch overrides gait and blocks sprinting', () => {
  const s = createSprintState();
  runKeyDown(s, 0); runKeyDown(s, 0.1);
  assert.equal(stepGait(s, { ...moving, crouching: true }, 0.1, 6), 'crouch');
  assert.equal(s.stamina, 1);
});

test('target speed multipliers', () => {
  assert.equal(targetSpeed('walk'), 2.4);
  assert.ok(Math.abs(targetSpeed('walk', { moveSpeed: 1.1 }) - 2.64) < 1e-9);
  assert.ok(Math.abs(targetSpeed('run', { focus: true }) - 4.4 * 0.4) < 1e-9);
  assert.ok(targetSpeed('sprint', { raised: true }) <= 2.4);
  assert.ok(targetSpeed('walk', { terrainFactor: 0.5 }) < 2.4);
});

test('terrain slowdown and stats.terrain reduction', () => {
  assert.equal(terrainFactor({}), 1);
  assert.equal(terrainFactor({ grade: -0.5 }), 1, 'downhill is not slowed');
  const steep = terrainFactor({ grade: 0.5 });
  assert.ok(steep < 0.7 && steep > 0.2);
  const water = terrainFactor({ depth: 0.8 });
  assert.ok(water < 0.75);
  const scrub = terrainFactor({ shrub: 1 });
  assert.ok(scrub < 0.7);
  const trained = terrainFactor({ grade: 0.5, terrain: 0.5 });
  assert.ok(trained > steep);
  assert.equal(terrainFactor({ grade: 0.5, depth: 1, shrub: 1, terrain: 1 }), 1);
  assert.ok(terrainFactor({ grade: 0.6, depth: 1.2, shrub: 1 }) >= 0.2);
});

test('steep ground', () => {
  assert.ok(!tooSteep(0.3));
  assert.ok(tooSteep(0.9));
});

test('velocity approach is smooth and converges', () => {
  let v = 0;
  for (let i = 0; i < 60; i++) v = approachVelocity(v, 2.4, 1 / 60, true);
  assert.ok(v > 2.3 && v <= 2.4);
  const half = approachVelocity(0, 2.4, 1 / 60, true);
  assert.ok(half > 0 && half < 0.5, 'no instant snap');
});

test('move mode classification', () => {
  assert.equal(moveMode(0.05, 'run', false, false), 'still');
  assert.equal(moveMode(2, 'walk', false, true), 'still');
  assert.equal(moveMode(1, 'crouch', true, false), 'crouch');
  assert.equal(moveMode(2.4, 'walk', false, false), 'walk');
  assert.equal(moveMode(4.4, 'run', false, false), 'run');
  assert.equal(moveMode(6.5, 'sprint', false, false), 'sprint');
});

test('eye heights and head bob', () => {
  assert.equal(eyeHeightFor(false, false), 1.65);
  assert.equal(eyeHeightFor(true, false), 1.0);
  assert.ok(eyeHeightFor(false, true) < 1.0);
  assert.deepEqual(bobParams(0, false, false), { amp: 0, freq: 0 });
  const walk = bobParams(2.4, false, false), run = bobParams(4.4, false, false);
  assert.ok(run.amp > walk.amp && run.freq > walk.freq);
  assert.ok(run.amp <= 0.06);
  assert.ok(bobParams(2.4, false, true).amp < walk.amp);
});

test('wading and deep water', () => {
  assert.equal(waterPushBack(0.5), 0);
  assert.equal(waterPushBack(MAX_WADE), 0);
  assert.ok(waterPushBack(1.5) > 0);
  assert.ok(!refuseWaterStep(0.2, 1.0));
  assert.ok(refuseWaterStep(1.0, 1.4));
  assert.ok(!refuseWaterStep(1.6, 1.4), 'stepping out of deep water is allowed');
});
