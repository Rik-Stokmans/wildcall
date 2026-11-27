// ctx.world (contract §5.2): streams the unbounded, seed-generated world around the
// player — terrain chunks in LOD rings, instanced vegetation with wind and seasons,
// the water plane — and answers ground queries for every other module.
//
// Files:
//   pipeline.js       chunk lifecycle (requests, arrivals, LOD changes, unloads, slicing)  [pure]
//   streamer.js       which chunks to want at which LOD, hysteresis, request ordering      [pure]
//   chunkCodec.js     binary chunk frames (contract §2.3)                                  [pure]
//   heightfield.js    loaded chunks as a queryable height/region/habitat field             [pure]
//   collision.js      trunks, rocks, blockers, canopy cover                                [pure]
//   terrainMesh.js / instances.js / vegModels.js / meshgen.js / season.js / shore.js       [pure]
//   chunkRenderer.js  terrain meshes + per-chunk vegetation, swapped atomically            [three]
//   vegetation.js     shared vegetation geometry and the wind/season foliage material      [three]
//   water.js          the y = 0 water surface                                               [three]
//   groundField.js    what grows where; the ground-cover lattice and its rings              [pure]
//   groundCover.js    GPU grass, wildflowers and ferns around the camera                    [three]
//   terrainMaterial.js the terrain shader (painterly detail, litter, shade)                [three]
import * as THREE from 'three';
import { CHUNK_SIZE, SEA_LEVEL, qualityOf } from './constants.js';
import { WorldPipeline } from './pipeline.js';
import { vegList } from './chunkCodec.js';
import { createVegetationKit } from './vegetation.js';
import { createChunkRenderer } from './chunkRenderer.js';
import { defaultTerrainUniforms } from './terrainMaterial.js';
import { TREE_RIM } from './trees/treeMaterials.js';
import { createWater } from './water.js';
import { createGroundCover } from './groundCover.js';
import { createFarTerrain } from './farTerrain.js';
import { collectFrameStats, formatStats } from './debugStats.js';
import { collectGaps, mowField } from './groundField.js';
import { isAirborneAct } from '../birds/constants.js';

/** Meshing budget per frame while the game waits for the world (ms). */
const BOOT_BUILD_MS = 12;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export default {
  name: 'world',

  init(ctx) {
    const { scene, bus, net, state } = ctx;
    let quality = qualityOf(state.settings?.quality);

    const root = new THREE.Group();
    root.name = 'world';
    scene.add(root);

    const vegKit = createVegetationKit();
    // c-trees: every tree and shrub is instanced across chunks under this one group.
    root.add(vegKit.trees);
    // Performance pass: trees pick their detail by distance (bands per quality), and
    // shadows come from caster sets fitted to the sun's shadow map.
    vegKit.forest.setQuality(state.settings?.quality || 'medium');
    vegKit.forest.setCamera(ctx.camera);
    vegKit.forest.setBaseFov(() => state.settings?.fov || 70);
    vegKit.setDecorRange(quality.decorFade[0], quality.decorFade[1]);
    vegKit.forest.setShadowLight(() => (ctx.sky?.shadows ? ctx.sky.light : null));
    // Uniforms the terrain shader and the ground cover share (season tint, time, wind).
    // (Sun and sky are shared too: the terrain mirrors the sky in pools, wet sand and ice.)
    const groundUniforms = defaultTerrainUniforms();
    let pipeline = null;
    const canopyAt = (x, z) => (pipeline ? pipeline.collision.canopyAt(x, z) : 0);
    const regionAt = (x, z) => (pipeline ? pipeline.store.regionAt(x, z) : 255);
    const renderer = createChunkRenderer(root, vegKit, () => quality, { canopyAt, regionAt, uniforms: groundUniforms });
    const water = createWater(scene);

    let readyEmitted = false;
    let started = false;
    let seed = null;
    let fallbackLights = null;
    let errorsLogged = 0;
    let loopRunning = false;

    pipeline = new WorldPipeline({
      request: (cx, cz, lod) => net.send('chunkReq', { cx, cz, lod }),
      mesher: renderer,
      quality,
      onChunk: (cx, cz, lod) => bus.emit('world:chunk', { cx, cz, lod }),
      onError: (err) => {
        // A bad frame costs one chunk, never the module; do not flood the console.
        if (errorsLogged++ < 5) console.warn('[world]', err?.message || err);
      },
    });
    const store = pipeline.store;
    const collision = pipeline.collision;
    // Low-detail terrain beyond the ring, so long views end in haze, not at an edge.
    const far = createFarTerrain(root, renderer.terrainMaterial, {
      request: (cx, cz) => net.send('chunkReq', { cx, cz, lod: 2 }),
      store,
    });
    far.setQuality(state.settings?.quality || 'medium', quality.radius);
    water.setRadius(Math.max(quality.radius, far.radius));
    const ground = createGroundCover(root, { store, canopyAt, quality: state.settings?.quality, uniforms: groundUniforms });
    ground.setShadows(quality.shadows);
    // The grass parts around ground birds (the server knows nothing of client grass:
    // a bird it reports as visible must be visible), ground nests and the player's feet.
    const nestList = () => { const l = ctx.nests?.list; return Array.isArray(l) ? l : null; };
    const gapHeight = (x, z) => store.heightAt(x, z);
    ground.setGapSource((out, cam, outY) => collectGaps(
      out, cam, ctx.birds?.list?.() || null, isAirborneAct, gapHeight, nestList(), ctx.player?.feet || null, outY,
      ctx.player?.sightLane || null, // prone: a low sight lane through the grass ahead
    ));
    // Short turf around the cabin and other buildings.
    bus.on('pois', () => ground.setMow(mowField(Object.values(state.pois || {}))));

    // --- player tracking -----------------------------------------------------------
    const spawn = { x: 0, z: 0 };
    const last = { x: NaN, z: NaN };
    const vel = { x: 0, z: 0 };

    function playerFeet() {
      const p = ctx.player?.feet || ctx.player?.pos;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) return p;
      return spawn;
    }

    // --- lifecycle ------------------------------------------------------------------
    function start(welcome) {
      const pos = welcome?.spawn?.pos;
      spawn.x = Number.isFinite(pos?.x) ? pos.x : 0;
      spawn.z = Number.isFinite(pos?.z) ? pos.z : 0;
      seed = welcome?.seed ?? welcome?.world?.seed ?? null;
      last.x = NaN; last.z = NaN; vel.x = 0; vel.z = 0;
      readyEmitted = false;
      pipeline.watchReady(spawn.x, spawn.z);
      started = true;
      // c-trees: the server's branching tree models (contract §11), before any chunk is built.
      vegKit.setTreeModels(welcome?.trees);
      vegKit.snapSeason(state.env?.season ?? welcome?.env?.season ?? 0);
      ensureLighting();
      startBootPump();
    }

    // main.js waits for 'world:ready' before it starts the frame loop, so until the
    // loop calls update() the world drives itself (with a larger meshing budget: there
    // is nothing else to draw yet).
    let bootPumping = false;
    function startBootPump() {
      if (bootPumping || loopRunning) return;
      bootPumping = true;
      const schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => setTimeout(() => fn(now()), 16);
      let prev = now();
      const pump = (t) => {
        if (loopRunning) { bootPumping = false; return; }
        const dt = Math.min(0.1, Math.max(0, (t - prev) / 1000));
        prev = t;
        try { step(dt, BOOT_BUILD_MS); } catch (err) { console.error('[world] boot streaming failed', err); }
        schedule(pump);
      };
      schedule(pump);
    }

    // The sky module owns lights and fog. If it failed to load, the world must still be
    // visible: add a soft default rig (removed again should a sky appear later).
    function ensureLighting() {
      if (ctx.sky || fallbackLights) return;
      fallbackLights = new THREE.Group();
      fallbackLights.name = 'world-fallback-lights';
      fallbackLights.add(new THREE.HemisphereLight(0xdfeefa, 0x5d6b45, 1.6));
      const sun = new THREE.DirectionalLight(0xfff1d8, 1.6);
      sun.position.set(0.5, 1, 0.35);
      fallbackLights.add(sun);
      scene.add(fallbackLights);
      if (!scene.fog) scene.fog = new THREE.Fog(0xc9dde6, 140, (quality.radius + 0.5) * CHUNK_SIZE);
      if (!scene.background) scene.background = new THREE.Color(0xc9dde6);
    }

    bus.on('welcome', (w) => {
      if (started) { pipeline.reset(); ground.reset(); far.reset(); }
      start(w);
    });
    // A new adventure on the same connection (newGame) brings a new seed: new world.
    bus.on('net:welcome', (w) => {
      if (!started) return; // the first welcome is handled via 'welcome'
      const s = w?.seed ?? w?.world?.seed ?? null;
      if (s !== seed) { pipeline.reset(); ground.reset(); far.reset(); start(w); }
    });
    bus.on('net:chunk', (buf) => {
      if (!started) return;
      far.receive(buf);
      pipeline.receive(buf);
    });
    bus.on('net:close', () => pipeline.connectionLost());
    bus.on('settings', ({ key, value }) => {
      if (key !== 'quality') return;
      const next = qualityOf(value);
      if (next === quality) return;
      quality = next;
      pipeline.configure(quality);
      far.setQuality(value, quality.radius);
      water.setRadius(Math.max(quality.radius, far.radius));
      ground.setQuality(value);
      vegKit.forest.setQuality(value);
      vegKit.setDecorRange(quality.decorFade[0], quality.decorFade[1]);
      ground.setShadows(quality.shadows);
      if (fallbackLights && scene.fog?.isFog) scene.fog.far = (quality.radius + 0.5) * CHUNK_SIZE;
      // Decoration density and shadows are baked into the instanced meshes.
      pipeline.rebuildAll();
    });

    // --- the public API ---------------------------------------------------------------
    const hit = { x: 0, y: 0, z: 0 };
    /** VegData → its object list (built on first vegOf, dropped with the chunk). */
    const vegLists = new WeakMap();
    const api = {
      /** Metres per chunk side. */
      chunkSize: CHUNK_SIZE,
      /** Height of all standing water. */
      seaLevel: SEA_LEVEL,
      /** The group holding every chunk mesh. */
      root,
      /** True once the chunks around the spawn point are meshed at lod 0. */
      get ready() { return readyEmitted; },

      heightAt: (x, z) => store.heightAt(x, z),
      isLoaded: (x, z) => store.isLoaded(x, z),
      regionAt: (x, z) => store.regionAt(x, z),
      habitatAt: (x, z) => store.habitatAt(x, z),
      waterDepthAt: (x, z) => store.waterDepthAt(x, z),
      /** LOD of the loaded chunk at a point, or -1. */
      lodAt: (x, z) => store.chunkAt(x, z)?.lod ?? -1,

      surfaceAt(x, z) {
        return collision.patchAt(x, z) || store.surfaceAt(x, z);
      },

      collide(pos, radius = 0.35) {
        if (!pos) return false;
        return collision.collide(pos, radius);
      },
      addBlocker: (b) => collision.addBlocker(b),
      /** Registers a patch of ground with its own footstep surface ({x, z, r, surface}). */
      addSurfacePatch: (p) => collision.addSurfacePatch(p),
      canopyAt: (x, z) => collision.canopyAt(x, z),

      /**
       * Distance (m) from (x, z) to the nearest tree trunk, rock or building blocker
       * edge; Infinity if none within `maxDist` (default 30). Cheap (a few 8 m cells).
       */
      nearestTreeDistance: (x, z, maxDist = 30) => collision.nearestSolid(x, z, maxDist),

      /**
       * Whether a camera (a sphere of `radius`) can move in a straight line from `from`
       * to `to` ({x, y, z}, world metres) without passing through a trunk, rock, tree
       * crown or the ground. Returns {clear, t, x, y, z, hit}: t is the fraction of the
       * way to the first contact (1 when clear), (x, y, z) the last free point and hit
       * 'trunk' | 'crown' | 'ground' | null. Unloaded ground counts as clear.
       */
      clearPath(from, to, radius = 0.6) {
        const res = { clear: true, t: 1, x: to.x, y: to.y, z: to.z, hit: null };
        if (!from || !to) return res;
        const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
        const len = Math.hypot(dx, dz, dy);
        const above = (t) => {
          const x = from.x + dx * t, z = from.z + dz * t;
          return store.isLoaded(x, z) ? from.y + dy * t - store.heightAt(x, z) : 1e3;
        };
        let tHit = 2;
        // Ground: sample every metre.
        const n = Math.max(1, Math.ceil(len));
        for (let i = 1; i <= n; i++) {
          if (above(i / n) < radius) { tHit = (i - 1) / n; res.hit = 'ground'; break; }
        }
        const ts = collision.sweep(from.x, from.z, to.x, to.z, radius, above);
        if (ts >= 0 && ts < tHit) {
          tHit = ts;
          const x = from.x + dx * ts, z = from.z + dz * ts;
          res.hit = collision.nearestSolid(x, z, radius + 0.5) <= radius + 0.5 ? 'trunk' : 'crown';
        }
        if (tHit <= 1) {
          res.clear = false; res.t = tHit;
          res.x = from.x + dx * tHit; res.y = from.y + dy * tHit; res.z = from.z + dz * tHit;
        }
        return res;
      },

      /**
       * The lod-0 vegetation of a loaded chunk in wire order, as plain objects
       * {kind, variant, x, y, z, scale, rot} (world metres, rot in radians) — forage
       * plants (kind >= 18) included, which the world itself never draws. null if the
       * chunk is not loaded or was never received at lod 0. The array is cached per
       * chunk and shared: do not mutate it. Re-query on 'world:chunk'.
       */
      vegOf(cx, cz) {
        const veg = store.vegOf(cx, cz);
        if (!veg) return null;
        let list = vegLists.get(veg);
        if (!list) { list = vegList(veg); vegLists.set(veg, list); }
        return list;
      },

      raycastTerrain(origin, dir, maxDist = 500) {
        if (!origin || !dir) return null;
        return store.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, hit)
          ? new THREE.Vector3(hit.x, hit.y, hit.z)
          : null;
      },

      /**
       * Debug only (computed on demand, never per frame): renders one extra frame with
       * per-object counting and returns {total, byCategory, byGroup, text} — draw calls
       * and triangles per category (terrain, trees.<detail>.<part>, ground.<layer>.r<ring>,
       * water, forage, props, birds, …) in the main and the shadow pass; 'post' is the
       * rest of the frame (full-screen passes).
       */
      debugStats() {
        const frameNow = () => {
          if (ctx.post && typeof ctx.post.render === 'function') ctx.post.render(0);
          else { ctx.renderer.info.reset(); ctx.renderer.render(scene, ctx.camera); }
        };
        const s = collectFrameStats(ctx.renderer, scene, frameNow);
        s.text = formatStats(s);
        return s;
      },

      /** Streaming diagnostics. */
      get debug() {
        return {
          chunks: store.size,
          backlog: pipeline.backlog,
          inflight: pipeline.streamer.inflight.size,
          meshes: renderer.meshCount(),
          radius: quality.radius,
          gaps: ground.gaps,
          forest: vegKit.forest.stats,
          far: far.stats,
        };
      },
    };
    ctx.world = api;

    // --- per frame ------------------------------------------------------------------
    const look = { sunDir: null, light: 1, sky: null, skyHigh: null, wind: 0.3 };
    const groundEnv = { wind: 0.3, rain: 0, season: 0, sunDir: null, light: 1 };
    frame = (dt) => {
      loopRunning = true;
      step(dt, quality.buildMs);
    };
    const SKY_FALLBACK = new THREE.Color(0.72, 0.8, 0.86);
    function updateSkyUniforms(lk) {
      const u = groundUniforms;
      if (lk.sunDir) u.uSunDir.value.copy(lk.sunDir);
      const up = lk.sunDir ? Math.max(0, Math.min(1, lk.sunDir.y * 4 + 0.15)) : 1;
      const k = Math.min(1, Math.max(0, (lk.sunDir?.y ?? 0.5) * 3));
      u.uSunCol.value.setRGB(1.0, 0.72 + 0.24 * k, 0.48 + 0.4 * k).multiplyScalar(lk.light * up);
      u.uSkyCol.value.copy(lk.sky || SKY_FALLBACK);
      if (lk.skyHigh) u.uSkyHigh.value.copy(lk.skyHigh);
      else u.uSkyHigh.value.copy(u.uSkyCol.value).multiplyScalar(0.6);
      u.uLight.value = lk.light;
      // Moonlight catches the edges of the crowns: a stronger rim at night.
      const night = 1 - Math.min(1, Math.max(0, lk.light / 0.3));
      TREE_RIM.value = 0.12 + 0.75 * night;
    }
    function step(dt, buildMs) {
      vegKit.update(ctx.time, state.env?.wind ?? 0.3, state.env?.season ?? 0, dt);
      if (!started) return;
      if (fallbackLights && ctx.sky) { scene.remove(fallbackLights); fallbackLights = null; }

      const feet = playerFeet();
      if (last.x === last.x && dt > 0) {
        const dx = feet.x - last.x, dz = feet.z - last.z;
        if (dx * dx + dz * dz > 400) { vel.x = 0; vel.z = 0; } // a teleport, not a walk
        else {
          const k = 1 - Math.exp(-dt * 3);
          vel.x += (dx / dt - vel.x) * k;
          vel.z += (dz / dt - vel.z) * k;
        }
      }
      last.x = feet.x; last.z = feet.z;

      // Streaming runs on its own clock: ctx.time does not advance before the loop starts.
      pipeline.tick(feet.x, feet.z, vel.x, vel.z, now() / 1000);
      pipeline.work(buildMs, now);
      if (readyEmitted) far.update(dt, feet.x, feet.z, pipeline.streamer.inflight.size > 0 || pipeline.backlog > 2, now() / 1000);
      if (!readyEmitted && pipeline.readyNow()) {
        readyEmitted = true;
        bus.emit('world:ready');
      }

      look.sunDir = ctx.sky?.sunDir || null;
      const daylight = ctx.sky?.daylight;
      look.light = Number.isFinite(daylight) ? daylight : (state.env?.light ?? 1);
      look.sky = ctx.sky?.fogColor || scene.fog?.color || null;
      look.skyHigh = ctx.sky?.zenithColor || null;
      look.wind = state.env?.wind ?? 0.3;
      water.update(dt, ctx.time, feet.x, feet.z, store, look);
      updateSkyUniforms(look);
      groundEnv.wind = state.env?.wind ?? 0.3;
      groundEnv.rain = ctx.sky?.env?.rain ?? state.env?.rain ?? 0;
      groundEnv.season = state.env?.season ?? 0;
      groundEnv.sunDir = look.sunDir;
      groundEnv.light = look.light;
      const toolZoom = ctx.tools?.zoom;
      const fovZoom = ctx.camera?.fov ? (state.settings?.fov || 70) / ctx.camera.fov : 1;
      ground.setZoom(Math.max(Number.isFinite(toolZoom) ? toolZoom : 1, fovZoom));
      ground.update(dt, ctx.time, ctx.camera?.position || feet, groundEnv);
      vegKit.updateDecor(ctx.camera?.position || feet);
    }
  },

  update(dt) {
    frame(dt);
  },
};

/** Set by init(); a no-op until then so a failed init cannot break the frame loop. */
let frame = () => {};
