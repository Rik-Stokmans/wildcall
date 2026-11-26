// Remembers which region type lies where, as the player walks. The server gives the map
// no region labels, and ctx.world.regionAt only answers for loaded chunks, so the client
// samples around the player and keeps the answers (per world seed, in localStorage) to
// letter region names over explored ground.

import { samplePoints, recordSamples, recordLocations, sampleKey } from './regions.js';

export function createRegionMemory() {
  const samples = new Map();
  let storageKey = null;
  let dirty = false;
  let sinceSave = 0;

  function load(key) {
    storageKey = key;
    samples.clear();
    try {
      const raw = JSON.parse(localStorage.getItem(key) || 'null');
      if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'number') samples.set(k, v);
    } catch { /* storage unavailable or corrupt: start fresh */ }
  }
  function save() {
    if (!storageKey || !dirty) return;
    dirty = false;
    try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(samples))); } catch { /* ignore */ }
  }
  return {
    samples,
    /** Bind to a world (call on welcome). */
    bind(seed) { load(`wildcall.regions.${seed}`); },
    /** Sample around a position using ctx.world.regionAt (silently does nothing when unavailable). */
    sample(world, x, z) {
      if (typeof world?.regionAt !== 'function') return false;
      const changed = recordSamples(samples, samplePoints(x, z), (px, pz) => world.regionAt(px, pz));
      if (changed) dirty = true;
      return changed;
    },
    /** Record a place whose region type is known for certain (e.g. the home valley). */
    addKnown(x, z, region) { const k = sampleKey(x, z); if (!samples.has(k)) { samples.set(k, region); dirty = true; } },
    addLocations(locations) { if (recordLocations(samples, locations)) dirty = true; },
    /** Call every frame with dt; persists at most every 20 s. */
    tick(dt) { sinceSave += dt; if (sinceSave > 20) { sinceSave = 0; save(); } },
    save,
  };
}
