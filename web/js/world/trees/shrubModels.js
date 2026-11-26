// Branching models for the shrub kind (core.VegShrub), in the same format as the
// server's tree models (proto.TreeModel), so shrubs are drawn by the same wood and
// leaf-card system as the trees and look like part of the same world. Pure and
// deterministic: every client builds identical shrubs.
//
// A shrub is a rounded, layered mound ~1.6 m tall (core.Veg nominal size): a few
// stems fanning out from the root, carrying one big central mass and a ring of
// smaller overlapping masses that reach down to the ground.
import { rng } from '../color.js';
import { VEG } from '../constants.js';

/** Number of distinct shrub models. */
export const SHRUB_VARIANTS = 4;

const TAU = Math.PI * 2;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** The shrub model for a variant (0..SHRUB_VARIANTS-1), as a wire-format TreeModel. */
export function shrubModel(variant) {
  const R = rng(4049 + variant * 7717);
  const branches = [];
  const leaves = [];
  // A short root stub the stems grow from.
  branches.push({ a: [0, 0, 0], b: [0, 0.12, 0], ra: 0.07, rb: 0.06, parent: -1 });
  const stems = 4 + (variant % 3);
  const turn = R() * TAU;
  for (let i = 0; i < stems; i++) {
    const a = turn + (i + (R() - 0.5) * 0.5) / stems * TAU;
    const reach = 0.35 + R() * 0.3;
    const h = 0.75 + R() * 0.45;
    const mid = [Math.cos(a) * reach * 0.5, 0.12 + h * 0.55, Math.sin(a) * reach * 0.5];
    const end = [Math.cos(a) * reach, 0.12 + h, Math.sin(a) * reach];
    const p1 = branches.length;
    branches.push({ a: [0, 0.12, 0], b: mid.map(r3), ra: 0.03, rb: 0.024, parent: 0 });
    branches.push({ a: mid.map(r3), b: end.map(r3), ra: 0.024, rb: 0.012, parent: p1 });
    // An outer mass on every stem end, a little lower and further out than the tip.
    const s = 0.48 + R() * 0.16;
    leaves.push({
      c: [Math.cos(a) * (reach + 0.18), 0.12 + h * 0.62, Math.sin(a) * (reach + 0.18)].map(r3),
      r: [s * 1.08, s * 0.9, s * 1.08].map(r3),
    });
  }
  // The central dome and a cap.
  const cr = 0.72 + R() * 0.12;
  leaves.push({ c: [0, 0.78, 0], r: [cr, cr * 0.85, cr].map(r3) });
  leaves.push({ c: [(R() - 0.5) * 0.2, 1.18, (R() - 0.5) * 0.2].map(r3), r: [0.5, 0.42, 0.5] });
  return { kind: VEG.SHRUB, variant, height: 1.6, branches, leaves };
}
