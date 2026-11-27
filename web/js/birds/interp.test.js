import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapAngle, angleDiff, lerpAngle, TickClock, createTrack, pushSample, createSample, sampleTrack,
  SnapshotBook, MAX_EXTRAP, TRACK_LEN, isJump,
} from './interp.js';
import { ACT, FLAG } from './constants.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('wrapAngle wraps into (-π, π]', () => {
  near(wrapAngle(0), 0);
  near(wrapAngle(Math.PI), Math.PI);
  near(wrapAngle(-Math.PI), Math.PI);
  near(wrapAngle(3 * Math.PI), Math.PI);
  near(wrapAngle(2 * Math.PI + 0.5), 0.5);
  near(wrapAngle(-2 * Math.PI - 0.5), -0.5);
});

test('yaw interpolation takes the shortest arc across ±π', () => {
  near(angleDiff(3.0, -3.0), 2 * Math.PI - 6.0);
  const mid = lerpAngle(3.0, -3.0, 0.5);
  near(Math.abs(mid), Math.PI, 1e-9);
  near(lerpAngle(0.1, -0.1, 0.5), 0);
  near(lerpAngle(-3.1, 3.1, 0.25), wrapAngle(-3.1 - (2 * Math.PI - 6.2) * 0.25));
});

test('TickClock maps ticks onto a steady local timeline despite jitter', () => {
  const c = new TickClock();
  const t0 = c.stamp(100, 50.0);
  near(t0, 50.0);
  // A late packet does not drag the timeline much…
  const t1 = c.stamp(101, 50.18);
  near(t1 - t0, 0.1, 0.01);
  // …an early one pulls it down at once (lower envelope).
  const t2 = c.stamp(102, 50.15);
  near(t2, 50.15);
  // Restart (tick went backwards) resyncs.
  const t3 = c.stamp(5, 80);
  near(t3, 80);
  // Missing tick falls back to the arrival time.
  near(c.stamp(undefined, 12.5), 12.5);
});

test('sampleTrack interpolates position, yaw and speed between samples', () => {
  const tr = createTrack();
  pushSample(tr, 1.0, 0, 0, 0, 3.0, 1, ACT.PERCHED, 0);
  pushSample(tr, 1.5, 10, 2, -4, -3.0, 3, ACT.FLYING, FLAG.SINGING);
  const s = sampleTrack(tr, 1.25, createSample());
  assert.ok(s.valid);
  near(s.x, 5); near(s.y, 1); near(s.z, -2); near(s.speed, 2);
  near(Math.abs(s.yaw), Math.PI, 1e-6);
  assert.equal(s.act, ACT.PERCHED, 'discrete fields come from the earlier sample');
  near(s.vx, 20, 1e-6);
  assert.equal(s.extrapolated, false);
});

test('before the first sample → hold the oldest', () => {
  const tr = createTrack();
  pushSample(tr, 2, 1, 2, 3, 0, 0, 0, 0);
  pushSample(tr, 2.1, 4, 5, 6, 0, 0, 0, 0);
  const s = sampleTrack(tr, 1.5, createSample());
  assert.deepEqual([s.x, s.y, s.z], [1, 2, 3]);
});

test('late snapshots: extrapolate briefly, then hold', () => {
  const tr = createTrack();
  pushSample(tr, 1.0, 0, 0, 0, 0, 0, 0, 0);
  pushSample(tr, 1.1, 1, 0, 0, 0, 0, 0, 0);
  const s = createSample();
  sampleTrack(tr, 1.15, s);
  near(s.x, 1.5); assert.ok(s.extrapolated);
  sampleTrack(tr, 5, s);
  near(s.x, 1 + 10 * MAX_EXTRAP);
  assert.equal(s.vx, 0, 'no velocity once holding');
});

test('stale and duplicate samples are dropped/replaced; teleports reset the track', () => {
  const tr = createTrack();
  pushSample(tr, 1.0, 0, 0, 0, 0, 0, 0, 0);
  pushSample(tr, 1.1, 1, 0, 0, 0, 0, 0, 0);
  pushSample(tr, 1.05, 99, 0, 0, 0, 0, 0, 0); // stale
  assert.equal(tr.n, 2);
  pushSample(tr, 1.1, 2, 0, 0, 0, 0, 0, 0); // same instant: replaces
  assert.equal(tr.n, 2);
  near(sampleTrack(tr, 2, createSample()).x, 2 + 20 * MAX_EXTRAP, 1e-9); // velocity (2-0)/0.1
  pushSample(tr, 1.2, 500, 0, 0, 0, 0, 0, 0); // teleport: kept, marked as a jump
  assert.equal(tr.n, 3);
  assert.equal(tr.jump[(tr.head - 1 + TRACK_LEN) % TRACK_LEN], 1);
});

test('isJump: only steps no bird could fly', () => {
  assert.equal(isJump(3, 0.1), false, 'short steps never');
  assert.equal(isJump(4, 0.1), false, 'a fast flight (40 m/s) is not a jump');
  assert.equal(isJump(8, 0.1), true, '80 m/s is');
  assert.equal(isJump(20, 1), false, 'after a gap of a second, 20 m is a flight');
  assert.equal(isJump(70, 5), true, 'beyond TELEPORT_DIST always');
});

test('a jump is cross-faded in place, never glided through the gap', () => {
  const tr = createTrack();
  for (let i = 0; i <= 5; i++) pushSample(tr, 1 + i * 0.1, i * 0.5, 0, 0, 0, 5, ACT.FLYING, 0);
  pushSample(tr, 1.6, 300, 0, 0, 0, 5, ACT.FLYING, 0); // the jump arrives at t = 1.6
  pushSample(tr, 1.7, 300.5, 0, 0, 0, 5, ACT.FLYING, 0);
  const s = createSample();
  let prevX = -1, minFade = 1;
  for (let rt = 1.3; rt <= 1.72; rt += 0.005) {
    sampleTrack(tr, rt, s);
    // Never anywhere in between: either on the old path (≤ 2.5) or at the new place.
    assert.ok(s.x <= 2.5 + 1e-9 || s.x >= 300 - 1e-9, `slid to ${s.x} at ${rt}`);
    if (prevX >= 0 && Math.abs(s.x - prevX) > 10) {
      assert.ok(s.fade < 0.05, `switched place while visible (fade ${s.fade})`);
    }
    prevX = s.x; minFade = Math.min(minFade, s.fade);
  }
  assert.ok(minFade < 0.02);
  near(sampleTrack(tr, 1.3, s).fade, 1, 1e-9);
  near(sampleTrack(tr, 1.69, s).fade, sampleTrack(tr, 1.69, s).fade);
});

test('interpolation never overshoots its samples and never snaps between frames', () => {
  // An engine flight sampled at 10 Hz: smoothstep take-off, cruise, smoothstep landing.
  const tr = createTrack();
  const s = createSample();
  const pos = (t) => { const u = Math.min(Math.max(t / 3, 0), 1); return 40 * u * u * (3 - 2 * u); };
  let next = 0, prev = null, maxStep = 0;
  for (let rt = -0.2; rt <= 3.4; rt += 1 / 144) {
    while (next <= rt + 0.12) { pushSample(tr, next, pos(next), 0, 0, 0, 0, ACT.FLYING, 0); next += 0.1; }
    sampleTrack(tr, rt, s);
    assert.ok(s.x >= -1e-9 && s.x <= 40 + 1e-9, `overshoot ${s.x}`);
    if (prev !== null) { assert.ok(s.x >= prev - 1e-9, 'never moves backwards'); maxStep = Math.max(maxStep, s.x - prev); }
    prev = s.x;
  }
  // Peak speed 20 m/s at 144 fps: no frame moves much more than 20/144 m.
  assert.ok(maxStep < 0.2, `step ${maxStep}`);
});

test('lookahead reports the coming take-off or landing', () => {
  const tr = createTrack();
  pushSample(tr, 1.0, 0, 1, 0, 0, 0, ACT.PERCHED, 0);
  pushSample(tr, 1.1, 0, 1, 0, 0, 0, ACT.PERCHED, 0);
  pushSample(tr, 1.2, 0.3, 1.2, 0, 0, 3, ACT.FLEEING, 0);
  const s = sampleTrack(tr, 1.05, createSample());
  assert.equal(s.act, ACT.PERCHED);
  assert.equal(s.nextAct, ACT.FLEEING);
  near(s.nextIn, 0.15, 1e-9);
  sampleTrack(tr, 1.25, s);
  assert.equal(s.nextAct, -1);
  assert.equal(s.nextIn, Infinity);
});

test('the ring buffer keeps only the newest TRACK_LEN samples', () => {
  const tr = createTrack();
  for (let i = 0; i < TRACK_LEN + 5; i++) pushSample(tr, i * 0.1, i, 0, 0, 0, 0, 0, 0);
  assert.equal(tr.n, TRACK_LEN);
  const s = sampleTrack(tr, 0, createSample());
  assert.equal(s.x, 5, 'oldest kept sample');
});

const row = (id, sp, x, act = 0, flags = 0) => [id, sp, act, flags, x, 1, 0, 0, 0];

test('SnapshotBook adds, keeps, removes missing birds and reaps after the fade', () => {
  const added = [], removed = [];
  const book = new SnapshotBook({ onAdd: (e) => added.push(e.id), onRemove: (e) => removed.push(e.id) });
  book.ingest({ tick: 1, b: [row(1, 0, 0), row(2, 3, 5)] }, 10);
  assert.deepEqual(added, [1, 2]);
  assert.equal(book.live, 2);
  book.ingest({ tick: 2, b: [row(1, 0, 0.1)] }, 10.1);
  assert.equal(book.live, 1, 'bird 2 missing → leaving');
  assert.ok(book.map.get(2).leaving);
  book.reap(10.11, 0.25);
  assert.equal(book.map.size, 2, 'still fading');
  book.reap(10.5, 0.25);
  assert.equal(book.map.size, 1);
  assert.deepEqual(removed, [2]);
});

test('SnapshotBook revives a bird that returns while fading and replaces on species change', () => {
  const added = [];
  const book = new SnapshotBook({ onAdd: (e) => added.push(`${e.id}:${e.sp}`) });
  book.ingest({ tick: 1, b: [row(7, 1, 0)] }, 1);
  book.ingest({ tick: 2, b: [] }, 1.1);
  assert.ok(book.map.get(7).leaving);
  book.ingest({ tick: 3, b: [row(7, 1, 0)] }, 1.2);
  assert.equal(book.map.get(7).leaving, false);
  book.ingest({ tick: 4, b: [row(7, 2, 0)] }, 1.3);
  assert.deepEqual(added, ['7:1', '7:2']);
});

test('SnapshotBook ignores malformed rows and pools entries without losing data', () => {
  const book = new SnapshotBook();
  book.ingest({ tick: 1, b: [null, [1, 2, 3], [5, 0, 0, 0, NaN, 0, 0, 0, 0], row(9, 0, 0)] }, 1);
  assert.deepEqual([...book.map.keys()], [9]);
  book.map.get(9).data = { keep: true };
  book.ingest({ tick: 2, b: [] }, 1.1);
  book.reap(5);
  assert.equal(book.pool.length, 1);
  assert.deepEqual(book.pool[0].data, { keep: true }, 'renderer state survives pooling');
  book.ingest({}, 6); // empty message
  assert.equal(book.map.size, 0);
});

test('SnapshotBook respects maxBirds and clear()', () => {
  const book = new SnapshotBook({ maxBirds: 2 });
  book.ingest({ tick: 1, b: [row(1, 0, 0), row(2, 0, 0), row(3, 0, 0)] }, 1);
  assert.equal(book.map.size, 2);
  book.clear();
  assert.equal(book.map.size, 0);
});
