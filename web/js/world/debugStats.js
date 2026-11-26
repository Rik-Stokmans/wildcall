// Per-category render statistics for one frame, computed only on demand
// (ctx.world.debugStats()). Every drawable in the scene is tagged with a category
// (terrain, trees by detail and part, ground cover per layer and ring, water, birds…);
// for one frame its draw calls and triangles are counted from renderer.info deltas
// around its own draw, in the main pass and in the shadow pass separately. What is left
// of the frame's totals afterwards is the post-processing (full-screen passes).
//
// statCategory() is pure (tested); collectFrameStats() needs a three.js renderer.

const DETAIL_NAMES = ['far', 'mid', 'near', 'giant'];

/** Top-level groups of other modules → category. */
const OWNERS = new Map([
  ['forage', 'forage'], ['nests', 'nests'], ['birds', 'birds'], ['birds-fx', 'birds'],
  ['props', 'props'], ['sky-precip', 'sky'], ['ground-cover', 'ground'],
]);

/**
 * The statistics category of a drawable (by its name, else its owning group).
 * @param {{name?:string, parent?:object}} obj
 * @returns {string} dotted category, e.g. 'trees.near.leaf', 'ground.grass.r2'
 */
export function statCategory(obj) {
  const n = obj?.name || '';
  if (n === 'terrain') return 'terrain';
  if (n === 'water') return 'water';
  if (n.startsWith('tree:')) {
    const m = /^tree:([a-z_]+)\/\d+\/(wood|leaf)(\d)$/.exec(n);
    if (!m) return 'trees.other';
    if (m[1] === 'shrub') return `shrubs.${m[2]}`;
    return `trees.${DETAIL_NAMES[+m[3]] || m[3]}.${m[2]}`;
  }
  if (n.startsWith('veg:')) return 'vegetation.' + n.slice(4);
  if (n.startsWith('ground:')) {
    const [, layer, ring] = n.split(':');
    return `ground.${layer}.r${ring}`;
  }
  if (n.startsWith('sky-')) return 'sky';
  for (let o = obj.parent; o; o = o.parent) {
    const c = OWNERS.get(o.name);
    if (c) return c;
  }
  return 'other' + (n ? ':' + n : '');
}

/**
 * Adds one draw to a stats table.
 * @param {object} table  category → {calls, tris, shadowCalls, shadowTris}
 */
export function addStat(table, cat, calls, tris, shadow) {
  let r = table[cat];
  if (!r) r = table[cat] = { calls: 0, tris: 0, shadowCalls: 0, shadowTris: 0 };
  if (shadow) { r.shadowCalls += calls; r.shadowTris += tris; } else { r.calls += calls; r.tris += tris; }
}

/**
 * Sums a stats table into coarser groups: the first `depth` parts of each category.
 * @returns {object} group → {calls, tris, shadowCalls, shadowTris}
 */
export function rollup(table, depth = 1) {
  const out = {};
  for (const [cat, r] of Object.entries(table)) {
    const key = cat.split('.').slice(0, depth).join('.');
    addStat(out, key, r.calls, r.tris, false);
    addStat(out, key, r.shadowCalls, r.shadowTris, true);
  }
  return out;
}

const HOOKS = ['onBeforeRender', 'onAfterRender', 'onBeforeShadow', 'onAfterShadow'];

/**
 * Renders one frame with per-object counting and returns the breakdown.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {() => void} renderFrame  draws one complete frame (post-processing included)
 * @returns {{total:{calls:number, tris:number}, byCategory:object, byGroup:object}}
 */
export function collectFrameStats(renderer, scene, renderFrame) {
  const info = renderer.info.render;
  const table = {};
  const saved = [];
  let c0 = 0, t0 = 0;
  scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
    const cat = statCategory(o);
    const own = {};
    for (const h of HOOKS) own[h] = Object.prototype.hasOwnProperty.call(o, h) ? o[h] : undefined;
    saved.push([o, own]);
    o.onBeforeRender = function (...a) { if (own.onBeforeRender) own.onBeforeRender.apply(this, a); c0 = info.calls; t0 = info.triangles; };
    o.onAfterRender = function (...a) { addStat(table, cat, info.calls - c0, info.triangles - t0, false); if (own.onAfterRender) own.onAfterRender.apply(this, a); };
    o.onBeforeShadow = function (...a) { if (own.onBeforeShadow) own.onBeforeShadow.apply(this, a); c0 = info.calls; t0 = info.triangles; };
    o.onAfterShadow = function (...a) { addStat(table, cat, info.calls - c0, info.triangles - t0, true); if (own.onAfterShadow) own.onAfterShadow.apply(this, a); };
  });
  let total;
  try {
    renderFrame();
    total = { calls: info.calls, tris: info.triangles };
  } finally {
    for (const [o, own] of saved) {
      for (const h of HOOKS) {
        if (own[h] !== undefined) o[h] = own[h];
        else delete o[h];
      }
    }
  }
  // Whatever was drawn outside the scene's own objects: full-screen post passes.
  let calls = 0, tris = 0;
  for (const r of Object.values(table)) { calls += r.calls + r.shadowCalls; tris += r.tris + r.shadowTris; }
  addStat(table, 'post', Math.max(0, total.calls - calls), Math.max(0, total.tris - tris), false);
  return { total, byCategory: table, byGroup: rollup(table, 1) };
}

/** A compact text table of a stats result (for logs and the screenshot harness). */
export function formatStats(s) {
  const rows = Object.entries(s.byCategory).sort((a, b) => (b[1].tris + b[1].shadowTris) - (a[1].tris + a[1].shadowTris));
  const k = (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v));
  const lines = [`TOTAL calls=${s.total.calls} tris=${k(s.total.tris)}`];
  for (const [cat, r] of rows) {
    if (!r.calls && !r.shadowCalls) continue;
    lines.push(`  ${cat.padEnd(26)} calls ${String(r.calls).padStart(4)} tris ${k(r.tris).padStart(7)} | shadow calls ${String(r.shadowCalls).padStart(4)} tris ${k(r.shadowTris).padStart(7)}`);
  }
  return lines.join('\n');
}
