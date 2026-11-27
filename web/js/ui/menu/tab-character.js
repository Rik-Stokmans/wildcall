// Character tab: level, XP, rank, skill points, credits, reputation, next unlocks,
// lifetime totals and the derived-stats readout.
import { el, icon, button, progressBar, STAT_INFO, formatStat, label } from '../kit.js';
import * as L from './logic.js';
import { stat } from './common.js';

const GROUP_NAMES = {
  optics: 'Binoculars', camera: 'Camera', audio: 'Listening & recording',
  backpack: 'Pack', field: 'In the field',
};

export function renderCharacter(ctx, st) {
  const { state } = ctx;
  const p = state.profile;
  if (!p) return el('div', { class: 'menu-empty' }, 'Your field notes are still being gathered.');
  const rank = L.currentRank(state.ranks, p);
  const next = L.nextRank(state.ranks, p);

  // --- left column: identity ------------------------------------------------
  const levelCard = el('div', { class: 'menu-card menu-hero' },
    el('div', { class: 'menu-hero-level' },
      el('span', { class: 'menu-hero-lv' }, 'Level'), el('span', { class: 'menu-hero-num' }, p.level || 1)),
    el('div', { class: 'menu-hero-body' },
      el('div', { class: 'menu-hero-name' }, p.name || 'Naturalist'),
      el('div', { class: 'menu-rank-badge' }, icon('rank', 16), rank?.title || 'Beginner'),
      progressBar(p.xp || 0, p.xpNext || 1, { height: 12 }),
      el('div', { class: 'menu-xp-line' },
        el('span', `${L.formatNumber(p.xp)} / ${L.formatNumber(p.xpNext)} XP`),
        el('span', { class: 'menu-faint' }, `${L.formatNumber(p.xpTotal)} total`))));

  const points = p.skillPoints || 0;
  const pointsRow = el('div', { class: 'menu-card menu-points' + (points > 0 ? ' has' : '') },
    icon('skillpoint', 22),
    el('div', { class: 'menu-points-text' },
      el('strong', `${points} unspent skill point${points === 1 ? '' : 's'}`),
      el('span', { class: 'menu-faint' }, points > 0 ? 'Choose where your craft grows next.' : 'Every level earns another.')),
    button('Open skills', { small: true, variant: points > 0 ? 'primary' : 'secondary', onClick: () => st.goTab('skills') }));

  const credits = el('div', { class: 'menu-card menu-credits' },
    icon('credits', 22), el('div', { class: 'menu-credits-text' }, el('div', { class: 'menu-faint' }, 'Field Credits'),
      el('div', { class: 'menu-credits-num' }, L.formatNumber(p.credits))),
    button('Ledger', { small: true, variant: 'ghost', onClick: () => st.goTab('credits') }));

  const factions = [...new Set([...Object.keys(L.FACTION_NAMES), ...Object.keys(p.rep || {})])];
  const repCard = el('div', { class: 'menu-card' },
    el('h3', { class: 'menu-h3' }, icon('reputation', 16), 'Reputation'),
    el('div', { class: 'menu-rep' }, factions.map((f) => {
      const v = p.rep?.[f] || 0;
      return el('div', { class: 'menu-rep-row' },
        el('span', L.FACTION_NAMES[f] || label(f)),
        progressBar(v, Math.max(100, Math.ceil(v / 50) * 50), { height: 8 }),
        el('b', String(v)));
    })));

  // --- right column: unlocks, totals, stats ----------------------------------
  const un = L.nextUnlocks(p, state.ranks);
  const unlocks = el('div', { class: 'menu-card' },
    el('h3', { class: 'menu-h3' }, icon('level', 16), 'Next unlocks'),
    el('ul', { class: 'menu-list' }, un.level.map((t) => el('li', t))),
    next ? el('div', { class: 'menu-unlock-rank' },
      el('div', { class: 'menu-faint' }, `At the rank of ${next.title}`),
      el('ul', { class: 'menu-list' }, un.rank.length ? un.rank.map((t) => el('li', t)) : el('li', 'New opportunities in the field.')),
      button('See requirements', { small: true, variant: 'ghost', onClick: () => st.goTab('rank') })) : null);

  const t = p.totals || {};
  const totals = el('div', { class: 'menu-card' },
    el('h3', { class: 'menu-h3' }, icon('journal', 16), 'Field record'),
    el('div', { class: 'menu-totals' },
      stat('Species identified', L.speciesIdentified(p)),
      stat('Species documented', L.speciesDocumented(p)),
      stat('Places discovered', Object.keys(p.journal?.locations || {}).length),
      stat('Rare discoveries', (p.journal?.rare || []).length),
      stat('Photographs', t.photos || 0),
      stat('Recordings', t.recordings || 0),
      stat('Distance walked', L.formatDistance(t.distance)),
      stat('Time afield', L.formatDuration(t.seconds)),
      stat('Birds startled', t.flushed || 0)));

  const groups = L.groupStats(state.stats, STAT_INFO);
  const stats = el('div', { class: 'menu-card' },
    el('h3', { class: 'menu-h3' }, icon('info', 16), 'Your abilities'),
    el('div', { class: 'menu-statgrid' }, groups.map((g) => el('div', { class: 'menu-statgroup' },
      el('div', { class: 'menu-statgroup-title' }, GROUP_NAMES[g.group] || label(g.group)),
      g.rows.map((r) => el('div', { class: 'menu-statrow' },
        el('span', r.info.label), el('b', formatStat(r.key, r.value))))))));

  return el('div', { class: 'menu-cols menu-character' },
    el('div', { class: 'menu-col menu-col-narrow', 'data-scroll': 'char-l' }, levelCard, pointsRow, credits, repCard),
    el('div', { class: 'menu-col', 'data-scroll': 'char-r' }, unlocks, totals, stats));
}
