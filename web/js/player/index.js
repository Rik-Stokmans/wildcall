// Player module: publishes ctx.player (first-person controller) and ctx.tools (field
// instruments), and handles the field actions that belong to the player — identify (T),
// scatter seed (G) and jot a field note (N). See docs/contract.md §5.2.
import { createController } from './controller.js';
import { createTools } from './tools.js';
import { createNotePrompt } from './note.js';
import { carries } from './field.js';

let controller = null;
let tools = null;

export default {
  name: 'player',

  init(ctx) {
    const { bus, net, state } = ctx;
    controller = createController(ctx, () => tools);
    ctx.player = controller.api;
    tools = createTools(ctx, controller);
    ctx.tools = tools;
    createNotePrompt(ctx, controller);

    // Identify (T) is handled by the encounter module (ctx.encounter.openIdentify):
    // a second handler here used to open the screen and the encounter's toggle then
    // closed it again in the same key press, so T never worked.
    let hintAt = -Infinity;
    const softHint = (title, text) => {
      // One gentle line at most every few seconds; never a nag.
      if (ctx.time - hintAt < 4) return;
      hintAt = ctx.time;
      bus.emit('toast', { kind: 'info', title, text, xp: 0, icon: '' });
    };

    // --- seed mix (G) --------------------------------------------------------------
    bus.on('action:seed', () => {
      if (state.mode !== 'play' || controller.s.busy) return;
      if (carries(state.profile, 'seed_mix')) net.send('use', { item: 'seed_mix' });
      else softHint('No seed mix', 'There is no seed mix in your satchel.');
    });
  },

  update(dt, ctx) {
    if (!controller) return;
    controller.update(dt);
    tools?.update(dt);
    controller.applyCamera(dt, tools?.sway);
  },
};
