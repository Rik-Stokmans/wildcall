// Snapshot buffering and interpolation for birds. Pure module (no three.js, no DOM).
//
// The server sends `birds` snapshots at 10 Hz. Each sample is time-stamped on a local
// timeline derived from the server tick (robust to network jitter), and the renderer
// samples every bird ~120 ms in the past so there is nearly always a newer sample to
// blend towards. If snapshots are late we extrapolate briefly along the last motion,
// then hold. A bird missing from a snapshot has left: it starts fading out and is
// reaped once the fade is done.
//
// Never a snap, never a slide through trees: a step between two samples that no bird
// could fly (faster than JUMP_SPEED, or longer than TELEPORT_DIST) is a jump — the
// bird is not dragged along the straight line but shrinks away where it was and grows
// back where it now is (`out.fade`, a cross-fade over JUMP_FADE seconds either side of
// the jump). Sampling also looks ahead: `out.nextAct` / `out.nextIn` tell the animator
// a take-off or a landing is coming (the render runs ~120 ms behind the newest data),
// so a bird can crouch before it springs and flare before it lands.

import { SNAP, TICK_HZ, FADE_OUT } from './constants.js';

const TAU = Math.PI * 2;
/** Samples kept per bird. 8 × 100 ms covers the delay plus generous jitter. */
export const TRACK_LEN = 8;
/** Longest we keep extrapolating past the newest sample (seconds). */
export const MAX_EXTRAP = 0.25;
/** A jump longer than this between consecutive samples is always a jump (cross-faded, never glided). */
export const TELEPORT_DIST = 60;
/** Faster than any bird flies (m/s): a step implying more is a jump (a fast puffin is ~33 m/s). */
export const JUMP_SPEED = 55;
/** Steps shorter than this are never jumps (jitter, re-stamped packets). */
export const JUMP_MIN = 6;
/** Seconds a jump fades out before and fades in after the jump instant. */
export const JUMP_FADE = 0.22;

/** Wrap an angle to (-π, π]. */
export function wrapAngle(a) {
  a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a === -Math.PI ? Math.PI : a;
}

/** Signed shortest angular difference b − a in (-π, π]. */
export function angleDiff(a, b) { return wrapAngle(b - a); }

/** Interpolate angles along the shortest arc; result wrapped to (-π, π]. */
export function lerpAngle(a, b, t) { return wrapAngle(a + angleDiff(a, b) * t); }

/**
 * Maps server ticks to the local clock. offset ≈ arrival − tick/TICK_HZ, tracked as a
 * lower envelope: an early packet pulls it down at once, late packets only nudge it up,
 * so jitter does not shake the timeline while slow drift is still followed.
 */
export class TickClock {
  constructor() { this.offset = 0; this.lastTick = -1; this.ready = false; }
  reset() { this.ready = false; this.lastTick = -1; }
  /** Local timestamp for a snapshot with `tick` that arrived at local time `arrival`. */
  stamp(tick, arrival) {
    if (typeof tick !== 'number' || !Number.isFinite(tick)) return arrival;
    const st = tick / TICK_HZ;
    const o = arrival - st;
    // First packet, server restart (tick went backwards) or a big discontinuity: resync.
    if (!this.ready || tick < this.lastTick || Math.abs(o - this.offset) > 1.5) {
      this.offset = o;
      this.ready = true;
    } else if (o < this.offset) {
      this.offset = o;
    } else {
      this.offset += (o - this.offset) * 0.03;
    }
    this.lastTick = tick;
    return st + this.offset;
  }
}

/** A fixed-size ring buffer of samples for one bird. */
export function createTrack() {
  return {
    n: 0, head: 0,
    t: new Float64Array(TRACK_LEN),
    x: new Float64Array(TRACK_LEN), y: new Float64Array(TRACK_LEN), z: new Float64Array(TRACK_LEN),
    yaw: new Float64Array(TRACK_LEN), speed: new Float64Array(TRACK_LEN),
    act: new Uint8Array(TRACK_LEN), flags: new Uint8Array(TRACK_LEN),
    jump: new Uint8Array(TRACK_LEN), // 1 = this sample is not reachable by flight from the previous one
  };
}

/** Is a step of `dist` metres over `dt` seconds more than a bird could fly? */
export function isJump(dist, dt) {
  if (!(dist > JUMP_MIN)) return false;
  return dist > TELEPORT_DIST || dist > JUMP_SPEED * Math.max(dt, 0.1);
}

export function clearTrack(tr) { tr.n = 0; tr.head = 0; }

/** Buffer index of the k-th sample, k = 0 oldest … n−1 newest. */
function idx(tr, k) { return (tr.head - tr.n + k + TRACK_LEN * 2) % TRACK_LEN; }

/** Append a sample. Out-of-order / duplicate samples replace or are dropped. */
export function pushSample(tr, t, x, y, z, yaw, speed, act, flags) {
  if (tr.n > 0) {
    const last = idx(tr, tr.n - 1);
    const lt = tr.t[last];
    if (t < lt - 0.5) clearTrack(tr); // timeline restarted
    else if (t < lt - 1e-6) return; // stale packet: newer data already buffered
    else if (t <= lt + 1e-6) { tr.n--; tr.head = (tr.head - 1 + TRACK_LEN) % TRACK_LEN; } // same instant: replace
  }
  let jump = 0;
  if (tr.n > 0) {
    const p = idx(tr, tr.n - 1);
    const dx = x - tr.x[p], dy = y - tr.y[p], dz = z - tr.z[p];
    if (isJump(Math.sqrt(dx * dx + dy * dy + dz * dz), t - tr.t[p])) jump = 1;
  }
  const i = tr.head;
  tr.jump[i] = jump;
  tr.t[i] = t; tr.x[i] = x; tr.y[i] = y; tr.z[i] = z;
  tr.yaw[i] = wrapAngle(yaw); tr.speed[i] = speed; tr.act[i] = act; tr.flags[i] = flags;
  tr.head = (tr.head + 1) % TRACK_LEN;
  if (tr.n < TRACK_LEN) tr.n++;
}

/**
 * Reusable sample result. Beyond the interpolated state: `fade` 0..1 (a jump's
 * cross-fade; 1 normally), `nextAct` / `nextIn` (the next different act in the
 * buffered future and the seconds until it; -1 / Infinity when none is known).
 */
export function createSample() {
  return {
    x: 0, y: 0, z: 0, yaw: 0, speed: 0, act: 0, flags: 0, vx: 0, vy: 0, vz: 0, yawRate: 0,
    extrapolated: false, valid: false, fade: 1, nextAct: -1, nextIn: Infinity,
  };
}

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Cross-fade factor at render time rt from the jumps in the buffer (1 = none near). */
function jumpFade(tr, rt) {
  let f = 1;
  for (let k = 1; k < tr.n; k++) {
    const i = idx(tr, k);
    if (!tr.jump[i]) continue;
    // The bird vanishes over JUMP_FADE before the jump instant and grows back after it.
    const g = smooth01(Math.abs(rt - tr.t[i]) / JUMP_FADE);
    if (g < f) f = g;
  }
  return f;
}

/** Fill nextAct / nextIn: the first buffered sample after rt whose act differs from out.act. */
function lookAhead(tr, rt, out) {
  out.nextAct = -1; out.nextIn = Infinity;
  for (let k = 0; k < tr.n; k++) {
    const i = idx(tr, k);
    if (tr.t[i] <= rt) continue;
    if (tr.act[i] !== out.act) { out.nextAct = tr.act[i]; out.nextIn = tr.t[i] - rt; return; }
  }
}

function setFrom(tr, i, out) {
  out.x = tr.x[i]; out.y = tr.y[i]; out.z = tr.z[i];
  out.yaw = tr.yaw[i]; out.speed = tr.speed[i]; out.act = tr.act[i]; out.flags = tr.flags[i];
}

/**
 * Sample a track at render time rt into out (no allocation). Discrete fields (act,
 * flags) come from the sample at or before rt so behaviour changes line up with motion.
 */
export function sampleTrack(tr, rt, out) {
  sampleRaw(tr, rt, out);
  if (!out.valid) { out.fade = 1; out.nextAct = -1; out.nextIn = Infinity; return out; }
  out.fade = tr.n > 1 ? jumpFade(tr, rt) : 1;
  lookAhead(tr, rt, out);
  return out;
}

function sampleRaw(tr, rt, out) {
  out.valid = tr.n > 0;
  out.extrapolated = false;
  out.vx = out.vy = out.vz = out.yawRate = 0;
  if (tr.n === 0) return out;
  const first = idx(tr, 0), newest = idx(tr, tr.n - 1);
  if (tr.n === 1 || rt <= tr.t[first]) {
    setFrom(tr, rt <= tr.t[first] ? first : newest, out);
    return out;
  }
  if (rt >= tr.t[newest]) {
    // Late: extrapolate along the last segment for a short while, then hold.
    const prev = idx(tr, tr.n - 2);
    const dt = tr.t[newest] - tr.t[prev];
    setFrom(tr, newest, out);
    if (dt > 1e-4 && !tr.jump[newest]) {
      const vx = (tr.x[newest] - tr.x[prev]) / dt;
      const vy = (tr.y[newest] - tr.y[prev]) / dt;
      const vz = (tr.z[newest] - tr.z[prev]) / dt;
      const yr = angleDiff(tr.yaw[prev], tr.yaw[newest]) / dt;
      const late = rt - tr.t[newest];
      const e = Math.min(late, MAX_EXTRAP);
      out.x += vx * e; out.y += vy * e; out.z += vz * e;
      out.yaw = wrapAngle(out.yaw + yr * e);
      out.extrapolated = late > 1e-6;
      if (late < MAX_EXTRAP) { out.vx = vx; out.vy = vy; out.vz = vz; out.yawRate = yr; }
    }
    return out;
  }
  for (let k = tr.n - 2; k >= 0; k--) {
    const a = idx(tr, k);
    if (tr.t[a] <= rt) {
      const b = idx(tr, k + 1);
      if (tr.jump[b]) {
        // Not reachable by flight: hold where it was until the jump instant (where the
        // cross-fade has shrunk it to nothing), then it is where it now is. Never slide.
        setFrom(tr, a, out);
        return out;
      }
      const dt = tr.t[b] - tr.t[a];
      const u = dt > 1e-6 ? (rt - tr.t[a]) / dt : 1;
      out.x = tr.x[a] + (tr.x[b] - tr.x[a]) * u;
      out.y = tr.y[a] + (tr.y[b] - tr.y[a]) * u;
      out.z = tr.z[a] + (tr.z[b] - tr.z[a]) * u;
      out.yaw = lerpAngle(tr.yaw[a], tr.yaw[b], u);
      out.speed = tr.speed[a] + (tr.speed[b] - tr.speed[a]) * u;
      out.act = tr.act[a];
      out.flags = tr.flags[a];
      if (dt > 1e-6) {
        out.vx = (tr.x[b] - tr.x[a]) / dt;
        out.vy = (tr.y[b] - tr.y[a]) / dt;
        out.vz = (tr.z[b] - tr.z[a]) / dt;
        out.yawRate = angleDiff(tr.yaw[a], tr.yaw[b]) / dt;
      }
      return out;
    }
  }
  setFrom(tr, first, out);
  return out;
}

/**
 * The set of known birds, keyed by id, fed by snapshots. Entries are pooled.
 * Entry: { id, sp, track, gen, born, leaving, leftAt, data } — `data` is free for the
 * renderer (it keeps its per-bird view state there; it survives pooling, so onAdd must
 * re-initialise it).
 */
export class SnapshotBook {
  constructor({ onAdd, onRemove, maxBirds = 1024 } = {}) {
    this.map = new Map();
    this.pool = [];
    this.clock = new TickClock();
    this.gen = 0;
    this.onAdd = onAdd || null;
    this.onRemove = onRemove || null;
    this.maxBirds = maxBirds;
    this.lastStamp = 0;
  }

  /** Number of birds currently present (excluding those fading out). */
  get live() {
    let n = 0;
    for (const e of this.map.values()) if (!e.leaving) n++;
    return n;
  }

  /**
   * Ingest one BirdsMsg ({tick, b}) that arrived at local time `now` (seconds).
   * Returns the local timestamp assigned to it.
   */
  ingest(msg, now) {
    const rows = Array.isArray(msg?.b) ? msg.b : [];
    const t = this.clock.stamp(msg?.tick, now);
    this.lastStamp = t;
    const gen = ++this.gen;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < SNAP.LEN) continue;
      const id = row[SNAP.ID];
      const x = +row[SNAP.X], y = +row[SNAP.Y], z = +row[SNAP.Z];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      let e = this.map.get(id);
      if (e && e.sp !== (row[SNAP.SP] | 0)) { this._drop(e); e = undefined; }
      if (e && e.leaving) {
        // Came back before the fade finished: revive it in place.
        e.leaving = false;
        e.born = now;
        clearTrack(e.track);
      }
      if (!e) {
        if (this.map.size >= this.maxBirds) continue;
        e = this.pool.pop() || { id: 0, sp: 0, track: createTrack(), gen: 0, born: 0, leaving: false, leftAt: 0, data: null };
        e.id = id; e.sp = row[SNAP.SP] | 0; e.born = now; e.leaving = false; e.leftAt = 0;
        clearTrack(e.track);
        this.map.set(id, e);
        if (this.onAdd) this.onAdd(e);
      }
      e.gen = gen;
      pushSample(e.track, t, x, y, z, +row[SNAP.YAW] || 0, +row[SNAP.SPEED] || 0, row[SNAP.ACT] | 0, row[SNAP.FLAGS] | 0);
    }
    // Snapshots are authoritative: anything not in this one has gone.
    for (const e of this.map.values()) {
      if (e.gen !== gen && !e.leaving) { e.leaving = true; e.leftAt = now; }
    }
    return t;
  }

  /** Remove birds whose fade-out finished. */
  reap(now, fade = FADE_OUT) {
    for (const e of this.map.values()) {
      if (e.leaving && now - e.leftAt >= fade) this._drop(e);
    }
  }

  /** Forget everything (e.g. a new world). */
  clear() {
    for (const e of [...this.map.values()]) this._drop(e);
    this.clock.reset();
  }

  _drop(e) {
    this.map.delete(e.id);
    if (this.onRemove) this.onRemove(e);
    // e.data is kept: the renderer reuses its pooled per-bird view state on the next add.
    this.pool.push(e);
  }
}
