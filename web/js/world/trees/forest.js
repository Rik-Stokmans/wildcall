// The forest: every tree (and shrub) of every loaded chunk, drawn from shared
// branching models with one InstancedMesh per (kind, model variant, detail, part)
// across ALL chunks — a few dozen draw calls for the whole forest instead of several
// per chunk.
//
// Chunks join and leave through a tiny handle object that vegetation.js puts into
// each chunk's mesh group: when the chunk renderer commits the group the handle's
// 'added' event registers the chunk's trees, and when it throws the group away
// (unload, LOD swap, rebuild) 'removed' unregisters them — so the chunk lifecycle
// stays exactly the one the world pipeline already runs.
//
// Detail follows the chunk's LOD: lod 0 → near (full limbs, dense leaf cards; the
// giant Old Oak gets its own denser cards), lod 1 → mid, lod 2 → far (a handful of big
// cards per mass and only the thick limbs — the same silhouette and colours).
import * as THREE from 'three';
import { hashByte } from '../color.js';
import { CHUNK_SIZE, VEG } from '../constants.js';
import { seasonTint, easeTint, seasonThin } from '../season.js';
import { treeStyle, isModelKind, TREE_VARIANTS } from './treeStyle.js';
import { prepareModel, buildWood, buildFoliage, writeInstanceMatrix, DETAIL } from './treeGeometry.js';
import { shrubModel, SHRUB_VARIANTS } from './shrubModels.js';
import { createTreeMaterial } from './treeMaterials.js';
import { treeTextures } from './textures.js';

/** Trees further than this from the camera (m) cast no shadow (beyond every shadow map). */
export const SHADOW_FAR = 110;

/** Instances at or above this scale are drawn with the giant detail near the player. */
export const GIANT_SCALE = 1.8;

/** Detail level for a chunk LOD and instance scale. */
export function detailFor(lod, scale) {
  if (lod <= 0) return scale >= GIANT_SCALE ? DETAIL.GIANT : DETAIL.NEAR;
  return lod === 1 ? DETAIL.MID : DETAIL.FAR;
}

/** Model variant of an instance's variant byte. */
export function modelVariant(kind, variant) {
  return kind === VEG.SHRUB ? variant % SHRUB_VARIANTS : variant % TREE_VARIANTS;
}

/**
 * Colour multiplier of a tree instance (linear RGB around 1): a little tone and a
 * warm/cool drift, more in the foliage-heavy amber kinds, almost none on snow.
 */
export function treeTint(kind, variant, x, z, out, o) {
  const style = treeStyle(kind);
  const h = (Math.floor(x * 3.1) * 73 + Math.floor(z * 2.7) * 151) & 0xffff;
  const tone = hashByte(variant, h & 255);
  const warm = hashByte(variant ^ (h >> 8), 5) - 0.5;
  const hue = style ? style.leafHue : 0.15;
  const b = 0.9 + tone * 0.2;
  out[o] = b * (1 + warm * hue);
  out[o + 1] = b * (1 + warm * hue * 0.15);
  out[o + 2] = b * (1 - warm * hue * 1.3);
}

const groupKey = (kind, variant, detail) => (kind * 8 + variant) * 4 + detail;

/**
 * @param {object} shared  live uniforms shared with the other vegetation: uTime, uWind, uWindDir
 */
export function createForest(shared) {
  const root = new THREE.Group();
  root.name = 'trees';
  root.matrixAutoUpdate = false;

  /** (kind * 8 + model variant) → prepared model */
  const models = new Map();
  let treeModelsLoaded = false;
  let curSeason = 0;
  for (let v = 0; v < SHRUB_VARIANTS; v++) models.set(VEG.SHRUB * 8 + v, prepareModel(shrubModel(v)));

  // --- materials: one pair per kind, season uniforms per class -----------------------
  const classes = new Map();
  function classUniforms(cls) {
    let u = classes.get(cls);
    if (!u) {
      const ref = seasonTint(cls, 1).a;
      u = {
        live: { a: [0, 0, 0], b: [0, 0, 0], amt: 0 },
        thin: 0,
        uSeasonA: { value: new THREE.Color() },
        uSeasonB: { value: new THREE.Color() },
        uSeasonRef: { value: new THREE.Color(ref[0], ref[1], ref[2]) },
        uSeasonAmt: { value: 0 },
        uThin: { value: 0 },
      };
      classes.set(cls, u);
      ease(cls, u, curSeason, 1); // a class appearing later starts in the current season
    }
    return u;
  }
  // Where the camera is (for the shadow pass's distance cut), taken from the main
  // render: onBeforeRender is not called for shadow maps.
  const camPos = { value: new THREE.Vector3() };
  const shadowFar = { value: SHADOW_FAR };
  const trackCamera = (renderer, scene, camera) => {
    const e = camera.matrixWorld.elements;
    camPos.value.set(e[12], e[13], e[14]);
  };
  const materials = new Map();
  function materialsFor(kind) {
    let m = materials.get(kind);
    if (m) return m;
    const style = treeStyle(kind);
    const tex = treeTextures();
    const cu = classUniforms(style.season);
    const uniforms = {
      uTime: shared.uTime, uWind: shared.uWind, uWindDir: shared.uWindDir,
      uBend: { value: style.bend }, uFlutter: { value: style.flutter }, uFreq: { value: style.freq },
      uThin: cu.uThin, uCamPos: camPos, uShadowFar: shadowFar,
      uSeasonA: cu.uSeasonA, uSeasonB: cu.uSeasonB, uSeasonRef: cu.uSeasonRef, uSeasonAmt: cu.uSeasonAmt,
    };
    m = {
      wood: createTreeMaterial({ cards: false, map: tex.bark[style.bark.tex], uniforms }),
      leaf: createTreeMaterial({ cards: true, map: style.leafTex === 'needle' ? tex.needle : tex.broad, uniforms }),
    };
    materials.set(kind, m);
    return m;
  }

  // --- geometry per (kind, variant, detail) -------------------------------------------------
  const geometries = new Map();
  function toGeometry(a, cards) {
    if (!a.triangleCount) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
    g.setAttribute('aTree', new THREE.BufferAttribute(a.tree, 4));
    if (cards) g.setAttribute('aCard', new THREE.BufferAttribute(a.card, 2));
    g.setIndex(new THREE.BufferAttribute(a.index, 1));
    return g;
  }
  function geometryFor(kind, variant, detail) {
    const key = groupKey(kind, variant, detail);
    let g = geometries.get(key);
    if (g) return g;
    const model = models.get(kind * 8 + variant);
    const style = treeStyle(kind);
    const wood = buildWood(model, style, detail);
    const leaf = buildFoliage(model, style, detail);
    g = { wood: toGeometry(wood, false), leaf: toGeometry(leaf, true), tris: wood.triangleCount + leaf.triangleCount };
    geometries.set(key, g);
    return g;
  }

  // --- instance groups --------------------------------------------------------------------------
  /** key → { kind, variant, detail, segs: Map(chunkKey → {m, c, n}), n, cap, meshes: [] , dirty } */
  const groups = new Map();
  const dirty = new Set();

  function groupFor(kind, variant, detail) {
    const key = groupKey(kind, variant, detail);
    let g = groups.get(key);
    if (!g) {
      g = { key, kind, variant, detail, segs: new Map(), cap: 0, meshes: [] };
      groups.set(key, g);
    }
    return g;
  }

  function disposeMeshes(g) {
    for (const mesh of g.meshes) { root.remove(mesh); mesh.dispose(); }
    g.meshes = [];
    g.cap = 0;
  }

  function rebuild(g) {
    let n = 0;
    for (const s of g.segs.values()) n += s.n;
    if (n > g.cap || n < g.cap / 4) { // grow (or shrink a lot): new buffers
      disposeMeshes(g);
      if (!n) return;
      g.cap = Math.max(16, Math.ceil(n * 1.5));
      const geo = geometryFor(g.kind, g.variant, g.detail);
      const mats = materialsFor(g.kind);
      const near = g.detail >= DETAIL.NEAR;
      for (const [part, geom] of [['wood', geo.wood], ['leaf', geo.leaf]]) {
        if (!geom) continue;
        const mesh = new THREE.InstancedMesh(geom, mats[part].material, g.cap);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(g.cap * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.customDepthMaterial = mats[part].depth;
        // The instances surround the player: culling the whole set is never useful.
        mesh.frustumCulled = false;
        mesh.castShadow = near;
        mesh.receiveShadow = g.detail >= DETAIL.MID;
        mesh.matrixAutoUpdate = false;
        mesh.onBeforeRender = trackCamera;
        mesh.name = `tree:${treeStyle(g.kind).name}/${g.variant}/${part}${g.detail}`;
        root.add(mesh);
        g.meshes.push(mesh);
      }
    }
    if (!g.meshes.length) return;
    const mArr = g.meshes[0].instanceMatrix.array;
    const cArr = g.meshes[0].instanceColor.array;
    let o = 0;
    for (const s of g.segs.values()) {
      mArr.set(s.m.subarray(0, s.n * 16), o * 16);
      cArr.set(s.c.subarray(0, s.n * 3), o * 3);
      o += s.n;
    }
    for (let i = 0; i < g.meshes.length; i++) {
      const mesh = g.meshes[i];
      if (i > 0) { // parts share the arrays' contents
        mesh.instanceMatrix.array.set(mArr.subarray(0, n * 16));
        mesh.instanceColor.array.set(cArr.subarray(0, n * 3));
      }
      mesh.count = n;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, n * 3);
      mesh.instanceColor.needsUpdate = true;
      mesh.visible = n > 0;
    }
  }

  // --- chunk registration --------------------------------------------------------------------------
  /** chunk key → { handle, chunk, groups: Set<group> } */
  const live = new Map();

  /** Whether the forest draws this kind (shrubs always; trees once their models arrived). */
  function draws(kind) {
    if (!isModelKind(kind)) return false;
    return kind === VEG.SHRUB || (treeModelsLoaded && models.has(kind * 8));
  }

  function bucket(rec) {
    const { chunk } = rec;
    const veg = chunk.veg;
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const per = new Map(); // group → list of instance indices
    for (let i = 0; i < veg.count; i++) {
      const kind = veg.kind[i];
      if (!draws(kind)) continue;
      const variant = modelVariant(kind, veg.variant[i]);
      if (!models.has(kind * 8 + variant)) continue;
      const g = groupFor(kind, variant, detailFor(chunk.lod, veg.scale[i]));
      let list = per.get(g);
      if (!list) per.set(g, (list = []));
      list.push(i);
    }
    for (const [g, list] of per) {
      const n = list.length;
      const m = new Float32Array(n * 16), c = new Float32Array(n * 3);
      list.forEach((i, j) => {
        writeInstanceMatrix(m, j * 16, veg.x[i], veg.y[i], veg.z[i], veg.scale[i], veg.rot[i]);
        treeTint(veg.kind[i], veg.variant[i], veg.x[i] - ox, veg.z[i] - oz, c, j * 3);
      });
      g.segs.set(rec.key, { m, c, n });
      rec.groups.add(g);
      dirty.add(g);
    }
  }

  function unbucket(rec) {
    for (const g of rec.groups) {
      g.segs.delete(rec.key);
      dirty.add(g);
    }
    rec.groups.clear();
  }

  /**
   * A handle for one chunk's trees: put it into the chunk's mesh group; it registers
   * the trees when the group is committed and unregisters them when it is dropped.
   * @param {import('../chunkCodec.js').ChunkData} chunk
   */
  function handleFor(chunk) {
    const handle = new THREE.Object3D();
    handle.name = 'trees-handle';
    handle.matrixAutoUpdate = false;
    // The chunk renderer disposes what it drops; there is nothing GPU-side here.
    handle.dispose = () => {};
    const key = `${chunk.cx},${chunk.cz}`;
    handle.addEventListener('added', () => {
      const old = live.get(key);
      if (old) unbucket(old);
      const rec = { key, handle, chunk, groups: new Set() };
      live.set(key, rec);
      bucket(rec);
    });
    handle.addEventListener('removed', () => {
      const rec = live.get(key);
      if (!rec || rec.handle !== handle) return; // already replaced by a newer build
      unbucket(rec);
      live.delete(key);
    });
    return handle;
  }

  /** Installs the server's tree models (welcome.trees). Invalid models are skipped. */
  function setModels(list) {
    if (!Array.isArray(list) || !list.length) return false;
    let ok = 0;
    for (const raw of list) {
      try {
        const m = prepareModel(raw);
        if (!treeStyle(m.kind) || m.kind === VEG.SHRUB || m.variant < 0 || m.variant >= TREE_VARIANTS) continue;
        models.set(m.kind * 8 + m.variant, m);
        ok++;
      } catch (err) {
        console.warn('[world] tree model skipped:', err?.message || err);
      }
    }
    if (!ok) return false;
    // New shapes: drop the built geometry and redistribute what is registered.
    for (const g of groups.values()) disposeMeshes(g);
    for (const g of geometries.values()) { g.wood?.dispose(); g.leaf?.dispose(); }
    geometries.clear();
    groups.clear();
    dirty.clear();
    treeModelsLoaded = true;
    for (const rec of live.values()) { rec.groups.clear(); bucket(rec); }
    return true;
  }

  /**
   * Per frame: rebuilds the instance buffers of changed groups and moves the seasons.
   * @param {number} dt @param {number} season core.Season
   */
  function update(dt, season) {
    curSeason = season;
    for (const g of dirty) rebuild(g);
    dirty.clear();
    const tk = 1 - Math.exp(-dt * 0.35);
    for (const [cls, u] of classes) ease(cls, u, season, tk);
  }

  function ease(cls, u, season, k) {
    if (cls) {
      easeTint(u.live, seasonTint(cls, season), k);
      u.uSeasonA.value.setRGB(u.live.a[0], u.live.a[1], u.live.a[2]);
      u.uSeasonB.value.setRGB(u.live.b[0], u.live.b[1], u.live.b[2]);
      u.uSeasonAmt.value = u.live.amt;
    }
    u.thin += (seasonThin(cls, season) - u.thin) * k;
    if (Math.abs(u.thin - seasonThin(cls, season)) < 0.002) u.thin = seasonThin(cls, season);
    u.uThin.value = u.thin;
  }

  return {
    root,
    draws,
    handleFor,
    setModels,
    update,
    /** Jumps straight to a season (first frame, no wash-in). */
    snapSeason(season) {
      curSeason = season;
      for (const [cls, u] of classes) ease(cls, u, season, 1);
    },
    /** Diagnostics: instance groups, drawn instances and triangles before culling. */
    get stats() {
      let meshes = 0, instances = 0, triangles = 0;
      for (const g of groups.values()) {
        let n = 0;
        for (const s of g.segs.values()) n += s.n;
        meshes += g.meshes.length;
        instances += n;
        if (n) triangles += n * geometryFor(g.kind, g.variant, g.detail).tris;
      }
      return { groups: groups.size, meshes, instances, triangles, chunks: live.size };
    },
    /** The prepared model of a kind and model variant (for tools and tests), or undefined. */
    model: (kind, variant) => models.get(kind * 8 + variant),
  };
}
