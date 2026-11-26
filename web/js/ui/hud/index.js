// WILDCALL in-game HUD (task c-hud). Minimal, soft and low-contrast: compass strip, region
// name, time/weather/forecast, detection clue cards, movement cues, observation readout,
// prompts, tool slots, quest tracker, toasts and first-time hints. See docs/contract.md 5.4.
//
// All logic that can be tested lives in the sibling pure modules (compass, clues, toasts,
// quest, hints, sighting, visibility, weather); this file only wires bus events to the DOM.
// Every call into another module is optional-chained: the HUD must never throw because
// ctx.player / ctx.tools / ctx.audio is not there yet.
import { el, fill, icon, label, formatClock, WEATHER_NAMES, WEATHER_ICONS } from '../kit.js';
import { RAD2DEG, tickTable, stripOffset, headingDegrees, arrowDegrees, spreadWidth, landmarkPips, cuePlacement } from './compass.js';
import { ClueStore, clueCard } from './clues.js';
import { ToastStack, toastSound } from './toasts.js';
import { trackedQuest } from './quest.js';
import { HintTracker, HINTS } from './hints.js';
import { sightingView } from './sighting.js';
import { hudLevel, toastsVisible } from './visibility.js';
import { forecastSlots } from './weather.js';

const HALF_SPAN = (80 / RAD2DEG); // compass strip shows +-80 degrees around the heading
const SIGHT_STALE = 1.5;          // seconds without a net:sighting before the readout hides
const REC_STALE = 1.5;            // seconds without a net:recState before REC hides
const REGION_BANNER = 4.5;        // seconds the region name is large before resting small
const CUE_LIFE_MS = 1500;

const SLOTS = [
  { tool: 'binoculars', slot: 'optics', key: '1', icon: 'binoculars', empty: 'No binoculars' },
  { tool: 'camera', slot: 'camera', key: '2', icon: 'camera', empty: 'No camera' },
  { tool: 'recorder', slot: 'audio', key: '3', icon: 'recorder', empty: 'No recorder' },
];

const ARROW_SVG = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M6 1.2 10.2 10 6 8 1.8 10z" fill="currentColor"/></svg>';
const RING_R = 17;
const RING_C = 2 * Math.PI * RING_R;

function svgRing(cls, r = RING_R, w = 3) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 44 44');
  svg.setAttribute('class', cls);
  const mk = (c) => {
    const n = document.createElementNS(ns, 'circle');
    n.setAttribute('cx', 22); n.setAttribute('cy', 22); n.setAttribute('r', r);
    n.setAttribute('fill', 'none'); n.setAttribute('stroke-width', w);
    n.setAttribute('class', c);
    n.setAttribute('transform', 'rotate(-90 22 22)');
    n.style.strokeDasharray = `${2 * Math.PI * r}`;
    return n;
  };
  const track = mk('hud-ring-track'), bar = mk('hud-ring-bar');
  bar.style.strokeDashoffset = `${2 * Math.PI * r}`;
  svg.append(track, bar);
  svg.bar = bar;
  svg.circ = 2 * Math.PI * r;
  return svg;
}
const setRing = (svg, v) => { svg.bar.style.strokeDashoffset = String(svg.circ * (1 - Math.max(0, Math.min(1, v)))); };

function keycaps(keys) { return el('span', { class: 'hud-keys' }, keys.map((k) => el('kbd', { class: 'hud-key' }, k))); }

let frame = null; // per-frame function, built inside init() once the DOM exists

export default {
  name: 'hud',

  init(ctx) {
    const { bus, state } = ctx;
    const hudRoot = document.getElementById('hud');
    const toastRoot = document.getElementById('toasts');
    if (!hudRoot || !toastRoot) return;
    const sound = (n) => { try { ctx.audio?.uiSound?.(n); } catch { /* audio is optional */ } };
    let storage = null;
    try { storage = window.localStorage; } catch { /* blocked storage: hints just do not persist */ }

    const stats = () => state.profile?.stats || state.stats || {};
    const speciesName = (id) => state.speciesById?.[id]?.name || '';
    const mysteryLabel = (id) => (state.profile?.journal?.mysteries || []).find((m) => m.id === id)?.label || '';
    const nowT = () => ctx.time || 0;

    const hints = new HintTracker(storage, () => state.settings?.hints !== false);
    const clues = new ClueStore(Math.max(2, Math.round(stats().clueSlots || 2)));
    const toasts = new ToastStack();

    /* ------------------------------------------------------------ DOM skeleton */
    const compassStrip = el('div', { class: 'hud-compass-strip' });
    const tickEls = tickTable(15).map((t) => {
      const n = el('div', { class: `hud-tick${t.major ? ' major' : t.mid ? ' mid' : ''}` }, el('i'), t.label ? el('b', t.label) : null);
      compassStrip.appendChild(n);
      return { t, n };
    });
    const pipPool = [], clueTickPool = [];
    const compassDeg = el('div', { class: 'hud-compass-deg' });
    const compass = el('div', { class: 'hud-part hud-compass' }, compassStrip, el('div', { class: 'hud-compass-caret' }), compassDeg);

    const regionName = el('div', { class: 'hud-part hud-region' });
    const clockText = el('span', { class: 'hud-clock' });
    const phaseText = el('span', { class: 'hud-phase' });
    const weatherIcon = el('span', { class: 'hud-weather-icon' });
    const forecastEl = el('div', { class: 'hud-forecast' });
    const timeEl = el('div', { class: 'hud-part hud-time' },
      el('div', { class: 'hud-time-row' }, weatherIcon, clockText, phaseText), forecastEl);

    const questEl = el('div', { class: 'hud-part hud-quest', hidden: true });
    const clueList = el('div', { class: 'hud-part hud-clues' });
    const cueLayer = el('div', { class: 'hud-part hud-cues' });
    const hintEl = el('div', { class: 'hud-part hud-hint', hidden: true });

    const promptEl = el('div', { class: 'hud-part hud-prompt', hidden: true });
    const sightEl = el('div', { class: 'hud-sight', hidden: true });
    const sightRing = svgRing('hud-sight-ring');
    const sightProgress = svgRing('hud-sight-progress', 21, 1.6);
    const sightCenter = el('div', { class: 'hud-sight-center' }, icon('eye', 14));
    const sightBlocked = el('div', { class: 'hud-sight-blocked' });
    const sightName = el('div', { class: 'hud-sight-name' });
    const sightChips = el('div', { class: 'hud-chips' });
    const sightBehavior = el('div', { class: 'hud-sight-behavior' });
    const sightIdentify = el('div', { class: 'hud-sight-identify', hidden: true }, keycaps(['T']), el('span', 'Identify'));
    const sightMoment = el('div', { class: 'hud-sight-moment', hidden: true, title: 'A moment worth photographing' }, icon('camera', 15));
    sightEl.append(
      el('div', { class: 'hud-sight-top' },
        el('div', { class: 'hud-sight-ringwrap' }, sightRing, sightProgress, sightCenter, sightMoment),
        el('div', { class: 'hud-sight-text' }, sightName, sightBlocked, sightBehavior)),
      sightChips, sightIdentify);

    // tools (bottom right)
    const slotEls = SLOTS.map((s) => {
      const filmBadge = s.tool === 'camera' ? el('span', { class: 'hud-film' }) : null;
      const n = el('div', { class: 'hud-slot' }, el('span', { class: 'hud-slot-key' }, s.key), icon(s.icon, 22), filmBadge);
      return { def: s, n, filmBadge };
    });
    const recEl = el('div', { class: 'hud-rec', hidden: true }, el('i'), el('span', 'REC'), el('b'));
    const staminaRing = svgRing('hud-stamina-ring', RING_R, 3.4);
    const staminaEl = el('div', { class: 'hud-stamina', title: 'Stamina' }, staminaRing);
    const toolsEl = el('div', { class: 'hud-tools' }, staminaEl, recEl, el('div', { class: 'hud-slots' }, slotEls.map((s) => s.n)));

    hudRoot.append(compass, regionName, timeEl, questEl, clueList, cueLayer, hintEl,
      el('div', { class: 'hud-bottom' }, promptEl, sightEl), toolsEl);
    hudRoot.classList.add('hud');
    toastRoot.classList.add('hud-toasts');

    /* ------------------------------------------------------------ visibility */
    let level = '', focusOn = false;
    function applyLevel() {
      const tools = ctx.tools;
      const next = hudLevel({ mode: state.mode, focus: focusOn, tool: tools?.active, raised: !!tools?.raised });
      if (next !== level) { level = next; hudRoot.dataset.level = next; }
      const tv = toastsVisible(state.mode);
      toastRoot.classList.toggle('hud-toasts-hidden', !tv);
    }
    bus.on('focus', ({ on }) => { focusOn = !!on; if (on) hints.complete('focus'); applyLevel(); renderHint(); });
    bus.on('mode', applyLevel);
    bus.on('tool', ({ active, raised }) => {
      if (active === 'binoculars' && raised) hints.complete('binoculars');
      applyLevel(); renderTools();
    });

    /* ------------------------------------------------------------ region, time, weather */
    let regionUntil = 0;
    bus.on('region:enter', (d) => {
      const r = d?.region;
      const info = typeof r === 'object' && r ? r : (state.regions || []).find((x) => x.id === r || x.key === r);
      const name = info?.name;
      if (!name) return;
      fill(regionName, el('span', name));
      regionName.classList.add('banner');
      regionUntil = nowT() + REGION_BANNER;
    });

    let envSig = '';
    function renderEnv() {
      const env = state.env;
      if (!env) return;
      const st = stats();
      const slots = forecastSlots(env.forecast, env.time, st.forecast || 0);
      const sig = [Math.floor(env.time * 60), env.weather, env.phase, slots.map((s) => s.hour + ':' + s.weather).join(',')].join('|');
      if (sig === envSig) return;
      envSig = sig;
      fill(weatherIcon, icon(WEATHER_ICONS[env.weather] || 'sunny', 16));
      weatherIcon.title = WEATHER_NAMES[env.weather] || '';
      clockText.textContent = formatClock(env.time);
      phaseText.textContent = env.phase || '';
      fill(forecastEl, slots.map((s) => el('div', { class: 'hud-fc-slot', title: WEATHER_NAMES[s.weather] || '' },
        el('span', formatClock(s.hour)), icon(WEATHER_ICONS[s.weather] || 'sunny', 13))));
      forecastEl.hidden = slots.length === 0;
    }
    bus.on('env', renderEnv);

    /* ------------------------------------------------------------ clue cards */
    const cards = new Map(); // clue id -> {n, arrow, sig}
    function cardFor(entry, isNew) {
      const c = entry.clue;
      const view = clueCard(c, { species: speciesName, mystery: mysteryLabel });
      const sig = JSON.stringify([view.title, view.subtitle, view.dir, view.facts, view.confidence, view.unusual, view.new]);
      let rec = cards.get(c.id);
      if (!rec) {
        rec = { n: el('div', { class: 'hud-card' }), arrow: el('span', { class: 'hud-arrow', html: ARROW_SVG }), sig: '' };
        rec.showTip = isNew && hints.tipAvailable('focusTip', 4, 'focus');
        if (rec.showTip) hints.tipShown('focusTip');
        cards.set(c.id, rec);
      }
      if (rec.sig !== sig) {
        rec.sig = sig;
        rec.n.classList.toggle('new', view.new);
        rec.n.classList.toggle('unusual', view.unusual);
        rec.n.classList.toggle('known', !!c.known && view.title !== 'A call');
        fill(rec.n,
          el('div', { class: 'hud-card-head' }, rec.arrow,
            el('div', { class: 'hud-card-title' },
              el('b', view.title),
              view.subtitle ? el('span', view.subtitle) : null),
            view.dir ? el('em', { class: 'hud-card-dir' }, view.dir) : null),
          view.facts.length ? el('div', { class: 'hud-card-facts' }, view.facts.map((f) => el('span', { class: 'hud-fact hud-fact-' + f.key }, f.text))) : null,
          view.unusual ? el('div', { class: 'hud-card-unusual' }, 'Something unusual…') : null,
          view.confidence ? el('div', { class: 'hud-card-conf' }, view.confidence) : null,
          rec.showTip ? el('div', { class: 'hud-card-tip' }, 'Hold F to listen closely') : null);
      }
      return rec;
    }
    function syncClues(now) {
      const live = clues.list(now);
      const keep = new Set(live.map((e) => e.id));
      for (const [id, rec] of cards) if (!keep.has(id)) { rec.n.remove(); cards.delete(id); }
      live.forEach((entry, i) => {
        const rec = cardFor(entry, false);
        if (rec.n.parentNode !== clueList || clueList.children[i] !== rec.n) clueList.insertBefore(rec.n, clueList.children[i] || null);
      });
    }
    bus.on('net:clue', (c) => {
      if (!c) return;
      clues.setCap(Math.max(2, Math.round(stats().clueSlots || 2)));
      const { entry, isNew } = clues.upsert(c, nowT());
      if (isNew) wantHint('focus');
      // Seed the card so its first render knows whether it is brand new (tip counting).
      if (isNew && clues.list(nowT()).some((e) => e.id === entry.id)) cardFor(entry, true);
      syncClues(nowT());
    });

    /* ------------------------------------------------------------ movement cues */
    bus.on('net:cue', (cue) => {
      if (!cue || state.mode !== 'play' || level === 'hidden') return;
      const cam = ctx.camera;
      const p = cuePlacement(cue, ctx.player?.yaw ?? 0, ctx.player?.pitch ?? 0, cam?.fov || 70, cam?.aspect || 16 / 9);
      const s = Math.max(0.25, Math.min(1, cue.strength || 0.5));
      const n = el('div', { class: `hud-cue ${p.edge ? 'edge' : 'shimmer'}`, style: { left: `${p.x * 100}%`, top: `${p.y * 100}%`, '--s': String(s) } }, el('i'), el('i'));
      if (p.edge) n.style.setProperty('--rot', `${Math.round(p.angle * RAD2DEG)}deg`);
      cueLayer.appendChild(n);
      while (cueLayer.children.length > 8) cueLayer.firstChild.remove();
      setTimeout(() => n.remove(), CUE_LIFE_MS);
    });

    /* ------------------------------------------------------------ observation readout */
    let sightAt = -99, lastBird = 0, chipEls = new Map(), newKeyUntil = 0;
    bus.on('net:sighting', (s) => {
      const v = sightingView(s, speciesName);
      if (!v) { sightAt = -99; sightEl.hidden = true; lastBird = 0; return; }
      sightAt = nowT();
      if (v.bird !== lastBird) {
        lastBird = v.bird; chipEls = new Map(); fill(sightChips);
        if (ctx.tools?.active !== 'binoculars' || !ctx.tools?.raised) wantHint('binoculars');
      }
      if (s.newKey) newKeyUntil = nowT() + 2.4;
      sightEl.hidden = false;
      setRing(sightRing, v.clarity);
      setRing(sightProgress, v.progress);
      sightEl.style.setProperty('--clarity', String(v.clarity));
      sightBlocked.textContent = v.blocked;
      sightBlocked.hidden = !v.blocked;
      sightName.textContent = v.name;
      sightName.hidden = !v.name;
      sightBehavior.textContent = v.behavior;
      sightBehavior.hidden = !v.behavior;
      sightIdentify.hidden = !v.identify;
      sightMoment.hidden = !v.moment;
      const seen = new Set();
      for (const chip of v.chips) {
        seen.add(chip.key);
        let n = chipEls.get(chip.key);
        if (!n) {
          n = el('span', { class: 'hud-chip' }, el('small'), el('b'));
          chipEls.set(chip.key, n);
          sightChips.appendChild(n);
        }
        n.children[0].textContent = chip.name;
        n.children[1].textContent = chip.text;
        n.classList.toggle('fresh', chip.isNew);
      }
      for (const [k, n] of chipEls) if (!seen.has(k)) { n.remove(); chipEls.delete(k); }
    });

    /* ------------------------------------------------------------ prompt */
    bus.on('interact:target', (t) => {
      if (!t) { promptEl.hidden = true; return; }
      fill(promptEl, keycaps(['E']), el('span', { class: 'hud-prompt-verb' }, label(t.verb || 'Interact')),
        t.label ? el('span', { class: 'hud-prompt-label' }, t.label) : null);
      promptEl.hidden = false;
      wantHint('interact');
    });
    bus.on('action:interact', () => hints.complete('interact'));

    /* ------------------------------------------------------------ tools, film, rec, stamina */
    function renderTools() {
      const eq = state.profile?.equipped || {};
      const active = ctx.tools?.active;
      for (const { def, n, filmBadge } of slotEls) {
        const item = state.items?.[eq[def.slot]];
        n.classList.toggle('empty', !item);
        n.classList.toggle('active', active === def.tool);
        n.classList.toggle('raised', active === def.tool && !!ctx.tools?.raised);
        n.title = item ? item.name : def.empty;
        if (filmBadge) {
          const f = state.profile?.film;
          const left = f && f.cap > 0 ? Math.max(0, f.cap - f.used) : null;
          filmBadge.textContent = left == null ? '' : String(left);
          filmBadge.classList.toggle('low', left != null && left <= 2);
          filmBadge.title = left == null ? '' : `${left} shots of film left`;
        }
      }
    }
    let recAt = -99, recSeconds = 0;
    bus.on('net:recState', (r) => { recAt = nowT(); recSeconds = r?.seconds || 0; });

    /* ------------------------------------------------------------ quest tracker */
    let questSig = '';
    const toastPad = () => { toastRoot.style.paddingTop = questEl.hidden ? '' : `${questEl.offsetHeight + 28}px`; };
    function renderQuest() {
      const q = trackedQuest(state.profile, state.quests);
      const sig = JSON.stringify(q);
      if (sig === questSig) return;
      questSig = sig;
      if (!q) { questEl.hidden = true; toastPad(); return; }
      questEl.hidden = false;
      fill(questEl,
        el('div', { class: 'hud-quest-name' }, icon('quest', 13), el('span', q.name)),
        q.objectives.map((o) => el('div', { class: 'hud-quest-obj' }, el('i'), el('span', o.text))),
        !q.objectives.length ? el('div', { class: 'hud-quest-obj done' }, el('i'), el('span', 'All objectives done')) : null);
      toastPad();
    }

    bus.on('profile', () => {
      renderTools(); renderQuest(); renderEnv();
      clues.setCap(Math.max(2, Math.round(stats().clueSlots || 2)));
    });
    bus.on('welcome', () => { renderTools(); renderQuest(); renderEnv(); });

    /* ------------------------------------------------------------ toasts */
    const toastEls = new Map();
    function toastNode(item) {
      return el('div', { class: `hud-toast hud-toast-${item.kind}` },
        el('div', { class: 'hud-toast-icon' }, icon(item.icon, 18)),
        el('div', { class: 'hud-toast-body' },
          item.title ? el('b', item.title) : null,
          item.text ? el('span', item.text) : null),
        item.xp && item.kind !== 'xp' ? el('em', { class: 'hud-toast-bonus' }, `+${item.xp} XP`) : null);
    }
    function dismissNode(n) {
      n.classList.add('out');
      setTimeout(() => n.remove(), 450);
    }
    bus.on('toast', (t) => {
      if (!t) return;
      const { item, merged, evicted } = toasts.push(t, nowT());
      for (const e of evicted) { const n = toastEls.get(e.id); if (n) { dismissNode(n); toastEls.delete(e.id); } }
      const fresh = toastNode(item);
      const old = toastEls.get(item.id);
      if (old) { old.replaceWith(fresh); fresh.classList.add('bump'); } else toastRoot.appendChild(fresh);
      toastEls.set(item.id, fresh);
      if (!merged) { const snd = toastSound(item.kind); if (snd) sound(snd); }
      if (item.kind === 'discovery' || item.kind === 'journal') wantHint('journal', 6);
    });

    /* ------------------------------------------------------------ hints */
    const wanted = new Map(); // id -> earliest time
    function wantHint(id, delay = 0) { if (!wanted.has(id) && hints.available(id)) wanted.set(id, nowT() + delay); }
    function renderHint() {
      const a = hints.active;
      const show = !!a && state.settings?.hints !== false && level === 'full';
      hintEl.hidden = !show;
      if (!show) return;
      const h = HINTS[a.id] || {};
      fill(hintEl, keycaps(h.keys || []), el('span', h.text || ''));
    }
    for (const a of ['forward', 'back', 'left', 'right']) bus.on('action:' + a, () => { if (hints.complete('movement')) renderHint(); wanted.delete('movement'); });
    bus.on('action:focus', () => { hints.complete('focus'); wanted.delete('focus'); renderHint(); });
    bus.on('action:journal', () => { hints.complete('journal'); wanted.delete('journal'); renderHint(); });
    bus.on('ui:open', ({ name }) => { if (name === 'journal') { hints.complete('journal'); wanted.delete('journal'); } });
    bus.on('game:start', () => wantHint('movement', 2.5));

    /* ------------------------------------------------------------ frame update */
    let lastHint = '';
    function updateCompass(now) {
      const yaw = ctx.player?.yaw ?? 0;
      const st = stats();
      const px = ctx.player?.pos?.x ?? 0, pz = ctx.player?.pos?.z ?? 0;
      for (const { t, n } of tickEls) {
        const off = stripOffset(t.rad, yaw, HALF_SPAN);
        if (off == null) { n.style.visibility = 'hidden'; continue; }
        n.style.visibility = 'visible';
        n.style.left = `${50 + off * 50}%`;
        n.style.opacity = String(1 - Math.abs(off) * 0.55);
      }
      const deg = headingDegrees(yaw);
      compassDeg.hidden = !(st.compass >= 1);
      if (!compassDeg.hidden) compassDeg.textContent = `${deg}°`;

      // landmark pips (compass >= 2): only discovered locations are in the journal
      const pips = st.compass >= 2 ? landmarkPips(state.profile?.journal?.locations, px, pz, yaw, HALF_SPAN) : [];
      while (pipPool.length < pips.length) { const n = el('div', { class: 'hud-pip' }, el('i'), el('span')); compassStrip.appendChild(n); pipPool.push(n); }
      pipPool.forEach((n, i) => {
        const p = pips[i];
        n.style.display = p ? '' : 'none';
        if (!p) return;
        n.style.left = `${50 + p.offset * 50}%`;
        n.children[1].textContent = p.name;
      });

      // live clue bearings: soft unlabeled ticks, width = uncertainty
      const live = clues.list(now);
      while (clueTickPool.length < live.length) { const n = el('div', { class: 'hud-clue-tick' }); compassStrip.appendChild(n); clueTickPool.push(n); }
      clueTickPool.forEach((n, i) => {
        const e = live[i];
        const off = e ? stripOffset(e.clue.bearing, yaw, HALF_SPAN) : null;
        if (off == null) { n.style.display = 'none'; return; }
        n.style.display = '';
        n.style.left = `${50 + off * 50}%`;
        n.style.width = `${spreadWidth(e.clue.spread, HALF_SPAN) * 100}%`;
        n.style.opacity = String(Math.max(0.15, clues.alpha(e, now) * (0.35 + 0.5 * (e.clue.strength || 0))));
      });
    }

    function updateClues(now) {
      const yaw = ctx.player?.yaw ?? 0;
      const gone = clues.prune(now);
      if (gone.length) syncClues(now);
      for (const e of clues.list(now)) {
        const rec = cards.get(e.id);
        if (!rec) { syncClues(now); continue; }
        rec.n.style.opacity = String(clues.alpha(e, now));
        rec.arrow.style.transform = `rotate(${arrowDegrees(e.clue.bearing, yaw)}deg)`;
      }
    }

    frame = () => {
      const now = ctx.time;
      applyLevel();
      if (level === 'hidden') { renderHintIfChanged(); return; }
      if (regionUntil && now > regionUntil) { regionName.classList.remove('banner'); regionUntil = 0; }
      updateCompass(now);
      updateClues(now);
      renderEnv();

      if (sightAt > -90 && now - sightAt > SIGHT_STALE) { sightEl.hidden = true; sightAt = -99; lastBird = 0; }
      sightEl.classList.toggle('flash', now < newKeyUntil);

      const recording = now - recAt < REC_STALE || (ctx.tools?.recording && now - recAt < 4);
      recEl.hidden = !recording;
      if (recording) {
        const s = Math.floor(recSeconds);
        recEl.lastChild.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }
      const stam = ctx.player?.stamina;
      const showStam = typeof stam === 'number' && stam < 0.985;
      staminaEl.classList.toggle('on', showStam);
      if (typeof stam === 'number') setRing(staminaRing, stam);

      for (const { def, n } of slotEls) {
        const act = ctx.tools?.active === def.tool;
        if (n.classList.contains('active') !== act) renderTools();
      }

      renderHintIfChanged();
    };

    function renderHintIfChanged() {
      const now = ctx.time;
      if (hints.tick(now)) lastHint = '';
      if (!hints.active && level === 'full') {
        for (const [id, at] of wanted) {
          if (at > now) continue;
          wanted.delete(id);
          if (hints.request(id, now)) break;
        }
      }
      const key = (hints.active?.id || '') + level + (state.settings?.hints !== false);
      if (key !== lastHint) { lastHint = key; renderHint(); }
      for (const gone of toasts.expire(now)) {
        const n = toastEls.get(gone.id);
        if (n) { dismissNode(n); toastEls.delete(gone.id); }
      }
    }

    // initial paint
    applyLevel();
  },

  update() { frame?.(); },
};
