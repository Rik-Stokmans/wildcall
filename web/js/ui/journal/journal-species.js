// Species section of the Field Journal: a grid of every species of the player's unlocked
// regions (identified ones in colour, the rest as dark silhouettes labelled "Unknown"), the
// player's mysteries, and the full species page.

import { el, icon, button, stars, progressBar, rarityColor, DISCOVERY_LEVELS, WILD_RARITY_NAMES } from '../kit.js';
import {
  speciesCards, filterCards, progressCounts, discoveryLadder, nextStepText, infoGates, activityBars, expectedActivity, mysteryCards,
  photosOfSpecies, photosOfMystery, recordingsOfSpecies, recordingsOfMystery, observationsOfSpecies, similarSpecies, habitatList,
  studyPercent, METHOD_LABELS, GENERIC_BIRD,
} from './species-logic.js';
import { regionName, capital, formatDay, clockText, plural, wildRarityColorIndex, SEASON_LABELS } from './format.js';
import { qualityWord } from './journal-logic.js';
import { chip, sectionTitle, emptyNote, lockedHint, kv, illustration, barChart, callPlayback, segmented, uiSound } from './widgets.js';

const SUBTABS = [
  { id: 'about', label: 'About' },
  { id: 'record', label: 'My record' },
  { id: 'voice', label: 'Voice' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'notes', label: 'Notes' },
];
const FILTERS = [{ id: 'all', label: 'All' }, { id: 'known', label: 'Identified' }, { id: 'unknown', label: 'Unknown' }];

export function renderSpecies(env) {
  const { ctx, st } = env;
  const profile = ctx.state.profile;
  const s = st.species;
  const cards = speciesCards(ctx.state.species, profile);
  const mysteries = mysteryCards(profile, DISCOVERY_LEVELS);
  const counts = progressCounts(cards);
  const shown = filterCards(cards, s.filter);

  // Drop a selection that no longer exists (e.g. a mystery that was just identified).
  if (s.sel?.type === 'mystery' && !mysteries.some((m) => m.id === s.sel.id)) s.sel = null;
  if (s.sel?.type === 'species' && !profile?.journal?.species?.[s.sel.id]) s.sel = null;

  const left = el('div', { class: 'jr-col' },
    el('div', { class: 'jr-page-head' },
      el('h2', 'Species'),
      el('div', { class: 'jr-page-sub' }, `${counts.known} of ${counts.total} identified`, counts.documented ? ` · ${counts.documented} documented` : '')),
    segmented(FILTERS, s.filter, (id) => { s.filter = id; uiSound(ctx, 'click'); env.rerender(); }),
    el('div', { class: 'jr-scroll', 'data-scroll': 'species-grid' },
      mysteries.length && s.filter !== 'known' ? el('div', { class: 'jr-mysteries' },
        sectionTitle('Mysteries', 'heard or seen, not yet named'),
        el('div', { class: 'jr-myst-list' }, mysteries.map((m) => mysteryCard(env, m)))) : null,
      shown.length ? el('div', { class: 'jr-grid' }, shown.map((c) => speciesCard(env, c)))
        : emptyNote(s.filter === 'known' ? 'No species identified yet. Listen, watch, and name what you find.' : 'Nothing here yet.', 'bird')));

  let right;
  if (s.sel?.type === 'species') right = speciesPage(env, s.sel.id);
  else if (s.sel?.type === 'mystery') right = mysteryPage(env, mysteries.find((m) => m.id === s.sel.id));
  else right = coverPage(env, counts, mysteries.length);
  return { left, right };
}

function speciesCard(env, c) {
  const { ctx, st } = env;
  const sel = st.species.sel?.type === 'species' && c.known && st.species.sel.id === c.sp.id;
  if (!c.known) {
    // The silhouette is the only thing an unidentified species shows: no name, no rarity, no colour.
    const real = ctx.state.species[c.index];
    return el('div', { class: 'jr-card unknown', title: 'Not yet identified' },
      el('div', { class: 'jr-card-art' }, illustration(real, { size: 78, silhouette: true })),
      el('div', { class: 'jr-card-name' }, 'Unknown'),
      el('div', { class: 'jr-card-level' }, DISCOVERY_LEVELS[1]));
  }
  const card = el('button', {
    type: 'button', class: 'jr-card known' + (sel ? ' selected' : ''),
    onclick: () => { st.species.sel = { type: 'species', id: c.sp.id }; st.species.tab = 'about'; uiSound(ctx, 'page'); env.rerender(); },
  },
  el('div', { class: 'jr-card-art' }, illustration(c.sp, { size: 78 })),
  el('div', { class: 'jr-card-name' }, c.sp.name),
  el('div', { class: 'jr-card-level' }, DISCOVERY_LEVELS[c.level] || ''),
  c.probable ? el('span', { class: 'jr-stamp' }, 'probable') : null);
  return card;
}

function mysteryCard(env, m) {
  const { ctx, st } = env;
  const sel = st.species.sel?.type === 'mystery' && st.species.sel.id === m.id;
  return el('button', {
    type: 'button', class: 'jr-myst' + (sel ? ' selected' : ''),
    onclick: () => { st.species.sel = { type: 'mystery', id: m.id }; uiSound(ctx, 'page'); env.rerender(); },
  },
  el('div', { class: 'jr-myst-art' }, illustration(GENERIC_BIRD, { size: 44, silhouette: true })),
  el('div', { class: 'jr-myst-body' },
    el('div', { class: 'jr-myst-name' }, m.label),
    el('div', { class: 'jr-myst-meta' }, m.levelName, m.rows.length ? ` · ${plural(m.rows.length, 'clue')}` : '')));
}

/** Right page when nothing is selected: a short, welcoming summary. */
function coverPage(env, counts, mysteryCount) {
  const { ctx } = env;
  const p = ctx.state.profile;
  return el('div', { class: 'jr-col jr-cover' },
    el('div', { class: 'jr-cover-mark' }, icon('journal', 46)),
    el('h2', { class: 'jr-cover-title' }, 'Field Journal'),
    el('div', { class: 'jr-cover-owner' }, p?.name ? `of ${p.name}` : ''),
    el('p', { class: 'jr-cover-text' }, counts.known
      ? 'Open a page to read your notes on a bird, replay its voice, or look back at the photographs you took.'
      : 'Nothing is written here yet. Listen for unfamiliar voices, watch quietly, and put a name to what you find.'),
    mysteryCount ? el('p', { class: 'jr-cover-text amber' }, `${plural(mysteryCount, 'mystery bird')} waiting for a name.`) : null,
    el('p', { class: 'jr-cover-text small' }, 'Birds are never marked on the map. Each one has to be earned.'));
}

/* -------------------------------------------------------------------------- */
/* Mystery page                                                               */

function mysteryPage(env, m) {
  if (!m) return coverPage(env, { known: 0 }, 0);
  const { ctx, player } = env;
  const profile = ctx.state.profile;
  const photos = photosOfMystery(profile, m.id);
  const recs = recordingsOfMystery(profile, m.id);
  const wrongNames = m.wrong.map((id) => ctx.state.speciesById[id]?.name).filter(Boolean);
  return el('div', { class: 'jr-col' },
    el('div', { class: 'jr-sp-head' },
      el('div', { class: 'jr-sp-art' }, illustration(GENERIC_BIRD, { size: 104, silhouette: true })),
      el('div', { class: 'jr-sp-titles' },
        el('h2', m.label),
        el('div', { class: 'jr-sci' }, 'Species unknown'),
        el('div', { class: 'jr-sp-chips' }, chip(m.levelName, { tone: 'amber' }),
          m.heard ? chip(`Heard ${m.heard}×`, { ico: 'ear' }) : null, m.seen ? chip(`Seen ${m.seen}×`, { ico: 'eye' }) : null))),
    el('div', { class: 'jr-scroll', 'data-scroll': 'mystery' },
      sectionTitle('What you know so far'),
      m.rows.length ? el('div', { class: 'jr-evidence' }, m.rows.map((r) => el('div', { class: 'jr-ev' }, el('span', r.label), el('b', r.value))))
        : emptyNote('No clues yet. Keep listening and watching: every detail you notice is written down here.', 'eye'),
      wrongNames.length ? el('p', { class: 'jr-muted' }, `Ruled out: ${wrongNames.join(', ')}.`) : null,
      recs.length ? [sectionTitle('Recordings'), el('div', { class: 'jr-list' }, recs.map((r) => recRow(env, r)))] : null,
      photos.length ? [sectionTitle('Photographs'), photoStrip(env, photos)] : null,
      el('div', { class: 'jr-actions' },
        button('Identify', {
          variant: 'primary', icon: 'search', disabled: m.rows.length === 0,
          title: m.rows.length ? 'Name this bird' : 'Gather a little evidence first',
          onClick: () => { uiSound(ctx, 'click'); ctx.ui.open('identify', { mystery: m.id }); },
        }),
        m.rows.length === 0 ? el('span', { class: 'jr-muted' }, 'Gather a little evidence first.') : null)));
}

/* -------------------------------------------------------------------------- */
/* Species page                                                               */

function speciesPage(env, id) {
  const { ctx, st } = env;
  const sp = ctx.state.speciesById[id];
  const entry = ctx.state.profile?.journal?.species?.[id];
  if (!sp || !entry) return coverPage(env, { known: 0 }, 0);
  const tab = st.species.tab;
  const wild = sp.rarity | 0;
  const body = { about: aboutTab, record: recordTab, voice: voiceTab, gallery: galleryTab, notes: notesTab }[tab] || aboutTab;
  return el('div', { class: 'jr-col' },
    el('div', { class: 'jr-sp-head' },
      el('div', { class: 'jr-sp-art' }, illustration(sp, { size: 112, background: true })),
      el('div', { class: 'jr-sp-titles' },
        el('h2', sp.name),
        el('div', { class: 'jr-sci' }, sp.sci),
        el('div', { class: 'jr-sp-chips' },
          chip(sp.family || 'Birds', { ico: 'leaf' }),
          el('span', { class: 'jr-rarity', style: { color: rarityColor(wildRarityColorIndex(wild)) } }, WILD_RARITY_NAMES[wild] || 'Common'),
          chip(DISCOVERY_LEVELS[entry.level] || 'Identified', { tone: 'good' }),
          entry.probable ? el('span', { class: 'jr-stamp inline' }, 'probable') : null),
        el('div', { class: 'jr-study' }, el('span', 'Study'), progressBar(studyPercent(entry), 100, { height: 8 }), el('b', studyPercent(entry) + '%')))),
    segmented(SUBTABS, tab, (t) => { st.species.tab = t; uiSound(ctx, 'click'); env.rerender(); }),
    el('div', { class: 'jr-scroll', 'data-scroll': 'species-' + tab }, body(env, sp, entry)));
}

function aboutTab(env, sp, entry) {
  const { ctx } = env;
  const gates = infoGates(ctx.state.stats);
  const ladder = discoveryLadder(entry, DISCOVERY_LEVELS);
  const out = [];
  out.push(el('div', { class: 'jr-ladder' }, ladder.map((step) => el('div', { class: 'jr-rung ' + step.state, title: step.hint },
    el('span', { class: 'jr-rung-dot' }, step.state === 'todo' ? '' : icon('check', 11)),
    el('span', { class: 'jr-rung-name' }, step.name)))));
  out.push(el('p', { class: 'jr-next' }, nextStepText(entry, DISCOVERY_LEVELS)));
  out.push(el('p', { class: 'jr-desc' }, sp.desc));
  if (sp.idTips) out.push(el('div', { class: 'jr-note-box' }, el('b', 'How to tell it apart'), el('p', sp.idTips)));
  if (gates.fact) { if (sp.fact) out.push(el('div', { class: 'jr-fact' }, icon('info', 16), el('p', sp.fact))); }
  else out.push(lockedHint('A little trivia about this bird is tucked away.'));

  out.push(sectionTitle('Where and when'));
  if (gates.habitats) {
    const hs = habitatList(sp);
    out.push(el('div', { class: 'jr-subhead' }, 'Likely habitats'));
    out.push(el('div', { class: 'jr-hbars' }, hs.map((h) => el('div', { class: 'jr-hbar' }, el('span', h.label), el('div', { class: 'jr-hbar-track' }, el('div', { style: { width: Math.round(h.frac * 100) + '%' } }))))));
    const perches = sp.behavior?.perches || [];
    if (perches.length) out.push(el('p', { class: 'jr-line' }, el('b', 'Perches: '), perches.map(capital).join(', ') + '.'));
    if (sp.behavior?.feeding) out.push(el('p', { class: 'jr-line' }, el('b', 'Feeds by: '), capital(sp.behavior.feeding) + '.'));
    out.push(el('p', { class: 'jr-line' }, el('b', 'Regions: '), (sp.regions || []).map((r) => regionName(ctx.state.regions, r)).join(', ') + '.'));
  } else out.push(lockedHint('Where this bird is likely to be found is not yet clear to you.'));
  if (gates.seasons) {
    out.push(el('div', { class: 'jr-subhead' }, 'Seasons present'));
    out.push(el('div', { class: 'jr-seasons' }, SEASON_LABELS.map((n, i) => chip(n, { tone: sp.seasons?.[i] ? 'good' : 'muted', title: sp.seasons?.[i] ? 'Present' : 'Away' }))));
    out.push(el('div', { class: 'jr-subhead' }, 'Usual daily activity'));
    out.push(barChart(expectedActivity(sp).map((a) => ({ name: a.name, frac: a.frac })), { accent: 'soft' }));
  } else out.push(lockedHint('When this bird is active through the year and through the day is not yet clear to you.'));

  out.push(sectionTitle('Relations'));
  if (gates.relations) {
    const rel = sp.relations || [];
    out.push(rel.length ? el('ul', { class: 'jr-bullets' }, rel.map((r) => el('li', r))) : el('p', { class: 'jr-muted' }, 'No ecological notes yet.'));
  } else out.push(lockedHint('How this bird fits into its habitat is not yet clear to you.'));
  const sim = similarSpecies(sp, ctx.state.speciesById, ctx.state.profile);
  if (gates.similar && (sim.shown.length || sim.hidden)) {
    out.push(el('div', { class: 'jr-subhead' }, 'Easily confused with'));
    out.push(el('div', { class: 'jr-sp-chips' },
      sim.shown.map((o) => el('button', { type: 'button', class: 'jr-chip link', onclick: () => { env.st.species.sel = { type: 'species', id: o.id }; env.st.species.tab = 'about'; env.rerender(); } }, o.name)),
      sim.hidden ? chip(`${plural(sim.hidden, 'bird')} you have not identified`, { tone: 'muted' }) : null));
  }
  return out;
}

function recordTab(env, sp, entry) {
  const { ctx } = env;
  const profile = ctx.state.profile;
  const out = [];
  const where = [entry.firstPlace, entry.firstRegion != null ? regionName(ctx.state.regions, entry.firstRegion) : ''].filter(Boolean).join(', ');
  out.push(el('div', { class: 'jr-kvs' },
    kv('First noted', `${formatDay(entry.firstDay)}${where ? ' · ' + where : ''}`),
    kv('Seen', plural(entry.seen || 0, 'time')),
    kv('Heard', plural(entry.heard || 0, 'time')),
    kv('Identified', `${entry.confidence || 0}% confident${entry.method ? ', ' + (METHOD_LABELS[entry.method] || entry.method) : ''}`),
    kv('Photographs', String(entry.photoCount || 0)),
    kv('Recordings', String(entry.recCount || 0))));
  const habs = entry.habitats || [], regs = entry.regions || [], behs = entry.behaviors || [];
  out.push(sectionTitle('Where you met it'));
  out.push(habs.length || regs.length
    ? el('div', { class: 'jr-sp-chips' }, regs.map((r) => chip(regionName(ctx.state.regions, r), { ico: 'map' })), habs.map((h) => chip(capital(h), { ico: 'leaf' })))
    : el('p', { class: 'jr-muted' }, 'No places noted yet.'));
  out.push(sectionTitle('Behaviours observed'));
  out.push(behs.length ? el('div', { class: 'jr-sp-chips' }, behs.map((b) => chip(capital(b), { tone: 'amber', ico: 'eye' }))) : el('p', { class: 'jr-muted' }, 'Watch it a while longer to see what it gets up to.'));
  out.push(sectionTitle('Your encounters through the day'));
  const act = activityBars(entry.phases);
  out.push(act.total ? barChart(act.bars.map((b) => ({ name: b.name, frac: b.frac, value: b.value })))
    : el('p', { class: 'jr-muted' }, 'Your own pattern of encounters will build up as you meet it at different times of day.'));
  const obs = observationsOfSpecies(profile, sp.id);
  out.push(sectionTitle('Field observations'));
  out.push(obs.length ? el('div', { class: 'jr-list' }, obs.slice().reverse().map((o) => el('div', { class: 'jr-obs' },
    el('div', { class: 'jr-obs-meta' }, `${formatDay(o.day)}, ${clockText(o.time)}`, o.behavior ? ` · ${capital(o.behavior)}` : '', o.auto ? '' : ' · your note'),
    el('p', o.text || '')))) : el('p', { class: 'jr-muted' }, 'No written observations yet.'));
  return out;
}

function voiceTab(env, sp) {
  const calls = sp.calls || [];
  if (!calls.length) return emptyNote('No calls have been described for this bird.', 'ear');
  return [
    el('p', { class: 'jr-muted' }, 'Press play to hear it again. The picture shows pitch over time.'),
    el('div', { class: 'jr-list' }, calls.map((c, i) => callPlayback(env.ctx, env.player, {
      key: `sp:${sp.id}:${i}`, spIndex: sp.index, callIndex: i, call: c,
      label: capital(c.kind || 'call'), sub: [c.pitch ? capital(c.pitch) + ' pitch' : '', c.pattern ? capital(c.pattern) : ''].filter(Boolean).join(' · '),
    }))),
  ];
}

function galleryTab(env, sp) {
  const profile = env.ctx.state.profile;
  const photos = photosOfSpecies(profile, sp.id);
  const recs = recordingsOfSpecies(profile, sp.id);
  return [
    sectionTitle('Photographs', plural(photos.length, 'photo')),
    photos.length ? photoStrip(env, photos) : el('p', { class: 'jr-muted' }, 'No photographs of this bird yet.'),
    sectionTitle('Recordings', plural(recs.length, 'recording')),
    recs.length ? el('div', { class: 'jr-list' }, recs.map((r) => recRow(env, r))) : el('p', { class: 'jr-muted' }, 'No recordings of this bird yet.'),
  ];
}

function notesTab(env, sp, entry) {
  const { ctx, drafts } = env;
  const value = drafts.has(sp.id) ? drafts.get(sp.id) : (entry.notes || '');
  const ta = el('textarea', {
    class: 'jr-notes', rows: 9, maxlength: 2000, placeholder: 'Jot down anything you want to remember about this bird…', spellcheck: 'true',
  });
  ta.value = value;
  ta.addEventListener('input', () => drafts.set(sp.id, ta.value));
  ta.addEventListener('blur', () => {
    const text = ta.value;
    drafts.delete(sp.id);
    if (text !== (entry.notes || '')) { ctx.net.send('note', { species: sp.id, text }); uiSound(ctx, 'page'); }
    env.flushPending();
  });
  return [
    el('p', { class: 'jr-muted' }, 'Your own words. They are saved when you click away.'),
    ta,
  ];
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */

export function photoStrip(env, photos) {
  return el('div', { class: 'jr-thumbs' }, photos.slice().reverse().map((p) => el('button', {
    type: 'button', class: 'jr-thumb', title: `${formatDay(p.day)} · ${p.stars || 0} stars`,
    onclick: () => env.openPhoto(p.id),
  }, el('img', { src: p.url, alt: 'Photograph', loading: 'lazy', draggable: 'false' }), el('span', { class: 'jr-thumb-stars' }, stars(p.stars || 0)))));
}

export function recRow(env, r) {
  const { ctx, player } = env;
  const sp = ctx.state.species[r.spIndex];
  const call = sp?.calls?.[r.call];
  return el('div', { class: 'jr-rec-mini' },
    call ? callPlayback(ctx, player, { key: `rec:${r.id}`, spIndex: r.spIndex, callIndex: r.call, call, label: `${formatDay(r.day)}, ${clockText(r.time)}`, sub: `${qualityWord(r.quality)} · ${'★'.repeat(r.stars || 0)}`, height: 40 })
      : el('div', { class: 'jr-muted' }, `Recording from ${formatDay(r.day)}`));
}

