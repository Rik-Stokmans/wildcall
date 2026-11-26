// UI and equipment sound recipes: pure data (lists of partials) so they are testable and
// easy to tune; sfx.js renders any recipe. The palette is soft and wooden — marimba-ish
// plucks, paper, leather and small brass — to match the field-journal UI. Nothing is
// harsh: even "error" is a gentle low two-note shrug (the game stays cozy).
//
// Partial: {t, type, f, f1?, dur, gain, attack?, filter?: {type, freq, q}}
//   type: oscillator type ('sine'|'triangle'|'square'|'sawtooth') or 'noise'
//   f → f1: frequency glide (Hz); for noise f is the filter centre
//   dur: decay time (s) of an exponential-ish envelope; gain: peak level

const mallet = (t, f, gain = 0.35, dur = 0.35) => [
  { t, type: 'sine', f, dur, gain },
  { t, type: 'sine', f: f * 3.98, dur: dur * 0.25, gain: gain * 0.18 }, // wooden overtone
  { t, type: 'noise', f: f * 2, dur: 0.012, gain: gain * 0.25, filter: { type: 'bandpass', freq: f * 2, q: 2 } },
];
const bell = (t, f, gain = 0.25, dur = 1.4) => [
  { t, type: 'sine', f, dur, gain },
  { t, type: 'sine', f: f * 2.76, dur: dur * 0.5, gain: gain * 0.25 },
  { t, type: 'sine', f: f * 5.4, dur: dur * 0.25, gain: gain * 0.1 },
];

export const UI_SOUNDS = {
  click: [
    { t: 0, type: 'noise', f: 3200, dur: 0.018, gain: 0.35, filter: { type: 'bandpass', freq: 3200, q: 3 } },
    { t: 0, type: 'sine', f: 1500, f1: 1100, dur: 0.03, gain: 0.12 },
  ],
  page: [
    { t: 0, type: 'noise', f: 1800, dur: 0.16, gain: 0.3, attack: 0.04, filter: { type: 'bandpass', freq: 1800, q: 0.8 } },
    { t: 0.07, type: 'noise', f: 4200, dur: 0.1, gain: 0.18, attack: 0.02, filter: { type: 'highpass', freq: 3000, q: 0.7 } },
  ],
  open: [...mallet(0, 587.3), ...mallet(0.08, 880, 0.3)],
  close: [...mallet(0, 880, 0.28), ...mallet(0.08, 587.3, 0.3)],
  reward: [...mallet(0, 523.3, 0.3), ...mallet(0.11, 659.3, 0.3), ...mallet(0.22, 784, 0.3), ...bell(0.36, 1046.5, 0.2)],
  discover: [...bell(0, 784, 0.22, 1.8), ...bell(0.18, 1174.7, 0.16, 1.8), ...bell(0.4, 1568, 0.12, 2)],
  shutter: [
    { t: 0, type: 'noise', f: 2500, dur: 0.02, gain: 0.5, filter: { type: 'bandpass', freq: 2500, q: 1.5 } },
    { t: 0, type: 'sine', f: 900, f1: 500, dur: 0.025, gain: 0.15 },
    { t: 0.055, type: 'noise', f: 1800, dur: 0.03, gain: 0.4, filter: { type: 'bandpass', freq: 1800, q: 1.2 } },
    { t: 0.055, type: 'sine', f: 400, f1: 250, dur: 0.04, gain: 0.12 },
  ],
  error: [...mallet(0, 392, 0.26, 0.3), ...mallet(0.13, 349.2, 0.26, 0.45)],
  level: [...mallet(0, 523.3, 0.28), ...mallet(0.09, 659.3, 0.28), ...mallet(0.18, 784, 0.28), ...mallet(0.27, 1046.5, 0.28), ...bell(0.4, 1568, 0.16, 2)],
  equip: [
    { t: 0, type: 'noise', f: 900, dur: 0.12, gain: 0.25, attack: 0.03, filter: { type: 'bandpass', freq: 900, q: 0.9 } }, // leather
    { t: 0.09, type: 'sine', f: 2350, dur: 0.18, gain: 0.1 },                                                          // buckle
    { t: 0.09, type: 'sine', f: 3710, dur: 0.12, gain: 0.06 },
  ],
  coin: [
    { t: 0, type: 'sine', f: 1975.5, dur: 0.35, gain: 0.16 },
    { t: 0, type: 'sine', f: 5200, dur: 0.08, gain: 0.04 },
    { t: 0.08, type: 'sine', f: 2637, dur: 0.5, gain: 0.16 },
    { t: 0.08, type: 'sine', f: 6900, dur: 0.1, gain: 0.04 },
  ],
};

/** Equipment handling sounds (routed with the world, not the UI bus). */
export const GEAR_SOUNDS = {
  // Lifting optics to the eyes: a cloth-and-strap rustle.
  raise: [
    { t: 0, type: 'noise', f: 1200, dur: 0.22, gain: 0.22, attack: 0.06, filter: { type: 'bandpass', freq: 1200, q: 0.7 } },
    { t: 0.05, type: 'noise', f: 3000, dur: 0.12, gain: 0.08, attack: 0.03, filter: { type: 'highpass', freq: 2500, q: 0.7 } },
  ],
  lower: [
    { t: 0, type: 'noise', f: 900, dur: 0.2, gain: 0.18, attack: 0.05, filter: { type: 'bandpass', freq: 900, q: 0.7 } },
  ],
  // Swapping instruments: a pouch flap and a soft click.
  select: [
    { t: 0, type: 'noise', f: 700, dur: 0.18, gain: 0.2, attack: 0.04, filter: { type: 'bandpass', freq: 700, q: 0.8 } },
    { t: 0.13, type: 'noise', f: 2600, dur: 0.015, gain: 0.25, filter: { type: 'bandpass', freq: 2600, q: 3 } },
  ],
  // The camera lens motor nudging into focus.
  zoom: [
    { t: 0, type: 'square', f: 140, f1: 180, dur: 0.12, gain: 0.015, filter: { type: 'bandpass', freq: 2200, q: 2 } },
  ],
  recStart: [
    { t: 0, type: 'noise', f: 2400, dur: 0.012, gain: 0.25, filter: { type: 'bandpass', freq: 2400, q: 3 } },
    { t: 0.03, type: 'sine', f: 1320, dur: 0.12, gain: 0.07 },
  ],
  recStop: [
    { t: 0, type: 'noise', f: 2000, dur: 0.012, gain: 0.25, filter: { type: 'bandpass', freq: 2000, q: 3 } },
    { t: 0.03, type: 'sine', f: 990, dur: 0.1, gain: 0.06 },
    { t: 0.15, type: 'sine', f: 990, dur: 0.1, gain: 0.05 },
  ],
};

/** Total length of a recipe in seconds (last partial end). */
export function recipeLength(recipe) {
  let end = 0;
  for (const p of recipe) end = Math.max(end, p.t + (p.attack || 0) + p.dur);
  return end;
}
