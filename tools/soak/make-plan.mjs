// Builds the soak plan for tools/shot/shot.cjs: node tools/soak/make-plan.mjs [minutes] > /tmp/soak.json
// The plan injects tools/soak/instrument.js, walks (running) a long loop through the
// home valley and out several hundred metres beyond it, raises and lowers each tool,
// opens and closes the journal and the map, changes the weather twice, logs one line
// of metrics every 25 s, and benchmarks frame time at a fixed pose and time of day at
// minute 2 and at the end of the run.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const minutes = Number(process.argv[2] || 13);
// `stances` as the second argument: every step also changes stance (stand, crouch,
// prone, then crawl on in prone) with the real keys, so the walk covers all three.
const stances = process.argv[3] === 'stances';
const STANCE_CYCLE = ['crouch', 'prone', 'prone', 'stand', 'prone', 'crouch', 'stand'];
const instrument = readFileSync(join(here, 'instrument.js'), 'utf8');

const plan = [];
const step = (js, wait = 0, shot) => plan.push(shot ? { js, wait, shot } : { js, wait });

step(instrument + '\nS.time(6); S.weather(0);', 2500);
// Route: the named places of the home valley, then a wide loop out beyond it.
step(`
  const P = (id) => wc.state.pois[id]?.pos;
  const c = P('cabin') || wc.player.feet;
  const named = ['old_oak', 'creekside', 'meadow_clearing', 'fern_valley', 'old_watchtower'].map(P).filter(Boolean).map((p) => [p.x, p.z]);
  const loop = [[500, 0], [500, -500], [-300, -500], [-300, 300], [200, 300], [0, 0]].map(([dx, dz]) => [c.x + dx, c.z + dz]);
  SOAK.home = [c.x + 14, c.z + 10, 315];
  SOAK.route = [...named, ...loop];
  console.error('INFO SOAK route ' + JSON.stringify(SOAK.route.map((p) => p.map(Math.round))));
  S.pose(SOAK.home[0], SOAK.home[1], SOAK.home[2], 0);
  SOAK.report('start');
  SOAK.startWalk(SOAK.route, true);
`, 1000);

const total = minutes * 60;
const actions = [
  `S.tool('binoculars', true); await S.sleep(4000); S.tool('binoculars', false);`,
  `S.open('journal', {}); await S.sleep(3000); S.close();`,
  `S.tool('camera', true); await S.sleep(3000); wc.bus.emit('mouse:down', {button: 0}); await S.sleep(200); wc.bus.emit('mouse:up', {button: 0}); await S.sleep(1500); S.tool('camera', false);`,
  `S.open('map', {}); await S.sleep(3000); S.close();`,
  `S.tool('recorder', true); await S.sleep(500); wc.bus.emit('mouse:down', {button: 0}); wc.bus.emit('mouse:up', {button: 0}); await S.sleep(9000); wc.bus.emit('mouse:down', {button: 0}); wc.bus.emit('mouse:up', {button: 0}); await S.sleep(1500); S.tool('recorder', false); S.tool('none', false);`,
  `wc.bus.emit('action:journal', {code: 'KeyJ'}); await S.sleep(2500); wc.bus.emit('action:escape', {code: 'Escape'});`,
];
let t = 3.5;
let k = 0;
let benched = false;
while (t < total) {
  if (!benched && t >= 120) {
    step(`await SOAK.bench('early', SOAK.home[0], SOAK.home[1], SOAK.home[2]);`, 0, 'bench-early');
    benched = true;
    t += 15;
    continue;
  }
  let js = `SOAK.report('walk');`;
  if (Math.abs(t - 330) < 13) js += ` S.weather(2);`; // rain
  if (Math.abs(t - 600) < 13) js += ` S.weather(1);`; // cloudy
  if (stances) js += ` await SOAK.stance('${STANCE_CYCLE[k % STANCE_CYCLE.length]}');`;
  js += ' ' + actions[k++ % actions.length];
  step(js, 25000 - 6000, k % 6 === 0 ? `walk-${Math.round(t)}` : undefined);
  t += 25;
}
// End: the same pose and time of day as the early benchmark.
step(`SOAK.report('walk-end'); S.time(8); S.weather(0);`, 3000);
step(`await SOAK.bench('late', SOAK.home[0], SOAK.home[1], SOAK.home[2]);`, 0, 'bench-late');
step(`SOAK.stopWalk(); console.error('INFO SOAK walked ' + Math.round(SOAK.walk.dist) + ' m');`, 500);
process.stdout.write(JSON.stringify(plan, null, 1));
