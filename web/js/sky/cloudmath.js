// Cloud layout and cover maths (pure: no three.js). A cumulus is a cluster of
// spherical puffs: a broad flat-bottomed base row and smaller puffs heaped towards a
// domed, slightly off-centre top.

/** Small deterministic PRNG (mulberry32) returning floats in [0, 1). */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds `count` cloud clusters scattered over a `span`-metre square.
 * Each cluster: {x, z, alt, yaw, width, height, threshold, cover, puffs:[{x, y, z, s,
 * seed, alpha}]} with puff positions relative to the cluster base centre (y ≥ 0) and
 * `s` the puff radius. Thresholds are spread over 0..1 so cover grows smoothly.
 */
export function cloudLayout(count, span, seed = 1) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    // Big fair-weather cumulus are common, the odd towering one rarer.
    const width = 150 + r() * 220;
    const tall = r() < 0.2 ? 0.8 + r() * 0.3 : 0.45 + r() * 0.25;
    const height = width * tall;
    const puffs = [];
    const nBase = 5 + Math.floor(r() * 3);
    const nTop = 6 + Math.floor(r() * 5);
    // Base row: wide, overlapping, along a slightly curved line, all at the base.
    for (let j = 0; j < nBase; j++) {
      const t = (j + 0.5) / nBase - 0.5;
      const s = width * (0.2 + 0.08 * r()) * (1 - Math.abs(t) * 0.7);
      puffs.push({
        x: t * width * 0.9, y: s * 0.35, z: (r() - 0.5) * width * 0.3,
        s, seed: r(), alpha: 0.9,
      });
    }
    // Heap: puffs higher up get smaller and pull towards a crest.
    const crestX = (r() - 0.5) * width * 0.3;
    for (let j = 0; j < nTop; j++) {
      const h = Math.pow((j + 1) / nTop, 0.8) * (0.55 + 0.25 * r());
      const s = width * (0.22 - 0.1 * h) * (0.8 + 0.4 * r());
      const spreadX = width * 0.45 * (1 - h * 0.7);
      puffs.push({
        x: crestX * h + (r() - 0.5) * 2 * spreadX, y: height * h + s * 0.2, z: (r() - 0.5) * width * 0.35 * (1 - h * 0.5),
        s, seed: r(), alpha: 0.95,
      });
    }
    out.push({
      x: r() * span, z: r() * span, alt: r() * 110, yaw: r() * Math.PI,
      width, height, threshold: (i + r() * 0.8) / count, cover: 0, puffs,
    });
  }
  return out;
}

/**
 * Target cover 0..1 of a cluster with the given threshold. A clear sky keeps a few
 * fair-weather clouds; cover follows env.cloud; rain fills the sky.
 */
export function clusterCover(threshold, cloud, rain = 0) {
  const want = Math.min(1, 0.22 + Math.max(0, cloud) * 0.78 + Math.max(0, rain) * 0.3);
  return want > threshold ? Math.min(1, (want - threshold) * 5) : 0;
}

/** Fraction of clusters with any cover — the visible share of the sky's clouds. */
export function coverFraction(layout, cloud, rain = 0) {
  let n = 0;
  for (const c of layout) if (clusterCover(c.threshold, cloud, rain) > 0) n++;
  return layout.length ? n / layout.length : 0;
}
