// Narrator line queue: one line at a time, highest priority first, stale lines expire.
// Pure logic (no DOM, no speech) — unit-tested in queue.test.js.
//
// A line is a proto.Narration: { id, text, kind, priority 0..3, ttl seconds }.
// Times are seconds on the narrator's own clock.

/** In "sparse" mode at most one line starts per this many seconds (priority 3 exempt). */
export const SPARSE_GAP = 90;

/** Whether the frequency setting lets this line in at all. */
export function admit(line, frequency) {
  if (!line || !line.text) return false;
  switch (frequency) {
    case 'off': return false;
    case 'sparse': return (line.priority | 0) >= 1;
    default: return true; // normal, chatty: the server already paces
  }
}

/** Whether `incoming` may cut off `current` mid-sentence. */
export function canInterrupt(current, incoming) {
  if (!current || !incoming) return false;
  return (incoming.priority | 0) >= 2 && (current.priority | 0) === 0;
}

/** Whether sparse mode allows starting a line now. */
export function sparseReady(frequency, lastStart, now, priority) {
  if (frequency !== 'sparse') return true;
  if ((priority | 0) >= 3) return true;
  return lastStart == null || now - lastStart >= SPARSE_GAP;
}

export function createQueue({ maxLen = 5 } = {}) {
  let items = [];
  let seq = 0;

  function prune(now) {
    items = items.filter((it) => it.expires > now);
  }

  function bestIndex() {
    let best = -1;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (best < 0) { best = i; continue; }
      const b = items[best];
      if (it.priority > b.priority || (it.priority === b.priority && it.seq < b.seq)) best = i;
    }
    return best;
  }

  return {
    get size() { return items.length; },
    /** Snapshot (for debugging / tests). */
    list() { return items.map((it) => ({ ...it })); },
    /**
     * Add a line. Returns false if the frequency setting rejects it or it is a
     * duplicate of a queued line. When full, the lowest-priority oldest line is
     * dropped (possibly the new one).
     */
    push(line, now, frequency = 'normal') {
      if (!admit(line, frequency)) return false;
      prune(now);
      if (items.some((it) => it.text === line.text || (line.id && it.id === line.id))) return false;
      const ttl = Number.isFinite(line.ttl) && line.ttl > 0 ? line.ttl : 10;
      items.push({
        id: line.id || 0,
        text: String(line.text),
        kind: line.kind || 'ambient',
        priority: Math.max(0, Math.min(3, line.priority | 0)),
        ttl,
        expires: now + ttl,
        seq: seq++,
      });
      while (items.length > maxLen) {
        let worst = 0;
        for (let i = 1; i < items.length; i++) {
          const a = items[i], w = items[worst];
          if (a.priority < w.priority || (a.priority === w.priority && a.seq < w.seq)) worst = i;
        }
        items.splice(worst, 1);
      }
      return items.some((it) => it.seq === seq - 1);
    },
    /** The line that would be spoken next (not removed), or null. */
    peek(now) {
      prune(now);
      const i = bestIndex();
      return i < 0 ? null : items[i];
    },
    /** Remove and return the next line, or null. */
    take(now) {
      prune(now);
      const i = bestIndex();
      if (i < 0) return null;
      return items.splice(i, 1)[0];
    },
    /** Put a line back (e.g. cut off by focus listening) keeping its original expiry. */
    requeue(item, now) {
      if (!item || item.expires <= now) return false;
      if (items.some((it) => it.text === item.text)) return false;
      items.push({ ...item, seq: seq++ });
      return true;
    },
    prune,
    clear() { items = []; },
  };
}
