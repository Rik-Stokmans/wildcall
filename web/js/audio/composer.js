// Generative music: decides WHAT to play (pure), music.js decides HOW it sounds.
// The music is meant to be barely there — a few plucked notes, an occasional soft pad,
// long silences — in a calm mode that follows the time of day.
import { intBetween, between, pick } from './rng.js';
import { daylight } from './mix.js';

/** Scale steps (semitones from the root). */
export const MODES = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  majorPent: [0, 2, 4, 7, 9],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minorPent: [0, 3, 5, 7, 10],
};

/** Root notes (MIDI) per season: spring D, summer F, autumn A, winter E. */
const SEASON_ROOT = [62, 65, 57, 64];

/**
 * The musical mood for this moment.
 * @returns {{mode:string, scale:number[], root:number, density:number, brightness:number, pad:number}}
 *   density = plucked phrases per minute; brightness 0..1 (filter opening); pad =
 *   probability that a phrase is a soft chord pad instead of plucks.
 */
export function moodFor(env) {
  const h = Number.isFinite(+env?.time) ? +env.time : 9;
  const light = daylight(env);
  const rain = Math.max(0, Math.min(1, +env?.rain || 0));
  let mode;
  if (h >= 4.5 && h < 7) mode = 'lydian';        // dawn: open, hopeful
  else if (h >= 7 && h < 11) mode = 'majorPent'; // morning: simple and light
  else if (h >= 11 && h < 14) mode = 'ionian';
  else if (h >= 14 && h < 18) mode = 'mixolydian';
  else if (h >= 18 && h < 21.5) mode = 'dorian'; // evening: warm, wistful
  else mode = 'minorPent';                        // night: hushed
  const root = SEASON_ROOT[((+env?.season | 0) & 3)] - (mode === 'minorPent' ? 12 : 0);
  return {
    mode,
    scale: MODES[mode],
    root,
    density: (0.6 + 0.9 * light) * (1 - 0.4 * rain),
    brightness: 0.25 + 0.55 * light,
    pad: mode === 'minorPent' || mode === 'dorian' ? 0.45 : 0.25 + 0.2 * rain,
  };
}

/** MIDI note → Hz. */
export function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

/** Is a MIDI note inside the mood's scale (any octave)? */
export function inScale(midi, mood) {
  const rel = (((midi - mood.root) % 12) + 12) % 12;
  return mood.scale.includes(rel);
}

/**
 * Compose the next musical gesture.
 * @param {() => number} rng
 * @param {object} mood from moodFor
 * @returns {{kind:'pluck'|'pad', notes:{t:number, midi:number, dur:number, vel:number}[],
 *   length:number, rest:number}} times in seconds relative to the gesture start; `rest`
 *   is the silence to leave after it (long — the music should mostly be absent).
 */
export function composePhrase(rng, mood) {
  const degree = (d) => {
    const n = mood.scale.length;
    const oct = Math.floor(d / n);
    return mood.root + 12 * oct + mood.scale[((d % n) + n) % n];
  };
  // Rest: around 60 s / density, never shorter than 18 s.
  const rest = Math.max(18, between(rng, 0.7, 1.6) * 60 / Math.max(0.2, mood.density));
  if (rng() < mood.pad) {
    const base = intBetween(rng, -2, 2);
    const chord = [base, base + 2, base + 4];
    if (rng() < 0.5) chord.push(base + 6);
    const dur = between(rng, 9, 15);
    return {
      kind: 'pad',
      notes: chord.map((d, i) => ({ t: i * between(rng, 0.2, 0.7), midi: degree(d) - 12, dur, vel: 0.5 + 0.2 * rng() })),
      length: dur + 2,
      rest,
    };
  }
  const count = intBetween(rng, 2, 5);
  let d = intBetween(rng, 0, mood.scale.length + 2);
  let t = 0;
  const notes = [];
  for (let i = 0; i < count; i++) {
    notes.push({ t, midi: degree(d), dur: between(rng, 1.8, 3.5), vel: 0.45 + 0.4 * rng() * (i === 0 ? 1 : 0.8) });
    t += pick(rng, [0.45, 0.6, 0.9, 1.2, 1.6]);
    d += pick(rng, [-2, -1, -1, 1, 1, 2, 3]);
    d = Math.max(-2, Math.min(mood.scale.length * 2, d));
  }
  return { kind: 'pluck', notes, length: t + 3.5, rest };
}
