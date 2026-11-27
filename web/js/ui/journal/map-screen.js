// The Map: a full-screen, pannable, zoomable view of the unbounded generated world.
// Map tiles come from welcome.world.mapUrl and are fetched ONLY for tiles that contain an
// explored cell; everything else stays blank parchment. Sparse fog of war (Profile.explored)
// is applied per 32 m cell with soft edges. Birds are never drawn.

import { el, fill, icon, button } from '../kit.js';
import { createFog, tilesToFetch, tileUrl, TILE_SIZE, CELL_SIZE } from './fog.js';
import { worldToScreen, screenToWorld, viewRect, panBy, zoomAt, wheelFactor, scaleBar, edgeArrow, MIN_SCALE, MAX_SCALE } from './mapmath.js';
import { regionLabels } from './regions.js';
import { buildMarkers, visibleTrails, trailSegments, quietLabels } from './map-data.js';
import { createTileCache } from './tile-cache.js';
import { formatDistance, clamp } from './format.js';
import { screenRoot, sheet, uiSound } from './widgets.js';
// Player waypoints on the map (owned by the minimap module).
import { createMapWaypoints } from '../minimap/map-waypoints.js';

const PAPER = '#D9C7A0';
let fontJournal = null;
let fontUI = null;
function fonts() {
  if (!fontJournal) {
    const cs = getComputedStyle(document.documentElement);
    fontJournal = cs.getPropertyValue('--font-journal').trim() || 'serif';
    fontUI = cs.getPropertyValue('--font-ui').trim() || 'sans-serif';
  }
}

export function createMapScreen(ctx, memory, mapWorld) {
  const root = screenRoot(ctx, 'map', 'jr-map-screen');
  const frame = sheet(ctx, 'map', { title: 'Map', subtitle: '', ico: 'map', className: 'jr-mapsheet' });
  root.appendChild(frame.panel);

  const fog = createFog();
  const cache = createTileCache({ onChange: () => { dirty = true; } });
  let view = { cx: 0, cz: 0, scale: 0.3 };
  let size = { w: 0, h: 0, dpr: 1 };
  let dirty = true;
  let isOpen = false;
  let raf = 0;
  let anim = null;
  let markers = [];
  let labels = [];
  let labelsKey = '';
  const markerEls = new Map(); // key -> element
  const trailBounds = new WeakMap();

  // ---- DOM ---------------------------------------------------------------
  const canvas = el('canvas', { class: 'jr-map-canvas' });
  const layer = document.createElement('canvas');
  const mask = document.createElement('canvas');
  const markerLayer = el('div', { class: 'jr-map-markers' });
  const player = el('div', { class: 'jr-player', title: 'You are here' });
  player.innerHTML = '<svg viewBox="-12 -12 24 24" width="26" height="26" aria-hidden="true"><path d="M0 -10 L7 8 L0 4 L-7 8 Z" fill="#355C43" stroke="#F2EBDD" stroke-width="2" stroke-linejoin="round"/></svg>';
  const edge = el('button', { type: 'button', class: 'jr-edge', title: 'Centre on home', onclick: () => centreOn(homePos(), null) },
    el('span', { class: 'jr-edge-arrow' }, icon('forward', 16)), el('span', { class: 'jr-edge-text' }));
  edge.hidden = true;
  const wrap = el('div', { class: 'jr-map-wrap' }, canvas, markerLayer, player, edge);
  const hint = el('div', { class: 'jr-map-hint' }, 'Nothing is charted yet. Walk the land and the map fills in around you.');
  const scaleEl = el('div', { class: 'jr-scalebar' }, el('div', { class: 'jr-scalebar-line' }), el('span'));
  const seedEl = el('div', { class: 'jr-map-seed' });
  const legend = buildLegend();
  const controls = el('div', { class: 'jr-map-controls' },
    button('Centre on me', { variant: 'secondary', small: true, icon: 'footprint', onClick: () => { uiSound(ctx, 'click'); centreOn(playerPos(), null); } }),
    button('Centre on home', { variant: 'secondary', small: true, icon: 'home', onClick: () => { uiSound(ctx, 'click'); centreOn(homePos(), null); } }),
    el('div', { class: 'jr-map-zoom' },
      button('', { variant: 'secondary', small: true, icon: 'plus', title: 'Zoom in', onClick: () => zoomCentre(1.5) }),
      button('', { variant: 'secondary', small: true, icon: 'minus', title: 'Zoom out', onClick: () => zoomCentre(1 / 1.5) })),
    button('Legend', { variant: 'ghost', small: true, icon: 'info', onClick: () => { legend.hidden = !legend.hidden; } }));
  const stage = el('div', { class: 'jr-map-stage' }, wrap, hint, controls, legend, scaleEl, seedEl);
  // [minimap module hook] waypoints: flag pins over the map, the list/edit panel and "Mark here".
  const wps = createMapWaypoints(ctx, { toScreen: (x, z) => worldToScreen(view, size.w, size.h, x, z), playerPos, centreOn: (p) => centreOn(p, null), requestDraw: () => { dirty = true; } });
  wrap.insertBefore(wps.layer, player);
  stage.appendChild(wps.panel);
  controls.insertBefore(wps.markButton, controls.children[2] || null);
  fill(frame.body, stage);

  function buildLegend() {
    const row = (ico, text) => el('li', el('span', { class: 'jr-lg-ico' }, ico), el('span', text));
    const box = el('div', { class: 'jr-map-legend' },
      el('b', 'Legend'),
      el('ul',
        row(icon('cabin', 15), 'Your cabin'),
        row(icon('landmark', 15), 'A place you have discovered'),
        row(icon('npc', 15), 'Someone you have met'),
        row(icon('quest', 15), 'Tracked quest objective'),
        row(icon('lock', 15), 'A region still closed to you'),
        row(el('span', { class: 'jr-lg-line' }), 'Trail'),
        row(el('span', { class: 'jr-lg-line dashed' }), 'Secret trail you uncovered'),
        row(el('span', { class: 'mm-lg-pin' }), 'Your waypoint: click the map to drop one'), // [minimap hook]
        row(el('span', { class: 'jr-lg-paper' }), 'Parchment: not explored yet')),
      el('small', 'Birds are never marked. Listen and look.'));
    box.hidden = true;
    return box;
  }

  // ---- data helpers ------------------------------------------------------
  const profile = () => ctx.state.profile;
  const homePos = () => { const h = ctx.state.welcome?.world?.home || { x: 0, z: 0 }; return { x: h.x, z: h.z }; };
  function playerPos() {
    const pl = ctx.player;
    if (pl?.pos && Number.isFinite(pl.pos.x)) return { x: pl.pos.x, z: pl.pos.z, yaw: Number.isFinite(pl.yaw) ? pl.yaw : (profile()?.yaw || 0) };
    const p = profile()?.pos || { x: 0, z: 0 };
    return { x: p.x, z: p.z, yaw: profile()?.yaw || 0 };
  }

  function refreshData() {
    const p = profile();
    if (!p) return;
    fog.update(p.explored);
    mapWorld.sync();
    memory.addLocations(p.journal?.locations);
    const me = playerPos();
    memory.sample(ctx.world, me.x, me.z);
    markers = buildMarkers({
      locations: p.journal?.locations, pois: mapWorld.pois, npcs: ctx.state.npcs, flags: p.flags, quests: ctx.state.quests,
      questStates: p.quests, home: homePos(), isExplored: (x, z) => fog.isExplored(x, z),
    });
    syncMarkerElements();
    const km2 = (fog.cellCount * CELL_SIZE * CELL_SIZE) / 1e6;
    frame.setSubtitle(fog.cellCount ? `${km2 < 1 ? km2.toFixed(2) : km2.toFixed(1)} km² charted` : '');
    seedEl.textContent = `World seed · ${ctx.state.welcome?.world?.seedText ?? ctx.state.welcome?.seed ?? ''}`;
    hint.hidden = fog.cellCount > 0;
    dirty = true;
  }

  function syncMarkerElements() {
    const keep = new Set(markers.map((m) => m.key));
    for (const [k, node] of markerEls) if (!keep.has(k)) { node.remove(); markerEls.delete(k); }
    for (const m of markers) {
      let node = markerEls.get(m.key);
      if (!node) {
        node = el('div', { class: `jr-mk jr-mk-${m.type}` }, el('span', { class: 'jr-mk-ico' }, icon(m.icon, 15)), el('span', { class: 'jr-mk-label' }));
        markerLayer.appendChild(node);
        markerEls.set(m.key, node);
      }
      node.title = m.sub ? `${m.label} · ${m.sub}` : m.label;
      node.querySelector('.jr-mk-label').textContent = m.label;
    }
  }

  // ---- sizing ------------------------------------------------------------
  function measure() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === size.w && h === size.h && dpr === size.dpr) return;
    size = { w, h, dpr };
    for (const c of [canvas, layer, mask]) { c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); }
    dirty = true;
  }

  // ---- drawing -----------------------------------------------------------
  let paperPattern = null;
  function paperFor(g) {
    if (!paperPattern) {
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const p = c.getContext('2d');
      p.fillStyle = PAPER; p.fillRect(0, 0, 160, 160);
      let s = 1234567;
      const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      for (let i = 0; i < 520; i++) {
        p.fillStyle = rnd() < 0.5 ? 'rgba(120,95,60,0.07)' : 'rgba(255,250,235,0.10)';
        p.fillRect(rnd() * 160, rnd() * 160, 1 + rnd() * 2, 1 + rnd() * 2);
      }
      paperPattern = g.createPattern(c, 'repeat');
    }
    return paperPattern;
  }

  function draw() {
    const { w, h, dpr } = size;
    if (!w || !h) return;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = paperFor(g) || PAPER;
    g.fillRect(0, 0, w, h);
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(85,69,55,0.22)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);

    const rect = viewRect(view, w, h);
    drawGrid(g, rect);

    // 1. everything that belongs to explored land goes on the layer canvas...
    const lg = layer.getContext('2d');
    lg.setTransform(dpr, 0, 0, dpr, 0, 0);
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, w, h);
    lg.imageSmoothingEnabled = true;
    lg.imageSmoothingQuality = 'high';
    const tileSize = TILE_SIZE * view.scale;
    for (const t of tilesToFetch(fog, rect)) {
      const img = cache.get(t.key, tileUrl(ctx.state.welcome?.world?.mapUrl, t.tx, t.tz));
      if (!img) continue;
      const p = worldToScreen(view, w, h, t.tx * TILE_SIZE, t.tz * TILE_SIZE);
      lg.drawImage(img, Math.floor(p.x), Math.floor(p.y), Math.ceil(tileSize) + 1, Math.ceil(tileSize) + 1);
    }
    const detail = ctx.state.stats?.mapDetail || 0;
    if (detail >= 2) drawRegionTint(lg, rect);
    drawTrails(lg, rect, detail);

    // 2. ...then a soft-edged mask of the explored 32 m cells cuts the layer to the fog line.
    const mg = mask.getContext('2d');
    mg.setTransform(dpr, 0, 0, dpr, 0, 0);
    mg.clearRect(0, 0, w, h);
    mg.fillStyle = '#fff';
    mg.shadowColor = '#fff';
    mg.shadowBlur = clamp(CELL_SIZE * view.scale * 0.5, 2, 12) * dpr;
    mg.beginPath();
    const pad = CELL_SIZE;
    fog.forEachCell({ x0: rect.x0 - pad, z0: rect.z0 - pad, x1: rect.x1 + pad, z1: rect.z1 + pad }, (x, z, s) => {
      const p = worldToScreen(view, w, h, x, z);
      mg.rect(p.x - 0.4, p.y - 0.4, s * view.scale + 0.8, s * view.scale + 0.8);
    });
    mg.fill();
    mg.shadowBlur = 0;
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'destination-in';
    lg.drawImage(mask, 0, 0);
    lg.globalCompositeOperation = 'source-over';

    g.save();
    g.shadowColor = 'rgba(60,40,20,0.35)';
    g.shadowBlur = 10;
    g.drawImage(layer, 0, 0, w, h);
    g.restore();

    drawRegionNames(g);
  }

  function drawGrid(g, rect) {
    if (view.scale < 0.08) return;
    g.save();
    g.strokeStyle = 'rgba(85,69,55,0.10)';
    g.lineWidth = 1;
    g.beginPath();
    const { w, h } = size;
    for (let tx = Math.floor(rect.x0 / TILE_SIZE); tx <= Math.ceil(rect.x1 / TILE_SIZE); tx++) {
      const x = Math.round(worldToScreen(view, w, h, tx * TILE_SIZE, 0).x) + 0.5;
      g.moveTo(x, 0); g.lineTo(x, h);
    }
    for (let tz = Math.floor(rect.z0 / TILE_SIZE); tz <= Math.ceil(rect.z1 / TILE_SIZE); tz++) {
      const y = Math.round(worldToScreen(view, w, h, 0, tz * TILE_SIZE).y) + 0.5;
      g.moveTo(0, y); g.lineTo(w, y);
    }
    g.stroke();
    g.restore();
  }

  function drawRegionTint(lg, rect) {
    const { w, h } = size;
    const regions = ctx.state.regions || [];
    lg.save();
    lg.globalAlpha = 0.16;
    for (const [key, region] of memory.samples) {
      const [cx, cz] = key.split(',').map(Number);
      const x = cx * 128, z = cz * 128;
      if (x > rect.x1 || x + 128 < rect.x0 || z > rect.z1 || z + 128 < rect.z0) continue;
      const info = regions.find((r) => r.id === region);
      if (!info?.color) continue;
      const p = worldToScreen(view, w, h, x, z);
      lg.fillStyle = info.color;
      lg.fillRect(p.x, p.y, 128 * view.scale + 0.6, 128 * view.scale + 0.6);
    }
    lg.restore();
  }

  function drawTrails(lg, rect, detail) {
    const trails = visibleTrails(mapWorld.trailList(), detail, profile()?.trails);
    if (!trails.length) return;
    const { w, h } = size;
    lg.save();
    lg.lineCap = 'round'; lg.lineJoin = 'round';
    lg.lineWidth = clamp(view.scale * 3, 1.4, 3.6);
    const reveal = new Set(profile()?.trails || []);
    for (const t of trails) {
      let b = trailBounds.get(t);
      if (!b) {
        b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
        for (const p of t.points) { b.x0 = Math.min(b.x0, p.x); b.x1 = Math.max(b.x1, p.x); b.z0 = Math.min(b.z0, p.z); b.z1 = Math.max(b.z1, p.z); }
        trailBounds.set(t, b);
      }
      if (b.x0 > rect.x1 || b.x1 < rect.x0 || b.z0 > rect.z1 || b.z1 < rect.z0) continue;
      lg.strokeStyle = t.hidden && reveal.has(t.id) ? 'rgba(53,92,67,0.8)' : 'rgba(140,92,52,0.78)';
      lg.setLineDash(t.hidden ? [5, 5] : []);
      for (const seg of trailSegments(t, (x, z) => fog.isExplored(x, z))) {
        lg.beginPath();
        seg.forEach((p, i) => { const s = worldToScreen(view, w, h, p.x, p.z); if (i) lg.lineTo(s.x, s.y); else lg.moveTo(s.x, s.y); });
        lg.stroke();
      }
    }
    lg.restore();
  }

  function drawRegionNames(g) {
    const p = profile();
    if (!p) return;
    const key = `${fog.cellCount}:${memory.samples.size}`;
    if (key !== labelsKey) { labelsKey = key; labels = regionLabels(memory.samples, (x, z) => fog.isExplored(x, z)); }
    const alpha = clamp(1.6 - view.scale, 0, 1);
    if (alpha <= 0.02) return;
    const { w, h } = size;
    const open = new Set(p.regions || []);
    const fontSize = clamp(view.scale * 120, 11, 24);
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.globalAlpha = alpha;
    for (const l of labels) {
      const s = worldToScreen(view, w, h, l.x, l.z);
      if (s.x < -200 || s.y < -60 || s.x > w + 200 || s.y > h + 60) continue;
      const info = (ctx.state.regions || []).find((r) => r.id === l.region);
      if (!info) continue;
      const locked = !open.has(l.region);
      fonts();
      g.font = `600 ${fontSize}px ${fontJournal}`;
      const text = info.name.toUpperCase();
      const total = spacedWidth(g, text, fontSize * 0.22);
      const lockW = locked ? fontSize * 1.1 : 0;
      let x = s.x - (total + lockW) / 2;
      if (locked) { drawLock(g, x + fontSize * 0.4, s.y, fontSize); x += lockW; }
      drawSpaced(g, text, x, s.y, fontSize * 0.22, locked ? 'rgba(107,93,79,0.85)' : 'rgba(58,48,39,0.78)');
      if (locked) {
        g.font = `italic ${Math.max(10, fontSize * 0.62)}px ${fontUI}`;
        g.fillStyle = 'rgba(107,93,79,0.95)';
        g.strokeStyle = 'rgba(217,199,160,0.9)'; g.lineWidth = 3;
        const req = requirementText(info);
        g.strokeText(req, s.x, s.y + fontSize * 1.1); g.fillText(req, s.x, s.y + fontSize * 1.1);
      }
    }
    g.restore();
  }

  function requirementText(info) {
    const parts = [];
    if (info.reqRank > 1) parts.push(`${ctx.state.ranks?.[info.reqRank - 1]?.title || 'Rank ' + info.reqRank} rank`);
    if (info.reqQuest) parts.push(`“${ctx.state.quests?.[info.reqQuest]?.name || 'a quest'}”`);
    return parts.length ? 'Requires ' + parts.join(' and ') : 'Closed for now';
  }
  function spacedWidth(g, text, spacing) { let t = 0; for (const ch of text) t += g.measureText(ch).width + spacing; return t - spacing; }
  function drawSpaced(g, text, x, y, spacing, color) {
    g.textAlign = 'left';
    g.lineWidth = 4; g.strokeStyle = 'rgba(217,199,160,0.85)'; g.fillStyle = color;
    for (const ch of text) { g.strokeText(ch, x, y); g.fillText(ch, x, y); x += g.measureText(ch).width + spacing; }
    g.textAlign = 'center';
  }
  function drawLock(g, x, y, fs) {
    const bw = fs * 0.62, bh = fs * 0.46;
    g.save();
    g.fillStyle = 'rgba(107,93,79,0.9)';
    g.strokeStyle = 'rgba(107,93,79,0.9)';
    g.lineWidth = Math.max(1.5, fs * 0.11);
    g.beginPath(); g.arc(x, y - bh * 0.35, bw * 0.3, Math.PI, 0); g.stroke();
    g.fillRect(x - bw / 2, y - bh * 0.35, bw, bh);
    g.restore();
  }

  // ---- markers, player, edge arrow ----------------------------------------
  function placeMarkers() {
    const { w, h } = size;
    markerLayer.classList.toggle('labels', view.scale >= 0.12);
    const shown = [];
    for (const m of markers) {
      const node = markerEls.get(m.key);
      if (!node) continue;
      const s = worldToScreen(view, w, h, m.x, m.z);
      const out = s.x < -40 || s.y < -40 || s.x > w + 40 || s.y > h + 40;
      node.style.display = out ? 'none' : '';
      if (!out) { node.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`; shown.push({ key: m.key, type: m.type, x: s.x, y: s.y, label: m.label }); }
    }
    // Overlapping labels: keep the most important, the rest show on hover.
    const quiet = quietLabels(shown);
    for (const [k, node] of markerEls) node.classList.toggle('jr-mk-quiet', quiet.has(k));
    const sb = scaleBar(view.scale);
    scaleEl.firstChild.style.width = sb.px.toFixed(0) + 'px';
    scaleEl.lastChild.textContent = sb.label;
  }

  function placePlayer() {
    const me = playerPos();
    const { w, h } = size;
    const s = worldToScreen(view, w, h, me.x, me.z);
    const out = s.x < -20 || s.y < -20 || s.x > w + 20 || s.y > h + 20;
    player.style.display = out ? 'none' : '';
    if (!out) player.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) rotate(${me.yaw}rad)`;
  }

  function placeEdge() {
    const { w, h } = size;
    const home = homePos();
    const s = worldToScreen(view, w, h, home.x, home.z);
    const a = edgeArrow(s.x, s.y, w, h, 64);
    edge.hidden = !a;
    if (!a) return;
    const me = playerPos();
    edge.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px)`;
    edge.firstChild.style.transform = `rotate(${(a.angle - Math.PI / 2).toFixed(3)}rad)`;
    edge.lastChild.textContent = `Home · ${formatDistance(Math.hypot(home.x - me.x, home.z - me.z))}`;
    edge.classList.toggle('below', a.y < h / 2);
  }

  // ---- interaction ----------------------------------------------------------
  function centreOn(p, scale) {
    if (!p) return;
    anim = { t0: performance.now(), dur: 320, from: { ...view }, to: { cx: p.x, cz: p.z, scale: scale ?? view.scale } };
  }
  function zoomCentre(f) {
    uiSound(ctx, 'click');
    view = zoomAt(view, size.w, size.h, size.w / 2, size.h / 2, f);
    dirty = true;
  }

  let drag = null;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    anim = null;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, button: e.button, onUi: !!e.target?.closest?.('button') };
    try { wrap.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    wrap.classList.add('dragging');
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy));
    view = panBy(view, e.clientX - drag.x, e.clientY - drag.y);
    drag.x = e.clientX; drag.y = e.clientY;
    dirty = true;
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // [minimap hook] a click without movement drops / selects a waypoint (dragging never does)
    if (e.type === 'pointerup' && drag.button === 0 && !drag.onUi && drag.moved < 5) {
      const r = wrap.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      wps.click(sx, sy, screenToWorld(view, size.w, size.h, sx, sy));
    }
    drag = null; wrap.classList.remove('dragging');
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    anim = null;
    const r = wrap.getBoundingClientRect();
    view = zoomAt(view, size.w, size.h, e.clientX - r.left, e.clientY - r.top, wheelFactor(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    dirty = true;
  }, { passive: false });
  wrap.addEventListener('dblclick', (e) => {
    wps.cancelClick(); // [minimap hook] a double click zooms, it does not drop a waypoint
    const r = wrap.getBoundingClientRect();
    view = zoomAt(view, size.w, size.h, e.clientX - r.left, e.clientY - r.top, 1.8);
    dirty = true;
  });
  function onKey(e) {
    if (!isOpen || e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
    const step = 90;
    if (e.key === '+' || e.key === '=') zoomCentre(1.4);
    else if (e.key === '-' || e.key === '_') zoomCentre(1 / 1.4);
    else if (e.key === 'ArrowLeft') { view = panBy(view, step, 0); dirty = true; }
    else if (e.key === 'ArrowRight') { view = panBy(view, -step, 0); dirty = true; }
    else if (e.key === 'ArrowUp') { view = panBy(view, 0, step); dirty = true; }
    else if (e.key === 'ArrowDown') { view = panBy(view, 0, -step); dirty = true; }
    else return;
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);

  // ---- frame loop -------------------------------------------------------------
  function frameLoop(now) {
    if (!isOpen) { raf = 0; return; }
    measure();
    if (anim) {
      const t = clamp((now - anim.t0) / anim.dur, 0, 1);
      const k = 1 - Math.pow(1 - t, 3);
      view = { cx: anim.from.cx + (anim.to.cx - anim.from.cx) * k, cz: anim.from.cz + (anim.to.cz - anim.from.cz) * k, scale: anim.from.scale + (anim.to.scale - anim.from.scale) * k };
      if (t >= 1) anim = null;
      dirty = true;
    }
    if (dirty) { dirty = false; draw(); placeMarkers(); placeEdge(); wps.place(size.w, size.h); }
    placePlayer();
    raf = requestAnimationFrame(frameLoop);
  }

  ctx.bus.on('profile', () => { if (isOpen) refreshData(); });

  return {
    root,
    closable: true,
    open(data = {}) {
      isOpen = true;
      refreshData();
      wps.open(); // [minimap hook]
      measure();
      const me = playerPos();
      if (data.focus && Number.isFinite(data.focus.x)) {
        view = { cx: data.focus.x, cz: data.focus.z, scale: clamp(Math.max(view.scale, 0.4), MIN_SCALE, MAX_SCALE) };
      } else view = { cx: me.x, cz: me.z, scale: clamp(view.scale || 0.3, MIN_SCALE, MAX_SCALE) };
      anim = null;
      dirty = true;
      uiSound(ctx, 'open');
      if (!raf) raf = requestAnimationFrame(frameLoop);
    },
    close() {
      isOpen = false;
      wps.close(); // [minimap hook]
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      memory.save();
      uiSound(ctx, 'close');
    },
  };
}
