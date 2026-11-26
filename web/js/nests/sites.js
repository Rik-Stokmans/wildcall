// Pure nest rules for the client (task c-field): the wire format of the `nests`
// message, site and stage words, what can be seen inside an open nest, and where a
// cavity's entrance sits on its trunk. No DOM, no three.js (sites.test.js).

/** Wire order of the site types (proto.NestSites). */
export const NEST_SITES = Object.freeze(['cavity', 'cup_shrub', 'cup_fork', 'platform', 'dome', 'pendant', 'ground', 'scrape', 'reed', 'floating', 'burrow', 'ledge']);

/** Nest stages (core.NestOld … NestChicks). */
export const STAGE = Object.freeze({ OLD: 0, BUILDING: 1, EGGS: 2, CHICKS: 3 });
export const STAGE_WORDS = Object.freeze(['old', 'being built', 'with eggs', 'with chicks']);
export const STAGE_LABELS = Object.freeze(['Old nest', 'Being built', 'Eggs', 'Chicks']);

/** Player-facing words for a site, as a field note would put them. */
export const SITE_WORDS = Object.freeze({
  cavity: 'A hole in a tree',
  cup_shrub: 'A cup nest in a shrub',
  cup_fork: 'A cup nest in a tree fork',
  platform: 'A big stick platform',
  dome: 'A domed nest in thick cover',
  pendant: 'A cup hung beneath a branch',
  ground: 'A nest hidden on the ground',
  scrape: 'A bare scrape on open ground',
  reed: 'A cup woven among reeds',
  floating: 'A floating nest mound',
  burrow: 'A burrow in a bank',
  ledge: 'A nest on a ledge',
});

/** Sites whose contents can be seen from outside (an open cup or platform). */
const OPEN = new Set(['cup_shrub', 'cup_fork', 'platform', 'pendant', 'ground', 'scrape', 'reed', 'floating', 'ledge']);
/** Enclosed sites: at the chick stage a hungry head shows at the entrance. */
const ENCLOSED = new Set(['cavity', 'dome', 'burrow']);

export const isOpenSite = (site) => OPEN.has(site);

/**
 * Parses a NestsMsg ({n: [[id, siteIndex, stage, x, y, z, size, yaw], ...]}).
 * Rows that cannot be read are skipped.
 * @returns {{id:number, site:string, stage:number, x:number, y:number, z:number, size:number, yaw:number}[]}
 */
export function parseNests(msg) {
  const out = [];
  for (const row of msg?.n || []) {
    if (!Array.isArray(row) || row.length < 8) continue;
    const [id, si, stage, x, y, z, size, yaw] = row.map(Number);
    const site = NEST_SITES[si];
    if (!site || ![id, x, y, z, size, yaw].every(Number.isFinite)) continue;
    out.push({ id, site, stage: Math.max(0, Math.min(3, stage | 0)), x, y, z, size: size > 0 ? size : 0.15, yaw });
  }
  return out;
}

/** What shows in a nest: 'eggs' | 'chicks' | 'peek' (a head at an entrance) | null. */
export function contentsOf(site, stage) {
  if (stage === STAGE.EGGS && OPEN.has(site)) return 'eggs';
  if (stage === STAGE.CHICKS) {
    if (OPEN.has(site)) return 'chicks';
    if (ENCLOSED.has(site)) return 'peek';
  }
  return null;
}

/** A small deterministic hash of a nest id (0..1) for clutch size and placement. */
export function nestHash(id, salt = 0) {
  let h = (id >>> 0) ^ Math.imul(salt + 0x9e37, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** How many eggs or chicks a nest shows (2–5; big platforms fewer). */
export function clutchSize(id, site) {
  const h = nestHash(id, 7);
  if (site === 'platform' || site === 'ledge') return 1 + Math.floor(h * 3);
  return 2 + Math.floor(h * 4);
}

/** core.HeadingDir: the unit XZ direction of a compass heading. */
export function headingDir(yaw) {
  return { x: Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Three.js rotation.y that turns a model whose front faces −Z towards a heading. */
export const yawToRotY = (yaw) => -yaw;

/**
 * Where a cavity entrance sits on a trunk segment (world space): the point on the
 * segment's axis nearest the nest, pushed out by the trunk radius there in the nest's
 * heading (made perpendicular to the segment). Returns null for a degenerate segment.
 * @param {{x,y,z}} p  nest centre
 * @param {{x,y,z}} a  segment start (world)
 * @param {{x,y,z}} b  segment end (world)
 * @param {number} ra  radius at a (world)
 * @param {number} rb  radius at b (world)
 * @param {number} yaw heading the entrance faces
 */
export function cavityOnTrunk(p, a, b, ra, rb, yaw) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (!(len2 > 1e-8)) return null;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t };
  const r = ra + (rb - ra) * t;
  const len = Math.sqrt(len2);
  const ux = dx / len, uy = dy / len, uz = dz / len;
  const h = headingDir(yaw);
  // remove the component along the segment so the entrance faces straight out
  const dot = h.x * ux + h.z * uz;
  let nx = h.x - ux * dot, ny = -uy * dot, nz = h.z - uz * dot;
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-6) { nx = h.x; ny = 0; nz = h.z; } else { nx /= nl; ny /= nl; nz /= nl; }
  return { x: q.x + nx * r, y: q.y + ny * r, z: q.z + nz * r, r, nx, ny, nz };
}

/** Distance from a point to a segment (all {x,y,z}). */
export function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t), p.z - (a.z + dz * t));
}

/** Model space → world for a vegetation instance (same as the world's tree transform). */
export function treeToWorld(p, v) {
  const c = Math.cos(v.rot), s = Math.sin(v.rot), k = v.scale;
  return { x: v.x + k * (c * p[0] + s * p[2]), y: v.y + k * p[1], z: v.z + k * (-s * p[0] + c * p[2]) };
}

/** Journal line for a found nest: "A cup nest in a shrub, with eggs". */
export function nestLine(entry) {
  const words = SITE_WORDS[entry?.site] || 'A nest';
  const st = STAGE_WORDS[entry?.stage] ?? '';
  if (entry?.stage === STAGE.OLD) return words.replace(/^An? /, 'An old ');
  return `${words}, ${st}`;
}

/** Tree kinds (core.VegKind) whose models carry cavities. */
export const TREE_KINDS = Object.freeze([0, 1, 2, 3, 13, 14, 15, 24]);
