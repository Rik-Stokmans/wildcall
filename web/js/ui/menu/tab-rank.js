// Rank tab: the five-rank ladder and the next rank's requirements with progress bars.
import { el, icon, progressBar } from '../kit.js';
import * as L from './logic.js';
import { section, note } from './common.js';

export function renderRank(ctx) {
  const { state } = ctx;
  const p = state.profile;
  if (!p || !state.ranks.length) return el('div', { class: 'menu-empty' }, 'Rank information is not available yet.');
  const cur = p.rank || 1;
  const next = L.nextRank(state.ranks, p);

  const ladder = el('ol', { class: 'menu-ladder' }, state.ranks.map((r) => {
    const status = r.index < cur ? 'done' : r.index === cur ? 'current' : 'future';
    return el('li', { class: 'menu-rung ' + status },
      el('span', { class: 'menu-rung-badge' }, status === 'done' ? icon('check', 16) : String(r.index)),
      el('div', { class: 'menu-rung-text' },
        el('div', { class: 'menu-rung-title' }, r.title, status === 'current' ? el('span', { class: 'menu-tag purchased' }, 'You are here') : null),
        el('div', { class: 'menu-faint' }, r.desc)));
  }));

  let right;
  if (next) {
    const rows = L.rankProgress(next, p, state.quests);
    const overall = L.rankFraction(rows);
    right = el('div', { class: 'menu-card menu-next-rank' },
      el('div', { class: 'menu-faint' }, 'Next rank'),
      el('h2', { class: 'menu-detail-title' }, el('span', { class: 'menu-rank-badge big' }, icon('rank', 18), next.title)),
      el('p', { class: 'menu-desc' }, next.desc),
      progressBar(overall, 1, { height: 10 }),
      section('Requirements', el('ul', { class: 'menu-reqlist' }, rows.map(reqRow))),
      section('What it opens up',
        el('ul', { class: 'menu-list' },
          next.skillPoints ? el('li', `${next.skillPoints} bonus skill points`) : null,
          (next.unlocks || []).map((t) => el('li', t)))));
  } else {
    right = el('div', { class: 'menu-card menu-next-rank' },
      el('h2', { class: 'menu-detail-title' }, 'The highest rank'),
      note('You have become a Master Naturalist. The forest has plenty left to teach, and plenty left to hide.'));
  }

  return el('div', { class: 'menu-cols menu-rank' },
    el('div', { class: 'menu-col menu-col-narrow', 'data-scroll': 'rank-l' }, section('The path of a naturalist', ladder)),
    el('div', { class: 'menu-col', 'data-scroll': 'rank-r' }, right));
}

function reqRow(r) {
  const quest = r.id === 'quest';
  const statusText = r.status === 'complete' ? 'Ready to hand in' : r.status === 'active' ? 'In progress' : r.status === 'turned_in' ? 'Complete' : 'Not started';
  return el('li', { class: 'menu-req' + (r.done ? ' done' : '') },
    el('div', { class: 'menu-req-head' },
      icon(r.done ? 'check' : quest ? 'quest' : 'star', 14),
      el('span', quest ? `Quest: ${r.label}` : r.label),
      el('b', quest ? statusText : `${L.formatNumber(Math.min(r.have, r.need))} / ${L.formatNumber(r.need)}`)),
    progressBar(r.fraction, 1, { height: 8 }));
}
