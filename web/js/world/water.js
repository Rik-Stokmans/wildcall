// The one water surface at y = 0 (contract §2: sea, lakes, rivers, marsh pools and
// ponds are all this plane, showing wherever terrain dips below it). It follows the
// player, so its size never depends on the world's.
//
// Look (contract §10): clear near the bank with the bed showing through, deepening to a
// rich teal; gentle moving ripples with sun glints; the sky reflected at grazing angles
// (Fresnel), coloured by the time of day; a soft, broken foam line along the shore and
// around rocks and logs in the water; a slow drift along narrow channels.
//
// The surface itself stays flat (shorelines never shimmer); all motion is in the
// normals. Depth comes from a ground-height texture around the player (shore.js),
// refreshed a few rows per frame; foam rings from the nearest rocks in water.
import * as THREE from 'three';
import { CHUNK_SIZE } from './constants.js';
import { SHORE_RES, SHORE_TEXEL, SHORE_RANGE, shoreOrigin, fillShoreRows, collectWaterRocks } from './shore.js';

const ROWS_PER_FRAME = 16;
const REFRESH_SECONDS = 0.6;
const ROCKS = 24;
const ROCK_SECONDS = 0.5;

const VERT = /* glsl */`
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */`
uniform sampler2D uShore;
uniform vec2 uShoreOrigin;
uniform float uTime;
uniform float uLight;
uniform float uWind;
uniform vec2 uWindDir;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uSkyHigh;
uniform vec4 uRocks[${ROCKS}];
varying vec3 vWorld;
#include <fog_pars_fragment>

const float RES = ${SHORE_RES.toFixed(1)};
const float TEXEL = ${SHORE_TEXEL.toFixed(1)};
const float RANGE = ${SHORE_RANGE.toFixed(1)};

float groundHeight(vec2 p) {
  vec2 uv = (p - uShoreOrigin) / (RES * TEXEL) + 0.5 / RES;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -RANGE;
  return texture2D(uShore, uv).r * 2.0 * RANGE - RANGE;
}

float wHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Gradient of value noise (analytic).
vec2 wGrad(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = wHash(i), b = wHash(i + vec2(1.0, 0.0)), c = wHash(i + vec2(0.0, 1.0)), d = wHash(i + vec2(1.0, 1.0));
  return du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx);
}
// Slope of the ripple field at p (several drifting octaves; fine ones fade with distance).
vec2 ripples(vec2 p, float t, float fine) {
  vec2 g = wGrad(p * 0.31 + uWindDir * t * 0.22) * 0.5;
  g += wGrad(p * 0.83 - vec2(t * 0.19, t * 0.11)) * 0.3;
  g += wGrad(p * 2.1 + vec2(-t * 0.33, t * 0.27)) * 0.17 * fine;
  g += wGrad(p * 4.7 + vec2(t * 0.55, -t * 0.43)) * 0.09 * fine;
  return g;
}

void main() {
  vec2 p = vWorld.xz;
  float h = groundHeight(p);
  float depth = max(0.0, -h);
  vec3 toEye = cameraPosition - vWorld;
  float dist = length(toEye);
  vec3 V = toEye / dist;
  float fine = 1.0 - smoothstep(30.0, 140.0, dist);

  // Drift along narrow channels: across the depth gradient, in a consistent sense.
  vec2 gr = vec2(groundHeight(p + vec2(1.5, 0.0)) - groundHeight(p - vec2(1.5, 0.0)),
                 groundHeight(p + vec2(0.0, 1.5)) - groundHeight(p - vec2(0.0, 1.5)));
  vec2 along = vec2(-gr.y, gr.x);
  float al = length(along);
  along = al > 1e-4 ? along / al : vec2(0.0);
  along *= dot(along, vec2(0.6, 0.8)) < 0.0 ? -1.0 : 1.0;
  float channel = smoothstep(0.08, 0.5, al) * (1.0 - smoothstep(1.2, 3.5, depth));
  float t = uTime;
  float ph0 = fract(t * 0.12), ph1 = fract(t * 0.12 + 0.5);
  float w0 = 1.0 - abs(2.0 * ph0 - 1.0);
  vec2 flowOff = along * channel * 2.2;
  vec2 g = ripples(p - flowOff * ph0, t, fine) * w0 + ripples(p - flowOff * ph1 + 7.3, t, fine) * (1.0 - w0);
  float amp = (0.09 + 0.36 * uWind) * (0.55 + 0.45 * smoothstep(0.0, 0.6, depth));
  vec3 n = normalize(vec3(-g.x * amp, 1.0, -g.y * amp));

  float lit = 0.18 + 0.82 * uLight;
  // Body colour: clear and slightly green-blue in the shallows, rich teal when deep.
  float path = depth / max(V.y, 0.07);
  float murk = 1.0 - exp(-path * 0.26);
  vec3 body = mix(uShallow, uDeep, smoothstep(0.15, 2.4, depth)) * lit;
  float alpha = mix(0.04, 0.93, murk);

  // Reflection: the far bank (dark, green-blue) just above the horizon, then the sky.
  float ndv = clamp(dot(n, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  fres = min(fres, 0.6) * (0.45 + 0.55 * smoothstep(0.0, 0.45, depth));
  vec3 R = reflect(-V, n);
  // (Most water is seen from a bank, framed by trees and hills: the low reflection is
  // their dark, cool green rather than the pale horizon haze.)
  vec3 bank = mix(uSky, vec3(0.035, 0.09, 0.065), 0.72);
  vec3 sky = mix(bank, mix(uSky, uSkyHigh, smoothstep(0.2, 0.6, R.y)), smoothstep(0.06, 0.34, R.y));
  sky *= 0.25 + 0.75 * uLight;
  vec3 col = mix(body, sky, fres);
  alpha = mix(alpha, 1.0, fres);

  // Sun glints: a broad sheen and sharp sparkles.
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float nh = max(dot(n, H), 0.0);
  float sun = smoothstep(-0.02, 0.12, L.y);
  float spec = (pow(nh, 90.0) * 0.3 + pow(nh, 900.0) * 5.0) * sun;
  col += uSunCol * spec;
  alpha = min(1.0, alpha + spec * 0.5);

  // Foam: a soft, broken line along the water's edge, and rings around rocks.
  float slope = max(al / 3.0, 0.04);
  float edge = depth / slope;                         // metres to the shore
  float breakup = wNoise(p * 1.6 + vec2(t * 0.21, -t * 0.17)) * 0.6 + wNoise(p * 4.3 - vec2(t * 0.3, t * 0.12)) * 0.4;
  float lap = 0.5 + 0.5 * sin(t * 0.9 + wNoise(p * 0.35) * 6.2831853);
  float shore = (1.0 - smoothstep(0.05, 0.3 + 0.35 * lap, edge)) * (1.0 - smoothstep(0.25, 0.5, depth));
  float ring = 0.0;
  for (int i = 0; i < ${ROCKS}; i++) {
    vec4 r = uRocks[i];
    if (r.w <= 0.0) continue;
    float d = distance(p, r.xy) - r.z;
    ring = max(ring, r.w * (1.0 - smoothstep(0.0, 0.2 + 0.35 * breakup, d)));
  }
  float froth = max(shore, ring);
  float foam = froth * smoothstep(0.52, 0.85, breakup) * (0.55 + 0.45 * uWind);
  foam *= 1.0 - smoothstep(50.0, 140.0, dist) * 0.7;
  col = mix(col, uFoam * lit, foam * 0.55);
  alpha = max(alpha, foam * 0.55);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * @param {THREE.Scene} scene
 * @returns {{mesh:THREE.Mesh, setRadius(chunks:number):void,
 *   update(dt:number, time:number, px:number, pz:number, store:object,
 *          look:{sunDir?:THREE.Vector3, light:number, sky?:THREE.Color, skyHigh?:THREE.Color, wind?:number}):void,
 *   dispose():void}}
 */
export function createWater(scene) {
  const front = new Uint8Array(SHORE_RES * SHORE_RES); // everything starts "deep"
  const back = new Uint8Array(SHORE_RES * SHORE_RES);
  const tex = new THREE.DataTexture(front, SHORE_RES, SHORE_RES, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const rocks = new Float32Array(ROCKS * 4);
  const rockVecs = Array.from({ length: ROCKS }, () => new THREE.Vector4());
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uShore: { value: null },
    uShoreOrigin: { value: new THREE.Vector2(-1e9, -1e9) },
    uTime: { value: 0 },
    uLight: { value: 1 },
    uWind: { value: 0.3 },
    uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
    uDeep: { value: new THREE.Color(0x123f4c) },
    uShallow: { value: new THREE.Color(0x3a7f6c) },
    uFoam: { value: new THREE.Color(0xf2f6ee) },
    uSky: { value: new THREE.Color(0xb9d3dc) },
    uSkyHigh: { value: new THREE.Color(0x6f9fc8) },
    uRocks: { value: null },
  }]);
  // merge() clones values; these must be the live objects.
  uniforms.uShore.value = tex;
  uniforms.uRocks.value = rockVecs;

  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, fog: true,
  });
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water';
  mesh.renderOrder = 2; // after the opaque world, before UI-ish overlays
  mesh.frustumCulled = false;
  scene.add(mesh);

  // Shore refresh state: building `back` for origin (bx, bz), `row` rows done.
  let job = null;
  let lastVersion = -1;
  let sinceRefresh = REFRESH_SECONDS;
  let shownOrigin = [NaN, NaN];
  let sinceRocks = ROCK_SECONDS;
  let wind = 0.3;

  return {
    mesh,
    setRadius(chunks) {
      const size = (chunks + 2.5) * CHUNK_SIZE * 2;
      mesh.scale.set(size, 1, size);
    },
    update(dt, time, px, pz, store, look) {
      uniforms.uTime.value = time;
      uniforms.uLight.value = look.light;
      wind += ((look.wind ?? 0.3) - wind) * (1 - Math.exp(-dt * 0.6));
      uniforms.uWind.value = wind;
      const a = 0.9 + Math.sin(time * 0.011) * 0.5;
      uniforms.uWindDir.value.set(Math.cos(a), Math.sin(a));
      if (look.sunDir) {
        uniforms.uSunDir.value.copy(look.sunDir);
        // Warm and soft near the horizon, white-gold at noon.
        const up = Math.max(0, look.sunDir.y);
        const k = Math.min(1, up * 3);
        uniforms.uSunCol.value.setRGB(1.0, 0.72 + 0.24 * k, 0.48 + 0.4 * k).multiplyScalar(look.light);
      }
      if (look.sky) uniforms.uSky.value.copy(look.sky);
      if (look.skyHigh) uniforms.uSkyHigh.value.copy(look.skyHigh);
      else if (look.sky) uniforms.uSkyHigh.value.copy(look.sky).lerp(SKY_HIGH, 0.6).multiplyScalar(0.4 + 0.6 * look.light);
      // Snap to whole chunks so the plane's edge never creeps with the player.
      mesh.position.set(Math.round(px / CHUNK_SIZE) * CHUNK_SIZE, 0, Math.round(pz / CHUNK_SIZE) * CHUNK_SIZE);

      sinceRocks += dt;
      if (sinceRocks >= ROCK_SECONDS) {
        sinceRocks = 0;
        collectWaterRocks(store, px, pz, 90, rocks);
        for (let i = 0; i < ROCKS; i++) rockVecs[i].set(rocks[i * 4], rocks[i * 4 + 1], rocks[i * 4 + 2], rocks[i * 4 + 3]);
      }

      sinceRefresh += dt;
      if (!job) {
        const [ox, oz] = shoreOrigin(px, pz);
        const moved = ox !== shownOrigin[0] || oz !== shownOrigin[1];
        if (moved || (store.version !== lastVersion && sinceRefresh >= REFRESH_SECONDS)) {
          job = { ox, oz, row: 0, version: store.version };
        }
      }
      if (job) {
        const end = Math.min(SHORE_RES, job.row + ROWS_PER_FRAME);
        fillShoreRows(store, job.ox, job.oz, back, job.row, end);
        job.row = end;
        if (end === SHORE_RES) {
          front.set(back);
          tex.needsUpdate = true;
          uniforms.uShoreOrigin.value.set(job.ox, job.oz);
          shownOrigin = [job.ox, job.oz];
          lastVersion = job.version;
          sinceRefresh = 0;
          job = null;
        }
      }
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      tex.dispose();
    },
  };
}

/** A clear zenith blue (linear), mixed into the horizon colour when the sky does not say. */
const SKY_HIGH = new THREE.Color(0.16, 0.33, 0.6);
