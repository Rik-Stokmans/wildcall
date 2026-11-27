// Waypoints on the big map (hooked into js/ui/journal/map-screen.js): flag pins drawn over
// the map, a click without movement drops one (anywhere: it is the player's own guess),
// clicking a pin selects it, a small panel lists them with distance + bearing from the
// player, and edits the selected one (rename inline, colour, centre, remove). Also the
// "Mark here" button for the map's control column. Styles: css/minimap.css (.mm-map-*, .mm-wp).

import { el, fill, icon, button } from '../kit.js';
import { WAYPOINT_COLORS, MAX_WAYPOINTS, MAX_NAME } from './waypoints.js';
import { distanceBearing } from './mm-math.js';

const CLICK_DELAY = 260; // ms: a double click zooms the map instead of dropping two pins
const PIN_SVG = (color) => `<svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true"><path d="M12 31C10 24 3 19 3 11.5a9 9 0 0 1 18 0C21 19 14 24 12 31z" fill="${color}" stroke="#F2EBDD" stroke-width="2" stroke-linejoin="round"/><path d="M12 31v-4" stroke="#3A3027" stroke-width="1.4" stroke-linecap="round" opacity=".55"/></svg>`;

/**
 * @param ctx
 * @param opts.toScreen(x, z) -> {x, y}   world -> map pixels (current view)
 * @param opts.playerPos() -> {x, z}
 * @param opts.centreOn({x, z})
 * @param opts.requestDraw()               mark the map dirty
 */
export function createMapWaypoints(ctx, { toScreen, playerPos, centreOn, requestDraw }) {
  const wp = () => ctx.waypoints;
  const sound = (n) => { try { ctx.audio?.uiSound?.(n); } catch { /* optional */ } };
  const layer = el('div', { class: 'mm-map-layer' });
  const pins = new Map(); // id -> {node, color, letter, name}
  const panel = el('div', { class: 'mm-map-panel' });
  let pending = null;
  let note = '';
  let isOpen = false;

  const markButton = button('Mark here', { variant: 'secondary', small: true, icon: 'flag', title: 'Drop a waypoint where you stand',
    onClick: () => { const me = playerPos(); drop(me.x, me.z); } });

  function drop(x, z) {
    const store = wp();
    if (!store) return;
    if (store.full) { note = `All ${MAX_WAYPOINTS} waypoints are in use. Remove one first.`; sound('error'); render(); return; }
    const w = store.add({ x, z });
    if (!w) return;
    note = '';
    store.select(w.id);
    sound('click');
  }

  /** Hit test in map pixels: the pin head sits above its point. */
  function hitTest(sx, sy) {
    let best = null, bd = Infinity;
    for (const w of wp()?.list() || []) {
      const s = toScreen(w.x, w.z);
      const dx = sx - s.x, dy = sy - (s.y - 19);
      if (Math.abs(dx) > 13 || dy < -15 || dy > 21) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }

  function syncPins() {
    const list = wp()?.list() || [];
    const keep = new Set(list.map((w) => w.id));
    for (const [id, p] of pins) if (!keep.has(id)) { p.node.remove(); pins.delete(id); }
    for (const w of list) {
      let p = pins.get(w.id);
      if (!p) {
        p = { node: el('div', { class: 'mm-wp' }), color: '', letter: '', name: '' };
        p.node.append(el('span', { class: 'mm-wp-svg' }), el('b'), el('span', { class: 'mm-wp-label' }));
        layer.appendChild(p.node);
        pins.set(w.id, p);
      }
      if (p.color !== w.color) { p.color = w.color; p.node.firstChild.innerHTML = PIN_SVG(w.color); p.node.style.setProperty('--c', w.color); }
      if (p.letter !== w.letter) { p.letter = w.letter; p.node.children[1].textContent = w.letter; }
      if (p.name !== w.name) { p.name = w.name; p.node.children[2].textContent = w.name; }
      p.node.classList.toggle('sel', w.id === wp()?.selectedId);
      p.w = w;
    }
  }

  /** Re-position the pins for the current view (call when the map view changed). */
  function place(w, h) {
    for (const p of pins.values()) {
      const s = toScreen(p.w.x, p.w.z);
      const out = s.x < -40 || s.y < -40 || s.x > w + 40 || s.y > h + 40;
      p.node.style.display = out ? 'none' : '';
      if (!out) p.node.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    }
  }

  function render() {
    if (!isOpen) return;
    const store = wp();
    if (note && !store?.full) note = ''; // the only note is "all 12 in use": stale once one is gone
    const list = (store?.list() || []).sort((a, b) => a.letter.localeCompare(b.letter));
    const sel = store?.get(store.selectedId);
    const me = playerPos();
    const active = document.activeElement;
    if (sel && active?.classList?.contains('mm-mp-name-in') && panel.contains(active) && active.dataset.id === sel.id) {
      // typing in the name field: refresh only the list so the caret is not lost
      panel.querySelector('.mm-mp-list')?.replaceWith(listEl(list, sel, me));
      return;
    }
    fill(panel,
      el('div', { class: 'mm-mp-head' }, icon('flag', 15), el('span', 'Waypoints'), el('small', `${list.length} / ${MAX_WAYPOINTS}`)),
      sel ? editor(sel, me) : null,
      list.length ? listEl(list, sel, me) : el('p', { class: 'mm-mp-empty' }, 'Click anywhere on the map to drop a waypoint, or mark where you stand.'),
      note ? el('p', { class: 'mm-mp-note' }, note) : null);
    panel.classList.toggle('mm-tall', !!sel);
  }

  function listEl(list, sel, me) {
    return el('ul', { class: 'mm-mp-list' }, list.map((w) => el('li', {
      class: 'mm-mp-row' + (sel?.id === w.id ? ' sel' : ''), style: { '--c': w.color }, title: 'Select',
      onclick: () => { wp()?.select(sel?.id === w.id ? null : w.id); sound('click'); },
    },
    el('span', { class: 'mm-mp-dot' }, w.letter),
    el('span', { class: 'mm-mp-name' }, w.name),
    el('span', { class: 'mm-mp-dist' }, distanceBearing(me.x, me.z, w)),
    el('button', { type: 'button', class: 'mm-mp-go', title: 'Centre on it', 'aria-label': 'Centre on it',
      onclick: (e) => { e.stopPropagation(); wp()?.select(w.id); centreOn({ x: w.x, z: w.z }); sound('click'); } }, icon('eye', 14)))));
  }

  function editor(w, me) {
    const input = el('input', { class: 'mm-mp-name-in', type: 'text', value: w.name, maxlength: MAX_NAME, 'aria-label': 'Waypoint name', spellcheck: 'false' });
    input.dataset.id = w.id;
    const commit = () => { wp()?.rename(w.id, input.value); };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    input.addEventListener('blur', commit);
    return el('div', { class: 'mm-mp-edit' },
      input,
      el('div', { class: 'mm-mp-sw', role: 'group', 'aria-label': 'Colour' }, WAYPOINT_COLORS.map((c) => el('button', {
        type: 'button', class: c === w.color ? 'on' : '', style: { '--c': c }, title: 'Colour', 'aria-label': 'Colour ' + c,
        onclick: () => { wp()?.recolor(w.id, c); sound('click'); },
      }))),
      el('div', { class: 'mm-mp-meta' }, Math.hypot(w.x - me.x, w.z - me.z) < 12 ? 'Where you stand' : `${distanceBearing(me.x, me.z, w)} from you`),
      el('div', { class: 'mm-mp-actions' },
        button('Centre', { variant: 'secondary', small: true, icon: 'eye', onClick: () => { centreOn({ x: w.x, z: w.z }); sound('click'); } }),
        button('Remove', { variant: 'ghost', small: true, icon: 'trash', onClick: () => { wp()?.remove(w.id); note = ''; sound('click'); } }),
        button('Done', { variant: 'ghost', small: true, icon: 'check', onClick: () => { commit(); wp()?.select(null); } })));
  }

  ctx.bus.on('waypoints', () => { syncPins(); render(); requestDraw(); });

  return {
    layer,
    panel,
    markButton,
    /** A click without movement at map pixel (sx, sy) whose world point is `world` {x, z}. */
    click(sx, sy, world) {
      const hit = hitTest(sx, sy);
      if (hit) {
        cancel();
        wp()?.select(wp()?.selectedId === hit.id ? null : hit.id);
        sound('click');
        return;
      }
      cancel();
      pending = setTimeout(() => { pending = null; drop(world.x, world.z); }, CLICK_DELAY);
    },
    /** A double click (zoom) cancels the pending drop. */
    cancelClick: cancel,
    place,
    open() { isOpen = true; note = ''; syncPins(); render(); },
    close() {
      cancel();
      const a = document.activeElement;
      if (a && panel.contains(a)) a.blur();
      isOpen = false;
    },
  };

  function cancel() { if (pending) { clearTimeout(pending); pending = null; } }
}
