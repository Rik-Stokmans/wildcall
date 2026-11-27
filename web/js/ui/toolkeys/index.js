// Equipment key hints (module toolkeys): a compact legend beside the tool slots that
// tells the player what the instrument in hand does, with real keycaps and mouse
// pictograms; and the full "Field controls" reference card for the menu / tutorial.
//
// Public API (ctx.toolkeys):
//   referenceCard(opts?) → HTMLElement   opts {title?: string|false, plain?: bool}
//   legend → the current legend model (legend.js legendFor)
//
// DOM is written only when the content or the visibility state changes; update(dt)
// just advances the pure visibility machine.
import { el, fill } from '../kit.js';
import { legendFor, legendSignature } from './legend.js';
import { LegendVisibility } from './visibility.js';
import { panelChildren, lineChildren, referenceCard } from './view.js';

const OPTICS = new Set(['binoculars', 'camera']);
const REC_PANEL_BOTTOM = 150;   // css/tools.css .tool-rec bottom
const REC_PANEL_GUESS = 120;   // its usual height, until it can be measured
const GAP = 12;

const carries = (profile, item) => !!profile?.inventory?.some((s) => s && s.item === item && (s.qty ?? 1) > 0);

let st = null;

export default {
  name: 'toolkeys',

  init(ctx) {
    const { bus, state } = ctx;
    const panel = el('div', { class: 'tk-panel' });
    const line = el('div', { class: 'tk-line' });
    const root = el('div', { class: 'tk-root', 'aria-hidden': 'true', dataset: { show: 'hidden', strength: 'rest', tool: 'none' } }, panel, line);
    document.body.appendChild(root);

    const vis = new LegendVisibility();
    st = {
      ctx, root, panel, line, vis,
      tool: 'none', raised: false, recording: false, focus: false,
      toolSig: '', contentSig: '', viewSig: '', legend: null, recBottom: '', nextAt: 0,
    };

    const now = () => ctx.time;

    function refreshContent() {
      const p = state.profile;
      const lg = legendFor({
        tool: st.tool, raised: st.raised, recording: st.recording,
        equipped: p?.equipped, seed: carries(p, 'seed_mix'), film: p?.film,
      });
      st.legend = lg;
      const sig = legendSignature(lg);
      if (sig === st.contentSig) return;
      st.contentSig = sig;
      fill(panel, panelChildren(lg));
      fill(line, lineChildren(lg));
      root.dataset.tool = lg.tool;
      root.dataset.state = lg.state;
    }

    // The recorder's own panel (tools.css .tool-rec, right/bottom) sits where the
    // legend normally is: stack the legend above it. A layout read on tool change only.
    // The overlay shows its panel on its next frame, so measure again one frame later.
    function place(retry = true) {
      let bottom = '';
      if (st.tool === 'recorder') {
        const rec = document.querySelector('#tool-overlay .tool-rec');
        const h = rec ? rec.offsetHeight : 0;
        bottom = (REC_PANEL_BOTTOM + (h > 0 ? h : REC_PANEL_GUESS) + GAP) + 'px';
        if (retry) requestAnimationFrame(() => requestAnimationFrame(() => place(false)));
      }
      if (bottom !== st.recBottom) { st.recBottom = bottom; panel.style.bottom = bottom; }
    }

    function onToolState() {
      const t = ctx.tools;
      const active = t?.active || 'none';
      const raised = OPTICS.has(active) && !!t?.raised;
      const recording = active === 'recorder' && !!t?.recording;
      const sig = `${active}:${raised}:${recording}`;
      st.tool = active; st.raised = raised; st.recording = recording;
      const changed = sig !== st.toolSig;
      if (changed) { st.toolSig = sig; vis.change(now()); }
      refreshContent();
      if (changed) place();
      render();
    }

    function render() {
      const v = vis.view({
        now: now(), mode: state.mode, hints: state.settings?.hints !== false,
        tool: st.tool, raised: st.raised, focus: st.focus,
      });
      st.nextAt = now() + vis.nextEdge(now());
      const sig = v.show + ':' + v.strength;
      if (sig === st.viewSig) return;
      st.viewSig = sig;
      root.dataset.show = v.show;
      root.dataset.strength = v.strength;
    }
    st.render = render;

    bus.on('tool', onToolState);
    bus.on('profile', () => { refreshContent(); });
    bus.on('focus', ({ on }) => { st.focus = !!on; render(); });
    bus.on('mode', ({ mode, prev }) => {
      // Stepping into the field from the title screen counts as a fresh start.
      if (mode === 'play' && (prev === 'mainmenu' || prev === 'boot')) vis.change(now());
      render();
    });
    bus.on('game:start', () => { vis.change(now()); render(); });
    bus.on('settings', ({ key }) => { if (key === 'hints') render(); });
    bus.on('resize', () => { if (st.tool === 'recorder') { st.recBottom = null; place(); } });
    const use = () => { if (st.tool !== 'none') vis.used(now()); };
    bus.on('mouse:down', use);
    bus.on('mouse:wheel', use);

    ctx.toolkeys = {
      referenceCard: (opts) => referenceCard(opts),
      get legend() { return st.legend; },
    };
    refreshContent();
    render();
  },

  update() {
    // Pure timers only; render() touches the DOM only when the view changes.
    if (st && st.ctx.time >= st.nextAt) st.render();
  },
};
