// Spare bird views. A view released by a bird that went out of full detail is kept for
// the next bird of the same species, but only SPARE_CAP spares are kept in all (the
// oldest is disposed first): each view owns GPU objects (its skeleton's bone texture,
// its outline material), and a journey through many regions and species would
// otherwise leave a spare set for every species it ever met.

/** Spare views kept in all, over every species. */
export const SPARE_CAP = 32;

export class SparePool {
  /**
   * @param {(view: object) => void} dispose  frees one view's own GPU objects
   * @param {number} [cap]
   */
  constructor(dispose, cap = SPARE_CAP) {
    this.dispose = dispose;
    this.cap = cap;
    this.byKey = new Map(); // template → views, oldest first
    this.order = [];        // [template, view] pairs, oldest first
  }

  get size() { return this.order.length; }

  /** Keeps a released view of template `key`; disposes the oldest spare beyond the cap. */
  put(key, view) {
    let list = this.byKey.get(key);
    if (!list) this.byKey.set(key, (list = []));
    list.push(view);
    this.order.push([key, view]);
    while (this.order.length > this.cap) {
      const [k, v] = this.order.shift();
      const l = this.byKey.get(k);
      l.splice(l.indexOf(v), 1);
      if (!l.length) this.byKey.delete(k);
      this.dispose(v);
    }
  }

  /** A spare view of template `key` (the most recent), or null. */
  take(key) {
    const list = this.byKey.get(key);
    if (!list) return null;
    const v = list.pop();
    if (!list.length) this.byKey.delete(key);
    for (let i = this.order.length - 1; i >= 0; i--) if (this.order[i][1] === v) { this.order.splice(i, 1); break; }
    return v;
  }

  /** Disposes every spare. */
  clear() {
    for (const [, v] of this.order) this.dispose(v);
    this.order.length = 0;
    this.byKey.clear();
  }
}

/** Frees a view's own GPU objects (geometry and the base material are shared by the template). */
export function disposeView(view) {
  view.object?.skeleton?.dispose?.();
  const o = view.outline;
  if (o) { o.removeFromParent?.(); o.material?.dispose?.(); view.outline = null; }
}
