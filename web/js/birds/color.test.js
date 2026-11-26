import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHex, srgbToLinear, toLinear, mix, leucistic, brightness } from './color.js';

test('parseHex reads #rrggbb and #rgb, rejects junk', () => {
  assert.deepEqual(parseHex('#ff8000'), [1, 128 / 255, 0]);
  assert.deepEqual(parseHex('#f80'), [1, 136 / 255, 0]);
  assert.deepEqual(parseHex('00FF00'), [0, 1, 0]);
  for (const bad of [undefined, null, 12, '#12', '#zzzzzz', '']) {
    const c = parseHex(bad);
    assert.equal(c.length, 3);
    assert.ok(c.every((v) => v > 0 && v < 1), 'neutral fallback');
  }
});

test('sRGB → linear', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.ok(Math.abs(srgbToLinear(1) - 1) < 1e-12);
  assert.ok(Math.abs(srgbToLinear(0.5) - 0.214) < 0.001);
  assert.deepEqual(toLinear([0, 1, 0]), [0, 1, 0]);
});

test('mix and leucistic tint', () => {
  assert.deepEqual(mix([0, 0, 0], [1, 1, 1], 0.25), [0.25, 0.25, 0.25]);
  const dark = [0.1, 0.05, 0.02];
  const pale = leucistic(dark);
  assert.ok(brightness(pale) > 0.6 && brightness(pale) > brightness(dark) * 5, 'plumage washes out');
  const bill = leucistic(dark, true);
  assert.ok(brightness(bill) < brightness(pale), 'bare parts keep more colour');
});
