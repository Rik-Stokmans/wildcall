// Pure game-menu logic: no DOM, no three.js, no kit imports, so it runs under node --test.
// Everything takes plain data shaped like the wire types in internal/proto (Profile,
// SkillDef, TierReq, ItemDef, RankDef ...) and returns plain data for the views to draw.

export const SLOTS = ['optics', 'camera', 'audio', 'backpack', 'navigation', 'clothing'];
export const SLOT_NAMES = {
  optics: 'Optics', camera: 'Camera', audio: 'Audio', backpack: 'Backpack',
  navigation: 'Navigation', clothing: 'Clothing',
};
export const FACTION_NAMES = {
  naturalists: 'Naturalists', outfitters: 'Outfitters', research: 'Research', rangers: 'Rangers',
};

/** Index a list (or already-indexed object) of defs by id. */
export function byId(list) {
  if (!list) return {};
  if (!Array.isArray(list)) return list;
  const out = {};
  for (const x of list) out[x.id] = x;
  return out;
}

/* ------------------------------------------------------------------ skills */

/** Requirement of a tier: {tier, points, rank, label}; tier I (or unknown) needs nothing. */
export function tierRequirement(tiers, tier) {
  const t = (tiers || []).find((x) => x.tier === tier);
  return { tier, points: t?.points || 0, rank: t?.rank || 0, label: t?.label || '' };
}

/**
 * Skill points invested in a discipline = cost x ranks bought, summed (the same rule the
 * server uses to check tier requirements).
 * @param {object} profile
 * @param {object[]|object} skills SkillDef list or id-indexed map
 */
export function pointsInDiscipline(profile, skills, discipline) {
  const owned = profile?.skills || {};
  let n = 0;
  for (const s of Object.values(byId(skills))) {
    if (s.discipline !== discipline) continue;
    n += (s.cost || 1) * Math.min(Math.max(owned[s.id] || 0, 0), s.maxRank || 1);
  }
  return n;
}

/**
 * Derive the display state of one skill node. `env` = {tiers, skills, ranks, disciplines}
 * (the welcome's skillTiers, skills, ranks, disciplines; skills may be a list or id map).
 *  state     'purchased' (rank >= 1) | 'available' (tier requirement met, none bought) | 'locked'
 *  maxed     every rank bought
 *  canBuy    the next rank could be bought right now (requirement met AND affordable)
 *  reason    why not, in plain language ('' when canBuy or maxed)
 *  tierMet   points + rank requirement of the tier are satisfied
 */
export function skillState(skill, profile, env = {}) {
  const { tiers, skills, ranks, disciplines } = env;
  const rank = Math.max(0, profile?.skills?.[skill.id] || 0);
  const maxRank = skill.maxRank || 1;
  const cost = skill.cost || 1;
  const req = tierRequirement(tiers, skill.tier);
  const have = pointsInDiscipline(profile, skills, skill.discipline);
  const playerRank = profile?.rank || 1;
  const pointsMet = have >= req.points;
  const rankMet = playerRank >= req.rank;
  const tierMet = pointsMet && rankMet;
  const maxed = rank >= maxRank;
  const unspent = profile?.skillPoints || 0;
  const dName = (disciplines || []).find((d) => d.id === skill.discipline)?.name || skill.discipline;

  let reason = '';
  if (!maxed) {
    if (!rankMet) reason = `Opens at the rank of ${rankTitle(ranks, req.rank)}.`;
    else if (!pointsMet) reason = `Needs ${req.points} points in ${dName} (you have ${have}).`;
    else if (unspent < cost) reason = `Costs ${cost} skill point${cost === 1 ? '' : 's'} (you have ${unspent}).`;
  }
  return {
    rank, maxRank, cost, maxed, tierMet, pointsHave: have, pointsNeed: req.points, rankNeed: req.rank,
    state: rank >= 1 ? 'purchased' : tierMet ? 'available' : 'locked',
    canBuy: !maxed && tierMet && unspent >= cost,
    reason,
  };
}

function rankTitle(ranks, index) {
  return (ranks || []).find((r) => r.index === index)?.title || `rank ${index}`;
}

/** Human text for a tier band: "3 points in Acoustics" (+ " and Naturalist rank 3"). */
export function tierRequirementText(req, disciplineName, ranks) {
  const parts = [];
  if (req.points > 0) parts.push(`${req.points} points in ${disciplineName}`);
  if (req.rank > 1) parts.push(`rank of ${rankTitle(ranks, req.rank)}`);
  return parts.length ? parts.join(' and ') : 'Available from the start';
}

/**
 * Lay a discipline's skills out by tier: [{tier, req, skills:[SkillDef...]}] for tiers 1..4,
 * keeping the catalog order inside a tier.
 */
export function disciplineLayout(skills, discipline, tiers) {
  const list = Object.values(byId(skills)).filter((s) => s.discipline === discipline);
  const out = [];
  for (let t = 1; t <= 4; t++) {
    out.push({ tier: t, req: tierRequirement(tiers, t), skills: list.filter((s) => s.tier === t) });
  }
  return out;
}

/** Count of skills with at least one rank in a discipline, and total skills. */
export function disciplineCounts(profile, skills, discipline) {
  const list = Object.values(byId(skills)).filter((s) => s.discipline === discipline);
  return { learned: list.filter((s) => (profile?.skills?.[s.id] || 0) > 0).length, total: list.length };
}

/* --------------------------------------------------------------- inventory */

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'gadgets', label: 'Gadgets' },
  { id: 'supplies', label: 'Supplies' },
  { id: 'keepsakes', label: 'Keepsakes' },
  { id: 'larder', label: 'Food' }, // c-field: foraged ingredients, pantry staples and cooked food
];
export const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'rarity', label: 'Rarity' },
  { id: 'tier', label: 'Tier' },
  { id: 'type', label: 'Type' },
];
const KIND_FILTER = { equipment: 'equipment', gadget: 'gadgets', supply: 'supplies', keepsake: 'keepsakes', ingredient: 'larder', food: 'larder' };
const KIND_ORDER = { equipment: 0, gadget: 1, supply: 2, keepsake: 3, food: 4, ingredient: 5 };

/** Filter id an item belongs to ('equipment' | 'gadgets' | 'supplies' | 'keepsakes'). */
export function itemCategory(def) {
  return KIND_FILTER[def?.kind] || 'equipment';
}

/** Stacks matching a filter id, in their original order. Stacks of unknown items are kept under 'all'. */
export function filterStacks(stacks, items, filter) {
  const defs = byId(items);
  return (stacks || []).filter((s) => filter === 'all' || !filter || (defs[s.item] && itemCategory(defs[s.item]) === filter));
}

/** Sorted copy of stacks. Rarity and tier sort high to low; ties break by name so the order is stable. */
export function sortStacks(stacks, items, sort) {
  const defs = byId(items);
  const d = (s) => defs[s.item] || {};
  const name = (s) => (d(s).name || s.item || '').toLowerCase();
  const cmpName = (a, b) => name(a).localeCompare(name(b));
  const cmp = {
    name: cmpName,
    rarity: (a, b) => (d(b).rarity | 0) - (d(a).rarity | 0) || cmpName(a, b),
    tier: (a, b) => (d(b).tier | 0) - (d(a).tier | 0) || cmpName(a, b),
    type: (a, b) => (KIND_ORDER[d(a).kind] ?? 9) - (KIND_ORDER[d(b).kind] ?? 9)
      || String(d(a).slot || '').localeCompare(String(d(b).slot || '')) || cmpName(a, b),
  }[sort] || cmpName;
  return [...(stacks || [])].sort(cmp);
}

/**
 * Backpack usage. Equipped items live outside Inventory and do not count; gadgets and
 * keepsakes do, one slot per stack (the server's rule: each ItemStack occupies a slot).
 */
export function capacityUsage(profile, capacity) {
  const used = (profile?.inventory || []).length;
  const cap = Math.round(capacity || 0);
  return { used, cap, full: cap > 0 && used >= cap };
}

/** Is the item equippable from the backpack (equipment kind with a slot)? */
export function canEquip(def) {
  return !!def && def.kind === 'equipment' && !!def.slot;
}

/** Can a supply be used from the menu? Food and edible ingredients (use "eat") too (c-field). */
export function canUse(def) {
  if (!def || !def.use) return false;
  if (def.kind === 'supply') return true;
  return def.use === 'eat' && (def.kind === 'food' || def.kind === 'ingredient');
}

/** The button label for using an item from the pack (c-field: drinks are drunk). */
export function useLabel(def) {
  if (def?.use === 'eat') return def.buff?.slot === 'drink' ? 'Drink' : 'Eat';
  return def?.use === 'film' ? 'Load film' : def?.use === 'seed' ? 'Scatter seed' : 'Use';
}

/* ------------------------------------------------------------- comparisons */

/**
 * Per-stat difference between an item and the gear it would replace.
 * `from` and `to` are ItemDef.mods style maps (additive stat modifiers); either may be
 * undefined (empty slot). Returns rows for every stat that differs, in alphabetical key order.
 * @param {(key:string, delta:number)=>boolean} [isGood] defaults to "higher is better"
 */
export function compareMods(from, to, isGood = (_k, d) => d >= 0) {
  const a = from || {}, b = to || {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const rows = [];
  for (const key of keys) {
    const x = a[key] || 0, y = b[key] || 0;
    const delta = round(y - x);
    if (delta === 0) continue;
    rows.push({ key, from: x, to: y, delta, good: isGood(key, delta) });
  }
  return rows;
}

/** Mods of an item including the purchased upgrades listed in profile.upgrades. */
export function effectiveMods(def, profile) {
  if (!def) return {};
  const out = { ...(def.mods || {}) };
  const bought = profile?.upgrades?.[def.id] || [];
  for (const up of def.upgrades || []) {
    if (!bought.includes(up.id)) continue;
    for (const [k, v] of Object.entries(up.mods || {})) out[k] = round((out[k] || 0) + v);
  }
  return out;
}

/** Upgrades of an item split into owned and still-available. */
export function upgradeLists(def, profile) {
  const bought = profile?.upgrades?.[def?.id] || [];
  const all = def?.upgrades || [];
  return { owned: all.filter((u) => bought.includes(u.id)), available: all.filter((u) => !bought.includes(u.id)) };
}

/**
 * Items of a slot the player owns (backpack + cabin storage), excluding the equipped one.
 * Returns [{item, def, where:'inventory'|'storage'}].
 */
export function alternativesForSlot(profile, items, slot) {
  const defs = byId(items);
  const out = [];
  const add = (stacks, where) => {
    for (const s of stacks || []) {
      const def = defs[s.item];
      if (def && def.kind === 'equipment' && def.slot === slot) out.push({ item: s.item, def, where });
    }
  };
  add(profile?.inventory, 'inventory');
  add(profile?.storage, 'storage');
  return out;
}

function round(v) { return Math.round(v * 1000) / 1000; }

/* -------------------------------------------------------------- stats view */

/**
 * Group a core.Stats object for the compact readout using a STAT_INFO table
 * ({label, unit, better, group}). Returns [{group, rows:[{key, value, info}]}] in the order
 * the groups first appear in `info`.
 */
export function groupStats(stats, info) {
  const groups = new Map();
  for (const [key, meta] of Object.entries(info || {})) {
    if (typeof stats?.[key] !== 'number') continue;
    if (!groups.has(meta.group)) groups.set(meta.group, []);
    groups.get(meta.group).push({ key, value: stats[key], info: meta });
  }
  return [...groups].map(([group, rows]) => ({ group, rows }));
}

/* -------------------------------------------------------------------- rank */

/** Number of identified species (entries in journal.species). */
export function speciesIdentified(profile) {
  return Object.keys(profile?.journal?.species || {}).length;
}
/** Species documented: discovery level >= 5. */
export function speciesDocumented(profile) {
  return Object.values(profile?.journal?.species || {}).filter((e) => (e?.level || 0) >= 5).length;
}
/** Total reputation over all factions. */
export function totalReputation(profile) {
  return Object.values(profile?.rep || {}).reduce((a, b) => a + (b || 0), 0);
}

/**
 * Requirement rows for reaching a rank, each with progress.
 * Row: {id, label, have, need, done, fraction, unit?} where quest rows are boolean
 * (have 0/1 of need 1) and carry `status` ('' | available | active | complete | turned_in).
 * Returns [] for a null rank (already at the top).
 * @param {object} rank RankDef
 * @param {object} profile
 * @param {object} [quests] id-indexed QuestDef map (for the milestone quest's name)
 */
export function rankProgress(rank, profile, quests) {
  if (!rank) return [];
  const rows = [];
  const num = (id, label, have, need) => {
    if (!(need > 0)) return;
    rows.push({ id, label, have, need, done: have >= need, fraction: clamp01(have / need) });
  };
  num('level', 'Player level', profile?.level || 1, rank.reqLevel);
  num('species', 'Species identified', speciesIdentified(profile), rank.reqSpecies);
  num('docs', 'Species documented', speciesDocumented(profile), rank.reqDocs);
  num('rep', 'Total reputation', totalReputation(profile), rank.reqRep);
  if (rank.reqQuest) {
    const status = profile?.quests?.[rank.reqQuest]?.status || '';
    const done = status === 'turned_in';
    rows.push({
      id: 'quest', label: quests?.[rank.reqQuest]?.name || 'Milestone quest',
      have: done ? 1 : 0, need: 1, done, fraction: done ? 1 : status === 'complete' ? 0.9 : status === 'active' ? 0.4 : 0,
      status,
    });
  }
  return rows;
}

/** Overall fraction (0..1) toward a rank: mean of the rows' fractions. */
export function rankFraction(rows) {
  if (!rows.length) return 1;
  return rows.reduce((a, r) => a + r.fraction, 0) / rows.length;
}

/** The RankDef after the current one, or null at the top. */
export function nextRank(ranks, profile) {
  const cur = profile?.rank || 1;
  return (ranks || []).find((r) => r.index === cur + 1) || null;
}
export function currentRank(ranks, profile) {
  const cur = profile?.rank || 1;
  return (ranks || []).find((r) => r.index === cur) || null;
}

export const MAX_LEVEL = 40;

/**
 * "Next unlocks": what the next level and the next rank give. Lines are plain strings.
 * @returns {{level: string[], rank: string[], rankTitle: string}}
 */
export function nextUnlocks(profile, ranks) {
  const level = [];
  const lv = profile?.level || 1;
  if (lv < MAX_LEVEL) level.push(`Level ${lv + 1}: +1 skill point`);
  else level.push('You have reached the highest level.');
  const nr = nextRank(ranks, profile);
  const rank = [];
  if (nr) {
    if (nr.skillPoints) rank.push(`+${nr.skillPoints} skill points`);
    rank.push(...(nr.unlocks || []));
  }
  return { level, rank, rankTitle: nr?.title || '' };
}

/* ------------------------------------------------------------- formatting */

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/** 3725 -> "1h 2m"; 59 -> "0m"; under an hour shows minutes only. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** 850 -> "850 m"; 12400 -> "12.4 km". */
export function formatDistance(metres) {
  const m = Math.max(0, metres || 0);
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** 12345 -> "12,345" (locale independent so tests are stable). */
export function formatNumber(n) {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** One-line summary used on the Continue button. */
export function saveSummary(profile, ranks, welcome) {
  if (!profile) return null;
  const rank = currentRank(ranks, profile)?.title || 'Beginner';
  return {
    level: profile.level || 1,
    rank,
    species: speciesIdentified(profile),
    day: welcome?.env?.day ?? 1,
    seed: welcome?.world?.seedText || String(welcome?.seed ?? ''),
  };
}
