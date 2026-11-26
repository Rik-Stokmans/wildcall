// Spectrogram of a synthesizable call (core.Call). The client does not record real audio
// for the journal; it paints the frequency-over-time picture the notes describe, which is
// exactly what the synth plays. Pure maths: returns a rows x cols intensity grid (0..1),
// row 0 = highest frequency.

export const SPEC_FMIN = 400;
export const SPEC_FMAX = 11000;

/** Frequency (Hz) -> row fraction 0 (top, SPEC_FMAX) .. 1 (bottom, SPEC_FMIN), log scale. */
export function freqToY(f) {
  const lo = Math.log(SPEC_FMIN), hi = Math.log(SPEC_FMAX);
  const t = (Math.log(Math.max(SPEC_FMIN, Math.min(SPEC_FMAX, f))) - lo) / (hi - lo);
  return 1 - t;
}

/** Total length in seconds of `reps` phrases of the call. */
export function spectrogramSeconds(call, reps) {
  const phrase = (call?.notes || []).reduce((a, n) => a + (n.dur || 0) + (n.gap || 0), 0);
  return Math.max(0.2, phrase * reps + Math.max(0, reps - 1) * (call?.gap || 0));
}

export function callSpectrogram(call, { cols = 96, rows = 40, reps = 1 } = {}) {
  const data = new Float32Array(cols * rows);
  const notes = call?.notes || [];
  if (!notes.length) return { data, cols, rows, seconds: 0 };
  reps = Math.max(1, reps | 0);
  const seconds = spectrogramSeconds(call, reps);
  const phrase = notes.reduce((a, n) => a + (n.dur || 0) + (n.gap || 0), 0);
  const dt = seconds / cols;
  const add = (col, y, amp, spread) => {
    if (col < 0 || col >= cols) return;
    const r0 = Math.max(0, Math.floor((y - spread) * rows)), r1 = Math.min(rows - 1, Math.ceil((y + spread) * rows));
    for (let r = r0; r <= r1; r++) {
      const d = ((r + 0.5) / rows - y) / spread;
      const v = amp * Math.exp(-d * d * 1.6);
      const i = r * cols + col;
      if (v > data[i]) data[i] = v;
    }
  };
  for (let rep = 0; rep < reps; rep++) {
    let t0 = rep * (phrase + (call.gap || 0));
    for (const n of notes) {
      const dur = Math.max(0.005, n.dur || 0.05);
      const amp = Math.max(0.15, Math.min(1, n.amp ?? 0.7));
      const c0 = Math.floor(t0 / dt), c1 = Math.max(c0, Math.floor((t0 + dur) / dt - 1e-9));
      for (let c = c0; c <= c1; c++) {
        const u = Math.min(1, Math.max(0, ((c + 0.5) * dt - t0) / dur));
        let f = (n.f0 || 3000) + ((n.f1 ?? n.f0 ?? 3000) - (n.f0 || 3000)) * u;
        const tt = (c + 0.5) * dt;
        if ((n.rate || 0) > 0 && n.wave !== 'trill' && n.wave !== 'buzz') f *= 1 + Math.sin(tt * n.rate * Math.PI * 2) * (n.depth || 0);
        const y = freqToY(f);
        switch (n.wave) {
          case 'noise': add(c, y, amp * 0.55, 0.22); break;
          case 'click': add(c, y, amp, 0.3); break;
          case 'buzz': add(c, y, amp * 0.85, 0.07); add(c, freqToY(f * 2), amp * 0.4, 0.05); break;
          case 'trill': {
            const on = (n.rate || 12) > 0 ? 0.5 + 0.5 * Math.sin(tt * (n.rate || 12) * Math.PI * 2) : 1;
            add(c, y, amp * (0.35 + 0.65 * on), 0.05);
            break;
          }
          default: add(c, y, amp, 0.045); add(c, freqToY(f * 2), amp * 0.22, 0.04); // whistle / sine + faint harmonic
        }
      }
      t0 += dur + (n.gap || 0);
    }
  }
  return { data, cols, rows, seconds };
}
