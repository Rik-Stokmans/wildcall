import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapPi, relBearing, stripOffset, headingTo, headingDegrees, arrowDegrees, spreadWidth, tickTable, landmarkPips, cuePlacement } from './compass.js';
import { ClueStore, distanceBand, clueCard } from './clues.js';
import { ToastStack, toastSound, XP_WINDOW } from './toasts.js';
import { objectiveProgressText, trackedQuest } from './quest.js';
import { HintTracker, memoryStorage } from './hints.js';
import { sightingView, evidenceChips, blockedWord } from './sighting.js';
import { hudLevel } from './visibility.js';
import { forecastSlots } from './weather.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test('wrapPi and relative bearing wrap across north', () => {
  near(wrapPi(3 * Math.PI), Math.PI);
  near(wrapPi(-Math.PI * 1.5), Math.PI / 2);
  near(relBearing(0.1, Math.PI * 2 - 0.1), 0.2);
  near(relBearing(Math.PI * 2 - 0.1, 0.1), -0.2);
});

test('stripOffset maps heading to strip position or null', () => {
  const half = Math.PI / 3;
  near(stripOffset(1, 1, half), 0);
  near(stripOffset(1 + half / 2, 1, half), 0.5);
  near(stripOffset(1 - half, 1, half), -1);
  assert.equal(stripOffset(1 + half + 0.01, 1, half), null);
  assert.notEqual(stripOffset(0.05, Math.PI * 2 - 0.05, half), null);
});

test('headingTo uses north = -Z, east = +X', () => {
  near(headingTo(0, 0, 0, -10), 0);
  near(headingTo(0, 0, 10, 0), Math.PI / 2);
  near(headingTo(0, 0, 0, 10), Math.PI);
  near(headingTo(0, 0, -10, 0), Math.PI * 1.5);
  assert.equal(headingDegrees(-0.0001), 0);
  assert.equal(headingDegrees(Math.PI / 2), 90);
  assert.equal(arrowDegrees(Math.PI / 2, 0), 90);
  assert.equal(arrowDegrees(0, Math.PI / 2), -90);
});

test('spreadWidth and tick table', () => {
  near(spreadWidth(0.3, 1.2), 0.25);
  assert.ok(spreadWidth(0, 1.2) > 0);
  const t = tickTable(15);
  assert.equal(t.length, 24);
  assert.equal(t[0].label, 'N');
  assert.equal(t[6].label, 'E');
  assert.equal(t.filter((x) => x.label).length, 8);
});

test('landmarkPips picks nearby on-strip landmarks, nearest first', () => {
  const locs = {
    a: { name: 'Cabin', pos: { x: 0, z: -50 } },
    b: { name: 'Tower', pos: { x: 100, z: 0 } },
    c: { name: 'Far', pos: { x: 0, z: -5000 } },
    d: { name: 'Behind', pos: { x: 0, z: 40 } },
  };
  const pips = landmarkPips(locs, 0, 0, 0, Math.PI / 3);
  assert.deepEqual(pips.map((p) => p.id), ['a']);
  assert.equal(landmarkPips(locs, 0, 0, Math.PI / 2, Math.PI / 3)[0].id, 'b');
});

test('cuePlacement: shimmer in view, edge ripple out of view', () => {
  const inView = cuePlacement({ bearing: 0, elev: 0, inView: true }, 0, 0, 70, 16 / 9);
  assert.equal(inView.edge, false);
  near(inView.x, 0.5); near(inView.y, 0.5);
  const right = cuePlacement({ bearing: Math.PI / 2, elev: 0, inView: false }, 0, 0, 70, 16 / 9);
  assert.equal(right.edge, true);
  near(right.x, 0.95); near(right.y, 0.5);
  const behind = cuePlacement({ bearing: Math.PI, elev: 0, inView: false }, 0, 0, 70, 16 / 9);
  near(behind.y, 0.95);
  const left = cuePlacement({ bearing: -Math.PI / 2, elev: 0, inView: false }, 0, 0, 70, 16 / 9);
  near(left.x, 0.05);
});

test('distanceBand text', () => {
  assert.equal(distanceBand(0, 0), '');
  assert.equal(distanceBand(31, 44), 'about 30–45 m');
  assert.equal(distanceBand(20, 20), 'about 20 m');
  assert.equal(distanceBand(0, 12), 'within 10 m');
  assert.equal(distanceBand(45, 30), 'about 30–45 m');
});

const clue = (id, strength, ttl = 3, extra = {}) => ({ id, strength, ttl, bearing: 0, spread: 0.2, dir: 'North', ...extra });

test('ClueStore upserts by id and refreshes expiry', () => {
  const s = new ClueStore(3);
  assert.equal(s.upsert(clue(1, 0.5), 0).isNew, true);
  const r = s.upsert(clue(1, 0.6), 2);
  assert.equal(r.isNew, false);
  assert.equal(r.entry.born, 0);
  assert.equal(s.list(4).length, 1);
  assert.equal(s.list(4)[0].clue.strength, 0.6);
  assert.equal(s.list(5.1).length, 0);
});

test('ClueStore expiry, fade, sort and slot cap', () => {
  const s = new ClueStore(2);
  s.upsert(clue(1, 0.2, 2), 0);
  s.upsert(clue(2, 0.9, 2), 0);
  s.upsert(clue(3, 0.5, 2), 0);
  assert.deepEqual(s.list(0.5).map((e) => e.id), [2, 3]);
  const e = s.map.get(2);
  assert.equal(s.alpha(e, 0.5), 1);
  near(s.alpha(e, 1.4), 0.6 / 1.2);
  assert.equal(s.alpha(e, 2), 0);
  assert.deepEqual(s.prune(2).sort(), [1, 2, 3]);
  assert.equal(s.list(2).length, 0);
});

test('clueCard: omits empty fields, never invents a species', () => {
  const resolve = { species: (id) => (id === 'robin' ? 'European Robin' : ''), mystery: (id) => (id === 'm1' ? 'Unknown bird A' : '') };
  const bare = clueCard(clue(1, 0.5), resolve);
  assert.equal(bare.title, 'A call');
  assert.deepEqual(bare.facts, []);
  assert.equal(bare.confidence, '');
  const fresh = clueCard(clue(1, 0.5, 3, { new: true, mystery: 'm1', pitch: 'Very high', pattern: 'Trill', distMin: 30, distMax: 45, elevation: 'above', unusual: true }), resolve);
  assert.equal(fresh.title, 'An unfamiliar call');
  assert.equal(fresh.subtitle, 'Unknown bird A');
  assert.ok(fresh.new && fresh.unusual);
  assert.deepEqual(fresh.facts.map((f) => f.text), ['about 30–45 m', 'from above', 'Very high pitch', 'Trill']);
  assert.equal(clueCard(clue(1, 0.5, 3, { mystery: 'm1' }), resolve).title, 'Unknown bird A');
  const known = clueCard(clue(1, 0.5, 3, { known: 'robin', new: true }), resolve);
  assert.equal(known.title, 'European Robin');
  assert.equal(known.new, false);
  // unresolvable known id must not leak the raw id
  assert.equal(clueCard(clue(1, 0.5, 3, { known: 'zzz' }), resolve).title, 'A call');
});

test('ToastStack coalesces XP gains and caps the stack', () => {
  const s = new ToastStack(3);
  const a = s.push({ kind: 'xp', xp: 5, title: '+5 XP', text: 'Heard a call' }, 0);
  assert.equal(a.merged, false);
  const b = s.push({ kind: 'xp', xp: 10, text: 'Photo' }, 1);
  assert.equal(b.merged, true);
  assert.equal(b.item.xp, 15);
  assert.equal(b.item.title, '+15 XP');
  assert.equal(s.items.length, 1);
  const c = s.push({ kind: 'xp', xp: 1 }, 1 + XP_WINDOW + 3);
  assert.equal(c.merged, false);
  s.push({ kind: 'info', title: 'a' }, 10);
  const last = s.push({ kind: 'info', title: 'b' }, 10);
  assert.equal(last.evicted.length, 1);
  assert.equal(s.items.length, 3);
  assert.equal(s.expire(1000).length, 3);
  assert.equal(toastSound('level'), 'level');
  assert.equal(toastSound('xp'), '');
});

test('objective progress text and tracked quest', () => {
  assert.equal(objectiveProgressText({ id: 'a', text: 'Photograph a bird', count: 5 }, { a: 2 }), 'Photograph a bird (2/5)');
  assert.equal(objectiveProgressText({ id: 'a', text: 'Reach the tower', count: 1 }, {}), 'Reach the tower');
  assert.equal(objectiveProgressText({ id: 'a', text: 'x', count: 3 }, { a: 9 }), 'x (3/3)');
  const defs = {
    q1: { name: 'First Steps', ordered: true, objectives: [{ id: 'a', text: 'Walk', count: 1 }, { id: 'b', text: 'Listen', count: 2 }] },
    q2: { name: 'Free', ordered: false, objectives: [{ id: 'a', text: 'One', count: 1 }, { id: 'b', text: 'Two', count: 1 }] },
  };
  const profile = { quests: { q1: { status: 'active', tracked: false, progress: {} }, q2: { status: 'active', tracked: true, progress: { a: 1 } } } };
  const t = trackedQuest(profile, defs);
  assert.equal(t.name, 'Free');
  assert.deepEqual(t.objectives.map((o) => o.text), ['Two']);
  profile.quests.q1.tracked = true;
  profile.quests.q2.tracked = false;
  const o = trackedQuest(profile, defs);
  assert.deepEqual(o.objectives.map((x) => x.text), ['Walk']);
  assert.equal(trackedQuest({ quests: { q1: { status: 'turned_in', tracked: true } } }, defs), null);
  assert.equal(trackedQuest(null, defs), null);
});

test('HintTracker: one at a time, completion is remembered, show cap', () => {
  const st = memoryStorage();
  const h = new HintTracker(st, () => true);
  assert.ok(h.request('movement', 0));
  assert.equal(h.request('journal', 1), null);
  assert.equal(h.complete('movement'), true);
  assert.ok(h.request('journal', 2));
  const h2 = new HintTracker(st, () => true);
  assert.equal(h2.isDone('movement'), true);
  assert.equal(h2.request('movement', 0), null);
  h2.tick(100);
  for (let i = 0; i < 5; i++) { h2.request('focus', 200 + i * 20); h2.tick(200 + i * 20 + 15); }
  assert.equal(h2.data.shown.focus, 3);
  assert.equal(new HintTracker(st, () => false).request('interact', 0), null);
  const broken = new HintTracker({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } });
  assert.ok(broken.request('interact', 0));
});

test('sighting view-model', () => {
  assert.equal(sightingView({ bird: 0 }), null);
  const v = sightingView({ bird: 4, mystery: 'm1', clarity: 0.4, blocked: 'distance', evidence: { bill: 'thin', size: 'small', primary: '' }, newKey: 'bill', behavior: 'feeding', moment: true }, () => 'SECRET');
  assert.equal(v.blocked, 'too far');
  assert.deepEqual(v.chips.map((c) => c.key), ['size', 'bill']);
  assert.equal(v.chips[1].isNew, true);
  assert.equal(v.identify, true);
  assert.equal(v.name, '');
  assert.equal(v.moment, true);
  const k = sightingView({ bird: 4, known: 'robin', evidence: {} }, (id) => 'Robin ' + id);
  assert.equal(k.name, 'Robin robin');
  assert.equal(k.identify, false);
  assert.equal(sightingView({ bird: 1, mystery: 'm', evidence: { size: 'a' } }).identify, false);
  assert.equal(blockedWord('dark'), 'too dark');
  assert.equal(blockedWord(''), '');
  assert.deepEqual(evidenceChips(null), []);
});

test('hudLevel rules', () => {
  assert.equal(hudLevel({ mode: 'mainmenu' }), 'hidden');
  assert.equal(hudLevel({ mode: 'boot' }), 'hidden');
  assert.equal(hudLevel({ mode: 'ui' }), 'hidden');
  assert.equal(hudLevel({ mode: 'play' }), 'full');
  assert.equal(hudLevel({ mode: 'play', focus: true }), 'dim');
  assert.equal(hudLevel({ mode: 'play', tool: 'camera', raised: true }), 'essential');
  assert.equal(hudLevel({ mode: 'play', tool: 'none', raised: true }), 'full');
});

test('forecastSlots honours the stat and wraps midnight', () => {
  const f = [{ hour: 15, weather: 0 }, { hour: 18, weather: 1 }, { hour: 21, weather: 2 }, { hour: 0, weather: 3 }];
  assert.deepEqual(forecastSlots(f, 14, 0), []);
  assert.equal(forecastSlots(f, 14, 6).length, 2);
  assert.equal(forecastSlots(f, 14, 12).length, 4);
  assert.equal(forecastSlots(f, 23, 3)[0].hour, 0);
  assert.equal(forecastSlots(f, 14.5, 1).length, 1);
});
