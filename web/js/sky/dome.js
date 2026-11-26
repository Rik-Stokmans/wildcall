// Sky dome: a deep zenith fading to a pale warm horizon, sunrise/sunset colour bands
// and the twilight "belt" opposite the sun, a sun disc with limb darkening and a soft
// halo, a moon with phase, glow and faint maria, twinkling stars of varied colour and
// a faint milky band. One inverted sphere that follows the camera; drawn first, never
// fogged. The colours are set each frame by the sky module.
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
uniform float uGolden;
uniform float uTwilight;
uniform vec3 uBelt;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

// One lattice layer of stars: returns brightness, writes a colour temperature.
float starLayer(vec3 d, float scale, float density, out float temp) {
  vec3 p = d * scale;
  vec3 c = floor(p);
  float h = hash13(c);
  temp = fract(h * 517.3);
  if (h < 1.0 - density) return 0.0;
  // Jitter the star inside its cell so the lattice never shows.
  vec3 o = vec3(hash13(c + 7.1), hash13(c + 13.7), hash13(c + 29.3)) * 0.6 + 0.2;
  float r = length(fract(p) - o);
  float tw = 0.65 + 0.35 * sin(uTime * (1.3 + h * 23.0) + h * 91.0);
  return smoothstep(0.2, 0.0, r) * tw * (0.45 + 0.75 * fract(h * 1013.0));
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec2 sunXZ = normalize(uSunDir.xz + 1e-5);
  float toward = dot(normalize(d.xz + 1e-5), sunXZ) * 0.5 + 0.5; // 1 towards the sun's azimuth

  // Gradient: a wide soft horizon band that deepens into the zenith colour.
  float up = smoothstep(-0.02, 0.62, y);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.62));
  // Deepen the very top a touch for a richer dome.
  col = mix(col, uZenith * 0.82, smoothstep(0.55, 1.0, y) * 0.5);

  // Sunrise / sunset: a warm band hugging the horizon, broadest under the sun, and a
  // rosy belt with a darker blue band below it on the opposite side at twilight.
  float band = exp(-max(y, 0.0) / (0.06 + 0.1 * toward)) * (0.25 + 0.75 * pow(toward, 2.5));
  col = mix(col, uGlow, clamp(band * uGolden * 0.85, 0.0, 1.0));
  float anti = 1.0 - toward;
  float belt = smoothstep(0.02, 0.1, y) * (1.0 - smoothstep(0.12, 0.3, y)) * anti * anti;
  col = mix(col, uBelt, belt * uTwilight * 0.55);

  // Below and just above the horizon the sky becomes the fog colour, so distant
  // terrain fading into fog meets the sky seamlessly.
  float haze = 1.0 - smoothstep(-0.06, 0.1 + 0.2 * uHaze, y);
  col = mix(col, uFog, haze);
  col = mix(col, mix(uFog, uGround, 0.35), smoothstep(0.0, -0.35, y));

  // Sun: wide warm halo + tight bright aureole + a limb-darkened disc (HDR, so the
  // bloom catches it).
  float sd = max(dot(d, uSunDir), 0.0);
  float halo = pow(sd, 5.0) * 0.18 + pow(sd, 32.0) * 0.32 + pow(sd, 400.0) * 0.9;
  col += uGlow * halo * uSunVis * (0.7 + 0.6 * uGolden);
  float discR = 1.0 - sd; // ~ angle^2 / 2
  float disc = 1.0 - smoothstep(0.00003, 0.000055, discR);
  if (disc > 0.0) {
    float limb = 1.0 - 0.35 * clamp(discR / 0.000055, 0.0, 1.0);
    vec3 dcol = mix(vec3(1.0, 0.98, 0.92), uSunColor, 0.55) * (6.0 * limb);
    col = mix(col, dcol, disc * uSunVis * smoothstep(-0.03, 0.0, y));
  }

  // Stars: two lattice layers (fine and sparse-bright), varied colour, a denser,
  // glowing milky band along a tilted great circle.
  if (uStars > 0.001 && y > -0.05) {
    vec3 bandN = normalize(vec3(0.42, 0.55, 0.72));
    float bd = dot(d, bandN);
    float milky = exp(-bd * bd / 0.022);
    float cloudy = fbm(d * 5.0 + 3.0);
    float lane = smoothstep(0.35, 0.75, fbm(d * 11.0));
    float horizonFade = smoothstep(-0.02, 0.3, y);
    vec3 mcol = mix(vec3(0.35, 0.4, 0.62), vec3(0.62, 0.58, 0.66), cloudy);
    col += mcol * milky * (0.07 + 0.12 * cloudy) * (1.0 - 0.6 * lane) * uStars * horizonFade;
    float t1, t2;
    float s1 = starLayer(d, 260.0, 0.012 + 0.03 * milky, t1);
    float s2 = starLayer(d.zxy, 120.0, 0.004, t2);
    vec3 c1 = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), t1);
    vec3 c2 = mix(vec3(0.8, 0.86, 1.0), vec3(1.0, 0.88, 0.75), t2);
    col += (c1 * s1 * 1.3 + c2 * s2 * 2.6) * uStars * horizonFade;
  }

  // Moon: a soft glow, then a pale disc with faint maria; the phase is the lit part
  // of a sphere lit from a direction that swings round with the phase.
  if (uMoonVis > 0.001) {
    float md = dot(d, uMoonDir);
    col += vec3(0.5, 0.58, 0.78) * (pow(max(md, 0.0), 60.0) * 0.18 + pow(max(md, 0.0), 900.0) * 0.25) * uMoonVis;
    float rr = (1.0 - md) / 0.00012; // 0 at the centre, 1 at the rim
    if (rr < 1.15) {
      vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + 1e-4);
      vec3 upv = cross(right, uMoonDir);
      vec2 uv = vec2(dot(d, right), dot(d, upv)) / 0.0155;
      float r2 = dot(uv, uv);
      float mdisc = 1.0 - smoothstep(0.9, 1.0, r2);
      vec3 n = vec3(uv, sqrt(max(0.0, 1.0 - r2)));
      float ang = (uMoonPhase - 0.5) * 6.2831853; // 0 at full
      vec3 lightDir = vec3(sin(ang), 0.0, cos(ang));
      float lit = smoothstep(-0.05, 0.12, dot(n, lightDir));
      float maria = 0.82 + 0.18 * smoothstep(0.35, 0.65, vnoise(vec3(uv * 3.2, 1.7)));
      vec3 mcol = vec3(0.95, 0.95, 0.9) * maria * (1.6 * lit + 0.05);
      col = mix(col, mcol, mdisc * uMoonVis * max(lit, 0.25));
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Builds the dome. Colours are set each frame by the sky module. */
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
    uGolden: { value: 0 },
    uTwilight: { value: 0 },
    uBelt: { value: new THREE.Color(0.8, 0.6, 0.7) },
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
