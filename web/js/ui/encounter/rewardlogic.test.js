import test from 'node:test';
import assert from 'node:assert/strict';
import { countUp, rewardSummary, rewardLines, objectiveProgress, rankRequirements, rankView, regionView } from './rewardlogic.js';
import { landscapePlan, habitatTraits, rng } from './landscape.js';

const items = { explorer_binoculars: { id: 'explorer_binoculars', name: 'Explorer Binoculars', icon: 'binoculars' } };

test('count-up eases to the target and clamps', () => {
  assert.equal(countUp(0, 1000, 300), 0);
  assert.equal(countUp(1000, 1000, 300), 300);
  assert.equal(countUp(5000, 1000, 300), 300);
  const mid = countUp(500, 1000, 300);
  assert.ok(mid > 150 && mid < 300, 'ease-out is ahead of linear');
  assert.equal(countUp(10, 0, 42), 42);
});

test('reward summary maps every RewardsMsg field', () => {
  const s = rewardSummary({ title: 'Unseen Singer', xp: 300, credits: 40, items: ['explorer_binoculars', 'mystery'], rep: { research: 10, rangers: 0, naturalists: 5 }, skillPoints: 1, journal: ['New entry', ''], levelUp: 3 }, items);
  assert.equal(s.xp, 300); assert.equal(s.credits, 40); assert.equal(s.levelUp, 3); assert.equal(s.skillPoints, 1);
  assert.equal(s.items[0].def.name, 'Explorer Binoculars'); assert.equal(s.items[1].def, null);
  assert.deepEqual(s.rep.map((r) => r.label), ['Field Naturalists', 'Research Society']);
  assert.deepEqual(s.journal, ['New entry']);
  assert.equal(s.isEmpty, false);
  assert.equal(rewardSummary({}).isEmpty, true);
  assert.equal(rewardSummary(null).title, 'Rewards');
});

test('reward lines for quest cards', () => {
  const lines = rewardLines({ xp: 300, credits: 50, skillPoints: 2, rep: { research: 10 }, items: ['explorer_binoculars'], unlock: ['region:murmur_marsh'], badge: 'badge_singer' }, items);
  const text = lines.map((l) => l.text);
  assert.ok(text.includes('300 XP')); assert.ok(text.includes('50 Field Credits')); assert.ok(text.includes('2 skill points'));
  assert.ok(text.some((t) => t.includes('+10 reputation')));
  assert.ok(text.includes('Explorer Binoculars'));
  assert.ok(text.includes('Opens Murmur marsh'));
  assert.ok(text.some((t) => t.startsWith('Badge: Singer')));
  // Readable names, never raw ids.
  const named = rewardLines({ unlock: ['quest:harrows_survey', 'feature:trail_secret_lookout', 'region:murmur_marsh'], badge: 'badge_first_song' }, items,
    { regions: [{ key: 'murmur_marsh', name: 'Murmur Marsh' }], quests: { harrows_survey: { name: "Harrow's Survey", hidden: true } }, collectibles: { badge_first_song: { name: 'First Song' } } }).map((l) => l.text);
  assert.deepEqual(named, ['Opens a new line of enquiry', 'Reveals a hidden trail on your map', 'Opens Murmur Marsh', 'Badge: First Song']);
  assert.deepEqual(rewardLines(null), []);
});

test('objective progress', () => {
  assert.deepEqual(objectiveProgress({ id: 'o1', count: 3 }, { progress: { o1: 2 } }), { have: 2, need: 3, done: false });
  assert.equal(objectiveProgress({ id: 'o1', count: 0 }, { progress: { o1: 5 } }).done, true);
  assert.equal(objectiveProgress({ id: 'o1' }, undefined).have, 0);
});

const ranks = [
  { index: 1, title: 'Beginner', desc: 'd1', unlocks: [], skillPoints: 0 },
  { index: 2, title: 'Observer', desc: 'd2', unlocks: ['Murmur Marsh permit'], skillPoints: 2, reqLevel: 3, reqSpecies: 5, reqQuest: 'unseen_singer' },
  { index: 3, title: 'Naturalist', desc: 'd3', unlocks: [], skillPoints: 2, reqLevel: 8, reqSpecies: 12, reqDocs: 6, reqRep: 60 },
];

test('rank view and requirements', () => {
  const v = rankView(2, ranks, { level: 8, species: 6, rep: 10, docs: 0 });
  assert.equal(v.title, 'Observer'); assert.deepEqual(v.unlocks, ['Murmur Marsh permit']); assert.equal(v.skillPoints, 2);
  assert.equal(v.next.title, 'Naturalist');
  assert.equal(v.next.requirements.length, 4);
  assert.equal(v.next.requirements[0].met, true);
  assert.equal(v.next.requirements[1].met, false);
  assert.equal(rankView(3, ranks).next, null);
  assert.equal(rankView(9, ranks).title, 'Rank 9');
  const req = rankRequirements(ranks[1], { questName: 'The Unseen Singer', questDone: true });
  assert.equal(req.at(-1).text, 'Complete "The Unseen Singer"'); assert.ok(req.at(-1).met);
});

const regions = [{ id: 0, key: 'greenhollow', name: 'Greenhollow Woods', tagline: 't', desc: 'd', habitats: ['Woodland'], emphasis: ['Listen at dawn'], reqRank: 1, reqQuest: '', color: '#7C9A70' },
  { id: 3, key: 'whispering_coast', name: 'Whispering Coast', tagline: 'surf', desc: 'x', habitats: ['Beach'], emphasis: ['Watch the tide'], reqRank: 3, reqQuest: 'coast_q', color: '#627F9A' }];

test('region view: discovery and closed trail', () => {
  const open = regionView({ region: 0, species: 20, unlocked: true, hints: [] }, regions);
  assert.equal(open.name, 'Greenhollow Woods'); assert.equal(open.speciesCount, 20); assert.deepEqual(open.hints, ['Listen at dawn']); assert.equal(open.needs.length, 0);
  const closed = regionView({ region: 3, unlocked: false, reason: 'Needs a permit.', hints: ['h'] }, regions, { rank: 2, ranks, quests: { coast_q: { name: 'Salt and Wind' } } });
  assert.equal(closed.unlocked, false); assert.equal(closed.reason, 'Needs a permit.');
  assert.deepEqual(closed.hints, ['h']);
  assert.equal(closed.needs[0].text, 'Naturalist rank 3 (Naturalist)'); assert.equal(closed.needs[0].met, false);
  assert.equal(closed.needs[1].text, 'Complete the quest "Salt and Wind"');
  assert.equal(regionView({ region: 99, unlocked: true }, regions).name, 'A new region');
});

test('landscape plan is deterministic and reflects habitats', () => {
  const r = { key: 'murmur_marsh', color: '#8C9C73', habitats: ['Reedbed', 'Shallow pools'] };
  const a = landscapePlan(r, 640, 220), b = landscapePlan(r, 640, 220);
  assert.deepEqual(a, b);
  assert.ok(a.traits.reeds && a.water); assert.ok(a.details.some((d) => d.kind === 'reed'));
  assert.equal(a.hills.length, 3);
  assert.ok(a.hills.every((h) => h.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))));
  const f = landscapePlan({ key: 'frostveil', habitats: ['Snowfield', 'Snow-laden pines'] });
  assert.ok(f.traits.snow && f.traits.pines && f.trees.length > 0 && f.details.some((d) => d.kind === 'flake'));
  const unknown = landscapePlan({ key: 'new_place', color: '#336699', habitats: [] });
  assert.equal(unknown.sky.length, 2);
  assert.notDeepEqual(a.hills[0].points, f.hills[0].points);
});

test('habitat traits and rng', () => {
  assert.ok(habitatTraits(['Cliff face', 'Beach']).crags);
  const r = rng(5); const v = r(); assert.ok(v >= 0 && v < 1); assert.equal(rng(5)(), v);
});
