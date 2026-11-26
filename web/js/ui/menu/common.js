// Small DOM helpers shared by the menu screens. DOM only; no game logic.
import { el, icon, STAT_INFO, formatMod, statIsGood } from '../kit.js';

/** Play a UI sound if the audio module is up. Never throws. */
export function sfx(ctx, name) {
  try { ctx.audio?.uiSound?.(name); } catch { /* audio is optional */ }
}

/** Titled block used in the detail panes: <section><h3>title</h3>...children</section>. */
export function section(title, ...children) {
  return el('section', { class: 'menu-section' }, title ? el('h3', { class: 'menu-h3' }, title) : null, ...children);
}

/** A soft, italic hint line. */
export function note(text, cls = '') {
  return el('p', { class: 'menu-note ' + cls }, text);
}

/** Rank pips: ●●○ for a skill with several ranks. */
export function pips(rank, max) {
  const wrap = el('span', { class: 'menu-pips', title: `Rank ${rank} of ${max}` });
  for (let i = 0; i < max; i++) wrap.appendChild(el('i', { class: i < rank ? 'on' : '' }));
  return wrap;
}

/** Small labelled value, e.g. "Field Credits  120". */
export function stat(labelText, value, cls = '') {
  return el('div', { class: 'menu-stat ' + cls }, el('span', { class: 'menu-stat-label' }, labelText), el('span', { class: 'menu-stat-value' }, value));
}

/** Icon + text pill. */
export function pill(iconName, text, cls = '') {
  return el('span', { class: 'menu-pill ' + cls }, iconName ? icon(iconName, 14) : null, text);
}

/**
 * Run `render` (which replaces the contents of `host`) while keeping the scroll position of
 * every descendant marked data-scroll="<key>", so a profile refresh does not jump the view.
 */
export function keepScroll(host, render) {
  const saved = new Map();
  host.querySelectorAll('[data-scroll]').forEach((n) => saved.set(n.dataset.scroll, n.scrollTop));
  render();
  host.querySelectorAll('[data-scroll]').forEach((n) => {
    const top = saved.get(n.dataset.scroll);
    if (top) n.scrollTop = top;
  });
}

/** Mods rendered as coloured rows: formatMod + label, green when good, rust when not. */
export function modRows(mods) {
  const rows = Object.entries(mods || {}).filter(([k, v]) => v !== 0 && STAT_INFO[k]);
  return rows.map(([k, v]) => el('div', { class: `menu-mod ${statIsGood(k, v) ? 'good' : 'bad'}` },
    el('span', { class: 'menu-mod-v' }, formatMod(k, v)), el('span', { class: 'menu-mod-k' }, STAT_INFO[k].label)));
}
