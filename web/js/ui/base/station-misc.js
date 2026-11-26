// Journal Display, Photography Wall, Storage, Cabin Upgrades and Rest.
import { el, icon, button, progressBar, stars, formatClock, label, itemCard,
  WEATHER_NAMES, WEATHER_ICONS, SEASON_NAMES } from '../kit.js';
import * as L from './logic.js';
import { emptyState, sectionTitle, itemDetail, issueRow, priceTag } from './views.js';

/* ------------------------------------------------------------------ journal display */

export function renderJournal(api) {
  const s = L.journalSummary(api.profile, api.state.species, api.state.ranks);
  const meter = (title, n, total, sub) => el('div', { class: 'base-meter' },
    el('div', { class: 'base-meter-head' }, el('span', title), el('b', `${n} / ${total}`)),
    progressBar(n, Math.max(1, total), { height: 10 }),
    el('div', { class: 'base-muted' }, sub));
  const region = (id) => api.state.regions[id]?.name || '';
  return el('div', { class: 'base-station base-journal' }, el('div', { class: 'base-station-scroll' },
    el('div', { class: 'base-hero' },
      el('div', { class: 'base-hero-rank' }, icon('rank', 28),
        el('div', el('div', { class: 'base-hero-title' }, s.rankTitle), el('div', { class: 'base-muted' }, `Naturalist rank ${s.rank}${s.nextRank ? ` · next: ${s.nextRank.title}` : ' · the highest rank'}`))),
      el('div', { class: 'base-hero-text' }, 'The journal on the shelf keeps everything you have learned. Only what you have truly identified is written in it.'),
      button('Open the journal', { variant: 'primary', icon: 'journal', onClick: () => { api.snd('page'); api.ctx.ui.open('journal', { section: 'species' }); } })),
    sectionTitle('Progress', 'species in the regions you can enter'),
    el('div', { class: 'base-meters' },
      meter('Identified', s.identified, s.total, 'Birds you can name with confidence'),
      meter('Documented', s.documented, s.total, 'A photo, recording or note on file'),
      meter('Studied', s.studied, s.total, 'Completed at the research desk')),
    el('div', { class: 'base-two' },
      el('div', { class: 'base-col' },
        sectionTitle('Recent discoveries'),
        s.recent.length
          ? el('div', { class: 'base-list' }, s.recent.map((e) => el('div', { class: 'base-list-row' },
            icon('bird', 16), el('b', api.state.speciesById[e.id]?.name || 'Identified bird'),
            el('span', { class: 'base-muted' }, `Day ${e.firstDay}${e.firstPlace ? ' · ' + e.firstPlace : region(e.firstRegion) ? ' · ' + region(e.firstRegion) : ''}`))))
          : emptyState('Nothing identified yet.', 'Your first identification will be written here.')),
      el('div', { class: 'base-col' },
        sectionTitle('Rare discoveries', String(s.rareCount)),
        s.rare.length
          ? el('div', { class: 'base-list' }, s.rare.map((r) => el('div', { class: 'base-list-row' }, icon('star', 16), el('b', r.title), el('span', { class: 'base-muted' }, `Day ${r.day}`))))
          : emptyState('No rare discoveries yet.', 'Vagrants, unusual plumage and exceptional moments are logged here.'),
        el('div', { class: 'base-facts' },
          fact('camera', `${s.photos} photographs`), fact('recorder', `${s.recordings} recordings`), fact('search', `${s.mysteries} unidentified`))))));
}

function fact(ic, text) { return el('span', { class: 'base-fact' }, icon(ic, 14), text); }

/* ------------------------------------------------------------------ photography wall */

/** Photo ids currently shown on the wall illustration, in slot order. */
export function pinnedPhotos(profile) {
  const byId = new Map((profile?.journal?.photos || []).map((p) => [p.id, p]));
  return L.pinInfo(profile).pinned.map((id) => byId.get(id)).filter(Boolean);
}

export function renderPhotos(api) {
  const photos = api.profile.journal?.photos || [];
  const pin = L.pinInfo(api.profile);
  const pinned = new Set(pin.pinned);
  const sel = photos.find((p) => p.id === api.view.photo) || photos[photos.length - 1] || null;
  if (sel) api.view.photo = sel.id;
  const pinButton = (p, small) => pinned.has(p.id)
    ? button('Unpin', { small, icon: 'pin', onClick: () => api.send('cabin', { action: 'unpin', id: p.id }, 'click') })
    : button('Pin to wall', { small, icon: 'pin', variant: 'primary', disabled: !pin.canPin, title: pin.canPin ? '' : 'The wall is full. Unpin a photo first.',
      onClick: () => api.send('cabin', { action: 'pin', id: p.id }, 'page') });
  const grid = photos.length
    ? el('div', { class: 'base-photo-grid' }, photos.slice().reverse().map((p) =>
      el('button', { class: 'base-photo' + (sel && p.id === sel.id ? ' active' : '') + (pinned.has(p.id) ? ' pinned' : ''), type: 'button',
        onclick: () => { api.snd('click'); api.view.photo = p.id; api.rerender(); } },
        el('div', { class: 'base-photo-img' }, p.url ? el('img', { src: p.url, alt: '', loading: 'lazy' }) : null),
        el('div', { class: 'base-photo-foot' }, stars(p.stars || 0), pinned.has(p.id) ? icon('pin', 13) : null))))
    : emptyState('No photographs yet.', 'Raise the camera with the right mouse button and press the shutter. Your best shots can hang here.');
  const score = (name, v) => el('div', { class: 'base-score' }, el('span', name), progressBar(v || 0, 100, { height: 6 }), el('b', String(v || 0)));
  const detail = sel ? el('div', { class: 'base-photo-detail' },
    el('div', { class: 'base-photo-big' }, sel.url ? el('img', { src: sel.url, alt: '' }) : null),
    el('div', { class: 'base-card-title' }, L.photoLabel(sel, api.profile, api.state.speciesById)),
    el('div', { class: 'base-card-sub' }, stars(sel.stars || 0), ` · ${sel.score || 0}/100 · Day ${sel.day}, ${formatClock(sel.time || 0)}`),
    el('div', { class: 'base-card-sub' }, [api.state.regions[sel.region]?.name, WEATHER_NAMES[sel.weather]].filter(Boolean).join(' · ')),
    el('div', { class: 'base-scores' }, score('Focus', sel.focus), score('Composition', sel.composition), score('Distance', sel.distance), score('Lighting', sel.lighting), score('Visibility', sel.visibility)),
    (sel.tags || []).length ? el('div', { class: 'base-tags' }, sel.tags.map((t) => el('span', { class: 'base-tag' }, label(t.replace('behavior:', ''))))) : null,
    sel.submitted ? el('span', { class: 'base-chip done' }, icon('check', 12), 'Submitted to research') : null,
    pinButton(sel, false)) : null;
  return el('div', { class: 'base-station base-photos' },
    el('div', { class: 'base-photo-head' },
      el('div', { class: 'base-card-title' }, `${pin.count} / ${pin.slots} frames in use`),
      el('div', { class: 'base-muted' }, pin.slots === L.WALL_SLOTS_BASE ? 'The photography wall upgrade adds six more frames.' : 'Every frame on the extended wall is available.')),
    el('div', { class: 'base-photo-layout' },
      el('div', { class: 'base-station-scroll' }, grid),
      detail));
}

/* ------------------------------------------------------------------ storage */

function stackRow(api, stack, side) {
  const item = api.state.items[stack.item];
  if (!item) return null;
  const to = side === 'backpack' ? 'storage' : 'inventory';
  const check = L.moveCheck(item, to, api.profile, api.stats);
  const selected = api.view.stackSel === item.id;
  return el('div', { class: 'base-stack-row' + (selected ? ' selected' : '') },
    el('div', { class: 'base-stack-card', onclick: () => { api.snd('click'); api.view.stackSel = item.id; api.rerender(); } },
      itemCard(item, { qty: stack.qty, compact: true, selected })),
    button(side === 'backpack' ? 'Store' : 'Take', { small: true, icon: side === 'backpack' ? 'forward' : 'back', disabled: !check.ok, title: check.reason,
      onClick: () => api.send('move', { item: item.id, to }, 'click') }));
}

export function renderStorage(api) {
  const cap = L.capacityInfo(api.profile, api.stats);
  const pack = api.profile.inventory || [];
  const store = api.profile.storage || [];
  const sel = api.state.items[api.view.stackSel] || null;
  const col = (title, aside, list, side, empty) => el('div', { class: 'base-col base-storage-col' },
    sectionTitle(title, aside),
    el('div', { class: 'base-station-scroll' }, list.length ? list.map((s) => stackRow(api, s, side)) : emptyState(empty)));
  return el('div', { class: 'base-station base-storage' },
    el('div', { class: 'base-two base-storage-cols' },
      col('Backpack', cap.cap ? `${cap.used} / ${cap.cap}` : String(cap.used), pack, 'backpack', 'Your backpack is empty.'),
      col('Cabin storage', `${store.length} stack${store.length === 1 ? '' : 's'}`, store, 'storage', 'Nothing stored. Leave spare gear and keepsakes here to keep your pack light.')),
    el('div', { class: 'base-storage-detail' }, sel
      ? itemDetail(sel, { extra: el('div', { class: 'base-muted' }, `Where: ${L.locateItem(api.profile, sel.id) || 'not owned'}`) })
      : el('div', { class: 'base-muted' }, 'Select an item to read about it. Equipped gear lives in the Equipment station and does not use pack space.')));
}

/* ------------------------------------------------------------------ cabin upgrades */

export function renderUpgrades(api) {
  const defs = Object.values(api.state.cabinUpgrades).sort((a, b) => (a.price - b.price) || a.name.localeCompare(b.name));
  const owned = defs.filter((d) => (api.profile.cabin || []).includes(d.id)).length;
  return el('div', { class: 'base-station base-upgrades' },
    el('div', { class: 'base-photo-head' },
      el('div', { class: 'base-card-title' }, `${owned} of ${defs.length} improvements built`),
      el('div', { class: 'base-muted' }, 'Each one changes the room itself.')),
    el('div', { class: 'base-station-scroll' }, defs.length
      ? el('div', { class: 'base-cards' }, defs.map((d) => {
        const st = L.cabinUpgradeStatus(d, api.profile, api.state.ranks);
        return el('div', { class: 'base-card base-cabin-up' + (st.owned ? ' owned' : '') },
          el('div', { class: 'base-silhouette' }, icon(d.icon || 'cabin', 30)),
          el('div', { class: 'base-card-main' },
            el('div', { class: 'base-card-title' }, d.name, st.owned ? el('span', { class: 'base-chip done' }, icon('check', 12), 'Built') : null),
            el('p', { class: 'base-desc' }, d.desc),
            el('div', { class: 'base-effect' }, icon('upgrade', 14), d.effect),
            st.owned ? null : el('div', { class: 'base-reqs' }, st.issues.filter((i) => i.code === 'rank').map((i) => issueRow(i.text)))),
          el('div', { class: 'base-card-actions' },
            st.owned ? null : priceTag(d.price, (api.profile.credits || 0) >= d.price),
            st.owned ? null : button('Build', { variant: 'primary', icon: 'upgrade', disabled: !st.canBuy,
              onClick: () => api.send('cabin', { action: 'upgrade', id: d.id }, 'coin') })));
      }))
      : emptyState('No cabin improvements are on offer yet.')));
}

/* ------------------------------------------------------------------ rest */

export function renderRest(api) {
  const env = api.env || {};
  const sel = L.REST_OPTIONS.find((o) => o.id === api.view.rest) || L.REST_OPTIONS[0];
  const plans = L.REST_OPTIONS.map((o) => L.restPlan(env, api.stats, o));
  const plan = plans.find((p) => p.option.id === sel.id);
  const wx = (w) => `${WEATHER_NAMES[w] || 'Mild'} skies`;
  const forecastText = (p) => {
    if (p.forecastState === 'ok') return `Forecast: ${wx(p.forecast)}`;
    if (p.forecastState === 'far') return 'Beyond your forecast range';
    return 'You cannot read the sky well enough to forecast yet';
  };
  return el('div', { class: 'base-station base-rest' }, el('div', { class: 'base-station-scroll' },
    el('div', { class: 'base-rest-now' }, icon(WEATHER_ICONS[env.weather] || 'sunny', 22),
      el('div', el('b', `Day ${env.day ?? 1}, ${formatClock(env.time ?? 0)}`),
        el('div', { class: 'base-muted' }, `${SEASON_NAMES[env.season] || ''} · ${WEATHER_NAMES[env.weather] || ''}`))),
    sectionTitle('Rest until...'),
    el('div', { class: 'base-rest-grid' }, plans.map((p) => el('button', { class: 'base-rest-opt' + (p.option.id === sel.id ? ' active' : ''), type: 'button',
      onclick: () => { api.snd('click'); api.view.rest = p.option.id; api.rerender(); } },
      icon(p.option.icon, 22),
      el('div', { class: 'base-rest-label' }, p.option.label),
      el('div', { class: 'base-muted' }, p.wakeClock + (p.nextDay ? ' tomorrow' : '')),
      el('div', { class: 'base-rest-hours' }, p.duration)))),
    el('div', { class: 'base-rest-card' },
      el('div', { class: 'base-hand' }, plan.option.blurb),
      el('div', { class: 'base-rest-facts' },
        el('span', icon('moon', 14), `${plan.duration} will pass`),
        el('span', icon(plan.forecastState === 'ok' ? WEATHER_ICONS[plan.forecast] || 'cloudy' : 'cloudy', 14), forecastText(plan))),
      button(`Rest until ${plan.option.label.toLowerCase()}`, { variant: 'primary', icon: 'moon',
        onClick: () => { api.send('cabin', { action: 'rest', until: plan.option.hour }, 'page'); } }),
      el('div', { class: 'base-muted' }, 'Resting is always safe: the woods will be exactly as you left them, just a little later.'))));
}

