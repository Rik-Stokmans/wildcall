// Note voices: render one scheduled note event (schedule.js) as Web Audio nodes.
//
// Waves (core.Note.Wave):
//   sine     pure tone + micro-vibrato (owl hoots, the thinnest high notes)
//   whistle  sine + soft 2nd harmonic, gentle vibrato, breath noise (most song notes)
//   buzz     sawtooth with FM roughness through a band-pass that follows the glide
//   trill    whistle carrier with fast AM at Rate (Depth) and a little coupled FM
//   noise    band-passed noise sweeping F0→F1, rough AM (screeches, harsh calls)
//   click    very short broadband tap with a resonant ring (drums, ticks)
// On every wave but trill, Rate/Depth are vibrato (Depth = fraction of frequency).
//
// Every note has its own envelope with a smooth attack and release, so there are never
// clicks, and a whisper of band-passed breath noise and a slow pitch wobble so songs
// sound like a throat and not an oscillator.

/**
 * Schedule one note.
 * @param {import('./engine.js').AudioEngine} eng
 * @param {object} ev NoteEvent {dur, f0, f1, wave, rate, depth, amp}
 * @param {number} when absolute AudioContext start time
 * @param {AudioNode} out destination (the voice's input)
 * @param {() => number} rng variation source
 * @returns {{sources: AudioScheduledSourceNode[], end: number}}
 */
export function renderNote(eng, ev, when, out, rng) {
  const ac = eng.ac;
  const dur = Math.max(0.004, ev.dur);
  const end = when + dur;
  const f0 = ev.f0, f1 = ev.f1;
  const fMean = Math.sqrt(f0 * f1);
  const amp = ev.amp;
  const sources = [];

  const env = ac.createGain();
  env.gain.value = 0;
  env.connect(out);

  const extra = []; // nodes outside the envelope to disconnect afterwards
  let stopAt = end + 0.03;
  if (ev.wave === 'click') {
    stopAt = clickVoice(eng, ev, when, env, out, sources, extra, rng);
  } else {
    shapeEnvelope(env.gain, when, dur, amp);
    switch (ev.wave) {
      case 'sine': toneVoice(eng, ev, when, end, env, sources, rng, 0, 0.0035); break;
      case 'buzz': buzzVoice(eng, ev, when, end, env, sources, rng); break;
      case 'trill': trillVoice(eng, ev, when, end, env, sources, rng); break;
      case 'noise': noiseVoice(eng, ev, when, end, env, sources, rng); break;
      default: toneVoice(eng, ev, when, end, env, sources, rng, 0.12, 0.006); break;
    }
    if (ev.wave !== 'noise' && ev.wave !== 'buzz') breath(eng, fMean, when, end, env, sources, ev.wave === 'sine' ? 0.012 : 0.03);
    stopAt = end + 0.03;
  }

  for (const s of sources) s.stop(stopAt);
  // Tidy the graph once the note is over; every source ends at stopAt.
  if (sources.length) {
    sources[0].onended = () => {
      try { env.disconnect(); } catch { /* already gone */ }
      for (const n of extra) { try { n.disconnect(); } catch { /* already gone */ } }
    };
  }
  return { sources, end: stopAt };
}

/**
 * Attack/hold/release with a slight natural decay. Attack and release are a fraction of
 * the note so very short notes still get a (tiny) ramp instead of a step.
 */
export function shapeEnvelope(param, when, dur, amp) {
  let a = clamp(dur * 0.2, 0.004, 0.025);
  let r = clamp(dur * 0.3, 0.006, 0.05);
  if (a + r > dur) { const k = dur / (a + r); a *= k; r *= k; }
  param.setValueAtTime(0, when);
  param.linearRampToValueAtTime(amp, when + a);
  param.linearRampToValueAtTime(amp * 0.85, when + dur - r);
  param.linearRampToValueAtTime(0, when + dur);
}

function glideFreq(param, f0, f1, when, end) {
  param.setValueAtTime(f0, when);
  if (Math.abs(f1 - f0) > 0.5) param.exponentialRampToValueAtTime(f1, end);
}

/** Vibrato LFO into a frequency param (Hz depth). */
function vibrato(eng, params, rate, depthHz, when, end, sources) {
  if (!(depthHz > 0) || !(rate > 0)) return;
  const ac = eng.ac;
  const lfo = ac.createOscillator();
  lfo.frequency.value = rate;
  const g = ac.createGain();
  g.gain.value = depthHz;
  lfo.connect(g);
  for (const p of params) g.connect(p);
  lfo.start(when);
  sources.push(lfo);
}

/** The note's own vibrato (Rate/Depth) or a subtle natural micro-vibrato. */
function vibratoFor(ev, fMean, rng, microDepth) {
  if (ev.rate > 0 && ev.depth > 0) return { rate: ev.rate, depth: Math.min(0.5, ev.depth) * fMean };
  return { rate: 5 + rng() * 3, depth: microDepth * fMean };
}

/** sine / whistle: fundamental + optional soft 2nd harmonic. */
function toneVoice(eng, ev, when, end, out, sources, rng, harmonic, microDepth) {
  const ac = eng.ac;
  const fMean = Math.sqrt(ev.f0 * ev.f1);
  const osc = ac.createOscillator();
  osc.type = 'sine';
  glideFreq(osc.frequency, ev.f0, ev.f1, when, end);
  osc.connect(out);
  osc.start(when);
  sources.push(osc);
  const params = [osc.frequency];
  if (harmonic > 0 && ev.f1 * 2 < 16000) {
    const h = ac.createOscillator();
    h.type = 'sine';
    glideFreq(h.frequency, ev.f0 * 2, ev.f1 * 2, when, end);
    const hg = ac.createGain();
    hg.gain.value = harmonic;
    h.connect(hg).connect(out);
    h.start(when);
    sources.push(h);
    // Same relative vibrato on the harmonic: drive it from a doubled LFO depth.
    const v = vibratoFor(ev, fMean, rng, microDepth);
    vibrato(eng, [osc.frequency], v.rate, v.depth, when, end, sources);
    vibrato(eng, [h.frequency], v.rate, v.depth * 2, when, end, sources);
    return;
  }
  const v = vibratoFor(ev, fMean, rng, microDepth);
  vibrato(eng, params, v.rate, v.depth, when, end, sources);
}

/** buzz: sawtooth with FM roughness, shaped by a band-pass that follows the glide. */
function buzzVoice(eng, ev, when, end, out, sources, rng) {
  const ac = eng.ac;
  const fMean = Math.sqrt(ev.f0 * ev.f1);
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  glideFreq(osc.frequency, ev.f0, ev.f1, when, end);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.2;
  glideFreq(bp.frequency, ev.f0 * 1.2, ev.f1 * 1.2, when, end);
  const comp = ac.createGain();
  comp.gain.value = 1.4; // the band-pass removes most of the saw's energy
  osc.connect(bp).connect(comp).connect(out);
  osc.start(when);
  sources.push(osc);
  // Roughness: a fast FM (Rate if authored, else 70–130 Hz) at Depth (default 6 %).
  const rate = ev.rate > 0 ? ev.rate : 70 + rng() * 60;
  const depth = (ev.depth > 0 ? Math.min(0.5, ev.depth) : 0.06) * fMean;
  vibrato(eng, [osc.frequency], rate, depth, when, end, sources);
}

/** trill: whistle carrier chopped by fast AM at Rate with Depth, with coupled pitch flicks. */
function trillVoice(eng, ev, when, end, out, sources, rng) {
  const ac = eng.ac;
  const fMean = Math.sqrt(ev.f0 * ev.f1);
  const am = ac.createGain();
  const depth = clamp(ev.depth > 0 ? ev.depth : 0.8, 0, 1);
  am.gain.value = 1 - depth / 2;
  am.connect(out);
  const osc = ac.createOscillator();
  osc.type = 'sine';
  glideFreq(osc.frequency, ev.f0, ev.f1, when, end);
  osc.connect(am);
  const h = ac.createOscillator();
  h.type = 'sine';
  glideFreq(h.frequency, ev.f0 * 2, ev.f1 * 2, when, end);
  const hg = ac.createGain();
  hg.gain.value = 0.1;
  h.connect(hg).connect(am);
  osc.start(when); h.start(when);
  sources.push(osc, h);
  const rate = ev.rate > 0 ? ev.rate : 18 + rng() * 10;
  const lfo = ac.createOscillator();
  lfo.frequency.value = rate;
  const amDepth = ac.createGain();
  amDepth.gain.value = depth / 2;
  lfo.connect(amDepth).connect(am.gain);
  const fm = ac.createGain();
  fm.gain.value = 0.015 * fMean;
  lfo.connect(fm);
  fm.connect(osc.frequency);
  const fm2 = ac.createGain();
  fm2.gain.value = 0.03 * fMean;
  lfo.connect(fm2);
  fm2.connect(h.frequency);
  lfo.start(when);
  sources.push(lfo);
}

/** noise: band-passed noise sweeping F0→F1 with a rough AM (harsh calls, screeches). */
function noiseVoice(eng, ev, when, end, out, sources, rng) {
  const ac = eng.ac;
  const src = eng.noiseSource('white', when);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 2.2;
  glideFreq(bp.frequency, ev.f0, ev.f1, when, end);
  const bp2 = ac.createBiquadFilter();
  bp2.type = 'bandpass';
  bp2.Q.value = 3;
  glideFreq(bp2.frequency, Math.min(15000, ev.f0 * 2.1), Math.min(15000, ev.f1 * 2.1), when, end);
  const g2 = ac.createGain();
  g2.gain.value = 0.4;
  const am = ac.createGain();
  const depth = ev.depth > 0 ? clamp(ev.depth, 0, 1) : 0.4;
  am.gain.value = 3.2 * (1 - depth / 2);
  src.connect(bp).connect(am);
  src.connect(bp2).connect(g2).connect(am);
  am.connect(out);
  sources.push(src);
  const lfo = ac.createOscillator();
  lfo.type = 'triangle';
  lfo.frequency.value = ev.rate > 0 ? ev.rate : 45 + rng() * 30;
  const lg = ac.createGain();
  lg.gain.value = 3.2 * depth / 2;
  lfo.connect(lg).connect(am.gain);
  lfo.start(when);
  sources.push(lfo);
}

/** click: a 1–2 ms broadband strike plus a short resonant ring at F0 (wood, bill). */
function clickVoice(eng, ev, when, out, dest, sources, extra, rng) {
  const ac = eng.ac;
  const ring = 0.025 + 0.02 * rng();
  const g = out.gain;
  g.setValueAtTime(0, when);
  g.linearRampToValueAtTime(ev.amp, when + 0.0012);
  g.setTargetAtTime(0, when + 0.0012, Math.max(0.003, ev.dur * 0.6));
  // Broadband tap through a resonant band-pass.
  const src = eng.noiseSource('white', when);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = ev.f0;
  bp.Q.value = 6;
  const tapGain = ac.createGain();
  tapGain.gain.value = 3;
  src.connect(bp).connect(tapGain).connect(out);
  sources.push(src);
  // Woody ring: a sine at the resonance that decays independently of the tap.
  const osc = ac.createOscillator();
  osc.type = 'sine';
  glideFreq(osc.frequency, ev.f0, ev.f1, when, when + ring);
  const og = ac.createGain();
  og.gain.setValueAtTime(0, when);
  og.gain.linearRampToValueAtTime(0.45 * ev.amp, when + 0.001);
  og.gain.setTargetAtTime(0, when + 0.001, ring / 3);
  // The ring bypasses the tap envelope: it decays more slowly than the strike.
  osc.connect(og).connect(dest);
  extra.push(og);
  osc.start(when);
  sources.push(osc);
  return when + Math.max(ev.dur, ring) + 0.05;
}

/** Breath: band-passed noise around the fundamental, following the note's envelope. */
function breath(eng, fMean, when, end, out, sources, level) {
  const ac = eng.ac;
  const src = eng.noiseSource('pink', when);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(12000, fMean);
  bp.Q.value = 1.4;
  const g = ac.createGain();
  g.gain.value = level * 4;
  src.connect(bp).connect(g).connect(out);
  sources.push(src);
}

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
