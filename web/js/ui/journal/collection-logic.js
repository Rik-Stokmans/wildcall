// Pure derivation for the Collectibles screen: sets, found / missing slots, progress.

import { pageNumber } from './journal-logic.js';

const KIND_ORDER = ['feather', 'page', 'relic', 'badge'];

export function kindOrder(kind) { const i = KIND_ORDER.indexOf(kind); return i < 0 ? KIND_ORDER.length : i; }

/**
 * Group collectible definitions into sets (by their `set` field) and mark each found or
 * missing. `found` is Journal.collectibles (id -> day); badges may also be listed in
 * `badges` (ids) without a day.
 * Returns {sets:[{name, kind, items:[{def, found, day}], found, total}], found, total}.
 */
export function collectionSets(defs, found, badges = []) {
  const map = new Map();
  const badgeSet = new Set(badges || []);
  for (const def of defs || []) {
    const name = def.set || 'Other';
    if (!map.has(name)) map.set(name, { name, kind: def.kind, items: [] });
    const day = found?.[def.id];
    const isFound = day != null || badgeSet.has(def.id);
    map.get(name).items.push({ def, found: isFound, day: day ?? 0 });
  }
  const sets = [...map.values()];
  for (const s of sets) {
    s.items.sort((a, b) => (s.kind === 'page' ? pageNumber(a.def.id) - pageNumber(b.def.id) : 0) || a.def.name.localeCompare(b.def.name));
    s.found = s.items.filter((i) => i.found).length;
    s.total = s.items.length;
  }
  sets.sort((a, b) => (kindOrder(a.kind) - kindOrder(b.kind)) || a.name.localeCompare(b.name));
  return { sets, found: sets.reduce((a, s) => a + s.found, 0), total: sets.reduce((a, s) => a + s.total, 0) };
}

/** Rounded percentage, 0 for an empty set. */
export function percent(found, total) { return total > 0 ? Math.round((found / total) * 100) : 0; }

/** Group a list of sets for the side list: the feather sets merge visually under one heading. */
export function setIcon(kind) {
  return { feather: 'feather', page: 'page', relic: 'relic', badge: 'badge' }[kind] || 'star';
}
