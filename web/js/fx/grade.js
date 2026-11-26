// Pure parameter maths for the post-processing pipeline (no three.js, no DOM):
// the filmic colour grade by time of day / weather / region, bloom and vignette
// strength, light-shaft strength and the on-screen fade of the sun.

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t, out) => {
  out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t);
  return out;
};
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// Looks, all in display space after tone mapping. lift raises the blacks (slightly
// lifted, never grey), gain tints the highlights, gamma bends the mid-tones.
const DAY = { lift: [0.018, 0.02, 0.028], gamma: [1.0, 1.01, 1.0], gain: [1.03, 1.01, 0.97], sat: 1.12, contrast: 1.06 };
const GOLD = { lift: [0.016, 0.018, 0.04], gamma: [1.03, 1.0, 0.96], gain: [1.08, 1.0, 0.88], sat: 1.18, contrast: 1.08 };
const NIGHT = { lift: [0.012, 0.022, 0.05], gamma: [0.97, 1.0, 1.06], gain: [0.93, 1.0, 1.1], sat: 0.84, contrast: 1.02 };
const RAIN = { lift: [0.02, 0.024, 0.032], gamma: [0.98, 1.0, 1.02], gain: [0.97, 1.0, 1.03], sat: 0.9, contrast: 1.06 };

/**
 * The colour grade for a moment.
 * @param {object} p
 * @param {number} [p.daylight] 0..1
 * @param {number} [p.golden]   0..1 golden-hour weight
 * @param {number} [p.night]    0..1
 * @param {number} [p.rain]     0..1
 * @param {number} [p.wet]      0..1 wet ground (rain or lingering)
 * @param {number} [p.mist]     0..1
 * @param {number} [p.cold]     0..1 region coldness (Frostveil)
 * @param {number} [p.warm]     0..1 region warmth (Amberwood)
 * @returns {{lift:number[], gamma:number[], gain:number[], saturation:number,
 *   contrast:number, vignette:number, bloom:{strength:number, radius:number, threshold:number}}}
 */
export function gradeParams({ golden = 0, night = 0, rain = 0, wet = 0, mist = 0, cold = 0, warm = 0 } = {}) {
  const lift = [0, 0, 0], gamma = [0, 0, 0], gain = [0, 0, 0];
  const g = clamp(golden) * (1 - clamp(night));
  lerp3(DAY.lift, GOLD.lift, g, lift); lerp3(DAY.gamma, GOLD.gamma, g, gamma); lerp3(DAY.gain, GOLD.gain, g, gain);
  let sat = lerp(DAY.sat, GOLD.sat, g), contrast = lerp(DAY.contrast, GOLD.contrast, g);
  const n = clamp(night);
  lerp3(lift, NIGHT.lift, n, lift); lerp3(gamma, NIGHT.gamma, n, gamma); lerp3(gain, NIGHT.gain, n, gain);
  sat = lerp(sat, NIGHT.sat, n); contrast = lerp(contrast, NIGHT.contrast, n);
  const r = clamp(Math.max(rain, wet * 0.5));
  lerp3(lift, RAIN.lift, r, lift); lerp3(gamma, RAIN.gamma, r, gamma); lerp3(gain, RAIN.gain, r, gain);
  sat = lerp(sat, RAIN.sat, r); contrast = lerp(contrast, RAIN.contrast, r);
  // Mist softens contrast and lifts the blacks a touch.
  const m = clamp(mist);
  contrast -= 0.05 * m;
  for (let i = 0; i < 3; i++) lift[i] += 0.012 * m;
  // Regions: Frostveil cooler highlights, Amberwood warmer.
  gain[0] *= 1 + 0.04 * clamp(warm) - 0.03 * clamp(cold);
  gain[2] *= 1 - 0.05 * clamp(warm) + 0.04 * clamp(cold);
  return {
    lift, gamma, gain, saturation: sat, contrast,
    vignette: 0.2 + 0.08 * n,
    bloom: {
      strength: 0.16 + 0.14 * g + 0.22 * n,
      radius: 0.5 + 0.15 * m,
      threshold: lerp(0.95, 0.55, n),
    },
  };
}

/**
 * How strong the sun's light shafts are (0..~1.2): only when the sun is visible,
 * strongest when it is low, when there is mist and under trees.
 */
export function shaftStrength({ sunVisible = 0, golden = 0, mist = 0, canopy = 0, daylight = 1 } = {}) {
  return clamp(sunVisible) * smoothstep(0.02, 0.2, daylight)
    * (0.35 + 0.4 * clamp(golden) + 0.35 * clamp(mist) + 0.25 * clamp(canopy));
}

/**
 * Fade of screen-space effects tied to the sun by where it projects. ndc is the
 * sun's normalised device position (x, y in -1..1 on screen); `behind` true when the
 * sun is behind the camera. Full strength on screen, fading out by `margin` beyond
 * the edge so shafts still pour in when the sun is just out of view.
 */
export function sunScreenFade(ndcX, ndcY, behind, margin = 0.8) {
  if (behind) return 0;
  const ex = Math.max(0, Math.abs(ndcX) - 1), ey = Math.max(0, Math.abs(ndcY) - 1);
  return 1 - smoothstep(0, margin, Math.hypot(ex, ey));
}

/**
 * Post settings per quality: whether post runs at all, the scale of the effect
 * buffers relative to the screen, MSAA samples and the shaft buffer divisor.
 */
export function postConfig(quality) {
  if (quality === 'high') return { enabled: true, effectScale: 1, samples: 4, shaftDiv: 4 };
  if (quality === 'medium') return { enabled: true, effectScale: 0.5, samples: 4, shaftDiv: 4 };
  return { enabled: false, effectScale: 0.5, samples: 0, shaftDiv: 8 };
}

/**
 * Applies the grade to one display-space colour (the same maths as the final shader
 * pass; used by tests and to keep the two in sync).
 */
export function applyGrade(c, p) {
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let v = c[i] * p.gain[i] + p.lift[i] * (1 - c[i]);
    v = Math.pow(Math.max(v, 0), 1 / p.gamma[i]);
    out[i] = v;
  }
  const l = out[0] * 0.2126 + out[1] * 0.7152 + out[2] * 0.0722;
  for (let i = 0; i < 3; i++) {
    let v = l + (out[i] - l) * p.saturation;
    v = (v - 0.5) * p.contrast + 0.5;
    out[i] = clamp(v);
  }
  return out;
}
