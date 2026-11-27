// Pure content for the equipment key legend (module toolkeys). No DOM.
//
// Every key label comes from the pinned key map (core/input.js KEYMAP); every verb
// describes what web/js/player/tools.js really does with that button for the tool and
// state in hand:
//  - binoculars / camera: RMB held raises (stepRaise); the wheel zooms only once the
//    optic is at least partly raised; binocular LMB held while raised = held breath
//    (breathFactor); camera LMB while raised shoots, held = burst at camBurst.
//  - recorder: LMB toggles recording (refused without an audio device).
//  - a tool key pressed again, or 4 / `, puts the tool away.
import { KEYMAP } from '../../core/input.js';

const CODE_NAMES = {
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
  AltLeft: 'Alt', Space: 'Space', Tab: 'Tab', Escape: 'Esc', Backquote: '`', Enter: 'Enter',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};

/** Human label for a KeyboardEvent.code. */
export function codeLabel(code) {
  if (typeof code !== 'string' || !code) return '';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return CODE_NAMES[code] || code;
}

/** All labels bound to an action, in key-map order, without duplicates. */
export function keysFor(action, keymap = KEYMAP) {
  const out = [];
  for (const [code, a] of Object.entries(keymap || {})) {
    if (a !== action) continue;
    const l = codeLabel(code);
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}

/** The label to print on a keycap: a letter or digit key when one is bound
 *  (crouch is Ctrl and C: show C), else the first binding. '' if unbound. */
export function primaryKey(action, keymap = KEYMAP) {
  let first = '';
  for (const [code, a] of Object.entries(keymap || {})) {
    if (a !== action) continue;
    if (code.startsWith('Key') || code.startsWith('Digit')) return codeLabel(code);
    if (!first) first = codeLabel(code);
  }
  return first;
}

// ---------------------------------------------------------------------------------
// Legend model
//
// A row: { keys: [cap], verb, short, hold?, release?, dim?, minor? (hidden while resting) }
// A cap: { k: 'key', label } | { k: 'mouse', button: 'left' | 'right' | 'wheel' | 'move' }

const key = (action, km) => ({ k: 'key', label: primaryKey(action, km), action });
const mouse = (button) => ({ k: 'mouse', button });

export const TOOL_NAMES = Object.freeze({ binoculars: 'Binoculars', camera: 'Camera', recorder: 'Recorder', none: 'Hands free' });
export const TOOL_SLOT = Object.freeze({ binoculars: 'optics', camera: 'camera', recorder: 'audio' });
export const EMPTY_TEXT = Object.freeze({
  binoculars: 'No binoculars equipped',
  camera: 'No camera equipped',
  recorder: 'No recorder equipped',
});

const OPTICS = new Set(['binoculars', 'camera']);

/** Normalise the inputs the legend depends on (all plain data). */
export function legendInput(s = {}) {
  const tool = ['binoculars', 'camera', 'recorder'].includes(s.tool) ? s.tool : 'none';
  const equipped = s.equipped || {};
  const film = s.film && typeof s.film === 'object' ? s.film : null;
  return {
    tool,
    raised: OPTICS.has(tool) && !!s.raised,
    recording: tool === 'recorder' && !!s.recording,
    has: {
      binoculars: !!equipped.optics,
      camera: !!equipped.camera,
      recorder: !!equipped.audio,
    },
    seed: !!s.seed,
    filmLeft: film ? Math.max(0, (Number(film.cap) || 0) - (Number(film.used) || 0)) : null,
    filmCap: film ? Math.max(0, Number(film.cap) || 0) : 0,
  };
}

function filmNote(i) {
  if (i.filmLeft == null) return '';
  if (i.filmLeft <= 0) return 'Out of film';
  return i.filmLeft === 1 ? '1 frame left' : `${i.filmLeft} frames left`;
}

/**
 * The legend for the equipment in hand.
 * @param {object} s {tool, raised, recording, equipped: profile.equipped, seed: carries seed_mix, film: profile.film}
 * @returns {{tool, state, title, note, empty, rows, quiet, layout}}
 *   state  'free' | 'lowered' | 'raised' | 'idle' | 'recording' | 'empty'
 *   layout 'grid' (two columns) | 'list'
 */
export function legendFor(s, km = KEYMAP) {
  const i = legendInput(s);
  const out = { tool: i.tool, state: '', title: TOOL_NAMES[i.tool], note: '', empty: '', rows: [], quiet: [], layout: 'list' };

  if (i.tool === 'none') {
    out.state = 'free';
    out.layout = 'grid';
    for (const [tool, action] of [['binoculars', 'tool-binoculars'], ['camera', 'tool-camera'], ['recorder', 'tool-recorder']]) {
      out.rows.push(i.has[tool]
        ? { keys: [key(action, km)], verb: TOOL_NAMES[tool], short: TOOL_NAMES[tool] }
        : { keys: [key(action, km)], verb: EMPTY_TEXT[tool], short: EMPTY_TEXT[tool], dim: true });
    }
    out.rows.push({ keys: [key('focus', km)], verb: 'Listen closely', short: 'Listen', hold: true });
    // minor rows fold away in the resting state (the tool keys and F stay).
    out.rows.push({ keys: [key('interact', km)], verb: 'Interact', short: 'Interact', minor: true });
    out.rows.push({ keys: [key('crouch', km)], verb: 'Crouch', short: 'Crouch', minor: true });
    out.rows.push({ keys: [key('prone', km)], verb: 'Lie down', short: 'Lie down', minor: true });
    out.rows.push({ keys: [key('sit', km)], verb: 'Sit and wait', short: 'Sit', minor: true });
  } else if (!i.has[i.tool]) {
    // tools.js refuses to select an instrument whose slot is empty and puts it away
    // when it is unequipped; should the legend ever see it, say so instead of keys.
    out.state = 'empty';
    out.empty = EMPTY_TEXT[i.tool];
    out.note = 'Choose one in Equipment';
  } else if (i.tool === 'binoculars') {
    if (!i.raised) {
      out.state = 'lowered';
      out.rows.push({ keys: [mouse('right')], verb: 'Raise to your eyes', short: 'Raise', hold: true });
    } else {
      out.state = 'raised';
      out.rows.push({ keys: [mouse('wheel')], verb: 'Zoom', short: 'Zoom' });
      out.rows.push({ keys: [mouse('left')], verb: 'Hold breath to steady', short: 'Steady', hold: true });
      out.rows.push({ keys: [key('identify', km)], verb: 'Identify the bird you are watching', short: 'Identify' });
      out.rows.push({ keys: [mouse('right')], verb: 'Lower', short: 'Lower', release: true });
    }
  } else if (i.tool === 'camera') {
    out.note = filmNote(i);
    if (!i.raised) {
      out.state = 'lowered';
      out.rows.push({ keys: [mouse('right')], verb: 'Raise to aim', short: 'Aim', hold: true });
    } else {
      out.state = 'raised';
      out.rows.push(i.filmLeft === 0
        ? { keys: [mouse('left')], verb: 'Out of film: load a roll or develop at the cabin', short: 'Out of film', dim: true }
        : { keys: [mouse('left')], verb: 'Take a photo · hold for a burst', short: 'Photo · hold for burst' });
      out.rows.push({ keys: [mouse('wheel')], verb: 'Zoom', short: 'Zoom' });
      out.rows.push({ keys: [mouse('right')], verb: 'Lower', short: 'Lower', release: true });
    }
  } else {
    out.state = i.recording ? 'recording' : 'idle';
    out.rows.push({ keys: [mouse('left')], verb: i.recording ? 'Stop recording' : 'Start recording', short: i.recording ? 'Stop' : 'Record' });
    out.rows.push({ keys: [mouse('move')], verb: 'Point it at the singer', short: 'Aim' });
    out.rows.push({ keys: [key('focus', km)], verb: 'Listen closely', short: 'Listen', hold: true });
  }

  // The second, quieter line: always-available field keys.
  if (i.seed) out.quiet.push({ keys: [key('seed', km)], verb: 'Scatter seed', short: 'Seed' });
  out.quiet.push({ keys: [key('note', km)], verb: 'Field note', short: 'Note' });
  out.quiet.push({ keys: [key('journal', km)], verb: 'Journal', short: 'Journal' });
  out.quiet.push({ keys: [key('map', km)], verb: 'Map', short: 'Map' });
  out.quiet.push({ keys: [key('menu', km)], verb: 'Menu', short: 'Menu' });
  if (i.tool !== 'none') out.quiet.push({ keys: [key('tool-none', km)], verb: 'Put away', short: 'Put away' });
  return out;
}

/** The minimal one-line form used while an optic is fully raised. */
export function lineFor(legend) {
  const parts = legend.rows.map((r) => ({ keys: r.keys, verb: r.short || r.verb, hold: !!r.hold, release: !!r.release, dim: !!r.dim }));
  return { parts, note: legend.note || '' };
}

/** A stable string for "did the content change?" (DOM is rebuilt only then). */
export function legendSignature(legend) {
  const cap = (c) => (c.k === 'key' ? c.label : '@' + c.button);
  const row = (r) => r.keys.map(cap).join('+') + '=' + r.verb + (r.hold ? '/h' : '') + (r.release ? '/r' : '') + (r.dim ? '/d' : '');
  return [legend.tool, legend.state, legend.note, legend.empty, legend.rows.map(row).join(','), legend.quiet.map(row).join(',')].join('|');
}

// ---------------------------------------------------------------------------------
// The full reference card (settings controls tab, tutorial)

/**
 * Grouped list of every equipment and field control.
 * @returns {Array<{id, title, icon, rows: Array<{keys: cap[], alt?: cap[], verb, hold?, release?}>}>}
 */
export function referenceGroups(km = KEYMAP) {
  const keys = (action) => keysFor(action, km).map((label) => ({ k: 'key', label, action }));
  const one = (action) => [key(action, km)];
  return [
    {
      id: 'movement', title: 'Movement', icon: 'footprint', rows: [
        { keys: [key('forward', km), key('left', km), key('back', km), key('right', km)], verb: 'Walk (or the arrow keys)' },
        { keys: one('run'), verb: 'Run · double-tap and hold to sprint', hold: true },
        { keys: keys('crouch'), verb: 'Crouch', alt: true },
        { keys: one('prone'), verb: 'Lie down · move to crawl' },
        { keys: one('sit'), verb: 'Sit and wait' },
        { keys: one('jump'), verb: 'Jump' },
      ],
    },
    {
      id: 'senses', title: 'Senses', icon: 'ear', rows: [
        { keys: [mouse('move')], verb: 'Look around' },
        { keys: one('focus'), verb: 'Listen closely', hold: true },
        { keys: one('follow'), verb: 'Follow the voice you are facing · again to let go' }, // [soundring hook]
      ],
    },
    {
      id: 'optics', title: 'Binoculars', icon: 'binoculars', rows: [
        { keys: one('tool-binoculars'), verb: 'Take out / put away' },
        { keys: [mouse('right')], verb: 'Raise to your eyes', hold: true },
        { keys: [mouse('wheel')], verb: 'Zoom (while raised)' },
        { keys: [mouse('left')], verb: 'Hold breath to steady', hold: true },
        { keys: one('identify'), verb: 'Identify the bird you are watching' },
      ],
    },
    {
      id: 'camera', title: 'Camera', icon: 'camera', rows: [
        { keys: one('tool-camera'), verb: 'Take out / put away' },
        { keys: [mouse('right')], verb: 'Raise to aim', hold: true },
        { keys: [mouse('left')], verb: 'Take a photo · hold for a burst' },
        { keys: [mouse('wheel')], verb: 'Zoom (while raised)' },
      ],
    },
    {
      id: 'recorder', title: 'Recorder', icon: 'recorder', rows: [
        { keys: one('tool-recorder'), verb: 'Take out / put away' },
        { keys: [mouse('left')], verb: 'Start / stop recording' },
        { keys: [mouse('move')], verb: 'Point it at the singer' },
      ],
    },
    {
      id: 'field', title: 'Field actions', icon: 'leaf', rows: [
        { keys: one('interact'), verb: 'Interact' },
        { keys: one('seed'), verb: 'Scatter seed mix' },
        { keys: one('note'), verb: 'Jot a field note' },
        { keys: keys('tool-none'), verb: 'Put the tool away', alt: true },
      ],
    },
    {
      id: 'screens', title: 'Screens', icon: 'journal', rows: [
        { keys: one('menu'), verb: 'Menu' },
        { keys: one('journal'), verb: 'Journal' },
        { keys: one('map'), verb: 'Map' },
        { keys: one('quests'), verb: 'Quests' },
        { keys: one('skills'), verb: 'Skills' },
        { keys: one('inventory'), verb: 'Inventory' },
        { keys: one('collection'), verb: 'Collection' },
        { keys: one('escape'), verb: 'Close / pause' },
      ],
    },
  ];
}
