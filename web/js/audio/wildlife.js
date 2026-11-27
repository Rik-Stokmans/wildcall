// Other animals in the soundscape: the synthesis half (rates and placement are in
// wildmodel.js). Sparse one-shot events around the listener, each built from a noise
// source or an oscillator, a filter or two and a gate whose envelope is automated in one
// go (a pulse train is one source plus many gain events, not many nodes):
//
//   source → filter(s) → gate → input → air lowpass → panner (at the spot) → out → ambIn
//
// Routed through the ambience bus, so focused listening ducks them and the narrator duck
// applies; never the bird bus. A hard cap on simultaneous events keeps the CPU low.
import { mulberry32 } from './rng.js';
import { airCutoff } from './curves.js';
import { setPannerPos } from './calls.js';
import {
  KINDS, KIND, MAX_ACTIVE, wildlifeRates, stepWetness, shouldFire, pickSpot,
} from './wildmodel.js';

const TICK_S = 0.25;

const clampF = (f) => Math.min(19000, Math.max(30, f));

export class Wildlife {
  /** @param {import('./engine.js').AudioEngine} eng */
  constructor(eng, seed = 1) {
    this.eng = eng;
    this.rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    this.out = eng.ac.createGain();
    this.out.gain.value = 1;
    this.out.connect(eng.ambIn);
    this.active = []; // {kind, end, nodes[]}
    this.since = Object.fromEntries(KINDS.map((k) => [k, k === 'deer' || k === 'fox' ? 20 : 0]));
    this.lastEnd = new WeakMap();
    this.clock = 0;
    this.tick = 0;
    this.inputs = null;
    this.wetness = 0;
    this.focus = 0;
    this.rates = Object.fromEntries(KINDS.map((k) => [k, 0]));
    this.fired = Object.fromEntries(KINDS.map((k) => [k, 0]));
  }

  /**
   * @param {object} s {env, region, habitat, canopy, waterDist, seaDist, creekDist,
   *   listener: {x,y,z}, world: {habitatAt, waterDepthAt, canopyAt, heightAt}}
   */
  setInputs(s) { this.inputs = s; }

  get activeCount() { return this.active.length; }

  update(dt) {
    const s = this.inputs;
    if (!s) return;
    this.clock += dt;
    this.tick += dt;
    for (const k of KINDS) this.since[k] += dt;
    this.wetness = stepWetness(this.wetness, s.env?.rain, dt, s.env?.mist);
    this.reap();
    if (this.tick < TICK_S) return;
    const step = this.tick;
    this.tick = 0;
    this.rates = wildlifeRates({ ...s, wetness: this.wetness });
    // Focused listening: nothing new starts (what is sounding fades under the duck).
    if (this.focus > 0.5) return;
    for (const kind of KINDS) {
      if (this.active.length >= MAX_ACTIVE) break;
      const k = KIND[kind];
      if (this.countOf(kind) >= k.maxVoices) continue;
      if (!shouldFire(this.rates[kind], step, this.since[kind], k.minGap, this.rng)) continue;
      const spot = pickSpot(kind, this.rng, s.listener, { ...s.world, listenerY: s.listener.y });
      if (!spot) continue;
      this.since[kind] = 0;
      this.fired[kind]++;
      this.trigger(kind, spot);
    }
  }

  countOf(kind) {
    let n = 0;
    for (const a of this.active) if (a.kind === kind) n++;
    return n;
  }

  /** Release finished events. */
  reap() {
    const now = this.eng.now;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      if (now < a.end + 0.15) continue;
      for (const n of a.nodes) { try { n.disconnect(); } catch { /* fine */ } }
      this.active.splice(i, 1);
    }
  }

  // ---- event plumbing ---------------------------------------------------------------

  /** The shared chain of one event: returns {input, ev} (ev collects nodes and the end time). */
  chain(kind, spot, opts = {}) {
    const ac = this.eng.ac;
    const t0 = ac.currentTime + 0.03;
    const ev = { kind, end: t0 + 1, nodes: [], srcs: [], t0 };
    const input = ac.createGain();
    input.gain.value = KIND[kind].peak * (0.75 + 0.5 * this.rng());
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.5;
    lp.frequency.value = clampF(airCutoff(spot.d) * (opts.dull ?? 1));
    const panner = ac.createPanner();
    panner.panningModel = opts.hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = KIND[kind].ref;
    panner.rolloffFactor = KIND[kind].roll;
    panner.maxDistance = 10000;
    setPannerPos(panner, spot.x, spot.y, spot.z, t0, 0);
    input.connect(lp).connect(panner).connect(this.out);
    ev.nodes.push(input, lp, panner);
    ev.input = input;
    ev.panner = panner;
    return ev;
  }

  finish(ev, endTime) {
    ev.end = Math.max(ev.t0 + 0.05, endTime);
    // Stop every source as soon as its gate has closed (they were given generous stops).
    for (const s of ev.srcs) { try { s.stop(ev.end + 0.05); } catch { /* already stopped */ } }
    this.active.push(ev);
  }

  /** A noise source (decorrelated) through `filters` into a fresh gate, stopped at `end`. */
  noiseVoice(ev, color, filters, end, t = ev.t0) {
    const ac = this.eng.ac;
    const src = this.eng.noiseSource(color, t);
    let head = src;
    for (const f of filters) {
      const n = ac.createBiquadFilter();
      n.type = f.type; n.frequency.value = clampF(f.f); n.Q.value = f.q ?? 0.7;
      head = head.connect(n);
      ev.nodes.push(n);
      if (f.sweep) {
        n.frequency.setValueAtTime(clampF(f.f), t);
        for (const [dt, hz] of f.sweep) n.frequency.linearRampToValueAtTime(clampF(hz), t + dt);
      }
    }
    const gate = ac.createGain();
    gate.gain.value = 0;
    head.connect(gate).connect(ev.input);
    src.stop(end + 0.05);
    ev.nodes.push(src, gate);
    ev.srcs.push(src);
    return gate.gain;
  }

  /** An oscillator through `filters` into a gate; `glide` = [[dt, hz], ...] after f0. */
  toneVoice(ev, type, f0, glide, filters, end, t = ev.t0, am = null) {
    const ac = this.eng.ac;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(clampF(f0), t);
    for (const [dt, hz] of glide || []) osc.frequency.linearRampToValueAtTime(clampF(hz), t + dt);
    let head = osc;
    for (const f of filters) {
      const n = ac.createBiquadFilter();
      n.type = f.type; n.frequency.value = clampF(f.f); n.Q.value = f.q ?? 0.7;
      head = head.connect(n);
      ev.nodes.push(n);
    }
    if (am) {
      // Roughness: a gain stage whose gain wobbles at am.hz (depth 0..1), before the gate.
      const amNode = ac.createGain();
      amNode.gain.value = 1 - am.depth;
      const lfo = ac.createOscillator();
      lfo.frequency.value = am.hz;
      const lg = ac.createGain();
      lg.gain.value = am.depth;
      lfo.connect(lg).connect(amNode.gain);
      lfo.start(t);
      lfo.stop(end + 0.05);
      head = head.connect(amNode);
      ev.nodes.push(amNode, lfo, lg);
      ev.srcs.push(lfo);
    }
    const gate = ac.createGain();
    gate.gain.value = 0;
    head.connect(gate).connect(ev.input);
    osc.start(t);
    osc.stop(end + 0.05);
    ev.nodes.push(osc, gate);
    ev.srcs.push(osc);
    return { gain: gate.gain, osc };
  }

  /** One gate pulse: up over `atk`, hold, down over `rel` (all linear, never overlapping). */
  pulse(param, t, peak, atk, hold, rel) {
    // Automation events must stay in time order: never start inside the previous pulse.
    const last = this.lastEnd.get(param);
    if (last !== undefined && t < last + 0.0005) t = last + 0.0005;
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + atk);
    if (hold > 0) param.setValueAtTime(peak, t + atk + hold);
    param.linearRampToValueAtTime(0, t + atk + hold + rel);
    this.lastEnd.set(param, t + atk + hold + rel);
    return t + atk + hold + rel;
  }

  r(a, b) { return a + (b - a) * this.rng(); }

  trigger(kind, spot) {
    switch (kind) {
      case 'frog': return this.frog(spot);
      case 'squirrel': return this.squirrel(spot);
      case 'rustle': return this.rustle(spot);
      case 'bee': return this.bee(spot);
      case 'grasshopper': return this.grasshopper(spot);
      case 'deer': return this.deer(spot);
      case 'fox': return this.fox(spot);
      case 'lap': return this.lap(spot);
      case 'creak': return this.creak(spot);
      case 'drip': return this.drip(spot);
      default: return undefined;
    }
  }

  // ---- the sounds -------------------------------------------------------------------

  /**
   * Frogs: a rolling "wrrk" (a saw buzz chopped at 20-34 Hz through a throat-sac
   * formant, pitch sagging) one to three times, sometimes answered by a second frog;
   * or a low double "jug" from a big one.
   */
  frog(spot) {
    const heavy = this.rng() < 0.3;
    const ev = this.chain('frog', spot, { dull: 0.9 });
    let end = ev.t0;
    const voices = this.rng() < 0.45 ? 2 : 1;
    for (let v = 0; v < voices; v++) {
      const base = (heavy ? this.r(95, 150) : this.r(150, 270)) * (v ? this.r(0.8, 1.2) : 1);
      const lvl = v ? 0.55 : 1;
      let t = ev.t0 + (v ? this.r(0.2, 0.9) : 0);
      const croaks = heavy ? 2 : 1 + Math.floor(this.rng() * 3);
      for (let c = 0; c < croaks; c++) {
        const n = heavy ? 3 : 5 + Math.floor(this.rng() * 5);
        const rate = heavy ? this.r(11, 15) : this.r(20, 34);
        const dur = n / rate;
        const tone = this.toneVoice(ev, 'sawtooth', base, [[dur, base * 0.84]], [
          { type: 'bandpass', f: heavy ? this.r(300, 480) : this.r(750, 1250), q: 2.2 },
          { type: 'lowpass', f: heavy ? 900 : 2400, q: 0.5 },
        ], t + dur + 0.1, t);
        // A touch of breath noise under the buzz.
        const br = this.noiseVoice(ev, 'pink', [{ type: 'bandpass', f: heavy ? 450 : 1100, q: 1.2 }], t + dur + 0.1, t);
        for (let i = 0; i < n; i++) {
          const env = Math.sin(((i + 0.5) / n) * Math.PI);
          const ti = t + i / rate;
          const w = (1 / rate) * 0.55;
          const peak = lvl * (0.35 + 0.65 * env);
          this.pulse(tone.gain, ti, peak, w * 0.25, w * 0.35, w * 0.4);
          this.pulse(br, ti, peak * 0.18, w * 0.25, w * 0.35, w * 0.4);
        }
        end = Math.max(end, t + dur + 0.05);
        t += dur + this.r(0.25, 0.6);
      }
    }
    this.finish(ev, end);
  }

  /**
   * Squirrels: a scrabble of claws on bark (an accelerating, irregular run of tiny
   * bright ticks, a pause, another run) or a chattering "chk-chk-chk" scold.
   */
  squirrel(spot) {
    const ev = this.chain('squirrel', spot);
    let end = ev.t0;
    if (this.rng() < 0.65) {
      const gate = this.noiseVoice(ev, 'white', [
        { type: 'highpass', f: 1400, q: 0.5 },
        { type: 'bandpass', f: this.r(2600, 3800), q: 1.1 },
      ], ev.t0 + 3);
      let t = ev.t0;
      const runs = 1 + Math.floor(this.rng() * 3);
      for (let r = 0; r < runs; r++) {
        const n = 7 + Math.floor(this.rng() * 9);
        let gap = this.r(0.06, 0.09);
        for (let i = 0; i < n; i++) {
          const a = this.r(0.4, 1);
          end = this.pulse(gate, t, a, 0.0015, 0.001, this.r(0.008, 0.016));
          gap = Math.max(0.022, gap * this.r(0.82, 0.97));
          t += gap + this.rng() * 0.012;
        }
        t += this.r(0.18, 0.6);
      }
      // A dull thud as it lands on the trunk.
      const th = this.toneVoice(ev, 'sine', 140, [[0.08, 70]], [{ type: 'lowpass', f: 400, q: 0.5 }], ev.t0 + 0.3);
      this.pulse(th.gain, ev.t0, 0.45, 0.003, 0, 0.07);
    } else {
      // Chatter: raspy saw + noise, a falling "chk" repeated 6-11 times, tailing off.
      const n = 6 + Math.floor(this.rng() * 6);
      const rate = this.r(6.5, 9);
      const f = this.r(850, 1100);
      const tone = this.toneVoice(ev, 'sawtooth', f, [[n / rate, f * 0.7]], [
        { type: 'bandpass', f: 1500, q: 2.5 }, { type: 'lowpass', f: 3200, q: 0.5 },
      ], ev.t0 + n / rate + 0.3);
      const noise = this.noiseVoice(ev, 'white', [{ type: 'bandpass', f: 2200, q: 1.6 }], ev.t0 + n / rate + 0.3);
      for (let i = 0; i < n; i++) {
        const t = ev.t0 + i / rate + this.rng() * 0.02;
        const a = 1 - (i / n) * 0.65;
        end = this.pulse(tone.gain, t, a, 0.006, 0.012, 0.03);
        this.pulse(noise, t, a * 0.35, 0.004, 0.01, 0.025);
      }
    }
    this.finish(ev, end);
  }

  /** Rustle in leaf litter: bursts of dry crackle with scurry-and-pause timing. */
  rustle(spot) {
    const ev = this.chain('rustle', spot, { dull: 1.1 });
    const gate = this.noiseVoice(ev, 'white', [
      { type: 'highpass', f: 1100, q: 0.5 },
      { type: 'bandpass', f: this.r(2600, 4200), q: 0.7 },
    ], ev.t0 + 4);
    let t = ev.t0;
    let end = t;
    const bursts = 2 + Math.floor(this.rng() * 3);
    for (let b = 0; b < bursts; b++) {
      const grains = 5 + Math.floor(this.rng() * 10);
      const vol = this.r(0.45, 1);
      for (let i = 0; i < grains; i++) {
        end = this.pulse(gate, t, vol * this.r(0.3, 1), 0.002, 0.001, this.r(0.004, 0.014));
        t += this.r(0.008, 0.06);
      }
      t += this.r(0.2, 0.7);
    }
    this.finish(ev, end);
  }

  /**
   * A bee or hoverfly passing: two slightly detuned saw voices with a wing-beat wobble,
   * panned from one side to the other with a small Doppler shift and a swell in and out.
   */
  bee(spot) {
    const hover = this.rng() < 0.4;
    const ev = this.chain('bee', spot, { hrtf: true });
    const dur = hover ? this.r(2.2, 3.5) : this.r(3.2, 5.5);
    const f = hover ? this.r(300, 360) : this.r(180, 245);
    const vib = this.eng.ac.createOscillator();
    vib.frequency.value = this.r(4.5, 7);
    const vibG = this.eng.ac.createGain();
    vibG.gain.value = f * 0.025;
    vib.connect(vibG);
    ev.nodes.push(vib, vibG);
    ev.srcs.push(vib);
    const end = ev.t0 + dur;
    const a = this.toneVoice(ev, 'sawtooth', f * 1.03, [[dur, f * 0.96]], [
      { type: 'bandpass', f: hover ? 1300 : 760, q: hover ? 2 : 1.4 }, { type: 'lowpass', f: 2200, q: 0.5 },
    ], end);
    const b = this.toneVoice(ev, 'sawtooth', f * 1.045, [[dur, f * 0.975]], [
      { type: 'bandpass', f: hover ? 1300 : 760, q: hover ? 2 : 1.4 }, { type: 'lowpass', f: 2200, q: 0.5 },
    ], end);
    vib.connect(a.osc.frequency);
    vib.connect(b.osc.frequency);
    vib.start(ev.t0);
    vib.stop(end + 0.05);
    for (const g of [a.gain, b.gain]) {
      g.setValueAtTime(0, ev.t0);
      g.linearRampToValueAtTime(0.5, ev.t0 + dur * 0.5);
      g.linearRampToValueAtTime(0, end);
    }
    // The fly-by: from the spot across the listener's side to a point 6-12 m away.
    const L = this.inputs.listener;
    const ang = Math.atan2(spot.x - L.x, -(spot.z - L.z)) + (this.rng() < 0.5 ? 1 : -1) * this.r(0.9, 1.6);
    const d2 = Math.max(3, spot.d * this.r(0.6, 1));
    const tx = L.x + Math.sin(ang) * d2, tz = L.z - Math.cos(ang) * d2;
    const p = ev.panner;
    if (p.positionX) {
      p.positionX.setValueAtTime(spot.x, ev.t0);
      p.positionZ.setValueAtTime(spot.z, ev.t0);
      p.positionX.linearRampToValueAtTime(tx, end);
      p.positionZ.linearRampToValueAtTime(tz, end);
    }
    this.finish(ev, end);
  }

  /**
   * A grasshopper: runs of dry, rapid two-tick stridulation ("tk-tk tk-tk ...") through
   * a narrow high band, swelling and fading, a pause, again.
   */
  grasshopper(spot) {
    const ev = this.chain('grasshopper', spot);
    const gate = this.noiseVoice(ev, 'white', [
      { type: 'highpass', f: 3800, q: 0.5 },
      { type: 'bandpass', f: this.r(6200, 8200), q: 2.2 },
    ], ev.t0 + 9);
    let t = ev.t0;
    let end = t;
    const runs = 1 + Math.floor(this.rng() * 3);
    for (let r = 0; r < runs; r++) {
      const dur = this.r(0.8, 2.2);
      const rate = this.r(24, 36);
      const n = Math.floor(dur * rate);
      const vol = this.r(0.6, 1);
      for (let i = 0; i < n; i++) {
        const env = Math.sin(((i + 0.5) / n) * Math.PI) ** 0.6;
        const ti = t + i / rate;
        this.pulse(gate, ti, vol * env, 0.0012, 0, 0.007);
        end = this.pulse(gate, ti + 0.012, vol * env * 0.7, 0.0012, 0, 0.006);
      }
      t += dur + this.r(0.5, 1.6);
    }
    this.finish(ev, end);
  }

  /** A roe deer's bark, far off: a hoarse "bhoah", two to five times, seconds apart. */
  deer(spot) {
    const ev = this.chain('deer', spot, { dull: 0.7 });
    const n = 2 + Math.floor(this.rng() * 4);
    const f = this.r(190, 250);
    const tone = this.toneVoice(ev, 'sawtooth', f, [], [
      { type: 'bandpass', f: 850, q: 1.1 }, { type: 'lowpass', f: 2400, q: 0.5 },
    ], ev.t0 + n * 3.2 + 1);
    const noise = this.noiseVoice(ev, 'pink', [{ type: 'bandpass', f: 1000, q: 0.9 }], ev.t0 + n * 3.2 + 1);
    let t = ev.t0;
    let end = t;
    for (let i = 0; i < n; i++) {
      const fi = f * this.r(0.94, 1.06);
      tone.osc.frequency.setValueAtTime(fi, t);
      tone.osc.frequency.linearRampToValueAtTime(fi * 0.75, t + 0.24);
      const a = this.r(0.7, 1);
      end = this.pulse(tone.gain, t, a, 0.02, 0.1, 0.12);
      this.pulse(noise, t, a * 0.6, 0.015, 0.1, 0.12);
      t += this.r(1.6, 3.2);
    }
    this.finish(ev, end);
  }

  /** A fox far off: a vixen's rasping scream, or a "wow-wow-wow" triple bark. */
  fox(spot) {
    const ev = this.chain('fox', spot, { dull: 0.6 });
    let end = ev.t0;
    if (this.rng() < 0.55) {
      const dur = this.r(0.7, 1.0);
      const f = this.r(560, 720);
      const tone = this.toneVoice(ev, 'sawtooth', f, [[0.15, f * 1.4], [dur, f * 0.8]], [
        { type: 'bandpass', f: 1250, q: 1.2 }, { type: 'lowpass', f: 3000, q: 0.5 },
      ], ev.t0 + dur + 0.2, ev.t0, { hz: this.r(55, 85), depth: 0.45 });
      const noise = this.noiseVoice(ev, 'white', [{ type: 'bandpass', f: 1500, q: 0.8 }], ev.t0 + dur + 0.2);
      end = this.pulse(tone.gain, ev.t0, 0.8, 0.06, dur * 0.55, dur * 0.4);
      this.pulse(noise, ev.t0, 0.18, 0.06, dur * 0.55, dur * 0.4);
    } else {
      const n = 3;
      const f = this.r(430, 560);
      const tone = this.toneVoice(ev, 'sawtooth', f, [], [
        { type: 'bandpass', f: 950, q: 1.4 }, { type: 'lowpass', f: 2600, q: 0.5 },
      ], ev.t0 + 3);
      const noise = this.noiseVoice(ev, 'white', [{ type: 'bandpass', f: 1300, q: 1 }], ev.t0 + 3);
      let t = ev.t0;
      for (let i = 0; i < n; i++) {
        tone.osc.frequency.setValueAtTime(f * 1.15, t);
        tone.osc.frequency.linearRampToValueAtTime(f * 0.8, t + 0.12);
        end = this.pulse(tone.gain, t, 0.9 - i * 0.1, 0.008, 0.05, 0.07);
        this.pulse(noise, t, 0.3, 0.006, 0.04, 0.06);
        t += this.r(0.32, 0.45);
      }
    }
    this.finish(ev, end);
  }

  /** A wavelet slapping the shore: a soft filtered noise swell plus a little gurgle. */
  lap(spot) {
    const ev = this.chain('lap', spot);
    const big = this.rng() < 0.25 ? 1.4 : 1;
    const f = this.r(500, 800);
    const gate = this.noiseVoice(ev, 'pink', [
      { type: 'bandpass', f, q: 1.4, sweep: [[0.12, f * 1.9], [0.5, f * 0.9]] },
    ], ev.t0 + 1.2);
    let end = this.pulse(gate, ev.t0, 0.9 * big, 0.05, 0.03, this.r(0.25, 0.45));
    const bloops = 1 + Math.floor(this.rng() * 3);
    for (let i = 0; i < bloops; i++) {
      const t = ev.t0 + 0.1 + i * this.r(0.07, 0.16) + this.rng() * 0.1;
      const f0 = this.r(260, 520);
      const tone = this.toneVoice(ev, 'sine', f0, [[0.03, f0 * 1.8]], [], t + 0.15, t);
      end = Math.max(end, this.pulse(tone.gain, t, this.r(0.12, 0.3), 0.004, 0.005, 0.045));
    }
    this.finish(ev, end);
  }

  /**
   * A branch creaking in the wind: stick-slip friction (a pulse train that slows and
   * wanders in pitch) through a narrow wooden resonance, swelling and settling.
   */
  creak(spot) {
    const ev = this.chain('creak', spot, { dull: 0.9 });
    const dur = this.r(0.9, 2);
    const f = this.r(85, 135);
    const tone = this.toneVoice(ev, 'sawtooth', f, [], [
      { type: 'bandpass', f: this.r(420, 760), q: 7 }, { type: 'highpass', f: 180, q: 0.5 },
    ], ev.t0 + dur + 0.3);
    let t = ev.t0;
    let rate = this.r(22, 34);
    let end = t;
    let fi = f;
    while (t < ev.t0 + dur) {
      const k = (t - ev.t0) / dur;
      const env = Math.sin(Math.min(1, k) * Math.PI) ** 0.8;
      fi = Math.max(60, fi * this.r(0.94, 1.07));
      tone.osc.frequency.setValueAtTime(fi, t);
      end = this.pulse(tone.gain, t, env * this.r(0.5, 1), 0.003, 0.004, this.r(0.012, 0.026));
      rate = Math.max(9, rate * this.r(0.94, 0.995));
      t += 1 / rate;
    }
    this.finish(ev, end);
  }

  /** A drip from a leaf: a quick falling "plink", sometimes with the puddle's bloop after. */
  drip(spot) {
    const ev = this.chain('drip', spot);
    const f = this.r(1500, 3300);
    const tone = this.toneVoice(ev, 'sine', f, [[0.02, f * 0.5]], [], ev.t0 + 0.3);
    let end = this.pulse(tone.gain, ev.t0, this.r(0.5, 1), 0.001, 0.002, 0.018);
    const tick = this.noiseVoice(ev, 'white', [{ type: 'highpass', f: 4500, q: 0.5 }], ev.t0 + 0.3);
    this.pulse(tick, ev.t0, 0.25, 0.0008, 0, 0.004);
    if (this.rng() < 0.55) {
      const t = ev.t0 + this.r(0.05, 0.12);
      const f0 = this.r(420, 800);
      const tone2 = this.toneVoice(ev, 'sine', f0, [[0.035, f0 * 1.9]], [], t + 0.2, t);
      end = Math.max(end, this.pulse(tone2.gain, t, 0.35, 0.003, 0.003, 0.05));
    }
    this.finish(ev, end);
  }
}
