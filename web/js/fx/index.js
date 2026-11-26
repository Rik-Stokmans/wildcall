// ctx.post — post-processing; owns the final render (main.js calls ctx.post.render(dt)
// every frame and for photographs via ctx.capture).
//
// Pipeline (three/addons EffectComposer):
//   ScenePass       scene → MSAA HDR target with a float depth texture (anti-aliasing)
//   ShaftsPass      sun light shafts: sky-near-sun mask from depth, radial blur (low res)
//   AtmospherePass  aerial perspective, low-ground mist, in-scatter, rain curtains, wet
//                   darkening, cloud shadows (parameters from ctx.sky.atmosphere)
//   UnrealBloomPass subtle bloom on HDR highlights (half/quarter res)
//   FinalPass       shafts + ACES tone mapping + time-of-day grade + vignette → screen
// Quality 'low' bypasses all of it and renders the scene directly (the renderer's own
// ACES + sRGB output is used then). 'medium' runs the effect buffers at half
// resolution. While binoculars or camera are raised, bloom and vignette fade out and
// shafts are reduced, so the image is not softened beyond what the tools do.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ScenePass, ShaftsPass, AtmospherePass, FinalPass } from './passes.js';
import { gradeParams, shaftStrength, sunScreenFade, postConfig, clamp } from './grade.js';

/** Bloom whose buffers can run below the composer's resolution. */
class ScaledBloomPass extends UnrealBloomPass {
  constructor(...args) { super(...args); this.scale = 1; }
  setSize(w, h) { super.setSize(Math.max(2, Math.round(w * this.scale)), Math.max(2, Math.round(h * this.scale))); }
}

export default {
  name: 'fx',

  init(ctx) {
    const { renderer, scene, camera, bus, state } = ctx;
    // Draw-call counters must cover every pass of a frame (the harness reads them).
    renderer.info.autoReset = false;

    let cfg = postConfig(state.settings?.quality || 'medium');
    const maxSamples = renderer.capabilities?.maxSamples ?? 4;
    const samples = () => Math.min(cfg.samples, maxSamples);

    const scenePass = new ScenePass(scene, camera, samples());
    const shafts = new ShaftsPass(camera);
    const atmos = new AtmospherePass(camera);
    atmos.source = scenePass.target;
    shafts.depthTexture = scenePass.target.depthTexture;
    const bloom = new ScaledBloomPass(new THREE.Vector2(256, 256), 0.2, 0.5, 0.95);
    const final = new FinalPass();
    final.shaftsPass = shafts;

    const composer = new EffectComposer(renderer);
    composer.addPass(scenePass);
    composer.addPass(shafts);
    composer.addPass(atmos);
    composer.addPass(bloom);
    composer.addPass(final);

    const size = new THREE.Vector2();
    function resize() {
      renderer.getSize(size);
      bloom.scale = cfg.effectScale;
      shafts.divisor = cfg.shaftDiv / cfg.effectScale;
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(Math.max(1, size.x), Math.max(1, size.y));
    }
    function applyQuality() {
      cfg = postConfig(state.settings?.quality || 'medium');
      scenePass.setSamples(samples());
      resize();
    }
    applyQuality();
    bus.on('resize', resize);
    bus.on('settings', ({ key }) => { if (key === 'quality') applyQuality(); });

    // Tools: keep the image crisp while looking through binoculars or the camera.
    let sharpTarget = 0, sharp = 0;
    bus.on('tool', (t) => { sharpTarget = t?.raised && (t.active === 'binoculars' || t.active === 'camera') ? 1 : 0; });

    // Cloud-shadow drift (integrated wind).
    const cloudOffset = new THREE.Vector2(0, 0);
    const sunPoint = new THREE.Vector3();
    const camFwd = new THREE.Vector3();
    const NO_ATMOS = { aerialAmt: 0, mistAmt: 0, inscatterAmt: 0, curtain: 0, wet: 0, daylight: 1, golden: 0, night: 0 };

    function update(dt) {
      const a = ctx.sky?.atmosphere || NO_ATMOS;
      const env = ctx.sky?.env || {};
      sharp += (sharpTarget - sharp) * Math.min(1, dt > 0 ? dt * 8 : 1);
      if (sharpTarget && dt === 0) sharp = sharpTarget;

      // Atmosphere uniforms.
      const u = atmos.u;
      if (a.aerial) {
        u.uAerial.value.copy(a.aerial);
        u.uMist.value.copy(a.mist);
        u.uInscatter.value.copy(a.inscatter);
        u.uCurtainColor.value.copy(a.curtainColor);
        u.uSunDir.value.copy(a.sunDir);
      }
      u.uAerialAmt.value = a.aerialAmt;
      u.uAerialK.value = 1.15 / Math.max(50, a.fogFar || 400);
      u.uAerialH.value = a.aerialHeight || 200;
      u.uMistAmt.value = a.mistAmt;
      u.uMistH.value = a.mistHeight || 6;
      u.uMistLevel.value = a.mistLevel || 0;
      u.uInscatterAmt.value = a.inscatterAmt;
      u.uFogFar.value = a.fogFar || 400;
      u.uCurtain.value = a.curtain;
      u.uWet.value = clamp(a.wet || 0);
      const cover = clamp(env.cloud ?? 0);
      u.uCloudCover.value = 0.1 + cover * 0.75;
      u.uCloudShadow.value = 0.2 * clamp(a.sunVisible ?? 0) * clamp(a.daylight * 2) * (1 - clamp(a.rain || 0));
      const wind = env.wind ?? 0.3;
      cloudOffset.x += dt * (2.5 + wind * 14) * 0.8 / 520;
      cloudOffset.y -= dt * (2.5 + wind * 14) * 0.6 / 520;
      u.uCloudOffset.value.copy(cloudOffset);
      u.uTime.value = ctx.time % 1000;

      // Grade, bloom, vignette.
      const g = gradeParams({
        daylight: a.daylight, golden: a.golden, night: a.night, rain: a.rain, wet: a.wet,
        mist: a.mistEnv, cold: a.cold, warm: a.warm,
      });
      const f = final.u;
      f.uLift.value.set(g.lift[0], g.lift[1], g.lift[2]);
      f.uGamma.value.set(g.gamma[0], g.gamma[1], g.gamma[2]);
      f.uGain.value.set(g.gain[0], g.gain[1], g.gain[2]);
      f.uSat.value = g.saturation;
      f.uContrast.value = g.contrast;
      f.uVignette.value = g.vignette * (1 - sharp);
      f.uExposure.value = renderer.toneMappingExposure;
      bloom.strength = g.bloom.strength * (1 - sharp);
      bloom.radius = g.bloom.radius;
      bloom.threshold = g.bloom.threshold;
      bloom.enabled = bloom.strength > 0.005;

      // Shafts: project the sun onto the screen.
      let amt = 0;
      if (a.sunDir) {
        camera.getWorldDirection(camFwd);
        sunPoint.copy(a.sunDir).multiplyScalar(1000).add(camera.position);
        const behind = camFwd.dot(a.sunDir) <= 0.05;
        sunPoint.project(camera);
        const fade = sunScreenFade(sunPoint.x, sunPoint.y, behind);
        amt = fade * shaftStrength({
          sunVisible: a.sunVisible, golden: a.golden, mist: Math.max(a.mistEnv || 0, a.mistAmt * 0.5),
          canopy: ctx.sky?.canopy ?? 0, daylight: a.daylight,
        }) * (1 - 0.6 * sharp);
        shafts.setSun(a.sunDir, sunPoint.x * 0.5 + 0.5, sunPoint.y * 0.5 + 0.5);
      }
      shafts.active = amt > 0.01;
      f.uShaftAmt.value = amt * 0.9;
      if (a.sunColor) f.uShaftColor.value.copy(a.sunColor);
    }

    let enabled = cfg.enabled;
    ctx.post = {
      /** Renders the frame to the canvas (also used for photographs). */
      render(dt = 0) {
        renderer.info.reset();
        enabled = cfg.enabled;
        if (!enabled) { renderer.render(scene, camera); return; }
        camera.updateMatrixWorld();
        update(dt);
        composer.render(dt);
      },
      /** True when the effect pipeline runs (quality medium/high). */
      get enabled() { return enabled; },
      /** The EffectComposer (for debugging / extra passes). */
      get composer() { return composer; },
      /** The multisampled HDR scene target with its depth texture (read-only use). */
      get sceneTarget() { return scenePass.target; },
      /** 0..1: how far bloom/vignette are suppressed for a raised optical tool. */
      get sharp() { return sharp; },
    };
  },
};
