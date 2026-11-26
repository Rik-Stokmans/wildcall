// ctx.birds — renders the server's bird snapshots as procedural, animated 3D birds.
//
// Data flow: `net:birds` snapshots (10 Hz, authoritative) → SnapshotBook (per-bird
// sample ring buffers, interp.js) → every frame (lateUpdate, after the player has moved
// the camera) each bird is sampled ~120 ms in the past, animated from its act/flags
// (pose.js) and drawn as a full skinned model near the viewer (model.js), a tiny speck
// further out, or not at all beyond the fog (lod.js). Birds are never marked, outlined
// or labelled: finding them is the game.
//
// Public API (docs/contract.md §5.2):
//   ctx.birds.get(id)  → { id, sp, act, flags, pos: Vector3 } | undefined
//   ctx.birds.list()   → array of the same objects for every bird present
//   ctx.birds.count    → number of birds present
// `pos` is the interpolated render position (what the player sees), updated every
// frame. The returned objects are owned by this module: read them, do not keep or
// mutate them across frames.

import * as THREE from 'three';
import { SnapshotBook, createSample, sampleTrack } from './interp.js';
import { INTERP_DELAY, FADE_IN, FADE_OUT, MAX_BIRDS, ACT, FLAG, isAirborneAct } from './constants.js';
import { birdTemplate, instantiate, applyPose, setRare, buildBirdModel } from './model.js';
import { createAnimState, resetAnimState, createPose, createAnimInput, updateAnim } from './pose.js';
import { LOD, chooseLod, zoomFactor, fullRange, pixelAngle, speckSize, relativeBearing, fadeScale, fullBudget, budgetCutoff } from './lod.js';
import { emitCount } from './particles.js';
import { createEffects } from './effects.js';

/** Used when a snapshot names a species index the welcome did not contain. */
const FALLBACK_SPECIES = Object.freeze({
  id: '_unknown', index: -1,
  look: {
    length: 0.15, wingspan: 0.24, plump: 1.05, neck: 0.05, legs: 0.35, tail: 0.6, tailShape: 'square',
    bill: 0.45, billShape: 'thin', crest: false, wingShape: 'rounded',
    colors: { back: '#6b5a48', belly: '#c9b9a0', head: '#6b5a48', wing: '#5d4e3f', tail: '#5d4e3f', bill: '#3a332c', legs: '#8a7766', eye: '#141210' },
    marks: [],
  },
  move: { flight: 'direct', ground: 'hop', speed: 8, flapHz: 12 },
  traits: { shape: 'songbird' },
});

/** Effects are only spawned for birds this close (metres). */
const FX_RANGE = 70;

const now = () => performance.now() / 1000;

/** Stable per-id seed so each individual has its own rhythm. */
function hashId(id) {
  let h = (Math.floor(id) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export default {
  name: 'birds',

  init(ctx) {
    const scene = ctx.scene;
    const root = new THREE.Group();
    root.name = 'birds';
    scene.add(root);
    const fx = createEffects(scene);
    let templates = new Map(); // species object → template
    const fresh = [];
    const live = [];

    const speciesAt = (sp) => ctx.state?.species?.[sp] || FALLBACK_SPECIES;
    const templateFor = (sp) => {
      try { return birdTemplate(speciesAt(sp), templates); } catch (err) {
        console.error('[birds] model build failed for species', sp, err);
        return birdTemplate(FALLBACK_SPECIES, templates);
      }
    };

    function newData() {
      return {
        pub: { id: 0, sp: 0, act: 0, flags: 0, pos: new THREE.Vector3() },
        anim: createAnimState(),
        pose: createPose(),
        sample: createSample(),
        template: null,
        view: null,
        lod: LOD.NONE,
        dist: 0,
        fx: { ripple: 0, drop: 0, splashed: false },
      };
    }

    function release(d) {
      if (!d.view) return;
      root.remove(d.view.object);
      d.template.pool.push(d.view);
      d.view = null;
    }

    function acquire(d) {
      if (d.view) return d.view;
      const tpl = d.template;
      const v = tpl.pool.pop() || instantiate(tpl, false);
      root.add(v.object);
      d.view = v;
      return v;
    }

    const book = new SnapshotBook({
      maxBirds: MAX_BIRDS,
      onAdd(e) {
        const d = e.data || (e.data = newData());
        release(d);
        d.pub.id = e.id; d.pub.sp = e.sp; d.pub.act = 0; d.pub.flags = 0;
        d.template = templateFor(e.sp);
        resetAnimState(d.anim, hashId(e.id), d.pose);
        d.lod = LOD.NONE;
        d.fx.ripple = 0; d.fx.drop = 0; d.fx.splashed = false;
        fresh.push(e);
      },
      onRemove(e) { if (e.data) { release(e.data); e.data.lod = LOD.NONE; } },
    });

    function rebuildLive() {
      live.length = 0;
      for (const e of book.map.values()) if (!e.leaving) live.push(e.data.pub);
    }

    ctx.bus?.on?.('net:birds', (msg) => {
      try {
        // Reap here as well as per frame: a background tab gets no frames but keeps
        // receiving snapshots, and departed birds must not pile up meanwhile.
        book.reap(now());
        const t = book.ingest(msg, now());
        // Newly seen birds get a position straight away (before the next frame).
        for (let i = 0; i < fresh.length; i++) {
          const e = fresh[i];
          if (!e.data || book.map.get(e.id) !== e) continue;
          const s = sampleTrack(e.track, t, e.data.sample);
          if (s.valid) { e.data.pub.pos.set(s.x, s.y, s.z); e.data.pub.act = s.act; e.data.pub.flags = s.flags; }
        }
        fresh.length = 0;
        rebuildLive();
      } catch (err) {
        console.error('[birds] bad snapshot', err);
      }
    });

    // A new world (new adventure / reconnect): forget every bird and rebuild models
    // from the new catalog.
    ctx.bus?.on?.('welcome', () => {
      book.clear();
      fresh.length = 0;
      live.length = 0;
      fx.clear();
      for (const tpl of templates.values()) { for (const v of tpl.pool) v.object.skeleton?.dispose?.(); tpl.dispose(); }
      templates = new Map();
    });

    // --- per-frame scratch (no allocation in the frame loop) -----------------------
    const inp = createAnimInput();
    const dists = new Float32Array(MAX_BIRDS);
    const scratch = new Float32Array(MAX_BIRDS);
    const camPos = new THREE.Vector3();
    const camQuat = new THREE.Quaternion();

    function frame(dt) {
      const t = now();
      const rt = t - INTERP_DELAY;
      book.reap(t);
      const cam = ctx.camera;
      if (!cam) return;
      cam.updateMatrixWorld();
      camPos.setFromMatrixPosition(cam.matrixWorld);
      camQuat.setFromRotationMatrix(cam.matrixWorld);
      const settings = ctx.state?.settings || {};
      const zoom = zoomFactor(settings.fov || 70, cam.fov);
      const near = fullRange(zoom);
      const fog = ctx.scene?.fog;
      const fogFar = fog ? (fog.isFogExp2 ? 3 / Math.max(fog.density, 1e-6) : fog.far) : Infinity;
      const screenH = ctx.canvas?.clientHeight || window.innerHeight || 900;
      const pxA = pixelAngle(cam.fov, screenH);
      const quality = settings.quality || 'medium';
      const shadows = quality === 'high';

      // Pass 1: sample every bird at the render time and measure its distance.
      let n = 0;
      for (const e of book.map.values()) {
        const d = e.data;
        const s = sampleTrack(e.track, rt, d.sample);
        if (!s.valid) { d.dist = Infinity; continue; }
        const dx = s.x - camPos.x, dy = s.y - camPos.y, dz = s.z - camPos.z;
        d.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d.dist <= near + 8 && n < dists.length) dists[n++] = d.dist;
        if (!e.leaving) {
          d.pub.pos.set(s.x, s.y, s.z);
          d.pub.act = s.act;
          d.pub.flags = s.flags;
        }
      }
      const cutoff = budgetCutoff(dists, n, fullBudget(quality), scratch);

      // Pass 2: LOD, animation, drawing.
      fx.beginSpecks();
      for (const e of book.map.values()) {
        const d = e.data, s = d.sample;
        if (!s.valid) { release(d); continue; }
        let lod = chooseLod(d.lod, d.dist, near, fogFar);
        if (lod === LOD.FULL && d.dist > cutoff) lod = LOD.SPECK;
        d.lod = lod;
        const fade = e.leaving ? 1 - fadeScale(t - e.leftAt, FADE_OUT) : fadeScale(t - e.born, FADE_IN);
        const rare = (s.flags & FLAG.RARE_PLUMAGE) !== 0;
        if (lod === LOD.FULL) {
          const v = acquire(d);
          setRare(v, rare);
          inp.act = s.act; inp.flags = s.flags; inp.speed = s.speed;
          inp.vx = s.vx; inp.vy = s.vy; inp.vz = s.vz; inp.yawRate = s.yawRate;
          inp.lookYaw = relativeBearing(s.yaw, s.x, s.z, camPos.x, camPos.z);
          inp.y = s.y;
          const w = ctx.world;
          inp.groundDy = w?.isLoaded?.(s.x, s.z) ? Math.min(0, (w.heightAt?.(s.x, s.z) ?? s.y) - s.y) : 0;
          updateAnim(d.anim, d.template.profile, inp, dt, d.pose);
          applyPose(v, d.pose);
          const o = v.object;
          o.position.set(s.x, s.y, s.z);
          o.rotation.set(0, -s.yaw, 0);
          o.scale.setScalar(Math.max(fade, 1e-3));
          o.castShadow = shadows;
          if (d.dist < FX_RANGE) effectsFor(d, s, dt);
        } else {
          release(d);
          if (lod === LOD.SPECK && fade > 0.05) {
            const tpl = d.template;
            const sz = speckSize(tpl.rig.length, d.dist, pxA) * fade;
            const flying = isAirborneAct(s.act);
            // Airborne specks are wider (wings), perched ones a little taller than wide.
            const wx = flying ? Math.max(sz * 1.7, tpl.rig.span * 0.6 * fade) : sz;
            const wy = flying ? sz * 0.55 : sz * 0.8;
            fx.speck(s.x, s.y + (flying ? 0 : tpl.rig.legs.len + tpl.rig.body.ry), s.z, wx, wy, camQuat,
              rare ? tpl.speckColorRare : tpl.speckColor);
          }
        }
      }
      fx.endSpecks();
      fx.update(dt);
    }

    /** Wake rings for swimmers, splashes for bathers and plunge-divers. */
    function effectsFor(d, s, dt) {
      const pose = d.pose, L = d.template.rig.length;
      if (s.y > 0.4) { d.fx.splashed = false; }
      if (pose.wake > 0.05 && pose.swim > 0.5) {
        const k = emitCount(d.fx, 'ripple', 1.6 * pose.wake, dt);
        for (let i = 0; i < k; i++) fx.ripple(s.x, s.z, L * 2.2 + 0.08, 1.8);
      }
      if (pose.splash > 0.1 && s.y < 0.35) {
        const k = emitCount(d.fx, 'drop', 26 * pose.splash, dt);
        if (k > 0) fx.splash(s.x, Math.max(s.y, 0.02), s.z, L, k);
        const r = emitCount(d.fx, 'ripple', 2.5 * pose.splash, dt);
        for (let i = 0; i < r; i++) fx.ripple(s.x, s.z, L * 2.6 + 0.1, 1.2);
      }
      // A plunge-dive hitting the water: one big splash.
      if (s.act === ACT.DIVING && s.y < 0.3 && !d.fx.splashed) {
        d.fx.splashed = true;
        fx.splash(s.x, 0.05, s.z, L * 1.5, 14);
        fx.ripple(s.x, s.z, L * 4 + 0.2, 1.6);
      }
    }

    const api = {
      /** The bird with this id if it is present, else undefined. */
      get(id) {
        const e = book.map.get(id);
        return e && !e.leaving ? e.data.pub : undefined;
      },
      /** Every bird present (a reused array; do not keep or mutate it). */
      list() { return live; },
      /** Number of birds present. */
      get count() { return live.length; },
      /**
       * Build a standalone rigged model of a species (e.g. for a 3D journal view).
       * Returns { object: THREE.SkinnedMesh, bones, template, rare }.
       */
      buildBirdModel(species, opts = {}) { return buildBirdModel(species, { ...opts, cache: templates }); },
      /** @internal for tests / debugging */
      _frame: frame,
    };
    ctx.birds = api;
    this._frame = frame;
    this._live = () => rebuildLive();
  },

  lateUpdate(dt) {
    // lateUpdate: the player has already moved the camera this frame, so LOD and the
    // viewer-relative head turns use the current view.
    this._frame?.(dt);
    this._live?.();
  },
};
