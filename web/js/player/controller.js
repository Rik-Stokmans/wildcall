// First-person controller (ctx.player): locomotion, collision, standing on props, the
// region gate, interaction targeting, pose sending and the main-menu cinematic drift.
// All of the maths lives in the three-free files next to this one (movement.js,
// look.js, field.js) where it is unit-tested; this file wires it to the world.
import {
  applyMouse, clampPitch, damp, headingDir, wrapYaw,
} from './look.js';
import {
  createSprintState, runKeyDown, runKeyUp, stepGait, targetSpeed, terrainFactor, tooSteep,
  approachVelocity, moveMode, eyeHeightFor, bobParams, advanceStride, bobOffset, landingNoise,
  waterPushBack, refuseWaterStep, JUMP_SPEED, GRAVITY, STILL_SPEED, EYE_HEIGHT, STEP_UP,
} from './movement.js';
import {
  buildPose, poseInterval, pickInteractable, gateStep, cinematicPose, easeYaw, REGION_WATER,
} from './field.js';

const RADIUS = 0.35;           // body radius for collision (m)
const SNAP_DOWN = 0.4;         // stick to the ground when it drops less than this per frame
const INTERACT_EVERY = 0.12;   // seconds between interaction target scans
const REGION_EVERY = 0.25;     // seconds between region checks
const HAB_MARSH = 5, HAB_SHRUB = 10;

/** Density of scrub underfoot from the habitat byte (contract: core.Habitat ids). */
function shrubFor(habitat) {
  if (habitat === HAB_SHRUB) return 0.7;
  if (habitat === HAB_MARSH) return 0.3;
  return 0;
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * @param {object} ctx  the shared client context
 * @param {() => object} getTools  returns ctx.tools (read each frame; may be undefined)
 */
export function createController(ctx, getTools) {
  const { THREE, bus, net, state, input, camera } = ctx;

  const feet = new THREE.Vector3();
  const eye = new THREE.Vector3(0, EYE_HEIGHT, 0);
  const probe = new THREE.Vector3();

  const s = {
    yaw: 0, pitch: 0,
    vx: 0, vz: 0, vy: 0,
    grounded: true, onPlatform: false,
    crouching: false, sitting: false,
    gait: 'walk', move: 'still', speed: 0, stillTime: 0,
    stride: 0, bobAmp: 0, eyeH: EYE_HEIGHT, viewY: 0,
    noise: 0,
    spawned: false,      // a spawn/teleport position is known
    needsGround: true,   // waiting for terrain under the player to settle the height
    hintY: 0,            // height carried by the last teleport (platform lookup)
    jumpQueued: false,
    busy: false,         // a modal prompt (field note) is capturing the keyboard
  };
  const sprint = createSprintState();
  const gate = { safe: null, inside: false };
  const cine = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, init: false };
  let poseT = 0, interactT = 0, regionT = 0;
  let target = null;        // current interactable {id,label,verb}
  let lastRegion = null;

  // ---------------------------------------------------------------------------------
  // World queries (every call into another module is optional)

  const world = () => ctx.world;
  const heightAt = (x, z) => num(world()?.heightAt?.(x, z), 0);
  function loadedAt(x, z) {
    const w = world();
    if (!w) return true;                       // no world module: flat ground at y = 0
    if (typeof w.isLoaded !== 'function') return true;
    return !!w.isLoaded(x, z);
  }
  /** Highest walkable support under (x, z) for feet at height y. */
  function supportAt(x, z, y, out) {
    const ground = heightAt(x, z);
    let plat = null;
    try { plat = ctx.props?.platformHeightAt?.(x, z, y); } catch { plat = null; }
    if (typeof plat === 'number' && Number.isFinite(plat) && plat > ground - 0.01) {
      out.h = plat; out.platform = true;
    } else {
      out.h = ground; out.platform = false;
    }
    out.ground = ground;
    return out;
  }
  const sup = { h: 0, platform: false, ground: 0 };

  function surfaceHere() {
    if (s.onPlatform) return 'wood';
    if (heightAt(feet.x, feet.z) < -0.05) return 'water';
    return world()?.surfaceAt?.(feet.x, feet.z) || 'grass';
  }

  // ---------------------------------------------------------------------------------
  // Spawn / teleport

  function teleport(x, y, z, yaw) {
    feet.set(num(x, 0), num(y, 0), num(z, 0));
    s.hintY = feet.y;
    if (Number.isFinite(yaw)) s.yaw = wrapYaw(yaw);
    s.pitch = 0;
    s.vx = s.vz = s.vy = 0;
    s.grounded = true;
    s.sitting = false;
    s.spawned = true;
    s.needsGround = true;
    s.viewY = feet.y;
    s.speed = 0;
    gate.safe = null;
    eye.set(feet.x, feet.y + s.eyeH, feet.z);
  }

  bus.on('welcome', (w) => {
    // welcome.spawn is the saved position when a save exists, else the new-game start.
    const sp = w?.spawn;
    const pos = sp?.pos || w?.profile?.pos || w?.world?.home || { x: 0, y: 0, z: 0 };
    teleport(pos.x, pos.y, pos.z, num(sp?.yaw, num(w?.profile?.yaw, 0)));
    cine.init = false;
  });
  bus.on('net:teleport', (t) => {
    if (!t?.pos) return;
    teleport(t.pos.x, t.pos.y, t.pos.z, t.yaw);
  });

  // ---------------------------------------------------------------------------------
  // Actions

  bus.on('action:run', () => runKeyDown(sprint, ctx.time));
  bus.on('action-up:run', () => runKeyUp(sprint));
  bus.on('action:crouch', () => {
    if (s.busy) return;
    if (s.sitting) { s.sitting = false; s.crouching = true; return; }
    s.crouching = !s.crouching;
  });
  bus.on('action:sit', () => {
    if (s.busy || !s.grounded) return;
    s.sitting = !s.sitting;
    if (s.sitting) { s.crouching = false; }
  });
  bus.on('action:jump', () => { if (!s.busy) s.jumpQueued = true; });
  bus.on('action:interact', () => {
    if (s.busy || state.mode !== 'play' || !target) return;
    net.send('interact', { poi: target.id });
  });
  bus.on('mode', ({ mode }) => {
    if (mode !== 'play') setTarget(null);
    if (mode === 'mainmenu') cine.init = false;
  });

  function setTarget(it) {
    const id = it ? it.id : null;
    if ((target ? target.id : null) === id && (!it || (target.label === it.label && target.verb === it.verb))) return;
    target = it ? { id: it.id, label: it.label || '', verb: it.verb || '' } : null;
    bus.emit('interact:target', target);
  }

  // ---------------------------------------------------------------------------------
  // Per frame

  function readMove() {
    if (state.mode !== 'play' || s.busy) return { f: 0, r: 0 };
    const f = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    const r = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    return { f, r };
  }

  function look(tools) {
    const m = input.consumeMouse();
    if (state.mode !== 'play' || s.busy) return;
    if (!m.dx && !m.dy) return;
    const st = state.settings || {};
    const r = applyMouse(s.yaw, s.pitch, m.dx, m.dy, {
      sensitivity: st.sensitivity, invertY: st.invertY, scale: tools?.sensScale,
    });
    s.yaw = r.yaw; s.pitch = r.pitch;
  }

  function physics(dt, tools) {
    const stats = ctx.stats || {};
    const { f, r } = readMove();
    const moving = (f !== 0 || r !== 0);

    if (s.sitting && (moving || s.jumpQueued)) { s.sitting = false; s.jumpQueued = false; }

    // Wish direction: forward = HeadingDir(yaw), right = HeadingDir(yaw + π/2).
    const fw = headingDir(s.yaw);
    let wx = fw.x * f + -fw.z * r;
    let wz = fw.z * f + fw.x * r;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    const raised = !!tools?.raised;
    const focus = !!tools?.focus;
    s.gait = stepGait(sprint, {
      moving, runHeld: state.mode === 'play' && !s.busy && input.isDown('run'),
      crouching: s.crouching, canSprint: !raised && !focus,
    }, dt, num(stats.stamina, 6));

    // Terrain slowdown from the slope ahead, scrub and water underfoot.
    const ground = heightAt(feet.x, feet.z);
    const depth = s.onPlatform ? 0 : Math.max(0, -ground);
    // Deep-ish water makes crouching impossible (no swimming, no going under).
    if (s.crouching && depth > 0.6) s.crouching = false;

    let grade = 0;
    if (moving && !s.onPlatform) grade = (heightAt(feet.x + wx * 0.6, feet.z + wz * 0.6) - ground) / 0.6;
    const habitat = world()?.habitatAt?.(feet.x, feet.z);
    const tf = terrainFactor({
      grade: Math.max(0, grade), shrub: s.onPlatform ? 0 : shrubFor(habitat), depth, terrain: num(stats.terrain, 0),
    });
    const tSpeed = moving
      ? targetSpeed(s.crouching ? 'crouch' : s.gait, { moveSpeed: num(stats.moveSpeed, 1), terrainFactor: tf, focus, raised })
      : 0;

    // Smooth acceleration; little control while airborne.
    const tvx = wx * tSpeed, tvz = wz * tSpeed;
    const curSpeed = Math.hypot(s.vx, s.vz);
    const accel = tSpeed > curSpeed;
    const cdt = s.grounded ? dt : dt * 0.25;
    s.vx = approachVelocity(s.vx, tvx, cdt, accel);
    s.vz = approachVelocity(s.vz, tvz, cdt, accel);

    // Too steep to climb: remove the uphill component of the velocity, keep the rest so
    // the player slides along the hillside instead of sticking to it.
    if (!s.onPlatform && (s.vx || s.vz)) {
      const e = 0.5;
      const gx = (heightAt(feet.x + e, feet.z) - heightAt(feet.x - e, feet.z)) / (2 * e);
      const gz = (heightAt(feet.x, feet.z + e) - heightAt(feet.x, feet.z - e)) / (2 * e);
      const gl = Math.hypot(gx, gz);
      const vl = Math.hypot(s.vx, s.vz);
      if (gl > 1e-4 && vl > 1e-4) {
        const ux = gx / gl, uz = gz / gl;
        const along = s.vx * ux + s.vz * uz;          // m/s uphill
        if (along > 0 && tooSteep((along / vl) * gl)) { s.vx -= along * ux; s.vz -= along * uz; }
      }
    }

    // Horizontal move with collision.
    const ox = feet.x, oz = feet.z;
    let nx = ox + s.vx * dt, nz = oz + s.vz * dt;
    probe.set(nx, feet.y, nz);
    world()?.collide?.(probe, RADIUS);
    nx = probe.x; nz = probe.z;

    // Never walk onto terrain that is not loaded yet (held at the edge of what exists).
    if (!loadedAt(nx, nz)) { nx = ox; nz = oz; s.vx = 0; s.vz = 0; }

    // Wading: refuse steps that go deeper than ~1.2 m; slide along the shore instead.
    const depthAt = (x, z) => {
      if (supportAt(x, z, feet.y, sup).platform) return 0;
      return Math.max(0, -sup.ground);
    };
    const dFrom = depthAt(ox, oz);
    if (refuseWaterStep(dFrom, depthAt(nx, nz))) {
      if (!refuseWaterStep(dFrom, depthAt(nx, oz))) { nz = oz; s.vz = 0; }
      else if (!refuseWaterStep(dFrom, depthAt(ox, nz))) { nx = ox; s.vx = 0; }
      else { nx = ox; nz = oz; s.vx = 0; s.vz = 0; }
    }
    // Already too deep (teleported, or the water is deeper than it looked): the water
    // gently carries the player back toward the shallows (uphill on the lake bed).
    const dNow = depthAt(nx, nz);
    const push = waterPushBack(dNow);
    if (push > 0) {
      const e = 1;
      const gx = heightAt(nx + e, nz) - heightAt(nx - e, nz);
      const gz = heightAt(nx, nz + e) - heightAt(nx, nz - e);
      const gl = Math.hypot(gx, gz);
      if (gl > 1e-5) { nx += (gx / gl) * push * dt; nz += (gz / gl) * push * dt; }
    }

    // Region gate: a soft turn-back a few metres into a locked region type.
    const region = world()?.regionAt?.(nx, nz);
    const g = gateStep(gate, { x: nx, z: nz }, region, state.profile?.regions, dt);
    if (g.blocked) { s.vx *= 0.5; s.vz *= 0.5; }
    nx = g.x; nz = g.z;

    feet.x = nx; feet.z = nz;
    const moved = Math.hypot(nx - ox, nz - oz);

    // Vertical: stand on terrain or a prop surface, step up, fall, jump.
    supportAt(feet.x, feet.z, feet.y, sup);
    if (s.jumpQueued) {
      s.jumpQueued = false;
      if (s.grounded && state.mode === 'play') {
        if (s.crouching) s.crouching = false;              // first press stands up
        else if (dNow < 0.9) { s.vy = JUMP_SPEED; s.grounded = false; }
      }
    }
    if (s.grounded && s.vy <= 0) {
      if (sup.h >= feet.y - SNAP_DOWN && sup.h <= feet.y + STEP_UP) {
        feet.y = sup.h;                                   // walk, step up, stick to slopes
      } else if (sup.h < feet.y - SNAP_DOWN) {
        s.grounded = false; s.vy = 0;                     // walked off an edge
      } else {
        feet.y = sup.h;                                   // terrain rose: never sink into it
      }
    }
    if (!s.grounded) {
      s.vy -= GRAVITY * dt;
      feet.y += s.vy * dt;
      supportAt(feet.x, feet.z, feet.y, sup);
      if (feet.y <= sup.h) {
        s.noise = Math.max(s.noise, landingNoise(s.vy));
        if (s.vy < -2) bus.emit('footstep', { surface: sup.platform ? 'wood' : surfaceHereAt(sup), move: s.move === 'still' ? 'walk' : s.move, land: true });
        feet.y = sup.h; s.vy = 0; s.grounded = true;
      }
    }
    if (feet.y < sup.ground) feet.y = sup.ground;
    s.onPlatform = s.grounded && sup.platform;

    // Speed and move mode from what actually happened (collisions, gate, water).
    const actual = dt > 0 ? moved / dt : 0;
    s.speed += (actual - s.speed) * damp(12, dt);
    if (s.speed < 0.02) s.speed = 0;
    s.move = moveMode(s.speed, s.gait, s.crouching, s.sitting);
    s.stillTime = s.speed < STILL_SPEED ? s.stillTime + dt : 0;
    s.noise = Math.max(0, s.noise - dt * 2);

    // Head bob and footsteps.
    const bp = bobParams(s.grounded ? s.speed : 0, s.crouching, raised);
    s.bobAmp += (bp.amp - s.bobAmp) * damp(6, dt);
    if (bp.freq > 0) {
      const st = advanceStride(s.stride, bp.freq, dt);
      s.stride = st.phase;
      if (st.step && s.grounded) bus.emit('footstep', { surface: surfaceHere(), move: s.move });
    } else if (s.bobAmp < 0.002) {
      s.stride = 0;
    }
  }

  function surfaceHereAt(sp) {
    if (sp.ground < -0.05) return 'water';
    return world()?.surfaceAt?.(feet.x, feet.z) || 'grass';
  }

  function updateEye(dt) {
    s.eyeH += (eyeHeightFor(s.crouching, s.sitting) - s.eyeH) * damp(7, dt);
    // Step-ups and stairs are smoothed; falls are followed closely.
    s.viewY += (feet.y - s.viewY) * damp(s.grounded ? 14 : 30, dt);
    if (s.viewY < feet.y - 0.6) s.viewY = feet.y - 0.6;
    if (s.viewY > feet.y + 0.6) s.viewY = feet.y + 0.6;
    eye.set(feet.x, s.viewY + s.eyeH, feet.z);
  }

  function scanInteract(dt) {
    interactT -= dt;
    if (interactT > 0) return;
    interactT = INTERACT_EVERY;
    if (state.mode !== 'play' || s.busy) { setTarget(null); return; }
    let list = null;
    try { list = ctx.props?.interactables?.(); } catch { list = null; }
    setTarget(pickInteractable(list, eye, s.yaw, s.pitch));
  }

  function checkRegion(dt) {
    regionT -= dt;
    if (regionT > 0) return;
    regionT = REGION_EVERY;
    if (!loadedAt(feet.x, feet.z)) return;
    const r = world()?.regionAt?.(feet.x, feet.z);
    if (typeof r !== 'number' || r === REGION_WATER || r === lastRegion) return;
    lastRegion = r;
    bus.emit('region:enter', { region: r });
  }

  function sendPose(dt, tools) {
    if (!state.welcome || !s.spawned) return;
    poseT += dt;
    if (poseT < poseInterval(state.mode)) return;
    poseT = 0;
    net.send('pose', buildPose({
      eye, yaw: s.yaw, pitch: s.pitch, speed: s.speed, move: s.move,
      crouch: s.crouching, sit: s.sitting, focus: !!tools?.focus,
      tool: tools?.active || 'none', raised: !!tools?.raised,
      fov: num(tools?.fov, camera.fov), zoom: num(tools?.zoom, 1), sharp: num(tools?.sharp, 1),
      noise: s.noise,
    }));
  }

  function cinematic(dt) {
    const center = state.pois?.cabin?.pos || state.welcome?.world?.home || feet;
    cine.t += dt;
    const p = cinematicPose(cine.t, center);
    const ground = Math.max(heightAt(p.x, p.z), 0);
    const y = ground + p.lift + 1;
    if (!cine.init) {
      cine.init = true;
      cine.x = p.x; cine.z = p.z; cine.y = y; cine.yaw = p.yaw; cine.pitch = p.pitch;
    }
    // Chunks stream in under the drifting camera; ease height so they never pop it.
    const k = damp(1.5, dt);
    cine.x = p.x; cine.z = p.z;
    cine.y += (y - cine.y) * k;
    cine.yaw = easeYaw(cine.yaw, p.yaw, k);
    cine.pitch += (p.pitch - cine.pitch) * k;
    camera.position.set(cine.x, cine.y, cine.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(cine.pitch, -cine.yaw, 0, 'YXZ');
  }

  // ---------------------------------------------------------------------------------

  const controller = {
    feet, eye, s, sprint,
    teleport,
    get target() { return target; },
    /** Steps everything except writing the camera. */
    update(dt) {
      const tools = getTools();
      look(tools);
      if (!s.spawned) return;
      if (s.needsGround) {
        // Hold position until the terrain under the player exists (contract §5.2).
        if (!loadedAt(feet.x, feet.z)) return;
        supportAt(feet.x, feet.z, s.hintY + 0.2, sup);
        feet.y = sup.h;
        s.onPlatform = sup.platform;
        s.viewY = feet.y;
        s.needsGround = false;
      }
      if (!loadedAt(feet.x, feet.z)) {
        // The ground was unloaded beneath us (should not happen): freeze rather than fall.
        s.vx = s.vz = s.vy = 0;
      } else {
        physics(dt, tools);
      }
      updateEye(dt);
      scanInteract(dt);
      checkRegion(dt);
      sendPose(dt, tools);
    },
    /** Writes the camera: the cinematic drift in the main menu, else the eye + sway. */
    applyCamera(dt, sway) {
      if (state.mode === 'mainmenu') { cinematic(dt); return; }
      const bob = bobOffset(s.stride, s.bobAmp);
      const side = Math.sin(s.stride * Math.PI * 2) * s.bobAmp * 0.35;
      const right = headingDir(s.yaw + Math.PI / 2);
      camera.position.set(eye.x + right.x * side, eye.y + bob, eye.z + right.z * side);
      const yaw = s.yaw + (sway?.yaw || 0);
      const pitch = clampPitch(s.pitch + (sway?.pitch || 0));
      camera.rotation.order = 'YXZ';
      camera.rotation.set(pitch, -yaw, 0, 'YXZ');
    },
  };

  /** Public API published as ctx.player (contract §5.2). */
  controller.api = {
    get pos() { return eye; },
    get feet() { return feet; },
    get yaw() { return s.yaw; },
    set yaw(v) { if (Number.isFinite(v)) s.yaw = wrapYaw(v); },
    get pitch() { return s.pitch; },
    set pitch(v) { if (Number.isFinite(v)) s.pitch = clampPitch(v); },
    get speed() { return s.speed; },
    get move() { return s.move; },
    get crouching() { return s.crouching; },
    get sitting() { return s.sitting; },
    get stamina() { return sprint.stamina; },
    get sprinting() { return sprint.sprinting; },
    get grounded() { return s.grounded; },
    get onPlatform() { return s.onPlatform; },
    get stillTime() { return s.stillTime; },
    get ready() { return s.spawned && !s.needsGround; },
    get target() { return target; },
    teleport(x, y, z, yaw) { teleport(x, y, z, yaw); },
  };

  return controller;
}
