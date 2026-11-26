// The narrator (docs/contract.md §8): speaks `net:narrate` lines (proto.Narration)
// with a calm British system voice and shows each as a caption in #narrator.
//
// ctx.narrator = {
//   say(text, opts)  // queue a local line; opts {priority=1, ttl=10, kind='local', interrupt=false}
//   stop()           // cut the current line and clear the queue
//   voices()         // installed English voices, best first: [{name, lang, default, localService}]
// }
//
// Files: voice.js (the speech backend seam — swap it for a recorded/neural voice pack),
// queue.js (priority/TTL queue, frequency setting), caption.js (timing, line balancing,
// DOM caption), controller.js (the rules that tie them together).
import { createSpeech } from './voice.js';
import { createCaption } from './caption.js';
import { createController } from './controller.js';

let controller = null;

export default {
  name: 'narrator',

  init(ctx) {
    try {
      const speech = createSpeech(typeof window !== 'undefined' ? window : globalThis);
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
      };

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
      ctx.narrator = ctx.narrator || { say() { return false; }, stop() {}, voices() { return []; } };
    }
  },

  update(dt) {
    if (!controller) return;
    try { controller.tick(dt); } catch { /* never break the frame loop */ }
  },
};
