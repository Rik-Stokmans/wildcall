// Keyboard / mouse input. Translates physical keys into named actions (the table below
// is the pinned control scheme — docs/contract.md §Controls), tracks held state, and
// manages pointer lock. Gameplay input is only delivered while state.mode === 'play'.
//
// Bus events:
//   'action:<name>'      a bound key was pressed (gameplay actions only in 'play' mode;
//                        screen actions also in 'ui' mode)
//   'action-up:<name>'   it was released
//   'mouse:down' {button} / 'mouse:up' {button}     (play mode only; 0 = left, 2 = right)
//   'mouse:wheel' {dy}                               (play mode only)
//   'pointerlock' {locked}

export const KEYMAP = {
  // movement
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'run', ShiftRight: 'run',      // hold = run; double-tap and hold = sprint
  ControlLeft: 'crouch', KeyC: 'crouch',    // toggle
  Space: 'jump',
  KeyX: 'sit',                              // toggle: settle down and wait
  KeyZ: 'prone',                            // toggle: lie down flat; move to crawl
  // field actions
  KeyE: 'interact',                         // also opens the inventory when there is nothing to interact with
  KeyF: 'focus',                            // hold: focused listening
  KeyQ: 'follow',                           // follow one voice: the sound you are facing (again to let go)
  KeyT: 'identify',                         // open identification for the bird under observation
  KeyG: 'seed',                             // scatter seed mix (supply)
  KeyN: 'note',                             // jot a field note
  Digit1: 'tool-binoculars',
  Digit2: 'tool-camera',
  Digit3: 'tool-recorder',
  Digit4: 'tool-none', Backquote: 'tool-none',
  // screens (handled by core/ui.js)
  Tab: 'menu',
  KeyJ: 'journal',
  KeyM: 'map',
  KeyL: 'quests',
  KeyK: 'skills',
  KeyI: 'inventory',
  KeyO: 'collection',
  Escape: 'escape',
};

/** Actions that open screens; they also fire while a screen is open. */
export const SCREEN_ACTIONS = new Set(['menu', 'journal', 'map', 'quests', 'skills', 'inventory', 'collection', 'escape']);

export function createInput(bus, state, canvas) {
  const held = new Set();
  let dx = 0, dy = 0;
  let locked = false;
  let dragging = false;
  // ?nolock=1 disables pointer lock: hold the left mouse button and drag to look.
  const noLock = new URLSearchParams(location.search).has('nolock');

  const typing = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };

  window.addEventListener('keydown', (e) => {
    if (typing(e)) { if (e.code === 'Escape') e.target.blur(); return; }
    const action = KEYMAP[e.code];
    if (!action) return;
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    const isScreen = SCREEN_ACTIONS.has(action);
    if (state.mode === 'play' || (isScreen && (state.mode === 'ui' || state.mode === 'mainmenu'))) {
      if (state.mode === 'play') held.add(action);
      bus.emit('action:' + action, { code: e.code });
    } else if (state.mode === 'ui' && action === 'interact') {
      // E also closes the inventory it opened (see core/ui.js); gameplay never sees this.
      bus.emit('ui:key', { action, code: e.code });
    }
  });
  window.addEventListener('keyup', (e) => {
    const action = KEYMAP[e.code];
    if (!action) return;
    if (held.delete(action)) bus.emit('action-up:' + action, { code: e.code });
  });
  window.addEventListener('blur', () => releaseAll());

  function releaseAll() {
    for (const a of [...held]) { held.delete(a); bus.emit('action-up:' + a, {}); }
    dragging = false;
  }
  bus.on('mode', ({ mode }) => {
    if (mode !== 'play') {
      releaseAll();
      if (document.pointerLockElement) document.exitPointerLock();
    }
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (state.mode !== 'play') return;
    if (!noLock && !locked) { input.lock(); return; }   // first click only captures the mouse
    if (noLock && e.button === 0 && !e.shiftKey) dragging = true;
    bus.emit('mouse:down', { button: e.button, shift: e.shiftKey });
  });
  window.addEventListener('mouseup', (e) => {
    dragging = false;
    if (state.mode === 'play') bus.emit('mouse:up', { button: e.button });
  });
  window.addEventListener('mousemove', (e) => {
    if (state.mode !== 'play') return;
    if (locked || dragging) { dx += e.movementX; dy += e.movementY; }
  });
  canvas.addEventListener('wheel', (e) => {
    if (state.mode !== 'play') return;
    e.preventDefault();
    bus.emit('mouse:wheel', { dy: e.deltaY });
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    bus.emit('pointerlock', { locked });
  });

  const input = {
    noLock,
    get locked() { return locked; },
    /** Is a gameplay action currently held? e.g. input.isDown('forward') */
    isDown(action) { return held.has(action); },
    /** Mouse movement since the last call, in pixels: {dx, dy}. Call once per frame. */
    consumeMouse() { const m = { dx, dy }; dx = 0; dy = 0; return m; },
    lock() {
      if (noLock || locked) return;
      try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    },
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); },
    /** Human label for an action's primary key, for prompts: keyLabel('interact') → "E". */
    keyLabel(action) {
      for (const [code, a] of Object.entries(KEYMAP)) {
        if (a !== action) continue;
        if (code.startsWith('Key')) return code.slice(3);
        if (code.startsWith('Digit')) return code.slice(5);
        return ({ ShiftLeft: 'Shift', ControlLeft: 'Ctrl', Space: 'Space', Tab: 'Tab', Escape: 'Esc', Backquote: '`' })[code] || code;
      }
      return '';
    },
  };
  return input;
}
