// Pure quest-tracker derivation from profile.quests (QuestState) + welcome quests (QuestDef).

/** "Photograph a bird (2/5)"; objectives with count <= 1 show no counter. */
export function objectiveProgressText(def, progress) {
  const need = Math.max(1, def.count | 0);
  const have = Math.min(need, (progress && progress[def.id]) | 0);
  const text = def.text || '';
  return need > 1 ? `${text} (${have}/${need})` : text;
}

export function objectiveDone(def, progress) {
  const need = Math.max(1, def.count | 0);
  return ((progress && progress[def.id]) | 0) >= need;
}

/**
 * The quest to show: the first quest that is both tracked and active (status 'active';
 * 'complete' means ready to turn in and needs no objective line).
 * Returns null or { id, name, objectives: [{id, text, done, have, need}] }.
 * Ordered quests show just the next open objective; others list up to `max` open ones.
 */
export function trackedQuest(profile, questDefs, max = 3) {
  const quests = profile?.quests || {};
  for (const [id, qs] of Object.entries(quests)) {
    if (!qs || !qs.tracked || qs.status !== 'active') continue;
    const def = questDefs?.[id];
    if (!def) continue;
    const progress = qs.progress || {};
    const rows = (def.objectives || []).map((o) => ({
      id: o.id, text: objectiveProgressText(o, progress), done: objectiveDone(o, progress),
      have: Math.min(Math.max(1, o.count | 0), progress[o.id] | 0), need: Math.max(1, o.count | 0),
    }));
    const open = rows.filter((r) => !r.done);
    const shown = def.ordered ? open.slice(0, 1) : open.slice(0, max);
    return { id, name: def.name, objectives: shown, remaining: open.length, total: rows.length };
  }
  return null;
}
