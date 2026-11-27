// Inventory tab: the backpack as a grid of cells ("an open canvas pack on the table").
// Every stack lies at its own place and takes its item's footprint; the player arranges
// them by dragging (R or the right mouse button turns a piece). The six equipment slots
// beside the grid take drops to equip, and give items back by dragging them out. The
// detail pane on the right describes the selected item. Filters dim pieces in place:
// the layout is the player's; "Tidy" is the only sort.
import { el, icon, button, rarityBadge, label } from '../kit.js';
import * as L from './logic.js';
import * as P from './packlogic.js';
import { section, note, sfx, modRows } from './common.js';
import { renderGrid, createGridDrag, itemArt, footprintMini } from './packgrid.js';
import { abilityLines, activationLine, hasSpecial } from '../encounter/itemlogic.js';

const KIND_TEXT = { equipment: 'Equipment', gadget: 'Gadget', supply: 'Supply', keepsake: 'Keepsake', ingredient: 'Ingredient', food: 'Food' };
const TIER_TEXT = ['', 'Basic', 'Explorer', 'Specialist', 'Unique'];
const SLOT_ICON = { optics: 'binoculars', camera: 'camera', audio: 'microphone', backpack: 'backpack', navigation: 'compass', clothing: 'clothing' };
const HINT = 'Drag to arrange · R or right-click turns while dragging · double-click to equip or use · Esc cancels';

/* ------------------------------------------------------------------ session */

/**
 * The tab's state that outlives one render: the persistent root (the drag controller
 * listens on it), the optimistic layout while the server answers, animations, messages.
 * Created once per game menu and kept in st.inv.
 */
function session(ctx, st) {
  if (st.inv) return st.inv;
  const { state, bus, net } = ctx;
  const inv = {
    root: el('div', { class: 'menu-inventory inv-grid-tab' }),
    opt: null,        // {profile, stacks}: the backpack as it will be once the server agrees
    pending: null,    // {at, where, x, y} the piece of the last request (wobbles if refused)
    follow: null,     // {item, x, y, r, at}: after an unequip, move the item to where it was dropped
    anim: null,       // {where, x, y, cls, at} | {slot, cls, at}
    msg: '', msgOk: true, msgAt: 0,
    drag: null,
  };
  st.inv = inv;

  inv.model = () => {
    const p = state.profile;
    const stacks = inv.opt && inv.opt.profile === p ? inv.opt.stacks : null;
    return P.gridModel('inventory', p, state.items, stacks);
  };

  inv.say = (text, ok = false) => { inv.msg = text || ''; inv.msgOk = ok; inv.msgAt = performance.now(); };

  inv.isShown = () => ctx.ui.isOpen?.('menu') && st.tab === 'inventory';

  // A refusal from the server: put things back and wobble the piece.
  bus.on('net:error', (e) => {
    const pend = inv.pending;
    if (!pend || performance.now() - pend.at > 4000) return;
    inv.pending = null;
    inv.opt = null;
    inv.follow = null;
    inv.anim = pend.slot ? { slot: pend.slot, cls: 'refused', at: performance.now() } : { where: 'inventory', x: pend.x, y: pend.y, cls: 'refused', at: performance.now() };
    inv.say(e?.msg || 'That did not work.');
    sfx(ctx, 'error');
    if (inv.isShown()) st.rerender();
  });

  inv.send = (type, data, pend) => {
    inv.pending = pend ? { ...pend, at: performance.now(), profile: state.profile } : null;
    net.send(type, data);
  };

  inv.place = (fx, fy, x, y, r, quiet = false) => {
    const m = inv.model();
    const after = P.applyPlace(m, m, fx, fy, x, y, r, state.items);
    const ev = P.evaluatePlace(m, m, fx, fy, x, y, r, state.items);
    if (!after || ev.kind === 'same') return false;
    inv.opt = { profile: state.profile, stacks: after.to };
    const land = ev.kind === 'merge' ? m.stacks[ev.target] : { x, y };
    inv.anim = { where: 'inventory', x: land.x | 0, y: land.y | 0, cls: 'landed', at: performance.now() };
    inv.say('');
    inv.send('place', { from: 'inventory', fx, fy, to: 'inventory', x, y, r: !!r }, { x: fx, y: fy });
    sfx(ctx, 'equip'); // a soft leather thunk
    if (!quiet && inv.isShown()) st.rerender();
    return true;
  };

  inv.drag = createGridDrag(ctx, {
    root: inv.root,
    items: () => state.items,
    evalCell(src, where, x, y, r) {
      const m = inv.model();
      if (src.kind === 'stack') return P.evaluatePlace(m, m, src.x, src.y, x, y, r, state.items);
      // From an equipment slot: the item comes back into the pack at this spot.
      const def = state.items[src.item];
      if (src.slot === 'backpack') return { ok: true, kind: 'unequip', cells: [], reason: '', hint: `Taking the ${def?.name || 'pack'} off changes the size of your pack: it will be re-packed.` };
      const { w, h } = P.footprint(def, r);
      const cells = P.cellsOf(x, y, w, h);
      if (!P.inBounds(m, x, y, w, h)) return { ok: false, kind: 'oob', cells: cells.filter((c) => P.inBounds(m, c.x, c.y, 1, 1)), reason: `The ${def?.name} does not fit there.` };
      const occ = P.occupancy(m, state.items);
      const hit = cells.map((c) => occ[c.y * m.W + c.x]).find((v) => v);
      if (hit) return { ok: false, kind: 'taken', cells, reason: `That spot is taken by the ${state.items[m.stacks[hit - 1].item]?.name || 'item'}.` };
      return { ok: true, kind: 'unequip', cells, reason: '' };
    },
    evalSlot(src, slot) {
      const def = state.items[src.item];
      if (src.kind === 'slot') return { ok: src.slot === slot, reason: '' };
      if (!L.canEquip(def)) return { ok: false, reason: `The ${def?.name || 'item'} is not something you wear: it works from your pack.` };
      if (def.slot !== slot) return { ok: false, reason: `The ${def.name} goes in the ${L.SLOT_NAMES[def.slot] || def.slot} slot.` };
      const p = state.profile;
      const prev = p.equipped?.[slot];
      if (!prev) return { ok: true, reason: '', hint: `Wear the ${def.name}.` };
      const prevDef = state.items[prev];
      if (slot === 'backpack') return { ok: true, reason: '', hint: `Swap packs: your things move into the ${def.name}.` };
      const m = inv.model();
      const i = m.stacks.findIndex((s) => s.x === src.x && s.y === src.y);
      const at = P.predictSwap(m, state.items, i, prev);
      if (!at) return { ok: true, reason: '', hint: `There may be no room for the ${prevDef?.name} you would take off.` };
      if (at.tidy) return { ok: true, reason: '', hint: `Your pack will be tidied to make room for the ${prevDef?.name}.` };
      const fp = P.footprint(prevDef, at.r);
      return { ok: true, reason: '', hint: `Your ${prevDef?.name} will go here.`,
        swap: { where: 'inventory', cells: P.cellsOf(at.x, at.y, fp.w, fp.h), label: prevDef?.name || '' } };
    },
    drop(src, hover, r) {
      if (hover.type === 'cell') {
        if (src.kind === 'stack') { inv.place(src.x, src.y, hover.x, hover.y, r); return; }
        // Unequip, then move it to the chosen spot once the server has put it in the pack.
        if (src.slot !== 'backpack') inv.follow = { item: src.item, x: hover.x, y: hover.y, r: !!r, at: performance.now() };
        inv.say('');
        inv.send('unequip', { slot: src.slot }, { slot: src.slot });
        sfx(ctx, 'equip');
        st.itemSel = { where: 'inventory', item: src.item, x: hover.x, y: hover.y };
        st.rerender();
        return;
      }
      if (src.kind === 'stack') {
        inv.say('');
        inv.send('equip', { item: src.item }, { x: src.x, y: src.y });
        inv.anim = { slot: hover.slot, cls: 'landed', at: performance.now() };
        st.itemSel = { slot: hover.slot, item: src.item };
        sfx(ctx, 'equip');
        st.rerender();
      }
    },
    refuse(src, reason) {
      inv.anim = src.kind === 'slot' ? { slot: src.slot, cls: 'refused', at: performance.now() } : { where: 'inventory', x: src.x, y: src.y, cls: 'refused', at: performance.now() };
      inv.say(reason);
      sfx(ctx, 'error');
      st.rerender();
    },
    select(src, _e, quiet) {
      st.itemSel = src.kind === 'slot' ? { slot: src.slot, item: src.item } : { where: 'inventory', item: src.item, x: src.x, y: src.y };
      if (!quiet) sfx(ctx, 'click');
      st.rerender();
    },
    activate(src) { activate(ctx, st, src); },
    status(text, ok) {
      const line = inv.root.querySelector('.inv-status');
      if (!line) return;
      line.classList.toggle('bad', !ok && !!text);
      line.textContent = text || (inv.drag.active ? '' : HINT);
    },
    exists(src) {
      if (src.kind === 'slot') return state.profile?.equipped?.[src.slot] === src.item;
      return inv.model().stacks.some((s) => s.x === src.x && s.y === src.y && s.item === src.item);
    },
  });
  return inv;
}

/** Double-click: equip gear, use or eat supplies and food, take equipped gear off. */
function activate(ctx, st, src) {
  const inv = st.inv;
  const def = ctx.state.items[src.item];
  if (!def) return;
  if (src.kind === 'slot') {
    inv.send('unequip', { slot: src.slot }, { slot: src.slot });
    sfx(ctx, 'equip');
  } else if (L.canEquip(def)) {
    inv.send('equip', { item: def.id }, { x: src.x, y: src.y });
    inv.anim = { slot: def.slot, cls: 'landed', at: performance.now() };
    st.itemSel = { slot: def.slot, item: def.id };
    sfx(ctx, 'equip');
  } else if (L.canUse(def)) {
    inv.send('use', { item: def.id }, { x: src.x, y: src.y });
    sfx(ctx, 'click');
  } else return;
  st.rerender();
}

/** Called on every render: forget the optimistic layout once a new profile arrived, and
 * finish an unequip-by-drag by moving the item to where it was dropped. */
function syncProfile(ctx, inv) {
  const p = ctx.state.profile;
  if (inv.opt && inv.opt.profile !== p) inv.opt = null;
  if (inv.pending && inv.pending.profile !== p) inv.pending = null; // the server agreed
  const f = inv.follow;
  if (!f) return;
  if (performance.now() - f.at > 4000) { inv.follow = null; return; }
  const m = inv.model();
  const s = m.stacks.find((x) => x.item === f.item);
  if (!s) return; // not back in the pack yet
  inv.follow = null;
  if (s.x === f.x && s.y === f.y && !!s.r === f.r) return;
  const ev = P.evaluatePlace(m, m, s.x, s.y, f.x, f.y, f.r, ctx.state.items);
  if (ev.ok && ev.kind === 'move') inv.place(s.x, s.y, f.x, f.y, f.r, true);
}

/* ------------------------------------------------------------------ render */

export function renderInventory(ctx, st) {
  const { state } = ctx;
  const p = state.profile;
  if (!p) return el('div', { class: 'menu-empty' }, 'Your pack is not ready yet.');
  st.filter = L.FILTERS.some((f) => f.id === st.filter) ? st.filter : 'all';
  const inv = session(ctx, st);
  syncProfile(ctx, inv);
  const items = state.items;
  const model = inv.model();
  const use = P.usage(model, items);

  // Selection: a stack in the pack {where, x, y, item} or an equipped item {slot, item}.
  let sel = st.itemSel;
  if (sel?.slot) {
    if (p.equipped?.[sel.slot] !== sel.item) sel = null;
  } else if (sel) {
    const here = model.stacks.find((s) => s.x === sel.x && s.y === sel.y && s.item === sel.item)
      || model.stacks.find((s) => s.item === sel.item);
    sel = here ? { where: 'inventory', item: here.item, x: here.x, y: here.y } : null;
  }
  // While a request is on its way (equip, unequip) the selection may point at where the
  // item is about to be: keep it, and show the first piece meanwhile.
  const waiting = !sel && st.itemSel && inv.pending;
  if (!sel && model.stacks.length) {
    const first = [...model.stacks].sort((a, b) => a.y - b.y || a.x - b.x)[0];
    sel = { where: 'inventory', item: first.item, x: first.x, y: first.y };
  }
  if (!waiting) st.itemSel = sel;

  const packDef = items[p.equipped?.backpack];
  const packName = packDef?.name || 'Your pack';
  const dim = st.filter === 'all' ? null : (def) => L.itemCategory(def) !== st.filter;

  const toolbar = el('div', { class: 'menu-toolbar' },
    el('div', { class: 'menu-chips', role: 'group', 'aria-label': 'Highlight' }, L.FILTERS.map((f) =>
      el('button', { class: 'menu-chip' + (st.filter === f.id ? ' on' : ''), type: 'button',
        onclick: () => { st.filter = f.id; sfx(ctx, 'click'); st.rerender(); } }, f.label))),
    el('div', { class: 'inv-tools' },
      button('Tidy', { small: true, icon: 'sort', title: 'Re-pack neatly: stacks merged, biggest things first',
        disabled: !model.stacks.length,
        onClick: () => { inv.say(''); inv.send('tidy', { where: 'inventory' }); sfx(ctx, 'page'); } }),
      el('div', { class: 'menu-capacity' + (use.full ? ' full' : ''), title: `${use.free} free cell${use.free === 1 ? '' : 's'}` },
        icon('backpack', 16), el('b', `${use.used} / ${use.total}`), el('span', 'cells'))));

  // The six slots beside the grid: drop targets, and drag sources when filled.
  const slots = el('div', { class: 'inv-slots' }, L.SLOTS.map((slot) => {
    const def = items[p.equipped?.[slot]];
    const anim = inv.anim?.slot === slot && performance.now() - inv.anim.at < 600 ? inv.anim : null;
    const attrs = {
      class: 'inv-slot' + (def ? ' filled' : '') + (sel?.slot === slot ? ' selected' : '') + (anim ? ' ' + anim.cls : ''),
      dataset: { slotDrop: slot, ...(def ? { drag: '1', slot, item: def.id } : {}) },
      style: { '--rarity': def ? `var(--rarity-${def.rarity | 0})` : null, animationDelay: anim ? `-${Math.round(performance.now() - anim.at)}ms` : null },
      title: def ? `${def.name} (drag into your pack to take it off)` : `${L.SLOT_NAMES[slot]}: drop gear here to wear it`,
    };
    return el('div', attrs,
      el('span', { class: 'inv-slot-art' }, def ? itemArt(ctx, def, 28) : icon(SLOT_ICON[slot], 24)),
      el('span', { class: 'inv-slot-text' },
        el('span', { class: 'inv-slot-name' }, L.SLOT_NAMES[slot]),
        el('span', { class: 'inv-slot-item' }, def ? def.name : 'Empty')));
  }));

  const grid = renderGrid(ctx, {
    model, items, dim,
    selected: sel?.slot ? null : sel,
    anim: inv.anim?.where ? inv.anim : null,
    lifted: inv.drag.active && inv.drag.src?.kind === 'stack' ? inv.drag.src : null,
    label: packName,
  });
  const stage = el('div', { class: 'inv-stage' },
    el('div', { class: 'inv-pack' },
      el('div', { class: 'inv-pack-head' },
        el('span', { class: 'inv-pack-name' }, icon('backpack', 15), packName),
        el('span', { class: 'inv-pack-size' }, `${model.W} × ${model.H}`)),
      grid,
      model.stacks.length ? null : el('div', { class: 'inv-pack-empty' }, 'Your pack is empty. Explore, and you will find things worth carrying.')));

  // The line under the grid: the last refusal (fades after a while) or a hint.
  const msgFresh = inv.msg && performance.now() - inv.msgAt < 9000;
  const status = el('div', { class: 'inv-status' + (msgFresh && !inv.msgOk ? ' bad' : ''), 'aria-live': 'polite' }, msgFresh ? inv.msg : HINT);

  inv.root.replaceChildren(
    el('div', { class: 'menu-inv-main' }, toolbar,
      el('div', { class: 'inv-bench' }, slots, stage),
      status),
    el('aside', { class: 'menu-detail', 'data-scroll': 'inv-detail' }, itemDetail(ctx, st, sel, model)));
  queueMicrotask(() => inv.drag.refresh());
  return inv.root;
}

/** Close hook (gamemenu): drop a drag in progress and its window listeners. */
export function closeInventory(st) {
  st.inv?.drag?.dispose();
}

function itemDetail(ctx, st, sel, model) {
  const { state } = ctx;
  const p = state.profile;
  const inv = st.inv;
  const def = sel && state.items[sel.item];
  if (!def) return note('Select an item to read about it. Drag gear onto a slot on the left to wear it.');
  const isEquipped = !!sel.slot;
  const stack = isEquipped ? null : model.stacks.find((s) => s.x === sel.x && s.y === sel.y);
  const mods = L.effectiveMods(def, p);
  const total = isEquipped ? 0 : model.stacks.filter((s) => s.item === def.id).reduce((n, s) => n + (s.qty | 0), 0);

  const actions = [];
  if (isEquipped) {
    actions.push(button('Unequip', { icon: 'down',
      onClick: () => { inv.send('unequip', { slot: sel.slot }, { slot: sel.slot }); sfx(ctx, 'equip'); } }));
  } else if (L.canEquip(def)) {
    actions.push(button('Equip', { variant: 'primary', icon: 'check',
      onClick: () => activate(ctx, st, { kind: 'stack', item: def.id, x: sel.x, y: sel.y }) }));
  }
  if (!isEquipped && L.canUse(def)) {
    actions.push(button(L.useLabel(def), { variant: 'primary', icon: def.use === 'seed' ? 'seed' : def.use === 'eat' ? 'heart' : 'film',
      onClick: () => { inv.send('use', { item: def.id }, { x: sel.x, y: sel.y }); sfx(ctx, 'click'); } }));
    // c-field: what eating it does, and that it replaces the current buff of its kind.
    if (def.use === 'eat' && def.buff) actions.push(note(`${def.buff.text}. Replaces any ${def.buff.slot} you already had.`));
  }
  if (stack) {
    const fp = P.footprint(def);
    if (fp.w !== fp.h) {
      const ev = P.evaluatePlace(model, model, stack.x, stack.y, stack.x, stack.y, !stack.r, state.items);
      actions.push(button('Turn', { small: true, icon: 'upgrade', disabled: !ev.ok, title: ev.ok ? 'Turn it a quarter where it lies' : ev.reason,
        onClick: () => inv.place(stack.x, stack.y, stack.x, stack.y, !stack.r) }));
    }
  }
  if (!isEquipped && !L.canEquip(def) && !L.canUse(def)) {
    actions.push(note(def.kind === 'gadget' ? 'Works while you carry it.' : def.kind === 'keepsake' ? 'A keepsake. It is yours to keep.'
      : def.kind === 'ingredient' ? 'An ingredient for the field kitchen: cook it at the cabin or over a camp fire.' : ''));
  }

  const lines = (list, cls) => list?.length ? el('ul', { class: 'menu-prosons ' + cls }, list.map((t) => el('li', t))) : null;
  const fp = P.footprint(def, !!stack?.r);
  const limit = P.stackLimit(def, 'inventory', p.equipped);
  const sizeText = `${fp.w}×${fp.h} cell${fp.w * fp.h === 1 ? '' : 's'}` + (stack?.r ? ', turned' : '') + (limit > 1 ? ` · stacks of ${limit}` : '');

  return el('div', { class: 'menu-detail-inner' },
    el('div', { class: 'menu-detail-head' },
      el('span', { class: `menu-item-art kit-rarity-${def.rarity | 0}`, style: { '--rarity': `var(--rarity-${def.rarity | 0})` } }, itemArt(ctx, def, 34)),
      el('div',
        el('h2', { class: 'menu-detail-title' }, def.name),
        el('div', { class: 'menu-detail-sub' }, rarityBadge(def.rarity),
          el('span', { class: 'menu-faint' }, [KIND_TEXT[def.kind] || label(def.kind), def.slot ? label(def.slot) : '', TIER_TEXT[def.tier] ? `Tier ${def.tier} · ${TIER_TEXT[def.tier]}` : ''].filter(Boolean).join(' · '))))),
    el('div', { class: 'inv-detail-tags' },
      isEquipped ? el('span', { class: 'menu-tag purchased' }, 'Equipped') : (stack?.qty > 1 ? el('span', { class: 'menu-tag' }, `×${stack.qty} in this stack` + (total > stack.qty ? ` · ${total} carried` : '')) : null),
      el('span', { class: 'inv-size', title: isEquipped ? 'The room it takes when it is in your pack' : 'The room it takes in your pack' }, footprintMini(def, !!stack?.r), sizeText)),
    el('p', { class: 'menu-desc' }, def.desc),
    hasSpecial(def) ? section('Special ability', el('div', { class: 'menu-special' },
      el('p', { class: 'menu-effect' }, def.special),
      abilityLines(def).length ? el('ul', { class: 'menu-abilities' }, abilityLines(def).map((l) => el('li', icon(l.icon, 14), el('span', l.text)))) : null,
      activationLine(def) ? el('p', { class: 'menu-faint menu-activate' }, activationLine(def)) : null)) : null,
    Object.values(mods).some((v) => v) ? section('Effects', el('div', { class: 'menu-mods' }, modRows(mods))) : null,
    def.pros?.length || def.cons?.length ? section('In the field', lines(def.pros, 'pros'), lines(def.cons, 'cons')) : null,
    (def.rarity >= 2 && def.history) ? section('History', el('p', { class: 'menu-history' }, def.history)) : null,
    el('div', { class: 'menu-detail-actions' }, actions),
    note('Spare gear and surplus supplies can be left in storage at the cabin.', 'menu-storage-note'));
}
