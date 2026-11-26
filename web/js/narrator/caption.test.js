import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateDuration, balanceLines, createCaption, MAX_CHARS } from './caption.js';

test('duration grows with words and is never too short to read', () => {
  assert.equal(estimateDuration(''), 0);
  const short = estimateDuration('Hello.');
  const long = estimateDuration('That thin, hurried chirp is typical of a wren. An astonishing voice for something so small.');
  assert.ok(short >= 2.2);
  assert.ok(long > short);
  assert.ok(long > 5 && long < 12, `long line ${long}s`);
  // slower speech takes longer
  assert.ok(estimateDuration('One two three four five six seven eight nine ten eleven twelve.', 0.7) >
    estimateDuration('One two three four five six seven eight nine ten eleven twelve.', 1.2));
});

test('short lines stay on one line', () => {
  assert.deepEqual(balanceLines('A most sophisticated little song, that.'), ['A most sophisticated little song, that.']);
  assert.deepEqual(balanceLines('   '), []);
});

test('long lines wrap to the fewest balanced lines within the limit', () => {
  const text = 'There is a voice I have not heard before. A needle-thin, rattling trill, not far off, high in the canopy.';
  const lines = balanceLines(text);
  assert.equal(lines.join(' '), text);
  assert.equal(lines.length, Math.ceil(text.length / MAX_CHARS));
  for (const l of lines) assert.ok(l.length <= MAX_CHARS, `"${l}" is ${l.length} chars`);
  const lens = lines.map((l) => l.length);
  assert.ok(Math.max(...lens) - Math.min(...lens) <= 16, `unbalanced: ${lens}`);
});

test('balancing avoids a short orphan', () => {
  const text = 'Rain on the lenses, rain on everything around us. It is all a blur.';
  const lines = balanceLines(text, 60);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].length >= 20, `orphan "${lines[1]}"`);
});

test('a word longer than the limit gets its own line', () => {
  const lines = balanceLines('short ' + 'x'.repeat(70) + ' end', 60);
  assert.deepEqual(lines, ['short', 'x'.repeat(70), 'end']);
});

test('createCaption without a DOM is a harmless no-op', () => {
  const c = createCaption(null);
  c.show('Hello.');
  c.hide();
  c.clear();
});
