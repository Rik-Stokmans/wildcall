// Weather particles around the camera: rain streaks, snowflakes and wind-blown leaf
// motes. Each is a fixed set of particles in a box that wraps around the camera in
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

/** Builds rain, snow and leaves; add `group` to the scene. */
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
  const su = { ...baseUniforms(snowBox), uSize: { value: 0.09 }, uSway: { value: 0.6 } };
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

  for (const f of [rain, snow, leaves]) group.add(f.object);
  const center = new THREE.Vector3();

  /**
   * @param {number} dt
   * @param {number} time seconds
   * @param {THREE.Vector3} cam camera position
   * @param {object} w {rain, snow, leaves (0..1 amounts), wind 0..1, windDir [x,z] unit,
   *   light 0..1 (dims particles at night), leafA/leafB sRGB triples}
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
  }

  /** Scales particle counts for the quality setting (draw ranges, no rebuild). */
  function setQuality(q) {
    const f = q === 'high' ? 1 : q === 'low' ? 0.4 : 0.7;
    rg.setDrawRange(0, Math.floor(RAIN * f) * 2);
    sg.setDrawRange(0, Math.floor(SNOW * f));
    lg.setDrawRange(0, Math.floor(LEAVES * f));
  }

  return { group, update, setQuality };
}
