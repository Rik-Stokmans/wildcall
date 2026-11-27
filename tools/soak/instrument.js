// Soak-test instrumentation, injected into the running game by tools/soak/make-plan.mjs
// (as the first step of the plan). It installs window.SOAK:
//   - counters: rAF deltas, per-module update CPU time, render CPU time, bus listeners,
//     WebSocket messages/bytes per type, profile message size and rate, Web Audio nodes
//     created / still alive (FinalizationRegistry) / sources playing
//   - a walker that holds W (+Shift) through real keyboard events and steers along a
//     route of waypoints (re-pressing after a screen closes; nudging forward when stuck)
//   - SOAK.report(label): logs one 'INFO SOAK …' line of metrics (console.error so the
//     harness prints it) and resets the interval counters.
(() => {
  if (window.SOAK) return;
  const wc = window.wildcall;
  const S = window.S;
  const now = () => performance.now();

  // --- frame timing ------------------------------------------------------------
  const fr = { deltas: [], last: 0 };
  const raf = (t) => { if (fr.last) fr.deltas.push(t - fr.last); fr.last = t; requestAnimationFrame(raf); };
  requestAnimationFrame(raf);

  // --- CPU per module (wrap update/lateUpdate) and render ------------------------
  const cpu = new Map(); // name → ms this interval
  const frameCpu = [];   // total CPU ms per frame (modules + render)
  let frameAcc = 0;
  const add = (k, ms) => { cpu.set(k, (cpu.get(k) || 0) + ms); frameAcc += ms; };
  for (const m of wc.modules || []) {
    for (const ph of ['update', 'lateUpdate']) {
      const f = m[ph];
      if (typeof f !== 'function') continue;
      m[ph] = function (dt, c) { const t0 = now(); try { return f.call(this, dt, c); } finally { add(m.name, now() - t0); } };
    }
  }
  const wrapRender = (obj, key, label) => {
    const f = obj[key];
    obj[key] = function (...a) {
      const t0 = now();
      try { return f.apply(this, a); } finally { add(label, now() - t0); frameCpu.push(frameAcc); frameAcc = 0; }
    };
  };
  if (wc.post && typeof wc.post.render === 'function') wrapRender(wc.post, 'render', 'render');
  else wrapRender(wc.renderer, 'render', 'render');

  // --- bus listeners -------------------------------------------------------------
  const listeners = new Map(); // evt → live count
  const busOn = wc.bus.on.bind(wc.bus);
  wc.bus.on = (evt, fn) => {
    listeners.set(evt, (listeners.get(evt) || 0) + 1);
    const off = busOn(evt, fn);
    let done = false;
    return () => { if (!done) { done = true; listeners.set(evt, listeners.get(evt) - 1); } return off(); };
  };
  const busEmit = wc.bus.emit.bind(wc.bus);
  const emits = new Map();
  wc.bus.emit = (evt, d) => { emits.set(evt, (emits.get(evt) || 0) + 1); return busEmit(evt, d); };

  // --- WebSocket traffic (the net module re-emits every message as net:<t>) --------
  const msgs = new Map(); // t → [count, bytes]
  let profileLast = 0, profileCount = 0, profileMax = 0;
  const tap = (ev) => {
    const d = ev.data;
    let t = 'chunk', n = 0;
    if (typeof d === 'string') { n = d.length; const m = /^\{"t":"([a-zA-Z]+)"/.exec(d); t = m ? m[1] : '?'; }
    else n = d.byteLength || 0;
    const e = msgs.get(t) || [0, 0]; e[0]++; e[1] += n; msgs.set(t, e);
    if (t === 'profile') { profileLast = n; profileCount++; profileMax = Math.max(profileMax, n); }
  };
  // core/net.js keeps its socket private: hook it on its first send (poses go out
  // every frame-ish) and listen to its messages alongside its own onmessage.
  let hooked = false;
  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (m) {
    if (!this.__soak) { this.__soak = true; this.addEventListener('message', tap); hooked = true; }
    return origSend.call(this, m);
  };

  // --- Web Audio nodes ------------------------------------------------------------
  const au = { created: 0, collected: 0, byType: new Map(), sourcesStarted: 0, sourcesEnded: 0 };
  const reg = new FinalizationRegistry((type) => { au.collected++; au.byType.set(type, au.byType.get(type) - 1); });
  const AC = window.AudioContext || window.webkitAudioContext;
  const BAC = window.BaseAudioContext || AC;
  const track = (node, type) => {
    au.created++; au.byType.set(type, (au.byType.get(type) || 0) + 1); reg.register(node, type);
    if (typeof node.start === 'function') {
      const st = node.start;
      node.start = function (...a) { au.sourcesStarted++; this.addEventListener('ended', () => au.sourcesEnded++, { once: true }); return st.apply(this, a); };
    }
    return node;
  };
  for (const name of Object.getOwnPropertyNames(BAC.prototype)) {
    if (!/^create[A-Z]/.test(name) || name === 'createBuffer' || name === 'createPeriodicWave') continue;
    const f = BAC.prototype[name];
    if (typeof f !== 'function') continue;
    BAC.prototype[name] = function (...a) { return track(f.apply(this, a), name.slice(6)); };
  }
  // Constructor-style nodes (new GainNode(ac)) are counted through the class wrappers.
  for (const cls of ['GainNode', 'OscillatorNode', 'AudioBufferSourceNode', 'BiquadFilterNode', 'PannerNode', 'StereoPannerNode', 'DelayNode', 'ConvolverNode', 'DynamicsCompressorNode', 'WaveShaperNode', 'AnalyserNode', 'ConstantSourceNode', 'ChannelMergerNode', 'ChannelSplitterNode']) {
    const C = window[cls];
    if (!C) continue;
    const W = function (...a) { return track(new C(...a), cls.replace('Node', '')); };
    W.prototype = C.prototype;
    try { window[cls] = W; } catch { /* ignore */ }
  }

  // --- timers and animation-frame callbacks ---------------------------------------
  const tm = { intervals: new Set(), timeouts: new Set(), raf: 0 };
  const sI = window.setInterval, cI = window.clearInterval, sT = window.setTimeout, cT = window.clearTimeout, rAF = window.requestAnimationFrame;
  window.setInterval = function (...a) { const id = sI.apply(this, a); tm.intervals.add(id); return id; };
  window.clearInterval = function (id) { tm.intervals.delete(id); return cI.call(this, id); };
  window.setTimeout = function (fn, ms, ...rest) {
    let id = 0;
    const wrapped = typeof fn === 'function' ? function (...x) { tm.timeouts.delete(id); return fn.apply(this, x); } : fn;
    id = sT.call(this, wrapped, ms, ...rest); tm.timeouts.add(id); return id;
  };
  window.clearTimeout = function (id) { tm.timeouts.delete(id); return cT.call(this, id); };
  window.requestAnimationFrame = function (cb) { tm.raf++; return rAF.call(this, cb); };

  // --- texture census: every texture uploaded after this point, until disposed --------
  // three.js's WebGLTextures adds a 'dispose' listener to a texture when it first
  // uploads it (that is when info.memory.textures counts it): hook that. Geometries
  // get the same listener from WebGLGeometries.
  const texLive = new Map(); // texture → label
  const geoLive = new Map(); // geometry → label
  const texLabel = (t) => {
    const img = t.image || {};
    const kind = img instanceof HTMLCanvasElement ? 'canvas' : img instanceof HTMLImageElement ? 'img' : img.data ? 'data' : t.isRenderTargetTexture ? 'rt' : 'other';
    return `${t.constructor.name}:${t.name || '-'}:${kind}:${img.width || 0}x${img.height || 0}`;
  };
  const ED = Object.getPrototypeOf(wc.THREE.Texture.prototype);
  const addL = ED.addEventListener;
  ED.addEventListener = function (type, fn) {
    if (type === 'dispose' && this.isTexture && !texLive.has(this)) {
      texLive.set(this, texLabel(this));
      addL.call(this, 'dispose', () => texLive.delete(this));
    } else if (type === 'dispose' && this.isBufferGeometry && !geoLive.has(this)) {
      geoLive.set(this, (this.name || this.type) + ':' + (this.attributes.position?.count || 0));
      addL.call(this, 'dispose', () => geoLive.delete(this));
    }
    return addL.call(this, type, fn);
  };
  const texCensus = () => {
    const by = new Map();
    for (const l of texLive.values()) by.set(l, (by.get(l) || 0) + 1);
    const gb = new Map();
    for (const l of geoLive.values()) { const k = l.replace(/:\d+$/, ''); gb.set(k, (gb.get(k) || 0) + 1); }
    return { gn: geoLive.size, gtop: [...gb].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + '×' + v).join(','), n: texLive.size, top: [...by].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + '×' + v).join(',') };
  };

  // --- helpers ---------------------------------------------------------------------
  const stat = (arr) => {
    if (!arr.length) return { mean: 0, p95: 0, max: 0, n: 0 };
    const s = [...arr].sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    return { mean, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], max: s[s.length - 1], n: s.length };
  };
  const f1 = (x) => (Math.round(x * 10) / 10).toString();
  const sceneCount = () => {
    let n = 0, vis = 0, inst = 0; const top = new Map();
    for (const c of wc.scene.children) {
      let k = 0; c.traverse((o) => { k++; if (o.visible) vis++; if (o.isInstancedMesh) inst += o.count; });
      const key = c.name || c.type; top.set(key, (top.get(key) || 0) + k); n += k;
    }
    n++;
    const big = [...top].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ':' + v).join(',');
    return { n, vis, inst, big };
  };
  const domCount = () => {
    const all = document.getElementsByTagName('*').length;
    const ids = [];
    for (const el of document.querySelectorAll('[id]')) ids.push([el.id, el.getElementsByTagName('*').length]);
    ids.sort((a, b) => b[1] - a[1]);
    const scr = [...(document.getElementById('screens')?.children || [])].map((e) => [(e.className || e.tagName).split(' ').slice(0, 2).join('.'), e.getElementsByTagName('*').length]).filter(([, v]) => v > 10);
    return { all, top: ids.slice(0, 8).map(([k, v]) => k + ':' + v).join(',') + ' screens{' + scr.map(([k, v]) => k + ':' + v).join(',') + '}' };
  };
  const len = (x) => (Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.keys(x).length : 0);

  const t0 = now();
  let lastReport = now();
  const SOAK = {
    report(label = '') {
      const t = now();
      const secs = (t - lastReport) / 1000;
      lastReport = t;
      const fs = stat(fr.deltas); fr.deltas = [];
      const fc = stat(frameCpu); frameCpu.length = 0;
      const mods = [...cpu].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => k + '=' + f1(v / Math.max(1, fc.n))).join(' ');
      cpu.clear();
      const info = wc.renderer.info;
      const sc = sceneCount();
      const tc = texCensus();
      const dom = domCount();
      const p = wc.state.profile || {};
      const j = p.journal || {};
      const wd = wc.world?.debug || {};
      let lst = 0; for (const v of listeners.values()) lst += v;
      const topL = [...listeners].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => k + ':' + v).join(',');
      const net = [...msgs].sort((a, b) => b[1][1] - a[1][1]).slice(0, 9).map(([k, [c, b]]) => `${k}=${f1(c / secs)}/s,${f1(b / secs / 1024)}kB/s`).join(' ');
      msgs.clear();
      const pc = profileCount; profileCount = 0;
      const auLive = [...au.byType].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + ':' + v).join(',');
      const rafN = tm.raf; tm.raf = 0;
      const line = [
        `INFO SOAK ${label} t=${f1((t - t0) / 1000)}s`,
        `pos=${Math.round(wc.player.feet.x)},${Math.round(wc.player.feet.z)}`,
        `raf(mean/p95/max ms)=${f1(fs.mean)}/${f1(fs.p95)}/${f1(fs.max)} n=${fs.n}`,
        `cpu/frame(mean/p95/max)=${f1(fc.mean)}/${f1(fc.p95)}/${f1(fc.max)}`,
        `mods[${mods}]`,
        `heapMB=${f1((performance.memory?.usedJSHeapSize || 0) / 1048576)}`,
        `dom=${dom.all} [${dom.top}]`,
        `geo=${info.memory.geometries} tex=${info.memory.textures} progs=${info.programs?.length} texNew=${tc.n} [${tc.top}] geoNew=${tc.gn} [${tc.gtop}] calls=${info.render.calls} tris=${info.render.triangles}`,
        `scene=${sc.n} visible=${sc.vis} instances=${sc.inst} [${sc.big}]`,
        `world=${JSON.stringify({ chunks: wd.chunks, backlog: wd.backlog, meshes: wd.meshes, far: wd.far })}`,
        `birds=${wc.birds?.count} nests=${JSON.stringify(wc.nests?.debug)} forage=${JSON.stringify(wc.forage?.debug ?? wc.forage?.stats ?? null)}`,
        `audio created=${au.created} alive=${au.created - au.collected} srcPlaying=${au.sourcesStarted - au.sourcesEnded} voices=${wc.audio?.voices} [${auLive}]`,
        `bus=${lst} [${topL}]`,
        `timers intervals=${tm.intervals.size} timeouts=${tm.timeouts.size} rafPerFrame=${f1(rafN / Math.max(1, fs.n))} acState=${wc.audio?.context?.state ?? '-'}`,
        `net[${net}] wsHooked=${hooked}`,
        `profile last=${profileLast}B max=${profileMax}B n=${pc}`,
        `pois=${len(wc.state.pois)} trails=${len(wc.state.trails)} mysteries=${len(j.mysteries)} obs=${len(j.observations)} photos=${len(j.photos)} recs=${len(j.recordings)} flags=${len(p.flags)} xpLog=${len(p.xpLog)} explored=${len(p.explored)}`,
        `stance=${wc.player?.stance} move=${wc.player?.move} ring=${wc.soundring ? (wc.soundring.visible ? 'shown' : 'hidden') + ' arcs=' + (wc.soundring.debug?.().length ?? '-') + ' follow=' + wc.soundring.followId : '-'}`,
      ].join(' | ');
      console.error(line);
      return line;
    },
    // --- the walker -----------------------------------------------------------------
    walk: { on: false, route: [], i: 0, lastPos: null, stuckT: 0, run: true, dist: 0 },
    key(code, down) { window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })); },
    startWalk(route, run = true) {
      const w = SOAK.walk; w.route = route; w.i = 0; w.on = true; w.run = run;
      if (w.timer) clearInterval(w.timer);
      w.timer = setInterval(SOAK.steer, 100);
    },
    stopWalk() {
      const w = SOAK.walk; w.on = false; clearInterval(w.timer);
      SOAK.key('KeyW', false); SOAK.key('ShiftLeft', false);
    },
    steer() {
      const w = SOAK.walk; if (!w.on || wc.state.mode !== 'play') return;
      const inp = wc.input;
      if (!inp.isDown('forward')) SOAK.key('KeyW', true);
      if (w.run && !inp.isDown('run')) SOAK.key('ShiftLeft', true);
      const f = wc.player.feet; const tgt = w.route[w.i % w.route.length];
      const dx = tgt[0] - f.x, dz = tgt[1] - f.z;
      if (Math.hypot(dx, dz) < 6) { w.i++; return; }
      wc.player.yaw = Math.atan2(dx, -dz);
      if (w.lastPos) {
        const moved = Math.hypot(f.x - w.lastPos[0], f.z - w.lastPos[1]);
        w.dist += moved;
        w.stuckT = moved < 0.05 ? w.stuckT + 0.1 : 0;
        if (w.stuckT > 3) { // blocked (a trunk, a cliff, deep water): hop 4 m toward the target
          const d = Math.hypot(dx, dz), nx = f.x + dx / d * 4, nz = f.z + dz / d * 4;
          wc.player.teleport(nx, wc.world.heightAt(nx, nz), nz, wc.player.yaw); w.stuckT = 0;
        }
      }
      w.lastPos = [f.x, f.z];
    },
    // Geometries and textures uploaded since the start that no object in the scene
    // uses any more and that were never disposed (GPU memory nobody can draw).
    orphans() {
      const usedG = new Set(), usedT = new Set();
      const texOf = (m) => { for (const v of Object.values(m || {})) { if (v && v.isTexture) usedT.add(v); else if (v && v.value && v.value.isTexture) usedT.add(v.value); } };
      wc.scene.traverse((o) => {
        if (o.geometry) usedG.add(o.geometry);
        for (const m of [].concat(o.material || [])) { texOf(m); texOf(m.uniforms); }
        if (o.skeleton?.boneTexture) usedT.add(o.skeleton.boneTexture);
      });
      const by = new Map();
      for (const g of geoLive.keys()) {
        if (usedG.has(g)) continue;
        const k = 'geo:' + Object.keys(g.attributes).sort().join('+') + (g.isInstancedBufferGeometry ? ':inst' : '');
        by.set(k, (by.get(k) || 0) + 1);
      }
      for (const [t, l] of texLive) if (!usedT.has(t)) by.set('tex:' + l, (by.get('tex:' + l) || 0) + 1);
      const line = 'INFO SOAK orphans ' + [...by].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '×' + v).join(' ');
      console.error(line);
      return line;
    },
    // Change stance with the real keys (C crouch toggle, Z prone toggle) until the
    // controller reports `want` (stand | crouch | prone); gives up after a few presses.
    async stance(want) {
      for (let i = 0; i < 4 && wc.player?.stance !== want; i++) {
        const cur = wc.player?.stance;
        const code = want === 'prone' || (cur === 'prone' && want === 'stand') ? 'KeyZ' : 'KeyC';
        SOAK.key(code, true); await S.sleep(80); SOAK.key(code, false);
        await S.sleep(1800);
      }
      return wc.player?.stance;
    },
    // Hold still at a fixed pose for ms and report the frame timings there.
    async bench(label, x, z, yawDeg, ms = 12000) {
      const was = SOAK.walk.on; SOAK.stopWalk();
      S.pose(x, z, yawDeg, 0);
      // Let streaming settle after the jump (chunks, far field, props) before measuring.
      for (let i = 0; i < 60 && (wc.world?.debug?.backlog || wc.world?.debug?.far?.inflight); i++) await S.sleep(500);
      await S.sleep(10000);
      SOAK.report('pre-' + label);
      await S.sleep(ms);
      const line = SOAK.report('BENCH-' + label);
      if (was) SOAK.startWalk(SOAK.walk.route, SOAK.walk.run);
      return line;
    },
  };
  window.SOAK = SOAK;
  console.error('INFO SOAK instrumentation installed; modules=' + (wc.modules || []).map((m) => m.name).join(','));
})();
