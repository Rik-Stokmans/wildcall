// Weather & Time page of the Field Journal (spec screen 19, §20): today's clock and day
// phase with what wildlife is doing, the season and day, the weather with its effects on
// hearing, seeing, photography and bird activity, and the forecast Weather Sense allows.
// Follows the journal's {left, right} section contract; re-rendered on every 'env' tick
// while open (journal-screen.js).

import { el, icon, formatClock, WEATHER_NAMES, WEATHER_ICONS, SEASON_NAMES } from '../kit.js';
import {
  DAY_PHASES, currentPhase, hoursToNextPhase, hoursText, weatherEffects, forecastRows, forecastNote,
  windWord, rainWord, mistWord, cloudWord, weatherSlows,
} from './sky-logic.js';
import { formatDay } from './format.js';
import { sectionTitle } from './widgets.js';

const SEASON_ICONS = ['leaf', 'sunny', 'leaf', 'snow'];
const SEASON_LINES = [
  'Birds are pairing up and nesting; songs are at their fullest.',
  'Young birds are about; the dawn chorus starts very early.',
  'Migrants pass through and some birds fall quiet.',
  'Winter visitors arrive; the resident birds flock together.',
];

/** A 24-hour strip, one band per day phase, with a marker at the current time. */
function dayStrip(env) {
  const now = ((env.time % 24) + 24) % 24;
  const bands = [];
  // Night wraps midnight: draw it as two bands.
  for (const p of DAY_PHASES) {
    if (p.from > p.to) {
      bands.push({ p, a: p.from, b: 24 }, { p, a: 0, b: p.to });
    } else bands.push({ p, a: p.from, b: p.to });
  }
  const cur = DAY_PHASES[currentPhase(env)].id;
  return el('div', { class: 'jr-sky-strip', 'aria-hidden': 'true' },
    bands.map(({ p, a, b }) => el('div', {
      class: 'jr-sky-band jr-sky-' + p.id.toLowerCase() + (p.id === cur ? ' now' : ''),
      style: { left: (a / 24 * 100) + '%', width: ((b - a) / 24 * 100) + '%' },
    })),
    [0, 6, 12, 18].map((h) => el('span', { class: 'jr-sky-hour', style: { left: (h / 24 * 100) + '%' } }, String(h).padStart(2, '0'))),
    el('div', { class: 'jr-sky-now', style: { left: (now / 24 * 100) + '%' } }, el('i')));
}

export function renderSky(env) {
  const { ctx } = env;
  const e = ctx.state.env || {};
  const stats = ctx.state.stats || {};
  const pi = currentPhase(e);
  const phase = DAY_PHASES[pi];
  const season = Math.max(0, Math.min(3, e.season | 0));
  const next = DAY_PHASES[(pi + 1) % DAY_PHASES.length];

  const left = el('div', { class: 'jr-col jr-sky' },
    el('div', { class: 'jr-page-head' },
      el('h2', 'Weather & Time'),
      el('div', { class: 'jr-page-sub' }, `${formatDay(e.day)} · ${SEASON_NAMES[season]}`)),
    el('div', { class: 'jr-scroll', 'data-scroll': 'sky-left' },
      el('div', { class: 'jr-sky-clock' },
        el('span', { class: 'jr-sky-clock-icon' }, icon(phase.icon, 30)),
        el('div',
          el('div', { class: 'jr-sky-time' }, formatClock(e.time)),
          el('div', { class: 'jr-sky-phase' }, phase.id, el('small', ` · ${next.id} in ${hoursText(hoursToNextPhase(e.time)) || 'a moment'}`)))),
      dayStrip(e),
      el('p', { class: 'jr-sky-lede' }, phase.more),
      sectionTitle('Through the day', 'what the birds are doing'),
      el('ul', { class: 'jr-sky-phases' }, DAY_PHASES.map((p, i) => el('li', { class: i === pi ? 'now' : '' },
        el('span', { class: 'jr-sky-ph-icon' }, icon(p.icon, 15)),
        el('span', { class: 'jr-sky-ph-name' }, p.id),
        el('span', { class: 'jr-sky-ph-hours' }, `${formatClock(p.from)}–${formatClock(p.to)}`),
        el('span', { class: 'jr-sky-ph-act' }, p.activity)))),
      sectionTitle('Season'),
      el('div', { class: 'jr-sky-season' },
        el('span', { class: 'jr-sky-season-icon' }, icon(SEASON_ICONS[season], 20)),
        el('div', el('b', `${SEASON_NAMES[season]}, ${formatDay(e.day).toLowerCase()}`), el('p', SEASON_LINES[season])))));

  const w = e.weather | 0;
  const effects = weatherEffects(e, stats);
  const rows = forecastRows(e.forecast, e.time, stats.forecast || 0);
  const slows = weatherSlows(e, stats);
  const right = el('div', { class: 'jr-col jr-sky' },
    el('div', { class: 'jr-scroll', 'data-scroll': 'sky-right' },
      el('div', { class: 'jr-sky-now-weather' },
        el('span', { class: 'jr-sky-wx-icon' }, icon(WEATHER_ICONS[w] || 'sunny', 44)),
        el('div',
          el('div', { class: 'jr-sky-wx-name' }, WEATHER_NAMES[w] || 'Fair'),
          el('div', { class: 'jr-sky-wx-words' }, [windWord(e.wind), rainWord(e.rain), cloudWord(e.cloud), (e.mist || 0) > 0.1 ? mistWord(e.mist) : ''].filter(Boolean).join(' · ')))),
      sectionTitle('What it means in the field'),
      el('div', { class: 'jr-sky-effects' }, effects.map((f) => el('div', { class: 'jr-sky-effect ' + f.tone },
        el('span', { class: 'jr-sky-effect-icon' }, icon(f.icon, 16)),
        el('div', el('b', f.title), el('p', f.text))))),
      slows ? el('p', { class: 'jr-sky-foot' }, icon('footprint', 14), el('span', 'The weather slows your steps a little. Rain gear lets you walk at your usual pace.')) : null,
      sectionTitle('Forecast', rows.length ? `next ${Math.round(Math.min(12, stats.forecast || 0))} hours` : ''),
      rows.length ? el('div', { class: 'jr-sky-forecast' }, rows.map((r) => el('div', { class: 'jr-sky-fc' },
        el('span', { class: 'jr-sky-fc-time' }, formatClock(r.hour)),
        icon(WEATHER_ICONS[r.weather] || 'sunny', 22),
        el('span', { class: 'jr-sky-fc-name' }, WEATHER_NAMES[r.weather] || '')))) : null,
      el('p', { class: 'jr-sky-note' }, forecastNote(stats.forecast || 0, (e.forecast || []).length))));
  return { left, right };
}
