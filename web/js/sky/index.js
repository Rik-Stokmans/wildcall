// ctx.sky — the sky and everything lighting/atmosphere: gradient dome with sun, moon,
// stars and a milky band, big soft cumulus, scene fog matched to the horizon,
// hemisphere + fill + directional light following the sun (soft, camera-following
// shadow map on 'medium' and 'high'), rain / snow / leaves / motes / fireflies and
// per-region atmosphere. It also publishes the depth-atmosphere parameters (aerial
// perspective, low-ground mist, in-scattering, rain curtains) that the post module
// (web/js/fx) applies. Driven by the 1 Hz 'env' events, interpolated every frame (see
// skymath.js for the maths).
import * as THREE from 'three';
import {
  EnvInterp, skyColors, sunPosition, moonPosition, moonPhase, fogRange, viewDistance, nearDistance,
  regionAtmosphere, mixAtmosphere, particleAmounts, atmosphereParams, mistLevel,
  snapShadowCenter, shadowConfig, mix3, clamp, smoothstep, rgb, REGION,
} from './skymath.js';
import { createDome } from './dome.js';
import { createClouds } from './clouds.js';
import { createPrecip } from './precip.js';

const DEG = Math.PI / 180;
const WIND_DIR = [0.8, -0.6]; // prevailing wind towards the north-east (x east, z south)
const LIGHT_DIST = 300;       // how far up the light ray the shadow camera sits

const BELT = rgb(0xd8a2b4);
const STORM_LIT = rgb(0x9ea4ab);
const STORM_SHADE = rgb(0x5d636c);
const WHITE3 = [1, 1, 1];

const setSRGB = (color, c) => color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

export default {
  name: 'sky',

  init(ctx) {
    const { scene, renderer, camera, state, bus } = ctx;
    const env = new EnvInterp();
    if (state.env) env.set(state.env);
    let override = null; // dev/testing: forced env fields (ctx.sky.override)

    // --- scene objects ---------------------------------------------------
    const dome = createDome(Math.max(400, camera.far * 0.9));
    scene.add(dome.mesh);
    const clouds = createClouds();
    scene.add(clouds.mesh);
    const precip = createPrecip();
    scene.add(precip.group);

    const hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4a4a32, 1);
    hemi.name = 'sky-hemi';
    scene.add(hemi);
    // A flat fill so no face is ever black: the undersides of dense crowns only see
    // the (dim) ground half of the hemisphere light.
    const fill = new THREE.AmbientLight(0xffffff, 0.3);
    fill.name = 'sky-fill';
    scene.add(fill);
    const dir = new THREE.DirectionalLight(0xffffff, 2);
    dir.name = 'sky-sun';
    scene.add(dir);
    scene.add(dir.target);

    const fog = new THREE.Fog(0xbfd0d8, 100, 400);
    scene.fog = fog;
    const background = new THREE.Color(0xbfd0d8);
    scene.background = background;

    // --- public state ----------------------------------------------------
    const sunDir = new THREE.Vector3(0, 1, 0);
    const moonDir = new THREE.Vector3(0, -1, 0);
    const lightDir = new THREE.Vector3(0, 1, 0);
    const fogColor = new THREE.Color(0xbfd0d8);
    const zenithColor = new THREE.Color(0x6f9fc8);
    let daylightNow = 0.5;
    let goldenNow = 0;
    let quality = state.settings?.quality || 'medium';
    let shadow = shadowConfig('low');
    let shadowsOn = false;

    // Depth-atmosphere parameters for the post pass (linear colours).
    const atmosphere = {
      aerial: new THREE.Color(), aerialAmt: 0, aerialHeight: 200,
      mist: new THREE.Color(), mistAmt: 0, mistHeight: 6, mistLevel: 0,
      inscatter: new THREE.Color(), inscatterAmt: 0,
      curtain: 0, curtainColor: new THREE.Color(),
      fogNear: 100, fogFar: 400, fogColor,
      sunDir, sunVisible: 1, sunColor: new THREE.Color(),
      daylight: 0.5, golden: 0, night: 0, rain: 0, wet: 0, mistEnv: 0, cold: 0, warm: 0,
      region: REGION.GREENHOLLOW, time: 0, windDir: WIND_DIR,
    };

    // Region atmosphere eases between region types as the player crosses borders.
    const atmoTarget = { id: REGION.GREENHOLLOW };
    const atmo = mixAtmosphere(regionAtmosphere(REGION.GREENHOLLOW), regionAtmosphere(REGION.GREENHOLLOW), 0);
    let canopy = 0;
    let regionTimer = 0;
    let mistTimer = 0;
    let mistLvl = 0;
    let mistLvlTarget = 0;
    let groundY = NaN;
    const heights = [];

    function applyQuality() {
      quality = state.settings?.quality || 'medium';
      shadow = shadowConfig(quality);
      precip.setQuality(quality);
      dir.shadow.mapSize.set(shadow.mapSize, shadow.mapSize);
      dir.shadow.radius = shadow.radius;
      const sc = dir.shadow.camera;
      sc.left = -shadow.span; sc.right = shadow.span; sc.top = shadow.span; sc.bottom = -shadow.span;
      sc.near = 1; sc.far = LIGHT_DIST * 2.2;
      sc.updateProjectionMatrix();
      // Depth bias in light depth units; normal bias about one and a half texels so
      // leaves and grass do not self-shadow into acne.
      const texel = (shadow.span * 2) / shadow.mapSize;
      dir.shadow.bias = -0.0003;
      dir.shadow.normalBias = texel * 1.6;
      if (dir.shadow.map) { dir.shadow.map.dispose(); dir.shadow.map = null; }
      if (shadow.enabled === shadowsOn) return;
      shadowsOn = shadow.enabled;
      renderer.shadowMap.enabled = shadowsOn;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap; // bilinear-filtered PCF: smooth, soft edges
      dir.castShadow = shadowsOn;
      // Programs are compiled with or without shadow support; force a recompile.
      scene.traverse((o) => {
        const m = o.material;
        if (!m) return;
        if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true; }); else m.needsUpdate = true;
      });
    }
    applyQuality();

    bus.on('env', (e) => env.set(e));
    bus.on('welcome', (w) => { if (w?.env) env.set(w.env); });
    bus.on('settings', ({ key }) => { if (key === 'quality') applyQuality(); });
    bus.on('region:enter', (d) => { if (Number.isFinite(d?.region)) atmoTarget.id = d.region; });

    function sample(dt) {
      const cam = camera.position;
      const w = ctx.world;
      // Region and canopy at the player, sampled a few times a second.
      regionTimer -= dt;
      if (regionTimer <= 0) {
        regionTimer = 0.25;
        const r = w?.regionAt?.(cam.x, cam.z);
        if (Number.isFinite(r) && r !== 255 && r !== REGION.NONE) atmoTarget.id = r;
        const c = w?.canopyAt?.(cam.x, cam.z);
        if (Number.isFinite(c)) canopy = clamp(c);
        const g = w?.isLoaded?.(cam.x, cam.z) ? w.heightAt(cam.x, cam.z) : NaN;
        groundY = Number.isFinite(g) ? g : NaN;
      }
      // Low-ground mist level from a ring of terrain samples, once a second.
      mistTimer -= dt;
      if (mistTimer <= 0 && w?.heightAt) {
        mistTimer = 1;
        heights.length = 0;
        for (const rad of [0, 40, 90, 160]) {
          const n = rad === 0 ? 1 : 10;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const x = cam.x + Math.cos(a) * rad, z = cam.z + Math.sin(a) * rad;
            if (!w.isLoaded || w.isLoaded(x, z)) heights.push(w.heightAt(x, z));
          }
        }
        if (heights.length) mistLvlTarget = mistLevel(heights);
        if (!Number.isFinite(mistLvl) || Math.abs(mistLvl - mistLvlTarget) > 60) mistLvl = mistLvlTarget;
      }
      mistLvl += (mistLvlTarget - mistLvl) * Math.min(1, dt * 0.5);
      mixAtmosphere(atmo, regionAtmosphere(atmoTarget.id), Math.min(1, dt * 0.35), atmo);
    }

    ctx.sky = {
      /** Unit vector pointing at the sun (below the horizon at night). Live object: copy it. */
      get sunDir() { return sunDir; },
      /** Unit vector pointing at the moon. Live object: copy it. */
      get moonDir() { return moonDir; },
      /** Unit vector towards the light that currently casts (sun by day, moon by night). */
      get lightDir() { return lightDir; },
      /** 0 deep night … 1 bright midday, including cloud dimming. */
      get daylight() { return daylightNow; },
      /** 0..1 golden-hour weight (low warm sun). */
      get golden() { return goldenNow; },
      /** Current fog / horizon colour (linear THREE.Color). Live object: copy it. */
      get fogColor() { return fogColor; },
      /** Current sky colour overhead (linear THREE.Color). Live object: copy it. */
      get zenithColor() { return zenithColor; },
      /** Interpolated env (time, day, season, weather, wind, rain, mist, cloud, light, wet),
       *  with any override applied (so the world's wet ground follows a forced rain). */
      get env() { return override ? forced : env.cur; },
      /** Fraction of tree canopy above the player (0..1), as last sampled. */
      get canopy() { return canopy; },
      /** Whether the sun shadow map is on (quality medium/high). */
      get shadows() { return shadowsOn; },
      /** Depth-atmosphere parameters for the post pass (live object; see fx). */
      get atmosphere() { return atmosphere; },
      /** The directional (sun/moon) light. */
      get light() { return dir; },
      /**
       * Development/testing: force env fields (e.g. {mist: 1} or {rain: 1, cloud: 1});
       * null clears. Forced fields replace the interpolated values every frame.
       */
      override(fields) { override = fields && typeof fields === 'object' ? { ...fields } : null; },
    };

    const tmpA = [0, 0, 0], lit3 = [0, 0, 0], shade3 = [0, 0, 0], rim3 = [0, 0, 0], belt3 = [0, 0, 0];
    const center3 = [0, 0, 0], snapped3 = [0, 0, 0];
    const forced = {};
    const particles = {
      rain: 0, snow: 0, leaves: 0, wind: 0, windDir: WIND_DIR, light: 1, leafA: [1, 1, 1], leafB: [1, 1, 1],
      motes: 0, fireflies: 0, sunDir, sunColor: [1, 1, 1], ground: NaN,
    };

    this._frame = (dt) => {
      let e = env.step(dt);
      if (override) { Object.assign(forced, e, override); e = forced; }
      sample(dt);
      camera.updateMatrixWorld();
      const cam = camera.position;
      const sky = skyColors({ hour: e.time, season: e.season, cloud: e.cloud, rain: e.rain, mist: e.mist, atmo });
      const sun = sunPosition(e.time, e.season);
      const moon = moonPosition(e.time, e.season);
      sunDir.set(sun.dir[0], sun.dir[1], sun.dir[2]);
      moonDir.set(moon.dir[0], moon.dir[1], moon.dir[2]);
      daylightNow = sky.daylight;
      goldenNow = sky.golden;
      const eDeg = sun.elevation / DEG;
      const twilight = smoothstep(-9, -1, eDeg) * (1 - smoothstep(3, 12, eDeg));

      // Dome.
      const u = dome.uniforms;
      setSRGB(u.uZenith.value, sky.zenith);
      setSRGB(zenithColor, sky.zenith);
      setSRGB(u.uHorizon.value, sky.horizon);
      setSRGB(u.uFog.value, sky.fog);
      setSRGB(u.uGround.value, sky.ground);
      setSRGB(u.uSunColor.value, sky.sun);
      setSRGB(u.uGlow.value, sky.glow);
      mix3(BELT, sky.horizon, 0.35 + 0.5 * clamp(e.cloud), belt3);
      setSRGB(u.uBelt.value, belt3);
      u.uSunDir.value.copy(sunDir);
      u.uMoonDir.value.copy(moonDir);
      const clear = 1 - clamp(e.cloud * 0.9 + e.rain * 0.4);
      u.uSunVis.value = clamp(0.2 + 0.8 * clear);
      u.uMoonVis.value = clamp(0.3 + 0.7 * clear) * clamp(sky.stars * 1.4 + 0.15) * (moon.elevation > -0.05 ? 1 : 0);
      u.uMoonPhase.value = moonPhase(e.day);
      u.uStars.value = sky.stars;
      u.uTime.value = ctx.time % 1000;
      u.uHaze.value = clamp(e.mist + atmo.hazeAmt);
      u.uGolden.value = sky.golden * clear;
      u.uTwilight.value = twilight * clear;
      dome.mesh.position.copy(cam);

      // Fog — terrain melts into the horizon colour at the view edge.
      const vd = Math.min(viewDistance(quality), camera.far * 0.9);
      const fogOpts = { mist: e.mist, rain: e.rain, cloud: e.cloud, regionFog: atmo.fog };
      const f = fogRange(vd, fogOpts);
      // The aerial perspective keeps the density it has over the detailed ring; the far
      // terrain beyond it just sinks deeper into the haze.
      const fNear = fogRange(Math.min(nearDistance(quality), vd), fogOpts);
      fog.near = f.near; fog.far = f.far;
      setSRGB(fogColor, sky.fog);
      fog.color.copy(fogColor);
      background.copy(fogColor);

      // Lights.
      setSRGB(hemi.color, sky.hemiSky);
      setSRGB(hemi.groundColor, sky.hemiGround);
      hemi.intensity = sky.hemiIntensity;
      setSRGB(fill.color, sky.fillColor);
      fill.intensity = sky.fillIntensity;
      const useSun = sky.sunIntensity >= sky.moonIntensity;
      if (useSun) {
        setSRGB(dir.color, sky.sun);
        dir.intensity = sky.sunIntensity;
        // Keep a minimum elevation so shadows never stretch to infinity at sunrise.
        tmpA[0] = sunDir.x; tmpA[1] = Math.max(0.07, sunDir.y); tmpA[2] = sunDir.z;
      } else {
        setSRGB(dir.color, sky.moonLight);
        dir.intensity = sky.moonIntensity;
        tmpA[0] = moonDir.x; tmpA[1] = Math.max(0.12, moonDir.y); tmpA[2] = moonDir.z;
      }
      const len = Math.hypot(tmpA[0], tmpA[1], tmpA[2]) || 1;
      tmpA[0] /= len; tmpA[1] /= len; tmpA[2] /= len;
      lightDir.set(tmpA[0], tmpA[1], tmpA[2]);
      // Fit the shadow map around what the player looks at: centre it a little ahead
      // of the camera (horizontally), then snap to whole texels in light space.
      const me = camera.matrixWorld.elements;
      let fx = -me[8], fz = -me[10];
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl; fz /= fl;
      const ahead = shadow.span * 0.45;
      center3[0] = cam.x + fx * ahead; center3[1] = Number.isFinite(groundY) ? groundY : cam.y - 1.6; center3[2] = cam.z + fz * ahead;
      snapShadowCenter(center3, tmpA, (shadow.span * 2) / shadow.mapSize, snapped3);
      dir.target.position.set(snapped3[0], snapped3[1], snapped3[2]);
      dir.position.set(snapped3[0] + tmpA[0] * LIGHT_DIST, snapped3[1] + tmpA[1] * LIGHT_DIST, snapped3[2] + tmpA[2] * LIGHT_DIST);
      dir.target.updateMatrixWorld();
      // castShadow stays constant: toggling it would recompile every material.
      renderer.toneMappingExposure = sky.exposure;

      // Clouds: sunlit tops tinted by the sun (orange-pink at golden hour), shaded
      // bases from the sky; moonlit silver-grey at night; rain darkens them.
      const day = sky.daylight;
      const dayish = smoothstep(0, 0.35, day);
      mix3(WHITE3, sky.sun, 0.25 + 0.55 * sky.golden, lit3);
      mix3(lit3, sky.glow, 0.25 * sky.golden, lit3);
      mix3(mix3(sky.moonLight, sky.zenith, 0.5, tmpA), lit3, dayish, lit3);
      if (!dayish) for (let i = 0; i < 3; i++) lit3[i] *= 0.45;
      else for (let i = 0; i < 3; i++) lit3[i] *= 0.45 + 0.55 * dayish;
      mix3(sky.zenith, sky.horizon, 0.55, shade3);
      mix3(shade3, [0.55, 0.6, 0.72], 0.35 * dayish, shade3);
      for (let i = 0; i < 3; i++) shade3[i] *= 0.55 + 0.25 * dayish;
      const storm = clamp(e.rain * 0.9 + Math.max(0, e.cloud - 0.6) * 0.8);
      mix3(lit3, mix3(STORM_LIT, sky.fog, 0.3, tmpA), storm * 0.8, lit3);
      mix3(shade3, mix3(STORM_SHADE, sky.zenith, 0.25, tmpA), storm, shade3);
      if (!dayish) { for (let i = 0; i < 3; i++) shade3[i] *= 0.8; }
      mix3(sky.glow, WHITE3, 0.2, rim3);
      for (let i = 0; i < 3; i++) rim3[i] *= (0.5 + 0.9 * sky.golden) * (1 - storm) * smoothstep(-2 * DEG, 3 * DEG, sun.elevation);
      clouds.setLook(lit3, shade3, rim3, sky.fog, sunDir);
      clouds.update(dt, camera, e, ctx.time);

      // Particles.
      const pa = particleAmounts({ rain: e.rain, cloud: e.cloud, wind: e.wind, season: e.season, canopy, atmo, hour: e.time });
      particles.rain = pa.rain; particles.snow = pa.snow; particles.leaves = pa.leaves;
      particles.wind = e.wind; particles.light = clamp(0.25 + day);
      particles.leafA = pa.leafA; particles.leafB = pa.leafB;
      particles.motes = pa.motes * (quality === 'low' ? 0.5 : 1);
      particles.fireflies = pa.fireflies;
      particles.sunColor = sky.sun;
      particles.ground = groundY;
      precip.update(dt, ctx.time, cam, particles);

      // Atmosphere for the post pass.
      const ap = atmosphereParams({ sky, mist: e.mist, rain: e.rain, wet: e.wet, cloud: e.cloud, atmo, fogFar: f.far });
      setSRGB(atmosphere.aerial, ap.aerial);
      atmosphere.aerialAmt = ap.aerialAmt;
      atmosphere.aerialHeight = ap.aerialHeight;
      setSRGB(atmosphere.mist, ap.mist);
      atmosphere.mistAmt = ap.mistAmt;
      atmosphere.mistHeight = ap.mistHeight;
      atmosphere.mistLevel = mistLvl;
      setSRGB(atmosphere.inscatter, ap.inscatter);
      atmosphere.inscatterAmt = ap.inscatterAmt;
      atmosphere.curtain = ap.curtain;
      setSRGB(atmosphere.curtainColor, ap.curtainColor);
      atmosphere.fogNear = f.near;
      atmosphere.fogFar = f.far;
      atmosphere.aerialFar = fNear.far;
      atmosphere.sunVisible = u.uSunVis.value * smoothstep(-3 * DEG, 2 * DEG, sun.elevation);
      setSRGB(atmosphere.sunColor, sky.sun);
      atmosphere.daylight = day;
      atmosphere.golden = sky.golden;
      atmosphere.night = 1 - smoothstep(0, 0.3, day);
      atmosphere.rain = e.rain;
      atmosphere.wet = Math.max(e.rain, e.wet || 0);
      atmosphere.mistEnv = e.mist;
      atmosphere.cold = atmo.cold;
      atmosphere.cloudShadow = atmo.cloudShadow ?? 0.2;
      atmosphere.cloudSpeed = atmo.cloudSpeed ?? 1;
      atmosphere.warm = clamp(atmo.tintAmt * (atmo.sunTint[0] - atmo.sunTint[2]) * 6);
      atmosphere.region = atmoTarget.id;
      atmosphere.time = e.time;
    };
    // First frame values before the loop starts (welcome → screenshot).
    this._frame(0.0001);
  },

  // Runs after the player has moved the camera, so everything centred on it is in sync.
  lateUpdate(dt) {
    this._frame?.(dt);
  },
};
