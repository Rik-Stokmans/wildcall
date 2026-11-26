// Screen manager. Screens (full-screen or modal UI) register themselves by name and
// are opened/closed through here so that game mode, pointer lock and the Escape key
// behave consistently. Screen names are pinned in docs/contract.md §Screens.
//
//   ctx.ui.register('journal', {
//     root,                 // HTMLElement with class "screen" (already appended to #screens, hidden)
//     open(data) {},        // populate + show; called every time it is opened
//     close() {},           // optional cleanup
//     overlay: false,       // true = stacks on top of the current screen instead of replacing it
//     closable: true,       // false = Escape does not close it (main menu, forced dialogs)
//   });
//   ctx.ui.open('journal', { section: 'species' });
//   ctx.ui.close();         // close the top screen
//
// Bus events: 'ui:open' {name, data}, 'ui:close' {name}.
import { SCREEN_ACTIONS } from './input.js';

// action → [screen name, data]
const ACTION_SCREENS = {
  menu: ['menu', { tab: 'character' }],
  skills: ['menu', { tab: 'skills' }],
  inventory: ['menu', { tab: 'inventory' }],
  journal: ['journal', {}],
  map: ['map', {}],
  quests: ['quests', {}],
  collection: ['collection', {}],
};

export function createUI(bus, state, input) {
  const screens = new Map();
  const stack = []; // open screen names, bottom → top
  const host = document.getElementById('screens');

  function sync() {
    if (state.mode === 'boot') return;
    if (stack.length === 0) {
      if (state.mode !== 'play') state.setMode('play');
    } else if (stack[0] === 'mainmenu') {
      state.setMode('mainmenu');
    } else {
      state.setMode('ui');
    }
  }

  function hide(name) {
    const s = screens.get(name);
    if (!s) return;
    if (s.root) s.root.hidden = true;
    try { s.close?.(); } catch (err) { console.error(`[ui] ${name}.close threw`, err); }
    bus.emit('ui:close', { name });
  }

  const ui = {
    register(name, def) {
      if (def.root) {
        def.root.classList.add('screen');
        def.root.hidden = true;
        if (!def.root.parentNode) host.appendChild(def.root);
      }
      screens.set(name, { closable: true, overlay: false, ...def });
    },
    has(name) { return screens.has(name); },
    isOpen(name) { return name ? stack.includes(name) : stack.length > 0; },
    get top() { return stack[stack.length - 1] || null; },

    open(name, data = {}) {
      const s = screens.get(name);
      if (!s) { console.warn(`[ui] unknown screen "${name}"`); return false; }
      const at = stack.indexOf(name);
      if (at >= 0) stack.splice(at, 1);
      else if (!s.overlay) { while (stack.length) hide(stack.pop()); }
      stack.push(name);
      if (s.root) s.root.hidden = false;
      sync();
      try { s.open?.(data); } catch (err) { console.error(`[ui] ${name}.open threw`, err); }
      bus.emit('ui:open', { name, data });
      return true;
    },
    /** Close a named screen, or the top one. */
    close(name) {
      const target = name || ui.top;
      const at = stack.indexOf(target);
      if (at < 0) return;
      stack.splice(at, 1);
      hide(target);
      sync();
    },
    closeAll() { while (stack.length) hide(stack.pop()); sync(); },
    toggle(name, data) { if (ui.isOpen(name)) ui.close(name); else ui.open(name, data); },
  };

  for (const action of SCREEN_ACTIONS) {
    bus.on('action:' + action, () => {
      if (state.mode === 'boot') return;
      if (action === 'escape') {
        const top = screens.get(ui.top);
        if (top) { if (top.closable) ui.close(); }
        else ui.open('menu', { tab: 'character' });
        return;
      }
      if (state.mode === 'mainmenu') return;
      const top = screens.get(ui.top);
      if (top && !top.closable) return;
      const [name, data] = ACTION_SCREENS[action];
      // Pressing the same key again closes the screen it opened.
      if (ui.top === name && !(name === 'menu' && data.tab !== lastMenuTab)) { ui.close(name); return; }
      lastMenuTab = data.tab;
      ui.open(name, data);
    });
  }
  let lastMenuTab = null;

  // Losing pointer lock during play (the browser's own Esc) pauses into the menu.
  bus.on('pointerlock', ({ locked }) => {
    if (!locked && !input.noLock && state.mode === 'play' && screens.has('menu')) {
      ui.open('menu', { tab: 'character' });
    }
  });

  return ui;
}
