// Call scheduler: turns a core.Call (see internal/core/species.go) + a repeat count +
// a variation seed into a flat list of timed note events. Pure (no Web Audio) so the
// timing logic is testable; voice.js renders the events.
//
// Real birds never repeat a phrase exactly: tempo drifts a little, pitch wanders by a
// few cents, phrases late in a long bout get slightly softer and slower. The seed
// (CallMsg.seed) makes that variation deterministic, so the same bout always sounds
// the same, while two bouts of the same species sound like the same bird singing twice.
import { mulberry32, jitter, intBetween } from './rng.js';

export const WAVES = ['sine', 'whistle', 'buzz', 'trill', 'noise', 'click'];

/** Frequencies are kept inside this band so every voice stays below Nyquist at 44.1 kHz. */
export const MIN_FREQ = 60;
export const MAX_FREQ = 12000;
/** Hard caps that keep a malformed call from flooding the audio graph. */
export const MAX_REPEATS = 40;
export const MAX_EVENTS = 1200;
/** Length of one tap of a drum/click train, seconds. */
export const TAP_DUR = 0.012;

/** Duration of one phrase: sum of note dur + gap (mirrors core.Call.PhraseDur). */
export function phraseDur(call) {
  let d = 0;
  for (const n of call?.notes || []) d += (+n.dur || 0) + (+n.gap || 0);
  return d;
}

/** Audible base range in metres (mirrors core.Call.AudibleRange). */
export function baseRange(call) {
  return 40 + 260 * clamp01(+call?.loud || 0);
}

/**
 * How many phrases a bout has. The server decides (CallMsg.reps); when it does not
 * (journal playback, reps <= 0) the call's own Repeat range is used.
 */
export function boutRepeats(call, reps, rng) {
  if (reps > 0) return Math.min(Math.round(reps), MAX_REPEATS);
  const r = call?.repeat || [1, 1];
  const lo = Math.max(1, r[0] | 0), hi = Math.max(lo, r[1] | 0);
  return Math.min(rng ? intBetween(rng, lo, hi) : lo, MAX_REPEATS);
}

/**
 * Build the bout.
 * @param {object} call core.Call ({kind, notes, repeat, gap, loud, pitch, pattern})
 * @param {number} repeats phrases in the bout (<= 0: pick from call.repeat)
 * @param {number} seed variation seed (uint32)
 * @param {{variation?: number}} [opts] variation 0 = exact data (tests, analysis), 1 = natural
 * @returns {{events: NoteEvent[], duration: number, repeats: number}}
 *   NoteEvent = {t, dur, f0, f1, wave, rate, depth, amp, phrase}; t relative to bout start.
 *   duration = time at which the last sound ends.
 */
export function scheduleCall(call, repeats, seed, opts = {}) {
  const v = opts.variation ?? 1;
  const rng = mulberry32(seed);
  const notes = (call?.notes || []).filter((n) => (+n.dur || 0) > 0);
  const reps = boutRepeats(call, repeats, rng);
  const events = [];
  if (!notes.length) return { events, duration: 0, repeats: reps };

  // Bout-wide character: this individual today sings a touch high/low, fast/slow.
  const boutPitch = 1 + jitter(rng, 0.025 * v);
  const boutTempo = 1 + jitter(rng, 0.04 * v);
  const callGap = Math.max(0, +call.gap || 0);

  let t = 0;
  let end = 0;
  for (let r = 0; r < reps && events.length < MAX_EVENTS; r++) {
    const fatigue = reps > 1 ? r / (reps - 1) : 0; // 0 first phrase … 1 last
    const pPitch = boutPitch * (1 + jitter(rng, 0.012 * v));
    const pTempo = boutTempo * (1 + jitter(rng, 0.02 * v)) * (1 + 0.04 * v * fatigue);
    const pAmp = 1 - 0.12 * v * fatigue;
    for (const n of notes) {
      const dur = (+n.dur) * pTempo * (1 + jitter(rng, 0.04 * v));
      const gap = Math.max(0, +n.gap || 0) * pTempo * (1 + jitter(rng, 0.06 * v));
      const nPitch = pPitch * (1 + jitter(rng, 0.008 * v));
      const [f0, f1] = noteFreqs(n, nPitch);
      const wave = WAVES.includes(n.wave) ? n.wave : 'whistle';
      const amp = noteAmp(n) * pAmp * (1 - 0.12 * v * rng());
      const rate = Math.max(0, +n.rate || 0);
      const depth = clamp(+n.depth || 0, 0, 1);
      // A click note with a Rate is a drum roll (vibrato would be meaningless on a
      // 14 ms strike); expand it into individual taps.
      if (wave === 'click' && rate > 0 && dur * rate >= 1.5) {
        pushClickTrain(events, t, dur, f0, f1, rate, amp, r, rng, v);
      } else {
        events.push({ t, dur, f0, f1, wave, rate, depth, amp, phrase: r });
      }
      end = Math.max(end, t + dur);
      t += dur + gap;
      if (events.length >= MAX_EVENTS) break;
    }
    if (r < reps - 1) t += callGap * boutTempo * (1 + jitter(rng, 0.15 * v));
  }
  return { events, duration: end, repeats: reps };
}

/**
 * A drum or a run of clicks: Rate taps per second across the note's duration. A
 * woodpecker drum starts fast and crisp, slows slightly and fades towards the end.
 */
function pushClickTrain(events, t0, dur, f0, f1, rate, amp, phrase, rng, v) {
  const n = Math.max(2, Math.floor(dur * rate));
  const raw = [];
  let acc = 0;
  for (let k = 0; k < n; k++) {
    raw.push(acc);
    const prog = k / (n - 1);
    acc += (1 / rate) * (1 + 0.25 * prog * prog) * (1 + jitter(rng, 0.03 * v));
  }
  // Fit the whole train inside the note so the phrase timing stays exact.
  const last = raw[raw.length - 1];
  const fit = last + TAP_DUR > dur ? Math.max(0, dur - TAP_DUR) / last : 1;
  for (let k = 0; k < n; k++) {
    const prog = k / (n - 1);
    const f = f0 + (f1 - f0) * prog;
    events.push({
      t: t0 + raw[k] * fit,
      dur: TAP_DUR,
      f0: f, f1: f,
      wave: 'click', rate: 0, depth: 0,
      amp: amp * (1 - 0.4 * prog) * (1 + jitter(rng, 0.08 * v)),
      phrase,
    });
  }
}

function noteFreqs(n, mul) {
  let f0 = +n.f0 || 0, f1 = +n.f1 || 0;
  if (f0 <= 0 && f1 <= 0) f0 = f1 = 2000;
  else if (f0 <= 0) f0 = f1;
  else if (f1 <= 0) f1 = f0;
  return [clamp(f0 * mul, MIN_FREQ, MAX_FREQ), clamp(f1 * mul, MIN_FREQ, MAX_FREQ)];
}

/** Amp 0 (or missing) in authored data means "not set", not silence: use 0.8. */
function noteAmp(n) {
  const a = +n.amp;
  return a > 0 ? Math.min(a, 1) : 0.8;
}

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function clamp01(x) { return clamp(x, 0, 1); }
