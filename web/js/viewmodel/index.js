// ctx.viewmodel — the instrument in the player's hands (first-person "view model").
//
// A small procedural rig parented to ctx.camera: mitten-like hands and sleeved forearms
// holding the selected tool (binoculars, camera, recorder/microphone), shaped after the
// equipped item. Driven by ctx.tools (active, raiseAmount, toolZoom, recording), the
// bus ('tool', 'photo:taken', 'focus', 'mouse:down') and ctx.player (speed, yaw/pitch,
// crouching, prone):
//   - selecting a tool puts the previous one away, then draws the new one up with a settle;
//   - lowered: breathing sway, stride bob in step with the head bob, lag when turning;
//   - raising an optic lifts it to the eyes on tools.js's own raiseAmount and fades the
//     rig out while the binocular mask / viewfinder fades in (same number drives both);
//   - camera: the lens extends with the selected zoom, the index finger presses the
//     shutter, a tiny recoil; recorder: held forward while recording, LEDs follow the level.
// (A free hand cupping the ear during focused listening was tried and dropped: at the
// view's edge it read as a fist and covered the clue panel.)
// Rendering: drawn last, depth squeezed into the front 2 % of the depth range in the
// vertex shader so it never pokes into trees or the ground while still writing a (near)
// depth the post passes read as "very close" (no haze, no light shafts through it).
// Photos (ctx.capture) never include it. Nothing is shown outside 'play' mode.
import * as THREE from 'three';
import {
  createHolster, stepHolster, drawOffset, liftAmount, rigAlpha, stepRaise, strideFreq, bobAmp,
  bobOffsetHands, breathe, wrapAngle, lagTarget, pressCurve, recoilCurve, ledLevels,
  damp, lerp, clamp, easeInOut,
} from './anim.js';
import { armLook, lookKey, slotOf } from './looks.js';
import { buildBinoculars, buildCamera, buildRecorder, buildHand, buildFinger, buildForearm } from './models.js';

const REF_TAN = Math.tan((70 * Math.PI) / 360);   // the rig is laid out for a 70° view
const DEPTH_SQUEEZE = 0.02;
const LED_COLORS = [0x5fd46a, 0x8fe060, 0xf2c14a, 0xf0584a, 0xff3b30];
const SHOULDER_L = new THREE.Vector3(-0.2, -0.44, 0.06);
const SHOULDER_R = new THREE.Vector3(0.21, -0.44, 0.06);
const HAND_SCALE = 0.84;
const RAISE_RECORDER = 0.25;   // optics.raiseTime('recorder')

/** Make a material draw in the very front of the depth range (see header). */
function squeezeDepth(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>\n\tgl_Position.z = mix(-gl_Position.w, gl_Position.z, ${DEPTH_SQUEEZE.toFixed(3)});`,
    );
  };
  mat.customProgramCacheKey = () => 'wc-viewmodel-squeeze';
  return mat;
}

export default {
  name: 'viewmodel',

  init(ctx) {
    const { bus, state, camera } = ctx;

    // --- materials (shared by every part; the rig fades by one opacity) ----------
    const mat = squeezeDepth(new THREE.MeshPhongMaterial({
      vertexColors: true, shininess: 22, specular: new THREE.Color(0x1a1a1a),
      transparent: true, fog: false, emissive: new THREE.Color(0x0d0c0b),
    }));
    mat.name = 'viewmodel';
    const ledMats = LED_COLORS.map((c) => squeezeDepth(new THREE.MeshBasicMaterial({ color: c, transparent: true, fog: false })));
    const ledBase = LED_COLORS.map((c) => new THREE.Color(c));
    const allMats = [mat, ...ledMats];
    // While the rig fades, a depth-only pre-pass keeps only its front-most surface, so
    // the translucent hands and tool do not show their own insides.
    const depthMat = squeezeDepth(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, fog: false }));
    depthMat.name = 'viewmodel-depth';
    depthMat.visible = false;
    function addPrepass(obj) {
      const list = [];
      obj.traverse((o) => { if (o.isMesh && !o.userData.vmPre && !o.userData.vmHasPre) list.push(o); });
      for (const o of list) {
        const pre = new THREE.Mesh(o.geometry, depthMat);
        pre.userData.vmPre = true;
        pre.frustumCulled = false; pre.renderOrder = 999;
        pre.castShadow = pre.receiveShadow = false;
        o.userData.vmHasPre = true;
        o.add(pre);
      }
      return obj;
    }

    // --- scene graph ---------------------------------------------------------------
    const root = new THREE.Group();
    root.name = 'viewmodel';
    root.visible = false;
    camera.add(root);
    const holder = new THREE.Group();     // pose + motion
    root.add(holder);

    let armKey = '';
    let arms = null;                      // {left, right} forearm meshes (per clothing)
    let finger = null;                    // camera index finger (per clothing)
    let look = armLook('');
    const models = { binoculars: null, camera: null, recorder: null };
    let current = null;                   // model in the hands

    function newMesh(geo, m, name) {
      const o = new THREE.Mesh(geo, m);
      o.name = name; o.castShadow = false; o.receiveShadow = false;
      o.frustumCulled = false; o.renderOrder = 1000;
      return o;
    }
    function disposeModel(m) {
      if (!m) return;
      m.group.removeFromParent();
      if (finger && finger.parent === m.group) m.group.remove(finger);
      m.group.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.vmPre) o.geometry.dispose(); });
      if (m.ledGeo) m.ledGeo.dispose();
    }
    function buildArms(clothing) {
      const key = clothing || '';
      if (key === armKey && arms) return;
      armKey = key;
      look = armLook(clothing);
      if (arms) { arms.left.geometry.dispose(); arms.right.geometry.dispose(); arms.left.removeFromParent(); arms.right.removeFromParent(); }
      const fg = buildForearm(look);
      arms = { left: newMesh(fg, mat, 'armL'), right: newMesh(fg.clone(), mat, 'armR') };
      arms.left.visible = arms.right.visible = false;
      addPrepass(arms.left); addPrepass(arms.right);
      root.add(arms.left, arms.right);
      if (finger) { finger.geometry.dispose(); finger.removeFromParent(); }
      finger = newMesh(buildFinger(look), mat, 'finger');
      addPrepass(finger);
      // Models hold hands built with the old skin: rebuild them lazily.
      for (const k of Object.keys(models)) { if (models[k] && models[k] !== current) { disposeModel(models[k]); models[k] = null; } }
    }

    function itemFor(tool) {
      const id = state.profile?.equipped?.[slotOf(tool)] || '';
      return { id, def: state.items?.[id] || null };
    }

    function buildModel(tool) {
      const { id, def } = itemFor(tool);
      let m;
      if (tool === 'binoculars') m = buildBinoculars(id, def, mat);
      else if (tool === 'camera') m = buildCamera(id, def, mat);
      else m = buildRecorder(id, def, mat, ledMats);
      m.handMeshes = {};
      for (const side of ['left', 'right']) {
        const hp = m.hands[side];
        if (!hp) continue;
        const h = newMesh(buildHand(look, side === 'right', hp.grip ?? 0.7, { noThumb: false }), mat, 'hand' + side);
        h.position.set(hp.pos[0], hp.pos[1], hp.pos[2]);
        h.rotation.set(hp.rot[0], hp.rot[1], hp.rot[2]);
        h.scale.setScalar(HAND_SCALE);
        m.group.add(h);
        m.handMeshes[side] = h;
      }
      if (tool === 'camera' && finger) {
        // Index finger resting above the shutter button.
        finger.position.set(m.shutter[0] + 0.004, m.shutter[1] + 0.011, m.shutter[2] + 0.034);
        finger.rotation.set(-0.32, 0.08, 0);
        m.fingerRest = -0.32;
        m.group.add(finger);
      }
      m.key = lookKey(tool, id, state.profile?.equipped?.clothing);
      addPrepass(m.group);
      return m;
    }

    function attach(key) {
      if (current) current.group.removeFromParent();
      current = null;
      if (key === 'none') return;
      const tool = key.split('|')[0];
      let m = models[tool];
      if (!m || m.key !== key) { disposeModel(m); m = models[tool] = buildModel(tool); }
      current = m;
      holder.add(m.group);
    }

    // --- animation state ---------------------------------------------------------
    const h = createHolster();
    const a = {
      recRaise: 0, runAmt: 0, stride: 0, amp: 0,
      prevYaw: null, prevPitch: null, lagYaw: 0, lagPitch: 0,
      pressT: 99, shotT: 99, lens: 0, wheel: 0, alpha: 0,
      hide: 0, pulse: 0,
    };
    const bob = { x: 0, y: 0, rz: 0 };
    const br = { x: 0, y: 0, rx: 0 };
    const lit = [0, 0, 0, 0];
    const tmpV = new THREE.Vector3();
    const dirV = new THREE.Vector3();
    const Z = new THREE.Vector3(0, 0, 1);
    const pose = { pos: [0, 0, 0], rot: [0, 0, 0] };
    const base = { pos: [0, 0, 0], rot: [0, 0, 0] };

    bus.on('photo:taken', () => { a.shotT = 0; a.pressT = Math.min(a.pressT, 0.04); });
    bus.on('mouse:down', ({ button } = {}) => {
      if (button === 0 && state.mode === 'play' && ctx.tools?.active === 'camera') a.pressT = 0;
    });
    bus.on('profile', (p) => buildArms(p?.equipped?.clothing));
    bus.on('welcome', () => buildArms(state.profile?.equipped?.clothing));

    // Photographs never show the hands: hide the rig around the capture render.
    const origCapture = ctx.capture;
    if (typeof origCapture === 'function') {
      ctx.capture = function captureWithoutHands(...args) {
        const v = root.visible;
        root.visible = false;
        try { return origCapture.apply(this, args); } finally { root.visible = v; }
      };
    }

    function setArm(arm, hand, shoulder) {
      if (!hand || !hand.visible || !hand.parent) { arm.visible = false; return; }
      hand.updateWorldMatrix(true, false);
      tmpV.setFromMatrixPosition(hand.matrixWorld);
      root.worldToLocal(tmpV);
      arm.position.copy(tmpV);
      dirV.copy(shoulder).sub(tmpV).normalize();
      arm.quaternion.setFromUnitVectors(Z, dirV);
      arm.visible = true;
    }

    function lerpPose(p, q, t) {
      for (let i = 0; i < 3; i++) { pose.pos[i] = lerp(p.pos[i], q.pos[i], t); pose.rot[i] = lerp(p.rot[i], q.rot[i], t); }
    }

    function update(dt) {
      const tools = ctx.tools;
      const player = ctx.player;
      const playing = state.mode === 'play' && player?.ready !== false;
      const active = playing && tools ? tools.active : 'none';
      if (!arms) buildArms(state.profile?.equipped?.clothing);

      // Holster: stow the old tool, then draw the selected one.
      const slot = slotOf(active);
      const want = active === 'none' ? 'none' : lookKey(active, state.profile?.equipped?.[slot] || '', state.profile?.equipped?.clothing);
      stepHolster(h, want, dt);
      if (h.changed || (current ? current.key !== h.shown : h.shown !== 'none')) attach(h.shown);
      const stowing = h.shown !== want;

      // How far raised: optics follow tools.js exactly; the recorder has its own lift.
      const tool = current?.tool || 'none';
      const isActive = tool === active && !stowing;
      a.recRaise = stepRaise(a.recRaise, tool === 'recorder' && isActive && !!tools?.raised, RAISE_RECORDER, dt);
      let raise = 0;
      if (isActive && (tool === 'binoculars' || tool === 'camera')) raise = clamp(tools?.raiseAmount ?? (tools?.raised ? 1 : 0));
      const optic = tool === 'binoculars' || tool === 'camera';
      const lift = optic ? liftAmount(raise) : easeInOut(a.recRaise);
      const alpha = optic ? rigAlpha(raise) : 1;
      a.alpha = alpha;

      // Motion inputs.
      const speed = playing ? Math.max(0, player?.speed || 0) : 0;
      const prone = !!player?.prone;
      const crouching = !!player?.crouching;
      a.runAmt += ((speed > 3.4 ? 1 : 0) - a.runAmt) * damp(5, dt);
      const f = strideFreq(speed);
      if (f > 0) a.stride = (a.stride + f * dt) % 1;
      const ampT = bobAmp(speed, { crouching, prone, raised: Math.max(lift, a.recRaise * 0.5) });
      a.amp += (ampT - a.amp) * damp(6, dt);
      bobOffsetHands(a.stride, a.amp, bob);
      breathe(ctx.time, (1 - Math.min(1, speed / 1.5)) * (1 - lift * 0.7) + 0.25, br);

      // Turn lag from look velocity.
      const yaw = player?.yaw ?? 0, pitch = player?.pitch ?? 0;
      if (a.prevYaw === null || dt <= 0) { a.prevYaw = yaw; a.prevPitch = pitch; }
      const vy = dt > 0 ? wrapAngle(yaw - a.prevYaw) / dt : 0;
      const vp = dt > 0 ? (pitch - a.prevPitch) / dt : 0;
      a.prevYaw = yaw; a.prevPitch = pitch;
      a.lagYaw += (lagTarget(vy) - a.lagYaw) * damp(9, dt);
      a.lagPitch += (lagTarget(vp, 0.025, 0.06) - a.lagPitch) * damp(9, dt);
      const lagK = 1 - lift * 0.85;

      // Clips.
      a.pressT += dt; a.shotT += dt;
      const press = Math.max(pressCurve(a.pressT), pressCurve(a.shotT));
      const recoil = recoilCurve(a.shotT);

      if (current) {
        const low = current.low, run = current.lowRun || low;
        // Lowered pose blends to a "carry" pose when running.
        const rl = a.runAmt * (1 - lift);
        for (let i = 0; i < 3; i++) {
          pose.pos[i] = lerp(low.pos[i], run.pos[i], rl);
          pose.rot[i] = lerp(low.rot[i], run.rot[i], rl);
        }
        for (let i = 0; i < 3; i++) { base.pos[i] = pose.pos[i]; base.rot[i] = pose.rot[i]; }
        lerpPose(base, current.eye, lift);
        const off = drawOffset(h.draw, stowing);
        holder.position.set(
          pose.pos[0] + bob.x + br.x + a.lagYaw * 0.22 * lagK,
          pose.pos[1] + bob.y + br.y + off.y + a.lagPitch * 0.25 * lagK,
          pose.pos[2] + off.z + recoil * 0.008,
        );
        holder.rotation.set(
          pose.rot[0] + br.rx + off.rx + recoil * 0.06 + a.lagPitch * 0.6 * lagK,
          pose.rot[1] - a.lagYaw * 0.7 * lagK,
          pose.rot[2] + bob.rz + a.lagYaw * 0.4 * lagK,
        );

        if (current.tool === 'camera') {
          const maxZ = Math.max(1.01, Number(ctx.stats?.camZoom) || 4);
          const z = tools?.toolZoom ?? 1;
          a.lens += (clamp((z - 1) / (maxZ - 1)) - a.lens) * damp(8, dt);
          current.lens.position.z = current.lensBase - a.lens * current.lensTravel;
          if (finger && finger.parent === current.group) finger.rotation.x = current.fingerRest - press * 0.32;
        } else if (current.tool === 'binoculars' && current.wheel) {
          const z = tools?.toolZoom ?? 1;
          a.wheel += (z * 0.9 - a.wheel) * damp(8, dt);
          current.wheel.rotation.x = a.wheel;
        } else if (current.tool === 'recorder') {
          const recording = !!tools?.recording && isActive;
          const level = clamp(Number(ctx.audio?.level) || 0);
          a.pulse = Math.max(level, a.pulse - dt * 1.8);
          ledLevels(recording ? 0.12 + a.pulse * 0.95 : 0.12, 4, lit);
          for (let i = 0; i < 4; i++) {
            const k = 0.18 + lit[i] * 2.2;
            ledMats[i].color.copy(ledBase[i]).multiplyScalar(k);
          }
          const blink = recording ? (Math.sin(ctx.time * 6) > -0.2 ? 2.4 : 0.35) : 0.2;
          ledMats[4].color.copy(ledBase[4]).multiplyScalar(blink);
        }
      }

      // Visibility, fade, FOV compensation (the rig keeps its on-screen size while the
      // optics narrow the field of view).
      a.hide = Math.max(0, a.hide - 1);
      const showTool = !!current && h.shown !== 'none';
      root.visible = playing && a.hide === 0 && showTool && alpha > 0.01;
      if (!root.visible) return;
      for (const m of allMats) m.opacity = alpha;
      depthMat.visible = alpha < 0.999;
      const k = Math.tan((camera.fov * Math.PI) / 360) / REF_TAN;
      root.scale.set(k, k, 1);

      // Forearms run from each wrist to its shoulder.
      root.updateMatrixWorld(true);
      if (arms) {
        setArm(arms.left, current.handMeshes?.left, SHOULDER_L);
        setArm(arms.right, current.handMeshes?.right, SHOULDER_R);
      }
    }

    ctx.viewmodel = {
      root,
      /** Key of the model in the hands ('none' or 'tool|item|clothing'). */
      get shown() { return h.shown; },
      /** 0..1 how far drawn into the hands. */
      get draw() { return h.draw; },
      /** Current rig opacity (fades out as an optic reaches the eye). */
      get alpha() { return a.alpha; },
      /** Hide the rig for the next n frames (e.g. around a custom capture). */
      hideFor(frames = 1) { a.hide = Math.max(a.hide, frames | 0); root.visible = false; },
      update,
      dispose() {
        for (const k of Object.keys(models)) { disposeModel(models[k]); models[k] = null; }
        if (arms) { arms.left.geometry.dispose(); arms.right.geometry.dispose(); }
        finger?.geometry.dispose();
        for (const m of allMats) m.dispose();
        depthMat.dispose();
        root.removeFromParent();
        if (origCapture) ctx.capture = origCapture;
      },
    };
  },

  update(dt, ctx) {
    ctx.viewmodel?.update(dt);
  },
};
