// The narrator (docs/contract.md §8): speaks `net:narrate` lines (proto.Narration)
// with a calm British system voice and shows each as a caption in #narrator.
//
// ctx.narrator = {
//   say(text, opts)  // queue a local line; opts {priority=1, ttl=10, kind='local', interrupt=false}
//   stop()           // cut the current line and clear the queue
//   voices()         // installed English voices, best first: [{name, lang, default, localService}]
//   voicePack        // the pregenerated voice in use: {voice, model, lines} or null (system voice)
// }
// The bus event 'narrator:voicepack' ({voice, model, lines}) fires once a pack has loaded.
//
// Files: voice.js (system speech backend), pack.js (the pregenerated voice pack of §13 and
// the backend that prefers its clips over speech synthesis), queue.js (priority/TTL
// queue, frequency setting), caption.js (timing, line balancing, DOM caption),
// controller.js (the rules that tie them together).
import { createSpeech } from './voice.js';
import { createVoicePack, createNarratorVoice } from './pack.js';
import { createCaption } from './caption.js';
import { createController } from './controller.js';

const SYSTEM_VOICE_FALLBACK = false;
let controller = null;

export default {
  name: 'narrator',

  init(ctx) {
    try {
      const win = typeof window !== 'undefined' ? window : globalThis;
      // Recorded lines only. The system's speech synthesis is never used as a stand-in:
      // a robotic voice reading the lines is worse than a silent caption.
      const system = SYSTEM_VOICE_FALLBACK ? createSpeech(win) : null;
      const pack = createVoicePack({ baseUrl: 'voice/', getAudio: () => ctx.audio, win });
      const speech = createNarratorVoice(system, pack, {
        onSpeaking: (on) => ctx.audio?.voice?.setSpeaking?.(on),
      });
      const root = typeof document !== 'undefined' ? document.getElementById('narrator') : null;
      const caption = createCaption(root);
      let focusOn = false;

      controller = createController({
        speech,
        caption,
        settings: () => ctx.state?.settings,
        blocked: () => {
          const dialog = !!ctx.ui?.isOpen?.('dialog');
          const hard = focusOn || !!ctx.tools?.recording || dialog;
          const soft = (ctx.state?.mode ?? 'play') !== 'play';
          return { hard, soft };
        },
      });

      ctx.narrator = {
        say: (text, opts) => { try { return controller.say(text, opts); } catch { return false; } },
        stop: () => { try { controller.stop(); } catch { /* ignore */ } },
        voices: () => { try { return controller.voices(); } catch { return []; } },
        get voicePack() { return pack.info; },
      };
      pack.load().then((ok) => {
        if (!ok) return;
        console.info(`[narrator] voice pack: ${pack.info.voice} (${pack.info.lines} lines)`);
        try { ctx.bus?.emit?.('narrator:voicepack', pack.info); } catch { /* ignore */ }
      });

      const bus = ctx.bus;
      bus?.on?.('net:narrate', (line) => { try { controller.receive(line); } catch (err) { console.warn('[narrator]', err); } });
      bus?.on?.('focus', (d) => { focusOn = !!d?.on; try { controller.tick(0); } catch { /* ignore */ } });
      bus?.on?.('mode', () => { try { controller.tick(0); } catch { /* ignore */ } });
      bus?.on?.('ui:open', () => { try { controller.tick(0); } catch { /* ignore */ } });
      bus?.on?.('settings', ({ key, value } = {}) => {
        try {
          if (key === 'narratorVoice') controller.refreshVoice();
          if (key === 'narrator' && value === 'off') controller.stop();
          controller.tick(0);
        } catch { /* ignore */ }
      });
      speech.onVoicesChanged(() => { try { controller.refreshVoice(); } catch { /* ignore */ } });
    } catch (err) {
      console.warn('[narrator] init failed; continuing without narration', err);
      ctx.narrator = ctx.narrator || { say() { return false; }, stop() {}, voices() { return []; }, voicePack: null };
    }
  },

  update(dt) {
    if (!controller) return;
    try { controller.tick(dt); } catch { /* never break the frame loop */ }
  },
};
