// Equipment tab: the six slots, the gear in the selected slot with its stats and upgrades,
// and a side-by-side comparison with every owned alternative.
import { el, icon, button, itemCard, rarityBadge, formatMod, STAT_INFO, statIsGood, label } from '../kit.js';
import * as L from './logic.js';
import { section, note, sfx, modRows } from './common.js';

const SLOT_ICON = { optics: 'binoculars', camera: 'camera', audio: 'microphone', backpack: 'backpack', navigation: 'compass', clothing: 'clothing' };

export function renderEquipment(ctx, st) {
  const { state, net } = ctx;
  const p = state.profile;
  if (!p) return el('div', { class: 'menu-empty' }, 'Your gear is not ready yet.');
  if (!L.SLOTS.includes(st.slot)) st.slot = L.SLOTS[0];
  const slot = st.slot;
  const cur = state.items[p.equipped?.[slot]];
  const curMods = L.effectiveMods(cur, p);
  const isGood = (k, d) => statIsGood(k, d);

  const slotList = el('div', { class: 'menu-slots' }, L.SLOTS.map((s) => {
    const def = state.items[p.equipped?.[s]];
    const alts = L.alternativesForSlot(p, state.items, s).length;
    return el('button', { class: 'menu-slot' + (s === slot ? ' selected' : ''), type: 'button',
      onclick: () => { st.slot = s; sfx(ctx, 'click'); st.rerender(); } },
    el('span', { class: 'menu-slot-icon' }, icon(SLOT_ICON[s] || 'backpack', 22)),
    el('span', { class: 'menu-slot-text' },
      el('span', { class: 'menu-slot-name' }, L.SLOT_NAMES[s]),
      el('span', { class: 'menu-slot-item' }, def ? def.name : 'Empty')),
    alts ? el('span', { class: 'menu-badge', title: `${alts} other option${alts === 1 ? '' : 's'} owned` }, alts) : null);
  }));

  // Current gear -------------------------------------------------------------
  const current = el('div', { class: 'menu-card menu-gear' },
    cur ? [
      el('div', { class: 'menu-gear-head' },
        itemCard(cur, { compact: true, equipped: true }),
        el('div', { class: 'menu-gear-titles' },
          el('h2', { class: 'menu-detail-title' }, cur.name), rarityBadge(cur.rarity),
          el('p', { class: 'menu-desc' }, cur.desc))),
      Object.values(curMods).some((v) => v) ? el('div', { class: 'menu-mods' }, modRows(curMods)) : note('Plain and reliable: no special effects.'),
      cur.pros?.length || cur.cons?.length ? el('div', { class: 'menu-twocol' },
        el('ul', { class: 'menu-prosons pros' }, (cur.pros || []).map((t) => el('li', t))),
        el('ul', { class: 'menu-prosons cons' }, (cur.cons || []).map((t) => el('li', t)))) : null,
      el('div', { class: 'menu-detail-actions' },
        button('Unequip', { icon: 'down', onClick: () => { sfx(ctx, 'equip'); net.send('unequip', { slot }); } })),
      upgradesBlock(cur, p, state),
    ] : [note(`Nothing equipped in the ${L.SLOT_NAMES[slot].toLowerCase()} slot.`)]);

  // Alternatives with comparison -------------------------------------------------
  const alts = L.alternativesForSlot(p, state.items, slot);
  const altList = el('div', { class: 'menu-alts' },
    alts.length ? alts.map(({ def, where }) => {
      const rows = L.compareMods(curMods, L.effectiveMods(def, p), isGood);
      return el('div', { class: 'menu-alt' },
        el('div', { class: 'menu-alt-head' }, itemCard(def, { compact: true }),
          el('div', { class: 'menu-alt-titles' }, el('strong', def.name), el('span', { class: 'menu-faint' }, where === 'storage' ? 'In cabin storage' : 'In your pack')),
          button('Equip', { variant: 'primary', small: true, disabled: where === 'storage', title: where === 'storage' ? 'Collect it from storage at the cabin first.' : '',
            onClick: () => { sfx(ctx, 'equip'); net.send('equip', { item: def.id }); } })),
        el('div', { class: 'menu-compare' }, rows.length
          ? rows.map((r) => el('div', { class: `menu-cmp ${r.good ? 'good' : 'bad'}` },
            el('span', { class: 'menu-cmp-k' }, STAT_INFO[r.key]?.label || label(r.key)),
            el('span', { class: 'menu-cmp-d' }, STAT_INFO[r.key] ? formatMod(r.key, r.delta) : (r.delta > 0 ? '+' : '−') + Math.abs(r.delta))))
          : el('span', { class: 'menu-faint' }, 'Performs the same as what you wear now.')),
        def.cons?.length ? el('div', { class: 'menu-faint menu-alt-cons' }, 'Trade-offs: ' + def.cons.join('; ')) : null);
    }) : note('You do not own anything else for this slot yet. Finn and the wilds may have something.'));

  return el('div', { class: 'menu-equipment' },
    el('div', { class: 'menu-equip-slots', 'data-scroll': 'equip-slots' }, slotList),
    el('div', { class: 'menu-equip-main', 'data-scroll': 'equip-main' },
      section(L.SLOT_NAMES[slot], current),
      section('Other options', altList)));
}

function upgradesBlock(cur, p, state) {
  const { owned, available } = L.upgradeLists(cur, p);
  if (!owned.length && !available.length) return null;
  const row = (u, isOwned) => el('li', { class: isOwned ? 'owned' : 'available' },
    icon(isOwned ? 'check' : 'upgrade', 14),
    el('div', el('strong', u.name), el('span', { class: 'menu-faint' }, ' ' + u.desc),
      !isOwned ? el('div', { class: 'menu-faint' }, [`${u.price} Field Credits`, u.reqRank > 1 ? `rank of ${state.ranks.find((r) => r.index === u.reqRank)?.title || u.reqRank}` : '',
        u.reqCabin ? `needs the ${label(u.reqCabin)}` : ''].filter(Boolean).join(' · ')) : null,
      el('div', { class: 'menu-mods inline' }, modRows(u.mods))));
  return section('Upgrades', el('ul', { class: 'menu-upgrades' }, owned.map((u) => row(u, true)), available.map((u) => row(u, false))),
    available.length ? note("Upgrades are bought at Finn's stall or at the cabin workshop.") : null);
}
