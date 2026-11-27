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
    if (!voices.length) return null; // recorded voice only: nothing to choose
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
        el('small', recorded ? 'The narrator\'s recorded lines' : 'No recorded voice loaded: captions only')),
      el('span', { class: 'menu-pill' + (recorded ? '' : ' amber'), title: recorded && pack?.voice ? `${pack.voice}${pack.lines ? `, ${pack.lines} lines` : ''}` : '' },
        recorded ? 'Recorded voice' : 'Captions only'));
  };
  const narratorCard = section('Narrator', el('div', { class: 'menu-card menu-settings-card' },
    segmented('narrator', 'Inner voice (spoken thoughts)', [['off', 'Off'], ['sparse', 'Sparse'], ['normal', 'Normal'], ['chatty', 'Chatty']]),
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
    // [birds module hook] spotting aids (docs: web/js/birds/visibility.js).
    section('Spotting', el('div', { class: 'menu-card menu-settings-card' },
      toggle('birdOutline', 'Bird outline', 'A soft light edge on birds in clear sight'),
      toggle('leafFade', 'Leaf windows', 'Leaves right in front of a nearby bird thin out'),
      toggle('songRipples', 'Song ripples', 'Faint rings where a nearby bird is singing'), // [songsight hook]
      toggle('flightTrails', 'Flight trails', 'A faint streak behind a bird you scared off'))), // [birds flight hook]
    // [soundring hook] the ring around the centre of the view that shows where calls come from.
    section('Hearing aids', el('div', { class: 'menu-card menu-settings-card' },
      toggle('soundRing', 'Sound ring', 'Where each call comes from, around the centre of the view'),
      soundRingSize(ctx, sfx),
      // one card for the voice being followed (Q pins it), or a card for every voice
      segmented('clueCards', 'Clue cards', [['one', 'One at a time'], ['all', 'All']]))),
    // [minimap module hook] the corner map: on/off, heading-up or north-up, and its range.
    section('Minimap', el('div', { class: 'menu-card menu-settings-card' },
      toggle('minimap', 'Minimap', 'A small map in the top-left corner'),
      toggle('minimapRotate', 'Turns with you', 'Off: north stays up'),
      ctx.minimap ? minimapRange(ctx) : null)),
    section('Game', el('div', { class: 'menu-card menu-settings-card menu-system' },
      fullscreenButton(ctx, desktop),
      st.fromMain ? null : button('Return to main menu', { icon: 'home', onClick: () => { sfx(ctx, 'click'); location.assign(location.pathname); } }),
      desktop ? button('Quit to desktop', { icon: 'close', variant: 'danger', onClick: () => desktop.quit?.() }) : null)));

  const right = el('div', { class: 'menu-col', 'data-scroll': 'set-r' },
    // [toolkeys module hook] what each piece of equipment does, with its keys and mouse buttons
    ctx.toolkeys?.referenceCard ? section('Equipment', ctx.toolkeys.referenceCard({ plain: true, title: false })) : null,
    controlsReference(KEYMAP).map((sec) => section(sec.title, el('div', { class: 'menu-card menu-keys' }, sec.rows.map((r) =>
      el('div', { class: 'menu-keyrow' }, el('span', r.text), el('span', { class: 'menu-keycaps' }, r.keys.map((k) => el('kbd', k)))))))));

  return el('div', { class: 'menu-cols menu-settings' }, left, right);
}

/** [minimap module hook] Near / far range of the minimap (kept by ctx.minimap, not a setting key). */
function minimapRange(ctx) {
  const wrap = el('div', { class: 'menu-seg', role: 'group', 'aria-label': 'Minimap range' });
  const mark = () => wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === ctx.minimap.zoom));
  for (const [v, text] of [[0, 'Near'], [1, 'Far']]) {
    wrap.appendChild(el('button', { type: 'button', dataset: { v }, onclick: () => { ctx.minimap.setZoom(v); mark(); sfx(ctx, 'click'); } }, text));
  }
  mark();
  return el('div', { class: 'menu-setting' }, el('span', { class: 'menu-setting-name' }, 'Range', el('small', '120 m or 300 m around you')), wrap);
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

/** [soundring hook] Small / normal / large sound ring (settings.soundRingSize, default normal). */
function soundRingSize(ctx, sfx) {
  const { state } = ctx;
  const cur = () => state.settings.soundRingSize || 'normal';
  const wrap = el('div', { class: 'menu-seg', role: 'group', 'aria-label': 'Sound ring size' });
  const mark = () => wrap.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === cur()));
  for (const [v, text] of [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']]) {
    wrap.appendChild(el('button', { type: 'button', dataset: { v }, onclick: () => { state.setSetting('soundRingSize', v); mark(); sfx(ctx, 'click'); } }, text));
  }
  mark();
  return el('div', { class: 'menu-setting' }, el('span', { class: 'menu-setting-name' }, 'Ring size'), wrap);
}
