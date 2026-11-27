import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHolster, stepHolster, DRAW_TIME, STOW_TIME, drawOffset, easeOutBack, liftAmount, rigAlpha,
  overlayAlpha, FADE_END, POSE_END, stepRaise, strideFreq, bobAmp, bobOffsetHands, breathe, wrapAngle,
  lagTarget, pressCurve, PRESS_TIME, recoilCurve, ledLevels, smoothstep, damp,
} from './anim.js';
import { binoLook, cameraLook, audioLook, armLook, lookKey, slotOf } from './looks.js';

const run = (h, want, seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) stepHolster(h, want, dt);
  return h;
};

test('holster draws a tool up over DRAW_TIME', () => {
  const h = createHolster();
  stepHolster(h, 'camera|a', 1 / 60);
  assert.equal(h.shown, 'camera|a');
  assert.ok(h.draw > 0 && h.draw < 0.1);
  run(h, 'camera|a', DRAW_TIME * 0.5);
  assert.ok(h.draw > 0.4 && h.draw < 0.6, `half way: ${h.draw}`);
  run(h, 'camera|a', DRAW_TIME);
  assert.equal(h.draw, 1);
});

test('switching tools puts the old one away first, then draws the new one', () => {
  const h = run(createHolster(), 'binoculars|x', 1);
  stepHolster(h, 'camera|y', 1 / 60);
  assert.equal(h.shown, 'binoculars|x', 'still holding the old tool while it goes down');
  assert.ok(h.draw < 1);
  run(h, 'camera|y', STOW_TIME * 0.6);
  assert.equal(h.shown, 'binoculars|x');
  run(h, 'camera|y', STOW_TIME * 0.45);
  assert.equal(h.shown, 'camera|y');
  assert.ok(h.draw < 0.3);
  run(h, 'camera|y', DRAW_TIME + 0.05);
  assert.equal(h.draw, 1);
});

test('quick re-selections queue: only the last choice is drawn', () => {
  const h = run(createHolster(), 'binoculars|x', 1);
  run(h, 'camera|y', 0.05);
  run(h, 'recorder|z', 0.05);
  run(h, 'camera|y', STOW_TIME);
  assert.equal(h.shown, 'camera|y');
  // Going back to the tool already in hand mid-stow just raises it again.
  const g = run(createHolster(), 'binoculars|x', 1);
  run(g, 'none', 0.08);
  const d = g.draw;
  run(g, 'binoculars|x', 0.05);
  assert.equal(g.shown, 'binoculars|x');
  assert.ok(g.draw > d);
});

test('putting away leaves nothing in the hands', () => {
  const h = run(createHolster(), 'recorder|r', 1);
  run(h, 'none', STOW_TIME + 0.05);
  assert.equal(h.shown, 'none');
  assert.equal(h.draw, 0);
  stepHolster(h, 'none', 1 / 60);
  assert.equal(h.changed, false);
});

test('changed fires exactly once per switch', () => {
  const h = createHolster();
  let n = 0;
  for (let i = 0; i < 120; i++) { stepHolster(h, i < 60 ? 'a' : 'b', 1 / 60); if (h.changed) n++; }
  assert.equal(n, 2);
});

test('draw offset: below the view when away, settles with a small overshoot', () => {
  assert.ok(drawOffset(0).y < -0.3);
  assert.ok(Math.abs(drawOffset(1).y) < 1e-9);
  let peak = 0;
  for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, easeOutBack(t));
  assert.ok(peak > 1.02 && peak < 1.12, `overshoot ${peak}`);
  // Stowing has no overshoot and starts slowly.
  assert.ok(drawOffset(0.9, true).y > -0.01);
  assert.ok(drawOffset(0.2, true).y < -0.2);
});

test('raise: the rig fades out as the overlay fades in, and is gone before a photo is possible', () => {
  assert.equal(rigAlpha(0), 1);
  assert.equal(rigAlpha(FADE_END), 0);
  assert.equal(rigAlpha(0.9), 0, 'tools.js shoots at raiseAmount >= 0.9');
  // The crossover: somewhere in the middle both are about half.
  let cross = -1;
  for (let r = 0; r <= 1; r += 0.01) if (cross < 0 && overlayAlpha(r) >= rigAlpha(r)) cross = r;
  assert.ok(cross > 0.35 && cross < 0.6, `crossover at ${cross}`);
  // Monotonic.
  for (let r = 0; r < 1; r += 0.05) assert.ok(rigAlpha(r + 0.05) <= rigAlpha(r) + 1e-9);
  // The lift arrives at the eye just after the fade completes.
  assert.equal(liftAmount(0), 0);
  assert.equal(liftAmount(POSE_END), 1);
  assert.ok(POSE_END >= FADE_END);
  assert.ok(liftAmount(0.3) > 0.1 && liftAmount(0.3) < 0.6);
});

test('raise timing follows the tool raise time, lowering is quicker', () => {
  let r = 0, n = 0;
  while (r < 1 && n < 1000) { r = stepRaise(r, true, 0.4, 1 / 60); n++; }
  assert.ok(Math.abs(n / 60 - 0.4) < 0.03, `up in ${n / 60}s`);
  n = 0;
  while (r > 0 && n < 1000) { r = stepRaise(r, false, 0.4, 1 / 60); n++; }
  assert.ok(Math.abs(n / 60 - 0.24) < 0.03, `down in ${n / 60}s`);
});

test('stride matches the head bob cadence; bob grows with speed and shrinks when raised', () => {
  assert.equal(strideFreq(0), 0);
  const walk = strideFreq(2.4), runF = strideFreq(4.4);
  assert.ok(walk > 0.8 && walk < 1.2, `walk ${walk}`);
  assert.ok(runF > walk);
  assert.ok(bobAmp(4.4) > bobAmp(2.4));
  assert.ok(bobAmp(2.4, { raised: 1 }) < bobAmp(2.4) * 0.3);
  assert.ok(bobAmp(2.4, { crouching: true }) < bobAmp(2.4));
  const o = { x: 0, y: 0, rz: 0 };
  bobOffsetHands(0, 0.01, o);
  const atStep = o.y;
  bobOffsetHands(0.25, 0.01, o);
  assert.ok(o.y > atStep, 'lowest at the footfall');
});

test('breathing is small and centred', () => {
  const o = { x: 0, y: 0, rx: 0 };
  let max = 0, sum = 0;
  for (let t = 0; t < 30; t += 0.05) { breathe(t, 1, o); max = Math.max(max, Math.abs(o.y)); sum += o.y; }
  assert.ok(max > 0.001 && max < 0.006);
  assert.ok(Math.abs(sum / 600) < 0.0005);
});

test('turn lag trails the look and is clamped', () => {
  assert.ok(lagTarget(2) < 0);
  assert.ok(lagTarget(-2) > 0);
  assert.equal(lagTarget(1000), -0.09);
  assert.ok(Math.abs(wrapAngle(Math.PI * 2 - 0.1) + 0.1) < 1e-9);
  assert.ok(Math.abs(wrapAngle(-Math.PI * 2 + 0.1) - 0.1) < 1e-9);
});

test('shutter press and recoil are short one-shots', () => {
  assert.equal(pressCurve(-1), 0);
  assert.ok(pressCurve(0.05) > 0.95);
  assert.equal(pressCurve(PRESS_TIME + 0.01), 0);
  assert.ok(recoilCurve(0.03) > recoilCurve(0.3));
  assert.equal(recoilCurve(1), 0);
});

test('LEDs light by level', () => {
  const out = [0, 0, 0, 0];
  assert.deepEqual(ledLevels(0, 4, out), [0, 0, 0, 0]);
  assert.deepEqual(ledLevels(1, 4, out), [1, 1, 1, 1]);
  ledLevels(0.5, 4, out);
  assert.deepEqual(out, [1, 1, 0, 0]);
  assert.ok(smoothstep(0, 1, 0.5) === 0.5);
  assert.ok(damp(10, 0) === 0 && damp(10, 1) > 0.99);
});

test('looks follow the equipped item', () => {
  assert.ok(binoLook('basic_binoculars').size < binoLook('explorer_binoculars').size);
  assert.ok(binoLook('explorer_binoculars').rubber);
  assert.ok(binoLook('historical_binoculars').brass);
  assert.equal(binoLook('spotting_scope').kind, 'scope');
  assert.equal(binoLook('unknown', { tier: 3 }).rubber, true);
  assert.ok(cameraLook('telephoto_camera').lens > cameraLook('starter_camera').lens);
  assert.equal(cameraLook('vintage_camera').style, 'rangefinder');
  assert.equal(audioLook('parabolic_microphone').kind, 'dish');
  assert.equal(audioLook('directional_microphone').kind, 'shotgun');
  assert.equal(audioLook('vintage_recorder').kind, 'vintage');
  assert.equal(audioLook('mystery', { icon: 'microphone' }).kind, 'shotgun');
  assert.notEqual(armLook('rain_shell').sleeve, armLook('field_clothes').sleeve);
  assert.ok(armLook('camouflage_smock').mottle);
  assert.equal(lookKey('none', 'x'), 'none');
  assert.notEqual(lookKey('camera', 'a', 'c'), lookKey('camera', 'b', 'c'));
  assert.equal(slotOf('binoculars'), 'optics');
  assert.equal(slotOf('recorder'), 'audio');
});
