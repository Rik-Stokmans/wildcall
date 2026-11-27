// mowField is built from every POI the client has ever been sent (state.pois is never
// pruned: the map shows them). Its per-sample cost must not grow with that number.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mowField } from './groundField.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function brute(pois) {
  const spots = pois.filter((p) => ['cabin', 'camp', 'hide', 'watchtower'].includes(p.kind))
    .map((p) => [p.pos.x, p.pos.z, Math.max(14, Math.min(30, (p.radius || 0) * 1.5))]);
  return (x, z) => spots.reduce((m, [sx, sz, inner]) => Math.max(m, 1 - smooth(inner, inner + 12, Math.hypot(x - sx, z - sz))), 0);
}

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

test('mowField: bucketed lookup equals the brute-force maximum over every building', () => {
  const r = rng(7);
  const kinds = ['cabin', 'camp', 'hide', 'watchtower', 'pond', 'viewpoint'];
  const pois = Array.from({ length: 600 }, (_, i) => ({
    id: 'p' + i, kind: kinds[i % kinds.length], radius: r() * 25, pos: { x: (r() - 0.5) * 8000, z: (r() - 0.5) * 8000 },
  }));
  const fast = mowField(pois), slow = brute(pois);
  for (let i = 0; i < 4000; i++) {
    // Half the samples right next to a POI, half anywhere.
    const p = pois[i % pois.length];
    const x = i % 2 ? p.pos.x + (r() - 0.5) * 90 : (r() - 0.5) * 8000;
    const z = i % 2 ? p.pos.z + (r() - 0.5) * 90 : (r() - 0.5) * 8000;
    assert.ok(Math.abs(fast(x, z) - slow(x, z)) < 1e-9, `at ${x},${z}`);
  }
  assert.equal(fast(-3.5, 0) >= 0, true);
});

test('mowField: a sample only tests the buildings near it, however many there are', () => {
  // 2000 camps on a 200 m grid: each lookup may only see the few whose reach covers its cell.
  const pois = [];
  for (let i = 0; i < 2000; i++) pois.push({ id: 'c' + i, kind: 'camp', pos: { x: (i % 50) * 200, z: Math.floor(i / 50) * 200 } });
  const f = mowField(pois);
  assert.equal(f.spots, 2000);
  let calls = 0;
  const hypot = Math.hypot;
  Math.hypot = (...a) => { calls++; return hypot(...a); };
  try { for (let i = 0; i < 1000; i++) f(i * 7.3, i * 3.1); } finally { Math.hypot = hypot; }
  assert.ok(calls <= 1000 * 4, `hypot calls ${calls}`);
});

test('mowField: no buildings → null; negative coordinates bucket correctly', () => {
  assert.equal(mowField([{ kind: 'pond', pos: { x: 0, z: 0 } }]), null);
  const f = mowField([{ kind: 'cabin', pos: { x: -100, z: -100 }, radius: 10 }]);
  assert.equal(f(-100, -100), 1);
  assert.equal(f(-60, -100), 0);
  assert.ok(f(-80, -100) > 0 && f(-80, -100) < 1);
});
