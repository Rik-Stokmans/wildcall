// Wing-flap whirr for a movement cue (proto.MoveCue: {bearing, elev, inView, strength}).
// The server only sends a cue when the player's perception allows it, so the sound adds
// no information the HUD ripple does not: it just makes a close take-off audible. Pure.
import { clamp01 } from './curves.js';

/**
 * Where to place the flutter relative to the listener (world XZ follows the pinned
 * compass convention: heading h → (sin h, 0, −cos h)).
 * @returns {{dx:number, dy:number, dz:number, dist:number}}
 */
export function cueOffset(cue) {
  const s = clamp01(+cue?.strength || 0);
  const b = +cue?.bearing || 0;
  const e = Math.max(-1.4, Math.min(1.4, +cue?.elev || 0));
  const dist = 4 + (1 - s) * 22;
  const ce = Math.cos(e);
  return { dx: Math.sin(b) * ce * dist, dy: Math.sin(e) * dist, dz: -Math.cos(b) * ce * dist, dist };
}

/**
 * Flutter recipe: a burst of wingbeats that slows and fades as the bird gets going.
 * @returns {{beats:{t:number, gain:number, freq:number}[], gain:number}}
 */
export function flutterParams(cue, rng = Math.random) {
  const s = clamp01(+cue?.strength || 0);
  const hz = 11 + rng() * 7;            // small-bird wingbeat rate
  const n = 5 + Math.floor(rng() * 6);  // 5–10 beats
  const beats = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const prog = i / (n - 1);
    beats.push({ t, gain: (1 - 0.6 * prog) * (0.85 + 0.3 * rng()), freq: 1100 + 900 * rng() });
    t += (1 / hz) * (1 + 0.35 * prog);
  }
  return { beats, gain: 0.15 + 0.55 * s };
}
