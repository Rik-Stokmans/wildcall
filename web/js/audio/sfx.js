// One-shot sounds: footsteps, wing-flap flutter for movement cues, equipment handling,
// the shutter and UI sounds. All synthesized from recipes (footsteps.js, cues.js,
// uisounds.js).
import { footstepParams } from './footsteps.js';
import { cueOffset, flutterParams } from './cues.js';
import { UI_SOUNDS, GEAR_SOUNDS, recipeLength } from './uisounds.js';
import { mulberry32 } from './rng.js';
import { setPannerPos } from './calls.js';

export class Sfx {
  /** @param {import('./engine.js').AudioEngine} eng */
  constructor(eng, seed = 3) {
    this.eng = eng;
    this.rng = mulberry32(seed);
    const ac = eng.ac;
    // Player sounds sit in the ambience bus (they duck with it while focus-listening).
    this.footBus = ac.createGain();
    this.footBus.gain.value = 0.55;
    this.footBus.connect(eng.ambIn);
    // Equipment handling: after the focus duck (you still hear your own hands), but
    // following the ambient volume setting.
    this.gearBus = ac.createGain();
    this.gearBus.gain.value = 0.8;
    this.gearBus.connect(eng.ambUser);
    this.uiLast = new Map();
  }

  /** Footstep on a surface for a movement mode. */
  footstep(surface, move) {
    const p = footstepParams(surface, move, this.rng);
    if (!p) return;
    const ac = this.eng.ac;
    const t = ac.currentTime + 0.005;
    const out = this.footBus;
    // Scuff / crunch body.
    this.burst('white', p.filter, p.freq, p.q, t, 0.006, p.dur, p.gain * 0.9, out);
    // Crunch grains: tiny bright crackles spread across the step.
    for (let i = 0; i < p.grains; i++) {
      const gt = t + this.rng() * p.dur * 0.8;
      this.burst('white', 'bandpass', 2000 + 4000 * this.rng(), 2.5, gt, 0.001, 0.006 + 0.008 * this.rng(), p.gain * (0.25 + 0.35 * this.rng()), out);
    }
    // Knock on rock or a hollow board.
    if (p.tone > 0) this.tone('sine', p.tone, p.tone * 0.85, t, 0.002, 0.06, p.gain * 0.35, out);
    // Splash: a widening wash and a bubble.
    if (p.splash > 0) {
      this.sweepNoise('pink', 900, 2600, 0.8, t, 0.02, 0.28, p.splash * 0.5, out);
      this.tone('sine', 600, 1300, t + 0.08 + 0.05 * this.rng(), 0.004, 0.05, p.splash * 0.12, out);
    }
    // Squelch: a closing low-pass and a sagging low tone.
    if (p.squelch > 0) {
      this.sweepNoise('brown', 900, 220, 1.5, t + 0.02, 0.02, 0.18, p.squelch * p.gain * 0.8, out, 'lowpass');
      this.tone('sine', 220, 90, t + 0.03, 0.01, 0.12, p.squelch * p.gain * 0.25, out);
    }
  }

  /**
   * Wing-flap whirr for a movement cue (proto.MoveCue), placed along the cue's bearing
   * around the listener and played through an HRTF panner into the bird bus.
   */
  flutter(cue, listener) {
    const ac = this.eng.ac;
    const off = cueOffset(cue);
    const f = flutterParams(cue, this.rng);
    const panner = ac.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4;
    panner.rolloffFactor = 1;
    setPannerPos(panner, listener.x + off.dx, listener.y + off.dy, listener.z + off.dz, ac.currentTime, 0);
    const bus = ac.createGain();
    bus.gain.value = f.gain;
    bus.connect(panner).connect(this.eng.birdIn);
    const t0 = ac.currentTime + 0.01;
    let end = t0;
    for (const b of f.beats) {
      this.burst('pink', 'bandpass', b.freq, 0.9, t0 + b.t, 0.004, 0.03, b.gain, bus);
      end = t0 + b.t + 0.12;
    }
    setTimeout(() => { try { bus.disconnect(); panner.disconnect(); } catch { /* fine */ } }, (end - ac.currentTime + 0.3) * 1000);
  }

  /** Equipment handling: 'raise' 'lower' 'select' 'zoom' 'recStart' 'recStop'. */
  gear(name) {
    const r = GEAR_SOUNDS[name];
    if (r) this.recipe(r, this.gearBus, 1);
  }

  /** The camera shutter as heard in the world (photo:taken). */
  shutter() {
    this.recipe(UI_SOUNDS.shutter, this.gearBus, 1.1);
  }

  /** UI one-shot on the UI bus. Repeats of the same sound within 40 ms are merged. */
  ui(name) {
    const r = UI_SOUNDS[name];
    if (!r) return false;
    const now = this.eng.ac.currentTime;
    if (now - (this.uiLast.get(name) ?? -1) < 0.04) return true;
    this.uiLast.set(name, now);
    this.recipe(r, this.eng.uiIn, 1);
    return true;
  }

  /** Render a recipe (uisounds.js format) into a destination. */
  recipe(recipe, dest, mul = 1) {
    const ac = this.eng.ac;
    const t0 = ac.currentTime + 0.005;
    for (const p of recipe) {
      const t = t0 + p.t;
      const atk = p.attack || 0.002;
      if (p.type === 'noise') {
        const fl = p.filter || { type: 'bandpass', freq: p.f, q: 1 };
        this.burst('white', fl.type, fl.freq, fl.q, t, atk, p.dur, p.gain * mul * 2, dest);
      } else {
        this.tone(p.type, p.f, p.f1 ?? p.f, t, atk, p.dur, p.gain * mul, dest, p.filter);
      }
    }
    return recipeLength(recipe);
  }

  /** Filtered noise burst with an attack and exponential decay (dur ≈ audible length). */
  burst(color, type, freq, q, t, atk, dur, gain, dest) {
    const ac = this.eng.ac;
    const src = this.eng.noiseSource(color, t);
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(18000, Math.max(30, freq));
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + atk);
    g.gain.setTargetAtTime(0, t + atk, Math.max(0.002, dur / 3));
    src.connect(f).connect(g).connect(dest);
    src.stop(t + atk + dur * 1.6 + 0.02);
    src.onended = () => { try { g.disconnect(); } catch { /* fine */ } };
  }

  /** Noise through a filter whose frequency sweeps f0 → f1. */
  sweepNoise(color, f0, f1, q, t, atk, dur, gain, dest, type = 'bandpass') {
    const ac = this.eng.ac;
    const src = this.eng.noiseSource(color, t);
    const f = ac.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + atk);
    g.gain.setTargetAtTime(0, t + atk, dur / 3);
    src.connect(f).connect(g).connect(dest);
    src.stop(t + atk + dur * 1.6 + 0.02);
    src.onended = () => { try { g.disconnect(); } catch { /* fine */ } };
  }

  /** Oscillator ping with a pitch glide and exponential decay. */
  tone(type, f0, f1, t, atk, dur, gain, dest, filter) {
    const ac = this.eng.ac;
    const osc = ac.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(f0, t);
    if (Math.abs(f1 - f0) > 0.5) osc.frequency.exponentialRampToValueAtTime(f1, t + Math.max(0.01, dur));
    const g = ac.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + atk);
    g.gain.setTargetAtTime(0, t + atk, Math.max(0.002, dur / 3));
    let head = osc;
    if (filter) {
      const f = ac.createBiquadFilter();
      f.type = filter.type; f.frequency.value = filter.freq; f.Q.value = filter.q ?? 1;
      head = osc.connect(f);
    }
    head.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + atk + dur * 1.6 + 0.02);
    osc.onended = () => { try { g.disconnect(); } catch { /* fine */ } };
  }
}
