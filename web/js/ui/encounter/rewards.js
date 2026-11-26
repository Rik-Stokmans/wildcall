// Screen "rewards" (overlay): the Rewards screen (spec §28 screen 14): XP count-up, credits,
// items, reputation, skill points, journal updates and a level-up flourish.
import { itemCard } from '../kit.js';
import { el, fill, button, ico, sound, screenFrame, confirmKey, reducedMotion } from './shell.js';
import { rewardSummary, countUp } from './rewardlogic.js';

const COUNT_MS = 1200;

export function createRewards(ctx) {
  const { state, ui, bus } = ctx;
  let data = null, raf = 0;
  const frame = screenFrame({ cls: 'enc-rewards', title: 'Rewards', overlay: true });
  frame.card.classList.add('enc-card-narrow');

  function close() { sound(ctx, 'click'); ui.close('rewards'); }

  function stat(kind, iconName, labelText, target) {
    const num = el('span', { class: 'enc-stat-num' }, '0');
    return { num, target, node: el('div', { class: `enc-stat kind-${kind}` }, el('div', { class: 'enc-stat-icon' }, ico(iconName, 26)), num, el('div', { class: 'enc-stat-label' }, labelText)) };
  }

  function render(animate) {
    const s = rewardSummary(data, state.items);
    frame.setTitle(s.title, s.subtitle);
    cancelAnimationFrame(raf);
    const stats = [];
    if (s.xp) stats.push(stat('xp', 'xp', 'Experience', s.xp));
    if (s.credits) stats.push(stat('credits', 'credits', 'Field Credits', s.credits));
    if (s.skillPoints) stats.push(stat('skill', 'skillpoint', s.skillPoints === 1 ? 'Skill point' : 'Skill points', s.skillPoints));
    let n = 0;
    const delay = () => ({ '--d': `${(n++) * 90}ms` });
    fill(frame.body,
      s.levelUp ? el('div', { class: 'enc-levelup' },
        el('div', { class: 'enc-levelup-burst', 'aria-hidden': 'true' }, Array.from({ length: 16 }, (_, i) => el('span', { style: { '--i': i } }))),
        el('div', { class: 'enc-levelup-small' }, 'Level up'), el('div', { class: 'enc-levelup-num' }, String(s.levelUp)),
        el('div', { class: 'enc-levelup-note' }, 'Your skills and instincts sharpen.')) : null,
      stats.length ? el('div', { class: 'enc-stats' }, stats.map((x) => { x.node.style.setProperty('--d', `${(n++) * 90}ms`); return x.node; })) : null,
      s.items.length ? el('div', { class: 'enc-section' },
        el('h4', {}, s.items.length === 1 ? 'New item' : 'New items'),
        el('div', { class: 'enc-items' }, s.items.map((it) => el('div', { class: 'enc-item-wrap', style: delay() }, itemCard(it.def || { name: String(it.id).replace(/_/g, ' '), rarity: 0, icon: 'backpack' }))))) : null,
      s.rep.length ? el('div', { class: 'enc-section' }, el('h4', {}, 'Reputation'),
        el('ul', { class: 'enc-lines' }, s.rep.map((r) => el('li', { style: delay() }, ico('reputation', 16), el('span', {}, r.label), el('b', { class: r.amount < 0 ? 'neg' : '' }, `${r.amount > 0 ? '+' : ''}${r.amount}`))))) : null,
      s.journal.length ? el('div', { class: 'enc-section' }, el('h4', {}, 'Journal updates'),
        el('ul', { class: 'enc-lines' }, s.journal.map((j) => el('li', { style: delay() }, ico('journal', 16), el('span', {}, j))))) : null,
      s.isEmpty ? el('p', { class: 'enc-empty' }, 'Nothing new this time, but every walk teaches you something.') : null);
    fill(frame.footer, el('div', { class: 'enc-foot-actions' }, button('Continue', { variant: 'primary', onClick: close })));

    const finalize = () => { for (const x of stats) x.num.textContent = x.target.toLocaleString(); };
    if (!animate || reducedMotion() || !stats.length) return finalize();
    const t0 = performance.now();
    const tick = (now) => {
      const el_ = now - t0;
      for (const x of stats) x.num.textContent = countUp(el_, COUNT_MS, x.target).toLocaleString();
      if (el_ < COUNT_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  confirmKey(ctx, 'rewards', close);
  bus.on('profile', () => { if (ui.isOpen('rewards') && data) render(false); });

  ui.register('rewards', {
    root: frame.root,
    overlay: true,
    closable: true,
    open(msg) {
      data = msg || {};
      render(true);
      const s = rewardSummary(data, state.items);
      sound(ctx, s.levelUp ? 'level' : 'reward');
      if (s.credits > 0) setTimeout(() => sound(ctx, 'coin'), 500);
    },
    close() { cancelAnimationFrame(raf); },
  });
}
