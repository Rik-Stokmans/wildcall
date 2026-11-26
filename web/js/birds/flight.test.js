import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flapAngle, flightPose, flightStyleFor, flapRateFor, FLIGHT_CYCLES, createFlightPose } from './flight.js';
import { ACT, FLIGHT_STYLES } from './constants.js';

test('every catalog flight style has a cycle', () => {
  for (const s of FLIGHT_STYLES) assert.ok(FLIGHT_CYCLES[s], s);
});

test('flapAngle is a sine stroke around its mid angle', () => {
  assert.equal(flapAngle(0, 0.1, 0.5), 0.1);
  assert.ok(Math.abs(flapAngle(0.25, 0.1, 0.5) - 0.6) < 1e-12);
  assert.ok(Math.abs(flapAngle(0.75, 0.1, 0.5) + 0.4) < 1e-12);
});

test('flight poses are continuous in phase (no wing pops)', () => {
  const a = createFlightPose(), b = createFlightPose();
  for (const style of FLIGHT_STYLES) {
    const c = FLIGHT_CYCLES[style];
    const cyc = c.flaps + c.pause;
    let maxJump = 0;
    for (let p = 0; p < cyc * 2; p += 0.005) {
      flightPose(style, p, a);
      flightPose(style, p + 0.005, b);
      maxJump = Math.max(maxJump, Math.abs(a.flap - b.flap), Math.abs(a.fold - b.fold));
    }
    assert.ok(maxJump < 0.12, `${style}: jump ${maxJump}`);
  }
});

test('undulating flight closes the wings in its bound and bobs', () => {
  const o = createFlightPose();
  const c = FLIGHT_CYCLES.undulating;
  flightPose('undulating', c.flaps + c.pause * 0.6, o);
  assert.equal(o.flapping, false);
  assert.ok(o.fold > 0.95);
  let lo = Infinity, hi = -Infinity;
  for (let p = 0; p < c.flaps + c.pause; p += 0.05) { flightPose('undulating', p, o); lo = Math.min(lo, o.bob); hi = Math.max(hi, o.bob); }
  assert.ok(hi - lo > 0.8, 'clear bounding arcs');
});

test('soaring is mostly gliding on spread wings with the tail fanned', () => {
  const o = createFlightPose();
  const c = FLIGHT_CYCLES.soaring;
  let gliding = 0, n = 0;
  for (let p = 0; p < c.flaps + c.pause; p += 0.1, n++) {
    flightPose('soaring', p, o);
    if (!o.flapping) { gliding++; assert.equal(o.fold, 0); }
  }
  assert.ok(gliding / n > 0.8);
  assert.equal(o.tailSpread, 1);
});

test('whirring beats are shallower than direct ones; darting jinks sideways', () => {
  const amp = (style) => {
    const o = createFlightPose();
    let lo = Infinity, hi = -Infinity;
    for (let p = 0; p < 1; p += 0.01) { flightPose(style, p, o); lo = Math.min(lo, o.flap); hi = Math.max(hi, o.flap); }
    return hi - lo;
  };
  assert.ok(amp('whirring') < amp('direct'));
  const o = createFlightPose();
  let sway = 0;
  for (let p = 0; p < 4; p += 0.05) { flightPose('darting', p, o); sway = Math.max(sway, Math.abs(o.sway)); }
  assert.ok(sway > 0.1);
});

test('unknown style falls back to direct', () => {
  const a = flightPose('nonsense', 0.3, createFlightPose());
  const b = flightPose('direct', 0.3, createFlightPose());
  assert.deepEqual(a, b);
});

test('flightStyleFor maps acts to styles', () => {
  assert.equal(flightStyleFor(ACT.SOARING, 'direct'), 'soaring');
  assert.equal(flightStyleFor(ACT.HOVERING, 'undulating'), 'hover');
  assert.equal(flightStyleFor(ACT.FLYING, 'soaring'), 'flapglide', 'soarers travel with flap-and-glide');
  assert.equal(flightStyleFor(ACT.FLYING, 'hover'), 'direct');
  assert.equal(flightStyleFor(ACT.FLEEING, 'buoyant'), 'direct');
  assert.equal(flightStyleFor(ACT.FLEEING, 'undulating'), 'undulating');
  assert.equal(flightStyleFor(ACT.FLYING, 'bogus'), 'direct');
  for (const s of FLIGHT_STYLES) assert.ok(FLIGHT_CYCLES[flightStyleFor(ACT.FLYING, s)]);
});

test('fleeing birds beat faster, soaring ones slower', () => {
  assert.ok(flapRateFor(ACT.FLEEING) > flapRateFor(ACT.FLYING));
  assert.ok(flapRateFor(ACT.SOARING) < flapRateFor(ACT.FLYING));
});
