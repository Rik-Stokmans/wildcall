// Waypoint pins on the HUD compass strip (hooked in from js/ui/hud/index.js). Small coloured
// pins with the waypoint's letter and the distance, fading with distance; the selected (else
// the nearest) one slightly stronger; at most the 4 nearest on the strip. Same projection as
// the landmark pips (hud/compass.js stripOffset). Styles: css/minimap.css (.mm-cpin).

import { waypointPips, shortDistance } from './mm-math.js';

export function createCompassWaypoints(ctx, strip, { limit = 4 } = {}) {
  const pool = [];
  let list = null;
  let selected = null;
  ctx.bus?.on?.('waypoints', (d) => { list = d?.list || []; selected = d?.selected ?? null; });

  function node() {
    const n = document.createElement('div');
    n.className = 'mm-cpin';
    const head = document.createElement('i');
    const dist = document.createElement('span');
    n.append(head, dist);
    strip.appendChild(n);
    n._letter = ''; n._dist = ''; n._color = '';
    return n;
  }

  return {
    update(px, pz, yaw, halfSpan) {
      if (!list) { list = ctx.waypoints?.list?.() || null; selected = ctx.waypoints?.selectedId ?? null; }
      const pins = list && list.length ? waypointPips(list, px, pz, yaw, halfSpan, { limit, selected }) : [];
      while (pool.length < pins.length) pool.push(node());
      for (let i = 0; i < pool.length; i++) {
        const n = pool[i];
        const p = pins[i];
        if (!p) { if (n.style.display !== 'none') n.style.display = 'none'; continue; }
        n.style.display = '';
        n.style.left = `${50 + p.offset * 50}%`;
        n.style.opacity = String(Math.round(p.alpha * (p.strong ? 1 : 0.78) * 100) / 100);
        if (n._color !== p.color) { n._color = p.color; n.style.setProperty('--c', p.color); }
        if (n._letter !== p.letter) { n._letter = p.letter; n.firstChild.textContent = p.letter; }
        const d = shortDistance(p.dist);
        if (n._dist !== d) { n._dist = d; n.lastChild.textContent = d; }
        n.classList.toggle('strong', p.strong);
        if (n.title !== p.name) n.title = p.name; // no attribute write every frame
      }
    },
  };
}
