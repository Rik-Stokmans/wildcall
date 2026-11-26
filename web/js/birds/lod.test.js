import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOD, chooseLod, zoomFactor, fullRange, pixelAngle, speckSize, headingTo, relativeBearing, fadeScale,
  budgetCutoff, fullBudget,
} from './lod.js';
import { LOD_NEAR, LOD_HYST } from './constants.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≉ ${b}`);

test('zoom factor from FOVs; full-model range grows with zoom', () => {
  near(zoomFactor(70, 70), 1);
  near(zoomFactor(70, 80), 1, 0); // never below 1
  const z = zoomFactor(70, 70 / 8);
  assert.ok(z > 8 && z < 10, `${z}`); // 8× narrower angle ≈ 9× magnification (tan)
  assert.equal(fullRange(1), LOD_NEAR);
  assert.ok(fullRange(8) > LOD_NEAR * 7);
  assert.equal(fullRange(100), LOD_NEAR * 12, 'capped');
  near(zoomFactor(undefined, 0), 1);
});

test('chooseLod: model near, speck far, nothing beyond the fog, with hysteresis', () => {
  assert.equal(chooseLod(LOD.NONE, 50, 120, 400), LOD.FULL);
  assert.equal(chooseLod(LOD.NONE, 125, 120, 400), LOD.SPECK);
  assert.equal(chooseLod(LOD.FULL, 120 + LOD_HYST - 1, 120, 400), LOD.FULL, 'stays a model inside the hysteresis band');
  assert.equal(chooseLod(LOD.FULL, 120 + LOD_HYST + 1, 120, 400), LOD.SPECK);
  assert.equal(chooseLod(LOD.SPECK, 121, 120, 400), LOD.SPECK);
  assert.equal(chooseLod(LOD.SPECK, 401, 120, 400), LOD.NONE);
  assert.equal(chooseLod(LOD.FULL, NaN, 120, 400), LOD.NONE);
  assert.equal(chooseLod(LOD.NONE, 5000, 120), LOD.SPECK, 'no fog → no far cutoff');
});

test('speck size: true size, but at least ~0.7 px', () => {
  const pa = pixelAngle(70, 900);
  near(pa, (2 * Math.tan((35 * Math.PI) / 180)) / 900, 1e-12);
  near(speckSize(0.15, 10, pa), 0.135, 1e-12);
  const far = speckSize(0.15, 300, pa);
  assert.ok(far > 0.135 && Math.abs(far / (300 * pa) - 0.7) < 1e-9);
});

test('bearings use the compass convention (0 = north/−Z, π/2 = east/+X)', () => {
  near(headingTo(0, 0, 0, -10), 0);
  near(headingTo(0, 0, 10, 0), Math.PI / 2);
  near(Math.abs(headingTo(0, 0, 0, 10)), Math.PI);
  // a bird facing east sees a viewer to its north on its left (−π/2)
  near(relativeBearing(Math.PI / 2, 0, 0, 0, -5), -Math.PI / 2);
  near(relativeBearing(-3, 0, 0, 0, 5), 3 - Math.PI, 1e-9); // viewer due south, bird heading -3 rad
});

test('fade eases 0 → 1', () => {
  assert.equal(fadeScale(0, 0.3), 0);
  assert.equal(fadeScale(1, 0.3), 1);
  near(fadeScale(0.15, 0.3), 0.5);
  assert.equal(fadeScale(0.1, 0), 1);
});

test('budget cutoff keeps the nearest N full models', () => {
  const d = new Float32Array([50, 10, 30, 20, 40]);
  const scratch = new Float32Array(8);
  assert.equal(budgetCutoff(d, 5, 10, scratch), Infinity);
  assert.equal(budgetCutoff(d, 5, 3, scratch), 30);
  assert.equal(budgetCutoff(d, 5, 0, scratch), -Infinity);
  assert.deepEqual([...d], [50, 10, 30, 20, 40], 'input untouched');
  assert.ok(fullBudget('low') < fullBudget('medium') && fullBudget('medium') < fullBudget('high'));
  assert.equal(fullBudget('weird'), fullBudget('medium'));
});
