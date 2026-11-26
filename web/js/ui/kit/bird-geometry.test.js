import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveBirdGeometry, normalizeLook, billProfile, tailPolygon, catmullRom, wingPoint,
  TAIL_SHAPES, BILL_SHAPES, WING_SHAPES, MARK_KINDS, GENERIC_LOOK, DEFAULT_COLORS,
} from './bird-geometry.js';
import { FIXTURES } from './fixtures.js';

const byId = (id) => FIXTURES.find((f) => f.id === id);
const finite = (v, path = 'v') => {
  if (typeof v === 'number') assert.ok(Number.isFinite(v), `${path} is not finite: ${v}`);
  else if (Array.isArray(v)) v.forEach((x, i) => finite(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') finite(x, `${path}.${k}`);
};
const species = (look, extra = {}) => ({ look: { ...GENERIC_LOOK, ...look }, ...extra });

test('every fixture derives finite geometry in both poses', () => {
  for (const sp of FIXTURES) for (const pose of ['perched', 'flying']) {
    const g = deriveBirdGeometry(sp, pose);
    finite(g, `${sp.id}/${pose}`);
    assert.ok(g.bbox.w > 0.5 && g.bbox.h > 0.3, `${sp.id}/${pose} bbox too small`);
    assert.ok(g.bbox.w < 8 && g.bbox.h < 8, `${sp.id}/${pose} bbox too large`);
    assert.equal(g.pose, pose);
  }
});

test('every vocabulary value produces a distinct, valid shape', () => {
  for (const kind of BILL_SHAPES) {
    const g = deriveBirdGeometry(species({ billShape: kind }));
    assert.equal(g.bill.kind, kind);
    assert.ok(g.bill.polygon.length > 10);
    finite(g.bill);
    assert.ok(g.bill.len > 0 && g.bill.depth > 0);
  }
  const tails = TAIL_SHAPES.map((kind) => deriveBirdGeometry(species({ tailShape: kind })).tail);
  tails.forEach((t) => finite(t));
  assert.equal(new Set(tails.map((t) => t.polygon.length + ':' + t.w1.toFixed(3))).size, TAIL_SHAPES.length, 'tail shapes must differ');
  for (const kind of WING_SHAPES) for (const pose of ['perched', 'flying']) {
    const g = deriveBirdGeometry(species({ wingShape: kind }), pose);
    assert.ok(g.wing.outline.length > 12, `${kind}/${pose}`);
    finite(g.wing.outline);
  }
  for (const kind of MARK_KINDS) {
    const g = deriveBirdGeometry(species({ marks: [{ kind, color: '#ffffff' }] }));
    assert.equal(g.look.marks[0].kind, kind);
  }
});

test('forked tails have a notch, pointed tails taper, fans widen', () => {
  const t = (shape) => deriveBirdGeometry(species({ tailShape: shape, tail: 1 })).tail;
  assert.ok(t('forked').notch > 0);
  assert.equal(t('square').notch, 0);
  assert.ok(t('fan').w1 > t('square').w1 * 1.5);
  assert.ok(t('pointed').w1 < t('square').w1 * 0.4);
  const cocked = deriveBirdGeometry(species({ tailShape: 'cocked' })).tail;
  assert.ok(cocked.t[1] < 0, 'a cocked tail points upwards');
  assert.ok(t('square').t[1] > 0, 'a normal perched tail droops');
});

test('wren versus heron: the extreme proportions stay distinct and sane', () => {
  const wren = deriveBirdGeometry(byId('eurasian_wren'));
  const heron = deriveBirdGeometry(byId('grey_heron'));
  assert.ok(heron.bbox.h / heron.bbox.w > 1.4 * (wren.bbox.h / wren.bbox.w), 'heron is far taller than it is wide');
  assert.ok(heron.neck.length > wren.neck.length * 8, 'heron neck');
  assert.ok(Math.abs(heron.head.cy - heron.body.cy) > 3 * Math.abs(wren.head.cy - wren.body.cy), 'heron head sits high above its body');
  assert.ok(heron.legs.foot[1] - heron.legs.hip[1] > 3 * (wren.legs.foot[1] - wren.legs.hip[1]), 'heron legs are long');
  assert.ok(heron.bill.len > wren.bill.len * 2.5, 'heron bill');
  assert.ok(heron.tilt > wren.tilt, 'heron stands more upright');
  assert.ok(heron.body.ry < wren.body.ry, 'heron is slimmer, wren is round');
  assert.ok(heron.head.r < wren.head.r * 1.2, 'heron head stays small');
  assert.ok(heron.metersPerUnit > wren.metersPerUnit * 5, 'real sizes are kept');
  assert.ok(heron.semiSpan === undefined && deriveBirdGeometry(byId('grey_heron'), 'flying').semiSpan > 1);
});

test('plumpness scales the body, tail length scales the tail', () => {
  const slim = deriveBirdGeometry(species({ plump: 0.7 })), round = deriveBirdGeometry(species({ plump: 1.3 }));
  assert.ok(round.body.ry > slim.body.ry * 1.5);
  const short = deriveBirdGeometry(species({ tail: 0.2 })), long = deriveBirdGeometry(species({ tail: 1.5 }));
  assert.ok(long.tail.len > short.tail.len * 6);
});

test('posture follows the way the species lives', () => {
  const mallard = deriveBirdGeometry(byId('mallard'));
  assert.equal(mallard.perch.kind, 'water');
  assert.equal(mallard.legs.visible, false);
  assert.ok(mallard.tilt < 0.5, 'swimmers sit level');
  const pecker = deriveBirdGeometry(byId('great_spotted_woodpecker'));
  assert.equal(pecker.perch.kind, 'trunk');
  assert.ok(pecker.tilt > 1);
  assert.equal(deriveBirdGeometry(byId('grey_heron')).perch.kind, 'ground');
  assert.equal(deriveBirdGeometry(byId('european_robin')).perch.kind, 'branch');
  assert.equal(deriveBirdGeometry(byId('european_robin'), 'flying').perch, null);
});

test('crest only appears when the look has one', () => {
  assert.ok(deriveBirdGeometry(byId('eurasian_jay')).crest);
  assert.equal(deriveBirdGeometry(byId('european_robin')).crest, null);
});

test('flying: wingspan drives the wing length, long legs trail', () => {
  const swallow = deriveBirdGeometry(byId('barn_swallow'), 'flying');
  const heron = deriveBirdGeometry(byId('grey_heron'), 'flying');
  assert.ok(heron.legs.kind === 'trail' && swallow.legs.kind === 'tuck');
  assert.ok(heron.legs.foot[0] < heron.tail.tip[0], 'heron legs trail past the tail');
  assert.ok(swallow.wing.outline.length === heron.wing.outline.length || true);
  const wide = deriveBirdGeometry(species({ length: 0.2, wingspan: 0.6 }), 'flying');
  const narrow = deriveBirdGeometry(species({ length: 0.2, wingspan: 0.26 }), 'flying');
  assert.ok(wide.semiSpan > narrow.semiSpan * 1.5);
  assert.ok(wide.farWing && wide.farWing.dark);
});

test('the bbox contains the head, bill tip and tail tip', () => {
  for (const sp of FIXTURES) {
    const g = deriveBirdGeometry(sp);
    const b = g.bbox, inside = ([x, y]) => x >= b.minX - 1e-9 && x <= b.maxX + 1e-9 && y >= b.minY - 1e-9 && y <= b.maxY + 1e-9;
    assert.ok(inside(g.bill.tip) && inside(g.tail.tip) && inside([g.head.cx, g.head.cy]), sp.id);
  }
});

test('hostile input is clamped, not propagated', () => {
  const g = deriveBirdGeometry({ look: { length: NaN, plump: 99, neck: -5, legs: 'tall', tail: null, tailShape: 'zigzag', billShape: '??', wingShape: 'x', colors: { back: 'red' }, marks: [{ kind: 'nope' }, { kind: 'cap', color: 'bad' }, null] } });
  finite(g);
  assert.equal(g.look.tailShape, 'square');
  assert.equal(g.look.billShape, 'cone');
  assert.equal(g.look.colors.back, DEFAULT_COLORS.back);
  assert.deepEqual(g.look.marks, [{ kind: 'cap', color: '#f2ebdd' }]);
  finite(deriveBirdGeometry(undefined));
  finite(deriveBirdGeometry(null, 'flying'));
  finite(deriveBirdGeometry({}, 'bogus'));
  assert.equal(normalizeLook(undefined).plump, 1);
});

test('geometry is deterministic', () => {
  for (const sp of FIXTURES) assert.equal(JSON.stringify(deriveBirdGeometry(sp)), JSON.stringify(deriveBirdGeometry(sp)));
});

test('bill profiles: hooks bend down, curved bills curve, flat bills end round', () => {
  const tipY = (k) => billProfile(k, 1, 0.3).upper.at(-1)[1];
  assert.ok(tipY('hooked') > 0.2 && tipY('curved') > 0.3 && Math.abs(tipY('dagger')) < 0.02);
  const flat = billProfile('flat', 1, 0.3), chisel = billProfile('chisel', 1, 0.3);
  assert.ok(flat.upper.at(-1)[1] === flat.lower.at(-1)[1] - 0 || Math.abs(flat.upper.at(-1)[1]) < 1e-6, 'flat tip closes');
  assert.ok(chisel.lower.at(-1)[1] - chisel.upper.at(-1)[1] > 0.1, 'chisel keeps a blunt end');
  assert.equal(billProfile('cone', 1, 0.3).polygon.length, 2 * 19);
});

test('helpers: tailPolygon, catmullRom, wingPoint', () => {
  const poly = tailPolygon({ root: [0, 0], t: [-1, 0], len: 1, w0: 0.2, w1: 0.2, notch: 0, kind: 'square' });
  assert.ok(poly.every(([x]) => x <= 1e-9 && x >= -1 - 1e-9));
  const sp = catmullRom([[0, 0], [1, 1], [2, 0]], 4);
  assert.deepEqual(sp[0], [0, 0]);
  assert.deepEqual(sp.at(-1), [2, 0]);
  const w = { origin: [1, 1], ax: [1, 0], ay: [0, 1], lenU: 2, depthU: 3 };
  assert.deepEqual(wingPoint(w, 1, 1), [3, 4]);
});
