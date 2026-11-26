import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sunPosition, sunTimes, moonPosition, moonPhase, daylight, starVisibility, skyColors,
  fogRange, viewDistance, hourDiff, EnvInterp, regionAtmosphere, mixAtmosphere, REGION, particleAmounts,
  goldenHour, atmosphereParams, mistLevel, lightBasis, snapShadowCenter, shadowConfig, dirFrom,
} from './skymath.js';

const DEG = Math.PI / 180;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('sun is up by day and down at night in every season', () => {
  for (let s = 0; s < 4; s++) {
    assert.ok(sunPosition(13, s).elevation > 15 * DEG, `noon high, season ${s}`);
    assert.ok(sunPosition(1, s).elevation < -15 * DEG, `night low, season ${s}`);
    const { rise, set } = sunTimes(s);
    assert.ok(near(sunPosition(rise, s).elevation, 0, 1e-9));
    assert.ok(near(sunPosition(set, s).elevation, 0, 1e-9));
  }
});

test('summer days are longer and the sun higher than in winter', () => {
  assert.ok(sunTimes(1).len > sunTimes(3).len);
  assert.ok(sunPosition(12.75, 1).elevation > sunPosition(12.75, 3).elevation);
  // Summer 05:00 is already light, winter 05:00 is still night.
  assert.ok(sunPosition(5, 1).elevation > 0);
  assert.ok(sunPosition(5, 3).elevation < 0);
});

test('sun rises in the east, is south at noon and sets in the west', () => {
  const s = 0;
  const { rise, set } = sunTimes(s);
  const morning = sunPosition(rise + 0.2, s).dir;
  const noon = sunPosition(12.75, s).dir;
  const evening = sunPosition(set - 0.2, s).dir;
  assert.ok(morning[0] > 0.9, 'east = +X');
  assert.ok(noon[2] > 0 && Math.abs(noon[0]) < 1e-6, 'south = +Z');
  assert.ok(evening[0] < -0.9, 'west = -X');
});

test('sun position is continuous and its direction is a unit vector', () => {
  let prev = sunPosition(0, 2);
  for (let h = 0.05; h <= 24; h += 0.05) {
    const p = sunPosition(h, 2);
    assert.ok(Math.abs(p.elevation - prev.elevation) < 3 * DEG, `jump at ${h}`);
    assert.ok(near(Math.hypot(...p.dir), 1, 1e-9));
    prev = p;
  }
  // wraps
  assert.ok(near(sunPosition(24, 0).elevation, sunPosition(0, 0).elevation, 1e-9));
});

test('moon is up when the sun is down; phase stays in 0..1', () => {
  assert.ok(moonPosition(1, 0).elevation > 0);
  assert.ok(moonPosition(13, 0).elevation < 0);
  for (let d = -3; d < 40; d++) { const p = moonPhase(d); assert.ok(p >= 0 && p < 1); }
});

test('daylight and stars by elevation and cloud', () => {
  assert.equal(daylight(-40 * DEG), 0);
  assert.ok(near(daylight(60 * DEG), 1));
  assert.ok(daylight(60 * DEG, 1) < daylight(60 * DEG, 0));
  assert.ok(daylight(-40 * DEG, 0) === 0 && starVisibility(-40 * DEG, 0) === 1);
  assert.equal(starVisibility(20 * DEG, 0), 0);
  assert.ok(starVisibility(-40 * DEG, 1) < 0.01);
});

const lum = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
const warmth = (c) => c[0] - c[2];

test('sky colour keys: night is dark blue, midday bright, dawn horizon warm', () => {
  const night = skyColors({ hour: 1, season: 1 });
  const noon = skyColors({ hour: 13, season: 1 });
  const { rise, set } = sunTimes(1);
  const dawn = skyColors({ hour: rise + 0.5, season: 1 });
  const preDawn = skyColors({ hour: rise - 0.6, season: 1 });
  const dusk = skyColors({ hour: set - 0.5, season: 1 });
  assert.ok(lum(night.zenith) < 0.15 && night.zenith[2] > night.zenith[0], 'night deep blue');
  assert.ok(lum(noon.zenith) > lum(night.zenith) + 0.3);
  assert.ok(noon.zenith[2] > noon.zenith[0], 'midday sky is blue');
  assert.ok(warmth(dawn.horizon) > 0.15, 'golden dawn');
  assert.ok(warmth(dusk.horizon) > 0.15, 'golden evening');
  assert.ok(warmth(preDawn.horizon) < warmth(dawn.horizon), 'pre-dawn cooler than dawn');
  assert.ok(noon.sunIntensity > dawn.sunIntensity && night.sunIntensity < 0.01);
  assert.ok(night.hemiIntensity >= 0.5, 'never pitch black');
  assert.ok(night.exposure > noon.exposure);
  assert.ok(night.stars > 0.9 && noon.stars === 0);
  for (const c of [night, noon, dawn, dusk]) {
    for (const k of ['zenith', 'horizon', 'fog', 'sun', 'glow', 'ground', 'hemiSky', 'hemiGround']) {
      for (const v of c[k]) assert.ok(v >= 0 && v <= 1.0001, `${k} in range`);
    }
  }
});

test('overcast greys the sky; seasons and regions tint it', () => {
  const clear = skyColors({ hour: 13, season: 1, cloud: 0 });
  const grey = skyColors({ hour: 13, season: 1, cloud: 1, rain: 1 });
  const sat = (c) => Math.max(...c) - Math.min(...c);
  assert.ok(sat(grey.zenith) < sat(clear.zenith));
  assert.ok(grey.sunIntensity < clear.sunIntensity);
  const amber = skyColors({ hour: 13, season: 1, atmo: regionAtmosphere(REGION.AMBERWOOD) });
  const frost = skyColors({ hour: 13, season: 1, atmo: regionAtmosphere(REGION.FROSTVEIL) });
  assert.ok(warmth(amber.horizon) > warmth(clear.horizon), 'Amberwood warm haze');
  assert.ok(warmth(frost.sun) < warmth(clear.sun), 'Frostveil cold light');
  const autumn = skyColors({ hour: 13, season: 2 });
  const winter = skyColors({ hour: 13, season: 3 });
  assert.ok(warmth(autumn.horizon) > warmth(winter.horizon));
});

test('region atmosphere lookup and blending', () => {
  assert.equal(regionAtmosphere(255), regionAtmosphere(REGION.GREENHOLLOW));
  assert.equal(regionAtmosphere(REGION.FROSTVEIL).snow, 1);
  const m = mixAtmosphere(regionAtmosphere(0), regionAtmosphere(5), 0.5);
  assert.ok(near(m.snow, 0.5));
});

test('fog fades terrain out before the view edge and thickens with mist and rain', () => {
  for (const q of ['low', 'medium', 'high']) {
    const vd = viewDistance(q);
    const f = fogRange(vd, {});
    assert.ok(f.far <= vd && f.far > vd * 0.9, q);
    assert.ok(f.near < f.far);
  }
  const vd = viewDistance('medium');
  assert.ok(fogRange(vd, { mist: 1 }).far < fogRange(vd, {}).far * 0.4);
  assert.ok(fogRange(vd, { rain: 1 }).far < fogRange(vd, {}).far);
  assert.ok(fogRange(vd, { mist: 1, rain: 1 }).far >= 70);
  assert.ok(viewDistance('high') > viewDistance('low'));
});

test('particles: rain hides under canopy, Frostveil snows, autumn wind sheds leaves', () => {
  const open = particleAmounts({ rain: 1, wind: 0.2 });
  const canopy = particleAmounts({ rain: 1, wind: 0.2, canopy: 1 });
  assert.ok(open.rain > 0.9 && canopy.rain < 0.2);
  const frost = particleAmounts({ rain: 1, atmo: regionAtmosphere(REGION.FROSTVEIL) });
  assert.equal(frost.rain, 0);
  assert.ok(frost.snow > 0.9);
  assert.ok(particleAmounts({ cloud: 0.9, atmo: regionAtmosphere(REGION.FROSTVEIL) }).snow > 0.2, 'flurries');
  assert.equal(particleAmounts({ rain: 1 }).snow, 0, 'no snow in a Greenhollow summer');
  assert.ok(particleAmounts({ wind: 0.8, season: 2 }).leaves > particleAmounts({ wind: 0.8, season: 1 }).leaves);
  assert.equal(particleAmounts({ wind: 0, season: 2 }).leaves, 0);
  const amber = particleAmounts({ wind: 0.8, season: 1, atmo: regionAtmosphere(REGION.AMBERWOOD) });
  assert.ok(amber.leaves > 0.8 && amber.leafA[0] > amber.leafA[2]);
});

test('hourDiff wraps around midnight', () => {
  assert.equal(hourDiff(23.5, 0.5), 1);
  assert.equal(hourDiff(0.5, 23.5), -1);
  assert.equal(hourDiff(6, 8), 2);
});

test('EnvInterp: first update snaps, scalars ease, clock runs at the server rate', () => {
  const it = new EnvInterp();
  it.set({ time: 6, day: 1, season: 0, weather: 0, rain: 0, cloud: 0, mist: 0, wind: 0, light: 0.5, dayLen: 1440 });
  assert.equal(it.cur.time, 6);
  it.set({ time: 6.0167, rain: 1, cloud: 1, dayLen: 1440 });
  it.step(0.5);
  assert.ok(it.cur.rain > 0 && it.cur.rain < 1, 'eases, no pop');
  for (let i = 0; i < 200; i++) it.step(0.05);
  assert.ok(it.cur.rain > 0.99);
  // 10 s at 1 game hour per real minute → +1/6 h (plus the tiny correction).
  const before = it.cur.time;
  for (let i = 0; i < 100; i++) it.step(0.1);
  assert.ok(near(hourDiff(before, it.cur.time), 10 / 60, 1e-3));
});

test('EnvInterp: small drift is corrected smoothly, big jumps snap, midnight wraps', () => {
  const it = new EnvInterp();
  it.set({ time: 10, dayLen: 1440 });
  it.set({ time: 10.1, dayLen: 1440 });
  assert.equal(it.cur.time, 10, 'small correction is not applied instantly');
  for (let i = 0; i < 60; i++) it.step(0.05);
  assert.ok(Math.abs(hourDiff(it.target.time, it.cur.time)) < 0.01);
  it.set({ time: 18 });
  assert.equal(it.cur.time, 18, 'rest / skip snaps');
  it.set({ time: 23.99 });
  for (let i = 0; i < 20; i++) it.step(0.1);
  assert.ok(it.cur.time < 1, 'wrapped past midnight');
});

test('light balance: warm sun over a cooler, dimmer sky fill; golden hour is saturated', () => {
  const { rise, set } = sunTimes(1);
  const noon = skyColors({ hour: 13, season: 1 });
  const gold = skyColors({ hour: set - 0.7, season: 1 });
  const night = skyColors({ hour: 1, season: 1 });
  // Sunlit side clearly brighter than shade at midday (ratio of the light sums).
  const shade = noon.hemiIntensity + noon.fillIntensity;
  assert.ok((noon.sunIntensity + shade) / shade > 2, 'contrast at noon');
  assert.ok(warmth(noon.sun) > 0 && noon.hemiSky[2] > noon.hemiSky[0], 'warm sun, cool sky fill');
  assert.ok(gold.golden > 0.5 && noon.golden === 0, 'golden-hour weight');
  assert.ok(warmth(gold.sun) > warmth(noon.sun) + 0.15, 'saturated warm evening sun');
  assert.ok(gold.sunIntensity > 1, 'evening sun still carries light');
  assert.ok(night.moonIntensity > 0.3 && night.moonLight[2] > night.moonLight[0], 'cool moonlight');
  assert.ok(night.fillIntensity > 0.15, 'night stays readable');
  assert.ok(skyColors({ hour: rise - 1, season: 1 }).golden < 0.05);
});

test('goldenHour peaks just after sunrise / before sunset', () => {
  assert.equal(goldenHour(-10 * DEG), 0);
  assert.ok(goldenHour(5 * DEG) > 0.9);
  assert.equal(goldenHour(40 * DEG), 0);
});

test('particles: motes by day, fireflies on summer evenings only, Frostveil always snows a little', () => {
  const day = particleAmounts({ hour: 13, season: 1 });
  const night = particleAmounts({ hour: 1, season: 1 });
  assert.ok(day.motes > 0.2 && night.motes === 0);
  assert.ok(particleAmounts({ hour: 13, season: 1, rain: 1 }).motes < 0.01, 'no motes in rain');
  const { set } = sunTimes(1);
  const eve = particleAmounts({ hour: set + 0.8, season: 1 });
  assert.ok(eve.fireflies > 0.8, 'summer evening fireflies');
  assert.equal(particleAmounts({ hour: set + 0.8, season: 3 }).fireflies, 0, 'none in winter');
  assert.equal(day.fireflies, 0, 'none at midday');
  assert.ok(particleAmounts({ hour: set + 0.8, season: 1, rain: 1 }).fireflies < 0.01, 'none in rain');
  assert.equal(particleAmounts({ hour: set + 0.8, season: 1, atmo: regionAtmosphere(REGION.FROSTVEIL) }).fireflies, 0);
  assert.ok(particleAmounts({ cloud: 0, atmo: regionAtmosphere(REGION.FROSTVEIL) }).snow > 0.1, 'Frostveil flakes');
  assert.ok(particleAmounts({ wind: 0, atmo: regionAtmosphere(REGION.AMBERWOOD) }).leaves > 0.3, 'Amberwood sheds on still days');
});

test('atmosphere: blue aerial perspective by day, mist from env and wet ground, warm in-scatter at golden hour', () => {
  const { set } = sunTimes(1);
  const noonSky = skyColors({ hour: 13, season: 1 });
  const goldSky = skyColors({ hour: set - 0.6, season: 1 });
  const noon = atmosphereParams({ sky: noonSky, fogFar: 400 });
  const gold = atmosphereParams({ sky: goldSky, fogFar: 400 });
  assert.ok(noon.aerial[2] > noon.aerial[0], 'aerial tint is blue');
  assert.ok(noon.aerialAmt > 0.3 && noon.aerialAmt <= 1);
  assert.ok(gold.inscatterAmt > noon.inscatterAmt, 'in-scatter grows as the sun lowers');
  assert.ok(warmth(gold.inscatter) > 0.2);
  assert.ok(atmosphereParams({ sky: noonSky, mist: 1, fogFar: 400 }).mistAmt > 0.9);
  assert.ok(atmosphereParams({ sky: noonSky, wet: 1, fogFar: 400 }).mistAmt > noon.mistAmt, 'post-rain mist');
  assert.ok(atmosphereParams({ sky: noonSky, rain: 1, fogFar: 400 }).curtain > 0.9);
  assert.equal(noon.curtain, 0);
  assert.equal(noon.fogFar, 400);
});

test('mistLevel sits just above the low ground, robust to pits and water', () => {
  const hs = [12, 14, 13, 30, 40, 11, 12, 15, -6, 25];
  const m = mistLevel(hs);
  assert.ok(m > 11 && m < 15, String(m));
  assert.equal(mistLevel([-5, -4, -3]), 1.5, 'never below sea level');
  assert.equal(mistLevel([]), 0);
});

test('shadow centre snaps to whole texels in light space', () => {
  const L = dirFrom(2.1, 25 * DEG);
  const { right, up } = lightBasis(L);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(near(dot(right, L), 0, 1e-9) && near(dot(up, L), 0, 1e-9) && near(dot(right, up), 0, 1e-9));
  assert.ok(near(Math.hypot(...up), 1, 1e-9) && up[1] > 0, 'up is unit and points skywards');
  const texel = 0.0625;
  for (const c of [[3.3, 7.1, -11.9], [1000.02, 40.5, -2000.7]]) {
    const s = snapShadowCenter(c, L, texel);
    const fr = dot(s, right) / texel, fu = dot(s, up) / texel;
    assert.ok(near(fr, Math.round(fr), 1e-6) && near(fu, Math.round(fu), 1e-6));
    assert.ok(Math.hypot(s[0] - c[0], s[1] - c[1], s[2] - c[2]) <= texel);
    // Moving along the light direction does not change the snap.
    assert.ok(near(dot(s, L), dot(c, L), 1e-9));
  }
  assert.equal(shadowConfig('low').enabled, false);
  assert.ok(shadowConfig('high').mapSize > shadowConfig('medium').mapSize);
});

test('dawn mist is pearl / pale gold, never olive-brown', () => {
  for (const hour of [5.6, 6.0, 6.4, 7.0, 19.4]) {
    const sky = skyColors({ hour, season: 1, cloud: 0, rain: 0, mist: 1 });
    if (sky.daylight < 0.05) continue;
    const m = atmosphereParams({ sky, mist: 1, fogFar: 400 }).mist;
    assert.ok(!(m[1] > m[0] * 1.02 && m[2] < m[1] * 0.95), `olive at ${hour}: ${m}`);
    assert.ok(m[2] >= m[1] * 0.72 && m[2] >= m[0] * 0.65, `not brown at ${hour}: ${m}`);
    assert.ok(Math.max(...m) - Math.min(...m) < 0.25, `soft, low saturation at ${hour}: ${m}`);
  }
});
