// What the player bumps into and what hangs overhead. Pure: no three.js, no DOM.
//
// Two sources of circles in the XZ plane:
//   * vegetation of the loaded chunks — tree trunks, snags, big rocks and stumps are
//     solid; tree crowns give canopy cover (light, rain audio, sound occlusion);
//   * blockers and surface patches registered by other modules (buildings, boardwalks).
import { CHUNK_SIZE, vegInfo } from './constants.js';
import { chunkKey } from './heightfield.js';

const CELL = 8;                       // metres per bucket
const CELLS = CHUNK_SIZE / CELL;      // buckets per chunk side
const STRIDE = 4;                     // floats per record: x, z, solid radius, crown radius
const HASH_CELL = 16;                 // metres per bucket for registered circles

/** Radius of the solid body of a vegetation instance (0 = walk through). */
export function solidRadius(kind, scale) {
  const info = vegInfo(kind);
  if (!info || info.trunk <= 0 || scale < info.minSolid) return 0;
  return info.trunk * scale;
}

/** Radius of the crown of a vegetation instance (0 = casts no canopy). */
export function crownRadius(kind, scale) {
  const info = vegInfo(kind);
  return info && info.crown > 0 ? info.crown * scale : 0;
}

/**
 * Buckets a chunk's vegetation into 8 m cells (counting sort, CSR layout).
 * @param {number} cx @param {number} cz
 * @param {import('./chunkCodec.js').VegData} veg
 */
export function buildColliderGrid(cx, cz, veg) {
  const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
  const start = new Uint16Array(CELLS * CELLS + 1);
  const cellOf = new Uint8Array(veg.count);
  let kept = 0, maxSolid = 0, maxCrown = 0;
  for (let i = 0; i < veg.count; i++) {
    const solid = solidRadius(veg.kind[i], veg.scale[i]);
    const crown = crownRadius(veg.kind[i], veg.scale[i]);
    if (solid === 0 && crown === 0) { cellOf[i] = 255; continue; }
    let gx = Math.floor((veg.x[i] - x0) / CELL), gz = Math.floor((veg.z[i] - z0) / CELL);
    // Instances belong to the chunk that carries them even if rounding puts them a
    // hair outside; clamping keeps every record findable.
    gx = gx < 0 ? 0 : gx >= CELLS ? CELLS - 1 : gx;
    gz = gz < 0 ? 0 : gz >= CELLS ? CELLS - 1 : gz;
    cellOf[i] = gz * CELLS + gx;
    start[cellOf[i] + 1]++;
    kept++;
    if (solid > maxSolid) maxSolid = solid;
    if (crown > maxCrown) maxCrown = crown;
  }
  for (let c = 0; c < CELLS * CELLS; c++) start[c + 1] += start[c];
  const data = new Float32Array(kept * STRIDE);
  const cover = new Float32Array(kept);
  const fill = start.slice(0, CELLS * CELLS);
  for (let i = 0; i < veg.count; i++) {
    const c = cellOf[i];
    if (c === 255) continue;
    const slot = fill[c]++;
    const o = slot * STRIDE;
    data[o] = veg.x[i];
    data[o + 1] = veg.z[i];
    data[o + 2] = solidRadius(veg.kind[i], veg.scale[i]);
    data[o + 3] = crownRadius(veg.kind[i], veg.scale[i]);
    cover[slot] = vegInfo(veg.kind[i]).cover;
  }
  return { cx, cz, start, data, cover, maxSolid, maxCrown };
}

/** A set of registered circles in a spatial hash; each returns its own remover. */
class CircleSet {
  constructor() { this.cells = new Map(); this.size = 0; }

  add(x, z, r, payload) {
    const item = { x, z, r, payload };
    const keys = [];
    const x0 = Math.floor((x - r) / HASH_CELL), x1 = Math.floor((x + r) / HASH_CELL);
    const z0 = Math.floor((z - r) / HASH_CELL), z1 = Math.floor((z + r) / HASH_CELL);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const key = chunkKey(gx, gz);
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(item);
        keys.push(key);
      }
    }
    this.size++;
    let live = true;
    return () => {
      if (!live) return;
      live = false;
      this.size--;
      for (const key of keys) {
        const list = this.cells.get(key);
        if (!list) continue;
        const i = list.indexOf(item);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) this.cells.delete(key);
      }
    };
  }

  /** Bucket of circles that may touch the cell containing (gx, gz), or undefined. */
  cell(gx, gz) { return this.cells.get(chunkKey(gx, gz)); }

  clear() { this.cells.clear(); this.size = 0; }
}

export class Collision {
  constructor() {
    this.grids = new Map();
    this.blockers = new CircleSet();
    this.patches = new CircleSet();
    // Largest radii seen so far: how far a query has to look for a circle that could
    // reach it. They only grow, which is conservative and keeps removal trivial.
    this.maxSolid = 0;
    this.maxCrown = 0;
  }

  /** Registers the vegetation of a chunk (replacing what was there). */
  setChunk(cx, cz, veg) {
    const grid = buildColliderGrid(cx, cz, veg);
    this.grids.set(chunkKey(cx, cz), grid);
    if (grid.maxSolid > this.maxSolid) this.maxSolid = grid.maxSolid;
    if (grid.maxCrown > this.maxCrown) this.maxCrown = grid.maxCrown;
  }

  deleteChunk(cx, cz) { this.grids.delete(chunkKey(cx, cz)); }

  /** Drops all vegetation (new world). Registered blockers belong to their owners and stay. */
  clearChunks() {
    this.grids.clear();
    this.maxSolid = 0;
    this.maxCrown = 0;
  }

  /**
   * Registers a solid circle (a building, a wall segment…).
   * @param {{x:number, z:number, r:number}} b
   * @returns {() => void} call to remove the blocker again
   */
  addBlocker(b) {
    const x = +b?.x, z = +b?.z, r = +b?.r;
    if (!Number.isFinite(x + z + r) || r <= 0) return () => {};
    return this.blockers.add(x, z, r, null);
  }

  /**
   * Registers a patch of ground with its own footstep surface (a boardwalk, a bridge).
   * @param {{x:number, z:number, r:number, surface:string}} p
   * @returns {() => void} call to remove the patch again
   */
  addSurfacePatch(p) {
    const x = +p?.x, z = +p?.z, r = +p?.r;
    if (!Number.isFinite(x + z + r) || r <= 0 || typeof p.surface !== 'string') return () => {};
    return this.patches.add(x, z, r, p.surface);
  }

  /** Surface of the registered patch covering a point, or null. */
  patchAt(x, z) {
    if (this.patches.size === 0) return null;
    const list = this.patches.cell(Math.floor(x / HASH_CELL), Math.floor(z / HASH_CELL));
    if (!list) return null;
    for (let i = list.length - 1; i >= 0; i--) { // the most recently added patch wins
      const p = list[i];
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz <= p.r * p.r) return p.payload;
    }
    return null;
  }

  /**
   * Pushes a circle of the given radius out of every solid it overlaps, in XZ.
   * @param {{x:number, z:number}} pos  mutated in place (a THREE.Vector3 works)
   * @param {number} radius
   * @returns {boolean} whether pos was moved
   */
  collide(pos, radius) {
    let hit = false;
    // A few passes settle the corner cases where leaving one circle enters another.
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      if (this.grids.size > 0 && this.maxSolid > 0) {
        const reach = radius + this.maxSolid;
        const gx0 = Math.floor((pos.x - reach) / CELL), gx1 = Math.floor((pos.x + reach) / CELL);
        const gz0 = Math.floor((pos.z - reach) / CELL), gz1 = Math.floor((pos.z + reach) / CELL);
        for (let gz = gz0; gz <= gz1; gz++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            const ccx = Math.floor(gx / CELLS), ccz = Math.floor(gz / CELLS);
            const grid = this.grids.get(chunkKey(ccx, ccz));
            if (!grid) continue;
            const c = (gz - ccz * CELLS) * CELLS + (gx - ccx * CELLS);
            const data = grid.data;
            for (let s = grid.start[c], e = grid.start[c + 1]; s < e; s++) {
              const o = s * STRIDE;
              const r = data[o + 2];
              if (r > 0 && pushOut(pos, data[o], data[o + 1], r + radius)) moved = true;
            }
          }
        }
      }
      if (this.blockers.size > 0) {
        const hx0 = Math.floor((pos.x - radius) / HASH_CELL), hx1 = Math.floor((pos.x + radius) / HASH_CELL);
        const hz0 = Math.floor((pos.z - radius) / HASH_CELL), hz1 = Math.floor((pos.z + radius) / HASH_CELL);
        for (let gz = hz0; gz <= hz1; gz++) {
          for (let gx = hx0; gx <= hx1; gx++) {
            const list = this.blockers.cell(gx, gz);
            if (!list) continue;
            for (let i = 0; i < list.length; i++) {
              const b = list[i];
              if (pushOut(pos, b.x, b.z, b.r + radius)) moved = true;
            }
          }
        }
      }
      if (!moved) break;
      hit = true;
    }
    return hit;
  }

  /** Calls fn(x, z, solidR, crownR) for every collider whose cell lies within `reach` of (x, z). */
  _near(x, z, reach, fn) {
    if (!(this.grids.size > 0)) return;
    const gx0 = Math.floor((x - reach) / CELL), gx1 = Math.floor((x + reach) / CELL);
    const gz0 = Math.floor((z - reach) / CELL), gz1 = Math.floor((z + reach) / CELL);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const ccx = Math.floor(gx / CELLS), ccz = Math.floor(gz / CELLS);
        const grid = this.grids.get(chunkKey(ccx, ccz));
        if (!grid) continue;
        const c = (gz - ccz * CELLS) * CELLS + (gx - ccx * CELLS);
        const data = grid.data;
        for (let s = grid.start[c], e = grid.start[c + 1]; s < e; s++) {
          const o = s * STRIDE;
          fn(data[o], data[o + 1], data[o + 2], data[o + 3]);
        }
      }
    }
  }

  /**
   * Distance (m) from (x, z) to the edge of the nearest solid — tree trunk, rock,
   * registered blocker — or Infinity if there is none within `maxDist`. Cheap: only
   * the 8 m cells around the point are visited.
   */
  nearestSolid(x, z, maxDist = 30) {
    let best = Infinity;
    this._near(x, z, maxDist + this.maxSolid, (px, pz, r) => {
      if (r <= 0) return;
      const d = Math.hypot(x - px, z - pz) - r;
      if (d < best) best = d;
    });
    if (this.blockers.size > 0) {
      const hx0 = Math.floor((x - maxDist) / HASH_CELL), hx1 = Math.floor((x + maxDist) / HASH_CELL);
      const hz0 = Math.floor((z - maxDist) / HASH_CELL), hz1 = Math.floor((z + maxDist) / HASH_CELL);
      for (let gz = hz0; gz <= hz1; gz++) {
        for (let gx = hx0; gx <= hx1; gx++) {
          const list = this.blockers.cell(gx, gz);
          if (!list) continue;
          for (const b of list) { const d = Math.hypot(x - b.x, z - b.z) - b.r; if (d < best) best = d; }
        }
      }
    }
    return Math.max(0, best) <= maxDist ? Math.max(0, best) : Infinity;
  }

  /**
   * First contact of a circle of `radius` swept in a straight line from a to b (XZ)
   * against trunks and rocks, and — when `clearanceAt(t)` (height of the path above
   * the ground at fraction t) is given — against tree crowns at that height.
   * @returns {number} the fraction t (0..1) of the first contact, or -1 if the way is clear
   */
  sweep(ax, az, bx, bz, radius = 0.5, clearanceAt = null) {
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const len = Math.sqrt(len2);
    let first = 2;
    // Visit cells along the segment in steps of one cell.
    const steps = Math.max(1, Math.ceil(len / CELL));
    const seen = new Set();
    const reach = radius + Math.max(this.maxSolid, this.maxCrown);
    for (let k = 0; k <= steps; k++) {
      const cx = ax + dx * (k / steps), cz = az + dz * (k / steps);
      this._near(cx, cz, reach, (px, pz, r, cr) => {
        const key = px * 7919 + pz;
        if (seen.has(key)) return;
        seen.add(key);
        // closest approach of the segment to (px, pz)
        let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + dx * t - px, qz = az + dz * t - pz;
        const d = Math.sqrt(qx * qx + qz * qz);
        let hit = r > 0 && d < r + radius;
        if (!hit && clearanceAt && cr > 0 && d < cr * 0.85 + radius) {
          // Crowns fill from a little above head height to ~2.6 crown radii up.
          const y = clearanceAt(t);
          hit = y > 2.2 && y < cr * 2.6 + 1.5;
        }
        if (hit) {
          // back off to where the circle first touches (approximately)
          const back = len > 0 ? Math.sqrt(Math.max(0, (r + radius) ** 2 - d * d)) / len : 0;
          first = Math.min(first, Math.max(0, t - back));
        }
      });
    }
    return first <= 1 ? first : -1;
  }

  /**
   * Tree cover above a point: 0 = open sky, 1 = dense canopy. Overlapping crowns
   * combine like independent screens (1 − Π(1 − cᵢ)).
   */
  canopyAt(x, z) {
    const reach = this.maxCrown;
    if (!(reach > 0)) return 0;
    let open = 1;
    const gx0 = Math.floor((x - reach) / CELL), gx1 = Math.floor((x + reach) / CELL);
    const gz0 = Math.floor((z - reach) / CELL), gz1 = Math.floor((z + reach) / CELL);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const ccx = Math.floor(gx / CELLS), ccz = Math.floor(gz / CELLS);
        const grid = this.grids.get(chunkKey(ccx, ccz));
        if (!grid) continue;
        const c = (gz - ccz * CELLS) * CELLS + (gx - ccx * CELLS);
        const data = grid.data;
        for (let s = grid.start[c], e = grid.start[c + 1]; s < e; s++) {
          const o = s * STRIDE;
          const r = data[o + 3];
          if (r <= 0) continue;
          const dx = x - data[o], dz = z - data[o + 1];
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          // Full cover under most of the crown, thinning over its outer third.
          const edge = 1 - d2 / (r * r);
          open *= 1 - grid.cover[s] * Math.min(1, edge * 2.2);
        }
      }
    }
    return 1 - open;
  }
}

/** Moves pos to distance `min` from (cx, cz) if it is closer. Returns whether it moved. */
function pushOut(pos, cx, cz, min) {
  const dx = pos.x - cx, dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  // The small tolerance stops a position that was just pushed to the rim from
  // counting as overlapping again through rounding.
  const rim = min - 1e-6;
  if (d2 >= rim * rim) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-6) { // dead centre: any direction is as good as another
    pos.x = cx + min;
    return true;
  }
  const k = min / d;
  pos.x = cx + dx * k;
  pos.z = cz + dz * k;
  return true;
}
