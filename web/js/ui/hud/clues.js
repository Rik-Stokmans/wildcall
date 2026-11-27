// Pure clue logic: store, fading, distance bands and the lines of a clue card.
// A clue never names a species unless clue.known is set (server rule); the card
// builder additionally only uses names the caller resolves from that field.
import { layerText, clueElevAngle } from '../soundring/ring-math.js';

/** "about 30-45 m". Returns '' when the distance is unknown (0,0). */
export function distanceBand(min, max) {
  const lo0 = Number(min) || 0, hi0 = Number(max) || 0;
  if (hi0 <= 0 && lo0 <= 0) return '';
  const r5 = (v) => (v < 10 ? Math.round(v) : Math.round(v / 5) * 5);
  const lo = r5(Math.min(lo0, hi0)), hi = r5(Math.max(lo0, hi0));
  if (lo === hi) return `about ${hi} m`;
  if (lo <= 0) return `within ${hi} m`;
  // Close by, a band reads worse than one number: "about 10 m" (the middle of the band).
  if (hi <= 30) return `about ${r5((Math.min(lo0, hi0) + Math.max(lo0, hi0)) / 2)} m`;
  return `about ${lo}–${hi} m`;
}

const ELEVATION_WORDS = { above: 'from above', level: 'at eye level', below: 'from below' };
const DEG = Math.PI / 180;
/** Above / below the ear in words: the engine's numeric angle when it sends one
 *  (elevAngle, radians, + up), else its above|level|below word. */
export function elevationText(e, angle) {
  const a = typeof angle === 'number' && Number.isFinite(angle) ? angle : null;
  if (a == null) return ELEVATION_WORDS[e] || '';
  const m = Math.abs(a);
  if (m < 6 * DEG) return 'at eye level';
  if (a > 0) return m < 20 * DEG ? 'a little above you' : m < 45 * DEG ? 'above you' : 'high above you';
  return m < 20 * DEG ? 'a little below you' : m < 45 * DEG ? 'below you' : 'right below you';
}

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
  // [soundring] where to look: the layer ("low, near the ground") once the engine sends
  // it (clue.layer, or Habitat Reading's perch hint), else above / level / below.
  const layer = layerText(clue);
  add('layer', cap(layer));
  if (!layer || !/(low|high|head|branches|canopy)/.test(layer)) {
    add('elev', elevationText(clue.elevation, clueElevAngle(clue)));
  }
  add('pitch', clue.pitch ? `${cap(clue.pitch)} pitch` : '');
  add('pattern', cap(clue.pattern));
  add('habitat', cap(clue.habitat));
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
 * Which clue cards the panel shows (spec §29.1: subtle). The server may send more live
 * sources than are worth a card; the rest fold into one quiet "+2 more sounds" line.
 *
 * @param live    ClueStore.list() entries ({id, clue, born}), strongest first
 * @param opts    { max = 2, quarry: Set|array of mystery ids a quest is about,
 *                  tutorial: bool (the first quest is under way) }
 * Order: the quest's quarry first, then sounds the player has never heard, then the
 * newest, then the loudest. During the tutorial only the quarry plus one other card is
 * shown (one card in all while the quarry is still unknown), so a beginner is never
 * handed a wall of cards.
 * @returns {{shown: object[], hidden: number}}
 */
export function selectClueCards(live, opts = {}) {
  const list = Array.isArray(live) ? live.filter(Boolean) : [];
  const quarry = new Set(opts.quarry || []);
  const isQuarry = (e) => !!(e.clue?.mystery && quarry.has(e.clue.mystery));
  const rank = (e) => (isQuarry(e) ? 0 : e.clue?.new ? 1 : 2);
  const sorted = list.slice().sort((a, b) => (rank(a) - rank(b))
    || ((b.born || 0) - (a.born || 0))
    || ((b.clue?.strength || 0) - (a.clue?.strength || 0))
    || (a.id - b.id));
  let max = Math.max(1, (opts.max ?? 2) | 0);
  if (opts.tutorial) max = Math.min(max, sorted.some(isQuarry) ? 2 : 1);
  const shown = sorted.slice(0, max);
  return { shown, hidden: Math.max(0, sorted.length - shown.length) };
}

/**
 * "One at a time" (the default): the single card of the voice being followed (the id the
 * sound ring's follower gives; see soundring/follow.js), every other live voice folded
 * into the count. Without a followed id (no sound ring) it falls back to the first card
 * selectClueCards would show.
 *
 * @param live     ClueStore.all() entries, strongest first (may include the followed
 *                 voice held past its expiry)
 * @param followId the followed clue id, or 0
 * @param opts     { now, quarry, tutorial } (now: to count only voices still sounding)
 * @returns {{shown: object[], hidden: number, fresh: boolean}} fresh = one of the folded
 *          voices is one the player has never heard before
 */
export function oneClueCard(live, followId, opts = {}) {
  const list = Array.isArray(live) ? live.filter(Boolean) : [];
  let pick = followId ? list.find((e) => e.id === followId) : null;
  if (!pick) pick = selectClueCards(list, { max: 1, quarry: opts.quarry, tutorial: opts.tutorial }).shown[0] || null;
  const now = opts.now;
  let hidden = 0, fresh = false;
  for (const e of list) {
    if (e === pick) continue;
    if (now != null && e.expires <= now) continue;
    hidden++;
    if (e.clue?.new && !e.clue?.known) fresh = true;
  }
  return { shown: pick ? [pick] : [], hidden, fresh };
}

/** "+1 more sound" / "+3 more sounds", or '' for none. */
export function moreSoundsText(n) {
  n = n | 0;
  if (n <= 0) return '';
  return `+${n} more sound${n === 1 ? '' : 's'}`;
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
    const entry = { clue, id: clue.id, born: prev ? prev.born : now, heard: now, expires: now + ttl, ttl };
    this.map.set(clue.id, entry);
    return { entry, isNew: !prev };
  }

  /** Drop expired clues; returns the removed ids. `holdId` (the voice being followed)
   *  is kept past its expiry: its card stays through the silence between calls. */
  prune(now, holdId = 0) {
    const gone = [];
    for (const [id, e] of this.map) if (e.expires <= now && id !== holdId) { this.map.delete(id); gone.push(id); }
    return gone;
  }

  get(id) { return this.map.get(id) || null; }

  /** Opacity 0..1: full until the last `fade` seconds, then linear fade-out. */
  alpha(entry, now) {
    const left = entry.expires - now;
    if (left <= 0) return 0;
    const f = Math.min(this.fade, entry.ttl);
    return left >= f ? 1 : left / f;
  }

  /** Every live clue, strongest first (no slot cap): the panel folds the extras.
   *  `holdId` is included even when it has expired. */
  all(now, holdId = 0) {
    const live = [...this.map.values()].filter((e) => e.expires > now || (holdId && e.id === holdId));
    live.sort((a, b) => (b.clue.strength - a.clue.strength) || (a.id - b.id));
    return live;
  }

  /** Live clues, strongest first, capped to the slot count. */
  list(now) {
    const live = [...this.map.values()].filter((e) => e.expires > now);
    live.sort((a, b) => (b.clue.strength - a.clue.strength) || (a.id - b.id));
    return live.slice(0, this.cap);
  }

  clear() { this.map.clear(); }
}
