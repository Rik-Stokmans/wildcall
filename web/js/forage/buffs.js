// Buff chips on the HUD (task c-field): one chip per active food or drink effect
// (profile.buffs, at most one per slot), with a small painting of what was eaten inside
// a ring that empties as the effect wears off, the time left, and — for a few seconds
// after eating, or on hover — the name and what it does. A chip whose buff has gone
// fades away. The chips live in #hud, so the HUD's visibility levels apply to them.
import { el, fill } from '../ui/kit.js';
import { drawItemArt } from './art.js';
import { sortBuffs, gameHoursNow, buffRemaining, buffFraction, formatHoursShort, formatHours, SLOT_LABELS, goneBuffs } from './logic.js';

const R = 19;
const CIRC = 2 * Math.PI * R;
const EXPAND_S = 6;
const TICK = 0.25;

function ring() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 46 46');
  svg.setAttribute('class', 'frg-buff-ring');
  const mk = (cls) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', 23); c.setAttribute('cy', 23); c.setAttribute('r', R);
    c.setAttribute('fill', 'none'); c.setAttribute('class', cls);
    c.setAttribute('transform', 'rotate(-90 23 23)');
    c.style.strokeDasharray = String(CIRC);
    return c;
  };
  const track = mk('frg-ring-track'), bar = mk('frg-ring-bar');
  svg.append(track, bar);
  svg.bar = bar;
  return svg;
}

export function createBuffChips(ctx) {
  const { state, bus } = ctx;
  const host = el('div', { class: 'hud-part frg-buffs', role: 'status', 'aria-label': 'Food and drink' });
  const chips = new Map(); // key → {buff, node, ring, time, born}
  let envAt = 0;
  let tick = 0;
  let prev = [];

  const key = (b) => b.slot + ':' + b.item + ':' + b.until;

  function mount() {
    if (host.isConnected) return;
    const hud = document.getElementById('hud');
    if (hud) hud.appendChild(host);
  }

  function build(b) {
    const r = ring();
    const time = el('span', { class: 'frg-buff-time' });
    const node = el('div', { class: `frg-buff frg-buff-${b.slot} expanded`, dataset: { slot: b.slot } },
      el('div', { class: 'frg-buff-badge' }, r, el('div', { class: 'frg-buff-art' }, drawItemArt(b.item, 26, state.items?.[b.item]))),
      el('div', { class: 'frg-buff-text' },
        el('b', b.name || state.items?.[b.item]?.name || b.item),
        el('span', b.text || '')),
      time);
    node.title = `${b.name}: ${b.text}`;
    return { buff: b, node, ring: r, time, born: ctx.time };
  }

  function sync() {
    mount();
    const list = sortBuffs(state.profile?.buffs || []);
    const keep = new Set(list.map(key));
    for (const gone of goneBuffs(prev, list)) {
      const c = chips.get(key(gone));
      if (!c) continue;
      chips.delete(key(gone));
      c.node.classList.add('gone');
      setTimeout(() => c.node.remove(), 900);
    }
    for (const [k, c] of chips) if (!keep.has(k)) { chips.delete(k); c.node.classList.add('gone'); setTimeout(() => c.node.remove(), 900); }
    for (const b of list) {
      const k = key(b);
      if (chips.has(k)) continue;
      const c = build(b);
      chips.set(k, c);
    }
    // keep DOM order meal → drink → snack, leaving fading chips where they are
    for (const b of list) host.appendChild(chips.get(key(b)).node);
    prev = list;
    paint();
  }

  function paint() {
    const now = gameHoursNow(state.env, ctx.time - envAt);
    for (const c of chips.values()) {
      const left = buffRemaining(c.buff, now);
      const f = buffFraction(c.buff, now);
      c.ring.bar.style.strokeDashoffset = String(CIRC * (1 - f));
      c.time.textContent = formatHoursShort(left);
      c.node.title = `${c.buff.name} (${SLOT_LABELS[c.buff.slot] || c.buff.slot}): ${c.buff.text}. ${left > 0 ? formatHours(left) + ' left.' : 'Wearing off.'}`;
      c.node.classList.toggle('low', left > 0 && left < 0.34);
      c.node.classList.toggle('expanded', ctx.time - c.born < EXPAND_S);
      if (left <= 0) c.node.classList.add('ending');
    }
  }

  bus.on('welcome', () => { prev = []; for (const c of chips.values()) c.node.remove(); chips.clear(); sync(); });
  bus.on('profile', sync);
  bus.on('env', () => { envAt = ctx.time; });

  return {
    host,
    update(dt) {
      tick -= dt;
      if (tick > 0) return;
      tick = TICK;
      if (chips.size) paint();
    },
    get count() { return chips.size; },
  };
}
