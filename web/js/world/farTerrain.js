// Draws the far field (farField.js): lod-2 terrain beyond the streaming ring, merged
// into a few sector meshes with the terrain material, no vegetation, no shadows.
import * as THREE from 'three';
import { CHUNK_SIZE } from './constants.js';
import { parseChunk, peekChunkHeader } from './chunkCodec.js';
import { chunkKey, keyCx, keyCz } from './heightfield.js';
import { buildTerrainArrays } from './terrainMesh.js';
import {
  FarPlanner, farChunk, farRadiusOf, sectorOf, sectorOrigin, SECTOR,
} from './farField.js';
import { inRing } from './streamer.js';

/** Sectors rebuilt per frame at most. */
const SECTORS_PER_FRAME = 1;
/** Seconds between request plans. */
const PLAN_SECONDS = 0.25;

/**
 * @param {THREE.Object3D} parent
 * @param {THREE.Material} material  the terrain material
 * @param {object} o
 * @param {(cx:number, cz:number) => void} o.request  sends a lod-2 chunkReq
 * @param {{get(cx:number, cz:number):object|undefined, version:number}} o.store  the near ring's chunks
 */
export function createFarTerrain(parent, material, { request, store }) {
  const root = new THREE.Group();
  root.name = 'far-terrain';
  parent.add(root);
  const planner = new FarPlanner();
  /** sector key → mesh */
  const sectors = new Map();
  const dirty = new Set();
  let near = 7, far = 12;
  let pcx = NaN, pcz = NaN;
  let planT = 0;
  let lastVersion = -1;
  let versionT = 0;
  let enabled = true;

  const farRegionAt = (x, z) => {
    const c = planner.have.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
    if (!c) return 255;
    const ix = Math.min(c.n - 1, Math.max(0, Math.round((x - c.cx * CHUNK_SIZE) / c.cell)));
    const iz = Math.min(c.n - 1, Math.max(0, Math.round((z - c.cz * CHUNK_SIZE) / c.cell)));
    return c.region[iz * c.n + ix];
  };

  // Terrain arrays per far chunk, built once (merging a sector is then only copying).
  const built = new WeakMap();
  function arraysOf(c) {
    let a = built.get(c);
    if (!a) { a = buildTerrainArrays(c, null, farRegionAt); built.set(c, a); }
    return a;
  }

  function markChunk(cx, cz) { dirty.add(chunkKey(sectorOf(cx), sectorOf(cz))); }

  function markRingBand(inner = near - 2) {
    // Sectors that touch the near ring's edge (where the near/far split moves); after
    // a jump, every sector from the player outwards.
    const r0 = inner, r1 = near + 3;
    for (let dz = -r1; dz <= r1; dz += 1) {
      for (let dx = -r1; dx <= r1; dx += 1) {
        const d = Math.hypot(dx, dz);
        if (d >= r0 && d <= r1) dirty.add(chunkKey(sectorOf(pcx + dx), sectorOf(pcz + dz)));
      }
    }
  }

  function buildSector(key, sx, sz) {
    const old = sectors.get(key);
    const parts = [];
    for (let j = 0; j < SECTOR; j++) {
      for (let i = 0; i < SECTOR; i++) {
        const cx = sx * SECTOR + i, cz = sz * SECTOR + j;
        const c = planner.have.get(chunkKey(cx, cz));
        if (!c || store.get(cx, cz)) continue; // the near ring draws it
        const dx = cx - pcx, dz = cz - pcz;
        if (dx * dx + dz * dz > (far + 1.5) * (far + 1.5)) continue;
        // Inside the near ring the near chunks take over (a moment's gap while one
        // streams in is better than a raised canopy blanket standing in the woods).
        if (inRing(dx, dz, near)) continue;
        parts.push(c);
      }
    }
    if (old) { root.remove(old); old.geometry.dispose(); sectors.delete(key); }
    if (!parts.length) return;
    const [ox, oz] = sectorOrigin(sx, sz);
    const arrays = parts.map(arraysOf);
    let nv = 0, ni = 0;
    for (const a of arrays) { nv += a.vertexCount; ni += a.index.length; }
    const position = new Float32Array(nv * 3), normal = new Int8Array(nv * 3), color = new Float32Array(nv * 3);
    const canopy = new Float32Array(nv), regA = new Float32Array(nv * 3), regB = new Float32Array(nv * 2);
    const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let v0 = 0, i0 = 0, minY = Infinity, maxY = -Infinity;
    arrays.forEach((a, q) => {
      const c = parts[q];
      const offX = c.cx * CHUNK_SIZE - ox, offZ = c.cz * CHUNK_SIZE - oz;
      for (let v = 0; v < a.vertexCount; v++) {
        position[(v0 + v) * 3] = a.position[v * 3] + offX;
        position[(v0 + v) * 3 + 1] = a.position[v * 3 + 1];
        position[(v0 + v) * 3 + 2] = a.position[v * 3 + 2] + offZ;
      }
      normal.set(a.normal, v0 * 3);
      color.set(a.color, v0 * 3);
      regA.set(a.regA, v0 * 3);
      regB.set(a.regB, v0 * 2);
      // The blanket travels in the canopy attribute as a negative number (shader).
      const nn = c.n * c.n;
      for (let v = 0; v < a.vertexCount; v++) {
        const src = v < nn ? v : skirtSource(c.n, v - nn);
        canopy[v0 + v] = -c.blanket[src];
      }
      for (let k = 0; k < a.index.length; k++) index[i0 + k] = a.index[k] + v0;
      v0 += a.vertexCount; i0 += a.index.length;
      minY = Math.min(minY, a.minY); maxY = Math.max(maxY, a.maxY);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('aCanopy', new THREE.BufferAttribute(canopy, 1));
    g.setAttribute('aRegA', new THREE.BufferAttribute(regA, 3));
    g.setAttribute('aRegB', new THREE.BufferAttribute(regB, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const span = SECTOR * CHUNK_SIZE;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(span, maxY, span));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'far-terrain';
    mesh.position.set(ox, 0, oz);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    root.add(mesh);
    sectors.set(key, mesh);
  }

  return {
    root,
    /** Applies a quality preset: the near ring radius and the far radius. */
    setQuality(qualityName, nearRadius) {
      near = nearRadius;
      far = farRadiusOf(qualityName);
      enabled = far > near;
      for (const k of sectors.keys()) dirty.add(k);
      lastVersion = -1;
    },
    /** The far radius in chunks (0 when off). */
    get radius() { return enabled ? far : 0; },
    /** Drops everything (a new world). */
    reset() {
      planner.reset();
      for (const m of sectors.values()) { root.remove(m); m.geometry.dispose(); }
      sectors.clear();
      dirty.clear();
      pcx = pcz = NaN;
    },
    /** A chunk frame arrived: keeps it if the far field asked for it. */
    receive(buf) {
      if (!enabled) return false;
      const head = peekChunkHeader(buf);
      if (!head || !planner.wants(head.cx, head.cz)) return false;
      try {
        const c = farChunk(parseChunk(buf));
        planner.accept(c);
        markChunk(c.cx, c.cz);
      } catch { planner.inflight.delete(chunkKey(head.cx, head.cz)); }
      return true;
    },
    /**
     * Per frame.
     * @param {number} dt @param {number} px @param {number} pz  player position
     * @param {boolean} busy  the near ring is still loading (no far requests then)
     * @param {number} now  seconds
     */
    update(dt, px, pz, busy, now) {
      if (!enabled) {
        if (sectors.size) { for (const m of sectors.values()) { root.remove(m); m.geometry.dispose(); } sectors.clear(); }
        return;
      }
      const cx = Math.floor(px / CHUNK_SIZE), cz = Math.floor(pz / CHUNK_SIZE);
      if (cx !== pcx || cz !== pcz) {
        const jump = !(Math.abs(cx - pcx) <= 1 && Math.abs(cz - pcz) <= 1);
        pcx = cx; pcz = cz;
        for (const c of planner.evict(pcx, pcz, far)) markChunk(c.cx, c.cz);
        markRingBand(jump ? 0 : near - 2);
        // Sectors now wholly inside the near ring go at once.
        if (jump) {
          for (const [k, m] of sectors) {
            const sx = keySx(k) * SECTOR - pcx, sz = keySz(k) * SECTOR - pcz;
            if (Math.max(Math.abs(sx), Math.abs(sx + SECTOR - 1)) <= near && Math.max(Math.abs(sz), Math.abs(sz + SECTOR - 1)) <= near) {
              root.remove(m); m.geometry.dispose(); sectors.delete(k);
            }
          }
        }
      }
      versionT -= dt;
      if (store.version !== lastVersion && versionT <= 0) { lastVersion = store.version; versionT = 1; markRingBand(); }
      planT -= dt;
      if (planT <= 0 && !busy) {
        planT = PLAN_SECONDS;
        for (const r of planner.plan(pcx, pcz, near, far, now)) request(r.cx, r.cz);
      }
      // Rebuild the dirty sectors nearest the player first.
      for (let n = 0; n < SECTORS_PER_FRAME && dirty.size; n++) {
        let best = null, bd = Infinity;
        const psx = pcx / SECTOR, psz = pcz / SECTOR;
        for (const k of dirty) {
          const dx = keySx(k) - psx, dz = keySz(k) - psz;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = k; }
        }
        dirty.delete(best);
        buildSector(best, keySx(best), keySz(best));
      }
    },
    /** Diagnostics. */
    get stats() {
      let tris = 0;
      for (const m of sectors.values()) tris += m.geometry.index.count / 3;
      return { chunks: planner.have.size, inflight: planner.inflight.size, sectors: sectors.size, triangles: tris, radius: enabled ? far : 0 };
    },
  };
}

/** The grid vertex a skirt vertex copies (terrainMesh.js: north, south, west, east strips). */
function skirtSource(n, s) {
  const strip = Math.floor(s / n), k = s % n, last = n - 1;
  if (strip === 0) return k;
  if (strip === 1) return last * n + k;
  if (strip === 2) return k * n;
  return k * n + last;
}

// Sector keys use chunkKey(sx, sz); decode them with the same scheme.
const keySx = keyCx, keySz = keyCz;
