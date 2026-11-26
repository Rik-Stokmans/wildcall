// Small DOM widgets shared by the journal, quest log, collection and map screens.
// Everything here builds on the kit's pinned helpers; nothing reaches into other modules
// except through optional chaining on ctx.

import { el, icon, birdIllustration } from '../kit.js';
import { callSpectrogram } from './spectrogram.js';
import { callBoutSeconds } from './format.js';
import { GENERIC_BIRD } from './species-logic.js';

export function uiSound(ctx, name) { try { ctx.audio?.uiSound?.(name); } catch { /* audio is optional */ } }

/** A small pill. tone: '' | 'good' | 'amber' | 'muted' */
export function chip(text, { tone = '', ico = null, title = '' } = {}) {
  return el('span', { class: 'jr-chip' + (tone ? ' ' + tone : ''), title }, ico ? icon(ico, 13) : null, el('span', text));
}

export function sectionTitle(text, sub) {
  return el('div', { class: 'jr-section-title' }, el('span', text), sub ? el('small', sub) : null);
}

export function emptyNote(text, ico = 'feather') {
  return el('div', { class: 'jr-empty' }, icon(ico, 30), el('p', text));
}

/** The "learn more with the Knowledge discipline" hint shown where depth is locked. */
export function lockedHint(what) {
  return el('div', { class: 'jr-locked' }, icon('lock', 15),
    el('span', `${what} Learn more with the Knowledge discipline.`));
}

export function kv(label, value) {
  return el('div', { class: 'jr-kv' }, el('span', { class: 'jr-kv-k' }, label), el('span', { class: 'jr-kv-v' }, value));
}

/** A drawing of a bird that never throws: falls back to an empty box. */
export function illustration(species, opts = {}) {
  try {
    const c = birdIllustration(species || GENERIC_BIRD, opts);
    if (c) return c;
  } catch (err) { console.warn('[journal] illustration failed', err); }
  return el('div', { class: 'jr-illus-fallback', style: { width: (opts.size || 120) + 'px', height: (opts.size || 120) + 'px' } });
}

/** Vertical bar chart: bars [{name, frac, value?}], optional ghost curve [{frac}] drawn behind. */
export function barChart(bars, { ghost = null, unit = '', accent = '' } = {}) {
  return el('div', { class: 'jr-bars' + (accent ? ' ' + accent : '') }, bars.map((b, i) => el('div', { class: 'jr-bar-col', title: `${b.name}${b.value != null ? ': ' + b.value + unit : ''}` },
    el('div', { class: 'jr-bar-track' },
      ghost ? el('div', { class: 'jr-bar-ghost', style: { height: Math.round((ghost[i]?.frac || 0) * 100) + '%' } }) : null,
      el('div', { class: 'jr-bar', style: { height: Math.max(b.frac > 0 ? 4 : 0, Math.round(b.frac * 100)) + '%' } })),
    el('div', { class: 'jr-bar-val' }, b.value != null ? String(b.value) : ''),
    el('div', { class: 'jr-bar-name' }, b.name))));
}

/** A score meter 0..100 with a label and value. */
export function meter(label, value) {
  return el('div', { class: 'jr-meter' },
    el('span', { class: 'jr-meter-label' }, label),
    el('div', { class: 'jr-meter-track' }, el('div', { class: 'jr-meter-fill', style: { width: Math.max(0, Math.min(100, value)) + '%' } })),
    el('span', { class: 'jr-meter-val' }, String(Math.round(value))));
}

/**
 * Call playback with at most one call sounding at a time. Widgets subscribe to a frame
 * callback that reports playback progress 0..1 (or -1 when idle) for their key.
 */
export function createCallPlayer(ctx) {
  let cur = null; // {key, handle, t0, dur}
  let raf = 0;
  let subs = [];
  const notify = () => { for (const fn of subs) fn(); };
  function loop() {
    raf = 0;
    if (!cur) return;
    if (performance.now() - cur.t0 >= cur.dur) { stop(); return; }
    notify();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (cur) { try { cur.handle?.stop?.(); } catch { /* ignore */ } }
    cur = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    notify();
  }
  const player = {
    get available() { return typeof ctx.audio?.playCall === 'function'; },
    isPlaying(key) { return cur?.key === key; },
    /** 0..1 progress through the call for this key, -1 when it is not playing. */
    progress(key) { return cur?.key === key ? Math.min(1, (performance.now() - cur.t0) / cur.dur) : -1; },
    toggle(key, spIndex, callIndex, seconds) {
      if (cur?.key === key) { stop(); return; }
      stop();
      let handle = null;
      try { handle = ctx.audio?.playCall?.(spIndex, callIndex, {}) || null; } catch (err) { console.warn('[journal] playCall failed', err); }
      uiSound(ctx, 'click');
      cur = { key, handle, t0: performance.now(), dur: Math.max(600, seconds * 1000 + 300) };
      notify();
      raf = requestAnimationFrame(loop);
    },
    subscribe(fn) { subs.push(fn); },
    /** Forget widget callbacks (call before re-rendering); playback itself continues. */
    resetSubscriptions() { subs = []; },
    stop,
  };
  return player;
}

/**
 * A call row: play/stop button + spectrogram (+ moving cursor while sounding).
 * `call` is a core.Call; `spIndex`/`callIndex` address it for ctx.audio.playCall.
 */
export function callPlayback(ctx, player, { key, spIndex, callIndex, call, label, sub, height = 56 }) {
  const reps = Math.max(1, Math.min(3, call?.repeat?.[0] || 1));
  const grid = callSpectrogram(call, { cols: 120, rows: 36, reps });
  const seconds = callBoutSeconds(call) || grid.seconds;
  const canvas = el('canvas', { class: 'jr-spec-canvas', width: grid.cols * 3, height: grid.rows * 3 });
  paintSpectrogram(canvas, grid);
  const cursor = el('div', { class: 'jr-spec-cursor' });
  const btn = el('button', { class: 'jr-playbtn', type: 'button', disabled: !player.available }, icon('play', 16));
  const sync = () => {
    const p = player.progress(key);
    const on = p >= 0;
    cursor.style.opacity = on ? '1' : '0';
    cursor.style.left = on ? (p * 100).toFixed(1) + '%' : '0%';
    btn.classList.toggle('playing', on);
    btn.title = on ? 'Stop' : (player.available ? 'Play' : 'Sound is not ready yet');
    btn.replaceChildren(icon(on ? 'stop' : 'play', 16));
  };
  btn.addEventListener('click', () => player.toggle(key, spIndex, callIndex, seconds));
  player.subscribe(sync);
  sync();
  return el('div', { class: 'jr-callrow' },
    btn,
    el('div', { class: 'jr-callrow-main' },
      label ? el('div', { class: 'jr-callrow-label' }, label, sub ? el('small', sub) : null) : null,
      el('div', { class: 'jr-spec', style: { height: height + 'px' } }, canvas, cursor)));
}

/** Paint a spectrogram grid as ink on paper. */
export function paintSpectrogram(canvas, grid) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const cw = canvas.width / grid.cols, ch = canvas.height / grid.rows;
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = 'rgba(85, 69, 55, 0.06)';
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const v = grid.data[r * grid.cols + c];
      if (v < 0.05) continue;
      g.fillStyle = `rgba(53, 92, 67, ${Math.min(1, 0.15 + v * 0.85).toFixed(3)})`;
      g.fillRect(c * cw, r * ch, cw + 0.5, ch + 0.5);
    }
  }
}

/** Remember and restore scrollTop of [data-scroll] regions across a full re-render. */
export function keepScroll(root) {
  const saved = new Map();
  for (const n of root.querySelectorAll('[data-scroll]')) saved.set(n.dataset.scroll, n.scrollTop);
  return () => { for (const n of root.querySelectorAll('[data-scroll]')) { const t = saved.get(n.dataset.scroll); if (t) n.scrollTop = t; } };
}

/** Simple segmented control: options [{id, label}], returns an element. */
export function segmented(options, activeId, onSelect) {
  const root = el('div', { class: 'jr-seg', role: 'tablist' });
  for (const o of options) {
    root.appendChild(el('button', { type: 'button', class: 'jr-seg-btn' + (o.id === activeId ? ' active' : ''), role: 'tab', onclick: () => onSelect(o.id) }, o.label));
  }
  return root;
}

/** Backdrop root for a screen; clicking the dim area outside the panel closes it. */
export function screenRoot(ctx, name, extraClass = '') {
  const root = el('div', { class: `jr-screen jr-screen-${name} ${extraClass}`.trim() });
  root.addEventListener('mousedown', (e) => { if (e.target === root) ctx.ui.close(name); });
  return root;
}

/** Close button for a custom frame. */
export function closeButton(ctx, name) {
  return el('button', { class: 'jr-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => ctx.ui.close(name) }, icon('close', 18));
}

/**
 * A single-sheet frame (quest log, collection): paper panel with a title bar, optional
 * header controls, and a body. Returns { panel, head, body }.
 */
export function sheet(ctx, name, { title, subtitle = '', ico = 'journal', className = '' }) {
  const titleEl = el('div', { class: 'jr-sheet-title' }, el('h2', title), subtitle ? el('small', subtitle) : null);
  const headRight = el('div', { class: 'jr-sheet-head-right' });
  const head = el('div', { class: 'jr-sheet-head' }, el('span', { class: 'jr-sheet-icon' }, icon(ico, 26)), titleEl, el('div', { class: 'jr-spacer' }), headRight, closeButton(ctx, name));
  const body = el('div', { class: 'jr-sheet-body' });
  const panel = el('div', { class: `jr-sheet ${className}`.trim() }, head, body);
  return { panel, head, headRight, body, setSubtitle(t) { const s = titleEl.querySelector('small'); if (s) s.textContent = t; } };
}
