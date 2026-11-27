// Visibility state machine for the equipment key legend (spec §29.1: the HUD stays
// subtle). Pure: time is passed in, nothing touches the DOM.
//
//   change(now)  the tool or its state changed (selected, raised, lowered, recording)
//   used(now)    the player pressed a mouse button / turned the wheel with a tool
//   view({now, mode, hints, tool, raised, focus}) → {show, strength}
//     show      'hidden' | 'panel' | 'line'   ('line' = the minimal row while an optic is raised)
//     strength  'full' | 'rest'
//
// Rules:
//  - hidden outside play (title screen, any screen open, boot);
//  - after a change: full for FULL_FOR seconds, then the faint resting state;
//  - a tool in hand, lowered, unused for UNSURE_AFTER seconds: full once more;
//  - focused listening dims it to rest (the HUD dims too);
//  - settings.hints off: only the resting state, for OFF_FOR seconds after a change.
export const FULL_FOR = 6;
export const UNSURE_AFTER = 10;  // after the first full showing has faded
export const OFF_FOR = 2;

export class LegendVisibility {
  constructor({ fullFor = FULL_FOR, unsureAfter = UNSURE_AFTER, offFor = OFF_FOR } = {}) {
    this.fullFor = fullFor;
    this.unsureAfter = unsureAfter;
    this.offFor = offFor;
    this.changedAt = -Infinity;
    this.fullUntil = -Infinity;
    this.lastUse = -Infinity;
    this.unsureShown = true;   // nothing to be unsure about before the first change
  }

  change(now) {
    this.changedAt = now;
    this.fullUntil = now + this.fullFor;
    this.lastUse = now;
    this.unsureShown = false;
  }

  used(now) {
    this.lastUse = now;
    this.unsureShown = true;   // they know what to do with it
  }

  view({ now, mode = 'play', hints = true, tool = 'none', raised = false, focus = false }) {
    if (mode !== 'play') return { show: 'hidden', strength: 'rest' };
    const show = raised && (tool === 'binoculars' || tool === 'camera') ? 'line' : 'panel';
    if (!hints) {
      return now - this.changedAt < this.offFor ? { show, strength: 'rest' } : { show: 'hidden', strength: 'rest' };
    }
    if (tool !== 'none' && !raised && !this.unsureShown && now - this.lastUse >= this.unsureAfter) {
      this.unsureShown = true;
      this.fullUntil = now + this.fullFor;
    }
    const strength = !focus && now < this.fullUntil ? 'full' : 'rest';
    return { show, strength };
  }

  /** Seconds until the view may change by time alone (Infinity if never). */
  nextEdge(now) {
    let t = Infinity;
    if (this.fullUntil > now) t = Math.min(t, this.fullUntil - now);
    if (this.changedAt + this.offFor > now) t = Math.min(t, this.changedAt + this.offFor - now);
    if (!this.unsureShown) t = Math.min(t, Math.max(0, this.lastUse + this.unsureAfter - now));
    return t;
  }
}
