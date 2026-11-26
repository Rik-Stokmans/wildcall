// Pure formatting and geometry helpers shared by the journal, map, quest log and
// collection screens. No DOM, no three.js: everything here is unit-tested.

export const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const PHASE_NAMES = ['Dawn', 'Morning', 'Midday', 'Afternoon', 'Evening', 'Night'];
export const SEASON_LABELS = ['Spring', 'Summer', 'Autumn', 'Winter'];

/** Fallback region names (core.RegionID order) for when the welcome list is not available. */
const REGION_FALLBACK = ['Greenhollow Woods', 'Murmur Marsh', 'Windpeak Highlands', 'Whispering Coast', 'Amberwood', 'Frostveil'];

/** Name of a region type id; "Open Sea" for 255 / unknown ids. */
export function regionName(regions, id) {
  const r = (regions || []).find((x) => x.id === id);
  if (r) return r.name;
  return REGION_FALLBACK[id] || 'Open Sea';
}

/** Compass heading (radians, 0 = north, +x = east, north = -z) from a to b, in [0, 2pi). */
export function headingTo(ax, az, bx, bz) {
  let h = Math.atan2(bx - ax, -(bz - az));
  if (h < 0) h += Math.PI * 2;
  return h;
}

/** 8-point compass name for a heading in radians. */
export function compassName(heading) {
  let t = heading / (Math.PI * 2);
  t -= Math.floor(t);
  return COMPASS8[Math.floor(t * 8 + 0.5) % 8];
}

export function dist2(ax, az, bx, bz) { return Math.hypot(bx - ax, bz - az); }

/** 340 -> "340 m", 1234 -> "1.2 km", 12345 -> "12 km". */
export function formatDistance(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m / 10) * 10 || Math.round(m)} m`;
  const km = m / 1000;
  return km < 10 ? `${(Math.round(km * 10) / 10).toFixed(1)} km` : `${Math.round(km)} km`;
}

/** "340 m NE" — distance and bearing from `from` to `to` ({x, z}); "here" when very close. */
export function bearingText(from, to) {
  const d = dist2(from.x, from.z, to.x, to.z);
  if (d < 12) return 'right here';
  return `${formatDistance(d)} ${compassName(headingTo(from.x, from.z, to.x, to.z))}`;
}

export function formatDay(day) { return day > 0 ? `Day ${day}` : 'Day 1'; }

/** Clock text for an in-game hour (13.5 -> "13:30"). */
export function clockText(hours) {
  if (!Number.isFinite(hours)) return '';
  const h = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }

/** "very high" / "long_curved" -> "Very high" / "Long curved". */
export function capital(word) {
  if (!word) return '';
  const s = String(word).replace(/[_-]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Photo tag text: "behavior:feeding" -> "Feeding", "golden hour" -> "Golden hour". */
export function tagText(tag) {
  const i = String(tag).indexOf(':');
  return capital(i >= 0 ? String(tag).slice(i + 1) : tag);
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Wild rarity (0..3) -> index into the shared 0..4 rarity colour scale. */
export function wildRarityColorIndex(r) { return [0, 1, 2, 4][clamp(r | 0, 0, 3)]; }

/** Total seconds a bout of a call lasts when played (used to animate the spectrogram). */
export function callBoutSeconds(call) {
  const phrase = (call?.notes || []).reduce((a, n) => a + (n.dur || 0) + (n.gap || 0), 0);
  const reps = Math.max(1, Math.min(3, call?.repeat?.[0] || 1));
  return phrase * reps + (reps - 1) * (call?.gap || 0);
}
