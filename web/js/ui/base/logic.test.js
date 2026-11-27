import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from './logic.js';

const items = {
  basic_binoculars: { id: 'basic_binoculars', name: 'Basic Binoculars', kind: 'equipment', slot: 'optics', tier: 1, rarity: 0, price: 0,
    mods: { binoZoom: 0, binoStability: 0, binoWeight: 0 }, upgrades: [
      { id: 'coating', name: 'Lens coating', price: 40, reqRank: 1, reqCabin: '', mods: { binoClarity: 0.1 } },
      { id: 'tuned', name: 'Tuned focus', price: 90, reqRank: 2, reqCabin: 'workshop', mods: { binoFocus: 0.4 } },
    ] },
  explorer_binoculars: { id: 'explorer_binoculars', name: 'Explorer Binoculars', kind: 'equipment', slot: 'optics', tier: 2, rarity: 1, price: 100,
    reqRank: 2, reqRep: 20, mods: { binoZoom: 2, binoStability: -0.1, binoWeight: 0.3 }, upgrades: [] },
  film_roll: { id: 'film_roll', name: 'Film Roll', kind: 'supply', slot: '', tier: 1, rarity: 0, price: 10, stack: 5, mods: {} },
  forgotten_journal: { id: 'forgotten_journal', name: 'Forgotten Journal', kind: 'keepsake', tier: 4, rarity: 4, price: 0, mods: {} },
};

const baseProfile = () => ({
  credits: 120, rank: 2, rep: { outfitters: 15, rangers: 10 },
  inventory: [{ item: 'film_roll', qty: 3 }], storage: [], equipped: { optics: 'basic_binoculars' },
  upgrades: {}, cabin: [], regions: [1],
  journal: { species: {}, mysteries: [], photos: [], recordings: [], pinned: [], rare: [] }, quests: {},
});

test('unitPrice applies the discount and clamps it', () => {
  assert.equal(L.unitPrice(100, 0.1), 90);
  assert.equal(L.unitPrice(100, 0.9), 50); // discount capped at 50%
  assert.equal(L.unitPrice(1, 0.5), 1); // never free unless it was free
  assert.equal(L.unitPrice(0, 0.3), 0);
  assert.equal(L.unitPrice(33, 0.15), 28);
});

test('purchaseCheck: buyable, rank, rep, credits, owned, capacity', () => {
  const stats = { capacity: 8, discount: 0 };
  let p = baseProfile();
  let r = L.purchaseCheck(items.explorer_binoculars, p, stats);
  assert.equal(r.canBuy, true);
  assert.equal(r.price, 100);

  p.rank = 1;
  r = L.purchaseCheck(items.explorer_binoculars, p, stats);
  assert.deepEqual(r.issues.map((i) => i.code), ['rank']);

  p = baseProfile(); p.rep = { outfitters: 5, rangers: 5 };
  r = L.purchaseCheck(items.explorer_binoculars, p, stats);
  assert.deepEqual(r.issues.map((i) => i.code), ['rep']);

  p = baseProfile(); p.credits = 80;
  r = L.purchaseCheck(items.explorer_binoculars, p, stats);
  assert.deepEqual(r.issues.map((i) => i.code), ['credits']);
  assert.match(r.issues[0].text, /20 more/);
  // ...but a 25% discount makes 75 credits enough
  r = L.purchaseCheck(items.explorer_binoculars, p, { ...stats, discount: 0.25 });
  assert.equal(r.canBuy, true);
  assert.equal(r.price, 75);

  p = baseProfile(); p.storage = [{ item: 'explorer_binoculars', qty: 1 }];
  r = L.purchaseCheck(items.explorer_binoculars, p, stats);
  assert.equal(r.owned, true);
  assert.deepEqual(r.issues.map((i) => i.code), ['owned']);

  p = baseProfile();
  p.inventory = Array.from({ length: 8 }, (_, i) => ({ item: 'x' + i, qty: 1 }));
  r = L.purchaseCheck(items.explorer_binoculars, p, stats);
  assert.deepEqual(r.issues.map((i) => i.code), ['capacity']);
});

test('supplies are never "owned" and stack into a full pack', () => {
  const stats = { capacity: 2 };
  const p = baseProfile();
  p.inventory = [{ item: 'film_roll', qty: 2 }, { item: 'x', qty: 1 }];
  let r = L.purchaseCheck(items.film_roll, p, stats);
  assert.equal(r.canBuy, true); // merges into the film stack (2 < 5)
  p.inventory[0].qty = 5;
  r = L.purchaseCheck(items.film_roll, p, stats);
  assert.deepEqual(r.issues.map((i) => i.code), ['capacity']);
});

test('unsold items cannot be bought', () => {
  const r = L.purchaseCheck(items.forgotten_journal, baseProfile(), {});
  assert.deepEqual(r.issues.map((i) => i.code), ['unsold']);
});

test('capacityInfo counts stacks, ignores equipped, tolerates missing stats', () => {
  const p = baseProfile();
  assert.deepEqual(L.capacityInfo(p, { capacity: 8 }), { used: 1, cap: 8, free: 7, full: false });
  assert.equal(L.capacityInfo(p, {}).full, false);
  assert.equal(L.capacityInfo({ inventory: null }, { capacity: 3 }).used, 0);
});

test('compareToEquipped: deltas against the equipped item including its upgrades', () => {
  const p = baseProfile();
  let c = L.compareToEquipped(items.explorer_binoculars, p, items);
  assert.equal(c.current.id, 'basic_binoculars');
  const byKey = Object.fromEntries(c.deltas.map((d) => [d.key, d.delta]));
  assert.equal(byKey.binoZoom, 2);
  assert.ok(Math.abs(byKey.binoStability + 0.1) < 1e-9);
  assert.ok(Math.abs(byKey.binoWeight - 0.3) < 1e-9);

  p.upgrades = { basic_binoculars: ['coating'] };
  c = L.compareToEquipped({ ...items.explorer_binoculars, mods: { binoClarity: 0.1, binoZoom: 2 } }, p, items);
  // the equipped coating already gives +0.1 clarity: no delta for that stat
  assert.equal(c.deltas.some((d) => d.key === 'binoClarity'), false);

  c = L.compareToEquipped(items.basic_binoculars, p, items);
  assert.equal(c.same, true);
  assert.deepEqual(c.deltas, []);

  c = L.compareToEquipped(items.film_roll, p, items);
  assert.equal(c.current, null);
});

test('compareToEquipped with an empty slot compares against nothing', () => {
  const p = baseProfile(); p.equipped = {};
  const c = L.compareToEquipped(items.explorer_binoculars, p, items);
  assert.equal(c.current, null);
  assert.equal(c.deltas.find((d) => d.key === 'binoZoom').delta, 2);
});

test('upgradeStatus: rank, workshop and credits gates', () => {
  const p = baseProfile();
  const [coating, tuned] = items.basic_binoculars.upgrades;
  assert.equal(L.upgradeStatus(items.basic_binoculars, coating, p, {}).canBuy, true);
  let s = L.upgradeStatus(items.basic_binoculars, tuned, p, {});
  assert.deepEqual(s.issues.map((i) => i.code), ['cabin']);
  p.cabin = ['workshop'];
  assert.equal(L.upgradeStatus(items.basic_binoculars, tuned, p, {}).canBuy, true);
  p.rank = 1;
  assert.deepEqual(L.upgradeStatus(items.basic_binoculars, tuned, p, {}).issues.map((i) => i.code), ['rank']);
  p.rank = 2; p.credits = 10;
  assert.deepEqual(L.upgradeStatus(items.basic_binoculars, tuned, p, {}).issues.map((i) => i.code), ['credits']);
  p.credits = 500; p.upgrades = { basic_binoculars: ['tuned'] };
  s = L.upgradeStatus(items.basic_binoculars, tuned, p, {});
  assert.equal(s.bought, true);
  assert.equal(s.canBuy, false);
});

test('upgradableItems lists owned equipment with upgrades once each', () => {
  const p = baseProfile();
  p.storage = [{ item: 'basic_binoculars', qty: 1 }, { item: 'explorer_binoculars', qty: 1 }];
  const list = L.upgradableItems(p, items);
  assert.deepEqual(list.map((x) => [x.item.id, x.where]), [['basic_binoculars', 'equipped']]);
});

test('hoursUntil wraps midnight and never returns zero', () => {
  assert.equal(L.hoursUntil(8, 12), 4);
  assert.equal(L.hoursUntil(23, 5), 6);
  assert.equal(L.hoursUntil(22, 18.5), 20.5);
  assert.equal(L.hoursUntil(5, 5), 24);
  assert.equal(L.hoursUntil(4.999, 5), 24);
  assert.ok(Math.abs(L.hoursUntil(18.25, 18.5) - 0.25) < 1e-9);
});

test('formatDuration and clock', () => {
  assert.equal(L.formatDuration(7.5), '7 h 30 min');
  assert.equal(L.formatDuration(24), '24 h');
  assert.equal(L.formatDuration(0.25), '15 min');
  assert.equal(L.clock(18.5), '18:30');
  assert.equal(L.clock(5), '05:00');
  assert.equal(L.clock(24.25), '00:15');
});

test('restPlan: hours, next-day flag and forecast reach', () => {
  const env = { time: 20, forecast: [{ hour: 21, weather: 1 }, { hour: 0, weather: 2 }, { hour: 3, weather: 2 }, { hour: 6, weather: 0 }] };
  const dawn = L.REST_OPTIONS[0];
  let plan = L.restPlan(env, { forecast: 12 }, dawn);
  assert.equal(plan.hours, 9.5);
  assert.equal(plan.nextDay, true);
  assert.equal(plan.forecast, 2); // slot 3..6 covers 05:30
  assert.equal(plan.forecastState, 'ok');
  assert.equal(plan.wakeClock, '05:30');

  plan = L.restPlan(env, { forecast: 6 }, dawn); // 9 h away, beyond a 6 h forecast
  assert.equal(plan.forecast, null);
  assert.equal(plan.forecastState, 'far');

  plan = L.restPlan(env, { forecast: 0 }, dawn);
  assert.equal(plan.forecastState, 'none');

  const night = L.REST_OPTIONS[4];
  plan = L.restPlan({ time: 14, forecast: [] }, { forecast: 12 }, night);
  assert.equal(plan.hours, 8);
  assert.equal(plan.nextDay, false);
});

test('rest options are the five pinned times', () => {
  assert.deepEqual(L.REST_OPTIONS.map((o) => [o.label, o.hour]),
    [['Dawn', 5.5], ['Morning', 8], ['Midday', 12], ['Evening', 18.5], ['Night', 22]]);
  assert.match(L.REST_OPTIONS[0].blurb, /chorus is at its loudest/);
});

test('pin slot limits: 4 (as the server allows), or 12 with the photo wall', () => {
  const p = baseProfile();
  p.journal.photos = Array.from({ length: 14 }, (_, i) => ({ id: 'p' + i }));
  p.journal.pinned = ['p0', 'p1', 'p2'];
  let info = L.pinInfo(p);
  assert.deepEqual([info.slots, info.count, info.free, info.canPin], [4, 3, 1, true]);
  p.journal.pinned.push('p3');
  info = L.pinInfo(p);
  assert.equal(info.canPin, false);
  p.cabin = ['photo_wall'];
  info = L.pinInfo(p);
  assert.deepEqual([info.slots, info.free, info.canPin], [12, 8, true]);
  // pins that no longer match a photo are ignored
  p.journal.pinned = ['ghost', 'p1'];
  assert.equal(L.pinInfo(p).count, 1);
});

test('wallLayout fits inside the wall area', () => {
  for (const n of [6, 12]) {
    const frames = L.wallLayout(n);
    assert.equal(frames.length, n);
    for (const f of frames) {
      assert.ok(f.x >= L.WALL_AREA.x && f.x + f.w <= L.WALL_AREA.x + L.WALL_AREA.w + 1e-6);
      assert.ok(f.y >= L.WALL_AREA.y && f.y + f.h <= L.WALL_AREA.y + L.WALL_AREA.h + 1e-6);
    }
  }
});

const quests = {
  a: { id: 'a', name: 'Alpha', giver: 'board', reqRank: 1, requires: [], objectives: [{ id: 'o1', count: 3 }, { id: 'o2', count: 1 }] },
  b: { id: 'b', name: 'Bravo', giver: 'board', reqRank: 3, requires: [], objectives: [{ id: 'o1', count: 1 }] },
  c: { id: 'c', name: 'Charlie', giver: 'board', reqRank: 1, requires: ['a'], objectives: [] },
  d: { id: 'd', name: 'Delta', giver: 'board', reqRank: 1, hidden: true, requires: [], objectives: [] },
  e: { id: 'e', name: 'Echo', giver: 'mara', reqRank: 1, requires: [], objectives: [] },
  f: { id: 'f', name: 'Foxtrot', giver: 'board', reqRank: 1, requires: [], objectives: [{ id: 'o1', count: 2 }] },
  g: { id: 'g', name: 'Golf', giver: 'board', reqRank: 1, requires: [], objectives: [{ id: 'o1', count: 2 }] },
};

test('contractBoard derives states and ignores non-board quests', () => {
  const p = baseProfile();
  p.quests = {
    a: { status: 'active', progress: { o1: 2 } },
    f: { status: 'complete', progress: {} },
    g: { status: 'turned_in', progress: {} },
  };
  const board = L.contractBoard(quests, p);
  const by = Object.fromEntries(board.map((x) => [x.def.id, x]));
  assert.equal(by.e, undefined); // not a board contract
  assert.equal(by.d, undefined); // hidden, no state yet
  assert.equal(by.a.status, 'active');
  assert.ok(Math.abs(by.a.fraction - 2 / 4) < 1e-9);
  assert.equal(by.a.objectives[0].have, 2);
  assert.equal(by.b.status, 'locked');
  assert.match(by.b.lock, /rank 3/);
  assert.equal(by.c.status, 'locked'); // prerequisite not turned in
  assert.equal(by.f.status, 'complete');
  assert.equal(by.f.fraction, 1);
  assert.equal(by.g.status, 'done');
  // complete first, then active, then locked, then done
  assert.deepEqual(board.map((x) => x.def.id), ['f', 'a', 'b', 'c', 'g']);
});

test('contractBoard: no state + requirements met = available; hidden with state is shown', () => {
  const p = baseProfile();
  p.quests = { a: { status: 'turned_in', progress: {} }, d: { status: 'available', progress: {} } };
  const by = Object.fromEntries(L.contractBoard(quests, p).map((x) => [x.def.id, x]));
  assert.equal(by.c.status, 'available');
  assert.equal(by.f.status, 'available');
  assert.equal(by.d.status, 'available');
});

test('subjectLabel never leaks unidentified species', () => {
  const p = baseProfile();
  p.journal.species = { eurasian_wren: { id: 'eurasian_wren', level: 4 } };
  p.journal.mysteries = [{ id: 'm1', label: 'Unknown bird A' }];
  const sp = { eurasian_wren: { name: 'Eurasian Wren' }, european_robin: { name: 'European Robin' } };
  assert.equal(L.subjectLabel('eurasian_wren', '', p, sp), 'Eurasian Wren');
  assert.equal(L.subjectLabel('european_robin', 'm1', p, sp), 'Unknown bird A');
  assert.equal(L.subjectLabel('european_robin', '', p, sp), 'Unknown bird');
  assert.equal(L.subjectLabel('', 'm9', p, sp), 'Unknown bird');
  assert.equal(L.photoLabel({ subjects: [] }, p, sp), 'No subject in frame');
});

test('studyLists splits level 5 (ready) from 6 (studied)', () => {
  const p = baseProfile();
  p.journal.species = {
    a: { id: 'a', level: 4 }, b: { id: 'b', level: 5, study: 40 }, c: { id: 'c', level: 5, study: 80 }, d: { id: 'd', level: 6, study: 100 },
  };
  const s = L.studyLists(p);
  assert.deepEqual(s.ready.map((e) => e.id), ['c', 'b']);
  assert.deepEqual(s.studied.map((e) => e.id), ['d']);
  assert.equal(s.waiting, 1);
});

test('unanalyzedRecordings and submitLists', () => {
  const p = baseProfile();
  p.journal.recordings = [
    { id: 'r1', analyzed: false, quality: 40, stars: 2, submitted: false },
    { id: 'r2', analyzed: true, quality: 80, stars: 4, submitted: true },
    { id: 'r3', analyzed: false, quality: 70, stars: 3, submitted: false },
  ];
  p.journal.photos = [{ id: 'p1', stars: 0, submitted: false }, { id: 'p2', stars: 3, submitted: false, score: 70 }];
  assert.deepEqual(L.unanalyzedRecordings(p).map((r) => r.id), ['r3', 'r1']);
  const s = L.submitLists(p);
  assert.equal(s.pending, 3); // p2, r1, r3
  assert.equal(s.photos.find((x) => x.item.id === 'p1').eligible, false);
  assert.equal(s.recs.find((x) => x.item.id === 'r2').submitted, true);
});

test('journalSummary counts by discovery level over the unlocked catalog', () => {
  const p = baseProfile();
  p.regions = [0];
  p.journal.species = {
    a: { id: 'a', level: 4, firstDay: 1 }, b: { id: 'b', level: 5, firstDay: 3 }, c: { id: 'c', level: 6, firstDay: 2 },
  };
  p.journal.rare = [{ id: 'r1', day: 2 }, { id: 'r2', day: 5 }];
  const species = [{ id: 'a', regions: [0] }, { id: 'b', regions: [0] }, { id: 'c', regions: [0, 1] }, { id: 'd', regions: [0] }, { id: 'z', regions: [4] }];
  const ranks = [{ index: 1, title: 'Beginner' }, { index: 2, title: 'Observer' }];
  const s = L.journalSummary(p, species, ranks);
  assert.equal(s.total, 4); // z is in a locked region
  assert.deepEqual([s.identified, s.documented, s.studied], [3, 2, 1]);
  assert.deepEqual(s.recent.map((e) => e.id), ['b', 'c', 'a']);
  assert.equal(s.rareCount, 2);
  assert.equal(s.rare[0].id, 'r2');
  assert.equal(s.rank, 2);
  assert.equal(s.rankTitle, 'Observer');
  assert.equal(s.nextRank, null);
});

test('cabinUpgradeStatus', () => {
  const p = baseProfile();
  const def = { id: 'audio_lab', price: 200, reqRank: 3 };
  let s = L.cabinUpgradeStatus(def, p, [{ index: 3, title: 'Naturalist' }]);
  assert.deepEqual(s.issues.map((i) => i.code), ['rank', 'credits']);
  assert.match(s.issues[0].text, /Naturalist/);
  p.rank = 3; p.credits = 250;
  assert.equal(L.cabinUpgradeStatus(def, p).canBuy, true);
  p.cabin = ['audio_lab'];
  s = L.cabinUpgradeStatus(def, p);
  assert.equal(s.owned, true);
  assert.equal(s.canBuy, false);
  assert.equal(L.cabinFeatures(p).audioLab, true);
  assert.equal(L.cabinFeatures(p).garden, false);
});

test('moveCheck blocks a full backpack', () => {
  const p = baseProfile();
  p.inventory = Array.from({ length: 3 }, (_, i) => ({ item: 'x' + i, qty: 1 }));
  assert.equal(L.moveCheck({ id: 'k', stack: 0 }, 'inventory', p, { capacity: 3 }).ok, false);
  assert.equal(L.moveCheck({ id: 'k', stack: 0 }, 'storage', p, { capacity: 3 }).ok, true);
});

test('skyScene: day, night, weather', () => {
  const noon = L.skyScene(12.5, 0);
  assert.ok(noon.sun && !noon.moon);
  assert.ok(noon.light > 0.9);
  assert.equal(noon.night, false);
  const night = L.skyScene(1, 0);
  assert.ok(night.moon && !night.sun);
  assert.ok(night.stars > 0.85);
  assert.equal(night.night, true);
  const rain = L.skyScene(12.5, 2);
  assert.ok(rain.rain > 0 && rain.cloud > 0.8);
  assert.notEqual(rain.top, noon.top);
  // env values override weather defaults
  assert.equal(L.skyScene(12.5, 0, { rain: 0.3 }).rain, 0.3);
  // colours are valid hex through the whole day
  for (let h = 0; h < 24; h += 0.5) {
    const s = L.skyScene(h, h % 4);
    assert.match(s.top, /^#[0-9a-f]{6}$/);
    assert.match(s.bottom, /^#[0-9a-f]{6}$/);
  }
});

test('mixHex', () => {
  assert.equal(L.mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(L.mixHex('#102030', '#102030', 0.7), '#102030');
});

test('shop helpers', () => {
  const stock = L.shopStock(['explorer_binoculars', 'film_roll', 'missing', 'forgotten_journal'], items);
  assert.deepEqual(stock.map((s) => s.id), ['film_roll', 'explorer_binoculars']);
  assert.equal(L.shopTabOf(items.film_roll), 'supplies');
  assert.equal(L.shopTabOf(items.explorer_binoculars), 'gear');
  assert.equal(L.shopTabOf({ kind: 'ingredient' }), 'supplies');
  assert.equal(L.shopTabOf({ kind: 'food' }), 'supplies');
  assert.match(L.finnLine(items.explorer_binoculars, 'gear'), /Glass/);
  assert.equal(L.finnLine(null, 'upgrades'), L.FINN_LINES.upgrades);
});

test('rewardLines', () => {
  const lines = L.rewardLines({ xp: 100, credits: 1500, items: ['film_roll'], rep: { research: 5 }, skillPoints: 1 }, items);
  assert.deepEqual(lines, ['100 XP', '1,500 Field Credits', 'Film Roll', '1 skill point', '5 research reputation']);
});

test('tolerates null collections from Go nil slices', () => {
  const p = { inventory: null, storage: null, equipped: null, upgrades: null, cabin: null, rep: null, journal: { species: null, mysteries: null, photos: null, recordings: null, pinned: null, rare: null }, quests: null, regions: null };
  assert.equal(L.countOwned(p, 'x'), 0);
  assert.equal(L.pinInfo(p).count, 0);
  assert.deepEqual(L.contractBoard(quests, p).map((c) => c.status).includes('available'), true);
  assert.equal(L.journalSummary(p, [], []).total, 0);
  assert.equal(L.analysisInfo(p, {}).lab, false);
  assert.equal(L.studyLists(p).ready.length, 0);
});

test('analysisInfo mentions the lab and audio assist when present', () => {
  const p = baseProfile(); p.cabin = ['audio_lab'];
  const a = L.analysisInfo(p, { audioAssist: 1.5 });
  assert.equal(a.lab, true);
  assert.ok(a.lines.some((l) => /audio laboratory gives/.test(l)));
  assert.ok(a.lines.some((l) => /audio assist 1.5/.test(l)));
});
