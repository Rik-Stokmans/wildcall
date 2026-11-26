// The one water surface at y = 0 (contract §2: sea, lakes, rivers, marsh pools and
// ponds are all this plane, showing wherever terrain dips below it). It follows the
// player, so its size never depends on the world's. Stylised: a soft teal that lightens
// over the shallows, gentle animated ripples in the normals (the surface itself stays
// flat so shorelines never shimmer), a sky reflection by Fresnel, a sun glint, a foam
// band where the bed rises to the surface, and transparency near shore so the bed
// shows through. Depth comes from a small ground-height texture around the player
// (shore.js), refreshed a few rows per frame.
import * as THREE from 'three';
import { CHUNK_SIZE } from './constants.js';
import { SHORE_RES, SHORE_TEXEL, SHORE_RANGE, shoreOrigin, fillShoreRows } from './shore.js';

const ROWS_PER_FRAME = 16;
const REFRESH_SECONDS = 0.6;

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
uniform vec3 uSunDir;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
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

vec2 wave(vec2 p, vec2 dir, float k, float speed, float amp) {
  return dir * (cos(dot(p, dir) * k + uTime * speed) * amp * k);
}

void main() {
  vec2 p = vWorld.xz;
  float depth = max(0.0, -groundHeight(p));

  vec2 g = wave(p, vec2(0.8, 0.6), 0.35, 0.9, 0.06)
         + wave(p, vec2(-0.45, 0.89), 0.8, 1.4, 0.025)
         + wave(p, vec2(0.96, -0.28), 1.9, 2.1, 0.008)
         + wave(p, vec2(-0.7, -0.71), 3.7, 2.9, 0.004);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float fresnel = 0.04 + 0.6 * pow(1.0 - max(dot(n, V), 0.0), 4.0);

  float lit = 0.22 + 0.78 * uLight;
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 3.0, depth)) * lit;
  col = mix(col, uSky * (0.35 + 0.65 * uLight), fresnel);
  vec3 H = normalize(normalize(uSunDir) + V);
  col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, H), 0.0), 140.0) * 0.7 * uLight;

  // Foam: a soft, slowly breathing band where the bed meets the surface.
  float band = 1.0 - smoothstep(0.0, 0.4, depth);
  float wob = 0.5 + 0.5 * sin(dot(p, vec2(1.7, 1.3)) + uTime * 1.3) * sin(p.x * 0.9 - uTime * 0.6 + p.y * 0.4);
  float foam = band * smoothstep(0.35, 0.8, band * 0.7 + wob * 0.45);
  col = mix(col, uFoam * lit, foam * 0.75);

  float alpha = mix(0.32, 0.9, smoothstep(0.0, 2.4, depth));
  alpha = max(alpha, max(foam * 0.85, fresnel));
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/**
 * @param {THREE.Scene} scene
 * @returns {{mesh:THREE.Mesh, setRadius(chunks:number):void,
 *   update(dt:number, time:number, px:number, pz:number, store:object, look:{sunDir?:THREE.Vector3, light:number, sky?:THREE.Color}):void,
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

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uShore: { value: null },
    uShoreOrigin: { value: new THREE.Vector2(-1e9, -1e9) },
    uTime: { value: 0 },
    uLight: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uDeep: { value: new THREE.Color(0x2c6670) },
    uShallow: { value: new THREE.Color(0x76b9ac) },
    uFoam: { value: new THREE.Color(0xeef5ee) },
    uSky: { value: new THREE.Color(0xb9d3dc) },
  }]);
  uniforms.uShore.value = tex; // merge() clones values; the texture must be the live one

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

  return {
    mesh,
    setRadius(chunks) {
      const size = (chunks + 2.5) * CHUNK_SIZE * 2;
      mesh.scale.set(size, 1, size);
    },
    update(dt, time, px, pz, store, look) {
      uniforms.uTime.value = time;
      uniforms.uLight.value = look.light;
      if (look.sunDir) uniforms.uSunDir.value.copy(look.sunDir);
      if (look.sky) uniforms.uSky.value.copy(look.sky);
      // Snap to whole chunks so the plane's edge never creeps with the player.
      mesh.position.set(Math.round(px / CHUNK_SIZE) * CHUNK_SIZE, 0, Math.round(pz / CHUNK_SIZE) * CHUNK_SIZE);

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
