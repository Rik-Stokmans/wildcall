// Settings tab: every key in state.settings, the controls reference, desktop options.
// Unlike the other tabs this one does NOT re-render on profile events (a refresh would drop
// a slider mid-drag); each control writes through state.setSetting and updates itself.
import { el, button } from '../kit.js';
import { KEYMAP } from '../../core/input.js';
import { controlsReference } from './controls.js';
import { section, sfx } from './common.js';
import { narratorVoiceLabel } from '../journal/sky-logic.js';

const pct = (v) => Math.round(v * 100) + '%';
const SLIDERS = [
  ['Sound', [
    ['volMaster', 'Master volume', 0, 1, 0.01, pct],
    ['volBirds', 'Birdsong', 0, 1, 0.01, pct],
    ['volAmbient', 'Ambience', 0, 1, 0.01, pct],
    ['volMusic', 'Music', 0, 1, 0.01, pct],
    ['volUI', 'Interface sounds', 0, 1, 0.01, pct],
  ]],
  ['View & controls', [
    ['sensitivity', 'Look sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2) + '×'],
    ['fov', 'Field of view', 50, 100, 1, (v) => Math.round(v) + '°'],
  ]],
];

export function renderSettings(ctx, st) {
  const { state } = ctx;
  const desktop = window.wildcallDesktop;

  const slider = ([key, name, min, max, step, fmt]) => {
    const out = el('output', fmt(state.settings[key]));
    const input = el('input', { type: 'range', min, max, step, value: state.settings[key], 'aria-label': name,
      oninput: (e) => { const v = Number(e.target.value); state.setSetting(key, v); out.textContent = fmt(v); paint(e.target); },
      onchange: () => sfx(ctx, 'click') });
    paint(input);
    return el('label', { class: 'menu-setting' }, el('span', { class: 'menu-setting-name' }, name), input, out);
  };
  const toggle = (key, name, hint) => {
    const b = el('button', { class: 'menu-switch' + (state.settings[key] ? ' on' : ''), type: 'button', role: 'switch',
      'aria-checked': String(!!state.settings[key]), 'aria-label': name,
      onclick: () => {
        const v = !state.settings[key];
        state.setSetting(key, v); b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); sfx(ctx, 'click');
      } }, el('i'));
    return el('div', { class: 'menu-setting' }, el('span', { class: 'menu-setting-name' }, name, hint ? el('small', hint) : null), b);
  };
  const segmented = (key, name, options) => {
    const wrap = el('div', { class: 'menu-seg', role: 'group', 'aria-label': name });
    const mark = () => wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.settings[key]));
    for (const [v, text] of options) {
      wrap.appendChild(el('button', { type: 'button', dataset: { v }, onclick: () => { state.setSetting(key, v); mark(); sfx(ctx, 'click'); } }, text));
    }
    mark();
    return el('div', { class: 'menu-setting' }, el('span', { class: 'menu-setting-name' }, name), wrap);
  };

  // The narrator (docs/contract.md §8): how often he speaks, how loud, which system voice.
  const voiceSelect = () => {
    let voices = [];
    try { voices = ctx.narrator?.voices?.() || []; } catch { voices = []; }
    const cur = state.settings.narratorVoice || '';
    const opts = [el('option', { value: '' }, 'Automatic (best British voice)')];
    for (const v of voices) opts.push(el('option', { value: v.name }, `${v.name} (${v.lang})`));
    if (cur && !voices.some((v) => v.name === cur)) opts.push(el('option', { value: cur }, `${cur} (not installed)`));
    const sel = el('select', { 'aria-label': 'Narrator voice', class: 'menu-select',
      onchange: (e) => { state.setSetting('narratorVoice', e.target.value); sfx(ctx, 'click'); } }, opts);
    sel.value = cur;
    return el('label', { class: 'menu-setting' },
      el('span', { class: 'menu-setting-name' }, 'Voice', voices.length ? null : el('small', 'Captions only: no system voice found')), sel);
  };
  // Which voice is actually speaking: the pregenerated recorded voice pack (contract §13)
  // when it loaded, otherwise the system's speech synthesis.
  const voiceInUse = () => {
    const recorded = narratorVoiceLabel(ctx.narrator) === 'Recorded voice';
    const pack = ctx.narrator?.voicePack;
    return el('div', { class: 'menu-setting menu-voice-in-use' },
      el('span', { class: 'menu-setting-name' }, 'Voice in use',
        el('small', recorded ? 'The narrator\'s recorded lines; new lines fall back to the system voice' : 'Spoken by your system\'s speech synthesis')),
      el('span', { class: 'menu-pill' + (recorded ? '' : ' amber'), title: recorded && pack?.voice ? `${pack.voice}${pack.lines ? `, ${pack.lines} lines` : ''}` : '' },
        recorded ? 'Recorded voice' : 'System voice'));
  };
  const narratorCard = section('Narrator', el('div', { class: 'menu-card menu-settings-card' },
    segmented('narrator', 'How often he speaks', [['off', 'Off'], ['sparse', 'Sparse'], ['normal', 'Normal'], ['chatty', 'Chatty']]),
    slider(['volNarrator', 'Narrator volume', 0, 1, 0.01, pct]),
    voiceInUse(),
    voiceSelect()));

  const left = el('div', { class: 'menu-col', 'data-scroll': 'set-l' },
    SLIDERS.map(([title, rows]) => section(title, el('div', { class: 'menu-card menu-settings-card' }, rows.map(slider)))),
    narratorCard,
    section('Comfort', el('div', { class: 'menu-card menu-settings-card' },
      toggle('invertY', 'Invert vertical look'),
      segmented('quality', 'Graphics quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]),
      toggle('hints', 'Tutorial hints', 'Gentle first-time tips'),
      toggle('subtitles', 'Sound captions', 'Describe sounds in the clue panel'))),
    section('Game', el('div', { class: 'menu-card menu-settings-card menu-system' },
      fullscreenButton(ctx, desktop),
      st.fromMain ? null : button('Return to main menu', { icon: 'home', onClick: () => { sfx(ctx, 'click'); location.assign(location.pathname); } }),
      desktop ? button('Quit to desktop', { icon: 'close', variant: 'danger', onClick: () => desktop.quit?.() }) : null)));

  const right = el('div', { class: 'menu-col', 'data-scroll': 'set-r' },
    controlsReference(KEYMAP).map((sec) => section(sec.title, el('div', { class: 'menu-card menu-keys' }, sec.rows.map((r) =>
      el('div', { class: 'menu-keyrow' }, el('span', r.text), el('span', { class: 'menu-keycaps' }, r.keys.map((k) => el('kbd', k)))))))));

  return el('div', { class: 'menu-cols menu-settings' }, left, right);
}

/** Paint the filled portion of a range track via a CSS variable. */
function paint(input) {
  const min = Number(input.min), max = Number(input.max);
  input.style.setProperty('--fill', ((Number(input.value) - min) / (max - min) * 100) + '%');
}

function fullscreenButton(ctx, desktop) {
  const toggle = async () => {
    sfx(ctx, 'click');
    try {
      if (desktop?.toggleFullscreen) await desktop.toggleFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* fullscreen can be refused; nothing to do */ }
  };
  return button('Toggle fullscreen', { icon: 'eye', onClick: toggle });
}
