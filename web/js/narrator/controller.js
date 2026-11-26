// Narrator controller: decides what is spoken when, on the client side. All outside
// dependencies are injected so the rules are testable without a DOM or a speech engine
// (controller.test.js).
//
//   createController({
//     speech,            // a backend with createSpeech()'s shape (index.js passes pack.js
//                        //   createNarratorVoice: pack clips, else speech synthesis);
//                        //   optional speech.prefetch(text) is called as lines are queued
//     caption,           // { show(text), hide() } from caption.js createCaption()
//     settings(),        // → state.settings (volNarrator, volMaster, narrator, narratorVoice)
//     blocked(),         // → { hard, soft }: hard = focus listening / recording / dialogue
//                        //   (cut the current line), soft = any other screen (don't start)
//   })
//
// Rules: one line at a time; queue by priority with TTL expiry; a priority ≥ 2 line may
// cut off a priority 0 line; nothing starts while blocked (queued lines wait, and
// expire on TTL); a hard block cuts the current line politely (priority ≥ 2 lines are
// re-queued to be said afterwards if still relevant). Captions always show, voice or
// not.
import { createQueue, canInterrupt, sparseReady } from './queue.js';
import { estimateDuration } from './caption.js';
import { pickVoice, rankVoices } from './voice.js';

export const RATE = 0.92;
export const PITCH = 0.95;
const LINGER = 0.4;  // caption stays this long after the voice ends
const BREATH = 0.8;  // pause between two lines

const clamp01 = (x, d) => { const v = Number.isFinite(x) ? x : d; return v < 0 ? 0 : v > 1 ? 1 : v; };

export function createController({ speech, caption, settings, blocked }) {
  const queue = createQueue();
  let clock = 0;
  let current = null; // { item, handle, voiced, startedAt, est, endsAt }
  let lastStart = null;
  let readyAt = 0;
  let voice = null;
  let voiceKey = null;

  const cfg = () => { try { return settings?.() || {}; } catch { return {}; } };
  const block = () => { try { return blocked?.() || {}; } catch { return {}; } };

  function chooseVoice() {
    const pref = cfg().narratorVoice || '';
    const list = speech?.voices?.() || [];
    const key = pref + '|' + list.length;
    if (key !== voiceKey) { voiceKey = key; voice = pickVoice(list, pref); }
    return voice;
  }

  function finish() {
    if (!current) return;
    caption?.hide?.();
    current = null;
    readyAt = clock + BREATH;
  }

  function cut(requeue) {
    if (!current) return;
    const { item, handle } = current;
    current = null;
    try { handle?.cancel?.(); } catch { /* ignore */ }
    caption?.hide?.();
    readyAt = clock + BREATH;
    if (requeue && item.priority >= 2) queue.requeue(item, clock);
  }

  function start(item) {
    const s = cfg();
    lastStart = clock;
    const est = estimateDuration(item.text, RATE);
    current = { item, handle: null, voiced: false, startedAt: clock, est, endsAt: clock + est };
    caption?.show?.(item.text);
    const volume = clamp01(s.volNarrator, 0.9) * clamp01(s.volMaster, 0.8);
    if (!speech?.available || volume <= 0.001) return; // captions only
    let handle;
    try {
      handle = speech.speak(item.text, { voice: chooseVoice(), rate: RATE, pitch: PITCH, volume, expect: est });
    } catch { handle = null; }
    if (!handle) return;
    const mine = current;
    mine.handle = handle;
    mine.voiced = true;
    mine.endsAt = clock + est * 2 + 4; // safety: the backend's own guard should fire first
    Promise.resolve(handle.done).then((r) => {
      if (current !== mine) return; // cut or replaced
      mine.voiced = false;
      if (r && r.ok) mine.endsAt = clock + LINGER;
      else mine.endsAt = Math.max(clock + LINGER, mine.startedAt + mine.est); // engine failed: caption-only timing
    }, () => {
      if (current !== mine) return;
      mine.voiced = false;
      mine.endsAt = Math.max(clock, mine.startedAt + mine.est);
    });
  }

  function tick(dt = 0) {
    if (Number.isFinite(dt) && dt > 0) clock += dt;
    const s = cfg();
    const freq = s.narrator || 'normal';
    if (freq === 'off') {
      if (current) cut(false);
      queue.clear();
      return;
    }
    const b = block();
    if (current) {
      if (b.hard) { cut(true); }
      else if (clock >= current.endsAt) {
        if (current.voiced) cut(false); else finish();
      } else {
        const next = queue.peek(clock);
        if (next && canInterrupt(current.item, next)) { cut(false); readyAt = clock; } // no breath: the new line takes over
        else return;
      }
    }
    if (b.hard || b.soft) { queue.prune(clock); return; }
    if (clock < readyAt) return;
    const next = queue.peek(clock);
    if (!next) return;
    if (!sparseReady(freq, lastStart, clock, next.priority)) return;
    start(queue.take(clock));
  }

  return {
    get clock() { return clock; },
    get current() { return current ? { ...current.item, voiced: current.voiced } : null; },
    get queued() { return queue.size; },
    /** A proto.Narration from the server. */
    receive(line) {
      const ok = queue.push(line, clock, cfg().narrator || 'normal');
      if (ok && line?.text) { try { speech?.prefetch?.(line.text); } catch { /* best effort */ } }
      tick(0);
      return ok;
    },
    /** ctx.narrator.say(text, {priority=1, ttl=10, kind='local', interrupt=false}). */
    say(text, opts = {}) {
      if (!text) return false;
      if (opts.interrupt) cut(false);
      const line = {
        id: 0, text: String(text), kind: opts.kind || 'local',
        priority: Number.isFinite(opts.priority) ? opts.priority : 1,
        ttl: Number.isFinite(opts.ttl) ? opts.ttl : 10,
      };
      const ok = queue.push(line, clock, cfg().narrator || 'normal');
      tick(0);
      return ok;
    },
    stop() { cut(false); queue.clear(); },
    voices() {
      return rankVoices(speech?.voices?.() || []).map((v) => ({
        name: v.name, lang: v.lang, default: !!v.default, localService: !!v.localService,
      }));
    },
    /** Forget the chosen voice (voices changed, or settings.narratorVoice changed). */
    refreshVoice() { voiceKey = null; },
    tick,
  };
}
