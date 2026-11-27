// Onboarding nudges: one-time gentle hints that point a new naturalist at the rest of
// the game once the first quest is done (spec §27 stage 9, QA play-through). Pure: the
// HUD feeds it the profile and what the hint tracker remembers.
//
// Sequence: The Unseen Singer turned in -> "visit Finn's stall" (with a soft compass
// tick toward it) -> "use the cabin's stations". Independently, first time near a
// pickable plant -> foraging, first nest found -> nests, first ingredient carried ->
// cooking. Each is shown once and only while settings.hints is on (HintTracker).
import { headingTo } from './compass.js';

export const TUTORIAL_QUEST = 'unseen_singer';
export const NUDGE_ORDER = ['finn', 'cabin', 'nest', 'forage', 'cook'];

/** Is the first (tutorial) quest still under way? */
export function tutorialActive(profile) {
  const st = profile?.quests?.[TUTORIAL_QUEST]?.status;
  return st === 'active' || st === 'complete';
}

/** Does the player carry (pack or storage) something of this item kind? */
export function carriesKind(profile, items, kind) {
  for (const list of [profile?.inventory, profile?.storage]) {
    for (const s of list || []) if (s && s.qty > 0 && items?.[s.item]?.kind === kind) return true;
  }
  return false;
}

/**
 * Is a nudge due right now?
 * @param id     nudge id (NUDGE_ORDER)
 * @param s      { profile, items, nearForage: bool, wasShown(id) -> bool }
 */
export function nudgeDue(id, s = {}) {
  const p = s.profile;
  if (!p) return false;
  const shown = (k) => !!s.wasShown?.(k);
  switch (id) {
    case 'finn': return p.quests?.[TUTORIAL_QUEST]?.status === 'turned_in';
    case 'cabin': return p.quests?.[TUTORIAL_QUEST]?.status === 'turned_in' && shown('finn');
    case 'nest': return (p.journal?.nests || []).length > 0;
    case 'forage': return !!s.nearForage;
    case 'cook': return carriesKind(p, s.items, 'ingredient') && (!!p.recipes?.length || shown('forage'));
    default: return false;
  }
}

/** The first due nudge that the tracker still allows (`available(id)`), or null. */
export function nextNudge(s = {}, available = () => true) {
  for (const id of NUDGE_ORDER) if (available(id) && nudgeDue(id, s)) return id;
  return null;
}

/** Where a nudge points (for the compass tick): Finn's stall, or null. */
export function nudgeTarget(id, pois) {
  if (id !== 'finn') return null;
  const list = Object.values(pois || {});
  return list.find((p) => p?.kind === 'shop') || list.find((p) => p?.id === 'finn') || null;
}

/** Compass bearing from the player to a nudge target, or null. */
export function nudgeBearing(target, px, pz) {
  if (!target?.pos || !Number.isFinite(px) || !Number.isFinite(pz)) return null;
  return headingTo(px, pz, target.pos.x, target.pos.z);
}

/** Has the player done what the nudge asked? `near` = metres to the nudge target. */
export function nudgeComplete(id, { near = Infinity, opened = '' } = {}) {
  if (id === 'finn') return near < 14 || opened === 'shop';
  if (id === 'cabin') return opened === 'base';
  if (id === 'cook') return opened === 'cook';
  if (id === 'nest') return opened === 'journal';
  return false;
}
