// The "New plant" card (task c-field): when a plant is picked for the first time a
// small pressed-specimen card slides up for a few seconds with its name, its Latin
// name and any recipes it brought to mind. Never interactive; it hides under screens.
import { el, fill, icon } from '../ui/kit.js';
import { drawPlantArt } from './art.js';

const SHOW_MS = 5600;

export function createCards(ctx) {
  const { state, bus } = ctx;
  const host = el('div', { class: 'frg-cards', 'aria-live': 'polite' });
  document.body.appendChild(host);
  let timer = 0;

  bus.on('mode', ({ mode }) => host.classList.toggle('frg-cards-hidden', mode !== 'play'));

  return {
    newPlant(plant, learned) {
      const recipes = (learned || []).map((id) => (state.welcome?.recipes || []).find((r) => r.id === id)?.name || id);
      const card = el('div', { class: 'frg-card' },
        el('div', { class: 'frg-card-art' }, drawPlantArt(plant.id, { size: 96, height: 124, alt: plant.name })),
        el('div', { class: 'frg-card-text' },
          el('div', { class: 'frg-card-kicker' }, icon('leaf', 13), 'New to your herbarium'),
          el('div', { class: 'frg-card-name' }, plant.name),
          plant.sci ? el('div', { class: 'frg-card-sci' }, plant.sci) : null,
          recipes.length ? el('div', { class: 'frg-card-recipes' }, el('span', 'It brings to mind:'), recipes.map((r) => el('b', r))) : null,
          el('div', { class: 'frg-card-hint' }, 'Read about it in your journal (J).')));
      fill(host, card);
      try { ctx.audio?.uiSound?.('discover'); } catch { /* audio is optional */ }
      clearTimeout(timer);
      timer = setTimeout(() => {
        card.classList.add('out');
        setTimeout(() => card.remove(), 700);
      }, SHOW_MS);
    },
  };
}
