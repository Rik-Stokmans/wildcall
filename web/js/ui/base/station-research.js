// Research Desk: mysteries, recording analysis, species study, the contracts board and
// submissions. Species names only ever come from the player's own journal entries.
import { el, icon, button, progressBar, stars, formatClock, label, DISCOVERY_LEVELS } from '../kit.js';
import * as L from './logic.js';
import { emptyState, sectionTitle } from './views.js';

const EVIDENCE_ORDER = ['size', 'shape', 'primary', 'secondary', 'bill', 'marking', 'flight', 'behavior', 'habitat'];

export const RESEARCH_TABS = [
  { id: 'mysteries', label: 'Mysteries', icon: 'search' },
  { id: 'recordings', label: 'Recordings', icon: 'recorder' },
  { id: 'study', label: 'Study', icon: 'knowledge' },
  { id: 'contracts', label: 'Contracts', icon: 'quest' },
  { id: 'submit', label: 'Submit', icon: 'upgrade' },
];

function evidenceList(m) {
  const ev = m.evidence || {};
  const keys = [...EVIDENCE_ORDER.filter((k) => k in ev), ...Object.keys(ev).filter((k) => !EVIDENCE_ORDER.includes(k))];
  if (!keys.length) return el('div', { class: 'base-muted' }, 'No evidence gathered yet.');
  return el('div', { class: 'base-evidence' }, keys.map((k) =>
    el('span', { class: 'base-ev' }, el('b', label(k) + ': '), String(ev[k]))));
}

function mysteries(api) {
  const list = L.mysteryList(api.profile);
  if (!list.length) {
    return emptyState('No unknown birds on the desk.', 'Listen for unfamiliar calls out in the woods. Every voice you cannot place will land here as a mystery.');
  }
  return el('div', { class: 'base-cards' }, list.map((m) => {
    const n = L.evidenceCount(m);
    return el('div', { class: 'base-card base-mystery' },
      el('div', { class: 'base-silhouette' }, icon('bird', 34)),
      el('div', { class: 'base-card-main' },
        el('div', { class: 'base-card-title' }, m.label || 'Unknown bird'),
        el('div', { class: 'base-card-sub' },
          `${DISCOVERY_LEVELS[m.level] || 'Noticed'} · heard ${m.heard || 0}× · seen ${m.seen || 0}×`,
          m.region != null && api.state.regions[m.region] ? ` · ${api.state.regions[m.region].name}` : ''),
        evidenceList(m),
        n < 2 ? el('div', { class: 'base-hint' }, 'Two clues are needed before an identification can be tried.') : null),
      el('div', { class: 'base-card-actions' },
        button('Identify', { variant: 'primary', icon: 'search', onClick: () => { api.snd('page'); api.ctx.ui.open('identify', { mystery: m.id }); } })));
  }));
}

function playButton(api, rec) {
  let handle = null;
  const b = button('', { small: true, variant: 'ghost', icon: 'play', title: 'Listen' });
  b.addEventListener('click', () => {
    if (handle) { try { handle.stop(); } catch { /* ignore */ } handle = null; b.classList.remove('playing'); return; }
    handle = api.ctx.audio?.playCall?.(rec.spIndex, rec.call) || null;
    if (handle) { b.classList.add('playing'); setTimeout(() => { handle = null; b.classList.remove('playing'); }, Math.max(1500, (rec.dur || 3) * 1000)); }
  });
  return b;
}

function recRow(api, r, actions) {
  return el('div', { class: 'base-card compact' },
    el('div', { class: 'base-silhouette small' }, icon('recorder', 22)),
    el('div', { class: 'base-card-main' },
      el('div', { class: 'base-card-title' }, L.subjectLabel(r.species, r.mystery, api.profile, api.state.speciesById)),
      el('div', { class: 'base-card-sub' }, stars(r.stars || 0), ` · quality ${r.quality || 0} · ${Math.round((r.dur || 0) * 10) / 10}s · Day ${r.day}, ${formatClock(r.time || 0)}`)),
    el('div', { class: 'base-card-actions row' }, playButton(api, r), actions));
}

function recordings(api) {
  const info = L.analysisInfo(api.profile, api.stats);
  const waiting = L.unanalyzedRecordings(api.profile);
  const done = (api.profile.journal?.recordings || []).filter((r) => r.analyzed);
  return el('div', { class: 'base-stack' },
    el('div', { class: 'base-note' }, icon('headphones', 18),
      el('div', info.lines.map((t) => el('p', t)))),
    sectionTitle('Waiting for analysis', String(waiting.length)),
    waiting.length
      ? el('div', { class: 'base-cards' }, waiting.map((r) => recRow(api, r, button('Analyze', { variant: 'primary', small: true, icon: 'upgrade', onClick: () => api.send('cabin', { action: 'analyze', id: r.id }, 'page') }))))
      : emptyState('Nothing to analyze.', 'Record a call with the recorder (3) and bring it home.'),
    done.length ? sectionTitle('Analyzed', String(done.length)) : null,
    done.length ? el('div', { class: 'base-cards' }, done.map((r) => recRow(api, r, el('span', { class: 'base-chip done' }, icon('check', 12), 'Analyzed')))) : null);
}

function study(api) {
  const s = L.studyLists(api.profile);
  const speciesById = api.state.speciesById;
  const row = (e, actions) => el('div', { class: 'base-card compact' },
    el('div', { class: 'base-silhouette small' }, icon('bird', 22)),
    el('div', { class: 'base-card-main' },
      el('div', { class: 'base-card-title' }, speciesById[e.id]?.name || 'Identified bird'),
      e.level >= L.LEVEL_STUDIED
        ? el('div', { class: 'base-card-sub' }, 'Studied: every page of the entry is filled in.')
        : el('div', { class: 'base-study' }, progressBar(e.study || 0, L.STUDY_FULL, { height: 8 }),
          el('span', { class: 'base-muted' }, `${e.study || 0} / ${L.STUDY_FULL} toward Studied`))),
    el('div', { class: 'base-card-actions row' }, actions));
  return el('div', { class: 'base-stack' },
    el('div', { class: 'base-note' }, icon('knowledge', 18),
      el('div', el('p', 'Desk research turns a documented species (a photo, recording or written observation on file) into a Studied one. Each session fills the study meter; at 100 the entry is complete.'))),
    sectionTitle('Ready to study', String(s.ready.length)),
    s.ready.length
      ? el('div', { class: 'base-cards' }, s.ready.map((e) => row(e, button('Study', { variant: 'primary', small: true, icon: 'knowledge', onClick: () => api.send('cabin', { action: 'study', id: e.id }, 'page') }))))
      : emptyState('No species ready for study.', s.waiting ? `${s.waiting} identified species still need a photograph, recording or written observation first.` : 'Identify a bird and document it with a photo or recording.'),
    s.studied.length ? sectionTitle('Studied', String(s.studied.length)) : null,
    s.studied.length ? el('div', { class: 'base-cards' }, s.studied.map((e) => row(e, el('span', { class: 'base-chip done' }, icon('star', 12), 'Studied')))) : null);
}

function contracts(api) {
  const board = L.contractBoard(api.state.quests, api.profile);
  if (!board.length) {
    return emptyState('The board is bare for now.', 'New research contracts are pinned here as your rank grows.');
  }
  const statusChip = { complete: 'Ready to hand in', active: 'In progress', available: 'Open', locked: 'Locked', done: 'Handed in' };
  return el('div', { class: 'base-cards' }, board.map((c) => {
    const d = c.def;
    let action = null;
    if (c.status === 'available') action = button('Accept', { variant: 'primary', icon: 'check', onClick: () => api.send('quest', { id: d.id, action: 'accept' }, 'page') });
    else if (c.status === 'complete') action = button('Turn in', { variant: 'primary', icon: 'credits', onClick: () => api.send('quest', { id: d.id, action: 'turnin' }, 'reward') });
    else if (c.status === 'active') action = button(c.tracked ? 'Untrack' : 'Track', { small: true, variant: 'ghost', onClick: () => api.send('quest', { id: d.id, action: c.tracked ? 'untrack' : 'track' }) });
    const rewards = L.rewardLines(d.rewards, api.state.items);
    return el('div', { class: `base-card base-contract ${c.status}` },
      el('div', { class: 'base-card-main' },
        el('div', { class: 'base-card-title' }, d.name, el('span', { class: `base-chip ${c.status}` }, statusChip[c.status])),
        el('div', { class: 'base-card-sub' }, label(d.category), c.lock ? ` · ${c.lock}` : ''),
        el('p', { class: 'base-desc' }, d.summary || ''),
        c.status !== 'locked' && c.status !== 'done' ? el('div', { class: 'base-objectives' }, c.objectives.map((o) =>
          el('div', { class: 'base-objective' + (o.done ? ' done' : '') },
            icon(o.done ? 'check' : 'footprint', 13),
            el('span', o.def.text),
            o.need > 1 ? el('span', { class: 'base-objective-count' }, `${o.have}/${o.need}`) : null))) : null,
        c.status === 'active' || c.status === 'complete' ? progressBar(c.fraction, 1, { height: 6 }) : null,
        rewards.length ? el('div', { class: 'base-rewards' }, icon('credits', 13), rewards.join(' · ')) : null),
      el('div', { class: 'base-card-actions' }, action));
  }));
}

function submit(api) {
  const s = L.submitLists(api.profile);
  const send = (id) => api.send('cabin', { action: 'submit', id }, 'coin');
  const status = (it, make) => it.submitted
    ? el('span', { class: 'base-chip done' }, icon('check', 12), 'Submitted')
    : make();
  const photoRow = ({ item: p, submitted, eligible }) => el('div', { class: 'base-card compact' },
    el('div', { class: 'base-thumb' }, p.url ? el('img', { src: p.url, alt: '', loading: 'lazy' }) : icon('camera', 22)),
    el('div', { class: 'base-card-main' },
      el('div', { class: 'base-card-title' }, L.photoLabel(p, api.profile, api.state.speciesById)),
      el('div', { class: 'base-card-sub' }, stars(p.stars || 0), ` · Day ${p.day}, ${formatClock(p.time || 0)}`)),
    el('div', { class: 'base-card-actions row' }, status({ submitted }, () => button('Submit', { small: true, variant: 'primary', disabled: !eligible, title: eligible ? '' : 'A photo needs a bird in frame', onClick: () => send(p.id) }))));
  const recRowS = ({ item: r, submitted, eligible }) => el('div', { class: 'base-card compact' },
    el('div', { class: 'base-silhouette small' }, icon('recorder', 22)),
    el('div', { class: 'base-card-main' },
      el('div', { class: 'base-card-title' }, L.subjectLabel(r.species, r.mystery, api.profile, api.state.speciesById)),
      el('div', { class: 'base-card-sub' }, stars(r.stars || 0), ` · quality ${r.quality || 0} · Day ${r.day}`)),
    el('div', { class: 'base-card-actions row' }, status({ submitted }, () => button('Submit', { small: true, variant: 'primary', disabled: !eligible, onClick: () => send(r.id) }))));
  return el('div', { class: 'base-stack' },
    el('div', { class: 'base-note' }, icon('upgrade', 18),
      el('div', el('p', 'Hand your best photographs and recordings in to the research board for a modest one-time payment. Each item can be submitted once.'),
        el('p', { class: 'base-muted' }, s.pending ? `${s.pending} item${s.pending > 1 ? 's' : ''} waiting to be submitted.` : 'Everything eligible has been submitted.'))),
    sectionTitle('Photographs', String(s.photos.length)),
    s.photos.length ? el('div', { class: 'base-cards' }, s.photos.map(photoRow)) : emptyState('No photographs yet.', 'Raise the camera (2) and take a picture of a bird.'),
    sectionTitle('Recordings', String(s.recs.length)),
    s.recs.length ? el('div', { class: 'base-cards' }, s.recs.map(recRowS)) : emptyState('No recordings yet.', 'Raise the recorder (3) near a singing bird.'));
}

const PANES = { mysteries, recordings, study, contracts, submit };

/** Badges for the sub-tab row. */
export function researchCounts(api) {
  const board = L.contractBoard(api.state.quests, api.profile);
  const s = L.studyLists(api.profile);
  return {
    mysteries: L.mysteryList(api.profile).length,
    recordings: L.unanalyzedRecordings(api.profile).length,
    study: s.ready.length,
    contracts: board.filter((c) => c.status === 'available' || c.status === 'complete').length,
    submit: L.submitLists(api.profile).pending,
  };
}

export function renderResearch(api) {
  const counts = researchCounts(api);
  const sub = api.view.researchTab in PANES ? api.view.researchTab : 'mysteries';
  const nav = el('div', { class: 'base-pills', role: 'tablist' }, RESEARCH_TABS.map((t) =>
    el('button', { class: 'base-pill' + (t.id === sub ? ' active' : ''), type: 'button', role: 'tab',
      onclick: () => { api.snd('click'); api.view.researchTab = t.id; api.rerender(); } },
      icon(t.icon, 15), t.label,
      counts[t.id] ? el('span', { class: 'base-pill-badge' }, String(counts[t.id])) : null)));
  return el('div', { class: 'base-station base-research' }, nav, el('div', { class: 'base-station-scroll' }, PANES[sub](api)));
}
