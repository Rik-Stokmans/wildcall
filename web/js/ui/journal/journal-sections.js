// Photos, recordings, locations, natural history and rare-discovery sections of the
// Field Journal. Each render function returns { left, right } page contents.

import { el, icon, button, stars, rarityColor, RARITY_NAMES, WEATHER_NAMES } from '../kit.js';
import {
  PHOTO_SUBSCORES, filterPhotos, photoSubjectIds, subjectLabel, recordingInfo, recordingsNewestFirst, qualityWord, noiseWord,
  groupLocations, undiscoveredNearHome, locationStats, groupLore, diaryPages, rareNewestFirst, RARE_KIND_LABELS, RARE_KIND_ICONS,
  poiIcon, poiKindLabel,
} from './journal-logic.js';
import { regionName, formatDay, clockText, tagText, plural, formatDistance, bearingText } from './format.js';
import { chip, sectionTitle, emptyNote, kv, meter, callPlayback, uiSound, segmented } from './widgets.js';

const STAR_FILTERS = [{ id: '0', label: 'Any' }, { id: '3', label: '3★+' }, { id: '4', label: '4★+' }, { id: '5', label: '5★' }];

function pageHead(title, sub) {
  return el('div', { class: 'jr-page-head' }, el('h2', title), sub ? el('div', { class: 'jr-page-sub' }, sub) : null);
}

function blankRight(text, ico) { return el('div', { class: 'jr-col jr-cover' }, emptyNote(text, ico)); }

/* -------------------------------------------------------------------------- */
/* Photographs                                                                */

export function renderPhotos(env) {
  const { ctx, st } = env;
  const profile = ctx.state.profile;
  const all = profile?.journal?.photos || [];
  const f = st.photos;
  const list = filterPhotos(all, { subject: f.subject, minStars: f.minStars });
  const byId = ctx.state.speciesById;
  const subjects = photoSubjectIds(all).filter((id) => byId[id]);

  const select = el('select', { class: 'jr-select', 'aria-label': 'Filter by bird', onchange: (e) => { f.subject = e.target.value; uiSound(ctx, 'click'); env.rerender(); } },
    el('option', { value: 'all' }, 'All photographs'),
    subjects.map((id) => el('option', { value: id }, byId[id].name)),
    el('option', { value: 'unknown' }, 'Unknown birds'),
    el('option', { value: 'none' }, 'No bird in frame'));
  select.value = f.subject;

  if (f.sel && !all.some((p) => p.id === f.sel)) f.sel = null;
  const selected = all.find((p) => p.id === f.sel) || null;

  const left = el('div', { class: 'jr-col' },
    pageHead('Photographs', plural(all.length, 'photo')),
    el('div', { class: 'jr-filters' }, select, segmented(STAR_FILTERS, String(f.minStars), (id) => { f.minStars = Number(id); uiSound(ctx, 'click'); env.rerender(); })),
    el('div', { class: 'jr-scroll', 'data-scroll': 'photos' },
      list.length ? el('div', { class: 'jr-thumbs big' }, list.map((p) => el('button', {
        type: 'button', class: 'jr-thumb' + (p.id === f.sel ? ' selected' : ''),
        onclick: () => { f.sel = p.id; uiSound(ctx, 'page'); env.rerender(); },
      }, el('img', { src: p.url, alt: 'Photograph', loading: 'lazy', draggable: 'false' }), el('span', { class: 'jr-thumb-stars' }, stars(p.stars || 0)))))
        : emptyNote(all.length ? 'No photographs match these filters.' : 'No photographs yet. Raise the camera (2) and press the shutter when a bird holds still.', 'camera')));

  const right = selected ? photoDetail(env, selected) : blankRight('Pick a photograph to look at it more closely.', 'camera');
  return { left, right };
}

function photoDetail(env, p) {
  const { ctx } = env;
  const profile = ctx.state.profile;
  const subs = (p.subjects || []).map((s) => subjectLabel(s, ctx.state.speciesById, profile.journal.mysteries));
  const when = [`${formatDay(p.day)}, ${clockText(p.time)}`, WEATHER_NAMES[p.weather], regionName(ctx.state.regions, p.region)].filter(Boolean).join(' · ');
  return el('div', { class: 'jr-col' },
    el('div', { class: 'jr-photo-frame' }, el('img', { src: p.url, alt: 'Photograph', draggable: 'false' })),
    el('div', { class: 'jr-scroll', 'data-scroll': 'photo-detail' },
      el('div', { class: 'jr-photo-title' },
        el('div', el('h3', subs.length ? subs.join(' and ') : 'No bird in frame'), el('div', { class: 'jr-muted' }, when)),
        el('div', { class: 'jr-photo-score' }, stars(p.stars || 0), el('b', `${p.score || 0}`), el('small', '/ 100'))),
      el('div', { class: 'jr-meters' }, PHOTO_SUBSCORES.map((s) => meter(s.label, p[s.key] || 0))),
      (p.tags || []).length ? el('div', { class: 'jr-sp-chips' }, p.tags.map((t) => chip(tagText(t), { tone: /rare|exceptional|golden/.test(t) ? 'amber' : '' }))) : null,
      el('div', { class: 'jr-sp-chips' }, p.submitted ? chip('Submitted to research', { tone: 'good', ico: 'check' }) : null,
        (profile.journal.pinned || []).includes(p.id) ? chip('On your photo wall', { ico: 'pin' }) : null)));
}

/* -------------------------------------------------------------------------- */
/* Recordings                                                                 */

export function renderRecordings(env) {
  const { ctx, st } = env;
  const profile = ctx.state.profile;
  const all = profile?.journal?.recordings || [];
  const list = recordingsNewestFirst(all);
  if (st.recs.sel && !all.some((r) => r.id === st.recs.sel)) st.recs.sel = null;
  const sel = all.find((r) => r.id === st.recs.sel);
  const mys = profile?.journal?.mysteries || [];

  const left = el('div', { class: 'jr-col' },
    pageHead('Recordings', plural(all.length, 'recording')),
    el('div', { class: 'jr-scroll', 'data-scroll': 'recs' },
      list.length ? el('div', { class: 'jr-list' }, list.map((r) => {
        const info = recordingInfo(r, ctx.state.speciesById, mys);
        return el('button', {
          type: 'button', class: 'jr-row' + (r.id === st.recs.sel ? ' selected' : ''),
          onclick: () => { st.recs.sel = r.id; uiSound(ctx, 'page'); env.rerender(); },
        },
        el('span', { class: 'jr-row-icon' }, icon('microphone', 20)),
        el('span', { class: 'jr-row-main' },
          el('b', info.who),
          el('small', `${formatDay(r.day)}, ${clockText(r.time)} · ${qualityWord(r.quality)}`)),
        el('span', { class: 'jr-row-end' }, stars(r.stars || 0), r.submitted ? chip('Submitted', { tone: 'good' }) : r.analyzed ? chip('Analysed') : null));
      })) : emptyNote('No recordings yet. Raise the recorder (3), point it at a singing bird and press the button.', 'microphone')));

  let right = blankRight('Pick a recording to listen to it and see its spectrogram.', 'microphone');
  if (sel) {
    const info = recordingInfo(sel, ctx.state.speciesById, mys);
    const call = ctx.state.species[sel.spIndex]?.calls?.[sel.call];
    right = el('div', { class: 'jr-col' },
      el('div', { class: 'jr-sp-head' },
        el('div', { class: 'jr-rec-art' }, icon('microphone', 40)),
        el('div', { class: 'jr-sp-titles' }, el('h2', info.who), el('div', { class: 'jr-sci' }, `${formatDay(sel.day)}, ${clockText(sel.time)} · ${regionName(ctx.state.regions, sel.region)}`),
          el('div', { class: 'jr-sp-chips' }, stars(sel.stars || 0), chip(`${qualityWord(sel.quality)} · ${sel.quality}%`),
            sel.analyzed ? chip('Analysed', { ico: 'check' }) : chip('Not analysed yet', { tone: 'muted' }),
            sel.submitted ? chip('Submitted', { tone: 'good', ico: 'check' }) : null))),
      el('div', { class: 'jr-scroll', 'data-scroll': 'rec-detail' },
        call ? callPlayback(ctx, env.player, { key: `rec:${sel.id}`, spIndex: sel.spIndex, callIndex: sel.call, call, label: 'Playback', height: 130 })
          : el('p', { class: 'jr-muted' }, 'This recording cannot be replayed.'),
        el('div', { class: 'jr-kvs' },
          kv('Length', `${(sel.dur || 0).toFixed(1)} s`),
          kv('Distance', formatDistance(sel.dist || 0)),
          kv('Background', noiseWord(sel.noise || 0)),
          kv('Quality', `${sel.quality}%`)),
        info.named ? null : el('p', { class: 'jr-muted' }, 'You have not identified this voice yet. Listen again once you know more.')));
  }
  return { left, right };
}

/* -------------------------------------------------------------------------- */
/* Locations                                                                  */

export function renderLocations(env) {
  const { ctx, st } = env;
  const profile = ctx.state.profile;
  const w = ctx.state.welcome;
  const home = w?.world?.home || { x: 0, y: 0, z: 0 };
  const locations = profile?.journal?.locations || {};
  const groups = groupLocations(locations, home);
  const stats = locationStats(groups);
  const more = undiscoveredNearHome(Object.values(ctx.state.pois), locations, home, w?.world?.homeRadius || 450);
  if (st.locs.sel && !locations[st.locs.sel]) st.locs.sel = null;

  const left = el('div', { class: 'jr-col' },
    pageHead('Places', plural(stats.total, 'place') + ' discovered'),
    el('div', { class: 'jr-scroll', 'data-scroll': 'locs' },
      groups.length ? groups.map((g) => el('div', { class: 'jr-group' },
        sectionTitle(regionName(ctx.state.regions, g.region), plural(g.items.length, 'place')),
        el('div', { class: 'jr-list' }, g.items.map((it) => el('button', {
          type: 'button', class: 'jr-row' + (it.id === st.locs.sel ? ' selected' : ''),
          onclick: () => { st.locs.sel = it.id; uiSound(ctx, 'page'); env.rerender(); },
        },
        el('span', { class: 'jr-row-icon' }, icon(poiIcon(it.loc.kind), 20)),
        el('span', { class: 'jr-row-main' }, el('b', it.loc.name), el('small', `${poiKindLabel(it.loc.kind)} · ${formatDay(it.loc.day)}`)),
        el('span', { class: 'jr-row-end small' }, it.text, it.loc.hidden ? chip('Hidden place', { tone: 'amber' }) : null)))))) 
        : emptyNote('You have not found any named places yet. Wander off the trail.', 'compass'),
      more > 0 ? el('div', { class: 'jr-more' }, icon('compass', 18), el('span', `? ${more === 1 ? 'one more' : 'more'} to find nearby`)) : null));

  const sel = locations[st.locs.sel];
  let right;
  if (sel) {
    right = el('div', { class: 'jr-col' },
      el('div', { class: 'jr-sp-head' },
        el('div', { class: 'jr-rec-art' }, icon(poiIcon(sel.kind), 40)),
        el('div', { class: 'jr-sp-titles' }, el('h2', sel.name), el('div', { class: 'jr-sci' }, `${poiKindLabel(sel.kind)} · ${regionName(ctx.state.regions, sel.region)}`),
          el('div', { class: 'jr-sp-chips' }, sel.hidden ? chip('Hidden place', { tone: 'amber' }) : null))),
      el('div', { class: 'jr-kvs' },
        kv('Found', `${formatDay(sel.day)}, ${clockText(sel.time)}`),
        kv('From home', bearingText(home, sel.pos))),
      el('div', { class: 'jr-actions' }, button('Show on map', { variant: 'secondary', icon: 'map', onClick: () => { uiSound(ctx, 'click'); ctx.ui.open('map', { focus: { x: sel.pos.x, z: sel.pos.z } }); } })));
  } else {
    right = el('div', { class: 'jr-col' },
      el('div', { class: 'jr-page-head' }, el('h2', 'Exploration')),
      el('div', { class: 'jr-kvs' },
        kv('Places found', String(stats.total)),
        kv('Region types visited', String(stats.regions)),
        kv('Farthest from home', stats.total ? formatDistance(stats.farthest) : 'none yet')),
      more > 0 ? el('div', { class: 'jr-more big' }, icon('compass', 26), el('div', el('b', `? ${more === 1 ? 'one more place' : 'more places'} to find nearby`), el('p', 'Some of them are well off the trail.'))) : el('p', { class: 'jr-muted' }, 'You have found every place around the cabin. There is a whole world beyond it.'),
      el('div', { class: 'jr-actions' }, button('Open the map', { variant: 'secondary', icon: 'map', onClick: () => { uiSound(ctx, 'click'); ctx.ui.open('map', {}); } })));
  }
  return { left, right };
}

/* -------------------------------------------------------------------------- */
/* Natural history                                                            */

export function renderHistory(env) {
  const { ctx, st } = env;
  const profile = ctx.state.profile;
  const lore = groupLore(Object.values(ctx.state.lore), profile?.journal?.lore);
  const pages = diaryPages(Object.values(ctx.state.collectibles), profile?.journal?.collectibles);
  const foundPages = pages.filter((p) => p.found).length;
  const open = st.history.open;

  const left = el('div', { class: 'jr-col' },
    pageHead('Natural History', 'what you have learned about the land'),
    el('div', { class: 'jr-scroll', 'data-scroll': 'lore' },
      lore.groups.length ? lore.groups.map((g) => el('div', { class: 'jr-group' }, sectionTitle(g.label),
        g.entries.map((e) => el('div', { class: 'jr-lore' + (open.has(e.id) ? ' open' : '') },
          el('button', { type: 'button', class: 'jr-lore-head', onclick: () => { if (open.has(e.id)) open.delete(e.id); else open.add(e.id); uiSound(ctx, 'page'); env.rerender(); } },
            icon(open.has(e.id) ? 'down' : 'forward', 14), el('span', e.title)),
          open.has(e.id) ? el('p', { class: 'jr-lore-text' }, e.text) : null))))
        : emptyNote('Nothing recorded yet. Stories of the land turn up in caches, on old pages, and from the people you meet.', 'journal'),
      lore.locked > 0 ? el('p', { class: 'jr-muted center' }, `${plural(lore.locked, 'more entry', 'more entries')} to uncover.`) : null));

  const right = el('div', { class: 'jr-col jr-diary' },
    pageHead('The Forgotten Field Journal', pages.length ? `${foundPages} of ${pages.length} pages found` : ''),
    el('div', { class: 'jr-scroll', 'data-scroll': 'diary' },
      pages.length ? pages.map((p) => p.found
        ? el('div', { class: 'jr-diary-page' }, el('div', { class: 'jr-diary-no' }, `Page ${p.number}`, p.day ? el('small', ` · found day ${p.day}`) : null), el('p', { class: 'jr-hand' }, p.def.text || p.def.desc))
        : el('div', { class: 'jr-diary-page missing' }, el('div', { class: 'jr-diary-no' }, `Page ${p.number}`), el('p', { class: 'jr-hand faded' }, 'A torn edge. This page is somewhere out there.')))
        : emptyNote('An earlier naturalist left pages of their diary scattered across the land.', 'page')));
  return { left, right };
}

/* -------------------------------------------------------------------------- */
/* Rare discoveries                                                           */

export function renderRare(env) {
  const { ctx, st } = env;
  const profile = ctx.state.profile;
  const all = rareNewestFirst(profile?.journal?.rare);
  if (st.rare.sel && !all.some((r) => r.id === st.rare.sel)) st.rare.sel = null;
  const sel = all.find((r) => r.id === st.rare.sel);
  const photos = profile?.journal?.photos || [];

  const left = el('div', { class: 'jr-col' },
    pageHead('Rare Discoveries', plural(all.length, 'discovery', 'discoveries')),
    el('div', { class: 'jr-scroll', 'data-scroll': 'rare' },
      all.length ? el('div', { class: 'jr-list' }, all.map((r) => el('button', {
        type: 'button', class: 'jr-rare-card' + (r.id === st.rare.sel ? ' selected' : ''), style: { '--rarity': rarityColor(r.rarity) },
        onclick: () => { st.rare.sel = r.id; uiSound(ctx, 'page'); env.rerender(); },
      },
      el('span', { class: 'jr-rare-ico' }, icon(RARE_KIND_ICONS[r.kind] || 'star', 22)),
      el('span', { class: 'jr-row-main' }, el('b', r.title), el('small', `${RARE_KIND_LABELS[r.kind] || 'Discovery'} · ${formatDay(r.day)}`)),
      el('span', { class: 'jr-rare-name', style: { color: rarityColor(r.rarity) } }, RARITY_NAMES[r.rarity] || ''))))
        : emptyNote('Rare discoveries are the moments you could not have planned: an unusual plumage, a visitor far from home, a behaviour few have seen.', 'star')));

  let right = blankRight('Pick a discovery to read about it.', 'star');
  if (sel) {
    const photo = sel.photo ? photos.find((p) => p.id === sel.photo) : null;
    const spName = sel.species && profile.journal.species?.[sel.species] ? ctx.state.speciesById[sel.species]?.name : '';
    right = el('div', { class: 'jr-col jr-rare-detail', style: { '--rarity': rarityColor(sel.rarity) } },
      el('div', { class: 'jr-rare-banner' }, icon(RARE_KIND_ICONS[sel.kind] || 'star', 30),
        el('div', el('div', { class: 'jr-rare-kind' }, RARE_KIND_LABELS[sel.kind] || 'Discovery'), el('div', { class: 'jr-rare-rar', style: { color: rarityColor(sel.rarity) } }, RARITY_NAMES[sel.rarity] || ''))),
      el('h2', sel.title),
      el('div', { class: 'jr-muted' }, `${formatDay(sel.day)}${spName ? ' · ' + spName : ''}`),
      el('p', { class: 'jr-desc' }, sel.text),
      photo ? el('div', { class: 'jr-photo-frame small' }, el('img', { src: photo.url, alt: 'Photograph of the discovery', draggable: 'false' })) : null);
  }
  return { left, right };
}
