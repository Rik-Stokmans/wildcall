import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBirdMesh, BONES, BONE, BONE_PARENT, bonePositions } from './mesh.js';
import { deriveRig } from './rig.js';
import { BILL_SHAPES, TAIL_SHAPES, WING_SHAPES, MARK_KINDS } from './constants.js';
import { species as sp } from './test-fixtures.js';

function checkMesh(m, label) {
  assert.equal(m.positions.length, m.vertexCount * 3, label);
  assert.equal(m.vertexCount % 3, 0, `${label}: whole triangles`);
  assert.ok(m.vertexCount / 3 < 2200, `${label}: low poly (${m.vertexCount / 3} tris)`);
  for (const arr of [m.positions, m.normals, m.colors, m.colorsRare, m.skinWeight]) {
    for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `${label}: finite`);
  }
  for (let i = 0; i < m.vertexCount; i++) {
    const n = Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]);
    assert.ok(Math.abs(n - 1) < 1e-3, `${label}: unit normal`);
    assert.ok(m.skinIndex[i * 4] < BONES.length && m.skinIndex[i * 4 + 1] < BONES.length);
    assert.ok(Math.abs(m.skinWeight[i * 4] + m.skinWeight[i * 4 + 1] - 1) < 1e-6);
  }
  for (const c of m.colors) assert.ok(c >= 0 && c <= 1);
}

test('bone hierarchy is a tree with parents before children', () => {
  assert.equal(BONE_PARENT[BONE.body], -1);
  BONE_PARENT.forEach((p, i) => { if (i) assert.ok(p >= 0 && p < i, BONES[i]); });
  assert.equal(BONE_PARENT[BONE.handL], BONE.wingL);
  assert.equal(BONE_PARENT[BONE.jaw], BONE.head);
  assert.equal(BONE_PARENT[BONE.head], BONE.neck);
});

test('every vocabulary value builds a valid mesh', () => {
  for (const s of BILL_SHAPES) checkMesh(buildBirdMesh(sp({ billShape: s })), `bill ${s}`);
  for (const s of TAIL_SHAPES) checkMesh(buildBirdMesh(sp({ tailShape: s })), `tail ${s}`);
  for (const s of WING_SHAPES) checkMesh(buildBirdMesh(sp({ wingShape: s })), `wing ${s}`);
  checkMesh(buildBirdMesh(sp({ crest: true })), 'crest');
  checkMesh(buildBirdMesh(sp({ neck: 1, legs: 1, length: 0.95, wingspan: 1.85, billShape: 'dagger', bill: 2.4 }, { traits: { shape: 'heron' } })), 'heron');
  checkMesh(buildBirdMesh(sp({ billShape: 'hooked', plump: 1.3 }, { traits: { shape: 'owl' } })), 'owl');
  checkMesh(buildBirdMesh(sp({ billShape: 'flat', neck: 0.45 }, { traits: { shape: 'duck' }, move: { ground: 'swim' } })), 'duck');
  checkMesh(buildBirdMesh(undefined), 'no species');
});

test('model dimensions follow the look', () => {
  const extent = (m, k) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = k; i < m.positions.length; i += 3) { lo = Math.min(lo, m.positions[i]); hi = Math.max(hi, m.positions[i]); }
    return hi - lo;
  };
  for (const [len, span] of [[0.1, 0.16], [0.25, 0.4], [0.6, 1.4]]) {
    for (const w of WING_SHAPES) {
      const m = buildBirdMesh(sp({ length: len, wingspan: span, wingShape: w }));
      const sx = extent(m, 0);
      assert.ok(Math.abs(sx - span) / span < 0.08, `${w}: span ${sx.toFixed(3)} vs ${span}`);
      const sz = extent(m, 2);
      assert.ok(sz > len * 0.75 && sz < len * 1.1, `length ${sz.toFixed(3)} vs ${len}`);
    }
  }
});

test('structure toggles: crest, webbed feet, broad-wing fingers add geometry', () => {
  const tris = (m, part) => m.parts[part] || 0;
  assert.equal(tris(buildBirdMesh(sp({ crest: false })), 'crest'), 0);
  assert.ok(tris(buildBirdMesh(sp({ crest: true })), 'crest') > 0);
  const hop = buildBirdMesh(sp({}, { move: { ground: 'hop' } }));
  const swim = buildBirdMesh(sp({}, { move: { ground: 'swim' } }));
  assert.ok(tris(swim, 'legs') > tris(hop, 'legs'), 'webbed feet');
  assert.ok(tris(buildBirdMesh(sp({ wingShape: 'broad' })), 'wing') > tris(buildBirdMesh(sp({ wingShape: 'rounded' })), 'wing'));
  assert.equal(tris(buildBirdMesh(sp({ neck: 0 })), 'neck'), 0);
  assert.ok(tris(buildBirdMesh(sp({ neck: 0.6 })), 'neck') > 0);
  for (const p of ['body', 'head', 'bill', 'lowerbill', 'eye', 'tail', 'wing', 'cover', 'legs', 'throat', 'twig']) {
    assert.ok(tris(hop, p) > 0, `has ${p}`);
  }
});

test('every mark kind changes the painted model', () => {
  const plain = buildBirdMesh(sp());
  for (const kind of MARK_KINDS) {
    const m = buildBirdMesh(sp({ marks: [{ kind, color: '#ff0000' }] }));
    assert.equal(m.vertexCount, plain.vertexCount);
    let changed = 0;
    for (let i = 0; i < m.colors.length; i += 9) if (m.colors[i] !== plain.colors[i]) changed++;
    assert.ok(changed > 0, `${kind} visible on the model`);
  }
  const owl = sp({ marks: [{ kind: 'cheek', color: '#ff0000' }] }, { traits: { shape: 'owl' } });
  assert.ok(buildBirdMesh(owl).colors.some((c, i) => i % 3 === 0 && c === 1));
});

test('leucistic colours are paler than the normal plumage', () => {
  const m = buildBirdMesh(sp());
  let a = 0, b = 0;
  for (let i = 0; i < m.colors.length; i++) { a += m.colors[i]; b += m.colorsRare[i]; }
  assert.ok(b > a * 1.5);
});

test('closed parts face outwards (body normals point away from the centre)', () => {
  const m = buildBirdMesh(sp());
  const R = m.rig;
  let bad = 0, n = 0;
  for (let v = 0; v < m.vertexCount; v += 3) {
    const i = v * 3;
    if (m.skinIndex[v * 4] !== BONE.body) continue;
    const p = [0, 1, 2].map((k) => (m.positions[i + k] + m.positions[i + 3 + k] + m.positions[i + 6 + k]) / 3);
    // only triangles on the body ellipsoid itself
    const e = (p[0] / R.body.rx) ** 2 + (p[1] / R.body.ry) ** 2 + (p[2] / R.body.rz) ** 2;
    if (e < 0.6) continue;
    const a = [0, 1, 2].map((k) => m.positions[i + 3 + k] - m.positions[i + k]);
    const b = [0, 1, 2].map((k) => m.positions[i + 6 + k] - m.positions[i + k]);
    const nn = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    n++;
    if (nn[0] * p[0] + nn[1] * p[1] + nn[2] * p[2] < 0) bad++;
  }
  assert.ok(n > 100);
  assert.equal(bad, 0);
});

test('bone pivots sit where the parts are', () => {
  const R = deriveRig(sp());
  const pos = bonePositions(R);
  assert.deepEqual(pos[BONE.body], [0, 0, 0]);
  assert.ok(pos[BONE.wingR][0] > 0 && pos[BONE.wingL][0] < 0, 'wings on their sides');
  assert.ok(pos[BONE.handR][0] > pos[BONE.wingR][0], 'wrist outboard of the shoulder');
  assert.ok(pos[BONE.legR][1] < 0, 'hips below the centre');
  assert.ok(pos[BONE.tail][2] > 0, 'tail at the rear (+Z)');
  assert.ok(pos[BONE.jaw][2] < pos[BONE.head][2], 'bill in front of the head');
  const m = buildBirdMesh(sp());
  m.bones.forEach((b, i) => {
    const p = b.parent >= 0 ? m.bones[b.parent].pos : [0, 0, 0];
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(p[k] + b.rel[k] - b.pos[k]) < 1e-12);
    assert.equal(b.name, BONES[i]);
  });
});
