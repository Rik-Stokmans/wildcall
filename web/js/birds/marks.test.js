import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARK_PLACEMENT, preparePalette, paintAt, cellHash } from './marks.js';
import { MARK_KINDS } from './constants.js';

const RED = '#ff0000';
const base = { back: '#404040', belly: '#c0c0c0', head: '#505050', wing: '#303030', tail: '#202020', bill: '#111111', legs: '#222222', eye: '#000000' };
const ctx = { arch: 'songbird', disc: false };

/** Sample a part's paint coordinate domain on a grid. */
function* domain(part) {
  if (part === 'wing') { for (let s = 0; s <= 1; s += 0.05) for (const y of [1, -1]) for (let f = 0; f <= 1; f += 0.05) yield [s, y, f]; return; }
  if (part === 'tail') { for (let s = -1; s <= 1; s += 0.1) for (const y of [1, -1]) for (let f = 0; f <= 1; f += 0.05) yield [s, y, f]; return; }
  if (part === 'neck') { for (let s = -1; s <= 1; s += 0.1) for (let y = -1; y <= 1; y += 0.1) for (let f = 0; f <= 1; f += 0.1) yield [s, y, f]; return; }
  if (part === 'lowerbill') { for (let f = -1; f <= 1; f += 0.1) yield [0, -1, f]; return; }
  // body / head / crest: points on the unit sphere (the surface that is painted)
  for (let i = 1; i < 40; i++) {
    const a = (i / 40) * Math.PI;
    const ring = Math.max(4, Math.round(80 * Math.sin(a)));
    for (let j = 0; j < ring; j++) {
      const b = (j / ring) * Math.PI * 2;
      yield [Math.sin(a) * Math.sin(b), Math.sin(a) * Math.cos(b), Math.cos(a)];
    }
  }
}

function coverage(kind, part, c = ctx) {
  const pal = preparePalette({ colors: base, marks: [{ kind, color: RED }] });
  let hit = 0, n = 0;
  for (const [s, y, f] of domain(part)) {
    const rgb = paintAt(pal, part, s, y, f, c);
    n++;
    if (rgb[0] === 1 && rgb[1] === 0 && rgb[2] === 0) hit++;
  }
  return hit / n;
}

test('every mark kind has a placement on at least one part', () => {
  for (const k of MARK_KINDS) {
    assert.ok(MARK_PLACEMENT[k], k);
    assert.ok(Object.keys(MARK_PLACEMENT[k]).length > 0, k);
  }
  assert.deepEqual(Object.keys(MARK_PLACEMENT).sort(), [...MARK_KINDS].sort(), 'no stray kinds');
});

test('every mark paints a visible but partial region of each part it names', () => {
  for (const k of MARK_KINDS) {
    for (const part of Object.keys(MARK_PLACEMENT[k])) {
      if (part === 'crest' || part === 'lowerbill') continue; // whole-part marks by design
      const cov = coverage(k, part);
      assert.ok(cov > 0.01, `${k} on ${part} paints nothing (${cov})`);
      assert.ok(cov < 0.9, `${k} on ${part} floods the part (${cov})`);
    }
  }
});

test('marks sit where a birder expects them', () => {
  const pal = (kind) => preparePalette({ colors: base, marks: [{ kind, color: RED }] });
  const red = (rgb) => rgb[0] === 1 && rgb[1] === 0;
  assert.ok(red(paintAt(pal('breast'), 'body', 0, -0.5, 0.8, ctx)), 'breast: front underside');
  assert.ok(!red(paintAt(pal('breast'), 'body', 0, 0.8, -0.3, ctx)), 'breast not on the back');
  assert.ok(red(paintAt(pal('cap'), 'head', 0, 0.9, 0.1, ctx)), 'cap: crown');
  assert.ok(!red(paintAt(pal('cap'), 'head', 0, -0.9, 0.1, ctx)), 'cap not on the chin');
  assert.ok(red(paintAt(pal('rump'), 'body', 0, 0.6, -0.7, ctx)), 'rump: lower back');
  assert.ok(red(paintAt(pal('tailtip'), 'tail', 0, 1, 0.9, ctx)), 'tailtip: tip');
  assert.ok(!red(paintAt(pal('tailtip'), 'tail', 0, 1, 0.2, ctx)), 'tailtip not at the base');
  assert.ok(red(paintAt(pal('throat'), 'head', 0, -0.6, 0.4, ctx)), 'throat: under the chin');
  assert.ok(red(paintAt(pal('nape'), 'head', 0, 0.1, -0.8, ctx)), 'nape: back of the head');
  assert.ok(red(paintAt(pal('eyestripe'), 'head', 0.7, 0.27, 0.3, ctx)), 'eyestripe at eye level');
  assert.ok(red(paintAt(pal('wingbar'), 'wing', 0.4, 1, 0.28, ctx)), 'wingbar across the coverts');
});

test('owls paint the cheek as a facial disc; gulls paint the wingpatch as wingtips', () => {
  const owl = { arch: 'owl', disc: true }, gull = { arch: 'gull', disc: false };
  assert.ok(coverage('cheek', 'head', owl) > coverage('cheek', 'head') * 1.5);
  const pal = preparePalette({ colors: base, marks: [{ kind: 'wingpatch', color: RED }] });
  assert.equal(paintAt(pal, 'wing', 0.95, 1, 0.5, gull)[0], 1);
  assert.notEqual(paintAt(pal, 'wing', 0.4, 1, 0.5, gull)[0], 1);
});

test('marks paint in authored order (later over earlier)', () => {
  const pal = preparePalette({ colors: base, marks: [{ kind: 'breast', color: '#00ff00' }, { kind: 'spots', color: RED }] });
  let green = 0, red = 0;
  for (const [s, y, f] of domain('body')) {
    const c = paintAt(pal, 'body', s, y, f, ctx);
    if (c[1] === 1) green++;
    if (c[0] === 1) red++;
  }
  assert.ok(green > 0 && red > 0, 'spots over a washed breast');
});

test('palette: bare parts keep their colour, unknown marks are ignored, underparts blend', () => {
  const pal = preparePalette({ colors: base, marks: [{ kind: 'sparkles', color: RED }, null] });
  assert.equal(pal.marks.length, 0);
  assert.deepEqual(paintAt(pal, 'bill', 0, 0, 0, ctx), pal.bill);
  assert.deepEqual(paintAt(pal, 'eye', 0, 0, 0, ctx), pal.eye);
  assert.deepEqual(paintAt(pal, 'legs', 0, 0, 0, ctx), pal.legs);
  assert.deepEqual(paintAt(pal, 'body', 0, 0.9, 0, ctx), pal.back);
  assert.deepEqual(paintAt(pal, 'body', 0, -0.9, 0, ctx), pal.belly);
  assert.notDeepEqual(paintAt(pal, 'wing', 0.5, -1, 0.5, ctx), pal.wing, 'underwing is paler');
  const empty = preparePalette(undefined);
  assert.equal(empty.back.length, 3);
});

test('cellHash is deterministic and in 0..1', () => {
  for (let i = 0; i < 50; i++) {
    const h = cellHash(i, -i, i * 2);
    assert.ok(h >= 0 && h < 1);
    assert.equal(h, cellHash(i, -i, i * 2));
  }
});
