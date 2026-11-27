// ctx.birds — renders the server's bird snapshots as procedural, animated 3D birds.
//
// Data flow: `net:birds` snapshots (10 Hz, authoritative) → SnapshotBook (per-bird
// sample ring buffers, interp.js) → every frame (lateUpdate, after the player has moved
// the camera) each bird is sampled ~120 ms in the past, animated from its act/flags
// (pose.js) and drawn as a full skinned model near the viewer (model.js), a tiny speck
// further out, or not at all beyond the fog (lod.js). Birds are never labelled: finding
// them is the game.
//
// Findability (the owner's brief; visibility.js has the maths): birds are drawn larger
// than life by apparent size, with a sky rim and lively idle motion; a soft cream
// outline (setting birdOutline, outline.js) rims every bird you have a line of sight to,
// depth-tested so it never shows through anything; and leaf cards right in front of
// nearby birds thin out into a small window (setting leafFade, world/trees/leafWindows.js).
// ctx.birds.visibilityAudit() measures all of it (audit.js).
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
import { birdTemplate, instantiate, applyPose, setRare, buildBirdModel, BIRD_RIM } from './model.js';
import { createAnimState, resetAnimState, createPose, createAnimInput, updateAnim } from './pose.js';
import { LOD, chooseLod, zoomFactor, fullRange, pixelAngle, speckSize, relativeBearing, fadeScale, fullBudget, budgetCutoff } from './lod.js';
import { emitCount } from './particles.js';
import { createEffects } from './effects.js';
import { createFlightFx } from './flightfx.js'; // [flight hook] flight you can follow
import { createAudit } from './audit.js';
import { attachOutline, styleOutline, hideOutline, setOutlineDaylight, OUTLINE_RES } from './outline.js';
import { SparePool, disposeView } from './pool.js';
import {
  exaggeration, refPixelAngle, outlineStyle, motionBoost, windowStrength, windowDepth, nearDepth, updateLook, pickNearest, WINDOW,
} from './visibility.js';
import { LEAF_WINDOWS, MAX_LEAF_WINDOWS } from '../world/trees/leafWindows.js';

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
    const flight = createFlightFx(ctx, scene, fx); // [flight hook] trails, flush debris, wing sounds, silhouettes
    let templates = new Map(); // species object → template
    const fresh = [];
    const live = [];
    const spares = new SparePool(disposeView); // released views, bounded over all species

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
        scale: 1, // drawn larger than life (visibility.js exaggeration)
        look: 0, // seconds the player has recently looked near this bird (leaf windows)
        fx: { ripple: 0, drop: 0, splashed: false },
        fl: flight.state(), // [flight hook] take-off / landing / flush state (flightlook.js)
      };
    }

    function release(d) {
      if (!d.view) return;
      hideOutline(d.view);
      root.remove(d.view.object);
      spares.put(d.template, d.view);
      d.view = null;
    }

    function acquire(d) {
      if (d.view) return d.view;
      const tpl = d.template;
      const v = spares.take(tpl) || instantiate(tpl, false);
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
        flight.reset(d.fl, e.id); // [flight hook]
        d.lod = LOD.NONE;
        d.scale = 1; d.look = 0;
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
      flight.clear(); // [flight hook]
      spares.clear();
      for (const tpl of templates.values()) tpl.dispose();
      templates = new Map();
    });

    // --- per-frame scratch (no allocation in the frame loop) -----------------------
    const inp = createAnimInput();
    const dists = new Float32Array(MAX_BIRDS);
    const scratch = new Float32Array(MAX_BIRDS);
    const camPos = new THREE.Vector3();
    const camQuat = new THREE.Quaternion();
    const camFwd = new THREE.Vector3();
    const bufSize = new THREE.Vector2();
    const outStyle = { alpha: 0, px: 0 };
    // Leaf windows: the chosen birds (re-chosen a few times a second), their keys.
    const winKeys = new Float32Array(MAX_BIRDS);
    const winRefs = new Array(MAX_BIRDS).fill(null);
    const winIdx = new Int32Array(MAX_LEAF_WINDOWS);
    const winSel = new Array(MAX_LEAF_WINDOWS).fill(null);
    let winN = 0, winT = 0;
    let auditing = false;
    /**
     * Debug / tuning overrides (ctx.birds.debugWindows): leaf-window depth (m, 0 = normal)
     * and strength (0..1, -1 = normal); aids = false draws birds as before this work
     * (true size, no outline, no leaf windows) for paired before/after audits.
     */
    const dbgWin = { depth: 0, strength: -1, aids: true };

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
      const refPx = refPixelAngle(cam.fov);
      const daylight = Number.isFinite(ctx.sky?.daylight) ? ctx.sky.daylight : 1;
      const outlineOn = settings.birdOutline !== false && !auditing && dbgWin.aids;
      ctx.renderer?.getDrawingBufferSize?.(bufSize);
      if (bufSize.y > 0) OUTLINE_RES.copy(bufSize);
      const devPx = (bufSize.y > 0 ? bufSize.y : screenH) / 720;
      camFwd.set(0, 0, -1).applyQuaternion(camQuat);
      // "Looked near it": within ~7° of the view centre with the naked eye, narrower through optics.
      const lookCone = 0.12 / Math.max(zoom, 1) + 0.01;
      // The sky rim on birds: a warm edge by day, a faint moonlit one at night.
      BIRD_RIM.value = 0.3 + 0.32 * Math.min(1, Math.max(0, daylight));
      setOutlineDaylight(daylight);
      flight.begin(camPos, camQuat, cam.fov, settings, dt); // [flight hook]

      // Pass 1: sample every bird at the render time and measure its distance.
      let n = 0;
      for (const e of book.map.values()) {
        const d = e.data;
        const s = sampleTrack(e.track, rt, d.sample);
        if (!s.valid) { d.dist = Infinity; continue; }
        flight.track(d, s); // [flight hook] take-off / landing moments; glides out any residual position step
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
        // [flight hook] × s.fade: a jump no flight could make is cross-faded, never glided (interp.js).
        const fade = (e.leaving ? 1 - fadeScale(t - e.leftAt, FADE_OUT) : fadeScale(t - e.born, FADE_IN)) * s.fade;
        const rare = (s.flags & FLAG.RARE_PLUMAGE) !== 0;
        if (lod === LOD.FULL) {
          const v = acquire(d);
          setRare(v, rare);
          inp.act = flight.animAct(s); inp.flags = s.flags; inp.speed = s.speed; // [flight hook] a dash into cover flies
          inp.vx = s.vx; inp.vy = s.vy; inp.vz = s.vz; inp.yawRate = s.yawRate;
          inp.lookYaw = relativeBearing(s.yaw + d.pose.turn, s.x, s.z, camPos.x, camPos.z);
          inp.y = s.y;
          // Larger than life by apparent size (visibility.js); idle motion enlarged for small-looking birds.
          const L = d.template.rig.length;
          // [flight hook] one combined scale: the perched exaggeration, raised to a wingspan floor in flight.
          d.scale = dbgWin.aids ? flight.scale(d, exaggeration(L, d.dist, cam.fov), d.dist, cam.fov) : 1;
          const drawnPx = (L * d.scale) / Math.max(d.dist, 0.05) / refPx;
          inp.boost = motionBoost(drawnPx);
          const w = ctx.world;
          inp.groundDy = w?.isLoaded?.(s.x, s.z) ? Math.min(0, (w.heightAt?.(s.x, s.z) ?? s.y) - s.y) : 0;
          updateAnim(d.anim, d.template.profile, inp, dt, d.pose);
          applyPose(v, flight.pose(d)); // [flight hook] take-off crouch/burst, landing flare/settle
          const o = v.object;
          o.position.set(s.x, s.y, s.z);
          o.rotation.set(0, -(s.yaw + d.pose.turn), 0);
          // Scaled about the feet (the model's origin), so a bird stays on its perch.
          o.scale.setScalar(Math.max(fade, 1e-3) * d.scale);
          o.castShadow = shadows;
          // The outline: a soft cream rim, strongest where the bird is small on screen.
          const hidden = s.act === ACT.HIDING || (s.flags & FLAG.HIDDEN) !== 0;
          if (outlineOn && !hidden) {
            outlineStyle(drawnPx, d.dist, daylight, isAirborneAct(s.act), outStyle);
            outStyle.alpha = flight.outline(d, outStyle.alpha); // [flight hook] a little stronger ~10 s after a flushed bird lands
            if (outStyle.alpha > 0.01) attachOutline(v);
            styleOutline(v, outStyle.alpha * fade, outStyle.px * devPx);
          } else hideOutline(v);
          // How long the player has been looking near it (opens its leaf window fully).
          if (d.dist <= flight.windowRange(d, WINDOW.range) + 5) { // [flight hook] a just-landed flushed bird: farther
            const ix = (s.x - camPos.x) / Math.max(d.dist, 1e-3), iy = (s.y - camPos.y) / Math.max(d.dist, 1e-3), iz = (s.z - camPos.z) / Math.max(d.dist, 1e-3);
            const ang = Math.acos(Math.max(-1, Math.min(1, ix * camFwd.x + iy * camFwd.y + iz * camFwd.z)));
            d.look = updateLook(d.look, ang, lookCone, dt);
          } else d.look = 0;
          if (d.dist < FX_RANGE) effectsFor(d, s, dt);
        } else {
          release(d);
          if (lod === LOD.SPECK && fade > 0.05 && !flight.silhouette(d, s, fade, d.dist)) { // [flight hook] distant fliers: flapping silhouettes
            const tpl = d.template;
            const sz = speckSize(tpl.rig.length * exaggeration(tpl.rig.length, d.dist, cam.fov), d.dist, pxA) * fade;
            const flying = isAirborneAct(s.act);
            // Airborne specks are wider (wings), perched ones a little taller than wide.
            const wx = flying ? Math.max(sz * 1.7, tpl.rig.span * 0.6 * fade) : sz;
            const wy = flying ? sz * 0.55 : sz * 0.8;
            fx.speck(s.x, s.y + (flying ? 0 : tpl.rig.legs.len + tpl.rig.body.ry), s.z, wx, wy, camQuat,
              rare ? tpl.speckColorRare : tpl.speckColor);
          }
        }
        flight.trail(d, s, fade); // [flight hook] faint dabs behind a flushed bird (setting flightTrails)
      }
      fx.endSpecks();
      fx.update(dt);
      flight.end(); // [flight hook]
      updateLeafWindows(dt, settings.leafFade !== false && dbgWin.aids);
    }

    /**
     * Leaf windows (world/trees/leafWindows.js): up to MAX_LEAF_WINDOWS nearest perched
     * or ground birds within WINDOW.range m in front of the camera, re-chosen a few
     * times a second; their positions and strengths are written every frame (no
     * allocation). Hidden, hiding and airborne birds get none.
     */
    function updateLeafWindows(dt, on) {
      const U = LEAF_WINDOWS;
      if (!on) { U.uLeafWinN.value = 0; winN = 0; return; }
      winT -= dt;
      if (winT <= 0) {
        winT = 0.2;
        let n = 0;
        for (const e of book.map.values()) {
          const d = e.data;
          if (e.leaving || d.lod !== LOD.FULL || !d.view || !(d.dist <= flight.windowRange(d, WINDOW.range))) continue; // [flight hook]
          if (windowStrength(d.pub.act, d.pub.flags, d.look) <= 0) continue;
          const p = d.pub.pos;
          const ahead = (p.x - camPos.x) * camFwd.x + (p.y - camPos.y) * camFwd.y + (p.z - camPos.z) * camFwd.z;
          if (ahead < -1 || ahead < d.dist * 0.35) continue; // behind, or far off to the side
          winKeys[n] = d.fl.glow > 0 ? d.dist * 0.25 : d.dist; winRefs[n] = d; n++; // [flight hook] a just-landed flushed bird comes first
          if (n >= winKeys.length) break;
        }
        const m = pickNearest(winKeys, n, MAX_LEAF_WINDOWS, winIdx);
        for (let i = 0; i < m; i++) winSel[i] = winRefs[winIdx[i]];
        for (let i = 0; i < n; i++) winRefs[i] = null;
        for (let i = m; i < winN; i++) winSel[i] = null;
        winN = m;
      }
      let k = 0;
      for (let i = 0; i < winN; i++) {
        const d = winSel[i];
        if (!d || !d.view || d.lod !== LOD.FULL) continue;
        let str = windowStrength(d.pub.act, d.pub.flags, d.look);
        if (str <= 0) continue;
        if (dbgWin.strength >= 0) str = dbgWin.strength;
        const R = d.template.rig, sc = d.scale, p = d.pub.pos;
        U.uLeafWinA.value[k].set(p.x, p.y + R.standHeight * sc, p.z, str);
        const depth = dbgWin.depth > 0 ? dbgWin.depth : windowDepth(d.dist, str);
        U.uLeafWinB.value[k].set(Math.max(WINDOW.rBird, 0.6 * R.length * sc), depth, WINDOW.rFar, nearDepth(d.dist, depth));
        k++;
      }
      U.uLeafWinN.value = k;
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

    const auditList = [];
    const audit = createAudit({
      renderer: ctx.renderer, scene, camera: ctx.camera, root,
      setAuditMode(on) {
        auditing = on;
        if (on) for (const e of book.map.values()) hideOutline(e.data?.view);
      },
      candidates() {
        auditList.length = 0;
        for (const e of book.map.values()) {
          const d = e.data;
          if (e.leaving || d.lod !== LOD.FULL || !d.view) continue;
          const sc = d.scale;
          auditList.push({
            id: e.id, sp: d.pub.sp, spId: d.template.species?.id, act: d.pub.act, flags: d.pub.flags,
            dist: d.dist, object: d.view.object, scale: sc,
            length: d.template.rig.length * sc, height: d.template.rig.standHeight * 2 * sc,
          });
        }
        return auditList;
      },
    });

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
      /**
       * Debug / tuning (on demand, never per frame): how visible is every bird in view?
       * Renders the scene depth and each full-model bird within `range` m inside the view
       * as a flat id colour, and returns { entries: [{id, sp, spId, act, dist, angle,
       * scale, pxFull, pxVisible, frac}], summary (auditLogic.summariseAudit), ms }.
       * Pixel counts are for a 1280×720 view unless width/height say otherwise.
       */
      visibilityAudit(opt = {}) { return audit.run(opt); },
      /** Debug / tuning: leaf-window overrides { depth (m, 0 = normal), strength (0..1, -1 = normal) }. */
      debugWindows: dbgWin,
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
