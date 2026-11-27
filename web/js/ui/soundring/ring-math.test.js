import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEG, wrapPi, relAngle, lerpAngle, ease, easeAngle, arcHalfWidth, clueElevation, nearness,
  arcStyle, viewPlacement, onTarget, lifeFade, ringRadius, pickTop, layerText, clueElevAngle,
} from './ring-math.js';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} != ${b}`);

test('relative bearing wraps the short way round', () => {
  near(relAngle(10 * DEG, 350 * DEG), 20 * DEG);      // north-ish crossing 0
  near(relAngle(350 * DEG, 10 * DEG), -20 * DEG);
  near(Math.abs(relAngle(Math.PI, 0)), Math.PI);       // dead behind
  near(relAngle(Math.PI / 2, 0), Math.PI / 2);         // east while facing north = right
  near(relAngle(0, Math.PI / 2), -Math.PI / 2);        // north while facing east = left
  near(wrapPi(3 * Math.PI), Math.PI);
  near(wrapPi(-3 * Math.PI), Math.PI);
});

test('angle easing turns the shortest way and never overshoots', () => {
  near(lerpAngle(170 * DEG, -170 * DEG, 0.5), Math.PI, 1e-9); // through 180, not through 0
  let a = 170 * DEG;
  for (let i = 0; i < 200; i++) a = easeAngle(a, -170 * DEG, 1 / 60, 0.3);
  near(a, -170 * DEG, 1e-3);
  const step = easeAngle(170 * DEG, -170 * DEG, 1 / 60, 0.3);
  assert.ok(step > 170 * DEG || step < -170 * DEG, 'first step goes across the back');
  near(ease(0, 10, 0, 0.3), 0);
  assert.ok(ease(0, 10, 0.016, 0.3) > 0 && ease(0, 10, 0.016, 0.3) < 10);
  near(ease(0, 10, 100, 0.3), 10, 1e-6);
});

test('arc width follows the spread within limits', () => {
  near(arcHalfWidth(0), 4 * DEG);
  near(arcHalfWidth(20 * DEG), 20 * DEG);
  near(arcHalfWidth(-20 * DEG), 20 * DEG);
  near(arcHalfWidth(3), 80 * DEG);
  near(arcHalfWidth(undefined), 4 * DEG);
});

test('elevation: numeric angle wins, else the word, else unknown', () => {
  assert.equal(clueElevation({}), null);
  assert.equal(clueElevation({ elevation: '' }), null);
  const w = clueElevation({ elevation: 'above' });
  assert.ok(w.angle > 12 * DEG && w.spread > 0);
  assert.ok(clueElevation({ elevation: 'below' }).angle < -12 * DEG);
  near(clueElevation({ elevation: 'level' }).angle, 0);
  const n = clueElevation({ elevation: 'above', elevAngle: -0.2, elevSpread: 0.05 });
  near(n.angle, -0.2); near(n.spread, 0.05);
  near(clueElevation({ elev: 0.3 }).angle, 0.3);
  const out = {};
  assert.equal(clueElevation({ elevation: 'level' }, out), out);
});

test('nearness: distance band when known, else loudness', () => {
  assert.ok(nearness({ distMin: 5, distMax: 10 }) > 0.9);
  assert.ok(nearness({ distMin: 60, distMax: 90 }) < 0.05);
  near(nearness({ strength: 0.4 }), 0.4);
});

test('arc style: a vague far sound is faint and thin, a close one bright and thick', () => {
  const vague = arcStyle(0.2, 0.1, 60 * DEG, 1, 0, {});
  const close = arcStyle(0.9, 0.95, 5 * DEG, 1, 0, {});
  assert.ok(close.alpha > vague.alpha + 0.3);
  assert.ok(close.width > vague.width + 2);
  const called = arcStyle(0.5, 0.5, 10 * DEG, 1, 1, {});
  const quiet = arcStyle(0.5, 0.5, 10 * DEG, 1, 0, {});
  assert.ok(called.width > quiet.width && called.alpha >= quiet.alpha);
  assert.equal(arcStyle(1, 1, 0, 0, 0, {}).alpha, 0);
});

test('placement: ahead = top, right = right, behind = bottom (out of view)', () => {
  const H = 50 * DEG, V = 35 * DEG, o = {};
  viewPlacement(Math.PI / 2, null, 0, H, V, o);
  near(o.angle, Math.PI / 2); near(o.front, 0);
  viewPlacement(Math.PI, null, 0, H, V, o);
  near(Math.abs(o.angle), Math.PI); near(o.front, 0);
  viewPlacement(-Math.PI / 2, 0, 0, H, V, o);
  near(o.angle, -Math.PI / 2);
  viewPlacement(0, 0, 0, H, V, o);
  near(o.angle, 0); near(o.offset, 0, 1e-6);
});

test('homing: a voice ahead, up and left sits at the upper left of the ring', () => {
  const H = 50 * DEG, V = 35 * DEG, o = {};
  viewPlacement(-10 * DEG, 10 * DEG, 0, H, V, o);
  assert.equal(o.front, 1);
  assert.ok(o.angle < -20 * DEG && o.angle > -70 * DEG, `upper left, got ${o.angle / DEG}`);
  assert.ok(o.up > 0);
  // a level voice a little to the right slides to the right of the ring (not near the top)
  viewPlacement(12 * DEG, 0, 0, H, V, o);
  near(o.angle, Math.PI / 2, 1e-6);
  // below the line of sight when looking up at the canopy
  viewPlacement(0, 0, 20 * DEG, H, V, o);
  near(Math.abs(o.angle), Math.PI, 1e-6);
  assert.ok(o.up < 0);
  // ahead but well below a view tilted up into the canopy: bottom of the ring, not the side
  viewPlacement(0, 0, 30 * DEG, H, V, o);
  near(Math.abs(o.angle), Math.PI, 1e-6);
  viewPlacement(3 * DEG, -0.1, 45 * DEG, H, V, o);
  assert.ok(Math.abs(o.angle) > 150 * DEG, `bottom, got ${o.angle / DEG}`);
  // unknown elevation: only the horizontal part counts
  viewPlacement(5 * DEG, null, 30 * DEG, H, V, o);
  near(o.offset, 5 * DEG, 1e-9);
  // the blend is continuous as the source enters the view
  let prev = null;
  for (let r = 80; r >= 2; r -= 1) {
    viewPlacement(r * DEG, 0.05, 0, H, V, o);
    if (prev != null) assert.ok(Math.abs(wrapPi(o.angle - prev)) < 12 * DEG, `jump at ${r}`);
    prev = o.angle;
  }
});

test('on target within the uncertainty, off well outside it', () => {
  near(onTarget(0, 10 * DEG), 1);
  near(onTarget(9 * DEG, 10 * DEG), 1);
  near(onTarget(40 * DEG, 10 * DEG), 0);
  assert.ok(onTarget(14 * DEG, 10 * DEG) > 0 && onTarget(14 * DEG, 10 * DEG) < 1);
  near(onTarget(2 * DEG, 0), 1); // a hairline spread still has a 3 degree window
  assert.ok(onTarget(15 * DEG, 5 * DEG, 20 * DEG) > 0.99); // elevation doubt widens it
});

test('life fade and ring size', () => {
  near(lifeFade(10, 10), 1);
  assert.ok(lifeFade(2, 10) < 0.7);
  near(lifeFade(0, 10), 0);
  assert.ok(lifeFade(0.6, 10) < lifeFade(1.2, 10));
  near(ringRadius(1000, 'normal'), 175);
  assert.ok(ringRadius(1000, 'small') < ringRadius(1000, 'large'));
  assert.ok(ringRadius(1000, 'normal', true) > 175);
  near(ringRadius(1000, 'bogus'), 175);
});

test('pickTop keeps the strongest few in order', () => {
  const items = [0.3, 0.9, 0.1, 0.5, 0.7, 0.2, 0.8].map((score) => ({ score }));
  const idx = new Array(5);
  const n = pickTop(items, items.length, 5, idx);
  assert.equal(n, 5);
  assert.deepEqual(idx.slice(0, n).map((i) => items[i].score), [0.9, 0.8, 0.7, 0.5, 0.3]);
  assert.equal(pickTop(items, 2, 5, idx), 2);
  assert.deepEqual(idx.slice(0, 2), [1, 0]);
});

test('layer words', () => {
  assert.equal(layerText({}), '');
  assert.equal(layerText({ perch: 'on or near the ground' }), 'low, near the ground');
  assert.equal(layerText({ perch: 'high in the canopy' }), 'high up in the canopy');
  assert.equal(layerText({ layer: 'head', perch: 'on a low perch' }), 'about head height');
  assert.equal(layerText({ layer: 'somewhere odd' }), 'somewhere odd');
});

test('pickTop skips free slots', () => {
  const items = [{ score: -1 }, { score: 0.2 }, { score: -1 }];
  const idx = new Array(5);
  assert.equal(pickTop(items, 3, 5, idx), 1);
  assert.equal(idx[0], 1);
});

test('elevation from the engine: elev + elevSpread, a level voice has no elev field', () => {
  assert.deepEqual(clueElevation({ elev: 0.3, elevSpread: 0.1 }), { angle: 0.3, spread: 0.1 });
  assert.deepEqual(clueElevation({ elevSpread: 0.1 }), { angle: 0, spread: 0.1 }); // elev omitted = 0
  assert.equal(clueElevation({ elevSpread: 0 }), null); // cannot tell
  assert.equal(clueElevAngle({ elev: -0.2, elevSpread: 0.05 }), -0.2);
  assert.equal(clueElevAngle({ elevSpread: 0.05 }), 0);
  assert.equal(clueElevAngle({ elevation: 'above' }), undefined);
});

test('pickTop can rank by another key (the followed voice is always drawn)', () => {
  const items = [{ score: 0.9, rank: 0.9 }, { score: 0.1, rank: 4.1 }, { score: 0.5, rank: 0.5 }, { score: -1, rank: -1 }];
  const out = [0, 0];
  assert.equal(pickTop(items, 4, 2, out, 'rank'), 2);
  assert.deepEqual(out, [1, 0]);
});
