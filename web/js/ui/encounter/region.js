// Screen "region" (overlay): Region Discovery (spec §17, §28 screen 16), or the kind
// "The trail beyond is closed for now" card when the region is still locked.
import { label } from '../kit.js';
import { el, fill, button, ico, sound, screenFrame, confirmKey } from './shell.js';
import { regionView } from './rewardlogic.js';
import { landscapePlan } from './landscape.js';

const BW = 640, BH = 220;

/** Paint a landscapePlan onto a canvas (soft, flat, hand-painted look). */
export function paintBanner(plan) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = document.createElement('canvas');
  c.width = BW * dpr; c.height = BH * dpr;
  c.style.width = '100%'; c.style.aspectRatio = `${BW} / ${BH}`;
  c.className = 'enc-banner-canvas';
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const sky = g.createLinearGradient(0, 0, 0, BH);
  sky.addColorStop(0, plan.sky[0]); sky.addColorStop(1, plan.sky[1]);
  g.fillStyle = sky; g.fillRect(0, 0, BW, BH);
  const halo = g.createRadialGradient(plan.sun.x, plan.sun.y, 0, plan.sun.x, plan.sun.y, plan.sun.r * 4);
  halo.addColorStop(0, 'rgba(255,244,210,.8)'); halo.addColorStop(1, 'rgba(255,244,210,0)');
  g.fillStyle = halo; g.fillRect(0, 0, BW, BH);
  g.fillStyle = plan.sun.color; g.beginPath(); g.arc(plan.sun.x, plan.sun.y, plan.sun.r, 0, Math.PI * 2); g.fill();

  plan.hills.forEach((hill, i) => {
    g.fillStyle = hill.color;
    g.beginPath(); g.moveTo(0, BH);
    for (const [x, y] of hill.points) g.lineTo(x, y);
    g.lineTo(BW, BH); g.closePath(); g.fill();
    if (i === 0 && plan.traits.snow) { g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.moveTo(0, BH); for (const [x, y] of hill.points) g.lineTo(x, y + 6); g.lineTo(BW, BH); g.fill(); }
  });
  if (plan.water) {
    g.fillStyle = plan.water.color; g.globalAlpha = 0.85;
    g.fillRect(0, plan.water.y, BW, BH - plan.water.y);
    g.globalAlpha = 0.35; g.strokeStyle = '#fff'; g.lineWidth = 1.4;
    for (let i = 0; i < 9; i++) { const y = plan.water.y + 6 + i * 4, x = (i * 97) % BW; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y - 3, x + 28, y); g.stroke(); }
    g.globalAlpha = 1;
  }
  for (const d of plan.details) {
    if (d.kind === 'sand') { g.fillStyle = '#E3D2A8'; g.fillRect(0, d.y, BW, BH - d.y); }
    if (d.kind === 'crag') { g.fillStyle = 'rgba(70,62,56,.7)'; g.beginPath(); g.moveTo(d.x - 26 * d.s, d.y + 30); g.lineTo(d.x - 6 * d.s, d.y - 24 * d.s); g.lineTo(d.x + 8 * d.s, d.y - 6 * d.s); g.lineTo(d.x + 28 * d.s, d.y + 30); g.fill(); }
  }
  for (const t of plan.trees) {
    const s = t.s * 22;
    g.fillStyle = '#5A4332'; g.fillRect(t.x - 1.5 * t.s, t.y - s * 0.2, 3 * t.s, s * 0.7);
    g.fillStyle = t.color;
    if (t.kind === 'pine') {
      for (let k = 0; k < 3; k++) { const w = s * (0.55 + k * 0.22), y = t.y - s * 1.5 + k * s * 0.5; g.beginPath(); g.moveTo(t.x, y - s * 0.5); g.lineTo(t.x - w * 0.5, y + s * 0.45); g.lineTo(t.x + w * 0.5, y + s * 0.45); g.closePath(); g.fill(); }
    } else {
      g.beginPath(); g.arc(t.x, t.y - s * 0.75, s * 0.7, 0, Math.PI * 2); g.arc(t.x - s * 0.45, t.y - s * 0.45, s * 0.5, 0, Math.PI * 2); g.arc(t.x + s * 0.45, t.y - s * 0.45, s * 0.5, 0, Math.PI * 2); g.fill();
    }
  }
  for (const d of plan.details) {
    if (d.kind === 'reed') { g.strokeStyle = d.color; g.lineWidth = 1.6; g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x + 2, d.y - 26 * d.s); g.stroke(); g.fillStyle = '#7A5C3E'; g.fillRect(d.x + 0.5, d.y - 30 * d.s, 3, 9 * d.s); }
    if (d.kind === 'flake') { g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(d.x, d.y, d.r, 0, Math.PI * 2); g.fill(); }
    if (d.kind === 'leaf') { g.fillStyle = d.color; g.beginPath(); g.ellipse(d.x, d.y, d.r * 1.6, d.r, 0.6, 0, Math.PI * 2); g.fill(); }
  }
  // Paper-edge vignette so the banner sits in the notebook page.
  const vg = g.createRadialGradient(BW / 2, BH / 2, BH * 0.5, BW / 2, BH / 2, BW * 0.65);
  vg.addColorStop(0, 'rgba(60,45,30,0)'); vg.addColorStop(1, 'rgba(60,45,30,.22)');
  g.fillStyle = vg; g.fillRect(0, 0, BW, BH);
  return c;
}

export function createRegion(ctx) {
  const { state, ui, bus } = ctx;
  let data = null;
  const frame = screenFrame({ cls: 'enc-region', title: 'Region', overlay: true });
  frame.card.classList.add('enc-card-wide-ish');

  function close() { sound(ctx, 'click'); ui.close('region'); }

  function render() {
    const v = regionView(data, state.regions, { rank: state.profile?.rank, ranks: state.ranks, quests: state.quests });
    let banner;
    try { banner = paintBanner(landscapePlan({ key: v.key, color: v.color, habitats: v.habitats }, BW, BH)); } catch (err) { console.warn('[encounter] banner failed', err); banner = el('div', { class: 'enc-banner-canvas' }); }
    frame.root.classList.toggle('is-locked', !v.unlocked);
    if (!v.unlocked) {
      frame.setTitle('The trail beyond is closed for now', v.name);
      const needs = v.needs.length ? v.needs : [];
      fill(frame.body,
        el('div', { class: 'enc-banner locked' }, banner, el('div', { class: 'enc-banner-lock' }, ico('lock', 40))),
        el('p', { class: 'enc-closed-lead' }, `${v.name} is waiting for you, just not yet.`),
        v.reason ? el('p', { class: 'enc-closed-reason' }, v.reason) : null,
        needs.length ? el('div', { class: 'enc-needs' }, el('h4', {}, 'To open this trail'),
          el('ul', { class: 'enc-lines' }, needs.map((n) => el('li', { class: n.met ? 'met' : '' }, ico(n.met ? 'check' : 'gate', 16), el('span', {}, n.text))))) : null,
        el('p', { class: 'enc-closed-note' }, 'There is plenty left to discover on the paths you already know. Come back when you are ready.'));
      fill(frame.footer, el('div', { class: 'enc-foot-actions' }, button('Back to the trail', { variant: 'primary', icon: 'back', onClick: close })));
      return;
    }
    frame.setTitle('New Region Discovered', v.tagline);
    fill(frame.body,
      el('div', { class: 'enc-banner' }, banner, el('div', { class: 'enc-banner-title' }, el('span', {}, 'You have entered'), el('b', {}, v.name))),
      v.desc ? el('p', { class: 'enc-region-desc' }, v.desc) : null,
      el('div', { class: 'enc-region-cols' },
        el('div', {}, el('h4', {}, 'Habitats'), el('div', { class: 'enc-chips' }, v.habitats.map((h) => el('span', { class: 'enc-chip' }, h)))),
        el('div', {}, el('h4', {}, 'Wildlife'), el('div', { class: 'enc-bigstat' }, ico('bird', 28), el('b', {}, String(v.speciesCount)), el('span', {}, v.speciesCount === 1 ? 'species lives here' : 'species live here')))),
      v.hints.length ? el('div', { class: 'enc-section' }, el('h4', {}, 'Things to explore'),
        el('ul', { class: 'enc-lines' }, v.hints.map((h) => el('li', {}, ico('compass', 16), el('span', {}, label(h)))))) : null);
    fill(frame.footer, el('div', { class: 'enc-foot-actions' },
      button('Open the map', { variant: 'secondary', icon: 'map', onClick: () => { sound(ctx, 'page'); ui.open('map', {}); } }),
      button('Set out', { variant: 'primary', icon: 'forward', onClick: close })));
  }

  confirmKey(ctx, 'region', close);
  bus.on('profile', () => { if (ui.isOpen('region') && data) render(); });

  ui.register('region', {
    root: frame.root, overlay: true, closable: true,
    open(msg) { data = msg || {}; render(); sound(ctx, data.unlocked ? 'discover' : 'page'); },
  });
}
