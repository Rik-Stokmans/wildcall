// WILDCALL shared UI kit.
//
// The exported names, parameters and return types of this file are pinned by
// docs/contract.md §5.7: every UI module imports them. Pure logic lives in ./kit/*.js
// (icons, formatting, bird geometry) so it can be unit-tested in node; this file holds
// the DOM-facing parts. Styles: css/kit.css (class prefix "kit-").
//
// Import with:  import { el, icon, button, ... } from '../kit.js';
import { iconInner, resolveIcon } from './kit/icons.js';
import { drawBirdArt } from './kit/bird-art.js';
import {
  STAT_INFO, formatStat, formatMod, statIsGood, statLabel, formatClock, label, clampRarity,
  RARITY_NAMES, rarityName, rarityColor, SEASON_NAMES, WEATHER_NAMES, WEATHER_ICONS, DISCOVERY_LEVELS,
  WILD_RARITY_NAMES, tierNumeral, formatCount,
} from './kit/format.js';

// Pure helpers re-exported so a UI module needs only this one import.
export {
  STAT_INFO, formatStat, formatMod, statIsGood, statLabel, formatClock, label,
  RARITY_NAMES, rarityName, rarityColor, SEASON_NAMES, WEATHER_NAMES, WEATHER_ICONS, DISCOVERY_LEVELS,
  WILD_RARITY_NAMES, tierNumeral, formatCount,
};
export { STAT_GROUPS, statsInGroup, formatCount as formatNumber, formatDuration } from './kit/format.js';
export { ICON_NAMES } from './kit/icons.js';

/* ----------------------------------------------------------------------------
 * DOM helper
 * el('div', { class: 'x', onclick: fn, dataset: {id: 1}, style: {…}, hidden: true }, child, 'text', [more])
 * - attrs may be omitted; children may be nodes, strings, numbers, arrays, null/false (skipped).
 * - keys starting with "on" are added as event listeners; `class` sets className;
 *   `html` sets innerHTML; boolean attributes are toggled.
 * Returns the created HTMLElement. */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs && (attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null || sv === false) continue;
        if (sk.startsWith('--')) node.style.setProperty(sk, sv); else node.style[sk] = sv;
      }
    } else if (k === 'style') node.setAttribute('style', v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'value') node.value = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  appendAll(node, children);
  return node;
}

function appendAll(node, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendAll(node, c);
    else node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Remove all children of a node and append the given ones. Returns the node. */
export function fill(node, ...children) {
  node.replaceChildren();
  appendAll(node, children);
  return node;
}

/* ----------------------------------------------------------------------------
 * Icons. icon(name, size = 20) → inline <svg> element using currentColor.
 * Pinned icon vocabulary (unknown names must render a neutral dot, never throw):
 *  tools:      binoculars camera recorder microphone headphones backpack compass map clothing lens journal film seed
 *  disciplines: acoustics observation photography knowledge fieldcraft
 *  progression: xp level rank skillpoint credits reputation star lock check quest badge
 *  nature:     bird feather leaf tree footprint nest egg pond mountain wave snow
 *  weather:    sunny cloudy rain wind mist moon dawn
 *  ui:         close back forward up down plus minus search filter sort pin play pause stop
 *              eye ear note info warning home shop upgrade storage desk wall settings
 *  poi:        cabin tower station camp viewpoint hide landmark npc page relic cache gate
 * Extras (also available): clock calendar trophy pencil speaker trash heart flag, plus a few
 * aliases (sun, cloud, gear, coin, tent, mic…) — see kit/icons.js. */
export function icon(name, size = 20) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  const s = Number.isFinite(+size) && +size > 0 ? +size : 20;
  const known = resolveIcon(name);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', s);
  svg.setAttribute('height', s);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', 'kit-icon kit-icon-' + (known || 'dot'));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = iconInner(name);
  return svg;
}

/* ----------------------------------------------------------------------------
 * Bird illustration: a stylised 2D side-view drawing generated from a species'
 * `look` (core.Appearance). Used by the journal, field guide, identification screen.
 * birdIllustration(species, opts) → HTMLCanvasElement (CSS size = opts.size px, crisp on HiDPI)
 *   opts.size        px, default 160
 *   opts.height      px, default = size
 *   opts.pose        'perched' (default) | 'flying'
 *   opts.silhouette  true → flat dark silhouette only (for undiscovered species)
 *   opts.reveal      optional Set/array of evidence keys the player knows
 *                    (size, shape, primary, secondary, marking, bill): unknown parts are
 *                    drawn as neutral pencil outline — the "what I have seen so far" sketch.
 *   opts.background  false (default, transparent) | true → soft paper vignette
 *   opts.relativeScale  optional metres across the frame: draws birds at true relative size
 *   opts.alt         accessible name (default: the species name, or a neutral phrase when
 *                    the drawing is a silhouette / sketch so nothing is given away)
 * The returned canvas has .redraw(patch?) to repaint with changed opts (e.g. a grown
 * `reveal` set when new evidence arrives) and .species / .opts for reference. */
export function birdIllustration(species, opts = {}) {
  const c = document.createElement('canvas');
  c.className = 'kit-bird';
  c.setAttribute('role', 'img');
  const state = { species, opts: { ...opts } };
  const render = () => {
    const o = state.opts;
    const w = Math.max(16, Math.round(o.size || 160));
    const h = Math.max(16, Math.round(o.height || w));
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    try {
      drawBirdArt(g, w, h, state.species, o);
    } catch (err) {
      console.error('[kit] birdIllustration failed', err);
    }
    const veiled = o.silhouette || o.reveal != null;
    c.setAttribute('aria-label', o.alt || (veiled ? (o.silhouette ? 'Unidentified bird silhouette' : 'Sketch of a bird') : (state.species?.name || 'Bird')));
  };
  c.redraw = (patch) => {
    if (patch && typeof patch === 'object') {
      if ('species' in patch) state.species = patch.species;
      const { species: _s, ...rest } = patch;
      Object.assign(state.opts, rest);
    }
    render();
    return c;
  };
  Object.defineProperties(c, { species: { get: () => state.species }, opts: { get: () => state.opts } });
  render();
  return c;
}

/* ----------------------------------------------------------------------------
 * Rarity helpers (item / wildlife rarity 0..4: Common, Uncommon, Rare, Epic, Legendary). */
/** Small pill element showing the rarity name in its colour. */
export function rarityBadge(r) {
  const n = clampRarity(r);
  return el('span', { class: 'kit-rarity kit-rarity-' + n, style: { '--rarity': rarityColor(n) } }, rarityName(n));
}

/* ----------------------------------------------------------------------------
 * Widgets. All return HTMLElements styled by css/kit.css (class prefix "kit-"). */

/**
 * button('Buy', { variant: 'primary'|'secondary'|'ghost'|'danger', icon: 'credits', onClick, disabled, title, small })
 * Pass a null/'' label with `icon` (or opts.iconOnly) for a round icon button; `title`
 * then doubles as its accessible name. Extra: opts.class, opts.type, opts.autofocus,
 * opts.pressed (toggle state). The element has .setDisabled(bool) and .setLabel(text).
 */
export function button(label, opts = {}) {
  const iconOnly = !!opts.iconOnly || ((label == null || label === '') && !!opts.icon);
  const b = el('button', {
    class: `kit-btn kit-btn-${opts.variant || 'secondary'}${opts.small ? ' kit-btn-small' : ''}${iconOnly ? ' kit-btn-icon' : ''}${opts.class ? ' ' + opts.class : ''}`,
    title: opts.title, disabled: !!opts.disabled, type: opts.type || 'button',
    'aria-label': iconOnly ? (opts.title || opts.icon) : null,
    'aria-pressed': opts.pressed == null ? null : String(!!opts.pressed),
  }, opts.icon ? icon(opts.icon, opts.small ? 14 : 18) : null, !iconOnly && label != null && label !== '' ? el('span', { class: 'kit-btn-label' }, label) : null);
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  if (opts.autofocus) queueMicrotask(() => b.focus?.());
  b.setDisabled = (v) => { b.disabled = !!v; return b; };
  b.setLabel = (t) => {
    const s = b.querySelector('.kit-btn-label');
    if (s) s.textContent = t;
    return b;
  };
  return b;
}

/**
 * tabs([{ id, label, icon?, badge? }], activeId, onSelect) → element with .setActive(id)
 * and .setBadge(id, textOrNull). Arrow keys / Home / End move between tabs.
 * Extra: .active (current id), .setActive(id, silent) never fires onSelect.
 */
export function tabs(items, activeId, onSelect) {
  const root = el('div', { class: 'kit-tabs', role: 'tablist' });
  const btns = new Map();
  let current = null;
  const select = (id, focus) => {
    root.setActive(id);
    if (focus) btns.get(id)?.focus();
    onSelect?.(id);
  };
  for (const it of items) {
    const b = el('button', { class: 'kit-tab', type: 'button', role: 'tab', dataset: { id: it.id }, tabindex: '-1' },
      it.icon ? icon(it.icon, 18) : null,
      el('span', { class: 'kit-tab-label' }, it.label),
      el('span', { class: 'kit-tab-badge', hidden: !it.badge }, it.badge || ''));
    b.addEventListener('click', () => select(it.id, false));
    btns.set(it.id, b);
    root.appendChild(b);
  }
  root.addEventListener('keydown', (e) => {
    const ids = [...btns.keys()];
    if (!ids.length) return;
    const i = Math.max(0, ids.indexOf(current));
    let n = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = ids[(i + 1) % ids.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') n = ids[0];
    else if (e.key === 'End') n = ids[ids.length - 1];
    if (n != null) { e.preventDefault(); select(n, true); }
  });
  root.setActive = (id) => {
    current = id;
    for (const [k, b] of btns) {
      const on = k === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (!btns.has(id)) { const first = btns.values().next().value; if (first) first.tabIndex = 0; }
    return root;
  };
  root.setBadge = (id, text) => {
    const badge = btns.get(id)?.querySelector('.kit-tab-badge');
    if (badge) { badge.hidden = !text; badge.textContent = text || ''; }
    return root;
  };
  Object.defineProperty(root, 'active', { get: () => current });
  root.setActive(activeId);
  return root;
}

/**
 * A framed screen panel (paper card with a title bar and close button).
 * panel({ title, subtitle?, icon?, wide?, onClose? }) → { root, header, body, footer, setTitle(t, sub?) }
 * Append `root` inside your screen root; put content in `body` (scrolls, `.kit-scroll`).
 * `footer` is hidden while empty. Extras: setSubtitle(t), setIcon(name), closeButton.
 */
export function panel(opts = {}) {
  const titleEl = el('div', { class: 'kit-panel-title' }, opts.title || '');
  const subEl = el('div', { class: 'kit-panel-sub', hidden: !opts.subtitle }, opts.subtitle || '');
  const iconHost = el('span', { class: 'kit-panel-icon', hidden: !opts.icon }, opts.icon ? icon(opts.icon, 26) : null);
  const closeButton = opts.onClose
    ? el('button', { class: 'kit-panel-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: opts.onClose }, icon('close', 18))
    : null;
  const header = el('div', { class: 'kit-panel-header' },
    iconHost, el('div', { class: 'kit-panel-titles' }, titleEl, subEl),
    el('div', { class: 'kit-panel-spacer' }), closeButton);
  const body = el('div', { class: 'kit-panel-body kit-scroll' });
  const footer = el('div', { class: 'kit-panel-footer' });
  const root = el('section', { class: 'kit-panel' + (opts.wide ? ' kit-panel-wide' : '') }, header, body, footer);
  const setSubtitle = (t) => { subEl.textContent = t || ''; subEl.hidden = !t; };
  return {
    root, header, body, footer, closeButton, setSubtitle,
    setTitle(t, sub) { titleEl.textContent = t; if (sub != null) setSubtitle(sub); },
    setIcon(name) { iconHost.replaceChildren(); iconHost.hidden = !name; if (name) iconHost.appendChild(icon(name, 26)); },
  };
}

/**
 * progressBar(value, max, { label?, color?, height?, showValue? }) → element with .set(value, max, label?)
 * `showValue` prints "value / max" inside the bar.
 */
export function progressBar(value, max, opts = {}) {
  const fillEl = el('div', { class: 'kit-progress-fill', style: { background: opts.color || null } });
  const labelEl = el('span', { class: 'kit-progress-label' }, opts.label || '');
  const root = el('div', {
    class: 'kit-progress', role: 'progressbar', 'aria-valuemin': '0',
    style: { height: opts.height ? opts.height + 'px' : null },
  }, fillEl, labelEl);
  root.set = (v, m, text) => {
    const frac = m > 0 ? Math.max(0, Math.min(1, v / m)) : 0;
    fillEl.style.width = frac * 100 + '%';
    root.classList.toggle('full', frac >= 1);
    root.classList.toggle('empty', frac <= 0);
    root.setAttribute('aria-valuemax', String(Math.max(0, m || 0)));
    root.setAttribute('aria-valuenow', String(Math.max(0, v || 0)));
    const t = text !== undefined ? text : (opts.showValue ? `${formatCount(v)} / ${formatCount(m)}` : (opts.label || ''));
    labelEl.textContent = t || '';
    labelEl.hidden = !t;
    return root;
  };
  root.set(value, max);
  return root;
}

/** stars(n, max = 5) → element showing n filled of max stars. */
export function stars(n, max = 5) {
  const total = Math.max(0, Math.round(max));
  const have = Math.max(0, Math.min(total, Math.round(n)));
  const root = el('span', { class: 'kit-stars', role: 'img', 'aria-label': `${have} of ${total} stars`, title: `${have} / ${total}` });
  for (let i = 0; i < total; i++) root.appendChild(el('span', { class: 'kit-star' + (i < have ? ' on' : '') }, icon('star', 16)));
  return root;
}

/**
 * itemCard(itemDef, { owned?, equipped?, qty?, price?, compact?, selected?, onClick? }) → element.
 * Shows icon, name, rarity colour, tier, quantity and state badges. Used in the
 * inventory grid, equipment slots, shop and rewards. A null itemDef renders an empty slot
 * (pass opts.slotIcon to show which slot). Extras: opts.locked (requirements unmet),
 * opts.tooltip (string | function | true for the default item tooltip), opts.disabled.
 * With onClick the card is keyboard-operable (Enter / Space). The root has data-id.
 */
export function itemCard(item, opts = {}) {
  const r = clampRarity(item?.rarity);
  const interactive = typeof opts.onClick === 'function' && !opts.disabled;
  const empty = !item;
  const card = el('div', {
    class: `kit-item kit-rarity-${r}${opts.selected ? ' selected' : ''}${opts.compact ? ' compact' : ''}${opts.equipped ? ' equipped' : ''}${empty ? ' empty' : ''}${opts.locked ? ' locked' : ''}${opts.disabled ? ' disabled' : ''}${interactive ? ' interactive' : ''}`,
    style: { '--rarity': rarityColor(r) },
    dataset: item?.id ? { id: item.id } : null,
    role: interactive ? 'button' : null,
    tabindex: interactive ? '0' : null,
    'aria-pressed': interactive && opts.selected != null ? String(!!opts.selected) : null,
    'aria-label': item ? `${item.name}, ${rarityName(r)}${opts.equipped ? ', equipped' : ''}` : 'Empty slot',
  });
  const tier = item?.tier | 0;
  if (tier > 0) {
    const pips = el('div', { class: 'kit-item-tier', title: `Tier ${tierNumeral(tier)}` });
    for (let i = 0; i < Math.min(4, tier); i++) pips.appendChild(el('i'));
    card.appendChild(pips);
  }
  card.appendChild(el('div', { class: 'kit-item-icon' }, icon(item?.icon || (empty ? opts.slotIcon : null) || 'backpack', opts.compact ? 24 : 34)));
  card.appendChild(el('div', { class: 'kit-item-name' }, item?.name || 'Empty'));
  if (opts.qty > 1) card.appendChild(el('div', { class: 'kit-item-qty' }, '×' + opts.qty));
  if (opts.equipped) card.appendChild(el('div', { class: 'kit-item-tag' }, 'Equipped'));
  else if (opts.owned) card.appendChild(el('div', { class: 'kit-item-tag owned' }, icon('check', 11), 'Owned'));
  if (opts.price != null) card.appendChild(el('div', { class: 'kit-item-price' }, icon('credits', 12), formatCount(opts.price)));
  if (opts.locked) card.appendChild(el('div', { class: 'kit-item-lock' }, icon('lock', 14)));
  if (interactive) {
    card.addEventListener('click', opts.onClick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(e); }
    });
  }
  if (item && opts.tooltip) tooltip(card, opts.tooltip === true ? () => itemTooltip(item, opts.tooltipOpts) : opts.tooltip);
  return card;
}

/**
 * A rich item description node (for tooltip() or an inspector pane):
 * name, rarity, tier, description, stat modifiers (green good / red bad), pros, cons, price.
 * opts.owned: hide the price. */
export function itemTooltip(item, opts = {}) {
  if (!item) return el('div', { class: 'kit-tip-body' }, 'Empty slot');
  const r = clampRarity(item.rarity);
  const mods = Object.entries(item.mods || {}).filter(([, v]) => v);
  const kind = [label(item.kind), item.slot ? label(item.slot) : null, item.tier ? 'Tier ' + tierNumeral(item.tier) : null].filter(Boolean).join(' · ');
  return el('div', { class: 'kit-tip-body kit-rarity-' + r, style: { '--rarity': rarityColor(r) } },
    el('div', { class: 'kit-tip-head' }, icon(item.icon || 'backpack', 28),
      el('div', { class: 'kit-tip-titles' }, el('div', { class: 'kit-tip-name' }, item.name), el('div', { class: 'kit-tip-kind' }, kind)),
      rarityBadge(r)),
    item.desc ? el('p', { class: 'kit-tip-desc' }, item.desc) : null,
    mods.length ? el('ul', { class: 'kit-tip-mods' }, mods.map(([k, v]) =>
      el('li', { class: statIsGood(k, v) ? 'good' : 'bad' }, el('span', { class: 'kit-mod-val' }, formatMod(k, v)), ' ', statLabel(k)))) : null,
    item.pros?.length ? el('ul', { class: 'kit-tip-pros' }, item.pros.map((t) => el('li', t))) : null,
    item.cons?.length ? el('ul', { class: 'kit-tip-cons' }, item.cons.map((t) => el('li', t))) : null,
    item.price > 0 && !opts.owned ? el('div', { class: 'kit-tip-price' }, icon('credits', 14), formatCount(item.price)) : null);
}

/** A labelled stat line: statRow('binoZoom', 8, { delta: 2 }) → "Magnification  8×  (+2×)". */
export function statRow(key, value, opts = {}) {
  const d = opts.delta;
  return el('div', { class: 'kit-stat' },
    el('span', { class: 'kit-stat-label' }, statLabel(key)),
    el('span', { class: 'kit-stat-value' }, formatStat(key, value)),
    d ? el('span', { class: 'kit-stat-delta ' + (statIsGood(key, d) ? 'good' : 'bad') }, formatMod(key, d)) : null);
}

/** A small pill: chip('Tier II', { icon: 'star', tone: 'amber'|'forest'|'sky'|'danger' }). */
export function chip(text, opts = {}) {
  return el('span', { class: 'kit-chip' + (opts.tone ? ' kit-chip-' + opts.tone : '') }, opts.icon ? icon(opts.icon, 13) : null, text);
}

/** A friendly empty-state block: emptyState('bird', 'Nothing here yet', 'Go and listen…'). */
export function emptyState(iconName, title, text) {
  return el('div', { class: 'kit-empty' }, icon(iconName || 'leaf', 40), el('div', { class: 'kit-empty-title' }, title), text ? el('div', { class: 'kit-empty-text' }, text) : null);
}

/* ----------------------------------------------------------------------------
 * Modal confirmation.
 * confirmDialog('Start a new adventure?', { ok: 'Start', cancel: 'Cancel', danger: true }) → Promise<boolean>
 * Extras: opts.title, opts.detail (smaller second paragraph), opts.icon, opts.single (no cancel).
 * Esc / backdrop click cancels, Enter confirms (unless the cancel button has focus). Esc is
 * swallowed so the screen underneath stays open. Focus is trapped and then restored. */
export function confirmDialog(text, opts = {}) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('keydown', onKey, true);
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 140);
      try { previous?.focus?.(); } catch { /* element may be gone */ }
      resolve(v);
    };
    const okBtn = button(opts.ok || 'OK', { variant: opts.danger ? 'danger' : 'primary', onClick: () => done(true) });
    const cancelBtn = opts.single ? null : button(opts.cancel || 'Cancel', { variant: 'ghost', onClick: () => done(false) });
    const card = el('div', { class: 'kit-confirm-card' + (opts.danger ? ' danger' : ''), role: 'alertdialog', 'aria-modal': 'true', 'aria-label': opts.title || String(text) },
      opts.title || opts.icon ? el('div', { class: 'kit-confirm-title' }, opts.icon || opts.danger ? icon(opts.icon || 'warning', 20) : null, opts.title || '') : null,
      el('div', { class: 'kit-confirm-text' }, text),
      opts.detail ? el('div', { class: 'kit-confirm-detail' }, opts.detail) : null,
      el('div', { class: 'kit-confirm-actions' }, cancelBtn, okBtn));
    const wrap = el('div', { class: 'kit-confirm', onmousedown: (e) => { if (e.target === wrap && !opts.single) done(false); } }, card);
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); done(false); }
      else if (e.key === 'Enter') {
        if (document.activeElement === cancelBtn) return; // Enter on Cancel presses Cancel
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); done(true);
      } else if (e.key === 'Tab') {
        const order = [cancelBtn, okBtn].filter(Boolean);
        const i = order.indexOf(document.activeElement);
        const next = e.shiftKey ? order[(i <= 0 ? order.length : i) - 1] : order[(i + 1) % order.length];
        e.preventDefault(); next.focus();
      }
    }
    window.addEventListener('keydown', onKey, true);
    (document.getElementById('screens') || document.body).appendChild(wrap);
    (opts.danger && cancelBtn ? cancelBtn : okBtn).focus();
  });
}

/* ----------------------------------------------------------------------------
 * Tooltip: tooltip(node, string | () => Node|string|null, { delay?, follow? }) → node.
 * A rich hover card positioned near the node (below it, flipped above / clamped to the
 * viewport when there is no room). The function form is evaluated on every show, so it
 * can read live state. Calling tooltip() again on the same node replaces its content.
 * Also shown on keyboard focus. Only one tooltip exists at a time; hideTooltip() clears it. */
const tipBindings = new WeakMap();
let tipEl = null;
let tipOwner = null;
let tipTimer = 0;
let tipWatch = 0;
let tipSeq = 0;

function ensureTip() {
  if (!tipEl) {
    tipEl = el('div', { class: 'kit-tooltip', role: 'tooltip', hidden: true });
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function placeTip(anchor, x) {
  const t = ensureTip();
  const a = anchor.getBoundingClientRect();
  const w = t.offsetWidth, h = t.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, gap = 10, m = 8;
  let left = (x != null ? x : a.left + a.width / 2) - w / 2;
  left = Math.max(m, Math.min(vw - w - m, left));
  let top = a.bottom + gap;
  let side = 'below';
  if (top + h > vh - m) {
    if (a.top - gap - h >= m) { top = a.top - gap - h; side = 'above'; } else top = Math.max(m, vh - h - m);
  }
  t.style.left = Math.round(left) + 'px';
  t.style.top = Math.round(top) + 'px';
  t.dataset.side = side;
}

export function hideTooltip() {
  clearTimeout(tipTimer);
  clearInterval(tipWatch);
  tipWatch = 0;
  if (tipOwner) tipOwner.removeAttribute?.('aria-describedby');
  tipOwner = null;
  if (tipEl) tipEl.hidden = true;
}

function showTip(node, x) {
  const bind = tipBindings.get(node);
  if (!bind || !node.isConnected) return;
  let content;
  try { content = typeof bind.content === 'function' ? bind.content() : bind.content; } catch (err) { console.error('[kit] tooltip content failed', err); return; }
  if (content == null || content === false || content === '') { hideTooltip(); return; }
  const t = ensureTip();
  t.replaceChildren(content instanceof Node ? content : el('div', { class: 'kit-tip-text' }, String(content)));
  t.id = t.id || 'kit-tooltip-' + (++tipSeq);
  t.hidden = false;
  tipOwner = node;
  node.setAttribute('aria-describedby', t.id);
  placeTip(node, bind.follow ? x : null);
  clearInterval(tipWatch);
  // A node can be re-rendered away while hovered; make sure the card never gets stranded.
  tipWatch = setInterval(() => {
    if (!tipOwner || !tipOwner.isConnected || (!tipOwner.matches(':hover') && !tipOwner.matches(':focus-visible'))) hideTooltip();
  }, 350);
}

export function tooltip(node, content, opts = {}) {
  if (!node || typeof node.addEventListener !== 'function') return node;
  const existing = tipBindings.get(node);
  if (existing) {
    existing.content = content;
    if (tipOwner === node) showTip(node);
    return node;
  }
  const bind = { content, follow: !!opts.follow };
  tipBindings.set(node, bind);
  const delay = opts.delay ?? 120;
  node.addEventListener('mouseenter', (e) => { clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(node, e.clientX), delay); });
  node.addEventListener('mousemove', (e) => { if (bind.follow && tipOwner === node) placeTip(node, e.clientX); });
  node.addEventListener('mouseleave', () => { if (tipOwner === node || tipTimer) hideTooltip(); });
  node.addEventListener('focus', () => { if (node.matches?.(':focus-visible')) showTip(node); });
  node.addEventListener('blur', () => { if (tipOwner === node) hideTooltip(); });
  node.addEventListener('mousedown', () => { if (tipOwner === node) hideTooltip(); });
  if (typeof content === 'string' && !node.textContent.trim() && !node.getAttribute('aria-label')) node.setAttribute('aria-label', content);
  return node;
}

// The kit is also a (trivial) module so main.js can load it and expose ctx.kit.
import * as self from './kit.js';
export default {
  name: 'kit',
  init(ctx) {
    ctx.kit = self;
    // Tooltips belong to the screen that spawned them: never leave one behind when it closes.
    ctx.bus?.on?.('ui:close', hideTooltip);
    ctx.bus?.on?.('ui:open', hideTooltip);
  },
};
