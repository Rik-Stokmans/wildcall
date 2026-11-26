// Wire constants for bird snapshots and the appearance vocabulary.
//
// SOURCE: internal/core/sim.go (BirdAct, Flag* bits), internal/proto/messages.go
// (BirdsMsg array layout) and internal/species/catalog.go Validate (vocabulary).
// The numeric values are the wire protocol: they must match the Go constants exactly
// and are append-only there, so never reorder them here either.
// Pure module: no three.js, no DOM.

/** core.BirdAct wire values (internal/core/sim.go). */
export const ACT = Object.freeze({
  PERCHED: 0,
  FORAGING: 1,
  FEEDING: 2,
  FLYING: 3,
  SOARING: 4,
  HOVERING: 5,
  SWIMMING: 6,
  WADING: 7,
  CLIMBING: 8,
  ALERT: 9,
  FLEEING: 10,
  HIDING: 11,
  ROOSTING: 12,
  PREENING: 13,
  BATHING: 14,
  DIVING: 15,
  SOCIAL: 16,
  NESTING: 17,
});

/** Number of known acts (core.ActCount). Unknown future values fall back to PERCHED. */
export const ACT_COUNT = 18;

/** core.actKeys, indexed by ACT value. */
export const ACT_KEYS = Object.freeze([
  'perched', 'foraging', 'feeding', 'flying', 'soaring', 'hovering', 'swimming', 'wading',
  'climbing', 'alert', 'fleeing', 'hiding', 'roosting', 'preening', 'bathing', 'diving',
  'social', 'nesting',
]);

/** Mirrors core.BirdAct.Airborne(). */
export function isAirborneAct(act) {
  return act === ACT.FLYING || act === ACT.SOARING || act === ACT.HOVERING ||
    act === ACT.FLEEING || act === ACT.DIVING;
}

/** core Flag* bits (internal/core/sim.go). */
export const FLAG = Object.freeze({
  SINGING: 1 << 0,
  WARY: 1 << 1,
  HIDDEN: 1 << 2,
  RARE_PLUMAGE: 1 << 3,
  VAGRANT: 1 << 4,
  HABITUATED: 1 << 5,
});

/** proto.BirdsMsg: each bird is [id, speciesIndex, act, flags, x, y, z, yaw, speed]. */
export const SNAP = Object.freeze({ ID: 0, SP: 1, ACT: 2, FLAGS: 3, X: 4, Y: 5, Z: 6, YAW: 7, SPEED: 8, LEN: 9 });

/** Server snapshot rate (core.TickHz). */
export const TICK_HZ = 10;

// --- appearance / movement vocabulary (internal/species/catalog.go Validate) ---------
export const BILL_SHAPES = Object.freeze(['cone', 'thin', 'dagger', 'hooked', 'flat', 'curved', 'chisel']);
export const TAIL_SHAPES = Object.freeze(['square', 'forked', 'fan', 'pointed', 'cocked']);
export const WING_SHAPES = Object.freeze(['rounded', 'pointed', 'broad', 'long']);
export const MARK_KINDS = Object.freeze([
  'breast', 'cap', 'mask', 'eyestripe', 'wingbar', 'bib', 'collar', 'rump', 'cheek', 'spots',
  'streaks', 'tailtip', 'bars', 'throat', 'nape', 'wingpatch',
]);
export const FLIGHT_STYLES = Object.freeze(['direct', 'undulating', 'soaring', 'hover', 'flapglide', 'darting', 'buoyant', 'whirring']);
export const GROUND_MODES = Object.freeze(['hop', 'walk', 'wade', 'swim', 'cling', 'none']);

// --- rendering constants ------------------------------------------------------------
/** Render this far in the past so there is (almost) always a later snapshot to blend to. */
export const INTERP_DELAY = 0.12;
/** Full models within this distance; a speck beyond (with hysteresis). */
export const LOD_NEAR = 120;
export const LOD_HYST = 8;
/** Spawn / despawn scale-fade durations (seconds). */
export const FADE_IN = 0.3;
export const FADE_OUT = 0.25;
/** Upper bound on simultaneously tracked birds (server sends birds within 260 m). */
export const MAX_BIRDS = 1024;
