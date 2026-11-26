// Procedural "forest" impulse response for the shared convolution reverb. Pure: it
// returns plain Float32Arrays (one per channel) that engine.js copies into an
// AudioBuffer. A forest does not ring like a hall: a scatter of early reflections from
// trunks, then a soft, darkening, fairly short diffuse tail.
import { mulberry32 } from './rng.js';

/**
 * @param {number} sampleRate
 * @param {object} [o]
 * @param {number} [o.seconds=2.4] total length
 * @param {number} [o.decay=0.55] tail time constant (s)
 * @param {number} [o.seed=7]
 * @returns {Float32Array[]} [left, right]
 */
export function forestImpulse(sampleRate, o = {}) {
  const seconds = o.seconds ?? 2.4;
  const decay = o.decay ?? 0.55;
  const len = Math.max(1, Math.floor(sampleRate * seconds));
  const rng = mulberry32(o.seed ?? 7);
  const chans = [new Float32Array(len), new Float32Array(len)];
  const pre = Math.floor(0.012 * sampleRate); // pre-delay: nothing reflects instantly
  for (const ch of chans) {
    // Diffuse tail: noise with an exponential decay, low-passed harder as it ages
    // (leaves soak up the highs of late reflections).
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.exp(-t / decay) * Math.min(1, t / 0.03);
      const k = 0.55 * Math.exp(-t / 0.6) + 0.06; // one-pole coefficient: closes over time
      lp += k * ((rng() * 2 - 1) - lp);
      ch[i] = lp * env * 0.6;
    }
    // Early reflections: sparse taps from nearby trunks, 15–110 ms.
    const taps = 14;
    for (let j = 0; j < taps; j++) {
      const t = 0.015 + rng() * 0.095;
      const i = Math.floor(t * sampleRate);
      if (i < len) ch[i] += (rng() < 0.5 ? -1 : 1) * (0.25 + 0.35 * rng()) * Math.exp(-t / 0.12);
    }
  }
  // Normalise so the IR has unit-ish energy whatever the sample rate.
  let e = 0;
  for (const ch of chans) for (let i = 0; i < len; i++) e += ch[i] * ch[i];
  const norm = e > 0 ? 1 / Math.sqrt(e / 2) : 1;
  for (const ch of chans) for (let i = 0; i < len; i++) ch[i] *= norm;
  return chans;
}
