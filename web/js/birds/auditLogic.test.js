import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseAudit, mergeSummaries, visibleFraction, isFindable, countIds } from './auditLogic.js';

const e = (dist, pxFull, pxVisible) => ({ dist, pxFull, pxVisible, frac: visibleFraction(pxVisible, pxFull) });

test('visible fraction is clamped and safe for empty birds', () => {
  assert.equal(visibleFraction(5, 10), 0.5);
  assert.equal(visibleFraction(5, 0), 0);
  assert.equal(visibleFraction(12, 10), 1);
});

test('findable needs both the visible share and enough pixels', () => {
  assert.ok(isFindable(e(10, 40, 20)));
  assert.ok(!isFindable(e(10, 40, 10)), 'only 25 % visible');
  assert.ok(!isFindable(e(10, 10, 10)), 'too few pixels');
  assert.ok(isFindable(e(10, 10, 10), 0.4, 8));
});

test('summary counts birds per distance band (cumulative) and the findable share', () => {
  const s = summariseAudit([e(8, 50, 50), e(20, 30, 0), e(25, 30, 20), e(50, 14, 14), e(55, 0, 0)]);
  assert.deepEqual(s.bands, [15, 30, 60]);
  assert.deepEqual(s.n, [1, 3, 4], 'the empty (0 px) bird is ignored');
  assert.deepEqual(s.ok, [1, 2, 3]);
  assert.equal(s.okFrac[1], 2 / 3);
  assert.ok(Math.abs(s.meanFrac[1] - (1 + 0 + 2 / 3) / 3) < 1e-9);
  assert.equal(s.medianPx[1], 20);
  assert.ok(Number.isNaN(summariseAudit([]).okFrac[0]));
});

test('summaries merge by summing counts', () => {
  const a = summariseAudit([e(8, 50, 50)]), b = summariseAudit([e(9, 50, 0), e(40, 20, 20)]);
  const m = mergeSummaries([a, b]);
  assert.deepEqual(m.n, [2, 2, 3]);
  assert.deepEqual(m.ok, [1, 1, 2]);
  assert.equal(m.okFrac[0], 0.5);
});

test('countIds tallies the red channel ids', () => {
  const px = new Uint8Array([1, 0, 0, 255, 2, 0, 0, 255, 1, 0, 0, 255, 0, 0, 0, 0]);
  const c = countIds(px, new Uint32Array(4));
  assert.deepEqual(Array.from(c), [0, 2, 1, 0]);
});
