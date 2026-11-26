// Player module: publishes ctx.player (first-person controller) and ctx.tools (field
// instruments), and handles the field actions that belong to the player — identify (T),
// scatter seed (G) and jot a field note (N). See docs/contract.md §5.2.
import { createController } from './controller.js';
import { createTools } from './tools.js';
import { createNotePrompt } from './note.js';
import { createSightingTracker, trackSighting, liveMystery, carries } from './field.js';

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

    // --- identify (T): the bird under observation, if it is still a mystery --------
    const sighting = createSightingTracker();
    bus.on('net:sighting', (s) => trackSighting(sighting, s, ctx.time));
    let hintAt = -Infinity;
    const softHint = (title, text) => {
      // One gentle line at most every few seconds; never a nag.
      if (ctx.time - hintAt < 4) return;
      hintAt = ctx.time;
      bus.emit('toast', { kind: 'info', title, text, xp: 0, icon: '' });
    };
    bus.on('action:identify', () => {
      if (state.mode !== 'play' || controller.s.busy) return;
      const mystery = liveMystery(sighting, ctx.time);
      if (mystery && ctx.ui?.has?.('identify')) {
        ctx.ui.open('identify', { mystery });
      } else if (!mystery) {
        softHint('Nothing to identify yet', 'Watch an unfamiliar bird for a moment, then press T.');
      }
    });

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
