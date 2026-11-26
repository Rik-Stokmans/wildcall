import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPhotos, photoSubjectIds, subjectLabel, recordingInfo, qualityWord, groupLocations, undiscoveredNearHome, locationStats,
  groupLore, diaryPages, pageNumber, rareNewestFirst,
} from './journal-logic.js';

const photos = [
  { id: 'p1', stars: 3, subjects: [{ species: 'robin' }] },
  { id: 'p2', stars: 1, subjects: [{ mystery: 'm1', species: '' }] },
  { id: 'p3', stars: 5, subjects: [] },
  { id: 'p4', stars: 4, subjects: [{ species: 'wren' }, { species: 'robin' }] },
];

test('photo filters', () => {
  assert.deepEqual(filterPhotos(photos).map((p) => p.id), ['p4', 'p3', 'p2', 'p1'], 'newest first');
  assert.deepEqual(filterPhotos(photos, { subject: 'robin' }).map((p) => p.id), ['p4', 'p1']);
  assert.deepEqual(filterPhotos(photos, { subject: 'unknown' }).map((p) => p.id), ['p2']);
  assert.deepEqual(filterPhotos(photos, { subject: 'none' }).map((p) => p.id), ['p3']);
  assert.deepEqual(filterPhotos(photos, { minStars: 4 }).map((p) => p.id), ['p4', 'p3']);
  assert.deepEqual(photoSubjectIds(photos).sort(), ['robin', 'wren']);
});

test('subject and recording labels never invent a name', () => {
  const by = { robin: { name: 'Robin' } };
  const mys = [{ id: 'm1', label: 'Unknown bird A' }];
  assert.equal(subjectLabel({ species: 'robin' }, by, mys), 'Robin');
  assert.equal(subjectLabel({ mystery: 'm1' }, by, mys), 'Unknown bird A');
  assert.equal(subjectLabel({ mystery: 'zz' }, by, mys), 'Unknown bird');
  assert.deepEqual(recordingInfo({ species: 'robin' }, by, mys), { who: 'Robin', named: true });
  assert.deepEqual(recordingInfo({ species: '', mystery: 'm1' }, by, mys), { who: 'Unknown bird A', named: false });
  assert.deepEqual(recordingInfo({ species: 'ghost' }, by, mys), { who: 'Unknown bird', named: false });
});

test('quality words', () => {
  assert.equal(qualityWord(90), 'Excellent');
  assert.equal(qualityWord(10), 'Faint');
});

test('locations group by region with distance and bearing from home', () => {
  const locs = {
    a: { day: 2, name: 'Zed Tower', kind: 'watchtower', region: 0, pos: { x: 0, y: 0, z: -340 } },
    b: { day: 1, name: 'Alpha Hide', kind: 'hide', region: 0, pos: { x: 400, y: 0, z: 0 } },
    c: { day: 5, name: 'Dune Cairn', kind: 'landmark', region: 3, pos: { x: -2000, y: 0, z: 0 } },
  };
  const g = groupLocations(locs, { x: 0, y: 0, z: 0 });
  assert.deepEqual(g.map((x) => x.region), [0, 3]);
  assert.deepEqual(g[0].items.map((i) => i.loc.name), ['Alpha Hide', 'Zed Tower']);
  assert.equal(g[0].items[1].bearing, 'N');
  assert.equal(g[0].items[1].text, '340 m N of home');
  assert.equal(g[1].items[0].text, '2.0 km W of home');
  assert.deepEqual(locationStats(g), { total: 3, regions: 2, farthest: 2000 });
});

test('undiscovered count ignores people, pick-ups and far places and never lists names', () => {
  const pois = [
    { id: 'old_watchtower', kind: 'watchtower', pos: { x: 100, z: 0 } },
    { id: 'hidden_pond', kind: 'pond', pos: { x: 0, z: 100 } },
    { id: 'npc_mara', kind: 'npc', pos: { x: 3, z: 3 } },
    { id: 'page_0', kind: 'page', pos: { x: 3, z: 3 } },
    { id: 'far', kind: 'camp', pos: { x: 5000, z: 0 } },
    { id: 'cabin', kind: 'cabin', pos: { x: 0, z: 0 } },
  ];
  assert.equal(undiscoveredNearHome(pois, {}, { x: 0, z: 0 }, 450), 2);
  assert.equal(undiscoveredNearHome(pois, { old_watchtower: {} }, { x: 0, z: 0 }, 450), 1);
  assert.equal(typeof undiscoveredNearHome(pois, {}, { x: 0, z: 0 }, 450), 'number');
});

test('lore groups: unlocked only, with a count of what remains', () => {
  const defs = [
    { id: 'l1', category: 'ecology', title: 'A' }, { id: 'l2', category: 'history', title: 'B' },
    { id: 'l3', category: 'ecology', title: 'C' }, { id: 'l4', category: 'weird', title: 'D' },
  ];
  const r = groupLore(defs, ['l3', 'l2', 'l4']);
  assert.deepEqual(r.groups.map((g) => g.id), ['ecology', 'history', 'weird']);
  assert.equal(r.locked, 1);
  assert.equal(r.groups[0].entries[0].id, 'l3');
});

test('diary pages are ordered and missing pages carry no text', () => {
  const defs = [
    { id: 'page_2', kind: 'page', text: 'two' }, { id: 'feather_x', kind: 'feather' }, { id: 'page_0', kind: 'page', text: 'zero' },
    { id: 'page_10', kind: 'page', text: 'ten' },
  ];
  const pages = diaryPages(defs, { page_0: 3, page_10: 9 });
  assert.deepEqual(pages.map((p) => p.def.id), ['page_0', 'page_2', 'page_10']);
  assert.deepEqual(pages.map((p) => p.found), [true, false, true]);
  assert.equal(pages[0].day, 3);
  assert.equal(pageNumber('page_10'), 10);
});

test('rare discoveries newest first', () => {
  assert.deepEqual(rareNewestFirst([{ id: 1 }, { id: 2 }]).map((r) => r.id), [2, 1]);
});
