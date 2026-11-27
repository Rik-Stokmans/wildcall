import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ringRadius, callStrength, planBout, boutDur, eligible, thereThreshold, lifeAlpha,
  RingPool, BoutTable, RANGE, CLUE_RANGE, MAX_EMITS, MAX_FRAC, STAGGER,
} from './logic.js';

const viewH = (d, fov) => 2 * d * Math.tan((fov * Math.PI) / 360);
const frac = (d, fov, naked, s = 1) => ringRadius(d, fov, naked, s) / viewH(d, fov);

test('ring size is apparent: a little smaller at 5 m, constant on screen from 25 m on', () => {
  const f5 = frac(5, 70, 70), f15 = frac(15, 70, 70), f30 = frac(30, 70, 70), f60 = frac(60, 70, 70);
  assert.ok(f5 < f15 && f15 < f30, 'grows a little with distance');
  assert.ok(Math.abs(f30 - f60) < 1e-9, 'constant on screen far away');
  assert.ok(f5 >= 0.5 * f30, 'never tiny up close');
  // world size at 5 m stays small (well under half a metre)
  assert.ok(ringRadius(5, 70, 70) < 0.3);
  // at 30 m it covers a few percent of the view height: noticeable
  assert.ok(f30 > 0.025 && f30 < 0.06);
});

test('through binoculars the ring grows with zoom but never fills the view', () => {
  const naked = frac(30, 70, 70), x4 = frac(30, 70 / 4, 70), x12 = frac(30, 70 / 12, 70);
  assert.ok(x4 > naked * 1.5 && x4 < naked * 4, 'grows, but less than the zoom');
  assert.ok(x12 <= MAX_FRAC + 1e-9, 'capped');
});

test('a loud song is a little stronger and bigger than a soft call', () => {
  const song = callStrength({ kind: 'song', loud: 0.8 });
  const soft = callStrength({ kind: 'call', loud: 0.1 });
  assert.ok(song > soft);
  assert.ok(soft >= 0.6 && song <= 1);
  assert.ok(ringRadius(20, 70, 70, song) > ringRadius(20, 70, 70, soft));
  assert.equal(callStrength(undefined), 0.6);
});

test('bout plan: a burst per phrase, pulses inside long phrases, capped', () => {
  const out = new Float32Array(MAX_EMITS);
  const call = { notes: [{ dur: 0.3, gap: 0.1 }, { dur: 0.4, gap: 0.2 }], gap: 1.0 };
  const n = planBout(call, 2, 3, out);
  assert.equal(n, 6);
  assert.deepEqual(Array.from(out.slice(0, 3)).map((v) => +v.toFixed(2)), [0, +STAGGER.toFixed(2), +(2 * STAGGER).toFixed(2)]);
  assert.ok(Math.abs(out[3] - 2.0) < 1e-6, 'second phrase starts after phrase + gap');
  for (let i = 1; i < n; i++) assert.ok(out[i] >= out[i - 1]);
  const long = { notes: [{ dur: 3, gap: 0 }], gap: 0 };
  assert.ok(planBout(long, 1, 2, out) > 2, 'long phrases keep pulsing');
  assert.ok(planBout(long, 50, 3, out) <= MAX_EMITS);
  assert.ok(boutDur(long, 50) <= 9);
  assert.equal(planBout(undefined, 1, 2, out), 2, 'unknown call still ripples once');
});

test('eligibility: only while playing, enabled, and within range (farther with a clue)', () => {
  const base = { enabled: true, mode: 'play', dist: 20, hasClue: false };
  assert.equal(eligible(base), true);
  assert.equal(eligible({ ...base, enabled: false }), false);
  assert.equal(eligible({ ...base, mode: 'ui' }), false);
  assert.equal(eligible({ ...base, mode: 'mainmenu' }), false);
  assert.equal(eligible({ ...base, dist: RANGE + 1 }), false);
  assert.equal(eligible({ ...base, dist: RANGE + 1, hasClue: true }), true);
  assert.equal(eligible({ ...base, dist: CLUE_RANGE + 1, hasClue: true }), false);
  assert.equal(eligible({ ...base, dist: NaN }), false);
});

test('"there!" threshold is a few degrees, tighter through binoculars', () => {
  const naked = thereThreshold(70), bino = thereThreshold(70 / 8);
  assert.ok(naked > 0.05 && naked < 0.1);
  assert.ok(bino < naked);
});

test('ring alpha fades in fast and out softly', () => {
  assert.equal(lifeAlpha(0), 0);
  assert.equal(lifeAlpha(1), 0);
  assert.ok(lifeAlpha(0.1) > lifeAlpha(0.6));
  assert.ok(lifeAlpha(0.6) > lifeAlpha(0.95));
});

test('ring pool reuses its slots and never grows', () => {
  const p = new RingPool(4);
  const arr = p.age;
  for (let i = 0; i < 4; i++) p.spawn(i, 0, 0, 0, 1, 0, 1);
  assert.equal(p.n, 4);
  p.step(0.5);
  const slot = p.spawn(9, 1, 2, 3, 1, 0, 1); // full: recycles the oldest
  assert.equal(p.n, 4);
  assert.equal(p.bird[slot], 9);
  p.step(0.6); // the first four expire
  assert.equal(p.n, 1);
  assert.equal(p.bird[0], 9);
  assert.equal(p.age, arr, 'same backing arrays');
  p.step(1);
  assert.equal(p.n, 0);
});

test('bout table: one bout per bird, restart replaces, swap-remove keeps times', () => {
  const t = new BoutTable(2);
  const call = { kind: 'song', loud: 1, notes: [{ dur: 0.5, gap: 0 }], gap: 0.5 };
  const a = t.start(1, call, 2);
  assert.equal(t.start(1, call, 1), a, 'same bird reuses its slot');
  t.start(2, call, 3);
  assert.equal(t.n, 2);
  t.t[0] = 50; // bird 1's bout is long done
  const c = t.start(3, call, 1);
  assert.equal(t.n, 2);
  assert.equal(t.bird[c], 3, 'replaced the finished bout');
  const times2 = t.times[t.indexOf(2)];
  t.remove(c === 0 ? 0 : 1);
  assert.equal(t.n, 1);
  assert.equal(t.bird[0], 2);
  assert.equal(t.times[0], times2, 'times moved with the bout');
  assert.equal(t.count[0], planBout(call, 3, 3, new Float32Array(MAX_EMITS)));
});
