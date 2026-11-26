// Sky dome: gradient sky, sun disc + halo, moon with phase, procedural stars.
// One inverted sphere that follows the camera; drawn first, never fogged.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // sit on the far plane
}`;

const FRAG = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uGlow;
uniform float uSunVis;
uniform vec3 uMoonDir;
uniform float uMoonVis;
uniform float uMoonPhase;
uniform float uStars;
uniform float uTime;
uniform float uHaze;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  // Gradient: a wide soft horizon band that fades into the zenith colour.
  float up = smoothstep(-0.02, 0.55, y);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.75));
  // Below and just above the horizon the sky becomes the fog colour, so distant
  // terrain fading into fog meets the sky seamlessly.
  float haze = 1.0 - smoothstep(-0.06, 0.12 + 0.2 * uHaze, y);
  col = mix(col, uFog, haze);
  col = mix(col, mix(uFog, uGround, 0.35), smoothstep(0.0, -0.35, y));

  // Sun: broad warm halo + soft disc.
  float sd = max(dot(d, uSunDir), 0.0);
  col += uGlow * (pow(sd, 6.0) * 0.32 + pow(sd, 48.0) * 0.4) * uSunVis;
  float disc = smoothstep(0.99935, 0.99975, sd);
  col = mix(col, uSunColor * 1.6 + 0.2, disc * uSunVis * step(-0.02, y));

  // Stars: sparse twinkling points on a direction lattice.
  if (uStars > 0.001 && y > -0.05) {
    vec3 p = d * 220.0;
    vec3 c = floor(p);
    float h = hash13(c);
    if (h > 0.9965) {
      vec3 f = fract(p) - 0.5;
      float r = length(f);
      float tw = 0.75 + 0.25 * sin(uTime * (1.5 + h * 30.0) + h * 80.0);
      float s = smoothstep(0.22, 0.0, r) * tw * smoothstep(-0.05, 0.25, y);
      col += vec3(0.85, 0.9, 1.0) * s * uStars * (0.5 + 0.5 * fract(h * 1000.0));
    }
  }

  // Moon: pale disc with a soft halo; the phase is a shifted-circle shadow.
  float md = dot(d, uMoonDir);
  if (uMoonVis > 0.001) {
    col += vec3(0.55, 0.62, 0.8) * pow(max(md, 0.0), 90.0) * 0.25 * uMoonVis;
    float mdisc = smoothstep(0.99955, 0.99975, md);
    if (mdisc > 0.0) {
      vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + 1e-4);
      vec3 upv = cross(right, uMoonDir);
      vec2 uv = vec2(dot(d - uMoonDir, right), dot(d - uMoonDir, upv)) / 0.0225;
      float off = (uMoonPhase - 0.5) * 4.0; // -2 new … 0 full … 2 new
      float lit = smoothstep(0.85, 1.15, length(uv - vec2(off, 0.0)));
      lit = max(lit, 0.08);
      col = mix(col, vec3(0.93, 0.94, 0.88) * lit + col * (1.0 - lit) * 0.6, mdisc * uMoonVis);
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Builds the dome. Colours are set each frame by the sky module via setColors(). */
export function createDome(radius) {
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uFog: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uSunVis: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonVis: { value: 0 },
    uMoonPhase: { value: 0.5 },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uHaze: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.matrixAutoUpdate = true;
  return { mesh, uniforms };
}
