// The in-game menu screen ('menu'): tabbed panel over a dimmed, blurred view of the world.
import { el, fill, button, tabs, panel } from '../kit.js';
import { keepScroll, sfx } from './common.js';
import { renderCharacter } from './tab-character.js';
import { renderSkills } from './tab-skills.js';
import { renderInventory } from './tab-inventory.js';
import { renderEquipment } from './tab-equipment.js';
import { renderRank } from './tab-rank.js';
import { renderSettings } from './tab-settings.js';

export const TABS = [
  { id: 'character', label: 'Character', icon: 'level', render: renderCharacter },
  { id: 'skills', label: 'Skills', icon: 'skillpoint', render: renderSkills },
  { id: 'inventory', label: 'Inventory', icon: 'backpack', render: renderInventory },
  { id: 'equipment', label: 'Equipment', icon: 'binoculars', render: renderEquipment },
  { id: 'rank', label: 'Rank', icon: 'rank', render: renderRank },
  { id: 'settings', label: 'Settings', icon: 'settings', render: renderSettings, static: true },
];

/**
 * @param ctx   the game context
 * @param session {started: boolean} shared with the main menu: before the game starts the
 *                menu is opened from the title screen, so it offers "Back" instead of "Resume"
 *                and hides "Return to main menu".
 */
export function createGameMenu(ctx, session) {
  const { bus, ui, state } = ctx;
  const st = {
    tab: 'character', skillId: null, filter: 'all', sort: 'name', itemSel: null, slot: 'optics',
    fromMain: false,
    goTab(id) { selectTab(id); },
    rerender() { render(); },
  };

  const frame = panel({ title: 'Field Notes', subtitle: '', icon: 'journal', wide: true, onClose: () => ui.close('menu') });
  const tabBar = tabs(TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon })), st.tab, (id) => selectTab(id));
  const content = el('div', { class: 'menu-content' });
  const resume = button('Resume', { variant: 'primary', onClick: () => { sfx(ctx, 'close'); ui.close('menu'); } });
  frame.body.append(tabBar, content);
  frame.footer.append(el('span', { class: 'menu-faint menu-footer-hint' }, 'Esc closes this page'), resume);

  const root = el('div', { class: 'menu-root menu-shell' }, el('div', { class: 'menu-backdrop' }), frame.root);
  // Clicking the dimmed area outside the paper closes the menu.
  root.addEventListener('mousedown', (e) => { if (e.target === root || e.target.classList.contains('menu-backdrop')) ui.close('menu'); });

  function selectTab(id) {
    if (!TABS.some((t) => t.id === id)) id = 'character';
    st.tab = id;
    tabBar.setActive(id);
    sfx(ctx, 'click');
    render();
  }

  function render() {
    const def = TABS.find((t) => t.id === st.tab) || TABS[0];
    const p = state.profile;
    frame.setTitle('Field Notes', p ? `${p.name || 'Naturalist'} · ${state.ranks.find((r) => r.index === p.rank)?.title || 'Beginner'}` : '');
    tabBar.setBadge('skills', p?.skillPoints > 0 ? String(p.skillPoints) : null);
    keepScroll(content, () => {
      let view;
      try { view = def.render(ctx, st); } catch (err) {
        console.error(`[menu] ${def.id} tab failed`, err);
        view = el('div', { class: 'menu-empty' }, 'This page could not be drawn.');
      }
      fill(content, view);
      content.dataset.tab = def.id;
    });
  }

  let off = null;
  return {
    root,
    overlay: false,
    closable: true,
    open(data = {}) {
      st.fromMain = !session.started;
      resume.querySelector('span').textContent = st.fromMain ? 'Back' : 'Resume';
      st.tab = TABS.some((t) => t.id === data.tab) ? data.tab : 'character';
      tabBar.setActive(st.tab);
      render();
      off?.();
      off = bus.on('profile', () => {
        if (!TABS.find((t) => t.id === st.tab)?.static) render();
      });
    },
    close() { off?.(); off = null; },
  };
}
