// The GPU side of a chunk: its terrain mesh and vegetation, built in slices and
// swapped in atomically. Implements the mesher interface WorldPipeline expects.
import * as THREE from 'three';
import { CHUNK_SIZE } from './constants.js';
import { chunkKey } from './heightfield.js';
import { buildTerrainArrays, chunkSphere } from './terrainMesh.js';

/**
 * The terrain material: vertex colours carry the whole palette (region, habitat,
 * trails, shoreline are blended in by the server); Lambert keeps the light soft and
 * cheap, and it honours scene.fog so the far ring melts into the sky.
 */
export function createTerrainMaterial() {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

/**
 * @param {THREE.Object3D} root  parent of every chunk group
 * @param {object} vegKit  from createVegetationKit()
 * @param {() => {decor:number, shadows:boolean}} quality  current quality preset
 */
export function createChunkRenderer(root, vegKit, quality) {
  const terrainMaterial = createTerrainMaterial();
  /** key → THREE.Group currently drawn */
  const groups = new Map();

  function disposeGroup(g) {
    for (const child of g.children) {
      // Vegetation geometry is shared between chunks; only per-chunk buffers go.
      if (child.isInstancedMesh) child.dispose();
      else child.geometry?.dispose();
    }
    g.clear();
  }

  function terrainMesh(chunk) {
    const t = buildTerrainArrays(chunk);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(t.normal, 3, true)); // int8 × 127, normalised
    g.setAttribute('color', new THREE.BufferAttribute(t.color, 3));
    g.setIndex(new THREE.BufferAttribute(t.index, 1));
    const s = chunkSphere(t.minY, t.maxY);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(s.x, s.y, s.z), s.r);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, t.minY, 0), new THREE.Vector3(CHUNK_SIZE, t.maxY, CHUNK_SIZE));
    const mesh = new THREE.Mesh(g, terrainMaterial);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = !!quality().shadows;
    mesh.name = 'terrain';
    return mesh;
  }

  return {
    terrainMaterial,
    groups,

    begin(chunk) {
      let stage = 0;
      let terrain = null;
      let veg = null;
      return {
        step() {
          if (stage === 0) { terrain = terrainMesh(chunk); stage = 1; return false; }
          veg = vegKit.buildChunk(chunk, quality());
          return true;
        },
        commit() {
          const key = chunkKey(chunk.cx, chunk.cz);
          const g = new THREE.Group();
          g.name = `chunk ${chunk.cx},${chunk.cz} lod${chunk.lod}`;
          // Chunk-local vertex data under a translated group keeps float32 precision
          // independent of how far the chunk is from the origin.
          g.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
          g.matrixAutoUpdate = false;
          g.updateMatrix();
          g.add(terrain);
          for (const m of veg) g.add(m);
          g.userData.lod = chunk.lod;
          const old = groups.get(key);
          root.add(g);
          if (old) { root.remove(old); disposeGroup(old); }
          groups.set(key, g);
          terrain = null; veg = null;
        },
        cancel() {
          terrain?.geometry.dispose();
          if (veg) for (const m of veg) m.dispose();
          terrain = null; veg = null;
        },
      };
    },

    remove(cx, cz) {
      const key = chunkKey(cx, cz);
      const g = groups.get(key);
      if (!g) return;
      root.remove(g);
      disposeGroup(g);
      groups.delete(key);
    },

    clear() {
      for (const g of groups.values()) { root.remove(g); disposeGroup(g); }
      groups.clear();
    },

    /** Number of draw calls the loaded chunks could issue (before culling). */
    meshCount() {
      let n = 0;
      for (const g of groups.values()) n += g.children.length;
      return n;
    },
  };
}
