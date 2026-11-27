// Prints the soak series as a table: node tools/soak/table.mjs <client log> [engine log]
// (the client log is the harness output, the engine log the engine's stderr with -dev).
import { readFileSync } from 'node:fs';

const [clientLog, engineLog] = process.argv.slice(2);
const num = (re, s, i = 1) => { const m = re.exec(s); return m ? m[i] : ''; };
const rows = [];
let prevR = NaN, prevG = NaN;
for (const line of readFileSync(clientLog, 'utf8').split('\n')) {
  if (!line.startsWith('INFO SOAK ') || !line.includes(' t=')) continue;
  rows.push({
    label: num(/^INFO SOAK (\S+)/, line),
    t: num(/ t=([\d.]+)s/, line),
    pos: num(/pos=(\S+)/, line),
    raf: num(/raf\(mean\/p95\/max ms\)=(\S+)/, line),
    cpu: num(/cpu\/frame\(mean\/p95\/max\)=(\S+)/, line),
    // Renderer / GPU-process CPU time per frame over the interval (harness-appended).
    ...(() => {
      const r = parseFloat(num(/rendererCpuS=([\d.]+)/, line)), g = parseFloat(num(/gpuCpuS=([\d.]+)/, line));
      const n = Number(num(/max ms\)=\S+ n=(\d+)/, line));
      const out = { rCpuMs: Number.isFinite(r - prevR) && n ? ((r - prevR) * 1000 / n).toFixed(1) : '', gCpuMs: Number.isFinite(g - prevG) && n ? ((g - prevG) * 1000 / n).toFixed(1) : '' };
      if (Number.isFinite(r)) prevR = r;
      if (Number.isFinite(g)) prevG = g;
      return out;
    })(),
    heap: num(/heapMB=(\S+)/, line),
    dom: num(/dom=(\d+)/, line),
    geo: num(/geo=(\d+)/, line),
    tex: num(/tex=(\d+)/, line),
    texNew: num(/texNew=(\d+)/, line),
    progs: num(/progs=(\d+)/, line),
    calls: num(/calls=(\d+)/, line),
    scene: num(/scene=(\d+)/, line),
    inst: num(/instances=(\d+)/, line),
    birds: num(/birds=(\d+) nests/, line),
    auAlive: num(/alive=(\d+)/, line),
    srcs: num(/srcPlaying=(-?\d+)/, line),
    bus: num(/bus=(\d+)/, line),
    prof: num(/profile last=(\d+)B/, line),
    pois: num(/ pois=(\d+) trails/, line),
    trails: num(/trails=(\d+)/, line),
    myst: num(/mysteries=(\d+)/, line),
  });
}
const cols = Object.keys(rows[0] || {});
const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
const fmt = (r) => cols.map((c, i) => String(r[c]).padStart(w[i])).join(' ');
console.log(fmt(Object.fromEntries(cols.map((c) => [c, c]))));
for (const r of rows) console.log(fmt(r));
if (engineLog) {
  console.log('\nengine:');
  for (const line of readFileSync(engineLog, 'utf8').split('\n')) {
    if (!line.includes('SOAK engine')) continue;
    const g = (k) => num(new RegExp(' ' + k + '=([\\d.]+)'), line);
    console.log(['t', 'cpuPct', 'tickMean', 'tickMax', 'heapMB', 'heapObjs', 'ecoCells', 'birds', 'sentPOI', 'sentTrail', 'heardBirds', 'investigated', 'mysteryBird', 'callLog', 'mysteries', 'observations', 'flags', 'xpLog', 'explored', 'forage', 'profileBytes', 'viewBytes']
      .map((k) => k + '=' + g(k)).join(' '));
  }
}
