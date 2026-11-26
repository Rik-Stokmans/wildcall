import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeParams, shaftStrength, sunScreenFade, postConfig, applyGrade } from './grade.js';

const warmth = (c) => c[0] - c[2];

test('grade: warm highlights by day, warmer at golden hour, blue at night, muted in rain', () => {
  const day = gradeParams({ daylight: 1 });
  const gold = gradeParams({ golden: 1, daylight: 0.5 });
  const night = gradeParams({ night: 1, daylight: 0 });
  const rain = gradeParams({ rain: 1, daylight: 0.8 });
  assert.ok(warmth(day.gain) > 0, 'day highlights warm');
  assert.ok(warmth(gold.gain) > warmth(day.gain), 'golden warmer');
  assert.ok(warmth(night.gain) < 0 && night.lift[2] > night.lift[0], 'night blue');
  assert.ok(rain.saturation < day.saturation);
  assert.ok(day.saturation > 1, 'rich greens');
  assert.ok(night.bloom.strength > day.bloom.strength, 'fireflies/windows glow at night');
  for (const p of [day, gold, night, rain]) {
    assert.ok(p.vignette > 0 && p.vignette < 0.35, 'gentle vignette');
    for (const v of p.lift) assert.ok(v >= 0 && v < 0.08, 'blacks lifted slightly, never grey');
    for (const v of p.gain) assert.ok(v > 0.8 && v < 1.2);
  }
});

test('grade keeps black near black, white near white and greens rich', () => {
  const p = gradeParams({ daylight: 1 });
  const black = applyGrade([0, 0, 0], p);
  const white = applyGrade([1, 1, 1], p);
  for (const v of black) assert.ok(v < 0.06, 'black');
  for (const v of white) assert.ok(v > 0.9, 'white');
  const green = [0.35, 0.55, 0.2];
  const g = applyGrade(green, p);
  const sat = (c) => Math.max(...c) - Math.min(...c);
  assert.ok(sat(g) > sat(green), 'greens richer');
});

test('regions tint the grade', () => {
  const cold = gradeParams({ cold: 1 });
  const warm = gradeParams({ warm: 1 });
  assert.ok(warmth(warm.gain) > warmth(cold.gain));
});

test('shafts need a visible sun and grow when low, misty or under trees', () => {
  assert.equal(shaftStrength({ sunVisible: 0, daylight: 1 }), 0);
  const base = shaftStrength({ sunVisible: 1, daylight: 1 });
  assert.ok(base > 0);
  assert.ok(shaftStrength({ sunVisible: 1, daylight: 1, golden: 1 }) > base);
  assert.ok(shaftStrength({ sunVisible: 1, daylight: 1, mist: 1 }) > base);
  assert.ok(shaftStrength({ sunVisible: 1, daylight: 1, canopy: 1 }) > base);
  assert.equal(shaftStrength({ sunVisible: 1, daylight: 0 }), 0);
});

test('sun screen fade', () => {
  assert.equal(sunScreenFade(0, 0, false), 1);
  assert.equal(sunScreenFade(0, 0, true), 0);
  assert.ok(sunScreenFade(1.3, 0, false) > 0 && sunScreenFade(1.3, 0, false) < 1);
  assert.equal(sunScreenFade(3, 0, false), 0);
});

test('post config by quality', () => {
  assert.equal(postConfig('low').enabled, false);
  assert.equal(postConfig('medium').effectScale, 0.5);
  assert.equal(postConfig('high').effectScale, 1);
  assert.ok(postConfig('high').samples >= 2);
});
