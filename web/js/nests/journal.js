// The Nests section of the field journal (task c-field): every nest the player has
// found, newest first — the site, the stage it was in when found, the day and region,
// its owner only once the player has identified that species (the server leaves
// `species` empty until then), and the best photograph of it.
// renderNestJournal(env) follows the journal's section contract: {left, right}.
import { el, icon } from '../ui/kit.js';
import { SITE_WORDS, STAGE_LABELS, nestLine } from './sites.js';

const kv = (k, v) => el('div', { class: 'jr-kv' }, el('span', { class: 'jr-kv-k' }, k), el('span', { class: 'jr-kv-v' }, v));
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

function whereFrom(feet, pos) {
  if (!feet || !pos) return '';
  const dx = pos.x - feet.x, dz = pos.z - feet.z;
  const d = Math.hypot(dx, dz);
  if (d < 15) return 'right here';
  let h = Math.atan2(dx, -dz);
  if (h < 0) h += Math.PI * 2;
  const dir = COMPASS[Math.round(h / (Math.PI / 4)) % 8];
  const m = d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`;
  return `about ${m} ${dir}`;
}

export function renderNestJournal(env) {
  const { ctx, st } = env;
  const state = ctx.state;
  st.nests = st.nests || { sel: null };
  const ns = st.nests;
  const list = [...(state.profile?.journal?.nests || [])].sort((a, b) => (b.day | 0) - (a.day | 0));
  if (!ns.sel || !list.some((n) => n.id === ns.sel)) ns.sel = list[0]?.id || null;
  const region = (id) => (state.regions || []).find((r) => r.id === id)?.name || '';
  const owner = (n) => (n.species && state.speciesById?.[n.species]?.name) || '';
  const snd = (s) => { try { ctx.audio?.uiSound?.(s); } catch { /* optional */ } };
  const owners = new Set(list.filter((n) => n.species).map((n) => n.species));

  const left = el('div', { class: 'jr-col frg-nest-left' },
    el('div', { class: 'jr-page-head' }, el('h2', 'Nests'), el('div', { class: 'jr-page-sub' }, list.length ? `${list.length} found · ${owners.size} known builder${owners.size === 1 ? '' : 's'}` : 'None found yet')),
    el('div', { class: 'jr-scroll', 'data-scroll': 'nests' },
      list.length
        ? el('div', { class: 'frg-nest-list' }, list.map((n) => el('button', {
          type: 'button', class: 'frg-nest-row' + (n.id === ns.sel ? ' selected' : ''),
          onclick: () => { ns.sel = n.id; snd('page'); env.rerender(); },
        }, el('span', { class: `frg-nest-badge stage-${n.stage}` }, icon(n.stage === 2 ? 'egg' : 'nest', 18)),
        el('span', { class: 'frg-nest-row-main' },
          el('b', SITE_WORDS[n.site] || 'A nest'),
          el('span', [STAGE_LABELS[n.stage] || '', `Day ${n.day || 1}`, region(n.region)].filter(Boolean).join(' · '))),
        el('span', { class: 'frg-nest-owner' + (owner(n) ? '' : ' unknown') }, owner(n) || 'Owner unknown'),
        n.photo ? icon('camera', 14) : null)))
        : el('div', { class: 'frg-nest-empty' }, icon('nest', 34),
          el('p', 'No nests yet. In spring and summer, watch where a bird keeps returning with food or nest material, then hold your gaze on the spot. Many nests hide in thick cover, tree holes and reedbeds.'))));

  const sel = list.find((n) => n.id === ns.sel);
  const right = sel ? detail(ctx, sel, region, owner) : el('div', { class: 'jr-col' });
  return { left, right };
}

function detail(ctx, n, region, owner) {
  const state = ctx.state;
  const photo = n.photo ? (state.profile?.journal?.photos || []).find((p) => p.id === n.photo) : null;
  const who = owner(n);
  return el('div', { class: 'jr-col frg-nest-page' },
    el('div', { class: 'jr-scroll', 'data-scroll': 'nest-page' },
      photo?.url
        ? el('figure', { class: 'frg-nest-photo' }, el('img', { src: photo.url, alt: 'Photograph of the nest', draggable: 'false' }), el('figcaption', `Photographed · ${photo.stars || 0}★`))
        : el('div', { class: 'frg-nest-sketch' }, icon(n.stage === 2 ? 'egg' : 'nest', 64), el('span', 'No photograph yet: a nest in the frame earns its own picture.')),
      el('h2', { class: 'frg-nest-title' }, nestLine(n)),
      el('div', { class: 'frg-nest-kv' },
        kv('Site', SITE_WORDS[n.site] || n.site),
        kv('When found', `${STAGE_LABELS[n.stage] || ''}, day ${n.day || 1}`),
        kv('Where', [region(n.region), whereFrom(ctx.player?.feet, n.pos)].filter(Boolean).join(', ')),
        kv('Builder', who || 'Not yet known')),
      who
        ? el('p', { class: 'frg-nest-note' }, `You know the ${who} well enough now to say whose nest this is.`, ' ',
          el('button', { type: 'button', class: 'frg-link', onclick: () => ctx.ui.open('journal', { species: n.species }) }, 'Open its page'))
        : el('p', { class: 'frg-nest-note frg-faint' }, 'Whose nest is it? Watch who comes and goes, and once you have identified the bird its name will be written here.'),
      el('p', { class: 'frg-nest-note frg-faint' }, 'Keep a respectful distance: if the adults start alarm-calling, you are too close.')));
}
