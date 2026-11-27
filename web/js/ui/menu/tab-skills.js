// Skills tab: five discipline columns, seven nodes each laid out by tier with requirement
// bands between tiers, and a details pane with a Buy button.
import { el, icon, button, STAT_INFO, formatMod, statIsGood } from '../kit.js';
import * as L from './logic.js';
import { pips, section, note, sfx } from './common.js';

export function renderSkills(ctx, st) {
  const { state, net } = ctx;
  const p = state.profile;
  if (!p || !state.disciplines.length) return el('div', { class: 'menu-empty' }, 'The skill tree is not available yet.');
  const env = { tiers: state.skillTiers, skills: state.skills, ranks: state.ranks, disciplines: state.disciplines };

  // Default selection: the first thing the player could buy, else the first skill.
  const all = Object.values(state.skills);
  if (!st.skillId || !state.skills[st.skillId]) {
    st.skillId = (all.find((s) => L.skillState(s, p, env).canBuy) || all[0])?.id;
  }

  const select = (id) => { st.skillId = id; sfx(ctx, 'click'); st.rerender(); };

  const columns = state.disciplines.map((d) => {
    const invested = L.pointsInDiscipline(p, state.skills, d.id);
    const counts = L.disciplineCounts(p, state.skills, d.id);
    const layout = L.disciplineLayout(state.skills, d.id, state.skillTiers);
    const col = el('div', { class: 'menu-disc', style: { '--disc': d.color || 'var(--forest)' } },
      el('header', { class: 'menu-disc-head' },
        el('span', { class: 'menu-disc-icon' }, icon(d.icon || d.id, 22)),
        el('div', { class: 'menu-disc-titles' },
          el('div', { class: 'menu-disc-name', title: d.name }, d.name),
          el('div', { class: 'menu-disc-title' }, d.title,
            el('span', { class: 'menu-disc-points', title: `${counts.learned} of ${counts.total} skills learned` },
              ` · ${invested} pt${invested === 1 ? '' : 's'}`)))),
      el('div', { class: 'menu-disc-tiers' }, layout.map((t) => {
        const req = t.req;
        const met = invested >= req.points && (p.rank || 1) >= req.rank;
        return el('div', { class: 'menu-tier' + (met ? ' met' : '') },
          el('div', { class: 'menu-band', title: req.label || '' },
            icon(met ? 'check' : 'lock', 12),
            el('span', { class: 'menu-band-tier' }, roman(t.tier)),
            el('span', { class: 'menu-band-req' }, L.tierRequirementText(req, d.name, state.ranks))),
          t.skills.map((s) => skillNode(s, L.skillState(s, p, env), st.skillId === s.id, () => select(s.id))));
      })));
    return col;
  });

  return el('div', { class: 'menu-skills' },
    el('div', { class: 'menu-skills-main' },
      el('div', { class: 'menu-skills-top' },
        el('span', { class: 'menu-pill amber' }, icon('skillpoint', 14), `${p.skillPoints || 0} skill point${p.skillPoints === 1 ? '' : 's'} to spend`),
        note('Each discipline opens up as you invest points in it.')),
      el('div', { class: 'menu-discs', 'data-scroll': 'skills' }, columns)),
    el('aside', { class: 'menu-detail', 'data-scroll': 'skill-detail' }, skillDetail(ctx, st, env)));
}

function roman(n) { return ['', 'I', 'II', 'III', 'IV'][n] || String(n); }

function skillNode(skill, s, selected, onClick) {
  return el('button', {
    class: `menu-node ${s.state}${s.maxed ? ' maxed' : ''}${s.canBuy ? ' buyable' : ''}${selected ? ' selected' : ''}`,
    type: 'button', onclick: onClick, title: skill.name,
  },
  el('span', { class: 'menu-node-icon' }, icon(s.state === 'locked' ? 'lock' : (skill.icon || 'star'), 18)),
  el('span', { class: 'menu-node-name' }, skill.name),
  s.maxRank > 1 || s.rank > 0 ? pips(s.rank, s.maxRank) : null);
}

function skillDetail(ctx, st, env) {
  const { state, net } = ctx;
  const p = state.profile;
  const skill = state.skills[st.skillId];
  if (!skill) return note('Select a skill to read about it.');
  const s = L.skillState(skill, p, env);
  const d = state.disciplines.find((x) => x.id === skill.discipline);
  const stateText = s.maxed ? 'Mastered' : s.state === 'purchased' ? 'Learned' : s.state === 'available' ? 'Available' : 'Locked';

  const req = L.tierRequirement(state.skillTiers, skill.tier);
  const reqRows = [];
  if (req.points > 0) reqRows.push(reqRow(s.pointsHave >= req.points, `${req.points} points in ${d?.name || skill.discipline}`, `${Math.min(s.pointsHave, req.points)} / ${req.points}`));
  if (req.rank > 1) reqRows.push(reqRow((p.rank || 1) >= req.rank, `Rank of ${state.ranks.find((r) => r.index === req.rank)?.title || req.rank}`, ''));
  if (!reqRows.length) reqRows.push(reqRow(true, 'Open to everyone', ''));
  if (!s.maxed) reqRows.push(reqRow((p.skillPoints || 0) >= s.cost, `${s.cost} skill point${s.cost === 1 ? '' : 's'}`, `${p.skillPoints || 0} available`));

  const mods = Object.entries(skill.mods || {}).filter(([k, v]) => v && STAT_INFO[k]);

  const buy = button(s.maxed ? 'Fully learned' : s.rank > 0 ? `Improve (${s.cost} pt${s.cost === 1 ? '' : 's'})` : `Learn (${s.cost} pt${s.cost === 1 ? '' : 's'})`, {
    variant: 'primary', icon: s.maxed ? 'check' : 'skillpoint', disabled: !s.canBuy,
    title: s.reason || '',
    onClick: () => { sfx(ctx, 'equip'); net.send('skill', { id: skill.id }); },
  });

  return el('div', { class: 'menu-detail-inner', style: { '--disc': d?.color || 'var(--forest)' } },
    el('div', { class: 'menu-detail-head' },
      el('span', { class: 'menu-disc-icon big' }, icon(skill.icon || d?.icon || 'star', 30)),
      el('div',
        el('h2', { class: 'menu-detail-title' }, skill.name),
        el('div', { class: 'menu-faint' }, `${d?.name || ''} · Tier ${roman(skill.tier)}`))),
    el('div', { class: 'menu-detail-state' }, el('span', { class: 'menu-tag ' + s.state }, stateText), pips(s.rank, s.maxRank),
      el('span', { class: 'menu-faint' }, `Rank ${s.rank} of ${s.maxRank}`)),
    el('p', { class: 'menu-desc' }, skill.desc),
    section('Effect', el('p', { class: 'menu-effect' }, skill.effect || ''),
      mods.length ? el('div', { class: 'menu-mods' }, mods.map(([k, v]) =>
        el('div', { class: `menu-mod ${statIsGood(k, v) ? 'good' : 'bad'}` },
          el('span', { class: 'menu-mod-v' }, formatMod(k, v)), el('span', { class: 'menu-mod-k' }, `${STAT_INFO[k].label} per rank`)))) : null),
    section('Requirements', el('ul', { class: 'menu-reqs' }, reqRows)),
    el('div', { class: 'menu-detail-actions' }, buy,
      !s.canBuy && s.reason ? el('p', { class: 'menu-note' }, s.reason) : null));
}

function reqRow(ok, text, extra) {
  return el('li', { class: ok ? 'ok' : 'todo' }, icon(ok ? 'check' : 'lock', 14), el('span', text), extra ? el('em', extra) : null);
}
