// Pure toast stack model: lifetimes, XP coalescing and the sound each kind plays.
import { resolveIcon } from '../kit/icons.js';

const LIFE = { level: 6.5, warn: 6, discovery: 5.5, quest: 5.5, xp: 3.2 };
export const DEFAULT_LIFE = 4.5;
export const MAX_TOASTS = 5;
/** XP toasts arriving within this many seconds of the last one are merged into it. */
export const XP_WINDOW = 2.4;

export function toastLife(kind) { return LIFE[kind] || DEFAULT_LIFE; }

const ICONS = {
  xp: 'xp', discovery: 'bird', level: 'level', quest: 'quest', item: 'backpack', info: 'info',
  warn: 'warning', location: 'pin', journal: 'journal', rep: 'reputation', credits: 'credits', behavior: 'eye',
  buff: 'heart', lens: 'lens', nest: 'nest', forage: 'leaf', rare: 'star',
};
/** Neutral icon for kinds this client does not know yet (never the kit's bare dot). */
export const FALLBACK_TOAST_ICON = 'leaf';
/**
 * Icon for a toast: the server's icon when the kit can draw it, else the kind's icon,
 * else a neutral leaf. Item icons the kit lacks (and new toast kinds) degrade softly.
 */
export function toastIcon(t) {
  if (t?.icon && resolveIcon(t.icon)) return t.icon;
  const k = ICONS[t?.kind];
  return k && resolveIcon(k) ? k : FALLBACK_TOAST_ICON;
}

const SOUNDS = { level: 'level', discovery: 'discover', quest: 'page', item: 'reward', credits: 'coin', warn: 'error', location: 'discover', journal: 'page' };
/** ui sound for a toast kind, or '' for silence (plain XP gains stay quiet). */
export function toastSound(kind) { return SOUNDS[kind] || ''; }

export class ToastStack {
  constructor(max = MAX_TOASTS) { this.max = max; this.items = []; this.nextId = 1; }

  /**
   * Add a toast. Returns {item, merged, evicted[]}. XP toasts coalesce into the newest
   * live XP toast: their amounts add up and the life timer restarts.
   */
  push(t, now) {
    const kind = t.kind || 'info';
    if (kind === 'xp') {
      const prev = [...this.items].reverse().find((i) => i.kind === 'xp' && now - i.touched <= XP_WINDOW && i.expires > now);
      if (prev) {
        prev.xp += t.xp || 0;
        prev.title = `+${prev.xp} XP`;
        if (t.text) prev.text = t.text;
        prev.touched = now;
        prev.expires = now + toastLife('xp');
        return { item: prev, merged: true, evicted: [] };
      }
    }
    const item = {
      id: this.nextId++, kind, icon: toastIcon(t), xp: t.xp || 0,
      title: kind === 'xp' && !t.title ? `+${t.xp || 0} XP` : (t.title || ''),
      text: t.text || '', touched: now, expires: now + toastLife(kind),
    };
    this.items.push(item);
    const evicted = [];
    while (this.items.length > this.max) evicted.push(this.items.shift());
    return { item, merged: false, evicted };
  }

  /** Remove and return toasts whose time is up. */
  expire(now) {
    const gone = this.items.filter((i) => i.expires <= now);
    if (gone.length) this.items = this.items.filter((i) => i.expires > now);
    return gone;
  }
}
