// The player's own waypoints: personal map notes ("I heard something over there"), never
// server state. Up to MAX_WAYPOINTS per world, named "Waypoint A", "Waypoint B", ... by
// default, coloured from a small rotating palette of the design tokens, persisted per world
// seed in localStorage. Pure: storage and the change callback are injected (tests pass fakes).

export const MAX_WAYPOINTS = 12;
export const LETTERS = 'ABCDEFGHIJKL';
export const MAX_NAME = 32;

/** Rotating pin palette, taken from the tokens in css/base.css. */
export const WAYPOINT_COLORS = [
  '#C98A50', // --amber
  '#627F9A', // --sky
  '#A8553F', // --danger (rust)
  '#8E6BA8', // --rarity-3 (heather)
  '#4A7459', // --forest-soft
  '#D0973F', // --rarity-4 (gold)
];

export function storageKey(seed) { return `wildcall.waypoints.${seed}`; }

/** First letter not used by any current waypoint ('' when all twelve are taken). */
export function nextLetter(list) {
  const used = new Set((list || []).map((w) => w.letter));
  for (const l of LETTERS) if (!used.has(l)) return l;
  return '';
}

/** The palette colour used by the fewest waypoints (earliest in the palette on a tie). */
export function pickColor(list) {
  const count = new Map(WAYPOINT_COLORS.map((c) => [c, 0]));
  for (const w of list || []) if (count.has(w.color)) count.set(w.color, count.get(w.color) + 1);
  let best = WAYPOINT_COLORS[0];
  for (const c of WAYPOINT_COLORS) if (count.get(c) < count.get(best)) best = c;
  return best;
}

export function defaultName(letter) { return `Waypoint ${letter}`; }

/** Trimmed, single-line, at most MAX_NAME characters; '' when nothing is left. */
export function cleanName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

const isColor = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

/** Validate stored data: drops malformed entries, duplicate letters and anything past the limit. */
export function sanitize(raw) {
  const src = Array.isArray(raw) ? raw : Array.isArray(raw?.list) ? raw.list : [];
  const out = [];
  const ids = new Set();
  for (const w of src) {
    if (out.length >= MAX_WAYPOINTS) break;
    if (!w || typeof w.id !== 'string' || ids.has(w.id)) continue;
    const x = Number(w.x), z = Number(w.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    let letter = typeof w.letter === 'string' && LETTERS.includes(w.letter) && w.letter.length === 1 ? w.letter : '';
    if (!letter || out.some((o) => o.letter === letter)) letter = nextLetter(out);
    if (!letter) break;
    ids.add(w.id);
    out.push({ id: w.id, x, z, letter, name: cleanName(w.name) || defaultName(letter), color: isColor(w.color) ? w.color : pickColor(out) });
  }
  return out;
}

/**
 * createWaypointStore({ storage, onChange }) — storage is a localStorage-like object (or
 * null); onChange(list, selectedId) runs after every change. Call bind(seed) on welcome.
 */
export function createWaypointStore({ storage = null, onChange = () => {} } = {}) {
  let key = null;
  let items = [];
  let seq = 1;
  let selected = null;

  const copy = (w) => ({ ...w });
  function persist() {
    if (!key || !storage) return;
    try { storage.setItem(key, JSON.stringify({ v: 1, seq, list: items })); } catch { /* full or blocked: keep in memory */ }
  }
  function changed() {
    if (selected && !items.some((w) => w.id === selected)) selected = null;
    persist();
    try { onChange(store.list(), selected); } catch { /* a listener must not break the store */ }
  }

  const store = {
    /** Load the waypoints of a world (the welcome's world seed). */
    bind(seed) {
      key = storageKey(seed);
      items = []; seq = 1; selected = null;
      if (storage) {
        try {
          const raw = JSON.parse(storage.getItem(key) || 'null');
          items = sanitize(raw);
          seq = Math.max(Number(raw?.seq) || 1, 1);
          for (const w of items) { const n = Number(/^wp(\d+)$/.exec(w.id)?.[1]); if (n >= seq) seq = n + 1; }
        } catch { items = []; }
      }
      try { onChange(store.list(), selected); } catch { /* ignore */ }
    },
    /**
     * Drop the stored waypoints of a world seed (a NEW adventure on a seed played before must
     * not inherit the old save's pins). Clears the live list too when it is that world's.
     */
    forget(seed) {
      const k = storageKey(seed);
      try { storage?.removeItem(k); } catch { /* blocked: nothing stored anyway */ }
      if (k === key && items.length) { items = []; selected = null; try { onChange(store.list(), selected); } catch { /* ignore */ } }
    },
    get key() { return key; },
    get size() { return items.length; },
    get full() { return items.length >= MAX_WAYPOINTS; },
    list() { return items.map(copy); },
    get(id) { const w = items.find((x) => x.id === id); return w ? copy(w) : null; },
    /** Add a waypoint; returns it, or null when all MAX_WAYPOINTS are in use or x/z are bad. */
    add({ x, z, name, color } = {}) {
      if (items.length >= MAX_WAYPOINTS || !Number.isFinite(x) || !Number.isFinite(z)) return null;
      const letter = nextLetter(items);
      if (!letter) return null;
      const w = { id: 'wp' + seq++, x, z, letter, name: cleanName(name) || defaultName(letter), color: isColor(color) ? color : pickColor(items) };
      items.push(w);
      changed();
      return copy(w);
    },
    remove(id) {
      const n = items.length;
      items = items.filter((w) => w.id !== id);
      if (items.length !== n) changed();
      return items.length !== n;
    },
    /** Rename; an empty name restores the default "Waypoint X". */
    rename(id, name) {
      const w = items.find((x) => x.id === id);
      if (!w) return false;
      const next = cleanName(name) || defaultName(w.letter);
      if (next === w.name) return true;
      w.name = next;
      changed();
      return true;
    },
    recolor(id, color) {
      const w = items.find((x) => x.id === id);
      if (!w || !isColor(color) || w.color === color) return !!w;
      w.color = color;
      changed();
      return true;
    },
    clear() { if (!items.length) return; items = []; changed(); },
    /** Nearest waypoint within r metres of (x, z), or null. */
    nearest(x, z, r = Infinity) {
      let best = null, bd = r;
      for (const w of items) {
        const d = Math.hypot(w.x - x, w.z - z);
        if (d <= bd) { bd = d; best = w; }
      }
      return best ? copy(best) : null;
    },
    get selectedId() { return selected; },
    select(id) {
      const next = id && items.some((w) => w.id === id) ? id : null;
      if (next === selected) return;
      selected = next;
      try { onChange(store.list(), selected); } catch { /* ignore */ }
    },
  };
  return store;
}
