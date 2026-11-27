import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from './packlogic.js';

const items = {
  bino: { id: 'bino', name: 'Explorer Binoculars', kind: 'equipment', slot: 'optics', w: 2, h: 2 },
  bino2: { id: 'bino2', name: 'Basic Binoculars', kind: 'equipment', slot: 'optics', w: 2, h: 2 },
  tripod: { id: 'tripod', name: 'Tripod', kind: 'gadget', w: 1, h: 4 },
  tele: { id: 'tele', name: 'Telephoto Camera', kind: 'equipment', slot: 'camera', w: 3, h: 2 },
  film: { id: 'film', name: 'Film Roll', kind: 'supply', stack: 6, w: 1, h: 1 },
  seed: { id: 'seed', name: 'Seed Mix', kind: 'supply', stack: 8, w: 1, h: 1 },
  stool: { id: 'stool', name: 'Folding Stool & Scrim', kind: 'gadget', w: 2, h: 3 },
  baro: { id: 'baro', name: 'Pocket Barometer', kind: 'gadget', w: 1, h: 1 },
};
const pack = (stacks, w = 5, h = 4, equipped = {}) =>
  P.gridModel('inventory', { stats: { packW: w, packH: h }, inventory: stacks, equipped }, items);

test('footprint: size, turn, unknown items are 1x1', () => {
  assert.deepEqual(P.footprint(items.tele), { w: 3, h: 2 });
  assert.deepEqual(P.footprint(items.tele, true), { w: 2, h: 3 });
  assert.deepEqual(P.footprint(undefined), { w: 1, h: 1 });
  assert.deepEqual(P.footprint({ w: 0, h: 0 }), { w: 1, h: 1 });
});

test('occupancy honours rotation and skip', () => {
  const m = pack([{ item: 'tripod', qty: 1, x: 0, y: 0, r: true }, { item: 'film', qty: 2, x: 4, y: 3 }]);
  const occ = P.occupancy(m, items);
  assert.deepEqual([...occ.slice(0, 5)], [1, 1, 1, 1, 0]); // tripod lies across row 0
  assert.equal(occ[3 * 5 + 4], 2);
  assert.equal(P.usedCells(m, items), 5);
  assert.equal(P.occupancy(m, items, 0)[0], 0);
  assert.deepEqual(P.usage(m, items), { used: 5, total: 20, free: 15, frac: 0.25, full: false });
});

test('grid model sizes: pack from stats, storage at least 10x12 and taller with overflow rows', () => {
  assert.equal(pack([]).W, 5);
  assert.equal(P.gridModel('inventory', { stats: { packW: 8.0001, packH: 6 } }, items).W, 8);
  const s = P.gridModel('storage', { storage: [] }, items);
  assert.deepEqual([s.W, s.H], [10, 12]);
  const over = P.gridModel('storage', { storage: [{ item: 'tripod', qty: 1, x: 0, y: 12 }] }, items);
  assert.equal(over.H, 16);
});

test('stack limits: research backpack bonus applies in the pack only', () => {
  assert.equal(P.stackLimit(items.film, 'inventory', {}), 6);
  assert.equal(P.stackLimit(items.film, 'inventory', { backpack: 'research_backpack' }), 9);
  assert.equal(P.stackLimit(items.film, 'storage', { backpack: 'research_backpack' }), 6);
  assert.equal(P.stackLimit(items.bino, 'inventory', { backpack: 'research_backpack' }), 1);
});

test('evaluatePlace: move, turn in place, out of bounds, taken', () => {
  const m = pack([{ item: 'bino', qty: 1, x: 0, y: 0 }, { item: 'tripod', qty: 1, x: 4, y: 0 }]);
  let e = P.evaluatePlace(m, m, 0, 0, 2, 2, false, items);
  assert.equal(e.ok, true); assert.equal(e.kind, 'move'); assert.equal(e.cells.length, 4);
  e = P.evaluatePlace(m, m, 0, 0, 0, 0, false, items);
  assert.equal(e.kind, 'same');
  e = P.evaluatePlace(m, m, 0, 0, 1, 0, false, items); // nudging over its own old cells is fine
  assert.equal(e.kind, 'move');
  e = P.evaluatePlace(m, m, 0, 0, 3, 0, false, items);
  assert.equal(e.ok, false); assert.equal(e.kind, 'taken'); assert.equal(e.reason, 'That spot is taken by the Tripod.');
  e = P.evaluatePlace(m, m, 4, 0, 4, 1, false, items);
  assert.equal(e.kind, 'oob'); assert.equal(e.reason, 'The Tripod does not fit there.');
  e = P.evaluatePlace(m, m, 4, 0, 0, 3, true, items); // turned, it lies along the bottom row
  assert.equal(e.ok, true);
  e = P.evaluatePlace(m, m, 3, 3, 0, 0, false, items);
  assert.equal(e.kind, 'none'); assert.equal(e.reason, 'There is nothing there to move.');
});

test('evaluatePlace: merge by the target cell, full stack, between grids', () => {
  const m = pack([{ item: 'film', qty: 4, x: 0, y: 0 }, { item: 'film', qty: 5, x: 1, y: 0 }, { item: 'film', qty: 6, x: 2, y: 0 }]);
  let e = P.evaluatePlace(m, m, 0, 0, 1, 0, false, items);
  assert.equal(e.kind, 'merge'); assert.equal(e.qty, 1); assert.equal(e.target, 1);
  e = P.evaluatePlace(m, m, 0, 0, 2, 0, false, items);
  assert.equal(e.kind, 'full'); assert.equal(e.reason, 'That stack of Film Roll is already full.');
  const after = P.applyPlace(m, m, 0, 0, 1, 0, false, items);
  assert.deepEqual(after.from.map((s) => s.qty), [3, 6, 6]);
  const store = P.gridModel('storage', { storage: [{ item: 'film', qty: 2, x: 5, y: 5 }] }, items);
  e = P.evaluatePlace(m, store, 0, 0, 5, 5, false, items);
  assert.equal(e.kind, 'merge'); assert.equal(e.qty, 4);
  const moved = P.applyPlace(m, store, 0, 0, 5, 5, false, items);
  assert.equal(moved.from.length, 2); assert.equal(moved.to[0].qty, 6);
  // Into an empty storage cell: the whole stack moves across.
  const across = P.applyPlace(m, store, 2, 0, 9, 11, false, items);
  assert.equal(across.from.length, 2);
  assert.deepEqual(across.to[1], { item: 'film', qty: 6, x: 9, y: 11, r: false });
  // The source arrays are never changed.
  assert.equal(m.stacks.length, 3); assert.equal(store.stacks.length, 1);
});

test('applyPlace turns in place and refuses what the server would refuse', () => {
  const m = pack([{ item: 'tele', qty: 1, x: 0, y: 0 }]);
  const t = P.applyPlace(m, m, 0, 0, 0, 0, true, items);
  assert.deepEqual(t.from[0], { item: 'tele', qty: 1, x: 0, y: 0, r: true });
  assert.equal(P.applyPlace(m, m, 0, 0, 3, 0, false, items), null);
});

test('snapCell: pointer to the top-left cell of the piece', () => {
  // A 2x2 piece grabbed at its centre, pointer on the corner between cells: top-left (2, 1).
  assert.deepEqual(P.snapCell(3 * 50 + 4, 2 * 50 - 4, 50, 0.5, 0.5, 2, 2), { x: 2, y: 1 });
  // Grabbed at its top-left corner: the cell under the pointer.
  assert.deepEqual(P.snapCell(130, 20, 50, 0.1, 0.1, 2, 2), { x: 2, y: 0 });
  // Left of the grid: negative cells (refused as out of bounds).
  assert.ok(P.snapCell(-80, 10, 50, 0.5, 0.5, 1, 1).x < 0);
  // Turning about the grab point.
  assert.deepEqual(P.turnGrab(0.25, 0.75), { gx: 0.25, gy: 0.25 });
});

test('findSpace and addTarget mirror the server: top-up first, unturned before turned', () => {
  const m = pack([{ item: 'film', qty: 6, x: 0, y: 0 }, { item: 'film', qty: 3, x: 1, y: 0 }], 4, 4);
  assert.deepEqual(P.addTarget(m, items, 'film'), { kind: 'merge', target: 1 });
  assert.deepEqual(P.addTarget(m, items, 'tripod'), { kind: 'place', x: 2, y: 0, r: false });
  const tall = pack([{ item: 'stool', qty: 1, x: 0, y: 0 }, { item: 'stool', qty: 1, x: 2, y: 0 }], 4, 4);
  assert.deepEqual(P.findSpace(tall, items, 'tripod'), { x: 0, y: 3, r: true });
  const full = pack([{ item: 'tele', qty: 1, x: 0, y: 0 }, { item: 'tele', qty: 1, x: 0, y: 2 }], 3, 4);
  assert.equal(P.hasRoomFor(full, items, 'baro'), false);
});

test('fitsAfterTidy: a scattered pack that would hold one more once tidied', () => {
  // 4x4 with two 2x2 binoculars in the middle columns: no 2x2 hole, but tidied there is.
  const m = pack([{ item: 'bino', qty: 1, x: 1, y: 0 }, { item: 'bino2', qty: 1, x: 1, y: 2 }], 4, 4);
  assert.equal(P.hasRoomFor(m, items, 'stool'), false);
  assert.equal(P.fitsAfterTidy(m, items, 'stool'), true);
  const crammed = pack([{ item: 'tele', qty: 1, x: 0, y: 0 }, { item: 'tele', qty: 1, x: 0, y: 2 }], 3, 4);
  assert.equal(P.fitsAfterTidy(crammed, items, 'baro'), false);
  // Free cells add up but the tidied layout leaves them apart: not promised.
  const apart = pack([{ item: 'stool', qty: 1, x: 0, y: 0 }, { item: 'baro', qty: 1, x: 2, y: 0 }], 3, 3);
  assert.equal(P.usage(apart, items).free, 2);
  assert.equal(P.fitsAfterTidy(apart, items, 'tripod'), false);
});

test('tidyLayout: merged stacks, biggest first, compact from the top-left', () => {
  const m = pack([{ item: 'film', qty: 4, x: 4, y: 3 }, { item: 'film', qty: 4, x: 0, y: 3 }, { item: 'baro', qty: 1, x: 2, y: 2 }, { item: 'tele', qty: 1, x: 2, y: 0 }]);
  const t = P.tidyLayout(m, items);
  assert.deepEqual(t.map((s) => [s.item, s.qty, s.x, s.y, s.r]), [
    ['tele', 1, 0, 0, false], ['baro', 1, 3, 0, false], ['film', 6, 4, 0, false], ['film', 2, 3, 1, false]]);
  assert.equal(P.occupancy({ ...m, stacks: t }, items).filter(Boolean).length, 9);
});

test('quickMoveTarget: smallest stack, room, server texts', () => {
  const m = pack([{ item: 'film', qty: 6, x: 0, y: 0 }, { item: 'film', qty: 2, x: 1, y: 0 }]);
  const store = P.gridModel('storage', { storage: [] }, items);
  assert.equal(P.smallestStack(m.stacks, 'film'), 1);
  assert.deepEqual(P.quickMoveTarget(m, store, items, 'film'), { ok: true, target: { kind: 'place', x: 0, y: 0, r: false }, reason: '' });
  assert.equal(P.quickMoveTarget(store, m, items, 'film').ok, false);
  const fullPack = pack([{ item: 'tele', qty: 1, x: 0, y: 0 }, { item: 'tele', qty: 1, x: 0, y: 2 }], 3, 4);
  const s2 = P.gridModel('storage', { storage: [{ item: 'tripod', qty: 1, x: 0, y: 0 }] }, items);
  assert.match(P.quickMoveTarget(s2, fullPack, items, 'tripod').reason, /^Your pack is full: no room for the Tripod/);
});

test('predictSwap: the item taken off takes the freed spot, turned, or the first free spot', () => {
  const m = pack([{ item: 'bino', qty: 1, x: 3, y: 2 }, { item: 'film', qty: 1, x: 0, y: 0 }]);
  assert.deepEqual(P.predictSwap(m, items, 0, 'bino2'), { x: 3, y: 2, r: false });
  assert.deepEqual(P.predictSwap(m, items, 0, 'tele'), { x: 1, y: 0, r: false });
  assert.equal(P.predictSwap(m, items, 0, ''), null);
  const tight = pack([{ item: 'bino', qty: 1, x: 0, y: 0 }, { item: 'stool', qty: 1, x: 2, y: 0 }, { item: 'stool', qty: 1, x: 2, y: 3 }], 4, 6);
  assert.deepEqual(P.predictSwap(tight, items, 0, 'tripod'), { x: 0, y: 0, r: false });
  const wide = pack([{ item: 'tripod', qty: 1, x: 0, y: 0, r: true }], 4, 4);
  assert.deepEqual(P.predictSwap(wide, items, 0, 'tele'), { x: 0, y: 0, r: false });
  const nook = pack([{ item: 'baro', qty: 1, x: 0, y: 0 }, { item: 'tele', qty: 1, x: 1, y: 0 }, { item: 'tele', qty: 1, x: 0, y: 2 }], 4, 4);
  assert.deepEqual(P.predictSwap(nook, items, 0, 'tripod'), { tidy: true });
});

test('footprint diagram and text', () => {
  assert.deepEqual(P.footprintDiagram(items.tele), [[true, true, true], [true, true, true], [false, false, false]]);
  assert.deepEqual(P.footprintDiagram(items.baro), [[true]]);
  assert.equal(P.footprintText(items.tele, true), '2×3');
});
