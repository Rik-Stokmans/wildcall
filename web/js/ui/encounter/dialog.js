// Screen "dialog": NPC conversation (spec §16, §28 screen 17).
// A large procedural portrait, a name/role plate, the NPC's standing with their faction,
// lines revealed one at a time (click / Space), then the choices. Quest offers show the
// quest's summary, objectives and rewards; turn-ins show what is being paid out.
import { progressBar, label } from '../kit.js';
import { el, fill, button, ico, sound, reducedMotion } from './shell.js';
import { drawPortrait } from './portrait.js';
import { dialogView, LineCursor, repTier, factionName } from './logic.js';
import { rewardLines, objectiveProgress } from './rewardlogic.js';

const CHAR_MS = 16;
const PENDING_TIMEOUT_MS = 4000;
const SHOP_SUPPRESS_MS = 5000; // a slow server echo must not pull the conversation back over the shop

export function createDialog(ctx) {
  const { state, net, bus, ui } = ctx;
  const S = { node: null, view: null, cursor: new LineCursor([]), shown: 0, typing: false, pending: false, shopAt: 0, npc: '' };
  let typeTimer = 0, pendingTimer = 0;
  const portraitCache = new Map();

  const portraitBox = el('div', { class: 'enc-portrait' });
  const plate = el('div', { class: 'enc-plate' });
  const repBox = el('div', { class: 'enc-rep' });
  const speech = el('div', { class: 'enc-speech' });
  const choicesBox = el('div', { class: 'enc-choices' });
  const questBox = el('div', { class: 'enc-quest-card' });
  const root = el('div', { class: 'enc-root enc-full enc-dialog' },
    el('div', { class: 'enc-backdrop' }),
    el('div', { class: 'enc-card enc-dialog-card' },
      el('div', { class: 'enc-dialog-left' }, portraitBox, plate, repBox),
      el('div', { class: 'enc-dialog-right' }, speech, questBox, choicesBox)));

  /* --------------------------------------------------------------- helpers */

  function npcDef() { return state.npcs[S.node?.npc] || null; }

  function renderPortrait() {
    const def = npcDef() || { id: S.node?.npc || 'npc', name: S.node?.name, look: {} };
    let canvas = portraitCache.get(def.id);
    if (!canvas) {
      try { canvas = drawPortrait(def); } catch (err) { console.warn('[encounter] portrait failed', err); canvas = el('div', { class: 'enc-portrait-canvas' }); }
      portraitCache.set(def.id, canvas);
    }
    fill(portraitBox, canvas);
    fill(plate,
      el('div', { class: 'enc-plate-name' }, S.node?.name || def.name || 'Someone'),
      el('div', { class: 'enc-plate-role' }, S.node?.role || def.role || ''));
    const faction = def.faction;
    if (!faction) return fill(repBox);
    const rep = S.node?.rep ?? state.profile?.rep?.[faction] ?? 0;
    const t = repTier(rep);
    const bar = progressBar(t.progress, 1, { height: 8 });
    bar.classList.add('enc-rep-bar');
    fill(repBox,
      el('div', { class: 'enc-rep-title' }, ico('reputation', 15), `${factionName(faction)}`),
      el('div', { class: 'enc-rep-tier' }, t.name, el('span', {}, ` · ${rep}`)),
      bar,
      el('div', { class: 'enc-rep-next' }, t.next ? `Next: ${t.next} at ${t.nextMin}` : 'Fully trusted'));
  }

  /* ------------------------------------------------------------ speech text */

  function stopTyping() { clearInterval(typeTimer); typeTimer = 0; S.typing = false; }

  function startLine() {
    stopTyping();
    const text = S.cursor.current;
    if (!text) { S.shown = 0; return renderSpeech(); }
    if (reducedMotion()) { S.shown = text.length; return renderSpeech(); }
    S.shown = 0; S.typing = true;
    typeTimer = setInterval(() => {
      S.shown = Math.min(text.length, S.shown + 2);
      if (S.shown >= text.length) { stopTyping(); renderSpeech(); renderChoices(); } else renderSpeechText();
    }, CHAR_MS);
    renderSpeech();
  }

  function renderSpeechText() {
    const t = speech.querySelector('.enc-line-text');
    if (t) t.textContent = S.cursor.current.slice(0, S.shown);
  }

  function renderSpeech() {
    if (!S.view || S.view.lines.length === 0) return fill(speech);
    const text = S.cursor.current;
    const more = !S.cursor.atEnd;
    const done = !S.typing;
    fill(speech,
      el('div', { class: 'enc-bubble', role: 'button', tabindex: 0, onclick: advance },
        el('div', { class: 'enc-line-text' }, text.slice(0, S.shown)),
        el('div', { class: 'enc-advance' + (done && more ? ' show' : '') }, more ? 'Click or press Space to continue' : '', more ? ico('forward', 14) : null),
        S.view.lines.length > 1 ? el('div', { class: 'enc-dots', 'aria-hidden': 'true' }, S.view.lines.map((_, i) => el('i', { class: i === S.cursor.index ? 'on' : i < S.cursor.index ? 'past' : '' }))) : null));
  }

  function advance() {
    if (!S.view) return;
    if (S.typing) { S.shown = S.cursor.current.length; stopTyping(); renderSpeech(); renderChoices(); return; }
    if (S.cursor.advance()) { sound(ctx, 'page'); startLine(); renderChoices(); }
  }

  /* --------------------------------------------------------- quest + choices */

  function renderQuest() {
    const n = S.node;
    const def = n?.quest ? state.quests[n.quest] : null;
    const reward = n?.rewards || def?.rewards;
    const showCard = S.cursor.atEnd && !S.typing && (def || n?.rewards);
    questBox.hidden = !showCard;
    if (!showCard) return fill(questBox);
    const qs = state.profile?.quests?.[def?.id];
    const lines = rewardLines(reward, state.items, { regions: state.regions, quests: state.quests, collectibles: state.collectibles });
    fill(questBox,
      def ? el('div', { class: 'enc-quest-head' }, ico('quest', 18), el('div', {},
        el('div', { class: 'enc-quest-name' }, def.name), el('div', { class: 'enc-quest-cat' }, label(def.category)))) : el('div', { class: 'enc-quest-head' }, ico('xp', 18), el('div', { class: 'enc-quest-name' }, 'Your reward')),
      def?.summary ? el('p', { class: 'enc-quest-summary' }, def.summary) : null,
      def?.story && qs?.status !== 'active' && qs?.status !== 'complete' && qs?.status !== 'turned_in'
        ? el('p', { class: 'enc-quest-story' }, def.story) : null,
      def?.objectives?.length ? el('ul', { class: 'enc-objectives' }, def.objectives.map((o) => {
        const p = objectiveProgress(o, qs);
        return el('li', { class: p.done ? 'done' : '' }, ico(p.done ? 'check' : 'note', 14), el('span', {}, o.text), p.need > 1 ? el('em', {}, `${p.have}/${p.need}`) : null);
      })) : null,
      lines.length ? el('div', { class: 'enc-reward-lines' }, el('span', { class: 'enc-reward-title' }, qs?.status === 'turned_in' ? 'Paid out' : 'Reward'),
        lines.map((l) => el('span', { class: 'enc-pill' }, ico(l.icon, 15), l.text))) : null);
  }

  function renderChoices() {
    renderQuest();
    const ready = S.view && S.cursor.atEnd && !S.typing;
    choicesBox.hidden = !ready || S.view.choices.length === 0;
    if (choicesBox.hidden) return fill(choicesBox);
    fill(choicesBox, S.view.choices.map((c, i) => {
      const variant = c.kind === 'accept' || c.kind === 'turnin' ? 'primary' : c.kind === 'decline' || c.kind === 'bye' ? 'ghost' : 'secondary';
      const b = button(c.text, { variant, icon: c.kind === 'shop' ? 'shop' : c.kind === 'turnin' ? 'check' : c.kind === 'accept' ? 'quest' : undefined, disabled: S.pending, onClick: () => choose(c) });
      b.classList.add('enc-choice', 'kind-' + c.kind);
      b.prepend(el('span', { class: 'enc-choice-key' }, String(i + 1)));
      return b;
    }));
  }

  function choose(c) {
    if (S.pending || !S.node) return;
    sound(ctx, c.kind === 'accept' || c.kind === 'turnin' ? 'reward' : 'click');
    net.send('dialogChoice', { npc: S.node.npc, choice: c.id });
    if (c.kind === 'bye') { ui.close('dialog'); return; }
    S.pending = true;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { S.pending = false; if (ui.isOpen('dialog')) renderChoices(); }, PENDING_TIMEOUT_MS);
    if (c.kind === 'shop') { S.shopAt = Date.now(); ui.open('shop'); return; }
    renderChoices();
  }

  /* ----------------------------------------------------------------- opening */

  /** Show a node. Keeps the current line position when the same node is re-rendered. */
  function show(node, fresh) {
    const view = dialogView(node);
    S.node = node; S.view = view;
    if (fresh) {
      S.cursor = new LineCursor(view.lines);
      S.pending = false; clearTimeout(pendingTimer);
    }
    renderPortrait();
    if (fresh) startLine(); else renderSpeech();
    renderChoices();
  }

  // Space / Enter advance the conversation; 1-9 pick a choice.
  window.addEventListener('keydown', (e) => {
    if (ui.top !== 'dialog' || e.repeat) return;
    if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') return; // let the focused button click itself
      e.preventDefault(); e.stopPropagation(); advance();
    } else if (/^Digit[1-9]$/.test(e.code) && S.view && S.cursor.atEnd && !S.typing) {
      const c = S.view.choices[Number(e.code.slice(5)) - 1];
      if (c) { e.preventDefault(); e.stopPropagation(); choose(c); }
    }
  }, true);

  // Escape: the screen is registered non-closable (so it cannot be dismissed mid-offer);
  // allow it once the conversation offers a way out.
  bus.on('action:escape', () => {
    if (ui.top === 'dialog' && S.view?.canEscape) { sound(ctx, 'close'); ui.close('dialog'); }
  });

  bus.on('profile', () => { if (ui.isOpen('dialog') && S.node) { renderPortrait(); renderQuest(); } });

  ui.register('dialog', {
    root,
    overlay: false,
    closable: false,
    open(node) {
      if (!node || typeof node !== 'object') return;
      show(node, true);
      sound(ctx, 'open');
    },
    close() { stopTyping(); clearTimeout(pendingTimer); S.pending = false; S.node = null; S.view = null; },
  });

  return {
    /** Handle a server `dialog` node: empty closes, otherwise (re)opens. */
    receive(node) {
      const v = dialogView(node);
      if (v.empty) { if (ui.isOpen('dialog')) ui.close('dialog'); return; }
      // A shop choice already moved on to the shop; ignore the conversation's echo.
      if (Date.now() - S.shopAt < SHOP_SUPPRESS_MS && ui.isOpen('shop')) return;
      ui.open('dialog', node);
    },
  };
}
