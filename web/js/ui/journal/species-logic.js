// Pure derivation for the species section of the Field Journal: which species appear in
// the grid and in what state, the discovery ladder, knowledge-gated depth, the player's
// own activity chart, evidence lists. Never reveals anything about a species the player
// has not identified: unidentified cards carry NO name, rarity or colour data.

import { PHASE_NAMES, capital } from './format.js';
import { SITE_WORDS } from '../../nests/sites.js';

export const LEVELS = { UNKNOWN: 1, HEARD: 2, ENCOUNTERED: 3, IDENTIFIED: 4, DOCUMENTED: 5, STUDIED: 6 };
export const DEFAULT_LEVEL_NAMES = ['', 'Unknown', 'Heard', 'Encountered', 'Identified', 'Documented', 'Studied'];

/** What the player has to do to reach each level (shown on the status ladder). */
export const LEVEL_HINTS = {
  2: 'Hear its call out in the field.',
  3: 'See it with your own eyes, or through binoculars.',
  4: 'Gather evidence and name it in the identification screen.',
  5: 'Photograph it, record its call, or write down an observation.',
  6: 'Study it at the research desk in your cabin.',
};

/** Order evidence keys are listed in (matches core.EvidenceKeys). */
export const EVIDENCE_ORDER = ['size', 'shape', 'primary', 'secondary', 'marking', 'bill', 'flight', 'behavior', 'pitch', 'pattern', 'habitat'];
export const EVIDENCE_LABELS = {
  size: 'Size', shape: 'Shape', primary: 'Main colour', secondary: 'Other colour', marking: 'Field mark', bill: 'Bill',
  flight: 'Flight', behavior: 'Behaviour', pitch: 'Pitch', pattern: 'Song pattern', habitat: 'Habitat',
};

export const METHOD_LABELS = { sight: 'by sight', sound: 'by sound', photo: 'from a photo', mixed: 'by sight and sound' };

/** A neutral, completely generic bird used to draw silhouettes for mysteries ("?"). */
export const GENERIC_BIRD = {
  id: '', name: '', look: {
    length: 0.16, wingspan: 0.24, plump: 1, neck: 0.2, legs: 0.3, tail: 0.7, tailShape: 'square', bill: 1, billShape: 'cone',
    crest: false, wingShape: 'rounded', marks: [],
    colors: { back: '#6b5d4f', belly: '#6b5d4f', head: '#6b5d4f', wing: '#6b5d4f', tail: '#6b5d4f', bill: '#4a3f35', legs: '#4a3f35', eye: '#2a221b' },
  },
};

/** Is the player allowed to see this species in their field guide at all? */
export function isUnlockedSpecies(sp, regionIds) {
  const set = new Set(regionIds || []);
  return (sp.regions || []).some((r) => set.has(r));
}

/**
 * Grid cards for every species of the player's unlocked regions (plus any species the
 * player has identified elsewhere), in catalog order.
 * Identified cards expose the species; unknown cards expose only the catalog index.
 */
export function speciesCards(species, profile) {
  const known = profile?.journal?.species || {};
  const regions = profile?.regions || [];
  const cards = [];
  for (const sp of species || []) {
    const entry = known[sp.id];
    if (!entry && !isUnlockedSpecies(sp, regions)) continue;
    if (entry) cards.push({ key: sp.id, index: sp.index, known: true, sp, entry, level: entry.level || LEVELS.IDENTIFIED, probable: !!entry.probable });
    else cards.push({ key: `?${sp.index}`, index: sp.index, known: false, sp: null, entry: null, level: LEVELS.UNKNOWN, probable: false });
  }
  cards.sort((a, b) => a.index - b.index);
  return cards;
}

/** Filter cards: 'all' | 'known' | 'unknown'. */
export function filterCards(cards, mode) {
  if (mode === 'known') return cards.filter((c) => c.known);
  if (mode === 'unknown') return cards.filter((c) => !c.known);
  return cards;
}

export function progressCounts(cards) {
  const known = cards.filter((c) => c.known).length;
  const documented = cards.filter((c) => c.known && c.level >= LEVELS.DOCUMENTED).length;
  return { known, total: cards.length, documented };
}

/** The six-step discovery ladder for an identified species entry. */
export function discoveryLadder(entry, names = DEFAULT_LEVEL_NAMES) {
  const level = entry?.level || LEVELS.IDENTIFIED;
  const steps = [];
  for (let l = 2; l <= 6; l++) {
    steps.push({
      level: l,
      name: names[l] || DEFAULT_LEVEL_NAMES[l],
      state: l <= level ? (l === level ? 'current' : 'done') : 'todo',
      hint: LEVEL_HINTS[l],
    });
  }
  return steps;
}

/** One sentence on what unlocks the next level, or the closing line at "Studied". */
export function nextStepText(entry, names = DEFAULT_LEVEL_NAMES) {
  const level = entry?.level || LEVELS.IDENTIFIED;
  if (level >= LEVELS.STUDIED) return 'Fully studied. You know this bird well.';
  const next = level + 1;
  let text = `Next: ${names[next] || DEFAULT_LEVEL_NAMES[next]}. ${LEVEL_HINTS[next]}`;
  if (next === LEVELS.STUDIED && entry) text += ` Research ${Math.max(0, Math.min(100, entry.study || 0))}/100.`;
  if (entry?.probable) text = 'Probable identification: gather a little more evidence, or a decent photo or recording, to confirm it.';
  return text;
}

/**
 * Which blocks of species depth the player's Knowledge stats unlock.
 * journalInfo: facts; habitatKnow: habitats & perches; seasonKnow: seasons & daily curve;
 * ecoKnow: relations. Description, ID tips and the player's own record are always shown.
 */
export function infoGates(stats) {
  const s = stats || {};
  return {
    fact: (s.journalInfo || 0) >= 1,
    habitats: (s.habitatKnow || 0) >= 1,
    seasons: (s.seasonKnow || 0) >= 1,
    relations: (s.ecoKnow || 0) >= 1,
    similar: (s.journalInfo || 0) >= 2,
    // Field Experience rank 3: how hard the bird is to find, and how and when it nests.
    depth: (s.journalInfo || 0) >= 3,
  };
}

const DIFFICULTY_WORDS = ['', 'Easy to find', 'Usually found with a little patience', 'Takes some searching', 'Hard to find', 'Very elusive'];

/** {value 1..5, word} for Species.difficulty, or null when the catalog has none. */
export function difficultyInfo(sp) {
  const d = Math.round(Number(sp?.difficulty) || 0);
  if (d < 1) return null;
  const v = Math.min(5, d);
  return { value: v, max: 5, word: DIFFICULTY_WORDS[v] };
}

const SEASON_WORDS = ['spring', 'summer', 'autumn', 'winter'];

/** "spring and summer" / "spring, summer and autumn" / "all year". */
export function seasonList(flags) {
  const on = SEASON_WORDS.filter((_, i) => flags?.[i]);
  if (on.length === 4) return 'all year';
  if (!on.length) return '';
  return on.length === 1 ? on[0] : `${on.slice(0, -1).join(', ')} and ${on[on.length - 1]}`;
}

/**
 * The nest paragraph for a species page: {site, height, season, desc} as display text,
 * or null when the species does not nest in the game (site "none" or missing).
 */
export function nestInfo(sp) {
  const n = sp?.nest;
  if (!n || !n.site || n.site === 'none') return null;
  const lo = Number(n.heightMin) || 0, hi = Number(n.heightMax) || 0;
  let height = '';
  if (hi > 0.3) height = lo > 0.3 ? `${fmtM(lo)}–${fmtM(hi)} above the ground` : `up to ${fmtM(hi)} above the ground`;
  else if (n.site !== 'burrow') height = 'on or near the ground';
  const season = seasonList(n.seasons);
  return {
    site: SITE_WORDS[n.site] || capital(n.site),
    height,
    season: season ? (season === 'all year' ? 'Nests may be active at any time of year' : `Active in ${season}`) : '',
    desc: n.desc || '',
  };
}
function fmtM(v) { return v >= 10 ? `${Math.round(v)} m` : `${Math.round(v * 10) / 10} m`; }

/**
 * Does the player have the Forgotten Field Journal? 'carried' when it is in the pack or
 * equipped, 'stored' when it waits in cabin storage, '' otherwise.
 */
export const OLD_JOURNAL = 'forgotten_journal';
export function oldJournalState(profile) {
  const has = (list) => (list || []).some((s) => s?.item === OLD_JOURNAL && (s.qty == null || s.qty > 0));
  if (has(profile?.inventory) || Object.values(profile?.equipped || {}).includes(OLD_JOURNAL)) return 'carried';
  if (has(profile?.storage)) return 'stored';
  return '';
}

/**
 * The previous naturalist's margin note on a species, shown only for species the player
 * has identified and only while the old journal is carried. Returns the text or ''.
 */
export function marginNote(marginNotes, profile, speciesId) {
  if (!speciesId || !profile?.journal?.species?.[speciesId]) return '';
  if (oldJournalState(profile) !== 'carried') return '';
  const t = marginNotes?.[speciesId];
  return typeof t === 'string' ? t.trim() : '';
}

/** The player's own encounters per day phase as normalised bars. */
export function activityBars(phases) {
  const vals = PHASE_NAMES.map((_, i) => Math.max(0, Number(phases?.[i]) || 0));
  const max = Math.max(...vals, 0);
  return { total: vals.reduce((a, b) => a + b, 0), bars: vals.map((v, i) => ({ name: PHASE_NAMES[i], value: v, frac: max > 0 ? v / max : 0 })) };
}

/** The species' typical activity curve per phase (Behavior.Activity), as 0..1 fractions. */
export function expectedActivity(sp) {
  const a = sp?.behavior?.activity || [];
  return PHASE_NAMES.map((name, i) => ({ name, frac: Math.max(0, Math.min(1, Number(a[i]) || 0)) }));
}

/** Evidence map -> ordered [{key, label, value}] rows. */
export function evidenceRows(evidence) {
  const rows = [];
  for (const key of EVIDENCE_ORDER) {
    const v = evidence?.[key];
    if (v) rows.push({ key, label: EVIDENCE_LABELS[key], value: capital(v) });
  }
  for (const [key, v] of Object.entries(evidence || {})) {
    if (v && !EVIDENCE_ORDER.includes(key)) rows.push({ key, label: capital(key), value: capital(v) });
  }
  return rows;
}

/** Mystery cards ("Unknown bird A"), newest evidence first is not needed: keep the server order. */
export function mysteryCards(profile, names = DEFAULT_LEVEL_NAMES) {
  return (profile?.journal?.mysteries || []).map((m) => ({
    id: m.id,
    label: m.label || 'Unknown bird',
    level: m.level,
    levelName: names[m.level] || DEFAULT_LEVEL_NAMES[m.level] || 'Unknown',
    rows: evidenceRows(m.evidence),
    heard: m.heard || 0,
    seen: m.seen || 0,
    photos: (m.photos || []).length,
    recs: (m.recs || []).length,
    wrong: m.wrong || [],
    canIdentify: evidenceRows(m.evidence).length >= 2,
    mystery: m,
  }));
}

export function photosOfSpecies(profile, id) {
  return (profile?.journal?.photos || []).filter((p) => (p.subjects || []).some((s) => s.species === id));
}
export function photosOfMystery(profile, id) {
  return (profile?.journal?.photos || []).filter((p) => (p.subjects || []).some((s) => s.mystery === id));
}
export function recordingsOfSpecies(profile, id) {
  return (profile?.journal?.recordings || []).filter((r) => r.species === id);
}
export function recordingsOfMystery(profile, id) {
  return (profile?.journal?.recordings || []).filter((r) => !r.species && r.mystery === id);
}
export function observationsOfSpecies(profile, id) {
  return (profile?.journal?.observations || []).filter((o) => o.species === id);
}

/** Similar species the player has identified (clickable) and how many they have not. */
export function similarSpecies(sp, speciesById, profile) {
  const known = profile?.journal?.species || {};
  const shown = [];
  let hidden = 0;
  for (const id of sp?.similar || []) {
    if (known[id] && speciesById[id]) shown.push(speciesById[id]); else hidden++;
  }
  return { shown, hidden };
}

/** Habitat weights as sorted [{key, label, frac}] with frac relative to the largest. */
export function habitatList(sp) {
  const hs = [...(sp?.habitats || [])].sort((a, b) => b.weight - a.weight);
  const max = hs.length ? hs[0].weight || 1 : 1;
  return hs.map((h) => ({ key: h.habitat, label: capital(h.habitat), frac: Math.max(0.08, (h.weight || 0) / max) }));
}

/** Study progress 0..100 clamped. */
export function studyPercent(entry) { return Math.max(0, Math.min(100, Math.round(entry?.study || 0))); }
