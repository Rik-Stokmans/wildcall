// Screen "rankup" (overlay): the new naturalist rank ceremony (spec §7.2, §28 screen 12).
import { el, fill, button, ico, sound, screenFrame, confirmKey } from './shell.js';
import { rankView } from './rewardlogic.js';

const NS = 'http://www.w3.org/2000/svg';

/** SVG rank medal: a ribbon, a laurel ring and the rank number. */
function medal(rank) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 160 190'); svg.setAttribute('class', 'enc-medal'); svg.setAttribute('aria-hidden', 'true');
  const stars = '★'.repeat(Math.max(1, Math.min(5, rank)));
  svg.innerHTML = `
    <path d="M52 8h56l-6 78H58z" fill="var(--forest)"/><path d="M80 8h28l-6 78H80z" fill="var(--forest-deep)"/>
    <circle cx="80" cy="112" r="58" fill="var(--amber-soft)" stroke="var(--amber-deep)" stroke-width="5"/>
    <circle cx="80" cy="112" r="46" fill="var(--cream)" stroke="var(--amber)" stroke-width="2.5" stroke-dasharray="3 5"/>
    <path d="M44 116q-6-30 14-48M116 116q6-30-14-48" fill="none" stroke="var(--moss)" stroke-width="5" stroke-linecap="round"/>
    <text x="80" y="124" text-anchor="middle" font-family="var(--font-journal)" font-size="44" font-weight="700" fill="var(--forest-deep)">${rank}</text>
    <text x="80" y="146" text-anchor="middle" font-size="12" fill="var(--amber-deep)" letter-spacing="2">${stars}</text>`;
  return svg;
}

export function createRankUp(ctx) {
  const { state, ui, bus } = ctx;
  let data = null;
  const frame = screenFrame({ cls: 'enc-rankup', title: 'A New Rank', overlay: true });
  frame.card.classList.add('enc-card-narrow');

  function close() { sound(ctx, 'click'); ui.close('rankup'); }

  function facts(rankIndex) {
    const p = state.profile || {};
    const q = (state.ranks || []).find((r) => r.index === rankIndex + 1)?.reqQuest;
    return {
      questName: q ? state.quests[q]?.name : '', questDone: q ? ['complete', 'turned_in'].includes(p.quests?.[q]?.status) : false,
      level: p.level, species: Object.keys(p.journal?.species || {}).length,
      docs: Object.values(p.journal?.species || {}).filter((s) => s.level >= 5).length,
      rep: Object.values(p.rep || {}).reduce((a, b) => a + b, 0),
    };
  }

  function render() {
    const v = rankView(data?.rank | 0, state.ranks, facts(data?.rank | 0));
    frame.setTitle('Naturalist Rank', 'Your standing has grown');
    let n = 0;
    const d = () => ({ '--d': `${300 + (n++) * 110}ms` });
    fill(frame.body,
      el('div', { class: 'enc-medal-wrap' }, medal(v.rank), el('div', { class: 'enc-sparks big', 'aria-hidden': 'true' }, Array.from({ length: 18 }, (_, i) => el('span', { style: { '--i': i } })))),
      el('div', { class: 'enc-rank-kicker' }, 'You are now a'),
      el('div', { class: 'enc-rank-title' }, v.title),
      el('p', { class: 'enc-rank-desc' }, v.desc),
      v.unlocks.length || v.skillPoints ? el('div', { class: 'enc-section' }, el('h4', {}, 'Unlocked'),
        el('ul', { class: 'enc-lines' },
          v.skillPoints ? el('li', { style: d() }, ico('skillpoint', 16), el('span', {}, `${v.skillPoints} bonus skill points`)) : null,
          v.unlocks.map((u) => el('li', { style: d() }, ico('lock', 16), el('span', {}, u))))) : null,
      v.next ? el('div', { class: 'enc-next-rank' }, el('h4', {}, `Next: ${v.next.title}`),
        v.next.requirements.length ? el('ul', { class: 'enc-lines compact' }, v.next.requirements.map((r) => el('li', { class: r.met ? 'met' : '' }, ico(r.met ? 'check' : 'note', 14), el('span', {}, r.text),
          r.need > 1 ? el('em', {}, `${Math.min(r.have, r.need)} / ${r.need}`) : null))) : null) : el('div', { class: 'enc-next-rank' }, el('h4', {}, 'The highest rank'), el('p', {}, 'There is no higher title, only more to see.')));
    fill(frame.footer, el('div', { class: 'enc-foot-actions' },
      button('See my skills', { variant: 'secondary', icon: 'skillpoint', onClick: () => { sound(ctx, 'page'); ui.open('menu', { tab: 'skills' }); } }),
      button('Continue', { variant: 'primary', onClick: close })));
  }

  confirmKey(ctx, 'rankup', close);
  bus.on('profile', () => { if (ui.isOpen('rankup') && data) render(); });

  ui.register('rankup', {
    root: frame.root, overlay: true, closable: true,
    open(msg) { data = msg || {}; render(); sound(ctx, 'level'); },
  });
}
