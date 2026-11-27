// Following one voice (pure; no DOM). The left side of the HUD shows ONE clue card: the
// voice the player is following. Which voice that is:
//   1. a voice pinned with Q (kept until Q again, or silent / lost for `lost` seconds);
//   2. the quest's target when it is audible;
//   3. the voice the player has TURNED to and faced (inside its uncertainty) for
//      `faceDwell` s; a voice that merely pipes up in front of a player who is standing
//      still does not count;
//   4. otherwise keep the current one while it is alive, and only move to a clearly
//      louder voice (`louder` x its score). "Alive" spans the pauses in a song: birds
//      sing a bout every 15-25 s, so a voice is kept until it has not been heard for
//      `keep` seconds (and at least `grace` s after its clue ran out);
//   5. if the current one is gone, the loudest / nearest.
// Changes on the player's own turn of the head happen at most once every `faceDwell` s;
// automatic ones (quest target, louder, gone) at most once every `dwell` s, so the card
// never flickers between two birds. Pinning / letting go is the player's act: immediate.
//
// Candidates: an array (or array-like) of {id, score, quarry, heardAt, expires, live};
// only the first `count` entries are read, entries with live === false are skipped.
// `expires` is when the voice stops sounding to the player (the caller may extend it
// each time the followed voice calls again).

export const FOLLOW = { dwell: 4, faceDwell: 1, faceGap: 2, grace: 3, keep: 26, lost: 45, louder: 1.6, margin: 0.15 };

export class Follower {
  constructor(opts = {}) {
    this.o = { ...FOLLOW, ...opts };
    this.id = 0;
    this.pinned = false;
    this.changedAt = -1e9;
    this.faceId = 0;
    this.faceSince = 0;
    this.faceMeant = false;
  }

  static find(cands, count, id) {
    if (!id) return null;
    for (let i = 0; i < count; i++) {
      const c = cands[i];
      if (c && c.live !== false && c.id === id) return c;
    }
    return null;
  }

  set(id, now) {
    if (id === this.id) return;
    this.id = id;
    this.changedAt = now;
  }

  /**
   * Advance; returns the followed id (0 = none).
   * @param facingId the voice the line of sight is on (0 = none)
   * @param turning  the player turned the view in the last moments: facing only counts
   *                 when the player turned to the voice (or turns while facing it)
   */
  update(now, cands, count, facingId = 0, turning = true) {
    const o = this.o;
    if (facingId !== this.faceId) { this.faceId = facingId; this.faceSince = now; this.faceMeant = !!turning; }
    else if (turning) this.faceMeant = true;
    const cur = Follower.find(cands, count, this.id);

    if (this.pinned) {
      if (cur && now - (cur.heardAt ?? -1e9) <= o.lost) return this.id;
      this.pinned = false; // lost: fall back to automatic following
      this.changedAt = -1e9;
    }

    const alive = (c) => c && (now < c.expires + o.grace || now - (c.heardAt ?? -1e9) < o.keep);
    const curAlive = alive(cur);
    let quarry = null, loud = null;
    for (let i = 0; i < count; i++) {
      const c = cands[i];
      if (!c || c.live === false || now >= c.expires) continue;
      if (c.quarry && (!quarry || c.score > quarry.score)) quarry = c;
      if (!loud || c.score > loud.score) loud = c;
    }
    const faced = facingId && this.faceMeant && now - this.faceSince >= o.faceDwell ? Follower.find(cands, count, facingId) : null;

    let want = curAlive ? this.id : 0, wait = o.dwell;
    if (quarry) {
      if (!(curAlive && cur.quarry)) want = quarry.id;
    } else if (faced && now < faced.expires + o.grace) {
      want = faced.id;
      wait = o.faceGap; // the player's own choice: quicker than an automatic change
    } else if (!curAlive) {
      want = loud ? loud.id : 0;
    } else if (loud && loud.id !== this.id && loud.score > cur.score * o.louder + o.margin) {
      want = loud.id;
    }
    if (want !== this.id && now - this.changedAt >= wait) this.set(want, now);
    return this.id;
  }

  /**
   * Q: pin the voice being faced (or the followed one), or let go of a pinned voice.
   * Returns true when a voice is pinned afterwards.
   */
  togglePin(now, cands, count, facingId = 0) {
    const faced = Follower.find(cands, count, facingId);
    // Pinned and facing ANOTHER voice: the pin moves to that one. Otherwise Q lets go.
    if (this.pinned && !(faced && faced.id !== this.id)) { this.pinned = false; this.changedAt = now; return false; }
    const target = faced || Follower.find(cands, count, this.id);
    if (!target) return false;
    this.id = target.id;
    this.pinned = true;
    this.changedAt = now;
    return true;
  }
}

/**
 * At most one "first time" flourish (a new-voice mention, a first-time hint) per `gap`
 * seconds: allow() is true when one may be shown now, and starts the wait.
 */
export class Pace {
  constructor(gap = 20) { this.gap = gap; this.last = -1e9; }
  ready(now) { return now - this.last >= this.gap; }
  allow(now) {
    if (!this.ready(now)) return false;
    this.last = now;
    return true;
  }
}

/**
 * A count that rises at once but only falls after it has been lower for `hold` seconds:
 * "3 other voices" does not tick up and down as voices start and stop.
 */
export class CalmCount {
  constructor(hold = 6) { this.hold = hold; this.value = 0; this.lowSince = null; }
  update(n, now) {
    n = Math.max(0, n | 0);
    if (n >= this.value) { this.value = n; this.lowSince = null; return this.value; }
    if (this.lowSince == null) this.lowSince = now;
    if (now - this.lowSince >= this.hold) { this.value = n; this.lowSince = null; }
    return this.value;
  }
}

/** The quiet line under the card: "3 other voices", with a new voice mentioned once. */
export function otherVoicesText(others, newVoice = false) {
  const n = Math.max(0, others | 0);
  const rest = n ? `${n} other voice${n === 1 ? '' : 's'}` : '';
  if (newVoice) return rest ? `A new voice · ${rest}` : 'A new voice';
  return rest;
}

/** "silent for 12 s" (rounded to 5 s from 20 s on), or '' while it is calling. */
export function silentText(seconds) {
  const s = Number(seconds) || 0;
  if (s < 8) return '';
  const r = s < 20 ? Math.round(s) : Math.round(s / 5) * 5;
  return `silent for ${r} s`;
}
