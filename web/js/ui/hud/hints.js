// First-time contextual hints. Pure: storage is injected so it can be tested.
export const HINTS = {
  movement: { keys: ['W', 'A', 'S', 'D'], text: 'to walk. Hold Shift to run, C to crouch. Slow steps spook fewer birds.' },
  focus: { keys: ['F'], text: 'Hold to listen closely. It sharpens what you hear, but never shows you the bird.' },
  binoculars: { keys: ['1'], text: 'Take out the binoculars, then hold the right mouse button to raise them.' },
  journal: { keys: ['J'], text: 'Open your field journal to review what you have found.' },
  interact: { keys: ['E'], text: 'to interact with things in the field.' },
};

const KEY = 'wildcall.hud.hints.v1';
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
    this.data = { done: {}, shown: {} };
    this.active = null; // {id, until}
    try {
      const raw = JSON.parse(storage?.getItem(KEY) || 'null');
      if (raw && typeof raw === 'object') this.data = { done: raw.done || {}, shown: raw.shown || {} };
    } catch { /* corrupt or unavailable: start fresh */ }
  }

  _save() { try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ } }

  isDone(id) { return !!this.data.done[id]; }

  /** Has this hint any shows left? */
  available(id) { return this.enabled() && HINTS[id] && !this.data.done[id] && (this.data.shown[id] || 0) < MAX_SHOWS; }

  /** Show a hint now (only one at a time). Returns the hint or null. */
  request(id, now, seconds = 9) {
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

  /** Counted tip that is not a card (the "Hold F" line on clue cards). */
  tipAvailable(id, max = 4, doneId = id) { return this.enabled() && !this.data.done[doneId] && (this.data.shown[id] || 0) < max; }
  tipShown(id) { this.data.shown[id] = (this.data.shown[id] || 0) + 1; this._save(); }
}
