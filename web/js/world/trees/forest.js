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
import { CHUNK_SIZE, VEG } from '../constants.js';
import { seasonTint, easeTint, seasonThin } from '../season.js';
import { treeStyle, isModelKind, TREE_VARIANTS } from './treeStyle.js';
import { prepareModel, buildWood, buildFoliage, writeInstanceMatrix, woodDistance, unplacePoint, DETAIL } from './treeGeometry.js';
import { shrubModel, SHRUB_VARIANTS } from './shrubModels.js';
import { detailFor, modelVariant, treeTint, modelReach, SHADOW_FAR, SHADOW_KEEP, CULL_MOVE, CULL_TURN_COS, CULL_MARGIN_DEG } from './instancing.js';
import { createTreeMaterial } from './treeMaterials.js';
import { treeTextures } from './textures.js';

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
  let viewCamera = null;
  const trackCamera = (renderer, scene, camera) => {
    const e = camera.matrixWorld.elements;
    camPos.value.set(e[12], e[13], e[14]);
    viewCamera = camera;
  };

  // --- culling --------------------------------------------------------------------------------
  // The instance buffers hold only the chunks inside a widened view frustum (plus
  // the shadow casters around the player). They are refilled when the camera has
  // turned or moved enough to approach the margin, never per frame.
  const cull = {
    frustum: new THREE.Frustum(),
    wide: new THREE.PerspectiveCamera(),
    matrix: new THREE.Matrix4(),
    dir: new THREE.Vector3(0, 0, 0),
    pos: new THREE.Vector3(Infinity, 0, 0),
    fov: 0, aspect: 0,
    active: false,
  };
  const box = new THREE.Box3();
  const tmpDir = new THREE.Vector3();
  function updateCull() {
    const cam = viewCamera;
    if (!cam || !cam.isPerspectiveCamera) return false;
    cam.getWorldDirection(tmpDir);
    const moved = cull.pos.distanceToSquared(camPos.value) > CULL_MOVE * CULL_MOVE;
    const turned = tmpDir.dot(cull.dir) < CULL_TURN_COS;
    if (!moved && !turned && cam.fov === cull.fov && cam.aspect === cull.aspect && cull.active) return false;
    cull.dir.copy(tmpDir);
    cull.pos.copy(camPos.value);
    cull.fov = cam.fov; cull.aspect = cam.aspect;
    const w = cull.wide;
    w.fov = Math.min(170, cam.fov * 1.25 + CULL_MARGIN_DEG);
    w.aspect = cam.aspect;
    w.near = 0.1;
    w.far = Math.max(cam.far, 1);
    w.updateProjectionMatrix();
    w.matrixWorld.copy(cam.matrixWorld);
    w.matrixWorldInverse.copy(cam.matrixWorldInverse);
    cull.matrix.multiplyMatrices(w.projectionMatrix, w.matrixWorldInverse);
    cull.frustum.setFromProjectionMatrix(cull.matrix);
    cull.active = true;
    return true;
  }
  function segVisible(g, s) {
    if (!cull.active) return true;
    const b = s.box;
    if (g.detail >= DETAIL.NEAR) { // shadow casters around the player stay, wherever they are
      const dx = Math.max(b[0] - cull.pos.x, 0, cull.pos.x - b[3]);
      const dz = Math.max(b[2] - cull.pos.z, 0, cull.pos.z - b[5]);
      if (dx * dx + dz * dz < SHADOW_KEEP * SHADOW_KEEP) return true;
    }
    box.min.set(b[0], b[1], b[2]);
    box.max.set(b[3], b[4], b[5]);
    return cull.frustum.intersectsBox(box);
  }
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
    let n = 0, total = 0;
    const shown = [];
    for (const s of g.segs.values()) {
      total += s.n;
      if (!segVisible(g, s)) continue;
      shown.push(s);
      n += s.n;
    }
    // Capacity follows all registered instances, so turning around never reallocates.
    if (total > g.cap || total < g.cap / 4) { // grow (or shrink a lot): new buffers
      disposeMeshes(g);
      if (!total) return;
      g.cap = Math.max(16, Math.ceil(total * 1.5));
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
    for (const s of shown) {
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
      const model = models.get(g.kind * 8 + g.variant);
      const reach = modelReach(model);
      const bx = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      list.forEach((i, j) => {
        const k = veg.scale[i];
        writeInstanceMatrix(m, j * 16, veg.x[i], veg.y[i], veg.z[i], k, veg.rot[i]);
        treeTint(veg.kind[i], veg.variant[i], veg.x[i] - ox, veg.z[i] - oz, c, j * 3);
        bx[0] = Math.min(bx[0], veg.x[i] - reach * k); bx[3] = Math.max(bx[3], veg.x[i] + reach * k);
        bx[2] = Math.min(bx[2], veg.z[i] - reach * k); bx[5] = Math.max(bx[5], veg.z[i] + reach * k);
        bx[1] = Math.min(bx[1], veg.y[i] - 1); bx[4] = Math.max(bx[4], veg.y[i] + (model.height + 1) * k);
      });
      g.segs.set(rec.key, { m, c, n, box: bx });
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
    if (updateCull()) for (const g of groups.values()) dirty.add(g);
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

  const api = {
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
    /**
     * Diagnostics: the drawn tree wood nearest to a world point within `r` metres —
     * {d: distance to the bark surface in metres (negative = inside), kind, variant,
     * seg, x, z} or null. Used to check that birds on branch perches stand on limbs.
     */
    nearestWood(x, y, z, r = 20) {
      let best = null;
      for (const rec of live.values()) {
        const v = rec.chunk.veg;
        for (let i = 0; i < v.count; i++) {
          const kind = v.kind[i];
          if (!draws(kind) || kind === VEG.SHRUB) continue;
          if (Math.abs(v.x[i] - x) > r || Math.abs(v.z[i] - z) > r) continue;
          const model = models.get(kind * 8 + modelVariant(kind, v.variant[i]));
          if (!model) continue;
          const inst = { x: v.x[i], y: v.y[i], z: v.z[i], scale: v.scale[i], rot: v.rot[i] };
          const h = woodDistance(model, unplacePoint([x, y, z], inst));
          const d = h.d * inst.scale;
          if (!best || Math.abs(d) < Math.abs(best.d)) best = { d, kind, variant: modelVariant(kind, v.variant[i]), seg: h.seg, x: inst.x, z: inst.z };
        }
      }
      return best;
    },
  };
  root.userData.forest = api;
  return api;
}
