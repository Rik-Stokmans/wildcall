import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYMAP } from '../../core/input.js';
import { keyLabel, keysByAction, controlsReference } from './controls.js';

test('key labels are readable', () => {
  assert.equal(keyLabel('KeyW'), 'W');
  assert.equal(keyLabel('Digit1'), '1');
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(keyLabel('Escape'), 'Esc');
});

test('actions collect all their keys, deduplicated', () => {
  const k = keysByAction(KEYMAP);
  assert.deepEqual(k.forward, ['W', '↑']);
  assert.deepEqual(k.run, ['Shift']);
  assert.deepEqual(k['tool-none'], ['4', '`']);
});

test('reference covers every KEYMAP action exactly once', () => {
  const ref = controlsReference(KEYMAP);
  const described = ref.filter((s) => s.title !== 'Mouse').flatMap((s) => s.rows);
  const actions = new Set(Object.values(KEYMAP));
  assert.equal(described.length, actions.size);
  assert.ok(ref.at(-1).title === 'Mouse');
  assert.equal(ref.find((s) => s.title === 'Other'), undefined);
});

test('unknown actions land in Other', () => {
  const ref = controlsReference({ KeyZ: 'zoom-thing' });
  assert.equal(ref.find((s) => s.title === 'Other').rows[0].text, 'Zoom thing');
});
