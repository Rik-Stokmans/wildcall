import test from 'node:test';
import assert from 'node:assert/strict';
import { abilityLines, activationLine, hasSpecial } from './itemlogic.js';

test('rare items: concrete ability lines from their modifiers', () => {
  const lens = { kind: 'gadget', special: 'Look closely.', mods: { lensInspect: 1, trackSigns: 8 } };
  const lines = abilityLines(lens);
  assert.equal(lines.length, 2);
  assert.match(lines[0].text, /feather, track or feeding sign/);
  assert.match(lines[1].text, /8 m farther/);
  assert.equal(activationLine(lens), 'Works while it is in your pack: nothing to equip.');
  assert.match(activationLine({ kind: 'equipment', slot: 'optics' }), /optics slot/);
  assert.match(activationLine({ kind: 'keepsake' }), /carry it/);
  assert.equal(activationLine(null), '');
  assert.deepEqual(abilityLines({}), []);
  assert.equal(hasSpecial(lens), true);
  assert.equal(hasSpecial({ special: '  ' }), false);
  assert.match(abilityLines({ mods: { compass: 2 } })[0].text, /places you have discovered/);
});
