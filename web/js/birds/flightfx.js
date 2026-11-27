// Flight you can follow: the three.js side (the maths is in flightlook.js).
//
// Owned here, driven by a handful of hooks in index.js:
//   * per-bird flight tracking (take-off / flush / landing moments, airborne weight,
//     the continuity guard that turns residual position steps into short glides);
//   * the one combined drawn scale (perched exaggeration raised to a wingspan floor in
//     flight) and the take-off / landing pose written over the animator's pose;
//   * a faint trail of soft dabs behind a flushed bird (setting flightTrails), gone
//     within half a second, depth-tested like everything else;
//   * at a flush: two or three leaves or a feather drifting down from the perch (a
//     splash and rings on water), and the take-off heard where the bird is
//     (ctx.audio.wings: a pigeon-sized clatter, a small bird's flutter, a wren's whirr,
//     a duck's splash and wing whistle, a heron's slow whoosh);
//   * at the landing of a flushed bird: the flare and settle (pose), a soft landing
//     sound close by, and ~10 s of a slightly stronger outline (outline.js stays
//     depth-tested: nothing ever shows through terrain or trunks);
//   * distant flying birds (beyond the full-model range) as flapping silhouettes of the
//     right size and wing shape instead of square specks — buzzards circling, a crow
//     crossing — one instanced draw call.
// Nothing here names a bird. Everything is pooled and preallocated; nothing allocates
// per frame; dispose() frees every GPU object.

import * as THREE from 'three';
import { ParticlePool } from './particles.js';
import { ACT, isAirborneAct } from './constants.js';
import { flightPose, flightStyleFor, flapRateFor, createFlightPose } from './flight.js';
import { createPose } from './pose.js';
import { exaggeration } from './visibility.js';
import {
  createFlightState, resetFlightState, trackFlight, flightScale, scaleWeight, windowRange, overlayPose, glowAlpha, animAct,
  visibleFlapHz, trailCount, dabAlpha, dabSize, drawnSpanPx, refPixel, EV, TRAIL,
} from './flightlook.js';
import { wingKind } from '../audio/wingmodel.js';

const DAB_CAP = 320;
const DEBRIS_CAP = 96;
const SIL_CAP = 512;
const SOUND_TAKEOFF = 70, SOUND_CALM = 14, SOUND_LAND = 35;
const DEBRIS_RANGE = 45;

// --- materials --------------------------------------------------------------------

function dabMaterial() {
  return new THREE.ShaderMaterial({
    name: 'birds-flight-dab',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uColor: { value: new THREE.Color().setStyle('#fff3d8', THREE.SRGBColorSpace) } }]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute float aAlpha;
      attribute float aSeed;
      varying float vAlpha;
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        vAlpha = aAlpha; vUv = uv; vSeed = aSeed;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vAlpha;
      varying vec2 vUv;
      varying float vSeed;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        // A soft, slightly uneven brush dab rather than a perfect disc.
        float wob = 0.12 * sin(atan(q.y, q.x) * 3.0 + vSeed * 6.283);
        float r = length(q) * (1.0 + wob);
        float a = vAlpha * (1.0 - smoothstep(0.25, 1.0, r));
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
  });
}

// A flat bird planform of unit wingspan (faces -Z, right +X, up +Y). Wing vertices carry
// aW = (span 0..1, side ±1, trailing edge 0/1) and are bent, flapped and folded in the
// vertex shader; body and tail (side 0) are stretched to the species' proportions.
function silhouetteGeometry() {
  const P = [], W = [], I = [];
  const v = (x, y, z, s, side, tr) => { P.push(x, y, z); W.push(s, side, tr); return P.length / 3 - 1; };
  // Body: a diamond in the wing plane and a thin keel so a side view still shows it.
  const nose = v(0, 0, -0.25, 0, 0, 0), l = v(-0.04, 0, -0.03, 0, 0, 0), r = v(0.04, 0, -0.03, 0, 0, 0), tb = v(0, 0, 0.13, 0, 0, 0);
  I.push(nose, l, tb, nose, tb, r);
  const up = v(0, 0.035, -0.06, 0, 0, 0), dn = v(0, -0.03, -0.04, 0, 0, 0);
  I.push(nose, up, tb, nose, tb, dn);
  // Tail fan.
  const tl = v(-0.05, 0, 0.27, 0, 0, 0), tr = v(0.05, 0, 0.27, 0, 0, 0), tc = v(0, 0, 0.1, 0, 0, 0);
  I.push(tc, tl, tr);
  // Wings: three span stations (shoulder, wrist, tip) × leading/trailing edge.
  for (const side of [-1, 1]) {
    const idx = [];
    for (const s of [0, 0.45, 1]) idx.push([v(0, 0, 0, s, side, 0), v(0, 0, 0, s, side, 1)]);
    for (let k = 0; k < 2; k++) {
      const [a0, a1] = idx[k], [b0, b1] = idx[k + 1];
      I.push(a0, b0, a1, a1, b0, b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(W, 3));
  g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return g;
}

function silhouetteMaterial() {
  return new THREE.ShaderMaterial({
    name: 'birds-flight-silhouette',
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      attribute vec3 aW;
      attribute vec4 aWing;   // flap (rad, + up), fold 0..1, chord (of span), tip width (of chord)
      attribute vec2 aShape;  // body length / span, alpha-free spare
      attribute vec3 aColor;
      varying vec3 vColor;
      void main() {
        vec3 p = position;
        if (aW.y != 0.0) {
          float s = aW.x;
          float reach = 0.475 * (1.0 - 0.62 * aWing.y);
          float c = aWing.z * mix(1.0, aWing.w, s) * (1.0 - 0.35 * aWing.y);
          float zl = -0.05 + 0.08 * s * s;
          float z = zl + aW.z * c;
          float knee = 0.45;
          float a1 = aWing.x;
          float a2 = aWing.x * 1.4 - 0.06;
          float r = s * reach;
          vec2 xy = s <= knee ? vec2(cos(a1), sin(a1)) * r
            : vec2(cos(a1), sin(a1)) * (knee * reach) + vec2(cos(a2), sin(a2)) * (r - knee * reach);
          p = vec3((0.03 + xy.x) * aW.y, xy.y, z);
        } else {
          p.z *= aShape.x / 0.5;
        }
        vColor = aColor;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        gl_FragColor = vec4(vColor, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** Wing planform per catalog wing shape: chord (of span) and tip width (of chord). */
const PLANFORM = Object.freeze({
  rounded: [0.2, 0.55], pointed: [0.16, 0.18], broad: [0.24, 0.85], long: [0.13, 0.25],
});

const LEAF_COLORS = ['#5f8f3a', '#7aa447', '#4d7a33', '#a88a45'].map((c) => new THREE.Color().setStyle(c, THREE.SRGBColorSpace));
const FEATHER_COLOR = new THREE.Color().setStyle('#d9d2c4', THREE.SRGBColorSpace);

/**
 * @param {object} ctx   the client context (audio, world, sky are optional)
 * @param {THREE.Scene} scene
 * @param {object} [fx]  effects.js instance (splashes, ripples on water)
 */
export function createFlightFx(ctx, scene, fx) {
  // Setting flightTrails defaults to on (core/state.js DEFAULT_SETTINGS); kept as a
  // guard for contexts built without it (tests).
  const st = ctx.state?.settings;
  if (st && st.flightTrails === undefined) st.flightTrails = true;
  const group = new THREE.Group();
  group.name = 'birds-fx'; // same name as effects.js: the visibility audit hides both
  scene.add(group);

  // --- trail dabs ---
  const dabGeo = new THREE.PlaneGeometry(1, 1);
  const dabA = new THREE.InstancedBufferAttribute(new Float32Array(DAB_CAP), 1);
  const dabS = new THREE.InstancedBufferAttribute(new Float32Array(DAB_CAP), 1);
  dabA.setUsage(THREE.DynamicDrawUsage); dabS.setUsage(THREE.DynamicDrawUsage);
  dabGeo.setAttribute('aAlpha', dabA);
  dabGeo.setAttribute('aSeed', dabS);
  const dabMat = dabMaterial();
  const dabs = new THREE.InstancedMesh(dabGeo, dabMat, DAB_CAP);
  dabs.name = 'bird-trail-dabs';
  dabs.frustumCulled = false;
  dabs.count = 0;
  dabs.renderOrder = 3;
  dabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(dabs);
  const dabPool = new ParticlePool(DAB_CAP);

  // --- leaves and feathers ---
  const debGeo = new THREE.PlaneGeometry(1, 0.62);
  const debMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: true });
  const debris = new THREE.InstancedMesh(debGeo, debMat, DEBRIS_CAP);
  debris.name = 'bird-flush-debris';
  debris.frustumCulled = false;
  debris.count = 0;
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debris.setColorAt(0, FEATHER_COLOR);
  debris.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(debris);
  const debPool = new ParticlePool(DEBRIS_CAP);

  // --- distant silhouettes ---
  const silGeo = silhouetteGeometry();
  const aWing = new THREE.InstancedBufferAttribute(new Float32Array(SIL_CAP * 4), 4);
  const aShape = new THREE.InstancedBufferAttribute(new Float32Array(SIL_CAP * 2), 2);
  const aColor = new THREE.InstancedBufferAttribute(new Float32Array(SIL_CAP * 3), 3);
  for (const a of [aWing, aShape, aColor]) a.setUsage(THREE.DynamicDrawUsage);
  silGeo.setAttribute('aWing', aWing);
  silGeo.setAttribute('aShape', aShape);
  silGeo.setAttribute('aColor', aColor);
  const silMat = silhouetteMaterial();
  const sil = new THREE.InstancedMesh(silGeo, silMat, SIL_CAP);
  sil.name = 'bird-silhouettes';
  sil.frustumCulled = false;
  sil.count = 0;
  sil.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(sil);
  let nSil = 0;

  // --- scratch (no per-frame allocation) ---
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const fp = createFlightPose();
  const kinds = new WeakMap(); // template → wing sound kind
  let fov = 70, pxA = refPixel(70), dt = 0, trailsOn = true, day = 1, rnd = 987654;
  const random = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };

  function kindOf(tpl) {
    let k = kinds.get(tpl);
    if (!k) { k = wingKind(tpl.species); kinds.set(tpl, k); }
    return k;
  }

  function onWater(x, y, z) {
    if (y > 0.6) return false;
    try { return (+ctx.world?.waterDepthAt?.(x, z) || 0) > 0.05; } catch { return false; }
  }

  function groundAt(x, z, y) {
    try { if (ctx.world?.isLoaded?.(x, z)) return ctx.world.heightAt(x, z); } catch { /* not loaded */ }
    return y;
  }

  /** Leaves (and a feather) shaken off the perch, or a splash on water. */
  function flushDebris(d, x, y, z, dist) {
    const L = d.template.rig.length;
    if (onWater(x, y, z)) {
      if (fx) { fx.splash(x, 0.05, z, L, 12); fx.ripple(x, z, L * 4 + 0.2, 1.6); fx.ripple(x, z, L * 2.5 + 0.1, 1.1); }
      return;
    }
    const g = groundAt(x, z, y);
    const above = y - g;
    const minSize = 2.6 * pxA * dist; // never thinner than ~2.6 px (720p): a cue, not a speck of noise
    if (above > 1.4) {
      const n = 2 + (random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const fall = 0.8 + random() * 0.5;
        debPool.spawn(x + (random() - 0.5) * 0.5, y + 0.1 + random() * 0.3, z + (random() - 0.5) * 0.5,
          (random() - 0.5) * 0.8, 0.4 + random() * 0.5, (random() - 0.5) * 0.8,
          Math.min(4.5, above / fall + 0.4), Math.max(0.055 + random() * 0.03, minSize), Math.floor(random() * 4) + random() * 0.99);
      }
    }
    // One small feather, drifting slowly.
    debPool.spawn(x, y + 0.15, z, (random() - 0.5) * 0.4, 0.3, (random() - 0.5) * 0.4,
      Math.min(5, Math.max(above, 0.4) / 0.35 + 0.5), Math.max(0.045, minSize * 0.9), 4 + random() * 0.99);
  }

  function sound(d, s, dist, o) {
    const range = o.landing ? SOUND_LAND : o.flush ? SOUND_TAKEOFF : SOUND_CALM;
    if (dist > range) return;
    o.size = d.template.rig.length;
    o.water = onWater(s.x, s.y, s.z);
    try { ctx.audio?.wings?.(kindOf(d.template), s.x, s.y, s.z, o); } catch (err) { console.error('[birds] wing sound failed', err); }
  }
  const sndO = { flush: false, landing: false, water: false, size: 0.15, gain: 1 };

  const api = {
    group,

    /** A new per-bird flight state (keep it on the bird's renderer data). */
    state() {
      const fl = createFlightState();
      fl.pose = createPose();
      return fl;
    },

    /** Re-initialise a pooled state for a new bird. */
    reset(fl, id) { resetFlightState(fl, Math.floor(id) >>> 0); },

    /** Per frame, before any bird. */
    begin(cPos, cQuat, camFov, settings, frameDt) {
      camPos.copy(cPos); camQuat.copy(cQuat);
      fov = camFov; pxA = refPixel(camFov); dt = frameDt;
      trailsOn = settings?.flightTrails !== false;
      day = Number.isFinite(ctx.sky?.daylight) ? Math.min(1, Math.max(0, ctx.sky.daylight)) : 1;
      nSil = 0;
    },

    /**
     * Per bird with a valid sample, right after sampling (adjusts s.x/y/z through the
     * continuity guard) — take-off, flush and landing effects start here.
     */
    track(d, s) {
      const fl = d.fl;
      const ev = trackFlight(fl, s, dt);
      if (!ev) return;
      const dx = s.x - camPos.x, dy = s.y - camPos.y, dz = s.z - camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (ev & EV.FLUSH && ev & EV.TAKEOFF) {
        sndO.flush = true; sndO.landing = false; sndO.gain = 1;
        sound(d, s, dist, sndO);
        if (dist < DEBRIS_RANGE) flushDebris(d, s.x, s.y, s.z, dist);
      } else if (ev & EV.TAKEOFF) {
        sndO.flush = false; sndO.landing = false; sndO.gain = 0.7;
        sound(d, s, dist, sndO);
      } else if (ev & EV.LAND_FLUSHED) {
        sndO.flush = false; sndO.landing = true; sndO.gain = 1;
        sound(d, s, dist, sndO);
      }
    },

    /** The act to animate (a dash into cover is a flight). */
    animAct(s) { return animAct(s.act, s.speed); },

    /** The one combined drawn scale (perched exaggeration, raised to the flight floor). */
    scale(d, exag, dist, camFov) {
      // scaleWeight: a flushed bird keeps its flight floor on its landing perch for the glow.
      return flightScale(exag, d.template.rig.span, dist, camFov, scaleWeight(d.fl));
    },

    /** The pose to draw: the animator's, with take-off and landing written over it. */
    pose(d) { return overlayPose(d.fl, d.pose, d.fl.pose, d.template.rig.length); },

    /** Outline alpha, stronger for ~10 s after a flushed bird lands. */
    outline(d, alpha) { return glowAlpha(alpha, d.fl); },

    /** Leaf-window reach for this bird: farther for a flushed bird that has just landed. */
    windowRange(d, base) { return windowRange(d.fl, base); },

    /**
     * Per bird and frame after its LOD is drawn: the trail behind a flushed bird.
     * @param {number} fade  spawn/despawn fade × jump cross-fade
     */
    trail(d, s, fade) {
      const fl = d.fl;
      const on = trailsOn && fl.airborne && fl.flushed && d.dist < TRAIL.maxDist && fade > 0.5 && fl.sinceUp > 0.06;
      const n = trailCount(fl, dt, on);
      if (n > 0 && fl.pValid) {
        const span = d.template.rig.span;
        const scale = flightScale(exaggeration(d.template.rig.length, d.dist, fov), span, d.dist, fov, fl.air);
        const size = dabSize(drawnSpanPx(span, scale, d.dist, fov), d.dist, fov);
        for (let i = 0; i < n; i++) {
          const u = (i + 1) / n;
          dabPool.spawn(fl.px + (s.x - fl.px) * u, fl.py + (s.y - fl.py) * u, fl.pz + (s.z - fl.pz) * u,
            // k: intensity (dimmer at night) in hundredths + a seed for the dab's shape.
            0, 0, 0, TRAIL.life, size, Math.round(40 + 60 * day) + random() * 0.99);
        }
      }
      fl.px = s.x; fl.py = s.y; fl.pz = s.z; fl.pValid = true;
    },

    /**
     * Beyond the full-model range: draw a flying bird as a flapping silhouette of its
     * own size and wing shape. Returns false for birds that are not in flight (the
     * caller draws its speck).
     */
    silhouette(d, s, fade, dist) {
      const fl = d.fl;
      if (!fl.airborne && fl.air < 0.5) return false;
      if (nSil >= SIL_CAP) return true;
      const tpl = d.template, P = tpl.profile, R = tpl.rig;
      const act = animAct(s.act, s.speed);
      const style = flightStyleFor(isAirborneAct(act) ? act : ACT.FLYING, P.flight);
      fl.phase += dt * visibleFlapHz(P.flapHz * flapRateFor(act), dt);
      flightPose(style, fl.phase, fp);
      const scale = flightScale(exaggeration(R.length, dist, fov), R.span, dist, fov, 1) * fade;
      const hs = Math.hypot(s.vx, s.vz);
      const pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(s.vy, Math.max(hs, 0.5)) * 0.7));
      const roll = Math.max(-0.9, Math.min(0.9, Math.atan((hs * s.yawRate) / 9.81))) + fp.sway * 1.2;
      e.set(pitch, -s.yaw, -roll, 'YXZ');
      q.setFromEuler(e);
      p.set(s.x, s.y + fp.bob * R.length * scale, s.z);
      const w = R.span * Math.max(scale, 1e-3);
      sc.set(w, w, w);
      m.compose(p, q, sc);
      sil.setMatrixAt(nSil, m);
      const pf = PLANFORM[R.wing?.shape] || PLANFORM.rounded;
      const k4 = nSil * 4;
      aWing.array[k4] = fp.flap; aWing.array[k4 + 1] = fp.fold; aWing.array[k4 + 2] = pf[0]; aWing.array[k4 + 3] = pf[1];
      aShape.array[nSil * 2] = Math.min(1.2, R.length / Math.max(R.span, 0.05));
      const c = (s.flags & 8) !== 0 ? tpl.speckColorRare : tpl.speckColor;
      aColor.array[nSil * 3] = c.r; aColor.array[nSil * 3 + 1] = c.g; aColor.array[nSil * 3 + 2] = c.b;
      nSil++;
      return true;
    },

    /** Per frame, after every bird: advance and upload trails, debris and silhouettes. */
    end() {
      sil.count = nSil;
      if (nSil > 0) {
        sil.instanceMatrix.needsUpdate = true;
        aWing.needsUpdate = true; aShape.needsUpdate = true; aColor.needsUpdate = true;
      }
      dabPool.step(dt, 0);
      for (let i = 0; i < dabPool.n; i++) {
        const pr = dabPool.progress(i);
        p.set(dabPool.x[i], dabPool.y[i], dabPool.z[i]);
        const s = dabPool.size[i] * (0.8 + 0.5 * pr);
        sc.set(s, s, s);
        m.compose(p, camQuat, sc);
        dabs.setMatrixAt(i, m);
        const k = dabPool.k[i];
        dabA.array[i] = dabAlpha(pr) * Math.floor(k) / 100;
        dabS.array[i] = k - Math.floor(k);
      }
      dabs.count = dabPool.n;
      if (dabPool.n > 0) { dabs.instanceMatrix.needsUpdate = true; dabA.needsUpdate = true; dabS.needsUpdate = true; }

      debPool.step(dt, 0);
      for (let i = 0; i < debPool.n; i++) {
        const k = debPool.k[i], kind = Math.floor(k), seed = k - kind;
        const feather = kind >= 4;
        // Settle towards a slow drift down (leaves ~0.9 m/s, a feather ~0.35 m/s).
        const term = feather ? -0.35 : -0.9;
        debPool.vy[i] += (term - debPool.vy[i]) * (1 - Math.exp(-dt * 2.2));
        debPool.vx[i] *= Math.exp(-dt * 1.2); debPool.vz[i] *= Math.exp(-dt * 1.2);
        const a = debPool.age[i];
        const sway = (feather ? 0.25 : 0.14) * Math.sin(a * (feather ? 2.2 : 3.4) + seed * 6.283);
        p.set(debPool.x[i] + sway, debPool.y[i], debPool.z[i] + sway * 0.6);
        e.set(a * (2.5 + seed * 3), seed * 6.283 + a * 1.3, a * (1.7 + seed * 2), 'YXZ');
        q.setFromEuler(e);
        const fadeOut = Math.min(1, (debPool.life[i] - a) / 0.4);
        const s = debPool.size[i] * Math.max(0.05, fadeOut);
        sc.set(s, s, s);
        m.compose(p, q, sc);
        debris.setMatrixAt(i, m);
        debris.setColorAt(i, feather ? FEATHER_COLOR : LEAF_COLORS[kind & 3]);
      }
      debris.count = debPool.n;
      if (debPool.n > 0) { debris.instanceMatrix.needsUpdate = true; debris.instanceColor.needsUpdate = true; }
      // Nothing to draw → no draw call.
      sil.visible = nSil > 0; dabs.visible = dabPool.n > 0; debris.visible = debPool.n > 0;
    },

    /** Forget all transient effects (new world). */
    clear() {
      dabPool.clear(); debPool.clear();
      dabs.count = 0; debris.count = 0; sil.count = 0; nSil = 0;
    },

    /** Free every GPU object. */
    dispose() {
      api.clear();
      group.removeFromParent();
      for (const o of [dabs, debris, sil]) { o.geometry.dispose(); o.material.dispose(); o.dispose?.(); }
    },

    /** Debug: live counts (trail dabs, debris, silhouettes this frame). */
    get stats() { return { dabs: dabPool.n, debris: debPool.n, silhouettes: nSil }; },
  };
  return api;
}
