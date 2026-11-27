// Mix check by numbers: a pure model of what each bus carries, so the balance can be
// verified without listening (mixmodel.test.js). Nobody can hear this file; it estimates.
//
// Everything is an RMS amplitude (linear, 1 = full scale) at the INPUT of the master
// stage, after each bus's user volume, summed in power (sources are uncorrelated).
// The constants below are the model's assumptions, each from how the engine builds the
// sound; they are pessimistic for the layers that must stay behind the birds and
// realistic for the birds, so passing tests mean something and failing ones are real.
import { dbToGain, gainToDb, callGain, sourceLevel, audibleRange, musicCallDuck, levelFromRms } from './curves.js';
import { ambienceMix, ambienceLoad, loadCompensation } from './mix.js';
import { TRIM } from './ambience.js';
import { wildlifeRates, wildlifeWorstCase } from './wildmodel.js';
import { duckTargets } from './narratorbus.js';

/** RMS of the filtered noise beds relative to their gain trim (white/pink/brown, filtered). */
export const NOISE_RMS = 0.2;
/** A synthesised note's RMS relative to its amp (sine ~0.71, buzzes/trills less after the band-pass, rests). */
export const NOTE_RMS = 0.4;
/** calls.js BIRD_HEADROOM. */
export const BIRD_HEADROOM = 0.5;
/** Generative music bed (pads, a few soft notes), RMS before its user volume. */
export const MUSIC_RMS = 0.05;
/** The narrator's clips, RMS before his volume (a normalised speech file). */
export const NARRATOR_RMS = 0.12;
/** Peak / RMS of the summed mix (birdsong is peaky, noise beds are not). */
export const CREST = 3;

/** engine.js limiter threshold (dBFS) and the headroom the mix must keep below it. */
export const LIMITER_DB = -6;
export const HEADROOM_DB = 0.5;
/** Wildlife and ambience must sit at least this far under a typical nearby song. */
export const BIRD_MASK_DB = 6;

/** RMS of one bird song heard at distance d: source level x distance law x note RMS x headroom. */
export function songRms(d = 8, loud = 0.45, hearRange = 1) {
  const range = audibleRange(loud, { hearRange }, 0);
  return sourceLevel(loud) * callGain(d, range) * NOTE_RMS * BIRD_HEADROOM;
}

/** RMS of several singers at the given distances (a dawn chorus). */
export function chorusRms(dists, loud = 0.45) {
  let p = 0;
  for (const d of dists) { const r = songRms(d, loud); p += r * r; }
  return Math.sqrt(p);
}

/** RMS of the ambience bed for an ambienceMix(), before the ambient user volume. */
export function ambienceRms(mix) {
  const load = ambienceLoad(mix, TRIM);
  return Math.sqrt(load) * loadCompensation(load) * NOISE_RMS;
}

/**
 * Bus levels for a state, after the user volumes and ducks.
 * @param {object} s
 * @param {object} s.env, s.region, s.canopy, s.habitat, s.creekDist, s.waterDist, s.seaDist, s.altitude
 * @param {number[]} s.singers distances (m) of birds singing now
 * @param {boolean} [s.narrator] the narrator is speaking
 * @param {object} [s.vol] settings volumes {volMaster, volBirds, volAmbient, volMusic, volNarrator}
 * @returns {{birds:number, ambience:number, wildlife:number, music:number, narrator:number,
 *   bed:number, total:number, peak:number, peakDb:number, songNearby:number}} RMS values
 */
export function busLevels(s) {
  const vol = { volMaster: 0.8, volBirds: 1, volAmbient: 0.7, volMusic: 0.35, volNarrator: 0.9, ...(s.vol || {}) };
  const mix = ambienceMix({
    env: s.env, region: s.region, canopy: s.canopy, creekDist: s.creekDist ?? Infinity,
    waterDist: s.waterDist ?? Infinity, seaDist: s.seaDist ?? Infinity, altitude: s.altitude ?? 0,
  });
  const rates = wildlifeRates({
    env: s.env, region: s.region, habitat: s.habitat ?? -1, canopy: s.canopy,
    waterDist: s.waterDist ?? Infinity, seaDist: s.seaDist ?? Infinity,
    creekDist: s.creekDist ?? Infinity, wetness: s.wetness ?? 0,
  });
  const duck = duckTargets(!!s.narrator);
  const birds = chorusRms(s.singers || []) * vol.volBirds;
  const ambBed = ambienceRms(mix);
  const wild = wildlifeWorstCase(rates).rms;
  const ambDuck = dbToGain(duck.ambienceDb);
  const ambience = ambBed * vol.volAmbient * ambDuck;
  const wildlife = wild * vol.volAmbient * ambDuck;
  const lvl = levelFromRms(birds * 2);
  const music = MUSIC_RMS * vol.volMusic * musicCallDuck(lvl) * dbToGain(duck.musicDb);
  const narrator = s.narrator ? NARRATOR_RMS * vol.volNarrator : 0;
  const bed = Math.hypot(ambience, wildlife);
  const total = Math.sqrt(birds * birds + ambience * ambience + wildlife * wildlife + music * music + narrator * narrator) * vol.volMaster;
  const peak = total * CREST;
  return {
    birds, ambience, wildlife, music, narrator, bed, total, peak, peakDb: gainToDb(peak),
    songNearby: songRms(8) * vol.volBirds, rates, mix,
  };
}

/** dB of a / b (Infinity-safe). */
export function dbBelow(ref, x) {
  return gainToDb(ref) - gainToDb(x);
}
