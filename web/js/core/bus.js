// Tiny synchronous pub/sub. Event names are pinned in docs/contract.md §Bus events.
export function createBus() {
  const map = new Map();
  return {
    /** Subscribe; returns an unsubscribe function. */
    on(evt, fn) {
      let set = map.get(evt);
      if (!set) map.set(evt, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    once(evt, fn) {
      const off = this.on(evt, (d) => { off(); fn(d); });
      return off;
    },
    emit(evt, data) {
      const set = map.get(evt);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(data); } catch (err) { console.error(`[bus] handler for "${evt}" threw`, err); }
      }
    },
  };
}
