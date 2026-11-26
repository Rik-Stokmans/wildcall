// Pure formatting + stat vocabulary for the UI kit (no DOM, no three.js: node-testable).

/* ----------------------------------------------------------------------------
 * Units.  '%' stats are stored as 0..1 fractions and shown as percentages;
 * 'flag' stats are unlock thresholds (>= 1 means unlocked); 'lvl' stats are small
 * integer tiers; everything else is shown as the number plus its unit suffix. */

/** Group display names, in the order a stat sheet should list them. */
export const STAT_GROUPS = {
  audio: 'Listening & recording',
  optics: 'Binoculars & optics',
  camera: 'Camera',
  observation: 'Observation',
  knowledge: 'Knowledge',
  field: 'Fieldcraft',
  backpack: 'Pack & navigation',
  general: 'Progress',
};

/**
 * STAT_INFO[key] = { label, unit, better: 'high'|'low', group, desc }
 * Covers every core.Stats field (internal/core/sim.go) a player can meet in an item
 * tooltip, skill description or character sheet.
 */
export const STAT_INFO = {
  // --- Listening
  hearRange: { label: 'Hearing range', unit: '×', better: 'high', group: 'audio', desc: 'How far away you can pick out calls.' },
  focusBonus: { label: 'Focus listening', unit: '%', better: 'high', group: 'audio', desc: 'Extra hearing range while holding F.' },
  dirAccuracy: { label: 'Direction sense', unit: '%', better: 'high', group: 'audio', desc: 'How precisely you can tell where a sound comes from.' },
  distAcc: { label: 'Distance sense', unit: '%', better: 'high', group: 'audio', desc: 'How tightly you can judge how far a bird is.' },
  pitchInfo: { label: 'Pitch sense', unit: 'flag', better: 'high', group: 'audio', desc: 'Sound clues describe the pitch.' },
  patternInfo: { label: 'Pattern sense', unit: 'flag', better: 'high', group: 'audio', desc: 'Sound clues describe the rhythm.' },
  habitatInfo: { label: 'Habitat sense', unit: 'flag', better: 'high', group: 'audio', desc: 'Sound clues hint at the habitat.' },
  noiseReduce: { label: 'Noise reduction', unit: '%', better: 'high', group: 'audio', desc: 'Share of wind and rain noise you tune out.' },
  clueSlots: { label: 'Sounds tracked', unit: '', better: 'high', group: 'audio', desc: 'How many sound sources you can follow at once.' },
  callMemory: { label: 'Call memory', unit: 'flag', better: 'high', group: 'audio', desc: 'Recognise recorded species by ear.' },
  callRecognise: { label: 'Call recognition', unit: 'flag', better: 'high', group: 'audio', desc: 'Recognise any identified species by ear.' },
  // --- Recording
  recRange: { label: 'Recording range', unit: 'm', better: 'high', group: 'audio', desc: 'Distance for a clean recording.' },
  recQuality: { label: 'Recording quality', unit: '%', better: 'high', group: 'audio', desc: 'Base fidelity of your recordings.' },
  recFocus: { label: 'Directionality', unit: '%', better: 'high', group: 'audio', desc: 'Rejects off-axis noise; needs careful aim.' },
  spectrogram: { label: 'Live spectrogram', unit: 'flag', better: 'high', group: 'audio', desc: 'Shows sound as a picture while recording.' },
  audioAssist: { label: 'Audio analysis', unit: 'lvl', better: 'high', group: 'audio', desc: 'Recordings add evidence and sharpen identification.' },
  // --- Optics
  binoZoom: { label: 'Magnification', unit: '×', better: 'high', group: 'optics', desc: 'Maximum binocular zoom.' },
  binoFov: { label: 'Field of view', unit: '°', better: 'high', group: 'optics', desc: 'Apparent field of the binoculars.' },
  binoStability: { label: 'Stability', unit: '%', better: 'high', group: 'optics', desc: 'How steady the image stays.' },
  binoFocus: { label: 'Focus speed', unit: '/s', better: 'high', group: 'optics', desc: 'How quickly focus catches up.' },
  binoClarity: { label: 'Clarity', unit: '%', better: 'high', group: 'optics', desc: 'Optical quality of the image.' },
  binoWeight: { label: 'Weight', unit: 'kg', better: 'low', group: 'optics', desc: 'Heavier optics raise slowly and sway more.' },
  lowLight: { label: 'Low-light', unit: '%', better: 'high', group: 'optics', desc: 'Performance at dawn, dusk and night.' },
  // --- Camera
  camZoom: { label: 'Zoom', unit: '×', better: 'high', group: 'camera', desc: 'Maximum camera zoom.' },
  camStability: { label: 'Camera stability', unit: '%', better: 'high', group: 'camera', desc: 'Steadiness of the viewfinder.' },
  camFocus: { label: 'Autofocus speed', unit: '/s', better: 'high', group: 'camera', desc: 'How quickly the camera locks on.' },
  camQuality: { label: 'Image quality', unit: '%', better: 'high', group: 'camera', desc: 'Caps the score of your photos.' },
  camBurst: { label: 'Burst speed', unit: '/s', better: 'high', group: 'camera', desc: 'Shots per second while holding the shutter.' },
  camNoise: { label: 'Shutter noise', unit: '%', better: 'low', group: 'camera', desc: 'How much each shot disturbs wildlife.' },
  camReady: { label: 'Raise time', unit: 's', better: 'low', group: 'camera', desc: 'Seconds to bring the camera up.' },
  filmCap: { label: 'Film capacity', unit: '', better: 'high', group: 'camera', desc: 'Photos per expedition.' },
  composition: { label: 'Composition', unit: '%', better: 'high', group: 'camera', desc: 'Bonus to composition scoring.' },
  longLens: { label: 'Long-lens steadiness', unit: '%', better: 'high', group: 'camera', desc: 'Removes zoom-induced shake.' },
  momentBonus: { label: 'Moment bonus', unit: '%', better: 'high', group: 'camera', desc: 'Bonus score for behaviour photos.' },
  // --- Observation
  observeSpeed: { label: 'Observation speed', unit: '×', better: 'high', group: 'observation', desc: 'How fast watching reveals details.' },
  nakedEye: { label: 'Naked-eye range', unit: '×', better: 'high', group: 'observation', desc: 'Unaided observation range.' },
  moveSense: { label: 'Movement sense', unit: 'm', better: 'high', group: 'observation', desc: 'Distance at which you notice movement.' },
  peripheral: { label: 'Peripheral awareness', unit: 'm', better: 'high', group: 'observation', desc: 'Movement noticed outside your view.' },
  settle: { label: 'Settling speed', unit: '×', better: 'high', group: 'observation', desc: 'How quickly wildlife calms around you.' },
  perchHint: { label: 'Perch sense', unit: 'flag', better: 'high', group: 'observation', desc: 'Clues hint at where a bird is sitting.' },
  trackSigns: { label: 'Sign sense', unit: 'm', better: 'high', group: 'observation', desc: 'Distance at which feathers and signs glint.' },
  instinct: { label: 'Natural instinct', unit: 'flag', better: 'high', group: 'observation', desc: 'Clues flag unusual birds and behaviour.' },
  // --- Knowledge
  idAssist: { label: 'Identification help', unit: 'lvl', better: 'high', group: 'knowledge', desc: 'Sharper candidate lists and confidence.' },
  recognise: { label: 'Species recognition', unit: 'flag', better: 'high', group: 'knowledge', desc: 'Known species are recognised at a glance.' },
  journalInfo: { label: 'Journal detail', unit: 'lvl', better: 'high', group: 'knowledge', desc: 'Deeper species entries.' },
  habitatKnow: { label: 'Habitat knowledge', unit: 'flag', better: 'high', group: 'knowledge', desc: 'Field guide shows where species live.' },
  seasonKnow: { label: 'Seasonal knowledge', unit: 'flag', better: 'high', group: 'knowledge', desc: 'Field guide shows seasons and daily patterns.' },
  behaviorInsight: { label: 'Behaviour insight', unit: '%', better: 'high', group: 'knowledge', desc: 'Faster behaviour evidence and bonus XP.' },
  ecoKnow: { label: 'Ecological knowledge', unit: 'flag', better: 'high', group: 'knowledge', desc: 'Shows how species relate to each other.' },
  rareId: { label: 'Rare-bird confidence', unit: '%', better: 'high', group: 'knowledge', desc: 'Confidence boost for difficult species.' },
  // --- Fieldcraft
  stealth: { label: 'Disturbance', unit: '×', better: 'low', group: 'field', desc: 'How far you startle birds; lower is quieter.' },
  crouchBonus: { label: 'Crouch disturbance', unit: '×', better: 'low', group: 'field', desc: 'Disturbance multiplier while crouched or sitting.' },
  moveSpeed: { label: 'Walking speed', unit: '×', better: 'high', group: 'field', desc: 'Walking pace.' },
  stamina: { label: 'Stamina', unit: 's', better: 'high', group: 'field', desc: 'Seconds you can sprint.' },
  terrain: { label: 'Rough terrain', unit: '%', better: 'high', group: 'field', desc: 'Reduces slowdown on slopes, shrubs and shallows.' },
  forecast: { label: 'Weather forecast', unit: 'h', better: 'high', group: 'field', desc: 'Hours of forecast shown.' },
  trailSense: { label: 'Trail sense', unit: 'm', better: 'high', group: 'field', desc: 'Distance at which hidden trails and places reveal.' },
  camp: { label: 'Camp craft', unit: '%', better: 'high', group: 'field', desc: 'Effectiveness of sit-and-wait setups.' },
  familiarity: { label: 'Wildlife familiarity', unit: '×', better: 'high', group: 'field', desc: 'How quickly birds get used to you.' },
  rainProof: { label: 'Rain protection', unit: '%', better: 'high', group: 'field', desc: 'Share of rain penalties ignored.' },
  // --- Pack, navigation, general
  capacity: { label: 'Capacity', unit: '', better: 'high', group: 'backpack', desc: 'Inventory slots.' },
  compass: { label: 'Compass detail', unit: 'lvl', better: 'high', group: 'backpack', desc: 'Detail shown on the compass strip.' },
  mapDetail: { label: 'Map detail', unit: 'lvl', better: 'high', group: 'backpack', desc: 'Landmarks, trails, then habitats.' },
  lensInspect: { label: 'Close inspection', unit: 'flag', better: 'high', group: 'backpack', desc: 'Feathers and signs yield extra clues.' },
  xpMult: { label: 'XP bonus', unit: '×', better: 'high', group: 'general', desc: 'Multiplier on experience gained.' },
  creditMult: { label: 'Credit bonus', unit: '×', better: 'high', group: 'general', desc: 'Multiplier on Field Credits earned.' },
  discount: { label: 'Shop discount', unit: '%', better: 'high', group: 'general', desc: 'Discount at Finn\'s stall.' },
};

/** Trimmed fixed-point: 8 → "8", 7.50 → "7.5", 0.149 → "0.15", never "-0". */
export function trimNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  const dec = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  const s = String(parseFloat(n.toFixed(dec)));
  return s === '-0' ? '0' : s;
}

/** Display label for any stat key; unknown keys become "Some stat name". */
export function statLabel(key) {
  const info = STAT_INFO[key];
  if (info) return info.label;
  const spaced = String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** formatStat('binoZoom', 8) → "8×";  formatStat('binoStability', 0.35) → "35%". */
export function formatStat(key, value) {
  const v = Number(value);
  const info = STAT_INFO[key];
  if (!Number.isFinite(v)) return '–';
  if (!info) return trimNumber(v);
  switch (info.unit) {
    case '%': return Math.round(v * 100) + '%';
    case 'flag': return v >= 1 ? 'Yes' : 'No';
    case 'lvl': return String(Math.round(v));
    default: return trimNumber(v) + info.unit;
  }
}

/** formatMod('binoZoom', 2) → "+2×";  sign-aware, for item tooltips and comparisons. */
export function formatMod(key, delta) {
  const d = Number(delta);
  const info = STAT_INFO[key];
  if (!Number.isFinite(d)) return '–';
  if (info?.unit === 'flag') return d > 0 ? 'Unlocks' : d < 0 ? 'Removes' : '–';
  const s = formatStat(key, Math.abs(d));
  // A change that rounds to nothing in display units reads as "0", never as "+0%".
  if (d === 0 || parseFloat(s) === 0) return s;
  return (d > 0 ? '+' : '−') + s;
}

/** True if a positive delta of this stat is good for the player (zero is neutral-good). */
export function statIsGood(key, delta) {
  const better = STAT_INFO[key]?.better || 'high';
  return better === 'high' ? delta >= 0 : delta <= 0;
}

/** Stat keys of one group, in STAT_INFO order. */
export function statsInGroup(group) {
  return Object.keys(STAT_INFO).filter((k) => STAT_INFO[k].group === group);
}

/** formatClock(13.5) → "13:30" */
export function formatClock(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h)) return '--:--';
  const wrapped = ((h % 24) + 24) % 24;
  const hh = Math.floor(wrapped);
  const mm = Math.min(59, Math.floor((wrapped - hh) * 60 + 1e-6));
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

/** formatCount(12345) → "12,345" (credits, XP). */
export function formatCount(n) {
  const v = Math.round(Number(n) || 0);
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** formatDuration(3725) → "1h 02m";  formatDuration(95) → "1m 35s". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

/** Capitalised display text for snake_case / lower-case words: label('very high') → "Very high". */
export function label(word) {
  if (word == null || word === '') return '';
  const s = String(word).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
export function clampRarity(r) { return Math.max(0, Math.min(4, Math.round(Number(r)) || 0)); }
export function rarityName(r) { return RARITY_NAMES[clampRarity(r)]; }
export function rarityColor(r) { return `var(--rarity-${clampRarity(r)})`; }

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const WEATHER_NAMES = ['Sunny', 'Cloudy', 'Rain', 'Wind'];
export const WEATHER_ICONS = ['sunny', 'cloudy', 'rain', 'wind'];
export const DISCOVERY_LEVELS = ['', 'Unknown', 'Heard', 'Encountered', 'Identified', 'Documented', 'Studied'];
export const WILD_RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Legendary'];

/** Roman numerals for item tiers (1..4 → I..IV). */
export function tierNumeral(t) { return ['', 'I', 'II', 'III', 'IV'][Math.max(0, Math.min(4, t | 0))] || ''; }
