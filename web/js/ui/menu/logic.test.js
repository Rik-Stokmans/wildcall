import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';

const tiers = [
  { tier: 1, points: 0, rank: 1 }, { tier: 2, points: 3, rank: 1 },
  { tier: 3, points: 6, rank: 1 }, { tier: 4, points: 10, rank: 3 },
];
const ranks = [
  { index: 1, title: 'Beginner', unlocks: [] },
  { index: 2, title: 'Observer', reqLevel: 3, reqSpecies: 5, reqQuest: 'unseen_singer', unlocks: ['Murmur Marsh'], skillPoints: 2 },
  { index: 3, title: 'Naturalist', reqLevel: 8, reqSpecies: 12, reqDocs: 6, reqRep: 60, unlocks: [], skillPoints: 2 },
];
const disciplines = [{ id: 'acoustics', name: 'Acoustics' }];
const sk = (id, tier, maxRank, cost) => ({ id, discipline: 'acoustics', tier, maxRank, cost, name: id });
const skills = [
  sk('a1', 1, 3, 1), sk('a2', 1, 3, 1), sk('a3', 2, 2, 1), sk('a4', 2, 2, 1),
  sk('a5', 3, 2, 2), sk('a6', 3, 2, 2), sk('a7', 4, 1, 3),
  { id: 'o1', discipline: 'observation', tier: 1, maxRank: 3, cost: 1 },
];
const env = { tiers, skills, ranks, disciplines };
const prof = (over) => ({ skills: {}, skillPoints: 0, rank: 1, ...over });

test('points per discipline = cost x rank, ignoring other disciplines', () => {
  assert.equal(L.pointsInDiscipline(prof({ skills: { a1: 2, a5: 1, o1: 3 } }), skills, 'acoustics'), 4);
  assert.equal(L.pointsInDiscipline(prof({ skills: { a1: 9 } }), skills, 'acoustics'), 3); // clamped to maxRank
  assert.equal(L.pointsInDiscipline(null, skills, 'acoustics'), 0);
});

test('tier I is available immediately, tier II locked until 3 points', () => {
  const p = prof({ skillPoints: 1 });
  assert.equal(L.skillState(skills[0], p, env).state, 'available');
  assert.equal(L.skillState(skills[0], p, env).canBuy, true);
  const s = L.skillState(skills[2], p, env);
  assert.equal(s.state, 'locked');
  assert.equal(s.canBuy, false);
  assert.match(s.reason, /3 points in Acoustics/);
});

test('tier II opens at exactly 3 points', () => {
  const p = prof({ skills: { a1: 3 }, skillPoints: 1 });
  assert.equal(L.skillState(skills[2], p, env).state, 'available');
  assert.equal(L.skillState(skills[2], p, env).canBuy, true);
});

test('affordability: available but not buyable without points', () => {
  const s = L.skillState(skills[0], prof({ skillPoints: 0 }), env);
  assert.equal(s.state, 'available');
  assert.equal(s.canBuy, false);
  assert.match(s.reason, /1 skill point/);
  const t3 = L.skillState(skills[4], prof({ skills: { a1: 3, a3: 2, a2: 1 }, skillPoints: 1 }), env);
  assert.equal(t3.state, 'available');
  assert.equal(t3.canBuy, false); // costs 2
});

test('purchased multi-rank skill can still be bought until maxed', () => {
  const mid = L.skillState(skills[0], prof({ skills: { a1: 1 }, skillPoints: 2 }), env);
  assert.equal(mid.state, 'purchased');
  assert.equal(mid.canBuy, true);
  assert.equal(mid.maxed, false);
  const full = L.skillState(skills[0], prof({ skills: { a1: 3 }, skillPoints: 5 }), env);
  assert.equal(full.state, 'purchased');
  assert.equal(full.maxed, true);
  assert.equal(full.canBuy, false);
  assert.equal(full.reason, '');
});

test('tier IV needs 10 points AND naturalist rank 3', () => {
  const skillsOwned = { a1: 3, a2: 3, a3: 2, a4: 1, a5: 1 }; // 3+3+2+1+2 = 11
  const low = L.skillState(skills[6], prof({ skills: skillsOwned, skillPoints: 3, rank: 2 }), env);
  assert.equal(low.state, 'locked');
  assert.match(low.reason, /Naturalist/);
  const ok = L.skillState(skills[6], prof({ skills: skillsOwned, skillPoints: 3, rank: 3 }), env);
  assert.equal(ok.state, 'available');
  assert.equal(ok.canBuy, true);
  const short = L.skillState(skills[6], prof({ skills: { a1: 3 }, skillPoints: 3, rank: 3 }), env);
  assert.equal(short.state, 'locked');
  assert.match(short.reason, /10 points in Acoustics/);
});

test('discipline layout groups by tier', () => {
  const lay = L.disciplineLayout(skills, 'acoustics', tiers);
  assert.deepEqual(lay.map((t) => t.skills.length), [2, 2, 2, 1]);
  assert.equal(lay[3].req.rank, 3);
  assert.equal(L.tierRequirementText(lay[1].req, 'Acoustics', ranks), '3 points in Acoustics');
  assert.equal(L.tierRequirementText(lay[3].req, 'Acoustics', ranks), '10 points in Acoustics and rank of Naturalist');
  assert.equal(L.tierRequirementText(lay[0].req, 'Acoustics', ranks), 'Available from the start');
});

const items = [
  { id: 'bino', name: 'Binoculars', kind: 'equipment', slot: 'optics', rarity: 0, tier: 1 },
  { id: 'lens', name: "Explorer's Lens", kind: 'gadget', rarity: 4, tier: 4 },
  { id: 'film', name: 'Film Roll', kind: 'supply', rarity: 0, tier: 1, use: 'film' },
  { id: 'journal', name: 'Forgotten Journal', kind: 'keepsake', rarity: 3, tier: 4 },
  { id: 'cam', name: 'Action Camera', kind: 'equipment', slot: 'camera', rarity: 2, tier: 3 },
];
const stacks = items.map((i) => ({ item: i.id, qty: 1 }));

test('inventory filter by category', () => {
  assert.deepEqual(L.filterStacks(stacks, items, 'equipment').map((s) => s.item), ['bino', 'cam']);
  assert.deepEqual(L.filterStacks(stacks, items, 'gadgets').map((s) => s.item), ['lens']);
  assert.deepEqual(L.filterStacks(stacks, items, 'supplies').map((s) => s.item), ['film']);
  assert.deepEqual(L.filterStacks(stacks, items, 'keepsakes').map((s) => s.item), ['journal']);
  assert.equal(L.filterStacks(stacks, items, 'all').length, 5);
});

test('inventory sorts', () => {
  const ids = (k) => L.sortStacks(stacks, items, k).map((s) => s.item);
  assert.deepEqual(ids('name'), ['cam', 'bino', 'lens', 'film', 'journal']);
  assert.deepEqual(ids('rarity'), ['lens', 'journal', 'cam', 'bino', 'film']);
  assert.deepEqual(ids('tier'), ['lens', 'journal', 'cam', 'bino', 'film']);
  assert.deepEqual(ids('type'), ['cam', 'bino', 'lens', 'film', 'journal']);
  assert.equal(stacks[0].item, 'bino'); // input not mutated
});

test('capacity usage counts stacks', () => {
  const u = L.capacityUsage({ inventory: [1, 2, 3] }, 3);
  assert.deepEqual(u, { used: 3, cap: 3, full: true });
  assert.equal(L.capacityUsage({ inventory: [] }, 8).full, false);
});

test('equip/use predicates', () => {
  assert.equal(L.canEquip(items[0]), true);
  assert.equal(L.canEquip(items[1]), false);
  assert.equal(L.canUse(items[2]), true);
  assert.equal(L.canUse(items[3]), false);
});

test('compareMods gives signed deltas with good/bad flags', () => {
  const better = (k, d) => (k === 'binoWeight' ? d <= 0 : d >= 0);
  const rows = L.compareMods({ binoZoom: 2, binoWeight: 0.1 }, { binoZoom: 4, binoWeight: 0.4, lowLight: 0.2 }, better);
  const m = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(m.binoZoom.delta, 2);
  assert.equal(m.binoZoom.good, true);
  assert.equal(m.binoWeight.delta, 0.3);
  assert.equal(m.binoWeight.good, false);
  assert.equal(m.lowLight.delta, 0.2);
  assert.deepEqual(L.compareMods({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(L.compareMods(undefined, { a: -1 }).map((r) => r.delta), [-1]);
});

test('effective mods include purchased upgrades only', () => {
  const def = { id: 'x', mods: { binoZoom: 1 }, upgrades: [{ id: 'u1', mods: { binoZoom: 1, lowLight: 0.1 } }, { id: 'u2', mods: { binoZoom: 5 } }] };
  assert.deepEqual(L.effectiveMods(def, { upgrades: { x: ['u1'] } }), { binoZoom: 2, lowLight: 0.1 });
  const lists = L.upgradeLists(def, { upgrades: { x: ['u1'] } });
  assert.deepEqual([lists.owned.map((u) => u.id), lists.available.map((u) => u.id)], [['u1'], ['u2']]);
});

test('alternatives for a slot span inventory and storage', () => {
  const p = { inventory: [{ item: 'bino', qty: 1 }, { item: 'cam', qty: 1 }], storage: [{ item: 'bino', qty: 1 }] };
  const alts = L.alternativesForSlot(p, items, 'optics');
  assert.deepEqual(alts.map((a) => a.where), ['inventory', 'storage']);
  assert.equal(L.alternativesForSlot(p, items, 'audio').length, 0);
});

test('groupStats groups and skips unknown values', () => {
  const info = { a: { group: 'g1' }, b: { group: 'g2' }, c: { group: 'g1' }, d: { group: 'g3' } };
  const g = L.groupStats({ a: 1, b: 2, c: 3 }, info);
  assert.deepEqual(g.map((x) => [x.group, x.rows.map((r) => r.key)]), [['g1', ['a', 'c']], ['g2', ['b']]]);
});

test('rank progress rows', () => {
  const p = {
    level: 4, rep: { naturalists: 10, rangers: 5 },
    journal: { species: { a: { level: 4 }, b: { level: 5 }, c: { level: 6 } } },
    quests: { unseen_singer: { status: 'active' } },
  };
  const rows = L.rankProgress(ranks[1], p, { unseen_singer: { name: 'The Unseen Singer' } });
  const m = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(m.level.done, true);
  assert.equal(m.species.have, 3);
  assert.equal(m.species.done, false);
  assert.equal(m.species.fraction, 0.6);
  assert.equal(m.quest.label, 'The Unseen Singer');
  assert.equal(m.quest.done, false);
  assert.equal(m.docs, undefined); // no docs requirement for Observer
  const r3 = Object.fromEntries(L.rankProgress(ranks[2], p).map((r) => [r.id, r]));
  assert.equal(r3.docs.have, 2);
  assert.equal(r3.rep.have, 15);
  assert.equal(r3.rep.need, 60);
  assert.equal(L.rankProgress(null, p).length, 0);
  p.quests.unseen_singer.status = 'turned_in';
  assert.equal(L.rankProgress(ranks[1], p).find((r) => r.id === 'quest').done, true);
});

test('rankFraction averages and is 1 when empty', () => {
  assert.equal(L.rankFraction([]), 1);
  assert.equal(L.rankFraction([{ fraction: 1 }, { fraction: 0 }]), 0.5);
});

test('next unlocks', () => {
  const u = L.nextUnlocks({ level: 2, rank: 1 }, ranks);
  assert.deepEqual(u.level, ['Level 3: +1 skill point']);
  assert.deepEqual(u.rank, ['+2 skill points', 'Murmur Marsh']);
  assert.equal(u.rankTitle, 'Observer');
  assert.equal(L.nextUnlocks({ level: 40, rank: 3 }, ranks).rank.length, 0);
  assert.equal(L.nextRank(ranks, { rank: 3 }), null);
});

test('formatting helpers', () => {
  assert.equal(L.formatDuration(3725), '1h 2m');
  assert.equal(L.formatDuration(59), '0m');
  assert.equal(L.formatDistance(850), '850 m');
  assert.equal(L.formatDistance(12400), '12.4 km');
  assert.equal(L.formatNumber(1234567), '1,234,567');
});

test('saveSummary', () => {
  const s = L.saveSummary({ level: 5, journal: { species: { a: {} } }, rank: 2 }, ranks, { env: { day: 9 }, world: { seedText: 'moss' } });
  assert.deepEqual(s, { level: 5, rank: 'Observer', species: 1, day: 9, seed: 'moss' });
  assert.equal(L.saveSummary(null, ranks, {}), null);
});
