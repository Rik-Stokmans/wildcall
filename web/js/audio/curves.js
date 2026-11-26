// Distance, occlusion and mixing curves for spatial bird calls. Pure maths (no Web
// Audio, no DOM, no three.js) so every curve can be unit tested in node.
//
// The server decides what the player can *perceive* (clues); the client must make the
// same call actually *sound* that way: a call is clearly heard near the bird, fades
// with distance like real sound (inverse law) and is gone at the edge of its audible
// range 40 + 260·loud metres × stats.hearRange (× 1 + focusBonus while listening).

/** Fraction of the audible range used as the panner's reference distance. */
export const REF_FRAC = 0.05;
/** Linear gain the inverse-distance law reaches at the audible range (≈ −30 dB). */
export const EDGE_GAIN = 0.03;
/** The last part of the range is faded to true silence by an extra gain. */
export const FADE_START = 0.8;
/** Default focus bonus when stats are missing (core.BaseStats: 0.35). */
export const DEFAULT_FOCUS_BONUS = 0.35;
/** Maximum simultaneous spatial bird voices. */
export const MAX_VOICES = 24;

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function clamp01(x) { return clamp(x, 0, 1); }
export function smoothstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export function dbToGain(db) { return Math.pow(10, db / 20); }
export function gainToDb(g) { return g > 0 ? 20 * Math.log10(g) : -Infinity; }

/**
 * Audible range of a call in metres for the current player.
 * @param {number} loud core.Call.loud 0..1
 * @param {object} stats core.Stats (hearRange, focusBonus); missing → base values
 * @param {number} focus 0..1 how far focused listening is engaged (smoothed in the engine)
 */
export function audibleRange(loud, stats, focus = 0) {
  const base = 40 + 260 * clamp01(+loud || 0);
  const hear = +stats?.hearRange > 0 ? +stats.hearRange : 1;
  const fb = Number.isFinite(+stats?.focusBonus) && stats?.focusBonus !== undefined
    ? Math.max(0, +stats.focusBonus) : DEFAULT_FOCUS_BONUS;
  return base * hear * (1 + fb * clamp01(focus));
}

/**
 * PannerNode settings ('inverse' distance model) for a range: the reference distance
 * scales with the range (a loud call is "full volume" further out) and the rolloff is
 * solved so the inverse law reaches EDGE_GAIN exactly at the range.
 */
export function pannerParams(range) {
  const r = Math.max(4, +range || 0);
  const refDistance = Math.max(1, r * REF_FRAC);
  const rolloffFactor = ((1 / EDGE_GAIN) - 1) * refDistance / (r - refDistance);
  return { distanceModel: 'inverse', refDistance, rolloffFactor, maxDistance: 10000 };
}

/** The Web Audio 'inverse' distance law, exactly as the PannerNode computes it. */
export function inverseGain(d, p) {
  const dd = Math.max(d, p.refDistance);
  return p.refDistance / (p.refDistance + p.rolloffFactor * (dd - p.refDistance));
}

/** Extra gain that takes the last 20 % of the range smoothly to silence. */
export function edgeFade(d, range) {
  return 1 - smoothstep(FADE_START * range, range, d);
}

/** Total distance gain heard by the player: panner law × edge fade. */
export function callGain(d, range) {
  return inverseGain(d, pannerParams(range)) * edgeFade(d, range);
}

/** Source level of a call before distance: louder species are louder at the source too. */
export function sourceLevel(loud) {
  return 0.55 + 0.45 * clamp01(+loud || 0);
}

/** Foliage between bird and listener absorbs some energy as well as the highs. */
export function occlusionGain(occ) {
  return 1 - 0.45 * clamp01(+occ || 0);
}

/** Air absorption: high frequencies fade with distance (a simple 1/(1+d/k) law). */
export function airCutoff(d) {
  return clamp(20000 / (1 + Math.max(0, d) / 45), 1800, 20000);
}

/** Occlusion low-pass: each step of foliage takes the top octaves away. */
export function occlusionCutoff(occ) {
  return 20000 * Math.pow(2, -4.4 * clamp01(+occ || 0));
}

/**
 * Combined low-pass cutoff for a voice. Both effects remove octaves from the top, so
 * they add in the log domain: c = a·o / 20 kHz (floor 500 Hz).
 */
export function voiceCutoff(d, occ) {
  return Math.max(500, (airCutoff(d) * occlusionCutoff(occ)) / 20000);
}

/**
 * Rough occlusion estimate from tree cover while a bird moves during its bout (the
 * server's CallMsg.occ is only valid where the bout started).
 */
export function canopyOcclusion(canopyBird, canopyListener, d) {
  const c = 0.65 * clamp01(canopyBird || 0) + 0.35 * clamp01(canopyListener || 0);
  return clamp(0.6 * c * Math.min(1, Math.max(0, d) / 25), 0, 0.9);
}

/** Trust the server's occlusion while the bird stays put, the estimate once it moves. */
export function blendOcclusion(msgOcc, estimate, moved) {
  const w = Math.exp(-Math.max(0, moved) / 10);
  return clamp01((+msgOcc || 0) * w + (+estimate || 0) * (1 - w));
}

/** How loud a voice is to the player right now: used to rank voices for stealing. */
export function voicePriority(loud, d, range, occ) {
  return sourceLevel(loud) * callGain(d, range) * occlusionGain(occ);
}

/**
 * Voice stealing. `voices` is an array of {priority, stopping}. Returns whether a new
 * voice of priority `pri` may start and which voice index must be stolen for it
 * (-1 = none). Nearest/loudest win: the quietest active voice is evicted only if the
 * newcomer is louder; otherwise the newcomer is dropped.
 */
export function pickVoiceSlot(voices, pri, cap = MAX_VOICES) {
  if (!(pri > 0)) return { accept: false, victim: -1 };
  let active = 0, low = -1, lowPri = Infinity;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    if (v.stopping) continue;
    active++;
    if (v.priority < lowPri) { lowPri = v.priority; low = i; }
  }
  if (active < cap) return { accept: true, victim: -1 };
  if (pri > lowPri) return { accept: true, victim: low };
  return { accept: false, victim: -1 };
}

/** Reverb send per voice: distant calls are wetter (more of their sound is reflected). */
export function reverbSend(d, range) {
  return 0.08 + 0.32 * clamp01(d / Math.max(1, range));
}

/** Reverb return level at the listener: forests ring, open meadows and coasts are dry. */
export function reverbReturn(canopy, region) {
  let r = 0.18 + 0.7 * clamp01(canopy || 0);
  if (region === 2) r += 0.2;           // Windpeak: echoes off rock faces
  if (region === 3 || region === 255) r *= 0.6; // coast / open sea: open air
  return clamp(r, 0, 1);
}

/** Ambience duck while focus-listening: ~12 dB, deeper with better noise reduction. */
export function focusDuckDb(noiseReduce) {
  return -(12 + 8 * clamp01(+noiseReduce || 0));
}

/** Small lift of the bird bus while focus-listening (dB). */
export const FOCUS_BIRD_BOOST_DB = 2.5;

/** Map an RMS amplitude to a 0..1 loudness meter (−60 dBFS … 0 dBFS). */
export function levelFromRms(rms) {
  if (!(rms > 0)) return 0;
  return clamp01((gainToDb(rms) + 60) / 60);
}

/** Music steps aside when a call is loud: 1 below level 0.25, 0 above 0.6. */
export function musicCallDuck(level) {
  return 1 - smoothstep(0.25, 0.6, level);
}

/** Squared distance helper without allocation. */
export function dist3(ax, ay, az, bx, by, bz) {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
