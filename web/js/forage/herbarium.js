// The Herbarium section of the field journal (task c-field): pressed-plant pages.
// Left page: every plant as a small pressed specimen — the ones not found yet only as a
// faint pencil outline with no name (discovery is earned, spec §35). Right page: the
// chosen plant — the drawing, its names, how to recognise it, what it is good for, an
// honest caution, the seasons it bears, where it grows, and the player's own record.
// renderHerbarium(env) follows the journal's section contract: it returns {left, right}.
import { el, icon } from '../ui/kit.js';
import { drawPlantArt, drawItemArt } from './art.js';
import { herbariumModel, seasonTable, SEASON_LABELS, seasonOf } from './logic.js';

function regionName(regions, id) {
  return (regions || []).find((r) => r.id === id)?.name || '';
}

const kv = (k, v) => el('div', { class: 'jr-kv' }, el('span', { class: 'jr-kv-k' }, k), el('span', { class: 'jr-kv-v' }, v));
const head = (title, sub) => el('div', { class: 'jr-page-head' }, el('h2', title), sub ? el('div', { class: 'jr-page-sub' }, sub) : null);

export function renderHerbarium(env) {
  const { ctx, st } = env;
  const state = ctx.state;
  st.herbarium = st.herbarium || { sel: null };
  const hs = st.herbarium;
  const model = herbariumModel(state.welcome?.plants || [], state.profile);
  const found = model.filter((m) => m.entry).length;
  if (!hs.sel || !model.some((m) => m.plant.id === hs.sel)) hs.sel = (model.find((m) => m.entry) || model[0])?.plant.id || null;
  const snd = (n) => { try { ctx.audio?.uiSound?.(n); } catch { /* optional */ } };

  const left = el('div', { class: 'jr-col frg-herb-left' },
    head('Herbarium', `${found} of ${model.length} plants pressed`),
    el('div', { class: 'jr-scroll frg-herb-scroll', 'data-scroll': 'herbarium' },
      el('div', { class: 'frg-herb-grid' }, model.map(({ plant, entry }) => el('button', {
        type: 'button', class: 'frg-herb-cell' + (entry ? '' : ' unknown') + (plant.id === hs.sel ? ' selected' : ''),
        title: entry ? plant.name : 'Not found yet',
        onclick: () => { hs.sel = plant.id; snd('page'); env.rerender(); },
      }, drawPlantArt(plant.id, { size: 78, height: 96, faint: !entry, paper: false, alt: entry ? plant.name : 'An unknown plant' }),
      el('span', { class: 'frg-herb-cell-name' }, entry ? plant.name : '?')))),
      found === 0 ? el('p', { class: 'frg-herb-empty' }, 'No pressed plants yet. Berries, nuts, herbs and mushrooms grow all over the wild: when something looks ripe, step up to it and press E to pick.') : null));

  const sel = model.find((m) => m.plant.id === hs.sel);
  const right = sel ? page(ctx, sel) : el('div', { class: 'jr-col' });
  return { left, right };
}

function page(ctx, { plant, entry }) {
  const state = ctx.state;
  if (!entry) {
    return el('div', { class: 'jr-col frg-herb-page unknown' },
      el('div', { class: 'frg-herb-plate' }, drawPlantArt(plant.id, { size: 220, height: 270, faint: true, alt: 'An unknown plant' })),
      el('h2', { class: 'frg-herb-name' }, 'Not found yet'),
      el('p', { class: 'frg-herb-text frg-faint' }, 'This page is still blank. Somewhere out there grows a plant you have not picked yet; once you have, it will be pressed here.'));
  }
  const now = seasonOf(state.env);
  const seasons = seasonTable(plant);
  const regions = (plant.regions || []).map((r) => regionName(state.regions, r)).filter(Boolean);
  return el('div', { class: 'jr-col frg-herb-page' },
    el('div', { class: 'jr-scroll', 'data-scroll': 'herb-page' },
      el('div', { class: 'frg-herb-top' },
        el('div', { class: 'frg-herb-plate' }, drawPlantArt(plant.id, { size: 172, height: 214, alt: plant.name })),
        el('div', { class: 'frg-herb-titles' },
          el('h2', { class: 'frg-herb-name' }, plant.name),
          plant.sci ? el('div', { class: 'frg-herb-sci' }, plant.sci) : null,
          el('div', { class: 'frg-herb-seasons', role: 'list', 'aria-label': 'When it gives something' }, seasons.map((s) => el('div', {
            role: 'listitem', class: 'frg-season' + (s.items.length ? ' on' : '') + (s.season === now ? ' now' : ''),
            title: s.items.length ? `${SEASON_LABELS[s.season]}: ${s.items.map((i) => state.items?.[i]?.name || i).join(', ')}` : `${SEASON_LABELS[s.season]}: nothing`,
          }, el('span', SEASON_LABELS[s.season]), s.items.map((i) => drawItemArt(i, 22, state.items?.[i]))))),
          el('div', { class: 'frg-herb-record' },
            kv('First picked', `Day ${entry.firstDay || 1}${regionName(state.regions, entry.region) ? ', ' + regionName(state.regions, entry.region) : ''}`),
            kv('Times picked', String(entry.picked || 1)),
            kv('Bears again', `${plant.regrow} days after picking`)))),
      section('How to know it', plant.desc),
      section('Good for', plant.uses, 'camp'),
      plant.caution ? el('div', { class: 'frg-caution' }, icon('warning', 15), el('span', plant.caution)) : null,
      section('Where it grows', [plant.habitat, regions.length ? `In ${regions.join(', ')}.` : ''].filter(Boolean).join('. ').replace('..', '.'), 'map')));
}

function section(title, text, ico = 'leaf') {
  if (!text) return null;
  return el('div', { class: 'frg-herb-section' }, el('h3', icon(ico, 14), title), el('p', text));
}
