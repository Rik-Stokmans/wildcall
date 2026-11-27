import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStance, nextStance, setStance, stepEye, eyePath, stanceEye, crawlDirFactor, crawlBob,
  settleRoll, tooSteepToLie, indicatorAlpha, PRONE_EYE, CRAWL_SPEED, CRAWL_SIDE, CRAWL_BACK,
} from './stance.js';
import { stepGait, createSprintState, targetSpeed, moveMode, eyeHeightFor, EYE_HEIGHT, CROUCH_EYE, SPEED } from './movement.js';
import { postureFactor, proneRaiseTime } from './optics.js';
import { buildPose, MOVES } from './field.js';

const flat = { grounded: true, depth: 0, slope: 0 };

test('stance keys: stand, crouch, prone and back', () => {
  assert.equal(nextStance('stand', 'crouch', flat), 'crouch');
  assert.equal(nextStance('crouch', 'crouch', flat), 'stand');
  assert.equal(nextStance('stand', 'prone', flat), 'prone');
  assert.equal(nextStance('crouch', 'prone', flat), 'prone');
  assert.equal(nextStance('prone', 'crouch', flat), 'crouch');   // C while prone rises to a crouch
  assert.equal(nextStance('prone', 'prone', flat), 'stand');     // Z again stands up
  assert.equal(nextStance('prone', 'jump', flat), 'stand');      // so does jump
  assert.equal(nextStance('stand', 'jump', flat), 'stand');
});

test('sitting and prone exclude each other', () => {
  assert.equal(nextStance('prone', 'sit', flat), 'sit');
  assert.equal(nextStance('sit', 'prone', flat), 'prone');
  assert.equal(nextStance('sit', 'sit', flat), 'stand');
  assert.equal(nextStance('sit', 'crouch', flat), 'crouch');
});

test('no lying down in water, in the air or on steep ground', () => {
  assert.equal(nextStance('stand', 'prone', { ...flat, depth: 0.3 }), 'stand');
  assert.equal(nextStance('stand', 'prone', { ...flat, depth: 0.15 }), 'prone');
  assert.equal(nextStance('crouch', 'prone', { ...flat, grounded: false }), 'crouch');
  assert.equal(nextStance('stand', 'prone', { ...flat, slope: 0.8 }), 'stand');
  assert.ok(tooSteepToLie(Math.tan(36 * Math.PI / 180)));
  assert.ok(!tooSteepToLie(Math.tan(30 * Math.PI / 180)));
  // Standing up from prone is never refused.
  assert.equal(nextStance('prone', 'prone', { ...flat, depth: 1 }), 'stand');
});

test('eye path: down to prone through a crouch, up again in two stages', () => {
  assert.deepEqual(eyePath('stand', 'prone'), [CROUCH_EYE, PRONE_EYE]);
  assert.deepEqual(eyePath('prone', 'stand'), [CROUCH_EYE, EYE_HEIGHT]);
  assert.deepEqual(eyePath('crouch', 'prone'), [PRONE_EYE]);
  assert.deepEqual(eyePath('prone', 'crouch'), [CROUCH_EYE]);
  assert.equal(stanceEye('prone'), 0.35);
  assert.equal(eyeHeightFor(false, false, true), 0.35);
});

test('stepEye is smooth (no snap), passes the crouch and settles at 0.35 m', () => {
  const st = createStance();
  let eye = EYE_HEIGHT;
  assert.ok(setStance(st, 'prone', 0, eye));
  assert.ok(!setStance(st, 'prone', 0, eye));
  let minStep = Infinity, maxStep = 0, lowest = eye, passedCrouch = false;
  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) {
    const next = stepEye(st, eye, dt);
    const d = eye - next;
    maxStep = Math.max(maxStep, d);
    if (d > 1e-4) minStep = Math.min(minStep, d);
    if (Math.abs(next - CROUCH_EYE) < 0.1) passedCrouch = true;
    eye = next; lowest = Math.min(lowest, eye);
  }
  assert.ok(passedCrouch);
  assert.ok(maxStep < 0.15, `largest per-frame drop ${maxStep}`);   // never a snap
  assert.ok(Math.abs(eye - PRONE_EYE) < 0.01, `settled at ${eye}`);
  assert.ok(lowest >= PRONE_EYE - 1e-6);                            // no overshoot
  // And back up in two stages.
  setStance(st, 'stand', 3, eye);
  assert.equal(st.path.length, 2);
  for (let i = 0; i < 240; i++) eye = stepEye(st, eye, dt);
  assert.ok(Math.abs(eye - EYE_HEIGHT) < 0.01);
});

test('Z from a crouch skips the crouch waypoint', () => {
  const st = createStance();
  setStance(st, 'crouch', 0, EYE_HEIGHT);
  setStance(st, 'prone', 1, CROUCH_EYE);
  assert.deepEqual(st.path, [PRONE_EYE]);
  assert.equal(st.changedAt, 1);
});

test('crawling: 0.7 m/s forward, slower sideways and back, no sprint', () => {
  assert.equal(CRAWL_SPEED, 0.7);
  assert.equal(SPEED.crawl, 0.7);
  assert.equal(targetSpeed('crawl'), 0.7);
  assert.equal(crawlDirFactor(1, 0), 1);
  assert.equal(crawlDirFactor(0, 1), CRAWL_SIDE);
  assert.equal(crawlDirFactor(-1, 0), CRAWL_BACK);
  assert.equal(crawlDirFactor(0, 0), 0);
  assert.ok(crawlDirFactor(1, 1) < 1 && crawlDirFactor(1, 1) > CRAWL_SIDE);
  const sp = createSprintState();
  sp.armed = true;
  assert.equal(stepGait(sp, { moving: true, runHeld: true, prone: true }, 0.1, 6), 'crawl');
  assert.equal(sp.sprinting, false);
  assert.equal(moveMode(0.7, 'crawl', false, false, true), 'crawl');
  assert.equal(moveMode(0.05, 'crawl', false, false, true), 'still');
});

test('crawl sway is gentle and slower than a walk', () => {
  const b = crawlBob(0.7, false);
  assert.ok(b.amp > 0 && b.amp < 0.03 && b.freq > 0 && b.freq < 1.2 && b.roll <= 0.03);
  assert.deepEqual(crawlBob(0, false), { amp: 0, freq: 0, roll: 0 });
  assert.ok(crawlBob(0.7, true).amp < b.amp);
  assert.ok(Math.abs(settleRoll(10)) <= 0.025 && Math.abs(settleRoll(-10)) <= 0.025 && settleRoll(0) === 0);
});

test('tools are steadiest prone and a touch slower to raise', () => {
  assert.ok(postureFactor({ prone: true }) < postureFactor({ crouching: true }));
  assert.ok(postureFactor({ prone: true }) < postureFactor({ sitting: true }));
  assert.ok(proneRaiseTime(0.4, true) > 0.4 && proneRaiseTime(0.4, true) < 0.7);
  assert.equal(proneRaiseTime(0.4, false), 0.4);
});

test('pose carries prone and the crawl', () => {
  assert.ok(MOVES.includes('crawl'));
  const p = buildPose({ eye: { x: 0, y: 0.35, z: 0 }, move: 'crawl', prone: true, fov: 70 });
  assert.equal(p.prone, true);
  assert.equal(p.move, 'crawl');
  assert.equal(buildPose({ eye: { x: 0, y: 0, z: 0 }, fov: 70 }).prone, false);
});

test('stance indicator fades out a few seconds after a change', () => {
  assert.equal(indicatorAlpha(0), 1);
  assert.equal(indicatorAlpha(2), 1);
  assert.ok(indicatorAlpha(3) > 0 && indicatorAlpha(3) < 1);
  assert.equal(indicatorAlpha(4), 0);
  assert.equal(indicatorAlpha(Infinity), 0);
  assert.equal(indicatorAlpha(NaN), 0);
});
