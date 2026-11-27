import test from 'node:test';
import assert from 'node:assert/strict';
import { objectiveConditions, requirementRows, lockedQuests, rewardLines, objectiveRows, unlockLine } from './quest-logic.js';

const regions = [{ key: 'murmur_marsh', name: 'Murmur Marsh' }];
const ranks = [{ index: 1, title: 'Beginner' }, { index: 2, title: 'Observer' }];

test('objective conditions name the region and the rules that count', () => {
  assert.deepEqual(objectiveConditions({ region: 'murmur_marsh', minStars: '2' }, regions), ['in Murmur Marsh', '2★ or better']);
  assert.deepEqual(objectiveConditions({ method: 'sound', distinct: 'true' }, regions), ['by ear', 'each one different']);
  assert.deepEqual(objectiveConditions(null, regions), []);
  const rows = objectiveRows({ objectives: [{ id: 's', kind: 'identify', count: 3, params: { region: 'murmur_marsh' } }] }, { status: 'active', progress: { s: 2 } });
  assert.equal(rows[0].have, 2);
  assert.equal(rows[0].params.region, 'murmur_marsh');
});

test('requirements carry the player standing; locked quests list what is in sight', () => {
  const defs = [
    { id: 'reeds', name: 'Voices in the Reeds', reqRank: 2, objectives: [] },
    { id: 'ranger', name: 'Ranger Work', reqRep: { rangers: 40 }, objectives: [] },
    { id: 'later', name: 'Later', requires: ['ranger'], objectives: [] },
    { id: 'secret', name: 'Secret', hidden: true, reqRep: { rangers: 10 }, objectives: [] },
    { id: 'open', name: 'Open', objectives: [] },
    { id: 'tut', name: 'Tutorial', tutorial: true, reqRank: 3, objectives: [] },
  ];
  const profile = { rank: 1, rep: { rangers: 12 }, quests: {}, flags: {} };
  const r = requirementRows(defs[1], profile, { ranks });
  assert.deepEqual(r.map((x) => [x.kind, x.met, x.have, x.need]), [['rep', false, 12, 40]]);
  assert.equal(r[0].short, 'Needs 40 Rangers reputation');
  assert.equal(requirementRows(defs[0], profile, { ranks })[0].short, 'Needs the rank of Observer');
  const locked = lockedQuests(defs, profile, { ranks, quests: Object.fromEntries(defs.map((d) => [d.id, d])) });
  assert.deepEqual(locked.map((e) => e.def.id).sort(), ['ranger', 'reeds']);
  assert.equal(locked[0].state.status, 'locked');
  // revealed hidden quests join the list; started quests never do
  const revealed = lockedQuests(defs, { ...profile, flags: { 'quest:secret': true }, rep: { rangers: 0 } }, { ranks });
  assert.ok(revealed.some((e) => e.def.id === 'secret'));
  assert.ok(!lockedQuests(defs, { ...profile, quests: { ranger: { status: 'available' } } }, { ranks }).some((e) => e.def.id === 'ranger'));
});

test('reward lines show reputation with the current standing and equipment upgrades', () => {
  const lines = rewardLines({ xp: 10, rep: { rangers: 30 }, upgrades: ['binoculars_basic/coated'] }, {
    rep: { rangers: 45 }, items: { binoculars_basic: { name: 'Basic Binoculars', upgrades: [{ id: 'coated', name: 'Coated lenses' }] } },
  });
  const rep = lines.find((l) => l.kind === 'rep');
  assert.equal(rep.text, '+30 Rangers reputation');
  assert.equal(rep.note, 'you have 45');
  assert.equal(lines.find((l) => l.kind === 'upgrade').text, 'Upgrade: Coated lenses for your Basic Binoculars');
  assert.equal(rewardLines({ rep: { rangers: 5 } }).find((l) => l.kind === 'rep').note, '');
  assert.equal(unlockLine('upgrade:binoculars_basic/coated'), 'Unlocks the Coated upgrade');
});
