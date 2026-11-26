// Big soft cumulus: each cloud is a cluster of camera-facing puffs shaded as soft
// spheres (lit tops, shaded flat bases, a silver lining when the sun is behind them,
// billowy noisy edges). Puffs are sorted back to front every frame so the overlapping
// soft edges read as one volume. Clusters wrap around the camera on a high layer,
// drift with the wind and fade in/out by a per-cluster threshold as env.cloud changes;
// rain lowers, spreads and darkens them.
import * as THREE from 'three';
import { cloudLayout, clusterCover } from './cloudmath.js';

const CLUSTERS = 44;
const SPAN = 3400;     // metres: side of the wrapping square of cloud positions
const ALTITUDE = 300;  // metres above the camera (cloud bases)

const VERT = /* glsl */`
attribute vec4 iPos;   // xyz world centre, w size (radius, m)
attribute vec4 iCl;    // x cluster base y, y cluster height, z seed, w alpha
attribute vec2 iCen;   // cluster centre xz
uniform vec3 uCamRight;
uniform vec3 uCamUp;
varying vec2 vUv;
varying vec3 vWorld;
varying vec4 vCl;
varying float vSize;
varying float vCenDist;
void main() {
  vCenDist = length(iCen - cameraPosition.xz);
  vec3 wp = iPos.xyz + (uCamRight * position.x + uCamUp * position.y) * iPos.w;
  vUv = position.xy;
  vWorld = wp;
  vCl = iCl;
  vSize = iPos.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */`
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uFog;
uniform vec3 uRim;
uniform vec3 uSunDir;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uFar;
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;
varying vec4 vCl;
varying float vSize;
varying float vCenDist;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float r = sqrt(r2);
  // Billowy edge: two octaves of noise around the rim, slowly boiling.
  vec2 q = vUv * 2.2 + vCl.z * 31.0;
  float n = vnoise(q + uTime * 0.015) * 0.65 + vnoise(q * 2.3 - uTime * 0.02) * 0.35;
  float edge = 1.0 - smoothstep(0.6, 0.97, r + (n - 0.5) * 0.3);
  // Flat bases: the view ray's height where it passes the cluster centre decides
  // whether it is below the base plane. Using one distance per cluster keeps the base
  // a single clean line (a per-billboard world height would cut every camera-facing
  // puff at a different screen height and leave stripes).
  float base = vCl.x;
  vec3 ray = vWorld - cameraPosition;
  float rayY = cameraPosition.y + ray.y / max(length(ray.xz), 1.0) * vCenDist;
  float flatBase = smoothstep(base - 0.03 * vSize, base + 0.06 * vSize, rayY + (n - 0.5) * 0.04 * vSize);
  float a = edge * flatBase * vCl.w;
  if (a < 0.003) discard;

  // A sphere normal from the billboard, in world space.
  vec3 toCam = normalize(cameraPosition - vWorld);
  vec3 nrm = normalize(uCamRight * vUv.x + uCamUp * vUv.y + toCam * sqrt(max(0.0, 1.0 - r2)));
  float diff = dot(nrm, uSunDir) * 0.5 + 0.5;
  // Seen against the sun, per-puff sphere shading would light every puff's rim and
  // outline it; light flatly instead and let the height term and silver lining work.
  float against = smoothstep(0.2, 0.85, dot(-toCam, uSunDir));
  diff = mix(diff, 0.5, against * 0.9);
  // Height within the cloud: tops catch the light, bases sit in shade.
  float hgt = clamp((vWorld.y - base) / max(1.0, vCl.y), 0.0, 1.0);
  float lit = clamp(diff * 0.6 + hgt * 0.65 - 0.12, 0.0, 1.0);
  lit = smoothstep(0.0, 1.0, lit);
  vec3 col = mix(uShade, uLit, lit);
  // Silver lining: thin edges glow when the sun is behind the cloud.
  float behind = pow(max(dot(-toCam, uSunDir), 0.0), 6.0);
  // (kept gentle: every puff has its own rim, so strong values outline each puff)
  // Forward scattering lights the whole cloud near the sun, a little more at the rim.
  col += uRim * behind * (0.45 + 0.2 * smoothstep(0.6, 1.0, r));
  // Distance and low elevation melt into the horizon haze.
  float dist = length(vWorld.xz - cameraPosition.xz);
  float fade = 1.0 - smoothstep(uFar * 0.6, uFar, dist);
  float low = smoothstep(0.02, 0.22, (vWorld.y - cameraPosition.y) / max(dist, 1.0));
  col = mix(uFog, col, mix(0.25, 1.0, fade * low));
  gl_FragColor = vec4(col, a * mix(0.35, 1.0, fade));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createClouds() {
  const layout = cloudLayout(CLUSTERS, SPAN, 0xc10d5);
  const maxPuffs = layout.reduce((s, c) => s + c.puffs.length, 0);

  const quad = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const posArr = new Float32Array(maxPuffs * 4);
  const clArr = new Float32Array(maxPuffs * 4);
  const cenArr = new Float32Array(maxPuffs * 2);
  const iCen = new THREE.InstancedBufferAttribute(cenArr, 2).setUsage(THREE.DynamicDrawUsage);
  const iPos = new THREE.InstancedBufferAttribute(posArr, 4).setUsage(THREE.DynamicDrawUsage);
  const iCl = new THREE.InstancedBufferAttribute(clArr, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iCl', iCl);
  geo.setAttribute('iCen', iCen);
  geo.instanceCount = 0;

  const uniforms = {
    uLit: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.7, 0.75, 0.85) },
    uFog: { value: new THREE.Color() },
    uRim: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uFar: { value: SPAN * 0.5 },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'sky-clouds';
  mesh.frustumCulled = false;
  mesh.renderOrder = -900;

  // Scratch buffers for the per-frame build + sort (no allocations in the loop).
  const tmpPos = new Float32Array(maxPuffs * 4);
  const tmpCl = new Float32Array(maxPuffs * 4);
  const tmpCen = new Float32Array(maxPuffs * 2);
  const depth = new Float32Array(maxPuffs);
  const order = new Array(maxPuffs).fill(0);
  const byDepth = (a, b) => depth[b] - depth[a];
  const fwd = new THREE.Vector3();
  const drift = { x: 0, z: 0 };

  /**
   * @param {number} dt seconds
   * @param {THREE.Camera} camera
   * @param {{cloud:number, wind:number, rain:number}} e
   * @param {number} time seconds
   */
  function update(dt, camera, e, time) {
    const cam = camera.position;
    const m = camera.matrixWorld.elements;
    uniforms.uCamRight.value.set(m[0], m[1], m[2]).normalize();
    uniforms.uCamUp.value.set(m[4], m[5], m[6]).normalize();
    fwd.set(-m[8], -m[9], -m[10]).normalize();
    uniforms.uTime.value = time % 1000;
    // Prevailing wind from the south-west, faster aloft.
    const speed = 2.5 + e.wind * 14;
    drift.x += speed * 0.8 * dt;
    drift.z -= speed * 0.6 * dt;
    const spread = 1 + e.cloud * 0.35 + e.rain * 0.25;
    const lower = e.cloud * 60 + e.rain * 70;
    let n = 0;
    for (const c of layout) {
      const target = clusterCover(c.threshold, e.cloud, e.rain);
      c.cover += (target - c.cover) * Math.min(1, dt * 0.22);
      if (c.cover < 0.01) continue;
      // Wrap the cluster into the square centred on the camera.
      let x = c.x + drift.x - cam.x, z = c.z + drift.z - cam.z;
      x = ((x % SPAN) + SPAN) % SPAN - SPAN / 2;
      z = ((z % SPAN) + SPAN) % SPAN - SPAN / 2;
      const grow = (0.55 + 0.45 * c.cover) * spread;
      const baseY = cam.y + ALTITUDE + c.alt - lower;
      const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
      for (const p of c.puffs) {
        const px = cam.x + x + (p.x * cos + p.z * sin) * grow;
        const pz = cam.z + z + (-p.x * sin + p.z * cos) * grow;
        const py = baseY + p.y * grow;
        const o = n * 4;
        tmpPos[o] = px; tmpPos[o + 1] = py; tmpPos[o + 2] = pz; tmpPos[o + 3] = p.s * grow;
        tmpCl[o] = baseY; tmpCl[o + 1] = c.height * grow; tmpCl[o + 2] = p.seed; tmpCl[o + 3] = Math.min(1, c.cover * 1.4) * p.alpha;
        tmpCen[n * 2] = cam.x + x; tmpCen[n * 2 + 1] = cam.z + z;
        depth[n] = (px - cam.x) * fwd.x + (py - cam.y) * fwd.y + (pz - cam.z) * fwd.z;
        order[n] = n;
        n++;
      }
    }
    // Back to front.
    order.length = n;
    order.sort(byDepth);
    for (let i = 0; i < n; i++) {
      const s = order[i] * 4, d = i * 4;
      posArr[d] = tmpPos[s]; posArr[d + 1] = tmpPos[s + 1]; posArr[d + 2] = tmpPos[s + 2]; posArr[d + 3] = tmpPos[s + 3];
      clArr[d] = tmpCl[s]; clArr[d + 1] = tmpCl[s + 1]; clArr[d + 2] = tmpCl[s + 2]; clArr[d + 3] = tmpCl[s + 3];
      cenArr[i * 2] = tmpCen[order[i] * 2]; cenArr[i * 2 + 1] = tmpCen[order[i] * 2 + 1];
    }
    order.length = maxPuffs;
    geo.instanceCount = n;
    iPos.needsUpdate = true;
    iCl.needsUpdate = true;
    iCen.needsUpdate = true;
    mesh.visible = n > 0;
  }

  /** Lit/shade/rim colours (sRGB triples), fog colour and sun direction. */
  function setLook(lit, shade, rim, fog, sunDir) {
    uniforms.uLit.value.setRGB(lit[0], lit[1], lit[2], THREE.SRGBColorSpace);
    uniforms.uShade.value.setRGB(shade[0], shade[1], shade[2], THREE.SRGBColorSpace);
    uniforms.uRim.value.setRGB(rim[0], rim[1], rim[2], THREE.SRGBColorSpace);
    uniforms.uFog.value.setRGB(fog[0], fog[1], fog[2], THREE.SRGBColorSpace);
    uniforms.uSunDir.value.copy(sunDir);
  }

  return { mesh, update, setLook };
}
