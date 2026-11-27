// DOM for the equipment key legend and the Field controls reference card.
// Keycaps are styled spans; mouse buttons are small inline SVG pictograms.
import { el, icon } from '../kit.js';
import { lineFor, referenceGroups } from './legend.js';

const NS = 'http://www.w3.org/2000/svg';

function svg(viewBox, w, h, parts) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('width', w);
  s.setAttribute('height', h);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = parts;
  return s;
}

// A mouse 12 x 18 drawn at (ox, 1): body outline, button split, the named part lit.
function mouseParts(button, ox = 1) {
  const x0 = ox, x1 = ox + 12, cx = ox + 6;
  const body = `<rect class="tk-m-body" x="${x0}" y="1" width="12" height="18" rx="6"/>`
    + `<path class="tk-m-line" d="M${x0} 8.2H${x1}M${cx} 1V8.2"/>`;
  let lit = '';
  if (button === 'left') lit = `<path class="tk-m-lit" d="M${x0 + 0.7} 7.5V7A5.3 5.3 0 0 1 ${cx - 0.6} 1.75V7.5Z"/>`;
  else if (button === 'right') lit = `<path class="tk-m-lit" d="M${x1 - 0.7} 7.5V7A5.3 5.3 0 0 0 ${cx + 0.6} 1.75V7.5Z"/>`;
  else if (button === 'wheel') lit = `<rect class="tk-m-lit" x="${cx - 1.3}" y="2.6" width="2.6" height="4.6" rx="1.3"/>`;
  return body + lit;
}

/** Mouse pictogram: 'left' | 'right' | 'wheel' | 'move'. */
export function mouseGlyph(button, size = 18) {
  if (button === 'move') {
    // Mouse with little arrows either side: "move the mouse / aim".
    const arrows = '<path class="tk-m-lit" d="M3.6 10L.6 7.4V12.6ZM20.4 10L23.4 7.4V12.6Z"/>';
    return svg('0 0 24 20', Math.round(size * 1.2), size, mouseParts('', 6) + arrows);
  }
  if (button === 'wheel') {
    const ticks = '<path class="tk-m-tick" d="M16.5 4.5L18.2 2.4L19.9 4.5M16.5 15.5L18.2 17.6L19.9 15.5"/>';
    return svg('0 0 21 20', Math.round(size * 1.05), size, mouseParts('wheel', 1) + ticks);
  }
  return svg('0 0 14 20', Math.round(size * 0.7), size, mouseParts(button, 1));
}

const MOUSE_NAMES = { left: 'Left mouse button', right: 'Right mouse button', wheel: 'Mouse wheel', move: 'Move the mouse' };

/** One keycap or mouse cap. */
export function capEl(cap) {
  if (cap.k === 'mouse') return el('span', { class: `tk-cap tk-mouse tk-mouse-${cap.button}`, title: MOUSE_NAMES[cap.button] || '' }, mouseGlyph(cap.button));
  const wide = cap.label.length > 1;
  return el('span', { class: 'tk-cap tk-key' + (wide ? ' tk-key-wide' : '') }, cap.label);
}

function capsEl(row, sep = '') {
  const out = [];
  row.keys.forEach((c, i) => {
    if (i && sep) out.push(el('span', { class: 'tk-or' }, sep));
    out.push(capEl(c));
  });
  return el('span', { class: 'tk-caps' }, out);
}

function modEl(row) {
  if (row.hold) return el('span', { class: 'tk-mod' }, 'hold');
  if (row.release) return el('span', { class: 'tk-mod' }, 'release');
  return null;
}

const TOOL_ICONS = { binoculars: 'binoculars', camera: 'camera', recorder: 'recorder', none: 'footprint' };

/** The legend panel's children (header, rows, quiet line). */
export function panelChildren(lg) {
  const head = el('div', { class: 'tk-head' },
    el('span', { class: 'tk-head-icon' }, icon(TOOL_ICONS[lg.tool] || 'footprint', 14)),
    el('span', { class: 'tk-title' }, lg.title),
    lg.state === 'raised' ? el('span', { class: 'tk-state' }, 'raised') : null,
    lg.state === 'recording' ? el('span', { class: 'tk-state tk-state-rec' }, 'recording') : null,
    lg.note ? el('span', { class: 'tk-note' + (/Out of/.test(lg.note) ? ' tk-note-warn' : '') }, lg.note) : null);
  const body = lg.empty
    ? el('div', { class: 'tk-empty' }, el('b', null, lg.empty), lg.note ? el('span', null, lg.note) : null)
    : el('div', { class: 'tk-rows tk-rows-' + lg.layout }, lg.rows.map((r) => el('div', { class: 'tk-row' + (r.dim ? ' tk-dim' : '') + (r.minor ? ' tk-minor' : '') },
      capsEl(r), el('span', { class: 'tk-verb' }, modEl(r), r.verb))));
  const quiet = lg.quiet.length
    ? el('div', { class: 'tk-quiet' }, lg.quiet.map((r) => el('span', { class: 'tk-q', title: r.verb }, capsEl(r), el('span', { class: 'tk-qverb' }, r.short || r.verb))))
    : null;
  return [head, body, quiet];
}

/** The minimal single line used while an optic is raised. */
export function lineChildren(lg) {
  const line = lineFor(lg);
  const out = [];
  line.parts.forEach((p, i) => {
    if (i) out.push(el('span', { class: 'tk-dot' }));
    out.push(el('span', { class: 'tk-lp' + (p.dim ? ' tk-dim' : '') }, capsEl(p), el('span', { class: 'tk-verb' }, modEl(p), p.verb)));
  });
  if (line.note) {
    out.push(el('span', { class: 'tk-dot' }));
    out.push(el('span', { class: 'tk-lnote' + (/Out of/.test(line.note) ? ' tk-note-warn' : '') }, line.note));
  }
  return out;
}

/**
 * The complete "Field controls" reference card (settings controls tab, tutorial).
 * @param {object} opts {title?: string|false, plain?: bool (no paper card around it), keymap?}
 */
export function referenceCard(opts = {}) {
  const groups = referenceGroups(opts.keymap);
  const title = opts.title === false ? null : el('div', { class: 'tk-card-head' },
    el('span', { class: 'tk-card-title' }, opts.title || 'Field controls'),
    el('span', { class: 'tk-card-sub' }, 'Every key the equipment uses. The same hints appear beside your tool slots while you play.'));
  return el('section', { class: 'tk-card' + (opts.plain ? ' tk-card-plain' : '') },
    title,
    el('div', { class: 'tk-card-grid' }, groups.map((g) => el('div', { class: 'tk-group tk-group-' + g.id },
      el('div', { class: 'tk-group-head' }, icon(g.icon, 16), el('span', null, g.title)),
      g.rows.map((r) => el('div', { class: 'tk-crow' },
        capsEl(r, r.alt ? 'or' : ''),
        el('span', { class: 'tk-cverb' }, modEl(r), r.verb)))))));
}
