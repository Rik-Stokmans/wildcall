// The title screen ('mainmenu'): wordmark over the live forest, a short vertical menu,
// and the New Adventure panel. The backdrop is deliberately left clear: only a soft
// gradient on the left edge sits behind the text.
import { el, fill, icon, button, confirmDialog } from '../kit.js';
import { saveSummary } from './logic.js';
import { sfx } from './common.js';

const TAGLINE = 'Listen closer. Look further. Discover more.';

/**
 * @param ctx
 * @param session {started:boolean} shared with index.js, which brings this screen back
 *        whenever a screen opened from it closes before play has started.
 */
export function createMainMenu(ctx, session) {
  const { bus, net, ui, state, input } = ctx;
  const desktop = () => window.wildcallDesktop;

  const list = el('nav', { class: 'menu-main-list', 'aria-label': 'Main menu' });
  const summaryEl = el('div', { class: 'menu-continue-sub' });
  const newPanel = el('div', { class: 'menu-newgame', hidden: true });
  const versionEl = el('div', { class: 'menu-version' });

  const wordmark = el('header', { class: 'menu-wordmark' },
    el('div', { class: 'menu-wordmark-mark' }, icon('bird', 30)),
    el('h1', { class: 'menu-wordmark-text' }, 'WILDCALL'),
    el('div', { class: 'menu-wordmark-rule' }, el('span'), icon('feather', 16), el('span')),
    el('p', { class: 'menu-tagline' }, TAGLINE));

  const column = el('div', { class: 'menu-main-column' }, wordmark, list, newPanel);
  const root = el('div', { class: 'menu-root menu-main' }, el('div', { class: 'menu-main-shade' }), column, versionEl);

  /* --------------------------------------------------------------- actions */

  function startPlaying() {
    sfx(ctx, 'open');
    session.started = true;
    ui.close('mainmenu');
    bus.emit('game:start', { fresh: !state.welcome?.hasSave });
    input.lock();
  }

  /** Open another screen over the menu; index.js brings the menu back when it closes. */
  function openOver(name, data = {}) {
    sfx(ctx, 'click');
    ui.open(name, data);
  }

  let busy = false;
  async function beginNewAdventure(seedInput, beginBtn, status) {
    if (busy) return;
    if (state.welcome?.hasSave) {
      const ok = await confirmDialog('Start a new adventure? The journal, gear and progress of your current adventure will be replaced.',
        { ok: 'Start anew', cancel: 'Keep my adventure', danger: true });
      if (!ok) return;
    }
    busy = true;
    beginBtn.disabled = true;
    status.textContent = 'Growing a new world…';
    sfx(ctx, 'open');
    const seed = seedInput.value.trim();
    const failTimer = setTimeout(() => {
      busy = false; beginBtn.disabled = false; off();
      status.textContent = 'The forest is taking its time. You can try again.';
    }, 20000);
    // Subscribe BEFORE sending so the reply cannot slip past us.
    const off = bus.once('net:welcome', () => {
      clearTimeout(failTimer);
      location.assign(location.pathname + '?play=1');
    });
    net.send('hello', { name: state.profile?.name || 'Naturalist', newGame: true, seed });
  }

  function toggleNewPanel(show) {
    newPanel.hidden = !show;
    if (show) {
      sfx(ctx, 'click');
      newPanel.querySelector('input')?.focus();
    }
  }

  function buildNewPanel() {
    const seedInput = el('input', {
      class: 'menu-seed', type: 'text', maxlength: 40, placeholder: 'Leave blank for a random world',
      'aria-label': 'World seed', spellcheck: 'false', autocomplete: 'off',
    });
    const status = el('div', { class: 'menu-newgame-status', 'aria-live': 'polite' });
    const beginBtn = button('Begin', { variant: 'primary', icon: 'forward', onClick: () => beginNewAdventure(seedInput, beginBtn, status) });
    seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') beginNewAdventure(seedInput, beginBtn, status);
      if (e.key === 'Escape') { e.stopPropagation(); toggleNewPanel(false); list.querySelector('[data-id="new"]')?.focus(); }
    });
    fill(newPanel,
      el('h2', { class: 'menu-newgame-title' }, 'A new adventure'),
      el('label', { class: 'menu-newgame-field' }, el('span', 'World seed (optional)'), seedInput),
      el('p', { class: 'menu-newgame-note' }, 'Every seed grows a different world: its own forests, marshes and hidden places. Share a seed to explore the same one together.'),
      status,
      el('div', { class: 'menu-newgame-actions' },
        button('Cancel', { variant: 'ghost', onClick: () => toggleNewPanel(false) }), beginBtn));
  }

  /* ------------------------------------------------------------------ list */

  function entry(id, text, iconName, onClick, extra) {
    return el('button', { class: 'menu-main-btn' + (extra?.primary ? ' primary' : ''), type: 'button', dataset: { id }, onclick: onClick },
      el('span', { class: 'menu-main-btn-icon' }, icon(iconName, 20)),
      el('span', { class: 'menu-main-btn-text' }, text, extra?.sub || null));
  }

  function render() {
    const welcome = state.welcome;
    const hasSave = !!welcome?.hasSave;
    const sum = hasSave ? saveSummary(state.profile, state.ranks, welcome) : null;
    versionEl.textContent = welcome?.version ? `v${welcome.version}` : '';
    const items = [];
    if (hasSave && sum) {
      fill(summaryEl,
        el('span', `Level ${sum.level} ${sum.rank}`),
        el('span', `${sum.species} species`),
        el('span', `Day ${sum.day}`),
        sum.seed ? el('span', { class: 'menu-continue-seed' }, `Seed: ${sum.seed}`) : null);
      items.push(entry('continue', 'Continue', 'play', startPlaying, { primary: true, sub: summaryEl }));
    }
    items.push(entry('new', 'New Adventure', 'plus', () => { buildNewPanelIfNeeded(); toggleNewPanel(newPanel.hidden); }));
    items.push(
      entry('journal', 'Journal', 'journal', () => openOver('journal', {})),
      entry('equipment', 'Equipment', 'backpack', () => openOver('menu', { tab: 'equipment' })),
      entry('skills', 'Skills', 'skillpoint', () => openOver('menu', { tab: 'skills' })),
      entry('map', 'Map', 'map', () => openOver('map', {})),
      entry('quests', 'Quests', 'quest', () => openOver('quests', {})),
      entry('collection', 'Collection', 'feather', () => openOver('collection', {})),
      entry('settings', 'Settings', 'settings', () => openOver('menu', { tab: 'settings' })));
    if (desktop()) items.push(entry('quit', 'Quit', 'close', () => { sfx(ctx, 'close'); desktop().quit?.(); }));
    fill(list, items);
  }

  let panelBuilt = false;
  function buildNewPanelIfNeeded() { if (!panelBuilt) { buildNewPanel(); panelBuilt = true; } }

  // Arrow-key navigation: Tab is reserved by the game's key map, so arrows (and Home/End)
  // move between entries; Enter activates the focused one natively.
  root.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const btns = [...list.querySelectorAll('button')];
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement);
    let to = -1;
    if (e.key === 'ArrowDown') to = (i + 1) % btns.length;
    else if (e.key === 'ArrowUp') to = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = btns.length - 1;
    if (to >= 0) { e.preventDefault(); btns[to].focus(); sfx(ctx, 'click'); }
  });

  let off = null;
  return {
    root,
    overlay: false,
    closable: false,
    open() {
      toggleNewPanel(false);
      newPanel.hidden = true;
      render();
      off?.();
      off = bus.on('profile', () => { if (!busy) render(); });
      queueMicrotask(() => list.querySelector('button')?.focus({ preventScroll: true }));
    },
    close() { off?.(); off = null; },
  };
}
