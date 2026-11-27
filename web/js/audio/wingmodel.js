// Wing sounds of a take-off or landing, as recipes (pure; wings.js plays them).
//
// A flushed bird is heard before it is seen: the clatter of a pigeon-sized bird
// bursting out of a crown, the soft flutter of a small songbird, the dry whirr of a
// wren, a duck's splash and the whistle of its wings, the slow deep whoosh of a heron
// or a buzzard. Every recipe is short (under a second, a landing much less) and made of
// filtered noise only: no new audio files. The sound is placed at the bird (wings.js),
// so it says where it went, never what it is.

/** Sound character for a species: 'flutter' 'whirr' 'clatter' 'duck' 'big'. */
export function wingKind(species) {
  const look = species?.look || {}, move = species?.move || {};
  const L = +look.length || 0.15;
  const hz = +move.flapHz || 10;
  const flight = move.flight || 'direct';
  const shape = species?.traits?.shape || '';
  if (move.ground === 'swim' && L >= 0.25) return 'duck';
  if (shape === 'duck' || shape === 'waterfowl') return 'duck';
  if (L >= 0.45 || hz < 3.6) return 'big';
  if (flight === 'whirring' || L < 0.115) return 'whirr';
  if (L >= 0.29 && hz <= 8) return 'clatter';
  return 'flutter';
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * A recipe: { gain, beats: [{t, dur, freq, q, gain, type}], whistle?, splash? }.
 *   beats    filtered noise bursts (one per wingbeat or clap), seconds from the start
 *   whistle  {f0, f1, dur, gain, am}: a narrow band of noise (a duck's wing whistle)
 *   splash   {dur, gain}: a wash of low noise (leaving / landing on water)
 * @param {string} kind     wingKind()
 * @param {object} o
 * @param {boolean} o.landing   a landing (a few soft beats) instead of a take-off
 * @param {boolean} o.flush     a flush (louder, hurried) rather than a calm departure
 * @param {boolean} o.water     on water
 * @param {number} o.size       body length (m), nudges pitch
 * @param {() => number} rng
 */
export function wingRecipe(kind, o = {}, rng = Math.random) {
  const landing = !!o.landing, flush = !!o.flush;
  const L = clamp(+o.size || 0.15, 0.08, 1);
  // Bigger wings, lower noise band.
  const pitch = clamp(Math.pow(0.15 / L, 0.35), 0.55, 1.4);
  const beats = [];
  let gain = flush ? 1 : 0.6;
  let hz, n, f, q, dur, type = 'bandpass', decay;
  switch (kind) {
    case 'whirr': hz = 26; n = landing ? 4 : 12; f = 3400; q = 1.1; dur = 0.018; decay = 0.4; gain *= 0.5; break;
    case 'clatter': hz = 7.5; n = landing ? 3 : 7; f = 1500; q = 0.7; dur = 0.035; decay = 0.65; gain *= 1.1; break;
    case 'duck': hz = 8; n = landing ? 3 : 9; f = 1300; q = 0.8; dur = 0.04; decay = 0.5; gain *= 0.9; break;
    case 'big': hz = 2.6; n = landing ? 2 : 4; f = 380; q = 0.6; dur = 0.22; decay = 0.35; gain *= 0.95; type = 'lowpass'; break;
    default: hz = 15; n = landing ? 3 : 8; f = 2400; q = 0.9; dur = 0.022; decay = 0.55; gain *= 0.55; break;
  }
  if (flush && kind !== 'big') hz *= 1.12;
  let t = 0;
  for (let i = 0; i < n; i++) {
    const prog = n > 1 ? i / (n - 1) : 0;
    // Take-off: the first beats are the hardest (a clap), then it settles and fades.
    let g = landing ? 0.7 * (1 - 0.5 * prog) : (1 - decay * prog);
    if (!landing && kind === 'clatter' && i < 2) g *= 1.5; // the wing-clap
    beats.push({
      t, dur: dur * (0.85 + 0.3 * rng()), freq: f * pitch * (0.85 + 0.3 * rng()), q, type,
      gain: g * (0.85 + 0.3 * rng()),
    });
    t += (1 / hz) * (landing ? 1 + 0.25 * prog : 1 + 0.3 * prog) * (0.92 + 0.16 * rng());
  }
  const r = { kind, gain, beats, length: t + dur * 2 };
  if (kind === 'duck' && !landing) {
    r.whistle = { f0: 2600 * pitch, f1: 2200 * pitch, dur: 0.85, gain: 0.35, am: hz };
    r.length = Math.max(r.length, 0.9);
  }
  if (o.water) {
    r.splash = { dur: landing ? 0.35 : 0.5, gain: landing ? 0.45 : 0.8 };
    r.length = Math.max(r.length, r.splash.dur + 0.1);
  }
  return r;
}

/** Distance (m) beyond which no wing sound is played. */
export const WING_RANGE = Object.freeze({ takeoff: 70, landing: 35 });
