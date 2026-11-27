// Vegetation rendering: one shared geometry per (kind, detail), one material per kind,
// and per chunk one InstancedMesh per kind present.
//
// The foliage shader (a patched MeshLambertMaterial, so lights, fog and shadows behave
// like everywhere else) adds two things:
//   * wind: the whole plant bends downwind, with gusts and a small leaf flutter, scaled
//     by the per-vertex sway weight (aVeg.x), the instance height and state.env.wind.
//     The offset is computed in world space and converted back into the instance's own
//     space, so shadows and depth (customDepthMaterial) move with the leaves;
//   * season: leaf vertices (aVeg.y) blend towards the seasonal colour of their class,
//     keeping their light/shade structure; plants pick one of two seasonal colours.
// Per-instance colour (instanceColor) is applied with the per-vertex weight aVeg.z, so
// bark stays bark while crowns and petals vary. Optional model parts (aVeg2: the
// fraction of instances that show the part, e.g. a lily flower) are collapsed on the
// other instances.
//
// Trees and shrubs are drawn by the forest (trees/forest.js) from branching models —
// the server's tree models (welcome.trees, setTreeModels) and the shrub models — with
// one InstancedMesh per model across all chunks. Each chunk's mesh list carries a
// small handle that registers and unregisters its trees with the forest. Until the
// tree models arrive (or should a server not send them) trees fall back to the
// procedural low-poly models of vegModels.js.
import * as THREE from 'three';
import { VEG_INFO, VEG_KIND_COUNT, VEG, REGION } from './constants.js';
import { buildVegModel, detailForLod } from './vegModels.js';
import { seasonTint, easeTint } from './season.js';
import { countInstances, fillInstances } from './instances.js';
import { chunkSphere } from './terrainMesh.js';
import { createForest } from './trees/forest.js';

const HEADER = /* glsl */`
attribute vec3 aVeg;
attribute float aVeg2;
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform float uBend;
uniform float uFlutter;
uniform float uFreq;
uniform vec3 uSeasonA;
uniform vec3 uSeasonB;
uniform vec3 uSeasonRef;
uniform float uSeasonAmt;
uniform vec2 uDecorFar;   // small decoration shrinks away between these distances (0 = off)

// Wind offset for this vertex in the instance's local space.
vec3 vegWind(vec3 p) {
#ifdef USE_INSTANCING
  float sway = aVeg.x;
  if (sway <= 0.0 || uWind <= 0.001) return vec3(0.0);
  vec2 wp = modelMatrix[3].xz + instanceMatrix[3].xz;
  float ph = mod(dot(wp, vec2(0.071, 0.053)), 6.2831853);
  float sy = length(instanceMatrix[1].xyz);
  float gust = 0.55 + 0.45 * sin(uTime * 0.37 + ph * 0.6) * sin(uTime * 0.13 + ph);
  float lean = uWind * uBend * sy * sway * gust * (0.65 + 0.35 * sin(uTime * uFreq + ph));
  float fl = uWind * uFlutter * sy * sway * sin(uTime * uFreq * 3.7 + dot(p, vec3(3.1, 2.3, 2.9)) + ph);
  vec3 w = vec3(uWindDir.x * lean + fl, fl * 0.6 - lean * 0.15, uWindDir.y * lean - fl * 0.7);
  // instanceMatrix = R(y) * S: columns are orthogonal, so the inverse is cheap.
  vec3 c0 = instanceMatrix[0].xyz, c1 = instanceMatrix[1].xyz, c2 = instanceMatrix[2].xyz;
  return vec3(dot(c0, w) / dot(c0, c0), dot(c1, w) / dot(c1, c1), dot(c2, w) / dot(c2, c2));
#else
  return vec3(0.0);
#endif
}
`;

const BEGIN = /* glsl */`
vec3 transformed = vec3(position) + vegWind(position);
#ifdef USE_INSTANCING
  if (uDecorFar.y > 0.0) {
    vec3 ipw = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    transformed *= 1.0 - smoothstep(uDecorFar.x, uDecorFar.y, distance(ipw.xz, cameraPosition.xz));
  }
  if (aVeg2 < 1.0) {
    vec2 ip = mod(modelMatrix[3].xz * 0.29 + instanceMatrix[3].xz, 991.0);
    if (fract(sin(dot(ip, vec2(39.346, 11.135))) * 24634.6345) >= aVeg2) transformed = vec3(0.0);
  }
#endif
#ifdef USE_ALPHAHASH
  vPosition = vec3(position);
#endif
`;

const COLOR = /* glsl */`
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3(1.0);
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor *= mix(vec3(1.0), instanceColor, aVeg.z);
#endif
#if defined( USE_COLOR ) && defined( USE_INSTANCING )
  if (uSeasonAmt > 0.0 && aVeg.y > 0.0) {
    vec2 ip = mod(modelMatrix[3].xz * 0.37 + instanceMatrix[3].xz, 997.0);
    float pick = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453);
    vec3 target = mix(uSeasonA, uSeasonB, step(0.5, pick));
    // Keep each vertex's light and shade: scale the seasonal colour by how bright the
    // vertex is relative to the class's summer reference.
    const vec3 L = vec3(0.2126, 0.7152, 0.0722);
    float ratio = clamp(dot(vColor, L) / max(dot(uSeasonRef, L), 1e-3), 0.35, 1.9);
    vColor = mix(vColor, target * ratio, uSeasonAmt * aVeg.y);
  }
#endif
`;

function patch(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = HEADER + shader.vertexShader
    .replace('#include <begin_vertex>', BEGIN)
    .replace('#include <color_vertex>', COLOR);
}

/**
 * Builds the shared vegetation resources.
 * @returns {VegetationKit}
 */
export function createVegetationKit() {
  const shared = {
    uTime: { value: 0 },
    uWind: { value: 0.3 },
    uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
  };
  // One live tint per season class, shared by every kind of that class.
  const tints = new Map();
  const classUniforms = (cls) => {
    let u = tints.get(cls);
    if (!u) {
      const ref = seasonTint(cls, 1); // summer
      const sumRef = ref.a.slice();
      u = {
        live: { a: [0, 0, 0], b: [0, 0, 0], amt: 0 },
        uSeasonA: { value: new THREE.Color() },
        uSeasonB: { value: new THREE.Color() },
        uSeasonRef: { value: new THREE.Color(sumRef[0], sumRef[1], sumRef[2]) },
        uSeasonAmt: { value: 0 },
      };
      tints.set(cls, u);
    }
    return u;
  };

  const materials = [];
  const depthMaterials = [];
  // Performance pass: small decoration (flowers, tufts, ferns, mushrooms) shrinks away
  // with distance and whole chunk meshes of it are hidden beyond (updateDecor).
  const decorFar = { value: new THREE.Vector2(45, 65) };
  const noFade = { value: new THREE.Vector2(0, 0) };
  for (let k = 0; k < VEG_KIND_COUNT; k++) {
    const info = VEG_INFO[k];
    const cu = classUniforms(info.season);
    const uniforms = {
      ...shared,
      uBend: { value: info.bend },
      uFlutter: { value: info.flutter },
      uFreq: { value: info.freq },
      uSeasonA: cu.uSeasonA, uSeasonB: cu.uSeasonB, uSeasonRef: cu.uSeasonRef, uSeasonAmt: cu.uSeasonAmt,
      uDecorFar: info.decor ? decorFar : noFade,
    };
    // Single-sided on purpose: blades and petals are built with both windings already.
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (shader) => patch(shader, uniforms);
    mat.customProgramCacheKey = () => 'wc-veg';
    materials.push(mat);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader) => patch(shader, uniforms);
    depth.customProgramCacheKey = () => 'wc-veg-depth';
    depthMaterials.push(depth);
  }

  const geometries = new Map();
  /** Shared geometry of a kind at a detail level (built on first use, kept for the session). */
  function geometryFor(kind, detail, snowy = false) {
    const key = kind * 4 + detail + (snowy ? 1000 : 0);
    let g = geometries.get(key);
    if (g) return g;
    const m = buildVegModel(kind, detail, snowy);
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(m.color, 3));
    g.setAttribute('aVeg', new THREE.BufferAttribute(m.veg, 3));
    g.setAttribute('aVeg2', new THREE.BufferAttribute(m.part || new Float32Array(m.vertexCount).fill(1), 1));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    g.userData.model = m;
    geometries.set(key, g);
    return g;
  }

  const counts = new Uint32Array(VEG_KIND_COUNT);
  /** Every live decoration mesh (removed again when the chunk disposes it). */
  const decorMeshes = new Set();
  const sphere = new THREE.Sphere();
  const bounds = { minY: 0, maxY: 0, reach: 0 };
  const forest = createForest(shared);

  return {
    materials,
    /** The group holding every tree and shrub; the world adds it to its root. */
    trees: forest.root,
    forest,
    /**
     * Installs the server's tree models (welcome.trees, contract §11).
     * @param {object[]} list  proto.TreeModel[]
     * @returns {boolean} whether trees are now drawn from them
     */
    setTreeModels: (list) => forest.setModels(list),
    /**
     * Builds the InstancedMeshes of one chunk's vegetation.
     * @param {import('./chunkCodec.js').ChunkData} chunk
     * @param {{decor:number, shadows:boolean}} quality
     * @returns {THREE.InstancedMesh[]}
     */
    buildChunk(chunk, quality) {
      const out = [];
      const veg = chunk.veg;
      if (!veg.count) return out;
      for (let i = 0; i < veg.count; i++) {
        if (forest.draws(veg.kind[i])) { out.push(forest.handleFor(chunk)); break; }
      }
      countInstances(veg, quality.decor, counts);
      const ox = chunk.cx * 64, oz = chunk.cz * 64;
      for (let k = 0; k < VEG_KIND_COUNT; k++) {
        const n = counts[k];
        if (!n || forest.draws(k)) continue;
        // Rocks, logs and stumps on snowy ground (Frostveil) wear snow instead of moss.
        const snowy = (k === VEG.ROCK || k === VEG.LOG || k === VEG.STUMP) && snowyChunk(chunk);
        const geo = geometryFor(k, Math.min(detailForLod(k, chunk.lod), quality.vegDetail ?? 2), snowy);
        const matrices = new Float32Array(n * 16);
        const colors = new Float32Array(n * 3);
        const written = fillInstances(veg, k, ox, oz, quality.decor, geo.userData.model, matrices, colors, bounds);
        if (!written) continue;
        const mesh = new THREE.InstancedMesh(geo, materials[k], written);
        mesh.instanceMatrix = new THREE.InstancedBufferAttribute(matrices, 16);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        mesh.count = written;
        const s = chunkSphere(bounds.minY, bounds.maxY, bounds.reach);
        mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(s.x, s.y, s.z), s.r);
        mesh.customDepthMaterial = depthMaterials[k];
        mesh.castShadow = !!quality.shadows && VEG_INFO[k].shadow;
        mesh.receiveShadow = !!quality.shadows;
        mesh.matrixAutoUpdate = false;
        mesh.name = 'veg:' + VEG_INFO[k].name;
        if (VEG_INFO[k].decor) {
          mesh.userData.decor = true;
          decorMeshes.add(mesh);
          mesh.addEventListener('dispose', () => decorMeshes.delete(mesh));
        }
        out.push(mesh);
      }
      return out;
    },

    /** Decoration fade distances [start, end] in metres (per quality). */
    setDecorRange(start, end) { decorFar.value.set(start, end); },
    /**
     * Per frame: hides decoration meshes whose chunk lies wholly beyond the fade-out
     * (their instances would all be collapsed anyway). A few dozen sphere tests.
     */
    updateDecor(cam) {
      const end = decorFar.value.y;
      for (const m of decorMeshes) {
        if (!m.parent) continue;
        sphere.copy(m.boundingSphere).applyMatrix4(m.parent.matrixWorld);
        const d = Math.hypot(sphere.center.x - cam.x, sphere.center.z - cam.z) - sphere.radius;
        m.visible = d < end;
      }
    },
    /**
     * Per-frame animation state.
     * @param {number} time   seconds
     * @param {number} wind   0..1 (state.env.wind)
     * @param {number} season core.Season
     * @param {number} dt     seconds since the last frame
     */
    update(time, wind, season, dt) {
      shared.uTime.value = time;
      // Ease towards the weather's wind so a change never makes the forest jump.
      const k = 1 - Math.exp(-dt * 0.6);
      shared.uWind.value += ((0.12 + 0.88 * clamp01(wind)) - shared.uWind.value) * k;
      // A prevailing south-westerly that wanders slowly.
      const a = 0.9 + Math.sin(time * 0.011) * 0.5;
      shared.uWindDir.value.set(Math.cos(a), Math.sin(a));
      forest.update(dt, season);
      const tk = 1 - Math.exp(-dt * 0.35);
      for (const [cls, u] of tints) {
        if (!cls) continue;
        easeTint(u.live, seasonTint(cls, season), tk);
        u.uSeasonA.value.setRGB(u.live.a[0], u.live.a[1], u.live.a[2]);
        u.uSeasonB.value.setRGB(u.live.b[0], u.live.b[1], u.live.b[2]);
        u.uSeasonAmt.value = u.live.amt;
      }
    },

    /** Jumps straight to a season's colours (first frame, no wash-in). */
    snapSeason(season) {
      forest.snapSeason(season);
      for (const [cls, u] of tints) {
        if (!cls) continue;
        easeTint(u.live, seasonTint(cls, season), 1);
        u.uSeasonA.value.setRGB(u.live.a[0], u.live.a[1], u.live.a[2]);
        u.uSeasonB.value.setRGB(u.live.b[0], u.live.b[1], u.live.b[2]);
        u.uSeasonAmt.value = u.live.amt;
      }
    },
  };
}

/**
 * True when a chunk is snowy ground: in Frostveil (or anywhere) with at least a third of
 * its vertices snow-white (bright, unsaturated terrain colour).
 */
function snowyChunk(chunk) {
  const c = chunk.colors, r = chunk.region;
  if (!c || !c.length) return false;
  let snow = 0, total = 0, frost = 0;
  for (let v = 0; v * 3 < c.length; v += 2) {
    const R = c[v * 3], G = c[v * 3 + 1], B = c[v * 3 + 2];
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    if (R + G + B > 560 && max - min < 40) snow++;
    if (r && r[v] === REGION.FROSTVEIL) frost++;
    total++;
  }
  return snow * 3 > total || (frost * 2 > total && snow * 6 > total);
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v || 0; }
