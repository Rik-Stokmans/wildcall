import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudLayout, clusterCover, coverFraction, rng } from './cloudmath.js';

test('cloud layout is deterministic and shaped like cumulus', () => {
  const a = cloudLayout(20, 3000, 7);
  const b = cloudLayout(20, 3000, 7);
  assert.deepEqual(a, b);
  for (const c of a) {
    assert.ok(c.puffs.length >= 11 && c.puffs.length <= 18);
    assert.ok(c.x >= 0 && c.x < 3000 && c.z >= 0 && c.z < 3000);
    for (const p of c.puffs) {
      assert.ok(p.y >= 0, 'puffs sit on or above the flat base');
      assert.ok(p.s > 0 && p.s < c.width * 0.4);
    }
    // Upper puffs are smaller than the base row on average.
    const base = c.puffs.filter((p) => p.y < c.height * 0.2);
    const top = c.puffs.filter((p) => p.y > c.height * 0.4);
    if (base.length && top.length) {
      const avg = (xs) => xs.reduce((s, p) => s + p.s, 0) / xs.length;
      assert.ok(avg(top) < avg(base));
    }
  }
  // Thresholds spread over 0..1.
  const th = a.map((c) => c.threshold);
  assert.ok(Math.min(...th) < 0.1 && Math.max(...th) > 0.85);
});

test('cover grows with env.cloud and rain, clear skies keep a few clouds', () => {
  const l = cloudLayout(40, 3000, 3);
  const clear = coverFraction(l, 0);
  const half = coverFraction(l, 0.5);
  const full = coverFraction(l, 1);
  assert.ok(clear > 0 && clear < 0.25, `clear ${clear}`);
  assert.ok(half > clear && full > half);
  assert.equal(full, 1);
  assert.ok(coverFraction(l, 0.3, 1) > coverFraction(l, 0.3, 0), 'rain gathers clouds');
  assert.equal(clusterCover(0.99, 0), 0);
  assert.ok(clusterCover(0.01, 1) === 1);
});

test('rng is in [0,1)', () => {
  const r = rng(42);
  for (let i = 0; i < 1000; i++) { const v = r(); assert.ok(v >= 0 && v < 1); }
});
