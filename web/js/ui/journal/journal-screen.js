// The Field Journal: an open notebook with a two-page spread and section tabs along the
// edge. Fully re-rendered from ctx.state on open() and on every 'profile' event while open.

import { el, fill, icon } from '../kit.js';
import { renderSpecies } from './journal-species.js';
import { renderPhotos, renderRecordings, renderLocations, renderHistory, renderRare } from './journal-sections.js';
import { screenRoot, closeButton, createCallPlayer, keepScroll, uiSound } from './widgets.js';
import { mysteryCards } from './species-logic.js';

const SECTIONS = [
  { id: 'species', label: 'Species', icon: 'bird', render: renderSpecies },
  { id: 'photos', label: 'Photographs', icon: 'camera', render: renderPhotos },
  { id: 'recordings', label: 'Recordings', icon: 'microphone', render: renderRecordings },
  { id: 'locations', label: 'Places', icon: 'compass', render: renderLocations },
  { id: 'history', label: 'Natural History', icon: 'journal', render: renderHistory },
  { id: 'rare', label: 'Rare Discoveries', icon: 'star', render: renderRare },
  // c-field hooks: the Herbarium (web/js/forage/herbarium.js) and the Nests list
  // (web/js/nests/journal.js); both follow this file's {left, right} section contract.
  { id: 'herbarium', label: 'Herbarium', icon: 'leaf', render: (env) => fieldSection(env, 'forage', 'herbarium', 'Pressed plants will appear here.') },
  { id: 'nests', label: 'Nests', icon: 'nest', render: (env) => fieldSection(env, 'nests', 'journalSection', 'Nests you find will appear here.') },
];

/** Renders a section owned by another module, or a quiet blank spread if it is missing. */
function fieldSection(env, mod, fn, blank) {
  try {
    const out = env.ctx[mod]?.[fn]?.(env);
    if (out?.left && out?.right) return out;
  } catch (err) { console.error(`[journal] ${mod}.${fn} failed`, err); }
  return { left: el('div', { class: 'jr-col' }, el('p', blank)), right: el('div', { class: 'jr-col' }) };
}

export function createJournalScreen(ctx) {
  const root = screenRoot(ctx, 'journal');
  const player = createCallPlayer(ctx);
  const drafts = new Map(); // species id -> unsaved note text, survives re-renders
  const st = {
    section: 'species',
    species: { filter: 'all', sel: null, tab: 'about' },
    photos: { subject: 'all', minStars: 0, sel: null },
    recs: { sel: null },
    locs: { sel: null },
    history: { open: new Set() },
    rare: { sel: null },
  };
  let isOpen = false;
  let pending = false; // a profile update arrived while the player was typing a note

  const env = {
    ctx, st, player, drafts,
    rerender() { render(); },
    flushPending() { if (pending) { pending = false; render(); } },
    openPhoto(id) { st.section = 'photos'; st.photos.sel = id; st.photos.subject = 'all'; st.photos.minStars = 0; uiSound(ctx, 'page'); render(); },
  };

  const book = el('div', { class: 'jr-book' });
  root.appendChild(book);

  function render() {
    if (!isOpen || !ctx.state.profile) return;
    const restore = keepScroll(book);
    player.resetSubscriptions();
    const sec = SECTIONS.find((s) => s.id === st.section) || SECTIONS[0];
    const pages = sec.render(env);
    const j = ctx.state.profile.journal || {};
    const badge = {
      species: Object.keys(j.species || {}).length,
      photos: (j.photos || []).length,
      recordings: (j.recordings || []).length,
      locations: Object.keys(j.locations || {}).length,
      history: (j.lore || []).length,
      rare: (j.rare || []).length,
      herbarium: Object.keys(j.plants || {}).length,
      nests: (j.nests || []).length,
    };
    const mysteries = mysteryCards(ctx.state.profile).length;
    fill(book,
      el('div', { class: 'jr-pages' },
        el('div', { class: 'jr-page left' }, pages.left),
        el('div', { class: 'jr-spine' }),
        el('div', { class: 'jr-page right' }, pages.right)),
      el('div', { class: 'jr-tabs', role: 'tablist' }, SECTIONS.map((s) => el('button', {
        type: 'button', role: 'tab', class: 'jr-tab' + (s.id === st.section ? ' active' : ''), title: s.label,
        onclick: () => { if (s.id !== st.section) { st.section = s.id; uiSound(ctx, 'page'); render(); } },
      }, icon(s.icon, 18), el('span', { class: 'jr-tab-label' }, s.label),
      s.id === 'species' && mysteries ? el('span', { class: 'jr-tab-dot', title: `${mysteries} unknown` }, String(mysteries))
        : badge[s.id] ? el('span', { class: 'jr-tab-count' }, String(badge[s.id])) : null))),
      closeButton(ctx, 'journal'));
    restore();
  }

  // A profile update must not wipe a note the player is typing: hold it until they click away.
  ctx.bus.on('profile', () => {
    if (!isOpen) return;
    if (document.activeElement && document.activeElement.tagName === 'TEXTAREA' && root.contains(document.activeElement)) { pending = true; return; }
    render();
  });

  return {
    root,
    closable: true,
    open(data = {}) {
      isOpen = true;
      pending = false;
      const profile = ctx.state.profile;
      if (data.section && SECTIONS.some((s) => s.id === data.section)) st.section = data.section;
      if (data.species && profile?.journal?.species?.[data.species]) {
        st.section = 'species'; st.species.sel = { type: 'species', id: data.species }; st.species.tab = 'about';
      } else if (data.mystery && (profile?.journal?.mysteries || []).some((m) => m.id === data.mystery)) {
        st.section = 'species'; st.species.sel = { type: 'mystery', id: data.mystery };
      }
      uiSound(ctx, 'open');
      render();
    },
    close() { isOpen = false; player.stop(); uiSound(ctx, 'close'); },
  };
}
