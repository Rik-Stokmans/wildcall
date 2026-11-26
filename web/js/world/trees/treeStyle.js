// How each tree kind looks: bark, foliage palettes, leaf cards and wind. Pure data
// (plus tiny helpers): no three.js, no DOM.
//
// The branching shapes themselves come from the server (welcome.trees, contract §11);
// this file only dresses them. Colours are sRGB hex in the source and linear RGB in
// the tables the geometry builders read (see ../color.js).
import { hex, mix } from '../color.js';
import { VEG } from '../constants.js';

/** core.VegKind of the sweet chestnut: a forage kind (>= 18) that is also a tree. */
export const CHESTNUT = 24;

/** Kinds drawn from branching models: the eight tree kinds of core.VegKind.IsTree, plus shrubs. */
export const TREE_KINDS = Object.freeze([VEG.OAK, VEG.BIRCH, VEG.PINE, VEG.SNAG, VEG.AMBER_OAK, VEG.AMBER_BIRCH, VEG.SNOW_PINE, CHESTNUT]);

/** core.TreeVariants */
export const TREE_VARIANTS = 6;

/** Leaf masses per palette entry: low = shaded inside/underside, high = sunlit top. */
const pal = (low, high) => Object.freeze({ low: hex(low), high: hex(high) });

const OAK_LEAF = [pal(0x2f5a26, 0x76a845), pal(0x2b5524, 0x6c9f3f), pal(0x35602a, 0x82b04c)];
const CHESTNUT_LEAF = [pal(0x2e5822, 0x6f9e38), pal(0x34602a, 0x7aa742), pal(0x2a5020, 0x679535)];
const BIRCH_LEAF = [pal(0x46772e, 0x9cc25a), pal(0x4c7d30, 0xa8c962), pal(0x41702b, 0x92ba52)];
const PINE_NEEDLE = [pal(0x173d2b, 0x3f7448), pal(0x1a432e, 0x467b4b), pal(0x163a2a, 0x3a6d45)];
const SNOW_NEEDLE = [pal(0x1b3f31, 0x40704f), pal(0x1d4434, 0x467653)];
const AMBER_OAK_LEAF = [
  pal(0x7c3613, 0xd17a2c), // rust
  pal(0x8d5016, 0xe6a73c), // amber gold
  pal(0x86301a, 0xcf5f2b), // copper russet
  pal(0x7a4a14, 0xd99a35),
];
const AMBER_BIRCH_LEAF = [pal(0xa4761a, 0xf3d158), pal(0xae7f1f, 0xf6dc72), pal(0x9a6418, 0xebb848)];
const SHRUB_LEAF = [pal(0x2a5428, 0x63954a), pal(0x2e5a2a, 0x6c9c4d), pal(0x27502a, 0x5c8d47)];

/** Snow on the upper side of a frosted pine spray. */
export const SNOW = Object.freeze(hex(0xf4f7fb));

/**
 * Bark: colours at the root flare, up the bole and on thin twigs; `top` is where
 * stems head towards higher up (pine's orange upper trunk); `mark` paints birch.
 */
const BARK = {
  oak: { root: hex(0x5a4a3b), base: hex(0x8a7863), top: hex(0x968470), twig: hex(0x6e5c4a), moss: hex(0x5d7341), tex: 'furrow' },
  chestnut: { root: hex(0x584738), base: hex(0x82705c), top: hex(0x8c7862), twig: hex(0x6b5644), moss: hex(0x5f7542), tex: 'spiral' },
  birch: { root: hex(0x5b544b), base: hex(0xe4e0d4), top: hex(0xeeebe2), twig: hex(0x5c3f33), moss: null, tex: 'birch' },
  pine: { root: hex(0x553a2c), base: hex(0x8e5a3e), top: hex(0xd8864a), twig: hex(0x6e4c38), moss: null, tex: 'plates' },
  snag: { root: hex(0x5f5850), base: hex(0x9a938a), top: hex(0xb9b3a9), twig: hex(0x8d867d), moss: null, tex: 'furrow' },
  shrub: { root: hex(0x5a4a3a), base: hex(0x705c48), top: hex(0x705c48), twig: hex(0x6a5642), moss: null, tex: 'furrow' },
};

/**
 * Style per kind.
 *   leaf      palettes the masses cycle through
 *   leafTex   'broad' | 'needle' (the card texture atlas)
 *   card      leaf card edge length in metres at scale 1 (near detail)
 *   density   leaf cards per square metre of mass surface, relative
 *   season    seasonal tint class (season.js), '' = keeps its own colours all year
 *   snow      sprays carry snow on their upper side
 *   bend      whole-tree lean at the top at full wind (metres at scale 1)
 *   flutter   extra movement of a foliage mass at full wind (metres)
 *   freq      sway frequency (rad/s)
 *   leafHue   per-instance colour spread of the foliage
 */
const STYLE = new Map();
const base = { leafTex: 'broad', card: 1.15, density: 1.15, snow: false, bend: 0.16, flutter: 0.07, freq: 1.1, leafHue: 0.16 };
STYLE.set(VEG.OAK, { ...base, name: 'oak', bark: BARK.oak, leaf: OAK_LEAF, season: 'broadleaf' });
STYLE.set(CHESTNUT, { ...base, name: 'chestnut', bark: BARK.chestnut, leaf: CHESTNUT_LEAF, season: 'broadleaf', card: 1.2 });
STYLE.set(VEG.AMBER_OAK, { ...base, name: 'amber_oak', bark: BARK.oak, leaf: AMBER_OAK_LEAF, season: '', leafHue: 0.3 });
STYLE.set(VEG.BIRCH, { ...base, name: 'birch', bark: BARK.birch, leaf: BIRCH_LEAF, season: 'broadleaf', card: 0.85, density: 1.25, bend: 0.26, flutter: 0.1, freq: 1.5 });
STYLE.set(VEG.AMBER_BIRCH, { ...STYLE.get(VEG.BIRCH), name: 'amber_birch', leaf: AMBER_BIRCH_LEAF, season: '', leafHue: 0.24 });
STYLE.set(VEG.PINE, { ...base, name: 'pine', bark: BARK.pine, leaf: PINE_NEEDLE, leafTex: 'needle', season: 'evergreen', card: 0.95, density: 1.35, bend: 0.2, flutter: 0.035, freq: 0.9, leafHue: 0.1 });
STYLE.set(VEG.SNOW_PINE, { ...STYLE.get(VEG.PINE), name: 'snow_pine', leaf: SNOW_NEEDLE, season: '', snow: true, bend: 0.12, flutter: 0.02, leafHue: 0.04 });
STYLE.set(VEG.SNAG, { ...base, name: 'snag', bark: BARK.snag, leaf: [], season: '', bend: 0.03, flutter: 0 });
STYLE.set(VEG.SHRUB, { ...base, name: 'shrub', bark: BARK.shrub, leaf: SHRUB_LEAF, season: 'shrub', card: 0.62, density: 1.5, bend: 0.06, flutter: 0.04, freq: 1.9, leafHue: 0.18 });
for (const s of STYLE.values()) Object.freeze(s);

/** The style of a kind drawn by the tree system, or undefined. */
export function treeStyle(kind) { return STYLE.get(kind); }

/** True for kinds this system draws from branching models (trees and shrubs). */
export function isModelKind(kind) { return STYLE.has(kind); }

/** Bark colour of a point on a limb. */
export function barkColor(bark, y, height, radius, trunkR) {
  const h = Math.max(0, Math.min(1, y / height));
  if (radius < 0.035) return bark.twig;
  // Thick wood shows the bole colour, thin wood drifts to the twig colour.
  const thick = Math.max(0, Math.min(1, (radius - 0.035) / Math.max(0.05, trunkR * 0.45)));
  let c = mix(bark.base, bark.top, Math.min(1, h * 1.25));
  if (y < 0.9) c = mix(bark.root, c, Math.max(0, y / 0.9));
  return mix(bark.twig, c, Math.pow(thick, 0.6));
}
