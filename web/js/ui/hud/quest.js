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
    return { id, name: def.name, objectives: shown, remaining: open.length, total: rows.length, quarry: quarryLabel(profile, id) };
  }
  return null;
}

/**
 * Mystery ids an active quest is about: the server sets the flag
 * "quarry:<quest id>:<mystery id>" when it notices the quest's target species as a
 * mystery. Only mysteries still unnamed count (an identified bird has its own name).
 */
export function quarryMysteries(profile, questId) {
  const pre = 'quarry:' + questId + ':';
  const live = new Set((profile?.journal?.mysteries || []).map((m) => m.id));
  return Object.keys(profile?.flags || {}).filter((k) => profile.flags[k] && k.startsWith(pre))
    .map((k) => k.slice(pre.length)).filter((id) => live.has(id));
}

/** The label of the mystery a quest is about ("Unknown bird E"), or ''. */
export function quarryLabel(profile, questId) {
  const id = quarryMysteries(profile, questId)[0];
  if (!id) return '';
  return (profile.journal.mysteries.find((m) => m.id === id)?.label) || '';
}

/** Name of the active quest whose quarry is this mystery, or ''. */
export function questForMystery(profile, questDefs, mysteryId) {
  if (!mysteryId) return '';
  for (const [id, qs] of Object.entries(profile?.quests || {})) {
    if (!qs || qs.status !== 'active') continue;
    if (quarryMysteries(profile, id).includes(mysteryId)) return questDefs?.[id]?.name || '';
  }
  return '';
}
