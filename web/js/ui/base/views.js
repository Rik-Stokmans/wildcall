// Small DOM builders shared by the base stations and the shop. Pure presentation: every
// decision (can the player buy this? what changed?) comes from logic.js.
import { el, icon, button, rarityBadge, formatMod, statIsGood, STAT_INFO, stars } from '../kit.js';
import * as L from './logic.js';

export const TIER_NAMES = ['', 'Basic', 'Explorer', 'Specialist', 'Unique'];

export function statName(key) {
  return STAT_INFO[key]?.label || L.statWords(key);
}

/** One stat modifier as a coloured chip ("Magnification +2×"). */
export function modChip(key, value) {
  const good = statIsGood(key, value);
  return el('span', { class: 'base-mod ' + (good ? 'good' : 'bad'), title: key },
    el('span', { class: 'base-mod-name' }, statName(key)),
    el('span', { class: 'base-mod-val' }, formatMod(key, value)));
}

export function modChips(mods) {
  const entries = Object.entries(mods || {}).filter(([, v]) => Math.abs(v) > 1e-6);
  if (!entries.length) return null;
  return el('div', { class: 'base-mods' }, entries.map(([k, v]) => modChip(k, v)));
}

/** Pros and cons side by side: the tradeoffs are the point. */
export function prosCons(item) {
  const pros = item?.pros || [], cons = item?.cons || [];
  if (!pros.length && !cons.length) return null;
  return el('div', { class: 'base-proscons' },
    el('div', { class: 'base-pros' },
      el('div', { class: 'base-pc-title' }, icon('plus', 14), 'Strengths'),
      pros.length ? el('ul', pros.map((p) => el('li', p))) : el('div', { class: 'base-muted' }, 'None to speak of')),
    el('div', { class: 'base-cons' },
      el('div', { class: 'base-pc-title' }, icon('minus', 14), 'Tradeoffs'),
      cons.length ? el('ul', cons.map((c) => el('li', c))) : el('div', { class: 'base-muted' }, 'No real downsides')));
}

/** Rows "Stability  35% → 25%  −10%" coloured by whether the change helps. */
export function deltaRows(deltas, fmt) {
  if (!deltas.length) return el('div', { class: 'base-muted' }, 'No difference in stats.');
  return el('div', { class: 'base-deltas' }, deltas.map((d) => {
    const good = statIsGood(d.key, d.delta);
    return el('div', { class: 'base-delta ' + (good ? 'good' : 'bad') },
      el('span', { class: 'base-delta-name' }, statName(d.key)),
      el('span', { class: 'base-delta-vals' }, fmt ? fmt(d) : ''),
      el('span', { class: 'base-delta-val' }, (good ? '▲ ' : '▼ ') + formatMod(d.key, d.delta)));
  }));
}

/** A requirement line with a clear met / unmet state. */
export function reqRow(req) {
  return el('div', { class: 'base-req ' + (req.met ? 'met' : 'unmet') },
    icon(req.met ? 'check' : 'lock', 14), el('span', req.text));
}

export function issueRow(text) {
  return el('div', { class: 'base-req unmet' }, icon('lock', 14), el('span', text));
}

export function creditsChip(n, extra = '') {
  return el('span', { class: 'base-credits ' + extra, title: 'Field Credits' }, icon('credits', 16), L.formatCredits(n));
}

export function priceTag(n, affordable = true) {
  return el('span', { class: 'base-price' + (affordable ? '' : ' short') }, icon('credits', 14), L.formatCredits(n));
}

export function emptyState(text, hint) {
  return el('div', { class: 'base-empty' }, el('div', { class: 'base-empty-text' }, text), hint ? el('div', { class: 'base-empty-hint' }, hint) : null);
}

export function sectionTitle(text, aside) {
  return el('div', { class: 'base-section-title' }, el('h3', text), aside ? el('span', { class: 'base-section-aside' }, aside) : null);
}

export function itemTitle(item) {
  const bits = [];
  if (item.kind === 'equipment') bits.push(L.SLOT_INFO[item.slot]?.label || item.slot);
  else bits.push(item.kind ? item.kind.charAt(0).toUpperCase() + item.kind.slice(1) : 'Item');
  if (item.tier) bits.push(`Tier ${item.tier} · ${TIER_NAMES[item.tier] || ''}`.trim());
  return el('div', { class: 'base-item-title' },
    el('div', { class: 'base-item-name' }, item.name),
    el('div', { class: 'base-item-meta' }, rarityBadge(item.rarity), el('span', bits.join(' · '))));
}

/** The full description block for an item: text, tradeoffs, stats. */
export function itemDetail(item, opts = {}) {
  return el('div', { class: 'base-detail' },
    itemTitle(item),
    el('p', { class: 'base-desc' }, item.desc || ''),
    prosCons(item),
    Object.keys(item.mods || {}).length ? el('div', { class: 'base-block' }, el('div', { class: 'base-block-label' }, 'Stat changes'), modChips(item.mods)) : null,
    opts.extra || null);
}

export function starsLine(n) { return stars(n, 5); }

export const WEATHER_WORDS = ['sunny', 'cloudy', 'rainy', 'windy'];

/**
 * One purchasable item upgrade (equipment station and shop). `api` needs
 * { profile, stats, state, send }.
 */
export function upgradeCard(api, item, upg) {
  const st = L.upgradeStatus(item, upg, api.profile, api.stats, api.state.ranks);
  return el('div', { class: 'base-upgrade' + (st.bought ? ' owned' : '') },
    el('div', { class: 'base-upgrade-main' },
      el('div', { class: 'base-card-title' }, upg.name, st.bought ? el('span', { class: 'base-chip done' }, icon('check', 12), 'Fitted') : null),
      el('p', { class: 'base-desc' }, upg.desc),
      modChips(upg.mods),
      st.bought ? null : el('div', { class: 'base-reqs' }, st.issues.filter((i) => i.code !== 'item').map((i) => issueRow(i.text)))),
    el('div', { class: 'base-upgrade-buy' },
      st.bought ? null : priceTag(upg.price, (api.profile.credits || 0) >= upg.price),
      st.bought ? null : button('Upgrade', { variant: 'primary', small: true, icon: 'upgrade', disabled: !st.canBuy,
        onClick: () => api.send('upgrade', { item: item.id, upgrade: upg.id }, 'coin') })));
}
