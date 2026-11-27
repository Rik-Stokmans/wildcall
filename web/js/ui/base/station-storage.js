// Cabin storage station: the backpack grid and the 10 x 12 chest grid side by side, like
// gear spread out on the cabin table. Drag pieces between them ("place" with from/to),
// shift-click sends a piece to the other grid's first free space ("move"), Tidy re-packs
// either grid. Same grid component and rules as the inventory tab (ui/menu/packgrid.js,
// ui/menu/packlogic.js); the server stays the judge and its refusals are shown in place.
import { el, icon, button, rarityBadge } from '../kit.js';
import * as P from '../menu/packlogic.js';
import { renderGrid, createGridDrag, itemArt, footprintMini, snd } from '../menu/packgrid.js';

const HINT = 'Drag between pack and chest · shift-click sends to the other side · R or right-click turns · Esc cancels';
const OTHER = { inventory: 'storage', storage: 'inventory' };
const NAMES = { inventory: 'your pack', storage: 'the chest' };

function session(api) {
  const { view, ctx, state } = api;
  if (view.stg) return view.stg;
  const s = {
    root: el('div', { class: 'base-station base-storage st-grids' }),
    opt: null,      // {profile, inventory?, storage?}: the grids while the server answers
    pending: null,  // {at, where, x, y, profile}
    anim: null,     // {where, x, y, cls, at}
    msg: '', msgAt: 0,
  };
  view.stg = s;

  /** Both grid models; the same object for a grid within one call so moves within it work. */
  s.models = () => {
    const p = state.profile;
    const o = s.opt && s.opt.profile === p ? s.opt : null;
    return {
      inventory: P.gridModel('inventory', p, state.items, o?.inventory),
      storage: P.gridModel('storage', p, state.items, o?.storage),
    };
  };
  s.say = (text) => { s.msg = text || ''; s.msgAt = performance.now(); };
  s.isShown = () => ctx.ui.isOpen?.('base') && view.station === 'storage';
  s.send = (type, data, pend) => {
    s.pending = pend ? { ...pend, at: performance.now(), profile: state.profile } : null;
    ctx.net.send(type, data);
  };

  ctx.bus.on('net:error', (e) => {
    const pend = s.pending;
    if (!pend || performance.now() - pend.at > 4000) return;
    s.pending = null;
    s.opt = null;
    s.anim = { where: pend.where, x: pend.x, y: pend.y, cls: 'refused', at: performance.now() };
    s.say(e?.msg || 'That did not work.');
    snd(ctx, 'error');
    if (s.isShown()) api.rerender();
  });

  /** Drop the stack at (fx, fy) of `from` on (x, y) of `to`: optimistic, then "place". */
  s.place = (from, fx, fy, to, x, y, r) => {
    const m = s.models();
    const a = m[from], b = m[to];
    const ev = P.evaluatePlace(a, b, fx, fy, x, y, r, state.items);
    const after = P.applyPlace(a, b, fx, fy, x, y, r, state.items);
    if (!ev.ok || !after || ev.kind === 'same') return;
    s.opt = { profile: state.profile, [from]: after.from, [to]: after.to };
    const land = ev.kind === 'merge' ? b.stacks[ev.target] : { x, y };
    s.anim = { where: to, x: land.x | 0, y: land.y | 0, cls: 'landed', at: performance.now() };
    view.stackSel = { where: to, item: a.stacks[P.topLeftAt(a, fx, fy)]?.item, x: land.x | 0, y: land.y | 0 };
    s.say('');
    s.send('place', { from, fx, fy, to, x, y, r: !!r }, { where: from, x: fx, y: fy });
    snd(ctx, 'equip'); // a soft thunk
    api.rerender();
  };

  /** Shift-click: to the other grid's first free space (topping up stacks first). */
  s.quick = (src) => {
    const m = s.models();
    const from = src.where, to = OTHER[from];
    const q = P.quickMoveTarget(m[from], m[to], state.items, src.item);
    if (!q.ok) { refuse(src, q.reason); return; }
    const smallest = P.smallestStack(m[from].stacks, src.item);
    const clicked = P.topLeftAt(m[from], src.x, src.y);
    const t = q.target;
    const tx = t.kind === 'merge' ? m[to].stacks[t.target].x : t.x;
    const ty = t.kind === 'merge' ? m[to].stacks[t.target].y : t.y;
    if (clicked !== smallest) {
      // The server's "move" takes the smallest stack; this one goes by "place" instead.
      s.place(from, src.x, src.y, to, tx, ty, t.kind === 'merge' ? false : !!t.r);
      return;
    }
    s.anim = { where: to, x: tx | 0, y: ty | 0, cls: 'landed', at: performance.now() };
    view.stackSel = { where: to, item: src.item, x: tx | 0, y: ty | 0 };
    s.say('');
    s.send('move', { item: src.item, to }, { where: from, x: src.x, y: src.y });
    snd(ctx, 'equip');
    api.rerender();
  };

  function refuse(src, reason) {
    s.anim = { where: src.where, x: src.x, y: src.y, cls: 'refused', at: performance.now() };
    s.say(reason);
    snd(ctx, 'error');
    api.rerender();
  }

  s.drag = createGridDrag(ctx, {
    root: s.root,
    items: () => state.items,
    evalCell(src, where, x, y, r) {
      const m = s.models();
      return P.evaluatePlace(m[src.where], m[where], src.x, src.y, x, y, r, state.items);
    },
    drop(src, hover, r) { s.place(src.where, src.x, src.y, hover.where, hover.x, hover.y, r); },
    refuse,
    select(src, _e, quiet) {
      view.stackSel = { where: src.where, item: src.item, x: src.x, y: src.y };
      if (!quiet) snd(ctx, 'click');
      api.rerender();
    },
    activate(src) {
      const def = state.items[src.item];
      if (def?.kind === 'equipment' && def.slot) {
        s.send('equip', { item: def.id }, { where: src.where, x: src.x, y: src.y });
        snd(ctx, 'equip');
      } else s.quick(src);
    },
    quick: (src) => s.quick(src),
    status(text, ok) {
      const line = s.root.querySelector('.st-status');
      if (!line) return;
      line.classList.toggle('bad', !ok && !!text);
      line.textContent = text || (s.drag.active ? '' : HINT);
    },
    exists(src) {
      return s.models()[src.where].stacks.some((x) => x.x === src.x && x.y === src.y && x.item === src.item);
    },
  });
  return s;
}

export function renderStorage(api) {
  const { ctx, state, view } = api;
  const p = api.profile;
  const s = session(api);
  if (s.opt && s.opt.profile !== p) s.opt = null;
  if (s.pending && s.pending.profile !== p) s.pending = null;
  const items = state.items;
  const m = s.models();

  // Selection: a stack in either grid. Keep it while a move is on its way.
  let sel = view.stackSel && typeof view.stackSel === 'object' ? view.stackSel : null;
  if (sel) {
    const g = m[sel.where];
    const here = g?.stacks.find((x) => x.x === sel.x && x.y === sel.y && x.item === sel.item) || g?.stacks.find((x) => x.item === sel.item);
    if (here) sel = { where: sel.where, item: here.item, x: here.x, y: here.y };
    else if (!s.pending) sel = null;
  }
  if (!s.pending) view.stackSel = sel;

  const anim = s.anim && performance.now() - s.anim.at < 600 ? s.anim : null;
  const lifted = s.drag.active ? s.drag.src : null;
  const packDef = items[p.equipped?.backpack];
  const side = (where, title, ic) => {
    const g = m[where];
    const total = g.W * (where === 'storage' ? P.STORAGE_H : g.H); // overflow rows are not room
    const used = P.usedCells(g, items);
    return el('div', { class: `st-side st-${where}` },
      el('div', { class: 'st-head' },
        el('span', { class: 'st-title' }, icon(ic, 16), title),
        el('span', { class: 'st-count' + (used >= total ? ' full' : '') }, `${used} / ${total} cells`),
        button('Tidy', { small: true, icon: 'sort', disabled: !g.stacks.length, title: 'Re-pack neatly: stacks merged, biggest things first',
          onClick: () => { s.say(''); s.send('tidy', { where }); snd(ctx, 'page'); } })),
      el('div', { class: `st-box ${where === 'storage' ? 'st-chest base-station-scroll' : 'st-pack'}` },
        renderGrid(ctx, { model: g, items, selected: sel, anim, lifted, label: title })),
      where === 'storage' && g.H > P.STORAGE_H
        ? el('div', { class: 'st-overflow' }, 'The rows below the chest hold things that arrived while it was full. Move them out when you can.') : null);
  };

  const msgFresh = s.msg && performance.now() - s.msgAt < 9000;
  s.root.replaceChildren(
    el('div', { class: 'st-bench', style: { '--cols-all': m.inventory.W + m.storage.W } },
      side('inventory', packDef?.name || 'Your pack', 'backpack'),
      side('storage', 'Cabin storage', 'storage')),
    el('div', { class: 'st-status' + (msgFresh ? ' bad' : ''), 'aria-live': 'polite' }, msgFresh ? s.msg : HINT),
    detail(api, s, sel, m));
  queueMicrotask(() => s.drag.refresh());
  return s.root;
}

/** Close hook (base screen): drop a drag in progress and its window listeners. */
export function closeStorage(view) {
  view.stg?.drag.dispose();
}

function detail(api, s, sel, m) {
  const def = sel && api.state.items[sel.item];
  if (!def) {
    return el('div', { class: 'st-detail empty' },
      el('span', { class: 'base-muted' }, 'Select something to read about it. Equipped gear lives in the Equipment station and takes no room.'));
  }
  const stack = m[sel.where].stacks.find((x) => x.x === sel.x && x.y === sel.y);
  const to = OTHER[sel.where];
  const q = stack ? P.quickMoveTarget(m[sel.where], m[to], api.state.items, def.id) : { ok: false, reason: '' };
  const fp = P.footprint(def, !!stack?.r);
  return el('div', { class: 'st-detail' },
    el('span', { class: `st-detail-art kit-rarity-${def.rarity | 0}`, style: { '--rarity': `var(--rarity-${def.rarity | 0})` } }, itemArt(api.ctx, def, 30)),
    el('div', { class: 'st-detail-main' },
      el('div', { class: 'st-detail-title' }, el('b', def.name), rarityBadge(def.rarity),
        stack?.qty > 1 ? el('span', { class: 'base-muted' }, `×${stack.qty}`) : null,
        el('span', { class: 'st-detail-size' }, footprintMini(def, !!stack?.r), `${fp.w}×${fp.h}`),
        el('span', { class: 'base-muted' }, sel.where === 'storage' ? 'In the chest' : 'In your pack')),
      el('div', { class: 'st-detail-desc' }, def.desc || '')),
    el('div', { class: 'st-detail-actions' },
      def.kind === 'equipment' && def.slot
        ? button('Equip', { small: true, icon: 'check', onClick: () => { s.send('equip', { item: def.id }, { where: sel.where, x: sel.x, y: sel.y }); snd(api.ctx, 'equip'); } })
        : null,
      button(sel.where === 'storage' ? 'Take' : 'Store', { small: true, variant: 'primary', icon: sel.where === 'storage' ? 'back' : 'forward',
        disabled: !q.ok, title: q.ok ? `Send it to ${NAMES[to]}` : q.reason,
        onClick: () => s.quick({ kind: 'stack', where: sel.where, x: sel.x, y: sel.y, item: def.id }) })));
}
