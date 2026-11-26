// c-base: the Naturalist Cabin home base (screen 'base') and Finn's Field Supply
// (screen 'shop'). See docs/contract.md §5.3.
//
// Public API, published as ctx.base:
//   ctx.base.openBase(station?)  open the cabin on a station id (research, equipment,
//                                journal, photos, storage, upgrades, rest)
//   ctx.base.openShop(tab?)      open the shop on a tab (gear, supplies, upgrades)
// The server's `base` message opens the cabin automatically; the dialogue module opens
// the shop with ctx.ui.open('shop').
import { createBaseScreen } from './base-screen.js';
import { createShopScreen } from './shop-screen.js';

export default {
  name: 'base',
  init(ctx) {
    const base = createBaseScreen(ctx);
    const shop = createShopScreen(ctx);
    ctx.base = {
      openBase: (station) => ctx.ui.open('base', { station }),
      openShop: (tab) => ctx.ui.open('shop', { tab }),
      refresh: () => { base.render(); shop.render(); },
    };
  },
};
