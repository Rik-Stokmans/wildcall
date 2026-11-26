// Subtle generative music (spec §24.1 "subtle, atmospheric, relaxing"): composer.js
// picks sparse plucked phrases and soft pads in a mode that follows the time of day;
// this renders them with simple warm synthesis through a small feedback-delay "room".
// It leaves long silences, and steps aside when the player focus-listens or a bird
// calls loudly nearby (the module sets the duck through the engine's musDuck gain).
import { moodFor, composePhrase, midiToHz } from './composer.js';
import { mulberry32 } from './rng.js';

export class Music {
  /** @param {import('./engine.js').AudioEngine} eng */
  constructor(eng, seed = 5) {
    this.eng = eng;
    this.rng = mulberry32(seed);
    const ac = eng.ac;
    this.out = ac.createGain();
    this.out.gain.value = 0.5;
    this.tone = ac.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 2400;
    this.tone.Q.value = 0.5;
    this.out.connect(this.tone).connect(eng.musIn);
    // Feedback delay room: two taps cross-fed, darkened each pass.
    this.delay = ac.createDelay(2);
    this.delay.delayTime.value = 0.43;
    this.fb = ac.createGain();
    this.fb.gain.value = 0.38;
    this.damp = ac.createBiquadFilter();
    this.damp.type = 'lowpass';
    this.damp.frequency.value = 1800;
    this.wet = ac.createGain();
    this.wet.gain.value = 0.45;
    this.tone.connect(this.delay);
    this.delay.connect(this.damp).connect(this.fb).connect(this.delay);
    this.damp.connect(this.wet).connect(eng.musIn);
    // First gesture comes after a quiet while: the game opens on the forest, not music.
    this.nextAt = eng.now + 25 + 20 * this.rng();
  }

  /** @param {object} env state.env */
  update(env) {
    const now = this.eng.now;
    if (now < this.nextAt) return;
    const mood = moodFor(env || {});
    this.tone.frequency.setTargetAtTime(900 + 2600 * mood.brightness, now, 2);
    const ph = composePhrase(this.rng, mood);
    const t0 = now + 0.1;
    for (const n of ph.notes) {
      if (ph.kind === 'pad') this.pad(midiToHz(n.midi), t0 + n.t, n.dur, n.vel);
      else this.pluck(midiToHz(n.midi), t0 + n.t, n.dur, n.vel);
    }
    this.nextAt = t0 + ph.length + ph.rest;
  }

  /** A soft plucked note: triangle + sine octave with a quick attack and long decay. */
  pluck(f, t, dur, vel) {
    const ac = this.eng.ac;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11 * vel, t + 0.012);
    g.gain.setTargetAtTime(0, t + 0.012, dur / 4);
    const a = ac.createOscillator();
    a.type = 'triangle';
    a.frequency.value = f;
    const b = ac.createOscillator();
    b.type = 'sine';
    b.frequency.value = f * 2.002;
    const bg = ac.createGain();
    bg.gain.value = 0.25;
    a.connect(g);
    b.connect(bg).connect(g);
    g.connect(this.out);
    const end = t + dur * 1.5 + 0.1;
    for (const o of [a, b]) { o.start(t); o.stop(end); }
    a.onended = () => { try { g.disconnect(); bg.disconnect(); } catch { /* fine */ } };
  }

  /** A pad voice: two slightly detuned triangles swelling in and out over many seconds. */
  pad(f, t, dur, vel) {
    const ac = this.eng.ac;
    const g = ac.createGain();
    const peak = 0.05 * vel;
    const rise = Math.min(4, dur * 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + rise);
    g.gain.setValueAtTime(peak, t + dur - rise);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(2000, f * 3);
    lp.Q.value = 0.4;
    const oscs = [];
    for (const det of [-6, 5]) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
      oscs.push(o);
    }
    lp.connect(g).connect(this.out);
    oscs[0].onended = () => { try { g.disconnect(); lp.disconnect(); } catch { /* fine */ } };
  }
}
