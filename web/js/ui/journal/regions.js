// Region-type names for the map: the world is unbounded and the client only learns the
// region type of places it has actually been near (via ctx.world.regionAt) or discovered
// (LocEntry.region). Those samples are grouped into labelled patches over explored land.

export const SAMPLE_CELL = 128;    // metres per remembered sample
export const BLOCK_CELLS = 4;      // samples per block side (512 m) when joining patches into one label
export const MAX_SAMPLES = 4000;

export function sampleKey(x, z) { return `${Math.floor(x / SAMPLE_CELL)},${Math.floor(z / SAMPLE_CELL)}`; }

/** Points around (px, pz) worth sampling: the player's cell and a ring of neighbours. */
export function samplePoints(px, pz) {
  const out = [{ x: px, z: pz }];
  for (const r of [SAMPLE_CELL, SAMPLE_CELL * 2]) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      out.push({ x: px + Math.cos(a) * r, z: pz + Math.sin(a) * r });
    }
  }
  return out;
}

/**
 * Remember region ids for points. `samples` is a Map<"cx,cz", regionId>. Region 255 (open
 * water / not loaded) is ignored. Returns true when anything changed.
 */
export function recordSamples(samples, points, regionAt) {
  let changed = false;
  for (const p of points) {
    const r = regionAt(p.x, p.z);
    if (r == null || r === 255 || r < 0) continue;
    const k = sampleKey(p.x, p.z);
    if (samples.get(k) !== r) {
      if (!samples.has(k) && samples.size >= MAX_SAMPLES) samples.delete(samples.keys().next().value);
      samples.set(k, r);
      changed = true;
    }
  }
  return changed;
}

/** Add the samples that discovered locations imply (they carry their region type). */
export function recordLocations(samples, locations) {
  let changed = false;
  for (const loc of Object.values(locations || {})) {
    if (!loc?.pos || loc.region == null || loc.region === 255) continue;
    const k = sampleKey(loc.pos.x, loc.pos.z);
    if (!samples.has(k)) { samples.set(k, loc.region); changed = true; }
  }
  return changed;
}

/**
 * Group samples that lie on explored land into labelled patches: 8-connected blocks of the
 * same region id form one patch, labelled at the sample nearest its centroid.
 * Returns [{region, x, z, cells}] (x, z = world centre of the label).
 */
export function regionLabels(samples, isExplored) {
  const blocks = new Map(); // "bx,bz,region" -> {region, bx, bz, pts:[{x,z}]}
  for (const [key, region] of samples) {
    const [cx, cz] = key.split(',').map(Number);
    const x = (cx + 0.5) * SAMPLE_CELL, z = (cz + 0.5) * SAMPLE_CELL;
    if (!isExplored(x, z)) continue;
    const bx = Math.floor(cx / BLOCK_CELLS), bz = Math.floor(cz / BLOCK_CELLS);
    const bk = `${bx},${bz},${region}`;
    let b = blocks.get(bk);
    if (!b) blocks.set(bk, (b = { region, bx, bz, pts: [] }));
    b.pts.push({ x, z });
  }
  const seen = new Set();
  const labels = [];
  for (const [bk, b] of blocks) {
    if (seen.has(bk)) continue;
    const pts = [];
    const stack = [b];
    seen.add(bk);
    while (stack.length) {
      const cur = stack.pop();
      pts.push(...cur.pts);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nk = `${cur.bx + dx},${cur.bz + dz},${cur.region}`;
          const nb = blocks.get(nk);
          if (nb && !seen.has(nk)) { seen.add(nk); stack.push(nb); }
        }
      }
    }
    let mx = 0, mz = 0;
    for (const p of pts) { mx += p.x; mz += p.z; }
    mx /= pts.length; mz /= pts.length;
    let best = pts[0], bd = Infinity;
    for (const p of pts) { const d = (p.x - mx) ** 2 + (p.z - mz) ** 2; if (d < bd) { bd = d; best = p; } }
    labels.push({ region: b.region, x: best.x, z: best.z, cells: pts.length });
  }
  return labels;
}
