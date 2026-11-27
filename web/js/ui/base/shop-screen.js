// Finn's Field Supply: gear, supplies and upgrades for owned equipment. The tradeoffs
// (strengths vs. downsides) and the comparison with what is currently equipped are the
// centre of each item page. Re-renders fully from ctx.state on open and on every 'profile'.
import { el, fill, icon, button, panel, tabs, itemCard, formatMod } from '../kit.js';
import * as L from './logic.js';
import { creditsChip, priceTag, itemTitle, prosCons, modChips, deltaRows, reqRow, issueRow, emptyState, sectionTitle, upgradeCard } from './views.js';
import { footprintMini } from '../menu/packgrid.js';
import { footprint } from '../menu/packlogic.js';

/** "Takes 2×3 cells" with a little diagram, so players can plan where it goes. */
function footprintTag(item, long = false) {
  const { w, h } = footprint(item);
  return el('span', { class: 'base-fp' + (long ? ' long' : ''), title: `Takes ${w}×${h} cell${w * h === 1 ? '' : 's'} of your pack` },
    footprintMini(item), long ? `Takes ${w}×${h} cell${w * h === 1 ? '' : 's'} of your pack` : `${w}×${h}`);
}

const TABS = [
  { id: 'gear', label: 'Gear', icon: 'binoculars' },
  { id: 'supplies', label: 'Supplies', icon: 'film' },
  { id: 'upgrades', label: 'Upgrades', icon: 'upgrade' },
];

export function createShopScreen(ctx) {
  const { state, bus } = ctx;
  const view = { tab: 'gear', sel: { gear: null, supplies: null, upgrades: null } };
  let isOpen = false;

  const snd = (name) => { try { ctx.audio?.uiSound?.(name); } catch { /* audio is optional */ } };
  const api = {
    ctx, state, view,
    get profile() { return state.profile; },
    get stats() { return state.stats; },
    send(type, data, sound = 'click') { ctx.net.send(type, data); snd(sound); },
  };

  const frame = panel({ title: "Finn's Field Supply", subtitle: 'Outfitters', icon: 'shop', wide: true, onClose: () => ctx.ui.close('shop') });
  const chips = el('div', { class: 'base-head-chips' });
  frame.header.insertBefore(chips, frame.header.querySelector('.kit-panel-close') || null);
  const bar = tabs(TABS, view.tab, (id) => { snd('click'); view.tab = id; render(); });
  bar.classList.add('base-tabbar', 'base-shop-tabs');
  const list = el('div', { class: 'base-shop-list' });
  const detail = el('div', { class: 'base-shop-detail' });
  frame.body.append(el('div', { class: 'base-shop-layout' }, el('div', { class: 'base-shop-left' }, bar, list), detail));
  const finnLine = el('div', { class: 'base-finn' });
  frame.footer.append(finnLine, button('Done', { variant: 'primary', onClick: () => { snd('close'); ctx.ui.close('shop'); } }));
  const root = el('div', { class: 'base-screen base-shop' }, el('div', { class: 'base-frame' }, frame.root));

  const stockFor = (tab) => L.shopStock(state.shop, state.items).filter((it) => L.shopTabOf(it) === tab);

  // --- list ------------------------------------------------------------------
  function shopCard(item, selected) {
    const chk = L.purchaseCheck(item, state.profile, state.stats, state.ranks, state.items);
    const locked = chk.requirements.some((r) => !r.met);
    const noRoom = chk.noRoom && !chk.owned && !locked;
    const card = el('div', { class: 'base-shop-card' + (selected ? ' selected' : '') + (chk.owned ? ' owned' : '') + (locked ? ' locked' : '') + (!chk.canBuy && !chk.owned && !locked ? ' short' : '') + (noRoom ? ' noroom' : ''),
      onclick: () => { snd('click'); view.sel[view.tab] = item.id; render(); } },
      itemCard(item, { price: chk.price, selected, owned: chk.owned }),
      footprintTag(item),
      chk.owned ? el('span', { class: 'base-ribbon' }, icon('check', 12), 'Owned') : null,
      locked ? el('span', { class: 'base-ribbon lock' }, icon('lock', 12), 'Locked') : null,
      noRoom ? el('span', { class: 'base-ribbon room', title: L.NO_ROOM_TEXT }, icon('backpack', 12), 'No room') : null);
    return card;
  }

  function renderList(stock, selId) {
    fill(list, stock.length ? el('div', { class: 'base-shop-grid' }, stock.map((it) => shopCard(it, it.id === selId)))
      : emptyState('Nothing on this shelf.', 'Finn is restocking.'));
  }

  function renderUpgradeList(owned, selId) {
    fill(list, owned.length ? el('div', { class: 'base-shop-grid' }, owned.map(({ item, where }) =>
      el('div', { class: 'base-shop-card' + (item.id === selId ? ' selected' : ''),
        onclick: () => { snd('click'); view.sel.upgrades = item.id; render(); } },
        itemCard(item, { selected: item.id === selId, equipped: where === 'equipped' }))))
      : emptyState('No gear to improve yet.', 'Upgrades appear here for equipment you own that can be improved.'));
  }

  // --- detail ------------------------------------------------------------------
  function comparison(item) {
    const cmp = L.compareToEquipped(item, state.profile, state.items);
    if (item.kind !== 'equipment') return null;
    if (cmp.same) return el('div', { class: 'base-block' }, sectionTitle('Compared with your gear'), el('div', { class: 'base-muted' }, 'This is what you have equipped right now.'));
    const heading = cmp.current ? `Compared with your ${cmp.current.name}` : `Your ${L.SLOT_INFO[item.slot]?.label.toLowerCase() || 'slot'} slot is empty`;
    return el('div', { class: 'base-block' }, sectionTitle(heading),
      deltaRows(cmp.deltas, (d) => `${formatMod(d.key, d.cur)} → ${formatMod(d.key, d.next)}`));
  }

  function renderItemDetail(item) {
    const chk = L.purchaseCheck(item, state.profile, state.stats, state.ranks, state.items);
    const carried = item.kind === 'supply' ? L.countOwned(state.profile, item.id) : 0;
    const discounted = chk.price !== item.price;
    const buy = el('div', { class: 'base-buy' },
      el('div', { class: 'base-buy-price' }, priceTag(chk.price, (state.profile.credits || 0) >= chk.price),
        discounted ? el('s', { class: 'base-muted' }, L.formatCredits(item.price)) : null,
        discounted ? el('span', { class: 'base-chip done' }, `${Math.round(Math.min(0.5, state.stats.discount || 0) * 100)}% off`) : null),
      chk.owned && item.kind === 'equipment' && state.profile.equipped?.[item.slot] !== item.id
        // Bought but not in use yet: let the player put it on right here.
        ? button('Equip', { variant: 'primary', icon: 'check', onClick: () => api.send('equip', { item: item.id }, 'equip') })
        : button(chk.owned ? (state.profile.equipped?.[item.slot] === item.id ? 'Equipped' : 'Owned') : 'Buy', { variant: 'primary', icon: 'credits', disabled: !chk.canBuy,
          onClick: () => api.send('buy', { item: item.id }, 'coin') }),
      chk.issues.length && !chk.owned ? el('div', { class: 'base-reqs' }, chk.issues.map((i) => issueRow(i.text))) : null,
      chk.noRoom && !chk.owned ? el('div', { class: 'base-room-hint' }, chk.tidyFits
        ? [el('span', 'Tidied, your pack would have room for it.'),
          button('Tidy my pack', { small: true, icon: 'sort', onClick: () => api.send('tidy', { where: 'inventory' }, 'page') })]
        : el('span', 'Leave something in your cabin storage, or take something out of your pack, to make room.')) : null);
    fill(detail, el('div', { class: 'base-shop-scroll' },
      itemTitle(item),
      footprintTag(item, true),
      el('p', { class: 'base-desc' }, item.desc),
      prosCons(item),
      chk.requirements.length ? el('div', { class: 'base-block' }, sectionTitle('Requirements'), el('div', { class: 'base-reqs' }, chk.requirements.map(reqRow))) : null,
      Object.keys(item.mods || {}).length ? el('div', { class: 'base-block' }, sectionTitle('Stat changes'), modChips(item.mods)) : null,
      comparison(item),
      carried ? el('div', { class: 'base-muted' }, `You are carrying ${carried}.`) : null),
      buy);
  }

  function renderUpgradeDetail(owned, selId) {
    const entry = owned.find((o) => o.item.id === selId);
    if (!entry) { fill(detail, emptyState('Choose a piece of gear to see its upgrades.')); return; }
    const { item, where } = entry;
    fill(detail, el('div', { class: 'base-shop-scroll' },
      itemTitle(item),
      el('div', { class: 'base-muted' }, where === 'equipped' ? 'Currently equipped' : where === 'backpack' ? 'In your backpack' : 'In cabin storage'),
      sectionTitle('Upgrades'),
      item.upgrades.map((u) => upgradeCard(api, item, u)),
      el('div', { class: 'base-muted' }, 'Some upgrades need a workshop in your cabin or a higher rank.')));
  }

  // --- render ------------------------------------------------------------------
  function render() {
    if (!state.profile) return;
    fill(chips, creditsChip(state.profile.credits || 0, 'big'));
    bar.setActive(view.tab);
    const finn = Object.values(state.npcs).find((n) => n.id === 'finn');
    frame.setTitle("Finn's Field Supply", finn ? `${finn.name}, ${finn.role}` : 'Outfitters');
    let item = null;
    if (view.tab === 'upgrades') {
      const owned = L.upgradableItems(state.profile, state.items);
      if (!owned.some((o) => o.item.id === view.sel.upgrades)) view.sel.upgrades = owned[0]?.item.id || null;
      renderUpgradeList(owned, view.sel.upgrades);
      renderUpgradeDetail(owned, view.sel.upgrades);
      item = owned.find((o) => o.item.id === view.sel.upgrades)?.item || null;
    } else {
      const stock = stockFor(view.tab);
      if (!stock.some((s) => s.id === view.sel[view.tab])) view.sel[view.tab] = stock[0]?.id || null;
      item = stock.find((s) => s.id === view.sel[view.tab]) || null;
      renderList(stock, view.sel[view.tab]);
      if (item) renderItemDetail(item); else fill(detail, emptyState('Nothing to show.'));
    }
    fill(finnLine, icon('shop', 16), el('span', { class: 'base-hand' }, `${finn?.name || 'Finn'}: "${L.finnLine(view.tab === 'upgrades' ? null : item, view.tab)}"`));
  }

  bus.on('profile', () => { if (isOpen) render(); });
  ctx.ui.register('shop', {
    root,
    open(data = {}) {
      isOpen = true;
      if (data.tab && TABS.some((t) => t.id === data.tab)) view.tab = data.tab;
      snd('open');
      render();
    },
    close() { isOpen = false; },
    overlay: false,
    closable: true,
  });
  return { render };
}
