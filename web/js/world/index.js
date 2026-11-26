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
import * as THREE from 'three';
import { CHUNK_SIZE, SEA_LEVEL, qualityOf } from './constants.js';
import { WorldPipeline } from './pipeline.js';
import { createVegetationKit } from './vegetation.js';
import { createChunkRenderer } from './chunkRenderer.js';
import { createWater } from './water.js';

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
    const renderer = createChunkRenderer(root, vegKit, () => quality);
    const water = createWater(scene);
    water.setRadius(quality.radius);

    let readyEmitted = false;
    let started = false;
    let seed = null;
    let fallbackLights = null;
    let errorsLogged = 0;
    let loopRunning = false;

    const pipeline = new WorldPipeline({
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
      if (started) pipeline.reset();
      start(w);
    });
    // A new adventure on the same connection (newGame) brings a new seed: new world.
    bus.on('net:welcome', (w) => {
      if (!started) return; // the first welcome is handled via 'welcome'
      const s = w?.seed ?? w?.world?.seed ?? null;
      if (s !== seed) { pipeline.reset(); start(w); }
    });
    bus.on('net:chunk', (buf) => { if (started) pipeline.receive(buf); });
    bus.on('net:close', () => pipeline.connectionLost());
    bus.on('settings', ({ key, value }) => {
      if (key !== 'quality') return;
      const next = qualityOf(value);
      if (next === quality) return;
      quality = next;
      pipeline.configure(quality);
      water.setRadius(quality.radius);
      if (fallbackLights && scene.fog?.isFog) scene.fog.far = (quality.radius + 0.5) * CHUNK_SIZE;
      // Decoration density and shadows are baked into the instanced meshes.
      pipeline.rebuildAll();
    });

    // --- the public API ---------------------------------------------------------------
    const hit = { x: 0, y: 0, z: 0 };
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

      raycastTerrain(origin, dir, maxDist = 500) {
        if (!origin || !dir) return null;
        return store.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, hit)
          ? new THREE.Vector3(hit.x, hit.y, hit.z)
          : null;
      },

      /** Streaming diagnostics. */
      get debug() {
        return {
          chunks: store.size,
          backlog: pipeline.backlog,
          inflight: pipeline.streamer.inflight.size,
          meshes: renderer.meshCount(),
          radius: quality.radius,
        };
      },
    };
    ctx.world = api;

    // --- per frame ------------------------------------------------------------------
    const look = { sunDir: null, light: 1, sky: null };
    frame = (dt) => {
      loopRunning = true;
      step(dt, quality.buildMs);
    };
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
      if (!readyEmitted && pipeline.readyNow()) {
        readyEmitted = true;
        bus.emit('world:ready');
      }

      look.sunDir = ctx.sky?.sunDir || null;
      const daylight = ctx.sky?.daylight;
      look.light = Number.isFinite(daylight) ? daylight : (state.env?.light ?? 1);
      look.sky = ctx.sky?.fogColor || scene.fog?.color || null;
      water.update(dt, ctx.time, feet.x, feet.z, store, look);
    }
  },

  update(dt) {
    frame(dt);
  },
};

/** Set by init(); a no-op until then so a failed init cannot break the frame loop. */
let frame = () => {};
