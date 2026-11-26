import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audibleRange, pannerParams, inverseGain, edgeFade, callGain, EDGE_GAIN, sourceLevel,
  occlusionGain, airCutoff, occlusionCutoff, voiceCutoff, canopyOcclusion, blendOcclusion,
  voicePriority, pickVoiceSlot, reverbSend, reverbReturn, focusDuckDb, levelFromRms,
  musicCallDuck, dbToGain, gainToDb, MAX_VOICES,
} from './curves.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('audible range: 40 + 260·loud × hearRange × (1 + focusBonus) while focusing', () => {
  assert.equal(audibleRange(0, {}), 40);
  assert.equal(audibleRange(1, { hearRange: 1 }), 300);
  assert.equal(audibleRange(0.5, { hearRange: 1.2 }), 204);
  assert.ok(near(audibleRange(0.5, { hearRange: 1, focusBonus: 0.5 }, 1), 255));
  assert.ok(near(audibleRange(0.5, { hearRange: 1, focusBonus: 0.5 }, 0.5), 212.5));
  // Missing focusBonus falls back to the base 0.35; hearRange 0/missing means 1.
  assert.ok(near(audibleRange(0, {}, 1), 54));
  assert.equal(audibleRange(0, { hearRange: 0 }), 40);
});

test('panner rolloff reaches EDGE_GAIN exactly at the range', () => {
  for (const r of [40, 100, 170, 300, 600]) {
    const p = pannerParams(r);
    assert.equal(p.distanceModel, 'inverse');
    assert.ok(near(inverseGain(r, p), EDGE_GAIN, 1e-9));
    assert.equal(inverseGain(0, p), 1);
    assert.equal(inverseGain(p.refDistance, p), 1);
  }
});

test('call gain falls monotonically to silence at the range and stays silent beyond', () => {
  const r = 170;
  let prev = Infinity;
  for (let d = 0; d <= r * 1.5; d += 2.5) {
    const g = callGain(d, r);
    assert.ok(g <= prev + 1e-12, `not monotone at ${d}`);
    assert.ok(g >= 0 && g <= 1);
    prev = g;
  }
  assert.equal(callGain(r, r), 0);
  assert.equal(callGain(r * 1.2, r), 0);
  // Before the fade region the curve is the pure inverse law.
  assert.ok(near(callGain(0.5 * r, r), inverseGain(0.5 * r, pannerParams(r))));
  assert.equal(edgeFade(0.79 * r, r), 1);
  // The curve has the same shape for every range (scale invariant): a quiet call heard
  // at half its range is as loud as a loud call at half its range.
  assert.ok(near(callGain(20, 40), callGain(150, 300)));
  // About −20 dB a third of the way out: clearly fading, still audible.
  const db = gainToDb(callGain(r / 3, r));
  assert.ok(db < -12 && db > -26, `${db}`);
});

test('focus widens the audible range so a distant call becomes audible', () => {
  const stats = { hearRange: 1, focusBonus: 0.35 };
  const d = 180;
  assert.equal(callGain(d, audibleRange(0.5, stats, 0)), 0);
  assert.ok(callGain(d, audibleRange(0.5, stats, 1)) > 0);
});

test('source level and occlusion gain', () => {
  assert.equal(sourceLevel(0), 0.55);
  assert.equal(sourceLevel(1), 1);
  assert.equal(occlusionGain(0), 1);
  assert.ok(near(occlusionGain(1), 0.55));
  assert.ok(occlusionGain(0.5) > occlusionGain(0.9));
});

test('low-pass: air absorption and occlusion darken the sound', () => {
  assert.equal(airCutoff(0), 20000);
  assert.ok(airCutoff(100) < airCutoff(50));
  assert.ok(airCutoff(10000) >= 1800);
  assert.equal(occlusionCutoff(0), 20000);
  assert.ok(occlusionCutoff(0.5) < 5000 && occlusionCutoff(0.5) > 3000);
  assert.ok(occlusionCutoff(1) < 1100);
  // Combined: never brighter than either cause, monotone in both, floor 500 Hz.
  for (const d of [0, 20, 80, 200]) {
    for (const o of [0, 0.3, 0.7, 0.95]) {
      const c = voiceCutoff(d, o);
      assert.ok(c <= airCutoff(d) + 1e-6 && c <= occlusionCutoff(o) + 1e-6 || c === 500);
      assert.ok(voiceCutoff(d + 30, o) <= c + 1e-6);
      assert.ok(voiceCutoff(d, Math.min(1, o + 0.1)) <= c + 1e-6);
      assert.ok(c >= 500);
    }
  }
  // Open air close by stays bright.
  assert.ok(voiceCutoff(5, 0) > 15000);
});

test('occlusion estimate and blending', () => {
  assert.equal(canopyOcclusion(0, 0, 50), 0);
  assert.ok(canopyOcclusion(1, 1, 50) <= 0.9);
  assert.ok(canopyOcclusion(1, 0, 5) < canopyOcclusion(1, 0, 50));
  // A bird that has not moved keeps the server's occlusion.
  assert.equal(blendOcclusion(0.6, 0.1, 0), 0.6);
  // After moving far, the estimate takes over.
  assert.ok(Math.abs(blendOcclusion(0.6, 0.1, 60) - 0.1) < 0.01);
});

test('voice priority: nearer, louder and less occluded wins', () => {
  const r = audibleRange(0.5, {});
  assert.ok(voicePriority(0.5, 10, r, 0) > voicePriority(0.5, 60, r, 0));
  assert.ok(voicePriority(0.5, 30, r, 0) > voicePriority(0.5, 30, r, 0.8));
  assert.ok(voicePriority(1, 60, audibleRange(1, {}), 0) > voicePriority(0.1, 60, audibleRange(0.1, {}), 0));
  assert.equal(voicePriority(0.5, r + 1, r, 0), 0);
});

test('voice stealing: free slots first, then evict the quietest only for a louder call', () => {
  const mk = (ps) => ps.map((priority) => ({ priority, stopping: false }));
  assert.deepEqual(pickVoiceSlot(mk([0.1, 0.2]), 0.05, 3), { accept: true, victim: -1 });
  assert.deepEqual(pickVoiceSlot(mk([0.3, 0.1, 0.2]), 0.15, 3), { accept: true, victim: 1 });
  assert.deepEqual(pickVoiceSlot(mk([0.3, 0.1, 0.2]), 0.05, 3), { accept: false, victim: -1 });
  // Voices already fading out do not count and are never chosen.
  const v = mk([0.3, 0.01, 0.2]);
  v[1].stopping = true;
  assert.deepEqual(pickVoiceSlot(v, 0.05, 3), { accept: true, victim: -1 });
  v.push({ priority: 0.25, stopping: false });
  assert.deepEqual(pickVoiceSlot(v, 0.22, 3), { accept: true, victim: 2 });
  // Inaudible newcomers are never started.
  assert.equal(pickVoiceSlot([], 0, 3).accept, false);
  assert.equal(MAX_VOICES, 24);
});

test('reverb: distant calls wetter, forests ring more than meadows', () => {
  assert.ok(reverbSend(100, 170) > reverbSend(10, 170));
  assert.ok(reverbSend(1000, 170) <= 0.4 + 1e-9);
  assert.ok(reverbReturn(0.9, 0) > reverbReturn(0.1, 0));
  assert.ok(reverbReturn(0.2, 2) > reverbReturn(0.2, 0));
  assert.ok(reverbReturn(0.2, 3) < reverbReturn(0.2, 0));
  assert.ok(reverbReturn(1, 2) <= 1);
});

test('focus duck ~12 dB, deeper with noise reduction', () => {
  assert.equal(focusDuckDb(0), -12);
  assert.equal(focusDuckDb(1), -20);
  assert.equal(focusDuckDb(5), -20);
  assert.ok(near(dbToGain(-12), 0.2512, 1e-4));
});

test('level meter and music duck', () => {
  assert.equal(levelFromRms(0), 0);
  assert.equal(levelFromRms(1), 1);
  assert.ok(near(levelFromRms(0.001), 0));
  assert.ok(near(levelFromRms(Math.pow(10, -30 / 20)), 0.5));
  assert.equal(musicCallDuck(0.1), 1);
  assert.equal(musicCallDuck(0.8), 0);
  assert.ok(musicCallDuck(0.4) > 0 && musicCallDuck(0.4) < 1);
});
