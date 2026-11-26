// The field kitchen screen 'cook' (task c-field; docs/contract.md §12). Opened from the
// cabin's Kitchen station (kettle and stove) and from a camp's fire (kettle only).
// Left page: every recipe by station — known ones with what the pack holds against
// what they need, unknown ones as "???" with a hint of how they are learned. Right
// page: the chosen recipe — its painting, what it does, the ingredients, how many to
// make, and Cook. Re-renders from ctx.state on open and on every profile while open.
import { el, fill, icon, button, panel, statLabel, formatMod, statIsGood } from '../ui/kit.js';
import { drawItemArt } from './art.js';
import { cookModel, recipeNeeds, stationAllows, learnHint, missingText, countItem, eatVerb, SLOT_LABELS } from './logic.js';

const PLACE_TEXT = {
  cabin: ['Cabin Kitchen', 'The kettle and the old stove'],
  camp: ['Camp Fire', 'A kettle over the fire. Baking needs the cabin\'s stove.'],
  none: ['Field Recipes', 'No fire here: find a camp or head home to cook'],
};

export function createCookScreen(ctx) {
  const { state, bus, net } = ctx;
  const view = { at: null, poi: null, sel: null, qty: 1, pending: null };
  let isOpen = false;
  const snd = (n) => { try { ctx.audio?.uiSound?.(n); } catch { /* optional */ } };

  const frame = panel({ title: 'Cabin Kitchen', subtitle: '', icon: 'camp', wide: true, onClose: () => ctx.ui.close('cook') });
  const listEl = el('div', { class: 'frg-cook-list kit-scroll' });
  const detailEl = el('div', { class: 'frg-cook-detail kit-scroll' });
  frame.body.classList.add('frg-cook-body');
  frame.body.append(el('div', { class: 'frg-cook-layout' }, listEl, detailEl));
  const footNote = el('div', { class: 'frg-cook-foot' });
  frame.footer.append(footNote, button('Done', { variant: 'primary', icon: 'check', onClick: () => ctx.ui.close('cook') }));
  const root = el('div', { class: 'frg-cook-screen' }, el('div', { class: 'frg-cook-frame' }, frame.root));

  const items = () => state.items || {};
  const recipes = () => state.welcome?.recipes || [];
  const itemName = (id) => items()[id]?.name || id;

  function art(id, size, faint = false) {
    const c = drawItemArt(id, size, items()[id]);
    if (faint) c.classList.add('faint');
    return c;
  }

  function statusTag(e) {
    switch (e.status) {
      case 'ready': return el('span', { class: 'frg-tag ready' }, icon('check', 12), e.batches > 1 ? `Ready ×${e.batches}` : 'Ready');
      case 'missing': return el('span', { class: 'frg-tag missing' }, 'Missing some');
      case 'station': return el('span', { class: 'frg-tag station' }, icon('home', 12), 'Cabin stove');
      case 'nofire': return el('span', { class: 'frg-tag nofire' }, e.ready ? 'Have it all' : 'Missing some');
      default: return el('span', { class: 'frg-tag unknown' }, icon('lock', 11), 'Not learned');
    }
  }

  function renderList(groups) {
    fill(listEl, groups.map((g) => el('section', { class: 'frg-cook-group' + (view.at === 'camp' && g.station === 'stove' ? ' dim' : '') },
      el('h3', { class: 'frg-cook-group-title' }, icon(g.station === 'stove' ? 'home' : 'camp', 15), g.label,
        view.at === 'camp' && g.station === 'stove' ? el('span', { class: 'frg-faint' }, ' · at the cabin only') : null),
      el('div', { class: 'frg-cook-cards' }, g.recipes.map((e) => {
        const r = e.recipe;
        const sel = view.sel === r.id;
        return el('button', {
          type: 'button', class: `frg-recipe ${e.status}${sel ? ' selected' : ''}`,
          onclick: () => { view.sel = r.id; view.qty = 1; snd('page'); render(); },
        },
        el('div', { class: 'frg-recipe-art' }, art(r.output, 40, !e.known)),
        el('div', { class: 'frg-recipe-main' },
          el('div', { class: 'frg-recipe-name' }, e.known ? r.name : '???'),
          e.known
            ? el('div', { class: 'frg-recipe-needs' }, e.inputs.map((x) => el('span', { class: 'frg-need' + (x.ok ? ' ok' : '') }, `${itemName(x.item)} ${x.have}/${x.need}`)))
            : el('div', { class: 'frg-recipe-hint' }, learnHint(r, { plants: state.welcome?.plants, npcs: state.npcs, profile: state.profile }))),
        statusTag(e));
      })))));
  }

  function effectBox(def) {
    const b = def?.buff;
    if (!b) return null;
    const mods = Object.entries(b.mods || {}).filter(([, v]) => v);
    return el('div', { class: 'frg-effect' },
      el('div', { class: 'frg-effect-head' }, el('span', { class: 'frg-slot frg-slot-' + b.slot }, SLOT_LABELS[b.slot] || b.slot), el('span', { class: 'frg-faint' }, `${b.hours} in-game hours`)),
      el('div', { class: 'frg-effect-text' }, b.text),
      mods.length ? el('ul', { class: 'frg-mods' }, mods.map(([k, v]) => el('li', { class: statIsGood(k, v) ? 'good' : 'bad' }, el('b', formatMod(k, v)), ' ', statLabel(k)))) : null,
      el('div', { class: 'frg-faint frg-effect-note' }, 'One drink, one meal and one snack can work at once; a new one replaces the last of its kind.'));
  }

  function renderDetail(groups) {
    const all = groups.flatMap((g) => g.recipes);
    let e = all.find((x) => x.recipe.id === view.sel);
    if (!e) { e = all.find((x) => x.status === 'ready') || all.find((x) => x.known) || all[0]; view.sel = e?.recipe.id || null; }
    if (!e) { fill(detailEl, el('div', { class: 'frg-empty' }, 'No recipes yet.')); return; }
    const r = e.recipe, def = items()[r.output];
    if (!e.known) {
      fill(detailEl,
        el('div', { class: 'frg-detail-head' }, el('div', { class: 'frg-detail-art faint' }, art(r.output, 88, true)),
          el('div', el('h2', { class: 'frg-detail-name' }, '???'), el('div', { class: 'frg-faint' }, r.station === 'stove' ? 'A stove recipe' : 'A kettle recipe'))),
        el('p', { class: 'frg-detail-desc' }, 'You have not learned this one yet.'),
        el('div', { class: 'frg-hint-box' }, icon('leaf', 16), learnHint(r, { plants: state.welcome?.plants, npcs: state.npcs, profile: state.profile })));
      return;
    }
    const needs = recipeNeeds(r, state.profile);
    const allowed = stationAllows(view.at, r);
    const max = Math.max(1, Math.min(99, needs.batches));
    view.qty = Math.max(1, Math.min(view.qty, max));
    const inPack = countItem(state.profile, r.output);
    let reason = '';
    if (!view.at) reason = 'You need a fire for that: the cabin\'s kitchen, or a camp\'s fire.';
    else if (!allowed) reason = `${r.name} needs the stove at the cabin.`;
    else if (!needs.ready) reason = `For ${r.name} you still need ${missingText(needs, items())}.`;
    const canCook = !reason && !view.pending;

    const qtyEl = el('div', { class: 'frg-qty' + (canCook && max > 1 ? '' : ' off') },
      button('', { icon: 'minus', title: 'Fewer', small: true, disabled: !canCook || view.qty <= 1, onClick: () => { view.qty--; snd('click'); render(); } }),
      el('span', { class: 'frg-qty-n' }, String(view.qty)),
      button('', { icon: 'plus', title: 'More', small: true, disabled: !canCook || view.qty >= max, onClick: () => { view.qty++; snd('click'); render(); } }));

    fill(detailEl,
      el('div', { class: 'frg-detail-head' },
        el('div', { class: 'frg-detail-art' }, art(r.output, 88)),
        el('div',
          el('h2', { class: 'frg-detail-name' }, r.name),
          el('div', { class: 'frg-faint' }, `${r.station === 'stove' ? 'On the stove' : 'Over the kettle'} · makes ${r.qty} per batch`),
          inPack ? el('div', { class: 'frg-inpack' }, `${inPack} in your pack`) : null)),
      el('p', { class: 'frg-detail-desc' }, r.desc || def?.desc || ''),
      effectBox(def),
      el('h3', { class: 'frg-sub' }, 'Ingredients'),
      el('ul', { class: 'frg-ingredients' }, needs.inputs.map((x) => el('li', { class: x.ok ? 'ok' : 'short' },
        el('span', { class: 'frg-ing-art' }, art(x.item, 30)),
        el('span', { class: 'frg-ing-name' }, itemName(x.item)),
        el('span', { class: 'frg-ing-count' }, el('b', String(x.have)), ` / ${x.need * view.qty}`),
        x.have >= x.need * view.qty ? icon('check', 14) : el('span', { class: 'frg-ing-short' }, `${Math.max(0, x.need * view.qty - x.have)} short`)))),
      el('div', { class: 'frg-cook-actions' },
        qtyEl,
        button(view.pending ? 'Cooking…' : `Cook ${view.qty > 1 ? `×${view.qty}` : ''}`.trim(), {
          variant: 'primary', icon: 'camp', disabled: !canCook,
          onClick: () => {
            view.pending = r.id;
            net.send('cook', { recipe: r.id, qty: view.qty });
            snd('click');
            render();
            setTimeout(() => { if (view.pending === r.id) { view.pending = null; if (isOpen) render(); } }, 4000);
          },
        }),
        inPack && def?.use === 'eat' ? button(`${eatVerb(def)} one`, { variant: 'secondary', onClick: () => { net.send('use', { item: r.output }); snd('click'); } }) : null),
      reason ? el('div', { class: 'frg-reason' }, icon('info', 14), reason) : null);
  }

  function render() {
    if (!isOpen || !state.profile) return;
    const [title, sub] = PLACE_TEXT[view.at || 'none'];
    const poi = view.poi && state.pois?.[view.poi];
    frame.setTitle(view.at === 'camp' && poi?.name ? poi.name : title, sub);
    frame.setIcon(view.at === 'cabin' ? 'cabin' : 'camp');
    const groups = cookModel(recipes(), state.profile, view.at);
    const known = groups.reduce((n, g) => n + g.recipes.filter((e) => e.known).length, 0);
    const total = groups.reduce((n, g) => n + g.recipes.length, 0);
    fill(footNote, icon('journal', 14), `${known} of ${total} recipes known. Cooking never uses what is in cabin storage.`);
    const keep = listEl.scrollTop;
    renderList(groups);
    renderDetail(groups);
    listEl.scrollTop = keep;
  }

  bus.on('profile', () => { view.pending = null; if (isOpen) render(); });
  bus.on('net:error', () => { if (view.pending) { view.pending = null; if (isOpen) render(); } });

  ctx.ui.register('cook', {
    root,
    open(data = {}) {
      isOpen = true;
      view.at = data.at === 'cabin' || data.at === 'camp' ? data.at : null;
      view.poi = data.poi || null;
      if (data.recipe) view.sel = data.recipe;
      view.pending = null;
      snd('open');
      render();
    },
    close() { isOpen = false; snd('close'); },
    overlay: false,
    closable: true,
  });

  return { render };
}
