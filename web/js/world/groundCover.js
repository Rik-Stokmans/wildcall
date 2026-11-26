// Lush ground: GPU-scattered grass, wildflower drifts and ferns around the camera.
//
// Everything a plant is — where it stands, how tall, which colour, whether it exists at
// all — is computed in the vertex shader from its fixed world-lattice index and a small
// window of ground textures (groundField.js). The CPU only
//   * refills that window a few rows per frame when chunks arrive or the player moves on,
//   * snaps each ring's patches to its lattice and sets their visibility (a few dozen
//     matrix writes per frame),
//   * eases wind and season uniforms.
// So plants never swim or pop, density falls off smoothly with distance, and the field
// melts into the terrain colour at its far edge.
//
// The materials are patched MeshLambertMaterials, so sun, sky light, fog and (on high)
// shadows behave exactly as on the terrain.
import * as THREE from 'three';
import {
  GROUND_RES, GROUND_TEXEL, LATTICE_BIAS, FADE_START, FADE_END,
  groundOrigin, allocGroundPlanes, fillGroundRows, createCanopyCache, ringLayout, ringHole, ringPatches,
} from './groundField.js';
import { groundQualityOf } from './constants.js';
import { tuftGeometry, flowerGeometry, fernGeometry } from './groundModels.js';

const ROWS_PER_FRAME = 16;
const REFRESH_SECONDS = 0.5;

// --- shared GLSL ------------------------------------------------------------------

/** Colour helpers shared with the terrain shader (so far grass and ground agree). */
export const GRASS_COLOR_GLSL = /* glsl */`
uniform vec4 uGrassTint;   // rgb: seasonal tip colour (linear), a: amount
vec3 grassTip(vec3 root) {
  vec3 t = root * vec3(1.3, 1.24, 0.82) + vec3(0.022, 0.026, 0.0);
  return mix(t, uGrassTint.rgb * (0.6 + 2.2 * dot(root, vec3(0.3, 0.6, 0.1))), uGrassTint.a);
}
// The colour a stretch of grass averages to from a distance.
vec3 grassField(vec3 root) { return mix(root, grassTip(root), 0.42); }
`;

const NOISE_GLSL = /* glsl */`
float gHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash21(i), gHash21(i + vec2(1.0, 0.0)), u.x),
             mix(gHash21(i + vec2(0.0, 1.0)), gHash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const SCATTER_GLSL = /* glsl */`
attribute vec2 aCell;
uniform highp sampler2D uGH;
uniform sampler2D uGC;
uniform sampler2D uGV;
uniform sampler2D uGA;
uniform vec2 uGOrigin;
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uSpacing;
uniform float uBase;
uniform float uRing;
uniform float uMaxLevel;
uniform float uH0;
uniform vec4 uInner;
uniform vec4 uAmount;     // x grass density, y grass height, z flowers, w ferns (season)
uniform float uWet;       // rain on the leaves, 0..1
varying vec3 vTrans;
varying vec3 vShape;      // per-layer shape data for the fragment shader (cut-outs)

const float G_RES = ${GROUND_RES.toFixed(1)};
const float G_TEXEL = ${GROUND_TEXEL.toFixed(1)};

${NOISE_GLSL}

uint gHash(vec2 idx) {
  uvec2 u = uvec2(ivec2(idx) + ${LATTICE_BIAS});
  uint h = (u.x * 0x8da6b343u) ^ (u.y * 0xd8163841u);
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return h;
}
float gRand(inout uint h) {
  h ^= h >> 13; h *= 0x5bd1e995u; h ^= h >> 15;
  return float(h & 0xffffffu) / 16777216.0;
}
vec2 gUV(vec2 w) { return ((w - uGOrigin) / G_TEXEL + 0.5) / G_RES; }
// Ground height under w (bilinear over the 2 m texels); -1000 where nothing is loaded,
// so a plant there (or under the water, height < 0) is never drawn.
float gHeight(vec2 w) {
  vec2 f = (w - uGOrigin) / G_TEXEL;
  vec2 i = floor(f);
  if (i.x < 0.0 || i.y < 0.0 || i.x > G_RES - 2.0 || i.y > G_RES - 2.0) return -1000.0;
  vec2 t = f - i;
  ivec2 a = ivec2(i);
  float h00 = texelFetch(uGH, a, 0).r;
  float h10 = texelFetch(uGH, a + ivec2(1, 0), 0).r;
  float h01 = texelFetch(uGH, a + ivec2(0, 1), 0).r;
  float h11 = texelFetch(uGH, a + ivec2(1, 1), 0).r;
  if (min(min(h00, h10), min(h01, h11)) < -999.0) return -1000.0;
  return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
}
vec3 gNormal(vec4 aux) {
  vec2 nxz = (aux.rg * 255.0 - 128.0) / 127.0;
  return normalize(vec3(nxz.x, sqrt(max(0.05, 1.0 - dot(nxz, nxz))), nxz.y));
}

// The plant at this instance's lattice point: false if this ring does not draw it or it
// has faded out. p = jittered world position, d = distance to the camera.
bool plantAt(out vec2 p, out float d, out float fade, out uint h, out float level) {
  vec2 cellW = modelMatrix[3].xz + aCell * uSpacing;
  vec2 idx = floor(cellW / uBase + 0.5);
  p = vec2(0.0); d = 0.0; fade = 0.0; h = 0u; level = uRing;
  if (uRing > 0.5 && idx.x >= uInner.x && idx.y >= uInner.y && idx.x < uInner.z && idx.y < uInner.w) return false;
  float m = exp2(uRing + 1.0);
  for (int L = 0; L < 8; L++) {
    if (level >= uMaxLevel) break;
    if (mod(idx.x, m) != 0.0 || mod(idx.y, m) != 0.0) break;
    level += 1.0;
    m *= 2.0;
  }
  h = gHash(idx);
  float s = uBase * exp2(level);
  p = idx * uBase + (vec2(gRand(h), gRand(h)) - 0.5) * s * 0.92;
  d = distance(p, cameraPosition.xz);
  float reach = uH0 * exp2(level);
  fade = 1.0 - smoothstep(reach * ${FADE_START.toFixed(3)}, reach * ${FADE_END.toFixed(3)}, d);
  return fade > 0.002;
}

float windGust(vec2 p) {
  return vnoise(p * 0.045 - uWindDir * uTime * 1.15) * 0.65 + vnoise(p * 0.16 - uWindDir * uTime * 2.2) * 0.35;
}
`;

// Grass: a tuft of tapered, curved blades rising from the root colour to a lighter,
// warmer tip, bent by travelling gusts.
const GRASS_MAIN = /* glsl */`
vec3 gPos = vec3(0.0);
vec3 gNrm = vec3(0.0, 1.0, 0.0);
vColor = vec3(0.0);
vTrans = vec3(0.0);
vShape = vec3(0.0);
{
  vec2 p; float d, fade, level; uint h;
  if (plantAt(p, d, fade, h, level)) {
    vec2 uv = gUV(p);
    vec4 cov = texture(uGV, uv);
    float gy = gHeight(p);
    if (gRand(h) < cov.r * uAmount.x && gy > 0.06) {
      vec4 aux = texture(uGA, uv);
      vec3 root = pow(texture(uGC, uv).rgb, vec3(2.2));
      float grow = smoothstep(0.0, 0.65, fade);
      float H = (0.13 + 0.85 * cov.g) * (0.6 + 0.75 * gRand(h)) * uAmount.y * (0.35 + 0.65 * grow);
      float widen = max(1.0, d * 0.3) * grow;
      float w = 0.034 * (0.75 + 0.5 * gRand(h)) * widen;
      float yaw = gRand(h) * 6.2831853;
      float curve = 0.18 + 0.4 * gRand(h);
      float ph = gRand(h) * 6.2831853;
      float shade = 0.86 + 0.26 * gRand(h);

      float v = position.y, side = position.x, b = position.z;
      float by = yaw + b * 2.39996;
      vec2 fdir = vec2(cos(by), sin(by));
      vec2 across = vec2(-fdir.y, fdir.x);
      vec2 off = b > 0.5 ? vec2(cos(ph + b * 2.1), sin(ph + b * 2.1)) * 0.05 * max(1.0, d * 0.3) : vec2(0.0);
      float gust = windGust(p);
      float sway = uWind * (0.2 + 1.05 * gust) + 0.07 * (0.3 + uWind) * sin(uTime * 2.4 + ph);
      vec2 lean = fdir * curve + uWindDir * sway * 0.8;
      float bl = min(1.0, length(lean) * v);
      float y = H * v * (1.0 - 0.32 * bl * bl);
      vec2 xz = p + off + across * side * w * (1.0 - 0.85 * v) + lean * H * v * v;
      gPos = vec3(xz.x, gy - 0.07 + y, xz.y) - modelMatrix[3].xyz;
      gNrm = normalize(gNormal(aux) + vec3(fdir.x, 0.0, fdir.y) * 0.2 * v);

      vec3 tip = grassTip(root);
      vec3 c = mix(root * 0.6, tip, smoothstep(0.0, 1.0, v)) * shade;
      c *= 1.0 + 0.28 * uWind * smoothstep(0.5, 0.95, gust) * v;
      c = mix(grassField(root), c, smoothstep(0.0, 0.7, fade));
      vColor = c * (1.0 - 0.1 * uWet);
      vec3 toP = normalize(vec3(xz.x, gy + y, xz.y) - cameraPosition);
      vTrans = uSunCol * tip * pow(max(0.0, dot(toP, uSunDir)), 4.0) * v * 0.45;
    }
  }
}
`;

// Wildflowers: a little clump of stalks with five-petalled heads, in drifts of one
// species, palettes per region (and woodland floor).
const FLOWER_MAIN = /* glsl */`
vec3 gPos = vec3(0.0);
vec3 gNrm = vec3(0.0, 1.0, 0.0);
vColor = vec3(0.0);
vTrans = vec3(0.0);
vShape = vec3(0.0);
{
  vec2 p; float d, fade, level; uint h;
  if (plantAt(p, d, fade, h, level)) {
    vec2 uv = gUV(p);
    vec4 cov = texture(uGV, uv);
    float gy = gHeight(p);
    float drift = smoothstep(0.42, 0.72, vnoise(p * 0.075 + 13.1)) * (0.55 + 0.45 * vnoise(p * 0.6 + 3.7));
    if (gRand(h) < cov.b * uAmount.z * drift * 1.6 && gy > 0.06) {
      vec4 col = texture(uGC, uv);
      vec4 aux = texture(uGA, uv);
      vec3 root = pow(col.rgb, vec3(2.2));
      float region = floor(col.a * 255.0 + 0.5);
      float habitat = floor(aux.a * 255.0 + 0.5);
      int row = region < 5.5 ? int(region) : 0;
      if (row == 0 && (habitat == 3.0 || habitat == 10.0)) row = 6; // woodland floor
      float sp = floor(vnoise(p * 0.05 + 71.3) * 3.999);
      if (gRand(h) < 0.2) sp = floor(gRand(h) * 3.999);
      vec3 petal = pow(PETALS[row * 4 + int(sp)], vec3(2.2));
      float grow = smoothstep(0.0, 1.0, fade);
      float widen = max(1.0, d * 0.07);
      float ph = gRand(h) * 6.2831853;
      float tallBase = (0.18 + 0.42 * cov.g) * (0.75 + 0.5 * gRand(h));

      float part = floor(position.z / 10.0 + 0.01);
      float f = position.z - part * 10.0;
      float fr = fract(sin((f + 1.0) * 12.9898 + ph) * 43758.5453);
      vec2 base = p + (f > 0.5 ? vec2(cos(ph + f * 2.3), sin(ph + f * 2.3)) * (0.1 + 0.08 * fr) : vec2(0.0));
      float Hs = tallBase * (0.8 + 0.4 * fr) * grow;
      float gust = windGust(base);
      vec2 lean = uWindDir * (uWind * (0.15 + 0.6 * gust) + 0.05 * sin(uTime * 2.1 + ph + f)) + vec2(cos(ph * 3.0 + f), sin(ph * 3.0 + f)) * 0.12;
      vec2 top = base + lean * Hs;
      float R = (0.04 + 0.025 * fr) * widen * grow;
      float by = gHeight(base) - 0.05;
      if (part < 0.5) {
        // Stalk: a thin quad from the ground to the head.
        float v = position.y;
        vec2 along = normalize(vec2(-lean.y, lean.x) + vec2(0.001));
        vec2 xz = mix(base, top, v * v) + along * position.x * 0.012 * widen;
        gPos = vec3(xz.x, by + Hs * v, xz.y);
        gNrm = gNormal(aux);
        vColor = mix(root * 0.55, root * vec3(0.8, 1.05, 0.6), v);
      } else {
        // Head: a flat cup of petals facing up, tilted a little with the stalk.
        vec2 q = position.xy;
        vec2 xz = top + q * R;
        float cup = part > 1.5 ? -0.25 : 0.3;
        gPos = vec3(xz.x, by + Hs + R * cup + dot(q, lean) * R * 0.6, xz.y);
        gNrm = normalize(vec3(-lean.x * 0.4, 1.0, -lean.y * 0.4));
        vec3 eye = (row == 6 || sp > 1.5) ? petal * 0.55 : pow(vec3(0.95, 0.72, 0.16), vec3(2.2));
        vColor = part > 1.5 ? eye : petal;
        vShape = vec3(1.0, q);
        vec3 toP = normalize(vec3(xz.x, by + Hs, xz.y) - cameraPosition);
        vTrans = uSunCol * petal * pow(max(0.0, dot(toP, uSunDir)), 3.0) * 0.4;
      }
      gPos -= modelMatrix[3].xyz;
    }
  }
}
`;

// Ferns: a shuttlecock of arching fronds with cut-out leaflets, in clumps on damp,
// shaded ground; bracken-brown in Amberwood and in autumn.
const FERN_MAIN = /* glsl */`
vec3 gPos = vec3(0.0);
vec3 gNrm = vec3(0.0, 1.0, 0.0);
vColor = vec3(0.0);
vTrans = vec3(0.0);
vShape = vec3(0.0);
{
  vec2 p; float d, fade, level; uint h;
  if (plantAt(p, d, fade, h, level)) {
    vec2 uv = gUV(p);
    vec4 cov = texture(uGV, uv);
    float gy = gHeight(p);
    float clump = smoothstep(0.3, 0.62, vnoise(p * 0.12 + 5.3));
    if (gRand(h) < cov.a * uAmount.w * (0.25 + 1.1 * clump) && gy > 0.06) {
      vec4 col = texture(uGC, uv);
      vec4 aux = texture(uGA, uv);
      vec3 root = pow(col.rgb, vec3(2.2));
      float region = floor(col.a * 255.0 + 0.5);
      float grow = smoothstep(0.0, 1.0, fade);
      float R = (0.42 + 0.5 * gRand(h)) * (0.65 + 0.7 * cov.a) * grow;
      float ph = gRand(h) * 6.2831853;
      float fi = position.z;
      float fr = fract(sin((fi + 1.0) * 17.31 + ph) * 43758.5453);
      float ang = ph + fi * 0.8975979 + (fr - 0.5) * 0.5;   // 7 fronds
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 across = vec2(-dir.y, dir.x);
      float v = position.y;
      float len = R * (0.75 + 0.45 * fr);
      float gust = windGust(p);
      float sway = uWind * (0.1 + 0.35 * gust) + 0.03 * sin(uTime * 1.7 + ph + fi);
      float rise = len * (1.45 * v - 1.05 * v * v) * (0.85 + 0.3 * fr);
      float halfW = len * 0.2 * pow(sin(3.1415927 * min(v * 1.08, 1.0)), 0.6) * max(1.0, d * 0.05);
      vec2 xz = p + dir * len * v * 0.95 + across * position.x * 2.0 * halfW + uWindDir * sway * len * v * v;
      gPos = vec3(xz.x, gy - 0.04 + rise - abs(position.x) * halfW * 0.5, xz.y) - modelMatrix[3].xyz;
      gNrm = normalize(gNormal(aux) + vec3(dir.x, 0.0, dir.y) * 0.35 * (v - 0.4));
      vec3 green = mix(pow(vec3(0.27, 0.47, 0.17), vec3(2.2)), root, 0.25);
      vec3 rust = pow(vec3(0.62, 0.36, 0.15), vec3(2.2));
      float brown = max(uGrassTint.a * 0.6 * step(0.5, uGrassTint.r / max(uGrassTint.g, 1e-3)), region == 4.0 ? 0.85 : 0.0);
      vec3 c = mix(green, rust, brown) * (0.86 + 0.28 * fr);
      vColor = mix(c * 0.55, c * 1.15, v);
      vShape = vec3(2.0, position.x, v);
      vec3 toP = normalize(vec3(xz.x, gy + rise, xz.y) - cameraPosition);
      vTrans = uSunCol * c * pow(max(0.0, dot(toP, uSunDir)), 3.0) * 0.4;
    }
  }
}
`;

// Petal colours (sRGB): rows = region (Greenhollow, Marsh, Windpeak, Coast, Amberwood,
// Frostveil) and the woodland floor; four species each.
const PETALS = [
  [0xf4f1e6, 0xf4d13c, 0xe47fae, 0x8e72d8], // meadow: oxeye daisy, buttercup, red campion, knapweed
  [0xf2d23a, 0xe38ab6, 0xf1ead2, 0xb583d8], // marsh: yellow flag, ragged robin, meadowsweet, loosestrife
  [0xb072c8, 0xd68ad0, 0x7e95e6, 0xf0d24a], // highland: heather, bell heather, harebell, tormentil
  [0xf09ac0, 0xf6f3ea, 0xf2c43a, 0x9fb0ea], // coast: thrift, sea campion, bird's-foot trefoil, sea aster
  [0xf2c23a, 0xa27ad8, 0xf3eee2, 0xe8873a], // amberwood: goldenrod, aster, yarrow, hawkweed
  [0xf6f4ee, 0xf2d35a, 0xc09ae0, 0xeef0f6], // frostveil: mountain avens, globeflower, saxifrage
  [0x6c7fe0, 0xf3f1ea, 0xf2e6a0, 0x8a78d8], // woodland: bluebell, wood anemone, primrose, bugle
];
const PETALS_GLSL = `const vec3 PETALS[28] = vec3[28](${PETALS.flat().map((c) =>
  `vec3(${((c >> 16) & 255) / 255}, ${((c >> 8) & 255) / 255}, ${(c & 255) / 255})`).join(', ')});\n`;

const FRAG_HEAD = /* glsl */`
varying vec3 vTrans;
varying vec3 vShape;
`;

// Cut-outs: five-petalled flower heads and fern leaflets.
const FRAG_SHAPE = /* glsl */`
if (vShape.x > 1.5) {
  float notch = 0.5 * (0.5 + 0.5 * abs(sin(vShape.z * 3.1415927 * 11.0)));
  if (abs(vShape.y) > notch && vShape.z > 0.06) discard;
} else if (vShape.x > 0.5) {
  float r = length(vShape.yz);
  float a = atan(vShape.z, vShape.y);
  if (r > 0.42 + 0.58 * pow(abs(cos(a * 2.5)), 0.7)) discard;
}
`;

function patchMaterial(main, extraHead, uniforms, key) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = GRASS_COLOR_GLSL + SCATTER_GLSL + extraHead + shader.vertexShader
      .replace('#include <color_vertex>', main)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = gNrm;')
      .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_SHAPE)
      // Both faces of a blade are lit like the ground it grows from: no normal flip.
      .replace('#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vTrans;');
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// --- the system ----------------------------------------------------------------------------

const LAYERS = [
  // Far rings: fewer segments, more blades per tuft (they stand for a wider patch).
  { name: 'grass', main: GRASS_MAIN, head: '', geometry: (cfg, k) => (k < 2 ? tuftGeometry(cfg.blades, cfg.segs) : tuftGeometry(cfg.blades + 2, 1)) },
  { name: 'flowers', main: FLOWER_MAIN, head: PETALS_GLSL, geometry: () => flowerGeometry() },
  { name: 'ferns', main: FERN_MAIN, head: '', geometry: (cfg, k) => fernGeometry(k === 0 ? 5 : 3) },
];

// Season → [grass density, grass height, flowers, ferns] and the tip tint.
const SEASON_AMOUNT = [
  [0.95, 0.85, 0.85, 0.85],  // spring: fresh, flowers out
  [1.0, 1.0, 1.0, 1.0],      // summer
  [0.95, 0.9, 0.28, 0.95],   // autumn: seed heads, few flowers, bracken turns
  [0.8, 0.62, 0.0, 0.6],     // winter: flattened, no flowers
];
const SEASON_TINT = [
  [0.2, 0.5, 0.05, 0.22],
  [0.2, 0.4, 0.05, 0.0],
  [0.55, 0.38, 0.09, 0.42],
  [0.42, 0.36, 0.22, 0.5],
];

/**
 * @param {THREE.Object3D} parent
 * @param {object} o
 * @param {object} o.store      ChunkStore (chunkAt, sampleHeight, heightAt, version)
 * @param {(x:number, z:number) => number} o.canopyAt
 * @param {string} o.quality    settings.quality
 * @param {object} [o.uniforms] live uniform objects to share with the terrain material
 *        ({uGrassTint, uTime, uWind, uWet, uWindDir}); created here when absent
 */
export function createGroundCover(parent, { store, canopyAt, quality, uniforms = {} }) {
  const root = new THREE.Group();
  root.name = 'ground-cover';
  parent.add(root);

  // Ground window: front textures are what the shaders read; back planes are refilled.
  const front = allocGroundPlanes();
  const back = allocGroundPlanes();
  const texH = new THREE.DataTexture(front.height, GROUND_RES, GROUND_RES, THREE.RedFormat, THREE.FloatType);
  const texC = new THREE.DataTexture(front.color, GROUND_RES, GROUND_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  const texV = new THREE.DataTexture(front.cover, GROUND_RES, GROUND_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  const texA = new THREE.DataTexture(front.aux, GROUND_RES, GROUND_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  for (const t of [texH, texC, texV, texA]) {
    t.magFilter = t.minFilter = t === texH ? THREE.NearestFilter : THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
  }
  const canopy = createCanopyCache(canopyAt);

  const shared = {
    uGH: { value: texH }, uGC: { value: texC }, uGV: { value: texV }, uGA: { value: texA },
    uGOrigin: { value: new THREE.Vector2(-1e9, -1e9) },
    uTime: uniforms.uTime || { value: 0 },
    uWind: uniforms.uWind || { value: 0.3 },
    uWet: uniforms.uWet || { value: 0 },
    uWindDir: uniforms.uWindDir || { value: new THREE.Vector2(0.8, 0.6) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uSunCol: { value: new THREE.Color(1, 0.9, 0.7) },
    uAmount: { value: new THREE.Vector4(1, 1, 1, 1) },
    uGrassTint: uniforms.uGrassTint || { value: new THREE.Vector4(0, 0, 0, 0) },
  };

  /** One built layer: per ring a material and g² patch meshes. */
  let layers = [];
  let shadows = false;

  function build(qualityName) {
    for (const l of layers) {
      for (const r of l.rings) {
        r.material.dispose();
        r.geometry.dispose();
        for (const m of r.meshes) root.remove(m);
      }
    }
    layers = [];
    const gq = groundQualityOf(qualityName);
    for (const spec of LAYERS) {
      const cfg = gq[spec.name];
      if (!cfg) continue;
      const p = cfg.n / cfg.g;
      const cells = new Uint8Array(p * p * 2);
      for (let j = 0, q = 0; j < p; j++) for (let i = 0; i < p; i++, q += 2) { cells[q] = i; cells[q + 1] = j; }
      const cellAttr = new THREE.InstancedBufferAttribute(cells, 2);
      const layer = { spec, cfg, rings: [], layout: [], patches: [], hole: [0, 0, 0, 0] };
      for (let k = 0; k < cfg.rings; k++) {
        const g = spec.geometry(cfg, k);
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
        geometry.setIndex(new THREE.BufferAttribute(g.index, 1));
        geometry.setAttribute('aCell', cellAttr);
        geometry.instanceCount = p * p;
        const size = p * cfg.base * (1 << k);
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(size / 2, 0, size / 2), size * 0.75 + 12);
        const uniforms = {
          ...shared,
          uSpacing: { value: cfg.base * (1 << k) },
          uBase: { value: cfg.base },
          uRing: { value: k },
          uMaxLevel: { value: cfg.rings - 1 },
          uH0: { value: cfg.n / 2 * cfg.base },
          uInner: { value: new THREE.Vector4(0, 0, 0, 0) },
        };
        const material = patchMaterial(spec.main, spec.head, uniforms, 'wc-ground-' + spec.name);
        const meshes = [];
        for (let q = 0; q < cfg.g * cfg.g; q++) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.name = `ground:${spec.name}:${k}`;
          mesh.matrixAutoUpdate = false;
          mesh.receiveShadow = shadows;
          mesh.castShadow = false;
          mesh.visible = false;
          root.add(mesh);
          meshes.push(mesh);
        }
        layer.rings.push({ geometry, material, meshes, uniforms });
      }
      layers.push(layer);
    }
  }
  build(quality);

  // --- window refresh ---------------------------------------------------------------
  let job = null;
  let lastVersion = -1;
  let sinceRefresh = REFRESH_SECONDS;
  let shownX = NaN, shownZ = NaN;

  function refresh(dt, px, pz) {
    sinceRefresh += dt;
    if (!job) {
      const [ox, oz] = groundOrigin(px, pz);
      const moved = ox !== shownX || oz !== shownZ;
      if (moved || (store.version !== lastVersion && sinceRefresh >= REFRESH_SECONDS)) {
        job = { ox, oz, row: 0, version: store.version };
      }
    }
    if (!job) return;
    const end = Math.min(GROUND_RES, job.row + ROWS_PER_FRAME);
    fillGroundRows(store, canopy, job.ox, job.oz, back, job.row, end);
    job.row = end;
    if (end < GROUND_RES) return;
    front.height.set(back.height);
    front.color.set(back.color);
    front.cover.set(back.cover);
    front.aux.set(back.aux);
    texH.needsUpdate = texC.needsUpdate = texV.needsUpdate = texA.needsUpdate = true;
    shared.uGOrigin.value.set(job.ox, job.oz);
    shownX = job.ox; shownZ = job.oz;
    lastVersion = job.version;
    sinceRefresh = 0;
    job = null;
  }

  // --- per-frame placement ----------------------------------------------------------------
  const winHalf = GROUND_RES * GROUND_TEXEL / 2;
  function place(cx, cz) {
    const ready = shownX === shownX;
    const wcx = shownX + winHalf, wcz = shownZ + winHalf;
    for (const l of layers) {
      const { cfg } = l;
      const p = cfg.n / cfg.g;
      ringLayout(cfg, cx, cz, l.layout);
      for (let k = 0; k < cfg.rings; k++) {
        const ring = l.rings[k];
        const s = cfg.base * (1 << k);
        const hole = ringHole(l.layout, k, l.hole);
        if (hole) ring.uniforms.uInner.value.set(hole[0], hole[1], hole[2], hole[3]);
        ringPatches(cfg, l.layout, k, l.patches);
        for (let q = 0; q < l.patches.length; q++) {
          const pa = l.patches[q];
          const mesh = ring.meshes[q];
          const x = pa.i * s, z = pa.j * s, size = p * s;
          // Skip patches inside the finer ring and patches wholly outside the window.
          const out = Math.abs(x + size / 2 - wcx) > winHalf + size / 2 || Math.abs(z + size / 2 - wcz) > winHalf + size / 2;
          mesh.visible = ready && !pa.inside && !out;
          if (!mesh.visible) continue;
          const y = store.heightAt(x + size / 2, z + size / 2);
          const m = mesh.matrix.elements;
          if (m[12] !== x || m[13] !== y || m[14] !== z) {
            m[12] = x; m[13] = y; m[14] = z;
            mesh.matrixWorldNeedsUpdate = true;
          }
        }
      }
    }
  }

  const amount = [1, 1, 1, 1], tint = [0, 0, 0, 0];
  let seasonSnapped = false;

  return {
    root,
    /** Rebuilds the layers for another quality preset. */
    setQuality(name) { build(name); },
    /** Whether ground cover receives the sun's shadow map. */
    setShadows(on) {
      shadows = !!on;
      for (const l of layers) for (const r of l.rings) for (const m of r.meshes) m.receiveShadow = shadows;
    },
    /** Drops the window (a new world). */
    reset() {
      job = null; lastVersion = -1; shownX = shownZ = NaN;
      for (const l of layers) for (const r of l.rings) for (const m of r.meshes) m.visible = false;
    },
    /**
     * @param {number} dt @param {number} time
     * @param {THREE.Vector3} cam  camera position
     * @param {{wind:number, rain:number, season:number, sunDir?:THREE.Vector3, light:number}} env
     */
    update(dt, time, cam, env) {
      shared.uTime.value = time;
      // Ground wets quickly in rain and dries slowly after it.
      const rain = clamp01(env.rain);
      shared.uWet.value += (rain - shared.uWet.value) * (1 - Math.exp(-dt * (rain > shared.uWet.value ? 0.5 : 0.05)));
      const k = 1 - Math.exp(-dt * 0.6);
      shared.uWind.value += ((0.12 + 0.88 * clamp01(env.wind)) - shared.uWind.value) * k;
      // The same slowly wandering south-westerly as the trees.
      const a = 0.9 + Math.sin(time * 0.011) * 0.5;
      shared.uWindDir.value.set(Math.cos(a), Math.sin(a));
      if (env.sunDir) shared.uSunDir.value.copy(env.sunDir);
      const sunUp = clamp01((env.sunDir ? env.sunDir.y : 0.5) * 4 + 0.15);
      const light = clamp01(env.light);
      shared.uSunCol.value.setRGB(1.0 * light * sunUp, 0.86 * light * sunUp, 0.62 * light * sunUp);

      const season = ((env.season | 0) % 4 + 4) % 4;
      const sk = seasonSnapped ? 1 - Math.exp(-dt * 0.3) : 1;
      seasonSnapped = true;
      for (let i = 0; i < 4; i++) {
        amount[i] += (SEASON_AMOUNT[season][i] - amount[i]) * sk;
        tint[i] += (SEASON_TINT[season][i] - tint[i]) * sk;
      }
      shared.uAmount.value.set(amount[0], amount[1], amount[2], amount[3]);
      shared.uGrassTint.value.set(tint[0], tint[1], tint[2], tint[3]);

      refresh(dt, cam.x, cam.z);
      place(cam.x, cam.z);
    },
    /** Uniforms the terrain shader shares (the seasonal grass tint). */
    sharedUniforms: { uGrassTint: shared.uGrassTint, uTime: shared.uTime, uWind: shared.uWind, uWet: shared.uWet, uWindDir: shared.uWindDir },
    /** Draw calls the ground cover can issue this frame (before frustum culling). */
    visibleCount() {
      let n = 0;
      for (const l of layers) for (const r of l.rings) for (const m of r.meshes) if (m.visible) n++;
      return n;
    },
    dispose() {
      for (const l of layers) for (const r of l.rings) { r.material.dispose(); r.geometry.dispose(); }
      for (const t of [texH, texC, texV, texA]) t.dispose();
      parent.remove(root);
    },
  };
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v || 0; }

