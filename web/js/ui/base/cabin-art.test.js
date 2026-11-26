import test from 'node:test';
import assert from 'node:assert/strict';
import { drawCabin, HOTSPOTS, ART_W, ART_H } from './cabin-art.js';
import { skyScene, cabinFeatures } from './logic.js';

// A recording stand-in for CanvasRenderingContext2D: any method is a no-op that counts calls,
// gradients accept colour stops, and bad colour strings are rejected like a real canvas would.
function mockContext() {
  const calls = { n: 0, fills: 0 };
  const gradient = { addColorStop() {} };
  const state = {};
  const target = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  return {
    calls,
    g: new Proxy(target, {
      get(t, k) {
        if (k in t) return t[k];
        if (k in state) return state[k];
        return (...args) => {
          calls.n++;
          if (k === 'fill' || k === 'fillRect') calls.fills++;
          for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${String(k)} got non-finite ${a}`);
        };
      },
      set(t, k, v) {
        if ((k === 'fillStyle' || k === 'strokeStyle') && typeof v === 'string') {
          assert.ok(/^(#[0-9a-fA-F]{3,8}|rgba?\([\d., ]+\))$/.test(v), `bad colour ${v}`);
        }
        state[k] = v;
        return true;
      },
    }),
  };
}

test('drawCabin renders every combination of upgrades, hours and weathers without bad values', () => {
  const featureSets = [[], ['audio_lab', 'photo_wall', 'workshop', 'map_room', 'garden']];
  for (const cabin of featureSets) {
    for (const time of [0.5, 5.5, 8, 12.5, 18.5, 21, 23.5]) {
      for (const weather of [0, 1, 2, 3]) {
        const { g, calls } = mockContext();
        drawCabin(g, {
          sky: skyScene(time, weather, weather === 2 ? { mist: 0.4 } : {}),
          features: cabinFeatures({ cabin }),
          slots: cabin.length ? 12 : 6,
          equipped: { optics: true, camera: true, navigation: true, audio: false },
          books: 9,
          active: 'research',
        });
        assert.ok(calls.n > 200, 'draws a fully furnished room');
      }
    }
  }
});

test('hotspots stay inside the illustration and never share a station label twice', () => {
  const labels = new Set();
  for (const h of HOTSPOTS) {
    assert.ok(h.x >= 0 && h.y >= 0 && h.x + h.w <= ART_W && h.y + h.h <= ART_H, h.label);
    assert.ok(!labels.has(h.label));
    labels.add(h.label);
  }
  const stations = new Set(HOTSPOTS.map((h) => h.station));
  for (const s of ['research', 'equipment', 'journal', 'photos', 'storage', 'upgrades', 'rest']) assert.ok(stations.has(s), s);
});
