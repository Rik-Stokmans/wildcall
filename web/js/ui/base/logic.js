// Pure logic for the home-base and shop screens: no DOM, no three.js; the only import is
// the pure grid-inventory logic (ui/menu/packlogic.js).
// Everything here is derived from the wire types in internal/proto (Profile, ItemDef,
// UpgradeDef, CabinUpgradeDef, QuestDef, EnvMsg, core.Stats) so it can be tested with
// plain node --test.

import * as Pack from '../menu/packlogic.js';

/* ------------------------------------------------------------------ helpers */

const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x && typeof x === 'object' ? x : {});
const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 1234 → "1,234" */
export function formatCredits(n) {
  return Math.round(num(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 'binoZoom' → "Bino zoom" (fallback label for stats the kit does not name). */
export function statWords(key) {
  const s = String(key || '').replace(/([A-Z])/g, ' $1').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The rank title for a rank number, tolerant of an empty catalog. */
export function rankTitle(ranks, n) {
  const r = arr(ranks).find((x) => x.index === n) || arr(ranks)[n - 1];
  return r?.title || `Rank ${n}`;
}

/* ------------------------------------------------------------------ constants */

export const EQUIP_SLOTS = ['optics', 'camera', 'audio', 'backpack', 'navigation', 'clothing'];

export const SLOT_INFO = {
  optics: { label: 'Optics', icon: 'binoculars', empty: 'No binoculars' },
  camera: { label: 'Camera', icon: 'camera', empty: 'No camera' },
  audio: { label: 'Audio', icon: 'recorder', empty: 'No recorder' },
  backpack: { label: 'Backpack', icon: 'backpack', empty: 'No pack' },
  navigation: { label: 'Navigation', icon: 'compass', empty: 'No map' },
  clothing: { label: 'Clothing', icon: 'clothing', empty: 'Bare-handed' },
};

export const STATIONS = [
  { id: 'research', label: 'Research Desk', icon: 'desk' },
  { id: 'equipment', label: 'Equipment', icon: 'backpack' },
  { id: 'journal', label: 'Journal', icon: 'journal' },
  { id: 'photos', label: 'Photo Wall', icon: 'wall' },
  { id: 'storage', label: 'Storage', icon: 'storage' },
  { id: 'upgrades', label: 'Cabin Upgrades', icon: 'upgrade' },
  { id: 'rest', label: 'Rest', icon: 'moon' },
  // c-field hook: the kitchen opens the field-kitchen screen ('cook', web/js/forage).
  { id: 'kitchen', label: 'Kitchen', icon: 'camp' },
];
export const STATION_IDS = STATIONS.map((s) => s.id);

export const WALL_SLOTS_BASE = 4; // progress.PinSlotsBase
export const WALL_SLOTS_UPGRADED = 12; // progress.PinSlotsUpgraded

/** The "Studied" discovery level and the study meter's full value. */
export const LEVEL_DOCUMENTED = 5;
export const LEVEL_STUDIED = 6;
export const STUDY_FULL = 100;

export const REST_OPTIONS = [
  { id: 'dawn', label: 'Dawn', hour: 5.5, icon: 'dawn', // 05:00 is still near dark; the chorus is at full voice by half past
    blurb: 'Dawn: the chorus is at its loudest. The best hour for unfamiliar voices.' },
  { id: 'morning', label: 'Morning', hour: 8, icon: 'sunny',
    blurb: 'Morning: birds are feeding and on the move, and the light is kind to photographs.' },
  { id: 'midday', label: 'Midday', hour: 12, icon: 'sunny',
    blurb: 'Midday: the woods go quiet. Good for patient watching and for raptors on the thermals.' },
  { id: 'evening', label: 'Evening', hour: 18.5, icon: 'dawn',
    blurb: 'Evening: calls ring out and flocks head home under golden light.' },
  { id: 'night', label: 'Night', hour: 22, icon: 'moon',
    blurb: 'Night: owls and nightjars take over. Bring good ears and a little patience.' },
];

/* ------------------------------------------------------------------ time */

/** Hours that pass when resting from `now` until hour-of-day `target` (wraps midnight;
 *  resting until the very same hour means a full day, never zero). */
export function hoursUntil(now, target) {
  const d = (((target - now) % 24) + 24) % 24;
  return d < 1 / 60 ? 24 : d;
}

/** 7.5 → "7 h 30 min", 24 → "24 h", 0.25 → "15 min" */
export function formatDuration(hours) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** 18.5 → "18:30" (kept local so this file stays dependency free). */
export function clock(hours) {
  const t = ((hours % 24) + 24) % 24;
  let h = Math.floor(t);
  let m = Math.round((t - h) * 60);
  if (m === 60) { h = (h + 1) % 24; m = 0; }
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/**
 * The forecast slot covering the moment the player will wake, or null when the player's
 * forecast skill does not reach that far (stats.forecast = hours of forecast shown; the
 * server only decides 12 hours ahead, in 3-hour slots whose `hour` is the hour of day).
 */
export function forecastFor(env, stats, target) {
  const reach = Math.min(12, num(stats?.forecast));
  if (reach <= 0) return null;
  const now = num(env?.time);
  if (hoursUntil(now, target) > reach) return null;
  for (const slot of arr(env?.forecast)) {
    const d = (((target - slot.hour) % 24) + 24) % 24;
    if (d < 3) return slot;
  }
  return null;
}

/** Everything the Rest station shows for one option. */
export function restPlan(env, stats, option) {
  const hours = hoursUntil(num(env?.time), option.hour);
  const slot = forecastFor(env, stats, option.hour);
  let forecastState = 'none'; // none = skill too low, far = beyond reach, ok
  if (num(stats?.forecast) > 0) forecastState = slot ? 'ok' : 'far';
  return {
    option,
    hours,
    duration: formatDuration(hours),
    wakeClock: clock(option.hour),
    nextDay: num(env?.time) + hours >= 24,
    forecast: slot ? slot.weather : null,
    forecastState,
  };
}

/* ------------------------------------------------------------------ sky for the cabin window */

const SKY_STOPS = [
  [0, '#0b1426', '#1c2c4a'],
  [4.5, '#0f1a30', '#26385a'],
  [5.5, '#5a6f9a', '#f0b48a'],
  [7, '#7fa6d0', '#f7d9b0'],
  [9, '#6fa8dc', '#cfe6f2'],
  [13, '#5d9bd5', '#bfe0f0'],
  [16.5, '#6aa3d6', '#e9e3c4'],
  [18.5, '#7b86b8', '#f2a671'],
  [20, '#3d4670', '#c9745a'],
  [21.5, '#141c34', '#2a3556'],
  [24, '#0b1426', '#1c2c4a'],
];

export function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  const v = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16) || 0;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgbToHex([r, g, b]) {
  const c = (x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
/** Blend two hex colours; t = 0 → a, 1 → b. */
export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((x, i) => x + (B[i] - x) * t));
}

/**
 * Describe the sky for the window illustration from the clock and weather.
 * weather: 0 sunny, 1 cloudy, 2 rain, 3 wind (core.Weather). env fields cloud/rain/mist/
 * wind/light override the weather-derived defaults when present.
 */
export function skyScene(time, weather = 0, env = {}) {
  const t = ((num(time) % 24) + 24) % 24;
  let i = 0;
  while (i < SKY_STOPS.length - 2 && t >= SKY_STOPS[i + 1][0]) i++;
  const [t0, top0, bot0] = SKY_STOPS[i];
  const [t1, top1, bot1] = SKY_STOPS[i + 1];
  const k = clamp((t - t0) / (t1 - t0), 0, 1);
  let top = mixHex(top0, top1, k);
  let bottom = mixHex(bot0, bot1, k);

  const wx = { cloud: [0.12, 0.7, 0.95, 0.4][weather] ?? 0.12, rain: weather === 2 ? 0.8 : 0,
    wind: weather === 3 ? 0.8 : 0.15, mist: 0 };
  const cloud = clamp(num(env?.cloud, wx.cloud), 0, 1);
  const rain = clamp(num(env?.rain, wx.rain), 0, 1);
  const wind = clamp(num(env?.wind, wx.wind), 0, 1);
  const mist = clamp(num(env?.mist, wx.mist), 0, 1);
  // Overcast skies pull the colours towards flat grey.
  const grey = clamp(cloud * 0.55 + rain * 0.25, 0, 0.8);
  const night = t < 5 || t > 21.5;
  if (grey > 0) {
    top = mixHex(top, night ? '#1a2230' : '#7f8a94', grey);
    bottom = mixHex(bottom, night ? '#2a3340' : '#b9bfc2', grey);
  }

  const dayT = (t - 5.5) / 14;
  const sunUp = t >= 5.5 && t <= 19.5;
  const nightT = ((t - 19.5 + 24) % 24) / 10;
  const moonUp = t >= 19.5 || t <= 5.5;
  const arc = (p) => ({ x: 0.1 + 0.8 * p, y: 0.88 - 0.72 * Math.sin(Math.PI * clamp(p, 0, 1)) });
  const sun = sunUp ? arc(dayT) : null;
  const moon = moonUp ? arc(clamp(nightT, 0, 1)) : null;
  const starAlpha = clamp(t >= 21.5 || t <= 4.5 ? 1 : t > 19.5 ? (t - 19.5) / 2 : t > 4.5 && t < 5.5 ? 5.5 - t : 0, 0, 1) * (1 - cloud * 0.8);
  const light = clamp(num(env?.light, sunUp ? Math.sin(Math.PI * clamp(dayT, 0, 1)) : 0), 0, 1);
  const warm = clamp(t >= 17 && t <= 20 ? 1 - Math.abs(t - 18.5) / 1.5 : t >= 5 && t <= 7 ? 1 - Math.abs(t - 6) : 0, 0, 1);
  return {
    time: t, top, bottom, sun, moon, stars: starAlpha, cloud, rain, wind, mist, light, warm,
    sunColor: mixHex('#fff3c4', '#ffb070', warm),
    night: light < 0.15,
  };
}

/* ------------------------------------------------------------------ inventory & ownership */

/** Item definition from the welcome index (state.items), or null. */
export function itemDef(items, id) {
  return (items && items[id]) || null;
}

export function countOwned(profile, id) {
  let n = 0;
  for (const s of arr(profile?.inventory)) if (s.item === id) n += num(s.qty, 1);
  for (const s of arr(profile?.storage)) if (s.item === id) n += num(s.qty, 1);
  for (const v of Object.values(obj(profile?.equipped))) if (v === id) n += 1;
  return n;
}
export const isOwned = (profile, id) => countOwned(profile, id) > 0;

/** The backpack grid as packlogic sees it, sized by `stats` (packW x packH). */
function packModel(profile, stats, items) {
  return Pack.gridModel('inventory', { ...obj(profile), stats: stats || profile?.stats }, items || {});
}

/**
 * Backpack usage in grid cells (each stack covers its item's footprint; equipped items
 * take none). Without `items` every stack counts as one cell.
 */
export function capacityInfo(profile, stats, items) {
  const m = packModel(profile, stats, items);
  const used = items ? Pack.usedCells(m, items) : arr(profile?.inventory).length;
  const cap = m.W * m.H;
  return { used, cap, free: Math.max(0, cap - used), full: used >= cap };
}

/**
 * Would one more of this item fit in the backpack as it is packed now (topping up a
 * stack, or a free spot as it is or turned)? The server's own buy check. Without
 * `items` the answer is unknown and taken as yes (the server decides).
 */
export function fitsInBackpack(profile, stats, item, items) {
  if (!items || !item) return true;
  const all = withItem(items, item);
  return Pack.hasRoomFor(packModel(profile, stats, all), all, item.id);
}

/** ItemDefs by id, sure to include `item`. */
const withItem = (items, item) => (items[item.id] ? items : { ...items, [item.id]: item });

export function totalRep(profile) {
  return Object.values(obj(profile?.rep)).reduce((a, b) => a + num(b), 0);
}

/** Price after the player's shop discount (stats.discount 0..0.5). Never free unless it was. */
export function unitPrice(price, discount) {
  const p = num(price);
  if (p <= 0) return 0;
  return Math.max(1, Math.round(p * (1 - clamp(num(discount), 0, 0.5))));
}

/** Rank / reputation requirement rows for an item, each with a met flag. */
export function itemRequirements(item, profile, ranks) {
  const out = [];
  if (num(item?.reqRank) > 1) {
    out.push({ code: 'rank', met: num(profile?.rank, 1) >= item.reqRank,
      text: `Rank ${item.reqRank}: ${rankTitle(ranks, item.reqRank)}` });
  }
  if (num(item?.reqRep) > 0) {
    out.push({ code: 'rep', met: totalRep(profile) >= item.reqRep,
      text: `Reputation ${item.reqRep}` });
  }
  return out;
}

export const NO_ROOM_TEXT = 'No room in your pack – make space or send it home';

/**
 * Can the player buy this shop item right now?
 * → { canBuy, price, issues: [{code, text}], requirements: [{code, met, text}], owned, noRoom, tidyFits }
 * Codes: unsold, owned, rank, rep, credits, capacity. The room check needs `items` (ItemDefs
 * by id, for the footprints already in the pack); it mirrors the server, which refuses a
 * buy when the item has no spot as the pack is packed now. tidyFits: a quick tidy would
 * make room (a hint; the player tidies, the shop never rearranges their pack).
 */
export function purchaseCheck(item, profile, stats, ranks = [], items = null) {
  const price = unitPrice(item?.price, stats?.discount);
  const requirements = itemRequirements(item, profile, ranks);
  const issues = [];
  const owned = !!item && item.kind !== 'supply' && isOwned(profile, item.id);
  if (!item || !(item.price > 0)) {
    issues.push({ code: 'unsold', text: 'Not for sale' });
  } else {
    if (owned) issues.push({ code: 'owned', text: 'You already own this' });
    for (const r of requirements) if (!r.met) issues.push({ code: r.code, text: r.text });
    const credits = num(profile?.credits);
    if (credits < price) issues.push({ code: 'credits', text: `${formatCredits(price - credits)} more Field Credits needed` });
    if (!owned && !fitsInBackpack(profile, stats, item, items)) issues.push({ code: 'capacity', text: NO_ROOM_TEXT });
  }
  const noRoom = issues.some((i) => i.code === 'capacity');
  let tidyFits = false;
  if (noRoom) {
    const all = withItem(items, item);
    tidyFits = Pack.fitsAfterTidy(packModel(profile, stats, all), all, item.id);
  }
  return { canBuy: issues.length === 0, price, issues, requirements, owned, noRoom, tidyFits };
}

/** Owned equipment mods including purchased upgrades. */
export function effectiveMods(item, profile) {
  const out = { ...obj(item?.mods) };
  const bought = new Set(arr(obj(profile?.upgrades)[item?.id]));
  for (const u of arr(item?.upgrades)) {
    if (!bought.has(u.id)) continue;
    for (const [k, v] of Object.entries(obj(u.mods))) out[k] = num(out[k]) + num(v);
  }
  return out;
}

/** Stat deltas between a candidate's mods and the current ones: [{key, next, cur, delta}]. */
export function compareMods(nextMods, curMods) {
  const n = obj(nextMods), c = obj(curMods);
  const keys = [...Object.keys(n), ...Object.keys(c).filter((k) => !(k in n))];
  const out = [];
  for (const key of keys) {
    const next = num(n[key]), cur = num(c[key]);
    const delta = next - cur;
    if (Math.abs(delta) > 1e-6) out.push({ key, next, cur, delta });
  }
  return out;
}

/**
 * Compare a shop/inventory item against what the player currently has equipped in its
 * slot (upgrades included). → { slot, current (ItemDef|null), same (bool), deltas }
 */
export function compareToEquipped(item, profile, items) {
  if (!item || item.kind !== 'equipment' || !item.slot) return { slot: '', current: null, same: false, deltas: [] };
  const curId = obj(profile?.equipped)[item.slot];
  const current = curId ? itemDef(items, curId) : null;
  const same = curId === item.id;
  const deltas = same ? [] : compareMods(item.mods, current ? effectiveMods(current, profile) : {});
  return { slot: item.slot, current, same, deltas };
}

/** Where does this item sit? 'equipped' | 'backpack' | 'storage' | null */
export function locateItem(profile, id) {
  if (Object.values(obj(profile?.equipped)).includes(id)) return 'equipped';
  if (arr(profile?.inventory).some((s) => s.item === id)) return 'backpack';
  if (arr(profile?.storage).some((s) => s.item === id)) return 'storage';
  return null;
}

/** Owned equipment for one slot, with its location: [{item, where, qty}] equipped first. */
export function ownedInSlot(profile, items, slot) {
  const out = [];
  const eq = obj(profile?.equipped)[slot];
  if (eq && items[eq]) out.push({ item: items[eq], where: 'equipped', qty: 1 });
  for (const [where, list] of [['backpack', profile?.inventory], ['storage', profile?.storage]]) {
    for (const s of arr(list)) {
      const d = items[s.item];
      if (d && d.kind === 'equipment' && d.slot === slot) out.push({ item: d, where, qty: num(s.qty, 1) });
    }
  }
  return out;
}

/** Status of one item upgrade for the player. */
export function upgradeStatus(item, upg, profile, stats, ranks = []) {
  const bought = arr(obj(profile?.upgrades)[item?.id]).includes(upg.id);
  const issues = [];
  const owned = isOwned(profile, item?.id);
  if (!owned) issues.push({ code: 'item', text: 'You do not own this item' });
  if (num(profile?.rank, 1) < num(upg.reqRank)) issues.push({ code: 'rank', text: `Rank ${upg.reqRank}: ${rankTitle(ranks, upg.reqRank)}` });
  if (upg.reqCabin && !arr(profile?.cabin).includes(upg.reqCabin)) {
    issues.push({ code: 'cabin', text: `Needs the cabin ${cabinLabel(upg.reqCabin)}` });
  }
  const credits = num(profile?.credits);
  if (credits < num(upg.price)) issues.push({ code: 'credits', text: `${formatCredits(upg.price - credits)} more Field Credits needed` });
  return { bought, price: num(upg.price), issues, canBuy: !bought && issues.length === 0 };
}

const CABIN_LABELS = {
  audio_lab: 'audio laboratory', photo_wall: 'photography wall', workshop: 'workshop',
  map_room: 'map room', garden: 'observation garden',
};
export function cabinLabel(id) { return CABIN_LABELS[id] || String(id).replace(/_/g, ' '); }

/** Items the player owns that have upgrades available: [{item, where}] */
export function upgradableItems(profile, items) {
  const seen = new Set();
  const out = [];
  const add = (id, where) => {
    const d = items[id];
    if (!d || seen.has(id) || d.kind !== 'equipment' || !arr(d.upgrades).length) return;
    seen.add(id);
    out.push({ item: d, where });
  };
  for (const id of Object.values(obj(profile?.equipped))) add(id, 'equipped');
  for (const s of arr(profile?.inventory)) add(s.item, 'backpack');
  for (const s of arr(profile?.storage)) add(s.item, 'storage');
  return out;
}

/** Moving a stack with "move": would it fit on the other side? → {ok, reason} (grid rules, packlogic). */
export function moveCheck(item, to, profile, stats, items) {
  if (!items || !item) return { ok: true, reason: '' };
  const all = withItem(items, item);
  const pack = packModel(profile, stats, all);
  const store = Pack.gridModel('storage', profile, all);
  const q = to === 'inventory' ? Pack.quickMoveTarget(store, pack, all, item.id) : Pack.quickMoveTarget(pack, store, all, item.id);
  return { ok: q.ok, reason: q.reason };
}

/* ------------------------------------------------------------------ cabin upgrades */

export function cabinFeatures(profile) {
  const has = (id) => arr(profile?.cabin).includes(id);
  return { audioLab: has('audio_lab'), photoWall: has('photo_wall'), workshop: has('workshop'), mapRoom: has('map_room'), garden: has('garden') };
}

export function cabinUpgradeStatus(def, profile, ranks = []) {
  const owned = arr(profile?.cabin).includes(def.id);
  const issues = [];
  if (num(profile?.rank, 1) < num(def.reqRank)) issues.push({ code: 'rank', text: `Rank ${def.reqRank}: ${rankTitle(ranks, def.reqRank)}` });
  const credits = num(profile?.credits);
  if (credits < num(def.price)) issues.push({ code: 'credits', text: `${formatCredits(def.price - credits)} more Field Credits needed` });
  return { owned, price: num(def.price), issues, canBuy: !owned && issues.length === 0 };
}

/* ------------------------------------------------------------------ photography wall */

export function wallSlots(profile) {
  return arr(profile?.cabin).includes('photo_wall') ? WALL_SLOTS_UPGRADED : WALL_SLOTS_BASE;
}

/** Pin state: only pinned ids that still exist as photos count. */
export function pinInfo(profile) {
  const slots = wallSlots(profile);
  const photoIds = new Set(arr(profile?.journal?.photos).map((p) => p.id));
  const pinned = arr(profile?.journal?.pinned).filter((id) => photoIds.has(id));
  return { slots, pinned, count: pinned.length, free: Math.max(0, slots - pinned.length), canPin: pinned.length < slots };
}

/**
 * Frame rectangles on the wall panel in the 800×600 cabin illustration space.
 * 6 slots → 3×2, 12 → 4×3. Each frame has a small deterministic tilt.
 */
export const WALL_AREA = { x: 488, y: 66, w: 288, h: 222 };
export function wallLayout(slots) {
  const cols = slots > 6 ? 4 : 3;
  const rows = Math.ceil(slots / cols);
  const gap = 8;
  const cw = (WALL_AREA.w - gap * (cols + 1)) / cols;
  const ch = (WALL_AREA.h - gap * (rows + 1)) / rows;
  const out = [];
  for (let i = 0; i < slots; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    out.push({
      x: WALL_AREA.x + gap + c * (cw + gap),
      y: WALL_AREA.y + gap + r * (ch + gap),
      w: cw, h: ch,
      tilt: ((((i * 37) % 7) - 3) * 0.006),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ research desk */

/** Name for a photo/recording subject without leaking unidentified species. */
export function subjectLabel(speciesId, mysteryId, profile, speciesById) {
  if (speciesId && obj(profile?.journal?.species)[speciesId]) {
    return speciesById?.[speciesId]?.name || 'Identified bird';
  }
  if (mysteryId) {
    const m = arr(profile?.journal?.mysteries).find((x) => x.id === mysteryId);
    if (m) return m.label;
  }
  return 'Unknown bird';
}

export function photoLabel(photo, profile, speciesById) {
  const s = arr(photo?.subjects)[0];
  if (!s) return 'No subject in frame';
  return subjectLabel(s.species, s.mystery, profile, speciesById);
}

/** Mysteries, most-known first. */
export function mysteryList(profile) {
  return arr(profile?.journal?.mysteries).slice().sort((a, b) =>
    (num(b.level) - num(a.level)) || (Object.keys(obj(b.evidence)).length - Object.keys(obj(a.evidence)).length) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
}

export function evidenceCount(m) { return Object.keys(obj(m?.evidence)).length; }

/** Recordings still waiting for desk analysis, best first. */
export function unanalyzedRecordings(profile) {
  return arr(profile?.journal?.recordings).filter((r) => !r.analyzed).sort((a, b) => num(b.quality) - num(a.quality));
}

/**
 * Species the desk can study: level 5 entries (study progress < 100) and those already
 * studied. → { ready: [entry], studied: [entry] }
 */
export function studyLists(profile) {
  const entries = Object.values(obj(profile?.journal?.species)).filter(Boolean);
  const byName = (a, b) => String(a.id).localeCompare(String(b.id));
  return {
    ready: entries.filter((e) => num(e.level) === LEVEL_DOCUMENTED).sort((a, b) => (num(b.study) - num(a.study)) || byName(a, b)),
    studied: entries.filter((e) => num(e.level) >= LEVEL_STUDIED).sort(byName),
    waiting: entries.filter((e) => num(e.level) < LEVEL_DOCUMENTED).length,
  };
}

/** What the audio lab and the player's audio assist change about analysis. */
export function analysisInfo(profile, stats) {
  const lab = arr(profile?.cabin).includes('audio_lab');
  const assist = num(stats?.audioAssist);
  const lines = ['Analysis cleans up a recording and writes its pitch and rhythm into the journal as evidence.'];
  if (lab) lines.push('Your audio laboratory gives the clearest read of every recording.');
  else lines.push('An audio laboratory in the cabin would sharpen every analysis.');
  if (assist >= 1) lines.push(`Your gear and skills (audio assist ${Math.round(assist * 10) / 10}) turn analysed recordings into extra identification confidence.`);
  else lines.push('Better audio gear and skills would turn analysed recordings into extra identification confidence.');
  return { lab, assist, lines };
}

/** Photos and recordings that can go to the research board. */
export function submitLists(profile) {
  const photos = arr(profile?.journal?.photos).slice().sort((a, b) => num(b.stars) - num(a.stars) || num(b.score) - num(a.score));
  const recs = arr(profile?.journal?.recordings).slice().sort((a, b) => num(b.stars) - num(a.stars) || num(b.quality) - num(a.quality));
  return {
    photos: photos.map((p) => ({ item: p, submitted: !!p.submitted, eligible: num(p.stars) >= 1 })),
    recs: recs.map((r) => ({ item: r, submitted: !!r.submitted, eligible: num(r.stars) >= 1 || num(r.quality) > 0 })),
    pending: photos.filter((p) => !p.submitted && num(p.stars) >= 1).length +
      recs.filter((r) => !r.submitted && (num(r.stars) >= 1 || num(r.quality) > 0)).length,
  };
}

/* ------------------------------------------------------------------ research contracts board */

const BOARD_ORDER = { complete: 0, active: 1, available: 2, locked: 3, done: 4 };

/**
 * Derive the state of every cabin research contract (QuestDef.giver === "board").
 * status: complete (ready to turn in) | active | available | locked | done.
 * A contract with no QuestState is available once its rank and prerequisites are met;
 * hidden contracts stay off the board until the server has given them a state.
 */
export function contractBoard(questDefs, profile) {
  const states = obj(profile?.quests);
  const rank = num(profile?.rank, 1);
  const out = [];
  for (const def of Object.values(obj(questDefs))) {
    if (!def || def.giver !== 'board') continue;
    const st = states[def.id] || null;
    if (def.hidden && !st) continue;
    let status;
    let lock = '';
    switch (st?.status) {
      case 'turned_in': status = 'done'; break;
      case 'complete': status = 'complete'; break;
      case 'active': status = 'active'; break;
      case 'available': status = 'available'; break;
      default: {
        const missing = arr(def.requires).filter((q) => states[q]?.status !== 'turned_in');
        if (rank < num(def.reqRank)) { status = 'locked'; lock = `Needs rank ${def.reqRank}`; }
        else if (missing.length) { status = 'locked'; lock = 'Needs an earlier contract'; }
        else status = 'available';
      }
    }
    const progress = obj(st?.progress);
    const objectives = arr(def.objectives).map((o) => {
      const need = Math.max(1, num(o.count, 1));
      const have = status === 'complete' || status === 'done' ? need : clamp(num(progress[o.id]), 0, need);
      return { def: o, have, need, done: have >= need };
    });
    const total = objectives.reduce((a, o) => a + o.need, 0);
    const got = objectives.reduce((a, o) => a + o.have, 0);
    out.push({ def, status, lock, objectives, fraction: total ? got / total : 0, tracked: !!st?.tracked });
  }
  return out.sort((a, b) => (BOARD_ORDER[a.status] - BOARD_ORDER[b.status]) || a.def.name.localeCompare(b.def.name));
}

/** Short reward line: "300 XP · 80 credits · Field Guide". */
export function rewardLines(reward, items) {
  const r = obj(reward);
  const out = [];
  if (num(r.xp) > 0) out.push(`${r.xp} XP`);
  if (num(r.credits) > 0) out.push(`${formatCredits(r.credits)} Field Credits`);
  for (const id of arr(r.items)) out.push(items?.[id]?.name || statWords(id));
  if (num(r.skillPoints) > 0) out.push(`${r.skillPoints} skill point${r.skillPoints > 1 ? 's' : ''}`);
  for (const [f, n] of Object.entries(obj(r.rep))) out.push(`${n} ${f} reputation`);
  return out;
}

/* ------------------------------------------------------------------ journal display */

/** Species of the unlocked regions plus anything the player has identified elsewhere. */
export function journalSummary(profile, species, ranks) {
  const unlocked = new Set(arr(profile?.regions));
  const catalog = arr(species).filter((s) => arr(s.regions).some((r) => unlocked.has(r)));
  const entries = obj(profile?.journal?.species);
  const ids = new Set(Object.keys(entries));
  for (const s of catalog) ids.add(s.id);
  let identified = 0, documented = 0, studied = 0;
  for (const e of Object.values(entries)) {
    if (!e) continue;
    if (num(e.level) >= 4) identified++;
    if (num(e.level) >= LEVEL_DOCUMENTED) documented++;
    if (num(e.level) >= LEVEL_STUDIED) studied++;
  }
  const byDay = (a, b) => (num(b.firstDay) - num(a.firstDay)) || String(a.id).localeCompare(String(b.id));
  const recent = Object.values(entries).filter(Boolean).sort(byDay).slice(0, 5);
  const rare = arr(profile?.journal?.rare);
  const nextRank = arr(ranks).find((r) => r.index === num(profile?.rank, 1) + 1) || null;
  return {
    total: ids.size, identified, documented, studied, recent,
    rareCount: rare.length, rare: rare.slice().sort((a, b) => num(b.day) - num(a.day)).slice(0, 3),
    rank: num(profile?.rank, 1), rankTitle: rankTitle(ranks, num(profile?.rank, 1)), nextRank,
    mysteries: arr(profile?.journal?.mysteries).length,
    photos: arr(profile?.journal?.photos).length,
    recordings: arr(profile?.journal?.recordings).length,
  };
}

/* ------------------------------------------------------------------ shop */

/** Shop tabs. Gear = equipment, gadgets, keepsakes; Supplies = consumables, pantry and food. */
export function shopTabOf(item) {
  const k = item?.kind;
  return k === 'supply' || k === 'ingredient' || k === 'food' ? 'supplies' : 'gear';
}

export function shopStock(shopIds, items) {
  return arr(shopIds).map((id) => items?.[id]).filter((d) => d && d.price > 0)
    .sort((a, b) => (a.tier - b.tier) || (a.price - b.price) || a.name.localeCompare(b.name));
}

/** Finn's one-liner per category (slot for equipment, kind otherwise). */
export const FINN_LINES = {
  optics: "Glass is where I'd spend first. Heavier lenses see further, but your arms will have opinions about it.",
  camera: "A better camera won't take the picture for you, but it'll forgive you a little more.",
  audio: "Your ears do the real work. Mine just sell the funnel and the microphone.",
  backpack: "More room is more weight, friend. Pack the light stuff and leave the guilt at the door.",
  navigation: "A good map never got anyone lost. A bad one got me famous, once.",
  clothing: "The birds don't mind what you wear, they mind how loudly you wear it.",
  gadget: "Gadgets rattle around in the pack, so keep only the ones that earn their space.",
  keepsake: "Some things aren't for sale. The ones that are, I'm afraid, are mostly sentimental.",
  supplies: "Film and seed. Nothing fancy, but you'll miss them the moment they're gone.",
  pantry: "Oats, flour and honey. The wood does the rest, if you know where to look.",
  upgrades: "Good gear can be made better. I'll leave the tinkering to the workshop, mind.",
  default: "Take your time. Gear is a long conversation, not a transaction.",
};

export function finnLine(item, tab) {
  if (tab === 'upgrades') return FINN_LINES.upgrades;
  if (!item) return FINN_LINES.default;
  if (item.kind === 'equipment') return FINN_LINES[item.slot] || FINN_LINES.default;
  if (item.kind === 'supply') return FINN_LINES.supplies;
  if (item.kind === 'ingredient' || item.kind === 'food') return FINN_LINES.pantry;
  return FINN_LINES[item.kind] || FINN_LINES.default;
}
