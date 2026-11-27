// Pure: turn the pinned KEYMAP (code -> action) into a readable controls reference.
// No DOM. Unknown actions still appear (with a prettified name) so a new binding added to
// KEYMAP shows up in the menu without touching this file.

/** Display order and wording: [section, [[action, description], ...]] */
export const CONTROL_SECTIONS = [
  ['Moving', [
    ['forward', 'Walk forward'], ['back', 'Walk back'], ['left', 'Step left'], ['right', 'Step right'],
    ['run', 'Run (hold)'], ['crouch', 'Crouch (toggle)'], ['jump', 'Jump · climb a ledge'], ['sit', 'Sit and wait (toggle)'],
  ]],
  ['In the field', [
    ['interact', 'Interact / talk'], ['focus', 'Focused listening (hold)'], ['identify', 'Identify the bird you are watching'],
    ['seed', 'Scatter seed mix'], ['note', 'Jot a field note'],
    ['tool-binoculars', 'Binoculars'], ['tool-camera', 'Camera'], ['tool-recorder', 'Recorder'], ['tool-none', 'Hands free'],
  ]],
  ['Your notebook', [
    ['menu', 'Character menu'], ['journal', 'Journal'], ['map', 'Map'], ['quests', 'Quest log'],
    ['skills', 'Skills'], ['inventory', 'Inventory'], ['collection', 'Collection'], ['escape', 'Close / pause'],
  ]],
];

const MOUSE_ROWS = [
  ['Look around', 'Mouse'], ['Raise binoculars, camera or recorder', 'Hold right button'],
  ['Primary action (shutter, record)', 'Left button'], ['Zoom', 'Mouse wheel'],
];

export function keyLabel(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return ({
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
    Space: 'Space', Tab: 'Tab', Escape: 'Esc', Backquote: '`',
  })[code] || code;
}

/** action -> unique key labels in KEYMAP order, e.g. forward -> ['W', '↑']. */
export function keysByAction(keymap) {
  const out = {};
  for (const [code, action] of Object.entries(keymap || {})) {
    const l = keyLabel(code);
    (out[action] ||= []);
    if (!out[action].includes(l)) out[action].push(l);
  }
  return out;
}

/** [{title, rows:[{text, keys:[...]}]}] ready to draw. Actions missing from the table go in "Other". */
export function controlsReference(keymap) {
  const byAction = keysByAction(keymap);
  const used = new Set();
  const sections = CONTROL_SECTIONS.map(([title, rows]) => ({
    title,
    rows: rows.filter(([a]) => byAction[a]).map(([a, text]) => { used.add(a); return { text, keys: byAction[a] }; }),
  }));
  const rest = Object.keys(byAction).filter((a) => !used.has(a))
    .map((a) => ({ text: a.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase()), keys: byAction[a] }));
  if (rest.length) sections.push({ title: 'Other', rows: rest });
  sections.push({ title: 'Mouse', rows: MOUSE_ROWS.map(([text, k]) => ({ text, keys: [k] })) });
  return sections;
}
