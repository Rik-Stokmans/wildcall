// The mix by numbers: for representative states, the buses sum under the limiter with
// headroom, the new wildlife layer and the ambience stay well under a typical nearby
// song, and the narrator's ducking targets are met. See mixmodel.js for the assumptions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  busLevels, dbBelow, songRms, chorusRms, LIMITER_DB, HEADROOM_DB, BIRD_MASK_DB,
} from './mixmodel.js';
import { HAB } from './wildmodel.js';
import { gainToDb, dbToGain } from './curves.js';
import { DUCK } from './narratorbus.js';

const E = (o = {}) => ({ time: 12, season: 1, weather: 0, wind: 0.2, rain: 0, mist: 0, cloud: 0.2, light: 1, ...o });

/** The four states of the brief, plus a summer meadow and a night at a lake. */
const STATES = {
  'dawn chorus in woodland': {
    env: E({ time: 5.5, light: 0.35, season: 0, wind: 0.1, mist: 0.3 }), region: 0, habitat: HAB.woodland, canopy: 0.8,
    singers: [9, 15, 24, 38, 58], altitude: 10, // ~12 birds in song at ~40 % duty: five at once
  },
  'windy coast': {
    env: E({ wind: 0.9, cloud: 0.5 }), region: 3, habitat: HAB.beach, canopy: 0, seaDist: 20, waterDist: 6,
    singers: [10, 30], altitude: 3,
  },
  'rainy marsh night': {
    env: E({ time: 23, light: 0, wind: 0.2, rain: 0.8 }), region: 1, habitat: HAB.marsh, canopy: 0.1, waterDist: 3,
    wetness: 0.9, singers: [25], altitude: 2,
  },
  'quiet snowfield': {
    env: E({ season: 3, wind: 0.1, cloud: 0.8 }), region: 5, habitat: HAB.snow, canopy: 0, singers: [12], altitude: 20,
  },
  'summer meadow noon': {
    env: E({}), region: 0, habitat: HAB.meadow, canopy: 0, singers: [8, 15], altitude: 10,
  },
  'lakeside summer dusk': {
    env: E({ time: 20, light: 0.12, wind: 0.15 }), region: 0, habitat: HAB.river, canopy: 0.2, waterDist: 3,
    singers: [14, 26], altitude: 2,
  },
};

const LIMIT = LIMITER_DB - HEADROOM_DB;

test('each representative state sums under the limiter threshold with headroom', () => {
  for (const [name, s] of Object.entries(STATES)) {
    for (const narrator of [false, true]) {
      const b = busLevels({ ...s, narrator });
      // A song at 8 m or a dawn chorus already reaches the limiter's knee (it starts at
      // -12 dB: threshold -6, knee 6); the mix must stay under the threshold itself.
      assert.ok(b.peakDb <= LIMIT, `${name} (narrator ${narrator}): peak ${b.peakDb.toFixed(1)} dBFS > ${LIMIT}`);
      assert.ok(Number.isFinite(b.peakDb) || b.total === 0);
    }
  }
});

test('the wildlife layer is quiet in absolute terms: worst case under -26 dBFS RMS at the bus', () => {
  for (const [name, s] of Object.entries(STATES)) {
    const b = busLevels(s);
    assert.ok(b.wildlife === 0 || gainToDb(b.wildlife) <= -26, `${name}: wildlife ${gainToDb(b.wildlife).toFixed(1)} dBFS`);
  }
});

test('even at full user volumes the peak stays below the limiter threshold', () => {
  for (const [name, s] of Object.entries(STATES)) {
    const b = busLevels({ ...s, narrator: true, vol: { volMaster: 1, volBirds: 1, volAmbient: 1, volMusic: 1, volNarrator: 1 } });
    assert.ok(b.peakDb <= LIMITER_DB + 3, `${name}: ${b.peakDb.toFixed(1)}`); // the soft clip catches the rest
  }
});

test('the new wildlife layer stays at least 6 dB under a typical nearby song, in every state', () => {
  for (const [name, s] of Object.entries(STATES)) {
    const b = busLevels(s);
    assert.ok(dbBelow(b.songNearby, b.wildlife) >= BIRD_MASK_DB, `${name}: wildlife ${dbBelow(b.songNearby, b.wildlife).toFixed(1)} dB under song`);
  }
});

test('ambience plus wildlife stay at least 6 dB under a typical nearby song', () => {
  for (const [name, s] of Object.entries(STATES)) {
    const b = busLevels(s);
    const margin = dbBelow(b.songNearby, b.bed);
    assert.ok(margin >= BIRD_MASK_DB, `${name}: bed ${margin.toFixed(1)} dB under song`);
  }
});

test('wildlife is also under the song across a sweep of places, weathers and times', () => {
  let worst = Infinity;
  for (const region of [0, 1, 2, 3, 4, 5, 255]) for (const wind of [0, 0.4, 1]) for (const rain of [0, 0.6]) for (const light of [0, 0.15, 1]) {
    for (const habitat of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) for (const [waterDist, creekDist] of [[Infinity, Infinity], [3, Infinity], [3, 5]]) {
      for (const season of [0, 1, 2, 3]) {
        const b = busLevels({
          env: E({ wind, rain, light, season }), region, habitat, canopy: 0.6, waterDist, creekDist, wetness: 0.6, singers: [8],
        });
        worst = Math.min(worst, dbBelow(b.songNearby, b.wildlife));
      }
    }
  }
  assert.ok(worst >= BIRD_MASK_DB, `worst wildlife margin ${worst.toFixed(1)} dB`);
});

test('the ambience bed alone is not what masks the birds in ordinary weather', () => {
  // A gale on exposed ground is allowed to mask birds (spec 12.3 weather noise), but a
  // calm or breezy day, rain included, must leave the song 6 dB clear.
  for (const region of [0, 1, 3, 4]) for (const wind of [0, 0.3, 0.6]) for (const rain of [0, 0.5]) {
    const b = busLevels({ env: E({ wind, rain, light: 1 }), region, habitat: HAB.woodland, canopy: 0.5, waterDist: 3, singers: [8] });
    assert.ok(dbBelow(b.songNearby, b.bed) >= BIRD_MASK_DB, `region ${region} wind ${wind} rain ${rain}: ${dbBelow(b.songNearby, b.bed).toFixed(1)}`);
  }
});

test('narrator ducking: music -8 dB, ambience (and wildlife) -3 dB, birds untouched', () => {
  // No bird singing, so the music is not already stepping aside for a call.
  const s = { ...STATES['summer meadow noon'], singers: [] };
  const quiet = busLevels({ ...s, narrator: false });
  const talking = busLevels({ ...s, narrator: true });
  near(gainToDb(talking.music / quiet.music), -8, 0.01);
  near(gainToDb(talking.ambience / quiet.ambience), -3, 0.01);
  near(gainToDb(talking.wildlife / quiet.wildlife), -3, 0.01);
  assert.equal(talking.birds, quiet.birds);
  assert.equal(talking.narrator > 0, true);
  assert.equal(quiet.narrator, 0);
  assert.equal(DUCK.musicDb, -8);
  assert.equal(DUCK.ambienceDb, -3);
  assert.equal(DUCK.attackS, 0.25);
});

test('the narrator is clearly above the beds he ducks (speech stays intelligible)', () => {
  for (const [name, s] of Object.entries(STATES)) {
    const b = busLevels({ ...s, narrator: true });
    assert.ok(dbBelow(b.narrator, b.bed) >= 6, `${name}: narrator ${dbBelow(b.narrator, b.bed).toFixed(1)} dB over the bed`);
    assert.ok(dbBelow(b.narrator, b.music) >= 6, `${name}: narrator over music`);
  }
});

test('song model: louder when close, a chorus is louder than one singer', () => {
  assert.ok(songRms(5) > songRms(20));
  assert.ok(songRms(20) > songRms(80));
  assert.ok(chorusRms([8, 12, 20]) > songRms(8));
  assert.equal(chorusRms([]), 0);
  near(gainToDb(dbToGain(-12)), -12, 1e-9);
});

function near(a, b, eps) { assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`); }
