// A quest's search area (proto.QuestState.area: {name, x, z, radius}): the place a quest
// points the player to, e.g. "the low bushes beside the old trail" for The Unseen Singer.
// It is a named circle on the ground, never a bird. Shown as:
//   * a soft amber band on the compass strip, as wide as the circle looks from here, with
//     the distance under it (createCompassArea, hooked in from hud/index.js);
//   * a line under the quest tracker ("Search the low bushes beside the old trail");
//   * a quest marker on the minimap and the big map (journal/map-data.js buildMarkers).
// Pure helpers first (tested in search-area.test.js), then the small DOM part.
import { headingTo, stripOffset } from './compass.js';

/**
 * The search area to show: the tracked active quest's area, else the first active quest
 * with one. Returns null or { questId, name, x, z, radius }.
 */
export function questSearchArea(profile) {
  let any = null;
  for (const [id, qs] of Object.entries(profile?.quests || {})) {
    const a = qs?.area;
    if (!a || qs.status !== 'active' || !Number.isFinite(a.x) || !Number.isFinite(a.z)) continue;
    const out = { questId: id, name: a.name || '', x: a.x, z: a.z, radius: Math.max(0, a.radius || 0) };
    if (qs.tracked) return out;
    if (!any) any = out;
  }
  return any;
}

/**
 * Where the area sits on the compass strip (±halfSpan rad around the heading).
 * Returns { offset (-1..1, or null when off the strip), width (strip fraction), dist (m to
 * the edge of the circle, 0 inside), inside }.
 */
export function areaOnStrip(area, px, pz, yaw, halfSpan) {
  const dx = area.x - px, dz = area.z - pz;
  const centre = Math.hypot(dx, dz);
  const r = area.radius || 0;
  const inside = centre <= r;
  const dist = Math.max(0, centre - r);
  if (inside) return { offset: null, width: 0, dist: 0, inside: true };
  const bearing = headingTo(px, pz, area.x, area.z);
  const half = Math.asin(Math.min(1, r / Math.max(centre, 1e-3)));
  const offset = stripOffset(bearing, yaw, halfSpan + half);
  const width = Math.min(1, Math.max(0.02, (2 * half) / (2 * halfSpan)));
  return { offset: offset == null ? null : Math.max(-1, Math.min(1, offset * (halfSpan + half) / halfSpan)), width, dist, inside: false };
}

/** The tracker line: "Search the low bushes beside the old trail". */
export function areaLine(area, inside) {
  if (!area?.name) return '';
  return inside ? `You are at ${area.name}: listen, then look low` : `Search ${area.name}`;
}

/** Distance words for the compass pin: "85 m", "1.2 km". */
export function areaDistance(m) {
  if (!(m > 0)) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 5) * 5 || Math.round(m)} m`;
}

/** Compass band for the area (one element, no per-frame allocation, writes only on change). */
export function createCompassArea(ctx, strip) {
  let node = null, label = null, lastLeft = '', lastWidth = '', lastText = '', lastShown = null;
  let stripW = 0, frames = 0;
  function make() {
    node = document.createElement('div');
    node.className = 'hud-area-band';
    node.appendChild(document.createElement('i'));
    label = document.createElement('span');
    node.appendChild(label);
    strip.appendChild(node);
  }
  const show = (on) => { if (lastShown !== on) { lastShown = on; if (node) node.style.display = on ? '' : 'none'; } };
  return {
    update(px, pz, yaw, halfSpan) {
      const area = questSearchArea(ctx.state?.profile);
      if (!area) { show(false); return; }
      const s = areaOnStrip(area, px, pz, yaw, halfSpan);
      if (s.offset == null) { show(false); return; }
      if (!node) make();
      show(true);
      if (!(frames++ % 120) || !stripW) stripW = strip.clientWidth || 600; // a layout read now and then, not every frame
      const left = `${(50 + s.offset * 50).toFixed(1)}%`;
      const width = `${Math.max(12, Math.round(s.width * stripW))}px`;
      if (left !== lastLeft) { lastLeft = left; node.style.left = left; }
      if (width !== lastWidth) { lastWidth = width; node.firstChild.style.width = width; node.firstChild.style.marginLeft = `-${parseInt(width, 10) / 2}px`; }
      const text = areaDistance(s.dist);
      if (text !== lastText) { lastText = text; label.textContent = text; }
    },
  };
}
