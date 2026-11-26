import test from 'node:test';
import assert from 'node:assert/strict';
import { headingTo, compassName, formatDistance, bearingText, clockText, tagText, capital, callBoutSeconds, regionName, wildRarityColorIndex } from './format.js';

test('compass heading matches the engine convention (0 = north = -z, east = +x)', () => {
  assert.ok(Math.abs(headingTo(0, 0, 0, -10)) < 1e-9);
  assert.ok(Math.abs(headingTo(0, 0, 10, 0) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(headingTo(0, 0, 0, 10) - Math.PI) < 1e-9);
  assert.ok(Math.abs(headingTo(0, 0, -10, 0) - 1.5 * Math.PI) < 1e-9);
  assert.equal(compassName(0), 'N');
  assert.equal(compassName(Math.PI / 2), 'E');
  assert.equal(compassName(Math.PI * 1.75), 'NW');
  assert.equal(compassName(-0.01), 'N');
});

test('distance and bearing text', () => {
  assert.equal(formatDistance(340), '340 m');
  assert.equal(formatDistance(1234), '1.2 km');
  assert.equal(formatDistance(12345), '12 km');
  assert.equal(bearingText({ x: 0, z: 0 }, { x: 0, z: -340 }), '340 m N');
  assert.equal(bearingText({ x: 0, z: 0 }, { x: 3, z: 3 }), 'right here');
});

test('misc text helpers', () => {
  assert.equal(clockText(13.5), '13:30');
  assert.equal(clockText(-1), '23:00');
  assert.equal(tagText('behavior:feeding'), 'Feeding');
  assert.equal(tagText('golden hour'), 'Golden hour');
  assert.equal(capital('long_curved'), 'Long curved');
  assert.equal(regionName([{ id: 2, name: 'X' }], 2), 'X');
  assert.equal(regionName([], 3), 'Whispering Coast');
  assert.equal(regionName([], 255), 'Open Sea');
  assert.equal(wildRarityColorIndex(3), 4);
});

test('call bout length', () => {
  const call = { notes: [{ dur: 0.2, gap: 0.1 }], repeat: [3, 5], gap: 0.5 };
  assert.ok(Math.abs(callBoutSeconds(call) - (0.3 * 3 + 1.0)) < 1e-9);
  assert.equal(callBoutSeconds({}), 0);
});
