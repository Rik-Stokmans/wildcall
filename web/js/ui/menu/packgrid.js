// Grid inventory, DOM side: draws a grid of cells with the stacks lying in it, and a drag
// controller that lets the player pick a piece up, turn it and put it down somewhere else.
// Used by the inventory tab (backpack + equipment slots) and the cabin storage station
// (backpack + chest). All rules come from packlogic.js; the screens decide what to send.
//
// Grid markup (the controller relies on it):
//   .pg-grid[data-where][data-cols][data-rows]   one grid; cells are var(--pitch) square
//     .pg-cell                                   the empty cells (background)
//     .pg-pieces > .pg-item[data-drag][data-where][data-x][data-y][data-item]
//     .pg-hl                                     drop highlights, painted by the controller
//   [data-slot-drop="optics"]                    an equipment slot that takes drops
//     with data-drag + data-slot + data-item when something is equipped (drag it out)
import { el, icon, rarityColor } from '../kit.js';
import * as P from './packlogic.js';

const TIER_MARK = ['', 'I', 'II', 'III', 'IV'];

/** Play a UI sound if the audio module is up. Never throws. */
export function snd(ctx, name) {
  try { ctx.audio?.uiSound?.(name); } catch { /* audio is optional */ }
}

/** An item's picture: the larder painting for food and ingredients, else its icon. */
export function itemArt(ctx, def, size = 34) {
  if (def?.kind === 'ingredient' || def?.kind === 'food') {
    try {
      const art = ctx.forage?.foodArt?.(def.id, size);
      if (art) return art;
    } catch { /* fall back to the icon */ }
  }
  return icon(def?.icon || 'backpack', size);
}

/**
 * One piece lying in a grid (or the ghost of one): icon, name when it is big enough,
 * quantity, rarity edge and tier mark. `stack` is {item, qty, x, y, r}.
 */
export function pieceNode(ctx, def, stack, opts = {}) {
  const { w, h } = P.footprint(def, !!stack.r);
  const rar = Math.max(0, Math.min(4, def?.rarity | 0));
  const big = w >= 2 && h >= 2;
  const node = el('div', {
    class: `pg-item kit-rarity-${rar} k-${def?.kind || 'item'}${big ? ' big' : ''}${w === 1 && h === 1 ? ' unit' : ''}${opts.cls ? ' ' + opts.cls : ''}`,
    style: { '--x': stack.x | 0, '--y': stack.y | 0, '--w': w, '--h': h, '--rarity': rarityColor(rar), ...(opts.style || {}) },
    title: opts.title || null,
  });
  if (opts.drag) Object.assign(node.dataset, { drag: '1', where: opts.where, x: stack.x | 0, y: stack.y | 0, item: stack.item, r: stack.r ? '1' : '' });
  node.appendChild(el('span', { class: 'pg-art' }, itemArt(ctx, def, 40)));
  if (big) node.appendChild(el('span', { class: 'pg-name' }, def?.name || stack.item));
  if ((stack.qty | 0) > 1) node.appendChild(el('span', { class: 'pg-qty' }, '×' + stack.qty));
  if (def?.tier > 0 && def.kind === 'equipment') node.appendChild(el('span', { class: 'pg-tier', title: `Tier ${def.tier}` }, TIER_MARK[def.tier] || ''));
  return node;
}

/**
 * A grid of cells with its stacks. opts:
 *   model, items          the grid (packlogic gridModel) and ItemDefs by id
 *   selected              {where, x, y} of the selected stack, or null
 *   dim(def) → bool       pieces to dim (the filter)
 *   anim                  {where, x, y, cls, at} a piece to animate ('landed' | 'refused')
 *   lifted                {where, x, y} the piece being dragged (drawn faded)
 *   cls                   extra class
 */
export function renderGrid(ctx, opts) {
  const { model, items } = opts;
  const grid = el('div', {
    class: 'pg-grid' + (opts.cls ? ' ' + opts.cls : ''),
    dataset: { where: model.where, cols: model.W, rows: model.H },
    style: { '--cols': model.W, '--rows': model.H },
    role: 'grid', 'aria-label': opts.label || (model.where === 'storage' ? 'Cabin storage' : 'Backpack'),
  });
  const cells = el('div', { class: 'pg-cells' });
  const extra = model.where === 'storage' ? P.STORAGE_H : model.H;
  for (let i = 0; i < model.W * model.H; i++) {
    cells.appendChild(el('i', { class: 'pg-cell' + (Math.floor(i / model.W) >= extra ? ' overflow' : '') }));
  }
  const pieces = el('div', { class: 'pg-pieces' });
  const now = performance.now();
  for (const s of model.stacks) {
    const def = items[s.item];
    const at = (o) => o && o.where === model.where && o.x === (s.x | 0) && o.y === (s.y | 0);
    let cls = '';
    if (at(opts.selected)) cls += ' selected';
    if (at(opts.lifted)) cls += ' lifted';
    if (opts.dim?.(def)) cls += ' dim';
    let style = null;
    if (at(opts.anim) && now - opts.anim.at < 600) {
      cls += ' ' + opts.anim.cls;
      // A re-render mid-animation continues it instead of starting over.
      style = { animationDelay: `-${Math.round(now - opts.anim.at)}ms` };
    }
    const qty = (s.qty | 0) > 1 ? ` ×${s.qty}` : '';
    pieces.appendChild(pieceNode(ctx, def, s, { drag: true, where: model.where, cls: cls.trim(), style, title: `${def?.name || s.item}${qty}` }));
  }
  grid.append(cells, pieces, el('div', { class: 'pg-hl', 'aria-hidden': 'true' }));
  return grid;
}

/** A small footprint diagram (w x h cells filled in a square). */
export function footprintMini(def, r = false) {
  const rows = P.footprintDiagram(def, r);
  return el('span', { class: 'pg-mini', style: { '--n': rows.length }, 'aria-hidden': 'true' },
    rows.flat().map((on) => el('i', { class: on ? 'on' : '' })));
}

/* ---------------------------------------------------------------- drag controller */

const keyOf = (src) => (src.kind === 'slot' ? `slot:${src.slot}` : `${src.where}:${src.x},${src.y}`);

function srcOf(node) {
  const d = node.dataset;
  if (d.slot) return { kind: 'slot', slot: d.slot, item: d.item };
  return { kind: 'stack', where: d.where, x: +d.x, y: +d.y, item: d.item, r: d.r === '1' };
}

/**
 * Mouse drag-and-drop over the grids inside `hooks.root`. Window listeners exist only
 * while the mouse is down; dispose() removes everything (call it when the screen closes).
 * hooks:
 *   root                       element holding the grids and slots
 *   items()                    ItemDefs by id
 *   evalCell(src, where, x, y, r) → {ok, cells, reason, kind, swap?}
 *   evalSlot(src, slot)        → {ok, reason, swap?: {where, cells}}  (optional)
 *   drop(src, hover, r)        hover: {type:'cell', where, x, y, ev} | {type:'slot', slot, ev}
 *   refuse(src, reason)        a drop the rules refuse (wobble + message)
 *   select(src, ev) / activate(src) / quick(src)   click, double-click, shift-click
 *   status(text, ok)           the line under the grid while dragging ('' to clear)
 *   exists(src) → bool         is the dragged piece still there after a profile update
 */
export function createGridDrag(ctx, hooks) {
  let press = null;
  let drag = null;
  let lastClick = null;
  let listening = false;

  const onDown = (e) => {
    if (drag) {
      if (e.button === 2) { e.preventDefault(); turn(); }
      return;
    }
    if (e.button !== 0) return;
    const node = e.target.closest?.('[data-drag]');
    if (!node || !hooks.root.contains(node)) return;
    e.preventDefault();
    const r = node.getBoundingClientRect();
    press = { src: srcOf(node), x0: e.clientX, y0: e.clientY, rect: r, shift: e.shiftKey };
    listen(true);
  };

  const onMove = (e) => {
    if (press && !drag && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > 5) start(e);
    if (drag) update(e.clientX, e.clientY);
  };

  const onUp = (e) => {
    if (e.button === 2) return;
    if (drag) finish();
    else if (press) click(press.src, e);
    press = null;
    if (!drag) listen(false);
  };

  const onKey = (e) => {
    if (!drag) return;
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); hooks.status?.(''); }
    else if (e.code === 'KeyR') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) turn(); }
  };
  const onContext = (e) => { if (drag || press) e.preventDefault(); };
  const onBlur = () => cancel();

  function listen(on) {
    if (on === listening) return;
    listening = on;
    const f = on ? 'addEventListener' : 'removeEventListener';
    window[f]('mousemove', onMove);
    window[f]('mouseup', onUp);
    window[f]('keydown', onKey, true);
    window[f]('contextmenu', onContext, true);
    window[f]('blur', onBlur);
  }

  hooks.root.addEventListener('mousedown', onDown);
  hooks.root.addEventListener('contextmenu', (e) => { if (drag || e.target.closest?.('[data-drag]')) e.preventDefault(); });

  function click(src, e) {
    const now = performance.now();
    const key = keyOf(src);
    if (e.shiftKey && hooks.quick) { lastClick = null; hooks.quick(src); return; }
    if (lastClick && lastClick.key === key && now - lastClick.t < 420) {
      lastClick = null;
      hooks.activate?.(src);
      return;
    }
    lastClick = { key, t: now };
    hooks.select?.(src, e);
  }

  function start(e) {
    const src = press.src;
    const def = hooks.items()[src.item];
    if (!def) { press = null; return; }
    const pitch0 = pitchNear(src) || 48;
    const isSlot = src.kind === 'slot';
    const fp = P.footprint(def, !!src.r);
    // Where the piece was grabbed, as a fraction of its size (slots: the middle).
    let gx = 0.5, gy = 0.5;
    if (!isSlot && press.rect.width > 0) {
      gx = Math.min(0.95, Math.max(0.05, (press.x0 - press.rect.left) / press.rect.width));
      gy = Math.min(0.95, Math.max(0.05, (press.y0 - press.rect.top) / press.rect.height));
    }
    const ghost = el('div', { class: 'pg-ghost' });
    document.body.appendChild(ghost);
    drag = { src, def, r: !!src.r, gx, gy, ghost, pitch: pitch0, cx: e.clientX, cy: e.clientY, hover: null, paintKey: '', fp };
    press = null;
    hooks.root.classList.add('pg-dragging');
    drawGhost();
    markLifted();
    snd(ctx, 'click');
    hooks.select?.(src, null, true);
  }

  function pitchNear(src) {
    const grid = src.kind === 'stack' ? hooks.root.querySelector(`.pg-grid[data-where="${src.where}"]`) : hooks.root.querySelector('.pg-grid[data-where="inventory"]');
    if (!grid) return 0;
    const r = grid.getBoundingClientRect();
    return r.width / Math.max(1, +grid.dataset.cols);
  }

  function drawGhost() {
    const { def, r } = drag;
    const node = pieceNode(ctx, def, { item: def.id, qty: drag.src.kind === 'stack' ? qtyOf(drag.src) : 1, x: 0, y: 0, r },
      { style: { transformOrigin: `${Math.round(drag.gx * 100)}% ${Math.round(drag.gy * 100)}%` } });
    drag.ghost.replaceChildren(node);
    drag.fp = P.footprint(def, r);
    sizeGhost(drag.pitch);
  }

  function qtyOf(src) {
    const node = hooks.root.querySelector(`.pg-item[data-where="${src.where}"][data-x="${src.x}"][data-y="${src.y}"] .pg-qty`);
    return node ? parseInt(node.textContent.slice(1), 10) || 1 : 1;
  }

  function sizeGhost(pitch) {
    drag.ghost.style.setProperty('--pitch', pitch + 'px');
    drag.ghost.style.width = drag.fp.w * pitch + 'px';
    drag.ghost.style.height = drag.fp.h * pitch + 'px';
  }

  function markLifted() {
    hooks.root.querySelectorAll('.pg-item.lifted, [data-slot].lifted').forEach((n) => n.classList.remove('lifted'));
    if (!drag) return;
    const s = drag.src;
    const node = s.kind === 'slot'
      ? hooks.root.querySelector(`[data-slot="${s.slot}"]`)
      : hooks.root.querySelector(`.pg-item[data-where="${s.where}"][data-x="${s.x}"][data-y="${s.y}"]`);
    node?.classList.add('lifted');
  }

  function update(cx, cy) {
    drag.cx = cx; drag.cy = cy;
    const hit = document.elementFromPoint(cx, cy);
    const gridEl = hit?.closest?.('.pg-grid');
    const slotEl = hit?.closest?.('[data-slot-drop]');
    let hover = null;
    let gx = cx - drag.gx * drag.fp.w * drag.pitch, gy = cy - drag.gy * drag.fp.h * drag.pitch;
    if (gridEl && hooks.root.contains(gridEl)) {
      const rect = gridEl.getBoundingClientRect();
      const pitch = rect.width / Math.max(1, +gridEl.dataset.cols);
      if (Math.abs(pitch - drag.pitch) > 0.5) { drag.pitch = pitch; sizeGhost(pitch); }
      const { w, h } = drag.fp;
      const c = P.snapCell(cx - rect.left, cy - rect.top, pitch, drag.gx, drag.gy, w, h);
      const where = gridEl.dataset.where;
      const ev = hooks.evalCell(drag.src, where, c.x, c.y, drag.r);
      hover = { type: 'cell', where, x: c.x, y: c.y, ev };
      gx = rect.left + c.x * pitch; gy = rect.top + c.y * pitch;
    } else if (slotEl && hooks.root.contains(slotEl) && hooks.evalSlot) {
      const slot = slotEl.dataset.slotDrop;
      hover = { type: 'slot', slot, ev: hooks.evalSlot(drag.src, slot) };
    }
    drag.ghost.style.transform = `translate(${Math.round(gx)}px, ${Math.round(gy)}px)`;
    drag.ghost.classList.toggle('bad', !!hover && !hover.ev.ok);
    drag.ghost.classList.toggle('snapped', hover?.type === 'cell');
    drag.ghost.classList.toggle('over-slot', hover?.type === 'slot');
    drag.hover = hover;
    const key = hover ? `${hover.type}:${hover.where || hover.slot}:${hover.x},${hover.y}:${drag.r}` : '';
    if (key !== drag.paintKey) {
      drag.paintKey = key;
      paint(hover);
      hooks.status?.(hover ? hover.ev.reason || hover.ev.hint || '' : 'Let go here to put it back.', hover ? hover.ev.ok : true);
    }
  }

  function clearPaint() {
    hooks.root.querySelectorAll('.pg-hl').forEach((n) => n.replaceChildren());
    hooks.root.querySelectorAll('[data-slot-drop]').forEach((n) => n.classList.remove('drop-ok', 'drop-bad'));
  }

  function paintCells(where, cells, cls, label) {
    const layer = hooks.root.querySelector(`.pg-grid[data-where="${where}"] .pg-hl`);
    if (!layer) return;
    for (const c of cells) layer.appendChild(el('i', { class: 'pg-hl-cell ' + cls, style: { '--x': c.x, '--y': c.y } }));
    if (label && cells.length) {
      const x = Math.min(...cells.map((c) => c.x)), y = Math.min(...cells.map((c) => c.y));
      layer.appendChild(el('span', { class: 'pg-hl-label ' + cls, style: { '--x': x, '--y': y } }, label));
    }
  }

  function paint(hover) {
    clearPaint();
    if (!hover) return;
    const ev = hover.ev;
    if (hover.type === 'cell') {
      paintCells(hover.where, ev.cells || [], ev.ok ? (ev.kind === 'merge' ? 'merge' : 'ok') : 'bad', ev.kind === 'merge' && ev.ok ? `+${ev.qty}` : '');
    } else {
      hooks.root.querySelector(`[data-slot-drop="${hover.slot}"]`)?.classList.add(ev.ok ? 'drop-ok' : 'drop-bad');
    }
    if (ev.swap?.cells?.length) paintCells(ev.swap.where, ev.swap.cells, 'swap', ev.swap.label || '');
  }

  function turn() {
    if (!drag) return;
    const { w, h } = P.footprint(drag.def);
    if (w === h) return;
    drag.r = !drag.r;
    ({ gx: drag.gx, gy: drag.gy } = P.turnGrab(drag.gx, drag.gy));
    drawGhost();
    drag.paintKey = '';
    update(drag.cx, drag.cy);
    snd(ctx, 'click');
  }

  function end() {
    if (!drag) return null;
    const d = drag;
    drag = null;
    d.ghost.remove();
    clearPaint();
    hooks.root.classList.remove('pg-dragging');
    markLifted();
    listen(false);
    return d;
  }

  function finish() {
    const d = end();
    if (!d) return;
    const hover = d.hover;
    if (!hover) { hooks.status?.(''); return; } // dropped outside: it stays where it was
    if (hover.ev.ok) { hooks.status?.(''); hooks.drop(d.src, hover, d.r); }
    else hooks.refuse?.(d.src, hover.ev.reason);
  }

  function cancel() {
    press = null;
    end();
    listen(false);
  }

  return {
    get active() { return !!drag; },
    get src() { return drag?.src || null; },
    /** After a re-render: find the new elements, drop the drag if its piece is gone. */
    refresh() {
      if (!drag) return;
      if (hooks.exists && !hooks.exists(drag.src)) { cancel(); hooks.status?.(''); return; }
      markLifted();
      drag.paintKey = '';
      update(drag.cx, drag.cy);
    },
    turn,
    cancel,
    dispose() { cancel(); lastClick = null; },
  };
}
