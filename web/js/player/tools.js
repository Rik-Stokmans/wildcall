// The field instruments (ctx.tools): binoculars, camera, recorder and focused listening
// (contract §5.2, spec §5.4, §6.2, §9.2). The numbers come from optics.js / field.js;
// this file holds the per-frame state, the input handling, the network messages and
// drives the overlays in #tool-overlay.
import {
  clampZoom, wheelZoom, fovFor, sensitivityScale, raiseTime, swayAmplitude, swayOffset,
  shakeAmount, sharpness, stepFocus, blurPx, lowLightBrightness, focusState, stepRaise,
  isRaised, burstInterval, blendFov, opticStats, breathFactor, zoomRange, proneRaiseTime,
} from './optics.js';
import {
  buildPhoto, outOfFilm, outOfFilmText, filmLeft, focusTarget, recorderHint, recResultText, TOOLS, FOCUS_FAR,
} from './field.js';
import { lookDir } from './look.js';
import { windSway } from './mantle.js';
import { toolSlot, missingToolText } from './field.js';
import { createOverlay } from './overlay.js';

const DEG = Math.PI / 180;
const FOCUS_PROBE_EVERY = 1 / 15;   // seconds between focus-distance probes
const SPECTRO_EVERY = 1 / 30;       // spectrogram columns per second
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const smooth = (a) => a * a * (3 - 2 * a);

/**
 * @param {object} ctx
 * @param {object} player  the controller from controller.js (needs .api, .s, .eye)
 */
export function createTools(ctx, player) {
  const { bus, net, state, camera, canvas } = ctx;
  const overlay = createOverlay(document.getElementById('tool-overlay'));

  const t = {
    active: 'none',
    rmb: false, lmb: false, lmbHeld: 0,
    raiseAmt: 0,
    zooms: { binoculars: 0, camera: 1 },   // 0 = not yet initialised from stats
    fov: num(state.settings?.fov, 70),
    zoom: 1,
    sharp: 1,
    focusDist: 20, targetDist: 20, probeT: 0,
    swayAmp: 0, sway: { yaw: 0, pitch: 0 }, shake: 0,
    sensScale: 1,
    recording: false, recStart: 0, recState: null, recStateAt: 0,
    focus: false,
    nextShot: 0, pendingShots: 0,
    filter: '',
    specT: 0,
    emitted: '',
    visible: true,
  };

  const baseFov = () => num(state.settings?.fov, 70);
  const optic = () => t.active === 'binoculars' || t.active === 'camera';
  const raisedNow = () => {
    if (optic()) return isRaised(t.raiseAmt);
    if (t.active === 'recorder') return t.recording || (t.rmb && state.mode === 'play');
    return false;
  };

  function emitTool() {
    const raised = raisedNow();
    const key = t.active + ':' + raised;
    if (key === t.emitted) return;
    t.emitted = key;
    bus.emit('tool', { active: t.active, raised });
  }

  // ---------------------------------------------------------------------------------
  // Selecting

  /** Is the instrument's equipment slot filled? (No binoculars, no binoculars view.) */
  const hasTool = (name) => {
    const slot = toolSlot(name);
    return !slot || !!state.profile?.equipped?.[slot];
  };

  function select(name) {
    if (!TOOLS.includes(name)) return false;
    if (name === t.active) return true;
    // Tools need their slot: a kind word instead of an empty viewfinder. The equipment
    // screen says the same next to an empty optics / camera / audio slot.
    if (!hasTool(name)) {
      overlay.message(missingToolText(name), 2.6);
      ctx.audio?.uiSound?.('error');
      return false;
    }
    if (t.recording && name !== 'recorder') stopRecording();
    t.active = name;
    t.raiseAmt = 0;           // a new instrument starts lowered
    t.lmb = false;
    if (optic()) {
      // Lenses keep their own magnification; the first time, start at the widest.
      const [lo] = zoomRange(name, ctx.stats);
      if (!t.zooms[name]) t.zooms[name] = lo;
    }
    ctx.audio?.uiSound?.('click');
    emitTool();
    return true;
  }

  for (const name of ['binoculars', 'camera', 'recorder', 'none']) {
    bus.on('action:tool-' + name, () => {
      if (state.mode !== 'play' || player.s.busy) return;
      // Pressing the key of the tool in hand puts it away.
      select(t.active === name ? 'none' : name);
    });
  }

  // ---------------------------------------------------------------------------------
  // Focused listening (hold F)

  function setFocus(on) {
    on = !!on;
    if (t.focus === on) return;
    t.focus = on;
    try { ctx.audio?.setFocus?.(on); } catch (err) { console.warn('[tools] audio.setFocus', err); }
    overlay.listening(on);
    bus.emit('focus', { on });
  }
  bus.on('action:focus', () => { if (state.mode === 'play' && !player.s.busy) setFocus(true); });
  bus.on('action-up:focus', () => setFocus(false));

  // ---------------------------------------------------------------------------------
  // Mouse

  bus.on('mouse:down', ({ button }) => {
    if (state.mode !== 'play' || player.s.busy) return;
    if (button === 2) { t.rmb = true; return; }
    if (button !== 0) return;
    t.lmb = true; t.lmbHeld = 0;
    if (t.active === 'recorder') { if (t.recording) stopRecording(); else startRecording(); }
    else if (t.active === 'camera') t.nextShot = Math.min(t.nextShot, ctx.time); // shoot this frame if ready
  });
  bus.on('mouse:up', ({ button }) => {
    if (button === 2) t.rmb = false;
    if (button === 0) { t.lmb = false; t.lmbHeld = 0; }
  });
  bus.on('mouse:wheel', ({ dy }) => {
    if (state.mode !== 'play' || !optic() || t.raiseAmt < 0.3) return;
    t.zooms[t.active] = wheelZoom(t.active, t.zooms[t.active] || 1, dy, ctx.stats);
  });

  // ---------------------------------------------------------------------------------
  // Camera

  function shoot() {
    const film = state.profile?.film;
    if (outOfFilm(film, t.pendingShots)) {
      overlay.message(outOfFilmText(state.profile), 3);
      ctx.audio?.uiSound?.('error');
      t.nextShot = ctx.time + 0.8;
      return;
    }
    const yaw = player.api.yaw + t.sway.yaw;
    const pitch = player.api.pitch + t.sway.pitch;
    let img = '';
    try { img = ctx.capture?.(640) || ''; } catch (err) { console.warn('[tools] capture failed', err); }
    net.send('photo', buildPhoto({
      eye: player.eye, yaw, pitch, fov: t.fov, aspect: camera.aspect,
      sharp: t.sharp, shake: t.shake, img,
    }));
    t.pendingShots++;
    bus.emit('photo:taken', { img });
    ctx.audio?.uiSound?.('shutter');
    overlay.shutter();
    t.nextShot = ctx.time + burstInterval(num(ctx.stats?.camBurst, 1));
  }

  bus.on('net:photoResult', (r) => {
    t.pendingShots = Math.max(0, t.pendingShots - 1);
    if (r?.noFilm) overlay.message(outOfFilmText(state.profile), 3);
    else if (r?.notes?.length && t.active === 'camera') overlay.message(r.notes[0], 2.2);
  });
  bus.on('profile', () => {
    t.pendingShots = 0; clampZooms();
    // The instrument in hand was unequipped (equipment screen, storage): put it away.
    if (t.active !== 'none' && !hasTool(t.active)) {
      if (t.recording) stopRecording();
      t.active = 'none'; t.raiseAmt = 0; t.lmb = false; t.rmb = false;
      emitTool();
    }
  });

  function clampZooms() {
    for (const k of ['binoculars', 'camera']) {
      if (t.zooms[k]) t.zooms[k] = clampZoom(k, t.zooms[k], ctx.stats);
    }
  }

  // ---------------------------------------------------------------------------------
  // Recorder

  function startRecording() {
    if (t.recording) return;
    // The server refuses recStart without an audio device and would never answer
    // with recState/recResult, leaving the panel stuck on "recording".
    if (!state.profile?.equipped?.audio) {
      overlay.message('No recorder equipped', 1.8);
      ctx.audio?.uiSound?.('error');
      return;
    }
    t.recording = true;
    t.recStart = ctx.time;
    t.recStateAt = ctx.time;
    t.recState = null;
    overlay.clearSpectrogram();
    net.send('recStart', {});
    ctx.audio?.uiSound?.('click');
    emitTool();
  }
  function stopRecording() {
    if (!t.recording) return;
    t.recording = false;
    net.send('recStop', {});
    ctx.audio?.uiSound?.('click');
    emitTool();
  }
  bus.on('net:recState', (r) => { if (t.recording) { t.recState = r; t.recStateAt = ctx.time; } });
  // A refused start (error) or a recording the server dropped without a recResult
  // (audio unequipped, resting) stops the 4 Hz recState stream: give up after 2.5 s.
  function recWatchdog() {
    if (t.recording && ctx.time - (t.recStateAt || 0) > 2.5) {
      t.recording = false; t.recState = null; emitTool();
    }
  }
  bus.on('net:recResult', (r) => {
    t.recording = false; t.recState = null; emitTool();
    // The profile with a brand-new mystery label follows the result: read it a beat later.
    setTimeout(() => overlay.message(recResultText(r, state.profile, state.speciesById), 4), 150);
  });

  // ---------------------------------------------------------------------------------
  // Modes: tools drop while a screen is open

  bus.on('mode', ({ mode }) => {
    if (mode === 'play') return;
    t.rmb = false; t.lmb = false;
    setFocus(false);
    if (mode === 'mainmenu') { stopRecording(); select('none'); }
  });
  bus.on('resize', () => overlay.resize());
  bus.on('welcome', () => { clampZooms(); });

  // ---------------------------------------------------------------------------------
  // Per frame

  function probeFocus(dt) {
    t.probeT -= dt;
    if (t.probeT > 0) return;
    t.probeT = FOCUS_PROBE_EVERY;
    const eye = player.eye;
    const yaw = player.api.yaw + t.sway.yaw, pitch = player.api.pitch + t.sway.pitch;
    let terrain = null;
    try {
      const d = lookDir(yaw, pitch);
      const hit = ctx.world?.raycastTerrain?.(eye, d, FOCUS_FAR);
      if (hit) terrain = Math.hypot(hit.x - eye.x, hit.y - eye.y, hit.z - eye.z);
    } catch { terrain = null; }
    let birds = null;
    try { birds = ctx.birds?.list?.(); } catch { birds = null; }
    t.targetDist = focusTarget(eye, yaw, pitch, terrain, birds);
  }

  function setCanvasBlur(px) {
    const f = px > 0 ? `blur(${px}px)` : '';
    if (f === t.filter) return;
    t.filter = f;
    canvas.style.filter = f;
  }

  function update(dt) {
    recWatchdog();
    const playing = state.mode === 'play' && !player.s.busy;
    if (!playing) { t.rmb = false; t.lmb = false; }
    const stats = ctx.stats || {};
    const o = opticStats(stats);
    const base = baseFov();
    const isOptic = optic();

    // Raise / lower at the speed the equipment allows (weight, camReady).
    t.raiseAmt = isOptic
      ? stepRaise(t.raiseAmt, playing && t.rmb, proneRaiseTime(raiseTime(t.active, stats), !!player.api.prone), dt)
      : 0;
    const up = isOptic && t.raiseAmt > 0;
    if (t.lmb) t.lmbHeld += dt;

    // Magnification and field of view.
    const zoom = isOptic ? clampZoom(t.active, t.zooms[t.active] || 1, stats) : 1;
    if (isOptic) t.zooms[t.active] = zoom;
    const toolFov = fovFor(t.active, zoom, stats, base);
    t.fov = up ? blendFov(base, toolFov, smooth(t.raiseAmt)) : base;
    if (Math.abs(camera.fov - t.fov) > 1e-4) { camera.fov = t.fov; camera.updateProjectionMatrix(); }
    t.zoom = isOptic && isRaised(t.raiseAmt) ? zoom : 1;
    t.sensScale = sensitivityScale(t.fov, base);

    // Hand sway: grows with zoom, shrinks with stability, posture and a held breath.
    let amp = 0;
    if (up) {
      amp = swayAmplitude(t.active, zoom, stats, {
        crouching: player.api.crouching, sitting: player.api.sitting, prone: !!player.api.prone,
        speed: player.api.speed, stillTime: player.api.stillTime,
      }) * t.raiseAmt;
      if (t.active === 'binoculars' && t.lmb) amp *= breathFactor(t.lmbHeld);
      // Wind tugs at a raised instrument (spec §20.2); a held breath still steadies it.
      amp *= windSway(num(state.env?.wind, 0));
    }
    t.swayAmp += (amp - t.swayAmp) * (1 - Math.exp(-4 * dt));
    const off = swayOffset(ctx.time, t.swayAmp, 0.37);
    t.sway.yaw = off.yaw * DEG; t.sway.pitch = off.pitch * DEG;
    t.shake = up ? shakeAmount(t.swayAmp, t.fov, player.api.speed) : 0;

    // Optical focus: the lens chases the distance at the view centre at the stat's speed.
    if (up) {
      probeFocus(dt);
      if (t.raiseAmt > 0.5) {
        const speed = t.active === 'camera' ? o.camFocus : o.binoFocus;
        t.focusDist = stepFocus(t.focusDist, t.targetDist, speed, dt);
      }
      t.sharp = sharpness(t.focusDist, t.targetDist, zoom);
    } else {
      t.sharp = 1;
    }
    const clarity = t.active === 'binoculars' ? o.binoClarity : 0.65;
    setCanvasBlur(up ? Math.round(blurPx(t.sharp, clarity) * t.raiseAmt * 20) / 20 : 0);

    // Burst: holding the shutter keeps shooting at camBurst frames per second.
    if (playing && t.active === 'camera' && t.lmb && isRaised(t.raiseAmt) && ctx.time >= t.nextShot) shoot();

    drawOverlays(dt, playing, stats, o, zoom);
    emitTool();
  }

  function drawOverlays(dt, playing, stats, o, zoom) {
    if (!playing && state.mode !== 'play') {
      if (t.visible) { overlay.hideAll(); t.visible = false; }
      return;
    }
    t.visible = true;
    overlay.show(t.active, optic() ? t.raiseAmt : (raisedNow() ? 1 : 0.4), { clarity: o.binoClarity });
    if (t.active === 'binoculars') {
      const daylight = num(ctx.sky?.daylight, num(state.env?.light, 1));
      overlay.bino({ zoom, brightness: lowLightBrightness(daylight, o.lowLight) });
    } else if (t.active === 'camera') {
      const film = state.profile?.film;
      overlay.camera({
        zoom,
        filmLeft: filmLeft(film, t.pendingShots),
        filmCap: num(film?.cap, 0),
        focus: focusState(t.sharp),
        noFilm: outOfFilm(film, t.pendingShots),
      });
    } else if (t.active === 'recorder') {
      const r = t.recording ? t.recState : null;
      const live = !t.recording ? num(ctx.audio?.level, 0) : num(r?.level, 0);
      const spectro = num(stats.spectrogram, 0) >= 1;
      overlay.recorder({
        recording: t.recording,
        seconds: t.recording ? Math.max(ctx.time - t.recStart, num(r?.seconds, 0)) : 0,
        level: live,
        noise: num(r?.noise, 0),
        onAxis: num(r?.onAxis, 1),
        signal: !!r?.signal,
        idle: !t.recording,
        spectrogram: spectro,
        hint: recorderHint(t.recording, r, num(stats.recFocus, 0), 'Click'),
      });
      if (spectro) {
        t.specT -= dt;
        if (t.specT <= 0) {
          t.specT = SPECTRO_EVERY;
          let bins = null;
          try { bins = ctx.audio?.getSpectrum?.(); } catch { bins = null; }
          overlay.spectrogramColumn(bins);
        }
      }
    }
  }

  /** Public API published as ctx.tools (contract §5.2). */
  const api = {
    get active() { return t.active; },
    get raised() { return raisedNow(); },
    /** 0..1 how far the optic is brought up to the eye. */
    get raiseAmount() { return t.raiseAmt; },
    /** Current magnification (1 = naked eye; the tool's zoom once fully raised). */
    get zoom() { return t.zoom; },
    /** Selected magnification of the tool in hand (even while lowered). */
    get toolZoom() { return optic() ? (t.zooms[t.active] || 1) : 1; },
    get fov() { return t.fov; },
    get sharp() { return t.sharp; },
    get shake() { return t.shake; },
    get recording() { return t.recording; },
    get focus() { return t.focus; },
    /** Mouse-look multiplier so zoomed views pan at a comfortable rate. */
    get sensScale() { return t.sensScale; },
    /** Current hand-sway offset in radians {yaw, pitch} (applied to the camera). */
    get sway() { return t.sway; },
    select,
    update,
  };
  return api;
}
