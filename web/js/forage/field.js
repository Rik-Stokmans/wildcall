// The forage plants in the 3D world (task c-field): reads the LOD-0 vegetation of the
// chunks around the player (ctx.world.vegOf), keeps every forage plant (kinds 18–35)
// as a node with its pinned id "fg@<cx>,<cz>,<n>", and draws them with one
// InstancedMesh per (kind, variant, part). The pickable part of a plant is only drawn
// while it bears this season and is not regrowing (profile.forage), and disappears the
// moment a pick succeeds.
import * as THREE from 'three';
import { buildPlant, KIND_INFO, VARIANTS, seasonTint } from './plants.js';
import { createLeafAtlas } from './atlas.js';
import { isForageKind, nodeId, nodeState, seasonOf } from './logic.js';

const CHUNK_RING = 2;          // lod-0 chunks around the player that are scanned
const SCAN_EVERY = 0.5;        // seconds between chunk scans
const MOVE_REBUILD = 18;       // metres walked before view culling is redone

/** Wind for the plants: a gentle lean and flutter weighted by the aSway attribute. */
function windPatch(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `
attribute float aSway;
attribute vec2 aCard;
attribute float aLeaf;
uniform float uTime;
uniform float uWind;
` + shader.vertexShader.replace('#include <project_vertex>', `
vec4 mvPosition = vec4( transformed, 1.0 );
float cardScale = 1.0;
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
  cardScale = length(instanceMatrix[0].xyz);
#endif
mvPosition = modelViewMatrix * mvPosition;
// leaf cards turn to face the camera (aCard is the corner offset in metres)
mvPosition.xy += aCard * cardScale;
gl_Position = projectionMatrix * mvPosition;
`).replace('#include <color_vertex>', `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  // the season and per-plant tint colour the foliage, never the wood or the fruit
  vColor *= mix( vec3( 1.0 ), instanceColor, aLeaf );
#endif
`).replace('#include <begin_vertex>', `
vec3 transformed = vec3(position);
#ifdef USE_INSTANCING
{
  vec2 wp = instanceMatrix[3].xz;
  float ph = dot(wp, vec2(0.37, 0.23));
  float gust = 0.6 + 0.4 * sin(uTime * 0.41 + ph * 0.3);
  float w = aSway * (0.25 + uWind) * gust;
  transformed.x += w * (0.045 * sin(uTime * 1.7 + ph) + 0.012 * sin(uTime * 5.3 + position.y * 9.0 + ph));
  transformed.z += w * (0.035 * cos(uTime * 1.4 + ph * 1.3) + 0.012 * sin(uTime * 4.7 + position.x * 9.0));
}
#endif
`);
  };
  material.customProgramCacheKey = () => 'frg-wind-card-leaf';
}

export function createForageField(ctx) {
  const { scene, state, bus } = ctx;
  const root = new THREE.Group();
  root.name = 'forage';
  scene.add(root);

  const uniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };
  const atlas = createLeafAtlas();
  const baseMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: atlas, alphaTest: 0.42 });
  windPatch(baseMat, uniforms);
  const cropMat = new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, shininess: 46, specular: new THREE.Color(0x2a2a2a) });
  windPatch(cropMat, uniforms);

  const models = new Map();  // "kind:variant" → {base, crops}
  const model = (kind, variant) => {
    const key = kind + ':' + variant;
    if (!models.has(key)) models.set(key, buildPlant(kind, variant));
    return models.get(key);
  };

  /** All forage nodes of the scanned chunks: {id, kind, plant, x, y, z, scale, rot, variant, cx, cz}. */
  let nodes = [];
  const chunkLists = new Map(); // "cx,cz" → the vegOf array last seen
  const meshes = new Map();     // "b|kind|v" or "c|kind|v|item" → InstancedMesh
  const plantByVeg = new Map();
  const pickedNow = new Set();  // ids picked this session that profile.forage may not show yet
  const origin = { x: 0, z: 0 };
  let lastBuild = { x: NaN, z: NaN };
  let dirty = true;
  let scanT = 0;
  let lastSeason = -1, lastForageSig = '';

  function indexPlants() {
    plantByVeg.clear();
    for (const p of state.welcome?.plants || []) plantByVeg.set(p.veg, p);
    chunkLists.clear(); // the next scan rebuilds every node with its plant
  }

  function feet() {
    const f = ctx.player?.feet || ctx.player?.pos || ctx.camera.position;
    return f;
  }

  /** Re-reads the vegetation of the chunks around the player; marks dirty on change. */
  function scan() {
    const world = ctx.world;
    if (!world?.vegOf) return;
    const size = world.chunkSize || 64;
    const f = feet();
    const pcx = Math.floor(f.x / size), pcz = Math.floor(f.z / size);
    const seen = new Set();
    let changed = false;
    for (let dz = -CHUNK_RING; dz <= CHUNK_RING; dz++) {
      for (let dx = -CHUNK_RING; dx <= CHUNK_RING; dx++) {
        const cx = pcx + dx, cz = pcz + dz, key = cx + ',' + cz;
        let list = null;
        try { list = world.vegOf(cx, cz); } catch { list = null; }
        if (list) seen.add(key);
        if (chunkLists.get(key) !== (list || undefined)) {
          if (list) chunkLists.set(key, list); else chunkLists.delete(key);
          changed = true;
        }
      }
    }
    for (const key of [...chunkLists.keys()]) if (!seen.has(key)) { chunkLists.delete(key); changed = true; }
    if (changed) {
      const out = [];
      for (const [key, list] of chunkLists) {
        const [cx, cz] = key.split(',').map(Number);
        for (let n = 0; n < list.length; n++) {
          const v = list[n];
          if (!isForageKind(v.kind)) continue;
          const plant = plantByVeg.get(v.kind) || null;
          // node.scale includes the kind's drawing exaggeration (KIND_INFO.k)
          const k = KIND_INFO[v.kind]?.k || 1;
          out.push({ id: nodeId(cx, cz, n), kind: v.kind, plant, x: v.x, y: v.y, z: v.z, scale: (v.scale || 1) * k, rot: v.rot || 0, variant: v.variant | 0, cx, cz, n });
        }
      }
      nodes = out;
      dirty = true;
    }
  }

  const mat4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const col = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);

  function meshFor(key, geom, material, need) {
    let m = meshes.get(key);
    if (m && m.instanceMatrix.count < need) { root.remove(m); m.dispose(); m = null; }
    if (!m) {
      let cap = 16;
      while (cap < need) cap *= 2;
      m = new THREE.InstancedMesh(geom, material, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.receiveShadow = true;
      m.frustumCulled = true;
      m.name = 'forage:' + key;
      meshes.set(key, m);
      root.add(m);
    }
    return m;
  }

  /** Is the crop of a node drawn right now? */
  function bearing(node) {
    if (!node.plant) return null;
    if (pickedNow.has(node.id)) return null;
    const st = nodeState(node.plant, node.id, state.profile, state.env);
    return st.state === 'ripe' ? st.yield.item : null;
  }

  function rebuild() {
    dirty = false;
    const f = feet();
    lastBuild = { x: f.x, z: f.z };
    origin.x = Math.round(f.x / 64) * 64;
    origin.z = Math.round(f.z / 64) * 64;
    root.position.set(origin.x, 0, origin.z);
    const season = seasonOf(state.env);
    // group the visible instances
    const groups = new Map(); // key → {geom, mat, list:[node]}
    const add = (key, geom, material, node) => {
      let g = groups.get(key);
      if (!g) { g = { geom, material, list: [] }; groups.set(key, g); }
      g.list.push(node);
    };
    for (const node of nodes) {
      const info = KIND_INFO[node.kind];
      if (!info || info.hidden.includes(season)) continue;
      const d = Math.hypot(node.x - f.x, node.z - f.z);
      if (d > info.view) continue;
      const v = node.variant % VARIANTS;
      const m = model(node.kind, v);
      if (!m) continue;
      if (m.base) add(`b|${node.kind}|${v}`, m.base, baseMat, node);
      const item = bearing(node);
      if (item && m.crops[item]) add(`c|${node.kind}|${v}|${item}`, m.crops[item], cropMat, node);
    }
    for (const [key, m] of meshes) if (!groups.has(key)) m.count = 0;
    for (const [key, g] of groups) {
      const m = meshFor(key, g.geom, g.material, g.list.length);
      const isBase = key[0] === 'b';
      let i = 0;
      for (const node of g.list) {
        // a little per-instance shape variety from the variant byte
        const vb = node.variant;
        const sx = node.scale * (0.9 + ((vb >> 2) & 7) / 7 * 0.22);
        const sy = node.scale * (0.9 + ((vb >> 5) & 7) / 7 * 0.2);
        q.setFromAxisAngle(Y, node.rot);
        p3.set(node.x - origin.x, node.y - 0.02, node.z - origin.z);
        s3.set(sx, sy, sx);
        mat4.compose(p3, q, s3);
        m.setMatrixAt(i, mat4);
        if (isBase) {
          const t = seasonTint(node.kind, season);
          const k = 0.9 + (vb & 3) * 0.06;
          col.setRGB(t[0] * k, t[1] * k, t[2] * k);
        } else col.setRGB(1, 1, 1);
        m.setColorAt(i, col);
        i++;
      }
      m.count = i;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  function forageSig() {
    const fg = state.profile?.forage || {};
    return Object.keys(fg).length + ':' + Object.entries(fg).map(([k, v]) => k + '=' + v).join(',') + '|' + (state.env?.day | 0);
  }

  bus.on('welcome', () => { indexPlants(); dirty = true; });
  bus.on('profile', () => {
    const sig = forageSig();
    if (sig !== lastForageSig) {
      lastForageSig = sig;
      // profile.forage now holds what was picked: the optimistic set can go
      for (const id of [...pickedNow]) if (state.profile?.forage?.[id] != null) pickedNow.delete(id);
      dirty = true;
    }
  });
  bus.on('env', (e) => {
    const s = seasonOf(e);
    if (s !== lastSeason) { lastSeason = s; dirty = true; }
    const sig = forageSig();
    if (sig !== lastForageSig) { lastForageSig = sig; dirty = true; }
  });
  bus.on('world:chunk', () => { scanT = Math.min(scanT, 0.05); });

  return {
    root,
    get nodes() { return nodes; },
    /** Hides a node's crop at once (a successful pick, before the profile arrives). */
    markPicked(id) { pickedNow.add(id); dirty = true; },
    /** True while a pick is shown before the profile confirms it. */
    isPicked: (id) => pickedNow.has(id),
    /** Forces a redraw on the next frame. */
    invalidate() { dirty = true; },
    /** The node with an id among the scanned chunks, or null. */
    node(id) { return nodes.find((n) => n.id === id) || null; },
    /** Nodes within `r` metres of a point (XZ), nearest first. */
    near(x, z, r, out = []) {
      out.length = 0;
      const season = seasonOf(state.env);
      for (const n of nodes) {
        const info = KIND_INFO[n.kind];
        if (!info || info.hidden.includes(season)) continue;
        const d = Math.hypot(n.x - x, n.z - z);
        if (d <= r + info.radius * n.scale) out.push(n);
      }
      return out;
    },
    bearingItem: bearing,
    update(dt) {
      uniforms.uTime.value = ctx.time;
      uniforms.uWind.value = state.env?.wind ?? 0.3;
      scanT -= dt;
      if (scanT <= 0) { scanT = SCAN_EVERY; indexPlantsIfNeeded(); scan(); }
      const f = feet();
      if (!dirty && Math.hypot(f.x - lastBuild.x, f.z - lastBuild.z) > MOVE_REBUILD) dirty = true;
      if (dirty && plantByVeg.size) rebuild();
    },
    get debug() {
      let inst = 0, draws = 0;
      for (const m of meshes.values()) if (m.count) { inst += m.count; draws++; }
      return { nodes: nodes.length, chunks: chunkLists.size, instances: inst, drawCalls: draws, models: models.size };
    },
  };

  function indexPlantsIfNeeded() { if (!plantByVeg.size && state.welcome?.plants) indexPlants(); }
}
