import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from './rng.js';
import {
  HAB, KINDS, KIND, wildlifeRates, stepWetness, shouldFire, pickSpot, peakAt, distanceGain,
  habitatWeight, wildlifeWorstCase,
} from './wildmodel.js';

const E = (o = {}) => ({ time: 12, season: 1, weather: 0, wind: 0.15, rain: 0, mist: 0, cloud: 0.15, light: 1, ...o });
const rates = (o = {}) => wildlifeRates({
  env: E(o.env), region: 0, habitat: HAB.woodland, canopy: 0.7, waterDist: Infinity, seaDist: Infinity,
  creekDist: Infinity, wetness: 0, ...o, ...(o.env ? { env: E(o.env) } : {}),
});

test('every rate is finite, within 0..maxRate, for extreme inputs', () => {
  for (const region of [0, 1, 2, 3, 4, 5, 255]) for (const habitat of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    for (const wind of [0, 1]) for (const rain of [0, 1]) for (const light of [0, 1]) for (const season of [0, 1, 2, 3]) {
      const r = wildlifeRates({
        env: E({ wind, rain, light, season }), region, habitat, canopy: 1, waterDist: 0, seaDist: 0, creekDist: 0, wetness: 1,
      });
      for (const k of KINDS) assert.ok(Number.isFinite(r[k]) && r[k] >= 0 && r[k] <= KIND[k].maxRate, `${k}=${r[k]}`);
    }
  }
  // Missing inputs are fine.
  const r = wildlifeRates({});
  for (const k of KINDS) assert.ok(Number.isFinite(r[k]));
});

test('frogs: still water, spring/summer, evenings and nights, not winter, not in a creek', () => {
  const pond = { habitat: HAB.marsh, region: 1, waterDist: 4, canopy: 0.1 };
  const night = rates({ ...pond, env: { light: 0, time: 23, season: 1 } }).frog;
  assert.ok(night > 4, `night ${night}`);
  assert.ok(rates({ ...pond, env: { light: 1, season: 1 } }).frog < 0.25 * night, 'day is quiet');
  assert.ok(rates({ ...pond, env: { light: 0.2, time: 20, season: 0 } }).frog > 0.5 * night, 'spring dusk');
  assert.equal(rates({ ...pond, env: { light: 0, season: 3 } }).frog, 0);
  assert.ok(rates({ ...pond, env: { light: 0, season: 2 } }).frog < 0.3 * night);
  assert.equal(rates({ ...pond, waterDist: Infinity, env: { light: 0 } }).frog, 0);
  assert.ok(rates({ ...pond, waterDist: 60, env: { light: 0 } }).frog < 0.25 * night);
  assert.ok(rates({ ...pond, creekDist: 2, env: { light: 0 } }).frog < 0.35 * night, 'running water drowns frogs');
  assert.ok(rates({ ...pond, env: { light: 0, wind: 1 } }).frog < 0.5 * night);
  assert.equal(rates({ ...pond, region: 5, env: { light: 0 } }).frog, 0);
});

test('squirrels: woodland by day only, quieter in rain, busy in autumn', () => {
  const day = rates({ env: { light: 1, season: 1 } }).squirrel;
  assert.ok(day > 0.5);
  assert.equal(rates({ env: { light: 0 } }).squirrel, 0);
  assert.equal(rates({ habitat: HAB.meadow, canopy: 0 }).squirrel, 0);
  assert.equal(rates({ habitat: HAB.snow, canopy: 0 }).squirrel, 0);
  assert.ok(rates({ env: { light: 1, rain: 0.8 } }).squirrel < 0.3 * day);
  assert.ok(rates({ env: { light: 1, season: 2 } }).squirrel > day);
  assert.ok(rates({ env: { light: 1, season: 3 } }).squirrel < day);
});

test('rustles: any time on vegetated ground, more at night, fewer in rain and wind and snow', () => {
  const dayR = rates({ env: { light: 1 }, habitat: HAB.shrub }).rustle;
  const nightR = rates({ env: { light: 0 }, habitat: HAB.shrub }).rustle;
  assert.ok(dayR > 0.5 && nightR > dayR);
  assert.ok(rates({ env: { rain: 1 }, habitat: HAB.shrub }).rustle < 0.2 * dayR);
  assert.ok(rates({ habitat: HAB.snow, region: 5 }).rustle < 0.4 * dayR);
  assert.equal(rates({ habitat: HAB.ocean }).rustle, 0);
});

test('bees: flower meadow, warm sun, calm - not at night, not in cloud/rain/wind/winter', () => {
  const m = { habitat: HAB.meadow, canopy: 0 };
  const sunny = rates({ ...m, env: { light: 1, cloud: 0, season: 1 } }).bee;
  assert.ok(sunny > 1);
  assert.equal(rates({ ...m, env: { light: 0 } }).bee, 0);
  assert.ok(rates({ ...m, env: { light: 1, cloud: 1 } }).bee < 0.4 * sunny);
  assert.equal(rates({ ...m, env: { light: 1, rain: 1 } }).bee, 0);
  assert.equal(rates({ ...m, env: { light: 1, wind: 0.8 } }).bee, 0);
  assert.equal(rates({ ...m, env: { light: 1, season: 3 } }).bee, 0);
  assert.ok(rates({ habitat: HAB.woodland }).bee < 0.2 * sunny);
});

test('grasshoppers: summer meadows at midday', () => {
  const m = { habitat: HAB.meadow, canopy: 0 };
  const noon = rates({ ...m, env: { light: 1, season: 1 } }).grasshopper;
  assert.ok(noon > 1);
  assert.ok(rates({ ...m, env: { light: 0.55, season: 1 } }).grasshopper < 0.2 * noon, 'not in the weak light of morning');
  assert.equal(rates({ ...m, env: { light: 0 } }).grasshopper, 0);
  assert.ok(rates({ ...m, env: { light: 1, season: 0 } }).grasshopper < 0.2 * noon);
  assert.equal(rates({ ...m, env: { light: 1, season: 3 } }).grasshopper, 0);
  assert.equal(rates({ habitat: HAB.woodland, env: { light: 1 } }).grasshopper, 0);
});

test('deer and fox: rare, at dusk and night; fox most in winter; never in rain', () => {
  const dusk = rates({ env: { light: 0.12, time: 19.5, season: 2 } });
  const day = rates({ env: { light: 1 } });
  assert.ok(dusk.deer > 0.1 && dusk.deer <= KIND.deer.maxRate);
  assert.ok(day.deer < 0.02 * KIND.deer.maxRate + 1e-9 || day.deer === 0);
  assert.equal(day.fox, 0);
  const nightWinter = rates({ env: { light: 0, season: 3 } }).fox;
  const nightSummer = rates({ env: { light: 0, season: 1 } }).fox;
  assert.ok(nightWinter > nightSummer && nightWinter > 0);
  assert.ok(nightWinter <= 0.25 && dusk.deer <= 0.35, 'at most one every few minutes');
  assert.equal(rates({ env: { light: 0, rain: 1 } }).fox, 0);
  // Owls are real birds in the simulation: there is no owl-like kind here.
  assert.ok(!KINDS.some((k) => /owl|hoot/.test(k)));
});

test('wavelets lap at lake and sea shores, more in wind, drowned by creeks', () => {
  const shore = rates({ waterDist: 2, habitat: HAB.beach, canopy: 0, env: { wind: 0.5 } }).lap;
  assert.ok(shore > 2);
  assert.ok(rates({ waterDist: 2, habitat: HAB.beach, env: { wind: 0 } }).lap < shore);
  assert.equal(rates({ waterDist: 60 }).lap < 0.1, true);
  assert.equal(rates({ waterDist: Infinity }).lap, 0);
  assert.ok(rates({ waterDist: 2, creekDist: 1, env: { wind: 0.5 } }).lap < 0.3 * shore);
});

test('branches creak only in strong wind and among trees', () => {
  assert.equal(rates({ env: { wind: 0.3 } }).creak, 0);
  assert.ok(rates({ env: { wind: 0.95 } }).creak > 1);
  assert.equal(rates({ env: { wind: 0.95 }, canopy: 0, habitat: HAB.meadow }).creak, 0);
});

test('drips after rain: wetness drives them, and they leave the rain bed to its own drips', () => {
  assert.equal(rates({ wetness: 0 }).drip, 0);
  const after = rates({ wetness: 0.9, env: { rain: 0 } }).drip;
  assert.ok(after > 5 && after <= KIND.drip.maxRate);
  assert.equal(rates({ wetness: 0.9, env: { rain: 0.5 } }).drip, 0);
  assert.ok(rates({ wetness: 0.9, canopy: 0 }).drip < after);
  assert.ok(rates({ wetness: 0.3 }).drip < after);
});

test('wetness rises in rain, dries in about ten minutes, and mist keeps a floor', () => {
  let w = 0;
  for (let i = 0; i < 60; i++) w = stepWetness(w, 0.8, 1);
  assert.ok(w > 0.5 && w <= 1);
  const wet = w;
  for (let i = 0; i < 600; i++) w = stepWetness(w, 0, 1);
  assert.ok(w < 0.3 * wet, `after ten dry minutes ${w}`);
  assert.ok(stepWetness(0, 0, 1, 1) >= 0.4);
  assert.equal(stepWetness(NaN, NaN, NaN), 0);
});

test('shouldFire: Poisson timing with a minimum gap', () => {
  const rng = mulberry32(5);
  assert.equal(shouldFire(0, 1, 100, 1, rng), false);
  assert.equal(shouldFire(10, 1, 0.5, 1, rng), false, 'inside the minimum gap');
  let n = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) if (shouldFire(6, 0.25, 100, 1, rng)) n++;
  const perMin = (n / N) * (60 / 0.25);
  assert.ok(perMin > 5 && perMin < 7, `${perMin}/min`);
});

test('pickSpot validates against the world and stays in the kind\'s band', () => {
  const rng = mulberry32(9);
  const L = { x: 0, z: 0 };
  // A pond 20 m east; marsh habitat only at the pond.
  const world = {
    waterDepthAt: (x, z) => (Math.hypot(x - 20, z) < 8 ? 0.5 : 0),
    habitatAt: (x, z) => (Math.hypot(x - 20, z) < 12 ? HAB.marsh : HAB.meadow),
    canopyAt: () => 0.6, heightAt: () => 3, listenerY: 4.6,
  };
  let found = 0;
  for (let i = 0; i < 200; i++) {
    const s = pickSpot('frog', rng, L, world);
    if (!s) continue;
    found++;
    assert.ok(Math.hypot(s.x - 20, s.z) < 12.5, 'a frog sits at the pond');
    assert.ok(s.d >= KIND.frog.near - 1e-9 && s.d <= KIND.frog.far + 1e-9);
    for (const v of [s.x, s.y, s.z]) assert.ok(Number.isFinite(v));
  }
  assert.ok(found > 5, `found ${found}`);
  // No water anywhere: no frogs, no lapping.
  const dry = { waterDepthAt: () => 0, habitatAt: () => HAB.meadow, canopyAt: () => 0 };
  for (let i = 0; i < 50; i++) { assert.equal(pickSpot('frog', rng, L, dry), null); assert.equal(pickSpot('lap', rng, L, dry), null); }
  // Squirrels need trees; bees need flowers; both fine when the world says so.
  assert.equal(pickSpot('squirrel', rng, L, { ...dry, canopyAt: () => 0, habitatAt: () => HAB.meadow }), null);
  assert.ok(pickSpot('squirrel', rng, L, { ...dry, canopyAt: () => 0.9, habitatAt: () => HAB.woodland }));
  assert.ok(pickSpot('bee', rng, L, dry));
  // Deer and fox are far away.
  for (let i = 0; i < 40; i++) {
    const s = pickSpot('deer', rng, L, { ...dry, habitatAt: () => HAB.woodland });
    assert.ok(s && s.d >= 70 && s.d <= 160);
  }
  // Without any world at all, only the kinds that need no knowledge place.
  assert.equal(pickSpot('frog', rng, L, {}), null);
  assert.equal(pickSpot('lap', rng, L, {}), null);
  assert.ok(pickSpot('drip', rng, L, {}));
  assert.equal(pickSpot('nonsense', rng, L, {}), null);
  // A throwing world is survivable.
  assert.doesNotThrow(() => pickSpot('rustle', rng, L, { waterDepthAt() { throw new Error('x'); } }));
});

test('levels: quiet by design, falling with distance', () => {
  for (const k of KINDS) {
    assert.ok(KIND[k].peak <= 0.15, `${k} peak`);
    assert.ok(peakAt(k, KIND[k].far) < peakAt(k, KIND[k].near), `${k} falls with distance`);
    assert.ok(distanceGain(k, 0.1) <= 1 && distanceGain(k, 1000) > 0);
  }
  assert.ok(habitatWeight('frog', HAB.marsh) > habitatWeight('frog', HAB.woodland));
  assert.equal(habitatWeight('squirrel', HAB.ocean), 0);
  const w = wildlifeWorstCase({ frog: 3, rustle: 1 });
  assert.ok(w.rms > 0 && w.parts.frog > 0 && !('bee' in w.parts));
  assert.equal(wildlifeWorstCase({}).rms, 0);
});
