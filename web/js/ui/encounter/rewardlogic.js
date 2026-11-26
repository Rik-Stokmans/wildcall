// Pure logic for the rewards, rare item, region and rank-up screens. No DOM.
import { factionName } from './logic.js';

/** Ease-out count-up: the integer shown `elapsed` ms into a `dur` ms animation. */
export function countUp(elapsed, dur, target) {
  if (!(dur > 0) || elapsed >= dur) return Math.round(target);
  if (elapsed <= 0) return 0;
  const t = elapsed / dur;
  return Math.round(target * (1 - Math.pow(1 - t, 3)));
}

/**
 * Normalise a RewardsMsg (or a proto.Reward) for display.
 * @param msg    RewardsMsg { title, subtitle, xp, credits, items, rep, skillPoints, journal, levelUp }
 * @param items  state.items (id -> ItemDef)
 * @returns { title, subtitle, xp, credits, skillPoints, levelUp, items:[{id, def}], rep:[{faction,label,amount}], journal:[], isEmpty }
 */
export function rewardSummary(msg, items = {}) {
  const m = msg || {};
  const rep = Object.entries(m.rep || {})
    .filter(([, n]) => n)
    .map(([faction, amount]) => ({ faction, label: factionName(faction), amount }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const out = {
    title: m.title || 'Rewards',
    subtitle: m.subtitle || '',
    xp: Math.max(0, m.xp | 0),
    credits: m.credits | 0,
    skillPoints: Math.max(0, m.skillPoints | 0),
    levelUp: Math.max(0, m.levelUp | 0),
    items: (m.items || []).map((id) => ({ id, def: items[id] || null })),
    rep,
    journal: (m.journal || []).filter(Boolean),
  };
  out.isEmpty = !out.xp && !out.credits && !out.skillPoints && !out.levelUp && !out.items.length && !out.rep.length && !out.journal.length;
  return out;
}

/**
 * Compact reward lines for a quest offer / turn-in card (proto.Reward).
 * Returns [{ icon, text }] using the kit's icon vocabulary.
 */
export function rewardLines(reward, items = {}) {
  if (!reward) return [];
  const out = [];
  if (reward.xp) out.push({ icon: 'xp', text: `${reward.xp} XP` });
  if (reward.credits) out.push({ icon: 'credits', text: `${reward.credits} Field Credits` });
  if (reward.skillPoints) out.push({ icon: 'skillpoint', text: `${reward.skillPoints} skill point${reward.skillPoints === 1 ? '' : 's'}` });
  for (const [f, n] of Object.entries(reward.rep || {})) {
    if (n) out.push({ icon: 'reputation', text: `${n > 0 ? '+' : ''}${n} reputation with the ${factionName(f)}` });
  }
  for (const id of reward.items || []) out.push({ icon: items[id]?.icon || 'backpack', text: items[id]?.name || String(id).replace(/_/g, ' ') });
  for (const u of reward.unlock || []) {
    const [kind, key] = String(u).split(':');
    out.push({ icon: kind === 'region' ? 'map' : 'lock', text: `Unlocks ${kind} ${String(key || '').replace(/_/g, ' ')}`.trim() });
  }
  if (reward.badge) out.push({ icon: 'badge', text: `Badge: ${String(reward.badge).replace(/^badge_/, '').replace(/_/g, ' ')}` });
  return out;
}

/** Quest progress for an objective: "2 / 3" style text and completion flag. */
export function objectiveProgress(obj, questState) {
  const need = Math.max(1, obj?.count | 0);
  const have = Math.min(need, questState?.progress?.[obj?.id] | 0);
  return { have, need, done: have >= need };
}

/** Requirement lines for a rank, with met flags against the player's profile facts. */
export function rankRequirements(rank, facts = {}) {
  if (!rank) return [];
  const out = [];
  const add = (cond, text, have, need) => { if (cond) out.push({ text, have, need, met: have >= need }); };
  add(rank.reqLevel > 0, `Reach level ${rank.reqLevel}`, facts.level | 0, rank.reqLevel);
  add(rank.reqSpecies > 0, `Identify ${rank.reqSpecies} species`, facts.species | 0, rank.reqSpecies);
  add(rank.reqDocs > 0, `Document ${rank.reqDocs} species`, facts.docs | 0, rank.reqDocs);
  add(rank.reqRep > 0, `Earn ${rank.reqRep} reputation`, facts.rep | 0, rank.reqRep);
  if (rank.reqQuest) out.push({ text: `Complete "${facts.questName || rank.reqQuest}"`, have: facts.questDone ? 1 : 0, need: 1, met: !!facts.questDone });
  return out;
}

/**
 * Display model for the rank-up ceremony. `ranks` is welcome.ranks (RankDef[], Index 1..5).
 * Returns { rank, title, desc, unlocks, skillPoints, next:{title, requirements}|null }.
 */
export function rankView(index, ranks, facts = {}) {
  const list = ranks || [];
  const rank = list.find((r) => r.index === index) || list[index - 1] || null;
  const next = list.find((r) => r.index === index + 1) || null;
  return {
    rank: index,
    title: rank?.title || `Rank ${index}`,
    desc: rank?.desc || 'Your field notes have earned you a new standing.',
    unlocks: rank?.unlocks || [],
    skillPoints: rank?.skillPoints | 0,
    next: next ? { title: next.title, requirements: rankRequirements(next, facts) } : null,
  };
}

/**
 * Display model for the region screen.
 * @param msg      RegionMsg { region, species, unlocked, reason, hints }
 * @param regions  welcome.regions (RegionInfo[])
 * @param ctx      { rank, ranks, quests }  for describing what is needed when locked
 */
export function regionView(msg, regions, ctx = {}) {
  const info = (regions || []).find((r) => r.id === msg?.region) || null;
  const out = {
    info,
    name: info?.name || 'A new region',
    tagline: info?.tagline || '',
    desc: info?.desc || '',
    habitats: info?.habitats || [],
    speciesCount: Math.max(0, msg?.species | 0),
    unlocked: !!msg?.unlocked,
    reason: msg?.reason || '',
    hints: (msg?.hints && msg.hints.length ? msg.hints : info?.emphasis || []).filter(Boolean),
    needs: [],
    key: info?.key || '',
    color: info?.color || '',
  };
  if (!out.unlocked && info) {
    if (info.reqRank > 1) {
      const t = (ctx.ranks || []).find((r) => r.index === info.reqRank)?.title;
      out.needs.push({ text: `Naturalist rank ${info.reqRank}${t ? ` (${t})` : ''}`, met: (ctx.rank | 0) >= info.reqRank });
    }
    if (info.reqQuest) {
      const q = ctx.quests?.[info.reqQuest];
      out.needs.push({ text: `Complete the quest "${q?.name || info.reqQuest}"`, met: false });
    }
  }
  return out;
}
