// The sample path: real bird recordings (web/birdsong, contract §14).
//
// This file is the pure, testable half: manifest parsing and lookup, rotation between the
// recordings of a call, an LRU cache of decoded buffers, and the fitting of a recording
// to a bout's length. calls.js turns the result into Web Audio nodes.
//
// manifest.json: {version, species: {<species id>: {<call index>: [{file, dur, gain}]}},
// credits: [...]}. A missing or malformed manifest simply means "no recordings": every
// call keeps its synthesised voice.
import { mulberry32 } from './rng.js';

export const BASE_URL = 'birdsong/';
export const MANIFEST_URL = BASE_URL + 'manifest.json';
/** Decoded audio kept in memory (bytes). One minute of mono 48 kHz float is ~11 MB. */
export const CACHE_BYTES = 40 * 1024 * 1024;
/** Per-play variation of gain and playback rate: at most this fraction either way. */
export const VARIATION = 0.02;
/** A bout that has to wait for a recording to load is dropped after this many seconds. */
export const MAX_WAIT_S = 2;

// ---------------------------------------------------------------------------
// Manifest

/**
 * Validate a parsed manifest into a lookup. Entries with unsafe or non-string file
 * names are dropped; dur is 0 when unknown; gain is clamped to 0.1..3.
 * @returns {Map<string, Map<number, {file: string, url: string, dur: number, gain: number}[]>>}
 */
export function parseManifest(json) {
  const out = new Map();
  const sp = json && typeof json === 'object' ? json.species : null;
  if (!sp || typeof sp !== 'object') return out;
  for (const [id, calls] of Object.entries(sp)) {
    if (!calls || typeof calls !== 'object') continue;
    const byCall = new Map();
    for (const [ci, list] of Object.entries(calls)) {
      const idx = Number(ci);
      if (!Number.isInteger(idx) || idx < 0 || !Array.isArray(list)) continue;
      const entries = [];
      for (const e of list) {
        const file = typeof e?.file === 'string' ? e.file : '';
        if (!file || file.startsWith('/') || file.includes('..') || file.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(file)) continue;
        const dur = Number.isFinite(+e.dur) && +e.dur > 0 ? +e.dur : 0;
        const gain = Number.isFinite(+e.gain) && +e.gain > 0 ? Math.min(3, Math.max(0.1, +e.gain)) : 1;
        entries.push({ file, url: BASE_URL + file.split('/').map(encodeURIComponent).join('/'), dur, gain });
      }
      if (entries.length) byCall.set(idx, entries);
    }
    if (byCall.size) out.set(id, byCall);
  }
  return out;
}

// ---------------------------------------------------------------------------
// LRU cache

/** A byte-budgeted least-recently-used cache. Values are never evicted while being set. */
export class LruCache {
  constructor(maxBytes = CACHE_BYTES) {
    this.maxBytes = maxBytes;
    this.map = new Map(); // key -> {value, bytes}; insertion order = recency
    this.bytes = 0;
  }
  get size() { return this.map.size; }
  has(key) { return this.map.has(key); }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e); // most recent last
    return e.value;
  }
  set(key, value, bytes) {
    const old = this.map.get(key);
    if (old) { this.bytes -= old.bytes; this.map.delete(key); }
    this.map.set(key, { value, bytes });
    this.bytes += bytes;
    for (const [k, e] of this.map) {
      if (this.bytes <= this.maxBytes || this.map.size <= 1) break;
      if (k === key) continue;
      this.map.delete(k);
      this.bytes -= e.bytes;
    }
  }
  clear() { this.map.clear(); this.bytes = 0; }
}

/** Decoded size of an AudioBuffer-like in bytes (32-bit float samples). */
export function bufferBytes(buf) {
  return Math.max(1, (buf?.length | 0) * Math.max(1, buf?.numberOfChannels | 0) * 4);
}

// ---------------------------------------------------------------------------
// Bank: manifest + rotation + lazy decoding

export class SampleBank {
  /**
   * @param {{fetchJson?: (url: string) => Promise<any>, fetchBytes?: (url: string) => Promise<ArrayBuffer>,
   *   decode: (bytes: ArrayBuffer) => Promise<any>, maxBytes?: number}} io injected so tests need no network
   */
  constructor(io) {
    this.io = io;
    this.manifest = new Map();
    this.cache = new LruCache(io.maxBytes ?? CACHE_BYTES);
    this.pending = new Map(); // url -> Promise<buffer|null>
    this.failed = new Set(); // urls that could not be fetched/decoded: not tried again
    this.bags = new Map(); // "id/call" -> remaining shuffled indices
    this.last = new Map(); // "id/call" -> last index played
    this.loaded = null;
  }

  /** Load the manifest once. Never rejects. */
  load() {
    this.loaded ??= (async () => {
      try {
        const json = await this.io.fetchJson(MANIFEST_URL);
        this.manifest = parseManifest(json);
      } catch { this.manifest = new Map(); }
      return this.manifest.size;
    })();
    return this.loaded;
  }

  /** Recordings of a species' call (empty array when there are none). */
  list(speciesId, callIndex) {
    return this.manifest.get(speciesId)?.get(callIndex | 0) || [];
  }

  has(speciesId, callIndex) {
    return this.list(speciesId, callIndex).some((e) => !this.failed.has(e.url));
  }

  /**
   * The next recording of a call. Recordings take turns: a shuffled bag is emptied
   * before it is refilled, and the refill never starts with the one just played, so a
   * bird does not sing the same take twice in a row while others exist.
   * @param {number} seed picks the shuffle (CallMsg.seed)
   */
  pick(speciesId, callIndex, seed = 1) {
    const all = this.list(speciesId, callIndex).filter((e) => !this.failed.has(e.url));
    if (!all.length) return null;
    if (all.length === 1) return all[0];
    const key = `${speciesId}/${callIndex | 0}`;
    let bag = this.bags.get(key) || [];
    bag = bag.filter((i) => i < all.length);
    if (!bag.length) {
      const rng = mulberry32((seed >>> 0) ^ 0x9e3779b1);
      bag = all.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      const last = this.last.get(key);
      if (bag[0] === last) { const k = bag.length - 1; [bag[0], bag[k]] = [bag[k], bag[0]]; }
    }
    const i = bag.shift();
    this.bags.set(key, bag);
    this.last.set(key, i);
    return all[i];
  }

  /** The decoded buffer when it is already in memory (and counts as used), else null. */
  cached(entry) {
    return this.cache.get(entry.url) || null;
  }

  /** Fetch and decode a recording (once, however many callers wait). Resolves null on failure. */
  ensure(entry) {
    const hit = this.cache.get(entry.url);
    if (hit) return Promise.resolve(hit);
    if (this.failed.has(entry.url)) return Promise.resolve(null);
    let p = this.pending.get(entry.url);
    if (!p) {
      p = (async () => {
        try {
          const bytes = await this.io.fetchBytes(entry.url);
          const buf = await this.io.decode(bytes);
          if (!buf || !(buf.length > 0)) throw new Error('empty audio');
          this.cache.set(entry.url, buf, bufferBytes(buf));
          return buf;
        } catch {
          this.failed.add(entry.url);
          return null;
        } finally {
          this.pending.delete(entry.url);
        }
      })();
      this.pending.set(entry.url, p);
    }
    return p;
  }

  /** Warm the cache for every recording of a call, without waiting. */
  prefetch(speciesId, callIndex) {
    for (const e of this.list(speciesId, callIndex)) if (!this.cache.has(e.url) && !this.failed.has(e.url)) this.ensure(e);
  }
}

// ---------------------------------------------------------------------------
// Fitting a recording to a bout

/** Longest start offset into a long recording (s). */
const MAX_OFFSET = 1;
/** Hard cap on how often a short recording repeats inside one bout. */
const MAX_SEGMENTS = 16;

/**
 * Decide how a recording of `recDur` seconds fills a bout of `boutDur` seconds.
 *  - long enough: played once, from a small random offset when there is slack, cut at the
 *    bout's end with a fade-out (a recording that is only a little longer plays out whole);
 *  - shorter: repeated with a natural, slightly varying gap, the last repeat cut and faded
 *    at the bout's end (a repeat would play less than half of the take is not started).
 *  - boutDur <= 0 (journal playback with no length asked for): the whole recording once.
 * Every segment also carries a per-play gain and playback-rate variation within
 * +-VARIATION.
 * @param {number} recDur seconds of audio
 * @param {number} boutDur target length in seconds (<= 0: none)
 * @param {() => number} rng
 * @param {{gap?: number}} [o] gap: the call's phrase gap (s), sets the pause between repeats
 * @returns {{duration: number, segments: {at: number, offset: number, len: number, fadeOut: number, rate: number, gain: number}[]}}
 */
export function fitBout(recDur, boutDur, rng, o = {}) {
  const rec = Math.max(0.05, +recDur || 0.05);
  const bout = boutDur > 0 && Number.isFinite(boutDur) ? boutDur : 0;
  const vary = () => ({ rate: 1 + (rng() * 2 - 1) * VARIATION, gain: 1 + (rng() * 2 - 1) * VARIATION });
  const tail = (len) => Math.min(0.6, Math.max(0.05, len * 0.2));
  if (!bout || bout >= rec * 0.92 && bout <= rec * 1.1) {
    // Plays whole (a bout within ~10% of the recording is not worth cutting or looping).
    const len = bout ? Math.min(rec, Math.max(bout, rec * 0.92)) : rec;
    return { duration: len, segments: [{ at: 0, offset: 0, len, fadeOut: len < rec ? tail(len) : 0, ...vary() }] };
  }
  if (rec > bout) {
    const slack = rec - bout;
    const offset = slack > 1.2 ? rng() * Math.min(MAX_OFFSET, 0.25 * slack) : 0;
    return { duration: bout, segments: [{ at: 0, offset, len: bout, fadeOut: tail(bout), ...vary() }] };
  }
  // Shorter than the bout: loop with a natural gap.
  const base = Math.min(2.5, Math.max(0.35, +o.gap || 0.8));
  const segments = [];
  let at = 0;
  while (segments.length < MAX_SEGMENTS) {
    const left = bout - at;
    if (segments.length && left < rec * 0.5) break;
    const len = Math.min(rec, left);
    segments.push({ at, offset: 0, len, fadeOut: len < rec ? tail(len) : 0, ...vary() });
    at += rec + base * (0.8 + 0.4 * rng());
    if (len < rec) break;
  }
  const last = segments[segments.length - 1];
  return { duration: Math.min(bout, last.at + last.len), segments };
}
