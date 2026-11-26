// WILDCALL shared UI kit — CONTRACT STUB.
//
// The exported names, parameters and return types in this file are pinned: every UI
// module imports them. The `ui-kit` task replaces the bodies with the real, polished
// implementations (and writes css/kit.css) WITHOUT changing any signature.
// The stub bodies below are deliberately plain but functional.
//
// Import with:  import { el, icon, button, ... } from '../kit.js';

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
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return node;
}

/** Remove all children of a node and append the given ones. Returns the node. */
export function fill(node, ...children) {
  node.replaceChildren();
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
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
 */
export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'kit-icon kit-icon-' + name);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="12" cy="12" r="5" fill="currentColor" opacity=".7"/>';
  return svg;
}

/* ----------------------------------------------------------------------------
 * Bird illustration: a stylised 2D side-view drawing generated from a species'
 * `look` (core.Appearance). Used by the journal, field guide, identification screen.
 * birdIllustration(species, opts) → HTMLCanvasElement (CSS size = opts.size px, crisp on HiDPI)
 *   opts.size        px, default 160
 *   opts.pose        'perched' (default) | 'flying'
 *   opts.silhouette  true → flat dark silhouette only (for undiscovered species)
 *   opts.reveal      optional Set/array of evidence keys the player knows
 *                    (size, shape, primary, secondary, marking, bill): unknown parts are
 *                    drawn as neutral pencil outline — the "what I have seen so far" sketch.
 *   opts.background  false (default, transparent) | true → soft paper vignette
 */
export function birdIllustration(species, opts = {}) {
  const size = opts.size || 160;
  const c = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = size + 'px';
  c.className = 'kit-bird';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const col = opts.silhouette ? '#3A3027' : (species?.look?.colors?.back || '#7A6A5B');
  g.fillStyle = col;
  g.beginPath(); g.ellipse(size * 0.5, size * 0.56, size * 0.26, size * 0.18, -0.2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(size * 0.7, size * 0.4, size * 0.1, 0, Math.PI * 2); g.fill();
  return c;
}

/* ----------------------------------------------------------------------------
 * Rarity helpers (item / wildlife rarity 0..4: Common, Uncommon, Rare, Epic, Legendary). */
export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
export function rarityName(r) { return RARITY_NAMES[r] || 'Common'; }
/** CSS colour (a var(--rarity-n) reference) for a rarity. */
export function rarityColor(r) { return `var(--rarity-${Math.max(0, Math.min(4, r | 0))})`; }
/** Small pill element showing the rarity name in its colour. */
export function rarityBadge(r) {
  return el('span', { class: 'kit-rarity kit-rarity-' + (r | 0), style: { color: rarityColor(r) } }, rarityName(r));
}

/* ----------------------------------------------------------------------------
 * Widgets. All return HTMLElements styled by css/kit.css (class prefix "kit-"). */

/** button('Buy', { variant: 'primary'|'secondary'|'ghost'|'danger', icon: 'credits', onClick, disabled, title, small }) */
export function button(label, opts = {}) {
  const b = el('button', {
    class: `kit-btn kit-btn-${opts.variant || 'secondary'}${opts.small ? ' kit-btn-small' : ''}`,
    title: opts.title, disabled: !!opts.disabled, type: 'button',
  }, opts.icon ? icon(opts.icon, opts.small ? 14 : 18) : null, label != null ? el('span', label) : null);
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

/**
 * tabs([{ id, label, icon?, badge? }], activeId, onSelect) → element with .setActive(id)
 * and .setBadge(id, textOrNull).
 */
export function tabs(items, activeId, onSelect) {
  const root = el('div', { class: 'kit-tabs', role: 'tablist' });
  const btns = new Map();
  for (const it of items) {
    const b = el('button', { class: 'kit-tab', type: 'button', role: 'tab', dataset: { id: it.id } },
      it.icon ? icon(it.icon, 18) : null, el('span', it.label), el('span', { class: 'kit-tab-badge', hidden: !it.badge }, it.badge || ''));
    b.addEventListener('click', () => { root.setActive(it.id); onSelect?.(it.id); });
    btns.set(it.id, b);
    root.appendChild(b);
  }
  root.setActive = (id) => { for (const [k, b] of btns) b.classList.toggle('active', k === id); };
  root.setBadge = (id, text) => {
    const badge = btns.get(id)?.querySelector('.kit-tab-badge');
    if (badge) { badge.hidden = !text; badge.textContent = text || ''; }
  };
  root.setActive(activeId);
  return root;
}

/**
 * A framed screen panel (paper card with a title bar and close button).
 * panel({ title, subtitle?, icon?, wide?, onClose? }) → { root, header, body, footer, setTitle(t, sub?) }
 * Append `root` inside your screen root; put content in `body`.
 */
export function panel(opts = {}) {
  const titleEl = el('div', { class: 'kit-panel-title' }, opts.title || '');
  const subEl = el('div', { class: 'kit-panel-sub' }, opts.subtitle || '');
  const header = el('div', { class: 'kit-panel-header' },
    opts.icon ? icon(opts.icon, 26) : null, el('div', { class: 'kit-panel-titles' }, titleEl, subEl),
    el('div', { class: 'kit-panel-spacer' }),
    opts.onClose ? el('button', { class: 'kit-panel-close', type: 'button', title: 'Close (Esc)', onclick: opts.onClose }, icon('close', 18)) : null);
  const body = el('div', { class: 'kit-panel-body' });
  const footer = el('div', { class: 'kit-panel-footer' });
  const root = el('div', { class: 'kit-panel' + (opts.wide ? ' kit-panel-wide' : '') }, header, body, footer);
  return { root, header, body, footer, setTitle(t, sub) { titleEl.textContent = t; if (sub != null) subEl.textContent = sub; } };
}

/** progressBar(value, max, { label?, color?, height? }) → element with .set(value, max) */
export function progressBar(value, max, opts = {}) {
  const fillEl = el('div', { class: 'kit-progress-fill', style: { background: opts.color || '' } });
  const root = el('div', { class: 'kit-progress', style: { height: opts.height ? opts.height + 'px' : '' } }, fillEl,
    opts.label ? el('span', { class: 'kit-progress-label' }, opts.label) : null);
  root.set = (v, m) => { fillEl.style.width = (m > 0 ? Math.max(0, Math.min(1, v / m)) * 100 : 0) + '%'; };
  root.set(value, max);
  return root;
}

/** stars(n, max = 5) → element showing n filled of max stars. */
export function stars(n, max = 5) {
  return el('span', { class: 'kit-stars', title: `${n} / ${max}` }, '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, max - n)));
}

/**
 * Human labels and formatting for core.Stats keys.
 * STAT_INFO[key] = { label, unit: '×'|'%'|'m'|'s'|'kg'|'', better: 'high'|'low', group }
 * Only stats worth showing to players are listed.
 */
export const STAT_INFO = {
  binoZoom: { label: 'Magnification', unit: '×', better: 'high', group: 'optics' },
  binoFov: { label: 'Field of view', unit: '', better: 'high', group: 'optics' },
  binoStability: { label: 'Stability', unit: '%', better: 'high', group: 'optics' },
  binoFocus: { label: 'Focus speed', unit: '', better: 'high', group: 'optics' },
  binoClarity: { label: 'Clarity', unit: '%', better: 'high', group: 'optics' },
  binoWeight: { label: 'Weight', unit: 'kg', better: 'low', group: 'optics' },
  lowLight: { label: 'Low-light', unit: '%', better: 'high', group: 'optics' },
  camZoom: { label: 'Zoom', unit: '×', better: 'high', group: 'camera' },
  camFocus: { label: 'Focus speed', unit: '', better: 'high', group: 'camera' },
  camQuality: { label: 'Image quality', unit: '%', better: 'high', group: 'camera' },
  camBurst: { label: 'Burst speed', unit: '/s', better: 'high', group: 'camera' },
  camStability: { label: 'Stability', unit: '%', better: 'high', group: 'camera' },
  camNoise: { label: 'Shutter noise', unit: '%', better: 'low', group: 'camera' },
  filmCap: { label: 'Film capacity', unit: '', better: 'high', group: 'camera' },
  recRange: { label: 'Range', unit: 'm', better: 'high', group: 'audio' },
  recFocus: { label: 'Directionality', unit: '%', better: 'high', group: 'audio' },
  recQuality: { label: 'Recording quality', unit: '%', better: 'high', group: 'audio' },
  noiseReduce: { label: 'Noise reduction', unit: '%', better: 'high', group: 'audio' },
  hearRange: { label: 'Hearing range', unit: '×', better: 'high', group: 'audio' },
  dirAccuracy: { label: 'Direction sense', unit: '%', better: 'high', group: 'audio' },
  capacity: { label: 'Capacity', unit: '', better: 'high', group: 'backpack' },
  moveSpeed: { label: 'Walking speed', unit: '×', better: 'high', group: 'field' },
  stamina: { label: 'Stamina', unit: 's', better: 'high', group: 'field' },
  stealth: { label: 'Disturbance', unit: '×', better: 'low', group: 'field' },
  rainProof: { label: 'Rain protection', unit: '%', better: 'high', group: 'field' },
  terrain: { label: 'Rough terrain', unit: '%', better: 'high', group: 'field' },
};

/** formatStat('binoZoom', 8) → "8×";  formatStat('binoStability', 0.35) → "35%". */
export function formatStat(key, value) {
  const info = STAT_INFO[key];
  if (!info) return String(Math.round(value * 100) / 100);
  if (info.unit === '%') return Math.round(value * 100) + '%';
  return (Math.round(value * 10) / 10) + info.unit;
}

/** formatMod('binoZoom', 2) → "+2×";  sign-aware, for item tooltips and comparisons. */
export function formatMod(key, delta) {
  const s = formatStat(key, Math.abs(delta));
  return (delta >= 0 ? '+' : '−') + s;
}

/** True if a positive delta of this stat is good for the player. */
export function statIsGood(key, delta) {
  const better = STAT_INFO[key]?.better || 'high';
  return better === 'high' ? delta >= 0 : delta <= 0;
}

/**
 * itemCard(itemDef, { owned?, equipped?, qty?, price?, compact?, selected?, onClick? }) → element.
 * Shows icon, name, rarity colour, tier, quantity and state badges. Used in the
 * inventory grid, equipment slots, shop and rewards.
 */
export function itemCard(item, opts = {}) {
  const card = el('div', { class: `kit-item kit-rarity-${item?.rarity | 0}${opts.selected ? ' selected' : ''}${opts.compact ? ' compact' : ''}`,
    style: { '--rarity': rarityColor(item?.rarity) } },
    el('div', { class: 'kit-item-icon' }, icon(item?.icon || 'backpack', opts.compact ? 24 : 34)),
    el('div', { class: 'kit-item-name' }, item?.name || 'Empty'),
    opts.qty > 1 ? el('div', { class: 'kit-item-qty' }, '×' + opts.qty) : null,
    opts.equipped ? el('div', { class: 'kit-item-tag' }, 'Equipped') : null,
    opts.price != null ? el('div', { class: 'kit-item-price' }, icon('credits', 12), String(opts.price)) : null);
  if (opts.onClick) card.addEventListener('click', opts.onClick);
  return card;
}

/** formatClock(13.5) → "13:30" */
export function formatClock(hours) {
  const h = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const WEATHER_NAMES = ['Sunny', 'Cloudy', 'Rain', 'Wind'];
export const WEATHER_ICONS = ['sunny', 'cloudy', 'rain', 'wind'];
export const DISCOVERY_LEVELS = ['', 'Unknown', 'Heard', 'Encountered', 'Identified', 'Documented', 'Studied'];
export const WILD_RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Legendary'];

/** Capitalised display text for snake_case / lower-case vocabulary words: label('very high') → "Very high". */
export function label(word) {
  if (!word) return '';
  const s = String(word).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** confirmDialog('Start a new adventure?', { ok: 'Start', cancel: 'Cancel', danger: true }) → Promise<boolean> */
export function confirmDialog(text, opts = {}) {
  return new Promise((resolve) => {
    const done = (v) => { wrap.remove(); resolve(v); };
    const wrap = el('div', { class: 'kit-confirm' },
      el('div', { class: 'kit-confirm-card' },
        el('div', { class: 'kit-confirm-text' }, text),
        el('div', { class: 'kit-confirm-actions' },
          button(opts.cancel || 'Cancel', { variant: 'ghost', onClick: () => done(false) }),
          button(opts.ok || 'OK', { variant: opts.danger ? 'danger' : 'primary', onClick: () => done(true) }))));
    document.getElementById('screens').appendChild(wrap);
  });
}

/** Attach a hover tooltip (string or element-producing function) to a node. Returns the node. */
export function tooltip(node, content) {
  if (typeof content === 'string') node.title = content;
  return node;
}

// The kit is also a (trivial) module so main.js can load it and expose ctx.kit.
import * as self from './kit.js';
export default {
  name: 'kit',
  init(ctx) { ctx.kit = self; },
};
