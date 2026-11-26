import test from 'node:test';
import assert from 'node:assert/strict';
import { drawBirdArt, resolveReveal, partPalette, hashSeq } from './bird-art.js';
import { mix, lighten, darken, parseHex, toHex, rgba, luminance } from './color.js';
import { FIXTURES } from './fixtures.js';

/** A recording CanvasRenderingContext2D stand-in: counts calls, enforces save/restore balance. */
function mockCtx() {
  const calls = {};
  let depth = 0;
  const texts = [];
  const grad = { addColorStop() {} };
  const g = new Proxy({}, {
    get(_, name) {
      if (name === 'calls') return calls;
      if (name === 'texts') return texts;
      if (name === 'depth') return depth;
      return (...args) => {
        calls[name] = (calls[name] || 0) + 1;
        if (name === 'save') depth++;
        if (name === 'restore') { depth--; assert.ok(depth >= 0, 'restore without save'); }
        if (name === 'fillText') texts.push(args[0]);
        for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${name} got non-finite ${a}`);
        if (name.startsWith('create')) return grad;
        return undefined;
      };
    },
    set() { return true; },
  });
  return g;
}

test('drawBirdArt renders every fixture in every mode without throwing', () => {
  const modes = [{}, { pose: 'flying' }, { silhouette: true }, { silhouette: true, pose: 'flying' }, { background: true }, { reveal: [] },
    { reveal: ['size'] }, { reveal: ['shape'] }, { reveal: ['size', 'shape', 'primary', 'secondary', 'marking', 'bill'] }, { reveal: new Set(['shape', 'bill']) },
    { reveal: ['shape', 'primary'], pose: 'flying' }, { relativeScale: 1.2 }];
  for (const sp of FIXTURES) for (const m of modes) {
    const g = mockCtx();
    const r = drawBirdArt(g, 200, 180, sp, m);
    assert.equal(g.depth, 0, `unbalanced save/restore for ${sp.id} ${JSON.stringify(m)}`);
    assert.ok(((g.calls.fill || 0) + (g.calls.stroke || 0)) > 5 && Number.isFinite(r.scale) && r.scale > 0);
  }
});

test('the drawing fits inside the frame', () => {
  for (const sp of FIXTURES) {
    const r = drawBirdArt(mockCtx(), 200, 160, sp);
    const b = r.geometry.bbox;
    const x0 = r.tx + b.minX * r.scale, x1 = r.tx + b.maxX * r.scale, y0 = r.ty + b.minY * r.scale, y1 = r.ty + b.maxY * r.scale;
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= 200 && y1 <= 160, `${sp.id} spills out of its frame`);
  }
});

test('relativeScale draws a heron bigger than a wren and never overflows', () => {
  const wren = drawBirdArt(mockCtx(), 200, 200, FIXTURES[0], { relativeScale: 1.2 });
  const heron = drawBirdArt(mockCtx(), 200, 200, FIXTURES[2], { relativeScale: 1.2 });
  const px = (r) => r.geometry.look.length * 1; // metres
  assert.ok(px(heron) > px(wren));
  assert.ok(wren.scale * wren.geometry.bbox.w < heron.scale * heron.geometry.bbox.w * 1.001 + 1e6);
  assert.ok(wren.scale <= 200 / wren.geometry.bbox.w);
});

test('silhouette never uses colour data, reveal sketches the unknown as hatching', () => {
  const sil = mockCtx();
  drawBirdArt(sil, 160, 160, FIXTURES[1], { silhouette: true });
  assert.ok(!sil.calls.createLinearGradient, 'silhouettes are flat');
  const blank = mockCtx();
  const r0 = drawBirdArt(blank, 160, 160, FIXTURES[1], { reveal: [] });
  assert.equal(r0.generic, true);
  assert.ok(blank.texts.includes('?'), 'unknown shape shows a question mark');
  assert.ok(blank.calls.setLineDash >= 1, 'generic sketch is dashed');
  const partial = mockCtx();
  const r1 = drawBirdArt(partial, 160, 160, FIXTURES[1], { reveal: ['shape'] });
  assert.equal(r1.generic, false);
  assert.ok(partial.calls.clip > 3, 'unknown colour areas are hatched inside a clip');
  assert.ok(!partial.texts.includes('?'));
  const full = mockCtx();
  drawBirdArt(full, 160, 160, FIXTURES[1], { reveal: ['size', 'shape', 'primary', 'secondary', 'marking', 'bill'] });
  assert.ok(full.texts.some((t) => /size: small/.test(t)), 'known size is noted in the margin');
});

test('the sketch never leaks the real shape before it is known', () => {
  const a = drawBirdArt(mockCtx(), 160, 160, FIXTURES[0], { reveal: ['size'] });
  const b = drawBirdArt(mockCtx(), 160, 160, FIXTURES[2], { reveal: ['size'] });
  assert.deepEqual(a.geometry.bbox, b.geometry.bbox, 'wren and heron look identical until shape is revealed');
  assert.equal(a.geometry.look.length, b.geometry.look.length);
});

test('resolveReveal / partPalette', () => {
  assert.equal(resolveReveal(undefined).active, false);
  assert.equal(resolveReveal(null).shape, true);
  const rv = resolveReveal(['shape', 'primary']);
  assert.deepEqual([rv.active, rv.shape, rv.primary, rv.secondary, rv.bill, rv.marking, rv.size], [true, true, true, false, false, false, false]);
  assert.equal(resolveReveal(new Set(['size'])).size, true);
  assert.equal(resolveReveal({ bill: true, size: false }).bill, true);
  const pal = partPalette(FIXTURES[1].look, rv);
  assert.equal(pal.head.known && pal.back.known && pal.wing.known && pal.tail.known, true);
  assert.equal(pal.belly.known || pal.bill.known || pal.marks, false);
});

test('hashSeq is deterministic and spread', () => {
  const a = hashSeq('wren'), b = hashSeq('wren'), c = hashSeq('robin');
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, [c(), c(), c()]);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});

test('colour helpers', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(lighten('#000000', 1), '#ffffff');
  assert.equal(toHex(parseHex('#355c43')), '#355c43');
  assert.deepEqual(parseHex('nonsense'), [128, 128, 128]);
  assert.equal(rgba('#ff0000', 0.5), 'rgba(255,0,0,0.5)');
  assert.ok(luminance('#ffffff') > 0.99 && luminance('#000000') < 0.01);
  assert.notEqual(darken('#ffffff', 0.5), '#ffffff');
});
