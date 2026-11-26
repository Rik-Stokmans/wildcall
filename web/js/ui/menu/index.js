// WILDCALL menu module: the title screen ('mainmenu') and the in-game menu ('menu').
// Pure logic lives in logic.js / controls.js (unit-tested); everything else is DOM.
import { createMainMenu } from './mainmenu.js';
import { createGameMenu } from './gamemenu.js';

export default {
  name: 'menu',
  init(ctx) {
    // Shared between the two screens. `started` flips when play begins (or immediately
    // when the title screen is skipped with ?play=1).
    const session = { started: false };
    ctx.bus.on('game:start', () => { session.started = true; });

    const mainmenu = createMainMenu(ctx, session);
    const menu = createGameMenu(ctx, session);
    ctx.ui.register('mainmenu', mainmenu);
    ctx.ui.register('menu', menu);

    // Screens opened from the title screen (journal, map, menu...) REPLACE it in the screen
    // manager. Before play has started, closing one of them must bring the title screen back
    // or the player would be dropped into the world without having pressed Continue.
    // Deferred so that a screen replaced by another (journal -> identify) does not get the
    // title screen pushed over its successor.
    ctx.bus.on('ui:close', ({ name }) => {
      if (session.started || name === 'mainmenu') return;
      setTimeout(() => { if (!session.started && !ctx.ui.isOpen()) ctx.ui.open('mainmenu'); }, 0);
    });

    ctx.menu = {
      /** Open the in-game menu on a tab: 'character'|'skills'|'inventory'|'equipment'|'rank'|'settings'. */
      open(tab = 'character') { ctx.ui.open('menu', { tab }); },
    };
  },
};
