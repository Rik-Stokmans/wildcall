import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questSearchArea, areaOnStrip, areaLine, areaDistance } from './search-area.js';
import { buildMarkers } from '../journal/map-data.js';

const area = { name: 'the low bushes beside the old trail', x: 0, z: -100, radius: 10 };

test('questSearchArea: tracked active quest first, ignores inactive ones', () => {
  assert.equal(questSearchArea(null), null);
  const p = { quests: {
    a: { status: 'complete', tracked: true, area },
    b: { status: 'active', tracked: false, area: { ...area, name: 'b' } },
    c: { status: 'active', tracked: true, area: { ...area, name: 'c' } },
  } };
  assert.equal(questSearchArea(p).name, 'c');
  delete p.quests.c;
  assert.equal(questSearchArea(p).name, 'b');
});

test('areaOnStrip: ahead, behind, inside and width', () => {
  const half = 80 * Math.PI / 180;
  const ahead = areaOnStrip(area, 0, 0, 0, half); // facing north, area 100 m north
  assert.ok(Math.abs(ahead.offset) < 1e-6);
  assert.equal(ahead.dist, 90);
  assert.ok(ahead.width > 0.05 && ahead.width < 0.2);
  assert.equal(areaOnStrip(area, 0, 0, Math.PI, half).offset, null); // behind
  const right = areaOnStrip(area, 0, 0, -Math.PI / 4, half); // facing NW: area is 45° to the right
  assert.ok(right.offset > 0.5 && right.offset < 0.6);
  const inside = areaOnStrip(area, 3, -98, 0, half);
  assert.equal(inside.inside, true);
  assert.equal(inside.offset, null);
});

test('areaLine and areaDistance never name a bird and read plainly', () => {
  assert.equal(areaLine(area), 'Search the low bushes beside the old trail');
  assert.equal(areaLine({}), '');
  assert.equal(areaDistance(87), '85 m');
  assert.equal(areaDistance(1240), '1.2 km');
  assert.equal(areaDistance(0), '');
});

test('buildMarkers adds the active quest search area as a quest marker with its radius', () => {
  const quests = { q: { id: 'q', name: 'The Unseen Singer', objectives: [{ id: 'hear', kind: 'hear', target: 'x', count: 1 }] } };
  const on = buildMarkers({ quests, questStates: { q: { status: 'active', tracked: true, progress: {}, area } }, home: { x: 0, z: 0 } });
  const m = on.find((x) => x.key === 'quest:q:area');
  assert.ok(m && m.type === 'quest' && m.radius === 10 && m.x === 0 && m.z === -100);
  assert.match(m.label, /^The low bushes/);
  const off = buildMarkers({ quests, questStates: { q: { status: 'complete', tracked: true, progress: {}, area } }, home: { x: 0, z: 0 } });
  assert.ok(!off.some((x) => x.key === 'quest:q:area'));
});
