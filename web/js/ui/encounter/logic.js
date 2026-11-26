// Pure logic for the identification / dialogue screens. No DOM, no three.js: everything
// here is covered by logic.test.js (node --test).
//
// Wire vocabulary: evidence keys and trait words come from core.Species / core.EvidenceKeys
// (internal/core/species.go); Mystery / Candidate / DialogNode from internal/proto.

/** Every evidence key in core display order (core.EvidenceKeys). */
export const EVIDENCE_KEYS = ['size', 'shape', 'primary', 'secondary', 'marking', 'bill', 'flight', 'behavior', 'pitch', 'pattern', 'habitat'];
/** The evidence keys birdIllustration understands for its `reveal` option. */
export const SKETCH_KEYS = ['size', 'shape', 'primary', 'secondary', 'marking', 'bill'];
export const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge'];
/** Server rule (docs/contract.md §3.6): >= 70 % confidence in the right species is "certain". */
export const CERTAIN_CONFIDENCE = 70;

const lower = (v) => String(v ?? '').trim().toLowerCase();
const nice = (v) => lower(v).replace(/_/g, ' ');

/* ------------------------------------------------------------------ habitats */

// core.Habitat keys and labels (internal/core/types.go) -> how to phrase them.
const HABITATS = {
  ocean: { label: 'Open sea', noun: 'open sea', phrase: 'over open water' },
  beach: { label: 'Shoreline', noun: 'shoreline', phrase: 'on the shoreline' },
  meadow: { label: 'Open meadow', noun: 'open meadow', phrase: 'in open meadow' },
  woodland: { label: 'Woodland canopy', noun: 'woodland', phrase: 'in woodland' },
  conifer: { label: 'Pine forest', noun: 'pine forest', phrase: 'in pine forest' },
  marsh: { label: 'Reedbed', noun: 'reedbed', phrase: 'in the reeds' },
  river: { label: 'Riverside', noun: 'riverside', phrase: 'beside the water' },
  alpine: { label: 'Mountain slope', noun: 'mountain slope', phrase: 'on a mountain slope' },
  cliff: { label: 'Cliff face', noun: 'cliff face', phrase: 'on a cliff face' },
  snow: { label: 'Snowfield', noun: 'snowfield', phrase: 'on the snow' },
  shrub: { label: 'Dense shrubs', noun: 'dense shrubs', phrase: 'in dense shrubs' },
};

/** Resolve a habitat key OR a player-facing label ("Dense shrubs") to its key, or ''. */
export function habitatKey(value) {
  const v = lower(value);
  if (!v) return '';
  if (HABITATS[v]) return v;
  for (const [k, h] of Object.entries(HABITATS)) if (lower(h.label) === v) return k;
  return '';
}
export function habitatNoun(value) {
  const k = habitatKey(value);
  return k ? HABITATS[k].noun : nice(value);
}
export function habitatPhrase(value) {
  const k = habitatKey(value);
  return k ? HABITATS[k].phrase : 'in ' + nice(value);
}

/* ------------------------------------------------------------ evidence rows */

const SPEC = {
  size: { label: 'Size', hint: 'Compare it with a branch or leaf near it.' },
  shape: { label: 'Shape', hint: 'Needs a clear look at its outline.', fmt: (v) => `${nice(v)}-like` },
  primary: { label: 'Main colour', hint: 'Needs better light or a closer view.' },
  secondary: { label: 'Second colour', hint: 'Needs a steadier, closer view.' },
  marking: { label: 'Mark', hint: 'Look for a patch, stripe or bar.' },
  bill: { label: 'Bill', hint: 'Needs a close, clear view of its head.' },
  flight: { label: 'Flight', hint: 'Watch how it moves through the air.' },
  behavior: { label: 'Seen', hint: 'Watch what it is doing.' },
  pitch: { label: 'Call pitch', hint: 'Hold F and listen for how high it sings.' },
  pattern: { label: 'Call pattern', hint: 'Hold F and listen to its rhythm.' },
  habitat: { label: 'Habitat', hint: 'Note the kind of ground it favours.' },
};

const hasValue = (ev, k) => ev && ev[k] != null && String(ev[k]).trim() !== '';

/**
 * Build the evidence list shown on the sketch card, in core EvidenceKeys order.
 * Known evidence reads like a field note ("Size: small"); behaviour + habitat and call
 * pitch + pattern are merged into one line when both are known ("Seen: foraging in dense
 * shrubs", "Call: high, repeated"). Missing evidence yields a faint row with a hint on
 * how to gather it, so the player knows what to look for.
 * Each row: { key, keys, label, text, line, known, hint }.
 */
export function evidenceRows(evidence) {
  const ev = evidence || {};
  const rows = [];
  const skip = new Set();
  for (const key of EVIDENCE_KEYS) {
    if (skip.has(key)) continue;
    const spec = SPEC[key];
    if (key === 'behavior' && hasValue(ev, 'behavior') && hasValue(ev, 'habitat')) {
      skip.add('habitat');
      rows.push(knownRow(key, ['behavior', 'habitat'], 'Seen', `${nice(ev.behavior)} ${habitatPhrase(ev.habitat)}`));
    } else if (key === 'pitch' && hasValue(ev, 'pitch') && hasValue(ev, 'pattern')) {
      skip.add('pattern');
      rows.push(knownRow(key, ['pitch', 'pattern'], 'Call', `${nice(ev.pitch)}, ${nice(ev.pattern)}`));
    } else if (hasValue(ev, key)) {
      let text = spec.fmt ? spec.fmt(ev[key]) : nice(ev[key]);
      let label = spec.label;
      if (key === 'habitat') text = habitatNoun(ev.habitat);
      if (key === 'behavior') text = nice(ev.behavior);
      if (key === 'pitch') { label = 'Call pitch'; }
      rows.push(knownRow(key, [key], label, text));
    } else {
      rows.push({ key, keys: [key], label: spec.label, text: 'not yet observed', line: `${spec.label}: not yet observed`, known: false, hint: spec.hint });
    }
  }
  return rows;
}

function knownRow(key, keys, label, text) {
  return { key, keys, label, text, line: `${label}: ${text}`, known: true, hint: '' };
}

/** Number of distinct evidence keys the player holds (any key of EVIDENCE_KEYS). */
export function evidenceCount(evidence) {
  return EVIDENCE_KEYS.filter((k) => hasValue(evidence, k)).length;
}

/** Labels of evidence still to gather, in display order. */
export function missingEvidence(evidence) {
  return EVIDENCE_KEYS.filter((k) => !hasValue(evidence, k)).map((k) => ({ key: k, label: SPEC[k].label, hint: SPEC[k].hint }));
}

/** The subset of evidence keys the sketch can use as `reveal`. */
export function revealKeys(evidence) {
  return SKETCH_KEYS.filter((k) => hasValue(evidence, k));
}

/* ----------------------------------------------------------- colours / sketch */

const COLOUR_WORDS = {
  brown: '#8A6A4A', black: '#2E2A28', grey: '#8E918F', white: '#EEEAE0', blue: '#4F78A8', green: '#6B8F4E',
  yellow: '#E3C14A', red: '#B9473C', orange: '#D9823B', buff: '#CDAE82', pink: '#D79BA0',
};
const SIZE_LENGTH = { tiny: 0.11, small: 0.15, medium: 0.3, large: 0.55, huge: 0.9 };

/** CSS colour for a colour word ("buff" -> hex); '' for unknown words. */
export function colourWordHex(word) { return COLOUR_WORDS[lower(word)] || ''; }

export function safeHex(v, fallback = '#7A6A5B') {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}
export function hexToRgb(hex) {
  const h = safeHex(hex, '#000000');
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
export function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
/** Mix two colours: t = 0 -> a, t = 1 -> b. */
export function mixHex(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}
/** Lighten (amt > 0) or darken (amt < 0) a colour. */
export function shadeHex(hex, amt) { return amt >= 0 ? mixHex(hex, '#ffffff', amt) : mixHex(hex, '#000000', -amt); }

/** A neutral songbird used for the silhouette-ish sketch before the shape is known. */
export const NEUTRAL_LOOK = {
  length: 0.15, wingspan: 0.22, plump: 1, neck: 0.1, legs: 0.3, tail: 0.7, tailShape: 'square', bill: 1, billShape: 'cone',
  crest: false, wingShape: 'rounded',
  colors: { back: '#8A7B6A', belly: '#BFB29C', head: '#8A7B6A', wing: '#7A6B5A', tail: '#6E6052', bill: '#5A4A3A', legs: '#6A5A4A', eye: '#222222' },
  marks: [],
};

/** How many known evidence traits of `evidence` a species matches / contradicts. */
export function traitFit(sp, evidence) {
  const out = { match: 0, mismatch: 0, mismatches: [] };
  if (!sp || !evidence) return out;
  for (const key of ['size', 'shape', 'primary', 'secondary', 'marking', 'bill', 'flight', 'pitch', 'pattern', 'habitat']) {
    if (!hasValue(evidence, key)) continue;
    let ok;
    if (key === 'habitat') {
      const hk = habitatKey(evidence.habitat);
      ok = !hk || (sp.habitats || []).some((h) => h.habitat === hk);
    } else if (key === 'pitch' || key === 'pattern') {
      ok = (sp.calls || []).some((c) => lower(c[key]) === lower(evidence[key]));
    } else {
      ok = lower(traitOf(sp, key)) === lower(evidence[key]);
    }
    if (ok) out.match++; else { out.mismatch++; out.mismatches.push(key); }
  }
  return out;
}

export function traitOf(sp, key) {
  const t = sp?.traits || {};
  switch (key) {
    case 'pitch': return sp?.calls?.[0]?.pitch || '';
    case 'pattern': return sp?.calls?.[0]?.pattern || '';
    default: return t[key] || '';
  }
}

/**
 * Build a stand-in "species" for the field sketch of an unidentified bird. The server
 * never tells the client which species a mystery is, so the sketch is composed from the
 * evidence alone: the catalogue species that best fits the evidence lends its proportions,
 * and the colour/size evidence is painted over it. birdIllustration only draws the parts in
 * `reveal`, so nothing beyond what the player has observed shows. Until the shape is known
 * the neutral songbird is used and the caller draws a silhouette.
 */
export function sketchSpecies(evidence, catalog, candidates) {
  const ev = evidence || {};
  const conf = new Map((candidates || []).map((c) => [c.species, c.confidence]));
  let base = null;
  if (hasValue(ev, 'shape')) {
    let best = -Infinity;
    for (const sp of catalog || []) {
      if (lower(sp.traits?.shape) !== lower(ev.shape)) continue;
      const fit = traitFit(sp, ev);
      const score = fit.match * 3 - fit.mismatch * 4 + (conf.get(sp.id) || 0) / 100;
      if (score > best || (score === best && base && sp.id < base.id)) { best = score; base = sp; }
    }
  }
  const look = JSON.parse(JSON.stringify(base?.look || NEUTRAL_LOOK));
  const col = look.colors;
  const primary = colourWordHex(ev.primary);
  const secondary = colourWordHex(ev.secondary);
  if (primary) { col.back = primary; col.head = primary; col.wing = shadeHex(primary, -0.12); col.tail = shadeHex(primary, -0.2); }
  if (secondary) col.belly = secondary;
  if (SIZE_LENGTH[lower(ev.size)]) {
    const k = SIZE_LENGTH[lower(ev.size)] / (look.length || 0.15);
    look.length = SIZE_LENGTH[lower(ev.size)];
    look.wingspan = (look.wingspan || 0.22) * k;
  }
  return { id: '_sketch', index: -1, name: 'Unknown bird', look, traits: {}, calls: [] };
}

/* ---------------------------------------------------------------- candidates */

/**
 * Candidate table rows: live candidates by confidence (ties by name), then species the
 * player has already ruled out, struck through, with no confidence.
 * Returns [{ species, name, confidence, ruledOut }].
 */
export function orderCandidates(candidates, wrong, speciesById) {
  const byId = speciesById || {};
  const ruled = new Set(wrong || []);
  const name = (id) => byId[id]?.name || String(id).replace(/_/g, ' ');
  const seen = new Set();
  const live = [];
  for (const c of candidates || []) {
    if (!c || seen.has(c.species) || ruled.has(c.species)) continue;
    seen.add(c.species);
    live.push({ species: c.species, name: name(c.species), confidence: Math.max(0, Math.round(c.confidence || 0)), ruledOut: false });
  }
  live.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  const out = [...live];
  for (const id of ruled) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ species: id, name: name(id), confidence: 0, ruledOut: true });
  }
  return out;
}

/** 'low' | 'mid' | 'high' styling tier of a confidence percentage. */
export function confidenceTone(pct) {
  if (pct >= CERTAIN_CONFIDENCE) return 'high';
  if (pct >= 40) return 'mid';
  return 'low';
}

/** A single sentence on how sure the field notes are, for the table footer. */
export function confidenceNote(topPct, evidenceN) {
  if (evidenceN < 2) return 'Too little evidence so far to say. Watch it a little longer.';
  if (topPct >= CERTAIN_CONFIDENCE) return 'Your notes point clearly to one species.';
  if (topPct >= 40) return 'A likely front-runner, but it is not certain yet.';
  return 'Still several possibilities. More evidence will narrow them.';
}

/* --------------------------------------------------------------- field guide */

/** Species of the unlocked regions (profile.regions), by name. */
export function guideSpecies(catalog, regions) {
  const open = new Set(regions || []);
  return (catalog || [])
    .filter((sp) => !open.size || (sp.regions || []).some((r) => open.has(r)))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
}

const anyOf = (v) => v == null || v === '' || v === 'any';

/**
 * Field-guide filter. filters: { size, shape, colour, habitat, pattern, query } ('' or
 * 'any' = no constraint). colour matches the primary or secondary colour word, habitat any
 * preferred habitat, pattern any of the species' calls. opts.evidence + opts.fitOnly keeps
 * only species whose traits do not contradict the evidence in hand.
 */
export function filterSpecies(list, filters = {}, opts = {}) {
  const q = lower(filters.query);
  return (list || []).filter((sp) => {
    const t = sp.traits || {};
    if (!anyOf(filters.size) && lower(t.size) !== lower(filters.size)) return false;
    if (!anyOf(filters.shape) && lower(t.shape) !== lower(filters.shape)) return false;
    if (!anyOf(filters.colour) && lower(t.primary) !== lower(filters.colour) && lower(t.secondary) !== lower(filters.colour)) return false;
    if (!anyOf(filters.habitat) && !(sp.habitats || []).some((h) => h.habitat === filters.habitat)) return false;
    if (!anyOf(filters.pattern) && !(sp.calls || []).some((c) => lower(c.pattern) === lower(filters.pattern))) return false;
    if (q && !lower(sp.name).includes(q) && !lower(sp.family).includes(q)) return false;
    if (opts.fitOnly && traitFit(sp, opts.evidence).mismatch > 0) return false;
    return true;
  });
}

/** Distinct, ordered values for each filter dropdown, derived from a species list. */
export function filterOptions(list) {
  const set = { size: new Set(), shape: new Set(), colour: new Set(), habitat: new Set(), pattern: new Set() };
  for (const sp of list || []) {
    const t = sp.traits || {};
    if (t.size) set.size.add(lower(t.size));
    if (t.shape) set.shape.add(lower(t.shape));
    if (t.primary) set.colour.add(lower(t.primary));
    if (t.secondary) set.colour.add(lower(t.secondary));
    for (const h of sp.habitats || []) set.habitat.add(h.habitat);
    for (const c of sp.calls || []) if (c.pattern) set.pattern.add(lower(c.pattern));
  }
  const alpha = (s) => [...s].sort();
  return {
    size: [...set.size].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b)),
    shape: alpha(set.shape),
    colour: alpha(set.colour),
    habitat: alpha(set.habitat),
    pattern: alpha(set.pattern),
  };
}

/** Rows for the side-by-side comparison of two species: [{ label, a, b, same }]. */
export function compareRows(a, b) {
  if (!a || !b) return [];
  const cols = (sp) => [sp.traits?.primary, sp.traits?.secondary].filter(Boolean).join(' and ');
  const hab = (sp) => (sp.habitats || []).slice().sort((x, y) => y.weight - x.weight).slice(0, 2).map((h) => habitatNoun(h.habitat)).join(', ');
  const call = (sp) => {
    const c = sp.calls?.[0];
    return c ? [c.pitch, c.pattern].filter(Boolean).join(', ') : '';
  };
  const defs = [
    ['Family', (sp) => sp.family],
    ['Size', (sp) => sp.traits?.size],
    ['Shape', (sp) => sp.traits?.shape && `${sp.traits.shape}-like`],
    ['Colours', cols],
    ['Key mark', (sp) => sp.traits?.marking],
    ['Bill', (sp) => sp.traits?.bill],
    ['Flight', (sp) => sp.traits?.flight],
    ['Call', call],
    ['Habitat', hab],
  ];
  return defs.map(([label, get]) => {
    const av = String(get(a) || '').trim(), bv = String(get(b) || '').trim();
    return { label, a: av || 'unknown', b: bv || 'unknown', same: lower(av) === lower(bv) };
  });
}

/* -------------------------------------------------------------------- result */

/**
 * Turn an identifyResult into display content.
 * @param r  proto.IdentifyResult
 * @param ctx { speciesById, evidence }  names are only used for outcomes that name a species
 * @returns { kind, tone, title, lead, lines[], xp, added, species }
 */
export function resultView(r, ctx = {}) {
  const byId = ctx.speciesById || {};
  const nameOf = (id) => byId[id]?.name || '';
  const feedback = (r?.feedback || '').trim();
  const notes = (r?.notes || []).filter(Boolean);
  switch (r?.outcome) {
    case 'certain':
      return {
        kind: 'certain', tone: 'joy', title: "You've identified it!", lead: nameOf(r.species) || 'A new species',
        lines: [...(feedback ? [feedback] : []), ...(r.first ? ['The first of its kind in your field journal.'] : []), ...notes],
        xp: r.xp | 0, added: true, species: r.species,
      };
    case 'probable':
      return {
        kind: 'probable', tone: 'hope', title: 'Probable identification',
        lead: `${nameOf(r.species) || 'Your guess'} (${r.confidence | 0}% sure)`,
        lines: [...(feedback ? [feedback] : []),
          'Noted in your journal as probable. A clearer look, a photograph or a recording of it would confirm it.', ...notes],
        xp: r.xp | 0, added: true, species: r.species,
      };
    case 'wrong': {
      const guess = nameOf(r.guess);
      return {
        kind: 'wrong', tone: 'gentle', title: 'Not quite, and that is part of the craft',
        lead: feedback || 'Something about that guess does not fit what you have seen.',
        lines: [guess ? `${guess} is crossed off the list for this bird. Nothing is lost; look again, or try another.` : 'Look again, or try another species.', ...notes],
        xp: 0, added: false, species: '',
      };
    }
    case 'insufficient': {
      const missing = (ctx.evidence ? missingEvidence(ctx.evidence) : []).slice(0, 4);
      return {
        kind: 'insufficient', tone: 'gentle', title: 'Not enough to go on yet',
        lead: feedback || 'Gather a little more evidence before committing to a name.',
        lines: [...missing.map((m) => `${m.label}: ${m.hint}`), ...notes],
        xp: 0, added: false, species: '',
      };
    }
    default:
      return { kind: 'unknown', tone: 'gentle', title: 'Field notes updated', lead: feedback, lines: notes, xp: r?.xp | 0, added: false, species: '' };
  }
}

/* ------------------------------------------------------------ place and time */

/** Name of the discovered place nearest to `pos` within `maxDist` metres, or ''. */
export function nearestPlace(pos, locations, maxDist = 140) {
  if (!pos || !locations) return '';
  let best = '', bd = maxDist;
  for (const loc of Object.values(locations)) {
    if (!loc?.pos || !loc.name) continue;
    const d = Math.hypot((loc.pos.x || 0) - (pos.x || 0), (loc.pos.z || 0) - (pos.z || 0));
    if (d < bd) { bd = d; best = loc.name; }
  }
  return best;
}

/* ------------------------------------------------------------------ dialogue */

/** Reputation tiers (rank requirements in the spec use 60 / 150 / 300). */
export const REP_TIERS = [
  { min: 0, name: 'Stranger' }, { min: 15, name: 'Acquaintance' }, { min: 60, name: 'Trusted' },
  { min: 150, name: 'Respected' }, { min: 300, name: 'Honoured' },
];
export const FACTION_NAMES = {
  naturalists: 'Field Naturalists', outfitters: 'Outfitters', research: 'Research Society', rangers: 'Park Rangers',
};
export function factionName(id) { return FACTION_NAMES[id] || (id ? id.charAt(0).toUpperCase() + id.slice(1) : ''); }

/** { name, next, nextMin, progress 0..1 } for a reputation score. */
export function repTier(rep) {
  const r = Math.max(0, rep | 0);
  let i = 0;
  while (i + 1 < REP_TIERS.length && r >= REP_TIERS[i + 1].min) i++;
  const cur = REP_TIERS[i], nxt = REP_TIERS[i + 1];
  return {
    name: cur.name, next: nxt ? nxt.name : '', nextMin: nxt ? nxt.min : cur.min,
    progress: nxt ? (r - cur.min) / (nxt.min - cur.min) : 1,
  };
}

/** Describe a DialogNode for the dialogue screen. */
export function dialogView(node) {
  const lines = (node?.lines || []).filter((l) => l != null && String(l).trim() !== '');
  const choices = node?.choices || [];
  return {
    empty: lines.length === 0 && choices.length === 0,
    lines,
    choices,
    hasBye: choices.some((c) => c.kind === 'bye'),
    // Escape may close a conversation that offers a way out (or has nothing left to say).
    canEscape: choices.length === 0 || choices.some((c) => c.kind === 'bye'),
  };
}

/** Steps through the lines of a node one at a time. */
export class LineCursor {
  constructor(lines) { this.lines = lines || []; this.index = 0; }
  get current() { return this.lines[this.index] ?? ''; }
  /** True once the last line is showing (choices may appear). */
  get atEnd() { return this.index >= this.lines.length - 1; }
  /** Advance; returns false when already at the last line. */
  advance() { if (this.atEnd) return false; this.index++; return true; }
}

/* ------------------------------------------------------------- overlay queue */

/**
 * Serialises overlay screens so several arriving together show one after another.
 * push() returns the entry to show NOW (or null when it was queued); finish(name) is
 * called when an overlay closes and returns the next entry to show (or null).
 */
export class OverlayQueue {
  constructor() { this.waiting = []; this.current = null; }
  get length() { return this.waiting.length + (this.current ? 1 : 0); }
  push(name, data) {
    const entry = { name, data };
    if (this.current) { this.waiting.push(entry); return null; }
    this.current = entry;
    return entry;
  }
  finish(name) {
    if (!this.current || this.current.name !== name) return null;
    this.current = this.waiting.shift() || null;
    return this.current;
  }
  clear() { this.waiting = []; this.current = null; }
}
