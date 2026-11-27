// Pure clue logic: store, fading, distance bands and the lines of a clue card.
// A clue never names a species unless clue.known is set (server rule); the card
// builder additionally only uses names the caller resolves from that field.

/** "about 30-45 m". Returns '' when the distance is unknown (0,0). */
export function distanceBand(min, max) {
  const lo0 = Number(min) || 0, hi0 = Number(max) || 0;
  if (hi0 <= 0 && lo0 <= 0) return '';
  const r5 = (v) => (v < 10 ? Math.round(v) : Math.round(v / 5) * 5);
  const lo = r5(Math.min(lo0, hi0)), hi = r5(Math.max(lo0, hi0));
  if (lo === hi) return `about ${hi} m`;
  if (lo <= 0) return `within ${hi} m`;
  return `about ${lo}–${hi} m`;
}

const ELEVATION_WORDS = { above: 'from above', level: 'at eye level', below: 'from below' };
export function elevationText(e) { return ELEVATION_WORDS[e] || ''; }

function cap(s) {
  s = String(s || '').replace(/_/g, ' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/**
 * Build the textual content of a clue card. Empty fields are omitted, never filled
 * with "unknown". `resolve` supplies names: { species(id) -> name|'', mystery(id) -> label|'' }.
 * Returns { title, subtitle, new, unusual, facts: [{key, text}], confidence }.
 */
export function clueCard(clue, resolve = {}) {
  const speciesName = clue.known ? (resolve.species?.(clue.known) || '') : '';
  const mysteryLabel = clue.mystery ? (resolve.mystery?.(clue.mystery) || '') : '';
  let title, subtitle = '';
  if (speciesName) title = speciesName;
  else if (clue.new) { title = 'An unfamiliar call'; subtitle = mysteryLabel; }
  else title = mysteryLabel || 'A call';
  const facts = [];
  const add = (key, text) => { if (text) facts.push({ key, text }); };
  add('dist', distanceBand(clue.distMin, clue.distMax));
  add('elev', elevationText(clue.elevation));
  add('pitch', clue.pitch ? `${cap(clue.pitch)} pitch` : '');
  add('pattern', cap(clue.pattern));
  add('habitat', cap(clue.habitat));
  add('perch', cap(clue.perch));
  return {
    title, subtitle,
    quest: clue.mystery && !speciesName ? (resolve.quest?.(clue.mystery) || '') : '',
    dir: clue.dir || '',
    new: !!clue.new && !speciesName,
    unusual: !!clue.unusual,
    facts,
    confidence: clue.confidence || '',
  };
}

/**
 * Live clues keyed by id. Times are seconds on any monotonic clock the caller picks.
 * `cap` is the number of simultaneous sources shown (stats.clueSlots); the strongest win.
 */
export class ClueStore {
  constructor(cap = 2, fadeSeconds = 1.2) {
    this.cap = Math.max(1, cap | 0);
    this.fade = fadeSeconds;
    this.map = new Map();
  }

  setCap(cap) { this.cap = Math.max(1, cap | 0); }

  /** Insert or refresh a clue. Returns {entry, isNew}. */
  upsert(clue, now) {
    const ttl = clue.ttl > 0 ? clue.ttl : 3;
    const prev = this.map.get(clue.id);
    const entry = { clue, id: clue.id, born: prev ? prev.born : now, expires: now + ttl, ttl };
    this.map.set(clue.id, entry);
    return { entry, isNew: !prev };
  }

  /** Drop expired clues; returns the removed ids. */
  prune(now) {
    const gone = [];
    for (const [id, e] of this.map) if (e.expires <= now) { this.map.delete(id); gone.push(id); }
    return gone;
  }

  /** Opacity 0..1: full until the last `fade` seconds, then linear fade-out. */
  alpha(entry, now) {
    const left = entry.expires - now;
    if (left <= 0) return 0;
    const f = Math.min(this.fade, entry.ttl);
    return left >= f ? 1 : left / f;
  }

  /** Live clues, strongest first, capped to the slot count. */
  list(now) {
    const live = [...this.map.values()].filter((e) => e.expires > now);
    live.sort((a, b) => (b.clue.strength - a.clue.strength) || (a.id - b.id));
    return live.slice(0, this.cap);
  }

  clear() { this.map.clear(); }
}
