// Pure view-model for the observation readout (net:sighting). Never reveals a species
// unless sighting.known is set by the server.

const BLOCKED = { foliage: 'foliage', distance: 'too far', dark: 'too dark', rain: 'rain', motion: 'movement' };
export function blockedWord(b) { return BLOCKED[b] || ''; }

/** Display order of evidence keys, matching the order the server reveals them. */
export const EVIDENCE_ORDER = ['size', 'shape', 'primary', 'flight', 'secondary', 'bill', 'marking', 'behavior', 'habitat'];
const KEY_WORDS = { primary: 'main colour', secondary: 'also', bill: 'bill', marking: 'marking', size: 'size', shape: 'shape', flight: 'flight', behavior: 'behaviour', habitat: 'habitat' };

function words(v) { const s = String(v || '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }

/** Evidence chips in a stable order; unknown keys follow alphabetically. Empty values are skipped. */
export function evidenceChips(evidence, newKey = '') {
  const ev = evidence || {};
  const keys = Object.keys(ev).filter((k) => ev[k] !== '' && ev[k] != null);
  keys.sort((a, b) => {
    const ia = EVIDENCE_ORDER.indexOf(a), ib = EVIDENCE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : 1);
  });
  return keys.map((k) => ({ key: k, name: KEY_WORDS[k] || k, text: words(ev[k]), isNew: k === newKey }));
}

/** The "T - identify" cue: an unidentified mystery with at least two pieces of evidence. */
export function canIdentify(s) {
  if (!s || s.known || !s.mystery) return false;
  return Object.values(s.evidence || {}).filter((v) => v !== '' && v != null).length >= 2;
}

/**
 * @param s net:sighting payload
 * @param speciesName (id) => string  resolves state.speciesById
 */
export function sightingView(s, speciesName = () => '') {
  if (!s || !s.bird) return null;
  const known = s.known ? speciesName(s.known) : '';
  return {
    bird: s.bird,
    clarity: Math.max(0, Math.min(1, s.clarity || 0)),
    progress: Math.max(0, Math.min(1, s.progress || 0)),
    blocked: blockedWord(s.blocked),
    chips: evidenceChips(s.evidence, s.newKey),
    behavior: s.behavior ? words(s.behavior) : '',
    identify: canIdentify(s),
    name: known,
    moment: !!s.moment,
  };
}
