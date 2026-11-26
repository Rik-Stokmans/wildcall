import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tileKey, parseTileKey, tileIndex, worldToTile, worldToCell, cellRect, decodeMask, encodeMask, maskBit,
  setMaskBit, createFog, tilesToFetch, tileUrl, MASK_BYTES,
} from './fog.js';

const mk = (cells) => { const m = new Uint8Array(MASK_BYTES); for (const [cx, cz] of cells) setMaskBit(m, cx, cz); return encodeMask(m); };

test('tile keys round trip, negatives included', () => {
  assert.equal(tileKey(-3, 7), '-3,7');
  assert.deepEqual(parseTileKey('-3,7'), { tx: -3, tz: 7 });
  assert.equal(parseTileKey('x,1'), null);
  assert.equal(parseTileKey('1,2,3'), null);
});

test('tile index uses floor division', () => {
  assert.equal(tileIndex(0), 0);
  assert.equal(tileIndex(511.9), 0);
  assert.equal(tileIndex(512), 1);
  assert.equal(tileIndex(-0.1), -1);
  assert.equal(tileIndex(-512), -1);
  assert.equal(tileIndex(-512.1), -2);
  assert.deepEqual(worldToTile(-1, 600), { tx: -1, tz: 1 });
});

test('world to cell, negative coordinates', () => {
  assert.deepEqual(worldToCell(0, 0), { tx: 0, tz: 0, cx: 0, cz: 0 });
  assert.deepEqual(worldToCell(33, 65), { tx: 0, tz: 0, cx: 1, cz: 2 });
  // x = -1 is in tile -1, the last cell column (x in [-32, 0))
  assert.deepEqual(worldToCell(-1, -1), { tx: -1, tz: -1, cx: 15, cz: 15 });
  assert.deepEqual(worldToCell(-512, -33), { tx: -1, tz: -1, cx: 0, cz: 14 });
  assert.deepEqual(cellRect(-1, 0, 15, 2), { x: -32, z: 64, size: 32 });
});

test('mask decoding and bit layout', () => {
  const b64 = mk([[0, 0], [15, 15], [3, 1]]);
  const m = decodeMask(b64);
  assert.equal(m.length, 32);
  assert.ok(maskBit(m, 0, 0));
  assert.ok(maskBit(m, 15, 15));
  assert.ok(maskBit(m, 3, 1));
  assert.ok(!maskBit(m, 1, 0));
  assert.ok(!maskBit(m, 16, 0));
  // bit i = cz*16+cx lives in byte i>>3 at 1<<(i&7): cell (3,1) -> i=19 -> byte 2, bit 3
  assert.equal(m[2] & 8, 8);
  assert.equal(decodeMask('!!'), null);
  assert.equal(decodeMask(btoa('short')), null);
  assert.equal(decodeMask(undefined), null);
});

test('fog lookup across tiles incl. negative world coordinates', () => {
  const fog = createFog().update({
    '0,0': mk([[0, 0], [1, 0]]),
    '-1,-1': mk([[15, 15]]),
    '2,-3': mk([[5, 5]]),
    bogus: mk([[0, 0]]),
    '9,9': mk([]),
  });
  assert.ok(fog.isExplored(5, 5));
  assert.ok(fog.isExplored(40, 10));
  assert.ok(!fog.isExplored(70, 10));
  assert.ok(fog.isExplored(-1, -1));
  assert.ok(!fog.isExplored(-33, -1));
  assert.ok(fog.isExplored(2 * 512 + 5 * 32 + 1, -3 * 512 + 5 * 32 + 1));
  assert.ok(!fog.isExplored(10000, 10000));
  assert.equal(fog.cellCount, 4);
  assert.equal(fog.tiles.length, 3, 'empty and malformed tiles are not listed');
});

test('forEachCell visits only explored cells in the rect', () => {
  const fog = createFog().update({ '0,0': mk([[0, 0], [1, 0], [15, 15]]) });
  const seen = [];
  fog.forEachCell({ x0: 0, z0: 0, x1: 40, z1: 10 }, (x, z) => seen.push([x, z]));
  assert.deepEqual(seen, [[0, 0], [32, 0]]);
});

test('only tiles with explored cells inside the viewport are fetched', () => {
  const fog = createFog().update({ '0,0': mk([[0, 0]]), '5,5': mk([[1, 1]]), '-1,0': mk([[3, 3]]), '1,0': mk([]) });
  const need = tilesToFetch(fog, { x0: -600, z0: -50, x1: 600, z1: 50 });
  assert.deepEqual(need.map((t) => t.key).sort(), ['-1,0', '0,0']);
  assert.deepEqual(tilesToFetch(fog, { x0: 9000, z0: 9000, x1: 9100, z1: 9100 }), []);
});

test('tile url substitutes signed coordinates', () => {
  assert.equal(tileUrl('/map/{tx}/{tz}.png', -2, 3), '/map/-2/3.png');
  assert.equal(tileUrl(undefined, 0, -1), '/map/0/-1.png');
});

test('fog update reuses decoded masks for unchanged data', () => {
  const fog = createFog();
  const data = { '0,0': mk([[2, 2]]) };
  fog.update(data);
  const first = fog.tiles[0].mask;
  fog.update({ ...data });
  assert.equal(fog.tiles[0].mask, first);
});
