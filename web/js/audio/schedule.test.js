import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleCall, phraseDur, baseRange, boutRepeats, MAX_REPEATS, MAX_EVENTS, TAP_DUR } from './schedule.js';
import { mulberry32 } from './rng.js';

const note = (dur, gap, f0, f1, wave = 'whistle', amp = 0.8, rate = 0, depth = 0) =>
  ({ dur, gap, f0, f1, wave, rate, depth, amp });

const robin = {
  kind: 'song', loud: 0.45, repeat: [2, 4], gap: 1.5, pitch: 'high', pattern: 'melodic',
  notes: [note(0.12, 0.05, 4200, 5100), note(0.08, 0.03, 6200, 5600, 'trill', 0.6, 40, 0.7), note(0.2, 0.1, 3600, 3000, 'sine')],
};

test('phraseDur mirrors core.Call.PhraseDur', () => {
  assert.ok(Math.abs(phraseDur(robin) - 0.58) < 1e-9);
  assert.equal(phraseDur({ notes: [] }), 0);
  assert.equal(phraseDur(null), 0);
});

test('baseRange mirrors core.Call.AudibleRange', () => {
  assert.equal(baseRange({ loud: 0 }), 40);
  assert.equal(baseRange({ loud: 1 }), 300);
  assert.equal(baseRange({ loud: 0.5 }), 170);
});

test('exact schedule (variation 0) reproduces the data', () => {
  const { events, duration, repeats } = scheduleCall(robin, 3, 1, { variation: 0 });
  assert.equal(repeats, 3);
  assert.equal(events.length, 9);
  // Phrase 1 starts after one phrase plus the bout gap.
  const p = phraseDur(robin);
  assert.ok(Math.abs(events[3].t - (p + robin.gap)) < 1e-9);
  assert.ok(Math.abs(events[1].t - 0.17) < 1e-9);
  // Total length: reps phrases + gaps between them, minus the trailing note gap.
  const expect = 3 * p + 2 * robin.gap - 0.1;
  assert.ok(Math.abs(duration - expect) < 1e-9, `${duration} vs ${expect}`);
  for (const e of events) {
    assert.ok(e.f0 >= 60 && e.f0 <= 12000);
    assert.ok(e.amp > 0 && e.amp <= 1);
  }
  assert.equal(events[1].wave, 'trill');
  assert.equal(events[1].rate, 40);
  assert.equal(events[1].depth, 0.7);
  assert.equal(events[4].phrase, 1);
});

test('events are time ordered and never overlap within a phrase', () => {
  const { events } = scheduleCall(robin, 4, 99);
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].t >= events[i - 1].t + events[i - 1].dur - 1e-9, `event ${i} overlaps`);
  }
});

test('same seed → identical bout; different seed → different but close timing', () => {
  const a = scheduleCall(robin, 3, 1234);
  const b = scheduleCall(robin, 3, 1234);
  assert.deepEqual(a, b);
  const c = scheduleCall(robin, 3, 4321);
  assert.notDeepEqual(a.events, c.events);
  // Natural variation stays small: within ±20 % of the exact duration.
  const exact = scheduleCall(robin, 3, 1, { variation: 0 }).duration;
  for (const s of [1, 2, 3, 77, 9999]) {
    const d = scheduleCall(robin, 3, s).duration;
    assert.ok(Math.abs(d - exact) / exact < 0.2, `seed ${s}: ${d} vs ${exact}`);
  }
});

test('pitch variation is a few percent at most', () => {
  const exact = scheduleCall(robin, 1, 1, { variation: 0 }).events;
  const varied = scheduleCall(robin, 1, 5).events;
  for (let i = 0; i < exact.length; i++) {
    assert.ok(Math.abs(varied[i].f0 / exact[i].f0 - 1) < 0.06);
  }
});

test('repeats: server value wins, else the call range, capped', () => {
  assert.equal(scheduleCall(robin, 1, 1).repeats, 1);
  assert.equal(scheduleCall(robin, 500, 1).repeats, MAX_REPEATS);
  for (let s = 0; s < 30; s++) {
    const r = scheduleCall(robin, 0, s).repeats;
    assert.ok(r >= 2 && r <= 4);
  }
  assert.equal(boutRepeats({ repeat: [0, 0] }, 0, mulberry32(1)), 1);
});

test('later phrases of a long bout are a little softer (fatigue)', () => {
  const { events } = scheduleCall({ ...robin, notes: [note(0.1, 0.05, 3000, 3000)] }, 10, 3, { variation: 1 });
  const first = events[0].amp, last = events[events.length - 1].amp;
  assert.ok(last < first);
});

test('click drum notes with a rate expand into a tap train that fits the note', () => {
  const drum = { kind: 'drum', loud: 0.75, repeat: [1, 1], gap: 0, notes: [note(0.6, 0, 850, 780, 'click', 1, 20, 0)] };
  const { events, duration } = scheduleCall(drum, 1, 8, { variation: 0 });
  assert.equal(events.length, 12);
  assert.ok(events.every((e) => e.wave === 'click' && e.dur === TAP_DUR));
  assert.ok(events[events.length - 1].t + TAP_DUR <= 0.6 + 1e-9);
  assert.ok(Math.abs(duration - 0.6) < 1e-9);
  // Taps slow down and fade towards the end.
  const g0 = events[1].t - events[0].t, gN = events[11].t - events[10].t;
  assert.ok(gN > g0);
  assert.ok(events[11].amp < events[0].amp);
});

test('authored per-strike drums (click notes without rate) are kept as is', () => {
  const strikes = Array.from({ length: 14 }, (_, i) => note(0.014, i === 13 ? 0 : 0.04, 850, 780, 'click', 1 - 0.04 * i));
  const { events } = scheduleCall({ notes: strikes, repeat: [1, 1], gap: 2 }, 1, 1, { variation: 0 });
  assert.equal(events.length, 14);
});

test('malformed data degrades gracefully', () => {
  assert.deepEqual(scheduleCall({ notes: [] }, 2, 1).events, []);
  assert.equal(scheduleCall(null, 2, 1).duration, 0);
  const odd = scheduleCall({ notes: [{ dur: 0.1, f0: 0, f1: 0, wave: 'laser', amp: 0 }], repeat: [1, 1] }, 1, 1, { variation: 0 });
  assert.equal(odd.events[0].wave, 'whistle');
  assert.equal(odd.events[0].f0, 2000);
  assert.equal(odd.events[0].amp, 0.8);
  const huge = scheduleCall({ notes: Array.from({ length: 100 }, () => note(0.01, 0, 3000, 3000)), gap: 0 }, 40, 1);
  assert.ok(huge.events.length <= MAX_EVENTS);
});
