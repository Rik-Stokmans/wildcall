// Pure planner for the procedurally painted region banner. Produces a deterministic
// description of layered hills, trees and details from a region's key, colour and
// habitats; region.js paints the plan onto a canvas. No DOM here, so it is unit tested.
import { mixHex, shadeHex, safeHex } from './logic.js';

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Per-region moods: sky gradient, hill palette (far -> near), tree colour, glow.
const MOODS = {
  greenhollow: { sky: ['#BFD9C4', '#F2EBDD'], hills: ['#9DB88C', '#7C9A70', '#5F8159'], tree: '#355C43', sun: '#F7E3A8' },
  murmur_marsh: { sky: ['#C9D4C8', '#EFE8D2'], hills: ['#A9B58F', '#8C9C73', '#6F8460'], tree: '#587455', sun: '#F3E2B0' },
  windpeak: { sky: ['#A9BED2', '#E9E3D3'], hills: ['#9AA6AF', '#7E8A8E', '#625E58'], tree: '#46594A', sun: '#F4EAD0' },
  whispering_coast: { sky: ['#A8C8DA', '#F1EAD8'], hills: ['#B9C7A2', '#D9C7A0', '#C4AF82'], tree: '#5D7C5A', sun: '#FFF0C4' },
  amberwood: { sky: ['#E8C9A0', '#F6E6C8'], hills: ['#D9A867', '#C98A50', '#A96D38'], tree: '#B5602E', sun: '#FFD998' },
  frostveil: { sky: ['#B7C9DC', '#EEF2F5'], hills: ['#DCE5EC', '#C3D1DC', '#A9BCCB'], tree: '#3E5B53', sun: '#F4F7FA' },
};

function moodFor(key, color) {
  if (MOODS[key]) return MOODS[key];
  const c = safeHex(color, '#7C9A70');
  return {
    sky: [mixHex(c, '#ffffff', 0.7), '#F2EBDD'],
    hills: [shadeHex(c, 0.3), c, shadeHex(c, -0.2)],
    tree: shadeHex(c, -0.45), sun: '#F7E3A8',
  };
}

/** Which scenery a list of player-facing habitat names asks for. */
export function habitatTraits(habitats) {
  const text = (habitats || []).join(' ').toLowerCase();
  return {
    pines: /pine|conifer|snow-laden/.test(text),
    reeds: /reed|marsh|wet|pool/.test(text),
    water: /water|river|creek|pond|lake|stream|channel|sea|surf/.test(text),
    crags: /cliff|rock|scree|mountain|alpine|highland|crag|slope/.test(text),
    sand: /beach|shore|dune|sand/.test(text),
    snow: /snow|frost|ice|frozen/.test(text),
    broadleaf: /wood|forest|oak|thicket|clearing|shrub|meadow|glade/.test(text),
  };
}

/**
 * @param {{key?:string,color?:string,habitats?:string[]}} region
 * @param {number} w  canvas width (CSS px)
 * @param {number} h  canvas height
 * @returns {{w,h,sky:string[],sun:{x,y,r,color},hills:{color,points:number[][]}[],trees:object[],details:object[],water:object|null,traits:object}}
 */
export function landscapePlan(region, w = 640, h = 220) {
  const key = region?.key || '';
  const mood = moodFor(key, region?.color);
  const traits = habitatTraits(region?.habitats);
  const rand = rng(hashString(key + '|' + (region?.habitats || []).join(',')));
  const between = (a, b) => a + (b - a) * rand();

  const hills = mood.hills.map((color, i) => {
    const base = h * (0.52 + i * 0.13);
    const amp = (traits.crags ? 0.26 : 0.12) * h * (1 - i * 0.25);
    const wave = between(0.006, 0.012) * (traits.crags ? 1.6 : 1);
    const phase = between(0, 6.28);
    const points = [];
    for (let x = 0; x <= w; x += 16) {
      const jag = traits.crags && i === 0 ? (rand() - 0.5) * amp * 0.35 : 0;
      points.push([x, base - amp * (0.5 + 0.5 * Math.sin(x * wave + phase + i)) - amp * 0.25 * Math.sin(x * wave * 2.3 + i * 2) + jag]);
    }
    return { color, points };
  });

  const treeKind = traits.pines ? 'pine' : key === 'amberwood' ? 'round' : traits.broadleaf ? 'round' : null;
  const trees = [];
  if (treeKind) {
    const n = traits.broadleaf || traits.pines ? 16 : 6;
    for (let i = 0; i < n; i++) {
      const x = between(0.02, 0.98) * w;
      const row = i % 3;
      const hill = hills[Math.min(row, hills.length - 1)].points;
      const y = hill[Math.max(0, Math.min(hill.length - 1, Math.round(x / 16)))][1] + 6 + row * 4;
      trees.push({ kind: rand() < 0.25 && traits.pines ? 'pine' : treeKind, x, y, s: (0.7 + row * 0.35) * between(0.8, 1.25), color: mixHex(mood.tree, mood.hills[2], row * 0.15), snow: traits.snow });
    }
    trees.sort((a, b) => a.y - b.y);
  }

  const details = [];
  if (traits.reeds) for (let i = 0; i < 30; i++) details.push({ kind: 'reed', x: between(0, w), y: h - between(0, 0.22) * h, s: between(0.6, 1.4), color: mixHex('#8C9C73', '#C4AF82', rand()) });
  if (traits.sand) details.push({ kind: 'sand', y: h * 0.86 });
  if (traits.snow) for (let i = 0; i < 40; i++) details.push({ kind: 'flake', x: between(0, w), y: between(0, h), r: between(0.8, 2.2) });
  if (key === 'amberwood') for (let i = 0; i < 26; i++) details.push({ kind: 'leaf', x: between(0, w), y: between(0.1, 0.95) * h, r: between(1.5, 3.2), color: i % 2 ? '#E0953F' : '#B5602E' });
  if (traits.crags) for (let i = 0; i < 4; i++) details.push({ kind: 'crag', x: between(0.1, 0.9) * w, y: h * between(0.55, 0.75), s: between(0.7, 1.3) });

  const water = traits.water || traits.reeds ? { y: h * (traits.sand ? 0.8 : 0.84), color: traits.sand ? '#7FA6BA' : '#8FB0B4' } : null;

  return {
    w, h, sky: mood.sky,
    sun: { x: between(0.62, 0.84) * w, y: between(0.16, 0.28) * h, r: h * 0.09, color: mood.sun },
    hills, trees, details, water, traits,
  };
}
