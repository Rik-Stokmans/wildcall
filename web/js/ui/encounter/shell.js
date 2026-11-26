// Small DOM helpers shared by the encounter screens: sound, safe icons, screen frames,
// bird art that never reveals more than the player has earned.
import { el, fill, icon, birdIllustration, button } from '../kit.js';
import { revealKeys } from './logic.js';

export { el, fill, button };

/** Play a UI sound through ctx.audio if it exists; never throws. */
export function sound(ctx, name) {
  try { ctx.audio?.uiSound?.(name); } catch { /* audio is optional */ }
}

/** kit icon that can never throw (unknown or failing icons render nothing). */
export function ico(name, size = 18) {
  try { return icon(name, size); } catch { return null; }
}

/** True if the player has identified this species (journal entry exists). */
export function isIdentified(profile, id) {
  return !!profile?.journal?.species?.[id];
}

/**
 * A bird illustration that never over-reveals.
 *  - identified species: full colour
 *  - otherwise, with `evidence`: only the parts the player has observed (pencil outline for
 *    the rest); with no observed parts it falls back to a silhouette
 *  - otherwise: silhouette
 */
export function speciesArt(sp, { size = 64, identified = false, evidence = null, pose = 'perched', background = false } = {}) {
  let c;
  try {
    const reveal = evidence ? revealKeys(evidence) : [];
    if (identified) c = birdIllustration(sp, { size, pose, background });
    else if (reveal.length) c = birdIllustration(sp, { size, pose, reveal, background });
    else c = birdIllustration(sp, { size, pose, silhouette: true, background });
  } catch (err) {
    console.warn('[encounter] illustration failed', err);
    c = el('div', { style: { width: size + 'px', height: size + 'px' } });
  }
  c.classList.add('enc-art');
  return c;
}

/**
 * The standard screen frame: dimmed backdrop + centred paper card with a header.
 * Returns { root, card, header, body, footer, setTitle(title, subtitle) }.
 */
export function screenFrame({ cls, title, subtitle, iconName, onClose, overlay = false, wide = false }) {
  const titleEl = el('div', { class: 'enc-title' }, title || '');
  const subEl = el('div', { class: 'enc-subtitle' }, subtitle || '');
  const header = el('div', { class: 'enc-header' },
    iconName ? el('div', { class: 'enc-header-icon' }, ico(iconName, 26)) : null,
    el('div', { class: 'enc-titles' }, titleEl, subEl),
    onClose ? el('button', { class: 'enc-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: onClose }, ico('close', 18)) : null);
  const body = el('div', { class: 'enc-body' });
  const footer = el('div', { class: 'enc-footer' });
  const card = el('div', { class: 'enc-card' + (wide ? ' enc-card-wide' : '') }, header, body, footer);
  const root = el('div', { class: `enc-root ${overlay ? 'enc-overlay' : 'enc-full'} ${cls || ''}` }, el('div', { class: 'enc-backdrop' }), card);
  return {
    root, card, header, body, footer,
    setTitle(t, s) { titleEl.textContent = t || ''; subEl.textContent = s || ''; subEl.hidden = !s; },
  };
}

/** Re-render a screen when the profile changes, but only if `sig()` changed. */
export function watchProfile(ctx, isOpen, sig, render) {
  let last = '';
  ctx.bus.on('profile', () => {
    if (!isOpen()) return;
    let s = '';
    try { s = sig(); } catch { s = String(Math.random()); }
    if (s === last) return;
    last = s;
    render();
  });
  return { reset(s = '') { last = s; } };
}

/** True when the user prefers reduced motion (skips count-ups and typewriter effects). */
export function reducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Wildcard rarity (0..3 Common..Legendary) -> kit rarity scale (0..4). */
export function wildRarityToKit(r) { return r === 3 ? 4 : r | 0; }

/** Space / Enter confirm for an overlay screen while it is the top screen. */
export function confirmKey(ctx, name, fn) {
  window.addEventListener('keydown', (e) => {
    if (ctx.ui.top !== name || e.repeat) return;
    if (e.code !== 'Space' && e.code !== 'Enter') return;
    if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') return;
    e.preventDefault(); e.stopPropagation();
    fn();
  }, true);
}
