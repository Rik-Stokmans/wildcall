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
  findLedge, mantlePose, mantleDuration, pushClimb, collectTops, topAt, weatherSlow,
} from './mantle.js';
import {
  buildPose, poseInterval, pickInteractable, gateStep, cinematicPose, chooseCinematicPath, cinematicObstacles, easeYaw, REGION_WATER,
} from './field.js';

const RADIUS = 0.35;           // body radius for collision (m)
const SNAP_DOWN = 0.4;         // stick to the ground when it drops less than this per frame
const INTERACT_EVERY = 0.12;   // seconds between interaction target scans
const REGION_EVERY = 0.25;     // seconds between region checks
const HAB_MARSH = 5, HAB_SHRUB = 10;
const TOPS_EVERY = 0.4;        // seconds between refreshes of the climbable rock/stump tops nearby
const TOPS_REACH = 10;         // metres around the player searched for them

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
    onRock: null,        // the rock/stump top the player stands on ({x, z, y, r}) or null
    pushT: 0,            // seconds spent pushing forward against an obstacle (auto-climb)
    climbAgain: 0,       // time before another climb attempt may be probed
  };
  // A climb in progress: {t, dur, from:{x,y,z}, to:{x,y,z}} or null (spec §19.1).
  let mantle = null;
  // Climbable rock and stump tops around the player (refreshed a few times a second).
  const tops = [];
  let topsT = 0, topsX = Infinity, topsZ = Infinity;
  const sprint = createSprintState();
  const gate = { safe: null, inside: false };
  const cine = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, init: false, path: null, planned: false };
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
    // The top of a boulder or stump the player has climbed onto.
    const top = tops.length ? topAt(tops, x, z, y) : null;
    out.rock = null;
    if (top && top.y > out.h) { out.h = top.y; out.platform = false; out.rock = top; }
    out.ground = ground;
    return out;
  }
  const sup = { h: 0, platform: false, ground: 0, rock: null };
  const climbSup = { h: 0, platform: false, ground: 0, rock: null };
  const climbSupport = (x, z, y) => (loadedAt(x, z) ? supportAt(x, z, y, climbSup).h : NaN);

  function refreshTops(dt) {
    topsT -= dt;
    const moved = Math.hypot(feet.x - topsX, feet.z - topsZ);
    if (topsT > 0 && moved < 3) return;
    topsT = TOPS_EVERY; topsX = feet.x; topsZ = feet.z;
    tops.length = 0;
    const w = world();
    const size = w?.chunkSize;
    if (!size || typeof w.vegOf !== 'function') return;
    for (let cx = Math.floor((feet.x - TOPS_REACH) / size); cx <= Math.floor((feet.x + TOPS_REACH) / size); cx++) {
      for (let cz = Math.floor((feet.z - TOPS_REACH) / size); cz <= Math.floor((feet.z + TOPS_REACH) / size); cz++) {
        let veg = null;
        try { veg = w.vegOf(cx, cz); } catch { veg = null; }
        if (veg) collectTops(veg, feet.x, feet.z, TOPS_REACH, tops);
      }
    }
  }

  /** Try to climb onto what is straight ahead. Returns true when a climb starts. */
  function tryMantle() {
    if (mantle || !s.grounded || s.sitting || ctx.time < s.climbAgain) return false;
    s.climbAgain = ctx.time + 0.4;
    const dir = headingDir(s.yaw);
    const to = findLedge(feet, dir, climbSupport);
    if (!to) return false;
    if (s.crouching) s.crouching = false;
    mantle = { t: 0, dur: mantleDuration(to.rise), from: { x: feet.x, y: feet.y, z: feet.z }, to };
    s.vx = s.vz = s.vy = 0;
    s.pushT = 0;
    s.noise = Math.max(s.noise, 0.15); // a soft scuffle, not a crash
    bus.emit('footstep', { surface: surfaceHere(), move: 'walk' });
    return true;
  }

  function stepMantle(dt) {
    mantle.t += dt / mantle.dur;
    const p = mantlePose(mantle.t, mantle.from, mantle.to);
    feet.set(p.x, p.y, p.z);
    s.speed += (0.8 - s.speed) * damp(8, dt);
    if (mantle.t >= 1) {
      supportAt(feet.x, feet.z, feet.y + 0.05, sup);
      feet.y = Math.max(sup.h, sup.ground);
      s.grounded = true; s.vy = 0;
      s.onPlatform = sup.platform;
      s.onRock = sup.rock;
      bus.emit('footstep', { surface: s.onRock ? 'rock' : surfaceHere(), move: 'walk', land: true });
      mantle = null;
    }
  }

  function surfaceHere() {
    if (s.onRock) return 'rock';
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
    s.onRock = null; s.pushT = 0;
    mantle = null;
    topsT = 0;
    gate.safe = null;
    eye.set(feet.x, feet.y + s.eyeH, feet.z);
  }

  bus.on('welcome', (w) => {
    // welcome.spawn is the saved position when a save exists, else the new-game start.
    const sp = w?.spawn;
    const pos = sp?.pos || w?.profile?.pos || w?.world?.home || { x: 0, y: 0, z: 0 };
    teleport(pos.x, pos.y, pos.z, num(sp?.yaw, num(w?.profile?.yaw, 0)));
    cine.init = false;
    cine.path = null; cine.planned = false; cine.t = 0;
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
    // Rain and strong wind slow the walk a little unless rain gear covers it (spec §20.2).
    const wx2 = weatherSlow(state.env, num(stats.rainProof, 0));
    const tSpeed = moving
      ? targetSpeed(s.crouching ? 'crouch' : s.gait, { moveSpeed: num(stats.moveSpeed, 1) * wx2, terrainFactor: tf, focus, raised })
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
    // Standing on a boulder or stump: its own collider would shove the player off the
    // top, so a push pointing away from its centre is ignored.
    const rk = s.onRock;
    if (rk && (probe.x !== nx || probe.z !== nz)) {
      const px = probe.x - nx, pz = probe.z - nz;
      if (px * (nx - rk.x) + pz * (nz - rk.z) >= 0) { probe.x = nx; probe.z = nz; }
    }
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
        // Jump while walking into a ledge, rock or low wall: climb onto it instead.
        if (f > 0 && tryMantle()) return;
        if (s.crouching) s.crouching = false;              // first press stands up
        else if (dNow < 0.9) { s.vy = JUMP_SPEED; s.grounded = false; }
      }
    }
    // Or simply keep walking into it for a moment.
    if (state.mode === 'play' && !s.busy) {
      const want = moving ? Math.hypot(tvx, tvz) : 0;
      const pc = pushClimb(s.pushT, f, want > 0.3 ? moved / Math.max(dt, 1e-4) : 9, s.grounded, dt);
      s.pushT = pc.pushT;
      if (pc.go && tryMantle()) return;
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
    s.onRock = s.grounded && sup.rock && Math.abs(feet.y - sup.rock.y) < 0.06 ? sup.rock : null;

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
    // On the title screen the player is not in the world yet: no pose, so the server
    // neither hears birds for them (no mysteries before play) nor runs their clock.
    if (state.mode === 'mainmenu') return;
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

  /** Trees around the centre from the loaded vegetation, or null while chunks are missing. */
  function cineObstacles(center, reach) {
    const w = world();
    const size = w?.chunkSize;
    if (!size || !w.vegOf) return [];
    const out = [];
    for (let cx = Math.floor((center.x - reach) / size); cx <= Math.floor((center.x + reach) / size); cx++) {
      for (let cz = Math.floor((center.z - reach) / size); cz <= Math.floor((center.z + reach) / size); cz++) {
        const veg = w.vegOf(cx, cz);
        if (!veg) return null;
        cinematicObstacles(veg, out);
      }
    }
    return out;
  }

  function cinematic(dt) {
    const center = state.pois?.cabin?.pos || state.welcome?.world?.home || feet;
    // Plan the path once the vegetation around the cabin is known (re-planning only
    // while the menu is still fading in, so the camera never jumps in view).
    if (!cine.path || (!cine.planned && cine.t < 2)) {
      const obs = cineObstacles(center, 52);
      cine.planned = !!obs;
      cine.path = chooseCinematicPath(center, obs || []);
    }
    cine.t += dt;
    const p = cinematicPose(cine.t, center, cine.path);
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
      refreshTops(dt);
      if (!loadedAt(feet.x, feet.z)) {
        // The ground was unloaded beneath us (should not happen): freeze rather than fall.
        s.vx = s.vz = s.vy = 0;
      } else if (mantle) {
        stepMantle(dt);
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
    /** True while climbing onto a ledge (spec §19.1). */
    get climbing() { return !!mantle; },
    get stillTime() { return s.stillTime; },
    get ready() { return s.spawned && !s.needsGround; },
    get target() { return target; },
    teleport(x, y, z, yaw) { teleport(x, y, z, yaw); },
  };

  return controller;
}
