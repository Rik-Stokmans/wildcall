// Placement rules of tree instances shared by the forest and its tests. Pure: no
// three.js, no DOM.
import { hashByte } from '../color.js';
import { VEG } from '../constants.js';
import { treeStyle, TREE_VARIANTS } from './treeStyle.js';
import { DETAIL } from './treeGeometry.js';
import { SHRUB_VARIANTS } from './shrubModels.js';

/** Trees further than this from the camera (m) cast no shadow (beyond every shadow map). */
export const SHADOW_FAR = 110;

/** Shadow casters kept around the camera whatever the view direction (m). */
export const SHADOW_KEEP = 70;

// --- distance bands (performance pass) --------------------------------------------------
// Detail follows each instance's distance from the camera (not its chunk's LOD): near
// cards and full limbs only close by, the mid model (fewer, larger cards, thick limbs
// only) after `near` metres, the far model after `mid`. Around each boundary both
// models are drawn over `fade` metres with complementary screen-space dither, so a
// tree never visibly swaps. Shadows come from separate caster sets (mid detail) that
// hold only the instances whose shadow can land in the sun's shadow map.

/** Band edges in metres per quality, for trees and (smaller) for shrubs. */
// `cut`: far trees dither out over `fade` metres before this distance (low only: deep
// in its fog, where they are mostly sky colour anyway).
export const TREE_BANDS = Object.freeze({
  low: Object.freeze({ near: 24, mid: 60, fade: 8, cut: 190 }),
  medium: Object.freeze({ near: 38, mid: 110, fade: 10, cut: 425 }),
  high: Object.freeze({ near: 56, mid: 160, fade: 12, cut: 1e5 }),
});
export const SHRUB_BANDS = Object.freeze({
  low: Object.freeze({ near: 14, mid: 45, fade: 5 }),
  medium: Object.freeze({ near: 20, mid: 60, fade: 6 }),
  high: Object.freeze({ near: 28, mid: 85, fade: 7 }),
});

/** The bands of a kind group for a settings.quality name. */
export function bandsFor(isShrub, quality) {
  const t = isShrub ? SHRUB_BANDS : TREE_BANDS;
  return t[quality] || t.medium;
}

/**
 * Which detail levels must hold an instance at horizontal distance `d` (bit 1 << DETAIL):
 * its band, plus the neighbour band inside the cross-fade zones; `margin` widens the
 * zones by how far the camera may move before the buffers are refilled.
 */
export function bandMask(d, bands, margin = 0) {
  const h = bands.fade / 2 + margin;
  let mask = 0;
  if (d < bands.near + h) mask |= 1 << DETAIL.NEAR;
  if (d > bands.near - h && d < bands.mid + h) mask |= 1 << DETAIL.MID;
  if (d > bands.mid - h && d < (bands.cut || Infinity) + margin) mask |= 1 << DETAIL.FAR;
  return mask;
}

/**
 * Cross-fade window of a detail level: [inStart, inEnd, outStart, outEnd] in metres.
 * The shader keeps a pixel while its dither value t satisfies t >= 1 − fadeIn and
 * t < fadeOut, so the two levels around a boundary draw complementary pixels.
 */
export function fadeWindow(detail, bands, out = [0, 0, 0, 0]) {
  const h = bands.fade / 2;
  const cut = bands.cut || 1e8;
  const NONE_IN = [-2, -1], NONE_OUT = [cut - bands.fade, cut];
  const near = detail >= DETAIL.NEAR, mid = detail === DETAIL.MID;
  const fin = near ? NONE_IN : mid ? [bands.near - h, bands.near + h] : [bands.mid - h, bands.mid + h];
  const fout = near ? [bands.near - h, bands.near + h] : mid ? [bands.mid - h, bands.mid + h] : NONE_OUT;
  out[0] = fin[0]; out[1] = fin[1]; out[2] = fout[0]; out[3] = fout[1];
  return out;
}

/** The fade factors (0..1) the shader computes for a distance — for tests. */
export function fadeAt(d, win) {
  const c = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  return [c((d - win[0]) / (win[1] - win[0])), 1 - c((d - win[2]) / (win[3] - win[2]))];
}
/** The culling frustum is refreshed after the camera moved this far (m)… */
export const CULL_MOVE = 6;
/** …or turned this far, and is wider than the view by this many degrees. */
export const CULL_TURN_COS = Math.cos((10 * Math.PI) / 180);
export const CULL_MARGIN_DEG = 30;

/** Horizontal reach of a model from its trunk at scale 1 (wood and foliage). */
export function modelReach(model) {
  let r = 0;
  for (const b of model.branches) r = Math.max(r, Math.hypot(b.b[0], b.b[2]) + b.rb);
  for (const l of model.leaves) r = Math.max(r, Math.hypot(l.c[0], l.c[2]) + Math.max(l.r[0], l.r[2]) + 0.8);
  return r;
}

/** Instances at or above this scale are drawn with the giant detail near the player. */
export const GIANT_SCALE = 1.8;

/** Detail level for a chunk LOD and instance scale. */
export function detailFor(lod, scale) {
  if (lod <= 0) return scale >= GIANT_SCALE ? DETAIL.GIANT : DETAIL.NEAR;
  return lod === 1 ? DETAIL.MID : DETAIL.FAR;
}

/** Model variant of an instance's variant byte. */
export function modelVariant(kind, variant) {
  return kind === VEG.SHRUB ? variant % SHRUB_VARIANTS : variant % TREE_VARIANTS;
}

/**
 * Colour multiplier of a tree instance (linear RGB around 1): a little tone and a
 * warm/cool drift, more in the foliage-heavy amber kinds, almost none on snow.
 */
export function treeTint(kind, variant, x, z, out, o) {
  const style = treeStyle(kind);
  const h = (Math.floor(x * 3.1) * 73 + Math.floor(z * 2.7) * 151) & 0xffff;
  const tone = hashByte(variant, h & 255);
  const warm = hashByte(variant ^ (h >> 8), 5) - 0.5;
  const hue = style ? style.leafHue : 0.15;
  const b = 0.9 + tone * 0.2;
  out[o] = b * (1 + warm * hue);
  out[o + 1] = b * (1 + warm * hue * 0.15);
  out[o + 2] = b * (1 - warm * hue * 1.3);
}

/** Zoom (fov / base fov) in steps: 1, 0.7, 0.5, 0.35, 0.25 (forest.js takes its root). */
export function zoomStep(z) {
  if (!(z < 0.85)) return 1;
  return z >= 0.6 ? 0.7 : z >= 0.42 ? 0.5 : z >= 0.3 ? 0.35 : 0.25;
}

/**
 * Per-region-type colour of a tree or shrub's foliage (linear multiplier, applied on
 * top of treeTint): the same models read differently in each landscape — darker,
 * bluer pines on the mountains, salt-greyed crowns on the coast, frost-browned bushes
 * in Frostveil, olive sallows in the marsh, dark juniper-like scrub on the heath.
 * @param {number} kind  core.VegKind
 * @param {number} region  core.RegionID at the instance (255 = unknown)
 * @param {Float32Array|number[]} out  tint to scale in place at offset o
 */
export function regionTint(kind, region, out, o) {
  const shrub = kind === VEG.SHRUB;
  const pine = kind === VEG.PINE;
  let m = null;
  switch (region) {
    case 1: m = shrub ? [1.25, 0.95, 0.65] : kind === VEG.BIRCH ? [1.1, 1.0, 0.75] : null; break;  // marsh
    case 2: m = shrub ? [0.78, 0.86, 0.8] : pine ? [0.82, 0.92, 1.04] : null; break;               // highland
    case 3: m = shrub ? [1.02, 1.0, 0.82] : (pine || kind === VEG.OAK) ? [0.9, 0.97, 1.0] : null; break; // coast
    case 5: m = shrub ? [2.1, 0.8, 0.72] : null; break;                                              // frost: bronzed
    default: break;
  }
  if (!m) return;
  out[o] *= m[0]; out[o + 1] *= m[1]; out[o + 2] *= m[2];
}
