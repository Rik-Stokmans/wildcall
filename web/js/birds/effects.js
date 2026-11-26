// Instanced extras drawn for birds: distant specks (one 2-triangle camera-facing quad
// per far bird), wake / splash ripple rings on the water plane and splash droplets.
// Each is one InstancedMesh (one draw call) with preallocated capacity; nothing here
// allocates per frame.

import * as THREE from 'three';
import { ParticlePool, rippleShape } from './particles.js';

const SPECK_CAP = 1024;
const RIPPLE_CAP = 160;
const DROP_CAP = 320;
const WATER_Y = 0.02;

function rippleMaterial() {
  return new THREE.ShaderMaterial({
    name: 'birds-ripple',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color(0xeef6f4) } }]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vAlpha;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(uColor, vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}

export function createEffects(scene) {
  const group = new THREE.Group();
  group.name = 'birds-fx';
  scene.add(group);

  // --- specks ---------------------------------------------------------------------
  const speckGeo = new THREE.PlaneGeometry(1, 1);
  const speckMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  const specks = new THREE.InstancedMesh(speckGeo, speckMat, SPECK_CAP);
  specks.name = 'bird-specks';
  specks.frustumCulled = false; // instances are spread over the whole view
  specks.count = 0;
  specks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  specks.setColorAt(0, new THREE.Color(0, 0, 0));
  specks.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(specks);

  // --- ripples --------------------------------------------------------------------
  const ringGeo = new THREE.RingGeometry(0.86, 1, 22, 1);
  ringGeo.rotateX(-Math.PI / 2);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(RIPPLE_CAP), 1);
  alpha.setUsage(THREE.DynamicDrawUsage);
  ringGeo.setAttribute('aAlpha', alpha);
  const ripples = new THREE.InstancedMesh(ringGeo, rippleMaterial(), RIPPLE_CAP);
  ripples.name = 'bird-ripples';
  ripples.frustumCulled = false;
  ripples.count = 0;
  ripples.renderOrder = 2;
  ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(ripples);

  // --- droplets -------------------------------------------------------------------
  const dropGeo = new THREE.IcosahedronGeometry(1, 0);
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xdfeef0, fog: true });
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, DROP_CAP);
  drops.name = 'bird-drops';
  drops.frustumCulled = false;
  drops.count = 0;
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(drops);

  const ripplePool = new ParticlePool(RIPPLE_CAP);
  const dropPool = new ParticlePool(DROP_CAP);

  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const qId = new THREE.Quaternion();
  const shape = { r: 0, a: 0 };
  let nSpeck = 0;
  let rnd = 12345;
  const random = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };

  return {
    group,

    /** Start collecting specks for this frame. */
    beginSpecks() { nSpeck = 0; },

    /** Add one camera-facing speck. sx/sy are world sizes; quat = camera quaternion. */
    speck(x, y, z, sx, sy, quat, color) {
      if (nSpeck >= SPECK_CAP) return;
      p.set(x, y, z); s.set(sx, sy, 1);
      m.compose(p, quat, s);
      specks.setMatrixAt(nSpeck, m);
      specks.setColorAt(nSpeck, color);
      nSpeck++;
    },

    endSpecks() {
      specks.count = nSpeck;
      if (nSpeck > 0) {
        specks.instanceMatrix.needsUpdate = true;
        specks.instanceColor.needsUpdate = true;
      }
    },

    /** A ring on the water at (x, z) growing to `size` metres over `life` seconds. */
    ripple(x, z, size, life = 1.6) {
      ripplePool.spawn(x, WATER_Y, z, 0, 0, 0, life, size);
    },

    /** A small burst of droplets thrown up around (x, y, z). */
    splash(x, y, z, scale, count) {
      for (let i = 0; i < count; i++) {
        const a = random() * Math.PI * 2, sp = (0.4 + random() * 0.9) * Math.sqrt(scale * 4 + 0.2);
        dropPool.spawn(x, y, z, Math.cos(a) * sp * 0.5, 0.8 + random() * 1.4 * Math.sqrt(scale * 4 + 0.2), Math.sin(a) * sp * 0.5,
          0.35 + random() * 0.35, Math.max(0.006, scale * (0.05 + random() * 0.05)));
      }
    },

    update(dt) {
      ripplePool.step(dt, 0);
      dropPool.step(dt, 9.81, WATER_Y - 0.05);
      for (let i = 0; i < ripplePool.n; i++) {
        rippleShape(ripplePool.progress(i), ripplePool.size[i], shape);
        p.set(ripplePool.x[i], ripplePool.y[i], ripplePool.z[i]);
        s.set(shape.r, 1, shape.r);
        m.compose(p, qId, s);
        ripples.setMatrixAt(i, m);
        alpha.array[i] = shape.a;
      }
      ripples.count = ripplePool.n;
      if (ripplePool.n > 0) { ripples.instanceMatrix.needsUpdate = true; alpha.needsUpdate = true; }
      for (let i = 0; i < dropPool.n; i++) {
        const k = 1 - dropPool.progress(i) * 0.6;
        p.set(dropPool.x[i], dropPool.y[i], dropPool.z[i]);
        s.setScalar(dropPool.size[i] * k);
        m.compose(p, qId, s);
        drops.setMatrixAt(i, m);
      }
      drops.count = dropPool.n;
      if (dropPool.n > 0) drops.instanceMatrix.needsUpdate = true;
    },

    clear() {
      ripplePool.clear(); dropPool.clear();
      ripples.count = 0; drops.count = 0; specks.count = 0;
    },
  };
}
