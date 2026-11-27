import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYMAP } from '../../core/input.js';
import {
  codeLabel, keysFor, primaryKey, legendFor, legendInput, lineFor, legendSignature, referenceGroups, EMPTY_TEXT,
} from './legend.js';
import { LegendVisibility, FULL_FOR, UNSURE_AFTER, OFF_FOR } from './visibility.js';

const ALL = { optics: 'bino_basic', camera: 'cam_basic', audio: 'rec_basic' };
const caps = (row) => row.keys.map((c) => (c.k === 'key' ? c.label : '@' + c.button)).join('+');
const table = (lg) => lg.rows.map((r) => `${caps(r)} ${r.verb}${r.hold ? ' (hold)' : ''}${r.release ? ' (release)' : ''}`);

// A key map that mimics input.keyLabel's rule, for comparison.
function inputKeyLabel(action) {
  for (const [code, a] of Object.entries(KEYMAP)) if (a === action) return codeLabel(code);
  return '';
}

test('key labels come from the pinned key map', () => {
  assert.equal(codeLabel('KeyF'), 'F');
  assert.equal(codeLabel('Digit3'), '3');
  assert.equal(codeLabel('Tab'), 'Tab');
  assert.equal(codeLabel('Escape'), 'Esc');
  assert.equal(primaryKey('focus'), 'F');
  assert.equal(primaryKey('identify'), 'T');
  assert.equal(primaryKey('crouch'), 'C');        // letter preferred over Ctrl
  assert.deepEqual(keysFor('crouch'), ['Ctrl', 'C']);
  assert.deepEqual(keysFor('tool-none'), ['4', '`']);
  assert.equal(primaryKey('run'), 'Shift');
  assert.equal(primaryKey('menu'), 'Tab');
  assert.equal(primaryKey('nope'), '');
  // Where input.keyLabel already prints a letter or digit, ours agrees.
  for (const a of new Set(Object.values(KEYMAP))) {
    const l = inputKeyLabel(a);
    if (/^[A-Z0-9]$/.test(l)) assert.equal(primaryKey(a), l, a);
  }
  // A rebound map flows through.
  const km = { ...KEYMAP, KeyF: undefined, KeyQ: 'focus' };
  assert.equal(primaryKey('focus', km), 'Q');
});

test('every key cap in every legend is bound in the key map', () => {
  const tools = ['none', 'binoculars', 'camera', 'recorder'];
  for (const tool of tools) for (const raised of [false, true]) for (const recording of [false, true]) for (const seed of [false, true]) {
    const lg = legendFor({ tool, raised, recording, seed, equipped: ALL, film: { cap: 24, used: 3 } });
    for (const r of [...lg.rows, ...lg.quiet]) for (const c of r.keys) {
      if (c.k === 'key') assert.ok(c.label && keysFor(c.action).includes(c.label), `${tool}: ${c.action}`);
      else assert.ok(['left', 'right', 'wheel', 'move'].includes(c.button));
    }
  }
});

test('hands free: tool keys, listening, interact and stances', () => {
  const lg = legendFor({ tool: 'none', equipped: ALL });
  assert.equal(lg.state, 'free');
  assert.equal(lg.layout, 'grid');
  assert.deepEqual(table(lg), [
    '1 Binoculars', '2 Camera', '3 Recorder', 'F Listen closely (hold)', 'E Interact',
    'C Crouch', 'Z Lie down', 'X Sit and wait',
  ]);
  assert.deepEqual(lg.quiet.map(caps), ['N', 'J', 'M', 'Tab']); // no seed, no put-away
});

test('hands free with empty slots says so', () => {
  const lg = legendFor({ tool: 'none', equipped: { optics: 'b' } });
  assert.equal(lg.rows[0].verb, 'Binoculars');
  assert.equal(lg.rows[1].verb, EMPTY_TEXT.camera);
  assert.ok(lg.rows[1].dim);
  assert.equal(lg.rows[2].verb, 'No recorder equipped');
  const none = legendFor({ tool: 'none', equipped: null });
  assert.equal(none.rows.filter((r) => r.dim).length, 3);
});

test('binoculars lowered and raised', () => {
  const low = legendFor({ tool: 'binoculars', raised: false, equipped: ALL });
  assert.equal(low.state, 'lowered');
  assert.deepEqual(table(low), ['@right Raise to your eyes (hold)']);   // wheel and LMB do nothing lowered
  const up = legendFor({ tool: 'binoculars', raised: true, equipped: ALL });
  assert.equal(up.state, 'raised');
  assert.deepEqual(table(up), [
    '@wheel Zoom', '@left Hold breath to steady (hold)', 'T Identify the bird you are watching', '@right Lower (release)',
  ]);
  assert.deepEqual(up.quiet.map(caps), ['N', 'J', 'M', 'Tab', '4']);
});

test('camera lowered and raised, with film', () => {
  const low = legendFor({ tool: 'camera', equipped: ALL, film: { cap: 24, used: 4 } });
  assert.deepEqual(table(low), ['@right Raise to aim (hold)']);
  assert.equal(low.note, '20 frames left');
  const up = legendFor({ tool: 'camera', raised: true, equipped: ALL, film: { cap: 24, used: 23 } });
  assert.deepEqual(table(up), ['@left Take a photo · hold for a burst', '@wheel Zoom', '@right Lower (release)']);
  assert.equal(up.note, '1 frame left');
  const empty = legendFor({ tool: 'camera', raised: true, equipped: ALL, film: { cap: 24, used: 24 } });
  assert.equal(empty.note, 'Out of film');
  assert.ok(empty.rows[0].dim);
  assert.match(empty.rows[0].verb, /Out of film/);
  assert.equal(legendFor({ tool: 'camera', equipped: ALL }).note, '');      // no film info: no note
});

test('recorder idle and recording', () => {
  const idle = legendFor({ tool: 'recorder', equipped: ALL });
  assert.equal(idle.state, 'idle');
  assert.deepEqual(table(idle), ['@left Start recording', '@move Point it at the singer', 'F Listen closely (hold)']);
  const rec = legendFor({ tool: 'recorder', recording: true, raised: true, equipped: ALL });
  assert.equal(rec.state, 'recording');
  assert.equal(rec.rows[0].verb, 'Stop recording');
  assert.equal(legendInput({ tool: 'recorder', raised: true }).raised, false); // only optics raise
});

test('a tool whose slot is empty lists no keys', () => {
  for (const [tool, slot] of [['binoculars', 'optics'], ['camera', 'camera'], ['recorder', 'audio']]) {
    const eq = { ...ALL, [slot]: '' };
    const lg = legendFor({ tool, raised: true, equipped: eq });
    assert.equal(lg.state, 'empty');
    assert.equal(lg.rows.length, 0);
    assert.equal(lg.empty, EMPTY_TEXT[tool]);
  }
});

test('seed only when carried; unknown tool is hands free', () => {
  assert.equal(legendFor({ tool: 'none', seed: true, equipped: ALL }).quiet[0].verb, 'Scatter seed');
  assert.equal(legendFor({ tool: 'none', seed: true, equipped: ALL }).quiet[0].keys[0].label, 'G');
  assert.equal(legendFor({ tool: 'spoon' }).tool, 'none');
});

test('line form and signature', () => {
  const up = legendFor({ tool: 'binoculars', raised: true, equipped: ALL });
  const line = lineFor(up);
  assert.deepEqual(line.parts.map((p) => p.verb), ['Zoom', 'Steady', 'Identify', 'Lower']);
  assert.ok(line.parts[1].hold && line.parts[3].release);
  const a = legendSignature(up);
  assert.equal(a, legendSignature(legendFor({ tool: 'binoculars', raised: true, equipped: ALL })));
  assert.notEqual(a, legendSignature(legendFor({ tool: 'binoculars', raised: false, equipped: ALL })));
  const c1 = legendSignature(legendFor({ tool: 'camera', equipped: ALL, film: { cap: 24, used: 1 } }));
  const c2 = legendSignature(legendFor({ tool: 'camera', equipped: ALL, film: { cap: 24, used: 2 } }));
  assert.notEqual(c1, c2);
});

test('reference card groups cover every bound field action', () => {
  const groups = referenceGroups();
  assert.deepEqual(groups.map((g) => g.title), ['Movement', 'Senses', 'Binoculars', 'Camera', 'Recorder', 'Field actions', 'Screens']);
  const shown = new Set();
  for (const g of groups) for (const r of g.rows) for (const c of r.keys) {
    if (c.k === 'key') { assert.ok(c.label, `${g.id}: ${c.action}`); shown.add(c.action); }
  }
  for (const a of new Set(Object.values(KEYMAP))) assert.ok(shown.has(a), 'missing ' + a);
  const crouch = groups[0].rows.find((r) => r.verb === 'Crouch');
  assert.deepEqual(crouch.keys.map((c) => c.label), ['Ctrl', 'C']);
});

test('visibility: hidden outside play', () => {
  const v = new LegendVisibility();
  v.change(0);
  for (const mode of ['mainmenu', 'ui', 'boot']) assert.equal(v.view({ now: 1, mode }).show, 'hidden');
});

test('visibility: full after a change, then rest; back to full on the next change', () => {
  const v = new LegendVisibility();
  v.change(10);
  assert.deepEqual(v.view({ now: 10.1 }), { show: 'panel', strength: 'full' });
  assert.deepEqual(v.view({ now: 10 + FULL_FOR + 0.1 }), { show: 'panel', strength: 'rest' });
  v.change(30);
  assert.equal(v.view({ now: 30.5, tool: 'binoculars' }).strength, 'full');
});

test('visibility: raised optic → line; recorder stays a panel', () => {
  const v = new LegendVisibility();
  v.change(0);
  assert.equal(v.view({ now: 1, tool: 'binoculars', raised: true }).show, 'line');
  assert.equal(v.view({ now: 1, tool: 'camera', raised: true }).show, 'line');
  assert.equal(v.view({ now: 1, tool: 'recorder', raised: true }).show, 'panel');
  assert.equal(v.view({ now: 1, tool: 'camera', raised: false }).show, 'panel');
});

test('visibility: an unsure player gets the full legend again once', () => {
  const v = new LegendVisibility();
  v.change(0);
  const t = UNSURE_AFTER + 0.1;
  assert.equal(v.view({ now: FULL_FOR + 1, tool: 'camera' }).strength, 'rest');
  assert.equal(v.view({ now: t, tool: 'camera' }).strength, 'full');
  assert.equal(v.view({ now: t + FULL_FOR + 0.1, tool: 'camera' }).strength, 'rest');
  assert.equal(v.view({ now: t + 60, tool: 'camera' }).strength, 'rest'); // only once
  // Using the tool cancels it.
  const u = new LegendVisibility();
  u.change(0);
  u.used(2);
  assert.equal(u.view({ now: UNSURE_AFTER + 3, tool: 'camera' }).strength, 'rest');
  // Hands free is never "unsure".
  const n = new LegendVisibility();
  n.change(0);
  assert.equal(n.view({ now: UNSURE_AFTER + 1, tool: 'none' }).strength, 'rest');
});

test('visibility: focused listening dims; hints off shows rest briefly', () => {
  const v = new LegendVisibility();
  v.change(0);
  assert.equal(v.view({ now: 1, focus: true }).strength, 'rest');
  const off = new LegendVisibility();
  off.change(5);
  assert.deepEqual(off.view({ now: 5.5, hints: false }), { show: 'panel', strength: 'rest' });
  assert.equal(off.view({ now: 5 + OFF_FOR + 0.1, hints: false }).show, 'hidden');
  assert.equal(new LegendVisibility().view({ now: 0, hints: false }).show, 'hidden');
});

test('visibility: nextEdge points at the next timed change', () => {
  const v = new LegendVisibility();
  assert.equal(v.nextEdge(0), Infinity);
  v.change(0);
  assert.ok(Math.abs(v.nextEdge(1) - 1) < 1e-9);          // OFF_FOR edge first
  assert.ok(Math.abs(v.nextEdge(3) - (FULL_FOR - 3)) < 1e-9);
});
