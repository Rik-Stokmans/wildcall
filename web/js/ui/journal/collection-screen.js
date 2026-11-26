// Collectibles: sets (feathers, the Forgotten Field Journal, relics, badges) with found
// items in full and missing ones as empty outlined slots, plus progress per set and overall.

import { el, fill, icon, progressBar, rarityColor, RARITY_NAMES } from '../kit.js';
import { collectionSets, percent, setIcon } from './collection-logic.js';
import { plural, formatDay } from './format.js';
import { screenRoot, sheet, emptyNote, keepScroll, uiSound } from './widgets.js';

export function createCollectionScreen(ctx) {
  const root = screenRoot(ctx, 'collection');
  const frame = sheet(ctx, 'collection', { title: 'Collection', subtitle: '', ico: 'feather', className: 'jr-collection' });
  root.appendChild(frame.panel);
  const st = { set: null, item: null };
  let isOpen = false;

  function render() {
    if (!isOpen || !ctx.state.profile) return;
    const restore = keepScroll(frame.panel);
    const j = ctx.state.profile.journal || {};
    const data = collectionSets(Object.values(ctx.state.collectibles), j.collectibles, j.badges);
    if (!data.sets.some((s) => s.name === st.set)) st.set = data.sets[0]?.name || null;
    const set = data.sets.find((s) => s.name === st.set);
    if (!set || !set.items.some((i) => i.def.id === st.item)) st.item = null;
    const item = set?.items.find((i) => i.def.id === st.item);
    frame.setSubtitle(data.total ? `${data.found} of ${data.total} found` : '');

    fill(frame.headRight, el('div', { class: 'jr-overall' },
      el('span', `${percent(data.found, data.total)}%`), progressBar(data.found, data.total, { height: 8 })));

    fill(frame.body,
      el('div', { class: 'jr-sets', 'data-scroll': 'sets' }, data.sets.length ? data.sets.map((s) => el('button', {
        type: 'button', class: 'jr-set' + (s.name === st.set ? ' selected' : '') + (s.found === s.total ? ' complete' : ''),
        onclick: () => { st.set = s.name; st.item = null; uiSound(ctx, 'click'); render(); },
      }, el('span', { class: 'jr-set-icon' }, icon(setIcon(s.kind), 20)),
      el('span', { class: 'jr-set-main' }, el('b', s.name), el('small', `${s.found} of ${s.total}`), progressBar(s.found, s.total, { height: 5 })),
      s.found === s.total && s.total > 0 ? el('span', { class: 'jr-set-done', title: 'Complete' }, icon('check', 14)) : null))
        : emptyNote('Nothing to collect yet.', 'feather')),
      el('div', { class: 'jr-slots-wrap', 'data-scroll': 'slots' }, set ? [
        el('div', { class: 'jr-page-head' }, el('h2', set.name), el('div', { class: 'jr-page-sub' }, `${plural(set.found, 'item')} found of ${set.total}`)),
        el('div', { class: 'jr-slots' }, set.items.map((it) => slot(it))),
      ] : null),
      el('div', { class: 'jr-slot-detail', 'data-scroll': 'slotdetail' }, item ? itemDetail(item) : el('div', { class: 'jr-cover small' }, icon('journal', 30), el('p', 'Select a keepsake to read about it.'))));
    restore();
  }

  function slot(it) {
    const sel = it.def.id === st.item;
    if (!it.found) {
      // Missing: an empty outlined slot with no name, so nothing about it is given away.
      return el('div', { class: 'jr-slot missing' + (sel ? ' selected' : ''), title: 'Not found yet' }, el('span', { class: 'jr-slot-q' }, '?'));
    }
    return el('button', {
      type: 'button', class: 'jr-slot found' + (sel ? ' selected' : ''), style: { '--rarity': rarityColor(it.def.rarity) }, title: it.def.name,
      onclick: () => { st.item = it.def.id; uiSound(ctx, 'page'); render(); },
    }, icon(it.def.icon || setIcon(it.def.kind), 26), el('span', { class: 'jr-slot-name' }, it.def.name));
  }

  function itemDetail(it) {
    const d = it.def;
    return el('div', { class: 'jr-slotd', style: { '--rarity': rarityColor(d.rarity) } },
      el('div', { class: 'jr-slotd-icon' }, icon(d.icon || setIcon(d.kind), 44)),
      el('h3', d.name),
      el('div', { class: 'jr-slotd-rar', style: { color: rarityColor(d.rarity) } }, RARITY_NAMES[d.rarity] || 'Common'),
      el('p', { class: 'jr-desc' }, d.desc),
      d.text ? el('p', { class: d.kind === 'page' ? 'jr-hand' : 'jr-lore-text' }, d.text) : null,
      it.day ? el('div', { class: 'jr-muted' }, `Found ${formatDay(it.day)}`) : null);
  }

  ctx.bus.on('profile', () => { if (isOpen) render(); });

  return {
    root,
    closable: true,
    open(data = {}) {
      isOpen = true;
      if (data.set) st.set = data.set;
      uiSound(ctx, 'open');
      render();
    },
    close() { isOpen = false; uiSound(ctx, 'close'); },
  };
}
