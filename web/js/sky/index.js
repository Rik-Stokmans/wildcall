// ctx.sky — the sky and everything lighting/atmosphere: gradient dome with sun, moon
// and stars, drifting clouds, scene fog matched to weather and view distance,
// hemisphere + directional light following the sun (soft shadows on 'high'),
// rain / snow / leaf particles and per-region atmosphere. Driven by the 1 Hz 'env'
// events, interpolated every frame (see skymath.js for the maths).
import * as THREE from 'three';
import {
  EnvInterp, skyColors, sunPosition, moonPosition, moonPhase, fogRange, viewDistance,
  regionAtmosphere, mixAtmosphere, particleAmounts, mix3, clamp, REGION,
} from './skymath.js';
import { createDome } from './dome.js';
import { createClouds } from './clouds.js';
import { createPrecip } from './precip.js';

const WHITE = new THREE.Color(0xffffff);

const WIND_DIR = [0.8, -0.6]; // prevailing wind towards the north-east (x east, z south)
const SHADOW_SPAN = 70;       // metres either side of the player covered by the shadow map
const SHADOW_MAP = 2048;

const setSRGB = (color, c) => color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

export default {
  name: 'sky',

  init(ctx) {
    const { scene, renderer, camera, state, bus } = ctx;
    const env = new EnvInterp();
    if (state.env) env.set(state.env);

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
    const fill = new THREE.AmbientLight(0xffffff, 0.5);
    fill.name = 'sky-fill';
    scene.add(fill);
    const dir = new THREE.DirectionalLight(0xffffff, 2);
    dir.name = 'sky-sun';
    dir.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sc = dir.shadow.camera;
    sc.left = -SHADOW_SPAN; sc.right = SHADOW_SPAN; sc.top = SHADOW_SPAN; sc.bottom = -SHADOW_SPAN;
    sc.near = 1; sc.far = 600;
    dir.shadow.bias = -0.0004;
    dir.shadow.normalBias = 0.35;
    dir.shadow.radius = 3;
    scene.add(dir);
    scene.add(dir.target);

    const fog = new THREE.Fog(0xbfd0d8, 100, 400);
    scene.fog = fog;
    const background = new THREE.Color(0xbfd0d8);
    scene.background = background;

    // --- public state ----------------------------------------------------
    const sunDir = new THREE.Vector3(0, 1, 0);
    const moonDir = new THREE.Vector3(0, -1, 0);
    const fogColor = new THREE.Color(0xbfd0d8);
    let daylightNow = 0.5;
    let quality = state.settings?.quality || 'medium';
    let shadowsOn = false;

    // Region atmosphere eases between region types as the player crosses borders.
    const atmoTarget = { id: REGION.GREENHOLLOW };
    const atmo = mixAtmosphere(regionAtmosphere(REGION.GREENHOLLOW), regionAtmosphere(REGION.GREENHOLLOW), 0);
    let canopy = 0;
    let regionTimer = 0;

    function applyQuality() {
      quality = state.settings?.quality || 'medium';
      const want = quality === 'high';
      precip.setQuality(quality);
      if (want === shadowsOn) return;
      shadowsOn = want;
      renderer.shadowMap.enabled = want;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      dir.castShadow = want;
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

    const tmpA = [0, 0, 0], tmpB = [0, 0, 0], tmpC = [0, 0, 0];
    const particles = { rain: 0, snow: 0, leaves: 0, wind: 0, windDir: WIND_DIR, light: 1, leafA: [1, 1, 1], leafB: [1, 1, 1] };

    function sample(dt) {
      const cam = camera.position;
      // Region and canopy at the player, sampled a few times a second.
      regionTimer -= dt;
      if (regionTimer <= 0) {
        regionTimer = 0.25;
        const r = ctx.world?.regionAt?.(cam.x, cam.z);
        if (Number.isFinite(r) && r !== 255 && r !== REGION.NONE) atmoTarget.id = r;
        const c = ctx.world?.canopyAt?.(cam.x, cam.z);
        if (Number.isFinite(c)) canopy = clamp(c);
      }
      mixAtmosphere(atmo, regionAtmosphere(atmoTarget.id), Math.min(1, dt * 0.35), atmo);
    }

    ctx.sky = {
      /** Unit vector pointing at the sun (below the horizon at night). Live object: copy it. */
      get sunDir() { return sunDir; },
      /** Unit vector pointing at the moon. Live object: copy it. */
      get moonDir() { return moonDir; },
      /** 0 deep night … 1 bright midday, including cloud dimming. */
      get daylight() { return daylightNow; },
      /** Current fog / horizon colour (linear THREE.Color). Live object: copy it. */
      get fogColor() { return fogColor; },
      /** Interpolated env (time, day, season, weather, wind, rain, mist, cloud, light). */
      get env() { return env.cur; },
      /** Fraction of tree canopy above the player (0..1), as last sampled. */
      get canopy() { return canopy; },
    };

    this._frame = (dt) => {
      const e = env.step(dt);
      sample(dt);
      const cam = camera.position;
      const sky = skyColors({ hour: e.time, season: e.season, cloud: e.cloud, rain: e.rain, mist: e.mist, atmo });
      const sun = sunPosition(e.time, e.season);
      const moon = moonPosition(e.time, e.season);
      sunDir.set(sun.dir[0], sun.dir[1], sun.dir[2]);
      moonDir.set(moon.dir[0], moon.dir[1], moon.dir[2]);
      daylightNow = sky.daylight;

      // Dome.
      const u = dome.uniforms;
      setSRGB(u.uZenith.value, sky.zenith);
      setSRGB(u.uHorizon.value, sky.horizon);
      setSRGB(u.uFog.value, sky.fog);
      setSRGB(u.uGround.value, sky.ground);
      setSRGB(u.uSunColor.value, sky.sun);
      setSRGB(u.uGlow.value, sky.glow);
      u.uSunDir.value.copy(sunDir);
      u.uMoonDir.value.copy(moonDir);
      const clear = 1 - clamp(e.cloud * 0.9 + e.rain * 0.4);
      u.uSunVis.value = clamp(0.25 + 0.75 * clear);
      u.uMoonVis.value = clamp(0.3 + 0.7 * clear) * clamp(sky.stars * 1.4 + 0.15) * (moon.elevation > -0.05 ? 1 : 0);
      u.uMoonPhase.value = moonPhase(e.day);
      u.uStars.value = sky.stars;
      u.uTime.value = ctx.time % 1000;
      u.uHaze.value = clamp(e.mist + atmo.hazeAmt);
      dome.mesh.position.copy(cam);

      // Fog — terrain melts into the horizon colour at the view edge.
      const vd = Math.min(viewDistance(quality), camera.far * 0.9);
      const f = fogRange(vd, { mist: e.mist, rain: e.rain, cloud: e.cloud, regionFog: atmo.fog });
      fog.near = f.near; fog.far = f.far;
      setSRGB(fogColor, sky.fog);
      fog.color.copy(fogColor);
      background.copy(fogColor);

      // Lights.
      setSRGB(hemi.color, sky.hemiSky);
      setSRGB(hemi.groundColor, sky.hemiGround);
      hemi.intensity = sky.hemiIntensity;
      fill.color.copy(hemi.color).lerp(WHITE, 0.5);
      fill.intensity = 0.32 + 0.3 * sky.daylight;
      const useSun = sky.sunIntensity >= sky.moonIntensity;
      if (useSun) {
        setSRGB(dir.color, sky.sun);
        dir.intensity = sky.sunIntensity;
        tmpA[0] = sunDir.x; tmpA[1] = Math.max(0.06, sunDir.y); tmpA[2] = sunDir.z;
      } else {
        setSRGB(dir.color, sky.moonLight);
        dir.intensity = sky.moonIntensity;
        tmpA[0] = moonDir.x; tmpA[1] = Math.max(0.1, moonDir.y); tmpA[2] = moonDir.z;
      }
      const len = Math.hypot(tmpA[0], tmpA[1], tmpA[2]) || 1;
      // Snap the shadow centre to whole shadow-map texels so shadows do not shimmer.
      const texel = (SHADOW_SPAN * 2) / SHADOW_MAP;
      const px = Math.round(cam.x / texel) * texel, pz = Math.round(cam.z / texel) * texel;
      dir.target.position.set(px, cam.y, pz);
      dir.position.set(px + (tmpA[0] / len) * 250, cam.y + (tmpA[1] / len) * 250, pz + (tmpA[2] / len) * 250);
      // castShadow stays constant: toggling it would recompile every material.
      renderer.toneMappingExposure = sky.exposure;

      // Clouds: sunlit tops tinted by the sun, shaded undersides from the sky.
      const day = sky.daylight;
      mix3(sky.zenith, [1, 1, 1], 0.55 * clamp(day * 1.5), tmpB);
      mix3(tmpB, sky.sun, 0.35 * clamp(day * 2), tmpB);
      mix3(tmpB, sky.horizon, 0.2 + 0.4 * e.cloud, tmpB);
      mix3(sky.zenith, sky.horizon, 0.5, tmpC);
      for (let i = 0; i < 3; i++) tmpC[i] *= 0.62 + 0.18 * day - 0.12 * e.rain;
      clouds.setLook(tmpB, tmpC, sky.fog, sunDir, 0.78 + 0.2 * e.cloud);
      clouds.update(dt, cam, e.cloud, e.wind);

      // Particles.
      const pa = particleAmounts({ rain: e.rain, cloud: e.cloud, wind: e.wind, season: e.season, canopy, atmo });
      particles.rain = pa.rain; particles.snow = pa.snow; particles.leaves = pa.leaves;
      particles.wind = e.wind; particles.light = clamp(0.25 + day);
      particles.leafA = pa.leafA; particles.leafB = pa.leafB;
      precip.update(dt, ctx.time, cam, particles);
    };
    // First frame values before the loop starts (welcome → screenshot).
    this._frame(0.0001);
  },

  // Runs after the player has moved the camera, so everything centred on it is in sync.
  lateUpdate(dt) {
    this._frame?.(dt);
  },
};
