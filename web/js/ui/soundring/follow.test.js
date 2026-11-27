import test from 'node:test';
import assert from 'node:assert/strict';
import { Follower, Pace, CalmCount, otherVoicesText, silentText } from './follow.js';

const v = (id, score, extra = {}) => ({ id, score, quarry: false, heardAt: 0, expires: 10, live: true, ...extra });

test('follows the loudest when nothing else applies, and keeps it against near equals', () => {
  const f = new Follower();
  const c = [v(1, 0.5), v(2, 0.6)];
  assert.equal(f.update(0, c, 2), 2);
  c[0].score = 0.7; // a bit louder now: not enough to switch
  assert.equal(f.update(5, c, 2), 2);
  c[0].score = 1.5; // clearly louder: switch (dwell passed)
  assert.equal(f.update(6, c, 2), 1);
});

test('never changes more than once per dwell', () => {
  const f = new Follower();
  const c = [v(1, 0.3), v(2, 0.2)];
  assert.equal(f.update(0, c, 2), 1);
  c[1].score = 2;
  assert.equal(f.update(0.5, c, 2), 1);
  assert.equal(f.update(3.9, c, 2), 1);
  assert.equal(f.update(4.1, c, 2), 2);
  c[0].score = 9;
  assert.equal(f.update(8, c, 2), 2);
  assert.equal(f.update(8.2, c, 2), 1);
});

test('a voice that pipes up in front of a player standing still is not followed', () => {
  const f = new Follower();
  const c = [v(1, 0.9), v(2, 0.2)];
  assert.equal(f.update(0, c, 2, 0, false), 1);
  for (let t = 5; t < 9; t += 0.25) assert.equal(f.update(t, c, 2, 2, false), 1); // faced, never turned
  assert.equal(f.update(9, c, 2, 2, true), 2);    // now the player turns a little toward it: followed
  assert.equal(f.update(12, c, 2, 0, false), 2);
});

test('a count that rises at once and falls slowly', () => {
  const k = new CalmCount(6);
  assert.equal(k.update(2, 0), 2);
  assert.equal(k.update(1, 1), 2);
  assert.equal(k.update(2, 3), 2);
  assert.equal(k.update(1, 4), 2); // the wait starts again
  assert.equal(k.update(1, 9.9), 2);
  assert.equal(k.update(1, 10), 1);
  assert.equal(k.update(4, 10.1), 4);
  assert.equal(k.update(0, 17), 4);
  assert.equal(k.update(0, 23.1), 0);
});

test('the quest target wins when audible', () => {
  const f = new Follower();
  const c = [v(1, 0.9), v(2, 0.1, { quarry: true })];
  assert.equal(f.update(0, c, 2), 2);
  assert.equal(f.update(5, c, 2, 1), 2); // facing another voice does not steal it
});

test('facing a voice for a second follows it; a glance does not', () => {
  const f = new Follower();
  const c = [v(1, 0.9), v(2, 0.2)];
  assert.equal(f.update(0, c, 2), 1);
  assert.equal(f.update(3, c, 2, 2), 1);   // just turned toward 2
  assert.equal(f.update(3.5, c, 2, 2), 1);
  assert.equal(f.update(3.6, c, 2, 0), 1); // looked away: timer resets
  assert.equal(f.update(4, c, 2, 2), 1);
  assert.equal(f.update(5.1, c, 2, 2), 2); // a full second
  assert.equal(f.update(6, c, 2, 0), 2);   // stays after looking away (hysteresis)
});

test('a voice is kept through the pause in its song, then the next one', () => {
  const f = new Follower();
  const c = [v(1, 0.9, { expires: 5 }), v(2, 0.3, { expires: 60 })];
  assert.equal(f.update(0, c, 2), 1);
  assert.equal(f.update(6, c, 2), 1);    // its clue ran out 1 s ago: still followed
  assert.equal(f.update(20, c, 2), 1);   // 20 s since it was heard: a normal pause
  assert.equal(f.update(26.5, c, 2), 2); // not heard for 26 s: move on
  // ... and when it calls again in time there is no change at all
  const h = new Follower();
  const d = [v(1, 0.4, { expires: 5 }), v(2, 0.6, { expires: 90 })];
  assert.equal(h.togglePin(0, d, 2, 1), true); h.togglePin(0, d, 2, 1); // follow 1, not pinned
  assert.equal(h.update(20, d, 2), 1);
  d[0].expires = 30; d[0].heardAt = 21; // called again
  assert.equal(h.update(45, d, 2), 1);
  assert.equal(h.update(48, d, 2), 2);
  const g = new Follower();
  assert.equal(g.update(0, [v(1, 0.5, { expires: 1 })], 1), 1);
  assert.equal(g.update(5, [], 0), 0);
  // with no memory (keep 0) only the grace after the clue counts
  const k = new Follower({ keep: 0 });
  assert.equal(k.update(0, c, 2), 1);
  assert.equal(k.update(7.9, c, 2), 1);
  assert.equal(k.update(8.5, c, 2), 2);
});

test('pinning keeps one voice through ten louder ones and its silences', () => {
  const f = new Follower();
  const c = [v(1, 0.2, { expires: 4, heardAt: 0 })];
  for (let i = 2; i <= 11; i++) c.push(v(i, 0.9, { expires: 100 }));
  f.update(0, c, c.length, 0);
  assert.equal(f.togglePin(0.2, c, c.length, 1), true);
  assert.equal(f.id, 1);
  assert.equal(f.update(20, c, c.length, 3), 1);  // silent for 20 s, facing another
  assert.equal(f.update(44, c, c.length), 1);
  assert.equal(f.pinned, true);
  assert.notEqual(f.update(46, c, c.length), 1); // not heard for 45 s: let go, the loudest takes over
  assert.equal(f.pinned, false);
});

test('a pinned voice that calls again stays pinned past 45 s', () => {
  const f = new Follower();
  const c = [v(1, 0.2, { expires: 4, heardAt: 0 }), v(2, 0.9, { expires: 500 })];
  f.togglePin(0, c, 2, 1);
  assert.equal(f.update(40, c, 2), 1);
  c[0].heardAt = 41; c[0].expires = 57; // it called again
  assert.equal(f.update(80, c, 2), 1);
  assert.equal(f.pinned, true);
  assert.equal(f.update(87, c, 2), 2);
});

test('Q while pinned and facing another voice moves the pin', () => {
  const f = new Follower();
  const c = [v(1, 0.5), v(2, 0.3), v(3, 0.2)];
  assert.equal(f.togglePin(0, c, 3, 2), true);
  assert.equal(f.id, 2);
  assert.equal(f.togglePin(1, c, 3, 3), true); // facing 3: the pin moves
  assert.equal(f.id, 3);
  assert.equal(f.togglePin(2, c, 3, 3), false); // facing the pinned one: let go
  assert.equal(f.pinned, false);
});

test('ten voices calling over each other: the followed one barely changes', () => {
  // Ten voices, each calling every 4-9 s with a 6 s clue and a loudness that wobbles.
  const f = new Follower();
  const c = [];
  for (let i = 1; i <= 10; i++) c.push(v(i, 0.3 + 0.05 * i, { expires: 0, heardAt: -99 }));
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const next = c.map(() => rnd() * 5);
  let changes = 0, last = 0;
  for (let t = 0; t < 120; t += 0.1) {
    c.forEach((x, i) => {
      if (t >= next[i]) { x.heardAt = t; x.expires = t + 6; x.score = 0.3 + 0.05 * (i + 1) + (rnd() - 0.5) * 0.3; next[i] = t + 4 + rnd() * 5; }
    });
    const id = f.update(t, c, c.length);
    if (id !== last) { changes++; last = id; }
  }
  assert.ok(changes <= 3, `followed voice changed ${changes} times in two minutes`);
});

test('pace: one flourish per gap', () => {
  const p = new Pace(20);
  assert.equal(p.allow(0), true);
  assert.equal(p.allow(5), false);
  assert.equal(p.ready(19.9), false);
  assert.equal(p.allow(20), true);
  assert.equal(p.allow(39), false);
});

test('Q again lets go; Q with nothing faced pins the followed voice; nothing to pin', () => {
  const f = new Follower();
  const c = [v(1, 0.5), v(2, 0.3)];
  f.update(0, c, 2);
  assert.equal(f.togglePin(1, c, 2, 0), true);
  assert.equal(f.id, 1);
  assert.equal(f.togglePin(2, c, 2, 0), false);
  assert.equal(f.pinned, false);
  assert.equal(f.id, 1); // keeps following, just not pinned
  assert.equal(new Follower().togglePin(0, [], 0, 0), false);
  // a pinned voice that vanishes from the list entirely is let go
  const g = new Follower();
  g.togglePin(0, c, 2, 2);
  assert.equal(g.update(1, [c[0]], 1), 1);
  assert.equal(g.pinned, false);
});

test('quiet line words', () => {
  assert.equal(otherVoicesText(0), '');
  assert.equal(otherVoicesText(1), '1 other voice');
  assert.equal(otherVoicesText(3, true), 'A new voice · 3 other voices');
  assert.equal(otherVoicesText(0, true), 'A new voice');
  assert.equal(silentText(3), '');
  assert.equal(silentText(12.4), 'silent for 12 s');
  assert.equal(silentText(33), 'silent for 35 s');
});
