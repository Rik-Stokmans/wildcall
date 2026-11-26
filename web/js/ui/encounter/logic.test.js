import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_KEYS, evidenceRows, evidenceCount, missingEvidence, revealKeys, orderCandidates, confidenceTone,
  guideSpecies, filterSpecies, filterOptions, compareRows, traitFit, sketchSpecies, resultView, nearestPlace,
  repTier, dialogView, LineCursor, OverlayQueue, habitatKey, habitatPhrase, mixHex, shadeHex, safeHex, NEUTRAL_LOOK,
} from './logic.js';

const sp = (id, name, traits, extra = {}) => ({
  id, name, family: 'F', regions: [0], habitats: [{ habitat: 'woodland', weight: 0.6 }, { habitat: 'shrub', weight: 0.4 }],
  calls: [{ pitch: 'high', pattern: 'trill' }], look: { ...NEUTRAL_LOOK, colors: { ...NEUTRAL_LOOK.colors } }, traits: { size: 'small', shape: 'songbird', primary: 'brown', secondary: 'buff', marking: 'pale eyebrow', bill: 'thin', flight: 'direct', ...traits }, ...extra,
});
const robin = sp('robin', 'Robin', { marking: 'orange-red breast', primary: 'brown', secondary: 'orange' });
const wren = sp('wren', 'Wren', { size: 'tiny', marking: 'cocked tail' }, { regions: [0, 1], calls: [{ pitch: 'high', pattern: 'chatter' }] });
const heron = sp('heron', 'Grey Heron', { size: 'huge', shape: 'heron', primary: 'grey', secondary: 'white' }, { regions: [1], habitats: [{ habitat: 'river', weight: 1 }], calls: [{ pitch: 'low', pattern: 'harsh' }] });
const catalog = [robin, wren, heron];

test('evidence rows follow core order and cover every key', () => {
  const rows = evidenceRows({});
  assert.equal(rows.length, EVIDENCE_KEYS.length);
  assert.deepEqual(rows.map((r) => r.key), EVIDENCE_KEYS);
  assert.ok(rows.every((r) => !r.known && r.text === 'not yet observed' && r.hint));
});

test('evidence wording and merging', () => {
  const rows = evidenceRows({ size: 'small', pitch: 'high', pattern: 'repeated', behavior: 'foraging', habitat: 'shrub', shape: 'thrush', bill: 'long curved' });
  const line = (k) => rows.find((r) => r.key === k)?.line;
  assert.equal(line('size'), 'Size: small');
  assert.equal(line('shape'), 'Shape: thrush-like');
  assert.equal(line('pitch'), 'Call: high, repeated');
  assert.equal(line('behavior'), 'Seen: foraging in dense shrubs');
  assert.equal(line('bill'), 'Bill: long curved');
  assert.equal(rows.find((r) => r.key === 'habitat'), undefined, 'habitat merged into behaviour');
  assert.equal(rows.find((r) => r.key === 'pattern'), undefined);
  assert.equal(rows.length, EVIDENCE_KEYS.length - 2);
});

test('single behaviour / habitat / call keys stay separate', () => {
  const rows = evidenceRows({ habitat: 'Dense shrubs', pitch: 'High' });
  assert.equal(rows.find((r) => r.key === 'habitat').line, 'Habitat: dense shrubs');
  assert.equal(rows.find((r) => r.key === 'pitch').line, 'Call pitch: high');
  assert.equal(rows.find((r) => r.key === 'pattern').known, false);
});

test('evidence counting helpers', () => {
  assert.equal(evidenceCount({ size: 'small', shape: '', bill: 'thin' }), 2);
  assert.equal(missingEvidence({ size: 'small' }).length, EVIDENCE_KEYS.length - 1);
  assert.deepEqual(revealKeys({ size: 'small', flight: 'direct', primary: 'red', habitat: 'x' }), ['size', 'primary']);
});

test('habitat resolution accepts keys and labels', () => {
  assert.equal(habitatKey('Woodland canopy'), 'woodland');
  assert.equal(habitatKey('shrub'), 'shrub');
  assert.equal(habitatKey('nonsense'), '');
  assert.equal(habitatPhrase('nonsense'), 'in nonsense');
});

test('candidate ordering: by confidence, ties by name, ruled-out last', () => {
  const byId = { a: { name: 'Alpha' }, b: { name: 'Bravo' }, c: { name: 'Charlie' }, d: { name: 'Delta' } };
  const rows = orderCandidates([{ species: 'b', confidence: 30 }, { species: 'a', confidence: 30 }, { species: 'c', confidence: 40 }, { species: 'd', confidence: 5 }], ['d', 'zzz'], byId);
  assert.deepEqual(rows.map((r) => r.species), ['c', 'a', 'b', 'd', 'zzz']);
  assert.deepEqual(rows.map((r) => r.ruledOut), [false, false, false, true, true]);
  assert.equal(rows[3].confidence, 0);
  assert.equal(rows[4].name, 'zzz');
  assert.deepEqual(orderCandidates(null, null, null), []);
});

test('confidence tone', () => {
  assert.equal(confidenceTone(75), 'high');
  assert.equal(confidenceTone(40), 'mid');
  assert.equal(confidenceTone(10), 'low');
});

test('guide lists species of unlocked regions, sorted', () => {
  assert.deepEqual(guideSpecies(catalog, [0]).map((s) => s.id), ['robin', 'wren']);
  assert.deepEqual(guideSpecies(catalog, [1]).map((s) => s.id), ['heron', 'wren']);
  assert.equal(guideSpecies(catalog, []).length, 3);
});

test('field-guide filters', () => {
  assert.deepEqual(filterSpecies(catalog, { size: 'tiny' }).map((s) => s.id), ['wren']);
  assert.deepEqual(filterSpecies(catalog, { shape: 'heron' }).map((s) => s.id), ['heron']);
  assert.deepEqual(filterSpecies(catalog, { colour: 'orange' }).map((s) => s.id), ['robin']);
  assert.deepEqual(filterSpecies(catalog, { colour: 'white' }).map((s) => s.id), ['heron']);
  assert.deepEqual(filterSpecies(catalog, { habitat: 'river' }).map((s) => s.id), ['heron']);
  assert.deepEqual(filterSpecies(catalog, { pattern: 'chatter' }).map((s) => s.id), ['wren']);
  assert.deepEqual(filterSpecies(catalog, { query: 'GREY' }).map((s) => s.id), ['heron']);
  assert.equal(filterSpecies(catalog, { size: 'any', shape: '' }).length, 3);
  assert.equal(filterSpecies(catalog, { size: 'tiny', shape: 'heron' }).length, 0);
});

test('fit-to-evidence filter drops contradicted species', () => {
  const ev = { size: 'small', pitch: 'high' };
  assert.deepEqual(filterSpecies(catalog, {}, { fitOnly: true, evidence: ev }).map((s) => s.id), ['robin']);
  assert.deepEqual(traitFit(wren, ev).mismatches, ['size']);
  assert.equal(traitFit(robin, { habitat: 'Dense shrubs' }).match, 1);
  assert.equal(traitFit(heron, { habitat: 'woodland' }).mismatch, 1);
});

test('filter options are distinct and size-ordered', () => {
  const o = filterOptions(catalog);
  assert.deepEqual(o.size, ['tiny', 'small', 'huge']);
  assert.ok(o.colour.includes('orange') && o.colour.includes('white'));
  assert.deepEqual(o.habitat, ['river', 'shrub', 'woodland']);
});

test('compare rows flag shared and differing traits', () => {
  const rows = compareRows(robin, wren);
  assert.equal(rows.find((r) => r.label === 'Size').same, false);
  assert.equal(rows.find((r) => r.label === 'Family').same, true);
  assert.equal(compareRows(null, wren).length, 0);
});

test('sketch species is composed from evidence only', () => {
  const none = sketchSpecies({}, catalog, []);
  assert.deepEqual(none.look.colors, NEUTRAL_LOOK.colors);
  const s = sketchSpecies({ shape: 'heron', primary: 'red', size: 'tiny' }, catalog, []);
  assert.equal(s.look.colors.back, '#B9473C');
  assert.equal(s.look.length, 0.11);
  assert.equal(s.name, 'Unknown bird');
  assert.notEqual(s.id, 'heron');
  // the catalogue entry is never mutated
  assert.equal(heron.look.colors.back, NEUTRAL_LOOK.colors.back);
});

test('result views', () => {
  const byId = { robin: { name: 'Robin' }, wren: { name: 'Wren' } };
  const c = resultView({ outcome: 'certain', species: 'robin', xp: 100, first: true, feedback: '' }, { speciesById: byId });
  assert.equal(c.tone, 'joy'); assert.equal(c.lead, 'Robin'); assert.equal(c.xp, 100); assert.ok(c.added);
  assert.ok(c.lines.some((l) => /first/i.test(l)));
  const p = resultView({ outcome: 'probable', species: 'robin', confidence: 55 }, { speciesById: byId });
  assert.equal(p.title, 'Probable identification'); assert.match(p.lead, /55%/); assert.ok(p.lines.join(' ').includes('confirm'));
  const w = resultView({ outcome: 'wrong', guess: 'wren', feedback: 'The tail is too short.' }, { speciesById: byId });
  assert.equal(w.xp, 0); assert.equal(w.lead, 'The tail is too short.'); assert.ok(w.lines[0].includes('Wren'));
  const i = resultView({ outcome: 'insufficient' }, { evidence: { size: 'small' } });
  assert.ok(i.lines.length > 0 && i.lines[0].startsWith('Shape'));
  assert.equal(resultView({ outcome: '???' }).kind, 'unknown');
});

test('nearest place within range', () => {
  const locs = { a: { name: 'Creekside', pos: { x: 10, z: 10 } }, b: { name: 'Far', pos: { x: 500, z: 0 } } };
  assert.equal(nearestPlace({ x: 0, z: 0 }, locs), 'Creekside');
  assert.equal(nearestPlace({ x: 300, z: 300 }, locs), '');
  assert.equal(nearestPlace(null, locs), '');
});

test('reputation tiers', () => {
  assert.equal(repTier(0).name, 'Stranger');
  assert.equal(repTier(60).name, 'Trusted');
  assert.equal(repTier(1000).progress, 1);
  const t = repTier(30);
  assert.equal(t.next, 'Trusted'); assert.ok(t.progress > 0 && t.progress < 1);
});

test('dialog view and line cursor', () => {
  assert.ok(dialogView({ lines: [], choices: [] }).empty);
  assert.ok(dialogView({}).empty);
  const v = dialogView({ lines: ['a', ' ', 'b'], choices: [{ id: 'x', text: 'Bye', kind: 'bye' }] });
  assert.equal(v.lines.length, 2); assert.ok(v.hasBye && v.canEscape && !v.empty);
  assert.equal(dialogView({ lines: ['a'], choices: [{ id: 'n', text: 'Go', kind: 'next' }] }).canEscape, false);
  const c = new LineCursor(v.lines);
  assert.equal(c.current, 'a'); assert.ok(!c.atEnd); assert.ok(c.advance()); assert.equal(c.current, 'b'); assert.ok(c.atEnd); assert.ok(!c.advance());
  assert.ok(new LineCursor([]).atEnd);
});

test('overlay queue shows one at a time in order', () => {
  const q = new OverlayQueue();
  assert.deepEqual(q.push('rewards', 1), { name: 'rewards', data: 1 });
  assert.equal(q.push('rankup', 2), null);
  assert.equal(q.push('rewards', 3), null);
  assert.equal(q.length, 3);
  assert.equal(q.finish('region'), null, 'unrelated close ignored');
  assert.deepEqual(q.finish('rewards'), { name: 'rankup', data: 2 });
  assert.deepEqual(q.finish('rankup'), { name: 'rewards', data: 3 });
  assert.equal(q.finish('rewards'), null);
  assert.equal(q.length, 0);
  assert.deepEqual(q.push('region', 4), { name: 'region', data: 4 });
  q.clear(); assert.equal(q.length, 0);
});

test('colour helpers', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(shadeHex('#ffffff', -0.5), '#808080');
  assert.equal(safeHex('nope', '#123456'), '#123456');
});
