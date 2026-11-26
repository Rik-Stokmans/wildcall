// Narrator voice backend — THE SEAM.
//
// Everything the narrator needs from a voice goes through createSpeech(). It returns
//
//   {
//     available: boolean,                       // can this backend make sound at all?
//     voices(): VoiceLike[],                    // installed voices ({name, lang, default, localService})
//     onVoicesChanged(cb): () => void,          // voices load asynchronously in most browsers
//     speak(text, {voice, rate, pitch, volume}) // → { done: Promise<{ok, reason}>, cancel() }
//   }
//
// Today it wraps the Web Speech API (window.speechSynthesis). To ship a recorded or
// neural voice pack later, write another factory with the same shape (e.g. one that
// looks the line's text or id up in a pack of audio clips and plays them through Web
// Audio) and pass it to the narrator in place of createSpeech — nothing else in
// js/narrator needs to change. `done` must always settle, even if the engine never
// reports the end of an utterance.
//
// rankVoices / pickVoice are pure and unit-tested (voice.test.js).

/** Name fragments of calm male British voices, best first. */
export const PREFERRED = ['Daniel', 'Oliver', 'Arthur', 'George', 'Ryan', 'UK English Male', 'Thomas', 'Malcolm'];

/** Female-sounding voice names commonly installed with en-GB (we prefer male). */
const FEMALE = ['female', 'kate', 'serena', 'martha', 'stephanie', 'hazel', 'susan', 'libby', 'sonia', 'maisie', 'fiona', 'moira', 'tessa', 'karen', 'samantha', 'victoria'];

/** macOS novelty voices: never the narrator. */
const NOVELTY = ['bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'good news', 'jester', 'organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox', 'albert', 'fred', 'junior', 'ralph', 'grandma', 'grandpa', 'eddy', 'flo', 'reed', 'rocko', 'sandy', 'shelley', 'deranged', 'hysterical', 'pipe organ'];

function lower(s) { return String(s || '').toLowerCase(); }

/** Score one voice; higher is better. -Infinity = not English. */
export function scoreVoice(v) {
  const name = lower(v?.name);
  const lang = lower(v?.lang).replace('_', '-');
  let s;
  if (lang === 'en-gb' || lang.startsWith('en-gb')) s = 100;
  else if (lang.startsWith('en')) s = 40;
  else return -Infinity;
  const i = PREFERRED.findIndex((p) => name.includes(p.toLowerCase()));
  if (i >= 0) s += 60 - i * 5;
  if (/\bmale\b/.test(name) && !name.includes('female')) s += 20;
  if (FEMALE.some((f) => name.includes(f))) s -= 15;
  if (NOVELTY.some((n) => name === n || name.startsWith(n + ' '))) s -= 200;
  if (name.includes('enhanced') || name.includes('premium') || name.includes('natural')) s += 8;
  if (v?.localService) s += 3;
  if (v?.default) s += 1;
  return s;
}

/** English voices, best first. Stable for equal scores. */
export function rankVoices(voices) {
  return [...(voices || [])]
    .map((v, i) => ({ v, i, s: scoreVoice(v) }))
    .filter((x) => x.s > -Infinity)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.v);
}

/**
 * The voice to use: the one named by `preferredName` (settings.narratorVoice) if it is
 * installed, else the best-ranked English voice, else null (captions only, or the
 * engine's default voice).
 */
export function pickVoice(voices, preferredName = '') {
  const list = voices || [];
  if (preferredName) {
    const exact = list.find((v) => v?.name === preferredName);
    if (exact) return exact;
  }
  return rankVoices(list)[0] || null;
}

/** Web Speech API backend. Never throws; `available` is false without speech synthesis. */
export function createSpeech(win = globalThis) {
  const synth = win?.speechSynthesis;
  const Utterance = win?.SpeechSynthesisUtterance;
  const available = !!(synth && typeof synth.speak === 'function' && Utterance);

  return {
    available,
    voices() {
      if (!available) return [];
      try { return synth.getVoices() || []; } catch { return []; }
    },
    onVoicesChanged(cb) {
      if (!available) return () => {};
      try {
        if (typeof synth.addEventListener === 'function') {
          synth.addEventListener('voiceschanged', cb);
          return () => synth.removeEventListener('voiceschanged', cb);
        }
        synth.onvoiceschanged = cb;
        return () => { if (synth.onvoiceschanged === cb) synth.onvoiceschanged = null; };
      } catch { return () => {}; }
    },
    speak(text, { voice = null, rate = 0.92, pitch = 0.95, volume = 1, expect = 6 } = {}) {
      let settle;
      const done = new Promise((resolve) => { settle = resolve; });
      let finished = false;
      const finish = (ok, reason) => { if (!finished) { finished = true; clearTimeout(guard); settle({ ok, reason }); } };
      // Engines sometimes never fire 'end' (Chrome after long idle, some Linux setups).
      const guard = setTimeout(() => finish(true, 'timeout'), Math.max(4, expect * 2 + 3) * 1000);
      if (!available) { finish(false, 'unavailable'); return { done, cancel() {} }; }
      try {
        const u = new Utterance(text);
        if (voice) u.voice = voice;
        u.lang = voice?.lang || 'en-GB';
        u.rate = rate; u.pitch = pitch; u.volume = Math.max(0, Math.min(1, volume));
        u.onend = () => finish(true, 'end');
        u.onerror = (e) => finish(false, e?.error || 'error');
        // Chrome can get stuck in a paused state; nudge it.
        if (synth.paused) { try { synth.resume(); } catch { /* ignore */ } }
        synth.speak(u);
      } catch (err) {
        finish(false, String(err?.message || err));
      }
      return {
        done,
        cancel() {
          if (finished) return;
          try { synth.cancel(); } catch { /* ignore */ }
          finish(false, 'cancelled');
        },
      };
    },
  };
}
