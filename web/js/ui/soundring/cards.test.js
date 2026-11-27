// The clue cards' wording for finding a voice (web/js/ui/hud/clues.js, soundring task).
import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceBand, elevationText, clueCard, oneClueCard, ClueStore } from '../hud/clues.js';

test('a close voice gets one number, a far one a band', () => {
  assert.equal(distanceBand(5, 15), 'about 10 m');
  assert.equal(distanceBand(10, 20), 'about 15 m');
  assert.equal(distanceBand(3, 6), 'about 5 m');
  assert.equal(distanceBand(0, 5), 'within 5 m');
  assert.equal(distanceBand(31, 44), 'about 30–45 m');
});

test('elevation words from a numeric angle or the word', () => {
  assert.equal(elevationText('above'), 'from above');
  assert.equal(elevationText('above', 0.02), 'at eye level');
  assert.equal(elevationText('', 0.2), 'a little above you');
  assert.equal(elevationText('', -0.5), 'below you');
  assert.equal(elevationText('', 1.0), 'high above you');
  assert.equal(elevationText(''), '');
});

test('cards say which layer to look in, and never name an unknown bird', () => {
  const low = clueCard({ id: 1, new: true, perch: 'on or near the ground', elevation: 'below', distMin: 5, distMax: 15 });
  assert.deepEqual(low.facts.map((f) => f.text), ['about 10 m', 'Low, near the ground']);
  assert.equal(low.title, 'An unfamiliar call');
  const layer = clueCard({ id: 2, layer: 'head', elevation: 'level' });
  assert.deepEqual(layer.facts.map((f) => f.key), ['layer']);
  const water = clueCard({ id: 3, perch: 'out on the water', elevation: 'below' });
  assert.deepEqual(water.facts.map((f) => f.text), ['Out on the water', 'from below']);
});

test('the engine\'s elev angle is put in words', () => {
  const up = clueCard({ id: 4, elev: 0.5, elevSpread: 0.1, elevation: 'above' });
  assert.deepEqual(up.facts.map((f) => f.text), ['above you']);
  const flat = clueCard({ id: 5, elevSpread: 0.1 });
  assert.deepEqual(flat.facts.map((f) => f.text), ['at eye level']);
  const word = clueCard({ id: 6, elevation: 'below' });
  assert.deepEqual(word.facts.map((f) => f.text), ['from below']);
});

test('one card at a time: the followed voice, everything else is a count', () => {
  const s = new ClueStore(4);
  s.upsert({ id: 1, strength: 0.9, ttl: 10 }, 0);
  s.upsert({ id: 2, strength: 0.2, ttl: 10 }, 0);
  s.upsert({ id: 3, strength: 0.5, ttl: 10, new: true }, 0);
  let p = oneClueCard(s.all(1), 2, { now: 1 });
  assert.deepEqual(p.shown.map((e) => e.id), [2]);
  assert.equal(p.hidden, 2);
  assert.equal(p.fresh, true);
  // nothing followed (no ring): the card selectClueCards would put first
  p = oneClueCard(s.all(1), 0, { now: 1 });
  assert.deepEqual(p.shown.map((e) => e.id), [3]);
  // a quest's voice goes first in the fallback
  s.upsert({ id: 4, strength: 0.1, ttl: 10, mystery: 'm9' }, 1);
  assert.deepEqual(oneClueCard(s.all(1), 0, { now: 1, quarry: ['m9'] }).shown.map((e) => e.id), [4]);
  assert.deepEqual(oneClueCard([], 7, { now: 1 }), { shown: [], hidden: 0, fresh: false });
});

test('the followed voice is held past its expiry; the others are pruned', () => {
  const s = new ClueStore(4);
  s.upsert({ id: 1, strength: 0.4, ttl: 5 }, 0);
  s.upsert({ id: 2, strength: 0.9, ttl: 5 }, 0);
  assert.deepEqual(s.prune(20, 1), [2]);
  assert.deepEqual(s.all(20, 1).map((e) => e.id), [1]);
  assert.deepEqual(s.all(20).map((e) => e.id), []);
  const p = oneClueCard(s.all(20, 1), 1, { now: 20 });
  assert.deepEqual(p.shown.map((e) => e.id), [1]);
  assert.equal(p.hidden, 0);
  assert.equal(s.get(1).heard, 0);
  assert.deepEqual(s.prune(21), [1]);
});
