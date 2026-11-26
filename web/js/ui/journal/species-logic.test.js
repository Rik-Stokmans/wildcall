import test from 'node:test';
import assert from 'node:assert/strict';
import {
  speciesCards, filterCards, progressCounts, discoveryLadder, nextStepText, infoGates, activityBars, expectedActivity,
  evidenceRows, mysteryCards, photosOfSpecies, recordingsOfSpecies, recordingsOfMystery, similarSpecies, habitatList, studyPercent,
  isUnlockedSpecies, LEVELS,
} from './species-logic.js';

const SP = [
  { id: 'robin', index: 0, name: 'Robin', regions: [0], similar: ['wren', 'finch'], habitats: [{ habitat: 'woodland', weight: 0.6 }, { habitat: 'shrub', weight: 0.3 }], behavior: { activity: [1, 0.8, 0.3, 0.5, 0.9, 0] } },
  { id: 'wren', index: 1, name: 'Wren', regions: [0] },
  { id: 'heron', index: 2, name: 'Heron', regions: [1] },
  { id: 'puffin', index: 3, name: 'Puffin', regions: [3] },
  { id: 'finch', index: 4, name: 'Finch', regions: [0, 4] },
];
const profile = (over = {}) => ({ regions: [0, 1], journal: { species: {}, mysteries: [], photos: [], recordings: [], observations: [] }, ...over });

test('grid lists every species of unlocked regions in catalog order', () => {
  const cards = speciesCards(SP, profile());
  assert.deepEqual(cards.map((c) => c.index), [0, 1, 2, 4]);
  assert.ok(cards.every((c) => !c.known));
});

test('unknown cards leak nothing about the species', () => {
  const cards = speciesCards(SP, profile());
  for (const c of cards) { assert.equal(c.sp, null); assert.equal(c.entry, null); assert.ok(!/robin|wren|heron|finch/i.test(JSON.stringify(c).replace(/"index":\d+/, ''))); }
});

test('identified species show up with their entry; ones outside unlocked regions are still listed', () => {
  const p = profile();
  p.journal.species = { robin: { id: 'robin', level: 5 }, puffin: { id: 'puffin', level: 4, probable: true } };
  const cards = speciesCards(SP, p);
  assert.deepEqual(cards.map((c) => c.index), [0, 1, 2, 3, 4]);
  assert.equal(cards[0].known, true);
  assert.equal(cards[0].level, 5);
  assert.equal(cards[3].probable, true);
  assert.equal(cards[1].known, false);
  const counts = progressCounts(cards);
  assert.deepEqual(counts, { known: 2, total: 5, documented: 1 });
  assert.equal(filterCards(cards, 'known').length, 2);
  assert.equal(filterCards(cards, 'unknown').length, 3);
  assert.equal(filterCards(cards, 'all').length, 5);
});

test('region unlock check', () => {
  assert.ok(isUnlockedSpecies(SP[4], [4]));
  assert.ok(!isUnlockedSpecies(SP[3], [0]));
});

test('discovery ladder states and hints', () => {
  const steps = discoveryLadder({ level: 5 });
  assert.deepEqual(steps.map((s) => s.state), ['done', 'done', 'done', 'current', 'todo']);
  assert.equal(steps[0].level, 2);
  assert.ok(steps.every((s) => s.hint));
  assert.deepEqual(discoveryLadder({ level: 4 }).map((s) => s.state), ['done', 'done', 'current', 'todo', 'todo']);
});

test('next step text', () => {
  assert.match(nextStepText({ level: 4 }), /Documented/);
  assert.match(nextStepText({ level: 5, study: 40 }), /Studied.*40\/100/);
  assert.match(nextStepText({ level: 6 }), /Fully studied/);
  assert.match(nextStepText({ level: 4, probable: true }), /Probable/);
});

test('knowledge gates', () => {
  assert.deepEqual(infoGates({}), { fact: false, habitats: false, seasons: false, relations: false, similar: false });
  const g = infoGates({ journalInfo: 2, habitatKnow: 1, seasonKnow: 0, ecoKnow: 1 });
  assert.deepEqual(g, { fact: true, habitats: true, seasons: false, relations: true, similar: true });
});

test('activity bars normalise to the busiest phase', () => {
  const a = activityBars([2, 4, 0, 1, 0, 0]);
  assert.equal(a.total, 7);
  assert.equal(a.bars[1].frac, 1);
  assert.equal(a.bars[0].frac, 0.5);
  assert.equal(activityBars(undefined).total, 0);
  assert.equal(activityBars([0, 0, 0, 0, 0, 0]).bars[0].frac, 0);
  assert.equal(expectedActivity(SP[0])[0].frac, 1);
  assert.equal(expectedActivity({}).length, 6);
});

test('evidence rows are ordered and capitalised', () => {
  const rows = evidenceRows({ habitat: 'woodland', size: 'small', primary: 'brown', odd: 'x' });
  assert.deepEqual(rows.map((r) => r.key), ['size', 'primary', 'habitat', 'odd']);
  assert.equal(rows[0].value, 'Small');
});

test('mystery cards', () => {
  const p = profile();
  p.journal.mysteries = [{ id: 'm1', label: 'Unknown bird A', level: 2, evidence: { size: 'tiny' }, heard: 3, seen: 0, photos: [], recs: ['r1'], wrong: ['wren'] },
    { id: 'm2', label: 'Unknown bird B', level: 3, evidence: { size: 'tiny', shape: 'songbird' }, photos: ['p1'] }];
  const cards = mysteryCards(p);
  assert.equal(cards[0].levelName, 'Heard');
  assert.equal(cards[0].canIdentify, false);
  assert.equal(cards[1].canIdentify, true);
  assert.equal(cards[1].levelName, 'Encountered');
  assert.equal(cards[0].recs, 1);
});

test('per-species lists', () => {
  const p = profile();
  p.journal.photos = [{ id: 'a', subjects: [{ species: 'robin' }] }, { id: 'b', subjects: [{ mystery: 'm1' }] }];
  p.journal.recordings = [{ id: 'r1', species: 'robin' }, { id: 'r2', species: '', mystery: 'm1' }];
  assert.equal(photosOfSpecies(p, 'robin').length, 1);
  assert.equal(recordingsOfSpecies(p, 'robin')[0].id, 'r1');
  assert.equal(recordingsOfMystery(p, 'm1')[0].id, 'r2');
});

test('similar species only name identified ones', () => {
  const p = profile();
  p.journal.species = { wren: { id: 'wren' } };
  const byId = Object.fromEntries(SP.map((s) => [s.id, s]));
  const r = similarSpecies(SP[0], byId, p);
  assert.deepEqual(r.shown.map((s) => s.id), ['wren']);
  assert.equal(r.hidden, 1);
});

test('habitat list sorted by weight', () => {
  const h = habitatList(SP[0]);
  assert.equal(h[0].label, 'Woodland');
  assert.equal(h[0].frac, 1);
  assert.ok(h[1].frac < 1);
});

test('study percent clamps', () => {
  assert.equal(studyPercent({ study: 140 }), 100);
  assert.equal(studyPercent({}), 0);
  assert.equal(LEVELS.STUDIED, 6);
});
