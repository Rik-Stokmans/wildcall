// WILDCALL encounter module: the identification screen, NPC dialogue and the four
// "moment" overlays (rewards, rare item, region discovery, rank-up).
//
// Screens (names pinned in docs/contract.md §5.3): identify, dialog, rewards, rareitem,
// region, rankup. Server messages that open them: net:dialog, net:rewards, net:rareItem,
// net:region, net:rankUp. Several overlays arriving together are queued and shown one
// after another (OverlayQueue).
//
// Public API (ctx.encounter):
//   openIdentify(mysteryOrId?, extra?)  open the identification screen; with no argument it
//                                       uses the bird currently under observation
//   showOverlay(name, data)             queue an overlay screen ('rewards'|'rareitem'|'region'|'rankup')
//   lastSighting                        latest net:sighting with a bird (or null)
import { createIdentify } from './identify.js';
import { createDialog } from './dialog.js';
import { createRewards } from './rewards.js';
import { createRareItem } from './rareitem.js';
import { createRegion } from './region.js';
import { createRankUp } from './rankup.js';
import { OverlayQueue } from './logic.js';

const OVERLAYS = new Set(['rewards', 'rareitem', 'region', 'rankup']);
/** Pause between queued overlays so each one lands on its own beat. */
const GAP_MS = 260;

export default {
  name: 'encounter',
  init(ctx) {
    const { bus, ui, state } = ctx;
    const guard = (what, fn) => { try { fn(); } catch (err) { console.error(`[encounter] ${what} failed`, err); } };

    guard('identify', () => createIdentify(ctx));
    const dialog = (() => { try { return createDialog(ctx); } catch (err) { console.error('[encounter] dialog failed', err); return null; } })();
    guard('rewards', () => createRewards(ctx));
    guard('rareitem', () => createRareItem(ctx));
    guard('region', () => createRegion(ctx));
    guard('rankup', () => createRankUp(ctx));

    /* ---- overlay queue --------------------------------------------------- */
    const queue = new OverlayQueue();
    let timer = 0;

    function present(entry) {
      if (!entry) return;
      if (!ui.open(entry.name, entry.data)) showNext(queue.finish(entry.name));
    }
    function showNext(entry) {
      clearTimeout(timer);
      if (entry) timer = setTimeout(() => present(entry), GAP_MS);
    }
    function showOverlay(name, data) {
      if (!ui.has(name)) return;
      const entry = queue.push(name, data);
      if (entry) present(entry);
    }
    bus.on('ui:close', ({ name }) => { if (OVERLAYS.has(name)) showNext(queue.finish(name)); });

    bus.on('net:rewards', (m) => showOverlay('rewards', m));
    bus.on('net:rareItem', (m) => showOverlay('rareitem', m));
    bus.on('net:region', (m) => showOverlay('region', m));
    bus.on('net:rankUp', (m) => showOverlay('rankup', m));
    bus.on('net:dialog', (node) => dialog?.receive(node));

    /* ---- identification entry point --------------------------------------- */
    let lastSighting = null;
    bus.on('net:sighting', (s) => { lastSighting = s && s.bird ? s : null; });

    function openIdentify(target, extra = {}) {
      let mystery = target;
      let sighting = extra.sighting || null;
      if (!mystery) {
        sighting = sighting || lastSighting;
        if (!sighting || !sighting.bird) {
          bus.emit('toast', { kind: 'info', title: 'Nothing in view', text: 'Raise your binoculars on a bird and watch it for a moment first.' });
          return false;
        }
        if (sighting.known) {
          const sp = state.speciesById[sighting.known];
          bus.emit('toast', { kind: 'info', title: sp ? `You know this one: ${sp.name}` : 'You already know this bird', text: 'It is already in your journal.' });
          return false;
        }
        mystery = sighting.mystery;
        if (!mystery) {
          bus.emit('toast', { kind: 'info', title: 'Keep watching', text: 'Give it a moment longer before you try to name it.' });
          return false;
        }
      }
      return ui.open('identify', { mystery, sighting });
    }

    // T: identify the bird under observation (also closes the screen again).
    bus.on('action:identify', () => {
      if (ui.isOpen('identify')) { ui.close('identify'); return; }
      if (state.mode !== 'play') return;
      openIdentify();
    });

    ctx.encounter = {
      openIdentify,
      showOverlay,
      get lastSighting() { return lastSighting; },
    };
  },
};
