import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wingKind, wingRecipe } from './wingmodel.js';
import { mulberry32 } from './rng.js';

const sp = (length, flapHz, flight = 'direct', ground = 'hop', shape = 'songbird') => ({
  look: { length }, move: { flapHz, flight, ground }, traits: { shape },
});

test('wingKind gives each kind of bird its own take-off sound', () => {
  assert.equal(wingKind(sp(0.095, 21, 'whirring')), 'whirr', 'wren');
  assert.equal(wingKind(sp(0.14, 14, 'darting')), 'flutter', 'robin');
  assert.equal(wingKind(sp(0.34, 4.5, 'buoyant', 'hop', 'corvid')), 'clatter', 'jay');
  assert.equal(wingKind(sp(0.58, 6, 'direct', 'swim', 'duck')), 'duck', 'mallard');
  assert.equal(wingKind(sp(0.54, 2.8, 'soaring', 'walk', 'raptor')), 'big', 'buzzard');
  assert.equal(wingKind(sp(0.95, 2.2, 'direct', 'wade', 'heron')), 'big', 'heron');
  assert.equal(wingKind(undefined), 'flutter');
});

test('recipes are short, start hard and fade; landings are softer', () => {
  for (const kind of ['flutter', 'whirr', 'clatter', 'duck', 'big']) {
    const r = wingRecipe(kind, { flush: true, size: 0.2 }, mulberry32(4));
    assert.ok(r.beats.length >= 2, kind);
    assert.ok(r.length < (kind === 'big' ? 2.5 : 1.6), `${kind} too long: ${r.length}`); // a heron's few heavy beats take longer
    for (let i = 1; i < r.beats.length; i++) assert.ok(r.beats[i].t > r.beats[i - 1].t, 'beats in order');
    const first = r.beats[0].gain, last = r.beats[r.beats.length - 1].gain;
    assert.ok(first > last, `${kind} fades`);
    const land = wingRecipe(kind, { landing: true, size: 0.2 }, mulberry32(4));
    assert.ok(land.beats.length < r.beats.length, `${kind} landing is shorter`);
    assert.ok(land.gain < r.gain, `${kind} landing is quieter`);
  }
});

test('beat rates follow the character: whirr fastest, big slowest', () => {
  const rate = (k) => { const r = wingRecipe(k, {}, mulberry32(1)); return (r.beats.length - 1) / r.beats[r.beats.length - 1].t; };
  assert.ok(rate('whirr') > rate('flutter'));
  assert.ok(rate('flutter') > rate('clatter'));
  assert.ok(rate('clatter') > rate('big'));
  assert.ok(rate('big') < 3.5);
});

test('ducks whistle and splash on water; bigger birds sound lower', () => {
  const d = wingRecipe('duck', { water: true, flush: true, size: 0.58 }, mulberry32(2));
  assert.ok(d.whistle && d.splash);
  assert.ok(!wingRecipe('flutter', {}, mulberry32(2)).splash);
  const small = wingRecipe('flutter', { size: 0.1 }, mulberry32(3)).beats[0].freq;
  const large = wingRecipe('flutter', { size: 0.3 }, mulberry32(3)).beats[0].freq;
  assert.ok(small > large);
});
