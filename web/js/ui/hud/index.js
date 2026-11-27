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
import { ClueStore, clueCard, selectClueCards, oneClueCard, moreSoundsText } from './clues.js';
// [soundring hook] one clue card at a time: the voice being followed (Q pins it).
import { Pace, CalmCount, otherVoicesText, silentText } from '../soundring/follow.js';
import { ToastStack, toastSound } from './toasts.js';
import { trackedQuest, questForMystery, quarryMysteries } from './quest.js';
import { HintTracker, HINTS } from './hints.js';
import { sightingView } from './sighting.js';
import { hudLevel, toastsVisible } from './visibility.js';
import { forecastSlots } from './weather.js';
import { nextNudge, nudgeTarget, nudgeBearing, nudgeComplete, tutorialActive } from './nudges.js';
// [minimap module hook] the player's waypoints as pins on the compass strip.
import { createCompassWaypoints } from '../minimap/compass-pins.js';
import { createCompassArea, questSearchArea, areaLine } from './search-area.js'; // [search-area hook]

const FOCUS_TIP_USES = 3;         // after this many uses of focused listening the card tip retires
const FOLLOW_TIP_USES = 2;        // after this many uses of Q the "stay with this voice" tip retires
const FIRST_HEARD_GAP = 20;       // seconds between "first heard" flourishes (a hint, a new-voice mention)
const NEW_VOICE_SECONDS = 6;      // how long the quiet line mentions a new voice
const ALL_CARDS_MAX = 6;          // "Clue cards: All" never stacks more than this

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
    const waypointPins = createCompassWaypoints(ctx, compassStrip); // [minimap hook]
    const areaBand = createCompassArea(ctx, compassStrip); // [search-area hook] the quest's search area
    const compassDeg = el('div', { class: 'hud-compass-deg' });
    const compass = el('div', { class: 'hud-part hud-compass' }, compassStrip, el('div', { class: 'hud-compass-caret' }), compassDeg);

    const regionName = el('div', { class: 'hud-part hud-region' });
    const clockText = el('span', { class: 'hud-clock' });
    const phaseText = el('span', { class: 'hud-phase' });
    const weatherIcon = el('span', { class: 'hud-weather-icon' });
    const forecastEl = el('div', { class: 'hud-forecast' });
    // The readout hints at the Weather & Time page in the journal (J).
    const timeEl = el('div', { class: 'hud-part hud-time', title: 'Weather & Time: open the journal (J)' },
      el('div', { class: 'hud-time-row' }, weatherIcon, clockText, phaseText,
        el('kbd', { class: 'hud-time-key', 'aria-label': 'Journal key' }, 'J')), forecastEl);

    const questEl = el('div', { class: 'hud-part hud-quest', hidden: true });
    const clueList = el('div', { class: 'hud-part hud-clues' });
    const moreEl = el('div', { class: 'hud-clue-more', hidden: true });
    const cueLayer = el('div', { class: 'hud-part hud-cues' });
    const hintEl = el('div', { class: 'hud-part hud-hint', hidden: true });
    let nudgeTick = null; // compass tick toward a nudge target (Finn's stall)

    const promptEl = el('div', { class: 'hud-part hud-prompt', hidden: true });
    const sightEl = el('div', { class: 'hud-sight', hidden: true });
    const sightRing = svgRing('hud-sight-ring');
    const sightProgress = svgRing('hud-sight-progress', 21, 1.6);
    const sightCenter = el('div', { class: 'hud-sight-center' }, icon('eye', 14));
    const sightBlocked = el('div', { class: 'hud-sight-blocked' });
    const sightName = el('div', { class: 'hud-sight-name' });
    const sightChips = el('div', { class: 'hud-chips' });
    const sightBehavior = el('div', { class: 'hud-sight-behavior' });
    // Identification progress: "3 marks noted" and a pip per watchable mark (no names).
    const sightPips = el('span', { class: 'hud-pips' });
    const sightMarksText = el('span', { class: 'hud-marks-text' });
    const sightQuarry = el('span', { class: 'hud-marks-quarry', title: 'The bird your quest is about', hidden: true }, icon('quest', 11));
    const sightMarks = el('div', { class: 'hud-marks', hidden: true }, sightQuarry, sightPips, sightMarksText);
    const sightIdentify = el('div', { class: 'hud-sight-identify', hidden: true }, keycaps(['T']), el('span', 'Identify'));
    const sightMoment = el('div', { class: 'hud-sight-moment', hidden: true, title: 'A moment worth photographing' }, icon('camera', 15));
    sightEl.append(
      el('div', { class: 'hud-sight-top' },
        el('div', { class: 'hud-sight-ringwrap' }, sightRing, sightProgress, sightCenter, sightMoment),
        el('div', { class: 'hud-sight-text' }, sightName, sightMarks, sightBlocked, sightBehavior)),
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
      // Over an open screen the stack starts below the screen's header (close button).
      toastRoot.classList.toggle('hud-toasts-over-screen', state.mode === 'ui');
    }
    bus.on('focus', ({ on }) => {
      focusOn = !!on;
      if (on) {
        hints.complete('focus');
        // After a few uses the "Hold F" line on the cards has done its job.
        if (hints.bump('focusUses') >= FOCUS_TIP_USES) for (const rec of cards.values()) if (rec.showTip) { rec.showTip = false; rec.sig = ''; }
      }
      applyLevel(); renderHint();
    });
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
      const view = clueCard(c, { species: speciesName, mystery: mysteryLabel, quest: (m) => questForMystery(state.profile, state.quests, m) });
      const sig = JSON.stringify([view.title, view.subtitle, view.quest, view.dir, view.facts, view.confidence, view.unusual, view.new]);
      let rec = cards.get(c.id);
      if (!rec) {
        rec = { n: el('div', { class: 'hud-card' }), arrow: el('span', { class: 'hud-arrow', html: ARROW_SVG }), sig: '' };
        // [soundring hook] the follow line: "Following · silent for 12 s" / the Q tip.
        rec.footText = el('span');
        rec.foot = el('div', { class: 'hud-card-follow', hidden: true }, el('kbd', 'Q'), rec.footText);
        rec.footSig = '';
        // One "Hold F" line at a time, and only until focus has been used a few times.
        const tipOnScreen = [...cards.values()].some((r) => r.showTip && r.n.isConnected);
        rec.showTip = isNew && !tipOnScreen && hints.count('focusUses') < FOCUS_TIP_USES && hints.tipAvailable('focusTip', 6, 'focusTipRetired');
        if (rec.showTip) hints.tipShown('focusTip');
        // "Q: stay with this voice", on a few cards until Q has been used a couple of times.
        rec.followTip = isNew && !rec.showTip && hints.count('followUses') < FOLLOW_TIP_USES && hints.tipAvailable('followTip', 5, 'followTipRetired');
        if (rec.followTip) hints.tipShown('followTip');
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
          view.facts.length || view.confidence ? el('div', { class: 'hud-card-facts' },
            view.facts.map((f) => el('span', { class: 'hud-fact hud-fact-' + f.key }, f.text)),
            view.confidence ? el('span', { class: 'hud-card-conf' }, view.confidence) : null) : null,
          view.quest ? el('div', { class: 'hud-card-quest' }, icon('quest', 11), el('span', view.quest)) : null,
          view.unusual ? el('div', { class: 'hud-card-unusual' }, 'Something unusual…') : null,
          rec.showTip ? el('div', { class: 'hud-card-tip' }, 'Hold F to listen closely') : null,
          rec.foot);
      }
      return rec;
    }
    /** Mystery ids any active quest is about (tracked quest first). */
    function quarrySet() {
      const p = state.profile;
      const out = new Set();
      for (const [id, qs] of Object.entries(p?.quests || {})) {
        if (qs?.status !== 'active') continue;
        for (const m of quarryMysteries(p, id)) out.add(m);
      }
      return out;
    }
    // [soundring hook] "Clue cards: One at a time" (default) shows only the card of the
    // voice being followed (ctx.soundring.followId; Q pins it); every other voice is on
    // the sound ring and in one quiet line ("3 other voices"). "All" stacks the cards.
    const oneCard = () => state.settings?.clueCards !== 'all';
    const followId = () => ctx.soundring?.followId || 0;
    const firstHeard = new Pace(FIRST_HEARD_GAP);
    const others = new CalmCount(6); // "3 other voices" rises at once, falls slowly
    let shownIds = new Set(), newVoiceUntil = 0, lastFollow = 0, lastPinned = false, lastOne = null, othersAt = 0;
    function syncClues(now) {
      const one = oneCard(), fid = followId();
      othersAt = now + 0.5;
      const all = clues.all(now, fid);
      const opts = { quarry: quarrySet(), tutorial: tutorialActive(state.profile) };
      const pick = one ? oneClueCard(all, fid, { ...opts, now })
        : selectClueCards(all, { ...opts, max: Math.min(ALL_CARDS_MAX, clues.cap) });
      if (one !== lastOne) { lastOne = one; clueList.classList.toggle('one', one); }
      const live = pick.shown;
      const keep = new Set(live.map((e) => e.id));
      shownIds = keep;
      // Cards of sounds that are still live but folded away keep their record (and tip state).
      for (const [id, rec] of cards) if (!keep.has(id)) { rec.n.remove(); if (!clues.map.has(id)) cards.delete(id); }
      live.forEach((entry, i) => {
        const rec = cardFor(entry, now - entry.born < 0.5);
        if (rec.n.parentNode !== clueList || clueList.children[i] !== rec.n) clueList.insertBefore(rec.n, clueList.children[i] || null);
      });
      const more = one ? otherVoicesText(others.update(pick.hidden, now), now < newVoiceUntil && pick.fresh) : moreSoundsText(pick.hidden);
      if (moreEl.textContent !== more) moreEl.textContent = more;
      moreEl.hidden = !more;
      if (moreEl.parentNode !== clueList || clueList.lastChild !== moreEl) clueList.appendChild(moreEl);
    }
    bus.on('net:clue', (c) => {
      if (!c) return;
      clues.setCap(Math.max(2, Math.round(stats().clueSlots || 2)));
      if (!(c.ttl > 0)) { // the engine let this voice go (its slot went to a louder one)
        const old = clues.get(c.id);
        if (old) { old.expires = Math.min(old.expires, nowT()); syncClues(nowT()); }
        return;
      }
      const { isNew } = clues.upsert(c, nowT());
      // First-heard flourishes are paced: the "Hold F" hint or a "A new voice" mention
      // in the quiet line, at most one every FIRST_HEARD_GAP seconds.
      if (isNew && firstHeard.ready(nowT())) {
        if (hints.available('focus') && !wanted.has('focus')) { wantHint('focus'); firstHeard.allow(nowT()); }
        else if (c.new && !c.known && c.id !== followId()) { newVoiceUntil = nowT() + NEW_VOICE_SECONDS; firstHeard.allow(nowT()); }
      }
      syncClues(nowT());
    });
    bus.on('action:follow', () => {
      if (hints.bump('followUses') >= FOLLOW_TIP_USES) for (const rec of cards.values()) rec.followTip = false;
    });
    bus.on('settings', ({ key } = {}) => { if (key === 'clueCards') syncClues(nowT()); });

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
      const v = sightingView(s, speciesName, (m) => quarrySet().has(m));
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
      sightIdentify.classList.toggle('pulse', v.pulse);
      sightMarks.hidden = !v.marks.have && !v.quarry;
      if (!sightMarks.hidden) {
        sightMarksText.textContent = v.marksText || 'Watching…';
        sightQuarry.hidden = !v.quarry;
        if (sightPips.childElementCount !== v.marks.total) fill(sightPips, Array.from({ length: v.marks.total }, () => el('i')));
        [...sightPips.children].forEach((n, i) => n.classList.toggle('on', i < v.marks.have));
      }
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
      if (String(t.id || '').startsWith('fg@') && /pick/i.test(t.verb || 'pick')) nearForage = true;
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
      const qa = q ? questSearchArea(state.profile) : null; // [search-area hook]
      const areaText = qa && qa.questId === q.id && q.objectives.length ? areaLine(qa) : '';
      const sig = JSON.stringify(q) + areaText;
      if (sig === questSig) return;
      questSig = sig;
      if (!q) { questEl.hidden = true; toastPad(); return; }
      questEl.hidden = false;
      fill(questEl,
        el('div', { class: 'hud-quest-name' }, icon('quest', 13), el('span', q.name)),
        q.objectives.map((o) => el('div', { class: 'hud-quest-obj' }, el('i'), el('span', o.text))),
        q.quarry && q.objectives.length ? el('div', { class: 'hud-quest-quarry' }, 'In your journal as ', el('b', q.quarry)) : null,
        areaText ? el('div', { class: 'hud-quest-area' }, areaText) : null, // [search-area hook]
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
    let lastHint = '';
    const wanted = new Map(); // id -> earliest time
    function wantHint(id, delay = 0) { if (!wanted.has(id) && hints.available(id)) wanted.set(id, nowT() + delay); }
    function renderHint() {
      const a = hints.active;
      const show = !!a && state.settings?.hints !== false && level === 'full';
      hintEl.hidden = !show;
      if (!show) return;
      const h = HINTS[a.id] || {};
      fill(hintEl,
        h.icon ? el('span', { class: 'hud-hint-icon' }, icon(h.icon, 16)) : null,
        h.keys?.length ? keycaps(h.keys) : null,
        el('span', h.text || ''),
        h.once ? el('button', { type: 'button', class: 'hud-hint-close', title: 'Dismiss', 'aria-label': 'Dismiss hint',
          onclick: () => { hints.dismiss(); lastHint = ''; renderHint(); } }, icon('close', 12)) : null);
      hintEl.classList.toggle('nudge', !!h.once);
    }
    for (const a of ['forward', 'back', 'left', 'right']) bus.on('action:' + a, () => { if (hints.complete('movement')) renderHint(); wanted.delete('movement'); });
    bus.on('action:focus', () => { hints.complete('focus'); wanted.delete('focus'); renderHint(); });
    bus.on('action:journal', () => { hints.complete('journal'); wanted.delete('journal'); renderHint(); });
    bus.on('ui:open', ({ name }) => {
      if (name === 'journal') { hints.complete('journal'); wanted.delete('journal'); }
      for (const id of ['finn', 'cabin', 'cook', 'nest']) {
        if (nudgeComplete(id, { opened: name }) && hints.wasShown(id)) { hints.complete(id); wanted.delete(id); }
      }
    });
    // Talking to Finn counts as finding his stall.
    bus.on('net:dialog', (d) => { if (d?.npc === 'finn' && hints.wasShown('finn')) { hints.complete('finn'); wanted.delete('finn'); } });
    bus.on('game:start', () => wantHint('movement', 2.5));

    /* ------------------------------------------------------------ frame update */
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

      waypointPins.update(px, pz, yaw, HALF_SPAN); // [minimap hook] waypoint pins (max 4 nearest)
      areaBand.update(px, pz, yaw, HALF_SPAN); // [search-area hook]

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

      // A soft moss tick toward the place an onboarding nudge points at (Finn's stall).
      const target = hints.active ? nudgeTarget(hints.active.id, state.pois) : null;
      const b = target ? nudgeBearing(target, px, pz) : null;
      const off = b == null ? null : stripOffset(b, yaw, HALF_SPAN);
      if (off != null && !nudgeTick) { nudgeTick = el('div', { class: 'hud-nudge-tick' }, el('i'), el('span')); compassStrip.appendChild(nudgeTick); }
      if (nudgeTick) {
        nudgeTick.style.display = off == null ? 'none' : '';
        if (off != null) {
          nudgeTick.style.left = `${50 + off * 50}%`;
          nudgeTick.lastChild.textContent = target?.kind === 'shop' ? 'Finn' : '';
        }
      }
    }

    function updateClues(now) {
      const yaw = ctx.player?.yaw ?? 0;
      // [soundring hook] the followed voice keeps its card between its calls
      const fid = followId(), pinned = !!ctx.soundring?.pinned;
      const gone = clues.prune(now, fid);
      let resync = gone.length > 0 || fid !== lastFollow || pinned !== lastPinned || (others.lowSince != null && now >= othersAt);
      if (newVoiceUntil && now >= newVoiceUntil) { newVoiceUntil = 0; resync = true; }
      lastFollow = fid; lastPinned = pinned;
      if (resync) syncClues(now);
      for (const id of shownIds) {
        const e = clues.get(id);
        const rec = cards.get(id);
        if (!e || !rec || !rec.n.parentNode) continue;
        const mine = id === fid;
        const alpha = clues.alpha(e, now);
        const shown = mine ? (pinned || ctx.soundring.followLive ? 1 : 0.72) : alpha; // dimmed between its calls
        if (rec.alpha !== shown) { rec.alpha = shown; rec.n.style.opacity = String(shown); }
        rec.arrow.style.transform = `rotate(${arrowDegrees(e.clue.bearing, yaw)}deg)`;
        // highlight the card of the voice the player is facing
        const facing = ctx.soundring?.facingId === id;
        if (rec.facing !== facing) { rec.facing = facing; rec.n.classList.toggle('sr-facing', facing); }
        // the follow line: pinned = "Following (· silent for 12 s)", else the Q tip
        const hold = mine && pinned;
        const silent = hold ? silentText(ctx.soundring.silentFor) : '';
        const text = hold ? `Following · ${silent || 'again to let go'}` : mine && rec.followTip ? 'stay with this voice' : '';
        const sig = (hold ? 'p' : '') + text;
        if (rec.footSig !== sig) {
          rec.footSig = sig;
          rec.footText.textContent = text;
          rec.foot.hidden = !text;
          rec.n.classList.toggle('sr-pinned', hold);
        }
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

    let nudgeAt = 0, nearForage = false;
    function checkNudges(now) {
      if (now < nudgeAt) return;
      nudgeAt = now + 1;
      const p = state.profile;
      if (!p) return;
      // Finn's stall reached (or the hint already shown and the player walked there).
      if (hints.wasShown('finn') && !hints.isDone('finn')) {
        const t = nudgeTarget('finn', state.pois);
        const f = ctx.player?.feet;
        if (t?.pos && f && nudgeComplete('finn', { near: Math.hypot(t.pos.x - f.x, t.pos.z - f.z) })) {
          if (hints.complete('finn')) lastHint = '';
        }
      }
      const id = nextNudge({ profile: p, items: state.items, nearForage, wasShown: (k) => hints.wasShown(k) }, (k) => hints.available(k));
      if (id && !wanted.has(id)) wanted.set(id, now + (id === 'finn' ? 4 : 1.2));
      nearForage = false;
    }
    function renderHintIfChanged() {
      const now = ctx.time;
      if (level === 'full') checkNudges(now);
      if (hints.tick(now)) lastHint = '';
      if (!hints.active && level === 'full') {
        // Onboarding nudges (shown once) go before the repeatable first-time tips.
        const queue = [...wanted].sort((a, b) => (HINTS[b[0]]?.once ? 1 : 0) - (HINTS[a[0]]?.once ? 1 : 0));
        for (const [id, at] of queue) {
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
