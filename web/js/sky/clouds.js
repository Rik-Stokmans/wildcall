// Drifting stylised clouds: soft flattened low-poly puffs grouped into clusters on a
// high layer around the camera. Cover follows env.cloud (clusters fade in by a per-
// cluster threshold), drift follows the wind, and the layer wraps around the camera so
// the sky is never empty however far the player walks.
import * as THREE from 'three';

const CLUSTERS = 56;
const PUFFS = 6;
const SPAN = 2600;     // metres: side of the wrapping square of cloud positions
const ALTITUDE = 330;  // metres above the camera

const VERT = /* glsl */`
uniform vec3 uSunDir;
varying float vLight;
varying float vDist;
varying float vHeight;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vLight = dot(n, uSunDir) * 0.5 + 0.5;
  vHeight = normal.y;
  vDist = length(wp.xz - cameraPosition.xz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */`
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uFog;
uniform float uOpacity;
uniform float uFar;
varying float vLight;
varying float vDist;
varying float vHeight;
void main() {
  // Two-tone toon shading with a soft band, brighter tops.
  float l = smoothstep(0.25, 0.75, vLight) * 0.75 + 0.25 * smoothstep(-0.2, 0.8, vHeight);
  vec3 col = mix(uShade, uLit, l);
  float fade = 1.0 - smoothstep(uFar * 0.55, uFar, vDist);
  col = mix(uFog, col, 0.35 + 0.65 * fade);
  gl_FragColor = vec4(col, uOpacity * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createClouds() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uLit: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.7, 0.75, 0.85) },
    uFog: { value: new THREE.Color() },
    uOpacity: { value: 0.9 },
    uFar: { value: SPAN * 0.5 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, material, CLUSTERS * PUFFS);
  mesh.name = 'sky-clouds';
  mesh.frustumCulled = false;
  mesh.renderOrder = -900;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const r = rand(0xc10d5);
  const clusters = [];
  for (let i = 0; i < CLUSTERS; i++) {
    const size = 40 + r() * 90;
    const puffs = [];
    for (let j = 0; j < PUFFS; j++) {
      const a = r() * Math.PI * 2, d = r() * size * 0.9;
      puffs.push({
        x: Math.cos(a) * d, z: Math.sin(a) * d * 0.6, y: r() * size * 0.12,
        s: size * (0.35 + r() * 0.4) * (1 - d / (size * 2)),
      });
    }
    clusters.push({
      x: r() * SPAN, z: r() * SPAN, y: ALTITUDE + r() * 120,
      // Lower thresholds appear first: a clear sky still keeps a few fair-weather clouds.
      threshold: i / CLUSTERS, flat: 0.32 + r() * 0.12, yaw: r() * Math.PI, cover: 0, puffs,
    });
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const drift = { x: 0, z: 0 };

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} cam camera position
   * @param {number} cloud 0..1 cover
   * @param {number} wind 0..1
   */
  function update(dt, cam, cloud, wind) {
    // Prevailing wind from the south-west, faster aloft.
    const speed = 2.5 + wind * 14;
    drift.x += speed * 0.8 * dt;
    drift.z -= speed * 0.6 * dt;
    const want = 0.12 + cloud * 0.88;
    let n = 0;
    for (const c of clusters) {
      const target = want > c.threshold ? Math.min(1, (want - c.threshold) * 6) : 0;
      c.cover += (target - c.cover) * Math.min(1, dt * 0.25);
      // Wrap the cluster into the square centred on the camera.
      let x = c.x + drift.x - cam.x, z = c.z + drift.z - cam.z;
      x = ((x % SPAN) + SPAN) % SPAN - SPAN / 2;
      z = ((z % SPAN) + SPAN) % SPAN - SPAN / 2;
      // Overcast clouds sit lower and spread wider.
      const grow = c.cover * (1 + cloud * 0.45);
      const cy = cam.y + c.y - cloud * 70;
      q.setFromAxisAngle(up, c.yaw);
      const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
      for (const p of c.puffs) {
        const s = p.s * grow;
        pos.set(cam.x + x + (p.x * cos + p.z * sin) * (1 + cloud * 0.3), cy + p.y, cam.z + z + (-p.x * sin + p.z * cos) * (1 + cloud * 0.3));
        scl.set(s, s * c.flat, s * 0.85);
        if (s < 0.5) scl.set(0, 0, 0);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(n++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Lit/shade colours (sRGB triples), fog colour, sun direction, opacity. */
  function setLook(lit, shade, fog, sunDir, opacity) {
    uniforms.uLit.value.setRGB(lit[0], lit[1], lit[2], THREE.SRGBColorSpace);
    uniforms.uShade.value.setRGB(shade[0], shade[1], shade[2], THREE.SRGBColorSpace);
    uniforms.uFog.value.setRGB(fog[0], fog[1], fog[2], THREE.SRGBColorSpace);
    uniforms.uSunDir.value.copy(sunDir);
    uniforms.uOpacity.value = opacity;
  }

  return { mesh, update, setLook };
}
