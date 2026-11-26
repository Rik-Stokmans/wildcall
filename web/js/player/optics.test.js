import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zoomRange, clampZoom, wheelZoom, fovFor, sensitivityScale, raiseTime, swayAmplitude,
  postureFactor, swayOffset, shakeAmount, sharpness, stepFocus, blurPx, lowLightBrightness,
  binoMask, focusState, FOCUS_SPAN,
} from './optics.js';

const base = { binoZoom: 6, binoFov: 48, binoStability: 0.35, binoFocus: 1.2, binoClarity: 0.5, binoWeight: 0.6, lowLight: 0.2, camZoom: 3, camStability: 0.4, camFocus: 1, camReady: 0.6, longLens: 0 };

test('zoom ranges follow the stats', () => {
  assert.deepEqual(zoomRange('binoculars', base), [4, 6]);
  assert.deepEqual(zoomRange('binoculars', { ...base, binoZoom: 10 }), [4, 10]);
  assert.deepEqual(zoomRange('binoculars', { ...base, binoZoom: 3 }), [3, 3]);
  assert.deepEqual(zoomRange('camera', base), [1, 3]);
  assert.deepEqual(zoomRange('none', base), [1, 1]);
  assert.equal(clampZoom('binoculars', 20, base), 6);
  assert.equal(clampZoom('camera', 0.2, base), 1);
});

test('wheel zoom: scroll up zooms in, clamped', () => {
  const z = wheelZoom('binoculars', 4, -100, base);
  assert.ok(z > 4 && z <= 6);
  assert.equal(wheelZoom('binoculars', 6, -500, base), 6);
  assert.ok(wheelZoom('camera', 2, 100, base) < 2);
});

test('true field of view = binoFov / zoom; higher zoom is narrower', () => {
  assert.equal(fovFor('binoculars', 6, base, 70), 8);
  assert.equal(fovFor('binoculars', 4, base, 70), 12);
  assert.ok(fovFor('binoculars', 10, { ...base, binoZoom: 10 }, 70) < fovFor('binoculars', 6, base, 70));
  assert.equal(fovFor('none', 1, base, 75), 75);
  assert.equal(fovFor('recorder', 1, base, 70), 70);
  assert.ok(Math.abs(fovFor('camera', 1, base, 70) - 70) < 1e-9);
  const cam3 = fovFor('camera', 3, base, 70);
  assert.ok(cam3 < 30 && cam3 > 20);
  // Wider apparent field binoculars show more at the same magnification.
  assert.ok(fovFor('binoculars', 6, { ...base, binoFov: 60 }, 70) > 8);
});

test('mouse sensitivity scales with the field of view', () => {
  assert.equal(sensitivityScale(70, 70), 1);
  assert.ok(Math.abs(sensitivityScale(7, 70) - 0.1) < 1e-9);
});

test('raise time follows weight and camReady', () => {
  assert.ok(raiseTime('binoculars', { ...base, binoWeight: 1.2 }) > raiseTime('binoculars', base));
  assert.equal(raiseTime('camera', { ...base, camReady: 0.9 }), 0.9);
});

test('sway grows with zoom, shrinks with stability and a braced posture', () => {
  const s4 = swayAmplitude('binoculars', 4, base);
  const s6 = swayAmplitude('binoculars', 6, base);
  assert.ok(s6 > s4);
  // Visible sway (relative to the field) grows much faster than the angle itself.
  assert.ok(s6 / fovFor('binoculars', 6, base) > 1.4 * (s4 / fovFor('binoculars', 4, base)));
  assert.ok(swayAmplitude('binoculars', 6, { ...base, binoStability: 0.9 }) < s6 * 0.5);
  assert.ok(swayAmplitude('binoculars', 6, { ...base, binoWeight: 1.4 }) > s6);
  assert.ok(swayAmplitude('binoculars', 6, base, { crouching: true }) < s6);
  assert.ok(swayAmplitude('binoculars', 6, base, { sitting: true }) < swayAmplitude('binoculars', 6, base, { crouching: true }));
  assert.ok(swayAmplitude('binoculars', 6, base, { stillTime: 5 }) < s6);
  assert.ok(swayAmplitude('binoculars', 6, base, { speed: 2.4 }) > s6);
  assert.equal(swayAmplitude('none', 1, base), 0);
});

test('camera shake: long lens removes zoom-induced shake', () => {
  const plain = swayAmplitude('camera', 3, base);
  const ll = swayAmplitude('camera', 3, { ...base, longLens: 1 });
  assert.ok(ll < plain);
  assert.ok(Math.abs(ll - swayAmplitude('camera', 1, base)) < 1e-9);
});

test('posture factor', () => {
  assert.equal(postureFactor({}), 1);
  assert.ok(postureFactor({ sitting: true }) < postureFactor({ crouching: true }));
});

test('sway offsets stay within amplitude and vary over time', () => {
  let max = 0;
  const seen = new Set();
  for (let t = 0; t < 30; t += 0.05) {
    const o = swayOffset(t, 0.2);
    max = Math.max(max, Math.abs(o.yaw), Math.abs(o.pitch));
    seen.add(o.yaw.toFixed(3));
  }
  assert.ok(max <= 0.2 + 1e-9);
  assert.ok(seen.size > 50);
  assert.deepEqual(swayOffset(3, 0), { yaw: 0, pitch: 0 });
});

test('shake amount', () => {
  assert.equal(shakeAmount(0, 20, 0), 0);
  assert.ok(shakeAmount(0.5, 8, 0) > shakeAmount(0.5, 25, 0));
  assert.ok(shakeAmount(0.1, 20, 3) > shakeAmount(0.1, 20, 0));
  assert.ok(shakeAmount(10, 2, 6) <= 1);
});

test('sharpness: exact focus is sharp, depth of field narrows with zoom', () => {
  assert.equal(sharpness(20, 20, 6), 1);
  assert.ok(sharpness(20, 30, 4) > sharpness(20, 30, 10));
  assert.ok(sharpness(5, 80, 6) < 0.05);
});

test('focus eases at the stat speed: a full refocus takes 1/speed seconds', () => {
  const from = 3, to = 3 * Math.exp(FOCUS_SPAN);
  let f = from, t = 0;
  while (f < to - 1e-6 && t < 10) { f = stepFocus(f, to, 1.2, 1 / 60); t += 1 / 60; }
  assert.ok(Math.abs(t - 1 / 1.2) < 0.05, `took ${t}`);
  // Faster focus speed catches up sooner.
  const slow = stepFocus(3, 60, 1, 0.2), fast = stepFocus(3, 60, 2.5, 0.2);
  assert.ok(fast > slow);
  // Never overshoots.
  assert.ok(Math.abs(stepFocus(10, 11, 5, 1) - 11) < 1e-9);
  // Sharpness eases toward 1 as focus catches up.
  let s0 = sharpness(3, 40, 6), focus = 3;
  for (let i = 0; i < 10; i++) {
    focus = stepFocus(focus, 40, 1.2, 0.05);
    const s1 = sharpness(focus, 40, 6);
    assert.ok(s1 >= s0 - 1e-12);
    s0 = s1;
  }
});

test('blur and low light', () => {
  assert.equal(blurPx(1), 0);
  assert.ok(blurPx(0.2) > blurPx(0.6));
  assert.ok(blurPx(0.2, 0) > blurPx(0.2, 1));
  assert.equal(lowLightBrightness(1, 0), 1);
  assert.ok(lowLightBrightness(0, 0) < lowLightBrightness(0, 1));
  assert.equal(lowLightBrightness(0, 1), 1);
});

test('mask edge softness from clarity', () => {
  assert.ok(binoMask(0).feather > binoMask(1).feather);
  assert.equal(focusState(0.95), 'locked');
  assert.equal(focusState(0.6), 'near');
  assert.equal(focusState(0.1), 'hunting');
});
