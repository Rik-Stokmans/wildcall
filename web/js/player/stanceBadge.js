// Stance indicator in #tool-overlay (styled by css/tools.css, "tool-stance"): three
// small pictograms (standing, crouched, lying flat) with the current one lit. It shows
// for a couple of seconds after a stance change and then fades away (spec §29.1: the
// HUD stays subtle). DOM only; the fade curve is stance.js indicatorAlpha.
import { indicatorAlpha } from './stance.js';

const ICONS = {
  // 20×20 line pictograms: head + body, drawn in currentColor.
  stand: '<circle cx="10" cy="3.2" r="2"/><path d="M10 6v6.5M10 12.5l-2.6 5.8M10 12.5l2.6 5.8M10 7.8l-3.4 3.4M10 7.8l3.4 3.4"/>',
  crouch: '<circle cx="10.5" cy="6.4" r="2"/><path d="M10 9.2l-1.6 4.6M8.4 13.8l3.8 1.2-1.2 3.6M8.4 13.8l-1.4 4.4M9.8 10.4l3.4 1.8"/>',
  prone: '<circle cx="16.4" cy="13.4" r="2"/><path d="M14 15.4H5.2M5.2 15.4l-3 1.6M14 15.4l-1.2 2.6M10.8 15.4l1.4 2.4"/>',
};
const ORDER = ['stand', 'crouch', 'prone'];

export function createStanceBadge(root) {
  root = root || document.getElementById('tool-overlay') || document.body;
  const el = document.createElement('div');
  el.className = 'tool-stance';
  el.setAttribute('aria-hidden', 'true');
  const icons = {};
  for (const k of ORDER) {
    const i = document.createElement('span');
    i.className = 'tool-stance-icon';
    i.dataset.stance = k;
    i.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
    el.appendChild(i);
    icons[k] = i;
  }
  root.appendChild(el);
  let shown = '', alpha = -1;

  return {
    /** @param {string} stance stand|crouch|prone|sit  @param {number} since seconds since the change */
    update(stance, since, playing) {
      const lit = stance === 'sit' ? 'crouch' : stance; // sitting reads as the low-but-upright icon
      if (lit !== shown) {
        for (const k of ORDER) icons[k].classList.toggle('tool-stance-on', k === lit);
        shown = lit;
      }
      const a = playing ? Math.round(indicatorAlpha(since) * 100) / 100 : 0;
      if (a !== alpha) { el.style.opacity = String(a); alpha = a; }
    },
  };
}
