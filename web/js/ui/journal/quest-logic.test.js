import test from 'node:test';
import assert from 'node:assert/strict';
import {
  questTabs, groupByCategory, objectiveRows, questProgress, giverName, turnInText, availableText, unlockLine, rewardLines, readyToTurnIn, tabOf,
} from './quest-logic.js';

const defs = [
  { id: 'a', name: 'Alpha', category: 'photography', giver: 'mara', objectives: [] },
  { id: 'b', name: 'Beta', category: 'research', giver: 'alder', objectives: [] },
  { id: 'tut', name: 'Zed Tutorial', category: 'research', giver: 'mara', tutorial: true, objectives: [] },
  { id: 'h', name: 'Hidden', category: 'exploration', giver: 'june', hidden: true, objectives: [] },
  { id: 'c', name: 'Charlie', category: 'weird', giver: 'board', objectives: [] },
  { id: 'd', name: 'Delta', category: 'acoustic', giver: 'mara', objectives: [] },
];

test('tabs: states map to tabs, unseen quests (hidden or not) are not listed', () => {
  const q = { a: { status: 'active' }, b: { status: 'complete' }, tut: { status: 'active' }, c: { status: 'available' }, d: { status: 'turned_in' } };
  const t = questTabs(defs, q);
  assert.deepEqual(t.active.map((e) => e.def.id), ['tut', 'b', 'a'], 'tutorial first, then ready-to-turn-in, then by name');
  assert.deepEqual(t.available.map((e) => e.def.id), ['c']);
  assert.deepEqual(t.completed.map((e) => e.def.id), ['d']);
  assert.ok(![...t.active, ...t.available, ...t.completed].some((e) => e.def.id === 'h'));
  assert.equal(tabOf({ status: 'weird' }), null);
  // once the hidden quest has a state it shows
  assert.deepEqual(questTabs(defs, { h: { status: 'active' } }).active.map((e) => e.def.id), ['h']);
});

test('grouping follows the canonical category order, unknown categories last', () => {
  const entries = defs.map((def) => ({ def, state: {} }));
  const g = groupByCategory(entries);
  assert.deepEqual(g.map((x) => x.id), ['research', 'photography', 'exploration', 'acoustic', 'weird']);
  assert.equal(g[0].entries.length, 2);
  assert.equal(g[0].icon, 'knowledge');
  assert.equal(g[4].label, 'Weird');
});

const quest = { id: 'q', ordered: true, objectives: [
  { id: 'o1', text: 'Hear it', count: 1, hint: 'listen' },
  { id: 'o2', text: 'Find three', count: 3, hint: 'look' },
  { id: 'o3', text: 'Report', count: 0, hint: 'go back' },
] };

test('ordered objectives: one current, later ones locked without hints', () => {
  const rows = objectiveRows(quest, { status: 'active', progress: { o1: 1, o2: 1 } });
  assert.deepEqual(rows.map((r) => r.status), ['done', 'current', 'locked']);
  assert.deepEqual(rows.map((r) => [r.have, r.need]), [[1, 1], [1, 3], [0, 1]]);
  assert.equal(rows[1].hint, 'look');
  assert.equal(rows[2].hint, '');
  assert.deepEqual(questProgress(quest, { progress: { o1: 1, o2: 1 } }), { done: 1, total: 3, frac: 1 / 3 });
});

test('unordered objectives are all current; counts clamp; turned-in is all done', () => {
  const q = { ...quest, ordered: false };
  const rows = objectiveRows(q, { status: 'active', progress: { o2: 99 } });
  assert.deepEqual(rows.map((r) => r.status), ['current', 'done', 'current']);
  assert.equal(rows[1].have, 3);
  assert.ok(objectiveRows(q, { status: 'turned_in', progress: {} }).every((r) => r.done));
  assert.deepEqual(questProgress({ objectives: [] }, {}), { done: 0, total: 0, frac: 0 });
});

test('giver names and reminders', () => {
  const npcs = { mara: { name: 'Mara' } };
  assert.equal(giverName('mara', npcs), 'Mara');
  assert.equal(giverName('board', npcs), 'Cabin research board');
  assert.match(turnInText({ giver: 'mara' }, npcs), /Return to Mara/i);
  assert.match(turnInText({ giver: 'board' }, npcs), /Research Desk/);
  assert.match(availableText({ giver: 'mara' }, npcs), /Talk to Mara/);
});

test('reward lines', () => {
  const lines = rewardLines({ xp: 300, credits: 40, rep: { research: 10 }, skillPoints: 2, unlock: ['region:murmur_marsh'], lore: ['l1'], badge: 'b' },
    { regions: [{ key: 'murmur_marsh', name: 'Murmur Marsh' }], lore: { l1: { title: 'Wrens' } } });
  assert.deepEqual(lines.map((l) => l.text), ['300 XP', '40 Field Credits', '+10 Research reputation', '2 skill points', 'Natural history: Wrens', 'Opens Murmur Marsh', 'A badge for your collection']);
  assert.deepEqual(rewardLines({}), []);
  assert.equal(unlockLine('feature:map_room'), 'Unlocks Map room');
});

test('ready to turn in count', () => {
  assert.equal(readyToTurnIn({ a: { status: 'complete' }, b: { status: 'active' }, c: { status: 'complete' } }), 2);
});
