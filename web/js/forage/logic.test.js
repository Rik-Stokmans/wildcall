import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';

const bramble = { id: 'bramble', name: 'Bramble', regrow: 4, yields: [{ item: 'blackberry', seasons: [false, true, true, false], min: 1, max: 3 }] };
const elder = { id: 'elder', name: 'Elder', regrow: 5, yields: [
  { item: 'elderflower', seasons: [true, false, false, false] },
  { item: 'elderberry', seasons: [false, false, true, false] },
] };

test('node ids are canonical and round-trip', () => {
  assert.equal(L.nodeId(-1, 0, 224), 'fg@-1,0,224');
  assert.deepEqual(L.parseNodeId('fg@-1,0,224'), { cx: -1, cz: 0, n: 224 });
  assert.equal(L.parseNodeId('fg@-0,0,1'), null, 'no negative zero');
  assert.equal(L.parseNodeId('fg@1,02,3'), null, 'no leading zeros');
  assert.equal(L.parseNodeId('fg@1,2'), null);
  assert.equal(L.parseNodeId('cabin'), null);
  assert.equal(L.parseNodeId(null), null);
  assert.ok(L.isNodeId('fg@3,-7,0'));
  assert.ok(!L.isNodeId('fg@3,-7,-1'));
});

test('forage kinds are 18..35', () => {
  assert.ok(L.isForageKind(18) && L.isForageKind(35));
  assert.ok(!L.isForageKind(17) && !L.isForageKind(36) && !L.isForageKind(18.5));
});

test('a plant bears only in its seasons and not while regrowing', () => {
  const env = (season, day = 10) => ({ season, day });
  assert.equal(L.nodeState(bramble, 'fg@0,0,1', {}, env(0)).state, 'season');
  const ripe = L.nodeState(bramble, 'fg@0,0,1', { forage: {} }, env(2));
  assert.equal(ripe.state, 'ripe');
  assert.equal(ripe.yield.item, 'blackberry');
  // picked on day 8: regrow 4 → bears again on day 12
  const prof = { forage: { 'fg@0,0,1': 8 } };
  const picked = L.nodeState(bramble, 'fg@0,0,1', prof, env(2, 10));
  assert.equal(picked.state, 'picked');
  assert.equal(picked.days, 2);
  assert.equal(L.nodeState(bramble, 'fg@0,0,1', prof, env(2, 12)).state, 'ripe');
  assert.equal(L.nodeState(bramble, 'fg@0,0,2', prof, env(2, 10)).state, 'ripe', 'other nodes are unaffected');
});

test('elder gives flowers in spring and berries in autumn', () => {
  assert.equal(L.yieldIn(elder, 0).item, 'elderflower');
  assert.equal(L.yieldIn(elder, 2).item, 'elderberry');
  assert.equal(L.yieldIn(elder, 1), null);
  assert.deepEqual(L.bearingSeasons(elder), [0, 2]);
  assert.deepEqual(L.seasonTable(elder).map((s) => s.items), [['elderflower'], [], ['elderberry'], []]);
});

test('gentle reasons match the server wording', () => {
  assert.equal(L.stateReason({ state: 'season' }), 'Nothing to pick this season.');
  assert.match(L.stateReason({ state: 'picked', days: 1 }), /tomorrow/);
  assert.match(L.stateReason({ state: 'picked', days: 3 }), /few days/);
  assert.equal(L.stateReason({ state: 'ripe' }), '');
});

test('season of an env is clamped', () => {
  assert.equal(L.seasonOf({ season: 3 }), 3);
  assert.equal(L.seasonOf({ season: 7 }), 0);
  assert.equal(L.seasonOf(null), 0);
});

test('buff clock maths', () => {
  const env = { day: 2, time: 10, dayLen: 1440 };
  assert.equal(L.gameHours(env), 34);
  // 60 real seconds at 1440 s per day = 1 game hour; extrapolation is capped at 5 s
  assert.equal(L.gameHoursNow(env, 0), 34);
  assert.ok(Math.abs(L.gameHoursNow(env, 3) - (34 + 3 * 24 / 1440)) < 1e-9);
  assert.ok(Math.abs(L.gameHoursNow(env, 60) - (34 + 5 * 24 / 1440)) < 1e-9);
  const buff = { until: 36, hours: 4 };
  assert.equal(L.buffRemaining(buff, 34), 2);
  assert.equal(L.buffFraction(buff, 34), 0.5);
  assert.equal(L.buffRemaining(buff, 40), 0);
  assert.equal(L.buffFraction(buff, 40), 0);
  assert.equal(L.buffFraction({ until: 50, hours: 4 }, 34), 1, 'clamped when the clock went backwards');
  assert.equal(L.buffFraction({ until: 50, hours: 0 }, 34), 0);
});

test('remaining time reads naturally', () => {
  assert.equal(L.formatHours(2 + 10 / 60), '2 h 10 min');
  assert.equal(L.formatHours(3), '3 h');
  assert.equal(L.formatHours(0.75), '45 min');
  assert.equal(L.formatHours(0.001), 'under a minute');
  assert.equal(L.formatHours(0), 'worn off');
  assert.equal(L.formatHoursShort(2 + 10 / 60), '2:10');
  assert.equal(L.formatHoursShort(0.25), '0:15');
  assert.equal(L.formatHoursShort(-1), '0:00');
});

test('buffs sort meal, drink, snack and vanished ones are found', () => {
  const a = { slot: 'snack', item: 'bars', until: 5 }, b = { slot: 'meal', item: 'soup', until: 9 }, c = { slot: 'drink', item: 'tea', until: 7 };
  assert.deepEqual(L.sortBuffs([a, b, c]).map((x) => x.slot), ['meal', 'drink', 'snack']);
  assert.deepEqual(L.goneBuffs([a, b, c], [b]).map((x) => x.item), ['bars', 'tea']);
  // a new tea in the same slot replaces the old one: the old one is gone
  assert.deepEqual(L.goneBuffs([c], [{ ...c, until: 12 }]).map((x) => x.until), [7]);
  assert.deepEqual(L.goneBuffs(null, []), []);
});

test('eat verbs and edibility', () => {
  assert.equal(L.eatVerb({ buff: { slot: 'drink' } }), 'Drink');
  assert.equal(L.eatVerb({ buff: { slot: 'meal' } }), 'Eat');
  assert.ok(L.isEdible({ kind: 'food', use: 'eat', buff: {} }));
  assert.ok(L.isEdible({ kind: 'ingredient', use: 'eat', buff: {} }));
  assert.ok(!L.isEdible({ kind: 'ingredient', use: '' }), 'elderberries are not eaten raw');
  assert.ok(!L.isEdible({ kind: 'supply', use: 'eat', buff: {} }));
});

const recipes = [
  { id: 'pine_tip_tea', name: 'Pine-Tip Tea', station: 'kettle', inputs: [{ item: 'pine_tips', qty: 2 }], output: 'pine_tip_tea', qty: 2, learn: 'start' },
  { id: 'bilberry_tart', name: 'Bilberry Tart', station: 'stove', inputs: [{ item: 'bilberry', qty: 3 }, { item: 'flour', qty: 2 }], output: 'bilberry_tart', qty: 1, learn: 'plant:bilberry' },
  { id: 'nettle_tea', name: 'Nettle Tea', station: 'kettle', inputs: [{ item: 'nettle', qty: 2 }], output: 'nettle_tea', qty: 2, learn: 'plant:nettle' },
];
const items = { pine_tips: { name: 'Pine Tips' }, bilberry: { name: 'Bilberry' }, flour: { name: 'Bag of Flour' } };

test('recipe needs count every stack in the pack', () => {
  const p = { inventory: [{ item: 'pine_tips', qty: 3 }, { item: 'pine_tips', qty: 2 }] };
  assert.equal(L.countItem(p, 'pine_tips'), 5);
  const n = L.recipeNeeds(recipes[0], p);
  assert.equal(n.batches, 2);
  assert.ok(n.ready);
  assert.deepEqual(n.inputs, [{ item: 'pine_tips', need: 2, have: 5, ok: true }]);
  const tart = L.recipeNeeds(recipes[1], { inventory: [{ item: 'bilberry', qty: 4 }] });
  assert.equal(tart.batches, 0);
  assert.equal(L.missingText(tart, items), '2 more Bag of Flour');
  const none = L.recipeNeeds(recipes[1], { inventory: [] });
  assert.equal(L.missingText(none, items), '3 more Bilberry and 2 more Bag of Flour');
});

test('stations: the cabin has both, a camp only the kettle, nowhere neither', () => {
  assert.ok(L.stationAllows('cabin', recipes[1]));
  assert.ok(L.stationAllows('camp', recipes[0]));
  assert.ok(!L.stationAllows('camp', recipes[1]));
  assert.ok(!L.stationAllows(null, recipes[0]));
});

test('the cook model groups by station and orders ready, missing, stove, unknown', () => {
  const profile = { recipes: ['pine_tip_tea', 'bilberry_tart'], inventory: [{ item: 'pine_tips', qty: 2 }, { item: 'bilberry', qty: 3 }, { item: 'flour', qty: 2 }] };
  const atCamp = L.cookModel(recipes, profile, 'camp');
  assert.deepEqual(atCamp.map((g) => g.station), ['kettle', 'stove']);
  assert.deepEqual(atCamp[0].recipes.map((e) => [e.recipe.id, e.status]), [['pine_tip_tea', 'ready'], ['nettle_tea', 'unknown']]);
  assert.deepEqual(atCamp[1].recipes.map((e) => [e.recipe.id, e.status]), [['bilberry_tart', 'station']]);
  const atCabin = L.cookModel(recipes, profile, 'cabin');
  assert.equal(atCabin[1].recipes[0].status, 'ready');
  const nowhere = L.cookModel(recipes, profile, null);
  assert.equal(nowhere[0].recipes[0].status, 'nofire');
});

test('learn hints never name a plant that has not been found', () => {
  const plants = [{ id: 'nettle', name: 'Stinging Nettle' }];
  const hidden = L.learnHint(recipes[2], { plants, profile: { journal: { plants: {} } } });
  assert.ok(!/Nettle/.test(hidden), hidden);
  const known = L.learnHint(recipes[2], { plants, profile: { journal: { plants: { nettle: {} } } } });
  assert.match(known, /Stinging Nettle/);
  const nudge = L.learnHint(recipes[2], { plants: [{ id: 'nettle', name: 'Stinging Nettle', habitat: 'Damp, rich ground.' }], profile: {} });
  assert.equal(nudge, 'Something new from damp, rich ground may bring this one to mind.');
  assert.match(L.learnHint({ learn: 'npc:mara' }, { npcs: { mara: { name: 'Mara' } } }), /Mara/);
  assert.match(L.learnHint({ learn: 'lore:keepers_stew' }), /book/);
  assert.match(L.learnHint({ learn: 'start' }), /always known/);
});

test('cook place: cabin within 25 m, nearest camp within 12 m', () => {
  const pois = {
    cabin: { id: 'cabin', kind: 'cabin', pos: { x: 0, z: 0 } },
    camp_a: { id: 'camp_a', kind: 'camp', pos: { x: 100, z: 0 } },
    camp_b: { id: 'camp_b', kind: 'camp', pos: { x: 108, z: 0 } },
  };
  assert.equal(L.cookPlaceAt({ x: 20, z: 10 }, pois).at, 'cabin');
  const c = L.cookPlaceAt({ x: 106, z: 1 }, pois);
  assert.equal(c.at, 'camp');
  assert.equal(c.poi.id, 'camp_b');
  assert.equal(L.cookPlaceAt({ x: 50, z: 50 }, pois).at, null);
  assert.equal(L.cookPlaceAt(null, pois).at, null);
});

test('herbarium model keeps the server order and marks found plants', () => {
  const m = L.herbariumModel([bramble, elder], { journal: { plants: { elder: { id: 'elder', picked: 2 } } } });
  assert.deepEqual(m.map((x) => [x.plant.id, !!x.entry]), [['bramble', false], ['elder', true]]);
});

test('pick results read as a short list', () => {
  assert.equal(L.gotText([{ item: 'blackberry', qty: 2 }, { item: 'x', qty: 0 }], { blackberry: { name: 'Blackberry' } }), 'Blackberry ×2');
  assert.equal(L.gotText(null, {}), '');
});

test('the pick motion dips and comes back', () => {
  assert.equal(L.dipCurve(0), 0);
  assert.equal(L.dipCurve(1), 0);
  assert.equal(L.dipCurve(0.4), 1);
  assert.ok(L.dipCurve(0.2) > 0 && L.dipCurve(0.2) < 1);
  assert.ok(L.dipCurve(0.8) > 0 && L.dipCurve(0.8) < 1);
  assert.equal(L.dipCurve(NaN), 0);
});
