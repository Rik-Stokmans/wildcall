import test from 'node:test';
import assert from 'node:assert/strict';
import { ambienceMix, daylight, distToPolyline, probeWater, creekDistance, runningWaterDist, REGION } from './mix.js';

const env = (o = {}) => ({ time: 10, season: 1, weather: 0, wind: 0.2, rain: 0, light: 0.9, mist: 0, cloud: 0.2, ...o });
const mix = (o = {}) => ambienceMix({ env: env(o.env), region: REGION.greenhollow, canopy: 0.5, creekDist: Infinity, waterDist: Infinity, seaDist: Infinity, altitude: 20, ...o, env: env(o.env) });

test('every level is within 0..1 for extreme inputs', () => {
  for (const region of [0, 1, 2, 3, 4, 5, 255, 99]) {
    for (const w of [0, 1]) {
      for (const r of [0, 1]) {
        for (const light of [0, 1]) {
          const m = ambienceMix({ env: env({ wind: w, rain: r, light }), region, canopy: 1, creekDist: 0, waterDist: 0, seaDist: 0, altitude: 900 });
          for (const [k, v] of Object.entries(m)) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), `${k}=${v}`);
        }
      }
    }
  }
});

test('wind follows env.wind and is stronger on Windpeak and the coast than in the woods', () => {
  assert.ok(mix({ env: { wind: 0.8 } }).wind > mix({ env: { wind: 0.1 } }).wind);
  const woods = mix({ env: { wind: 0.5 }, canopy: 0 });
  assert.ok(mix({ env: { wind: 0.5 }, canopy: 0, region: REGION.windpeak }).wind > woods.wind);
  assert.ok(mix({ env: { wind: 0.5 }, canopy: 0, region: REGION.coast }).wind > woods.wind);
  // Trees shelter.
  assert.ok(mix({ env: { wind: 0.5 }, canopy: 1 }).wind < woods.wind);
  // Howl only in strong wind on exposed ground.
  assert.equal(mix({ env: { wind: 0.3 }, region: REGION.windpeak }).windHowl, 0);
  assert.ok(mix({ env: { wind: 1 }, region: REGION.windpeak, canopy: 0 }).windHowl > 0.2);
  // There is always a breath of air.
  assert.ok(mix({ env: { wind: 0 } }).wind > 0);
});

test('leaves rustle only under canopy, less in winter', () => {
  assert.equal(mix({ canopy: 0 }).leaves, 0);
  assert.ok(mix({ canopy: 0.9 }).leaves > 0);
  assert.ok(mix({ canopy: 0.9, env: { season: 3 } }).leaves < mix({ canopy: 0.9, env: { season: 1 } }).leaves);
});

test('water near a creek, surf on the coast', () => {
  assert.equal(mix().creek, 0);
  assert.ok(mix({ creekDist: 5 }).creek > mix({ creekDist: 40 }).creek);
  assert.ok(mix({ creekDist: 0 }).creek > 0.95);
  assert.ok(mix({ creekDist: 150 }).creek < 0.01);
  assert.ok(mix({ waterDist: 3 }).lap > 0);
  assert.equal(mix().surf, 0);
  const coast = mix({ region: REGION.coast, seaDist: 30 }).surf;
  assert.ok(coast > 0.3);
  assert.ok(mix({ region: REGION.greenhollow, seaDist: 30 }).surf < coast); // a lake does not crash
});

test('rain: open hiss vs. muffled canopy patter', () => {
  assert.equal(mix().rainOpen, 0);
  const open = mix({ env: { rain: 0.8, weather: 2 }, canopy: 0 });
  const wood = mix({ env: { rain: 0.8, weather: 2 }, canopy: 0.9 });
  assert.ok(open.rainOpen > wood.rainOpen);
  assert.ok(wood.rainCanopy > open.rainCanopy);
  assert.equal(open.rainCanopy, 0);
  assert.ok(mix({ env: { rain: 1 }, canopy: 0 }).rainOpen > mix({ env: { rain: 0.3 }, canopy: 0 }).rainOpen);
});

test('insects: summer days, silenced by rain, absent in winter and in Frostveil', () => {
  const summerDay = mix({ env: { season: 1, light: 1 } }).insects;
  assert.ok(summerDay > 0.5);
  assert.ok(mix({ env: { season: 0, light: 1 } }).insects < summerDay);
  assert.equal(mix({ env: { season: 3, light: 1 } }).insects, 0);
  assert.equal(mix({ env: { season: 1, light: 1 }, region: REGION.frostveil }).insects, 0);
  assert.ok(mix({ env: { season: 1, light: 1, rain: 0.9 } }).insects < 0.1 * summerDay);
  assert.equal(mix({ env: { season: 1, light: 0 } }).insects, 0);
  // Crickets take over on summer nights.
  assert.ok(mix({ env: { season: 1, light: 0, time: 23 } }).crickets > 0.5);
  assert.equal(mix({ env: { season: 1, light: 1 } }).crickets, 0);
});

test('night air only at night', () => {
  assert.equal(mix({ env: { light: 1 } }).night, 0);
  assert.ok(mix({ env: { light: 0, time: 1 } }).night > 0.9);
});

test('daylight falls back to the clock when env.light is missing', () => {
  assert.equal(daylight({ time: 12 }), 1);
  assert.equal(daylight({ time: 2 }), 0);
  assert.equal(daylight({ light: 0.4, time: 12 }), 0.4);
  assert.equal(daylight(null), 1);
});

test('polyline distance', () => {
  const line = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
  assert.equal(distToPolyline(line, 5, 3), 3);
  assert.equal(distToPolyline(line, 13, 5), 3);
  assert.equal(distToPolyline(line, -4, 3), 5);
  assert.equal(distToPolyline([], 0, 0), Infinity);
  assert.equal(distToPolyline([{ x: 3, z: 4 }], 0, 0), 5);
});

test('probeWater finds the nearest water, deep water, and its direction', () => {
  // A river along x = 20 (east), 6 m wide, shallow.
  const river = (x) => (x > 17 && x < 23 ? 0.5 : 0);
  const p = probeWater((x, z) => river(x, z), 0, 0);
  assert.ok(p.waterDist >= 14 && p.waterDist <= 26);
  assert.equal(p.seaDist, Infinity);
  assert.ok(p.dirX > 0.8, `dir ${p.dirX},${p.dirZ}`);
  // Sea to the north (z < -40) is deep.
  const sea = probeWater((x, z) => (z < -40 ? 5 : 0), 0, 0);
  assert.ok(sea.seaDist >= 42 && sea.seaDist <= 64);
  assert.ok(sea.dirZ < -0.8);
  // Dry land, missing function, and a throwing function are all safe.
  assert.equal(probeWater(() => 0, 0, 0).waterDist, Infinity);
  assert.equal(probeWater(undefined, 0, 0).waterDist, Infinity);
  assert.equal(probeWater(() => { throw new Error('x'); }, 0, 0).waterDist, Infinity);
});

test('creek trails and running water', () => {
  const trails = [
    { id: 'main', points: [{ x: 0, z: 0, y: 0 }, { x: 100, z: 0, y: 0 }] },
    { id: 'creek', points: [{ x: 0, z: 50, y: 0 }, { x: 100, z: 50, y: 0 }] },
  ];
  assert.equal(creekDistance(trails, 50, 10), 40);
  assert.equal(creekDistance([trails[0]], 50, 10), Infinity);
  assert.equal(creekDistance(undefined, 0, 0), Infinity);
  // Shallow water inland babbles; marsh pools and the sea shore do not count.
  assert.equal(runningWaterDist(Infinity, { waterDist: 14, seaDist: Infinity }, REGION.greenhollow), 22);
  assert.equal(runningWaterDist(Infinity, { waterDist: 14, seaDist: Infinity }, REGION.marsh), Infinity);
  assert.equal(runningWaterDist(Infinity, { waterDist: 14, seaDist: 42 }, REGION.coast), Infinity);
  assert.equal(runningWaterDist(5, { waterDist: 14, seaDist: Infinity }, REGION.greenhollow), 5);
});

import { ambienceLoad, loadCompensation } from './mix.js';
import { softClipCurve } from './engine.js';

test('layers piling up are levelled, ordinary mixes are left alone', () => {
  const trim = { wind: 0.32, creek: 0.26, surf: 0.42, rainOpen: 0.3 };
  const calm = ambienceLoad({ wind: 0.5, creek: 0.3 }, trim);
  assert.equal(loadCompensation(calm), 1);
  const storm = ambienceLoad({ wind: 1, creek: 1, surf: 1, rainOpen: 1 }, trim);
  const k = loadCompensation(storm);
  assert.ok(k < 0.75 && k > 0.3, `storm gain ${k}`);
  // Levelled power equals the limit: the stack stops growing.
  assert.ok(Math.abs(storm * k * k - 0.16) < 1e-9);
  assert.equal(ambienceLoad(null, trim), 0);
  const mix = ambienceMix({ env: { wind: 0.5, season: 2 }, region: 0, canopy: 0.8, creekDist: Infinity, waterDist: Infinity, seaDist: Infinity, altitude: 0 });
  assert.equal(mix.canopy, 0.8);
  assert.ok(mix.leafDry > 0.8, 'autumn leaves are dry');
});

test('the safety soft clip is transparent below the knee and never reaches full scale', () => {
  const c = softClipCurve(2049);
  const at = (x) => c[Math.round(((x + 1) / 2) * (c.length - 1))];
  assert.ok(Math.abs(at(0.5) - 0.5) < 1e-3 && Math.abs(at(-0.5) + 0.5) < 1e-3);
  assert.ok(Math.abs(at(0.8) - 0.8) < 1e-2);
  assert.ok(at(1) < 0.985 && at(1) > 0.9);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1] - 1e-9, 'monotonic');
});
