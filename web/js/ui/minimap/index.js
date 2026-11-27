// WILDCALL minimap + the player's waypoints.
//
// ctx.waypoints — personal map notes, persisted per world seed in localStorage (never server
// state). See waypoints.js:
//   list() -> [{id, x, z, name, color, letter}]   add({x, z, name?, color?}) -> waypoint | null
//   remove(id)  rename(id, name)  recolor(id, color)  clear()  nearest(x, z, r) -> waypoint | null
//   get(id)  select(id)  selectedId  size  full
//   bus event 'waypoints' {list, selected} after every change (and once on welcome).
//
// ctx.minimap — the small round map in the top-left corner:
//   zoom (0 near / 1 far), setZoom(i), rangeM, el
//
// The minimap shows exactly what the big map (journal/map-screen.js) shows and reuses its
// logic: map tiles only for explored tiles, the sparse 32 m fog of war, trails per
// stats.mapDetail, discovered places, met NPCs, tracked-quest targets, the cabin, plus the
// player's waypoints. Never birds, sounds or anything the big map does not show.
//
// Drawing: an expensive north-up "base" canvas (tiles, trails, fog) is redrawn at most ~10
// times a second and only when the data changed or the player walked past its margin; it is
// turned/shifted every frame with a CSS transform. A cheap marker canvas (icons, pins, N,
// player arrow) is redrawn only when the pose or the markers changed.

import { el, icon } from '../kit.js';
import { createFog, tilesToFetch, tileUrl, TILE_SIZE, CELL_SIZE } from '../journal/fog.js';
import { createTileCache } from '../journal/tile-cache.js';
import { buildMarkers, visibleTrails, trailSegments } from '../journal/map-data.js';
import { createMapWorld } from '../journal/map-world.js';
import { createWaypointStore } from './waypoints.js';
import { hudLevel } from '../hud/visibility.js';
import {
  ZOOMS, mapRotation, northMarker, arrowRotation, scaleFor, baseStale, poseChanged,
  placeMarkers, placeWaypoints, reachedWaypoints, shortDistance, spreadRim,
} from './mm-math.js';

const MARGIN = 30;           // px of pre-drawn map around the disc (covers walking between redraws)
const BASE_MIN_MS = 100;     // base layer redraws at most ~10 times a second
const REACH_M = 12;
const ZOOM_KEY = 'wildcall.minimap.zoom';
const PAPER = '#D9C7A0';
const INK = '#3A3027';

let tick = null;

export default {
  name: 'minimap',

  init(ctx) {
    const { bus, state } = ctx;
    let storage = null;
    try { storage = window.localStorage; } catch { /* blocked: waypoints live for this session only */ }

    /* ------------------------------------------------------------ waypoints */
    const store = createWaypointStore({
      storage,
      onChange: (list, selected) => { bus.emit('waypoints', { list, selected }); },
    });
    ctx.waypoints = store;
    const seedOf = (w) => w?.world?.seed ?? w?.seed ?? 'world';
    // Every net:welcome (also the one a "New Adventure" gets on the main menu, which is not
    // re-emitted as 'welcome'): hasSave false means a brand-new adventure, so any pins left
    // in this browser from an earlier save on the same seed are dropped.
    bus.on('net:welcome', (w) => { if (w && w.hasSave === false) store.forget(seedOf(w)); });
    bus.on('welcome', (w) => store.bind(seedOf(w)));

    /* ------------------------------------------------------------ DOM */
    const base = el('canvas', { class: 'mm-base' });
    const over = el('canvas', { class: 'mm-over' });
    const disc = el('div', { class: 'mm-disc', title: 'Minimap: click to change its range' }, base, over, el('div', { class: 'mm-rim' }));
    const rangeEl = el('div', { class: 'mm-range' });
    const reachedEl = el('div', { class: 'mm-reached' }, el('span', { class: 'mm-reached-dot' }), el('span'));
    const root = el('div', { class: 'mm-root mm-hidden', 'aria-hidden': 'true' }, disc, rangeEl, reachedEl);
    document.body.appendChild(root);

    let zoom = 0;
    try { zoom = Number(storage?.getItem(ZOOM_KEY)) === 1 ? 1 : 0; } catch { zoom = 0; }
    function setZoom(i) {
      zoom = i ? 1 : 0;
      try { storage?.setItem(ZOOM_KEY, String(zoom)); } catch { /* ignore */ }
      baseDirty = true; overDirty = true; sizeDirty = true;
      rangeEl.textContent = `${ZOOMS[zoom]} m`;
      rangeEl.classList.remove('show'); void rangeEl.offsetWidth; rangeEl.classList.add('show');
      bus.emit('minimap:zoom', { zoom });
    }
    disc.addEventListener('click', () => { setZoom(zoom ? 0 : 1); try { ctx.audio?.uiSound?.('click'); } catch { /* optional */ } });
    ctx.minimap = {
      el: root,
      get zoom() { return zoom; },
      setZoom,
      get rangeM() { return ZOOMS[zoom]; },
    };
    rangeEl.textContent = `${ZOOMS[zoom]} m`;

    /* ------------------------------------------------------------ data */
    const fog = createFog();
    const mapWorld = createMapWorld(ctx);
    let baseDirty = true, overDirty = true, sizeDirty = true;
    const cache = createTileCache({ max: 24, maxLoading: 3, onChange: () => { baseDirty = true; } });
    let markers = [];
    let dataSig = '';
    let waypoints = [];
    let selected = null;

    const homePos = () => { const h = state.welcome?.world?.home || { x: 0, z: 0 }; return { x: h.x, z: h.z }; };
    function refreshData() {
      const p = state.profile;
      if (!p) return;
      fog.update(p.explored);
      mapWorld.sync();
      markers = buildMarkers({
        locations: p.journal?.locations, pois: mapWorld.pois, npcs: state.npcs, flags: p.flags, quests: state.quests,
        questStates: p.quests, home: homePos(), isExplored: (x, z) => fog.isExplored(x, z),
      });
      overDirty = true;
      const sig = `${fog.cellCount}:${fog.tiles.length}:${p.stats?.mapDetail || 0}:${(p.trails || []).length}:${mapWorld.trails.size}`;
      if (sig !== dataSig) { dataSig = sig; baseDirty = true; }
    }
    bus.on('welcome', refreshData);
    bus.on('profile', refreshData);
    bus.on('net:pois', () => { mapWorld.sync(); refreshData(); });
    bus.on('waypoints', (d) => { waypoints = d?.list || []; selected = d?.selected ?? null; overDirty = true; });
    bus.on('resize', () => { sizeDirty = true; });
    bus.on('settings', ({ key }) => { if (key === 'minimap' || key === 'minimapRotate') { overDirty = true; sizeDirty = true; } });

    let focusOn = false;
    bus.on('focus', ({ on }) => { focusOn = !!on; });

    /* ------------------------------------------------------------ sizing */
    let D = 160, dpr = 1;
    function measure() {
      sizeDirty = false;
      const vh = window.innerHeight || 720, vw = window.innerWidth || 1280;
      D = Math.round(Math.max(140, Math.min(170, Math.min(vw, vh) * 0.22)));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      root.style.setProperty('--mm-d', D + 'px');
      root.style.setProperty('--mm-m', MARGIN + 'px');
      const B = D + 2 * MARGIN;
      base.width = base.height = Math.round(B * dpr);
      over.width = over.height = Math.round(D * dpr);
      baseState = null;
      baseDirty = true; overDirty = true;
    }

    /* ------------------------------------------------------------ base layer (tiles, trails, fog) */
    const layer = document.createElement('canvas');
    const mask = document.createElement('canvas');
    let baseState = null;   // {x, z, scale} the base was drawn for
    let lastBase = 0;
    let paper = null;
    const trailBounds = new WeakMap();

    function paperPattern(g) {
      if (!paper) {
        const c = document.createElement('canvas');
        c.width = c.height = 96;
        const p = c.getContext('2d');
        p.fillStyle = PAPER; p.fillRect(0, 0, 96, 96);
        let s = 987654321;
        const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        for (let i = 0; i < 220; i++) {
          p.fillStyle = rnd() < 0.5 ? 'rgba(120,95,60,0.07)' : 'rgba(255,250,235,0.12)';
          p.fillRect(rnd() * 96, rnd() * 96, 1 + rnd() * 2, 1 + rnd() * 2);
        }
        paper = c;
      }
      return g.createPattern(paper, 'repeat');
    }

    function drawBase(px, pz, scale) {
      const B = D + 2 * MARGIN;
      const W = base.width;
      if (layer.width !== W) { layer.width = layer.height = W; mask.width = mask.height = W; }
      const g = base.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = paperPattern(g) || PAPER;
      g.fillRect(0, 0, B, B);

      const half = B / 2 / scale;
      const rect = { x0: px - half, z0: pz - half, x1: px + half, z1: pz + half };
      const sx = (x) => B / 2 + (x - px) * scale;
      const sy = (z) => B / 2 + (z - pz) * scale;

      const lg = layer.getContext('2d');
      lg.setTransform(dpr, 0, 0, dpr, 0, 0);
      lg.globalCompositeOperation = 'source-over';
      lg.clearRect(0, 0, B, B);
      lg.imageSmoothingEnabled = true;
      lg.imageSmoothingQuality = 'high';
      const ts = TILE_SIZE * scale;
      const url = state.welcome?.world?.mapUrl;
      for (const t of tilesToFetch(fog, rect)) {
        const img = cache.get(t.key, tileUrl(url, t.tx, t.tz));
        if (!img) continue;
        lg.drawImage(img, Math.floor(sx(t.tx * TILE_SIZE)), Math.floor(sy(t.tz * TILE_SIZE)), Math.ceil(ts) + 1, Math.ceil(ts) + 1);
      }

      // trails (stats.mapDetail >= 1; secret trails only once revealed) on explored ground
      const p = state.profile;
      const trails = visibleTrails(mapWorld.trailList(), p?.stats?.mapDetail || 0, p?.trails);
      if (trails.length) {
        lg.lineCap = 'round'; lg.lineJoin = 'round';
        lg.lineWidth = Math.max(1.2, Math.min(2.4, scale * 3));
        const reveal = new Set(p?.trails || []);
        for (const t of trails) {
          let b = trailBounds.get(t);
          if (!b) {
            b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
            for (const q of t.points) { b.x0 = Math.min(b.x0, q.x); b.x1 = Math.max(b.x1, q.x); b.z0 = Math.min(b.z0, q.z); b.z1 = Math.max(b.z1, q.z); }
            trailBounds.set(t, b);
          }
          if (b.x0 > rect.x1 || b.x1 < rect.x0 || b.z0 > rect.z1 || b.z1 < rect.z0) continue;
          lg.strokeStyle = t.hidden && reveal.has(t.id) ? 'rgba(53,92,67,0.85)' : 'rgba(140,92,52,0.8)';
          lg.setLineDash(t.hidden ? [4, 4] : []);
          for (const seg of trailSegments(t, (x, z) => fog.isExplored(x, z))) {
            lg.beginPath();
            seg.forEach((q, i) => { if (i) lg.lineTo(sx(q.x), sy(q.z)); else lg.moveTo(sx(q.x), sy(q.z)); });
            lg.stroke();
          }
        }
        lg.setLineDash([]);
      }

      // soft-edged mask of the explored 32 m cells
      const mg = mask.getContext('2d');
      mg.setTransform(dpr, 0, 0, dpr, 0, 0);
      mg.clearRect(0, 0, B, B);
      mg.fillStyle = '#fff';
      mg.shadowColor = '#fff';
      mg.shadowBlur = Math.max(2, Math.min(9, CELL_SIZE * scale * 0.45)) * dpr;
      mg.beginPath();
      fog.forEachCell({ x0: rect.x0 - CELL_SIZE, z0: rect.z0 - CELL_SIZE, x1: rect.x1 + CELL_SIZE, z1: rect.z1 + CELL_SIZE }, (x, z, s) => {
        mg.rect(sx(x) - 0.4, sy(z) - 0.4, s * scale + 0.8, s * scale + 0.8);
      });
      mg.fill();
      mg.shadowBlur = 0;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.globalCompositeOperation = 'destination-in';
      lg.drawImage(mask, 0, 0);
      lg.globalCompositeOperation = 'source-over';

      g.save();
      g.shadowColor = 'rgba(60,40,20,0.30)';
      g.shadowBlur = 6 * dpr;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(layer, 0, 0);
      g.restore();

      baseState = { x: px, z: pz, scale };
      baseDirty = false;
    }

    /* ------------------------------------------------------------ marker layer */
    const icons = new Map(); // `${name}|${color}` -> Image (bounded)
    function iconImg(name, color) {
      const key = name + '|' + color;
      let img = icons.get(key);
      if (img) return img.complete && img.naturalWidth ? img : null;
      if (icons.size > 48) icons.delete(icons.keys().next().value);
      const svg = icon(name, 24);
      svg.setAttribute('stroke', color);
      svg.setAttribute('stroke-width', '2.1');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      img = new Image();
      img.onload = () => { overDirty = true; };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      icons.set(key, img);
      return null;
    }

    let fontUI = null;
    function font() {
      if (!fontUI) fontUI = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
      return fontUI;
    }

    function badge(g, x, y, r, fill, stroke, ico, icoColor) {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = fill; g.fill();
      g.lineWidth = 1.2; g.strokeStyle = stroke; g.stroke();
      const img = iconImg(ico, icoColor);
      if (img) { const s = r * 1.45; g.drawImage(img, x - s / 2, y - s / 2, s, s); }
    }

    function pin(g, x, y, color, letter, sel) {
      // a teardrop flag pin: the tip sits on the point
      const h = sel ? 19 : 16, r = sel ? 7 : 6;
      g.save();
      g.translate(x, y);
      g.shadowColor = 'rgba(30,22,14,0.45)'; g.shadowBlur = 3; g.shadowOffsetY = 1;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(-r * 0.35, -h * 0.45, -r, -h + r * 1.2, -r, -h + r);
      g.arc(0, -h + r, r, Math.PI, 0);
      g.bezierCurveTo(r, -h + r * 1.2, r * 0.35, -h * 0.45, 0, 0);
      g.closePath();
      g.fillStyle = color; g.fill();
      g.shadowColor = 'transparent';
      g.lineWidth = sel ? 1.8 : 1.3; g.strokeStyle = '#F2EBDD'; g.stroke();
      g.fillStyle = '#F2EBDD';
      g.font = `700 ${sel ? 9 : 8}px ${font()}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(letter, 0, -h + r + 0.5);
      g.restore();
    }

    function haloText(g, text, x, y, size, color) {
      g.font = `600 ${size}px ${font()}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3; g.strokeStyle = 'rgba(242,235,221,0.92)'; g.strokeText(text, x, y);
      g.fillStyle = color; g.fillText(text, x, y);
    }

    let lastPose = null;
    function drawOver(px, pz, yaw, rotate, scale) {
      const g = over.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, D, D);
      const R = D / 2;
      g.translate(R, R);

      // places, met NPCs, quest targets (inside the disc), the cabin (always; on the rim when far)
      const RIM = R - 12;
      const mk = placeMarkers(markers, px, pz, yaw, rotate, scale, RIM);
      const wps = placeWaypoints(waypoints, px, pz, yaw, rotate, scale, RIM);
      const n = northMarker(yaw, rotate, R - 9);
      // rim markers never pile up, and never sit under the "N" (an obstacle placed first)
      spreadRim([{ clamped: true, dist: -1, angle: Math.atan2(n.x, -n.y), noLabel: true }, ...mk.filter((p) => p.clamped), ...wps], RIM);
      for (const p of mk) {
        const t = p.m.type;
        if (t === 'home') badge(g, p.x, p.y, 7.5, '#E3B685', '#A96D38', 'cabin', '#24402F');
        else if (t === 'quest') {
          if (p.m.radius > 0) { // [search-area hook] the quest's search circle, soft and dashed
            g.save(); g.beginPath(); g.arc(p.x, p.y, Math.max(8, p.m.radius * scale), 0, Math.PI * 2);
            g.fillStyle = 'rgba(240,195,142,0.16)'; g.fill();
            g.setLineDash([4, 3]); g.lineWidth = 1.4; g.strokeStyle = 'rgba(169,109,56,0.85)'; g.stroke(); g.restore();
          }
          badge(g, p.x, p.y, 6.5, '#C98A50', '#A96D38', 'quest', '#24402F');
        }
        else if (t === 'npc') badge(g, p.x, p.y, 6, '#F2EBDD', '#627F9A', 'npc', '#627F9A');
        else badge(g, p.x, p.y, 6, 'rgba(242,235,221,0.95)', '#355C43', p.m.icon || 'landmark', '#355C43');
      }

      // waypoints: pins; far ones sit on the rim with their distance
      wps.sort((a, b) => (a.w.id === selected) - (b.w.id === selected) || b.dist - a.dist);
      for (const p of wps) {
        const sel = p.w.id === selected;
        if (p.clamped) {
          // a round head on the rim with a tick pointing outwards, distance just inside
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.angle);
          g.beginPath(); g.moveTo(-3.5, -5); g.lineTo(0, -10); g.lineTo(3.5, -5); g.closePath();
          g.fillStyle = p.w.color; g.fill();
          g.restore();
          g.beginPath(); g.arc(p.x, p.y, sel ? 6.5 : 5.5, 0, Math.PI * 2);
          g.fillStyle = p.w.color; g.fill();
          g.lineWidth = 1.2; g.strokeStyle = '#F2EBDD'; g.stroke();
          g.fillStyle = '#F2EBDD'; g.font = `700 7.5px ${font()}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(p.w.letter, p.x, p.y + 0.5);
          const k = (Math.hypot(p.x, p.y) - 15) / Math.max(1, Math.hypot(p.x, p.y));
          if (p.label) haloText(g, shortDistance(p.dist), p.x * k, p.y * k, 8.5, INK);
        } else pin(g, p.x, p.y, p.w.color, p.w.letter, sel);
      }

      // N on the rim
      g.beginPath(); g.arc(n.x, n.y, 6.5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(58,48,39,0.78)'; g.fill();
      g.fillStyle = '#E3B685'; g.font = `700 8px ${font()}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N', n.x, n.y + 0.5);

      // the player: a small arrow in the centre
      g.save();
      g.rotate(arrowRotation(yaw, rotate));
      g.shadowColor = 'rgba(20,16,10,0.5)'; g.shadowBlur = 3;
      g.beginPath(); g.moveTo(0, -8); g.lineTo(5.6, 6.4); g.lineTo(0, 3.2); g.lineTo(-5.6, 6.4); g.closePath();
      g.fillStyle = '#355C43'; g.fill();
      g.shadowColor = 'transparent';
      g.lineWidth = 1.6; g.lineJoin = 'round'; g.strokeStyle = '#F2EBDD'; g.stroke();
      g.restore();

      lastPose = { x: px, z: pz, yaw };
      overDirty = false;
    }

    /* ------------------------------------------------------------ "Reached Waypoint A" */
    const armed = new Map();
    let reachClock = 0, reachedUntil = 0;
    function checkReached(dt, px, pz) {
      reachClock += dt;
      if (reachClock < 0.25) return;
      reachClock = 0;
      const hit = reachedWaypoints(waypoints, px, pz, armed, REACH_M);
      if (!hit.length) return;
      const w = hit[0];
      reachedEl.lastChild.textContent = `Reached ${w.name}`;
      reachedEl.firstChild.style.background = w.color;
      reachedEl.classList.add('show');
      reachedUntil = (ctx.time || 0) + 3.6;
      try { ctx.audio?.uiSound?.('page'); } catch { /* optional */ }
    }

    /* ------------------------------------------------------------ frame */
    let shown = false, dim = false, nightSig = '', baseTf = '';
    let nightClock = 0;
    function visible() {
      if (state.settings?.minimap === false) return false;
      // Same rule as the HUD (spec §29.1): gone while a screen is open and while ANY tool is
      // raised (binoculars, camera or recorder: only the instrument readouts remain).
      const tl = ctx.tools;
      const lvl = hudLevel({ mode: state.mode, tool: tl?.active, raised: !!tl?.raised });
      return lvl === 'full';
    }

    tick = (dt) => {
      const pl = ctx.player;
      const px = pl?.pos?.x, pz = pl?.pos?.z;
      const ok = Number.isFinite(px) && Number.isFinite(pz) && !!state.welcome;
      if (reachedUntil && (ctx.time || 0) > reachedUntil) { reachedEl.classList.remove('show'); reachedUntil = 0; }
      if (ok && state.mode === 'play') checkReached(dt, px, pz);
      else if (reachedUntil) { reachedEl.classList.remove('show'); reachedUntil = 0; }

      const vis = ok && visible();
      if (vis !== shown) { shown = vis; root.classList.toggle('mm-hidden', !vis); root.classList.toggle('mm-shown', vis); }
      if (!vis) return;
      if (dim !== focusOn) { dim = focusOn; root.classList.toggle('mm-dim', dim); }

      nightClock -= dt;
      if (nightClock <= 0) {
        nightClock = 1;
        const day = ctx.sky?.daylight;
        const b = Number.isFinite(day) ? (0.72 + 0.28 * Math.max(0, Math.min(1, day))).toFixed(2) : '1';
        if (b !== nightSig) { nightSig = b; root.style.setProperty('--mm-light', b); }
      }

      if (sizeDirty) measure();
      const yaw = Number.isFinite(pl.yaw) ? pl.yaw : 0;
      const rotate = state.settings?.minimapRotate !== false;
      const scale = scaleFor(D / 2, ZOOMS[zoom]);
      const now = performance.now();
      if ((baseDirty || baseStale(baseState, px, pz, scale, MARGIN)) && now - lastBase >= BASE_MIN_MS) {
        lastBase = now;
        drawBase(px, pz, scale);
      }
      if (baseState) {
        const ox = (px - baseState.x) * baseState.scale, oy = (pz - baseState.z) * baseState.scale;
        const tf = `rotate(${mapRotation(yaw, rotate).toFixed(4)}rad) translate(${(-ox).toFixed(2)}px, ${(-oy).toFixed(2)}px)`;
        if (tf !== baseTf) { baseTf = tf; base.style.transform = tf; }
      }
      const pose = { x: px, z: pz, yaw };
      if (overDirty || poseChanged(lastPose, pose) || (lastPose && rotate !== lastPose.rotate)) {
        drawOver(px, pz, yaw, rotate, scale);
        lastPose.rotate = rotate;
      }
    };
  },

  update(dt) { tick?.(dt); },
};
