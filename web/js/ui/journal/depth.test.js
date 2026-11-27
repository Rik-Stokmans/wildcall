import test from 'node:test';
import assert from 'node:assert/strict';
import { infoGates, difficultyInfo, nestInfo, seasonList, marginNote, oldJournalState } from './species-logic.js';
import {
  phaseIndexAt, currentPhase, hoursToNextPhase, weatherEffects, forecastRows, forecastNote, weatherSlows, narratorVoiceLabel, windWord,
} from './sky-logic.js';

test('journal depth: difficulty and nest unlock at Field Experience rank 3', () => {
  assert.equal(infoGates({ journalInfo: 2 }).depth, false);
  assert.equal(infoGates({ journalInfo: 3 }).depth, true);
  assert.deepEqual(difficultyInfo({ difficulty: 4 }), { value: 4, max: 5, word: 'Hard to find' });
  assert.equal(difficultyInfo({ difficulty: 9 }).value, 5);
  assert.equal(difficultyInfo({}), null);
  const n = nestInfo({ nest: { site: 'cavity', heightMin: 2, heightMax: 8, seasons: [true, true, false, false], desc: 'A hole.' } });
  assert.equal(n.site, 'A hole in a tree');
  assert.equal(n.height, '2 m–8 m above the ground');
  assert.equal(n.season, 'Active in spring and summer');
  assert.equal(n.desc, 'A hole.');
  assert.equal(nestInfo({ nest: { site: 'none' } }), null);
  assert.equal(nestInfo({}), null);
  assert.equal(nestInfo({ nest: { site: 'ground', heightMax: 0 } }).height, 'on or near the ground');
  assert.equal(seasonList([true, true, true, true]), 'all year');
  assert.equal(seasonList([false, false, true, false]), 'autumn');
});

test('margin notes: identified species only, and only while the old journal is carried', () => {
  const notes = { robin: 'Bold as brass.', wren: 'Loud.' };
  const base = { journal: { species: { robin: { level: 4 } } }, inventory: [], storage: [], equipped: {} };
  assert.equal(marginNote(notes, base, 'robin'), '');
  assert.equal(oldJournalState(base), '');
  const carried = { ...base, inventory: [{ item: 'forgotten_journal', qty: 1 }] };
  assert.equal(oldJournalState(carried), 'carried');
  assert.equal(marginNote(notes, carried, 'robin'), 'Bold as brass.');
  assert.equal(marginNote(notes, carried, 'wren'), ''); // not identified
  assert.equal(marginNote(null, carried, 'robin'), '');
  const stored = { ...base, storage: [{ item: 'forgotten_journal', qty: 1 }] };
  assert.equal(oldJournalState(stored), 'stored');
  assert.equal(marginNote(notes, stored, 'robin'), '');
  assert.equal(oldJournalState({ ...base, equipped: { navigation: 'forgotten_journal' } }), 'carried');
});

test('weather & time: phases, effects and forecast', () => {
  assert.equal(phaseIndexAt(5), 0);
  assert.equal(phaseIndexAt(12), 2);
  assert.equal(phaseIndexAt(23), 5);
  assert.equal(phaseIndexAt(2), 5);
  assert.equal(currentPhase({ phase: 'Evening', time: 3 }), 4);
  assert.equal(currentPhase({ time: 15 }), 3);
  assert.equal(hoursToNextPhase(10), 1);
  assert.equal(hoursToNextPhase(22), 6.5);
  const calm = weatherEffects({ time: 10, wind: 0.05, rain: 0, cloud: 0.1, light: 1 });
  assert.deepEqual(calm.map((e) => e.key), ['hearing', 'seeing', 'photo', 'birds']);
  assert.ok(calm.every((e) => e.tone === 'good'));
  const storm = weatherEffects({ time: 10, weather: 2, wind: 0.6, rain: 0.8, cloud: 0.9, light: 0.6 });
  assert.equal(storm.find((e) => e.key === 'hearing').tone, 'poor');
  assert.equal(storm.find((e) => e.key === 'birds').tone, 'poor');
  const proofed = weatherEffects({ time: 10, rain: 0.8, light: 0.6 }, { rainProof: 1 });
  assert.match(proofed.find((e) => e.key === 'seeing').text, /rain gear/);
  assert.equal(weatherSlows({ rain: 0.5 }, {}), true);
  assert.equal(weatherSlows({ rain: 0.5 }, { rainProof: 0.6 }), false);
  assert.equal(weatherSlows({ wind: 0.4 }, {}), false);
  const f = [{ hour: 18, weather: 1 }, { hour: 15, weather: 0 }, { hour: 21, weather: 2 }];
  assert.deepEqual(forecastRows(f, 14, 0), []);
  assert.deepEqual(forecastRows(f, 14, 6).map((r) => r.hour), [15, 18]);
  assert.match(forecastNote(0, 4), /Weather Sense/);
  assert.match(forecastNote(6, 4), /6 hours/);
  assert.equal(windWord(0.9), 'Gale');
  assert.equal(narratorVoiceLabel({ voicePack: { voice: 'x', lines: 300 } }), 'Recorded voice');
  assert.equal(narratorVoiceLabel({ voicePack: null }), 'System voice');
  assert.equal(narratorVoiceLabel(undefined), 'System voice');
});
