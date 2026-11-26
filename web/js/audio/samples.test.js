// Pure tests of the sample path: manifest lookup, rotation, bout fitting, LRU cache and
// lazy decoding. No Web Audio and no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest, LruCache, SampleBank, fitBout, bufferBytes, VARIATION, MANIFEST_URL } from './samples.js';
import { mulberry32 } from './rng.js';

const manifest = {
  version: 1,
  species: {
    european_robin: {
      0: [{ file: 'european_robin/0-song-1.ogg', dur: 6.2, gain: 1 }, { file: 'european_robin/0-song-2.ogg', dur: 7, gain: 0.9 }, { file: 'european_robin/0-song-3.ogg', dur: 5 }],
      2: [{ file: 'european_robin/2-alarm-1.ogg', dur: 3.1 }],
    },
    blue_tit: { 1: [{ file: '../etc/passwd', dur: 3 }, { file: '/abs.ogg' }, { file: 'https://x.test/a.ogg' }, { file: 'blue_tit/1-call-1.ogg', dur: -5, gain: 99 }] },
    broken: 'nope',
  },
  credits: [],
};

test('manifest lookup by species id and call index; unsafe entries are dropped', () => {
  const m = parseManifest(manifest);
  assert.equal(m.get('european_robin').get(0).length, 3);
  assert.equal(m.get('european_robin').get(2)[0].url, 'birdsong/european_robin/2-alarm-1.ogg');
  assert.equal(m.get('european_robin').get(1), undefined);
  const bt = m.get('blue_tit').get(1);
  assert.equal(bt.length, 1, 'path traversal, absolute and remote files are rejected');
  assert.equal(bt[0].dur, 0, 'a bad duration becomes unknown');
  assert.equal(bt[0].gain, 3, 'gain is clamped');
  assert.equal(m.has('broken'), false);
  for (const bad of [null, undefined, 5, [], {}, { species: [] }, { species: { a: { x: [{ file: 'a.ogg' }] } } }]) {
    assert.equal(parseManifest(bad).size, 0);
  }
});

function bankWith(json, extra = {}) {
  const fetched = [];
  const bank = new SampleBank({
    fetchJson: async (url) => { assert.equal(url, MANIFEST_URL); if (json === 'fail') throw new Error('404'); return json; },
    fetchBytes: async (url) => { fetched.push(url); if (extra.failUrl === url) throw new Error('404'); return new ArrayBuffer(extra.bytes ?? 400); },
    decode: async (b) => ({ length: b.byteLength * 10, numberOfChannels: 1, duration: b.byteLength / 100 }),
    maxBytes: extra.maxBytes,
  });
  return { bank, fetched };
}

test('a missing or broken manifest means no recordings, never an error', async () => {
  const { bank } = bankWith('fail');
  assert.equal(await bank.load(), 0);
  assert.equal(bank.has('european_robin', 0), false);
  assert.equal(bank.pick('european_robin', 0, 1), null);
});

test('rotation: every recording is used before one repeats, and never twice in a row', async () => {
  const { bank } = bankWith(manifest);
  await bank.load();
  assert.equal(bank.has('european_robin', 0), true);
  assert.equal(bank.has('european_robin', 1), false);
  let prev = null;
  for (let round = 0; round < 6; round++) {
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      const e = bank.pick('european_robin', 0, 1000 + round * 7 + i);
      assert.notEqual(e.file, prev, 'no immediate repeat');
      assert.ok(!seen.has(e.file), 'one full pass before repeating');
      seen.add(e.file); prev = e.file;
    }
    assert.equal(seen.size, 3);
  }
  // A call with a single recording always gets it.
  assert.equal(bank.pick('european_robin', 2, 5).file, 'european_robin/2-alarm-1.ogg');
});

test('LRU cache evicts the least recently used within the byte budget', () => {
  const c = new LruCache(100);
  c.set('a', 1, 40); c.set('b', 2, 40);
  assert.equal(c.get('a'), 1); // a is now most recent
  c.set('c', 3, 40); // 120 > 100: evicts b
  assert.equal(c.has('b'), false);
  assert.equal(c.has('a'), true);
  assert.equal(c.has('c'), true);
  assert.equal(c.bytes, 80);
  c.set('big', 9, 500); // over budget alone: kept, everything else goes
  assert.deepEqual([...c.map.keys()], ['big']);
  c.set('big', 9, 10); // replacing updates the count
  assert.equal(c.bytes, 10);
  assert.equal(bufferBytes({ length: 48000, numberOfChannels: 1 }), 192000);
});

test('the bank decodes lazily, once, and keeps decoded audio under the cache cap', async () => {
  const { bank, fetched } = bankWith(manifest, { maxBytes: 9000 }); // each buffer = 4000*4*... see decode
  await bank.load();
  const [e1, e2, e3] = bank.list('european_robin', 0);
  assert.equal(fetched.length, 0, 'nothing is fetched until a call needs it');
  assert.equal(bank.cached(e1), null);
  const [b1, b1b] = await Promise.all([bank.ensure(e1), bank.ensure(e1)]);
  assert.equal(b1, b1b);
  assert.equal(fetched.length, 1, 'concurrent requests share one fetch');
  assert.equal(bank.cached(e1), b1);
  await bank.ensure(e2); await bank.ensure(e3);
  assert.ok(bank.cache.bytes <= 9000 + bufferBytes(b1), 'cap respected');
  assert.equal(bank.cached(e1), null, 'the oldest was evicted');
  await bank.ensure(e1);
  assert.equal(fetched.length, 4, 'an evicted recording is fetched again on demand');
});

test('a recording that cannot load is skipped from then on', async () => {
  const { bank } = bankWith(manifest, { failUrl: 'birdsong/european_robin/0-song-2.ogg' });
  await bank.load();
  const e2 = bank.list('european_robin', 0)[1];
  assert.equal(await bank.ensure(e2), null);
  for (let i = 0; i < 10; i++) assert.notEqual(bank.pick('european_robin', 0, i).file, e2.file);
  const { bank: b2 } = bankWith({ species: { x: { 0: [{ file: 'x/0.ogg', dur: 3 }] } } }, { failUrl: 'birdsong/x/0.ogg' });
  await b2.load();
  await b2.ensure(b2.list('x', 0)[0]);
  assert.equal(b2.has('x', 0), false, 'with every recording failed the call falls back to synthesis');
});

const within = (x) => Math.abs(x - 1) <= VARIATION + 1e-9;

test('bout fitting: a long recording is cut at the bout end with a fade, from a small offset', () => {
  let offsets = new Set();
  for (let s = 1; s <= 20; s++) {
    const f = fitBout(10, 4, mulberry32(s), { gap: 1 });
    assert.equal(f.segments.length, 1);
    const g = f.segments[0];
    assert.equal(g.len, 4);
    assert.equal(f.duration, 4);
    assert.ok(g.fadeOut > 0.05 && g.fadeOut <= 0.8, 'graceful fade-out');
    assert.ok(g.offset >= 0 && g.offset <= 1 && g.offset + g.len <= 10);
    assert.ok(within(g.rate) && within(g.gain), 'variation is within +-2%');
    offsets.add(g.offset.toFixed(2));
  }
  assert.ok(offsets.size > 5, 'the start offset varies');
  // Little slack: no offset, the start of the vocalisation is kept.
  assert.equal(fitBout(4.5, 4, mulberry32(1)).segments[0].offset, 0);
});

test('bout fitting: a short recording loops with a natural gap and the end is faded', () => {
  const f = fitBout(2, 9, mulberry32(4), { gap: 1.2 });
  assert.ok(f.segments.length >= 3 && f.segments.length <= 5, `got ${f.segments.length}`);
  for (let i = 1; i < f.segments.length; i++) {
    const prev = f.segments[i - 1];
    const gap = f.segments[i].at - (prev.at + prev.len);
    assert.ok(gap >= 0.35 * 0.8 - 1e-9 && gap <= 2.5 * 1.2 + 1e-9, `gap ${gap}`);
  }
  const last = f.segments[f.segments.length - 1];
  assert.ok(last.at + last.len <= 9 + 1e-9);
  assert.equal(f.duration, last.at + last.len);
  for (const s of f.segments) assert.ok(within(s.rate) && within(s.gain));
  // Gaps differ between repeats (not a mechanical loop).
  const gaps = f.segments.slice(1).map((s, i) => +(s.at - f.segments[i].at).toFixed(3));
  assert.ok(new Set(gaps).size > 1);
  // A leftover less than half a take is not started.
  const g = fitBout(2, 2.3 + 0.35 * 0.8 + 0.2, mulberry32(9), { gap: 0.35 });
  assert.ok(g.segments.every((s) => s.len >= 1 - 1e-9 || s === g.segments[g.segments.length - 1]));
});

test('bout fitting: no bout length plays the whole recording once; near-equal plays whole', () => {
  const w = fitBout(6.2, 0, mulberry32(2));
  assert.equal(w.segments.length, 1);
  assert.equal(w.segments[0].len, 6.2);
  assert.equal(w.segments[0].fadeOut, 0);
  assert.equal(w.duration, 6.2);
  const n = fitBout(6, 6.3, mulberry32(2));
  assert.equal(n.segments.length, 1);
  assert.equal(n.segments[0].len, 6);
  assert.ok(fitBout(1, 1000, mulberry32(3)).segments.length <= 16, 'loops are capped');
  for (const bad of [NaN, -3, Infinity]) assert.ok(fitBout(3, bad, mulberry32(1)).duration > 0);
});
