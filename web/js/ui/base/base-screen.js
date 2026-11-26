// The Naturalist Cabin: a procedurally drawn room whose hotspots are the stations, plus a
// station tab bar and the active station's panel. Fully re-rendered from ctx.state on
// open() and on every 'profile' bus event while open.
import { el, fill, icon, button, panel, tabs, formatClock, WEATHER_NAMES, WEATHER_ICONS, SEASON_NAMES } from '../kit.js';
import * as L from './logic.js';
import { drawCabin, HOTSPOTS, ART_W, ART_H } from './cabin-art.js';
import { creditsChip } from './views.js';
import { renderResearch, researchCounts } from './station-research.js';
import { renderEquipment } from './station-equipment.js';
import { renderJournal, renderPhotos, renderStorage, renderUpgrades, renderRest, pinnedPhotos } from './station-misc.js';

const RENDERERS = {
  research: renderResearch, equipment: renderEquipment, journal: renderJournal,
  photos: renderPhotos, storage: renderStorage, upgrades: renderUpgrades, rest: renderRest,
};

export function createBaseScreen(ctx) {
  const { state, bus } = ctx;
  const view = { station: 'research', researchTab: 'mysteries', slot: 'optics', photo: null, stackSel: null, rest: 'dawn' };
  let isOpen = false;
  let filmDeveloped = null;
  let lastStation = null;
  let lastArt = '';

  const snd = (name) => { try { ctx.audio?.uiSound?.(name); } catch { /* audio is optional */ } };
  const api = {
    ctx, state, view,
    get profile() { return state.profile; },
    get stats() { return state.stats; },
    get env() { return state.env; },
    send(type, data, sound = 'click') { ctx.net.send(type, data); snd(sound); },
    snd,
    rerender: () => render(),
  };

  // --- shell ---------------------------------------------------------------
  const frame = panel({ title: 'Naturalist Cabin', subtitle: 'Home base', icon: 'cabin', wide: true, onClose: () => ctx.ui.close('base') });
  const chips = el('div', { class: 'base-head-chips' });
  const closeBtn = frame.header.querySelector('.kit-panel-close');
  frame.header.insertBefore(chips, closeBtn || null);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = el('canvas', { class: 'base-canvas', width: Math.round(ART_W * dpr), height: Math.round(ART_H * dpr), 'aria-hidden': 'true' });
  const frames = el('div', { class: 'base-prints' });
  const hot = el('div', { class: 'base-hotspots' });
  const filmNote = el('div', { class: 'base-film-note', hidden: true });
  const stage = el('div', { class: 'base-stage' }, canvas, frames, hot, filmNote);

  const items = L.STATIONS.map((s) => ({ id: s.id, label: s.label, icon: s.icon }));
  const bar = tabs(items, view.station, (id) => selectStation(id, false));
  bar.classList.add('base-tabbar');
  const content = el('div', { class: 'base-content' });
  const side = el('div', { class: 'base-side' }, bar, content);

  frame.body.append(el('div', { class: 'base-layout' }, el('div', { class: 'base-left' }, stage,
    el('div', { class: 'base-caption' }, 'Click anything in the room, or use the tabs.')), side));
  frame.footer.append(
    el('div', { class: 'base-footer-note' }),
    button('Head out', { variant: 'primary', icon: 'forward', onClick: () => { snd('close'); ctx.ui.close('base'); } }));

  const root = el('div', { class: 'base-screen' }, el('div', { class: 'base-frame' }, frame.root));

  function selectStation(id, sound = true) {
    if (!L.STATION_IDS.includes(id)) return;
    if (sound) snd('click');
    view.station = id;
    render();
  }

  // --- pieces ----------------------------------------------------------------
  function renderHeader() {
    const p = state.profile, env = state.env;
    if (!p) return;
    fill(chips,
      env ? el('span', { class: 'base-time', title: 'Time of day and weather' },
        icon(WEATHER_ICONS[env.weather] || 'sunny', 16),
        `Day ${env.day} · ${formatClock(env.time)} · ${SEASON_NAMES[env.season] || ''}, ${(WEATHER_NAMES[env.weather] || '').toLowerCase()}`) : null,
      creditsChip(p.credits || 0));
    frame.setTitle('Naturalist Cabin', `${p.name || 'Naturalist'}'s home base`);
  }

  function artSignature(p, env) {
    const eq = {};
    for (const s of L.EQUIP_SLOTS) eq[s] = !!p.equipped?.[s];
    return JSON.stringify([Math.floor((env?.time ?? 12) * 4), env?.weather, env?.cloud != null ? Math.round(env.cloud * 10) : 0,
      env?.rain != null ? Math.round(env.rain * 10) : 0, env?.mist != null ? Math.round(env.mist * 10) : 0,
      p.cabin, L.wallSlots(p), eq, Math.min(14, 4 + Math.floor(Object.keys(p.journal?.species || {}).length / 2))]);
  }

  function drawScene(force) {
    const p = state.profile, env = state.env;
    if (!p) return;
    const sig = artSignature(p, env);
    if (!force && sig === lastArt) return;
    lastArt = sig;
    const g = canvas.getContext('2d');
    if (!g) return;
    const eq = {};
    for (const s of L.EQUIP_SLOTS) eq[s] = !!p.equipped?.[s];
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(canvas.width / ART_W, 0, 0, canvas.height / ART_H, 0, 0);
    drawCabin(g, {
      sky: L.skyScene(env?.time ?? 12, env?.weather ?? 0, env || {}),
      features: L.cabinFeatures(p), slots: L.wallSlots(p), equipped: eq,
      books: 4 + Math.floor(Object.keys(p.journal?.species || {}).length / 2), active: view.station,
    });
  }

  function renderPrints() {
    const p = state.profile;
    if (!p) return;
    const layout = L.wallLayout(L.wallSlots(p));
    const photos = pinnedPhotos(p).slice(0, layout.length);
    fill(frames, photos.map((ph, i) => {
      const f = layout[i];
      return el('div', { class: 'base-print', style: {
        left: (f.x / ART_W * 100) + '%', top: (f.y / ART_H * 100) + '%',
        width: (f.w / ART_W * 100) + '%', height: (f.h / ART_H * 100) + '%',
        transform: `rotate(${f.tilt}rad)`,
      } }, ph.url ? el('img', { src: ph.url, alt: '', loading: 'lazy', draggable: 'false' }) : null);
    }));
  }

  function renderHotspots() {
    const feats = L.cabinFeatures(state.profile || {});
    fill(hot, HOTSPOTS.filter((h) => !h.needs || feats[h.needs]).map((h) =>
      el('button', { class: 'base-hot' + (h.station === view.station ? ' active' : ''), type: 'button', 'aria-label': h.label,
        dataset: { label: h.label },
        style: { left: (h.x / ART_W * 100) + '%', top: (h.y / ART_H * 100) + '%', width: (h.w / ART_W * 100) + '%', height: (h.h / ART_H * 100) + '%' },
        onclick: () => selectStation(h.station) })));
  }

  function renderFilm() {
    const note = frame.footer.querySelector('.base-footer-note');
    const text = filmDeveloped == null ? '' : filmDeveloped > 0
      ? `Film developed: ${filmDeveloped} photo${filmDeveloped === 1 ? '' : 's'}` : 'Film developed: no new photos this time';
    filmNote.hidden = !text;
    fill(filmNote, text ? [icon('film', 16), text] : null);
    if (note) fill(note, text ? [icon('film', 14), text] : null);
  }

  function renderBadges() {
    const p = state.profile;
    if (!p) return;
    const c = researchCounts(api);
    const n = c.mysteries + c.recordings + c.study + c.contracts + c.submit;
    bar.setBadge('research', n ? String(n) : null);
    const pin = L.pinInfo(p);
    bar.setBadge('photos', pin.count ? `${pin.count}/${pin.slots}` : null);
  }

  function renderStation() {
    const keep = lastStation === view.station
      ? [...content.querySelectorAll('.base-station-scroll')].map((n) => n.scrollTop) : [];
    const node = RENDERERS[view.station](api);
    fill(content, node);
    content.dataset.station = view.station;
    content.querySelectorAll('.base-station-scroll').forEach((n, i) => { if (keep[i]) n.scrollTop = keep[i]; });
    lastStation = view.station;
  }

  function render() {
    if (!state.profile) return;
    renderHeader();
    drawScene(false);
    renderPrints();
    renderHotspots();
    bar.setActive(view.station);
    renderBadges();
    renderStation();
    renderFilm();
  }

  // --- lifecycle -------------------------------------------------------------
  bus.on('profile', () => { if (isOpen) render(); });
  bus.on('env', () => {
    if (!isOpen) return;
    renderHeader();
    drawScene(false);
    if (view.station === 'rest') renderStation();
  });
  // Opened by the server when the player interacts with the cabin.
  ctx.net.on('base', (d) => ctx.ui.open('base', { station: d?.station, filmDeveloped: d?.filmDeveloped ?? 0 }));

  ctx.ui.register('base', {
    root,
    open(data = {}) {
      isOpen = true;
      if (data.station && L.STATION_IDS.includes(data.station)) view.station = data.station;
      filmDeveloped = Number.isFinite(data.filmDeveloped) ? data.filmDeveloped : null;
      lastStation = null;
      snd('open');
      drawScene(true);
      render();
    },
    close() { isOpen = false; },
    overlay: false,
    closable: true,
  });

  return { selectStation, render };
}
