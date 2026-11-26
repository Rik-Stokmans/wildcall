// Pure derivation for the non-species journal sections: photos, recordings, locations,
// natural history, rare discoveries.

import { dist2, headingTo, compassName, formatDistance } from './format.js';

export const PHOTO_SUBSCORES = [
  { key: 'focus', label: 'Focus' },
  { key: 'composition', label: 'Composition' },
  { key: 'distance', label: 'Distance' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'visibility', label: 'Visibility' },
];

/**
 * Photos newest first, filtered by subject and minimum stars.
 * subject: 'all' | 'unknown' (an unidentified bird) | 'none' (no bird in frame) | a species id.
 */
export function filterPhotos(photos, { subject = 'all', minStars = 0 } = {}) {
  const out = (photos || []).filter((p) => {
    if ((p.stars || 0) < minStars) return false;
    const subs = p.subjects || [];
    if (subject === 'all') return true;
    if (subject === 'none') return subs.length === 0;
    if (subject === 'unknown') return subs.some((s) => !s.species);
    return subs.some((s) => s.species === subject);
  });
  return out.slice().reverse();
}

/** Species ids that appear as identified subjects in the photo set (for the filter menu). */
export function photoSubjectIds(photos) {
  const ids = new Set();
  for (const p of photos || []) for (const s of p.subjects || []) if (s.species) ids.add(s.species);
  return [...ids];
}

/**
 * What a photo's subject is called. Identified species use their name; anything else is the
 * mystery's label or plain "Unknown bird" — a name is NEVER derived for an unidentified bird.
 */
export function subjectLabel(subject, speciesById, mysteries) {
  if (subject?.species && speciesById[subject.species]) return speciesById[subject.species].name;
  const m = (mysteries || []).find((x) => x.id === subject?.mystery);
  return m?.label || 'Unknown bird';
}

/** Recording display info; the species is only named when the entry carries one. */
export function recordingInfo(rec, speciesById, mysteries) {
  let who;
  if (rec.species && speciesById[rec.species]) who = speciesById[rec.species].name;
  else if (rec.species) who = 'Unknown bird';
  else who = (mysteries || []).find((m) => m.id === rec.mystery)?.label || 'Unknown bird';
  return { who, named: !!rec.species && !!speciesById[rec.species] };
}

export function recordingsNewestFirst(recs) { return (recs || []).slice().reverse(); }

/** Quality words for a recording's 0..100 quality. */
export function qualityWord(q) {
  if (q >= 85) return 'Excellent';
  if (q >= 65) return 'Good';
  if (q >= 40) return 'Fair';
  return 'Faint';
}

/** Rows for a noise reading 0..1. */
export function noiseWord(n) { return n < 0.25 ? 'Quiet' : n < 0.55 ? 'Some background noise' : 'Noisy'; }

/**
 * Discovered locations grouped by region type, each with distance/bearing from home.
 * Returns [{region, items:[{id, loc, distance, bearing, text}]}] ordered by region id,
 * items by day found then name.
 */
export function groupLocations(locations, home) {
  const groups = new Map();
  for (const [id, loc] of Object.entries(locations || {})) {
    const r = loc.region ?? 255;
    const d = dist2(home.x, home.z, loc.pos?.x || 0, loc.pos?.z || 0);
    const bearing = compassName(headingTo(home.x, home.z, loc.pos?.x || 0, loc.pos?.z || 0));
    const item = { id, loc, distance: d, bearing, text: d < 12 ? 'at home' : `${formatDistance(d)} ${bearing} of home` };
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(item);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([region, items]) => ({
    region,
    items: items.sort((a, b) => (a.loc.day - b.loc.day) || a.loc.name.localeCompare(b.loc.name)),
  }));
}

/** POI kinds that are places to find (as opposed to people and pick-ups). */
const PLACE_KINDS = new Set(['ranger_station', 'watchtower', 'shop', 'research_site', 'abandoned_station', 'hidden_cabin', 'camp', 'viewpoint', 'hide', 'landmark', 'pond']);

/**
 * How many home-valley places the player has not found yet. Names are never exposed:
 * the journal only says "? more to find nearby".
 */
export function undiscoveredNearHome(pois, locations, home, radius) {
  let n = 0;
  for (const p of pois || []) {
    if (!PLACE_KINDS.has(p.kind)) continue;
    if (dist2(home.x, home.z, p.pos.x, p.pos.z) > radius) continue;
    if (locations && locations[p.id]) continue;
    n++;
  }
  return n;
}

export function locationStats(groups) {
  let total = 0, far = 0;
  for (const g of groups) for (const it of g.items) { total++; far = Math.max(far, it.distance); }
  return { total, regions: groups.length, farthest: far };
}

export const LORE_CATEGORIES = [
  { id: 'ecology', label: 'Ecology' },
  { id: 'history', label: 'History' },
  { id: 'fieldcraft', label: 'Fieldcraft' },
  { id: 'species', label: 'Species lore' },
];

/** Unlocked lore grouped by category (known categories first); the number still to find. */
export function groupLore(loreDefs, unlockedIds) {
  const have = new Set(unlockedIds || []);
  const byCat = new Map();
  let locked = 0;
  for (const def of loreDefs || []) {
    if (!have.has(def.id)) { locked++; continue; }
    if (!byCat.has(def.category)) byCat.set(def.category, []);
    byCat.get(def.category).push(def);
  }
  const groups = [];
  for (const c of LORE_CATEGORIES) if (byCat.has(c.id)) groups.push({ id: c.id, label: c.label, entries: byCat.get(c.id) });
  for (const [id, entries] of byCat) if (!LORE_CATEGORIES.some((c) => c.id === id)) groups.push({ id, label: id, entries });
  return { groups, locked };
}

/** Index of a page collectible (page_3 -> 3); order by it. */
export function pageNumber(id) { const m = /(\d+)$/.exec(id); return m ? Number(m[1]) : 0; }

/**
 * The Forgotten Field Journal: pages in order, each flagged found or missing. Missing pages
 * expose only their number — no text.
 */
export function diaryPages(collectibleDefs, found) {
  return (collectibleDefs || []).filter((c) => c.kind === 'page')
    .sort((a, b) => pageNumber(a.id) - pageNumber(b.id))
    .map((def, i) => ({ number: i + 1, def, found: found?.[def.id] != null, day: found?.[def.id] }));
}

/** Rare discoveries newest first. */
export function rareNewestFirst(rare) { return (rare || []).slice().reverse(); }

export const RARE_KIND_LABELS = {
  rare_species: 'Rare species', unusual_plumage: 'Unusual plumage', out_of_range: 'Out of range', behavior: 'Rare behaviour',
  exceptional_photo: 'Exceptional photograph', migration: 'Migration', hidden_habitat: 'Hidden habitat', relic: 'Relic',
};
export const RARE_KIND_ICONS = {
  rare_species: 'bird', unusual_plumage: 'feather', out_of_range: 'compass', behavior: 'eye',
  exceptional_photo: 'camera', migration: 'wind', hidden_habitat: 'leaf', relic: 'relic',
};

/** Icon (kit vocabulary) and label per POI kind; shared by the journal and the map. */
export const POI_KIND_ICONS = {
  cabin: 'cabin', ranger_station: 'station', watchtower: 'tower', shop: 'shop', research_site: 'desk', abandoned_station: 'station',
  hidden_cabin: 'cabin', camp: 'camp', viewpoint: 'viewpoint', hide: 'hide', landmark: 'landmark', pond: 'pond', npc: 'npc',
  feather: 'feather', page: 'page', relic: 'relic', cache: 'cache', sign: 'info',
};
export const POI_KIND_LABELS = {
  cabin: 'Cabin', ranger_station: 'Ranger station', watchtower: 'Watchtower', shop: 'Shop', research_site: 'Research site',
  abandoned_station: 'Abandoned station', hidden_cabin: 'Hidden cabin', camp: 'Camp', viewpoint: 'Viewpoint', hide: 'Bird hide',
  landmark: 'Landmark', pond: 'Pond', npc: 'Person', feather: 'Feather', page: 'Journal page', relic: 'Relic', cache: 'Cache', sign: 'Signpost',
};
export function poiIcon(kind) { return POI_KIND_ICONS[kind] || 'landmark'; }
export function poiKindLabel(kind) { return POI_KIND_LABELS[kind] || kind; }
