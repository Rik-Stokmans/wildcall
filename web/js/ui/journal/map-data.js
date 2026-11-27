// Pure map content: which markers and trails the map shows. The map never shows birds,
// never shows a secret place before the player has discovered it, and never shows the
// position of anything on ground the player has not explored (except the cabin).

import { poiIcon, poiKindLabel } from './journal-logic.js';
import { objectiveRows } from './quest-logic.js';

/**
 * Trails to draw. stats.mapDetail 0 = landmarks only (no trails), >= 1 = trails.
 * Hidden trails appear only when the server has revealed them (Profile.trails).
 */
export function visibleTrails(trails, mapDetail, revealedIds) {
  if ((mapDetail || 0) < 1) return [];
  const revealed = new Set(revealedIds || []);
  return (trails || []).filter((t) => t.points && t.points.length >= 2 && (!t.hidden || revealed.has(t.id)));
}

/**
 * Marker descriptors {key, type, x, z, icon, label, sub}.
 *   home    the cabin, always
 *   place   every entry of Journal.locations
 *   npc     NPCs the player has met (flag met:<id>)
 *   quest   objective markers of tracked quests: discover / talk targets that are known
 *           (a discovered place, a met NPC, or a visible POI on explored ground)
 * `pois` is a Map or object of id -> core.POI the client has received.
 */
export function buildMarkers({ locations, pois, npcs, flags, quests, questStates, home, isExplored }) {
  const out = [];
  const poiList = pois instanceof Map ? pois : new Map(Object.entries(pois || {}));
  const discovered = locations || {};
  out.push({ key: 'home', type: 'home', x: home.x, z: home.z, icon: 'cabin', label: 'Naturalist Cabin', sub: 'Home' });

  for (const [id, loc] of Object.entries(discovered)) {
    if (!loc?.pos) continue;
    out.push({ key: 'loc:' + id, type: 'place', x: loc.pos.x, z: loc.pos.z, icon: poiIcon(loc.kind), label: loc.name, sub: poiKindLabel(loc.kind) });
  }

  const npcPos = new Map();
  for (const npc of Object.values(npcs || {})) {
    const poi = poiList.get(npc.poi);
    if (!poi) continue;
    npcPos.set(npc.id, poi.pos);
    if (flags?.['met:' + npc.id]) out.push({ key: 'npc:' + npc.id, type: 'npc', x: poi.pos.x, z: poi.pos.z, icon: 'npc', label: npc.name, sub: npc.role });
  }

  for (const def of Object.values(quests || {})) {
    const state = questStates?.[def.id];
    if (!state?.tracked || (state.status !== 'active' && state.status !== 'complete')) continue;
    for (const row of objectiveRows(def, state)) {
      if (row.done) continue;
      const obj = def.objectives.find((o) => o.id === row.id);
      if (!obj || (obj.kind !== 'discover' && obj.kind !== 'talk')) continue;
      let pos = null;
      if (obj.kind === 'discover') {
        const loc = discovered[obj.target];
        const poi = poiList.get(obj.target);
        if (loc?.pos) pos = loc.pos;
        else if (poi && !poi.hidden && isExplored?.(poi.pos.x, poi.pos.z)) pos = poi.pos;
      } else {
        const p = npcPos.get(obj.target);
        if (p && (flags?.['met:' + obj.target] || isExplored?.(p.x, p.z))) pos = p;
      }
      if (pos) out.push({ key: `quest:${def.id}:${obj.id}`, type: 'quest', x: pos.x, z: pos.z, icon: 'quest', label: obj.text, sub: def.name });
    }
    // [search-area hook] the place the quest points to (QuestState.area: a named circle, never a bird)
    const area = state.status === 'active' ? state.area : null;
    if (area && Number.isFinite(area.x) && Number.isFinite(area.z)) {
      out.push({ key: `quest:${def.id}:area`, type: 'quest', x: area.x, z: area.z, icon: 'quest', label: area.name ? area.name[0].toUpperCase() + area.name.slice(1) : def.name, sub: def.name, radius: area.radius || 0 });
    }
  }
  return out;
}

/** Group sampled trail points into segments to draw, skipping segments on unexplored ground. */
export function trailSegments(trail, isExplored, step = 1) {
  const segs = [];
  let cur = null;
  const pts = trail.points;
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    if (isExplored(p.x, p.z)) {
      if (!cur) segs.push((cur = []));
      cur.push(p);
    } else cur = null;
  }
  return segs.filter((s) => s.length >= 2);
}

const LABEL_PRIORITY = { home: 0, quest: 1, place: 2, npc: 3 };

/**
 * Which marker labels to hide so that none overlap: greedy by priority (home, quest
 * markers, places, then people), labels drawn to the right of their icon.
 * items: [{key, type, x, y, label}] in screen px. Returns a Set of keys to quieten.
 */
export function quietLabels(items, { charW = 6.6, pad = 26, h = 18 } = {}) {
  const sorted = [...items].sort((a, b) => (LABEL_PRIORITY[a.type] ?? 9) - (LABEL_PRIORITY[b.type] ?? 9));
  const boxes = [], quiet = new Set();
  for (const it of sorted) {
    const w = pad + String(it.label || '').length * charW;
    const box = { x0: it.x - 12, x1: it.x + w, y0: it.y - h / 2, y1: it.y + h / 2 };
    if (boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) { quiet.add(it.key); continue; }
    boxes.push(box);
  }
  return quiet;
}
