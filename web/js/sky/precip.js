// Weather particles around the camera: rain streaks, snowflakes, wind-blown leaves,
// pollen/dust motes glinting in the sunbeams and fireflies on summer evenings. Each is a fixed set of particles in a box that wraps around the camera in
// world space (particles stay put as the player walks; only the box moves), animated
// entirely in the vertex shader — no per-frame CPU work beyond a few uniforms.
import * as THREE from 'three';

// GLSL shared by all three: world-anchored wrap of a particle into the box.
const WRAP = /* glsl */`
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uOffset;
uniform float uTime;
vec3 wrapPos(vec3 seed) {
  vec3 origin = uCenter - uBox * 0.5;
  return origin + mod(seed * uBox + uOffset - origin, uBox);
}`;

function seeds(count, perVertex, rnd) {
  const a = new Float32Array(count * perVertex * 3);
  for (let i = 0; i < count; i++) {
    const x = rnd(), y = rnd(), z = rnd();
    for (let v = 0; v < perVertex; v++) {
      const o = (i * perVertex + v) * 3;
      a[o] = x; a[o + 1] = y; a[o + 2] = z;
    }
  }
  return a;
}

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function baseUniforms(box) {
  return {
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(...box) },
    uOffset: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color(1, 1, 1) },
  };
}

/** A particle field whose offset integrates a (changing) velocity, kept bounded. */
class Field {
  constructor(object, uniforms, box) {
    this.object = object;
    this.u = uniforms;
    this.box = box;
    this.object.frustumCulled = false;
    this.object.visible = false;
  }
  advance(dt, vx, vy, vz, center, time, opacity) {
    const o = this.u.uOffset.value;
    const b = this.box;
    o.x = (o.x + vx * dt) % b[0];
    o.y = (o.y + vy * dt) % b[1];
    o.z = (o.z + vz * dt) % b[2];
    this.u.uCenter.value.copy(center);
    this.u.uTime.value = time % 628.3185307; // 100·2π: keeps float precision
    this.u.uOpacity.value = opacity;
    this.object.visible = opacity > 0.004;
  }
}

// --- rain -------------------------------------------------------------------
const RAIN_VERT = /* glsl */`
${WRAP}
uniform vec3 uDir;
uniform float uLen;
attribute vec3 aSeed;
attribute float aEnd;
varying float vFade;
void main() {
  vec3 p = wrapPos(aSeed) - uDir * uLen * aEnd * (0.7 + 0.6 * aSeed.x);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vFade = (1.0 - smoothstep(6.0, 22.0, -mv.z)) * mix(0.5, 1.0, aEnd);
  gl_Position = projectionMatrix * mv;
}`;
const RAIN_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vFade * 0.55);
  #include <colorspace_fragment>
}`;

// --- snow & leaves (points) ---------------------------------------------------
const FLAKE_VERT = /* glsl */`
${WRAP}
uniform float uSize;
uniform float uSway;
attribute vec3 aSeed;
varying float vFade;
varying float vRot;
varying float vTone;
void main() {
  vec3 p = wrapPos(aSeed);
  float ph = aSeed.x * 37.0 + aSeed.z * 11.0;
  p.x += sin(uTime * (1.0 + floor(aSeed.y * 2.0)) + ph) * uSway;
  p.z += cos(uTime * 1.0 + ph * 1.3) * uSway * 0.7;
  p.y += sin(uTime * 2.0 + ph) * uSway * 0.25;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vFade = 1.0 - smoothstep(uBox.x * 0.25, uBox.x * 0.5, length(mv.xyz));
  vRot = uTime * (0.5 + aSeed.y * 3.0) * (aSeed.z > 0.5 ? 1.0 : -1.0) + ph;
  vTone = fract(aSeed.x * 91.7);
  gl_PointSize = uSize * (0.6 + 0.8 * fract(aSeed.z * 53.1)) * (300.0 / max(0.5, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, r);
  gl_FragColor = vec4(uColor, a * uOpacity * vFade);
  #include <colorspace_fragment>
}`;
const LEAF_FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
varying float vFade;
varying float vRot;
varying float vTone;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vRot), k = cos(vRot);
  c = vec2(c.x * k - c.y * s, c.x * s + c.y * k);
  // A small almond leaf that flips: squash one axis with the spin.
  c.x /= 0.25 + 0.75 * abs(sin(vRot * 0.7));
  float d = length(vec2(c.x * 1.9, c.y));
  float a = smoothstep(0.42, 0.32, d);
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uColor, uColor2, vTone), a * uOpacity * vFade);
  #include <colorspace_fragment>
}`;

// --- motes: tiny specks that glint when they sit between the eye and the sun -------
const MOTE_VERT = /* glsl */`
${WRAP}
uniform float uSize;
uniform vec3 uSunDir;
attribute vec3 aSeed;
varying float vA;
void main() {
  vec3 p = wrapPos(aSeed);
  float ph = aSeed.x * 53.0 + aSeed.y * 17.0;
  p += vec3(sin(uTime * 0.31 + ph), sin(uTime * 0.23 + ph * 1.7) * 0.6, cos(uTime * 0.27 + ph * 0.7)) * 0.35;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vec3 toP = normalize(p - cameraPosition);
  float fwd = pow(max(dot(toP, uSunDir), 0.0), 3.0);
  float dist = length(mv.xyz);
  vA = (0.25 + 1.6 * fwd) * (1.0 - smoothstep(uBox.x * 0.22, uBox.x * 0.5, dist)) * smoothstep(0.4, 1.2, dist)
     * (0.6 + 0.4 * sin(uTime * (1.5 + aSeed.z * 3.0) + ph));
  gl_PointSize = uSize * (0.6 + 0.8 * fract(aSeed.z * 71.3)) * (300.0 / max(0.5, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(uColor * (0.6 + 0.8 * a), a * a * uOpacity * vA);
  #include <colorspace_fragment>
}`;

// --- fireflies: slow wandering lights that pulse on and off ----------------------
const FLY_VERT = /* glsl */`
${WRAP}
uniform float uSize;
attribute vec3 aSeed;
varying float vGlow;
void main() {
  vec3 p = wrapPos(aSeed);
  float ph = aSeed.x * 61.0 + aSeed.z * 23.0;
  p += vec3(sin(uTime * 0.21 + ph) * 1.4, sin(uTime * 0.37 + ph * 1.3) * 0.45, cos(uTime * 0.17 + ph * 0.9) * 1.4);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  // Each fly blinks: a soft pulse of ~0.8 s every 2.5–5 s.
  float period = 2.5 + aSeed.y * 2.5;
  float t = fract(uTime / period + aSeed.x * 7.3) * period;
  float pulse = smoothstep(0.0, 0.3, t) * (1.0 - smoothstep(0.7, 1.6, t));
  float dist = length(mv.xyz);
  vGlow = pulse * (1.0 - smoothstep(uBox.x * 0.3, uBox.x * 0.5, dist));
  gl_PointSize = uSize * (300.0 / max(0.5, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const FLY_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vGlow;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.22, 0.0, r);
  float halo = exp(-r * r * 9.0) * 0.5;
  float a = (core + halo) * vGlow * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * (core * 5.0 + halo * 1.5), a);
  #include <colorspace_fragment>
}`;

/** Builds rain, snow, leaves, motes and fireflies; add `group` to the scene. */
export function createPrecip() {
  const rnd = mulberry(0x5eed);
  const group = new THREE.Group();
  group.name = 'sky-precip';

  // Rain: line streaks, two vertices each.
  const RAIN = 2600, rainBox = [38, 24, 38];
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN * 2 * 3), 3));
  rg.setAttribute('aSeed', new THREE.BufferAttribute(seeds(RAIN, 2, rnd), 3));
  const ends = new Float32Array(RAIN * 2);
  for (let i = 0; i < RAIN; i++) ends[i * 2 + 1] = 1;
  rg.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  const ru = { ...baseUniforms(rainBox), uDir: { value: new THREE.Vector3(0, -1, 0) }, uLen: { value: 0.9 } };
  const rain = new Field(new THREE.LineSegments(rg, new THREE.ShaderMaterial({
    uniforms: ru, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false, fog: false,
  })), ru, rainBox);
  ru.uColor.value.setRGB(0.78, 0.84, 0.92, THREE.SRGBColorSpace);

  // Snow: soft round flakes.
  const SNOW = 2200, snowBox = [52, 30, 52];
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW * 3), 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(seeds(SNOW, 1, rnd), 3));
  const su = { ...baseUniforms(snowBox), uSize: { value: 0.14 }, uSway: { value: 0.6 } };
  const snow = new Field(new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: su, vertexShader: FLAKE_VERT, fragmentShader: SNOW_FRAG, transparent: true, depthWrite: false, fog: false,
  })), su, snowBox);
  su.uColor.value.setRGB(0.96, 0.97, 1.0, THREE.SRGBColorSpace);

  // Leaves: tumbling coloured motes near the ground.
  const LEAVES = 260, leafBox = [44, 14, 44];
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LEAVES * 3), 3));
  lg.setAttribute('aSeed', new THREE.BufferAttribute(seeds(LEAVES, 1, rnd), 3));
  const lu = { ...baseUniforms(leafBox), uSize: { value: 0.16 }, uSway: { value: 1.1 }, uColor2: { value: new THREE.Color() } };
  const leaves = new Field(new THREE.Points(lg, new THREE.ShaderMaterial({
    uniforms: lu, vertexShader: FLAKE_VERT, fragmentShader: LEAF_FRAG, transparent: true, depthWrite: false, fog: false,
  })), lu, leafBox);

  // Motes: a small cloud of specks close to the eye, glinting in the sun.
  const MOTES = 420, moteBox = [14, 7, 14];
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
  mg.setAttribute('aSeed', new THREE.BufferAttribute(seeds(MOTES, 1, rnd), 3));
  const mu = { ...baseUniforms(moteBox), uSize: { value: 0.018 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) } };
  const motes = new Field(new THREE.Points(mg, new THREE.ShaderMaterial({
    uniforms: mu, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  })), mu, moteBox);

  // Fireflies: a few dozen in a wide, low box around the player.
  const FLIES = 160, flyBox = [46, 3.2, 46];
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLIES * 3), 3));
  fg.setAttribute('aSeed', new THREE.BufferAttribute(seeds(FLIES, 1, rnd), 3));
  const fu = { ...baseUniforms(flyBox), uSize: { value: 0.75 } };
  const flies = new Field(new THREE.Points(fg, new THREE.ShaderMaterial({
    uniforms: fu, vertexShader: FLY_VERT, fragmentShader: FLY_FRAG, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  })), fu, flyBox);
  fu.uColor.value.setRGB(0.85, 1.0, 0.45, THREE.SRGBColorSpace);

  for (const f of [rain, snow, leaves, motes, flies]) group.add(f.object);
  const center = new THREE.Vector3();

  /**
   * @param {number} dt
   * @param {number} time seconds
   * @param {THREE.Vector3} cam camera position
   * @param {object} w {rain, snow, leaves (0..1 amounts), wind 0..1, windDir [x,z] unit,
   *   light 0..1 (dims particles at night), leafA/leafB sRGB triples, motes, fireflies
   *   0..1 amounts, sunDir THREE.Vector3, sunColor sRGB triple, ground y below the camera}
   */
  function update(dt, time, cam, w) {
    const wx = w.windDir[0] * w.wind, wz = w.windDir[1] * w.wind;
    // Rain falls fast, slanted by the wind.
    const rvx = wx * 5, rvy = -13, rvz = wz * 5;
    const rl = Math.hypot(rvx, rvy, rvz);
    ru.uDir.value.set(rvx / rl, rvy / rl, rvz / rl);
    center.copy(cam);
    rain.advance(dt, rvx, rvy, rvz, center, time, w.rain * (0.45 + 0.55 * w.light));
    snow.advance(dt, wx * 2.2, -1.1, wz * 2.2, center, time, w.snow * (0.55 + 0.45 * w.light));
    su.uSway.value = 0.4 + w.wind * 0.8;
    center.y = cam.y + 2;
    leaves.advance(dt, wx * 4 + 0.3, -0.45, wz * 4 + 0.2, center, time, w.leaves * (0.35 + 0.65 * w.light));
    lu.uSway.value = 0.6 + w.wind * 1.4;
    lu.uColor.value.setRGB(w.leafA[0], w.leafA[1], w.leafA[2], THREE.SRGBColorSpace);
    lu.uColor2.value.setRGB(w.leafB[0], w.leafB[1], w.leafB[2], THREE.SRGBColorSpace);
    center.copy(cam);
    motes.advance(dt, wx * 0.4, 0.02, wz * 0.4, center, time, w.motes);
    mu.uSunDir.value.copy(w.sunDir);
    mu.uColor.value.setRGB(w.sunColor[0], w.sunColor[1], w.sunColor[2], THREE.SRGBColorSpace);
    center.y = (Number.isFinite(w.ground) ? w.ground : cam.y - 1.6) + 1.4;
    flies.advance(dt, 0, 0, 0, center, time, w.fireflies);
  }

  /** Scales particle counts for the quality setting (draw ranges, no rebuild). */
  function setQuality(q) {
    const f = q === 'high' ? 1 : q === 'low' ? 0.4 : 0.7;
    rg.setDrawRange(0, Math.floor(RAIN * f) * 2);
    sg.setDrawRange(0, Math.floor(SNOW * f));
    lg.setDrawRange(0, Math.floor(LEAVES * f));
    mg.setDrawRange(0, Math.floor(MOTES * f));
    fg.setDrawRange(0, Math.floor(FLIES * (0.5 + 0.5 * f)));
  }

  return { group, update, setQuality };
}
