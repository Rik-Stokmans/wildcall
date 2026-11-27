import test from 'node:test';
import assert from 'node:assert/strict';
import { selectClueCards, moreSoundsText } from './clues.js';
import { sightingView, watchMarks, marksText, WATCH_KEYS } from './sighting.js';
import { toastIcon, FALLBACK_TOAST_ICON } from './toasts.js';
import { HintTracker, memoryStorage } from './hints.js';
import { nudgeDue, nextNudge, nudgeTarget, nudgeBearing, nudgeComplete, tutorialActive, carriesKind } from './nudges.js';

const entry = (id, strength, born, extra = {}) => ({ id, born, clue: { id, strength, ...extra } });

test('clue panel: at most two cards, quarry first, rest folded into one line', () => {
  const live = [entry(1, 0.9, 0), entry(2, 0.7, 1), entry(3, 0.5, 2), entry(4, 0.3, 3)];
  const a = selectClueCards(live);
  assert.equal(a.shown.length, 2);
  assert.equal(a.hidden, 2);
  // newest first when nothing is special
  assert.deepEqual(a.shown.map((e) => e.id), [4, 3]);
  // a never-heard voice outranks age; the quest's quarry outranks everything
  const b = selectClueCards([entry(1, 0.9, 0, { mystery: 'm7' }), entry(2, 0.2, 5), entry(3, 0.4, 1, { new: true })], { quarry: ['m7'] });
  assert.deepEqual(b.shown.map((e) => e.id), [1, 3]);
  assert.equal(b.hidden, 1);
  assert.deepEqual(selectClueCards([]), { shown: [], hidden: 0 });
  assert.deepEqual(selectClueCards(null), { shown: [], hidden: 0 });
});

test('clue panel during the tutorial: the quarry plus one, or a single card', () => {
  const live = [entry(1, 0.9, 0), entry(2, 0.7, 1, { mystery: 'm1' }), entry(3, 0.5, 2)];
  const withQuarry = selectClueCards(live, { tutorial: true, quarry: new Set(['m1']), max: 4 });
  assert.deepEqual(withQuarry.shown.map((e) => e.id), [2, 3]);
  assert.equal(withQuarry.hidden, 1);
  const noQuarry = selectClueCards(live, { tutorial: true, max: 4 });
  assert.equal(noQuarry.shown.length, 1);
  assert.equal(noQuarry.hidden, 2);
  assert.equal(moreSoundsText(0), '');
  assert.equal(moreSoundsText(1), '+1 more sound');
  assert.equal(moreSoundsText(2), '+2 more sounds');
});

test('identification progress counts watchable marks only and never names the bird', () => {
  assert.deepEqual(watchMarks({ size: 'small', pitch: 'High', habitat: 'x', primary: '' }), { have: 1, total: WATCH_KEYS.length, keys: ['size'] });
  assert.equal(marksText(0), '');
  assert.equal(marksText(1), '1 mark noted');
  assert.equal(marksText(3), '3 marks noted');
  const v = sightingView({ bird: 3, mystery: 'm2', evidence: { size: 'small', shape: 'plump', primary: 'brown' } }, () => 'SECRET', (m) => m === 'm2');
  assert.equal(v.marks.have, 3);
  assert.equal(v.marksText, '3 marks noted');
  assert.equal(v.pulse, true);
  assert.equal(v.quarry, true);
  assert.equal(v.name, '');
  const one = sightingView({ bird: 3, mystery: 'm2', evidence: { size: 'small', pitch: 'High' } });
  assert.equal(one.pulse, false); // two evidence keys, but only one mark from watching
  const known = sightingView({ bird: 3, known: 'robin', evidence: { size: 'small', shape: 'x' } }, () => 'Robin', () => true);
  assert.equal(known.marks.have, 0);
  assert.equal(known.quarry, false);
});

test('toast icons: unknown kinds and icons get a neutral leaf, never a dot', () => {
  assert.equal(toastIcon({ kind: 'buff' }), 'heart');
  assert.equal(toastIcon({ kind: 'lens' }), 'lens');
  assert.equal(toastIcon({ kind: 'rep' }), 'reputation');
  assert.equal(toastIcon({ kind: 'something_new' }), FALLBACK_TOAST_ICON);
  assert.equal(toastIcon({ kind: 'item', icon: 'teapot_that_does_not_exist' }), 'backpack');
  assert.equal(toastIcon({ kind: 'mystery', icon: 'nope' }), FALLBACK_TOAST_ICON);
  assert.equal(toastIcon({ kind: 'item', icon: 'feather' }), 'feather');
  assert.equal(toastIcon({}), FALLBACK_TOAST_ICON);
});

test('hint tracker: nudges show once, dismiss retires them, counters persist', () => {
  const st = memoryStorage();
  const h = new HintTracker(st, () => true);
  assert.ok(h.request('finn', 0));
  assert.equal(h.active.until, 24); // its own longer duration
  assert.equal(h.dismiss(), true);
  assert.equal(h.available('finn'), false);
  assert.equal(h.wasShown('finn'), true);
  assert.ok(h.request('forage', 1));
  h.tick(100);
  assert.equal(h.available('forage'), false); // once only, even when it just timed out
  assert.equal(h.bump('focusUses'), 1);
  h.bump('focusUses');
  assert.equal(new HintTracker(st).count('focusUses'), 2);
  assert.equal(new HintTracker(st, () => false).available('nest'), false); // settings.hints off
});

test('onboarding nudges: Finn after the first quest, then the cabin, then the rest', () => {
  const items = { mint: { kind: 'ingredient' }, tea: { kind: 'food' } };
  const p = { quests: { unseen_singer: { status: 'active' } }, journal: { nests: [] }, inventory: [] };
  assert.equal(tutorialActive(p), true);
  assert.equal(nextNudge({ profile: p, items }), null);
  p.quests.unseen_singer.status = 'turned_in';
  assert.equal(tutorialActive(p), false);
  const shown = new Set();
  const s = { profile: p, items, wasShown: (id) => shown.has(id) };
  assert.equal(nextNudge(s), 'finn');
  assert.equal(nudgeDue('cabin', s), false);
  shown.add('finn');
  assert.equal(nextNudge(s, (id) => !shown.has(id)), 'cabin');
  shown.add('cabin');
  const avail = (id) => !shown.has(id);
  assert.equal(nextNudge(s, avail), null);
  assert.equal(nextNudge({ ...s, nearForage: true }, avail), 'forage');
  p.journal.nests = [{ id: 'n1' }];
  assert.equal(nextNudge({ ...s, nearForage: true }, avail), 'nest');
  shown.add('nest'); shown.add('forage');
  assert.equal(nudgeDue('cook', s), false);
  p.inventory = [{ item: 'mint', qty: 2 }];
  assert.equal(carriesKind(p, items, 'ingredient'), true);
  assert.equal(nextNudge(s, avail), 'cook');
  assert.equal(nextNudge({ profile: null }), null);
});

test('nudge target, bearing and completion', () => {
  const pois = { cabin: { id: 'cabin', kind: 'cabin', pos: { x: 0, z: 0 } }, shop: { id: 'shop', kind: 'shop', pos: { x: 100, z: 0 } } };
  assert.equal(nudgeTarget('finn', pois).id, 'shop');
  assert.equal(nudgeTarget('cabin', pois), null);
  assert.ok(Math.abs(nudgeBearing(pois.shop, 0, 0) - Math.PI / 2) < 1e-9); // due east
  assert.equal(nudgeBearing(null, 0, 0), null);
  assert.equal(nudgeComplete('finn', { near: 10 }), true);
  assert.equal(nudgeComplete('finn', { near: 40 }), false);
  assert.equal(nudgeComplete('finn', { opened: 'shop' }), true);
  assert.equal(nudgeComplete('cabin', { opened: 'base' }), true);
  assert.equal(nudgeComplete('forage', { opened: 'base' }), false);
});
