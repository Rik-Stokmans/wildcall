// Live protocol smoke test: drives a REAL running engine the way the client does, without
// a browser, and runs the client's own pure-logic code on what the server actually sends.
//
//   go run ./cmd/wildcall -dev -addr 127.0.0.1:0 -save "$(mktemp -d)"   # note the URL
//   node web/js/dev/live-smoke.mjs http://127.0.0.1:<port>
//
// Use a throwaway save directory: the script plays a short session (debug commands,
// photos, a skill purchase) and starts a new adventure at the end.
//
// It checks: every file the page loads (static import graph from js/main.js) returns
// 200 with the right MIME type; hello → welcome carries everything state.applyWelcome
// and the modules read; chunk frames parse with the client's parser (negative chunk
// coordinates, all LODs, shared edges agree); real birds/env/call/clue/profile/narrate
// messages go through the pure-logic parts of the modules; and a scripted session
// (spawn a wren, observe, identify, photograph, talk to Mara, open the cabin, buy a
// skill) is answered with the messages the client expects. Exit code 0 = all passed.
import { parseChunk, peekChunkHeader } from '../world/chunkCodec.js';
import { createState } from '../core/state.js';
import { createBus } from '../core/bus.js';
import { SnapshotBook } from '../birds/interp.js';
import { SNAP, ACT_COUNT } from '../birds/constants.js';
import { ClueStore, clueCard } from '../ui/hud/clues.js';
import { sightingView } from '../ui/hud/sighting.js';
import { scheduleCall } from '../audio/schedule.js';
import { createFog, tileUrl, tilesToFetch } from '../ui/journal/fog.js';
import { speciesCards, mysteryCards } from '../ui/journal/species-logic.js';
import { orderCandidates, resultView, dialogView, evidenceRows } from '../ui/encounter/logic.js';
import { skillState, rankProgress, nextRank, capacityUsage } from '../ui/menu/logic.js';
import { createQueue, admit } from '../narrator/queue.js';

const BASE = (process.argv[2] || process.env.WILDCALL_URL || '').replace(/\/$/, '');
if (!BASE) { console.error('usage: node live-smoke.mjs http://127.0.0.1:<port>'); process.exit(2); }

// A 16x10 baseline JPEG (valid, decodable) as a photo payload.
const TINY_JPEG = 'data:image/jpeg;base64,/9j/2wCEAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9PjsBCgsLDg0OHBAQHDsoIig7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O//AABEIAAoAEAMBIgACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AMG2h6cVr20PTiqVt2rXtu1bV8qonHldR6H/2Q==';

// ---------------------------------------------------------------------------------
let failures = 0, passes = 0;
const notes = [];
function ok(cond, what, detail) {
  if (cond) { passes++; return true; }
  failures++;
  console.log(`  FAIL ${what}${detail !== undefined ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)) : ''}`);
  return false;
}
function section(t) { console.log(`\n## ${t}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isArr = Array.isArray;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------------------------
// 1. Static files: the page and its import graph.
async function staticGraph() {
  section('static files and import graph');
  const res = await fetch(BASE + '/');
  ok(res.status === 200, 'GET / is 200', res.status);
  ok(/text\/html/.test(res.headers.get('content-type') || ''), 'GET / is text/html', res.headers.get('content-type'));
  const html = await res.text();
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  const im = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  const importMap = im ? JSON.parse(im[1]).imports : {};
  ok(css.length >= 9, 'index.html links the stylesheets', css);
  for (const href of css) {
    const r = await fetch(BASE + '/' + href);
    const body = await r.text();
    ok(r.status === 200 && /text\/css/.test(r.headers.get('content-type') || ''), `stylesheet ${href} served as CSS`, `${r.status} ${r.headers.get('content-type')}`);
    ok(body.replace(/\/\*[\s\S]*?\*\//g, '').trim().length > 200, `stylesheet ${href} has real content`, body.length);
  }
  // Walk the static import graph (plus main.js's dynamic module list and the import map).
  const seen = new Set();
  const queue = scripts.map((s) => new URL(s, BASE + '/').href);
  for (const v of Object.values(importMap)) queue.push(new URL(v, BASE + '/').href);
  let count = 0;
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await fetch(url);
    const type = r.headers.get('content-type') || '';
    // Strip comments so that examples in doc comments are not taken for imports.
    const src = (await r.text()).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
    count++;
    if (!ok(r.status === 200, `GET ${url.slice(BASE.length)} is 200`, r.status)) continue;
    ok(/javascript/.test(type), `${url.slice(BASE.length)} has a JavaScript MIME type`, type);
    if (url.includes('/vendor/')) continue;
    const specs = new Set();
    for (const m of src.matchAll(/(?:^|[\s;])(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
    for (const m of src.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
    for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);
    if (url.endsWith('/js/main.js')) for (const m of src.matchAll(/'(\.\/[^']+\.js)'/g)) specs.add(m[1]);
    for (const s of specs) {
      if (importMap[s]) { queue.push(new URL(importMap[s], BASE + '/').href); continue; }
      if (!s.startsWith('.') && !s.startsWith('/')) { ok(false, `bare import "${s}" in ${url.slice(BASE.length)} is not in the import map`); continue; }
      queue.push(new URL(s, url).href);
    }
  }
  ok(count > 100, 'import graph covers the client', count);
  console.log(`  ${count} scripts fetched`);
}

// ---------------------------------------------------------------------------------
// 2. WebSocket client.
function connect() {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
  ws.binaryType = 'arraybuffer';
  const log = [];       // every JSON message {t, d, at}
  const chunks = [];    // binary frames
  const waiters = [];
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') { chunks.push(ev.data); for (const w of waiters.slice()) w.check(); return; }
    const m = JSON.parse(ev.data);
    m.at = Date.now();
    log.push(m);
    for (const w of waiters.slice()) w.check();
  };
  const api = {
    ws, log, chunks,
    send(t, d = {}) { ws.send(JSON.stringify({ t, d })); },
    open: new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); }),
    /** Wait for a message of type t (after index `from`) matching pred. */
    wait(t, pred = () => true, ms = 5000, from = log.length) {
      return new Promise((resolve, reject) => {
        const w = {
          check() {
            for (let i = from; i < log.length; i++) {
              if (log[i].t === t && pred(log[i].d)) { done(); resolve(log[i].d); return; }
            }
          },
        };
        const timer = setTimeout(() => { done(); reject(new Error(`timeout waiting for ${t}`)); }, ms);
        const done = () => { clearTimeout(timer); const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); };
        waiters.push(w);
        w.check();
      });
    },
    waitChunk(pred, ms = 5000) {
      return new Promise((resolve, reject) => {
        const w = { check() { const i = chunks.findIndex(pred); if (i >= 0) { done(); resolve(chunks.splice(i, 1)[0]); } } };
        const timer = setTimeout(() => { done(); reject(new Error('timeout waiting for chunk')); }, ms);
        const done = () => { clearTimeout(timer); const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); };
        waiters.push(w);
        w.check();
      });
    },
    since(i) { return log.slice(i); },
  };
  return api;
}

// ---------------------------------------------------------------------------------
// 3. Welcome validation (what state.applyWelcome and every module's welcome handler read).
function checkWelcome(w) {
  section('welcome');
  ok(typeof w.version === 'string' && w.version, 'welcome.version');
  ok(Number.isFinite(w.seed), 'welcome.seed is a number');
  ok(typeof w.hasSave === 'boolean', 'welcome.hasSave');
  const wi = w.world || {};
  ok(typeof wi.mapUrl === 'string' && wi.mapUrl.includes('{tx}') && wi.mapUrl.includes('{tz}'), 'world.mapUrl template', wi.mapUrl);
  ok(typeof wi.seedText === 'string' && wi.seedText, 'world.seedText');
  ok(isObj(wi.home) && Number.isFinite(wi.home.x), 'world.home');
  ok(wi.chunkSize === 64 && wi.fogCell === 32 && wi.mapTileSize === 512, 'world sizes', wi);
  for (const k of ['regions', 'species', 'ranks', 'disciplines', 'skillTiers', 'skills', 'items', 'cabinUpgrades', 'npcs', 'quests', 'collectibles', 'lore', 'pois', 'trails', 'shop']) {
    ok(isArr(w[k]) && w[k].length > 0, `welcome.${k} is a non-empty array`, w[k] === null ? 'null' : typeof w[k]);
  }
  w.species?.forEach((sp, i) => {
    ok(sp.index === i, `species[${i}].index matches position`, sp.index);
    ok(isObj(sp.look) && isObj(sp.look.colors) && isArr(sp.look.marks), `species ${sp.id} look/colors/marks`);
    ok(isArr(sp.calls) && sp.calls.length > 0 && sp.calls.every((c) => isArr(c.notes) && c.notes.length > 0), `species ${sp.id} calls with notes`);
    ok(isObj(sp.traits) && isObj(sp.move) && isObj(sp.behavior), `species ${sp.id} traits/move/behavior`);
    ok(isArr(sp.regions) && isArr(sp.habitats) && isArr(sp.seasons) && sp.seasons.length === 4, `species ${sp.id} regions/habitats/seasons arrays`);
    ok(isArr(sp.similar) || sp.similar === null, `species ${sp.id} similar`);
  });
  for (const p of w.pois || []) {
    ok(typeof p.id === 'string' && typeof p.kind === 'string' && isObj(p.pos) && Number.isFinite(p.radius), `poi ${p.id} shape`);
  }
  for (const id of ['cabin', 'npc_mara', 'npc_finn', 'npc_alder', 'npc_june', 'shop_finn', 'old_oak', 'old_watchtower', 'cache_watchtower', 'page_0']) {
    ok((w.pois || []).some((p) => p.id === id), `pinned POI ${id} present`);
  }
  for (const t of w.trails || []) ok(isArr(t.points) && t.points.length > 1, `trail ${t.id} has points`);
  for (const n of w.npcs || []) ok(isObj(n.look) && typeof n.poi === 'string', `npc ${n.id} look/poi`);
  for (const q of w.quests || []) ok(isArr(q.objectives) && isObj(q.rewards), `quest ${q.id} objectives/rewards`);
  for (const it of w.items || []) ok(isObj(it.mods) || it.mods === null, `item ${it.id} mods`);
  ok(isObj(w.spawn) && isObj(w.spawn.pos) && Number.isFinite(w.spawn.yaw), 'welcome.spawn {pos, yaw}');
  checkEnv(w.env, 'welcome.env');
  checkProfile(w.profile, 'welcome.profile');
}

function checkEnv(e, where) {
  ok(isObj(e), `${where} is an object`);
  for (const k of ['time', 'day', 'season', 'weather', 'wind', 'rain', 'mist', 'cloud', 'light', 'dayLen']) ok(Number.isFinite(e?.[k]), `${where}.${k} is a number`, e?.[k]);
  ok(typeof e?.phase === 'string', `${where}.phase`);
  ok(isArr(e?.forecast), `${where}.forecast is an array`, e?.forecast);
}

// Fields the modules iterate without guarding (or that must be objects to index).
function checkProfile(p, where) {
  ok(isObj(p), `${where} is an object`);
  if (!isObj(p)) return;
  const maps = ['skills', 'rep', 'equipped', 'upgrades', 'explored', 'quests', 'flags', 'stats', 'film', 'totals', 'xpLog'];
  const arrays = ['inventory', 'storage', 'cabin', 'regions', 'trails'];
  for (const k of maps) ok(isObj(p[k]), `${where}.${k} is an object (not null)`, p[k]);
  for (const k of arrays) ok(isArr(p[k]), `${where}.${k} is an array (not null)`, p[k]);
  const j = p.journal || {};
  for (const k of ['species', 'locations', 'collectibles']) ok(isObj(j[k]), `${where}.journal.${k} is an object`, j[k]);
  for (const k of ['mysteries', 'photos', 'recordings', 'observations', 'lore', 'rare', 'pinned', 'badges']) ok(isArr(j[k]), `${where}.journal.${k} is an array`, j[k]);
  for (const m of j.mysteries || []) {
    ok(!m.species, `${where}: mystery ${m.id} species blanked`);
    ok(isObj(m.evidence) && isArr(m.candidates) && isArr(m.wrong) && isArr(m.photos) && isArr(m.recs), `${where}: mystery ${m.id} evidence/candidates/wrong/photos/recs`, m);
  }
  for (const [id, e] of Object.entries(j.species || {})) {
    ok(isObj(e.evidence) && isArr(e.behaviors) && isArr(e.habitats) && isArr(e.regions) && isArr(e.phases), `${where}: species entry ${id} arrays`, e);
  }
  for (const ph of j.photos || []) ok(isArr(ph.subjects) && isArr(ph.tags), `${where}: photo ${ph.id} subjects/tags arrays`, ph);
  for (const [id, q] of Object.entries(p.quests || {})) ok(isObj(q.progress), `${where}: quest ${id}.progress is an object`, q);
  ok(Number.isFinite(p.film?.cap) && Number.isFinite(p.film?.used), `${where}.film`);
  ok(Number.isFinite(p.stats?.binoZoom) && Number.isFinite(p.stats?.clueSlots), `${where}.stats`);
}

// ---------------------------------------------------------------------------------
// Height sampling from parsed chunks (to stand the scripted player on the ground).
const chunkCache = new Map();
async function chunkAt(c, cx, cz) {
  const key = `${cx},${cz}`;
  if (chunkCache.has(key)) return chunkCache.get(key);
  const p = (async () => {
    c.send('chunkReq', { cx, cz, lod: 0 });
    const buf = await c.waitChunk((b) => { const h = peekChunkHeader(b); return h && h.cx === cx && h.cz === cz && h.lod === 0; });
    return parseChunk(buf);
  })();
  chunkCache.set(key, p);
  return p;
}
async function groundAt(c, x, z) {
  const cx = Math.floor(x / 64), cz = Math.floor(z / 64);
  const ch = await chunkAt(c, cx, cz);
  const fx = (x - cx * 64) / ch.cell, fz = (z - cz * 64) / ch.cell;
  const ix = Math.min(ch.n - 2, Math.floor(fx)), iz = Math.min(ch.n - 2, Math.floor(fz));
  const tx = fx - ix, tz = fz - iz;
  const h = (a, b) => ch.heights[b * ch.n + a];
  return (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz;
}
const headingTo = (a, b) => { let h = Math.atan2(b.x - a.x, -(b.z - a.z)); if (h < 0) h += Math.PI * 2; return h; };

function pose(eye, yaw, extra = {}) {
  return {
    x: eye.x, y: eye.y, z: eye.z, yaw, pitch: extra.pitch ?? 0, speed: 0, move: extra.crouch ? 'crouch' : 'still',
    crouch: !!extra.crouch, sit: false, focus: !!extra.focus, tool: extra.tool || 'none', raised: !!extra.raised,
    fov: extra.fov ?? 70, zoom: extra.zoom ?? 1, sharp: 1, noise: 0,
  };
}

// ---------------------------------------------------------------------------------
async function main() {
  await staticGraph();

  // Map tiles: negative coordinates substitute and serve.
  section('map tiles');
  const c = connect();
  await c.open;
  const hello0 = c.log.length;
  c.send('hello', { name: 'Smoke', newGame: true, seed: 'smoke-test' });
  const w = await c.wait('welcome', () => true, 15000, hello0);
  checkWelcome(w);

  // The client's own state.applyWelcome.
  const bus = createBus();
  const state = createState(bus);
  try { state.applyWelcome(w); ok(true); } catch (err) { ok(false, 'state.applyWelcome', String(err)); }
  ok(state.speciesById.eurasian_wren && state.pois.cabin && state.npcs.mara && state.quests.unseen_singer, 'state indexes built');
  ok(Object.keys(state.stats).length > 30, 'state.stats derived from profile');

  const fog = createFog().update(w.profile.explored);
  ok(fog.tiles.length > 0, 'a new adventure has explored fog tiles around the spawn', Object.keys(w.profile.explored));
  for (const t of tilesToFetch(fog, { x0: -1e6, z0: -1e6, x1: 1e6, z1: 1e6 })) {
    const url = tileUrl(w.world.mapUrl, t.tx, t.tz);
    const r = await fetch(BASE + url);
    ok(r.status === 200 && /image\/png/.test(r.headers.get('content-type') || ''), `explored map tile ${url} served`, r.status);
  }
  ok(tileUrl(w.world.mapUrl, -3, -1) === '/map/-3/-1.png', 'tileUrl substitutes negative coordinates', tileUrl(w.world.mapUrl, -3, -1));
  const far = await fetch(BASE + tileUrl(w.world.mapUrl, -40, 37));
  ok(far.status === 404, 'unexplored (negative) tile is 404, not an error', far.status);
  // The fog bit the server set for the spawn cell decodes to "explored" on the client.
  ok(fog.isExplored(w.spawn.pos.x, w.spawn.pos.z), 'client fog says the spawn cell is explored');

  // Chunks.
  section('chunks');
  const reqs = [[0, 0], [-1, 0], [0, -1], [-1, -1], [-7, 5], [3, -9]];
  for (const [cx, cz] of reqs) for (const lod of [0, 1, 2]) c.send('chunkReq', { cx, cz, lod });
  const parsed = {};
  for (const [cx, cz] of reqs) {
    for (const lod of [0, 1, 2]) {
      try {
        const buf = await c.waitChunk((b) => { const h = peekChunkHeader(b); return h && h.cx === cx && h.cz === cz && h.lod === lod; });
        const ch = parseChunk(buf);
        parsed[`${cx},${cz},${lod}`] = ch;
        ok(ch.cx === cx && ch.cz === cz && ch.lod === lod && ch.n === [33, 17, 9][lod], `chunk ${cx},${cz} lod ${lod} header`);
        ok(ch.minY > -200 && ch.maxY < 600, `chunk ${cx},${cz} lod ${lod} heights sane`, [ch.minY, ch.maxY]);
        for (let i = 0; i < ch.veg.count; i++) {
          const x = ch.veg.x[i], z = ch.veg.z[i];
          if (x < cx * 64 - 0.01 || x > cx * 64 + 64.01 || z < cz * 64 - 0.01 || z > cz * 64 + 64.01) { ok(false, `veg inside chunk ${cx},${cz}`, [x, z]); break; }
        }
      } catch (err) { ok(false, `chunk ${cx},${cz} lod ${lod}`, String(err)); }
    }
  }
  // Shared edges: chunk (-1,0)'s east column == chunk (0,0)'s west column; lod 1 == every 2nd lod-0 vertex.
  const a = parsed['-1,0,0'], b = parsed['0,0,0'], b1 = parsed['0,0,1'];
  if (a && b && b1) {
    let same = true, lodSame = true;
    for (let iz = 0; iz < 33; iz++) if (a.heights[iz * 33 + 32] !== b.heights[iz * 33]) same = false;
    for (let iz = 0; iz < 17; iz++) for (let ix = 0; ix < 17; ix++) if (b1.heights[iz * 17 + ix] !== b.heights[iz * 2 * 33 + ix * 2]) lodSame = false;
    ok(same, 'chunk edges agree across negative/positive chunks');
    ok(lodSame, 'lod 1 vertices equal every second lod-0 vertex');
  }
  c.send('chunkReq', { cx: 0, cz: 0, lod: 7 });
  await c.wait('error', (e) => /chunk/i.test(e.msg), 3000).then(() => ok(true), () => ok(false, 'bad chunkReq answered with an error'));

  // ---- scripted session ---------------------------------------------------------
  section('live session');
  const spawn = w.spawn.pos;
  const ground0 = await groundAt(c, spawn.x, spawn.z);
  ok(Math.abs(ground0 - spawn.y) < 1.0, 'welcome.spawn.pos is the FEET (ground) position', [spawn.y, ground0]);
  let eye = { x: spawn.x, y: spawn.y + 1.65, z: spawn.z };
  let yaw = w.spawn.yaw;
  const poseTimer = setInterval(() => { if (c.ws.readyState === 1 && current) c.send('pose', current); }, 100);
  let current = pose(eye, yaw);
  c.send('debug', { cmd: 'time', args: ['7'] });
  await sleep(1500);

  // Message streams the modules consume.
  const birdsMsg = await c.wait('birds', (d) => isArr(d.b), 5000);
  ok(Number.isFinite(birdsMsg.tick), 'birds.tick');
  const book = new SnapshotBook();
  book.ingest(birdsMsg, 0);
  ok(birdsMsg.b.every((r) => r.length === SNAP.LEN && Number.isInteger(r[0]) && r[2] >= 0 && r[2] < ACT_COUNT && r[1] < w.species.length), 'every bird row has 9 fields, integer id, known act and species');
  ok(book.live === new Set(birdsMsg.b.map((r) => r[0])).size, 'SnapshotBook holds every bird', [book.live, birdsMsg.b.length]);
  const env = await c.wait('env', () => true, 3000);
  checkEnv(env, 'env');

  // Spawn a wren ahead and watch it.
  const wren = w.species.find((s) => s.id === 'eurasian_wren');
  const logMark = c.log.length;
  c.send('debug', { cmd: 'spawn', args: ['eurasian_wren'] });
  const toast = await c.wait('toast', (t) => /spawned bird (\d+)/.test(t.text || ''), 3000, logMark).catch(() => null);
  ok(toast, 'debug spawn answered with a toast');
  const wrenId = toast ? Number(/spawned bird (\d+)/.exec(toast.text)[1]) : 0;
  const findWren = async () => {
    const m = await c.wait('birds', (d) => d.b.some((r) => r[0] === wrenId), 4000).catch(() => null);
    const r = m?.b.find((row) => row[0] === wrenId);
    return r ? { x: r[4], y: r[5], z: r[6], act: r[2] } : null;
  };
  let bird = await findWren();
  ok(bird, 'the spawned wren appears in a birds snapshot (exact integer id)', wrenId);

  const clues = new ClueStore(2);
  const t0 = Date.now();
  let sight = null, mysteryId = '';
  if (bird) {
    // Stand ~10 m from it, crouched, binoculars up.
    const placeNear = async () => {
      bird = (await findWren()) || bird;
      const away = headingTo(bird, eye);
      for (let i = 0; i < 12; i++) {
        const h = away + i * Math.PI / 6;
        const fx = bird.x + Math.sin(h) * 10, fz = bird.z - Math.cos(h) * 10;
        const gy = await groundAt(c, fx, fz);
        if (gy > 0.3) { eye = { x: fx, y: gy + 1.0, z: fz }; return; }
      }
    };
    await placeNear();
    const zoom = w.profile.stats.binoZoom;
    while (Date.now() - t0 < 45000) {
      bird = (await findWren()) || bird;
      const dx = bird.x - eye.x, dz = bird.z - eye.z;
      if (Math.hypot(dx, dz) > 20) await placeNear();
      yaw = headingTo(eye, bird);
      const pitch = Math.atan2(bird.y + 0.05 - eye.y, Math.hypot(bird.x - eye.x, bird.z - eye.z));
      current = pose(eye, yaw, { crouch: true, tool: 'binoculars', raised: true, zoom, fov: w.profile.stats.binoFov / zoom, pitch });
      const s = await c.wait('sighting', (d) => d.bird === wrenId, 1500).catch(() => null);
      if (s) {
        sight = s; mysteryId = s.mystery || mysteryId;
        const v = sightingView(s, (id) => state.speciesById[id]?.name || '');
        ok(v && v.bird === wrenId, 'HUD sightingView accepts the real sighting');
        if (Object.keys(s.evidence || {}).length >= 5) break;
      }
    }
    ok(sight, 'a sighting of the wren arrived while watching it');
    if (sight) {
      ok(isObj(sight.evidence), 'sighting.evidence is an object (not null)', sight.evidence);
      ok(isArr(sight.candidates), 'sighting.candidates is an array (not null)', sight.candidates);
      ok(!sight.known, 'an unidentified bird is not reported as known');
      ok(typeof sight.mystery === 'string' && sight.mystery, 'sighting carries the mystery id');
      console.log(`  evidence after ${((Date.now() - t0) / 1000).toFixed(0)} s:`, JSON.stringify(sight.evidence));
    }
  }

  // Every clue seen so far goes through the HUD's ClueStore and card builder.
  for (const m of c.since(0).filter((m) => m.t === 'clue')) {
    clues.upsert(m.d, 0);
    const card = clueCard(m.d, { species: (id) => state.speciesById[id]?.name, mystery: (id) => id });
    ok(card && typeof card.title === 'string', 'clueCard builds from a real clue');
    if (!m.d.known) ok(!/wren/i.test(JSON.stringify(card)), 'clue card for an unknown bird does not name it');
  }
  const callMsgs = c.since(0).filter((m) => m.t === 'call');
  for (const m of callMsgs.slice(0, 20)) {
    const sp = w.species[m.d.sp];
    const call = sp?.calls?.[m.d.call];
    ok(call, 'call refers to a real species call', m.d);
    if (call) {
      const sch = scheduleCall(call, m.d.reps, m.d.seed >>> 0);
      ok(sch.events.length > 0 && Number.isFinite(sch.duration), 'audio scheduleCall builds a bout from a real call message');
    }
    ok(Number.isFinite(m.d.x) && Number.isFinite(m.d.occ) && Number.isInteger(m.d.bird), 'call message fields');
  }
  console.log(`  ${callMsgs.length} call, ${c.since(0).filter((m) => m.t === 'clue').length} clue, ${c.since(0).filter((m) => m.t === 'cue').length} cue messages so far`);

  // Identification.
  const prof = () => [...c.log].reverse().find((m) => m.t === 'profile')?.d || w.profile;
  if (mysteryId) {
    const p = prof();
    checkProfile(p, 'profile');
    const m = (p.journal.mysteries || []).find((x) => x.id === mysteryId);
    ok(m, 'the mystery is in profile.journal.mysteries');
    if (m) {
      const cards = mysteryCards(p);
      ok(cards.some((x) => x.id === mysteryId), 'journal mysteryCards lists it');
      const ordered = orderCandidates(m.candidates, m.wrong, state.speciesById);
      ok(isArr(ordered), 'encounter orderCandidates accepts the real candidates');
      ok(isArr(evidenceRows(m.evidence)), 'encounter evidenceRows accepts the real evidence');
    }
    const mark = c.log.length;
    c.send('identify', { mystery: mysteryId, species: 'eurasian_wren' });
    const r = await c.wait('identifyResult', () => true, 4000, mark).catch(() => null);
    ok(r && ['certain', 'probable', 'wrong', 'insufficient'].includes(r.outcome), 'identifyResult outcome', r);
    if (r) {
      const view = resultView(r, { speciesById: state.speciesById });
      ok(view, 'encounter resultView renders the identifyResult');
      console.log(`  identify → ${r.outcome} (${r.confidence}%)`);
    }
  } else ok(false, 'no mystery to identify');

  // Photograph it.
  {
    bird = (await findWren()) || bird;
    const zoom = w.profile.stats.camZoom;
    const pitch = bird ? Math.atan2(bird.y - eye.y, Math.hypot(bird.x - eye.x, bird.z - eye.z)) : 0;
    if (bird) yaw = headingTo(eye, bird);
    current = pose(eye, yaw, { crouch: true, tool: 'camera', raised: true, zoom, fov: 50 / zoom, pitch });
    await sleep(300);
    const mark = c.log.length;
    c.send('photo', { x: eye.x, y: eye.y, z: eye.z, yaw, pitch, fov: 50 / zoom, aspect: 1.6, sharp: 1, shake: 0, img: TINY_JPEG });
    const r = await c.wait('photoResult', () => true, 4000, mark).catch(() => null);
    ok(r, 'photo answered with photoResult', c.since(mark).filter((m) => m.t === 'error').map((m) => m.d.msg));
    if (r) {
      ok(isArr(r.notes), 'photoResult.notes is an array', r.notes);
      ok(Number.isFinite(r.filmLeft), 'photoResult.filmLeft');
      if (r.photo) {
        ok(isArr(r.photo.subjects) && isArr(r.photo.tags), 'photoResult.photo subjects/tags arrays', r.photo);
        const img = await fetch(BASE + r.photo.url);
        ok(img.status === 200 && /image\/jpeg/.test(img.headers.get('content-type') || ''), 'the photo is served at photo.url', img.status);
        console.log(`  photo → ${r.photo.stars}★ score ${r.photo.score}`);
      }
    }
  }

  // Recording (no recorder yet → a gentle error is the expected answer).
  {
    const mark = c.log.length;
    c.send('recStart', {});
    const e = await c.wait('error', () => true, 2000, mark).catch(() => null);
    ok(e && typeof e.msg === 'string', 'recStart without a recorder answers with an error', e);
  }

  // Talk to Mara (accept the tutorial).
  {
    const poi = w.pois.find((p) => p.id === 'npc_mara');
    let at = null;
    for (let i = 0; i < 16 && !at; i++) {
      const h = i / 16 * Math.PI * 2;
      const fx = poi.pos.x + Math.sin(h) * 2, fz = poi.pos.z - Math.cos(h) * 2;
      const gy = await groundAt(c, fx, fz);
      if (gy > 0.2) at = { x: fx, y: gy, z: fz };
    }
    eye = { x: at.x, y: at.y + 1.65, z: at.z };
    yaw = headingTo(eye, poi.pos);
    current = pose(eye, yaw);
    await sleep(400);
    let mark = c.log.length;
    c.send('interact', { poi: 'npc_mara' });
    let node = await c.wait('dialog', () => true, 3000, mark).catch(() => null);
    ok(node && isArr(node.lines) && isArr(node.choices), 'interact with Mara opens a dialog with lines and choices', node);
    let accepted = false;
    for (let step = 0; node && step < 20 && node.choices?.length; step++) {
      const v = dialogView(node);
      ok(v, 'encounter dialogView renders the node');
      const pick = node.choices.find((x) => x.id === 'accept:unseen_singer') || node.choices.find((x) => x.kind === 'accept')
        || node.choices.find((x) => x.kind === 'next') || node.choices.find((x) => x.kind === 'bye') || node.choices[0];
      if (pick.kind === 'accept') accepted = true;
      mark = c.log.length;
      c.send('dialogChoice', { npc: node.npc, choice: pick.id });
      node = await c.wait('dialog', () => true, 3000, mark).catch(() => null);
      if (accepted) break;
    }
    await c.wait('profile', (d) => d.quests?.unseen_singer?.status === 'active', 3000).catch(() => null);
    const p = prof();
    ok(accepted && p.quests?.unseen_singer?.status === 'active', 'the tutorial is active after talking to Mara', p.quests?.unseen_singer);
    ok(Object.keys(p.equipped || {}).includes('audio') || (p.inventory || []).some((s) => /recorder/.test(s.item)), 'Mara handed over a recorder');
    // Close the conversation.
    if (node?.choices?.length) {
      const bye = node.choices.find((x) => x.kind === 'bye');
      if (bye) { mark = c.log.length; c.send('dialogChoice', { npc: node.npc, choice: bye.id }); const z = await c.wait('dialog', () => true, 3000, mark).catch(() => null); ok(z && !z.lines?.length && !z.choices?.length, 'bye closes the dialog with an empty node', z); }
    }
  }

  // Record now that the recorder is equipped.
  {
    const mark = c.log.length;
    c.send('recStart', {});
    const rs = await c.wait('recState', () => true, 3000, mark).catch(() => null);
    ok(rs && Number.isFinite(rs.level) && Number.isFinite(rs.seconds), 'recState streams while recording', c.since(mark).filter((m) => m.t === 'error').map((m) => m.d.msg));
    await sleep(1200);
    const m2 = c.log.length;
    c.send('recStop', {});
    const rr = await c.wait('recResult', () => true, 3000, m2).catch(() => null);
    ok(rr && isArr(rr.notes), 'recStop answers with recResult (notes array)', rr);
  }

  // Open the cabin.
  {
    const cabin = w.pois.find((p) => p.id === 'cabin');
    let at = null;
    for (let i = 0; i < 16 && !at; i++) {
      const h = cabin.yaw + i / 16 * Math.PI * 2;
      const fx = cabin.pos.x + Math.sin(h) * 4, fz = cabin.pos.z - Math.cos(h) * 4;
      const gy = await groundAt(c, fx, fz);
      if (gy > 0.2) at = { x: fx, y: gy, z: fz };
    }
    eye = { x: at.x, y: at.y + 1.65, z: at.z };
    current = pose(eye, headingTo(eye, cabin.pos));
    await sleep(700);
    const mark = c.log.length;
    c.send('interact', { poi: 'cabin' });
    const base = await c.wait('base', () => true, 3000, mark).catch(() => null);
    ok(base && Number.isFinite(base.filmDeveloped), 'interact with the cabin sends base {filmDeveloped}', c.since(mark).filter((m) => m.t === 'error').map((m) => m.d.msg));
    const m2 = c.log.length;
    c.send('cabin', { action: 'rest', until: 12 });
    const env2 = await c.wait('env', (e) => Math.abs(e.time - 12) < 0.2, 3000, m2).catch(() => null);
    ok(env2, 'rest at the cabin moves the clock (env)', c.since(m2).filter((m) => m.t === 'error').map((m) => m.d.msg));
  }

  // Buy a skill.
  {
    c.send('debug', { cmd: 'skillpoints', args: ['2'] });
    await sleep(300);
    const p0 = prof();
    const skill = w.skills.find((s) => s.id === 'keen_ears');
    const st = skillState(skill, p0, { tiers: w.skillTiers, skills: w.skills, ranks: w.ranks, disciplines: w.disciplines });
    ok(st && st.canBuy, 'menu skillState says keen_ears can be bought', st);
    const mark = c.log.length;
    c.send('skill', { id: 'keen_ears' });
    const p = await c.wait('profile', (d) => d.skills?.keen_ears === 1, 3000, mark).catch(() => null);
    ok(p, 'buying keen_ears answers with a profile', c.since(mark).filter((m) => m.t === 'error').map((m) => m.d.msg));
    if (p) {
      checkProfile(p, 'profile after skill');
      ok(isArr(rankProgress(nextRank(w.ranks, p) || w.ranks[1], p, p.quests)), 'menu rankProgress');
      ok(capacityUsage(p, p.stats.capacity), 'menu capacityUsage');
      ok(speciesCards(w.species, p).length > 0, 'journal speciesCards');
    }
  }

  // Narration: shape and the client queue.
  section('narration and stream hygiene');
  const narr = c.log.filter((m) => m.t === 'narrate');
  const q = createQueue();
  for (const m of narr) {
    ok(typeof m.d.text === 'string' && m.d.text && Number.isFinite(m.d.priority) && Number.isFinite(m.d.ttl) && typeof m.d.kind === 'string', 'narrate message shape', m.d);
    try { if (admit(m.d, 'normal')) q.push?.(m.d, 0); } catch (err) { ok(false, 'narrator queue accepts the line', String(err)); }
  }
  console.log(`  ${narr.length} narrate lines:`, narr.map((m) => m.d.text));

  // Nothing before identification names the wren (except the welcome catalog, candidates and indices).
  const idAt = c.log.findIndex((m) => m.t === 'identifyResult');
  const leaks = c.log.slice(0, idAt < 0 ? c.log.length : idAt).filter((m) => m.t !== 'welcome' && m.t !== 'birds')
    .filter((m) => {
      const d = JSON.parse(JSON.stringify(m.d));
      if (d.candidates) delete d.candidates;
      if (d.journal?.mysteries) for (const x of d.journal.mysteries) delete x.candidates;
      if (m.t === 'toast' && /^debug /.test(d.title)) return false; // our own debug spawn command
      return /wren/i.test(JSON.stringify(d));
    });
  ok(leaks.length === 0, 'no message before the identification names the wren', leaks.map((m) => m.t + ' ' + JSON.stringify(m.d).slice(0, 200)));
  const errors = c.log.filter((m) => m.t === 'error').map((m) => m.d.msg);
  console.log('  server errors seen (expected: bad chunk, recStart without recorder):', errors);
  const types = {};
  for (const m of c.log) types[m.t] = (types[m.t] || 0) + 1;
  console.log('  message counts:', JSON.stringify(types));
  const known = new Set(['welcome', 'env', 'birds', 'call', 'clue', 'cue', 'sighting', 'profile', 'toast', 'rewards', 'rareItem', 'region', 'rankUp', 'photoResult', 'recResult', 'recState', 'identifyResult', 'dialog', 'base', 'teleport', 'lure', 'pois', 'narrate', 'error']);
  ok(Object.keys(types).every((t) => known.has(t)), 'only protocol message types arrive', Object.keys(types));
  for (const m of c.log.filter((x) => x.t === 'pois')) ok(isArr(m.d.pois) && isArr(m.d.trails), 'pois message has pois/trails arrays', m.d);

  clearInterval(poseTimer);
  c.ws.close();
  console.log(`\n${passes} checks passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
