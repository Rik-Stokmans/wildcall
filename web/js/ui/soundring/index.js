// Sound ring: a thin ring around the centre of the view that shows where each heard call
// comes from, like the directional sound indicator in a shooter (spec §5, §29.1).
//
//   * one soft arc per heard source (the strongest five), at the angle of the sound
//     relative to where the player looks: top = ahead, right = right, bottom = behind;
//   * arc width = the clue's uncertainty (Spread): a vague far voice is a wide faint
//     smear, a close one a tight bright tick; it pulses each time that bird calls and
//     fades over the clue's ttl;
//   * up / down: an arc on the outer track with a small "^" is above the line of sight,
//     on the inner track with a "v" below it;
//   * homing: when the voice is in front, inside the view, the arc slides to the direction
//     on screen (a voice ahead, up and left = a tick at the upper left), and when the line
//     of sight is within the clue's uncertainty the ring tightens and glows softly.
//
//   * following: ONE voice is followed at a time (follow.js): the quest's target when it
//     is audible, else the voice faced for about a second, else the loudest; Q pins the
//     voice being faced (Q again lets go). The followed arc is drawn strongest and its
//     id is what the HUD shows a clue card for; while a voice is pinned the other arcs
//     dim to about a third and the pinned arc stays through its silences (up to 45 s).
//
// It is driven ONLY by the clue (perceived bearing / elevation, which already contain the
// listener's error), never by a bird's true position, never names an unknown bird and
// never draws anything in the world. Settings: soundRing (on/off), soundRingSize.
// The following itself works with the ring switched off (the HUD card still follows).
import {
  DEG, TAU, relAngle, lerpAngle, ease, easeAngle, arcHalfWidth, clueElevation, nearness, arcStyle,
  viewPlacement, onTarget, lifeFade, ringRadius, pickTop, layerText, clamp01, smoothstep,
} from './ring-math.js';
import { Follower } from './follow.js';
import { quarryMysteries } from '../hud/quest.js';

const MAX_TRACKS = 24;
const MAX_ARCS = 5;
const CREAM = '#FFF7E8';
const EDGE = '#120e0a';
const AMBER = '#F0C38E';
// Stacked spans of a wide arc: fraction of the half-width, line width, alpha.
const SPANS = [1, 0.72, 0.46, 0.22];
const SPAN_W = [0.6, 0.8, 0.95, 1];
const SPAN_A = [0.32, 0.36, 0.45, 0.6];
const FONT = '600 13px "Avenir Next", "Nunito", "Segoe UI", system-ui, sans-serif';

function newTrack() {
  return {
    id: 0, live: false, clue: null,
    bearing: 0, bearingShown: 0, spread: 0, spreadShown: 0,
    hasElev: false, elev: 0, elevShown: 0, elevSpread: 0,
    strength: 0, near: 0, expires: 0, heardAt: -1e9, ttl: 1, pulse: 0, lastPulse: -9,
    alpha: 0, angleShown: 0, trackShown: 0, quarry: false, color: '', layer: '',
    score: 0, rank: -1, onT: 0, onRaw: 0, front: 0, up: 0,
    place: { flat: 0, screen: 0, front: 0, angle: 0, offset: 0, up: 0 },
  };
}

const sr = {
  name: 'soundring',

  init(ctx) {
    const { bus, state } = ctx;
    const tracks = [];
    for (let i = 0; i < MAX_TRACKS; i++) tracks.push(newTrack());
    const byId = new Map();
    const top = new Array(MAX_ARCS).fill(0);
    const elevTmp = { angle: 0, spread: 0 };
    const style = { alpha: 0, width: 0 };
    let quarry = new Set();
    let focus = false;

    const canvas = document.createElement('canvas');
    canvas.className = 'sr-ring';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.display = 'none';
    document.body.appendChild(canvas);
    const g = canvas.getContext('2d');

    const view = { w: 0, h: 0, dpr: 1, side: 0, size: 'normal', shown: false, cleared: true };
    let ringFade = 0, slimAmt = 0, focusAmt = 0, glowShown = 0, radiusShown = 0, dimShown = 0, pinShown = 0;
    const follower = new Follower();
    const note = { text: '', until: 0 }; // a word under the ring after Q
    /**
     * ctx.soundring:
     *   facingId / facingLayer  the voice the player is looking toward (0 / '' = none)
     *   followId                the ONE voice being followed (0 = none): the HUD's clue card
     *   pinned                  true while that voice is held with Q
     *   followLive              that voice is sounding (false = between its calls)
     *   silentFor               seconds since the followed voice was last heard
     * Bus: 'soundring:follow' {id, pinned} whenever followId or pinned changes.
     */
    const api = { facingId: 0, facingLayer: '', followId: 0, pinned: false, followLive: false, silentFor: 0, get visible() { return view.shown; } };
    const turn = { yaw: 0, pitch: 0, at: -1e9 }; // the last time the view turned (for "facing")
    ctx.soundring = api;
    // For the screenshot harness and the console: what the ring is showing right now.
    api.debug = () => tracks.filter((t) => t.live).map((t) => ({
      id: t.id, angle: +(t.angleShown / DEG).toFixed(1), half: +(arcHalfWidth(t.spreadShown) / DEG).toFixed(1),
      alpha: +t.alpha.toFixed(2), left: +(t.expires - now()).toFixed(1), onT: +t.onT.toFixed(2), front: +t.front.toFixed(2),
      up: +(t.up / DEG).toFixed(1), score: +t.score.toFixed(2),
      follow: t.id === follower.id ? (follower.pinned ? 'pinned' : 'yes') : '' }));

    const settingOn = () => state.settings?.soundRing !== false;
    const sizeKey = () => state.settings?.soundRingSize || 'normal';

    function layout() {
      const w = window.innerWidth || 1280, h = window.innerHeight || 720;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const size = sizeKey();
      // Room for the largest state (focus + slim) plus the ripple, chevrons and caption.
      const side = Math.ceil(2 * (ringRadius(h, size, true, true) + 56));
      if (w === view.w && h === view.h && dpr === view.dpr && side === view.side) return;
      view.w = w; view.h = h; view.dpr = dpr; view.side = side; view.size = size;
      canvas.width = Math.round(side * dpr);
      canvas.height = Math.round(side * dpr);
      canvas.style.width = side + 'px';
      canvas.style.height = side + 'px';
      canvas.style.left = Math.round((w - side) / 2) + 'px';
      canvas.style.top = Math.round((h - side) / 2) + 'px';
      view.cleared = false;
    }
    layout();
    bus.on('resize', layout);
    window.addEventListener('resize', layout);
    bus.on('settings', ({ key } = {}) => { if (key === 'soundRingSize') layout(); });

    function refreshQuarry() {
      const p = state.profile;
      const out = new Set();
      for (const [id, qs] of Object.entries(p?.quests || {})) {
        if (qs?.status !== 'active') continue;
        for (const m of quarryMysteries(p, id)) out.add(m);
      }
      quarry = out;
      for (const t of tracks) if (t.live) t.quarry = !!(t.clue?.mystery && quarry.has(t.clue.mystery));
    }
    bus.on('profile', refreshQuarry);
    bus.on('welcome', refreshQuarry);

    const now = () => ctx.time || 0;

    function pulse(t, at) {
      if (at - t.lastPulse < 0.25) return;
      t.lastPulse = at;
      t.pulse = 1;
    }

    function take(id) {
      let t = byId.get(id);
      if (t) return t;
      t = tracks.find((x) => !x.live);
      if (!t) { // all in use: reuse the weakest (never the followed one)
        for (const x of tracks) if (x.id !== follower.id && (!t || x.score < t.score)) t = x;
        byId.delete(t.id);
      }
      t.live = true; t.id = id; t.alpha = 0; t.pulse = 0; t.lastPulse = -9;
      t.clue = null;
      byId.set(id, t);
      return t;
    }

    bus.on('net:clue', (c) => {
      if (!c || c.id == null) return;
      const at = now();
      // TTL 0 (and strength 0) is the engine evicting the voice: let its arc fade out.
      if (!(c.ttl > 0)) {
        // (The followed voice keeps its arc: the player is attending to it, see net:call.)
        const old = byId.get(c.id);
        if (old && old.id !== follower.id) old.expires = Math.min(old.expires, at);
        return;
      }
      const fresh = !byId.has(c.id);
      const t = take(c.id);
      t.clue = c;
      t.bearing = Number(c.bearing) || 0;
      t.spread = Math.abs(Number(c.spread) || 0);
      t.strength = clamp01(Number(c.strength) || 0);
      t.near = nearness(c);
      const e = clueElevation(c, elevTmp);
      t.hasElev = !!e;
      if (e) { t.elev = e.angle; t.elevSpread = e.spread; }
      t.ttl = c.ttl;
      t.expires = at + t.ttl;
      t.heardAt = at;
      t.quarry = !!(c.mystery && quarry.has(c.mystery));
      t.score = t.strength + (t.quarry ? 1 : 0) + (c.new ? 0.3 : 0);
      t.layer = layerText(c);
      const sp = c.known ? state.speciesById?.[c.known] : null;
      t.color = sp ? (sp.look?.colors?.head || sp.look?.colors?.belly || CREAM) : '';
      if (fresh) {
        t.bearingShown = t.bearing; t.spreadShown = t.spread; t.elevShown = t.hasElev ? t.elev : 0;
        t.angleShown = relAngle(t.bearing, ctx.player?.yaw || 0);
        t.trackShown = 0;
      }
      pulse(t, at);
    });
    // The audio engine plays a bout on net:call; pulse the arc of that voice if heard.
    // Only the fact THAT this voice sounded is used, never where the call came from.
    bus.on('net:call', (m) => {
      const t = m ? byId.get(m.bird) : null;
      if (!t || !t.live) return;
      const at = now();
      pulse(t, at);
      // The followed voice sounding again keeps its arc and its card (at the direction
      // last perceived), also while louder voices hold the engine's clue slots.
      if (t.id === follower.id) { t.heardAt = at; t.expires = Math.max(t.expires, at + t.ttl); }
    });
    bus.on('focus', ({ on } = {}) => { focus = !!on; });
    // While the HUD's observation readout is up (a bird is being watched) it sits right
    // under the ring: the "where to look" caption gives way to it.
    let sightAt = -9;
    bus.on('net:sighting', (m) => { sightAt = m && m.bird ? now() : -9; });

    function publishFollow() {
      if (follower.id === api.followId && follower.pinned === api.pinned) return;
      api.followId = follower.id;
      api.pinned = follower.pinned;
      bus.emit('soundring:follow', { id: api.followId, pinned: api.pinned });
    }
    // Q: follow the voice being faced until Q again (see follow.js).
    bus.on('action:follow', () => {
      const at = now();
      const was = follower.pinned, wasId = follower.id;
      const on = follower.togglePin(at, tracks, MAX_TRACKS, api.facingId);
      note.text = on ? (was && wasId !== follower.id ? 'Following this voice instead' : 'Following this voice')
        : was ? 'Let go' : 'No voice to follow yet';
      note.until = at + 1.8;
      try { ctx.audio?.uiSound?.(on || was ? 'click' : 'error'); } catch { /* audio is optional */ }
      publishFollow();
    });

    function drop(t) { t.live = false; byId.delete(t.id); t.clue = null; t.score = -1; }

    /* ------------------------------------------------------------ drawing helpers */
    // Ring angle (0 = top, clockwise) to canvas angle (0 = +x, clockwise).
    const ca = (a) => a - Math.PI / 2;

    function strokeArc(cx, cy, r, a0, a1, width, color, alpha) {
      if (alpha <= 0.003 || width <= 0) return;
      g.globalAlpha = alpha > 1 ? 1 : alpha;
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.arc(cx, cy, r, ca(a0), ca(a1));
      g.stroke();
    }

    function chevron(x, y, up, s, alpha) {
      const d = up ? -1 : 1;
      for (let pass = 0; pass < 2; pass++) {
        g.globalAlpha = alpha * (pass ? 1 : 0.5);
        g.strokeStyle = pass ? CREAM : EDGE;
        g.lineWidth = pass ? 1.6 : 3.6;
        g.beginPath();
        g.moveTo(x - s, y - d * s * 0.5);
        g.lineTo(x, y + d * s * 0.5);
        g.lineTo(x + s, y - d * s * 0.5);
        g.stroke();
      }
    }

    function drawArc(t, cx, cy, R, k, fade) {
      const half = arcHalfWidth(t.spreadShown) * (1 - 0.35 * t.front);
      arcStyle(t.strength, t.near, half, fade, t.pulse, style);
      // Near the centre of the view the glowing ring takes over from the tick.
      let a = style.alpha * t.alpha * ringFade * (1 - 0.35 * t.onT * t.front);
      if (focus) a = Math.min(1, a * 1.25);
      const mine = t.id === follower.id;
      // The followed voice is the strongest arc; while one is pinned the others dim to a third.
      a = mine ? Math.min(1, a * 1.15) : a * (1 - 0.67 * dimShown);
      if (a <= 0.01) return;
      const w = style.width * k * (1 - 0.35 * slimAmt) * (mine ? 1.2 : 1);
      const col = t.quarry ? AMBER : CREAM;
      const r = R + t.trackShown * 7 * k;
      const th = t.angleShown;
      // Dark under-stroke so it reads over bright meadow and in dark forest, then the
      // cream line. A wide arc is stacked from shorter and shorter spans so it fades
      // softly toward its ends (no per-frame gradient objects).
      g.lineCap = 'round';
      if (half < 9 * DEG) {
        strokeArc(cx, cy, r, th - half, th + half, w + 2.5 * k, EDGE, a * 0.5);
        strokeArc(cx, cy, r, th - half, th + half, w, col, a);
      } else {
        for (let i = 0; i < SPANS.length; i++) {
          const h = half * SPANS[i];
          strokeArc(cx, cy, r, th - h, th + h, w * SPAN_W[i] + 2.5 * k, EDGE, a * 0.2);
        }
        for (let i = 0; i < SPANS.length; i++) {
          const h = half * SPANS[i];
          strokeArc(cx, cy, r, th - h, th + h, w * SPAN_W[i], col, a * SPAN_A[i]);
        }
      }
      // a ripple outward each time it calls
      if (t.pulse > 0.02) {
        const p = t.pulse;
        strokeArc(cx, cy, r + (1 - p) * 18 * k, th - half * 1.05, th + half * 1.05, 1.6 * k, col, a * p * 0.8);
      }
      // above / below the line of sight: an upright chevron outside (above) / inside (below)
      const upMag = Math.abs(t.up);
      const elevTol = Math.max(7 * DEG, t.elevSpread * 0.6);
      if (t.hasElev && upMag > elevTol) {
        const ch = smoothstep(elevTol, elevTol + 8 * DEG, upMag) * a;
        const above = t.up > 0;
        const cr = r + (above ? 12 : -12) * k;
        chevron(cx + Math.sin(th) * cr, cy - Math.cos(th) * cr, above, 4.5 * k, ch);
      }
      // pinned with Q: a small bead on the arc
      if (mine && pinShown > 0.02) {
        const x = cx + Math.sin(th) * r, y = cy - Math.cos(th) * r;
        g.globalAlpha = Math.min(1, a * 1.2) * pinShown;
        g.fillStyle = col;
        g.strokeStyle = EDGE;
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x, y, (2.2 + 1.6 * pinShown) * k, 0, TAU);
        g.fill();
        g.stroke();
      }
      // a tiny plumage dot for a voice the player already knows (never for unknown ones)
      if (t.color) {
        const dr = r + (t.hasElev && t.up < -elevTol ? 12 : -11) * k;
        const x = cx + Math.sin(th) * dr, y = cy - Math.cos(th) * dr;
        g.globalAlpha = a;
        g.fillStyle = t.color;
        g.strokeStyle = CREAM;
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(x, y, 3 * k, 0, TAU);
        g.fill();
        g.stroke();
      }
    }

    // Life left of an arc; the followed voice never fades right out between its calls.
    function life(t, at) {
      const lf = lifeFade(t.expires - at, t.ttl);
      if (t.id !== follower.id) return lf;
      return Math.max(lf, follower.pinned ? 0.85 : 0.4);
    }

    /* ------------------------------------------------------------ frame */
    sr.frame = (dt) => {
      const at = now();
      const mode = state.mode;
      const tools = ctx.tools;
      const optic = !!(tools?.raised && (tools.active === 'binoculars' || tools.active === 'camera'));
      const want = settingOn() && mode === 'play';
      ringFade = ease(ringFade, want ? 1 : 0, dt, want ? 0.18 : 0.08);
      slimAmt = ease(slimAmt, optic ? 1 : 0, dt, 0.12);
      focusAmt = ease(focusAmt, focus ? 1 : 0, dt, 0.2);
      if (sizeKey() !== view.size) layout();

      const yaw = ctx.player?.yaw || 0;
      const pitch = ctx.player?.pitch || 0;
      const cam = ctx.camera;
      const halfV = ((cam?.fov || 70) * DEG) / 2;
      const halfH = Math.atan(Math.tan(halfV) * (cam?.aspect || 16 / 9));

      // update tracks
      let any = false;
      for (let i = 0; i < MAX_TRACKS; i++) {
        const t = tracks[i];
        if (!t.live) { t.score = -1; t.rank = -1; continue; }
        const left = t.expires - at;
        // The followed voice is kept between its calls: a pinned one stays bright for as
        // long as the pin holds, an unpinned one dims until the follower moves on.
        const mine = t.id === follower.id;
        if (left <= 0 && t.alpha < 0.01 && !mine) { drop(t); continue; }
        t.bearingShown = easeAngle(t.bearingShown, t.bearing, dt, 0.35);
        t.spreadShown = ease(t.spreadShown, t.spread, dt, 0.3);
        if (t.hasElev) t.elevShown = ease(t.elevShown, t.elev, dt, 0.35);
        t.pulse = t.pulse > 0.001 ? t.pulse * Math.exp(-dt / 0.45) : 0;
        const hold = left > 0 || (mine && follower.pinned) ? 1 : mine ? 0.45 : 0;
        t.alpha = ease(t.alpha, hold, dt, hold >= 1 ? 0.2 : 0.15);
        t.rank = t.score + (mine ? 4 : 0);
        const rel = relAngle(t.bearingShown, yaw);
        const p = viewPlacement(rel, t.hasElev ? t.elevShown : null, pitch, halfH, halfV, t.place);
        t.front = p.front;
        t.up = p.up;
        const precision = 1 - 0.6 * smoothstep(10 * DEG, 45 * DEG, t.spreadShown);
        t.onRaw = onTarget(p.offset, t.spreadShown, t.hasElev ? t.elevSpread : 0);
        t.onT = t.onRaw * precision; // a vague voice glows less
        // Inside the uncertainty the leftover direction is noise: the tick settles at the
        // top ("ahead") while the whole ring glows. Ease only a little: it turns with the
        // view at once. (Settles on onRaw, not the glow's onT: for a vague voice onT stays
        // well below 1, and straight ahead the screen angle is ±90 degrees noise, so the
        // tick would sit halfway to the side and flip sides as the view crossed it.)
        const target = t.onRaw > 0 ? lerpAngle(p.angle, 0, Math.min(1, t.onRaw * 1.2) * p.front) : p.angle;
        t.angleShown = easeAngle(t.angleShown, target, dt, 0.05);
        // inner / outer track by elevation, only while the voice is out of view
        const trackT = t.hasElev ? Math.max(-1, Math.min(1, p.up / (25 * DEG))) * (1 - p.front) : 0;
        t.trackShown = ease(t.trackShown, trackT, dt, 0.25);
        any = true;
      }

      const n = any ? pickTop(tracks, MAX_TRACKS, MAX_ARCS, top, 'rank') : 0;

      // the voice the player is facing (for the card highlight and the layer caption)
      // (the nearest match to the line of sight wins; the glow is weaker for a vague voice)
      let face = null, faceAmt = 0;
      for (let i = 0; i < n; i++) {
        const t = tracks[top[i]];
        const f = t.onRaw * t.front * t.alpha * (0.75 + 0.25 * t.strength) - 0.001 * (t.place.offset / DEG);
        if (f > faceAmt) { faceAmt = f; face = t; }
      }
      api.facingId = face && faceAmt > 0.45 ? face.id : 0;
      api.facingLayer = api.facingId ? face.layer : '';

      // which voice is followed (works with the ring hidden too: the HUD card needs it)
      // (facing only counts when the player turned to the voice: 6 degrees in the last 2.5 s)
      if (Math.abs(relAngle(yaw, turn.yaw)) > 6 * DEG || Math.abs(pitch - turn.pitch) > 6 * DEG) { turn.yaw = yaw; turn.pitch = pitch; turn.at = at; }
      follower.update(at, tracks, MAX_TRACKS, api.facingId, at - turn.at < 2.5);
      publishFollow();
      const followed = follower.id ? byId.get(follower.id) : null;
      api.silentFor = followed ? Math.max(0, at - followed.heardAt) : 0;
      api.followLive = !!followed && at < followed.expires;
      dimShown = ease(dimShown, follower.pinned ? 1 : 0, dt, 0.3);
      pinShown = ease(pinShown, follower.pinned ? 1 : 0, dt, 0.15);

      const visible = ringFade > 0.01 && (any || at < note.until);
      if (!visible) {
        if (view.shown) { canvas.style.display = 'none'; view.shown = false; }
        if (!view.cleared) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); view.cleared = true; }
        return;
      }
      if (!view.shown) { canvas.style.display = ''; view.shown = true; }

      const glowTarget = face ? face.onT * face.front * face.alpha * (0.6 + 0.4 * life(face, at)) * (0.6 + 0.4 * face.pulse) : 0;
      glowShown = ease(glowShown, glowTarget, dt, 0.18);

      const k = 1 + 0.18 * focusAmt;
      const baseR = ringRadius(view.h, view.size, false, false);
      const targetR = baseR * (1 + 0.18 * focusAmt) * (1 + 0.35 * slimAmt) * (1 - 0.12 * glowShown);
      radiusShown = radiusShown > 0 ? ease(radiusShown, targetR, dt, 0.15) : targetR;
      const R = radiusShown;

      const dpr = view.dpr, side = view.side, cx = side / 2, cy = side / 2;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, side, side);
      view.cleared = false;
      g.lineCap = 'round';
      g.lineJoin = 'round';

      // the faint guide ring
      const guide = ringFade * (0.55 + 0.45 * focusAmt) * (1 - 0.4 * slimAmt);
      strokeArc(cx, cy, R, 0, TAU, 3.2, EDGE, 0.16 * guide);
      strokeArc(cx, cy, R, 0, TAU, 1, CREAM, 0.26 * guide);

      // "you are looking the right way": the ring tightens and glows
      if (glowShown > 0.01) {
        const col = face?.quarry ? AMBER : CREAM;
        const gl = glowShown * ringFade;
        strokeArc(cx, cy, R, 0, TAU, 4.5 * k, EDGE, 0.3 * gl);
        strokeArc(cx, cy, R, 0, TAU, 12 * k, col, 0.1 * gl);
        strokeArc(cx, cy, R, 0, TAU, 5 * k, col, 0.2 * gl);
        strokeArc(cx, cy, R, 0, TAU, 2.2 * k, col, 0.9 * gl);
      }

      // weakest first so the strongest sits on top
      for (let i = n - 1; i >= 0; i--) {
        const t = tracks[top[i]];
        drawArc(t, cx, cy, R, k, life(t, at));
      }

      // the answer to Q for a moment (above the ring), else where to look, in words,
      // under the ring while facing the voice (not over the observation readout)
      const noteLeft = note.until - at;
      const words = noteLeft > 0 ? note.text : api.facingLayer && glowShown > 0.05 && at - sightAt > 1.5 ? api.facingLayer : '';
      if (words) {
        g.font = FONT;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const y = noteLeft > 0 ? cy - R - 24 : cy + R + 26;
        const a = (noteLeft > 0 ? clamp01(noteLeft / 0.4) : clamp01(glowShown * 1.4)) * ringFade * (1 - 0.3 * slimAmt);
        g.globalAlpha = a * 0.55;
        g.strokeStyle = EDGE;
        g.lineWidth = 3.5;
        g.strokeText(words, cx, y);
        g.globalAlpha = a;
        g.fillStyle = CREAM;
        g.fillText(words, cx, y);
      }
      g.globalAlpha = 1;
    };
  },

  update(dt) {
    if (sr.frame) sr.frame(Math.min(0.1, dt || 0));
  },
};

export default sr;
