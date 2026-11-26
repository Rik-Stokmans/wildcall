// Sparse fog of war. Profile.explored maps "tx,tz" (a 512 m map tile) to base64 of a
// 256-bit mask, one bit per 32 m cell: bit i = cz*16 + cx, stored in byte i>>3 under
// mask 1 << (i & 7). A missing tile is wholly unexplored. All coordinates are signed;
// tile / cell indices use floor division so negative world coordinates work.

export const TILE_SIZE = 512;
export const CELL_SIZE = 32;
export const CELLS_PER_SIDE = TILE_SIZE / CELL_SIZE; // 16
export const MASK_BYTES = (CELLS_PER_SIDE * CELLS_PER_SIDE) / 8; // 32

export function tileKey(tx, tz) { return `${tx},${tz}`; }

/** "3,-2" -> {tx: 3, tz: -2}; null when malformed. */
export function parseTileKey(key) {
  const m = /^(-?\d+),(-?\d+)$/.exec(String(key));
  return m ? { tx: Number(m[1]), tz: Number(m[2]) } : null;
}

/** Tile index containing a world coordinate (floor division, so -1 m is tile -1). */
export function tileIndex(v, size = TILE_SIZE) { return Math.floor(v / size); }

export function worldToTile(x, z) { return { tx: tileIndex(x), tz: tileIndex(z) }; }

/** Tile and in-tile cell containing a world point. */
export function worldToCell(x, z) {
  const tx = tileIndex(x), tz = tileIndex(z);
  const cx = Math.floor((x - tx * TILE_SIZE) / CELL_SIZE);
  const cz = Math.floor((z - tz * TILE_SIZE) / CELL_SIZE);
  return { tx, tz, cx: Math.min(CELLS_PER_SIDE - 1, cx), cz: Math.min(CELLS_PER_SIDE - 1, cz) };
}

/** World-space rectangle {x, z, size} of a cell. */
export function cellRect(tx, tz, cx, cz) {
  return { x: tx * TILE_SIZE + cx * CELL_SIZE, z: tz * TILE_SIZE + cz * CELL_SIZE, size: CELL_SIZE };
}

/** Decode a base64 mask into 32 bytes; null when absent or malformed. */
export function decodeMask(b64) {
  if (!b64 || typeof b64 !== 'string') return null;
  let bin;
  try { bin = atob(b64); } catch { return null; }
  if (bin.length !== MASK_BYTES) return null;
  const out = new Uint8Array(MASK_BYTES);
  for (let i = 0; i < MASK_BYTES; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode a 32-byte mask (used by tests and by anything that builds a fixture). */
export function encodeMask(mask) {
  let s = '';
  for (let i = 0; i < MASK_BYTES; i++) s += String.fromCharCode(mask[i] || 0);
  return btoa(s);
}

/** Is cell (cx, cz) set in a decoded mask? */
export function maskBit(mask, cx, cz) {
  if (!mask || cx < 0 || cz < 0 || cx >= CELLS_PER_SIDE || cz >= CELLS_PER_SIDE) return false;
  const i = cz * CELLS_PER_SIDE + cx;
  return (mask[i >> 3] & (1 << (i & 7))) !== 0;
}

export function setMaskBit(mask, cx, cz) {
  const i = cz * CELLS_PER_SIDE + cx;
  mask[i >> 3] |= 1 << (i & 7);
}

/**
 * Build a queryable view of Profile.explored. Masks decode lazily and are cached per
 * base64 string, so rebuilding the view on every profile update is cheap.
 */
export function createFog() {
  let cache = new Map(); // key -> {b64, mask, count}
  let tiles = [];        // [{key, tx, tz, mask, count}] tiles with at least one explored cell
  let totalCells = 0;
  const fog = {
    /** Replace the data (Profile.explored). */
    update(explored) {
      const next = new Map();
      const list = [];
      let total = 0;
      for (const [key, b64] of Object.entries(explored || {})) {
        const k = parseTileKey(key);
        if (!k) continue;
        let e = cache.get(key);
        if (!e || e.b64 !== b64) {
          const mask = decodeMask(b64);
          e = { b64, mask, count: mask ? popcount(mask) : 0 };
        }
        next.set(key, e);
        if (e.mask && e.count > 0) { list.push({ key, tx: k.tx, tz: k.tz, mask: e.mask, count: e.count }); total += e.count; }
      }
      cache = next;
      tiles = list;
      totalCells = total;
      return fog;
    },
    /** Is the 32 m cell containing world point (x, z) explored? */
    isExplored(x, z) {
      const c = worldToCell(x, z);
      const e = cache.get(tileKey(c.tx, c.tz));
      return !!(e && e.mask && maskBit(e.mask, c.cx, c.cz));
    },
    /** Tiles that contain at least one explored cell. */
    get tiles() { return tiles; },
    get cellCount() { return totalCells; },
    /** Call fn(x, z, size) for every explored cell whose rectangle intersects the world rect. */
    forEachCell(rect, fn) {
      for (const t of tiles) {
        const x0 = t.tx * TILE_SIZE, z0 = t.tz * TILE_SIZE;
        if (x0 > rect.x1 || x0 + TILE_SIZE < rect.x0 || z0 > rect.z1 || z0 + TILE_SIZE < rect.z0) continue;
        for (let cz = 0; cz < CELLS_PER_SIDE; cz++) {
          for (let cx = 0; cx < CELLS_PER_SIDE; cx++) {
            if (!maskBit(t.mask, cx, cz)) continue;
            const x = x0 + cx * CELL_SIZE, z = z0 + cz * CELL_SIZE;
            if (x > rect.x1 || x + CELL_SIZE < rect.x0 || z > rect.z1 || z + CELL_SIZE < rect.z0) continue;
            fn(x, z, CELL_SIZE);
          }
        }
      }
    },
  };
  return fog.update({});
}

function popcount(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) { let b = mask[i]; while (b) { n += b & 1; b >>= 1; } }
  return n;
}

/**
 * Which map tiles must be fetched for a viewport: only tiles that contain an explored
 * cell AND intersect the world rectangle {x0, z0, x1, z1}. Unexplored land is never requested.
 */
export function tilesToFetch(fogView, rect) {
  const out = [];
  for (const t of fogView.tiles) {
    const x0 = t.tx * TILE_SIZE, z0 = t.tz * TILE_SIZE;
    if (x0 > rect.x1 || x0 + TILE_SIZE < rect.x0 || z0 > rect.z1 || z0 + TILE_SIZE < rect.z0) continue;
    out.push({ key: t.key, tx: t.tx, tz: t.tz });
  }
  return out;
}

/** Substitute signed tile coordinates into the welcome's mapUrl template. */
export function tileUrl(template, tx, tz) {
  return String(template || '/map/{tx}/{tz}.png').replace('{tx}', String(tx)).replace('{tz}', String(tz));
}
