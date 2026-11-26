import test from 'node:test';
import assert from 'node:assert/strict';
import { ICONS, ICON_NAMES, ICON_VOCABULARY, ICON_ALIASES, iconInner, resolveIcon, svgMarkup } from './icons.js';

const vocabulary = Object.values(ICON_VOCABULARY).flatMap((s) => s.split(/\s+/)).filter(Boolean);

test('the pinned vocabulary has every group', () => {
  assert.deepEqual(Object.keys(ICON_VOCABULARY), ['tools', 'disciplines', 'progression', 'nature', 'weather', 'ui', 'poi']);
  assert.ok(vocabulary.length >= 85, `vocabulary too small: ${vocabulary.length}`);
  assert.equal(new Set(vocabulary).size, vocabulary.length, 'vocabulary has duplicates');
});

test('every vocabulary name has real path data', () => {
  for (const name of vocabulary) {
    assert.ok(ICONS[name], `missing icon: ${name}`);
    assert.match(ICONS[name], /<(path|circle|rect|ellipse)\b/, `no shapes for ${name}`);
  }
});

test('icon markup is well formed and stays inside the 24x24 grid', () => {
  for (const name of ICON_NAMES) {
    const m = ICONS[name];
    // balanced, self-closed elements only
    const tags = m.match(/<[a-z]+\b[^>]*>/g) || [];
    assert.ok(tags.every((t) => t.endsWith('/>')), `${name} has an element that is not self-closed`);
    assert.equal(m.replace(/<[a-z]+\b[^>]*\/>/g, ''), '', `${name} has stray markup`);
    for (const d of m.match(/ d="([^"]*)"/g) || []) {
      assert.doesNotMatch(d, /NaN|undefined/, `${name} path has NaN`);
      for (const n of d.match(/-?\d*\.?\d+/g) || []) assert.ok(Math.abs(+n) <= 30, `${name} coordinate out of range: ${n}`);
    }
  }
});

test('aliases resolve to real icons', () => {
  for (const [alias, target] of Object.entries(ICON_ALIASES)) {
    assert.ok(ICONS[target], `alias ${alias} → ${target} is missing`);
    assert.equal(resolveIcon(alias), target);
  }
  assert.equal(resolveIcon('Binoculars'), 'binoculars');
});

test('unknown names render a neutral dot and never throw', () => {
  for (const bad of ['nope', '', null, undefined, 42, {}, '__proto__', 'constructor', 'toString']) {
    assert.equal(resolveIcon(bad), null);
    assert.match(iconInner(bad), /^<circle cx="12" cy="12"/);
    assert.match(svgMarkup(bad, 'x'), /width="20"/);
  }
});

test('svgMarkup is a complete themed svg', () => {
  const s = svgMarkup('bird', 32);
  assert.match(s, /^<svg [^>]*viewBox="0 0 24 24"[^>]*width="32"/);
  assert.match(s, /stroke-width="1.75"/);
  assert.match(s, /stroke="currentColor"/);
  assert.ok(s.endsWith('</svg>'));
});

test('the cog has eight even teeth', () => {
  const d = /d="([^"]+)"/.exec(ICONS.settings)[1];
  assert.equal(d.split('L').length, 32); // 8 teeth x 4 points
});
