// The terrain material: the server's vertex colours stay the base (region, habitat,
// trails and shoreline are blended in there); this shader paints over them the things
// a 2 m vertex grid cannot carry, all in world space so chunk borders and LOD rings
// never show a seam:
//   * a low-contrast painterly wash (broad brightness, warm/cool shift),
//   * grassy ground lifted towards the colour of the grass on it, so the grass field
//     melts into the terrain at its far edge,
//   * clover patches in the open, leaf litter under trees, pebbles on bare earth,
//   * broken, soft edges where trails meet grass,
//   * banded rock and earth on steep slopes,
//   * shade under the canopy with a slowly drifting dapple of light.
// Fine detail fades with distance so nothing shimmers. A patched MeshLambertMaterial:
// lights, fog and shadow receiving work as everywhere else.
import * as THREE from 'three';
import { GRASS_COLOR_GLSL } from './groundCover.js';

const VERT_HEAD = /* glsl */`
attribute float aCanopy;
varying float vCanopy;
varying vec3 vWPos;
varying vec3 vWNrm;
`;

const VERT_TAIL = /* glsl */`
vCanopy = aCanopy;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_HEAD = /* glsl */`
uniform float uTime;
uniform float uWind;
uniform float uWet;
uniform vec2 uWindDir;
varying float vCanopy;
varying vec3 vWPos;
varying vec3 vWNrm;
${GRASS_COLOR_GLSL}
float tHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Round speckles on a jittered grid: x = coverage (0..1), y = a random per speckle.
vec2 speckle(vec2 p, float size) {
  vec2 c = floor(p);
  vec2 o = vec2(tHash(c), tHash(c + 17.3));
  float r = length(fract(p) - (0.25 + 0.5 * o));
  return vec2(1.0 - smoothstep(size * 0.7, size, r), tHash(c + 41.7));
}
`;

const FRAG_DETAIL = /* glsl */`
{
  vec3 base = diffuseColor.rgb;
  vec3 s = pow(max(base, vec3(0.0)), vec3(1.0 / 2.2)) * 255.0;
  float grass = smoothstep(10.0, 28.0, s.g - (s.r + s.b) * 0.5) * (1.0 - smoothstep(500.0, 580.0, s.r + s.g + s.b));
  float bright = s.r + s.g + s.b;
  vec2 p = vWPos.xz;
  float dist = length(vWPos - cameraPosition);
  float near = 1.0 - smoothstep(18.0, 60.0, dist);
  float mid = 1.0 - smoothstep(60.0, 220.0, dist);
  float canopy = clamp(vCanopy, 0.0, 1.0);

  float n1 = tNoise(p / 29.0);
  float n2 = tNoise(p / 7.3 + 3.1);
  float n3 = tNoise(p * 0.55 + 9.7);
  vec3 col = base * (0.93 + 0.14 * n1);
  col *= mix(vec3(1.0), vec3(1.05, 1.02, 0.9), (n2 - 0.5) * 0.7 * mid + 0.15);

  // Grass: the field colour, mottled like clumps of grass seen from afar, with the
  // wind's gusts running across it as lighter waves, and darker clover drifts.
  col = mix(col, grassField(col), grass * 0.8);
  float far = smoothstep(6.0, 22.0, dist) * mid;
  float clumps = tNoise(p * 0.9 + 4.1) * 0.6 + tNoise(p * 2.3 - 1.7) * 0.4;
  col *= 1.0 + grass * far * (clumps - 0.5) * 0.22;
  float gust = tNoise(p * 0.045 - uWindDir * uTime * 1.15) * 0.65 + tNoise(p * 0.16 - uWindDir * uTime * 2.2) * 0.35;
  col *= 1.0 + grass * (1.0 - canopy) * uWind * smoothstep(0.5, 0.95, gust) * 0.16;
  float clover = grass * (1.0 - canopy) * smoothstep(0.6, 0.74, tNoise(p * 0.17 + 7.0));
  col = mix(col, col * vec3(0.8, 0.92, 0.84), clover * 0.55 * mid);
  vec2 dot1 = speckle(p * 5.0, 0.18);
  col = mix(col, vec3(0.86, 0.86, 0.8), clover * dot1.x * step(0.55, dot1.y) * near * 0.85);

  // Leaf litter under trees: warm leaves scattered over the floor.
  // (Leaves are small rotated ellipses, so the floor reads as litter, not dots.)
  float la = tHash(floor(p * 6.0)) * 6.2831853;
  mat2 lr = mat2(cos(la), sin(la), -sin(la), cos(la));
  vec2 leaf = speckle(lr * (p * vec2(6.0, 6.0)) * vec2(1.0, 1.9) + vec2(n3 * 1.3, n2), 0.3);
  vec3 leafCol = mix(vec3(0.3, 0.19, 0.08), vec3(0.42, 0.33, 0.12), leaf.y) * (0.85 + 0.3 * n3);
  float litter = smoothstep(0.25, 0.7, canopy) * (0.4 + 0.6 * grass) * smoothstep(0.35, 0.6, n2 + 0.2 * canopy);
  col = mix(col, mix(col, leafCol, 0.28), litter * leaf.x * near);
  col = mix(col, col * vec3(1.03, 0.96, 0.86), litter * 0.4 * mid);

  // Bare earth and trails: pebbles and ruts, and a broken, grassy edge.
  float bare = (1.0 - grass) * (1.0 - smoothstep(560.0, 640.0, bright));
  vec2 peb = speckle(p * 3.4, 0.22);
  col = mix(col, col * (0.72 + 0.55 * peb.y), bare * peb.x * near * 0.6);
  col *= 1.0 - bare * 0.08 * (tNoise(p * 1.7) - 0.5) * near;
  float edge = grass * (1.0 - grass) * 4.0;
  col = mix(col, grassField(col * vec3(0.85, 1.12, 0.8)), edge * smoothstep(0.45, 0.75, tNoise(p * 0.9 + 2.0)) * 0.5);

  // Steep ground: bands of rock and earth.
  float steep = 1.0 - smoothstep(0.55, 0.82, vWNrm.y);
  float band = tNoise(vec2(p.x * 0.11 + p.y * 0.07, vWPos.y * 1.3));
  col = mix(col, col * (0.78 + 0.32 * band) * vec3(1.02, 0.98, 0.95), steep * 0.7);

  // Shade under the canopy, with a gently drifting dapple of light.
  float dap = tNoise(p * 0.42 + uWindDir * uTime * 0.12) * 0.6 + tNoise(p * 1.1 - uWindDir * uTime * 0.2) * 0.4;
  col *= 1.0 - canopy * (0.2 + 0.2 * smoothstep(0.38, 0.62, dap));

  // Rain darkens the ground (soil more than grass; less under the trees).
  col *= 1.0 - uWet * (0.1 + 0.16 * (1.0 - grass)) * (1.0 - 0.5 * canopy);

  diffuseColor.rgb = col;
}
`;

/**
 * @param {{uGrassTint:{value:THREE.Vector4}, uTime:{value:number}, uWind:{value:number}, uWet:{value:number}, uWindDir:{value:THREE.Vector2}}} shared
 *        live uniforms from the ground cover (seasonal grass tint, time, wind)
 */
export function createTerrainMaterial(shared) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uniforms = shared || {
    uGrassTint: { value: new THREE.Vector4() },
    uTime: { value: 0 },
    uWind: { value: 0.3 },
    uWet: { value: 0 },
    uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + VERT_TAIL);
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_DETAIL);
  };
  mat.customProgramCacheKey = () => 'wc-terrain';
  return mat;
}
