import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOOR, floorPx, flightScale, drawnSpanPx, refPixel, visibleFlapHz, createFlightState, resetFlightState,
  trackFlight, EV, LAND_GLOW, landGlow, glowAlpha, scaleWeight, windowRange, LAND_WINDOW_RANGE, overlayPose, animAct, inFlight, trailCount, dabAlpha, dabSize, TRAIL,
} from './flightlook.js';
import { flightPose, FLIGHT_CYCLES } from './flight.js';
import { createPose } from './pose.js';
import { createSample } from './interp.js';
import { ParticlePool } from './particles.js';
import { ACT } from './constants.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('the wingspan floor: ~13 px within 60 m, tapering smoothly, never rising', () => {
  assert.equal(floorPx(10), FLOOR.px);
  assert.equal(floorPx(60), FLOOR.px);
  let prev = Infinity;
  for (let d = 0; d <= 300; d += 2) { const f = floorPx(d); assert.ok(f <= prev + 1e-9); prev = f; }
  near(floorPx(150), FLOOR.midPx, 1e-9);
  near(floorPx(300), FLOOR.farPx, 1e-9);
});

test('flightScale: a flying songbird reaches the floor, perched birds and big birds are left alone', () => {
  const robin = 0.21;
  // Perched: the exaggeration passes straight through.
  assert.equal(flightScale(2.3, robin, 60, 70, 0), 2.3);
  // Flying at 60 m with the naked eye: at least ~13 px across on a 720-px view.
  const s = flightScale(2.3, robin, 60, 70, 1);
  near(drawnSpanPx(robin, s, 60, 70), 13, 0.01);
  for (const d of [5, 15, 30, 45, 60]) assert.ok(drawnSpanPx(robin, flightScale(1.4, robin, d, 70, 1), d, 70) >= 13 - 1e-6, `${d} m`);
  // A buzzard at 30 m is far above the floor already: true to its (exaggerated) size.
  assert.equal(flightScale(1.05, 1.2, 30, 70, 1), 1.05);
  // One combined scale: a large exaggeration is never multiplied by the floor.
  assert.equal(flightScale(9, robin, 60, 70, 1), 9);
  // Through 8x binoculars the bird already looks big: no floor needed.
  const bino = 2 * Math.atan(Math.tan(35 * Math.PI / 180) / 8) * 180 / Math.PI;
  assert.equal(flightScale(1.4, robin, 60, bino, 1), 1.4);
  // The blend follows the airborne weight monotonically.
  let prev = 0;
  for (let a = 0; a <= 1; a += 0.1) { const v = flightScale(2, robin, 50, 70, a); assert.ok(v >= prev); prev = v; }
  // Capped for the tiniest birds far away.
  assert.ok(flightScale(1, 0.15, 250, 70, 1) <= FLOOR.maxScale);
});

test('visibleFlapHz never shows more beats than the frame rate can draw', () => {
  assert.equal(visibleFlapHz(8, 1 / 60), 8);
  near(visibleFlapHz(27, 1 / 60), 18, 1e-9);
  near(visibleFlapHz(27, 1 / 30), 9, 1e-9);
  assert.equal(visibleFlapHz(27, 1 / 144), 27);
  // Monotone in the requested rate.
  assert.ok(visibleFlapHz(10, 1 / 30) <= visibleFlapHz(20, 1 / 30));
});

test('wingbeat phase per style: bounding closes the wings, soarers hold, whirrers beat on', () => {
  const frac = (style, test) => {
    let n = 0, k = 0;
    for (let p = 0; p < 40; p += 0.01) { if (test(flightPose(style, p))) k++; n++; }
    return k / n;
  };
  const flapping = (s) => frac(s, (o) => o.flapping);
  assert.equal(flapping('direct'), 1);
  assert.ok(flapping('soaring') < 0.2, 'soaring mostly holds its wings out');
  assert.ok(flapping('flapglide') < flapping('undulating'));
  assert.ok(flapping('whirring') > flapping('undulating'));
  // Bounding flight (finches, woodpeckers): wings fully closed for part of every cycle.
  assert.ok(frac('undulating', (o) => o.fold > 0.95) > 0.2);
  // Soaring wings are spread, never folded.
  assert.ok(frac('soaring', (o) => o.fold > 0.05) === 0);
  for (const s of Object.keys(FLIGHT_CYCLES)) {
    // No jumps in the wing angle within a cycle (smooth joins).
    let prev = flightPose(s, 0).flap;
    for (let p = 0.002; p < 20; p += 0.002) {
      const f = flightPose(s, p).flap;
      assert.ok(Math.abs(f - prev) < 0.05, `${s} wing jumps at ${p}`);
      prev = f;
    }
  }
});

function sample(act, x = 0, y = 5, z = 0, speed = 0) {
  const s = createSample();
  s.valid = true; s.act = act; s.x = x; s.y = y; s.z = z; s.speed = speed;
  return s;
}

test('trackFlight reports a flush once, then the landing, then ~10 s of glow', () => {
  const fl = createFlightState();
  resetFlightState(fl, 7);
  const dt = 1 / 60;
  assert.equal(trackFlight(fl, sample(ACT.PERCHED), dt), 0, 'first frame: no event');
  assert.equal(trackFlight(fl, sample(ACT.PERCHED), dt), 0);
  const ev = trackFlight(fl, sample(ACT.FLEEING, 0, 5, 0, 6), dt);
  assert.equal(ev, EV.TAKEOFF | EV.FLUSH);
  assert.equal(trackFlight(fl, sample(ACT.FLEEING, 0.1, 5.1, 0, 6), dt), 0, 'once');
  for (let i = 0; i < 60; i++) trackFlight(fl, sample(ACT.FLEEING, 0.1 + i * 0.1, 5.1, 0, 6), dt);
  assert.ok(fl.air > 0.99);
  const land = trackFlight(fl, sample(ACT.PERCHED, 6.1, 5.1, 0, 0), dt);
  assert.equal(land, EV.LAND | EV.LAND_FLUSHED);
  near(fl.glow, LAND_GLOW, 0.02);
  assert.equal(glowAlpha(0.1, fl), 0.5);
  for (let i = 0; i < 60 * 8; i++) trackFlight(fl, sample(ACT.PERCHED, 6.1, 5.1, 0, 0), dt);
  assert.ok(landGlow(fl) > 0.3 && landGlow(fl) < 1, 'fading in the last seconds');
  for (let i = 0; i < 60 * 3; i++) trackFlight(fl, sample(ACT.PERCHED, 6.1, 5.1, 0, 0), dt);
  assert.equal(landGlow(fl), 0);
  assert.equal(glowAlpha(0.1, fl), 0.1);
  // A calm flight: a take-off, but no flush and no glow after it.
  trackFlight(fl, sample(ACT.FLYING, 6.1, 5.1, 0, 3), dt);
  assert.equal(fl.flushed, false);
  for (let i = 0; i < 30; i++) trackFlight(fl, sample(ACT.FLYING, 6.1 + i * 0.05, 5.1, 0, 3), dt);
  assert.equal(trackFlight(fl, sample(ACT.PERCHED, 7.6, 5.1, 0, 0), dt), EV.LAND);
  assert.equal(fl.glow, 0);
});

test('look-ahead: crouch before the spring, flare before touch-down', () => {
  const fl = createFlightState();
  resetFlightState(fl, 1);
  const s = sample(ACT.PERCHED);
  trackFlight(fl, s, 0.016);
  s.nextAct = ACT.FLEEING; s.nextIn = 0.3;
  trackFlight(fl, s, 0.016);
  assert.equal(fl.crouch, 0, 'too early');
  s.nextIn = 0.05;
  trackFlight(fl, s, 0.016);
  assert.ok(fl.crouch > 0.5);
  const f = sample(ACT.FLYING, 1, 5, 0, 5);
  f.vx = 5;
  trackFlight(fl, f, 0.016);
  assert.equal(fl.crouch, 0);
  f.nextAct = ACT.PERCHED; f.nextIn = 0.05;
  trackFlight(fl, f, 0.016);
  assert.ok(fl.flare > 0.5);
});

test('the continuity guard glides out a step the motion cannot explain, and leaves real motion alone', () => {
  const fl = createFlightState();
  resetFlightState(fl, 3);
  const dt = 1 / 60;
  // Steady flight at 6 m/s: drawn position == sampled position.
  for (let i = 0; i < 30; i++) {
    const s = sample(ACT.FLYING, i * 0.1, 5, 0, 6); s.vx = 6;
    trackFlight(fl, s, dt);
    near(s.x, i * 0.1, 1e-9);
  }
  // A late snapshot catches up: the sampled bird jumps 3 m ahead in one frame.
  const s = sample(ACT.FLYING, 2.9 + 3, 5, 0, 6); s.vx = 6;
  trackFlight(fl, s, dt);
  assert.ok(s.x - 2.9 < 0.6, `snapped ${s.x - 2.9} m`);
  // …and converges within a second.
  let x = 0;
  for (let i = 1; i <= 60; i++) {
    const r = sample(ACT.FLYING, 5.9 + i * 0.1, 5, 0, 6); r.vx = 6;
    trackFlight(fl, r, dt);
    x = r.x - (5.9 + i * 0.1);
  }
  assert.ok(Math.abs(x) < 0.01, `still ${x} m off`);
  // A jump the interpolator cross-fades is not glided (it is out of sight at that moment).
  const j = sample(ACT.FLYING, 500, 5, 0, 6); j.fade = 0;
  trackFlight(fl, j, dt);
  assert.equal(j.x, 500);
});

test('overlayPose writes take-off and landing over a copy, never into the animator state', () => {
  const fl = createFlightState();
  resetFlightState(fl, 2);
  const pose = createPose();
  const before = { ...pose };
  const out = createPose();
  fl.crouch = 1;
  overlayPose(fl, pose, out, 0.15);
  assert.deepEqual(pose, before, 'input untouched');
  assert.ok(out.crouch > 0.8);
  // Just landed: wings up and the perch bouncing.
  fl.crouch = 0; fl.airborne = false; fl.sinceDown = 0.05;
  overlayPose(fl, pose, out, 0.15);
  assert.ok(out.flapL > 0.5 && out.fold < 0.5);
  assert.notEqual(out.lift, pose.lift);
  // Long after: identical to the animator's pose.
  fl.sinceDown = 5;
  overlayPose(fl, pose, out, 0.15);
  assert.deepEqual(out, pose);
});

test('a dash into cover is animated as a flight', () => {
  assert.equal(animAct(ACT.HIDING, 6), ACT.FLEEING);
  assert.equal(animAct(ACT.HIDING, 0), ACT.HIDING);
  assert.equal(animAct(ACT.PERCHED, 6), ACT.PERCHED);
  assert.ok(inFlight(ACT.HIDING, 5));
  assert.ok(!inFlight(ACT.SWIMMING, 5));
});

test('trail dabs: steady rate, gone within half a second, sized by apparent size, pooled', () => {
  const fl = createFlightState();
  let n = 0;
  for (let i = 0; i < 60; i++) n += trailCount(fl, 1 / 60, true);
  assert.ok(Math.abs(n - TRAIL.rate) <= 1);
  assert.equal(trailCount(fl, 1, false), 0);
  assert.equal(fl.trailAcc, 0);
  assert.ok(TRAIL.life <= 0.5);
  assert.equal(dabAlpha(1), 0);
  assert.ok(dabAlpha(0.2) > dabAlpha(0.8));
  assert.ok(dabAlpha(0.1) <= TRAIL.alpha);
  // Never thinner than a few pixels; proportional to distance in metres.
  near(dabSize(0, 100, 70), TRAIL.minPx * refPixel(70) * 100, 1e-9);
  near(dabSize(400, 5, 70), TRAIL.maxPx * refPixel(70) * 5, 1e-9); // a close bird never gets blobs
  // The pool: fixed capacity, swap-remove keeps per-dab values with their dab.
  const pool = new ParticlePool(4);
  for (let i = 0; i < 6; i++) pool.spawn(i, 0, 0, 0, 0, 0, i < 2 ? 0.1 : 1, 1, 10 + i);
  assert.equal(pool.n, 4);
  pool.step(0.2);
  assert.equal(pool.n, 2);
  assert.deepEqual([...pool.k.subarray(0, 2)].sort(), [12, 13]);
  assert.deepEqual([...pool.x.subarray(0, 2)].sort(), [2, 3]);
});

test('a flushed bird keeps its flight size on the landing perch for the glow, then eases back', () => {
  const fl = createFlightState();
  resetFlightState(fl, 3);
  const dt = 1 / 60;
  trackFlight(fl, sample(ACT.PERCHED), dt);
  assert.equal(scaleWeight(fl), 0, 'perched: no floor');
  for (let i = 0; i < 60; i++) trackFlight(fl, sample(ACT.FLEEING, i * 0.1, 5, 0, 6), dt);
  near(scaleWeight(fl), 1, 1e-3);
  trackFlight(fl, sample(ACT.PERCHED, 6, 5, 0, 0), dt);
  for (let i = 0; i < 60 * 3; i++) trackFlight(fl, sample(ACT.PERCHED, 6, 5, 0, 0), dt);
  assert.ok(fl.air < 0.01, 'airborne weight has settled');
  near(scaleWeight(fl), 1, 1e-3); // still at the flight floor 3 s after landing
  const s3 = flightScale(2.3, 0.22, 30, 70, scaleWeight(fl));
  assert.ok(s3 > 3, `drawn scale ${s3} keeps the floor`);
  for (let i = 0; i < 60 * 8; i++) trackFlight(fl, sample(ACT.PERCHED, 6, 5, 0, 0), dt);
  assert.equal(scaleWeight(fl), 0, 'after the glow: perched size again');
  // A calm landing never holds the floor.
  for (let i = 0; i < 30; i++) trackFlight(fl, sample(ACT.FLYING, 6 + i * 0.05, 5, 0, 3), dt);
  trackFlight(fl, sample(ACT.PERCHED, 7.5, 5, 0, 0), dt);
  for (let i = 0; i < 60; i++) trackFlight(fl, sample(ACT.PERCHED, 7.5, 5, 0, 0), dt);
  assert.ok(scaleWeight(fl) < 0.01);
});

test('a flushed bird that has just landed keeps a leaf window farther out, only during the glow', () => {
  const fl = createFlightState();
  resetFlightState(fl, 5);
  const dt = 1 / 60;
  trackFlight(fl, sample(ACT.PERCHED), dt);
  assert.equal(windowRange(fl, 45), 45);
  for (let i = 0; i < 30; i++) trackFlight(fl, sample(ACT.FLEEING, i * 0.1, 5, 0, 6), dt);
  assert.equal(windowRange(fl, 45), 45, 'not in flight');
  trackFlight(fl, sample(ACT.PERCHED, 3, 5, 0, 0), dt);
  assert.equal(windowRange(fl, 45), LAND_WINDOW_RANGE);
  for (let i = 0; i < 60 * 11; i++) trackFlight(fl, sample(ACT.PERCHED, 3, 5, 0, 0), dt);
  assert.equal(windowRange(fl, 45), 45, 'back to the everyday reach');
});
