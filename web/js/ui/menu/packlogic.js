// Grid inventory: pure logic shared by the inventory tab, the cabin storage station and
// the shop. No DOM. It mirrors the engine's placement rules (internal/progress/grid.go,
// inventory.go) so the screens can show what a drop will do before the server answers;
// the server stays the judge, and its error text is what the player finally reads.
//
// A grid "model" is { where, W, H, stacks, limit(def) }:
//   where   'inventory' | 'storage'
//   stacks  [{item, qty, x, y, r}]  (x, y) top-left cell; r = turned a quarter (H x W)
//   limit   most units one stack of an item may hold in this grid

export const STORAGE_W = 10;
export const STORAGE_H = 12;
/** Backpacks whose stacks hold more (in the backpack only): fraction added, rounded up. */
export const PACK_STACK_BONUS = { research_backpack: 0.5 };

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/** An item's footprint in cells, turned if r. Unknown items and 0 sizes are 1x1. */
export function footprint(def, r = false) {
  const w = Math.max(1, num(def?.w, 1) | 0), h = Math.max(1, num(def?.h, 1) | 0);
  return r ? { w: h, h: w } : { w, h };
}

/** The cells a stack covers: {x, y, w, h}. */
export function rectOf(stack, items) {
  const { w, h } = footprint(items?.[stack.item], !!stack.r);
  return { x: stack.x | 0, y: stack.y | 0, w, h };
}

/** Lowest occupied row + 1 (0 for an empty grid). */
export function bottomRow(stacks, items) {
  let b = 0;
  for (const s of stacks || []) { const r = rectOf(s, items); b = Math.max(b, r.y + r.h); }
  return b;
}

/** Backpack grid size from core.Stats (packW x packH, base 5 x 4). */
export function packSize(stats) {
  const w = Math.round(num(stats?.packW, 5)), h = Math.round(num(stats?.packH, 4));
  return { w: Math.max(1, w || 5), h: Math.max(1, h || 4) };
}

/** Item stack size (1 for gear). */
export function stackSize(def) { return Math.max(1, num(def?.stack, 0) | 0); }

/** Most units one stack may hold: in the backpack the worn pack's bonus applies. */
export function stackLimit(def, where, equipped) {
  if (!def) return 1;
  let n = stackSize(def);
  const bonus = where === 'inventory' ? PACK_STACK_BONUS[equipped?.backpack] || 0 : 0;
  if (n > 1 && bonus > 0) n += Math.ceil(n * bonus);
  return n;
}

/** The model of one of the player's grids. `stacks` may override the profile's (optimistic view). */
export function gridModel(where, profile, items, stacks) {
  const list = stacks || (where === 'storage' ? profile?.storage : profile?.inventory) || [];
  const equipped = profile?.equipped || {};
  let W, H;
  if (where === 'storage') {
    W = STORAGE_W;
    H = Math.max(STORAGE_H, bottomRow(list, items));
  } else {
    ({ w: W, h: H } = packSize(profile?.stats));
  }
  return { where, W, H, stacks: list, limit: (def) => stackLimit(def, where, equipped) };
}

/** Cell → index+1 of the stack covering it (0 = free), skipping stack `skip`. */
export function occupancy(model, items, skip = -1) {
  const { W, H } = model;
  const occ = new Int32Array(Math.max(0, W * H));
  model.stacks.forEach((s, i) => {
    if (i === skip) return;
    const r = rectOf(s, items);
    for (let y = Math.max(0, r.y); y < Math.min(H, r.y + r.h); y++) {
      for (let x = Math.max(0, r.x); x < Math.min(W, r.x + r.w); x++) occ[y * W + x] = i + 1;
    }
  });
  return occ;
}

/** Cells covered by stacks. */
export function usedCells(model, items) {
  let n = 0;
  for (const v of occupancy(model, items)) if (v) n++;
  return n;
}

export function inBounds(model, x, y, w, h) {
  return x >= 0 && y >= 0 && x + w <= model.W && y + h <= model.H;
}

function freeIn(occ, W, x, y, w, h) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (occ[yy * W + xx]) return false;
  return true;
}

/** Index of the stack covering cell (x, y), or -1 (first in list order, like the server). */
export function stackAt(model, items, x, y) {
  return model.stacks.findIndex((s) => {
    const r = rectOf(s, items);
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  });
}

/** Index of the stack whose top-left cell is (x, y), or -1. */
export function topLeftAt(model, x, y) {
  return model.stacks.findIndex((s) => (s.x | 0) === x && (s.y | 0) === y);
}

/** Every cell of a footprint, row by row. */
export function cellsOf(x, y, w, h) {
  const out = [];
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) out.push({ x: xx, y: yy });
  return out;
}

const nameOf = (items, id) => items?.[id]?.name || 'item';

/**
 * What dropping the stack at (fx, fy) of grid `from` on cell (x, y) of grid `to`, turned
 * if r, would do — the server's Place rule. from and to may be the same model object.
 * → { ok, kind, reason, cells, qty?, target? }
 *   kind 'move'   the whole stack moves (cells = its new footprint)
 *        'merge'  qty units join the stack `target` (cells = that stack's footprint)
 *        'same'   dropped where it already lies: nothing to send
 *        'none' | 'oob' | 'taken' | 'full'  refused; reason is the server's text
 */
export function evaluatePlace(from, to, fx, fy, x, y, r, items) {
  const src = topLeftAt(from, fx, fy);
  if (src < 0) return { ok: false, kind: 'none', reason: 'There is nothing there to move.', cells: [] };
  const st = from.stacks[src];
  const same = from === to;
  const skip = same ? src : -1;
  const t = stackAt(to, items, x, y);
  if (t >= 0 && t !== skip && to.stacks[t].item === st.item) {
    const def = items?.[st.item];
    const lim = to.limit(def);
    const tr = rectOf(to.stacks[t], items);
    const cells = cellsOf(tr.x, tr.y, tr.w, tr.h);
    if (lim <= 1) return { ok: false, kind: 'taken', reason: `That spot is taken by the ${nameOf(items, st.item)}.`, cells };
    const room = lim - num(to.stacks[t].qty, 1);
    if (room <= 0) return { ok: false, kind: 'full', reason: `That stack of ${nameOf(items, st.item)} is already full.`, cells, target: t };
    const qty = Math.min(room, num(st.qty, 1));
    return { ok: true, kind: 'merge', reason: '', cells, target: t, qty,
      hint: qty < num(st.qty, 1) ? `${qty} of them fit on that stack; the rest stay where they were.` : `Adds them to that stack of ${nameOf(items, st.item)}.` };
  }
  const { w, h } = footprint(items?.[st.item], r);
  const cells = cellsOf(x, y, w, h);
  if (!inBounds(to, x, y, w, h)) {
    return { ok: false, kind: 'oob', reason: `The ${nameOf(items, st.item)} does not fit there.`, cells: cells.filter((c) => inBounds(to, c.x, c.y, 1, 1)) };
  }
  const occ = occupancy(to, items, skip);
  for (const c of cells) {
    const v = occ[c.y * to.W + c.x];
    if (v) return { ok: false, kind: 'taken', reason: `That spot is taken by the ${nameOf(items, to.stacks[v - 1].item)}.`, cells };
  }
  if (same && (st.x | 0) === x && (st.y | 0) === y && !!st.r === !!r) return { ok: true, kind: 'same', reason: '', cells };
  return { ok: true, kind: 'move', reason: '', cells };
}

/**
 * The grids after a successful place (for the optimistic view while the server answers).
 * Returns { from: stacks, to: stacks } (the same array twice within one grid), or null
 * when the move would be refused.
 */
export function applyPlace(from, to, fx, fy, x, y, r, items) {
  const ev = evaluatePlace(from, to, fx, fy, x, y, r, items);
  if (!ev.ok) return null;
  const src = topLeftAt(from, fx, fy);
  const a = from.stacks.map((s) => ({ ...s }));
  const b = from === to ? a : to.stacks.map((s) => ({ ...s }));
  if (ev.kind === 'same') return { from: a, to: b };
  if (ev.kind === 'merge') {
    b[ev.target].qty = num(b[ev.target].qty, 1) + ev.qty;
    a[src].qty = num(a[src].qty, 1) - ev.qty;
    if (a[src].qty <= 0) a.splice(src, 1);
    return { from: a, to: b };
  }
  if (from === to) {
    Object.assign(a[src], { x, y, r: !!r });
    return { from: a, to: a };
  }
  const [st] = a.splice(src, 1);
  b.push({ ...st, x, y, r: !!r });
  return { from: a, to: b };
}

/**
 * Snap a dragged piece to cells. (px, py) is the pointer relative to the grid's top-left
 * corner in pixels, pitch the size of one cell (including the gap), (gx, gy) where the
 * piece was grabbed as a fraction of its size (0..1) and w x h its footprint now.
 * → the cell of the piece's top-left corner (may lie outside the grid).
 */
export function snapCell(px, py, pitch, gx, gy, w, h) {
  const p = pitch > 0 ? pitch : 1;
  return { x: Math.round((px - gx * w * p) / p), y: Math.round((py - gy * h * p) / p) };
}

/** Grab point after a quarter turn: the piece turns about the pointer. */
export function turnGrab(gx, gy) {
  return { gx: 1 - gy, gy: gx };
}

/** First free spot for a w x h footprint, rows top to bottom, left to right. */
function findIn(occ, W, H, w, h) {
  for (let y = 0; y + h <= H; y++) for (let x = 0; x + w <= W; x++) if (freeIn(occ, W, x, y, w, h)) return { x, y };
  return null;
}

/** Where a new stack of an item would go: as it is first, then turned (server FindSpace). */
export function findSpace(model, items, id, occ = occupancy(model, items)) {
  const { w, h } = footprint(items?.[id]);
  let at = findIn(occ, model.W, model.H, w, h);
  if (at) return { ...at, r: false };
  if (w !== h && (at = findIn(occ, model.W, model.H, h, w))) return { ...at, r: true };
  return null;
}

/**
 * How one more unit of an item would enter a grid as it is packed now (server Grid.Add):
 * topping up a stack → {kind:'merge', target}, a new stack → {kind:'place', x, y, r},
 * or null when there is no room (the server refuses a buy then).
 */
export function addTarget(model, items, id) {
  const def = items?.[id];
  const lim = model.limit(def);
  if (lim > 1) {
    const t = model.stacks.findIndex((s) => s.item === id && num(s.qty, 1) < lim);
    if (t >= 0) return { kind: 'merge', target: t };
  }
  const at = findSpace(model, items, id);
  return at ? { kind: 'place', ...at } : null;
}

/** Does one more unit of an item fit in a grid as it is packed now? */
export function hasRoomFor(model, items, id) { return !!addTarget(model, items, id); }

/** Smallest stack of an item (the one the server's "move" takes), or -1. */
export function smallestStack(stacks, id) {
  let best = -1;
  (stacks || []).forEach((s, i) => { if (s.item === id && (best < 0 || num(s.qty, 1) < num(stacks[best].qty, 1))) best = i; });
  return best;
}

/**
 * Shift-click quick move: what the server's "move" would do with the stack at index i of
 * `from` when sent to `to`. Mirrors MoveItem: it moves the item's smallest stack, topping
 * up stacks in `to` first, then the first free spot.
 * → { ok, target: {kind, ...}|null, reason }
 */
export function quickMoveTarget(from, to, items, id) {
  const name = nameOf(items, id);
  if (smallestStack(from.stacks, id) < 0) {
    return { ok: false, target: null, reason: to.where === 'storage' ? `You are not carrying the ${name}.` : `There is no ${name} in your storage.` };
  }
  const target = addTarget(to, items, id);
  if (target) return { ok: true, target, reason: '' };
  return { ok: false, target: null, reason: to.where === 'storage'
    ? `Your cabin storage is full: no room for the ${name}. Tidy it or take something out first.`
    : `Your pack is full: no room for the ${name}.` };
}

/** Kind order of a tidied grid (after size), as the server's tidy. */
const KIND_ORDER = { equipment: 0, gadget: 1, keepsake: 2, supply: 3, ingredient: 4, food: 5 };

/**
 * The grid as the server's "tidy" would lay it out: stacks of each item poured together
 * and split at the stack limit, biggest footprint first (then the longer side, kind,
 * item id, fuller stack), placed first-fit trying three turn preferences in turn.
 * Returns the new stacks, or null when only the server's exhaustive search could do it.
 */
export function tidyLayout(model, items) {
  const order = [];
  const total = new Map();
  for (const s of model.stacks) {
    if (num(s.qty, 1) <= 0) continue;
    if (!total.has(s.item)) order.push(s.item);
    total.set(s.item, (total.get(s.item) || 0) + num(s.qty, 1));
  }
  const pieces = [];
  for (const id of order) {
    const lim = model.limit(items?.[id]);
    for (let n = total.get(id); n > 0; n -= lim) pieces.push({ item: id, qty: Math.min(n, lim) });
  }
  const fp = (it) => footprint(items?.[it]);
  const kind = (it) => KIND_ORDER[items?.[it]?.kind] ?? 9;
  pieces.sort((a, b) => {
    const fa = fp(a.item), fb = fp(b.item);
    return (fb.w * fb.h - fa.w * fa.h) || (Math.max(fb.w, fb.h) - Math.max(fa.w, fa.h)) || (kind(a.item) - kind(b.item))
      || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0) || (b.qty - a.qty);
  });
  for (let orient = 0; orient < 3; orient++) {
    const occ = new Int32Array(model.W * model.H);
    const out = [];
    for (const pc of pieces) {
      const { w, h } = fp(pc.item);
      const first = orient === 1 ? h > w : orient === 2 ? w > h : false;
      let placed = null;
      for (const r of [first, !first]) {
        const fw = r ? h : w, fh = r ? w : h;
        const at = findIn(occ, model.W, model.H, fw, fh);
        if (at) {
          for (const c of cellsOf(at.x, at.y, fw, fh)) occ[c.y * model.W + c.x] = 1;
          placed = { ...pc, x: at.x, y: at.y, r };
          break;
        }
        if (w === h) break;
      }
      if (!placed) break;
      out.push(placed);
    }
    if (out.length === pieces.length) return out;
  }
  return null;
}

/**
 * Would one more of `id` fit once the player presses Tidy? Lays the grid out the way the
 * server's tidy does, then looks for room as a buy would. (When the server needs its
 * exhaustive search the answer here is "no": a hint, never a promise.)
 */
export function fitsAfterTidy(model, items, id) {
  const tidied = tidyLayout(model, items);
  return !!tidied && hasRoomFor({ ...model, stacks: tidied }, items, id);
}

/**
 * Equipping the stack at index i of the backpack: where the item taken off (prevId) would
 * land (server fitPack: the freed spot as it is, then turned, then the first free spot).
 * → {x, y, r} | {tidy: true} (only a re-pack would make room; the server tries it) |
 *   null when nothing goes back (no previous item, or a backpack swap that resizes).
 */
export function predictSwap(pack, items, i, prevId) {
  if (!prevId) return null;
  const st = pack.stacks[i];
  if (!st) return null;
  const occ = occupancy(pack, items, i);
  const { w, h } = footprint(items?.[prevId]);
  for (const [fw, fh, r] of [[w, h, false], [h, w, true]]) {
    if (inBounds(pack, st.x, st.y, fw, fh) && freeIn(occ, pack.W, st.x, st.y, fw, fh)) return { x: st.x | 0, y: st.y | 0, r };
  }
  const at = findSpace(pack, items, prevId, occ);
  return at || { tidy: true };
}

/** Rows of booleans for a small footprint diagram: w x h filled inside a max(w,h) square. */
export function footprintDiagram(def, r = false) {
  const { w, h } = footprint(def, r);
  const n = Math.max(w, h);
  const rows = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push(x < w && y < h);
    rows.push(row);
  }
  return rows;
}

/** "2×3" for an item's footprint. */
export function footprintText(def, r = false) {
  const { w, h } = footprint(def, r);
  return `${w}×${h}`;
}

/** Cells used / total of a grid, and how full it is. */
export function usage(model, items) {
  const used = usedCells(model, items);
  const total = model.W * model.H;
  return { used, total, free: Math.max(0, total - used), frac: total ? used / total : 0, full: used >= total };
}
