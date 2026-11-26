import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveRig, archetypeOf, profilesComplete, tailLengthAt, billDropAt, billWidthAt, wingOutline,
  BILL_PROFILES, TAIL_PROFILES, WING_PROFILES, ARCHETYPES, FINGER_FRACTION,
} from './rig.js';
import { BILL_SHAPES, TAIL_SHAPES, WING_SHAPES } from './constants.js';

import { species as sp } from './test-fixtures.js';

test('every vocabulary word has a profile', () => {
  assert.ok(profilesComplete());
  for (const s of BILL_SHAPES) assert.ok(BILL_PROFILES[s], s);
  for (const s of TAIL_SHAPES) assert.ok(TAIL_PROFILES[s], s);
  for (const s of WING_SHAPES) assert.ok(WING_PROFILES[s], s);
});

test('Length and Wingspan set real scale', () => {
  const small = deriveRig(sp({ length: 0.1, wingspan: 0.16 }));
  const big = deriveRig(sp({ length: 0.5, wingspan: 0.8 }));
  assert.ok(Math.abs(big.body.rz / small.body.rz - 5) < 0.6, 'body scales with length');
  assert.ok(big.wing.len > small.wing.len * 4);
  // half-span ≈ body half-width + wing (+ fingers)
  for (const r of [small, big]) {
    const half = r.body.rx * 0.75 + r.wing.len * (1 + (r.wing.fingers ? FINGER_FRACTION : 0));
    assert.ok(Math.abs(half * 2 - r.span) < 0.02 * r.span + 1e-6);
  }
});

test('ratios shape the body', () => {
  const r = (o) => deriveRig(sp(o));
  assert.ok(r({ plump: 1.3 }).body.ry > r({ plump: 0.8 }).body.ry * 1.4);
  assert.equal(r({ neck: 0 }).neck, null);
  assert.ok(r({ neck: 0.9 }).neck.len > r({ neck: 0.4 }).neck.len);
  assert.ok(r({ legs: 1 }).legs.len > r({ legs: 0.1 }).legs.len * 4);
  assert.ok(r({ tail: 1.4 }).tail.len > r({ tail: 0.3 }).tail.len * 2.5);
  assert.ok(r({ bill: 2.5 }).bill.len > r({ bill: 0.3 }).bill.len * 3);
  assert.equal(r({ crest: false }).crest, null);
  assert.ok(r({ crest: true }).crest.len > 0);
});

test('bill shapes: thick cones, thin daggers, hooked tips, broad flat bills, curved tips', () => {
  const r = (s) => deriveRig(sp({ billShape: s }));
  assert.ok(r('cone').bill.baseH > r('thin').bill.baseH * 1.8, 'finch bill is deep');
  assert.ok(r('flat').bill.baseW > r('flat').bill.baseH * 2, 'duck bill is broad and flat');
  assert.ok(billWidthAt('flat', 1) > 0.4, 'flat bill stays wide to the tip');
  assert.ok(billWidthAt('dagger', 1) < 0.05, 'dagger tapers to a point');
  assert.ok(billDropAt('hooked', 1) > 0.4 && billDropAt('hooked', 0.5) < 0.05, 'hook only at the tip');
  assert.ok(billDropAt('curved', 1) > 0.3 && billDropAt('curved', 0.5) > 0.05, 'decurved along its length');
  assert.equal(billDropAt('dagger', 1), 0);
  assert.ok(BILL_PROFILES.chisel.tip > BILL_PROFILES.dagger.tip, 'chisel tip is blunt');
  assert.ok(r('nonsense').bill.shape === 'cone', 'unknown shape falls back');
});

test('tail shapes: forked notch, pointed centre, fanned and cocked', () => {
  assert.ok(tailLengthAt('forked', 0) < tailLengthAt('forked', 1) - 0.25);
  assert.ok(tailLengthAt('pointed', 0) > tailLengthAt('pointed', 1) + 0.35);
  assert.equal(tailLengthAt('square', 0), 1);
  assert.ok(tailLengthAt('square', 1) > 0.9);
  assert.ok(tailLengthAt('fan', 1) < tailLengthAt('fan', 0), 'rounded fan');
  const r = (s) => deriveRig(sp({ tailShape: s }));
  assert.ok(r('fan').tail.width > r('square').tail.width && r('fan').tail.spread > r('square').tail.spread);
  assert.ok(r('cocked').tail.restPitch > 0.8, 'wren tail held up');
  for (const s of TAIL_SHAPES) for (let x = -1; x <= 1; x += 0.25) {
    const v = tailLengthAt(s, x);
    assert.ok(v >= 0.15 && v <= 1, `${s} ${x} ${v}`);
  }
});

test('wing shapes: pointed and long taper, broad has fingers, rounded stays blunt', () => {
  const tip = (s) => wingOutline(s, 1).chord / wingOutline(s, 0).chord;
  assert.ok(tip('pointed') < 0.15 && tip('long') < 0.2);
  assert.ok(tip('rounded') > 0.4 && tip('broad') > 0.6);
  assert.ok(wingOutline('pointed', 1).le > wingOutline('rounded', 1).le, 'pointed wings sweep back');
  assert.ok(WING_PROFILES.long.chord < WING_PROFILES.broad.chord, 'long wings are narrow');
  const r = (s) => deriveRig(sp({ wingShape: s }));
  assert.equal(r('broad').wing.fingers, 1);
  assert.ok(r('broad').wing.fingerLen > 0);
  assert.equal(r('pointed').wing.fingerLen, 0);
  for (const s of WING_SHAPES) for (let u = 0; u <= 1; u += 0.1) {
    const o = wingOutline(s, u);
    assert.ok(o.chord > 0 && Number.isFinite(o.le), s);
  }
});

test('archetype from traits.shape, else inferred from the look', () => {
  assert.equal(archetypeOf({ traits: { shape: 'owl' } }), 'owl');
  assert.equal(archetypeOf(sp({ billShape: 'flat' }, { traits: {} })), 'duck');
  assert.equal(archetypeOf(sp({ billShape: 'chisel' }, { traits: {} })), 'woodpecker');
  assert.equal(archetypeOf(sp({ billShape: 'hooked', neck: 0, plump: 1.3 }, { traits: {} })), 'owl');
  assert.equal(archetypeOf(sp({ billShape: 'hooked', wingShape: 'long' }, { traits: {} })), 'gull');
  assert.equal(archetypeOf(sp({ billShape: 'hooked' }, { traits: {} })), 'raptor');
  assert.equal(archetypeOf(sp({ legs: 0.9, neck: 0.8 }, { traits: {} })), 'heron');
  assert.equal(archetypeOf(sp({ legs: 0.6, bill: 2 }, { traits: {} })), 'wader');
  assert.equal(archetypeOf(sp({}, { traits: {} })), 'songbird');
  assert.equal(archetypeOf({}), 'songbird');
});

test('upright birds carry the head on top once pitched; necks keep their carriage', () => {
  for (const arch of Object.keys(ARCHETYPES)) {
    const r = deriveRig(sp({ neck: arch === 'heron' ? 1 : 0.05 }, { traits: { shape: arch } }));
    const p = r.perchPitch, h = r.head;
    // head position after pitching the body nose-up by the perch pitch
    const y = h.y * Math.cos(p) - h.z * Math.sin(p);
    const z = h.y * Math.sin(p) + h.z * Math.cos(p);
    assert.ok(y > 0, `${arch}: head above body centre`);
    assert.ok(z < r.body.rz * 0.3, `${arch}: head not behind the body (z=${z.toFixed(3)})`);
  }
});

test('deriveRig survives missing or junk input', () => {
  for (const s of [undefined, {}, { look: {} }, { look: { length: 'x', wingspan: -3, plump: NaN } }]) {
    const r = deriveRig(s);
    for (const v of [r.body.rx, r.body.ry, r.body.rz, r.head.r, r.bill.len, r.tail.len, r.wing.len, r.legs.len]) {
      assert.ok(Number.isFinite(v) && v > 0);
    }
  }
});
