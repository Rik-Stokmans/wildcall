// Smoke tests of the wildlife synthesis against the strict fake Web Audio API: every
// kind builds a valid graph (no non-finite values, no exponential ramps to zero, no
// double starts), stays on the ambience bus, is capped and is released afterwards.
// How it sounds can only be judged by ear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext, stats } from './fakeaudio.js';
import { AudioEngine } from './engine.js';
import { Wildlife } from './wildlife.js';
import { KINDS, KIND, MAX_ACTIVE, HAB } from './wildmodel.js';

function setup(seed = 3) {
  const eng = new AudioEngine(FakeAudioContext);
  eng.ac.state = 'running';
  return { eng, w: new Wildlife(eng, seed) };
}

const L = { x: 0, y: 4.6, z: 0 };
const world = {
  habitatAt: (x, z) => (z < -20 ? HAB.marsh : x > 30 ? HAB.meadow : HAB.woodland),
  waterDepthAt: (x, z) => (z < -20 ? 0.4 : 0),
  canopyAt: () => 0.7,
  heightAt: (x, z) => (z < -20 ? -0.4 : 3),
};
const inputs = (o = {}) => ({
  env: { time: 12, season: 1, weather: 0, wind: 0.2, rain: 0, mist: 0, cloud: 0.1, light: 1, ...(o.env || {}) },
  region: 0, habitat: HAB.woodland, canopy: 0.7, waterDist: 25, seaDist: Infinity, creekDist: Infinity,
  listener: L, world, ...o, ...(o.env ? { env: { time: 12, season: 1, wind: 0.2, rain: 0, mist: 0, cloud: 0.1, light: 1, ...o.env } } : {}),
});

function run(w, seconds, dt = 0.1) {
  const ac = w.eng.ac;
  for (let t = 0; t < seconds; t += dt) { ac.advance(dt); w.update(dt); }
}

test('every kind renders a valid graph on the ambience bus and is released', () => {
  const { eng, w } = setup();
  w.setInputs(inputs());
  assert.ok(w.out.outputs.has(eng.ambIn));
  assert.equal(w.out.outputs.size, 1);
  for (const kind of KINDS) {
    for (let i = 0; i < 25; i++) {
      const spot = { x: 5 + i, y: 2, z: -8 - i, d: 10 + i, ang: 0.3 };
      assert.doesNotThrow(() => w.trigger(kind, spot), `${kind} #${i}`);
      eng.ac.advance(0.5);
      w.reap();
    }
  }
  w.trigger('frog', { x: 5, y: 2, z: -8, d: 10, ang: 0 });
  assert.ok(w.activeCount > 0);
  eng.ac.advance(30);
  w.reap();
  assert.equal(w.activeCount, 0);
  assert.equal(stats.liveSources, 0, 'every source ended');
});

test('a day in a summer meadow, a night at a pond, a windy wood and wet ground all run', () => {
  const cases = {
    meadowNoon: inputs({ habitat: HAB.meadow, canopy: 0, env: { light: 1, season: 1, cloud: 0 }, listener: { x: 40, y: 4.6, z: 0 } }),
    pondNight: inputs({ habitat: HAB.marsh, region: 1, canopy: 0.1, waterDist: 6, env: { light: 0, time: 23, season: 1 }, listener: { x: 0, y: 1, z: -25 } }),
    windyWood: inputs({ env: { wind: 1, light: 0.8 } }),
    afterRain: inputs({ env: { rain: 0, light: 0.8 } }),
    dusk: inputs({ env: { light: 0.12, time: 20, season: 2 } }),
  };
  for (const [name, inp] of Object.entries(cases)) {
    const { eng, w } = setup(11);
    w.setInputs(inp);
    if (name === 'afterRain') w.wetness = 0.9;
    let peak = 0;
    const ac = eng.ac;
    for (let t = 0; t < 900; t += 0.1) {
      ac.advance(0.1);
      w.update(0.1);
      peak = Math.max(peak, w.activeCount);
    }
    assert.ok(peak <= MAX_ACTIVE, `${name}: ${peak} active`);
    const total = KINDS.reduce((a, k) => a + w.fired[k], 0);
    assert.ok(total > 0, `${name}: something happened`);
    for (const k of KINDS) assert.ok(w.countOf(k) <= KIND[k].maxVoices);
    assert.ok(stats.liveSources < 300, `${name}: sources ${stats.liveSources}`);
    // Frogs only on the pond night, grasshoppers only at the meadow noon.
    if (name === 'pondNight') assert.ok(w.fired.frog > 3, `frogs ${w.fired.frog}`);
    if (name === 'meadowNoon') assert.ok(w.fired.grasshopper + w.fired.bee > 0);
    if (name === 'windyWood') assert.ok(w.fired.creak > 0);
    if (name === 'afterRain') assert.ok(w.fired.drip > 20);
    if (name !== 'pondNight') assert.equal(w.fired.frog, 0);
    if (name !== 'dusk') assert.equal(w.fired.fox, 0);
  }
});

test('quiet where nothing lives: a snowfield in winter, and no events during focus', () => {
  const { w } = setup(2);
  w.setInputs(inputs({ habitat: HAB.snow, region: 5, canopy: 0, waterDist: Infinity, env: { season: 3, light: 1, cloud: 0.8 } }));
  run(w, 300);
  assert.equal(KINDS.reduce((a, k) => a + w.fired[k], 0), 0);
  const b = setup(2);
  b.w.setInputs(inputs({ env: { light: 0 } }));
  b.w.focus = 1;
  run(b.w, 300);
  assert.equal(KINDS.reduce((a, k) => a + b.w.fired[k], 0), 0);
  b.w.focus = 0;
  run(b.w, 300);
  assert.ok(KINDS.reduce((a, k) => a + b.w.fired[k], 0) > 0);
});

test('deterministic for a seed, and survives missing inputs and a vanishing world', () => {
  const a = setup(5), b = setup(5);
  for (const x of [a, b]) { x.w.setInputs(inputs({ env: { light: 0 }, habitat: HAB.woodland })); run(x.w, 400); }
  assert.deepEqual(a.w.fired, b.w.fired);
  const { w } = setup(1);
  w.update(1); // no inputs yet
  w.setInputs(inputs({ world: {} }));
  run(w, 120);
  w.setInputs({ env: {}, listener: L, world: undefined });
  assert.doesNotThrow(() => run(w, 60));
});
