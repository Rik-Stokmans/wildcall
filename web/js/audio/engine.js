// The Web Audio graph: context, buses, limiter, analyser, shared noise and reverb.
//
//   bird voices ─┐                         ┌→ analyser (spectrum / level tap)
//   rev return ──┴→ birdIn → birdFocus ────┴→ birdUser(volBirds) ─┐
//   ambience layers → ambIn → ambDuck → ambUser(volAmbient) ──────┤
//   music → musIn → musDuck → musUser(volMusic) ──────────────────┼→ master(volMaster) → limiter → out
//   ui one-shots → uiIn → uiUser(volUI) ──────────────────────────┘
//   voice sends → revIn → convolver(forest IR) → revReturn → birdIn
//   master → limiter → safety soft-clip → out
//
// The analyser taps the bird bus before the user's bird volume, so the recorder's
// spectrogram and level meter show what reaches the microphone, not the mixer setting.
import { forestImpulse } from './impulse.js';
import { mulberry32 } from './rng.js';
import { dbToGain } from './curves.js';

/** Analyser FFT size: 1024 → 512 frequency bins (contract: getSpectrum() is 512 bins). */
export const FFT_SIZE = 1024;
const NOISE_SECONDS = 6;

export class AudioEngine {
  /** @param {typeof AudioContext} AC */
  constructor(AC) {
    const ac = new AC({ latencyHint: 'interactive' });
    this.ac = ac;
    const g = (v = 1) => { const n = ac.createGain(); n.gain.value = v; return n; };

    this.limiter = ac.createDynamicsCompressor();
    // A gentle safety limiter: only catches the rare pile-up of loud calls.
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.master = g(1);
    this.master.connect(this.limiter);
    // Last line of defence: a soft clip after the limiter rounds any peak that gets past
    // it (the limiter is a compressor, not a brick wall), so nothing ever hard-clips.
    if (ac.createWaveShaper) {
      this.safety = ac.createWaveShaper();
      this.safety.curve = softClipCurve();
      this.safety.oversample = '2x';
      this.limiter.connect(this.safety);
      this.safety.connect(ac.destination);
    } else {
      this.limiter.connect(ac.destination);
    }

    this.birdIn = g(1);
    this.birdFocus = g(1);
    this.birdUser = g(1);
    this.birdIn.connect(this.birdFocus);
    this.birdFocus.connect(this.birdUser);
    this.birdUser.connect(this.master);
    this.analyser = ac.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0.6;
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -20;
    this.birdFocus.connect(this.analyser);

    this.ambIn = g(1);
    this.ambDuck = g(1);
    this.ambUser = g(1);
    this.ambIn.connect(this.ambDuck);
    this.ambDuck.connect(this.ambUser);
    this.ambUser.connect(this.master);

    this.musIn = g(1);
    this.musDuck = g(0);
    this.musUser = g(1);
    this.musIn.connect(this.musDuck);
    this.musDuck.connect(this.musUser);
    this.musUser.connect(this.master);

    this.uiIn = g(1);
    this.uiUser = g(1);
    this.uiIn.connect(this.uiUser);
    this.uiUser.connect(this.master);

    // Shared forest reverb (one convolver for every voice).
    this.revIn = g(1);
    this.convolver = ac.createConvolver();
    this.convolver.normalize = false;
    this.convolver.buffer = this.makeImpulse();
    this.revReturn = g(0.3);
    this.revIn.connect(this.convolver);
    this.convolver.connect(this.revReturn);
    this.revReturn.connect(this.birdIn);

    this.noise = {
      white: this.makeNoise('white', 11),
      pink: this.makeNoise('pink', 23),
      brown: this.makeNoise('brown', 37),
    };
    this.timeBuf = new Float32Array(FFT_SIZE);
    this.spectrum = new Uint8Array(FFT_SIZE / 2);
  }

  get now() { return this.ac.currentTime; }

  makeImpulse() {
    const sr = this.ac.sampleRate;
    const [l, r] = forestImpulse(sr, { seconds: 2.4, decay: 0.55 });
    const buf = this.ac.createBuffer(2, l.length, sr);
    // Scale so a fully wet signal is roughly as loud as the dry one.
    const k = 0.35;
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < l.length; i++) { L[i] = l[i] * k; R[i] = r[i] * k; }
    return buf;
  }

  /** A looping mono noise buffer: white, pink (Paul Kellet filter) or brown. */
  makeNoise(color, seed) {
    const sr = this.ac.sampleRate;
    const len = Math.floor(sr * NOISE_SECONDS);
    const buf = this.ac.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const rng = mulberry32(seed);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = rng() * 2 - 1;
      if (color === 'white') d[i] = w * 0.9;
      else if (color === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // Cross-fade the loop seam so looping never clicks.
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[len - fade + i] = d[len - fade + i] * (1 - t) + d[i] * t;
    }
    return buf;
  }

  /**
   * A started, looping noise source at a random offset (so layers sharing a buffer are
   * decorrelated). Caller connects and eventually stops it.
   */
  noiseSource(color = 'white', when = this.now, rate = 1) {
    const src = this.ac.createBufferSource();
    src.buffer = this.noise[color] || this.noise.white;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start(when, Math.random() * (NOISE_SECONDS - 0.5));
    return src;
  }

  /** Apply the volume settings (0..1 each). */
  applySettings(s, glide = 0.08) {
    const t = this.now;
    const set = (node, v) => node.gain.setTargetAtTime(clamp01(+v), t, glide);
    set(this.master, s?.volMaster ?? 0.8);
    set(this.birdUser, s?.volBirds ?? 1);
    set(this.ambUser, s?.volAmbient ?? 0.7);
    set(this.musUser, s?.volMusic ?? 0.35);
    set(this.uiUser, s?.volUI ?? 0.6);
  }

  /** Glide a bus gain to a dB value. */
  glideDb(node, db, tc = 0.25) {
    node.gain.setTargetAtTime(dbToGain(db), this.now, tc);
  }

  /** Current RMS of the bird bus (pre user volume). */
  birdRms() {
    const a = this.analyser;
    if (a.getFloatTimeDomainData) a.getFloatTimeDomainData(this.timeBuf);
    let s = 0;
    for (let i = 0; i < this.timeBuf.length; i++) s += this.timeBuf[i] * this.timeBuf[i];
    return Math.sqrt(s / this.timeBuf.length);
  }

  /** Fill and return the shared 512-bin spectrum of the bird bus. */
  readSpectrum() {
    this.analyser.getByteFrequencyData(this.spectrum);
    return this.spectrum;
  }
}

/**
 * Transfer curve of the safety stage: transparent up to 0.8, then a smooth tanh knee
 * that tops out at 0.98 (so even a large overshoot stays below full scale).
 */
export function softClipCurve(n = 2049) {
  const c = new Float32Array(n);
  const knee = 0.8, top = 0.98;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (top - knee) * Math.tanh((a - knee) / (top - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

function clamp01(x) { return Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0; }

/**
 * Set an AudioParam smoothly if it exists (feature-detects positionX vs. setPosition
 * elsewhere). Small helper used by voices and the listener.
 */
export function glide(param, value, t, tc) {
  if (!param || !Number.isFinite(value)) return;
  param.setTargetAtTime(value, t, tc);
}
