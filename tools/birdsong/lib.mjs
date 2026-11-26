// Pure helpers of the birdsong fetch tool: licence rules, call-type matching,
// candidate scoring and selection, trim-window analysis, manifest and credits output.
// No network and no processes in here, so everything is unit tested (lib.test.mjs).

// ---------------------------------------------------------------------------
// Licences

/**
 * Classify a licence from a Creative Commons URL or a short name ("CC BY-SA 4.0",
 * "CC0", "Public domain"...). The game ships the recordings inside a product, so:
 *   - ND (no derivatives) is never usable: every file is trimmed and re-encoded;
 *   - NC (non-commercial) is only taken with --allow-nc and flagged everywhere;
 *   - SA (share-alike) is usable but flagged: the converted files must stay under
 *     the same licence (the credits file says so).
 * @returns {{code: string, name: string, url: string, nc: boolean, sa: boolean, nd: boolean, usable: boolean, rank: number}|null}
 */
export function parseLicence(input) {
  if (!input) return null;
  const s = String(input).trim();
  const l = s.toLowerCase();
  let code = null;
  let version = '4.0';
  const m = l.match(/creativecommons\.org\/licen[sc]es\/([a-z-]+)\/?([0-9.]*)/);
  if (m) { code = m[1]; if (m[2]) version = m[2]; }
  else if (/publicdomain\/zero|^cc0|cc[- ]?zero|cc0/.test(l)) code = 'zero';
  else if (/public domain|^pd\b|pd-/.test(l)) code = 'pd';
  else {
    const n = l.match(/^cc[- ]by((?:[- ](?:nc|sa|nd))*)[- ]?([0-9.]*)/);
    if (n) {
      code = 'by' + n[1].replace(/ /g, '-');
      if (n[2]) version = n[2];
    }
  }
  if (!code) return null;
  if (code === 'zero' || code === 'pd') {
    const zero = code === 'zero';
    return {
      code: zero ? 'cc0' : 'pd', name: zero ? 'CC0 1.0' : 'Public domain',
      url: zero ? 'https://creativecommons.org/publicdomain/zero/1.0/' : 'https://creativecommons.org/publicdomain/mark/1.0/',
      nc: false, sa: false, nd: false, usable: true, rank: 3,
    };
  }
  const parts = code.split('-');
  if (parts[0] !== 'by') return null;
  const nc = parts.includes('nc'), sa = parts.includes('sa'), nd = parts.includes('nd');
  return {
    code: parts.join('-'),
    name: `CC ${parts.map((p) => p.toUpperCase()).join('-')} ${version}`,
    url: `https://creativecommons.org/licenses/${parts.join('-')}/${version}/`,
    nc, sa, nd, usable: !nd,
    rank: nd ? -100 : nc ? -5 : sa ? 0 : 2,
  };
}

/** Is this licence acceptable under the options? */
export function licenceAllowed(lic, { allowNc = false } = {}) {
  if (!lic || !lic.usable) return false;
  if (lic.nc && !allowNc) return false;
  return true;
}

/** Warning flags a licence carries, for the plan. */
export function licenceFlags(lic) {
  const f = [];
  if (lic?.nc) f.push('NON-COMMERCIAL');
  if (lic?.sa) f.push('SHARE-ALIKE');
  return f;
}

// ---------------------------------------------------------------------------
// Call types

/** Split a recording's type string ("song, call, nocturnal flight call") into tokens. */
export function parseTypes(s) {
  return String(s || '').toLowerCase().split(/[,;/]|\band\b/).map((t) => t.trim()).filter(Boolean);
}

/**
 * Which recording types stand for each of the game's call kinds, best first.
 * boom = the bittern's song; drum = woodpecker drumming (mechanical, a recording of it
 * is typically catalogued as "drumming").
 */
export const KIND_TYPES = {
  song: ['song'],
  call: ['call', 'contact call', 'flight call'],
  alarm: ['alarm call', 'mobbing call'],
  drum: ['drumming', 'drum'],
  boom: ['song', 'advertisement call'],
};

/** Trim limits per kind: the clip length (s) wanted around the vocalisation. */
export const KIND_LIMITS = {
  song: { min: 4, max: 10 },
  call: { min: 3, max: 5 },
  alarm: { min: 3, max: 6 },
  drum: { min: 3, max: 6 },
  boom: { min: 4, max: 10 },
};

/**
 * How well a recording's type tokens fit a call kind: 0 = no fit, higher is better.
 * A recording that is only the wanted type scores highest; mixed types ("song, call")
 * and unwanted extras (begging, juvenile, imitation) score lower or are rejected.
 */
export function typeFit(tokens, kind) {
  const want = KIND_TYPES[kind];
  if (!want || !tokens.length) return 0;
  if (tokens.some((t) => /begging|juvenile|imitat|mimic|subsong|dawn song|duet|female song|copulation|distress/.test(t))) return 0;
  const idx = tokens.findIndex((t) => want.includes(t));
  if (idx < 0) return 0;
  const rank = want.indexOf(tokens[idx]);
  const extra = tokens.length - 1;
  return Math.max(0.2, 1 - 0.15 * rank - 0.2 * Math.min(extra, 3));
}

// ---------------------------------------------------------------------------
// Candidates

/** "4:08" or "1:02:03" or 12.5 -> seconds. */
export function parseLength(v) {
  if (typeof v === 'number') return v;
  const parts = String(v || '').split(':').map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return NaN;
  return parts.reduce((a, p) => a * 60 + p, 0);
}

const NOISY = /\b(noise|noisy|rain|wind|windy|traffic|road|cars?|aircraft|plane|loud background|background|distant|faint|dog|church bell|cow ?bells?|crowd|insects?|frogs?|chorus|many (other )?birds)\b/i;
const CLEAN = /\b(clean|close|very close|good recording|no background|clear|isolated)\b/i;

/**
 * Score a candidate for a call kind (higher is better), or null when it must not be
 * used at all. The score combines: type fit, the archive's own quality rating where it
 * has one (xeno-canto A-E), clip length (short means a small download and little
 * background), remarks that hint at noise or a clean take, the licence and a small bonus
 * for a bird that was seen and unplayed (no playback means the bird sang naturally).
 * @param {object} c normalised candidate (see providers in fetch.mjs)
 * @param {string} kind song|call|alarm|drum|boom
 * @param {{allowNc?: boolean}} opts
 */
export function scoreCandidate(c, kind, opts = {}) {
  if (!c || !licenceAllowed(c.licence, opts)) return null;
  const fit = typeFit(c.types || [], kind);
  if (fit <= 0) return null;
  if (c.playback === true) return null; // playback was used: the bird was provoked
  const len = c.length;
  if (!(len >= 1.5)) return null;
  if (c.size && c.size > 5 * 1024 * 1024) return null;
  let s = fit * 40;
  const q = { A: 30, B: 20, C: 8, D: 0, E: -10 }[c.quality];
  s += q ?? 12; // unrated (a mirror without the rating): assume middling
  // Short clips: less to download, less background; very short ones may hold nothing.
  if (len <= 12) s += 12;
  else if (len <= 30) s += 8;
  else if (len <= 60) s += 3;
  else s -= Math.min(18, (len - 60) / 6); // long takes: bigger download, more background
  if (len < 2.5) s -= 6;
  if (c.size) s -= Math.min(10, (c.size / (1024 * 1024)) * 2);
  const remarks = c.remarks || '';
  if (NOISY.test(remarks)) s -= 10;
  if (CLEAN.test(remarks)) s += 4;
  if (Array.isArray(c.also) && c.also.length) s -= Math.min(9, 3 * c.also.length);
  if (c.seen === true) s += 2;
  if (c.typeGuessed) s -= 8; // the type was read from free text, not a catalogued field
  s += (c.licence.rank || 0) * 3;
  return s;
}

/**
 * Pick recordings for every call of one species.
 * Each call index gets up to `per` recordings; a recording is used at most once per
 * species (two calls of the same kind get different takes). Calls with the same kind
 * are served in index order, so call 0 gets the best.
 * @returns {{callIndex:number, kind:string, picks: object[], alternates: object[], reason?: string}[]}
 */
export function selectForSpecies(sp, candidates, { per = 2, alternates = 3, allowNc = false } = {}) {
  const used = new Set();
  const out = [];
  for (const call of sp.calls) {
    const scored = [];
    for (const c of candidates) {
      if (used.has(c.key)) continue;
      const score = scoreCandidate(c, call.kind, { allowNc });
      if (score != null) scored.push({ ...c, score: Math.round(score * 10) / 10 });
    }
    scored.sort((a, b) => b.score - a.score || String(a.key).localeCompare(String(b.key)));
    const picks = scored.slice(0, per);
    for (const p of picks) used.add(p.key);
    const alts = scored.slice(per, per + alternates);
    out.push({
      callIndex: call.index, kind: call.kind, picks, alternates: alts,
      ...(picks.length ? {} : { reason: candidates.length ? `no ${call.kind} recording with a usable licence` : 'no recordings found' }),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trim analysis

/**
 * Short-time level in dB of mono samples: one value per hop of `hopSec`.
 * Callers feed audio already high-passed (the tool does that with ffmpeg), so rumble
 * does not count as vocalisation.
 */
export function frameLevels(samples, sampleRate, hopSec = 0.05) {
  const hop = Math.max(1, Math.round(sampleRate * hopSec));
  const n = Math.floor(samples.length / hop);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop, e = j + hop; j < e; j++) sum += samples[j] * samples[j];
    out[i] = 10 * Math.log10(sum / hop + 1e-12);
  }
  return out;
}

function percentile(arr, p) {
  const a = Array.from(arr).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
}

/**
 * Choose the part of a recording to keep: the clip around the loudest vocalisation.
 * Vocalisation = frames clearly above the noise floor. Nearby activity is merged into
 * clusters (gaps up to `gapSec`); the strongest cluster wins; the window is `min..max`
 * seconds long, centred on it (a longer cluster is cut where it holds the most energy),
 * with a little lead-in and tail.
 * @param {Float32Array} levels frame levels in dB (frameLevels)
 * @param {{hop?: number, min?: number, max?: number, gapSec?: number, pre?: number, post?: number}} o
 * @returns {{start: number, dur: number, snr: number, peakDb: number, floorDb: number}} seconds
 */
export function chooseWindow(levels, o = {}) {
  const hop = o.hop ?? 0.05;
  const min = o.min ?? 3, max = o.max ?? 10;
  const gap = Math.round((o.gapSec ?? 0.8) / hop);
  const pre = o.pre ?? 0.3, post = o.post ?? 0.5;
  const total = levels.length * hop;
  if (levels.length < 2) return { start: 0, dur: total, snr: 0, peakDb: -120, floorDb: -120 };
  const floor = percentile(levels, 0.2);
  const peak = percentile(levels, 0.98);
  const span = peak - floor;
  const thr = floor + Math.max(6, 0.4 * span);
  const act = Float32Array.from(levels, (v) => Math.max(0, v - thr));
  // Clusters of active frames.
  const clusters = [];
  let cur = null;
  for (let i = 0; i < act.length; i++) {
    if (act[i] <= 0) continue;
    if (cur && i - cur.end <= gap) { cur.end = i; cur.score += act[i]; }
    else { cur = { start: i, end: i, score: act[i] }; clusters.push(cur); }
  }
  const snr = span;
  if (!clusters.length) {
    const dur = Math.min(total, Math.max(min, Math.min(max, total)));
    return { start: Math.max(0, (total - dur) / 2), dur, snr, peakDb: peak, floorDb: floor };
  }
  // Strongest cluster; clusters close to it that fit in `max` are folded in.
  clusters.sort((a, b) => b.score - a.score);
  let c = { ...clusters[0] };
  for (const o2 of clusters.slice(1)) {
    const s = Math.min(c.start, o2.start), e = Math.max(c.end, o2.end);
    if ((e - s + 1) * hop <= max - pre - post && o2.score > 0.15 * c.score) {
      c = { start: s, end: e, score: c.score + o2.score };
    }
  }
  let s = c.start * hop - pre;
  let e = (c.end + 1) * hop + post;
  if (e - s > max) {
    // Too long: keep the stretch of `max` seconds with the most vocal energy.
    const w = Math.round(max / hop);
    let best = c.start, bestSum = -1, run = 0;
    for (let i = c.start; i < Math.min(c.start + w, act.length); i++) run += act[i];
    bestSum = run; best = c.start;
    for (let i = c.start + 1; i <= c.end; i++) {
      run += (act[i + w - 1] || 0) - act[i - 1];
      if (run > bestSum) { bestSum = run; best = i; }
    }
    s = best * hop; e = s + max;
  } else if (e - s < min) {
    const mid = (s + e) / 2;
    s = mid - min / 2; e = mid + min / 2;
  }
  // Keep the window inside the file, preserving its length where possible.
  let len = Math.min(e - s, total);
  s = Math.min(Math.max(0, s), total - len);
  return { start: round3(s), dur: round3(len), snr, peakDb: peak, floorDb: floor };
}

function round3(x) { return Math.round(x * 1000) / 1000; }

// ---------------------------------------------------------------------------
// Output files

/** File name (relative to web/birdsong/) of one converted recording. */
export function outputPath(speciesId, callIndex, kind, n) {
  return `${speciesId}/${callIndex}-${kind}-${n}.ogg`;
}

/**
 * The client manifest: {version, species: {id: {callIndex: [{file, dur, gain}]}}, credits}.
 * @param {{species: string, callIndex: number, file: string, dur: number, gain?: number, credit: object}[]} files
 */
export function buildManifest(files) {
  const species = {};
  const credits = [];
  for (const f of files) {
    const sp = (species[f.species] ??= {});
    (sp[f.callIndex] ??= []).push({ file: f.file, dur: round3(f.dur), gain: f.gain ?? 1 });
    credits.push({ file: f.file, species: f.species, call: f.callIndex, ...f.credit });
  }
  return { version: 1, species, credits };
}

/** CREDITS.md: one line per file, grouped by species. */
export function creditsMarkdown(files, speciesNames = {}) {
  const lines = [
    '# Bird recordings: credits',
    '',
    'Every bird sound in `web/birdsong/` is a trimmed, high-passed, loudness-normalised and',
    're-encoded excerpt of a recording by the person named below, used under the licence',
    'shown. Licence terms apply to these excerpts; share-alike (SA) licences require that',
    'the excerpts stay under the same licence, and attribution must be kept.',
    '',
  ];
  const nc = files.filter((f) => f.credit.nc);
  if (nc.length) {
    lines.push('> **Non-commercial recordings are included** (' + nc.length + ' files): these may not be used in a commercial release.', '');
  }
  const by = new Map();
  for (const f of files) (by.get(f.species) ?? by.set(f.species, []).get(f.species)).push(f);
  for (const id of [...by.keys()].sort()) {
    lines.push(`## ${speciesNames[id] || id}`, '');
    for (const f of by.get(id)) {
      const c = f.credit;
      const lic = c.licenceUrl ? `[${c.licence}](${c.licenceUrl})` : c.licence;
      lines.push(`- \`${f.file}\` (${c.kind}): ${speciesNames[id] || id}, recorded by ${c.recordist || 'unknown'}, ${lic}, ${c.source} <${c.url}>`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Rough size of one converted clip (mono Opus, ~48 kbps). */
export function estimateOutputBytes(durSec) { return Math.round(durSec * 6000 + 1500); }

/** Strip tags and decode a few entities (archive metadata fields contain HTML). */
export function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Human-readable bytes. */
export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
