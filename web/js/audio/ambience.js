// Ambience (spec §24.1): wind, leaves, creek/water, surf, rain, insects, night air.
// Everything is synthesized from looping noise buffers and oscillators. Levels come
// from mix.ambienceMix (pure); here they are modulated by slow value noise (gusts,
// swells, drifting filters) so the soundscape keeps evolving and never loops audibly.
import { valueNoise1D, mulberry32, hashSeed } from './rng.js';
import { setPannerPos } from './calls.js';

/** Per-layer gain trims: mix levels are 0..1, these set the real loudness. */
const TRIM = {
  wind: 0.32, windHowl: 0.07, leaves: 0.16, creek: 0.26, lap: 0.16, surf: 0.42,
  rainOpen: 0.3, rainCanopy: 0.26, insects: 0.018, crickets: 0.02, night: 0.09,
};
const LEVEL_HZ = 10;

export class Ambience {
  /** @param {import('./engine.js').AudioEngine} eng */
  constructor(eng, seed = 1) {
    this.eng = eng;
    this.rng = mulberry32(seed);
    this.t = 0;
    this.levelClock = 0;
    this.mix = null;
    this.waterDir = { x: 0, z: -1 };
    this.listener = { x: 0, y: 0, z: 0 };
    this.n = {};
    for (const k of ['gust', 'gustFast', 'howl', 'leafL', 'leafR', 'creek', 'surf', 'rain', 'night', 'insect']) {
      this.n[k] = valueNoise1D(hashSeed(seed, k)); // independent drift per layer
    }
    this.build();
  }

  gain(v = 0) { const g = this.eng.ac.createGain(); g.gain.value = v; return g; }
  filter(type, freq, q = 0.7) {
    const f = this.eng.ac.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }
  stereo(pan) {
    const ac = this.eng.ac;
    if (ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; return p; }
    return this.gain(1);
  }

  build() {
    const eng = this.eng, ac = eng.ac, out = eng.ambIn;

    // --- wind: two decorrelated brown-noise beds, low-passed, spread wide.
    this.windGain = this.gain(0);
    this.windLP = [];
    for (const pan of [-0.7, 0.7]) {
      const src = eng.noiseSource('brown');
      const lp = this.filter('lowpass', 400, 0.6);
      src.connect(lp).connect(this.stereo(pan)).connect(this.windGain);
      this.windLP.push(lp);
    }
    this.windGain.connect(out);
    // Whistle/howl over exposed ground: narrow resonant band that wanders.
    this.howlGain = this.gain(0);
    this.howlBP = this.filter('bandpass', 800, 9);
    eng.noiseSource('pink').connect(this.howlBP).connect(this.howlGain).connect(out);

    // --- leaves: bright noise with a fast, organic flutter driven by brown noise.
    this.leafGain = this.gain(0);
    this.leafAmp = [];
    for (const pan of [-0.6, 0.6]) {
      const src = eng.noiseSource('white');
      const hp = this.filter('highpass', 1600, 0.6);
      const bp = this.filter('bandpass', 4500, 0.5);
      const amp = this.gain(0.5);
      // Flutter: audio-rate brown noise wobbling the amplitude.
      const mod = eng.noiseSource('brown', eng.now, 2.5);
      const modG = this.gain(0.6);
      mod.connect(modG).connect(amp.gain);
      src.connect(hp).connect(bp).connect(amp).connect(this.stereo(pan)).connect(this.leafGain);
      this.leafAmp.push(amp);
    }
    this.leafGain.connect(out);

    // --- water, placed towards the nearest water.
    this.waterPanner = ac.createPanner();
    this.waterPanner.panningModel = 'equalpower';
    this.waterPanner.distanceModel = 'inverse';
    this.waterPanner.refDistance = 1000;
    this.waterPanner.rolloffFactor = 0;
    this.waterPanner.connect(out);
    // Creek babble: three resonant bands on pink noise whose centres hop around
    // quickly, like bubbles and small falls, over a low rumble.
    this.creekGain = this.gain(0);
    this.creekGain.connect(this.waterPanner);
    const creekSrc = eng.noiseSource('pink');
    this.bubbles = [];
    for (let i = 0; i < 3; i++) {
      const bp = this.filter('bandpass', 600 + i * 500, 7);
      const g = this.gain(0.5);
      creekSrc.connect(bp).connect(g).connect(this.creekGain);
      this.bubbles.push({ bp, g, timer: 0 });
    }
    const rumble = this.filter('lowpass', 350, 0.5);
    const rumbleG = this.gain(0.6);
    eng.noiseSource('brown').connect(rumble).connect(rumbleG).connect(this.creekGain);
    // Still water lapping: slow soft swells of low noise.
    this.lapGain = this.gain(0);
    this.lapAmp = this.gain(0);
    eng.noiseSource('brown').connect(this.filter('lowpass', 650, 0.7)).connect(this.lapAmp).connect(this.lapGain);
    this.lapGain.connect(this.waterPanner);
    // Surf: a breaking-wave body (low-passed brown) and a trailing wash (high hiss).
    this.surfGain = this.gain(0);
    this.surfBodyLP = this.filter('lowpass', 400, 0.5);
    this.surfBody = this.gain(0);
    this.surfWash = this.gain(0);
    eng.noiseSource('brown').connect(this.surfBodyLP).connect(this.surfBody).connect(this.surfGain);
    eng.noiseSource('white').connect(this.filter('highpass', 2400, 0.5)).connect(this.surfWash).connect(this.surfGain);
    this.surfGain.connect(this.waterPanner);
    this.wave = { phase: 0, period: 8 };

    // --- rain: open hiss (wide) and muffled canopy patter with drips.
    this.rainOpenGain = this.gain(0);
    for (const pan of [-0.5, 0.5]) {
      eng.noiseSource('white').connect(this.filter('highpass', 900, 0.5)).connect(this.filter('lowpass', 9000, 0.5))
        .connect(this.stereo(pan)).connect(this.rainOpenGain);
    }
    this.rainOpenGain.connect(out);
    this.rainCanopyGain = this.gain(0);
    eng.noiseSource('pink').connect(this.filter('lowpass', 1300, 0.6)).connect(this.rainCanopyGain);
    this.rainCanopyGain.connect(out);
    this.dripBus = this.gain(1);
    this.dripBus.connect(out);
    this.dripAcc = 0;

    // --- insects / crickets: a few pulsing high tones gated into chirps.
    this.insectGain = this.gain(0);
    this.insectGain.connect(out);
    this.insects = [];
    for (let i = 0; i < 3; i++) {
      const osc = ac.createOscillator();
      osc.frequency.value = 5200 + i * 700;
      const am = this.gain(0.5);
      const pulse = ac.createOscillator();
      pulse.type = 'square';
      pulse.frequency.value = 60 + i * 9;
      const smooth = this.filter('lowpass', 260, 0.5); // round the square so it never clicks
      const pd = this.gain(0.5);
      pulse.connect(smooth).connect(pd).connect(am.gain);
      const gate = this.gain(0);
      osc.connect(am).connect(gate).connect(this.stereo(-0.7 + i * 0.7)).connect(this.insectGain);
      osc.start(); pulse.start();
      this.insects.push({ osc, pulse, gate, timer: this.rng() * 2, on: false });
    }
    this.insectStyle = 'day';

    // --- night air: very soft low hush with slow swells.
    this.nightGain = this.gain(0);
    eng.noiseSource('pink').connect(this.filter('lowpass', 420, 0.5)).connect(this.nightGain).connect(out);
  }

  /** Set the listener pose and the sampled environment. */
  setInputs(mix, listener, waterDir) {
    this.mix = mix;
    if (listener) { this.listener.x = listener.x; this.listener.y = listener.y; this.listener.z = listener.z; }
    if (waterDir && (waterDir.x || waterDir.z)) { this.waterDir.x = waterDir.x; this.waterDir.z = waterDir.z; }
  }

  update(dt) {
    const m = this.mix;
    if (!m) return;
    const now = this.eng.now;
    this.t += dt;
    const t = this.t;
    this.stepBubbles(dt, m, now);
    this.stepInsects(dt, m, now);
    this.stepDrips(dt, m);
    this.levelClock += dt;
    if (this.levelClock < 1 / LEVEL_HZ) return;
    const step = this.levelClock;
    this.levelClock = 0;
    const n = this.n;

    // Wind with gusts: slow swells plus quicker eddies, both from value noise.
    const gust = 0.6 * n.gust(t * 0.11) + 0.4 * n.gustFast(t * 0.45);
    const windAmp = m.wind * (0.45 + 0.9 * gust);
    set(this.windGain.gain, TRIM.wind * windAmp, now, 0.35);
    for (const lp of this.windLP) set(lp.frequency, 220 + 1100 * gust * (0.3 + m.wind), now, 0.4);
    set(this.howlGain.gain, TRIM.windHowl * m.windHowl * smooth01(gust * 1.4 - 0.2), now, 0.5);
    set(this.howlBP.frequency, 500 + 900 * n.howl(t * 0.07), now, 0.8);

    // Leaves rustle with the gusts.
    set(this.leafGain.gain, TRIM.leaves * m.leaves * (0.35 + 0.9 * gust), now, 0.25);
    set(this.leafAmp[0].gain, 0.3 + 0.4 * n.leafL(t * 0.8), now, 0.2);
    set(this.leafAmp[1].gain, 0.3 + 0.4 * n.leafR(t * 0.8 + 50), now, 0.2);

    // Water direction: keep the panner ~12 m towards the water from the listener.
    const L = this.listener, wd = this.waterDir;
    setPannerPos(this.waterPanner, L.x + wd.x * 12, L.y, L.z + wd.z * 12, now, 0.5);
    set(this.creekGain.gain, TRIM.creek * m.creek * (0.8 + 0.3 * n.creek(t * 0.05)), now, 0.6);
    set(this.lapGain.gain, TRIM.lap * m.lap, now, 0.6);
    set(this.lapAmp.gain, 0.4 + 0.6 * Math.max(0, Math.sin(t * 0.9 + 2 * n.creek(t * 0.1))), now, 0.3);

    // Surf: a wave cycle with a random period, so sets never line up.
    this.wave.phase += step / this.wave.period;
    if (this.wave.phase >= 1) { this.wave.phase -= 1; this.wave.period = 6.5 + 5 * this.rng(); }
    const ph = this.wave.phase;
    const body = ph < 0.35 ? smooth01(ph / 0.35) : Math.exp(-(ph - 0.35) * 4.5);
    const wash = ph < 0.4 ? 0 : Math.sin(Math.min(1, (ph - 0.4) / 0.6) * Math.PI) * 0.8;
    set(this.surfGain.gain, TRIM.surf * m.surf * (0.85 + 0.3 * n.surf(t * 0.03)), now, 0.8);
    set(this.surfBody.gain, 0.15 + 0.85 * body, now, 0.25);
    set(this.surfBodyLP.frequency, 250 + 1500 * body, now, 0.25);
    set(this.surfWash.gain, 0.35 * wash, now, 0.3);

    // Rain.
    const rainSwell = 0.85 + 0.3 * n.rain(t * 0.08);
    set(this.rainOpenGain.gain, TRIM.rainOpen * m.rainOpen * rainSwell, now, 1.2);
    set(this.rainCanopyGain.gain, TRIM.rainCanopy * m.rainCanopy * rainSwell, now, 1.2);

    // Insects / crickets share the voices; the louder of the two styles wins.
    const insectLvl = Math.max(m.insects * TRIM.insects, m.crickets * TRIM.crickets);
    const style = m.crickets > m.insects ? 'night' : 'day';
    if (style !== this.insectStyle) this.setInsectStyle(style, now);
    set(this.insectGain.gain, insectLvl * (0.75 + 0.5 * n.insect(t * 0.05)), now, 1.5);

    set(this.nightGain.gain, TRIM.night * m.night * (0.7 + 0.6 * n.night(t * 0.04)), now, 1.5);
  }

  /** Creek bubbles: each band hops to a new pitch every 60–200 ms. */
  stepBubbles(dt, m, now) {
    if (m.creek < 0.005) return;
    for (const b of this.bubbles) {
      b.timer -= dt;
      if (b.timer > 0) continue;
      b.timer = 0.06 + 0.14 * this.rng();
      const f = 350 + 2200 * Math.pow(this.rng(), 1.6);
      b.bp.frequency.setTargetAtTime(f, now, 0.015 + 0.03 * this.rng());
      b.g.gain.setTargetAtTime(0.25 + 0.75 * this.rng(), now, 0.03);
    }
  }

  setInsectStyle(style, now) {
    this.insectStyle = style;
    this.insects.forEach((v, i) => {
      const day = style === 'day';
      v.osc.frequency.setTargetAtTime(day ? 5200 + i * 700 + 300 * this.rng() : 4200 + i * 250, now, 0.5);
      v.pulse.frequency.setTargetAtTime(day ? 55 + i * 9 : 26 + i * 3, now, 0.5);
    });
  }

  /** Gate the insect voices: long buzzing runs by day, short chirp triplets at night. */
  stepInsects(dt, m, now) {
    if (m.insects < 0.01 && m.crickets < 0.01) return;
    const day = this.insectStyle === 'day';
    for (const v of this.insects) {
      v.timer -= dt;
      if (v.timer > 0) continue;
      if (day) {
        v.on = !v.on;
        v.timer = v.on ? 1.5 + 4 * this.rng() : 0.4 + 2.5 * this.rng();
        v.gate.gain.setTargetAtTime(v.on ? 1 : 0, now, v.on ? 0.25 : 0.4);
      } else {
        // A cricket chirp: three quick pulses, then a pause.
        const g = v.gate.gain;
        const per = 0.055;
        for (let k = 0; k < 3; k++) {
          const s = now + 0.02 + k * per;
          g.setTargetAtTime(1, s, 0.006);
          g.setTargetAtTime(0, s + per * 0.6, 0.008);
        }
        v.timer = 0.55 + 0.5 * this.rng();
      }
    }
  }

  /** Canopy drips: short falling pings, rate following the canopy rain level. */
  stepDrips(dt, m) {
    const rate = 1.5 + 22 * m.rainCanopy;
    if (m.rainCanopy < 0.02) return;
    this.dripAcc += rate * dt;
    while (this.dripAcc >= 1) {
      this.dripAcc -= 1 + (this.rng() - 0.5) * 0.6;
      this.drip(m.rainCanopy);
    }
  }

  drip(level) {
    const ac = this.eng.ac;
    const t = ac.currentTime + 0.01 + 0.08 * this.rng();
    const f = 1800 + 2600 * this.rng();
    const osc = ac.createOscillator();
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.03);
    const g = this.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03 * (0.4 + 0.6 * this.rng()) * Math.sqrt(level), t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.003, 0.012);
    const pan = this.stereo(this.rng() * 1.8 - 0.9);
    osc.connect(g).connect(pan).connect(this.dripBus);
    osc.start(t);
    osc.stop(t + 0.09);
    osc.onended = () => { try { g.disconnect(); pan.disconnect(); } catch { /* fine */ } };
  }
}

function set(param, v, t, tc) {
  if (Number.isFinite(v)) param.setTargetAtTime(v, t, tc);
}
function smooth01(x) {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}
