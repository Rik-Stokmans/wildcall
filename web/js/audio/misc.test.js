// Tests for the small pure helpers: rng, footsteps, composer, UI recipes, impulse
// response, movement-cue flutter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, valueNoise1D, hashSeed, intBetween, jitter } from './rng.js';
import { footstepParams, SURFACES, FOOTSTEP, MOVE_GAIN } from './footsteps.js';
import { moodFor, composePhrase, inScale, midiToHz, MODES } from './composer.js';
import { UI_SOUNDS, GEAR_SOUNDS, recipeLength } from './uisounds.js';
import { forestImpulse } from './impulse.js';
import { cueOffset, flutterParams } from './cues.js';

test('rng is deterministic and in range', () => {
  const a = mulberry32(42), b = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
  assert.equal(hashSeed('a', 1), hashSeed('a', 1));
  assert.notEqual(hashSeed('a', 1), hashSeed('a', 2));
  const r = mulberry32(3);
  for (let i = 0; i < 200; i++) {
    const n = intBetween(r, 2, 4);
    assert.ok(n >= 2 && n <= 4 && Number.isInteger(n));
    assert.ok(Math.abs(jitter(r, 0.1)) <= 0.1);
  }
});

test('value noise is smooth, bounded and seeded', () => {
  const n = valueNoise1D(5);
  let prev = n(0);
  for (let t = 0.01; t < 20; t += 0.01) {
    const v = n(t);
    assert.ok(v >= 0 && v < 1);
    assert.ok(Math.abs(v - prev) < 0.05, `jump at ${t}`);
    prev = v;
  }
  assert.equal(valueNoise1D(5)(3.3), n(3.3));
  assert.notEqual(valueNoise1D(6)(3.3), n(3.3));
});

test('footsteps: every surface has a recipe; louder when moving faster; silent when still', () => {
  const rng = mulberry32(1);
  for (const s of SURFACES) {
    assert.ok(FOOTSTEP[s], s);
    const walk = footstepParams(s, 'walk', () => 0.5);
    const run = footstepParams(s, 'run', () => 0.5);
    const crouch = footstepParams(s, 'crouch', () => 0.5);
    assert.ok(run.gain > walk.gain && walk.gain > crouch.gain, s);
    assert.ok(walk.dur > 0 && walk.dur < 0.5);
    assert.equal(footstepParams(s, 'still', rng), null);
  }
  assert.equal(footstepParams('lava', 'walk', () => 0.5).surface, 'grass');
  assert.ok(footstepParams('leaf', 'walk', rng).grains > 0);
  assert.ok(footstepParams('rock', 'walk', rng).tone > 0);
  assert.ok(footstepParams('water', 'walk', rng).splash > 0);
  assert.ok(footstepParams('mud', 'walk', rng).squelch > 0);
  assert.ok(MOVE_GAIN.sprint === 1);
});

test('composer: notes stay in the mode, phrases are sparse with long rests', () => {
  const rng = mulberry32(9);
  for (const time of [5, 8, 12, 15, 19, 23]) {
    const mood = moodFor({ time, season: 1, light: time > 6 && time < 20 ? 0.8 : 0 });
    assert.ok(MODES[mood.mode]);
    for (let i = 0; i < 40; i++) {
      const ph = composePhrase(rng, mood);
      assert.ok(ph.rest >= 18);
      assert.ok(ph.notes.length >= 2 && ph.notes.length <= 5);
      for (const n of ph.notes) {
        assert.ok(inScale(n.midi, mood), `${n.midi} not in ${mood.mode}`);
        assert.ok(n.midi > 30 && n.midi < 100);
        assert.ok(n.vel > 0 && n.vel <= 1);
      }
    }
  }
  assert.equal(moodFor({ time: 5.5 }).mode, 'lydian');
  assert.equal(moodFor({ time: 23 }).mode, 'minorPent');
  assert.ok(moodFor({ time: 12, light: 1 }).density > moodFor({ time: 23, light: 0 }).density);
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToHz(81) - 880) < 1e-9);
});

test('UI and gear recipes: every pinned name, sane levels and lengths', () => {
  for (const name of ['click', 'page', 'open', 'close', 'reward', 'discover', 'shutter', 'error', 'level', 'equip', 'coin']) {
    const r = UI_SOUNDS[name];
    assert.ok(Array.isArray(r) && r.length, name);
    for (const p of r) {
      assert.ok(p.gain > 0 && p.gain <= 0.6, `${name} gain`);
      assert.ok(p.f > 20 && p.f < 16000, `${name} freq`);
      assert.ok(p.dur > 0 && p.t >= 0);
    }
    assert.ok(recipeLength(r) < 3, name);
  }
  for (const r of Object.values(GEAR_SOUNDS)) assert.ok(recipeLength(r) < 1);
});

test('forest impulse: stereo, decaying, normalised, deterministic', () => {
  const [l, r] = forestImpulse(8000, { seconds: 2 });
  assert.equal(l.length, 16000);
  assert.equal(r.length, 16000);
  const energy = (a, from, to) => { let e = 0; for (let i = from; i < to; i++) e += a[i] * a[i]; return e; };
  assert.ok(energy(l, 0, 4000) > 10 * energy(l, 12000, 16000));
  assert.equal(l[0], 0); // pre-delay
  const total = energy(l, 0, l.length) + energy(r, 0, r.length);
  assert.ok(Math.abs(total / 2 - 1) < 1e-6);
  assert.deepEqual(forestImpulse(8000, { seconds: 0.5 })[0], forestImpulse(8000, { seconds: 0.5 })[0]);
  assert.notDeepEqual(l, r);
});

test('movement cue flutter: placed along the bearing, closer and louder when strong', () => {
  const east = cueOffset({ bearing: Math.PI / 2, elev: 0, strength: 1 });
  assert.ok(east.dx > 3.9 && Math.abs(east.dz) < 1e-9);
  const north = cueOffset({ bearing: 0, elev: 0, strength: 0 });
  assert.ok(north.dz < -20);
  const up = cueOffset({ bearing: 0, elev: 0.6, strength: 0.5 });
  assert.ok(up.dy > 0);
  assert.ok(cueOffset({ strength: 1 }).dist < cueOffset({ strength: 0.2 }).dist);
  const rng = mulberry32(4);
  const f = flutterParams({ strength: 1 }, rng);
  assert.ok(f.beats.length >= 5 && f.beats.length <= 10);
  for (let i = 1; i < f.beats.length; i++) assert.ok(f.beats[i].t > f.beats[i - 1].t);
  assert.ok(f.gain > flutterParams({ strength: 0 }, rng).gain);
});
