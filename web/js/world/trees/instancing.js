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
