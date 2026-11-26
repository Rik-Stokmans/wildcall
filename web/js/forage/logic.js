// Pure foraging and field-kitchen rules for the client (task c-field). No DOM, no
// three.js: everything here is unit-tested with node --test (logic.test.js).
//
// The server is authoritative (docs/contract.md §12); these helpers only decide what
// the client shows: which plants bear, node ids, buff clocks, what can be cooked.

/** First and last core.VegKind of the forage plants (contract §12). */
export const FIRST_FORAGE_KIND = 18;
export const LAST_FORAGE_KIND = 35;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_LABELS = ['Spring', 'Summer', 'Autumn', 'Winter'];

/** Cooking reach (contract §12 / session notes): cabin 25 m, camp 12 m. */
export const CABIN_REACH = 25;
export const CAMP_REACH = 12;

export const isForageKind = (k) => Number.isInteger(k) && k >= FIRST_FORAGE_KIND && k <= LAST_FORAGE_KIND;

/* ------------------------------------------------------------------ node ids */

/** Canonical forage node id: "fg@<cx>,<cz>,<n>" with plain integer decimals. */
export function nodeId(cx, cz, n) {
  return `fg@${cx | 0},${cz | 0},${n | 0}`;
}

const NODE_RE = /^fg@(-?\d+),(-?\d+),(\d+)$/;

/** Parses a node id; null when it is not one. */
export function parseNodeId(id) {
  const m = typeof id === 'string' ? NODE_RE.exec(id) : null;
  if (!m) return null;
  const cx = Number(m[1]), cz = Number(m[2]), n = Number(m[3]);
  // Canonical decimals only ("-0", "007" are not ids the server would accept).
  if (nodeId(cx, cz, n) !== id) return null;
  return { cx, cz, n };
}

export const isNodeId = (id) => parseNodeId(id) !== null;

/* ------------------------------------------------------------------ seasons */

/** Season index 0..3 of an EnvMsg (spring when unknown). */
export function seasonOf(env) {
  const s = Number(env?.season);
  return Number.isInteger(s) && s >= 0 && s <= 3 ? s : 0;
}

/** The plant's yield in a season (the first that applies), or null. */
export function yieldIn(plant, season) {
  for (const y of plant?.yields || []) if (y?.seasons?.[season]) return y;
  return null;
}

/** Seasons (0..3) in which a plant gives anything at all. */
export function bearingSeasons(plant) {
  const out = [];
  for (let s = 0; s < 4; s++) if (yieldIn(plant, s)) out.push(s);
  return out;
}

/**
 * Days until a picked node bears again: 0 when it is not regrowing (never picked, or
 * regrown). profile.forage maps node id → day it was picked.
 */
export function regrowDaysLeft(profile, id, plant, day) {
  const picked = profile?.forage?.[id];
  if (!Number.isFinite(picked)) return 0;
  const left = (plant?.regrow | 0) - ((day | 0) - picked);
  return left > 0 ? left : 0;
}

/**
 * Pick state of one node:
 *   'ripe'     something to pick now (yield is the PlantYield)
 *   'picked'   bears this season but is regrowing (days left in `days`)
 *   'season'   nothing in this season
 */
export function nodeState(plant, id, profile, env) {
  const season = seasonOf(env);
  const y = yieldIn(plant, season);
  if (!y) return { state: 'season', yield: null, days: 0 };
  const days = regrowDaysLeft(profile, id, plant, env?.day);
  if (days > 0) return { state: 'picked', yield: y, days };
  return { state: 'ripe', yield: y, days: 0 };
}

/** Gentle words for a non-ripe node, matching the server's reasons. */
export function stateReason(st) {
  if (st.state === 'season') return 'Nothing to pick this season.';
  if (st.state === 'picked') return st.days <= 1 ? 'Already picked. It will bear again tomorrow.' : 'Already picked. It will bear again in a few days.';
  return '';
}

/* ------------------------------------------------------------------ the game clock and buffs */

/** Absolute game hours of an EnvMsg: (day-1)*24 + time. */
export function gameHours(env) {
  const day = Number(env?.day) || 1;
  const time = Number(env?.time) || 0;
  return (day - 1) * 24 + time;
}

/**
 * Game hours now, extrapolated from the last env message: the clock advances
 * 24 game hours per `dayLen` real seconds. `since` is real seconds since that message.
 */
export function gameHoursNow(env, since) {
  const base = gameHours(env);
  const dayLen = Number(env?.dayLen);
  if (!(dayLen > 0) || !(since > 0)) return base;
  return base + Math.min(since, 5) * 24 / dayLen; // never run far ahead of the server
}

/** Remaining game hours of a buff (never negative). */
export function buffRemaining(buff, nowHours) {
  const r = (Number(buff?.until) || 0) - nowHours;
  return r > 0 ? r : 0;
}

/** Fraction 0..1 of the buff left (for the ring). */
export function buffFraction(buff, nowHours) {
  const total = Number(buff?.hours) || 0;
  if (!(total > 0)) return 0;
  const f = buffRemaining(buff, nowHours) / total;
  return f > 1 ? 1 : f;
}

/** "2 h 10 min", "45 min", "under a minute" — game time. */
export function formatHours(h) {
  if (!(h > 0)) return 'worn off';
  const mins = Math.round(h * 60);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  const hh = Math.floor(mins / 60), mm = mins % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

/** Compact clock for a chip: "2:10", "0:45". */
export function formatHoursShort(h) {
  const mins = Math.max(0, Math.ceil(h * 60));
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

export const SLOT_ORDER = ['meal', 'drink', 'snack'];
export const SLOT_LABELS = { drink: 'Drink', meal: 'Meal', snack: 'Snack' };

/** Active buffs sorted meal → drink → snack. */
export function sortBuffs(buffs) {
  return [...(buffs || [])].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
}

/** The verb for eating an item: drinks are drunk. */
export function eatVerb(def) {
  return def?.buff?.slot === 'drink' ? 'Drink' : 'Eat';
}

/** True when an item can be eaten or drunk from the pack. */
export function isEdible(def) {
  return !!def && def.use === 'eat' && !!def.buff && (def.kind === 'food' || def.kind === 'ingredient');
}

/* ------------------------------------------------------------------ pack and recipes */

/** How many of an item the pack holds (all stacks). */
export function countItem(profile, item) {
  let n = 0;
  for (const s of profile?.inventory || []) if (s?.item === item) n += s.qty | 0;
  return n;
}

/** Is the recipe known to this profile? */
export function knowsRecipe(profile, id) {
  return (profile?.recipes || []).includes(id);
}

/**
 * What cooking a recipe needs and what the pack has.
 * @returns {{inputs: {item, need, have, ok}[], ready: boolean, batches: number}}
 *   batches = how many batches the pack can make right now (0..99)
 */
export function recipeNeeds(recipe, profile) {
  let batches = 99;
  const inputs = (recipe?.inputs || []).map((s) => {
    const need = Math.max(1, s.qty | 0);
    const have = countItem(profile, s.item);
    batches = Math.min(batches, Math.floor(have / need));
    return { item: s.item, need, have, ok: have >= need };
  });
  if (!inputs.length) batches = 0;
  return { inputs, ready: batches > 0, batches };
}

/** Does a station allow a recipe? 'cabin' has kettle and stove, 'camp' only the kettle. */
export function stationAllows(at, recipe) {
  if (at === 'cabin') return true;
  if (at === 'camp') return recipe?.station === 'kettle';
  return false;
}

/**
 * The cook screen's model: recipes grouped by station, each with its state.
 *   status: 'unknown' | 'ready' | 'missing' | 'station' (needs the stove) | 'nofire'
 */
export function cookModel(recipes, profile, at) {
  const groups = [
    { station: 'kettle', label: 'Over the kettle', recipes: [] },
    { station: 'stove', label: 'On the stove', recipes: [] },
  ];
  for (const r of recipes || []) {
    const g = groups.find((x) => x.station === r.station) || groups[0];
    const known = knowsRecipe(profile, r.id);
    const needs = recipeNeeds(r, profile);
    let status;
    if (!known) status = 'unknown';
    else if (!at) status = 'nofire';
    else if (!stationAllows(at, r)) status = 'station';
    else status = needs.ready ? 'ready' : 'missing';
    g.recipes.push({ recipe: r, known, status, ...needs });
  }
  // Known first (ready ones on top), then the unknown ones, stable by the server's order.
  const rank = { ready: 0, missing: 1, nofire: 1, station: 2, unknown: 3 };
  for (const g of groups) {
    g.recipes = g.recipes.map((e, i) => ({ e, i })).sort((a, b) => rank[a.e.status] - rank[b.e.status] || a.i - b.i).map((x) => x.e);
  }
  return groups;
}

/**
 * Player-facing hint for learning a recipe: never names a plant the player has not
 * found yet (discovery is earned, spec §35).
 */
export function learnHint(recipe, { plants, npcs, profile } = {}) {
  const learn = String(recipe?.learn || '');
  const [kind, id] = learn.split(':');
  if (kind === 'start') return 'You have always known this one.';
  if (kind === 'plant') {
    const found = !!profile?.journal?.plants?.[id];
    const plant = (plants || []).find((p) => p.id === id);
    if (found && plant) return `Comes to mind once you have picked ${plant.name}.`;
    // a nudge towards where to look, never the plant's name
    const where = String(plant?.habitat || '').trim().replace(/\.$/, '');
    if (where) return `Something new from ${where.charAt(0).toLowerCase() + where.slice(1)} may bring this one to mind.`;
    return 'Pick a wild plant you have not found yet, and this one may come to you.';
  }
  if (kind === 'npc') {
    const npc = npcs?.[id];
    return npc?.name ? `${npc.name} might teach you this one.` : 'Someone in the valley knows this one.';
  }
  if (kind === 'lore') return 'Written down in an old book, somewhere out in the wild.';
  return 'Learned out in the field.';
}

/** Missing ingredients as text: "2 more Nettle and 1 more Oats". */
export function missingText(needs, items) {
  const parts = needs.inputs.filter((x) => !x.ok).map((x) => `${x.need - x.have} more ${items?.[x.item]?.name || x.item}`);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/* ------------------------------------------------------------------ where can I cook */

/**
 * Cooking place near a position: 'cabin' (within 25 m of the cabin POI) or 'camp'
 * (within 12 m of any camp POI) or null. Returns {at, poi}.
 */
export function cookPlaceAt(pos, pois) {
  if (!pos) return { at: null, poi: null };
  let camp = null, campD = Infinity;
  for (const p of Object.values(pois || {})) {
    if (!p?.pos) continue;
    const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
    if (p.kind === 'cabin' && d <= CABIN_REACH) return { at: 'cabin', poi: p };
    if (p.kind === 'camp' && d <= CAMP_REACH && d < campD) { camp = p; campD = d; }
  }
  return camp ? { at: 'camp', poi: camp } : { at: null, poi: null };
}

/* ------------------------------------------------------------------ herbarium */

/** Herbarium entries in the server's plant order with found/not found. */
export function herbariumModel(plants, profile) {
  const found = profile?.journal?.plants || {};
  return (plants || []).map((p) => ({ plant: p, entry: found[p.id] || null }));
}

/** Season words for a plant's yields: [{season, items:[ids]}] for the 4 seasons. */
export function seasonTable(plant) {
  const out = [];
  for (let s = 0; s < 4; s++) {
    out.push({ season: s, items: (plant?.yields || []).filter((y) => y?.seasons?.[s]).map((y) => y.item) });
  }
  return out;
}

/* ------------------------------------------------------------------ results */

/** Short text for a pick result's items: "Blackberry ×2, Nettle ×1". */
export function gotText(got, items) {
  return (got || []).filter((g) => g && g.qty > 0).map((g) => `${items?.[g.item]?.name || g.item} ×${g.qty}`).join(', ');
}

/** Profile diff: buffs that disappeared (by item+slot), for the chip fade-out. */
export function goneBuffs(prev, next) {
  const key = (b) => b.slot + ':' + b.item + ':' + b.until;
  const keep = new Set((next || []).map(key));
  return (prev || []).filter((b) => !keep.has(key(b)));
}

/* ------------------------------------------------------------------ the pick motion */

/** Smooth 0 → 1 → 0 bump over t in [0, 1]: a quick reach down, a short hold, a slower rise. */
export function dipCurve(t) {
  if (!(t > 0) || t >= 1) return 0;
  if (t < 0.35) { const u = t / 0.35; return u * u * (3 - 2 * u); }
  if (t < 0.5) return 1;
  const u = (t - 0.5) / 0.5;
  return 1 - u * u * (3 - 2 * u);
}
