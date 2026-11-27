// Screen "identify": Observation & Identification (spec §13, §28 screen 3).
// Left: the field sketch (built only from evidence), where/when, the evidence list.
// Right: candidate table and the field-guide browser. Bottom: Submit / Keep observing.
// The identifyResult is shown inline as a gentle card; nothing here punishes a wrong guess.
import { tabs, progressBar, rarityBadge, birdIllustration } from '../kit.js';
import { el, fill, button, ico, sound, speciesArt, isIdentified, screenFrame, watchProfile, wildRarityToKit } from './shell.js';
import { createGuide } from './guide.js';
import {
  evidenceRows, evidenceCount, revealKeys, orderCandidates, confidenceTone, confidenceNote, sketchSpecies,
  resultView, nearestPlace, CERTAIN_CONFIDENCE,
} from './logic.js';

const SUBMIT_TIMEOUT_MS = 8000;

export function createIdentify(ctx) {
  const { state, net, bus, ui } = ctx;
  const S = { id: '', fallback: null, selected: '', tab: 'candidates', result: null, sighting: null, submitting: false };
  let submitTimer = 0;

  const frame = screenFrame({
    cls: 'enc-identify', title: 'Field Notes', subtitle: 'Observation & identification', iconName: 'journal', wide: true,
    onClose: () => closeScreen(),
  });
  const guide = createGuide(ctx, { onPick: (id) => select(id, true) });
  const left = el('div', { class: 'enc-id-left' });
  const right = el('div', { class: 'enc-id-right' });
  const resultLayer = el('div', { class: 'enc-result-layer', hidden: true });
  frame.body.classList.add('enc-id-body');
  frame.body.append(left, right);
  frame.card.append(resultLayer);
  const candidatesPane = el('div', { class: 'enc-cand-pane' });
  const tabBar = tabs([{ id: 'candidates', label: 'Candidates', icon: 'search' }, { id: 'guide', label: 'Field guide', icon: 'journal' }], S.tab, (id) => { S.tab = id; syncTab(); });
  right.append(tabBar, candidatesPane, guide.root);

  function closeScreen() { sound(ctx, 'close'); ui.close('identify'); }

  /* ------------------------------------------------------------------ data */

  /** The mystery being identified, merged with the live sighting if it is the same bird. */
  function current() {
    const list = state.profile?.journal?.mysteries || [];
    let m = list.find((x) => x.id === S.id) || null;
    const sg = S.sighting && S.sighting.mystery === S.id ? S.sighting : null;
    if (!m && S.fallback) m = S.fallback;
    if (!m && sg) m = { id: S.id, label: 'Unknown bird', level: 3, evidence: {}, wrong: [], candidates: [], region: -1, heard: 0, seen: 1 };
    if (!m) return null;
    return {
      m,
      evidence: { ...(m.evidence || {}), ...(sg?.evidence || {}) },
      candidates: sg?.candidates?.length ? sg.candidates : (m.candidates || []),
      wrong: m.wrong || [],
      live: !!sg,
    };
  }

  function sig() {
    const c = current();
    return JSON.stringify([S.id, c && [c.evidence, c.candidates, c.wrong, c.m.heard, c.m.seen], state.profile?.regions, Object.keys(state.profile?.journal?.species || {}).length]);
  }
  const watch = watchProfile(ctx, () => ui.isOpen('identify'), sig, () => render());

  /* ------------------------------------------------------------------ left */

  function renderLeft(c) {
    if (!c) return fill(left, el('div', { class: 'enc-empty' }, 'Nothing to identify here.'));
    const { m, evidence } = c;
    const shapeKnown = !!evidence.shape;
    const sketch = sketchSpecies(evidence, state.species, c.candidates);
    let art;
    try {
      art = birdIllustration(sketch, shapeKnown
        ? { size: 150, reveal: revealKeys(evidence), background: true }
        : { size: 150, silhouette: true, background: true });
      art.classList.add('enc-art');
    } catch { art = el('div', { class: 'enc-art' }); }
    const region = state.regions.find((r) => r.id === m.region)?.name || '';
    const place = nearestPlace(m.pos, state.profile?.journal?.locations);
    const where = [place ? `near ${place}` : '', region].filter(Boolean).join(', ');
    const when = m.firstDay ? `Day ${m.firstDay}` : '';
    const n = evidenceCount(evidence);
    const rows = evidenceRows(evidence);
    fill(left,
      el('div', { class: 'enc-sketch' },
        el('div', { class: 'enc-sketch-art' }, art, c.live ? el('span', { class: 'enc-live', title: 'Still in view' }, 'in view') : null),
        el('div', { class: 'enc-sketch-info' },
        el('div', { class: 'enc-sketch-label' }, m.label || 'Unknown bird'),
        el('div', { class: 'enc-sketch-meta' },
          where ? el('div', {}, ico('pin', 14), `Noticed ${where}`) : null,
          when ? el('div', {}, ico('dawn', 14), when) : null,
          el('div', {}, ico('ear', 14), `Heard ${m.heard | 0}×`, ' · ', ico('eye', 14), `Seen ${m.seen | 0}×`),
          m.photos?.length || m.recs?.length ? el('div', {}, ico('camera', 14), `${m.photos?.length | 0} photo${m.photos?.length === 1 ? '' : 's'}`, ' · ', ico('recorder', 14), `${m.recs?.length | 0} recording${m.recs?.length === 1 ? '' : 's'}`) : null))),
      el('div', { class: 'enc-evidence' },
        el('div', { class: 'enc-evidence-head' }, el('h4', {}, 'What I have noted'), el('span', { class: 'enc-count' }, `${n} / 11`)),
        el('ul', { class: 'enc-ev-list' }, rows.map((r) => el('li', { class: 'enc-ev-row ' + (r.known ? 'known' : 'missing'), title: r.known ? '' : r.hint },
          el('span', { class: 'enc-ev-label' }, r.label), el('span', { class: 'enc-ev-value' }, r.text),
          r.known ? null : el('span', { class: 'enc-ev-hint' }, r.hint))))));
  }

  /* ------------------------------------------------------------ candidates */

  function renderCandidates(c) {
    if (!c) return fill(candidatesPane);
    const rows = orderCandidates(c.candidates, c.wrong, state.speciesById);
    const live = rows.filter((r) => !r.ruledOut);
    const n = evidenceCount(c.evidence);
    const top = live[0]?.confidence || 0;
    const table = el('div', { class: 'enc-cand-table' });
    if (!rows.length) {
      table.append(el('div', { class: 'enc-empty' }, n < 2
        ? 'Your notes are still too thin to suggest anything. Keep observing, or leaf through the field guide.'
        : 'Nothing fits your notes yet. The field guide may help.'));
    }
    for (const r of rows) {
      const sp = state.speciesById[r.species];
      const bar = progressBar(r.confidence, 100, { height: 10 });
      bar.classList.add('enc-bar', 'tone-' + confidenceTone(r.confidence));
      table.append(el('button', {
        class: 'enc-cand' + (S.selected === r.species ? ' chosen' : '') + (r.ruledOut ? ' ruled' : ''), type: 'button',
        'aria-pressed': S.selected === r.species,
        onclick: () => select(r.species, false),
      },
      sp ? speciesArt(sp, { size: 52, identified: isIdentified(state.profile, sp.id), evidence: c.evidence }) : el('div', { class: 'enc-art' }),
      el('div', { class: 'enc-cand-main' },
        el('div', { class: 'enc-cand-name' }, r.name, r.ruledOut ? el('em', {}, 'ruled out') : null),
        r.ruledOut ? el('div', { class: 'enc-cand-sub' }, 'You crossed this one off.')
          : el('div', { class: 'enc-cand-barwrap' }, bar, el('span', { class: 'enc-cand-tick', style: { left: CERTAIN_CONFIDENCE + '%' }, title: `About ${CERTAIN_CONFIDENCE}% is needed to be sure` }))),
      el('div', { class: 'enc-cand-pct' }, r.ruledOut ? '—' : r.confidence + '%'),
      S.selected === r.species ? el('span', { class: 'enc-cand-check' }, ico('check', 16)) : null));
    }
    const sel = S.selected && state.speciesById[S.selected];
    fill(candidatesPane,
      el('div', { class: 'enc-cand-head' }, el('h4', {}, 'Possible identification'), el('span', { class: 'enc-cand-note' }, confidenceNote(top, n))),
      table,
      sel ? el('div', { class: 'enc-cand-selected' },
        el('div', {}, el('b', {}, sel.name), ' ', el('span', { class: 'enc-sci' }, sel.sci)),
        sel.idTips ? el('p', {}, sel.idTips) : null,
        button('See in the field guide', { variant: 'ghost', small: true, icon: 'journal', onClick: () => { S.tab = 'guide'; syncTab(); guide.show(sel.id); sound(ctx, 'page'); } }))
        : el('div', { class: 'enc-cand-selected hint' }, rows.length ? 'Choose a species to read how to tell it apart, then submit your identification.' : ''));
  }

  /* --------------------------------------------------------------- actions */

  function select(id, fromGuide) {
    S.selected = id;
    sound(ctx, 'click');
    if (fromGuide) S.tab = 'guide';
    render();
  }

  function submit() {
    if (!S.selected || S.submitting) return;
    S.submitting = true;
    sound(ctx, 'click');
    net.send('identify', { mystery: S.id, species: S.selected });
    clearTimeout(submitTimer);
    submitTimer = setTimeout(() => { if (S.submitting) { S.submitting = false; render(); } }, SUBMIT_TIMEOUT_MS);
    render();
  }

  function renderFooter(c) {
    const name = S.selected && state.speciesById[S.selected]?.name;
    fill(frame.footer,
      el('div', { class: 'enc-foot-hint' }, name ? `Your pick: ${name}` : 'Pick a species from the candidates or the field guide.'),
      el('div', { class: 'enc-foot-actions' },
        button('Keep observing', { variant: 'secondary', icon: 'eye', onClick: closeScreen }),
        button(S.submitting ? 'Checking your notes…' : 'Submit identification', { variant: 'primary', icon: 'check', disabled: !c || !S.selected || S.submitting, onClick: submit })));
  }

  /* ---------------------------------------------------------------- result */

  function renderResult(c) {
    const r = S.result;
    resultLayer.hidden = !r;
    if (!r) return fill(resultLayer);
    const v = resultView(r, { speciesById: state.speciesById, evidence: c?.evidence });
    const sp = v.species ? state.speciesById[v.species] : null;
    const done = v.added;
    const art = sp ? speciesArt(sp, { size: 190, identified: true, background: true }) : null;
    const sparks = v.kind === 'certain' ? el('div', { class: 'enc-sparks', 'aria-hidden': 'true' }, Array.from({ length: 14 }, (_, i) => el('span', { style: { '--i': i } }))) : null;
    fill(resultLayer, el('div', { class: `enc-result tone-${v.tone}` },
      art ? el('div', { class: 'enc-result-art' }, art, sparks) : el('div', { class: 'enc-result-icon' }, ico(v.kind === 'insufficient' ? 'note' : 'leaf', 44)),
      el('div', { class: 'enc-result-text' },
        el('div', { class: 'enc-result-title' }, v.title),
        v.lead ? el('div', { class: v.kind === 'certain' || v.kind === 'probable' ? 'enc-result-name' : 'enc-result-lead' }, v.lead) : null,
        sp ? el('div', { class: 'enc-sci' }, sp.sci, ' · ', sp.family, ' ', v.kind === 'certain' ? rarityBadge(wildRarityToKit(sp.rarity)) : null) : null,
        v.kind === 'certain' && sp?.fact ? el('p', { class: 'enc-result-fact' }, sp.fact) : null,
        v.lines.length ? el('ul', { class: 'enc-result-lines' }, v.lines.map((l) => el('li', {}, l))) : null,
        done ? el('div', { class: 'enc-result-badges' },
          v.xp ? el('span', { class: 'enc-pill xp' }, ico('xp', 16), `+${v.xp} XP`) : null,
          el('span', { class: 'enc-pill' }, ico('journal', 16), v.kind === 'certain' ? 'Added to your journal' : 'Noted as probable')) : null,
        el('div', { class: 'enc-result-actions' },
          done ? button('Open my journal', { variant: 'secondary', icon: 'journal', onClick: () => { sound(ctx, 'page'); ui.open('journal', { section: 'species', species: v.species }); } }) : null,
          button(done ? 'Continue' : 'Back to my notes', { variant: 'primary', onClick: () => dismissResult(done) })))));
  }

  function dismissResult(close) {
    S.result = null;
    sound(ctx, 'click');
    if (close) ui.close('identify'); else render();
  }

  /* ---------------------------------------------------------------- render */

  function syncTab() {
    tabBar.setActive(S.tab);
    candidatesPane.hidden = S.tab !== 'candidates';
    guide.root.hidden = S.tab !== 'guide';
  }

  function render() {
    const c = current();
    const evidenceNow = c?.evidence || {};
    frame.setTitle('Field Notes', c ? `${c.m.label || 'Unknown bird'} · observation & identification` : 'Observation & identification');
    renderLeft(c);
    renderCandidates(c);
    guide.set({ profile: state.profile, evidence: evidenceNow, wrong: c?.wrong || [], selected: S.selected });
    syncTab();
    renderFooter(c);
    renderResult(c);
    watch.reset(sig());
  }

  /* ---------------------------------------------------------------- events */

  bus.on('net:sighting', (sg) => {
    if (!ui.isOpen('identify') || !sg?.bird || sg.mystery !== S.id) return;
    S.sighting = sg;
    const s = sig();
    if (s !== lastSightSig) { lastSightSig = s; render(); }
  });
  let lastSightSig = '';

  bus.on('net:identifyResult', (r) => {
    if (!ui.isOpen('identify') || !r || r.mystery !== S.id) return;
    clearTimeout(submitTimer);
    S.submitting = false;
    S.result = r;
    // A guess that did not fit is crossed off: do not leave it picked and submittable.
    if (r.outcome === 'wrong' && S.selected === r.guess) S.selected = '';
    sound(ctx, r.outcome === 'certain' ? 'discover' : r.outcome === 'probable' ? 'reward' : 'page');
    render();
  });

  /* -------------------------------------------------------------- register */

  ui.register('identify', {
    root: frame.root,
    overlay: false,
    closable: true,
    open(data) {
      const hint = data?.mystery;
      const id = typeof hint === 'string' ? hint : hint?.id || data?.sighting?.mystery || '';
      if (id !== S.id) { S.selected = ''; S.tab = 'candidates'; guide.reset(); }
      S.id = id;
      S.fallback = hint && typeof hint === 'object' ? hint : null;
      S.sighting = data?.sighting?.mystery === id ? data.sighting : null;
      S.result = null; S.submitting = false;
      lastSightSig = '';
      sound(ctx, 'open');
      render();
    },
    close() { guide.stopAudio(); clearTimeout(submitTimer); },
  });

  return { render };
}
