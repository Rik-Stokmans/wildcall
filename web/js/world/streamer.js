// Decides which chunks to request, coarsen and unload as the player travels.
// Pure bookkeeping: no three.js, no DOM, no network — the caller sends what plan() asks
// for and reports what arrives.
//
// The world is unbounded, so everything here is relative to the player's chunk:
//   * chunks are wanted inside a disc of `radius` chunks (the far ring is round — the
//     corners of a square would be hidden by fog anyway and cost 27 % more chunks);
//   * the LOD wanted for a chunk depends on its Chebyshev distance: lod 0 within 2
//     chunks, lod 1 to 4, lod 2 beyond (contract §5.2);
//   * refining needs the server, coarsening does not (see decimateChunk), and both
//     coarsening and unloading lag one chunk behind so that pacing back and forth
//     across a chunk border never thrashes.
import { CHUNK_SIZE, LOD0_RING, LOD1_RING } from './constants.js';
import { chunkKey, keyCx, keyCz } from './heightfield.js';

/** Extra chunks beyond the ring before a loaded chunk is dropped. */
export const UNLOAD_MARGIN = 1;
/** Extra chunks beyond a LOD ring before a loaded chunk is coarsened. */
export const LOD_MARGIN = 1;
/** Seconds after which an unanswered request may be sent again. */
export const REQUEST_TIMEOUT = 5;
/** How far ahead (seconds of travel) loading is biased towards the direction of travel. */
export const LEAD_SECONDS = 12;
/** Speeds above this do not increase the bias further (m/s; a sprint is 6.5). */
export const LEAD_MAX_SPEED = 7;

/** LOD wanted at a Chebyshev chunk distance. */
export function lodForRing(d) {
  return d <= LOD0_RING ? 0 : d <= LOD1_RING ? 1 : 2;
}

/** True if the chunk offset (dx, dz) lies inside the streaming disc. */
export function inRing(dx, dz, radius) {
  const r = radius + 0.5;
  return dx * dx + dz * dz <= r * r;
}

/** LOD wanted for a chunk offset, or -1 outside the ring. */
export function wantedLod(dx, dz, radius) {
  return inRing(dx, dz, radius) ? lodForRing(Math.max(Math.abs(dx), Math.abs(dz))) : -1;
}

/**
 * LOD a chunk that is currently held at `lod` should be kept at: unchanged while it
 * is within one chunk of where that LOD is wanted, otherwise the LOD wanted there.
 */
export function settledLod(dx, dz, lod) {
  const d = Math.max(Math.abs(dx), Math.abs(dz));
  return lodForRing(d - LOD_MARGIN) > lod ? lodForRing(d) : lod;
}

/** True if a loaded chunk at this offset is far enough outside the ring to drop. */
export function shouldUnload(dx, dz, radius) {
  const r = radius + 0.5 + UNLOAD_MARGIN;
  return dx * dx + dz * dz > r * r;
}

const ringCache = new Map();

/**
 * Every chunk offset inside the ring, sorted near to far.
 * @returns {{count:number, dx:Int16Array, dz:Int16Array, dist:Float32Array}}
 */
export function ringOffsets(radius) {
  let ring = ringCache.get(radius);
  if (ring) return ring;
  const list = [];
  const r = Math.ceil(radius + 0.5);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (inRing(dx, dz, radius)) list.push([dx, dz, Math.hypot(dx, dz)]);
    }
  }
  // Ties are broken by angle so the order is deterministic and spirals outwards.
  list.sort((a, b) => a[2] - b[2] || Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  ring = {
    count: list.length,
    dx: Int16Array.from(list, (o) => o[0]),
    dz: Int16Array.from(list, (o) => o[1]),
    dist: Float32Array.from(list, (o) => o[2]),
  };
  ringCache.set(radius, ring);
  return ring;
}

/**
 * @typedef {object} Plan
 * @property {{cx:number, cz:number, lod:number}[]} requests    send as chunkReq, in this order
 * @property {{cx:number, cz:number, lod:number}[]} downgrades  coarsen locally to this LOD
 * @property {{cx:number, cz:number}[]} unloads                 dispose
 */

export class Streamer {
  /**
   * @param {object} [opts]
   * @param {number} [opts.radius]    ring radius in chunks
   * @param {number} [opts.inflight]  requests allowed in flight at once
   * @param {number} [opts.timeout]   seconds before an unanswered request is retried
   */
  constructor({ radius = 7, inflight = 6, timeout = REQUEST_TIMEOUT } = {}) {
    this.radius = radius;
    this.cap = inflight;
    this.timeout = timeout;
    /** key → LOD held (meshed, or accepted and waiting to be meshed). */
    this.have = new Map();
    /** key → {lod, t}: requests sent and not yet answered. */
    this.inflight = new Map();
    this.pcx = 0;
    this.pcz = 0;
    this._alloc(inflight);
  }

  _alloc(cap) {
    this._score = new Float64Array(cap);
    this._pick = new Int32Array(cap);
  }

  /** Applies new quality settings; the next plan() adapts the loaded set. */
  configure({ radius, inflight }) {
    if (radius > 0) this.radius = radius;
    if (inflight > 0 && inflight !== this.cap) { this.cap = inflight; this._alloc(inflight); }
  }

  /** Forgets everything (new world). */
  reset() {
    this.have.clear();
    this.inflight.clear();
  }

  /** Forgets unanswered requests (the connection dropped; they will never arrive). */
  clearInflight() { this.inflight.clear(); }

  /** LOD held for a chunk, or -1. */
  lodOf(cx, cz) {
    const lod = this.have.get(chunkKey(cx, cz));
    return lod === undefined ? -1 : lod;
  }

  /**
   * Plans one streaming step around the player.
   * @param {number} px  player position, metres
   * @param {number} pz
   * @param {number} vx  player velocity, m/s (biases loading towards where they are going)
   * @param {number} vz
   * @param {number} now  monotonic seconds
   * @param {number} backlog  chunks that have arrived but are not meshed yet; they
   *        count against the in-flight budget so data never piles up faster than it is built
   * @param {Plan} out  arrays are cleared and refilled
   * @returns {Plan}
   */
  plan(px, pz, vx, vz, now, backlog, out) {
    out.requests.length = 0;
    out.downgrades.length = 0;
    out.unloads.length = 0;
    const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
    this.pcx = pcx; this.pcz = pcz;

    for (const [key, req] of this.inflight) {
      if (now - req.t > this.timeout) this.inflight.delete(key);
    }

    for (const [key, lod] of this.have) {
      const cx = keyCx(key), cz = keyCz(key);
      const dx = cx - pcx, dz = cz - pcz;
      if (shouldUnload(dx, dz, this.radius)) {
        this.have.delete(key);
        out.unloads.push({ cx, cz });
        continue;
      }
      const keep = settledLod(dx, dz, lod);
      if (keep !== lod) {
        this.have.set(key, keep);
        out.downgrades.push({ cx, cz, lod: keep });
      }
    }

    const budget = Math.min(this.cap, this.cap - this.inflight.size - backlog);
    if (budget <= 0) return out;

    const speed = Math.hypot(vx, vz);
    let ux = 0, uz = 0, lead = 0;
    if (speed > 0.3) {
      ux = vx / speed; uz = vz / speed;
      lead = Math.min(speed, LEAD_MAX_SPEED) * LEAD_SECONDS;
    }

    // Keep the `budget` best-scoring candidates, sorted, without allocating.
    const ring = ringOffsets(this.radius);
    const score = this._score, pick = this._pick;
    let found = 0;
    for (let i = 0; i < ring.count; i++) {
      // The ring is sorted by distance, so once the nearest any remaining chunk could
      // score is worse than the worst candidate kept, nothing later can displace it.
      if (found === budget && (ring.dist[i] - 1.5) * CHUNK_SIZE - lead > score[found - 1]) break;
      const dx = ring.dx[i], dz = ring.dz[i];
      const key = chunkKey(pcx + dx, pcz + dz);
      const want = lodForRing(Math.max(Math.abs(dx), Math.abs(dz)));
      const cur = this.have.get(key);
      if (cur !== undefined && cur <= want) continue;
      if (this.inflight.has(key)) continue;
      const ox = (pcx + dx + 0.5) * CHUNK_SIZE - px;
      const oz = (pcz + dz + 0.5) * CHUNK_SIZE - pz;
      const dist = Math.hypot(ox, oz);
      const s = dist - lead * (ox * ux + oz * uz) / Math.max(dist, 1);
      if (found === budget && s >= score[found - 1]) continue;
      let j = found < budget ? found++ : found - 1;
      while (j > 0 && score[j - 1] > s) { score[j] = score[j - 1]; pick[j] = pick[j - 1]; j--; }
      score[j] = s; pick[j] = i;
    }
    for (let j = 0; j < found; j++) {
      const i = pick[j];
      const cx = pcx + ring.dx[i], cz = pcz + ring.dz[i];
      const lod = lodForRing(Math.max(Math.abs(ring.dx[i]), Math.abs(ring.dz[i])));
      this.inflight.set(chunkKey(cx, cz), { lod, t: now });
      out.requests.push({ cx, cz, lod });
    }
    return out;
  }

  /**
   * Reports an arrived chunk. Returns the LOD it should be meshed at (its own, or a
   * coarser one if the player has moved on since it was requested), or -1 if it is
   * no longer useful and should be dropped.
   */
  receive(cx, cz, lod) {
    const key = chunkKey(cx, cz);
    const req = this.inflight.get(key);
    // A late reply to an older, coarser request must not cancel a finer one in flight.
    if (req && lod <= req.lod) this.inflight.delete(key);
    const dx = cx - this.pcx, dz = cz - this.pcz;
    if (shouldUnload(dx, dz, this.radius)) return -1;
    const target = settledLod(dx, dz, lod);
    const cur = this.have.get(key);
    if (cur !== undefined && cur <= target) return -1;
    this.have.set(key, target);
    return target;
  }

  /**
   * Reports that an accepted chunk could not be meshed. The chunk falls back to
   * `heldLod` (what is still on screen there, -1 for nothing) and is not asked for
   * again for `delay` seconds, so a persistently bad chunk cannot cause a request storm.
   */
  fail(cx, cz, now, heldLod = -1, delay = 10) {
    const key = chunkKey(cx, cz);
    if (heldLod >= 0) this.have.set(key, heldLod); else this.have.delete(key);
    this.inflight.set(key, { lod: 0, t: now + delay - this.timeout });
  }
}
