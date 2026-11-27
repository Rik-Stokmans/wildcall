// Pure quest-log derivation: which quests appear in which tab, grouped by category, with
// objective progress, giver names and reward lines. Hidden quests only appear once the
// player has a QuestState for them.

import { capital } from './format.js';

export const CATEGORIES = [
  { id: 'research', label: 'Research', icon: 'knowledge' },
  { id: 'photography', label: 'Photography', icon: 'camera' },
  { id: 'exploration', label: 'Exploration', icon: 'compass' },
  { id: 'acoustic', label: 'Acoustic', icon: 'ear' },
  { id: 'conservation', label: 'Conservation', icon: 'leaf' },
];

export function categoryInfo(id) {
  return CATEGORIES.find((c) => c.id === id) || { id, label: capital(id), icon: 'quest' };
}

/** Tab a quest state belongs to, or null if it is not listed. */
export function tabOf(state) {
  switch (state?.status) {
    case 'active': case 'complete': return 'active';
    case 'available': return 'available';
    case 'turned_in': return 'completed';
    default: return null;
  }
}

/**
 * {active, available, completed}: each an ordered list of {def, state}.
 * A quest with no QuestState is never listed (this also keeps hidden quests secret).
 */
export function questTabs(defs, profileQuests) {
  const tabs = { active: [], available: [], completed: [] };
  for (const def of defs || []) {
    const state = profileQuests?.[def.id];
    const tab = tabOf(state);
    if (!tab) continue;
    tabs[tab].push({ def, state });
  }
  const rank = (q) => (q.def.tutorial ? 0 : 1);
  for (const list of Object.values(tabs)) {
    list.sort((a, b) => (rank(a) - rank(b)) || (b.state.status === 'complete') - (a.state.status === 'complete') || a.def.name.localeCompare(b.def.name));
  }
  return tabs;
}

/** Group a tab's entries by category in the canonical category order. */
export function groupByCategory(entries) {
  const map = new Map();
  for (const e of entries) {
    const c = e.def.category;
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(e);
  }
  const out = [];
  for (const c of CATEGORIES) if (map.has(c.id)) out.push({ ...c, entries: map.get(c.id) });
  for (const [id, entries] of map) if (!CATEGORIES.some((c) => c.id === id)) out.push({ ...categoryInfo(id), entries });
  return out;
}

/**
 * Objective rows with progress. For ordered quests only the first unfinished objective is
 * "current"; later ones are "locked" (shown dim, hint withheld).
 */
export function objectiveRows(def, state) {
  const rows = [];
  let currentTaken = false;
  for (const o of def.objectives || []) {
    const need = Math.max(1, o.count || 1);
    const have = Math.min(need, Math.max(0, state?.progress?.[o.id] || 0));
    const done = have >= need || state?.status === 'turned_in';
    let status = done ? 'done' : 'open';
    if (!done) {
      if (def.ordered) {
        status = currentTaken ? 'locked' : 'current';
        currentTaken = true;
      } else {
        status = 'current';
      }
    }
    rows.push({ id: o.id, text: o.text, hint: status === 'current' ? o.hint : '', need, have: done ? need : have, done, status, kind: o.kind, params: o.params || null });
  }
  return rows;
}

const PARAM_WORDS = {
  minStars: (v) => `${v}★ or better`,
  method: (v) => ({ sight: 'by sight', sound: 'by ear', photo: 'from a photo', mixed: 'by sight and sound' })[v] || capital(v),
  behavior: (v) => `while ${String(v).replace(/_/g, ' ')}`,
  phase: (v) => `at ${String(v).toLowerCase()}`,
  rarity: (v) => `${v} birds`,
  distinct: (v) => (v === 'true' ? 'each one different' : ''),
};

/**
 * Where and how an objective counts, as short display words: ["in Murmur Marsh", "2★ or
 * better"]. Region and habitat keys are resolved to names; unknown params are skipped.
 */
export function objectiveConditions(params, regions) {
  const out = [];
  if (!params) return out;
  if (params.region) out.push('in ' + (regions?.find((r) => r.key === params.region)?.name || capital(params.region)));
  if (params.habitat) out.push('in ' + String(params.habitat).replace(/_/g, ' '));
  for (const k of ['method', 'minStars', 'behavior', 'phase', 'rarity', 'distinct']) {
    if (params[k] != null && params[k] !== '') { const w = PARAM_WORDS[k](params[k]); if (w) out.push(w); }
  }
  return out;
}

/**
 * Requirements that gate a quest: naturalist rank, reputation per faction and earlier
 * quests, each with the player's standing. [{kind, text, met, have?, need?}]
 */
export function requirementRows(def, profile, { ranks, quests } = {}) {
  const rows = [];
  if (!def) return rows;
  const rank = profile?.rank || 1;
  if ((def.reqRank || 0) > 1) {
    const title = ranks?.find((r) => r.index === def.reqRank)?.title || `rank ${def.reqRank}`;
    const cur = ranks?.find((r) => r.index === rank)?.title || `rank ${rank}`;
    rows.push({ kind: 'rank', text: `Naturalist rank: ${title}`, short: `Needs the rank of ${title}`, met: rank >= def.reqRank, have: cur, need: title });
  }
  for (const [f, need] of Object.entries(def.reqRep || {})) {
    if (!(need > 0)) continue;
    const have = profile?.rep?.[f] || 0;
    const name = FACTION_NAMES[f] || capital(f);
    rows.push({ kind: 'rep', faction: f, text: `${name} reputation ${need}`, short: `Needs ${need} ${name} reputation`, met: have >= need, have, need });
  }
  for (const id of def.requires || []) {
    const q = quests?.[id];
    const text = `Finish ${q?.name && !q.hidden ? q.name : 'an earlier quest'}`;
    rows.push({ kind: 'quest', text, short: text, met: profile?.quests?.[id]?.status === 'turned_in' });
  }
  return rows;
}

/**
 * Quests the player can see coming but cannot take yet: not started, not hidden (or
 * revealed), every earlier quest done, but rank or reputation still short. Sorted by
 * how close they are (fewest unmet requirements first).
 */
export function lockedQuests(defs, profile, opts = {}) {
  const out = [];
  for (const def of defs || []) {
    if (!def || def.tutorial || profile?.quests?.[def.id]) continue;
    if (def.hidden && !profile?.flags?.['quest:' + def.id]) continue;
    const reqs = requirementRows(def, profile, opts);
    if (reqs.some((r) => r.kind === 'quest' && !r.met)) continue;
    const unmet = reqs.filter((r) => !r.met);
    if (!unmet.length) continue; // it would be available; the server lists those itself
    out.push({ def, state: { status: 'locked', progress: {} }, reqs, unmet: unmet.length });
  }
  out.sort((a, b) => a.unmet - b.unmet || a.def.name.localeCompare(b.def.name));
  return out;
}

/** {done, total, frac} over the objectives. */
export function questProgress(def, state) {
  const rows = objectiveRows(def, state);
  const done = rows.filter((r) => r.done).length;
  return { done, total: rows.length, frac: rows.length ? done / rows.length : 0 };
}

/** NPC id / "board" -> display name of the quest giver. */
export function giverName(giver, npcs) {
  if (giver === 'board') return 'Cabin research board';
  return npcs?.[giver]?.name || (giver ? capital(giver) : 'Unknown');
}

/** The turn-in reminder for a finished quest. */
export function turnInText(def, npcs) {
  if (def.giver === 'board') return 'Complete: submit it at the Research Desk in your cabin.';
  return `Complete: return to ${giverName(def.giver, npcs)} to turn it in.`;
}

/** What a "board" or NPC giver tells an available quest's reader. */
export function availableText(def, npcs) {
  if (def.giver === 'board') return 'Pick this contract up at the Research Desk in your cabin.';
  return `Talk to ${giverName(def.giver, npcs)} to take this on.`;
}

/** Human line for an unlock id ("region:murmur_marsh", "quest:x", "feature:y"). */
export function unlockLine(u, regions, quests) {
  const [kind, rest] = String(u).split(':');
  if (kind === 'region') return `Opens ${regions?.find((r) => r.key === rest)?.name || capital(rest)}`;
  if (kind === 'quest') {
    const q = quests?.[rest];
    // A hidden quest stays a surprise until it is revealed.
    return q?.name && !q.hidden ? `Unlocks the quest ${q.name}` : 'Opens a new line of enquiry';
  }
  if (kind === 'upgrade') {
    const [item, up] = String(rest || '').split('/');
    return `Unlocks the ${capital(up || item || 'equipment')} upgrade`;
  }
  if (kind === 'feature') {
    if (String(rest).startsWith('trail_')) return 'Reveals a hidden trail on your map';
    return `Unlocks ${capital(rest)}`;
  }
  return capital(u);
}

export const FACTION_NAMES = { naturalists: 'Naturalists', outfitters: 'Outfitters', research: 'Research', rangers: 'Rangers' };

/** Reward as display lines [{icon, text}] (items are rendered separately as cards). */
export function rewardLines(reward, { regions, quests, lore, rep, items } = {}) {
  const r = reward || {};
  const lines = [];
  if (r.xp) lines.push({ icon: 'xp', text: `${r.xp} XP` });
  if (r.credits) lines.push({ icon: 'credits', text: `${r.credits} Field Credits` });
  for (const [f, n] of Object.entries(r.rep || {})) {
    if (!n) continue;
    // With the player's standing when it is known: "+30 Rangers reputation (you have 45)".
    const have = rep ? (rep[f] || 0) : null;
    lines.push({ icon: 'reputation', kind: 'rep', text: `+${n} ${FACTION_NAMES[f] || capital(f)} reputation`, note: have != null ? `you have ${have}` : '' });
  }
  // Upgrades for equipment (when the server sends them): "Upgrade: Coated lenses".
  for (const u of r.upgrades || []) {
    const [item, up] = String(u).split('/');
    const def = items?.[item];
    const name = def?.upgrades?.find((x) => x.id === (up || item))?.name || capital(up || item);
    lines.push({ icon: 'upgrade', kind: 'upgrade', text: `Upgrade: ${name}${def?.name ? ` for your ${def.name}` : ''}` });
  }
  if (r.skillPoints) lines.push({ icon: 'skillpoint', text: `${r.skillPoints} skill point${r.skillPoints > 1 ? 's' : ''}` });
  for (const id of r.lore || []) lines.push({ icon: 'note', text: `Natural history: ${lore?.[id]?.title || 'a new entry'}` });
  for (const u of r.unlock || []) lines.push({ icon: 'lock', text: unlockLine(u, regions, quests) });
  if (r.badge) lines.push({ icon: 'badge', text: 'A badge for your collection' });
  return lines;
}

/** Number of quests needing the player's attention (finished and waiting for a turn-in). */
export function readyToTurnIn(profileQuests) {
  return Object.values(profileQuests || {}).filter((s) => s?.status === 'complete').length;
}
