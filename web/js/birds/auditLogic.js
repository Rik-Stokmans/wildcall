// Pure maths of the bird visibility audit (audit.js renders, this summarises). No
// three.js, no DOM.
//
// An audit entry describes one bird inside the view frustum within the audit range:
//   { id, sp, act, dist (m), angle (deg, angular length as drawn), pxFull (pixels the
//     bird would cover if nothing hid it), pxVisible (pixels actually visible), frac }
// The summary answers "how findable are the birds in view": how many there are within
// 15 / 30 / 60 m and how many of those show at least `minFrac` of their body over at
// least `minPx` pixels.

/** Distance bands the summary reports (metres). */
export const AUDIT_BANDS = Object.freeze([15, 30, 60]);
/** Default thresholds: a bird is "findable" with ≥ 40 % of its body visible on ≥ 12 px (at 1280×720). */
export const AUDIT_MIN_FRAC = 0.4;
export const AUDIT_MIN_PX = 12;

/** Visible fraction of a bird (0 when it would cover no pixels at all). */
export function visibleFraction(pxVisible, pxFull) {
  if (!(pxFull > 0)) return 0;
  const f = pxVisible / pxFull;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/** Whether an entry counts as findable with the given thresholds. */
export function isFindable(e, minFrac = AUDIT_MIN_FRAC, minPx = AUDIT_MIN_PX) {
  return e.pxFull > 0 && e.frac >= minFrac && e.pxVisible >= minPx;
}

/**
 * Summarise audit entries.
 * @param {object[]} entries
 * @param {{minFrac?: number, minPx?: number, bands?: number[]}} [opt]
 * @returns {{n: number[], ok: number[], okFrac: number[], meanFrac: number[], medianPx: number[], bands: number[], minFrac: number, minPx: number}}
 *   per band (same order as `bands`): bird count, findable count, findable share
 *   (NaN when empty), mean visible fraction and median visible pixel count.
 */
export function summariseAudit(entries, opt = {}) {
  const minFrac = opt.minFrac ?? AUDIT_MIN_FRAC;
  const minPx = opt.minPx ?? AUDIT_MIN_PX;
  const bands = opt.bands || AUDIT_BANDS;
  const n = bands.map(() => 0), ok = bands.map(() => 0), sumF = bands.map(() => 0);
  const px = bands.map(() => []);
  for (const e of entries || []) {
    if (!e || !(e.pxFull > 0)) continue;
    const good = isFindable(e, minFrac, minPx);
    for (let b = 0; b < bands.length; b++) {
      if (e.dist > bands[b]) continue;
      n[b]++;
      if (good) ok[b]++;
      sumF[b] += e.frac;
      px[b].push(e.pxVisible);
    }
  }
  return {
    bands: bands.slice(),
    minFrac, minPx,
    n, ok,
    okFrac: n.map((c, b) => (c ? ok[b] / c : NaN)),
    meanFrac: n.map((c, b) => (c ? sumF[b] / c : NaN)),
    medianPx: px.map(median),
  };
}

/** Merge several summaries (e.g. the 8 headings of one spot) by summing their counts. */
export function mergeSummaries(list) {
  const valid = (list || []).filter(Boolean);
  if (!valid.length) return summariseAudit([]);
  const bands = valid[0].bands;
  const n = bands.map(() => 0), ok = bands.map(() => 0), sumF = bands.map(() => 0);
  for (const s of valid) {
    for (let b = 0; b < bands.length; b++) {
      n[b] += s.n[b]; ok[b] += s.ok[b];
      if (s.n[b]) sumF[b] += s.meanFrac[b] * s.n[b];
    }
  }
  return {
    bands: bands.slice(), minFrac: valid[0].minFrac, minPx: valid[0].minPx, n, ok,
    okFrac: n.map((c, b) => (c ? ok[b] / c : NaN)),
    meanFrac: n.map((c, b) => (c ? sumF[b] / c : NaN)),
    medianPx: bands.map(() => NaN),
  };
}

/** Count id-coloured pixels: R channel holds 1-based ids (0 = none). counts[id] += 1. */
export function countIds(pixels, counts) {
  counts.fill(0);
  for (let i = 0; i < pixels.length; i += 4) {
    const id = pixels[i];
    if (id) counts[id]++;
  }
  return counts;
}

function median(arr) {
  if (!arr.length) return NaN;
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
