import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionSets, percent, setIcon } from './collection-logic.js';

const defs = [
  { id: 'feather_robin', kind: 'feather', set: 'Feathers', name: 'Robin Covert' },
  { id: 'feather_wren', kind: 'feather', set: 'Feathers', name: 'Wren Primary' },
  { id: 'page_1', kind: 'page', set: 'The Forgotten Field Journal', name: 'Page 2' },
  { id: 'page_0', kind: 'page', set: 'The Forgotten Field Journal', name: 'Page 1' },
  { id: 'relic_0', kind: 'relic', set: 'Relics', name: 'Old Whistle' },
  { id: 'badge_first', kind: 'badge', set: 'Badges', name: 'First Steps' },
];

test('sets ordered feather, page, relic, badge; progress per set and overall', () => {
  const r = collectionSets(defs, { feather_wren: 4, page_0: 2 }, ['badge_first']);
  assert.deepEqual(r.sets.map((s) => s.name), ['Feathers', 'The Forgotten Field Journal', 'Relics', 'Badges']);
  assert.deepEqual(r.sets.map((s) => [s.found, s.total]), [[1, 2], [1, 2], [0, 1], [1, 1]]);
  assert.equal(r.found, 3);
  assert.equal(r.total, 6);
});

test('items: found flagged with day, missing without; pages in order', () => {
  const r = collectionSets(defs, { feather_wren: 4, page_0: 2 });
  const pages = r.sets[1].items;
  assert.deepEqual(pages.map((i) => i.def.id), ['page_0', 'page_1']);
  assert.equal(pages[0].found, true);
  assert.equal(pages[0].day, 2);
  assert.equal(pages[1].found, false);
  assert.equal(r.sets[0].items.find((i) => i.def.id === 'feather_wren').found, true);
});

test('empty input', () => {
  assert.deepEqual(collectionSets([], {}), { sets: [], found: 0, total: 0 });
  assert.equal(percent(0, 0), 0);
  assert.equal(percent(1, 3), 33);
  assert.equal(setIcon('relic'), 'relic');
  assert.equal(setIcon('x'), 'star');
});
