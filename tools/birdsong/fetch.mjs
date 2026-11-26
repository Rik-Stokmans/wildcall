#!/usr/bin/env node
// WILDCALL birdsong tool: finds openly licensed recordings of the game's birds, writes a
// plan for a human to approve, and (only when told to) downloads and converts them.
//
//   node tools/birdsong/fetch.mjs --plan                 # reads metadata only, downloads NO audio
//   node tools/birdsong/fetch.mjs --fetch                # downloads + converts what plan.json lists
//
// Node 22 built-ins only. ffmpeg/ffprobe are needed for --fetch (not for --plan).
// Read tools/birdsong/README.md for the full workflow, archives and licence rules.
//
// Options
//   --source auto|xeno-canto|commons   archive (default auto: xeno-canto when a key is
//                                      available, otherwise Wikimedia Commons, which needs none)
//   --allow-nc                         also accept NON-COMMERCIAL licences (flagged in the plan)
//   --per N                            recordings per call, rotated in game (default 2)
//   --species id,id                    only these species (default: all of species.json)
//   --plan-file path                   default tools/birdsong/plan.json (plan.md is written next to it)
//   --out dir                          fetch output dir (default web/birdsong)
//   --refresh                          ignore cached API answers
//   --selftest                         no network: synthesise a clip and run the trim/convert pipeline on it
//   --help
//
// xeno-canto's API v3 needs a free key (account page of a registered member with a
// verified e-mail). Give it as XC_API_KEY in the environment or in the git-ignored
// .env file at the repo root. The key is never printed or written to the plan.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  parseLicence, licenceFlags, parseTypes, parseLength, selectForSpecies, frameLevels,
  chooseWindow, KIND_LIMITS, outputPath, buildManifest, creditsMarkdown, estimateOutputBytes,
  stripHtml, fmtBytes, KIND_TYPES,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const UA = 'WildcallBirdsongTool/1.0 (open-source game asset tool; metadata and approved downloads only)';
const CACHE = path.join(HERE, '.cache');

// ---------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const o = { plan: false, fetch: false, selftest: false, source: 'auto', allowNc: false, per: 2, species: null, refresh: false, help: false,
    planFile: path.join(HERE, 'plan.json'), out: path.join(ROOT, 'web', 'birdsong') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) die(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case '--plan': o.plan = true; break;
      case '--fetch': o.fetch = true; break;
      case '--allow-nc': o.allowNc = true; break;
      case '--refresh': o.refresh = true; break;
      case '--selftest': o.selftest = true; break;
      case '--help': case '-h': o.help = true; break;
      case '--source': o.source = val(); break;
      case '--per': o.per = Math.max(1, Math.min(5, parseInt(val(), 10) || 2)); break;
      case '--species': o.species = val().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--plan-file': o.planFile = path.resolve(val()); break;
      case '--out': o.out = path.resolve(val()); break;
      default: die(`unknown option ${a} (try --help)`);
    }
  }
  if (!['auto', 'xeno-canto', 'commons'].includes(o.source)) die('--source must be auto, xeno-canto or commons');
  return o;
}

function die(msg) { console.error(`error: ${msg}`); process.exit(1); }

function usage() {
  const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const end = src.findIndex((l, i) => i > 0 && !l.startsWith('//'));
  console.log(src.slice(1, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
}

// ---------------------------------------------------------------------------
// Keys, HTTP, cache

function readEnvFile() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* no .env: fine */ }
  return out;
}

function xcKey() {
  const env = readEnvFile();
  return process.env.XC_API_KEY || process.env.XENO_CANTO_API_KEY || env.XC_API_KEY || env.XENO_CANTO_API_KEY || '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

/** Remove anything that looks like a key from text that may be printed. */
function scrub(s) { return String(s).replace(/([?&]key=)[^&\s]+/g, '$1***'); }

async function http(url, { json = true, retries = 6, minGap = 500, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = lastRequest + minGap - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*', ...headers }, redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} from ${scrub(url)}`);
        // Rate limited: honour Retry-After, else back off 4 s, 8 s, 16 s...
        const ra = parseFloat(res.headers.get('retry-after'));
        await sleep((Number.isFinite(ra) ? ra : 4 * 2 ** attempt) * 1000);
        continue;
      }
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).slice(0, 300);
        const err = new Error(`HTTP ${res.status} from ${scrub(url)} ${body}`);
        err.status = res.status;
        throw err;
      }
      return json ? await res.json() : res;
    } catch (e) {
      if (e.status) throw e;
      lastErr = e;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr || new Error(`request failed: ${scrub(url)}`);
}

/** GET JSON with an on-disk cache keyed by the URL minus the API key. */
async function cachedJson(url, opts, refresh) {
  const keyless = url.replace(/([?&]key=)[^&]+/, '$1');
  const f = path.join(CACHE, 'api', crypto.createHash('sha1').update(keyless).digest('hex') + '.json');
  if (!refresh) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* miss */ }
  }
  const data = await http(url, opts);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data));
  return data;
}

// ---------------------------------------------------------------------------
// Providers. Each returns normalised candidates:
//   {key, source, id, title, pageUrl, download, recordist, licence, types, length, quality,
//    size, sizeEstimated, remarks, also, seen, playback, typeGuessed}

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const IIPROPS = 'url|size|mime|mediatype|extmetadata';
const IIMETA = 'LicenseShortName|LicenseUrl|Artist|ImageDescription|Credit|Categories|Attribution';

function commonsCandidate(page, sci) {
  const ii = page.imageinfo?.[0];
  if (!ii || ii.mediatype !== 'AUDIO') return null;
  const m = ii.extmetadata || {};
  const cats = String(m.Categories?.value || '');
  const title = String(page.title || '').replace(/^File:/, '');
  if (!cats.includes(`Audio files of ${sci}`) && !title.toLowerCase().includes(sci.toLowerCase())) return null;
  const licence = parseLicence(m.LicenseUrl?.value) || parseLicence(m.LicenseShortName?.value);
  const descHtml = String(m.ImageDescription?.value || '');
  const typeLine = descHtml.match(/<b>Type:<\/b>\s*([^<]+)/i);
  let types = typeLine ? parseTypes(typeLine[1]) : [];
  let typeGuessed = false;
  const remarks = stripHtml(descHtml.split(/<dl>/i)[0]);
  if (!types.length) {
    const t = `${title} ${remarks}`.toLowerCase();
    const g = ['alarm call', 'drumming', 'song', 'call'].find((w) => new RegExp(`\\b${w}\\b`).test(t));
    if (g) { types = [g]; typeGuessed = true; }
  }
  const credit = String(m.Credit?.value || '');
  const xc = (credit.match(/xeno-canto\.org\/(\d+)/) || title.match(/XC(\d+)/) || [])[1];
  const seen = /bird-seen:\s*yes/i.test(descHtml) ? true : /bird-seen:\s*no/i.test(descHtml) ? false : undefined;
  const playback = /playback-used:\s*yes/i.test(descHtml) ? true : /playback-used:\s*no/i.test(descHtml) ? false : undefined;
  const artist = stripHtml(m.Artist?.value || '');
  return {
    key: `commons:${page.pageid}`, source: 'Wikimedia Commons', id: String(page.pageid),
    title, pageUrl: ii.descriptionurl, download: ii.url.replace(/\?.*$/, ''),
    recordist: artist || 'unknown', licence, types, typeGuessed,
    length: ii.duration ? +ii.duration : NaN, quality: undefined, size: ii.size, sizeEstimated: false,
    remarks, seen, playback, original: xc ? { name: 'xeno-canto', id: xc, url: `https://xeno-canto.org/${xc}` } : undefined,
  };
}

async function commonsFor(sp, opts) {
  const found = new Map();
  const add = (data) => {
    for (const p of Object.values(data.query?.pages || {})) {
      const c = commonsCandidate(p, sp.sci);
      if (c) found.set(c.key, c);
    }
  };
  const base = { action: 'query', format: 'json', prop: 'imageinfo', iiprop: IIPROPS, iiextmetadatafilter: IIMETA };
  const qs = (o) => COMMONS_API + '?' + new URLSearchParams(o).toString();
  // 1. the species' category, as many pages as there are (capped).
  let cont = {};
  for (let page = 0; page < 6; page++) {
    const data = await cachedJson(qs({ ...base, generator: 'categorymembers', gcmtitle: `Category:Audio files of ${sp.sci}`, gcmtype: 'file', gcmlimit: '50', ...cont }), {}, opts.refresh);
    add(data);
    if (!data.continue) break;
    cont = data.continue;
  }
  // 2. a text search per wanted type, to reach recordings beyond the category cap.
  const words = new Set();
  for (const c of sp.calls) for (const w of (KIND_TYPES[c.kind] || []).slice(0, 1)) words.add(w);
  for (const w of words) {
    const data = await cachedJson(qs({ ...base, generator: 'search', gsrnamespace: '6', gsrlimit: '50', gsrsearch: `filetype:audio "${sp.sci}" "${w}"` }), {}, opts.refresh);
    add(data);
  }
  return [...found.values()];
}

const XC_API = 'https://xeno-canto.org/api/3/recordings';
const XC_TYPE = { song: 'song', call: 'call', alarm: 'alarm call', drum: 'drumming', boom: 'song' };

function xcCandidate(r) {
  const licence = parseLicence(r.lic);
  const len = parseLength(r.length);
  return {
    key: `xc:${r.id}`, source: 'xeno-canto', id: String(r.id),
    title: `${r.en || ''} XC${r.id}`.trim(), pageUrl: r.url?.startsWith('http') ? r.url : `https://xeno-canto.org/${r.id}`,
    download: r.file || `https://xeno-canto.org/${r.id}/download`,
    recordist: r.rec || 'unknown', licence, types: parseTypes(r.type), typeGuessed: false,
    length: len, quality: /^[A-E]$/.test(r.q) ? r.q : undefined,
    size: Number.isFinite(len) ? Math.round(len * 16000) : undefined, sizeEstimated: true,
    remarks: String(r.rmk || ''), also: (r.also || []).filter(Boolean),
    seen: r['animal-seen'] === 'yes' ? true : r['animal-seen'] === 'no' ? false : undefined,
    playback: r['playback-used'] === 'yes' ? true : r['playback-used'] === 'no' ? false : undefined,
  };
}

async function xenoCantoFor(sp, opts, key) {
  const found = new Map();
  const kinds = [...new Set(sp.calls.map((c) => c.kind))];
  for (const kind of kinds) {
    for (const q of ['A', 'B']) {
      const query = `sp:"${sp.sci}" type:"${XC_TYPE[kind]}" q:${q} len:"2-60"`;
      let page = 1, numPages = 1;
      while (page <= numPages && page <= 3) {
        const url = `${XC_API}?${new URLSearchParams({ query, per_page: '100', page: String(page), key })}`;
        const data = await cachedJson(url, {}, opts.refresh);
        numPages = +data.numPages || 1;
        for (const r of data.recordings || []) {
          const c = xcCandidate(r);
          if (c.licence) found.set(c.key, c);
        }
        page++;
      }
    }
  }
  return [...found.values()];
}

// ---------------------------------------------------------------------------
// Plan

function loadSpecies(only) {
  const f = path.join(HERE, 'species.json');
  if (!fs.existsSync(f)) die('tools/birdsong/species.json is missing. Create it with: go run ./tools/birdsong/species');
  let list = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (only) {
    const known = new Set(list.map((s) => s.id));
    for (const id of only) if (!known.has(id)) die(`unknown species id ${id}`);
    list = list.filter((s) => only.includes(s.id));
  }
  return list;
}

async function makePlan(o) {
  const key = xcKey();
  let source = o.source;
  if (source === 'auto') source = key ? 'xeno-canto' : 'commons';
  if (source === 'xeno-canto' && !key) {
    die('xeno-canto API v3 needs a key. Register at https://xeno-canto.org (verified e-mail), copy the key from https://xeno-canto.org/account, then set XC_API_KEY=... in the environment or in the git-ignored .env file at the repo root. Or use --source commons (no key).');
  }
  console.error(`plan: source ${source}${source === 'xeno-canto' ? ' (key found)' : ' (no key needed)'}, ${o.allowNc ? 'NON-COMMERCIAL licences allowed' : 'commercial-compatible licences only'}, ${o.per} per call`);
  const list = loadSpecies(o.species);
  const plan = { generated: new Date().toISOString(), source, allowNc: o.allowNc, per: o.per, summary: {}, species: [] };
  for (const sp of list) {
    process.stderr.write(`  ${sp.id} ... `);
    let cands = [];
    try {
      cands = source === 'xeno-canto' ? await xenoCantoFor(sp, o, key) : await commonsFor(sp, o);
    } catch (e) {
      console.error(`FAILED: ${scrub(e.message)}`);
      plan.species.push({ id: sp.id, name: sp.name, sci: sp.sci, error: scrub(e.message), calls: sp.calls.map((c) => ({ index: c.index, kind: c.kind, status: 'none', reason: 'archive error', recordings: [], alternates: [] })) });
      continue;
    }
    const sel = selectForSpecies(sp, cands, { per: o.per, allowNc: o.allowNc });
    const calls = sel.map((s) => ({
      index: s.callIndex, kind: s.kind, status: s.picks.length ? 'ok' : 'none', ...(s.reason ? { reason: s.reason } : {}),
      recordings: s.picks.map(planRecording), alternates: s.alternates.map(planRecording),
    }));
    plan.species.push({ id: sp.id, name: sp.name, sci: sp.sci, candidates: cands.length, calls });
    console.error(`${cands.length} candidates, ${calls.filter((c) => c.status === 'ok').length}/${calls.length} calls covered`);
  }
  plan.summary = summarise(plan);
  return plan;
}

function planRecording(c) {
  return {
    key: c.key, source: c.source, id: c.id, title: c.title, pageUrl: c.pageUrl, download: c.download,
    recordist: c.recordist, licence: { code: c.licence.code, name: c.licence.name, url: c.licence.url, nc: c.licence.nc, sa: c.licence.sa },
    flags: licenceFlags(c.licence), types: c.types, ...(c.typeGuessed ? { typeGuessed: true } : {}),
    length: Math.round(c.length * 10) / 10, quality: c.quality ?? null,
    size: c.size ?? null, sizeEstimated: !!c.sizeEstimated, score: c.score,
    ...(c.original ? { original: c.original } : {}),
    ...(c.remarks ? { remarks: c.remarks.slice(0, 200) } : {}),
  };
}

function summarise(plan) {
  const s = { species: plan.species.length, speciesCovered: 0, calls: 0, callsCovered: 0, files: 0, downloadBytes: 0, outputBytesEstimate: 0, byLicence: {}, nonCommercial: 0, shareAlike: 0, uncovered: [] };
  for (const sp of plan.species) {
    let any = false;
    for (const c of sp.calls) {
      s.calls++;
      if (c.status === 'ok') { s.callsCovered++; any = true; } else s.uncovered.push(`${sp.id}#${c.index} (${c.kind})`);
      for (const r of c.recordings) {
        s.files++;
        s.downloadBytes += r.size || 0;
        s.outputBytesEstimate += estimateOutputBytes(Math.min(KIND_LIMITS[c.kind]?.max ?? 8, r.length));
        s.byLicence[r.licence.name] = (s.byLicence[r.licence.name] || 0) + 1;
        if (r.licence.nc) s.nonCommercial++;
        if (r.licence.sa) s.shareAlike++;
      }
    }
    if (any) s.speciesCovered++;
  }
  return s;
}

function planMarkdown(plan) {
  const s = plan.summary;
  const L = [];
  L.push('# Birdsong plan', '');
  L.push(`Generated ${plan.generated} from **${plan.source}**. Nothing has been downloaded. Approve, then run \`node tools/birdsong/fetch.mjs --fetch\`.`, '');
  if (plan.allowNc || s.nonCommercial) L.push(`> **WARNING: ${s.nonCommercial} recordings are NON-COMMERCIAL.** Do not ship them in a commercial release.`, '');
  if (s.shareAlike) L.push(`> **Share-alike:** ${s.shareAlike} recordings are CC BY-SA. The converted excerpts must be redistributed under the same licence (attribution + same terms); that affects the audio files, not the game code.`, '');
  L.push('## Summary', '');
  L.push(`- Species with at least one recording: **${s.speciesCovered} of ${s.species}**`);
  L.push(`- Calls covered: **${s.callsCovered} of ${s.calls}** (the rest keep their synthesised voice)`);
  L.push(`- Files: ${s.files}; download about ${fmtBytes(s.downloadBytes)}${plan.source === 'xeno-canto' ? ' (estimated from length)' : ''}; converted result about ${fmtBytes(s.outputBytesEstimate)}`);
  L.push(`- Licences: ${Object.entries(s.byLicence).map(([k, v]) => `${k} x${v}`).join(', ') || 'none'}`);
  if (s.uncovered.length) L.push(`- Not covered: ${s.uncovered.join(', ')}`);
  L.push('');
  L.push('## Recordings', '');
  for (const sp of plan.species) {
    L.push(`### ${sp.name} (${sp.sci}) \`${sp.id}\``, '');
    if (sp.error) L.push(`Archive error: ${sp.error}`, '');
    L.push('| call | type | recording | recordist | licence | length | quality | size | source |', '|---|---|---|---|---|---|---|---|---|');
    for (const c of sp.calls) {
      if (!c.recordings.length) L.push(`| ${c.index} | ${c.kind} | _none: ${c.reason || 'n/a'}_ | | | | | | |`);
      for (const r of c.recordings) {
        const flags = r.flags.length ? ` **${r.flags.join(' ')}**` : '';
        L.push(`| ${c.index} | ${c.kind}${r.typeGuessed ? ' (type guessed)' : ''} | ${r.source} ${r.id} | ${r.recordist.replace(/\|/g, '/')} | [${r.licence.name}](${r.licence.url})${flags} | ${r.length}s | ${r.quality ?? 'unrated'} | ${fmtBytes(r.size)}${r.sizeEstimated ? '~' : ''} | <${r.original?.url || r.pageUrl}>${r.original ? ` (mirror: <${r.pageUrl}>)` : ''} |`);
      }
    }
    L.push('');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Fetch (download + convert)

function binary(name) {
  const env = process.env[name.toUpperCase()];
  if (env) return env;
  for (const d of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) if (fs.existsSync(path.join(d, name))) return path.join(d, name);
  return name;
}

function run(cmd, args, { capture = 'stderr' } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      const stdout = Buffer.concat(out), stderr = Buffer.concat(err).toString();
      if (code !== 0) reject(new Error(`${path.basename(cmd)} exited ${code}: ${stderr.slice(-400)}`));
      else resolve({ stdout, stderr });
    });
  });
}

async function download(rec, dir) {
  const ext = (path.extname(new URL(rec.download).pathname) || '.mp3').toLowerCase();
  const f = path.join(dir, `${rec.key.replace(/[^a-z0-9]+/gi, '_')}${ext === '.download' ? '.mp3' : ext}`);
  if (fs.existsSync(f) && fs.statSync(f).size > 0) return f;
  const res = await http(rec.download, { json: false, minGap: 1000 });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error('download is too small to be audio');
  fs.writeFileSync(f, buf);
  return f;
}

async function analyse(ffmpeg, file, kind) {
  // 16 kHz mono float, rumble and hiss out, so levels reflect the vocalisation.
  const { stdout } = await run(ffmpeg, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-af', 'highpass=f=200,lowpass=7500', '-f', 'f32le', '-'], {});
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
  const levels = frameLevels(samples, 16000, 0.05);
  const lim = KIND_LIMITS[kind] || { min: 3, max: 8 };
  return chooseWindow(levels, { hop: 0.05, min: lim.min, max: lim.max });
}

async function convert(ffmpeg, file, win, dest) {
  const fadeOut = 0.25;
  const pre = `highpass=f=200,afade=t=in:st=0:d=0.04,afade=t=out:st=${Math.max(0, win.dur - fadeOut).toFixed(3)}:d=${fadeOut}`;
  const trim = ['-ss', String(win.start), '-t', String(win.dur), '-i', file];
  // Two-pass loudness normalisation (EBU R128, -16 LUFS integrated, true peak -1.5 dB).
  const first = await run(ffmpeg, ['-hide_banner', '-v', 'info', ...trim, '-af', `${pre},loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-']);
  const j = first.stderr.match(/\{[\s\S]*"target_offset"[\s\S]*?\}/);
  let norm = 'loudnorm=I=-16:TP=-1.5:LRA=11';
  if (j) {
    const m = JSON.parse(j[0]);
    if ([m.input_i, m.input_tp, m.input_lra, m.input_thresh, m.target_offset].every((v) => Number.isFinite(+v))) {
      norm = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await run(ffmpeg, ['-hide_banner', '-v', 'error', '-y', ...trim, '-af', `${pre},${norm}`, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', '-application', 'audio', '-map_metadata', '-1', dest]);
}

async function probeDuration(ffprobe, f) {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]);
  return parseFloat(stdout.toString());
}

async function doFetch(o) {
  if (!fs.existsSync(o.planFile)) die(`no plan at ${o.planFile}. Run --plan first and have it approved.`);
  const plan = JSON.parse(fs.readFileSync(o.planFile, 'utf8'));
  const ffmpeg = binary('ffmpeg'), ffprobe = binary('ffprobe');
  try { await run(ffmpeg, ['-version']); } catch { die('ffmpeg not found (set FFMPEG=/path/to/ffmpeg)'); }
  const only = o.species ? new Set(o.species) : null;
  const dl = path.join(CACHE, 'downloads');
  fs.mkdirSync(dl, { recursive: true });
  const speciesNames = {};
  const made = [];
  let failures = 0;
  for (const sp of plan.species) {
    speciesNames[sp.id] = sp.name;
    if (only && !only.has(sp.id)) continue;
    for (const call of sp.calls) {
      let n = 0;
      const queue = [...call.recordings];
      const spare = [...(call.alternates || [])];
      const want = call.recordings.length;
      while (queue.length && n < want) {
        const rec = queue.shift();
        try {
          process.stderr.write(`  ${sp.id} call ${call.index} (${call.kind}) ${rec.key} ... `);
          const src = await download(rec, dl);
          const win = await analyse(ffmpeg, src, call.kind);
          if (win.snr < 12 && spare.length) {
            console.error(`noisy (${win.snr.toFixed(0)} dB above floor), trying an alternate`);
            queue.push(spare.shift());
            continue;
          }
          const rel = outputPath(sp.id, call.index, call.kind, n + 1);
          const dest = path.join(o.out, rel);
          await convert(ffmpeg, src, win, dest);
          const dur = await probeDuration(ffprobe, dest);
          n++;
          made.push({
            species: sp.id, callIndex: call.index, file: rel, dur, gain: 1,
            credit: {
              kind: call.kind, recordist: rec.recordist, licence: rec.licence.name, licenceUrl: rec.licence.url,
              nc: rec.licence.nc, sa: rec.licence.sa, source: rec.source, url: rec.original?.url || rec.pageUrl,
              ...(rec.original ? { archiveUrl: rec.pageUrl } : {}), id: rec.id,
            },
          });
          console.error(`ok ${dur.toFixed(1)}s (${fmtBytes(fs.statSync(dest).size)})`);
        } catch (e) {
          failures++;
          console.error(`FAILED: ${scrub(e.message)}`);
          if (spare.length) queue.push(spare.shift());
        }
      }
    }
  }
  // Merge with a previous manifest for species not touched in this run.
  const mf = path.join(o.out, 'manifest.json');
  let kept = [];
  if (only && fs.existsSync(mf)) {
    try {
      const old = JSON.parse(fs.readFileSync(mf, 'utf8'));
      const credits = new Map((old.credits || []).map((c) => [c.file, c]));
      for (const [id, calls] of Object.entries(old.species || {})) {
        if (only.has(id)) continue;
        for (const [ci, list] of Object.entries(calls)) {
          for (const e of list) {
            const c = credits.get(e.file) || {};
            const { file: _f, species: _s, call: _c, ...credit } = c;
            kept.push({ species: id, callIndex: +ci, file: e.file, dur: e.dur, gain: e.gain, credit: { licence: '', ...credit } });
          }
        }
      }
    } catch { kept = []; }
  }
  const all = [...kept, ...made];
  fs.mkdirSync(o.out, { recursive: true });
  fs.writeFileSync(mf, JSON.stringify(buildManifest(all), null, 2) + '\n');
  fs.writeFileSync(path.join(o.out, 'CREDITS.md'), creditsMarkdown(all, speciesNames) + '\n');
  const bytes = made.reduce((a, f) => a + fs.statSync(path.join(o.out, f.file)).size, 0);
  console.error(`done: ${made.length} files (${fmtBytes(bytes)}), ${failures} failures. Wrote manifest.json and CREDITS.md in ${o.out}`);
  if (failures) process.exitCode = 2;
}

// ---------------------------------------------------------------------------

/** Check the ffmpeg pipeline on a synthetic recording: no network, nothing written to web/. */
async function selftest() {
  const ffmpeg = binary('ffmpeg'), ffprobe = binary('ffprobe');
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'birdsong-selftest-'));
  const src = path.join(dir, 'in.wav');
  // 30 s of low rumble + hiss, a faint chirp at 4 s and a loud 3 kHz warble 18-23 s.
  await run(ffmpeg, ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'anoisesrc=d=30:c=brown:a=0.05:r=44100',
    '-f', 'lavfi', '-i', 'sine=f=3000:d=30:r=44100',
    '-filter_complex', "[1]volume='if(between(t,18,23),0.5+0.3*sin(2*PI*6*t),if(between(t,4,4.3),0.03,0))':eval=frame[s];[0][s]amix=inputs=2:duration=first:normalize=0",
    '-ac', '1', src]);
  const win = await analyse(ffmpeg, src, 'song');
  const ok = win.start < 18.2 && win.start + win.dur > 22.5 && win.dur >= 4 && win.dur <= 10;
  console.error(`trim window: ${win.start.toFixed(2)}s + ${win.dur.toFixed(2)}s, ${win.snr.toFixed(0)} dB above the floor: ${ok ? 'ok' : 'WRONG'}`);
  const dest = path.join(dir, 'out', 'test-1.ogg');
  await convert(ffmpeg, src, win, dest);
  const info = JSON.parse((await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,channels,sample_rate,bit_rate:format=duration', '-of', 'json', dest])).stdout.toString());
  const st = info.streams[0];
  const loud = (await run(ffmpeg, ['-hide_banner', '-i', dest, '-af', 'ebur128=peak=true', '-f', 'null', '-'])).stderr;
  const lufs = parseFloat((loud.match(/I:\s+(-?[0-9.]+) LUFS/g) || []).pop()?.match(/-?[0-9.]+/)?.[0]);
  const peak = parseFloat((loud.match(/Peak:\s+(-?[0-9.]+) dBFS/g) || []).pop()?.match(/-?[0-9.]+/)?.[0]);
  console.error(`output: ${st.codec_name}, ${st.channels} ch, ${st.sample_rate} Hz, ${((fs.statSync(dest).size * 8) / parseFloat(info.format.duration) / 1000).toFixed(0)} kbps, ${parseFloat(info.format.duration).toFixed(2)} s, ${fmtBytes(fs.statSync(dest).size)}, ${lufs} LUFS, peak ${peak} dBFS`);
  const good = ok && st.codec_name === 'opus' && st.channels === 1 && Math.abs(lufs + 16) < 2.5 && peak < -0.5;
  fs.rmSync(dir, { recursive: true, force: true });
  console.error(good ? 'selftest passed' : 'selftest FAILED');
  if (!good) process.exitCode = 1;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.selftest) { await selftest(); return; }
  if (o.help || (!o.plan && !o.fetch)) { usage(); if (!o.help) console.error('\nnothing to do: pass --plan or --fetch'); return; }
  if (o.plan && o.fetch) die('pass --plan or --fetch, not both: the plan needs approval in between');
  if (o.plan) {
    const plan = await makePlan(o);
    fs.writeFileSync(o.planFile, JSON.stringify(plan, null, 2) + '\n');
    const md = o.planFile.replace(/\.json$/, '') + '.md';
    fs.writeFileSync(md, planMarkdown(plan) + '\n');
    const s = plan.summary;
    console.error(`\nplan written: ${o.planFile}\n              ${md}`);
    console.error(`${s.speciesCovered}/${s.species} species, ${s.callsCovered}/${s.calls} calls, ${s.files} files, download ~${fmtBytes(s.downloadBytes)}, result ~${fmtBytes(s.outputBytesEstimate)}; licences: ${JSON.stringify(s.byLicence)}`);
    if (s.nonCommercial) console.error(`WARNING: ${s.nonCommercial} NON-COMMERCIAL recordings in the plan`);
    if (s.shareAlike) console.error(`note: ${s.shareAlike} SHARE-ALIKE recordings in the plan`);
  } else {
    await doFetch(o);
  }
}

main().catch((e) => { console.error(`error: ${scrub(e.stack || e.message)}`); process.exit(1); });
