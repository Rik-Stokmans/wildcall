// Pure helpers that turn a rare item's stat modifiers into concrete, player-facing
// "how it shows in the field" lines (spec §10.2: a rare item should feel special and
// its ability should be obvious). Used by the rare-item presentation and the inventory.

const fmt = (v) => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));

/** One concrete line per notable modifier: [{icon, text}]. Unknown stats are skipped. */
export function abilityLines(item) {
  const m = item?.mods || {};
  const out = [];
  const add = (icon, text) => out.push({ icon, text });
  if (m.lensInspect >= 1) add('lens', 'Press E on a feather, track or feeding sign: the lens tells you what left it and what it was doing.');
  if (m.trackSigns > 0) add('feather', `Feathers and signs on the ground glint from ${fmt(m.trackSigns)} m farther away.`);
  if (m.journalInfo > 0) add('journal', 'Your species pages gain a deeper layer of notes.');
  if (m.trailSense > 0) add('footprint', `Hidden paths and secret places reveal themselves from ${fmt(m.trailSense)} m farther.`);
  if (m.compass >= 2) add('compass', 'The compass strip shows the direction of places you have discovered.');
  else if (m.compass >= 1) add('compass', 'The compass strip shows exact bearings in degrees.');
  if (m.forecast > 0) add('cloudy', `The weather readout looks ${fmt(m.forecast)} hours further ahead.`);
  if (m.lowLight > 0) add('moon', 'Birds stay bright and sharp in your optics at dawn, dusk and night.');
  if (m.binoZoom > 0) add('binoculars', `Up to ${fmt(m.binoZoom)}× more magnification through the binoculars.`);
  if (m.filmCap > 0) add('film', `${fmt(m.filmCap)} more photographs per expedition.`);
  if (m.recQuality > 0) add('microphone', 'Cleaner, warmer recordings.');
  if (m.capacity > 0) add('backpack', `${fmt(m.capacity)} more pack slots.`);
  return out;
}

/** How the item's effect is switched on, by kind/slot. */
export function activationLine(item) {
  if (!item) return '';
  if (item.kind === 'equipment') return `Equip it in the ${String(item.slot || 'matching').replace(/_/g, ' ')} slot to use it.`;
  if (item.kind === 'gadget') return 'Works while it is in your pack: nothing to equip.';
  if (item.kind === 'keepsake') return 'Its effects last as long as you carry it.';
  return '';
}

/** Should the inventory show the special block? Any item with a special text. */
export function hasSpecial(item) {
  return !!(item && typeof item.special === 'string' && item.special.trim());
}
