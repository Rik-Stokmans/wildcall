// Equipment Station: the six slots, swapping gear from the backpack or storage, and
// upgrades for the gear the player owns. Shared by nothing else; the shop has its own view.
import { el, icon, button, itemCard, formatMod } from '../kit.js';
import * as L from './logic.js';
import { deltaRows, modChips, prosCons, itemTitle, emptyState, sectionTitle, upgradeCard } from './views.js';

const WHERE = { equipped: 'Equipped', backpack: 'In backpack', storage: 'In storage' };

function slotTiles(api) {
  const items = api.state.items;
  return el('div', { class: 'base-slots' }, L.EQUIP_SLOTS.map((slot) => {
    const info = L.SLOT_INFO[slot];
    const id = api.profile.equipped?.[slot];
    const def = id ? items[id] : null;
    const active = api.view.slot === slot;
    return el('button', { class: 'base-slot' + (active ? ' active' : '') + (def ? '' : ' empty'), type: 'button',
      onclick: () => { api.snd('click'); api.view.slot = slot; api.rerender(); } },
      el('div', { class: 'base-slot-head' }, icon(info.icon, 18), el('span', info.label)),
      def ? el('div', { class: 'base-slot-item', style: { '--rarity': `var(--rarity-${def.rarity | 0})` } }, def.name)
        : el('div', { class: 'base-slot-item muted' }, info.empty));
  }));
}

function candidateRow(api, entry) {
  const { item, where, qty } = entry;
  const cmp = L.compareToEquipped(item, api.profile, api.state.items);
  const equipped = where === 'equipped';
  return el('div', { class: 'base-row' + (equipped ? ' equipped' : '') },
    el('div', { class: 'base-row-main' },
      itemTitle(item),
      el('div', { class: 'base-row-where' }, WHERE[where] + (qty > 1 ? ` ×${qty}` : '')),
      equipped ? null : deltaRows(cmp.deltas, (d) => `${formatMod(d.key, d.cur)} → ${formatMod(d.key, d.next)}`),
      equipped ? null : prosCons(item)),
    el('div', { class: 'base-row-actions' },
      equipped
        ? button('Unequip', { variant: 'secondary', small: true, onClick: () => api.send('unequip', { slot: item.slot }, 'equip') })
        : button('Equip', { variant: 'primary', small: true, icon: 'check', onClick: () => api.send('equip', { item: item.id }, 'equip') })));
}

function currentGear(api, slot, owned) {
  const eq = owned.find((o) => o.where === 'equipped');
  if (!eq) {
    return el('div', { class: 'base-block' },
      el('div', { class: 'base-block-label' }, 'In this slot'),
      emptyState(L.SLOT_INFO[slot].empty + ' equipped.', 'Pick something from the backpack or storage below.'));
  }
  const item = eq.item;
  const eff = L.effectiveMods(item, api.profile);
  return el('div', { class: 'base-block' },
    el('div', { class: 'base-block-label' }, 'Currently equipped'),
    el('div', { class: 'base-current' },
      itemCard(item, { equipped: true, compact: false }),
      el('div', { class: 'base-current-info' },
        el('p', { class: 'base-desc' }, item.desc),
        prosCons(item),
        Object.keys(eff).length ? el('div', { class: 'base-block' }, el('div', { class: 'base-block-label' }, 'Stats (with upgrades)'), modChips(eff)) : null)),
    el('div', { class: 'base-row-actions left' }, button('Unequip', { small: true, onClick: () => api.send('unequip', { slot }, 'equip') })));
}

function upgradesPane(api, owned) {
  const withUpgrades = owned.filter((o) => (o.item.upgrades || []).length);
  if (!withUpgrades.length) {
    return el('div', { class: 'base-block' }, sectionTitle('Upgrades'), emptyState('Nothing to upgrade here.', 'Upgrades appear for gear that can be improved.'));
  }
  return el('div', { class: 'base-block' }, sectionTitle('Upgrades'),
    withUpgrades.map((o) => el('div', { class: 'base-upgrade-group' },
      el('div', { class: 'base-upgrade-for' }, `For ${o.item.name}`, el('span', { class: 'base-row-where' }, WHERE[o.where])),
      o.item.upgrades.map((u) => upgradeCard(api, o.item, u)))));
}

export function renderEquipment(api) {
  const slot = L.EQUIP_SLOTS.includes(api.view.slot) ? api.view.slot : 'optics';
  api.view.slot = slot;
  const owned = L.ownedInSlot(api.profile, api.state.items, slot);
  const others = owned.filter((o) => o.where !== 'equipped');
  return el('div', { class: 'base-station base-equipment' },
    slotTiles(api),
    el('div', { class: 'base-station-scroll' },
      el('div', { class: 'base-two' },
        el('div', { class: 'base-col' },
          currentGear(api, slot, owned),
          el('div', { class: 'base-block' }, sectionTitle('Swap in', others.length ? String(others.length) : ''),
            others.length ? others.map((o) => candidateRow(api, o)) : emptyState('No other ' + L.SLOT_INFO[slot].label.toLowerCase() + ' gear.', 'Buy something from Finn or find it out in the world.'))),
        el('div', { class: 'base-col' }, upgradesPane(api, owned)))));
}

