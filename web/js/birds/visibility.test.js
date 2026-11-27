import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exaggeration, apparentPx, refPixelAngle, plumageLift, outlineStyle, leafCut, windowStrength, updateLook,
  pickNearest, motionBoost, windowDepth, nearDepth, EXAG, WINDOW, STRENGTH,
} from './visibility.js';
import { ACT, FLAG } from './constants.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('exaggeration: ~1.35x close up, rising smoothly to ~2.2-2.3x at 30-60 m for a small songbird', () => {
  const robin = 0.14;
  assert.ok(near(exaggeration(robin, 2, 70), EXAG.near, 0.02), 'close up');
  const e30 = exaggeration(robin, 30, 70), e60 = exaggeration(robin, 60, 70);
  assert.ok(e30 > 2.15 && e30 <= EXAG.far + 1e-9, `30 m: ${e30}`);
  assert.ok(e60 > 2.15 && e60 <= EXAG.far + 1e-9, `60 m: ${e60}`);
  // Monotonic and smooth: no step bigger than a few percent per metre.
  let prev = exaggeration(robin, 1, 70);
  for (let d = 1.5; d <= 80; d += 0.5) {
    const e = exaggeration(robin, d, 70);
    assert.ok(e >= prev - 1e-9, `monotonic at ${d}`);
    assert.ok(e - prev < 0.06, `smooth at ${d}`);
    prev = e;
  }
});

test('exaggeration: large birds stay near true size', () => {
  assert.ok(exaggeration(0.9, 5, 70) < 1.06, 'heron close');
  assert.ok(exaggeration(0.9, 60, 70) < 1.2, 'heron far');
  assert.ok(exaggeration(0.4, 40, 70) < exaggeration(0.14, 40, 70), 'pigeon less than robin');
});

test('exaggeration follows apparent size: binoculars do not double-exaggerate', () => {
  // 8x binoculars: the vertical FOV whose tangent is 8x narrower.
  const fov8 = (2 * Math.atan(Math.tan((70 * Math.PI) / 360) / 8) * 180) / Math.PI;
  // A robin at 40 m through 8x looks like one at 5 m with the naked eye.
  assert.ok(near(exaggeration(0.14, 40, fov8), exaggeration(0.14, 5, 70), 1e-6));
  assert.ok(exaggeration(0.14, 40, fov8) < 1.5);
  assert.ok(near(apparentPx(0.14, 40, fov8), apparentPx(0.14, 5, 70), 1e-6));
});

test('drawn songbird size at 1280x720 with the naked eye', () => {
  const px = (L, d) => (L * exaggeration(L, d, 70)) / d / refPixelAngle(70);
  assert.ok(px(0.12, 20) > 6.5, `12 cm at 20 m: ${px(0.12, 20)}`);
  assert.ok(px(0.12, 20) > 2 * 0.12 / 20 / refPixelAngle(70));
});

test('plumage lift: lighter and a little richer, whites stay white, hue kept', () => {
  const out = plumageLift([0.1, 0.1, 0.1]);
  assert.ok(out[0] > 0.1 && out[0] < 0.25, 'black lifts gently');
  assert.deepEqual(plumageLift([1, 1, 1]), [1, 1, 1]);
  const red = plumageLift([0.8, 0.3, 0.15]);
  assert.ok(red[0] > red[1] && red[1] > red[2], 'hue order kept');
  for (const c of plumageLift([1, 0, 0])) assert.ok(c >= 0 && c <= 1);
});

test('outline: strongest small, gone close up, faint at night, softer in flight', () => {
  const small = outlineStyle(6, 25, 1, false, {});
  const big = outlineStyle(80, 3, 1, false, {});
  assert.ok(small.alpha > 0.4, 'small birds get an edge');
  assert.ok(big.alpha < 0.01, 'close-up birds do not');
  assert.ok(outlineStyle(6, 25, 0, false, {}).alpha < small.alpha * 0.5, 'night');
  assert.ok(outlineStyle(6, 25, 1, true, {}).alpha < small.alpha, 'airborne');
  assert.ok(outlineStyle(6, 95, 1, false, {}).alpha < 0.01, 'beyond range');
  assert.ok(small.px >= outlineStyle(30, 10, 1, false, {}).px, 'a touch wider when tiny');
});

test('leaf cut: a card on the sight line just in front of the bird is cut, others are kept', () => {
  const cam = [0, 1.6, 0], bird = [0, 5, -20];
  const along = (t, off = [0, 0, 0]) => [bird[0] * t + cam[0] * (1 - t) + off[0], bird[1] * t + cam[1] * (1 - t) + off[1], bird[2] * t + cam[2] * (1 - t) + off[2]];
  const L = Math.hypot(20, 3.4);
  const at = (ahead, off) => along(1 - ahead / L, off);
  assert.ok(leafCut(at(0.5), 0.2, cam, bird, 0.25, 2.2, 1) > 0.99, 'on the line, 0.5 m in front');
  assert.ok(leafCut(at(0.5), 0.2, cam, bird, 0.25, 2.2, 0.6) < 0.61, 'strength scales the cut');
  assert.equal(leafCut(at(-0.5), 0.2, cam, bird, 0.25, 2.2, 1), 0, 'behind the bird: kept');
  assert.equal(leafCut(at(5), 0.2, cam, bird, 0.25, 2.2, 1), 0, 'a tree nearer the camera: kept (window, not tunnel)');
  assert.equal(leafCut(at(0.5, [1.2, 0, 0]), 0.2, cam, bird, 0.25, 2.2, 1), 0, 'well off the line: kept');
  // The cone widens towards the camera.
  const side = [0.45, 0, 0];
  assert.ok(leafCut(at(1.4, side), 0.1, cam, bird, 0.25, 2.2, 1) > leafCut(at(0.1, side), 0.1, cam, bird, 0.25, 2.2, 1));
  // Nothing at all for a zero-strength window.
  assert.equal(leafCut(at(0.5), 0.2, cam, bird, 0.25, 2.2, 0), 0);
  // Fully restored beyond the cone: a smooth falloff, never negative.
  for (let x = 0; x < 2; x += 0.05) {
    const c = leafCut(at(1, [x, 0, 0]), 0.2, cam, bird, 0.25, 2.2, 1);
    assert.ok(c >= 0 && c <= 1);
  }
});

test('window strength: none for hidden, hiding or flying birds; partial, then full after a look', () => {
  assert.equal(windowStrength(ACT.HIDING, 0, 5), 0);
  assert.equal(windowStrength(ACT.PERCHED, FLAG.HIDDEN, 5), 0);
  assert.equal(windowStrength(ACT.FLYING, 0, 5), 0);
  assert.ok(near(windowStrength(ACT.PERCHED, 0, 0), STRENGTH.partial));
  assert.ok(near(windowStrength(ACT.PERCHED, 0, STRENGTH.lookIn), 1));
  assert.ok(windowStrength(ACT.ROOSTING, 0, 0) < STRENGTH.partial);
  assert.ok(windowStrength(ACT.NESTING, 0, 0) < STRENGTH.partial, 'a sitting bird does not light up its nest');
  // Looking near it fills the timer; looking away drains it over lookOut seconds.
  let look = 0;
  for (let i = 0; i < 60; i++) look = updateLook(look, 0.05, 0.12, 1 / 60);
  assert.ok(near(look, STRENGTH.lookIn));
  for (let i = 0; i < 60 * STRENGTH.lookOut * 0.5; i++) look = updateLook(look, 1, 0.12, 1 / 60);
  assert.ok(look > 0 && look < STRENGTH.lookIn);
  for (let i = 0; i < 60 * STRENGTH.lookOut; i++) look = updateLook(look, 1, 0.12, 1 / 60);
  assert.equal(look, 0);
});

test('pickNearest: the k smallest, ascending, skipping non-finite keys', () => {
  const keys = new Float32Array([9, 3, Infinity, 1, 7, 2, 8]);
  const out = new Int32Array(3);
  assert.equal(pickNearest(keys, keys.length, 3, out), 3);
  assert.deepEqual(Array.from(out), [3, 5, 1]);
  assert.equal(pickNearest(keys, 2, 3, out), 2);
  assert.deepEqual(Array.from(out.subarray(0, 2)), [1, 0]);
  assert.equal(WINDOW.max, 12);
});

test('motion boost: 1 for big-looking birds, up to 1.6 for tiny ones', () => {
  assert.ok(near(motionBoost(60), 1));
  assert.ok(near(motionBoost(3), 1.6));
  assert.ok(motionBoost(15) > 1 && motionBoost(15) < 1.6);
});

test('window depth: deeper for further birds and stronger windows, capped, never reaching the camera', () => {
  assert.ok(near(windowDepth(4, 1), WINDOW.depth));
  assert.ok(windowDepth(20, 1) > windowDepth(10, 1));
  assert.ok(windowDepth(20, 0.6) < windowDepth(20, 1));
  assert.ok(windowDepth(45, 1) <= WINDOW.depthMax + 1e-9);
  for (let d = 3; d <= 45; d++) assert.ok(windowDepth(d, 1) <= Math.max(d - 1.5, WINDOW.depth) + 1e-9);
});

test('leaf cut per pixel vs the broad card test; the camera-end pinhole', () => {
  const cam = [0, 0, 0], bird = [0, 0, -20];
  // A big card whose centre is 1 m off the line, half-size 1.2 m: it may overlap the window...
  assert.ok(leafCut([1, 0, -19.5], 1.2, cam, bird, 0.25, 4, 1) > 0.5);
  // ...but its pixel 1 m off the line is kept, and its pixel on the line is cut.
  assert.equal(leafCut([1, 0, -19.5], 0, cam, bird, 0.25, 4, 1), 0);
  assert.ok(leafCut([0, 0, -19.5], 0, cam, bird, 0.25, 4, 1) > 0.99);
  // Middle of the sight line: solid. Near the camera: a pinhole only with nearD.
  assert.equal(leafCut([0, 0, -10], 0, cam, bird, 0.25, 4, 1, 4), 0);
  assert.equal(leafCut([0, 0, -2], 0, cam, bird, 0.25, 4, 1, 0), 0);
  assert.ok(leafCut([0, 0, -2], 0, cam, bird, 0.25, 4, 1, 4) > 0.99);
  // The pinhole is angular: 1.6x the bird's apparent radius (0.25 m at 20 m = 0.04 m at 2 m).
  assert.equal(leafCut([0.1, 0, -2], 0, cam, bird, 0.25, 4, 1, 4), 0);
  assert.ok(near(nearDepth(20, 6), WINDOW.near));
  assert.equal(nearDepth(5, 4.8), 0);
});
