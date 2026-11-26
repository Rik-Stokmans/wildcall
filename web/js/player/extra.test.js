// Tests for the helpers that drive focus targeting, notes, raising, burst and stride.
import test from 'node:test';
import assert from 'node:assert/strict';
import { focusTarget, FOCUS_FAR, cleanNote, buildNote, NOTE_MAX } from './field.js';
import { stepRaise, isRaised, burstInterval, blendFov, raiseTime } from './optics.js';
import { advanceStride, bobOffset, landingNoise } from './movement.js';

const eye = { x: 0, y: 1.65, z: 0 };

test('focus target: terrain, sky and birds near the centre', () => {
  assert.equal(focusTarget(eye, 0, 0, 30, []), 30);
  assert.equal(focusTarget(eye, 0, 0, null, []), FOCUS_FAR);
  assert.equal(focusTarget(eye, 0, 0, 5000, null), FOCUS_FAR);
  // A bird straight ahead (north = −Z) at 12 m in front of a hill at 30 m.
  const ahead = { pos: { x: 0, y: 1.65, z: -12 } };
  assert.ok(Math.abs(focusTarget(eye, 0, 0, 30, [ahead]) - 12) < 1e-9);
  // ~1° off axis still counts, ~5° off does not.
  const near = { pos: { x: Math.tan(Math.PI / 180) * 20, y: 1.65, z: -20 } };
  const off = { pos: { x: Math.tan((5 * Math.PI) / 180) * 20, y: 1.65, z: -20 } };
  assert.ok(Math.abs(focusTarget(eye, 0, 0, 30, [near]) - Math.hypot(near.pos.x, 20)) < 1e-9);
  assert.equal(focusTarget(eye, 0, 0, 30, [off]), 30);
  // Behind the terrain hit: hidden, ignored. Nearest qualifying bird wins.
  assert.equal(focusTarget(eye, 0, 0, 10, [ahead]), 10);
  const nearer = { pos: { x: 0, y: 1.65, z: -6 } };
  assert.ok(Math.abs(focusTarget(eye, 0, 0, 30, [ahead, nearer]) - 6) < 1e-9);
  // Facing east the north bird is ignored.
  assert.equal(focusTarget(eye, Math.PI / 2, 0, 30, [ahead]), 30);
  // Accepts any iterable (Map values) and skips malformed entries.
  const m = new Map([[1, ahead], [2, {}], [3, null]]);
  assert.ok(Math.abs(focusTarget(eye, 0, 0, 30, m.values()) - 12) < 1e-9);
});

test('field notes are cleaned and shaped like proto.NoteMsg', () => {
  assert.equal(cleanNote('  a\n\n wren   here '), 'a wren here');
  assert.equal(cleanNote(null), '');
  assert.equal(cleanNote('x'.repeat(1000)).length, NOTE_MAX);
  assert.deepEqual(Object.keys(buildNote('hi')).sort(), ['mystery', 'species', 'text']);
  assert.deepEqual(buildNote(' hi '), { species: '', mystery: '', text: 'hi' });
});

test('raising takes raiseTime, lowering is quicker', () => {
  const secs = raiseTime('binoculars', { binoWeight: 0.6 });
  let a = 0, t = 0;
  while (a < 1 && t < 5) { a = stepRaise(a, true, secs, 1 / 60); t += 1 / 60; }
  assert.ok(Math.abs(t - secs) < 0.05, `raise ${t} vs ${secs}`);
  let d = 0;
  while (a > 0 && d < 5) { a = stepRaise(a, false, secs, 1 / 60); d += 1 / 60; }
  assert.ok(d < t, 'lowering faster than raising');
  assert.equal(stepRaise(0.5, true, 0.5, 10), 1);
  assert.equal(stepRaise(0.5, false, 0.5, 10), 0);
  assert.ok(isRaised(0.95) && !isRaised(0.5));
  // Heavier glass is slower to bring up.
  assert.ok(raiseTime('binoculars', { binoWeight: 1.2 }) > secs);
});

test('burst interval and fov blend', () => {
  assert.equal(burstInterval(1), 1);
  assert.equal(burstInterval(4), 0.25);
  assert.equal(burstInterval(0), 5);
  assert.equal(burstInterval(NaN), 1);
  assert.ok(Math.abs(blendFov(70, 8, 0) - 70) < 1e-9);
  assert.ok(Math.abs(blendFov(70, 8, 1) - 8) < 1e-9);
  const mid = blendFov(70, 8, 0.5);
  assert.ok(Math.abs(mid - Math.sqrt(70 * 8)) < 1e-9, 'geometric mean halfway');
});

test('stride: two footfalls per cycle, bob dips on footfalls', () => {
  let phase = 0, steps = 0;
  for (let i = 0; i < 600; i++) { const r = advanceStride(phase, 1.5, 1 / 60); phase = r.phase; if (r.step) steps++; }
  assert.equal(steps, 30); // 10 s × 1.5 cycles × 2
  assert.ok(phase >= 0 && phase < 1);
  assert.deepEqual(advanceStride(0.3, 0, 1 / 60), { phase: 0.3, step: false });
  assert.ok(bobOffset(0, 0.04) < bobOffset(0.25, 0.04));
  assert.ok(Math.abs(bobOffset(0, 0.04) + 0.02) < 1e-9 && Math.abs(bobOffset(0.25, 0.04) - 0.02) < 1e-9);
  assert.equal(bobOffset(0.1, 0), 0);
});

test('landing noise only for real drops', () => {
  assert.equal(landingNoise(-1), 0);
  assert.equal(landingNoise(3), 0);
  assert.ok(landingNoise(-6) > 0 && landingNoise(-6) < 1);
  assert.equal(landingNoise(-20), 1);
});

import { breathFactor, BREATH_HOLD } from './optics.js';
import { recorderHint, formatTimer } from './field.js';

test('holding breath steadies, then wears off without penalty', () => {
  assert.equal(breathFactor(0), 1);
  assert.ok(breathFactor(0.15) < 1 && breathFactor(0.15) > 0.5);
  assert.equal(breathFactor(2), 0.5);
  assert.ok(breathFactor(BREATH_HOLD + 0.5) > 0.5);
  assert.equal(breathFactor(BREATH_HOLD + 5), 1);
  for (let t = 0; t < 10; t += 0.1) assert.ok(breathFactor(t) <= 1 && breathFactor(t) >= 0.5);
});

test('recorder hint and timer', () => {
  assert.equal(recorderHint(false, null, 0, 'LMB'), 'LMB to start recording');
  assert.equal(recorderHint(true, null), 'Listening…');
  assert.equal(recorderHint(true, { signal: true, onAxis: 0.9 }, 0.5), 'Capturing a call');
  assert.match(recorderHint(true, { signal: true, onAxis: 0.2 }, 0.5), /aim/);
  assert.equal(recorderHint(true, { signal: true, onAxis: 0.2 }, 0), 'Capturing a call');
  assert.match(recorderHint(true, { signal: false, noise: 0.8 }), /Noisy/);
  assert.equal(formatTimer(0), '0:00');
  assert.equal(formatTimer(75.9), '1:15');
  assert.equal(formatTimer(-3), '0:00');
});
