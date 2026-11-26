// WILDCALL client entry point. Builds the shared context (ctx), loads every feature
// module, connects to the Go server and runs the frame loop.
//
// Module contract (docs/contract.md §Client modules): each module file default-exports
//   { name, init(ctx), update?(dt, ctx), lateUpdate?(dt, ctx) }
// init may be async. A module publishes its public API as ctx[name] inside init.
// All modules are initialised BEFORE the welcome message arrives; react to the bus
// event 'welcome' to build world-dependent content.
import * as THREE from 'three';
import { createBus } from './core/bus.js';
import { createNet } from './core/net.js';
import { createState } from './core/state.js';
import { createInput } from './core/input.js';
import { createUI } from './core/ui.js';

// Load order matters only for ctx.<name> availability inside init(); cross-module calls
// should happen after 'welcome' or be guarded with optional chaining.
const MODULES = [
  './world/index.js',        // ctx.world   terrain, vegetation, water, chunk streaming
  './sky/index.js',          // ctx.sky     sky dome, sun/moon, fog, lighting, weather FX
  './fx/index.js',           // ctx.post    post-processing (bloom, grading, light shafts); owns the final render
  './props/index.js',        // ctx.props   structures, NPCs, collectibles, lures, trail markers
  './birds/index.js',        // ctx.birds   procedural bird models + animation
  './nests/index.js',        // ctx.nests   nests in trees, shrubs, reeds, banks and ledges
  './forage/index.js',       // ctx.forage  forage plants, picking, cooking, buffs
  './player/index.js',       // ctx.player  first-person controller + ctx.tools
  './audio/index.js',        // ctx.audio   spatial audio, call synth, ambience, music
  './narrator/index.js',     // ctx.narrator  spoken narration + captions
  './ui/kit.js',             // ctx.kit     shared UI kit (icons, bird illustrations, widgets)
  './ui/hud/index.js',       // HUD, clue panel, toasts, prompts, quest tracker
  './ui/encounter/index.js', // observation & identification, dialogue, rewards, rare item, region, rank-up
  './ui/menu/index.js',      // main menu + game menu (character, skills, inventory, equipment, rank, settings)
  './ui/journal/index.js',   // journal, map, quest log, collection
  './ui/base/index.js',      // home base (cabin stations) + shop
];

const canvas = document.getElementById('view');
const bootEl = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');
const setBoot = (t) => { bootStatus.textContent = t; };

function fatal(err) {
  console.error(err);
  bootEl.classList.remove('done');
  bootStatus.classList.add('boot-error');
  bootStatus.textContent = String(err?.message || err);
}

async function boot() {
  const bus = createBus();
  const state = createState(bus);
  const input = createInput(bus, state, canvas);
  const net = createNet(bus);
  const ui = createUI(bus, state, input);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(state.settings.fov, 16 / 9, 0.08, 2600);
  camera.rotation.order = 'YXZ';
  scene.add(camera); // so modules can parent view-space objects to the camera

  const applyQuality = () => {
    const q = state.settings.quality;
    const cap = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    resize();
  };
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    bus.emit('resize', { w, h });
  }
  window.addEventListener('resize', resize);
  bus.on('settings', ({ key }) => { if (key === 'quality') applyQuality(); });

  const captureCanvas = document.createElement('canvas');
  const ctx = {
    THREE, renderer, scene, camera, canvas,
    bus, net, state, input, ui,
    /** Seconds since boot (monotonic, paused never). */
    time: 0,
    /** Shorthand for the current core.Stats ({} before welcome). */
    get stats() { return state.stats; },
    /**
     * Render the current view and return it as a JPEG data URL (for photographs).
     * @param {number} width  output width in px (height follows the aspect ratio)
     * @param {number} quality  JPEG quality 0..1
     * @param {HTMLElement[]} hide  elements to ignore — only the 3D canvas is captured anyway
     */
    capture(width = 640, quality = 0.82) {
      renderFrame(0);
      const h = Math.round(width / camera.aspect);
      captureCanvas.width = width; captureCanvas.height = h;
      captureCanvas.getContext('2d').drawImage(canvas, 0, 0, width, h);
      return captureCanvas.toDataURL('image/jpeg', quality);
    },
  };
  window.wildcall = ctx; // debugging / automated tests

  // The post-processing module (ctx.post), when present, owns the final render so it
  // can add bloom, colour grading and light shafts; otherwise draw the scene directly.
  function renderFrame(dt) {
    if (ctx.post && typeof ctx.post.render === 'function') {
      try { ctx.post.render(dt); return; } catch (err) { console.error('[post] render threw; falling back', err); ctx.post = null; }
    }
    renderer.render(scene, camera);
  }

  applyQuality();

  // --- load modules -------------------------------------------------------
  const modules = [];
  for (const path of MODULES) {
    setBoot('Loading ' + path.replace('./', '').replace('/index.js', '').replace('.js', '') + '…');
    try {
      const mod = (await import(path)).default;
      if (!mod || typeof mod.init !== 'function') throw new Error('module has no default export with init()');
      await mod.init(ctx);
      modules.push(mod);
    } catch (err) {
      // A broken module must not take the whole game down; log loudly and carry on.
      console.error(`[boot] module ${path} failed to load`, err);
      bus.emit('module:error', { path, error: String(err?.stack || err) });
    }
  }
  ctx.modules = modules;

  // --- core message plumbing ---------------------------------------------
  net.on('profile', (p) => { state.profile = p; bus.emit('profile', p); });
  net.on('env', (e) => { state.env = e; bus.emit('env', e); });
  // Points of interest and trails stream in as the player travels the generated world.
  net.on('pois', (m) => {
    for (const p of m.pois || []) state.pois[p.id] = p;
    const known = new Set(state.trails.map((t) => t.id));
    for (const t of m.trails || []) if (!known.has(t.id)) state.trails.push(t);
    bus.emit('pois', m);
  });
  net.on('error', (e) => { console.warn('[server]', e.msg); bus.emit('toast', { kind: 'warn', title: e.msg, text: '' }); });
  net.on('toast', (t) => bus.emit('toast', t));
  bus.on('net:close', () => {
    if (state.mode !== 'boot') bus.emit('toast', { kind: 'warn', title: 'Connection lost', text: 'Reload the page to reconnect.' });
  });

  setBoot('Reaching the server…');
  const welcomed = new Promise((resolve) => bus.once('net:welcome', resolve));
  await net.connect();
  const params = new URLSearchParams(location.search);
  net.send('hello', { name: 'Naturalist', newGame: false });
  const welcome = await welcomed;
  state.applyWelcome(welcome);
  setBoot('Growing the forest…');
  bus.emit('welcome', welcome);
  bus.emit('profile', state.profile);
  bus.emit('env', state.env);

  // Give the world a moment to stream the first chunks around the spawn point.
  await Promise.race([
    new Promise((resolve) => bus.once('world:ready', resolve)),
    new Promise((resolve) => setTimeout(resolve, 6000)),
  ]);

  // --- frame loop ---------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    ctx.time += dt;
    for (const m of modules) {
      if (m.update) { try { m.update(dt, ctx); } catch (err) { reportOnce(m, 'update', err); } }
    }
    for (const m of modules) {
      if (m.lateUpdate) { try { m.lateUpdate(dt, ctx); } catch (err) { reportOnce(m, 'lateUpdate', err); } }
    }
    renderFrame(dt);
    requestAnimationFrame(frame);
  }
  const reported = new Set();
  function reportOnce(m, phase, err) {
    const key = m.name + ':' + phase + ':' + (err?.message || err);
    if (reported.has(key)) return;
    reported.add(key);
    console.error(`[frame] ${m.name}.${phase} threw`, err);
  }
  requestAnimationFrame(frame);

  // --- enter the game -----------------------------------------------------
  bootEl.classList.add('done');
  state.mode = 'mainmenu'; // leave 'boot' without emitting; the screen manager takes over
  // ?play=1 (set after "New Adventure", and handy for tests) skips the main menu.
  if (params.has('play') || !ui.has('mainmenu')) {
    state.mode = 'ui';
    state.setMode('play');
    bus.emit('game:start', { fresh: !welcome.hasSave });
  } else {
    ui.open('mainmenu', {});
  }
}

boot().catch(fatal);
