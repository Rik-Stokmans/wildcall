// Bounded cache of map tile images. Only tiles the caller asks for are fetched; at most
// `maxLoading` requests are in flight; the least recently used images are evicted; failed
// tiles are retried after a pause rather than hammered.

export function createTileCache({ max = 128, maxLoading = 6, retryMs = 15000, makeImage = () => new Image(), now = () => Date.now(), onChange = () => {} } = {}) {
  const map = new Map(); // key -> {state: 'idle'|'loading'|'ok'|'error', img, url, at}
  let loading = 0;

  function start(e) {
    if (loading >= maxLoading) return;
    e.state = 'loading';
    loading++;
    const img = makeImage();
    e.img = img;
    const done = (ok) => {
      if (e.img !== img) return; // evicted or restarted meanwhile
      img.onload = img.onerror = null;
      loading--;
      e.state = ok ? 'ok' : 'error';
      e.at = now();
      onChange();
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.decoding = 'async';
    img.src = e.url;
  }

  function evict() {
    while (map.size > max) {
      const [key, e] = map.entries().next().value;
      map.delete(key);
      if (e.state === 'loading') { loading--; e.img.onload = e.img.onerror = null; e.img = null; }
    }
  }

  return {
    /** The loaded image for a tile, or null while it is loading / unavailable. Starts a fetch if needed. */
    get(key, url) {
      let e = map.get(key);
      if (e) { map.delete(key); map.set(key, e); } // mark as recently used
      else { e = { state: 'idle', img: null, url, at: 0 }; map.set(key, e); evict(); }
      if (e.state === 'error' && now() - e.at >= retryMs) e.state = 'idle';
      if (e.state === 'idle') start(e);
      return e.state === 'ok' ? e.img : null;
    },
    get size() { return map.size; },
    get loading() { return loading; },
    has(key) { return map.has(key); },
    clear() { for (const e of map.values()) if (e.state === 'loading') { e.img.onload = e.img.onerror = null; } map.clear(); loading = 0; },
  };
}
