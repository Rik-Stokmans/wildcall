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
// Detail follows each instance's distance from the camera (instancing.js bands):
// near (full limbs, dense leaf cards; the giant Old Oak gets its own denser cards)
// close by, mid (fewer, larger cards, thick limbs) further out, far (a handful of big
// cards per mass, trunk and main limbs) beyond. Around each band edge both levels are
// drawn and cross-faded with screen-space dither (treeMaterials.js), so walking never
// visibly swaps a tree. The instance buffers are refilled only when the camera has
// moved or turned enough (never per frame), holding the chunks inside a widened view
// frustum.
//
// Shadows: the view meshes cast none. Per (kind, variant) a separate caster set at mid
// detail holds only the instances whose shadow can land inside the sun's shadow map
// (tested in light space), and is skipped in the main pass — so the shadow pass no
// longer redraws every full-detail tree within 110 m.
import * as THREE from 'three';
import { CHUNK_SIZE, VEG } from '../constants.js';
import { seasonTint, easeTint, seasonThin } from '../season.js';
import { treeStyle, isModelKind, TREE_VARIANTS } from './treeStyle.js';
import { prepareModel, buildWood, buildFoliage, writeInstanceMatrix, woodDistance, unplacePoint, DETAIL } from './treeGeometry.js';
import { shrubModel, SHRUB_VARIANTS } from './shrubModels.js';
import {
  modelVariant, treeTint, modelReach, GIANT_SCALE, CULL_MOVE, CULL_TURN_COS, CULL_MARGIN_DEG,
  bandsFor, bandMask, fadeWindow, zoomStep,
} from './instancing.js';
import { createTreeMaterial } from './treeMaterials.js';
import { treeTextures } from './textures.js';

const speciesKey = (kind, variant) => kind * 8 + variant;
const geoKey = (kind, variant, detail) => (kind * 8 + variant) * 4 + detail;
/** Slot index of the shadow-caster set (after the four detail levels). */
const SHADOW = 4;
/** Detail the shadow casters are drawn with. */
const SHADOW_DETAIL = DETAIL.MID;
/** Extra light-space margin (m) around the shadow map for caster selection. */
const SHADOW_MARGIN = 9;
/** Refill when the shadow camera moved this far (m) or the light turned this much. */
const SHADOW_MOVE = 4;
const SHADOW_TURN_COS = Math.cos((2.5 * Math.PI) / 180);

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
  let quality = 'medium';
  for (let v = 0; v < SHRUB_VARIANTS; v++) models.set(VEG.SHRUB * 8 + v, prepareModel(shrubModel(v)));

  // --- materials: one pair per kind and detail, season uniforms per class ----------------
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
  // The camera of the main render (onBeforeRender is not called for shadow maps).
  const camPos = new THREE.Vector3(Infinity, 0, 0);
  let viewCamera = null;
  const trackCamera = (renderer, scene, camera) => {
    if (!camera.isPerspectiveCamera) return;
    const e = camera.matrixWorld.elements;
    camPos.set(e[12], e[13], e[14]);
    viewCamera = camera;
  };
  /** () => the shadow-casting DirectionalLight, or null while shadows are off. */
  let shadowLight = () => null;
  /** () => the player's unzoomed field of view (settings.fov). */
  let baseFov = () => 70;
  // Looking through binoculars or a long lens brings trees closer: band distances are
  // scaled by the zoom (in steps, so a zoom animation refills a few times, not every
  // frame), and birds on thin limbs keep their drawn branch under them.
  const lodScale = { value: 1 };

  // --- culling --------------------------------------------------------------------------------
  const cull = {
    frustum: new THREE.Frustum(),
    wide: new THREE.PerspectiveCamera(),
    matrix: new THREE.Matrix4(),
    dir: new THREE.Vector3(0, 0, 0),
    pos: new THREE.Vector3(Infinity, 0, 0),
    fov: 0, aspect: 0,
    turnCos: CULL_TURN_COS,
    active: false,
    // shadow camera state at the last refill
    shadowOn: false,
    sPos: new THREE.Vector3(Infinity, 0, 0),
    sDir: new THREE.Vector3(0, 1, 0),
    sInv: new Float32Array(16),
    sHalfX: 0, sHalfY: 0,
  };
  const box = new THREE.Box3();
  const tmpDir = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  function updateCull() {
    const cam = viewCamera;
    if (!cam || !cam.isPerspectiveCamera) return false;
    const ce = cam.matrixWorld.elements;
    camPos.set(ce[12], ce[13], ce[14]);
    cam.getWorldDirection(tmpDir);
    let changed = false;
    const moved = cull.pos.distanceToSquared(camPos) > CULL_MOVE * CULL_MOVE;
    const zr = cam.fov / Math.max(1, baseFov() || 70);
    // Square root: through 4x optics the bands reach twice as far (not four times),
    // which keeps the zoomed view's triangle count near the unzoomed one.
    const zoom = Math.sqrt(zoomStep(zr));
    if (zoom !== lodScale.value) { lodScale.value = zoom; changed = true; }
    const turned = tmpDir.dot(cull.dir) < cull.turnCos;
    if (moved || turned || cam.fov !== cull.fov || cam.aspect !== cull.aspect || !cull.active) {
      cull.dir.copy(tmpDir);
      cull.pos.copy(camPos);
      cull.fov = cam.fov; cull.aspect = cam.aspect;
      const w = cull.wide;
      // The margin narrows with the zoom (optics turn slowly), and the refill comes
      // before a turn could reach the margin's edge.
      const margin = CULL_MARGIN_DEG * Math.min(1, Math.max(0.3, zr * 1.5));
      w.fov = Math.min(170, cam.fov * 1.25 + margin);
      cull.turnCos = Math.max(CULL_TURN_COS, Math.cos(((w.fov - cam.fov) / 2) * 0.7 * Math.PI / 180));
      w.aspect = cam.aspect;
      w.near = 0.1;
      w.far = Math.max(cam.far, 1);
      w.updateProjectionMatrix();
      w.matrixWorld.copy(cam.matrixWorld);
      w.matrixWorldInverse.copy(cam.matrixWorldInverse);
      cull.matrix.multiplyMatrices(w.projectionMatrix, w.matrixWorldInverse);
      cull.frustum.setFromProjectionMatrix(cull.matrix);
      cull.active = true;
      changed = true;
    }
    // Shadow casters: follow the sun's shadow camera (updated by the sky each frame).
    const light = shadowLight();
    const sc = light?.shadow?.camera;
    const on = !!sc;
    if (on !== cull.shadowOn) { cull.shadowOn = on; changed = true; }
    if (on) {
      sc.updateMatrixWorld();
      tmpV.setFromMatrixPosition(sc.matrixWorld);
      const e = sc.matrixWorld.elements;
      const dx = e[8], dy = e[9], dz = e[10]; // camera +z (towards the light)
      const turnedL = dx * cull.sDir.x + dy * cull.sDir.y + dz * cull.sDir.z < SHADOW_TURN_COS;
      if (changed || turnedL || tmpV.distanceToSquared(cull.sPos) > SHADOW_MOVE * SHADOW_MOVE ||
          cull.sHalfX !== (sc.right - sc.left) / 2 || cull.sHalfY !== (sc.top - sc.bottom) / 2) {
        cull.sPos.copy(tmpV);
        cull.sDir.set(dx, dy, dz);
        // Inverse of a rigid transform: rows of the rotation, then −Rᵀ·t.
        const inv = cull.sInv;
        sc.matrixWorldInverse.copy(sc.matrixWorld).invert();
        inv.set(sc.matrixWorldInverse.elements);
        cull.sHalfX = (sc.right - sc.left) / 2;
        cull.sHalfY = (sc.top - sc.bottom) / 2;
        changed = true;
      }
    }
    return changed;
  }
  function segInView(s) {
    if (!cull.active) return true;
    const b = s.box;
    box.min.set(b[0], b[1], b[2]);
    box.max.set(b[3], b[4], b[5]);
    return cull.frustum.intersectsBox(box);
  }
  /** Light-space overlap of a point cloud's bounding sphere with the shadow map. */
  function inShadowMap(x, y, z, r) {
    const e = cull.sInv;
    const lx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const ly = e[1] * x + e[5] * y + e[9] * z + e[13];
    return Math.abs(lx) <= cull.sHalfX + r + SHADOW_MARGIN && Math.abs(ly) <= cull.sHalfY + r + SHADOW_MARGIN;
  }
  function segInShadow(s) {
    if (!cull.shadowOn) return false;
    const b = s.box;
    const r = 0.5 * Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    return inShadowMap((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, r);
  }

  const materials = new Map();
  /** Material pair of a kind at a detail level (the detail carries its fade window). */
  function materialsFor(kind, detail) {
    const key = kind * 8 + detail;
    let m = materials.get(key);
    if (m) return m;
    const style = treeStyle(kind);
    const tex = treeTextures();
    const cu = classUniforms(style.season);
    const fade = { value: new THREE.Vector4(-2, -1, 1e8, 1e8 + 1) };
    const uniforms = {
      uTime: shared.uTime, uWind: shared.uWind, uWindDir: shared.uWindDir,
      uBend: { value: style.bend }, uFlutter: { value: style.flutter }, uFreq: { value: style.freq },
      uThin: cu.uThin, uFade: fade, uLodScale: lodScale,
      uSeasonA: cu.uSeasonA, uSeasonB: cu.uSeasonB, uSeasonRef: cu.uSeasonRef, uSeasonAmt: cu.uSeasonAmt,
    };
    m = {
      kind, detail, fade,
      wood: createTreeMaterial({ cards: false, map: tex.bark[style.bark.tex], uniforms }),
      leaf: createTreeMaterial({ cards: true, map: style.leafTex === 'needle' ? tex.needle : tex.broad, uniforms }),
    };
    setFade(m);
    materials.set(key, m);
    return m;
  }
  const fadeTmp = [0, 0, 0, 0];
  function setFade(m) {
    if (m.detail > DETAIL.GIANT) return;
    fadeWindow(m.detail, bandsFor(m.kind === VEG.SHRUB, quality), fadeTmp);
    m.fade.value.set(fadeTmp[0], fadeTmp[1], fadeTmp[2], fadeTmp[3]);
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
  /** A geometry sharing another's buffers with its own draw range (shadow casters). */
  function aliasGeometry(src) {
    if (!src) return null;
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) g.setAttribute(name, attr);
    g.setIndex(src.index);
    return g;
  }
  function geometryFor(kind, variant, detail) {
    const key = geoKey(kind, variant, detail);
    let g = geometries.get(key);
    if (g) return g;
    const model = models.get(kind * 8 + variant);
    const style = treeStyle(kind);
    const wood = buildWood(model, style, detail);
    const leaf = buildFoliage(model, style, detail);
    g = { wood: toGeometry(wood, false), leaf: toGeometry(leaf, true), tris: wood.triangleCount + leaf.triangleCount };
    if (detail === SHADOW_DETAIL) g.shadow = { wood: aliasGeometry(g.wood), leaf: aliasGeometry(g.leaf) };
    geometries.set(key, g);
    return g;
  }

  // --- species groups: all instances of one (kind, variant) --------------------------------------
  /**
   * key → { kind, variant, segs: Map(chunkKey → seg), total, slots: [5] }
   *   seg  { n, m: Float32Array(16n), c: Float32Array(3n), giant: Uint8Array(n), box: [6] }
   *   slot { cap, matrix: InstancedBufferAttribute, color, meshes: [] } per detail 0..3 and SHADOW
   */
  const species = new Map();
  const dirty = new Set();

  function speciesFor(kind, variant) {
    const key = speciesKey(kind, variant);
    let g = species.get(key);
    if (!g) {
      g = { key, kind, variant, segs: new Map(), total: 0, slots: [null, null, null, null, null], counts: [0, 0, 0, 0, 0] };
      species.set(key, g);
    }
    return g;
  }

  function disposeSlot(g, d) {
    const slot = g.slots[d];
    if (!slot) return;
    for (const mesh of slot.meshes) { root.remove(mesh); mesh.dispose(); }
    g.slots[d] = null;
  }

  // Shadow casters are skipped in the main pass: an empty draw range there, the full
  // range again for the shadow map (which is drawn before the main pass of a frame).
  function skipMain(renderer, scene, camera, geometry) { geometry.drawRange.count = -1; } // < 0: three skips the draw
  function restoreRange(renderer, scene, camera, geometry) { geometry.drawRange.count = Infinity; }

  /** Ensures a slot with room for `need` instances (shared matrix/colour buffers). */
  function slotFor(g, d, need) {
    let slot = g.slots[d];
    if (slot && need <= slot.cap && need >= slot.cap / 4) return slot;
    disposeSlot(g, d);
    const cap = Math.max(16, Math.ceil(need * 1.5));
    const detail = d === SHADOW ? SHADOW_DETAIL : d;
    const geo = geometryFor(g.kind, g.variant, detail);
    const mats = materialsFor(g.kind, detail);
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
    matrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    color.setUsage(THREE.DynamicDrawUsage);
    slot = { cap, matrix, color, meshes: [] };
    const parts = d === SHADOW ? geo.shadow : geo;
    for (const part of ['wood', 'leaf']) {
      const geom = parts[part];
      if (!geom) continue;
      const mesh = new THREE.InstancedMesh(geom, mats[part].material, cap);
      mesh.instanceMatrix = matrix; // wood and leaf share one GPU buffer
      mesh.instanceColor = color;
      mesh.customDepthMaterial = mats[part].depth;
      // The instances surround the player: culling the whole set is never useful.
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      if (d === SHADOW) {
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.onBeforeRender = skipMain;
        mesh.onAfterRender = restoreRange;
        mesh.name = `tree-shadow:${treeStyle(g.kind).name}/${g.variant}/${part}`;
      } else {
        mesh.castShadow = false;
        mesh.receiveShadow = d >= DETAIL.MID;
        mesh.onBeforeRender = trackCamera;
        mesh.name = `tree:${treeStyle(g.kind).name}/${g.variant}/${part}${d}`;
      }
      root.add(mesh);
      slot.meshes.push(mesh);
    }
    g.slots[d] = slot;
    return slot;
  }

  /** Copies instance i of a segment into slot d at position `o`. */
  function put(slot, s, i, o) {
    const src = s.m, dst = slot.matrix.array;
    const a = i * 16, b = o * 16;
    for (let k = 0; k < 16; k++) dst[b + k] = src[a + k];
    const cs = s.c, cd = slot.color.array;
    cd[o * 3] = cs[i * 3]; cd[o * 3 + 1] = cs[i * 3 + 1]; cd[o * 3 + 2] = cs[i * 3 + 2];
  }

  function rebuild(g) {
    const counts = g.counts;
    counts.fill(0);
    const total = g.total;
    if (!total) { for (let d = 0; d <= SHADOW; d++) disposeSlot(g, d); return; }
    const bands = bandsFor(g.kind === VEG.SHRUB, quality);
    const margin = CULL_MOVE + 1;
    const cx = camPos.x, cz = camPos.z;
    const zs = lodScale.value;
    const shadowsOn = cull.shadowOn;
    const reach = g.reach;
    const height = g.height;
    for (const s of g.segs.values()) {
      const view = segInView(s);
      const shade = shadowsOn && segInShadow(s);
      if (!view && !shade) continue;
      const m = s.m;
      for (let i = 0; i < s.n; i++) {
        const x = m[i * 16 + 12], y = m[i * 16 + 13], z = m[i * 16 + 14];
        if (view) {
          const d = Math.hypot(x - cx, z - cz) * zs;
          const mask = cull.active ? bandMask(d, bands, margin) : 1 << DETAIL.MID;
          for (let det = DETAIL.FAR; det <= DETAIL.NEAR; det++) {
            if (!(mask & (1 << det))) continue;
            const slotD = det === DETAIL.NEAR && s.giant[i] ? DETAIL.GIANT : det;
            const slot = slotFor(g, slotD, total);
            put(slot, s, i, counts[slotD]++);
          }
        }
        if (shade) {
          const k = s.scale[i];
          if (inShadowMap(x, y + height * k * 0.5, z, Math.max(reach, height * 0.5) * k)) {
            const slot = slotFor(g, SHADOW, total);
            put(slot, s, i, counts[SHADOW]++);
          }
        }
      }
    }
    for (let d = 0; d <= SHADOW; d++) {
      const slot = g.slots[d];
      if (!slot) continue;
      const n = counts[d];
      for (const mesh of slot.meshes) { mesh.count = n; mesh.visible = n > 0; }
      slot.matrix.clearUpdateRanges();
      slot.matrix.addUpdateRange(0, n * 16);
      slot.matrix.needsUpdate = true;
      slot.color.clearUpdateRanges();
      slot.color.addUpdateRange(0, n * 3);
      slot.color.needsUpdate = true;
    }
  }

  // --- chunk registration --------------------------------------------------------------------------
  /** chunk key → { handle, chunk, groups: Set<species> } */
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
    const per = new Map(); // species → list of instance indices
    for (let i = 0; i < veg.count; i++) {
      const kind = veg.kind[i];
      if (!draws(kind)) continue;
      const variant = modelVariant(kind, veg.variant[i]);
      if (!models.has(kind * 8 + variant)) continue;
      const g = speciesFor(kind, variant);
      let list = per.get(g);
      if (!list) per.set(g, (list = []));
      list.push(i);
    }
    for (const [g, list] of per) {
      const n = list.length;
      const m = new Float32Array(n * 16), c = new Float32Array(n * 3);
      const giant = new Uint8Array(n), sc = new Float32Array(n);
      const model = models.get(g.kind * 8 + g.variant);
      const reach = modelReach(model);
      g.reach = reach; g.height = model.height;
      const bx = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      list.forEach((i, j) => {
        const k = veg.scale[i];
        writeInstanceMatrix(m, j * 16, veg.x[i], veg.y[i], veg.z[i], k, veg.rot[i]);
        treeTint(veg.kind[i], veg.variant[i], veg.x[i] - ox, veg.z[i] - oz, c, j * 3);
        giant[j] = k >= GIANT_SCALE ? 1 : 0;
        sc[j] = k;
        bx[0] = Math.min(bx[0], veg.x[i] - reach * k); bx[3] = Math.max(bx[3], veg.x[i] + reach * k);
        bx[2] = Math.min(bx[2], veg.z[i] - reach * k); bx[5] = Math.max(bx[5], veg.z[i] + reach * k);
        bx[1] = Math.min(bx[1], veg.y[i] - 1); bx[4] = Math.max(bx[4], veg.y[i] + (model.height + 1) * k);
      });
      const old = g.segs.get(rec.key);
      if (old) g.total -= old.n;
      g.segs.set(rec.key, { m, c, n, giant, scale: sc, box: bx });
      g.total += n;
      rec.groups.add(g);
      dirty.add(g);
    }
  }

  function unbucket(rec) {
    for (const g of rec.groups) {
      const s = g.segs.get(rec.key);
      if (s) { g.total -= s.n; g.segs.delete(rec.key); }
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
    for (const g of species.values()) for (let d = 0; d <= SHADOW; d++) disposeSlot(g, d);
    for (const g of geometries.values()) {
      g.wood?.dispose(); g.leaf?.dispose();
      g.shadow?.wood?.dispose(); g.shadow?.leaf?.dispose();
    }
    geometries.clear();
    species.clear();
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
    if (updateCull()) for (const g of species.values()) dirty.add(g);
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
    /** settings.quality: picks the distance bands. */
    setQuality(name) {
      if (name === quality) return;
      quality = name;
      for (const m of materials.values()) setFade(m);
      for (const g of species.values()) dirty.add(g);
    },
    /** The view camera (instead of waiting for the first drawn tree to report it). */
    setCamera(camera) { if (camera?.isPerspectiveCamera) viewCamera = camera; },
    /** () => the unzoomed field of view in degrees (settings.fov). */
    setBaseFov(fn) { if (typeof fn === 'function') baseFov = fn; },
    /** () => the shadow-casting light (ctx.sky.light) while shadows are on, else null. */
    setShadowLight(fn) { shadowLight = typeof fn === 'function' ? fn : () => null; },
    /** Jumps straight to a season (first frame, no wash-in). */
    snapSeason(season) {
      curSeason = season;
      for (const [cls, u] of classes) ease(cls, u, season, 1);
    },
    /** Diagnostics: registered instances, and drawn instances/triangles per slot. */
    get stats() {
      let meshes = 0, instances = 0, triangles = 0;
      const drawn = [0, 0, 0, 0, 0];
      for (const g of species.values()) {
        instances += g.total;
        for (let d = 0; d <= SHADOW; d++) {
          const slot = g.slots[d];
          if (!slot) continue;
          meshes += slot.meshes.length;
          drawn[d] += g.counts[d];
          triangles += g.counts[d] * geometryFor(g.kind, g.variant, d === SHADOW ? SHADOW_DETAIL : d).tris;
        }
      }
      return { groups: species.size, meshes, instances, triangles, chunks: live.size, far: drawn[0], mid: drawn[1], near: drawn[2], giant: drawn[3], shadow: drawn[4] };
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
