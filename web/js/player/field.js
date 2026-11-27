// Pure field logic for the player module: wire messages (proto.Pose, proto.Photo),
// interaction targeting, the region gate, the live-sighting tracker, film accounting
// and the main-menu camera drift. No three.js, no DOM.
import { wrapYaw, lookDir, angleDelta, headingTo } from './look.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

export const POSE_HZ_PLAY = 10;
export const POSE_HZ_IDLE = 2;
export const TOOLS = Object.freeze(['none', 'binoculars', 'camera', 'recorder']);

/** Equipment slot each instrument needs ('' for none). */
export const TOOL_SLOTS = Object.freeze({ binoculars: 'optics', camera: 'camera', recorder: 'audio' });
export function toolSlot(name) { return TOOL_SLOTS[name] || ''; }

/** The kind word shown when an instrument's slot is empty. */
export function missingToolText(name) {
  if (name === 'binoculars') return 'No binoculars equipped. Choose a pair in Equipment (Tab).';
  if (name === 'camera') return 'No camera equipped. Choose one in Equipment (Tab).';
  if (name === 'recorder') return 'No recorder equipped. Choose one in Equipment (Tab).';
  return '';
}
export const MOVES = Object.freeze(['still', 'crouch', 'walk', 'run', 'sprint']);

/** Seconds between pose messages for a game mode (contract §4). */
export function poseInterval(mode) {
  return 1 / (mode === 'play' ? POSE_HZ_PLAY : POSE_HZ_IDLE);
}

/**
 * Build a proto.Pose payload. Field names are the JSON tags of internal/proto.Pose.
 * @param {object} p {eye:{x,y,z}, yaw, pitch, speed, move, crouch, sit, focus,
 *                    tool, raised, fov, zoom, sharp, noise}
 */
export function buildPose(p) {
  return {
    x: r3(p.eye.x),
    y: r3(p.eye.y),
    z: r3(p.eye.z),
    yaw: r3(wrapYaw(p.yaw || 0)),
    pitch: r3(p.pitch),
    speed: r3(Math.max(0, p.speed || 0)),
    move: MOVES.includes(p.move) ? p.move : 'still',
    crouch: !!p.crouch,
    sit: !!p.sit,
    focus: !!p.focus,
    tool: TOOLS.includes(p.tool) ? p.tool : 'none',
    raised: !!p.raised,
    fov: r3(p.fov),
    zoom: r3(Math.max(1, p.zoom || 1)),
    sharp: r3(clamp(p.sharp ?? 1, 0, 1)),
    noise: r3(clamp(p.noise || 0, 0, 1)),
  };
}

/**
 * Build a proto.Photo payload (shutter press).
 * @param {object} p {eye, yaw, pitch, fov, aspect, sharp, shake, img}
 */
export function buildPhoto(p) {
  return {
    x: r3(p.eye.x),
    y: r3(p.eye.y),
    z: r3(p.eye.z),
    yaw: r3(wrapYaw(p.yaw || 0)),
    pitch: r3(p.pitch),
    fov: r3(p.fov),
    aspect: r3(p.aspect > 0 ? p.aspect : 16 / 9),
    sharp: r3(clamp(p.sharp ?? 1, 0, 1)),
    shake: r3(clamp(p.shake || 0, 0, 1)),
    img: String(p.img || ''),
  };
}

/**
 * Choose the interactable the player is facing. Items must be within their radius
 * (+ a small margin) and roughly in front; nearer and more central wins.
 * @param {Array<{id,pos:{x,y,z},radius,label,verb}>} list
 * @param {{x,y,z}} eye
 * @param {number} yaw
 * @param {number} pitch
 * @returns the chosen item or null
 */
export function pickInteractable(list, eye, yaw, pitch) {
  if (!list) return null;
  const fwd = lookDir(yaw, pitch);
  let best = null, bestScore = Infinity;
  for (const it of list) {
    if (!it || !it.pos) continue;
    const dx = it.pos.x - eye.x, dy = (it.pos.y ?? eye.y) - eye.y, dz = it.pos.z - eye.z;
    const horiz = Math.hypot(dx, dz);
    const reach = Math.max(1.5, (it.radius || 3)) + 0.75;
    if (horiz > reach || Math.abs(dy) > 4.5) continue;
    const len = Math.hypot(dx, dy, dz);
    let ang = 0;
    if (len > 0.6) {
      const c = (fwd.x * dx + fwd.y * dy + fwd.z * dz) / len;
      ang = Math.acos(clamp(c, -1, 1));
      // Generous cone so prompts are easy to get, tighter for far items.
      const cone = horiz < 1.6 ? 1.35 : 0.85;
      if (ang > cone) continue;
    }
    const score = horiz / reach + ang * 0.9;
    if (score < bestScore) { bestScore = score; best = it; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Region gate

/** Metres the player may walk into a locked region type before being turned back. */
export const GATE_SLACK = 4;
export const REGION_WATER = 255;

/** Is the region id walkable for this profile? Missing data never traps the player. */
export function regionAllowed(region, unlocked) {
  if (region == null || region === REGION_WATER || region < 0) return true;
  if (!Array.isArray(unlocked) || unlocked.length === 0) return true;
  return unlocked.includes(region);
}

/**
 * Region gate step. `gate` = {safe:{x,z}|null} (mutated). Given the feet position after
 * this frame's move and the region there, returns the corrected {x, z} — the player is
 * held within GATE_SLACK metres of the last allowed spot, eased back softly.
 */
export function gateStep(gate, pos, region, unlocked, dt) {
  if (regionAllowed(region, unlocked)) {
    gate.safe = { x: pos.x, z: pos.z };
    gate.inside = false;
    return { x: pos.x, z: pos.z, blocked: false };
  }
  if (!gate.safe) return { x: pos.x, z: pos.z, blocked: false }; // spawned inside: let the server decide
  gate.inside = true;
  const dx = pos.x - gate.safe.x, dz = pos.z - gate.safe.z;
  const d = Math.hypot(dx, dz);
  if (d <= GATE_SLACK) return { x: pos.x, z: pos.z, blocked: false };
  // Beyond the slack ring: hold the player on the ring and ease them gently back
  // inward (≈0.8 m/s) so the border feels like a soft turn-back, not a wall.
  const ring = Math.max(0, GATE_SLACK - Math.max(0, dt) * 0.8);
  const k = Math.min(d, ring) / d;
  return { x: gate.safe.x + dx * k, z: gate.safe.z + dz * k, blocked: true };
}

// ---------------------------------------------------------------------------
// Live sighting tracking (for the T / identify action)

/** Seconds a sighting stays "live" after the last net:sighting naming a bird. */
export const SIGHTING_TTL = 1.6;

export function createSightingTracker() {
  return { mystery: '', bird: 0, at: -Infinity };
}

/** Feed a proto.Sighting received at time `now`. */
export function trackSighting(tr, s, now) {
  if (s && s.bird && s.mystery) {
    tr.mystery = s.mystery; tr.bird = s.bird; tr.at = now;
  } else if (s && s.bird && !s.mystery) {
    // A recognised (known) bird is in view: nothing to identify.
    tr.mystery = ''; tr.bird = s.bird; tr.at = now;
  } else {
    tr.mystery = ''; tr.bird = 0; tr.at = -Infinity;
  }
}

/** The mystery id under observation right now, or ''. */
export function liveMystery(tr, now) {
  return tr.mystery && now - tr.at <= SIGHTING_TTL ? tr.mystery : '';
}

// ---------------------------------------------------------------------------
// Film

/** Shots left given the profile's film and shots sent but not yet acknowledged. */
export function filmLeft(film, pending = 0) {
  const cap = film?.cap ?? 0, used = film?.used ?? 0;
  return Math.max(0, cap - used - pending);
}

/** What to do about an empty camera: load a spare roll, or go home to develop this one. */
export function outOfFilmText(profile) {
  return carries(profile, 'film_roll')
    ? 'Out of film. Load a spare roll from your pack (I).'
    : 'Out of film. The cabin develops the roll and loads a fresh one.';
}

export function outOfFilm(film, pending = 0) {
  if (!film || !(film.cap > 0)) return false; // unknown film state: let the server decide
  return filmLeft(film, pending) <= 0;
}

/** Does the inventory hold at least one of an item? */
export function carries(profile, item) {
  return !!profile?.inventory?.some((s) => s && s.item === item && (s.qty ?? 1) > 0);
}

// ---------------------------------------------------------------------------
// Main-menu cinematic drift

/**
 * A slow, looping camera path around a centre point (the cabin): a lazy ellipse with
 * gentle height and look changes. t in seconds. Returns {x, z, lift, yaw, pitch}
 * where lift is metres above the ground.
 */
export function cinematicPose(t, center, opts = {}) {
  const radius = opts.radius ?? 26;
  const period = opts.period ?? 150; // seconds per loop: barely perceptible motion
  const sx = opts.sx ?? 1, sz = opts.sz ?? 0.7;
  // A full loop, or (when trees crowd the loop) a slow swing to and fro along the
  // clear arc [a0, a0 + span].
  const ph = (t / period) * Math.PI * 2;
  const a = opts.span ? opts.a0 + opts.span * (0.5 - 0.5 * Math.cos(ph)) : ph + (opts.a0 || 0);
  const x = center.x + Math.sin(a) * radius * sx;
  const z = center.z + Math.cos(a) * radius * sz;
  const lift = 3.2 + Math.sin(a * 2 + 0.4) * 1.1;
  // Look past the centre, drifting off to the treeline and back.
  const toCenter = headingTo({ x, z }, center);
  const yaw = wrapYaw(toCenter + Math.sin(a * 1.5) * 0.55);
  const pitch = 0.04 + Math.sin(a * 0.9 + 1.1) * 0.05;
  return { x, z, lift, yaw, pitch };
}

/** VegKinds drawn as branching trees (core.VegKind.IsTree) and their nominal crown radius (m). */
export const CINE_TREE_CROWN = Object.freeze({ 0: 5.5, 1: 3.5, 2: 4, 3: 3, 13: 5.5, 14: 3.5, 15: 4, 24: 6 });

/** Obstacles for the title camera from a vegetation list ({kind, x, z, scale}). */
export function cinematicObstacles(veg, out = []) {
  for (const v of veg || []) {
    const r = CINE_TREE_CROWN[v.kind];
    if (r) out.push({ x: v.x, z: v.z, r: r * (v.scale || 1) + 1.2 });
  }
  return out;
}

function clearanceAt(x, z, obstacles) {
  let c = Infinity;
  for (const o of obstacles) {
    const d = Math.hypot(x - o.x, z - o.z) - o.r;
    if (d < c) c = d;
  }
  return c;
}

/**
 * Choose a camera path around the centre that does not fly through tree crowns.
 * Tries loops of several sizes and shapes first; when every loop clips a tree it
 * falls back to the longest clear arc (the camera then swings slowly along it).
 * Returns options for cinematicPose. Deterministic.
 */
export function chooseCinematicPath(center, obstacles, opts = {}) {
  const N = 72, minClear = opts.minClear ?? 1;
  const shapes = [[1, 0.7], [0.7, 1], [1, 1]];
  const radii = [26, 22, 30, 18, 34, 38, 16, 42];
  const sample = (R, sx, sz) => {
    const c = new Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      c[i] = clearanceAt(center.x + Math.sin(a) * R * sx, center.z + Math.cos(a) * R * sz, obstacles);
    }
    return c;
  };
  let bestArc = null;
  for (const R of radii) {
    for (const [sx, sz] of shapes) {
      const c = sample(R, sx, sz);
      if (Math.min(...c) >= minClear) return { radius: R, sx, sz };
      // Longest run of clear samples (wrapping around).
      let run = 0, best = 0, bestEnd = -1;
      for (let i = 0; i < N * 2; i++) {
        run = c[i % N] >= minClear ? run + 1 : 0;
        if (run > best && run <= N) { best = run; bestEnd = i; }
      }
      if (best >= 2 && (!bestArc || best > bestArc.n)) {
        bestArc = { n: best, radius: R, sx, sz, a0: ((bestEnd - best + 1) / N) * Math.PI * 2, span: ((best - 1) / N) * Math.PI * 2 };
      }
    }
  }
  if (bestArc && bestArc.n >= N / 8) {
    const { radius, sx, sz, a0, span } = bestArc;
    return { radius, sx, sz, a0, span, period: 110 };
  }
  // Nowhere clear: hold a near-still view from the least crowded point of the loop.
  if (bestArc) return { radius: bestArc.radius, sx: bestArc.sx, sz: bestArc.sz, a0: bestArc.a0, span: Math.max(bestArc.span, 0.01), period: 240 };
  return {};
}

/** Yaw that eases toward a target without wrap-around jumps. */
export function easeYaw(current, target, k) {
  return wrapYaw(current + angleDelta(current, target) * k);
}

// ---------------------------------------------------------------------------
// Optical focus target

/** Distance (m) the optics settle on when the view centre shows only sky. */
export const FOCUS_FAR = 400;
/** Birds within this angle of the view centre pull focus onto themselves (~2°). */
export const FOCUS_BIRD_ANGLE = (2 * Math.PI) / 180;

/**
 * The distance optics should focus at: the nearest bird within ~2° of the view centre
 * that is in front of the terrain hit, else the terrain hit, else FOCUS_FAR. Birds are
 * only used for the lens, never shown or marked (design rule: no bird markers).
 * @param {{x,y,z}} eye
 * @param {number} yaw
 * @param {number} pitch
 * @param {number|null} terrainDist  distance to the terrain under the centre, or null (sky)
 * @param {Iterable<{pos:{x,y,z}}>} birds
 * @param {number} maxAngle radians
 */
export function focusTarget(eye, yaw, pitch, terrainDist, birds, maxAngle = FOCUS_BIRD_ANGLE) {
  let best = terrainDist > 0 ? Math.min(terrainDist, FOCUS_FAR) : FOCUS_FAR;
  if (!birds) return best;
  const d = lookDir(yaw, pitch);
  const cosMax = Math.cos(maxAngle);
  for (const b of birds) {
    const p = b && b.pos;
    if (!p) continue;
    const vx = p.x - eye.x, vy = p.y - eye.y, vz = p.z - eye.z;
    const len = Math.hypot(vx, vy, vz);
    if (len < 0.3 || len >= best) continue;
    if ((d.x * vx + d.y * vy + d.z * vz) / len >= cosMax) best = len;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Field notes

export const NOTE_MAX = 400;

/** Clean a typed field note: trimmed, whitespace collapsed, capped. '' = nothing to send. */
export function cleanNote(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
}

/** proto.NoteMsg for a free-form field observation. */
export function buildNote(text) {
  return { species: '', mystery: '', text: cleanNote(text) };
}

// ---------------------------------------------------------------------------
// Recorder panel text

/**
 * The single hint line under the recorder panel.
 * @param {boolean} recording
 * @param {object|null} rec  latest proto.RecState while recording
 * @param {number} recFocus  stats.recFocus (directional microphones must be aimed)
 * @param {string} key       label of the primary button
 */
export function recorderHint(recording, rec, recFocus = 0, key = 'Click') {
  if (!recording) return `${key} to start recording`;
  if (!rec) return 'Listening…';
  if (rec.signal) {
    if (recFocus >= 0.3 && (rec.onAxis ?? 1) < 0.5) return 'Capturing: aim the microphone at the sound';
    return 'Capturing a call';
  }
  if ((rec.noise ?? 0) > 0.6) return 'Noisy here: try moving out of the wind or water';
  return 'Listening… hold still and wait for a call';
}

/** m:ss for the recorder timer. */
export function formatTimer(seconds) {
  const t = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Recording result

/**
 * One line for the viewfinder after a recording: whose voice was captured (species
 * name once identified, else the mystery label) and its stars, or why nothing was.
 * @param r proto.RecResult  @param profile  @param speciesById
 */
export function recResultText(r, profile, speciesById = {}) {
  const rec = r?.rec;
  const note = r?.notes?.[0] || '';
  if (!rec) return note || 'Nothing clear on the recording';
  let who = '';
  if (rec.species) who = speciesById?.[rec.species]?.name || '';
  else if (rec.mystery) who = profile?.journal?.mysteries?.find((m) => m.id === rec.mystery)?.label || '';
  const stars = Math.max(0, Math.min(5, rec.stars | 0));
  const line = `Recorded: ${who || 'an unknown bird'} ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`;
  return note ? `${line} · ${note}` : line;
}
