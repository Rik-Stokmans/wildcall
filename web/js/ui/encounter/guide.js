// The field-guide browser used inside the identification screen: every species of the
// player's unlocked regions, filters (size, shape, colour, habitat, call pattern), a detail
// pane with ID tips and call playback, and a side-by-side comparison of two species.
//
// Naming rule: the guide lists species BY NAME (it is the player's reference book at work,
// like the candidate table), but never shows colour art or rarity for a species the player
// has not identified yet - those get silhouettes and their text traits only.
import { label, rarityBadge } from '../kit.js';
import { el, fill, button, ico, sound, speciesArt, isIdentified, wildRarityToKit } from './shell.js';
import { guideSpecies, filterSpecies, filterOptions, compareRows, habitatNoun, traitFit } from './logic.js';

const FILTERS = [
  ['size', 'Size'], ['shape', 'Shape'], ['colour', 'Colour'], ['habitat', 'Habitat'], ['pattern', 'Call'],
];

/**
 * @param ctx   game context
 * @param opts  { onPick(speciesId) }
 * @returns { root, set({profile, evidence, wrong, selected}), show(speciesId), stopAudio() }
 */
export function createGuide(ctx, opts = {}) {
  const S = {
    profile: null, evidence: {}, wrong: [], selected: '',
    filters: { size: '', shape: '', colour: '', habitat: '', pattern: '', query: '' },
    fitOnly: false, detail: '', compare: '', playing: null, playingKey: '',
  };
  const listEl = el('div', { class: 'enc-guide-list', role: 'listbox' });
  const detailEl = el('div', { class: 'enc-guide-detail' });
  const countEl = el('span', { class: 'enc-guide-count' });
  const selects = {};
  let all = [], opt = {};

  const toolbar = el('div', { class: 'enc-guide-tools' });
  const search = el('input', {
    class: 'enc-input', type: 'search', placeholder: 'Search name or family', 'aria-label': 'Search the field guide',
    oninput: (e) => { S.filters.query = e.target.value; refresh(); },
  });
  const fitBox = el('input', { type: 'checkbox', id: 'enc-fit', onchange: (e) => { S.fitOnly = e.target.checked; refresh(); } });
  const reset = button('Clear', { variant: 'ghost', small: true, onClick: () => {
    for (const k of Object.keys(S.filters)) S.filters[k] = '';
    S.fitOnly = false; fitBox.checked = false; search.value = '';
    for (const s of Object.values(selects)) s.value = '';
    sound(ctx, 'click'); refresh();
  } });
  toolbar.append(search);
  for (const [key, text] of FILTERS) {
    const sel = el('select', { class: 'enc-select', 'aria-label': text + ' filter', onchange: (e) => { S.filters[key] = e.target.value; sound(ctx, 'click'); refresh(); } });
    selects[key] = sel;
    toolbar.append(sel);
  }
  toolbar.append(el('label', { class: 'enc-check', for: 'enc-fit', title: 'Hide species that contradict your field notes' }, fitBox, 'Fits my notes'), reset, countEl);

  const root = el('div', { class: 'enc-guide' }, toolbar, el('div', { class: 'enc-guide-main' }, listEl, detailEl));

  function buildOptions() {
    opt = filterOptions(all);
    for (const [key, text] of FILTERS) {
      const sel = selects[key];
      const cur = S.filters[key];
      fill(sel, el('option', { value: '' }, text + ': any'),
        ...opt[key].map((v) => el('option', { value: v }, key === 'habitat' ? label(habitatNoun(v)) : label(v))));
      sel.value = opt[key].includes(cur) ? cur : '';
      if (sel.value !== cur) S.filters[key] = sel.value;
    }
  }

  function visible() {
    return filterSpecies(all, S.filters, { fitOnly: S.fitOnly, evidence: S.evidence });
  }

  function refresh() {
    const list = visible();
    countEl.textContent = `${list.length} of ${all.length}`;
    fill(listEl, list.length ? list.map(row) : el('div', { class: 'enc-empty' }, 'No species match these filters.'));
    if (!S.detail || !all.some((s) => s.id === S.detail)) S.detail = list[0]?.id || '';
    renderDetail();
  }

  function row(sp) {
    const known = isIdentified(S.profile, sp.id);
    const ruled = S.wrong.includes(sp.id);
    const fit = traitFit(sp, S.evidence);
    const cls = ['enc-guide-row', S.detail === sp.id ? 'active' : '', S.selected === sp.id ? 'chosen' : '', ruled ? 'ruled' : '', fit.mismatch ? 'dim' : ''].join(' ');
    return el('button', {
      class: cls, type: 'button', role: 'option', 'aria-selected': S.detail === sp.id,
      title: fit.mismatch ? 'Some of your notes do not fit this species' : '',
      onclick: () => { S.detail = sp.id; S.compare = ''; sound(ctx, 'click'); refresh(); },
    },
    speciesArt(sp, { size: 44, identified: known }),
    el('span', { class: 'enc-guide-name' }, sp.name, ruled ? el('em', {}, 'ruled out') : null),
    known ? el('span', { class: 'enc-guide-known', title: 'In your journal' }, ico('check', 14)) : null);
  }

  function stopAudio() {
    try { S.playing?.stop?.(); } catch { /* ignore */ }
    S.playing = null; S.playingKey = '';
  }

  function playCall(sp, i) {
    const key = `${sp.id}:${i}`;
    const wasPlaying = S.playingKey === key;
    stopAudio();
    if (wasPlaying) { renderDetail(); return; }
    try {
      ctx.audio?.resume?.();
      S.playing = ctx.audio?.playCall?.(sp.index, i, {}) || null;
      S.playingKey = key;
    } catch (err) { console.warn('[encounter] playCall failed', err); }
    sound(ctx, 'click');
    renderDetail();
    // The synth handle has no end callback in the contract; release the highlight after the bout.
    const c = sp.calls?.[i];
    const secs = Math.min(12, ((c?.notes || []).reduce((t, n) => t + (n.dur || 0) + (n.gap || 0), 0) || 1.5) * ((c?.repeat?.[1] || 1)) + 0.4);
    setTimeout(() => { if (S.playingKey === key) { S.playing = null; S.playingKey = ''; renderDetail(); } }, secs * 1000);
  }

  function chips(items) { return el('div', { class: 'enc-chips' }, items.filter(Boolean).map((t) => el('span', { class: 'enc-chip' }, t))); }

  function detailFor(sp) {
    const known = isIdentified(S.profile, sp.id);
    const similar = (sp.similar || []).map((id) => all.find((s) => s.id === id)).filter(Boolean);
    const habs = (sp.habitats || []).slice().sort((a, b) => b.weight - a.weight).slice(0, 3).map((h) => label(habitatNoun(h.habitat)));
    const t = sp.traits || {};
    return el('div', { class: 'enc-species' },
      el('div', { class: 'enc-species-head' },
        speciesArt(sp, { size: 120, identified: known, background: true }),
        el('div', { class: 'enc-species-titles' },
          el('h3', {}, sp.name),
          el('div', { class: 'enc-sci' }, sp.sci, ' · ', sp.family),
          known ? el('div', { class: 'enc-species-tags' }, rarityBadge(wildRarityToKit(sp.rarity)), el('span', { class: 'enc-tag-known' }, ico('check', 13), 'In your journal'))
            : el('div', { class: 'enc-species-tags' }, el('span', { class: 'enc-tag-unknown' }, 'Not yet in your journal')),
          chips([t.size && label(t.size), t.shape && `${label(t.shape)}-like`, t.primary && label(t.primary), t.secondary && label(t.secondary), t.bill && `Bill: ${t.bill}`]))),
      el('p', { class: 'enc-species-desc' }, sp.desc),
      sp.idTips ? el('div', { class: 'enc-tips' }, el('div', { class: 'enc-tips-title' }, 'How to tell it apart'), el('p', {}, sp.idTips)) : null,
      t.marking ? el('div', { class: 'enc-line' }, el('b', {}, 'Key mark: '), t.marking) : null,
      el('div', { class: 'enc-line' }, el('b', {}, 'Habitat: '), habs.join(', ') || 'unknown'),
      (sp.calls || []).length ? el('div', { class: 'enc-calls' },
        el('div', { class: 'enc-tips-title' }, 'Calls'),
        (sp.calls || []).map((c, i) => {
          const on = S.playingKey === `${sp.id}:${i}`;
          return el('button', {
            class: 'enc-call' + (on ? ' playing' : ''), type: 'button', disabled: !ctx.audio?.playCall,
            title: ctx.audio?.playCall ? 'Play this call' : 'Audio is not available',
            onclick: () => playCall(sp, i),
          }, ico(on ? 'stop' : 'play', 14), el('span', {}, `${label(c.kind)}: ${[c.pitch, c.pattern].filter(Boolean).join(', ')}`));
        })) : null,
      el('div', { class: 'enc-species-actions' },
        opts.onPick ? button(S.selected === sp.id ? 'Chosen for identification' : 'Choose this species', { variant: S.selected === sp.id ? 'secondary' : 'primary', icon: 'check', disabled: S.selected === sp.id, onClick: () => opts.onPick(sp.id) }) : null,
        ...similar.map((o) => button(`Compare with ${o.name}`, { variant: 'ghost', small: true, icon: 'search', onClick: () => { S.compare = o.id; sound(ctx, 'page'); renderDetail(); } })),
        similar.length === 0 && all.length > 1 ? button('Compare with…', { variant: 'ghost', small: true, onClick: () => { S.compare = pickOther(sp.id); sound(ctx, 'page'); renderDetail(); } }) : null));
  }

  function pickOther(id) {
    const v = visible().filter((s) => s.id !== id);
    return (v[0] || all.find((s) => s.id !== id) || {}).id || '';
  }

  function compareView(a, b) {
    const rows = compareRows(a, b);
    const art = (sp) => speciesArt(sp, { size: 110, identified: isIdentified(S.profile, sp.id), background: true });
    const options = all.filter((s) => s.id !== a.id);
    const picker = el('select', { class: 'enc-select', 'aria-label': 'Compare with', onchange: (e) => { S.compare = e.target.value; sound(ctx, 'click'); renderDetail(); } },
      options.map((s) => el('option', { value: s.id, selected: s.id === b.id }, s.name)));
    return el('div', { class: 'enc-compare' },
      el('div', { class: 'enc-compare-head' }, el('h3', {}, 'Side by side'), picker, button('Done', { variant: 'ghost', small: true, onClick: () => { S.compare = ''; renderDetail(); } })),
      el('div', { class: 'enc-compare-grid' },
        el('div', { class: 'enc-compare-col' }, art(a), el('b', {}, a.name)),
        el('div', { class: 'enc-compare-mid' }),
        el('div', { class: 'enc-compare-col' }, art(b), el('b', {}, b.name)),
        rows.map((r) => [
          el('div', { class: 'enc-cmp-cell' + (r.same ? ' same' : ' diff') }, label(r.a)),
          el('div', { class: 'enc-cmp-label' }, r.label),
          el('div', { class: 'enc-cmp-cell' + (r.same ? ' same' : ' diff') }, label(r.b)),
        ])),
      a.idTips || b.idTips ? el('div', { class: 'enc-compare-tips' },
        el('div', {}, el('b', {}, a.name + ': '), a.idTips || ''), el('div', {}, el('b', {}, b.name + ': '), b.idTips || '')) : null,
      el('div', { class: 'enc-species-actions' },
        opts.onPick ? [button(`Choose ${a.name}`, { variant: 'secondary', small: true, onClick: () => opts.onPick(a.id) }),
          button(`Choose ${b.name}`, { variant: 'secondary', small: true, onClick: () => opts.onPick(b.id) })] : null));
  }

  function renderDetail() {
    const sp = all.find((s) => s.id === S.detail);
    if (!sp) { fill(detailEl, el('div', { class: 'enc-empty' }, 'Choose a species to read about it.')); return; }
    const other = S.compare && all.find((s) => s.id === S.compare);
    const scroll = detailEl.scrollTop;
    fill(detailEl, other ? compareView(sp, other) : detailFor(sp));
    detailEl.scrollTop = scroll;
  }

  return {
    root,
    /** Feed the guide the current game facts; call on every render. */
    set({ profile, evidence, wrong, selected }) {
      S.profile = profile; S.evidence = evidence || {}; S.wrong = wrong || [];
      S.selected = selected || '';
      all = guideSpecies(ctx.state.species, profile?.regions);
      buildOptions();
      refresh();
    },
    /** Jump to a species (clears filters that would hide it). */
    show(id) {
      if (!all.some((s) => s.id === id)) return;
      if (!visible().some((s) => s.id === id)) {
        for (const k of Object.keys(S.filters)) S.filters[k] = '';
        S.fitOnly = false; fitBox.checked = false; search.value = '';
        for (const s of Object.values(selects)) s.value = '';
      }
      S.detail = id; S.compare = '';
      refresh();
    },
    stopAudio,
    reset() {
      stopAudio();
      for (const k of Object.keys(S.filters)) S.filters[k] = '';
      S.fitOnly = false; S.detail = ''; S.compare = ''; fitBox.checked = false; search.value = '';
    },
  };
}
