// Inventory tab: carried items in a grid with sort/filter, capacity, and a details pane.
// Equipped gear is listed in a strip above the grid (it does not use backpack space).
import { el, icon, button, itemCard, rarityBadge, label } from '../kit.js';
import * as L from './logic.js';
import { section, note, sfx, modRows } from './common.js';
import { abilityLines, activationLine, hasSpecial } from '../encounter/itemlogic.js';

const KIND_TEXT = { equipment: 'Equipment', gadget: 'Gadget', supply: 'Supply', keepsake: 'Keepsake', ingredient: 'Ingredient', food: 'Food' };
const TIER_TEXT = ['', 'Basic', 'Explorer', 'Specialist', 'Unique'];

export function renderInventory(ctx, st) {
  const { state } = ctx;
  const p = state.profile;
  if (!p) return el('div', { class: 'menu-empty' }, 'Your pack is not ready yet.');
  st.filter = st.filter || 'all';
  st.sort = st.sort || 'name';

  const cap = L.capacityUsage(p, state.stats.capacity);
  const shown = L.sortStacks(L.filterStacks(p.inventory, state.items, st.filter), state.items, st.sort);

  // Selection: { item, equippedSlot? }. Drop it if the item is gone.
  const sel = st.itemSel;
  const equippedSlot = sel?.slot && p.equipped?.[sel.slot] === sel.item ? sel.slot : null;
  const carried = sel && (p.inventory || []).some((s) => s.item === sel.item);
  if (sel && !carried && !equippedSlot) st.itemSel = null;
  if (!st.itemSel && shown.length) st.itemSel = { item: shown[0].item };

  const toolbar = el('div', { class: 'menu-toolbar' },
    el('div', { class: 'menu-chips', role: 'group', 'aria-label': 'Filter' }, L.FILTERS.map((f) =>
      el('button', { class: 'menu-chip' + (st.filter === f.id ? ' on' : ''), type: 'button',
        onclick: () => { st.filter = f.id; sfx(ctx, 'click'); st.rerender(); } }, f.label))),
    el('label', { class: 'menu-sort' }, icon('sort', 14), 'Sort',
      el('select', { onchange: (e) => { st.sort = e.target.value; sfx(ctx, 'click'); st.rerender(); } },
        L.SORTS.map((o) => el('option', { value: o.id, selected: st.sort === o.id }, o.label)))),
    el('div', { class: 'menu-capacity' + (cap.full ? ' full' : '') }, icon('backpack', 16), el('b', `${cap.used} / ${cap.cap}`), el('span', 'carried')));

  const equippedStrip = el('div', { class: 'menu-equipped-strip' },
    el('span', { class: 'menu-faint' }, 'Equipped'),
    L.SLOTS.map((slot) => {
      const def = state.items[p.equipped?.[slot]];
      if (!def) return null;
      return el('div', { class: 'menu-equipped-item' }, itemCard(def, {
        compact: true, equipped: true,
        selected: st.itemSel?.slot === slot && st.itemSel?.item === def.id,
        onClick: () => { st.itemSel = { item: def.id, slot }; sfx(ctx, 'click'); st.rerender(); },
      }));
    }));

  const grid = el('div', { class: 'menu-grid', 'data-scroll': 'inv-grid' },
    shown.length
      ? shown.map((s) => {
        const def = state.items[s.item];
        if (!def) return null;
        return el('div', { class: 'menu-grid-cell' }, larderArt(ctx, def, itemCard(def, {
          qty: s.qty, selected: st.itemSel?.item === s.item && !st.itemSel?.slot,
          onClick: () => { st.itemSel = { item: s.item }; sfx(ctx, 'click'); st.rerender(); },
        }), 34));
      })
      : el('div', { class: 'menu-empty small' }, (p.inventory || []).length ? 'Nothing here matches that filter.' : 'Your pack is empty. Explore, and you will find things worth carrying.'));

  return el('div', { class: 'menu-inventory' },
    el('div', { class: 'menu-inv-main' }, toolbar, equippedStrip, grid,
      note('Spare gear and surplus supplies can be left in storage at the cabin.', 'menu-storage-note')),
    el('aside', { class: 'menu-detail', 'data-scroll': 'inv-detail' }, itemDetail(ctx, st, cap)));
}

function itemDetail(ctx, st, cap) {
  const { state, net } = ctx;
  const p = state.profile;
  const sel = st.itemSel;
  const def = sel && state.items[sel.item];
  if (!def) return note('Select an item to read about it.');
  const isEquipped = !!sel.slot;
  const stack = (p.inventory || []).find((s) => s.item === def.id);
  const mods = L.effectiveMods(def, p);

  const actions = [];
  if (isEquipped) {
    actions.push(button('Unequip', { icon: 'down', disabled: cap.full, title: cap.full ? 'Your pack is full.' : '',
      onClick: () => { sfx(ctx, 'equip'); net.send('unequip', { slot: sel.slot }); } }));
    if (cap.full) actions.push(note('Make room in your pack first.'));
  } else if (L.canEquip(def)) {
    actions.push(button('Equip', { variant: 'primary', icon: 'check',
      onClick: () => { sfx(ctx, 'equip'); net.send('equip', { item: def.id }); } }));
  }
  if (!isEquipped && L.canUse(def)) {
    actions.push(button(L.useLabel(def), { variant: 'primary', icon: def.use === 'seed' ? 'seed' : def.use === 'eat' ? 'heart' : 'film',
      onClick: () => { sfx(ctx, 'click'); net.send('use', { item: def.id }); } }));
    // c-field: what eating it does, and that it replaces the current buff of its kind.
    if (def.use === 'eat' && def.buff) actions.push(note(`${def.buff.text}. Replaces any ${def.buff.slot} you already had.`));
  }
  if (!isEquipped && !L.canEquip(def) && !L.canUse(def)) {
    actions.push(note(def.kind === 'gadget' ? 'Works while you carry it.' : def.kind === 'keepsake' ? 'A keepsake. It is yours to keep.'
      : def.kind === 'ingredient' ? 'An ingredient for the field kitchen: cook it at the cabin or over a camp fire.' : ''));
  }

  const lines = (list, cls) => list?.length ? el('ul', { class: 'menu-prosons ' + cls }, list.map((t) => el('li', t))) : null;

  return el('div', { class: 'menu-detail-inner' },
    el('div', { class: 'menu-detail-head' },
      el('span', { class: `menu-item-art kit-rarity-${def.rarity | 0}`, style: { '--rarity': `var(--rarity-${def.rarity | 0})` } }, larderIcon(ctx, def, 34) || icon(def.icon || 'backpack', 34)),
      el('div',
        el('h2', { class: 'menu-detail-title' }, def.name),
        el('div', { class: 'menu-detail-sub' }, rarityBadge(def.rarity),
          el('span', { class: 'menu-faint' }, [KIND_TEXT[def.kind] || label(def.kind), def.slot ? label(def.slot) : '', TIER_TEXT[def.tier] ? `Tier ${def.tier} · ${TIER_TEXT[def.tier]}` : ''].filter(Boolean).join(' · '))))),
    isEquipped ? el('span', { class: 'menu-tag purchased' }, 'Equipped') : (stack?.qty > 1 ? el('span', { class: 'menu-tag' }, `×${stack.qty} carried`) : null),
    el('p', { class: 'menu-desc' }, def.desc),
    hasSpecial(def) ? section('Special ability', el('div', { class: 'menu-special' },
      el('p', { class: 'menu-effect' }, def.special),
      abilityLines(def).length ? el('ul', { class: 'menu-abilities' }, abilityLines(def).map((l) => el('li', icon(l.icon, 14), el('span', l.text)))) : null,
      activationLine(def) ? el('p', { class: 'menu-faint menu-activate' }, activationLine(def)) : null)) : null,
    Object.values(mods).some((v) => v) ? section('Effects', el('div', { class: 'menu-mods' }, modRows(mods))) : null,
    def.pros?.length || def.cons?.length ? section('In the field', lines(def.pros, 'pros'), lines(def.cons, 'cons')) : null,
    (def.rarity >= 2 && def.history) ? section('History', el('p', { class: 'menu-history' }, def.history)) : null,
    el('div', { class: 'menu-detail-actions' }, actions));
}

// c-field hook: ingredients and food show a small painting of themselves (ctx.forage.foodArt)
// instead of a generic icon; anything else, or a missing forage module, keeps the icon.
function larderIcon(ctx, def, size) {
  if (def?.kind !== 'ingredient' && def?.kind !== 'food') return null;
  try { return ctx.forage?.foodArt?.(def.id, size) || null; } catch { return null; }
}

function larderArt(ctx, def, card, size) {
  const art = larderIcon(ctx, def, size);
  const slot = art && card.querySelector('.kit-item-icon');
  if (slot) slot.replaceChildren(art);
  return card;
}
