// The map's own cache of points of interest and trails. The welcome message carries the
// home valley; further POIs and trails stream in as 'net:pois' while the player travels.
// The map keeps them (bounded) so it can draw trails and quest targets far from the player.

const MAX_POIS = 4000;
const MAX_TRAILS = 500;

export function createMapWorld(ctx) {
  const pois = new Map();
  const trails = new Map();

  function addPois(list) {
    for (const p of list || []) {
      if (!p?.id) continue;
      pois.delete(p.id);
      pois.set(p.id, p);
      if (pois.size > MAX_POIS) pois.delete(pois.keys().next().value);
    }
  }
  function addTrails(list) {
    for (const t of list || []) {
      if (!t?.id) continue;
      trails.delete(t.id);
      trails.set(t.id, t);
      if (trails.size > MAX_TRAILS) trails.delete(trails.keys().next().value);
    }
  }
  /** Pull in what ctx.state already holds (welcome content). Cheap and idempotent. */
  function sync() {
    addPois(Object.values(ctx.state.pois || {}));
    addTrails(ctx.state.trails);
  }
  ctx.bus.on('welcome', sync);
  ctx.bus.on('net:pois', (m) => { addPois(m?.pois); addTrails(m?.trails); });
  return { pois, trails, sync, trailList() { return [...trails.values()]; } };
}
