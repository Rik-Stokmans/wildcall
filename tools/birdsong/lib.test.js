// node --test tools/birdsong/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLicence, licenceAllowed, licenceFlags, parseTypes, typeFit, parseLength, scoreCandidate,
  selectForSpecies, frameLevels, chooseWindow, buildManifest, creditsMarkdown, outputPath, stripHtml,
} from './lib.mjs';

test('licences: CC family, public domain, and what is usable', () => {
  const by = parseLicence('https://creativecommons.org/licenses/by/4.0/');
  assert.equal(by.name, 'CC BY 4.0'); assert.equal(by.usable, true); assert.equal(by.nc, false);
  const sa = parseLicence('CC BY-SA 3.0');
  assert.equal(sa.sa, true); assert.equal(sa.url, 'https://creativecommons.org/licenses/by-sa/3.0/');
  const nc = parseLicence('//creativecommons.org/licenses/by-nc-sa/4.0/');
  assert.equal(nc.nc, true); assert.equal(nc.sa, true); assert.equal(nc.name, 'CC BY-NC-SA 4.0');
  assert.equal(parseLicence('https://creativecommons.org/licenses/by-nc-nd/4.0/').usable, false, 'no derivatives: never usable');
  assert.equal(parseLicence('CC0').code, 'cc0');
  assert.equal(parseLicence('https://creativecommons.org/publicdomain/zero/1.0/').code, 'cc0');
  assert.equal(parseLicence('Public domain').code, 'pd');
  assert.equal(parseLicence('All rights reserved'), null);
  assert.equal(parseLicence(''), null);
  assert.equal(licenceAllowed(by), true);
  assert.equal(licenceAllowed(nc), false);
  assert.equal(licenceAllowed(nc, { allowNc: true }), true);
  assert.equal(licenceAllowed(parseLicence('CC BY-ND 4.0'), { allowNc: true }), false);
  assert.equal(licenceAllowed(null), false);
  assert.deepEqual(licenceFlags(nc), ['NON-COMMERCIAL', 'SHARE-ALIKE']);
  assert.deepEqual(licenceFlags(by), []);
});

test('types: tokens and fit to the game call kinds', () => {
  assert.deepEqual(parseTypes('Song, Call and alarm call'), ['song', 'call', 'alarm call']);
  assert.ok(typeFit(['song'], 'song') > typeFit(['song', 'call'], 'song'));
  assert.equal(typeFit(['call'], 'song'), 0);
  assert.equal(typeFit(['song', 'begging call'], 'song'), 0);
  assert.ok(typeFit(['alarm call'], 'alarm') > 0);
  assert.ok(typeFit(['drumming'], 'drum') > 0);
  assert.ok(typeFit(['song'], 'boom') > 0, 'booming is catalogued as song');
  assert.equal(typeFit([], 'song'), 0);
  assert.equal(parseLength('4:08'), 248);
  assert.equal(parseLength('0:07'), 7);
  assert.equal(parseLength('1:02:03'), 3723);
  assert.ok(Number.isNaN(parseLength('abc')));
});

const lic = (s) => parseLicence(s);
const cand = (key, over = {}) => ({ key, licence: lic('CC BY 4.0'), types: ['song'], length: 10, size: 150000, ...over });

test('scoring: prefers rated, short, clean, permissive; refuses playback, nc, bad length', () => {
  const base = scoreCandidate(cand('a'), 'song');
  assert.ok(base > 0);
  assert.ok(scoreCandidate(cand('a', { quality: 'A' }), 'song') > scoreCandidate(cand('a', { quality: 'D' }), 'song'));
  assert.ok(scoreCandidate(cand('a', { length: 8 }), 'song') > scoreCandidate(cand('a', { length: 150 }), 'song'));
  assert.ok(scoreCandidate(cand('a', { remarks: 'heavy rain and traffic' }), 'song') < base);
  assert.ok(scoreCandidate(cand('a', { also: ['Parus major'] }), 'song') < base);
  assert.ok(scoreCandidate(cand('a', { licence: lic('CC0') }), 'song') > base);
  assert.ok(scoreCandidate(cand('a', { licence: lic('CC BY-SA 4.0') }), 'song') < base);
  assert.equal(scoreCandidate(cand('a', { playback: true }), 'song'), null);
  assert.equal(scoreCandidate(cand('a', { licence: lic('CC BY-NC 4.0') }), 'song'), null);
  assert.ok(scoreCandidate(cand('a', { licence: lic('CC BY-NC 4.0') }), 'song', { allowNc: true }) != null);
  assert.equal(scoreCandidate(cand('a', { length: 0.5 }), 'song'), null);
  assert.equal(scoreCandidate(cand('a', { size: 6e6 }), 'song'), null);
  assert.equal(scoreCandidate(cand('a'), 'alarm'), null);
});

test('selection: best per call, a recording is used once per species, gaps are reported', () => {
  const sp = { id: 'x', calls: [{ index: 0, kind: 'song' }, { index: 1, kind: 'call' }, { index: 2, kind: 'call' }, { index: 3, kind: 'alarm' }] };
  const cands = [
    cand('s1', { quality: 'A' }), cand('s2', { quality: 'B' }), cand('s3', { quality: 'C' }), cand('s4', { quality: 'D' }),
    cand('c1', { types: ['call'], quality: 'A' }), cand('c2', { types: ['call'], quality: 'B' }),
    cand('c3', { types: ['call'], quality: 'C' }), cand('n1', { types: ['call'], licence: lic('CC BY-NC 4.0') }),
  ];
  const r = selectForSpecies(sp, cands, { per: 2 });
  assert.deepEqual(r[0].picks.map((p) => p.key), ['s1', 's2']);
  assert.deepEqual(r[0].alternates.map((p) => p.key), ['s3', 's4']);
  assert.deepEqual(r[1].picks.map((p) => p.key), ['c1', 'c2']);
  assert.deepEqual(r[2].picks.map((p) => p.key), ['c3'], 'the second call of a kind gets different takes');
  assert.equal(r[3].picks.length, 0);
  assert.match(r[3].reason, /alarm/);
  assert.match(selectForSpecies(sp, [], {})[0].reason, /no recordings/);
});

function synth(sr, seconds, bursts, noise = 0.002) {
  const x = new Float32Array(Math.round(sr * seconds));
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
  for (let i = 0; i < x.length; i++) x[i] = noise * rnd();
  for (const [t0, t1, amp] of bursts) {
    for (let i = Math.round(t0 * sr); i < Math.min(x.length, Math.round(t1 * sr)); i++) x[i] += amp * Math.sin((2 * Math.PI * 3000 * i) / sr);
  }
  return x;
}

test('trim window: centres on the loudest vocalisation, respects min and max', () => {
  const sr = 16000;
  // A quiet chirp early, the real song 20-25 s, nothing else.
  const x = synth(sr, 40, [[3, 3.4, 0.03], [20, 24, 0.5]]);
  const lv = frameLevels(x, sr, 0.05);
  const w = chooseWindow(lv, { min: 3, max: 10 });
  assert.ok(w.start < 20 && w.start + w.dur > 24, `window ${w.start}..${w.start + w.dur} covers the song`);
  assert.ok(w.dur >= 3 && w.dur <= 10);
  assert.ok(w.start > 15 && w.start + w.dur < 30, 'and does not wander off');
  assert.ok(w.snr > 25, 'clear signal above the floor');

  // A very short call is padded to the minimum length around it.
  const y = synth(sr, 30, [[12, 12.2, 0.5]]);
  const wy = chooseWindow(frameLevels(y, sr, 0.05), { min: 3, max: 5 });
  assert.ok(wy.dur >= 3 - 1e-6 && wy.start < 12 && wy.start + wy.dur > 12.2);

  // A very long song is cut to max seconds where the energy is.
  const z = synth(sr, 60, [[10, 50, 0.4]]);
  const wz = chooseWindow(frameLevels(z, sr, 0.05), { min: 3, max: 8 });
  assert.ok(wz.dur <= 8 + 1e-6 && wz.start >= 9 && wz.start + wz.dur <= 51);

  // Near the file's edge the window stays inside the file.
  const e = synth(sr, 8, [[7.5, 7.9, 0.5]]);
  const we = chooseWindow(frameLevels(e, sr, 0.05), { min: 3, max: 5 });
  assert.ok(we.start >= 0 && we.start + we.dur <= 8 + 1e-6);
  // Pure noise: still a valid window, low SNR reported.
  const n = synth(sr, 10, [], 0.05);
  const wn = chooseWindow(frameLevels(n, sr, 0.05), { min: 3, max: 5 });
  assert.ok(wn.dur >= 3 && wn.snr < 12);
  // Tiny input does not throw.
  assert.ok(chooseWindow(new Float32Array(1), {}).dur >= 0);
});

test('manifest and credits', () => {
  const files = [
    { species: 'european_robin', callIndex: 0, file: outputPath('european_robin', 0, 'song', 1), dur: 6.2041, credit: { kind: 'song', recordist: 'A. Person', licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', source: 'xeno-canto', url: 'https://xeno-canto.org/1', nc: false, sa: true } },
    { species: 'european_robin', callIndex: 0, file: outputPath('european_robin', 0, 'song', 2), dur: 5, credit: { kind: 'song', recordist: 'B', licence: 'CC BY 4.0', licenceUrl: 'u', source: 'xeno-canto', url: 'https://xeno-canto.org/2' } },
    { species: 'mallard', callIndex: 1, file: outputPath('mallard', 1, 'call', 1), dur: 3, credit: { kind: 'call', recordist: 'C', licence: 'CC BY-NC 4.0', licenceUrl: 'n', nc: true, source: 'x', url: 'y' } },
  ];
  assert.equal(files[0].file, 'european_robin/0-song-1.ogg');
  const m = buildManifest(files);
  assert.deepEqual(m.species.european_robin[0], [{ file: 'european_robin/0-song-1.ogg', dur: 6.204, gain: 1 }, { file: 'european_robin/0-song-2.ogg', dur: 5, gain: 1 }]);
  assert.equal(m.species.mallard[1].length, 1);
  assert.equal(m.credits.length, 3);
  assert.equal(m.credits[0].recordist, 'A. Person');
  const md = creditsMarkdown(files, { european_robin: 'European Robin', mallard: 'Mallard' });
  assert.equal(md.split('\n').filter((l) => l.startsWith('- `')).length, 3, 'one line per file');
  assert.match(md, /european_robin\/0-song-1\.ogg.*A\. Person.*CC BY-SA 4\.0.*xeno-canto\.org\/1/);
  assert.match(md, /Non-commercial recordings are included/);
  assert.equal(stripHtml('<a href="x">Jan &amp; Piet</a><br/>  ok'), 'Jan & Piet ok');
});
