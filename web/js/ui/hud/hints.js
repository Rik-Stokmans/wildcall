// First-time contextual hints. Pure: storage is injected so it can be tested.
export const HINTS = {
  movement: { keys: ['W', 'A', 'S', 'D'], text: 'to walk. Hold Shift to run, C to crouch. Slow steps spook fewer birds.' },
  focus: { keys: ['F'], text: 'Hold to listen closely. It sharpens what you hear, but never shows you the bird.' },
  binoculars: { keys: ['1'], text: 'Take out the binoculars, then hold the right mouse button to raise them.' },
  journal: { keys: ['J'], text: 'Open your field journal to review what you have found.' },
  interact: { keys: ['E'], text: 'to interact with things in the field.' },
  // Onboarding nudges (shown once each; see nudges.js for when they are due).
  finn: { keys: [], text: "Finn keeps an outfitter's stall at the Woodland Entrance. Follow the soft mark on your compass when you are ready.", once: true, seconds: 24, icon: 'shop' },
  cabin: { keys: ['E'], text: 'at the cabin door to use its stations: the research desk, the equipment rack and the kitchen.', once: true, seconds: 16, icon: 'cabin' },
  forage: { keys: ['E'], text: 'to pick this plant. Foraged things go in your pack and are pressed into the Herbarium.', once: true, seconds: 12, icon: 'leaf' },
  nest: { keys: ['J'], text: 'A nest! Watch it quietly from a distance. It is noted in your journal under Nests.', once: true, seconds: 12, icon: 'nest' },
  cook: { keys: [], text: 'You have ingredients. Cook them at the cabin stove or over a camp fire for a meal that helps in the field.', once: true, seconds: 13, icon: 'heart' },
};

const KEY = 'wildcall.hud.hints.v1';
const maxShows = (id) => (HINTS[id]?.once ? 1 : MAX_SHOWS);
const MAX_SHOWS = 3;

export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

export class HintTracker {
  /** @param storage localStorage-like; @param enabled () => bool (settings.hints) */
  constructor(storage, enabled = () => true) {
    this.storage = storage;
    this.enabled = enabled;
    this.data = { done: {}, shown: {}, count: {} };
    this.active = null; // {id, until}
    try {
      const raw = JSON.parse(storage?.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') this.data = { done: raw.done || {}, shown: raw.shown || {}, count: raw.count || {} };
    } catch { /* corrupt or unavailable: start fresh */ }
  }

  _save() { try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ } }

  isDone(id) { return !!this.data.done[id]; }

  /** Has this hint any shows left? */
  available(id) { return !!(this.enabled() && HINTS[id] && !this.data.done[id] && (this.data.shown[id] || 0) < maxShows(id)); }

  /** Has this hint been on screen at least once? */
  wasShown(id) { return (this.data.shown[id] || 0) > 0; }

  /** Show a hint now (only one at a time). Returns the hint or null. */
  request(id, now, seconds = HINTS[id]?.seconds || 9) {
    if (!this.available(id)) return null;
    if (this.active && this.active.until > now) return null;
    this.data.shown[id] = (this.data.shown[id] || 0) + 1;
    this.active = { id, until: now + seconds };
    this._save();
    return { id, ...HINTS[id] };
  }

  /** The player did the thing: never show it again. Returns true if it was on screen. */
  complete(id) {
    const wasActive = this.active?.id === id;
    if (!this.data.done[id]) { this.data.done[id] = true; this._save(); }
    if (wasActive) this.active = null;
    return wasActive;
  }

  /** Call every frame; returns true when the active hint just timed out. */
  tick(now) {
    if (this.active && this.active.until <= now) { this.active = null; return true; }
    return false;
  }

  /** Put the active hint away without marking it done (a dismiss click). */
  dismiss() { const a = this.active; this.active = null; if (a && HINTS[a.id]?.once) this.complete(a.id); return !!a; }

  /** A remembered counter (e.g. how often the player has used focused listening). */
  count(id) { return this.data.count[id] || 0; }
  bump(id) { this.data.count[id] = (this.data.count[id] || 0) + 1; this._save(); return this.data.count[id]; }

  /** Counted tip that is not a card (the "Hold F" line on clue cards). */
  tipAvailable(id, max = 4, doneId = id) { return this.enabled() && !this.data.done[doneId] && (this.data.shown[id] || 0) < max; }
  tipShown(id) { this.data.shown[id] = (this.data.shown[id] || 0) + 1; this._save(); }
}
