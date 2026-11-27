// Screenshot harness for WILDCALL: loads the running game in a hidden Electron window,
// drives it with small scripted steps and writes PNG screenshots. It lets an engineer
// (or an agent) SEE the game without a browser on screen.
//
// Usage (from the repo root; needs `npm ci` in desktop/ once):
//   desktop/node_modules/.bin/electron tools/shot/shot.cjs \
//       --url http://127.0.0.1:8177 --out /tmp/shots [--plan tools/shot/plans/tour.json] [--width 1280 --height 720]
//
// A plan is a JSON array of steps, run in order. Each step may have:
//   "js":   JavaScript evaluated in the page (async allowed; `wc` is window.wildcall, `S` is the helper below)
//   "wait": milliseconds to wait afterwards (default 0)
//   "shot": file name (without extension) to capture after the wait
// Helpers available as S.* inside "js":
//   S.pose(x, z, yawDeg, pitchDeg)        stand at x,z on the ground, facing a compass heading (0 = north, 90 = east)
//   S.at(poiId, distance, pitchDeg)       stand `distance` metres from a POI, looking at it
//   S.look(yawDeg, pitchDeg)              turn in place
//   S.time(hour) / S.weather(n) / S.season(n)   debug commands (engine must run with -dev)
//   S.tp(arg...)                          debug teleport: S.tp('murmur_marsh') or S.tp(120, -40)
//   S.tool(name, raised)                  'binoculars' | 'camera' | 'recorder' | 'none'
//   S.open(screen, data) / S.close()      UI screens
//   S.debug(cmd, ...args)                 any debug command
//   S.sleep(ms)
// Without --plan it takes a default tour around the home valley at several times of day.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const url = arg('url', 'http://127.0.0.1:8080').replace(/\/$/, '');
const out = path.resolve(arg('out', './shots'));
const width = parseInt(arg('width', '1280'), 10);
const height = parseInt(arg('height', '720'), 10);
const planPath = arg('plan', '');

const DEFAULT_PLAN = [
  { js: "S.time(10); S.weather(0)", wait: 2500 },
  { js: "S.at('cabin', 16, -2)", wait: 2500, shot: 'cabin-morning' },
  { js: "S.at('old_oak', 22, 8)", wait: 2500, shot: 'old-oak' },
  { js: "S.at('creekside', 14, -8)", wait: 2500, shot: 'creek' },
  { js: "S.at('meadow_clearing', 30, -3)", wait: 2500, shot: 'meadow' },
  { js: "S.at('fern_valley', 14, -6)", wait: 2500, shot: 'fern-valley' },
  { js: "S.at('old_watchtower', 24, 6)", wait: 2500, shot: 'watchtower' },
  { js: "S.time(18.6); S.at('meadow_clearing', 30, 0)", wait: 3500, shot: 'meadow-evening' },
  { js: "S.time(5.4); S.at('cabin', 16, 0)", wait: 3500, shot: 'cabin-dawn' },
  { js: "S.time(23); S.at('cabin', 16, 4)", wait: 3500, shot: 'cabin-night' },
];

const HELPERS = `
window.S = (() => {
  const wc = () => window.wildcall;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rad = (d) => d * Math.PI / 180;
  const ground = (x, z) => (wc().world && wc().world.heightAt ? wc().world.heightAt(x, z) : 0);
  const setPitch = (p) => { try { wc().player.pitch = rad(p); } catch (e) {} };
  const S = {
    sleep,
    debug(cmd, ...args) { wc().net.send('debug', { cmd, args: args.map(String) }); },
    time(h) { S.debug('time', h); },
    weather(n) { S.debug('weather', n); },
    season(n) { S.debug('season', n); },
    tp(...a) { S.debug('tp', ...a); },
    pose(x, z, yawDeg = 0, pitchDeg = 0) { wc().player.teleport(x, ground(x, z), z, rad(yawDeg)); setPitch(pitchDeg); },
    look(yawDeg, pitchDeg = 0) { const f = wc().player.feet; wc().player.teleport(f.x, f.y, f.z, rad(yawDeg)); setPitch(pitchDeg); },
    at(id, dist = 12, pitchDeg = 0, bearingDeg = 135) {
      const p = wc().state.pois[id]; if (!p) throw new Error('no POI ' + id);
      const b = rad(bearingDeg); const x = p.pos.x + Math.sin(b) * dist, z = p.pos.z - Math.cos(b) * dist;
      wc().player.teleport(x, ground(x, z), z, Math.atan2(p.pos.x - x, -(p.pos.z - z))); setPitch(pitchDeg);
    },
    tool(name, raised = true) {
      wc().bus.emit('action:tool-' + name, {});
      if (name !== 'none') wc().bus.emit(raised ? 'mouse:down' : 'mouse:up', { button: 2 });
    },
    open(name, data = {}) { wc().ui.open(name, data); },
    close() { wc().ui.closeAll(); },
  };
  return S;
})();`;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Silent by default: these hidden windows run next to a person playing the real game.
// The audio engine still runs (meters, events, tests); only the output is muted. --sound 1 to hear it.
if (arg('sound', '') !== '1') app.commandLine.appendSwitch('mute-audio');
app.commandLine.appendSwitch('force-device-scale-factor', arg('dpr', '1')); // 1 = screenshots are exactly width x height
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// At most a few of these hidden game windows render at once (default 2; WILDCALL_SHOT_SLOTS
// to change): each one costs a real game's worth of GPU and CPU, and a person may be playing
// the actual game on this machine. Extra runs wait their turn.
const SLOT_DIR = path.join(require('os').tmpdir(), 'wildcall-shot-slots');
const SLOTS = Math.max(1, parseInt(process.env.WILDCALL_SHOT_SLOTS || '2', 10) || 2);
let slotFile = '';
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function acquireSlot() {
  fs.mkdirSync(SLOT_DIR, { recursive: true });
  const t0 = Date.now();
  let told = false;
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const f = path.join(SLOT_DIR, 'slot-' + i);
      try {
        fs.writeFileSync(f, String(process.pid), { flag: 'wx' });
        slotFile = f;
        if (told) console.log(`slot free after ${Math.round((Date.now() - t0) / 1000)} s`);
        return;
      } catch {
        let pid = 0;
        try { pid = parseInt(fs.readFileSync(f, 'utf8'), 10) || 0; } catch { /* just released */ }
        if (pid && !alive(pid)) { try { fs.unlinkSync(f); } catch { /* someone else did */ } }
      }
    }
    if (!told) { told = true; console.log(`waiting for a free slot (${SLOTS} game windows may render at once)…`); }
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
  }
}
const releaseSlot = () => { if (slotFile) { try { fs.unlinkSync(slotFile); } catch { /* gone */ } slotFile = ''; } };
process.on('exit', releaseSlot);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { releaseSlot(); process.exit(1); });

app.whenReady().then(async () => {
  if (app.dock) app.dock.hide();
  await acquireSlot();
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: false, paintWhenInitiallyHidden: true,
    webPreferences: { backgroundThrottling: false, contextIsolation: true },
  });
  const wcn = win.webContents;
  const errors = [];
  wcn.on('console-message', (e) => {
    const level = e.level, message = e.message || '';
    // Metric lines (tools/soak) are printed as they come, in full, never de-duplicated.
    // Each metric line gets the page's renderer and the GPU process's cumulative CPU
    // seconds appended: CPU time, unlike wall time, does not grow when the machine is busy.
    if (message.startsWith('INFO SOAK')) {
      let proc = '';
      try {
        const pid = wcn.getOSProcessId();
        const ms = app.getAppMetrics();
        const r = ms.find((m) => m.pid === pid), g = ms.find((m) => m.type === 'GPU');
        proc = ` | proc rendererCpuS=${r?.cpu?.cumulativeCPUUsage?.toFixed(2) ?? '?'} gpuCpuS=${g?.cpu?.cumulativeCPUUsage?.toFixed(2) ?? '?'}`;
      } catch { /* metrics unavailable */ }
      console.log(message + proc);
      return;
    }
    if ((level === 'error' || level === 3 || level === 'warning' && /threw|failed/.test(message)) && !/Electron Security Warning/.test(message)) errors.push(message);
  });
  const ev = (code) => wcn.executeJavaScript(`(async () => { const wc = window.wildcall; ${code} })()`, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let failed = false;
  try {
    await win.loadURL(url + '/?play=1&nolock=1');
    const t0 = Date.now();
    for (;;) {
      const ready = await wcn.executeJavaScript("!!(window.wildcall && window.wildcall.state && window.wildcall.state.mode === 'play')");
      if (ready) break;
      if (Date.now() - t0 > 40000) throw new Error('game did not reach play mode within 40 s');
      await wait(250);
    }
    await wcn.executeJavaScript(HELPERS + '; 0');
    // Photos need a clean frame: hide the cursor-independent boot overlay just in case.
    await wait(1500);
    const plan = planPath ? JSON.parse(fs.readFileSync(planPath, 'utf8')) : DEFAULT_PLAN;
    for (const step of plan) {
      if (step.js) await ev(step.js);
      if (step.wait) await wait(step.wait);
      if (step.shot) {
        const img = await wcn.capturePage();
        const file = path.join(out, step.shot + '.png');
        fs.writeFileSync(file, img.toPNG());
        const info = await ev("return { fps: 0, calls: wc.renderer.info.render.calls, tris: wc.renderer.info.render.triangles }");
        console.log(`shot ${file}  drawCalls=${info.calls} triangles=${info.tris}`);
      }
    }
    // A quick frame-rate reading at the last pose.
    const fps = await ev("let n = 0; const t = performance.now(); await new Promise((r) => { const f = () => { n++; performance.now() - t < 2000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); return Math.round(n / 2);");
    console.log('fps(last pose)=' + fps);
  } catch (err) {
    failed = true;
    console.error('shot failed: ' + (err && err.message ? err.message : err));
  }
  if (errors.length) console.log('console errors (' + errors.length + '):\n' + [...new Set(errors)].slice(0, 20).join('\n'));
  app.exit(failed ? 1 : 0);
});
