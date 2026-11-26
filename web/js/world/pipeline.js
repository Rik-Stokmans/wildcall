// The chunk lifecycle: what to request, what to do with each frame that arrives, and
// when meshes are built, swapped and thrown away. Pure: no three.js, no DOM, no
// network — the network and the GPU side are injected, which is what makes the whole
// streaming flow testable in node.
//
//   frame arrives ──► receive(): header peek, Streamer.receive() decides the LOD (or drops it)
//                     └► job queue (one job per chunk coordinate)
//   every frame   ──► tick():  Streamer.plan() → send requests, coarsen, unload
//                 ──► work():  nearest job first, in small slices within a time budget:
//                              parse → height/collision data live → mesher task steps → commit
//
// The mesher is an object with
//   begin(chunk: ChunkData) → { step(): boolean /* true when finished */, commit(), cancel() }
//   remove(cx, cz)          drop whatever is drawn for that chunk and free its GPU memory
//   clear()                 drop everything
// A task's commit() swaps the new meshes in atomically, so a chunk is never blank while
// its replacement is being built.
import { CHUNK_SIZE } from './constants.js';
import { parseChunk, peekChunkHeader, decimateChunk } from './chunkCodec.js';
import { chunkKey, ChunkStore } from './heightfield.js';
import { Collision } from './collision.js';
import { Streamer } from './streamer.js';

/** Seconds between streaming plans (planning is cheap, but not free). */
export const PLAN_INTERVAL = 0.1;

export class WorldPipeline {
  /**
   * @param {object} o
   * @param {(cx:number, cz:number, lod:number) => void} o.request  sends a chunkReq
   * @param {{begin:Function, remove:Function, clear:Function}} o.mesher
   * @param {(cx:number, cz:number, lod:number) => void} [o.onChunk]  a chunk was meshed
   * @param {(err:Error) => void} [o.onError]  a frame could not be used
   * @param {{radius:number, inflight:number}} [o.quality]
   */
  constructor({ request, mesher, onChunk = () => {}, onError = () => {}, quality = { radius: 7, inflight: 6 } }) {
    this.request = request;
    this.mesher = mesher;
    this.onChunk = onChunk;
    this.onError = onError;
    this.store = new ChunkStore();
    this.collision = new Collision();
    this.streamer = new Streamer({ radius: quality.radius, inflight: quality.inflight });
    /** key → job; at most one pending job per chunk coordinate. */
    this.jobs = new Map();
    /** The job being worked on across frames (it stays in `jobs` until done). */
    this.current = null;
    /** key → LOD currently drawn. */
    this.meshed = new Map();
    this.px = 0;
    this.pz = 0;
    this._lastPlan = -Infinity;
    this._now = 0;
    this._plan = { requests: [], downgrades: [], unloads: [] };
    this._ready = null; // {cx, cz, done}
  }

  /** Waits for the chunks around a point to be meshed at lod 0 (see readyNow). */
  watchReady(x, z) {
    this._ready = { cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE), done: false };
  }

  /** True once every chunk of the 3×3 block around the watched point is drawn at lod 0. */
  readyNow() {
    const r = this._ready;
    if (!r) return false;
    if (r.done) return true;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.meshed.get(chunkKey(r.cx + dx, r.cz + dz)) !== 0) return false;
      }
    }
    r.done = true;
    return true;
  }

  /** Applies quality settings (ring radius, requests in flight). */
  configure(q) { this.streamer.configure(q); this._lastPlan = -Infinity; }

  /** Forgets the whole world (a new seed). Registered blockers stay with their owners. */
  reset() {
    this.current?.task?.cancel();
    this.current = null;
    this.jobs.clear();
    this.meshed.clear();
    this.store.clear();
    this.collision.clearChunks();
    this.streamer.reset();
    this.mesher.clear();
    this._lastPlan = -Infinity;
    this._ready = null;
  }

  /** The connection dropped: outstanding requests will never be answered. */
  connectionLost() { this.streamer.clearInflight(); }

  /** Chunks accepted but not yet drawn. */
  get backlog() { return this.jobs.size; }

  /**
   * A binary frame arrived.
   * @param {ArrayBuffer} buf
   */
  receive(buf) {
    const head = peekChunkHeader(buf);
    if (!head) { this.onError(new Error('chunk: unreadable frame header')); return; }
    const target = this.streamer.receive(head.cx, head.cz, head.lod);
    if (target < 0) return;
    this._enqueue(head.cx, head.cz, { lod: target, buf, data: null });
  }

  _enqueue(cx, cz, job) {
    const key = chunkKey(cx, cz);
    if (this.current && this.current.key === key) { this.current.task?.cancel(); this.current = null; }
    job.key = key; job.cx = cx; job.cz = cz; job.task = null;
    this.jobs.set(key, job);
  }

  /**
   * Plans streaming around the player (at most every PLAN_INTERVAL seconds).
   * @param {number} px @param {number} pz  player feet
   * @param {number} vx @param {number} vz  player velocity, m/s
   * @param {number} now  monotonic seconds
   */
  tick(px, pz, vx, vz, now) {
    this.px = px; this.pz = pz;
    this._now = now;
    if (now - this._lastPlan < PLAN_INTERVAL) return;
    this._lastPlan = now;
    const plan = this.streamer.plan(px, pz, vx, vz, now, this.jobs.size, this._plan);
    for (const u of plan.unloads) this._unload(u.cx, u.cz);
    for (const d of plan.downgrades) this._downgrade(d.cx, d.cz, d.lod);
    for (const r of plan.requests) this.request(r.cx, r.cz, r.lod);
  }

  _unload(cx, cz) {
    const key = chunkKey(cx, cz);
    if (this.current && this.current.key === key) { this.current.task?.cancel(); this.current = null; }
    this.jobs.delete(key);
    this.meshed.delete(key);
    this.store.delete(cx, cz);
    this.collision.deleteChunk(cx, cz);
    this.mesher.remove(cx, cz);
  }

  _downgrade(cx, cz, lod) {
    const key = chunkKey(cx, cz);
    const job = this.jobs.get(key);
    if (job) { // not drawn yet: build it at the coarser LOD straight away
      if (job.lod < lod) {
        if (this.current === job) { job.task?.cancel(); job.task = null; this.current = null; }
        if (job.data) job.data = decimateChunk(job.data, lod);
        job.lod = lod;
      }
      return;
    }
    const held = this.store.get(cx, cz);
    if (held && held.lod < lod) this._enqueue(cx, cz, { lod, buf: null, data: decimateChunk(held, lod) });
  }

  /** Rebuilds every drawn chunk from the data already held (quality changed). */
  rebuildAll() {
    for (const chunk of this.store.chunks.values()) {
      const key = chunkKey(chunk.cx, chunk.cz);
      if (!this.jobs.has(key)) this._enqueue(chunk.cx, chunk.cz, { lod: chunk.lod, buf: null, data: chunk });
    }
  }

  _nearestJob() {
    let best = null, bestD = Infinity;
    const pcx = this.px / CHUNK_SIZE - 0.5, pcz = this.pz / CHUNK_SIZE - 0.5;
    for (const job of this.jobs.values()) {
      const dx = job.cx - pcx, dz = job.cz - pcz;
      // Finer jobs sit close to the player anyway; the small LOD term only breaks ties.
      const d = dx * dx + dz * dz + job.lod * 0.25;
      if (d < bestD) { bestD = d; best = job; }
    }
    return best;
  }

  /**
   * Does meshing work until `budgetMs` has passed on `clock` (always at least one step,
   * so a slow machine still makes progress).
   * @param {number} budgetMs
   * @param {() => number} clock  milliseconds
   * @returns {number} steps performed
   */
  work(budgetMs, clock) {
    const t0 = clock();
    let steps = 0;
    do {
      if (!this.current) {
        this.current = this._nearestJob();
        if (!this.current) break;
      }
      this._step(this.current);
      steps++;
    } while (clock() - t0 < budgetMs);
    return steps;
  }

  _step(job) {
    try {
      if (!job.data) { // stage 1: parse (and coarsen, if the player moved on meanwhile)
        let data = parseChunk(job.buf);
        job.buf = null;
        if (data.lod < job.lod) data = decimateChunk(data, job.lod);
        job.data = data;
        return;
      }
      if (!job.task) { // stage 2: the data goes live for queries, meshing starts
        const prev = this.store.get(job.cx, job.cz);
        // Never replace finer query data with coarser data that is about to be drawn
        // unless this job IS the coarsening (the held chunk is then too far to matter).
        if (!prev || prev !== job.data) {
          this.store.set(job.data);
          this.collision.setChunk(job.cx, job.cz, job.data.veg);
        }
        job.task = this.mesher.begin(job.data);
        return;
      }
      if (!job.task.step()) return; // stage 3: mesher slices
      job.task.commit();
      this.jobs.delete(job.key);
      this.current = null;
      this.meshed.set(job.key, job.data.lod);
      this.onChunk(job.cx, job.cz, job.data.lod);
    } catch (err) {
      job.task?.cancel();
      this.jobs.delete(job.key);
      this.current = null;
      const shown = this.meshed.get(job.key);
      this.streamer.fail(job.cx, job.cz, this._now, shown === undefined ? -1 : shown);
      this.onError(err);
    }
  }
}
