// Narrator voice pack (docs/contract.md §13): pregenerated clips for every line the
// narrator can say, made by tools/voice/generate.mjs.
//
//   web/voice/manifest.json   {voice, model, format?, lines: {<id>: {file, dur}}}
//   web/voice/<id>.ogg        id = first 16 hex chars of SHA-256(exact line text)
//
// createVoicePack() loads the manifest (absent = fine: no pack) and plays clips;
// createNarratorVoice() wraps it and the system speech backend (voice.js createSpeech)
// into ONE backend with createSpeech's shape, so the controller is unchanged: a line
// with a clip plays the clip, any other line falls back to speech synthesis.
//
// Playback goes through the audio engine's narrator bus (ctx.audio.voice.play) when it
// exists and its context is running: the clip then passes the master limiter, obeys
// volNarrator × volMaster live (also while it plays) and ducks music and ambience. Where
// the engine has no voice bus, a private gain on the game's AudioContext is used, and
// without a running context an HTMLAudioElement. Those two fallbacks take the volume
// the controller passes (volNarrator × volMaster) once, at the start.

/** The JS fallback when crypto.subtle is unavailable (non-secure context). */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of bytes, in plain JS. Returns lowercase hex. */
export function sha256HexSync(bytes) {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(padded.length - 4, bits >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** The line id: first 16 hex chars of SHA-256 of the exact UTF-8 text (as narrator.LineID in Go). */
export async function lineId(text) {
  const bytes = new TextEncoder().encode(String(text));
  const subtle = globalThis.crypto?.subtle;
  if (subtle?.digest) {
    try { return hex(await subtle.digest('SHA-256', bytes)).slice(0, 16); } catch { /* fall back */ }
  }
  return sha256HexSync(bytes).slice(0, 16);
}

const MAX_IDS = 512;
const MAX_BUFFERS = 24;

/**
 * @param {{baseUrl?: string, fetchImpl?: typeof fetch, getAudio?: () => any, win?: any}} o
 *   baseUrl: where manifest.json and the clips live ('voice/' relative to the page);
 *   getAudio: () => ctx.audio (for its AudioContext); win: window (for Audio).
 */
export function createVoicePack({ baseUrl = 'voice/', fetchImpl = globalThis.fetch?.bind(globalThis), getAudio = () => null, win = globalThis } = {}) {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  let manifest = null;
  let loading = null;
  const ids = new Map(); // text → id
  const buffers = new Map(); // id → Promise<AudioBuffer>, insertion order = LRU

  async function idOf(text) {
    let id = ids.get(text);
    if (!id) {
      id = await lineId(text);
      if (ids.size >= MAX_IDS) ids.delete(ids.keys().next().value);
      ids.set(text, id);
    }
    return id;
  }

  function entry(id) {
    const e = manifest?.lines?.[id];
    return e && typeof e.file === 'string' && e.file && !e.file.includes('/') && !e.file.includes('..') ? e : null;
  }

  function audioContext() {
    try {
      const a = getAudio?.();
      const ac = a?.context;
      if (ac && ac.state === 'running' && typeof ac.decodeAudioData === 'function') {
        const voice = a.voice && typeof a.voice.play === 'function' ? a.voice : null;
        return { ac, voice, out: a.voiceOut || ac.destination };
      }
    } catch { /* none */ }
    return null;
  }

  function decoded(ac, id, e) {
    let p = buffers.get(id);
    if (p) { buffers.delete(id); buffers.set(id, p); return p; }
    p = fetchImpl(base + e.file)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((ab) => ac.decodeAudioData(ab));
    p.catch(() => buffers.delete(id));
    buffers.set(id, p);
    while (buffers.size > MAX_BUFFERS) buffers.delete(buffers.keys().next().value);
    return p;
  }

  /** Play a clip through Web Audio. Resolves to {ended: Promise, stop()} once sounding. */
  async function playWebAudio(wa, id, e, volume) {
    const buf = await decoded(wa.ac, id, e);
    if (wa.voice) {
      // The engine's narrator bus owns the volume (live) and the ducking.
      let end;
      const ended = new Promise((resolve) => { end = resolve; });
      const h = wa.voice.play(buf, { gain: 1, onEnded: () => end() });
      return { ended, stop() { try { h.stop(); } catch { /* ignore */ } }, bus: true };
    }
    const src = wa.ac.createBufferSource();
    const g = wa.ac.createGain();
    src.buffer = buf;
    g.gain.value = volume;
    src.connect(g);
    g.connect(wa.out);
    const ended = new Promise((resolve) => { src.onended = () => resolve(); });
    src.start();
    return {
      ended,
      stop() {
        try { src.onended = null; src.stop(); } catch { /* already stopped */ }
        try { src.disconnect(); g.disconnect(); } catch { /* ignore */ }
      },
    };
  }

  /** Play a clip with an HTMLAudioElement (no running AudioContext). */
  async function playElement(e, volume) {
    const Audio = win?.Audio;
    if (typeof Audio !== 'function') throw new Error('no audio output');
    const el = new Audio(base + e.file);
    el.preload = 'auto';
    el.volume = Math.max(0, Math.min(1, volume));
    const ended = new Promise((resolve, reject) => {
      el.onended = () => resolve();
      el.onerror = () => reject(new Error('audio element error'));
    });
    await el.play();
    return { ended, stop() { try { el.onended = null; el.pause(); el.removeAttribute('src'); el.load?.(); } catch { /* ignore */ } }, bus: false };
  }

  return {
    /** Load web/voice/manifest.json once. Resolves true when a pack with lines exists. */
    load() {
      if (!loading) {
        loading = (async () => {
          if (typeof fetchImpl !== 'function') return false;
          try {
            const r = await fetchImpl(base + 'manifest.json', { cache: 'no-cache' });
            if (!r.ok) return false;
            const m = await r.json();
            if (!m || typeof m.lines !== 'object' || !Object.keys(m.lines).length) return false;
            manifest = m;
            return true;
          } catch { return false; }
        })();
      }
      return loading;
    },
    get loaded() { return !!manifest; },
    /** {voice, model, lines} of the loaded pack, or null (the menu shows which voice is in use). */
    get info() {
      return manifest ? { voice: String(manifest.voice || ''), model: String(manifest.model || ''), lines: Object.keys(manifest.lines).length } : null;
    },
    idOf,
    /** The manifest entry for a line's text ({file, dur}), or null. */
    async lookup(text) {
      if (!manifest) return null;
      return entry(await idOf(text));
    },
    /** Start fetching/decoding a line's clip ahead of time (best effort). */
    async prefetch(text) {
      try {
        if (!manifest) return;
        const id = await idOf(text);
        const e = entry(id);
        const wa = e && audioContext();
        if (wa) await decoded(wa.ac, id, e);
      } catch { /* best effort */ }
    },
    /**
     * Play the clip for `text`. Resolves to a playing handle {ended: Promise, stop(), dur},
     * or null when there is no clip. Rejects if the clip exists but cannot be played.
     */
    async play(text, { volume = 1 } = {}) {
      if (!manifest) return null;
      const id = await idOf(text);
      const e = entry(id);
      if (!e) return null;
      const wa = audioContext();
      const h = wa ? await playWebAudio(wa, id, e, volume) : await playElement(e, volume);
      return { ...h, dur: Number(e.dur) || 0 };
    },
  };
}

/**
 * One backend (createSpeech's shape) over a voice pack and system speech: clips where
 * the pack has the line, speech synthesis for everything else (and when a clip fails).
 */
export function createNarratorVoice(speech, pack, { onSpeaking = null } = {}) {
  // Speaking state for the engine's ducking: clips on the engine's bus report themselves;
  // speech synthesis and element playback are reported here.
  const speaking = (on) => { try { onSpeaking?.(!!on); } catch { /* ignore */ } };
  return {
    get available() { return !!speech?.available || !!pack?.loaded; },
    voices: () => speech?.voices?.() || [],
    onVoicesChanged: (cb) => speech?.onVoicesChanged?.(cb) || (() => {}),
    prefetch: (text) => { pack?.prefetch?.(text); },
    speak(text, opts = {}) {
      let settle;
      const done = new Promise((r) => { settle = r; });
      let finished = false, cancelled = false;
      let clip = null, synth = null, guard = null, reported = false;
      const report = (on) => { if (on !== reported) { reported = on; speaking(on); } };
      const finish = (ok, reason) => {
        if (finished) return;
        finished = true;
        clearTimeout(guard);
        report(false);
        settle({ ok, reason });
      };
      const viaSpeech = () => {
        if (cancelled) return;
        if (!speech?.available) { finish(false, 'unavailable'); return; }
        report(true);
        synth = speech.speak(text, opts);
        Promise.resolve(synth?.done).then((r) => finish(!!r?.ok, r?.reason || 'end'), () => finish(false, 'error'));
      };
      (async () => {
        let h = null;
        try { h = pack?.loaded ? await pack.play(text, { volume: opts.volume ?? 1 }) : null; } catch { h = null; }
        if (cancelled) { h?.stop?.(); return; }
        if (!h) { viaSpeech(); return; }
        clip = h;
        if (!h.bus) report(true);
        // Never hang if 'ended' is lost.
        const limit = (h.dur || opts.expect || 6) * 1.5 + 3;
        guard = setTimeout(() => { clip?.stop?.(); finish(true, 'timeout'); }, limit * 1000);
        h.ended.then(() => finish(true, 'end'), () => finish(false, 'error'));
      })();
      return {
        done,
        get source() { return clip ? 'pack' : synth ? 'speech' : 'pending'; },
        cancel() {
          if (finished) return;
          cancelled = true;
          try { clip?.stop?.(); } catch { /* ignore */ }
          try { synth?.cancel?.(); } catch { /* ignore */ }
          finish(false, 'cancelled');
        },
      };
    },
  };
}
