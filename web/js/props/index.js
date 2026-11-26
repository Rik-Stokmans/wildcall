// ctx.props — every point of interest as stylised low-poly geometry: the Naturalist
// Cabin, Finn's stall, ranger stations, watchtowers, the field lab, hides, camps,
// ruins, ponds, viewpoints, landmarks, signposts, caches, collectibles, NPCs, seed
// lures and the garden feeder.
//
// The world is unbounded, so POIs stream: the welcome's list first, then every
// `net:pois` message (merged into ctx.state.pois / ctx.state.trails). Props are built
// within BUILD_DIST of the player in a per-frame time budget, nearest first, and
// dropped beyond DROP_DIST; they are rebuilt when the player comes back (the server
// re-sends them too). Each prop sits on the terrain via ctx.world.heightAt and is
// re-seated when a finer terrain chunk loads under it.
//
// API (contract §5.2):
//   interactables() → [{id, kind, pos: Vector3, radius, label, verb}]
//   npcPos(id)      → Vector3 | null   (NPC id 'mara' or POI id 'npc_mara'; feet)
//   platformHeightAt(x, z, y) → number | null
import * as THREE from 'three';
import {
  DROP_DIST, STEP_UP, mergePois, distXZ, streamAction, filterInteractables,
  interactRadius, paletteFor, rngFor, localToWorld, platformHeightAt, surfaceReach, isTaken,
  windowGlow, bob, glintAmount, feederSpot, applyLure, isFeederLure, hasGarden, seatSmall,
  overlapsChunk, hashString,
} from './logic.js';
import { Shape, materials, solidMesh, glowMesh } from './mesh.js';
import {
  buildCabin, buildRuinedCabin, buildAbandonedStation, buildShop, buildWatchtower,
  buildResearchSite, buildHide, buildCamp, buildViewpoint, buildPond,
} from './structures.js';
import { buildLandmark } from './landmarks.js';
import { buildSign, buildCache, buildCollectible, buildSeedLure, buildFeeder } from './small.js';
import { buildNPC } from './npc.js';
import { createSmoke, createGlint } from './fx.js';

const COLLECTIBLES = new Set(['feather', 'page', 'relic']);
// Small props keep their geometry when the terrain changes: only their height moves.
const SMALL = new Set(['npc', 'cache', 'feather', 'page', 'relic', 'sign', 'lure', 'feeder']);
const BUILD_BUDGET_MS = 3;
const ANIM_DIST = 90;      // NPCs and collectibles animate within this range
const SMOKE_DIST = 380;
const GLASS_DAY = new THREE.Color(0x2c3640);
const GLOW_NIGHT = new THREE.Color(0xffc477).multiplyScalar(1.6);

const STRUCTURE_BUILDERS = {
  cabin: (b) => buildCabin(b, { lit: true, smoke: true }),
  ranger_station: (b) => buildCabin(b, { ranger: true, lit: b.poi.id === 'ranger_station', smoke: b.poi.id === 'ranger_station' }),
  shop: buildShop,
  watchtower: buildWatchtower,
  research_site: buildResearchSite,
  hide: buildHide,
  camp: buildCamp,
  hidden_cabin: buildRuinedCabin,
  abandoned_station: buildAbandonedStation,
  viewpoint: buildViewpoint,
  pond: buildPond,
  landmark: buildLandmark,
};

export default {
  name: 'props',

  init(ctx) {
    const { scene, bus, state, camera } = ctx;
    const root = new THREE.Group();
    root.name = 'props';
    scene.add(root);
    materials();

    /** id → Prop */
    const props = new Map();
    /** ids waiting to be (re)built, with a reason: 'build' | 'rebuild' */
    const queue = new Map();
    /** lure id → LureMsg */
    const lures = new Map();
    /** platform sets of built props (for platformHeightAt) */
    const platformSets = new Set();
    let streamTimer = 0;
    let lastFlags = {};

    // --- helpers ---------------------------------------------------------------
    const world = () => ctx.world;
    function player() {
      const p = ctx.player?.feet || ctx.player?.pos;
      if (p && Number.isFinite(p.x)) return p;
      if (ctx.state.mode === 'boot' && state.welcome?.spawn?.pos) return state.welcome.spawn.pos;
      return camera.position;
    }
    function groundAt(x, z, fallback) {
      const w = world();
      if (w?.isLoaded?.(x, z)) {
        const h = w.heightAt?.(x, z);
        if (Number.isFinite(h)) return { y: h, loaded: true };
      }
      return { y: Number.isFinite(fallback) ? fallback : 0, loaded: false };
    }
    function lodAt(x, z) {
      const w = world();
      if (!w?.isLoaded?.(x, z)) return Infinity;
      const l = w.lodAt?.(x, z);
      return Number.isFinite(l) && l >= 0 ? l : 0;
    }
    const flags = () => state.profile?.flags || {};

    /** Pseudo-POIs that are not in state.pois: lures and the garden feeder. */
    function pseudoPoi(id) {
      if (id.startsWith('lure:')) {
        const l = lures.get(+id.slice(5));
        if (!l) return null;
        const r = world()?.regionAt?.(l.pos?.x ?? 0, l.pos?.z ?? 0);
        return { id, kind: isFeederLure(l.kind) ? 'feeder' : 'lure', name: '', pos: l.pos || { x: 0, y: 0, z: 0 }, yaw: 0, region: Number.isFinite(r) && r !== 255 ? r : 0, radius: 2 };
      }
      if (id === 'garden_feeder') {
        const cabin = state.pois?.cabin;
        if (!cabin || !hasGarden(state.profile) || feederLureNearCabin()) return null;
        const p = feederSpot(cabin);
        return { id, kind: 'feeder', name: 'Garden Feeder', pos: p, yaw: (+cabin.yaw || 0) + 0.6, region: cabin.region ?? 0, radius: 2 };
      }
      return null;
    }
    function feederLureNearCabin() {
      const cabin = state.pois?.cabin;
      if (!cabin) return false;
      const spot = feederSpot(cabin);
      for (const l of lures.values()) {
        if (isFeederLure(l.kind) && Math.hypot((l.pos?.x ?? 0) - spot.x, (l.pos?.z ?? 0) - spot.z) < 20) return true;
      }
      return false;
    }
    const poiFor = (id) => (id.startsWith('lure:') || id === 'garden_feeder' ? pseudoPoi(id) : state.pois?.[id]);

    /** Whether a POI should exist as a prop right now (taken collectibles do not). */
    function wanted(poi) {
      if (!poi || typeof poi.kind !== 'string') return false;
      if (COLLECTIBLES.has(poi.kind) && isTaken(poi.id, flags())) return false;
      return poi.kind === 'npc' || poi.kind === 'cache' || poi.kind === 'sign' || COLLECTIBLES.has(poi.kind)
        || poi.kind === 'lure' || poi.kind === 'feeder' || !!STRUCTURE_BUILDERS[poi.kind];
    }

    // --- building -------------------------------------------------------------
    function build(id) {
      const poi = poiFor(id);
      const old = props.get(id);
      if (!poi || !wanted(poi)) { if (old) drop(id); return; }
      const x = +poi.pos?.x || 0, z = +poi.pos?.z || 0;
      const yaw = +poi.yaw || 0;
      const g0 = groundAt(x, z, +poi.pos?.y);
      const small = SMALL.has(poi.kind);
      const prop = {
        id, poi, kind: poi.kind, x, z, yaw, base: g0.y, loaded: g0.loaded, seatLod: lodAt(x, z),
        group: new THREE.Group(), reach: 3, small, set: null,
        blockerRemovers: old?.blockerRemovers || [], patchRemovers: old?.patchRemovers || [],
        interactLocal: null, smoke: [], item: null, glint: null, npc: null, phase: (hashString(id) % 628) / 100,
        open: false, needsTerrain: false, interactPos: new THREE.Vector3(),
      };
      if (old) { old.blockerRemovers = []; old.patchRemovers = []; disposeProp(old); }
      prop.group.name = 'prop:' + id;

      const rand = rngFor(id, 1);
      const pal = paletteFor(poi.region, id);
      const solid = new Shape(rand, 1);
      const glow = new Shape(rand, 1);
      const b = {
        poi, rand, pal, solid, glow, base: prop.base, loaded: g0.loaded, complete: true,
        // local ground offset relative to the base (0 where the terrain is not loaded)
        ground(lx, lz) {
          const [wx, wz] = localToWorld(x, z, yaw, lx, lz);
          const g = groundAt(wx, wz, NaN);
          return g.loaded ? g.y - prop.base : 0;
        },
      };

      let spec = {};
      try {
        if (poi.kind === 'npc') spec = buildNpcProp(prop, poi);
        else if (poi.kind === 'cache') { prop.open = isTaken(id, flags()); spec = buildCache(b, prop.open); }
        else if (COLLECTIBLES.has(poi.kind)) spec = buildCollectibleProp(prop, b);
        else if (poi.kind === 'sign') spec = buildSign(b);
        else if (poi.kind === 'lure') spec = buildSeedLure(b);
        else if (poi.kind === 'feeder') spec = buildFeeder(b);
        else spec = STRUCTURE_BUILDERS[poi.kind](b) || {};
      } catch (err) {
        console.error(`[props] building ${id} (${poi.kind}) failed`, err);
        spec = {};
      }
      prop.needsTerrain = !g0.loaded || b.complete === false;

      const sg = solid.build();
      if (sg) prop.group.add(solidMesh(sg, 'prop-solid'));
      const gg = glow.build();
      if (gg) prop.group.add(glowMesh(gg, 'prop-glow'));
      prop.reach = Math.max(2, spec.reach || 3);
      prop.interactLocal = spec.interact || null;
      for (const s of spec.smoke || []) prop.smoke.push(createSmoke(prop.group, s.lx, s.ly, s.lz, hashString(id) % 97));

      prop.group.rotation.y = poi.kind === 'npc' ? 0 : -yaw;
      root.add(prop.group);
      props.set(id, prop);

      if (spec.surfaces?.length) {
        prop.set = { x, z, yaw, base: prop.base, surfaces: spec.surfaces, reach: surfaceReach(spec.surfaces) };
        platformSets.add(prop.set);
      }
      // Blockers and footstep patches are registered once per prop lifetime.
      if (prop.blockerRemovers.length === 0 && spec.blockers?.length) {
        for (const c of spec.blockers) {
          const [bx, bz] = localToWorld(x, z, yaw, c.lx, c.lz);
          const rm = world()?.addBlocker?.({ x: bx, z: bz, r: c.r });
          if (typeof rm === 'function') prop.blockerRemovers.push(rm);
        }
      }
      if (prop.patchRemovers.length === 0 && spec.patches?.length) {
        for (const c of spec.patches) {
          const [bx, bz] = localToWorld(x, z, yaw, c.lx, c.lz);
          const rm = world()?.addSurfacePatch?.({ x: bx, z: bz, r: c.r, surface: 'wood' });
          if (typeof rm === 'function') prop.patchRemovers.push(rm);
        }
      }
      place(prop);
      // A new walkable surface may lift nearby small props (Mara on the porch).
      if (prop.set) for (const p of props.values()) if (p.small && p !== prop && distXZ(p.poi, x, z) < prop.reach + 2) place(p);
    }

    function buildNpcProp(prop, poi) {
      const def = state.npcs?.[poi.data?.npc] || Object.values(state.npcs || {}).find((n) => n.poi === poi.id);
      const npc = buildNPC(def, poi.id);
      npc.setBaseYaw(+poi.yaw || 0);
      prop.npc = npc;
      prop.group.add(npc.group);
      return { reach: 1, blockers: [{ lx: 0, lz: 0, r: 0.3 }] };
    }

    function buildCollectibleProp(prop, b) {
      const { item, lift, tilt } = buildCollectible(b, () => new Shape(b.rand, 1));
      const holder = new THREE.Group();
      holder.name = 'collectible';
      const geo = item.build();
      if (geo) {
        const m = solidMesh(geo, 'collectible-model');
        m.rotation.x = tilt || 0;
        m.updateMatrix();
        holder.add(m);
      }
      holder.position.y = lift;
      prop.group.add(holder);
      prop.item = { holder, lift };
      prop.glint = createGlint(holder);
      return { reach: 1, interact: { lx: 0, ly: lift, lz: 0 } };
    }

    /** Seats a prop: structures at the ground; small props on a deck/floor if there is one. */
    function place(prop) {
      const g = groundAt(prop.x, prop.z, +prop.poi.pos?.y);
      let y = g.y;
      if (prop.small) {
        const plat = platformHeightAtExcept(prop.set, prop.x, prop.z, g.y + STEP_UP);
        y = seatSmall(g.y, plat);
      }
      prop.base = y;
      prop.loaded = g.loaded;
      if (prop.set) prop.set.base = y;
      prop.group.position.set(prop.x, y, prop.z);
      prop.group.updateMatrix();
      prop.group.matrixAutoUpdate = false;
      if (prop.interactLocal) {
        const [ix, iz] = localToWorld(prop.x, prop.z, prop.yaw, prop.interactLocal.lx, prop.interactLocal.lz);
        prop.interactPos.set(ix, y + prop.interactLocal.ly, iz);
      } else {
        prop.interactPos.set(prop.x, y + (prop.npc ? 1.2 : 1.0), prop.z);
      }
    }

    function platformHeightAtExcept(skip, x, z, y) {
      if (!skip) return platformHeightAt(platformSets, x, z, y);
      platformSets.delete(skip);
      const h = platformHeightAt(platformSets, x, z, y);
      platformSets.add(skip);
      return h;
    }

    function disposeProp(prop) {
      for (const s of prop.smoke) s.dispose();
      prop.glint?.dispose();
      prop.npc?.dispose();
      prop.group.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });
      root.remove(prop.group);
      if (prop.set) platformSets.delete(prop.set);
      for (const rm of prop.blockerRemovers) rm();
      for (const rm of prop.patchRemovers) rm();
      prop.blockerRemovers = [];
      prop.patchRemovers = [];
    }

    function drop(id) {
      const p = props.get(id);
      if (!p) return;
      disposeProp(p);
      props.delete(id);
    }

    function clearAll() {
      for (const id of [...props.keys()]) drop(id);
      queue.clear();
    }

    function enqueue(id, reason = 'build') {
      if (!queue.has(id) || reason === 'rebuild') queue.set(id, reason);
    }

    /** Streaming pass: queue what came into range, drop what went out of it. */
    function stream() {
      const p = player();
      for (const id in state.pois || {}) {
        const poi = state.pois[id];
        const built = props.has(id);
        const act = streamAction(built || queue.has(id), distXZ(poi, p.x, p.z));
        if (act === 'build' && wanted(poi)) enqueue(id);
        else if (act === 'drop') { drop(id); queue.delete(id); }
      }
      const feeder = pseudoPoi('garden_feeder');
      const near = feeder && distXZ(feeder, p.x, p.z) <= DROP_DIST;
      if (near && !props.has('garden_feeder')) enqueue('garden_feeder');
      else if (!near && props.has('garden_feeder')) drop('garden_feeder');
    }

    function runQueue() {
      if (queue.size === 0) return;
      const p = player();
      // nearest first
      const ids = [...queue.keys()];
      ids.sort((a, b) => dist(a, p) - dist(b, p));
      const t0 = performance.now();
      for (const id of ids) {
        queue.delete(id);
        const poi = poiFor(id);
        if (poi && !id.startsWith('lure:') && id !== 'garden_feeder' && distXZ(poi, p.x, p.z) > DROP_DIST) continue;
        build(id);
        if (performance.now() - t0 > BUILD_BUDGET_MS) break;
      }
    }
    const dist = (id, p) => { const poi = poiFor(id); return poi ? distXZ(poi, p.x, p.z) : Infinity; };

    // --- events ----------------------------------------------------------------
    bus.on('welcome', () => {
      // A welcome (first connect or a new adventure) replaces the world: start over.
      clearAll();
      lures.clear();
      lastFlags = { ...flags() };
      stream();
    });

    bus.on('net:pois', (msg) => {
      const pois = mergePois(state, msg);
      const p = player();
      for (const poi of pois) {
        const prop = props.get(poi.id);
        if (prop) {
          // re-sent: rebuild only if it actually changed
          const o = prop.poi;
          if (o.kind !== poi.kind || o.pos?.x !== poi.pos?.x || o.pos?.z !== poi.pos?.z || o.yaw !== poi.yaw || o.name !== poi.name) enqueue(poi.id, 'rebuild');
          else prop.poi = poi;
        } else if (wanted(poi) && distXZ(poi, p.x, p.z) <= DROP_DIST) {
          enqueue(poi.id);
        }
      }
    });

    bus.on('net:lure', (msg) => {
      const act = applyLure(lures, msg);
      const id = 'lure:' + (+msg?.id);
      if (act === 'add') enqueue(id, 'rebuild');
      else if (act === 'remove') drop(id);
      // a garden feeder lure replaces the profile-derived feeder (and vice versa)
      stream();
    });

    bus.on('profile', (profile) => {
      const f = profile?.flags || {};
      for (const [id, prop] of props) {
        const taken = isTaken(id, f);
        if (taken === !!lastFlags['taken:' + id]) continue;
        if (COLLECTIBLES.has(prop.kind) && taken) drop(id);
        else if (prop.kind === 'cache' && taken !== prop.open) build(id);
      }
      // a collectible that is no longer taken (new adventure) comes back via streaming
      lastFlags = { ...f };
      stream();
    });

    bus.on('world:chunk', (c) => {
      if (!c) return;
      const { cx, cz, lod } = c;
      for (const prop of props.values()) {
        if (!overlapsChunk(prop.x, prop.z, prop.reach, cx, cz)) continue;
        if (prop.small) { place(prop); continue; }
        if (lod < prop.seatLod || prop.needsTerrain) enqueue(prop.id, 'rebuild');
      }
    });

    // --- public API -----------------------------------------------------------
    ctx.props = {
      /** The scene group holding every prop. */
      root,
      /**
       * Currently available interaction targets near the player (built props only:
       * within ~800 m). Collected collectibles and opened caches are excluded.
       * @returns {{id:string, kind:string, pos:THREE.Vector3, radius:number, label:string, verb:string}[]}
       */
      interactables() {
        const entries = [];
        for (const prop of props.values()) {
          if (!prop.poi || prop.kind === 'lure' || prop.kind === 'feeder') continue;
          entries.push({ poi: prop.poi, pos: prop.interactPos, radius: interactRadius(prop.poi) });
        }
        const out = filterInteractables(entries, flags(), state.npcs, []);
        // c-field hook: forage plants near the player ("Pick"); E on them is answered
        // by ctx.forage (see web/js/forage/index.js), not sent to the server.
        try { const extra = ctx.forage?.interactables?.(); if (extra?.length) out.push(...extra); } catch { /* forage is optional */ }
        return out;
      },
      /** Feet position of an NPC (by NPC id or its POI id), or null if unknown. */
      npcPos(id) {
        let poiId = id;
        if (!state.pois?.[id] || state.pois[id].kind !== 'npc') {
          const def = state.npcs?.[id];
          poiId = def?.poi || Object.values(state.pois || {}).find((p) => p.kind === 'npc' && p.data?.npc === id)?.id;
        }
        const prop = poiId && props.get(poiId);
        if (prop) return new THREE.Vector3(prop.x, prop.base, prop.z);
        const poi = poiId && state.pois?.[poiId];
        if (!poi) return null;
        const g = groundAt(poi.pos.x, poi.pos.z, poi.pos.y);
        return new THREE.Vector3(poi.pos.x, g.y, poi.pos.z);
      },
      /**
       * Highest walkable prop surface (tower platform and stairs, porch, hide floor,
       * boardwalk) under (x, z) that feet at height y can stand on (at most a step
       * above y), or null.
       */
      platformHeightAt(x, z, y) {
        return platformHeightAt(platformSets, x, z, y);
      },
      /** Diagnostics. */
      get debug() { return { built: props.size, queued: queue.size, known: Object.keys(state.pois || {}).length, lures: lures.size }; },
    };

    // --- per frame ---------------------------------------------------------------
    this._frame = (dt) => {
      streamTimer -= dt;
      if (streamTimer <= 0) { streamTimer = 0.5; stream(); }
      runQueue();

      const t = ctx.time;
      const p = player();
      const daylight = Number.isFinite(ctx.sky?.daylight) ? ctx.sky.daylight : (state.env?.light ?? 1);
      const night = windowGlow(daylight);
      materials().glow.color.copy(GLASS_DAY).lerp(GLOW_NIGHT, night);
      const wind = ctx.sky?.env?.wind ?? state.env?.wind ?? 0.3;
      const track = +ctx.stats?.trackSigns || 0;
      const eyeY = camera.position.y;
      for (const prop of props.values()) {
        const dx = prop.x - p.x, dz = prop.z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (prop.npc && d < ANIM_DIST) prop.npc.update(dt, t, p.x, p.z, eyeY);
        if (prop.item && d < ANIM_DIST) {
          const h = prop.item.holder;
          h.position.y = prop.item.lift + bob(t, prop.phase);
          h.rotation.y = t * 0.6 + prop.phase;
          prop.glint.update(glintAmount(d, track), t, prop.phase);
          // the interaction point follows the bobbing item
          prop.interactPos.y = prop.base + h.position.y;
        }
        if (prop.smoke.length) {
          const near = d < SMOKE_DIST;
          for (const s of prop.smoke) {
            s.visible = near;
            if (near) s.update(t, wind, prop.yaw, daylight);
          }
        }
      }
    };
  },

  update(dt) {
    this._frame?.(dt);
  },
};
