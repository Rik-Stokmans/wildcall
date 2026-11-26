// Structure builders per POI kind. Each builder draws into Shapes in the prop's local
// frame (front = −Z, y up from the seated base) and returns a BuildSpec:
//
//   { solid: Shape, glow?: Shape, surfaces?: [], blockers?: [{lx,lz,r}],
//     smoke?: [{lx,ly,lz}], interact?: {lx,ly,lz}, reach: number }
//
// Dimensions vary per POI id (deterministic), colours follow the region palette
// (paletteFor in logic.js: weathered grey on the coast, snow caps in Frostveil, warm
// wood and mossy roofs in the woods). Roof heights match the perch heights the world
// generator assumes for each kind (internal/world structureHeight), so birds that
// land on a roof sit on it.
import {
  cabinLayout, hideLayout, towerLayout, perimeterBlockers, shadeHex, mixHex, stairFlight,
} from './logic.js';
import {
  logWall, plankWall, windowOn, doorFront, railing, stairs, crate, barrel, lantern,
  mossOnRoof, snowOnRoof, signpost, foundation, woodpile, bench, reedClump, fern, cairn,
  IRON, ROPE, MOSS, SNOW, LEAF,
} from './parts.js';

const isWoods = (pal) => pal.key === 'greenhollow' || pal.key === 'amberwood' || pal.key === 'murmur_marsh';
const mossHex = (pal) => (pal.key === 'amberwood' ? 0xb8803a : pal.key === 'murmur_marsh' ? 0x7f8a46 : MOSS);

// ---------------------------------------------------------------------------
// Cabin family: the Naturalist Cabin, ranger stations, ruined cabins

/**
 * Log cabin with porch, door, windows, chimney and mossy roof.
 * @param {object} b build context {poi, rand, pal, solid, glow, ground}
 * @param {{ranger?:boolean, lit?:boolean, smoke?:boolean}} o
 */
export function buildCabin(b, o = {}) {
  const { solid: s, glow: g, rand, pal } = b;
  const ranger = !!o.ranger;
  const L = cabinLayout(b.poi.id, { depth: ranger ? 5.2 : 5.0, porch: ranger ? 2.0 : 1.8 });
  const { w, d, deck } = L;
  const wallH = ranger ? 2.5 : 2.6;
  const eave = deck + wallH;
  const rise = (ranger ? 4.2 : 4.6) - eave;
  const wood = shadeHex(pal.wood, pal.shade);
  const frontZ = -d / 2, backZ = d / 2;

  foundation(s, w + 0.25, d + 0.25, deck, pal.stone);
  // Walls: logs for the cabin, painted planks for ranger stations.
  if (ranger) {
    const paint = pal.key === 'whispering_coast' ? 0x8a9a92 : 0x5f7a4e;
    const seam = shadeHex(paint, 0.82);
    plankWall(s, 'x', w, frontZ, deck, wallH, paint, seam, { out: -1 });
    plankWall(s, 'x', w, backZ, deck, wallH, paint, seam, { out: 1 });
    plankWall(s, 'z', d, -w / 2, deck, wallH, paint, seam, { out: -1 });
    plankWall(s, 'z', d, w / 2, deck, wallH, paint, seam, { out: 1 });
    for (const [x, z] of [[-w / 2, frontZ], [w / 2, frontZ], [-w / 2, backZ], [w / 2, backZ]]) {
      s.block(0.2, wallH, 0.2, pal.trim, { x, y: deck, z });
    }
  } else {
    logWall(s, 'x', w + 0.5, frontZ, deck, wallH, wood);
    logWall(s, 'x', w + 0.5, backZ, deck, wallH, wood);
    logWall(s, 'z', d + 0.5, -w / 2, deck, wallH, shadeHex(wood, 0.97));
    logWall(s, 'z', d + 0.5, w / 2, deck, wallH, shadeHex(wood, 0.97));
  }

  // Roof
  const roofHex = ranger ? (pal.key === 'frostveil' ? pal.roof : 0x8a4a34) : pal.roof;
  s.gable(w + 0.9, d + 1.1, rise, eave, roofHex, { endHex: ranger ? pal.trim : wood, inset: 0.45 });
  if (pal.snow) snowOnRoof(s, w + 0.9, d + 1.1, rise, eave);
  else if (!ranger && isWoods(pal)) mossOnRoof(s, w + 0.9, d + 1.1, rise, eave, rand, mossHex(pal), 12);

  // Porch: deck, posts, lean-to roof, rail, steps.
  const pz0 = frontZ - L.porch;
  s.block(w, 0.12, L.porch, shadeHex(pal.wood, 1.08), { x: 0, y: deck - 0.12, z: (frontZ + pz0) / 2 });
  for (let i = 0; i < Math.floor(w / 0.3); i++) {
    s.block(0.02, 0.01, L.porch, shadeHex(pal.wood, 0.8), { x: -w / 2 + 0.3 * (i + 0.5), y: deck, z: (frontZ + pz0) / 2 });
  }
  s.block(w, deck - 0.12 + 1.2, 0.14, pal.dark, { x: 0, y: -1.2, z: pz0 + 0.07 });
  const porchRoofY = eave - 0.15;
  for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) s.block(0.18, porchRoofY - deck, 0.18, pal.dark, { x, y: deck, z: pz0 + 0.15 });
  s.box(w + 0.3, 0.12, L.porch + 0.4, roofHex, { x: 0, y: porchRoofY + 0.05, z: (frontZ + pz0) / 2 - 0.1, rx: 0.14 });
  if (pal.snow) s.box(w + 0.2, 0.1, L.porch + 0.3, SNOW, { x: 0, y: porchRoofY + 0.15, z: (frontZ + pz0) / 2 - 0.1, rx: 0.14 });
  railing(s, -w / 2 + 0.1, w / 2 - 0.1, pz0 + 0.1, frontZ, deck, pal.dark, ['front', 'left', 'right'], { side: 'front', at: 0, width: 1.8 }, { h: 0.8 });
  const steps = stairFlight(deck, { width: 1.6, zTop: pz0, pitch: 28 });
  // the flight descends towards −Z here: mirror it by drawing from the porch edge
  for (let i = 1; i <= steps.steps; i++) {
    const y = deck - steps.rise * i;
    s.block(1.6, y + 0.3, steps.tread + 0.05, shadeHex(pal.wood, 1.02), { x: 0, y: -0.3, z: pz0 - steps.tread * (i - 0.5) });
  }

  // Door and windows
  doorFront(s, 0, frontZ, deck, 0.95, 1.95, ranger ? pal.trim : pal.dark, ranger ? pal.dark : shadeHex(pal.wood, 0.75));
  const lit = !!o.lit;
  const winY = deck + 1.45;
  for (const x of [-w / 4 - 0.25, w / 4 + 0.25]) {
    windowOn(s, g, 'front', x, frontZ - 0.12, winY, 0.9, 0.8, pal.trim, { lit, box: !ranger && !pal.snow, rand, shutters: ranger ? null : 0x5d7a4a });
  }
  windowOn(s, g, 'left', 0, -w / 2 - 0.12, winY, 0.8, 0.75, pal.trim, { lit });
  windowOn(s, g, 'right', -0.6, w / 2 + 0.12, winY, 0.8, 0.75, pal.trim, { lit });
  windowOn(s, g, 'back', 1.2, backZ + 0.12, winY, 0.8, 0.75, pal.trim, { lit });
  lantern(s, lit ? g : null, 0.85, deck + 2.15, frontZ - 0.3, 0.16);

  // Chimney (stone) on the right gable side.
  const chX = w / 2 - 0.9, chZ = 0.9;
  const chTop = eave + rise + 0.8;
  s.block(0.75, chTop + 1.2, 0.75, pal.stone, { x: chX, y: -1.2, z: chZ });
  s.block(0.9, 0.18, 0.9, shadeHex(pal.stone, 0.85), { x: chX, y: chTop - 0.1, z: chZ });
  const smoke = o.smoke ? [{ lx: chX, ly: chTop + 0.25, lz: chZ }] : [];

  // Dressing
  if (ranger) {
    // flag pole, notice board, radio mast
    const fx = -w / 2 - 1.4, fz = pz0 + 0.3;
    s.cyl(0.05, 0.07, 6.5, 0xd8d8d0, { x: fx, y: 3.25, z: fz, seg: 6 });
    s.ball(0.09, 0xc9a24a, { x: fx, y: 6.55, z: fz, detail: 0 });
    s.box(0.04, 0.6, 0.95, 0x3d6b46, { x: fx, y: 6.0, z: fz + 0.5, ry: 0.1 });
    s.block(1.3, 0.9, 0.08, 0x7a5a3a, { x: w / 2 + 0.6, y: 0.9, z: pz0 - 0.4 });
    s.block(1.1, 0.7, 0.03, 0xe8dcc0, { x: w / 2 + 0.6, y: 1.0, z: pz0 - 0.45 });
    for (const lx of [w / 2 + 0.05, w / 2 + 1.15]) s.block(0.09, 1.8, 0.09, pal.dark, { x: lx, y: 0, z: pz0 - 0.4 });
    s.cyl(0.03, 0.05, 3, IRON, { x: -w / 2 + 0.6, y: eave + rise + 0.6, z: 1.2, seg: 5 });
    signpost(s, w / 2 + 1.6, 0, pz0 - 2.4, pal.dark, pal.trim, rand, { boards: 2, angle: rand() * 3 });
    crate(s, -w / 2 - 0.6, 0, backZ - 0.6, 0.6, pal.wood);
  } else {
    woodpile(s, -w / 2 - 0.7, 0.2, 1.6, 4, shadeHex(pal.wood, 1.1), rand);
    s.block(0.1, 0.9, 0.1, pal.dark, { x: -w / 2 - 0.25, y: 0, z: -0.65 });
    s.block(0.1, 0.9, 0.1, pal.dark, { x: -w / 2 - 0.25, y: 0, z: 1.05 });
    s.box(0.6, 0.08, 1.9, roofHex, { x: -w / 2 - 0.6, y: 1.15, z: 0.2, rz: 0.35 });
    barrel(s, w / 2 + 0.55, 0, frontZ + 0.4, 0.32, 0.85, shadeHex(pal.wood, 0.9));
    // a chopping block with an axe-free stump look and a watering can
    s.cyl(0.3, 0.34, 0.5, shadeHex(pal.wood, 1.15), { x: -w / 2 - 1.3, y: 0.25, z: frontZ - 1.6 });
    s.cyl(0.14, 0.16, 0.28, 0x6e8a94, { x: w / 2 + 0.5, y: 0.14, z: pz0 - 0.3 });
    // potted plants on the porch
    for (const x of [-w / 2 + 0.6, w / 2 - 1.4]) {
      s.cyl(0.2, 0.15, 0.32, 0xa8613c, { x, y: deck + 0.16, z: pz0 + 0.45 });
      s.ball(0.28, LEAF, { x, y: deck + 0.48, z: pz0 + 0.45, detail: 0 });
    }
    bench(s, w / 4 + 0.25, deck, frontZ - 0.45, Math.PI, shadeHex(pal.wood, 1.05), { len: 1.4 });
  }

  // log walls are ~0.35 m thick: circles on the wall line keep the porch walkable
  const blockers = perimeterBlockers(w + 0.2, d + 0.1, { r: 0.42 });
  blockers.push({ lx: chX, lz: chZ, r: 0.5 });
  return {
    surfaces: L.surfaces, blockers, smoke,
    interact: { lx: 0, ly: deck + 1.1, lz: frontZ - 0.9 },
    reach: Math.hypot(w, d + 2 * L.porch) / 2 + 3,
  };
}

/** A ruined trapper's cabin: broken log walls, a fallen roof, moss and brambles. */
export function buildRuinedCabin(b) {
  const { solid: s, rand, pal } = b;
  const w = 5.0 + rand() * 1.0, d = 4.0 + rand() * 0.6;
  const wood = shadeHex(mixHex(pal.wood, 0x6e6a5e, 0.35), pal.shade);
  const h = 2.1;
  foundation(s, w + 0.2, d + 0.2, 0.15, shadeHex(pal.stone, 0.9));
  logWall(s, 'x', w + 0.4, d / 2, 0.15, h, wood, { broken: 0.4, rand });
  logWall(s, 'z', d + 0.4, -w / 2, 0.15, h, wood, { broken: 0.25, rand });
  logWall(s, 'z', d + 0.4, w / 2, 0.15, h, wood, { broken: 0.6, rand });
  // front wall with the door gap
  const side = (w - 1.1) / 2;
  for (const sx of [-1, 1]) {
    const cx = sx * (1.1 / 2 + side / 2);
    for (let i = 0; i < 6; i++) {
      if (rand() < i * 0.12) continue;
      s.cyl(0.17, 0.17, side + 0.2, shadeHex(wood, i % 2 ? 0.95 : 1.04), { x: cx, y: 0.15 + 0.17 + i * 0.33, z: -d / 2, rz: Math.PI / 2, seg: 7 });
    }
  }
  // fallen roof: one slab still up, one collapsed against the wall
  const roofHex = mixHex(pal.roof, 0x6a6a52, 0.4);
  s.box(w + 0.6, 0.16, d * 0.62, roofHex, { x: 0, y: h + 0.55, z: d * 0.22, rx: 0.42 });
  s.box(w * 0.7, 0.16, d * 0.6, shadeHex(roofHex, 0.9), { x: -0.4, y: 0.9, z: -d * 0.2, rx: -0.9, rz: 0.15 });
  s.beam([-w / 2, h + 0.1, 0], [w / 2 * 0.3, 0.3, -d * 0.1], 0.18, wood); // fallen ridge beam
  if (pal.snow) s.box(w + 0.4, 0.1, d * 0.6, SNOW, { x: 0, y: h + 0.68, z: d * 0.22, rx: 0.42 });
  else mossOnRoof(s, w + 0.6, d * 1.2, 0.6, h + 0.1, rand, mossHex(pal), 8);
  // the broken door lying in the grass, brambles creeping in
  s.box(0.9, 0.07, 1.8, shadeHex(wood, 0.8), { x: 0.6, y: 0.06, z: -d / 2 - 1.3, ry: 0.4 });
  for (let i = 0; i < 7; i++) {
    const a = rand() * 6.28, r = Math.max(w, d) * (0.45 + rand() * 0.25);
    s.ball(0.4 + rand() * 0.4, rand() < 0.5 ? 0x4e7a34 : 0x5c8a3a, { x: Math.cos(a) * r, y: 0.25, z: Math.sin(a) * r, sy: 0.7, detail: 0 });
  }
  if (!pal.snow) for (let i = 0; i < 4; i++) fern(s, (rand() - 0.5) * (w - 1), 0.15, (rand() - 0.3) * (d - 1), 0.7, rand);
  // a rusted stove inside
  s.block(0.6, 0.7, 0.5, 0x5a4a40, { x: w / 2 - 0.8, y: 0.15, z: d / 2 - 0.7 });
  s.cyl(0.08, 0.08, 1.4, 0x5a4a40, { x: w / 2 - 0.8, y: 1.55, z: d / 2 - 0.7, seg: 6, rz: 0.25 });
  return {
    blockers: perimeterBlockers(w + 0.2, d + 0.2, { r: 0.4, gaps: [{ side: 'front', at: 0, width: 1.1 }] }),
    reach: Math.hypot(w, d) / 2 + 2,
  };
}

/** An abandoned research/ranger station: weathered planks, tin roof, boarded windows, a mast. */
export function buildAbandonedStation(b) {
  const { solid: s, rand, pal } = b;
  const w = 5.2 + rand() * 1.2, d = 4.2 + rand() * 0.8;
  const deck = 0.35, wallH = 2.4;
  const eave = deck + wallH, rise = 3.4 - eave;
  const plank = mixHex(shadeHex(pal.wood, pal.shade), 0x8c877c, 0.45);
  const seam = shadeHex(plank, 0.78);
  foundation(s, w + 0.2, d + 0.2, deck, pal.stone);
  plankWall(s, 'x', w, -d / 2, deck, wallH, plank, seam, { out: -1 });
  plankWall(s, 'x', w, d / 2, deck, wallH, plank, seam, { out: 1 });
  plankWall(s, 'z', d, -w / 2, deck, wallH, shadeHex(plank, 0.96), seam, { out: -1 });
  plankWall(s, 'z', d, w / 2, deck, wallH, shadeHex(plank, 0.96), seam, { out: 1 });
  // corrugated tin roof: ribbed slabs, one panel missing
  const tin = pal.key === 'whispering_coast' ? 0x8c8f8a : 0x8a6a52;
  const half = (d + 0.8) / 2, slope = Math.atan2(rise, half), len = Math.hypot(half, rise) + 0.1;
  const panels = 6, missing = Math.floor(rand() * panels);
  for (const side of [-1, 1]) {
    for (let i = 0; i < panels; i++) {
      if (side === 1 && i === missing) continue;
      const x = -(w + 0.6) / 2 + ((w + 0.6) / panels) * (i + 0.5);
      s.box((w + 0.6) / panels - 0.03, 0.08, len, i % 2 ? tin : shadeHex(tin, 0.9), { x, y: eave + rise / 2 + 0.05, z: side * half / 2, rx: side * slope });
    }
  }
  s.gable(w + 0.2, d, rise, eave, plank, { t: 0.02, inset: 0.15 });
  if (pal.snow) snowOnRoof(s, w + 0.6, d + 0.8, rise, eave, 0.1);
  doorFront(s, -w / 4, -d / 2, deck, 0.9, 1.9, shadeHex(plank, 0.85), seam, { open: rand() < 0.5 });
  windowOn(s, null, 'front', w / 4, -d / 2 - 0.1, deck + 1.4, 0.8, 0.7, seam, { boarded: plank });
  windowOn(s, null, 'left', 0, -w / 2 - 0.1, deck + 1.4, 0.8, 0.7, seam, { boarded: plank });
  windowOn(s, null, 'right', 0.3, w / 2 + 0.1, deck + 1.4, 0.8, 0.7, seam, { glass: 0x3a4248 });
  // rusted mast with a leaning anemometer
  const mx = w / 2 + 0.9, mz = d / 2 - 0.4;
  s.cyl(0.05, 0.08, 6, 0x7a5a44, { x: mx, y: 3, z: mz, seg: 5, rz: 0.04 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 6.28;
    s.beam([mx + 0.12, 6.0, mz], [mx + 0.12 + Math.cos(a) * 0.45, 6.05, mz + Math.sin(a) * 0.45], 0.03, IRON);
    s.ball(0.07, IRON, { x: mx + 0.12 + Math.cos(a) * 0.45, y: 6.05, z: mz + Math.sin(a) * 0.45, detail: 0 });
  }
  for (const [ax, az] of [[mx + 2, mz + 1.5], [mx - 0.5, mz + 2.2]]) s.beam([mx, 4.5, mz], [ax, 0, az], 0.02, IRON);
  // clutter
  barrel(s, -w / 2 - 0.5, 0, -d / 2 + 0.3, 0.3, 0.8, 0x6a5a4a);
  crate(s, -w / 2 - 0.55, 0, d / 2 - 0.4, 0.55, shadeHex(plank, 0.9), { ry: 0.4 });
  crate(s, -w / 2 - 0.4, 0.55, d / 2 - 0.4, 0.4, plank, { ry: 0.9 });
  s.block(w * 0.7, 0.12, 1.0, seam, { x: 0, y: deck - 0.12, z: -d / 2 - 0.5 });
  return {
    blockers: perimeterBlockers(w + 0.2, d + 0.2, { r: 0.45 }),
    reach: Math.hypot(w, d) / 2 + 3,
  };
}

// ---------------------------------------------------------------------------
// Finn's stall

export function buildShop(b) {
  const { solid: s, glow: g, rand, pal } = b;
  const w = 3.4 + rand() * 0.4, d = 2.0;
  const wood = shadeHex(pal.wood, pal.shade);
  const stripeA = 0x3f7a5a, stripeB = 0xf1e6c8;
  // counter at the front, back frame, posts
  s.block(w, 1.0, 0.6, wood, { x: 0, y: 0, z: -d / 2 + 0.3 });
  s.block(w + 0.1, 0.08, 0.75, shadeHex(wood, 1.12), { x: 0, y: 1.0, z: -d / 2 + 0.3 });
  for (let i = 0; i < 6; i++) s.block(0.03, 0.9, 0.02, shadeHex(wood, 0.8), { x: -w / 2 + (w / 6) * (i + 0.5), y: 0.05, z: -d / 2 - 0.01 });
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) {
    s.block(0.14, 2.35, 0.14, pal.dark, { x, y: 0, z: -d / 2 + 0.05 });
    s.block(0.14, 2.6, 0.14, pal.dark, { x, y: 0, z: d / 2 - 0.1 });
  }
  s.block(w, 0.1, 0.12, pal.dark, { x: 0, y: 2.5, z: d / 2 - 0.1 });
  s.block(w, 1.6, 0.08, shadeHex(wood, 0.9), { x: 0, y: 0.6, z: d / 2 - 0.05 }); // back board
  // shelves with stock on the back board
  for (const y of [1.0, 1.5]) {
    s.block(w - 0.4, 0.05, 0.3, shadeHex(wood, 1.1), { x: 0, y, z: d / 2 - 0.25 });
    for (let i = 0; i < 6; i++) {
      const col = [0x8a5a3a, 0x3f5f7a, 0x6a7a3a, 0xc9a24a, 0x7a3a3a][Math.floor(rand() * 5)];
      s.block(0.22, 0.18 + rand() * 0.12, 0.2, col, { x: -w / 2 + 0.45 + i * ((w - 0.9) / 5), y: y + 0.05, z: d / 2 - 0.25 });
    }
  }
  // striped awning sloping forward, with a scalloped edge
  const stripes = 7;
  for (let i = 0; i < stripes; i++) {
    const x = -w / 2 - 0.2 + ((w + 0.4) / stripes) * (i + 0.5);
    const hex = i % 2 ? stripeB : stripeA;
    s.box((w + 0.4) / stripes, 0.06, d + 0.9, hex, { x, y: 2.5, z: -0.2, rx: -0.22 });
    s.cone(0.18, 0.22, hex, { x, y: 2.15, z: -d / 2 - 0.62, rx: Math.PI, seg: 4 });
  }
  if (pal.snow) s.box(w + 0.3, 0.08, d + 0.8, SNOW, { x: 0, y: 2.57, z: -0.2, rx: -0.22 });
  // a sign board on top
  s.block(1.9, 0.45, 0.08, pal.trim, { x: 0, y: 2.62, z: d / 2 - 0.12 });
  s.block(2.0, 0.07, 0.1, pal.dark, { x: 0, y: 3.05, z: d / 2 - 0.12 });
  s.ball(0.12, 0x3f7a5a, { x: -0.6, y: 2.85, z: d / 2 - 0.18, detail: 0, sz: 0.3 }); // painted bird emblem
  s.cone(0.07, 0.12, 0xc9a24a, { x: -0.48, y: 2.86, z: d / 2 - 0.18, rz: -Math.PI / 2, seg: 4 });
  // hanging gear under the awning: binoculars, lanterns, rope coil, a hat
  const hangZ = -d / 2 + 0.1;
  const hang = (x, len) => s.beam([x, 2.3, hangZ], [x, 2.3 - len, hangZ], 0.015, ROPE);
  hang(-w / 2 + 0.6, 0.35);
  for (const dx of [-0.07, 0.07]) s.cyl(0.05, 0.05, 0.18, 0x2e2e2e, { x: -w / 2 + 0.6 + dx, y: 1.86, z: hangZ, seg: 7 });
  hang(w / 2 - 0.5, 0.3);
  lantern(s, g, w / 2 - 0.5, 1.85, hangZ, 0.15);
  hang(0.2, 0.25);
  s.cyl(0.22, 0.22, 0.08, ROPE, { x: 0.2, y: 1.95, z: hangZ, rx: Math.PI / 2, seg: 10 });
  hang(-0.6, 0.2);
  s.cyl(0.16, 0.24, 0.1, 0x7a6a3a, { x: -0.6, y: 2.0, z: hangZ, rx: 1.2, seg: 8 });
  // on the counter: a brass scale, a ledger, a pair of binoculars on display
  s.block(0.4, 0.06, 0.3, 0xe8dcc0, { x: -0.8, y: 1.08, z: -d / 2 + 0.3, ry: 0.2 });
  s.cyl(0.04, 0.06, 0.3, 0xc9a24a, { x: 0.9, y: 1.23, z: -d / 2 + 0.3 });
  s.cyl(0.14, 0.14, 0.03, 0xc9a24a, { x: 0.9, y: 1.38, z: -d / 2 + 0.3 });
  for (const dx of [-0.06, 0.06]) s.cyl(0.045, 0.045, 0.16, 0x2e2e2e, { x: 0.15 + dx, y: 1.13, z: -d / 2 + 0.3, rx: Math.PI / 2, seg: 7 });
  // crates and a barrel beside the stall
  crate(s, w / 2 + 0.55, 0, -0.3, 0.6, wood, { ry: 0.2 });
  crate(s, w / 2 + 0.5, 0.6, -0.25, 0.45, shadeHex(wood, 1.1), { ry: 0.7 });
  crate(s, w / 2 + 0.6, 0, 0.5, 0.55, shadeHex(wood, 0.92), { ry: -0.2 });
  barrel(s, -w / 2 - 0.5, 0, 0.2, 0.3, 0.8, shadeHex(wood, 0.95));
  s.ball(0.32, LEAF, { x: -w / 2 - 0.5, y: 0.95, z: 0.2, detail: 0, sy: 0.6 }); // a fern in the barrel
  const blockers = [];
  for (let x = -w / 2 + 0.3; x <= w / 2 - 0.3 + 1e-6; x += 0.55) blockers.push({ lx: x, lz: -d / 2 + 0.3, r: 0.4 });
  blockers.push({ lx: w / 2 + 0.55, lz: 0.1, r: 0.6 }, { lx: -w / 2 - 0.5, lz: 0.2, r: 0.4 });
  for (let x = -w / 2; x <= w / 2 + 1e-6; x += 0.6) blockers.push({ lx: x, lz: d / 2 - 0.05, r: 0.3 });
  return {
    blockers,
    interact: { lx: 0, ly: 1.2, lz: -d / 2 - 0.2 },
    reach: Math.hypot(w + 1.5, d) / 2 + 2,
  };
}

// ---------------------------------------------------------------------------
// Watchtower

export function buildWatchtower(b) {
  const { solid: s, rand, pal } = b;
  const T = towerLayout(b.poi.id);
  const { height: H, half } = T;
  const wood = shadeHex(mixHex(pal.wood, 0x7a7266, 0.2), pal.shade);
  const dark = pal.dark;
  const foot = half + T.splay;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  // legs, splayed at the foot; each leg reaches down to the actual ground below it
  for (const [sx, sz] of corners) {
    const gy = b.ground(sx * foot, sz * foot);
    s.beam([sx * foot, gy - 0.6, sz * foot], [sx * (half - 0.1), H, sz * (half - 0.1)], 0.24, dark);
    s.block(0.5, 0.35, 0.5, pal.stone, { x: sx * foot, y: gy - 0.2, z: sz * foot }); // footing stone
  }
  // cross braces on each face, two levels
  const lvl = [0.8, H * 0.45, H - 0.3];
  const at = (sx, sz, y) => {
    const t = y / H;
    const r = foot + (half - 0.1 - foot) * t;
    return [sx * r, y, sz * r];
  };
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
    for (let k = 0; k < 2; k++) {
      s.beam(at(ax, az, lvl[k]), at(bx, bz, lvl[k + 1]), 0.1, wood);
      s.beam(at(bx, bz, lvl[k]), at(ax, az, lvl[k + 1]), 0.1, shadeHex(wood, 0.92));
    }
    s.beam(at(ax, az, lvl[1]), at(bx, bz, lvl[1]), 0.12, wood);
  }
  // platform deck with joists, railing with a gap where the stair arrives (back)
  s.block(half * 2 + 0.3, 0.16, half * 2 + 0.3, shadeHex(wood, 1.08), { x: 0, y: H - 0.16, z: 0 });
  for (let i = -2; i <= 2; i++) s.block(0.12, 0.2, half * 2 + 0.3, dark, { x: i * (half / 2.2), y: H - 0.36, z: 0 });
  railing(s, -half - 0.1, half + 0.1, -half - 0.1, half + 0.1, H, wood, ['front', 'back', 'left', 'right'], { side: 'back', at: 0, width: 1.3 }, { h: 1.05 });
  // roof on four posts, peak at T.top (the perch height the world assumes)
  const roofY = H + 2.25;
  for (const [sx, sz] of corners) s.block(0.14, roofY - H, 0.14, dark, { x: sx * (half + 0.05), y: H, z: sz * (half + 0.05) });
  const rise = T.top - roofY - 0.18;
  s.gable(half * 2 + 0.8, half * 2 + 0.9, rise, roofY, pal.roof, { ends: false });
  if (pal.snow) snowOnRoof(s, half * 2 + 0.8, half * 2 + 0.9, rise, roofY, 0.18);
  else if (isWoods(pal)) mossOnRoof(s, half * 2 + 0.8, half * 2 + 0.9, rise, roofY, rand, mossHex(pal), 6);
  // stair: stringers, treads, handrails; a landing post at the bottom
  stairs(s, T.flight, 0, 1.1, shadeHex(wood, 1.04), { handrail: true });
  const zb = T.flight.ramp.z1;
  s.block(1.6, 0.12, 0.8, pal.stone, { x: 0, y: b.ground(0, zb + 0.2) - 0.06, z: zb + 0.3 });
  // a weathered bench up top and a rope-bound map board
  s.block(1.2, 0.07, 0.35, wood, { x: 0, y: H + 0.42, z: -half + 0.35 });
  for (const x of [-0.5, 0.5]) s.block(0.07, 0.42, 0.3, dark, { x, y: H, z: -half + 0.35 });
  const blockers = corners.map(([sx, sz]) => ({ lx: sx * foot, lz: sz * foot, r: 0.35 }));
  return {
    surfaces: T.surfaces,
    blockers,
    reach: Math.hypot(half, half + T.flight.run) + 2,
  };
}

// ---------------------------------------------------------------------------
// Field-lab tent

export function buildResearchSite(b) {
  const { solid: s, glow: g, rand, pal } = b;
  const w = 3.0 + rand() * 0.5, d = 4.0 + rand() * 0.6;
  const canvas = shadeHex(pal.canvas, 0.98 + rand() * 0.04);
  const wallH = 1.25, rise = 2.5 - wallH;
  // floor cloth, side and back walls; the front is open with flaps tied back
  s.block(w + 0.2, 0.04, d + 0.2, shadeHex(canvas, 0.7), { x: 0, y: 0, z: 0 });
  s.block(0.06, wallH, d, canvas, { x: -w / 2, y: 0, z: 0 });
  s.block(0.06, wallH, d, canvas, { x: w / 2, y: 0, z: 0 });
  s.block(w, wallH, 0.06, shadeHex(canvas, 0.95), { x: 0, y: 0, z: d / 2 });
  // the roof runs front to back: ridge along Z (rotate the gable by drawing slabs here)
  const halfW = w / 2 + 0.25;
  const slope = Math.atan2(rise, halfW), len = Math.hypot(halfW, rise) + 0.1;
  for (const side of [-1, 1]) {
    s.box(len, 0.05, d + 0.5, canvas, { x: side * halfW / 2, y: wallH + rise / 2, z: 0, rz: -side * slope });
  }
  if (pal.snow) for (const side of [-1, 1]) s.box(len * 0.9, 0.08, d + 0.3, SNOW, { x: side * halfW / 2, y: wallH + rise / 2 + 0.07, z: 0, rz: -side * slope });
  for (let i = 0; i < 3; i++) {
    const f = (i + 0.5) / 3;
    s.box(w * (1 - f), rise / 3, 0.05, shadeHex(canvas, 0.95), { x: 0, y: wallH + rise * f, z: d / 2 });
  }
  // ridge pole, uprights, flaps, guy ropes and pegs
  s.cyl(0.04, 0.04, d + 0.6, pal.dark, { x: 0, y: 2.5, z: 0, rx: Math.PI / 2, seg: 5 });
  for (const z of [-d / 2 - 0.1, d / 2 + 0.1]) s.block(0.08, 2.5, 0.08, pal.dark, { x: 0, y: 0, z });
  for (const sx of [-1, 1]) s.box(0.5, wallH + 0.8, 0.05, shadeHex(canvas, 0.92), { x: sx * (w / 2 - 0.1), y: (wallH + 0.8) / 2, z: -d / 2 - 0.15, ry: sx * 0.7 });
  for (const sx of [-1, 1]) {
    for (const z of [-d / 3, d / 3]) {
      s.beam([sx * (w / 2 + 0.2), wallH + 0.1, z], [sx * (w / 2 + 1.4), 0.05, z], 0.02, ROPE);
      s.block(0.05, 0.25, 0.05, pal.dark, { x: sx * (w / 2 + 1.4), y: -0.1, z });
    }
  }
  // inside: workbench with microscope, specimen jars, lamp
  s.block(w - 0.6, 0.06, 0.7, shadeHex(pal.wood, 1.1), { x: 0, y: 0.85, z: d / 2 - 0.55 });
  for (const x of [-w / 2 + 0.45, w / 2 - 0.45]) s.block(0.06, 0.85, 0.6, pal.dark, { x, y: 0, z: d / 2 - 0.55 });
  s.block(0.14, 0.05, 0.18, 0x2e2e2e, { x: 0.3, y: 0.91, z: d / 2 - 0.55 });
  s.beam([0.3, 0.95, d / 2 - 0.5], [0.3, 1.2, d / 2 - 0.62], 0.05, 0x2e2e2e);
  s.cyl(0.03, 0.04, 0.16, 0x2e2e2e, { x: 0.3, y: 1.2, z: d / 2 - 0.55, rx: 0.4, seg: 6 });
  for (let i = 0; i < 4; i++) {
    s.cyl(0.06, 0.06, 0.16, [0x9cc9a8, 0xc9b98a, 0xa8c4d4, 0xd4b4a8][i], { x: -0.8 + i * 0.18, y: 0.99, z: d / 2 - 0.45, seg: 6 });
    s.cyl(0.065, 0.065, 0.03, 0x7a5a3a, { x: -0.8 + i * 0.18, y: 1.08, z: d / 2 - 0.45, seg: 6 });
  }
  lantern(s, g, 0, 2.15, 0, 0.16);
  s.beam([0, 2.45, 0], [0, 2.25, 0], 0.015, IRON);
  // outside: a folding table with a notebook, crates, a tripod scope, a specimen board
  s.block(1.1, 0.05, 0.6, shadeHex(pal.wood, 1.15), { x: w / 2 + 0.9, y: 0.72, z: -d / 2 + 0.2 });
  for (const [x, z] of [[0.45, 0.22], [-0.45, 0.22], [0.45, -0.22], [-0.45, -0.22]]) s.block(0.04, 0.72, 0.04, pal.dark, { x: w / 2 + 0.9 + x, y: 0, z: -d / 2 + 0.2 + z });
  s.block(0.3, 0.03, 0.22, 0xe8dcc0, { x: w / 2 + 0.8, y: 0.77, z: -d / 2 + 0.2, ry: 0.3 });
  crate(s, -w / 2 - 0.55, 0, -d / 2 + 0.6, 0.55, pal.wood, { ry: 0.3 });
  crate(s, -w / 2 - 0.5, 0, -d / 2 + 1.25, 0.5, shadeHex(pal.wood, 1.1), { ry: -0.2 });
  const tx = w / 2 + 0.6, tz = -d / 2 - 1.0;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 6.28 + 0.4;
    s.beam([tx, 1.15, tz], [tx + Math.cos(a) * 0.4, 0, tz + Math.sin(a) * 0.4], 0.03, 0x3a3a3a);
  }
  s.cyl(0.05, 0.07, 0.5, 0x4a5a4a, { x: tx, y: 1.25, z: tz - 0.1, rx: 1.35, seg: 7 });
  s.block(0.9, 0.7, 0.05, 0x9a7a52, { x: -w / 2 - 0.2, y: 0.5, z: d / 2 + 0.4, ry: 0.4 });
  s.block(0.8, 0.6, 0.02, 0xefe6d0, { x: -w / 2 - 0.22, y: 0.55, z: d / 2 + 0.37, ry: 0.4 });
  const blockers = perimeterBlockers(w, d, { r: 0.35, gaps: [{ side: 'front', at: 0, width: w - 0.4 }] });
  blockers.push({ lx: -w / 2 - 0.55, lz: -d / 2 + 0.9, r: 0.55 });
  return { blockers, reach: Math.hypot(w + 3, d + 2) / 2 + 1 };
}

// ---------------------------------------------------------------------------
// Bird hide

export function buildHide(b) {
  const { solid: s, rand, pal } = b;
  const L = hideLayout(b.poi.id);
  const { w, d, floor, wallH, slitY } = L;
  const wood = shadeHex(mixHex(pal.wood, 0x6e6450, 0.3), pal.shade);
  const seam = shadeHex(wood, 0.8);
  // stilts down to the real ground, floor
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) {
    const x = sx * (w / 2 - 0.15), z = sz * (d / 2 - 0.15);
    const gy = b.ground(x, z);
    s.block(0.16, floor - gy + 0.6, 0.16, pal.dark, { x, y: gy - 0.6, z });
  }
  s.block(w, 0.1, d, shadeHex(wood, 1.06), { x: 0, y: floor - 0.1, z: 0 });
  // front wall (−Z) with the viewing slit; back wall with the door gap; side walls
  const slitH = 0.3;
  const yBot = floor, yTop = floor + wallH;
  const sy0 = floor + slitY - slitH / 2, sy1 = floor + slitY + slitH / 2;
  plankWall(s, 'x', w, -d / 2, yBot, sy0 - yBot, wood, seam, { out: -1 });
  const frontTop = yTop + 0.35; // shed roof: higher at the front so the slit looks out
  plankWall(s, 'x', w, -d / 2, sy1, frontTop - sy1, wood, seam, { out: -1 });
  s.block(w - 0.2, 0.05, 0.3, shadeHex(wood, 1.1), { x: 0, y: sy0 - 0.05, z: -d / 2 + 0.2 }); // elbow shelf
  const doorW = 1.1, side = (w - doorW) / 2;
  plankWall(s, 'x', side, d / 2, yBot, yTop - yBot, wood, seam, { out: 1, c: -(doorW / 2 + side / 2) });
  plankWall(s, 'x', side, d / 2, yBot, yTop - yBot, wood, seam, { out: 1, c: doorW / 2 + side / 2 });
  s.block(doorW, yTop - yBot - 1.95, 0.16, wood, { x: 0, y: yBot + 1.95, z: d / 2 });
  for (const sx of [-1, 1]) {
    s.block(0.16, wallH, d, shadeHex(wood, 0.96), { x: sx * w / 2, y: yBot, z: 0 });
    s.box(0.16, 0.35, d, shadeHex(wood, 0.96), { x: sx * w / 2, y: yTop + 0.17, z: -d / 4, sy: 1 });
  }
  // shed roof sloping to the back, with turf/grass camouflage
  const slope = Math.atan2(0.35, d + 0.6);
  s.box(w + 0.5, 0.14, d + 0.9, pal.roof, { x: 0, y: yTop + 0.25, z: 0, rx: -slope });
  if (pal.snow) s.box(w + 0.4, 0.14, d + 0.8, SNOW, { x: 0, y: yTop + 0.38, z: 0, rx: -slope });
  else {
    for (let i = 0; i < 9; i++) {
      const x = (rand() - 0.5) * (w + 0.2), z = (rand() - 0.5) * (d + 0.6);
      s.ball(0.3 + rand() * 0.25, rand() < 0.5 ? 0x7a8a46 : 0x8a9a52, { x, y: yTop + 0.38 - z * Math.tan(slope), z, sy: 0.45, detail: 0 });
    }
  }
  // bench inside facing the slit, a bird board on the wall
  s.block(w - 0.5, 0.06, 0.35, shadeHex(wood, 1.12), { x: 0, y: floor + 0.45, z: -d / 2 + 0.9 });
  for (const x of [-w / 2 + 0.4, w / 2 - 0.4]) s.block(0.07, 0.45, 0.3, seam, { x, y: floor, z: -d / 2 + 0.9 });
  s.block(0.8, 0.55, 0.02, 0xefe6d0, { x: w / 2 - 0.09, y: floor + 1.1, z: 0.3, ry: Math.PI / 2 });
  // access ramp at the back
  const ramp = L.surfaces[1];
  s.beam([0, floor - 0.05, ramp.z0], [0, -0.05, ramp.z1], 0.08, shadeHex(wood, 1.05), { w: 1.1, d: 0.08 });
  // reeds/grass tucked around the base for camouflage
  for (let i = 0; i < 6; i++) {
    const a = rand() * 6.28;
    const x = Math.cos(a) * (w / 2 + 0.6), z = Math.sin(a) * (d / 2 + 0.6);
    if (z > d / 2 - 0.2 && Math.abs(x) < 1) continue;
    reedClump(s, x, b.ground(x, z), z, rand, { h: 1.0, n: 4 });
  }
  return {
    surfaces: L.surfaces,
    blockers: perimeterBlockers(w, d, { r: 0.3, gaps: [{ side: 'back', at: 0, width: doorW }] }),
    reach: Math.hypot(w, d + 3) / 2 + 1,
  };
}

// ---------------------------------------------------------------------------
// Camp

export function buildCamp(b) {
  const { solid: s, rand, pal } = b;
  const old = !!b.poi.hidden;
  const canvas = old ? mixHex(pal.canvas, 0x8a8a74, 0.35) : pal.canvas;
  // A-frame tent, ridge along Z, opening to the front; peak 1.6 m
  const tw = 2.0, td = 2.4, th = 1.6;
  const tx = -1.2, tz = 0.6;
  const slope = Math.atan2(th, tw / 2), len = Math.hypot(tw / 2, th);
  const sag = old ? 0.25 : 0;
  for (const side of [-1, 1]) {
    s.box(len, 0.04, td, side === 1 ? canvas : shadeHex(canvas, 0.94), { x: tx + side * tw / 4, y: th / 2 - sag / 2, z: tz, rz: -side * (slope - (side === 1 ? sag : 0)) });
  }
  s.box(tw * 0.9, th * 0.9, 0.04, shadeHex(canvas, 0.85), { x: tx, y: th * 0.35, z: tz + td / 2, sx: 0.55 });
  s.cyl(0.03, 0.03, td + 0.4, pal.dark, { x: tx, y: th - sag, z: tz, rx: Math.PI / 2, seg: 5 });
  for (const z of [tz - td / 2 - 0.1, tz + td / 2 + 0.1]) s.block(0.05, th - sag, 0.05, pal.dark, { x: tx, y: 0, z });
  if (pal.snow) for (const side of [-1, 1]) s.box(len * 0.8, 0.06, td * 0.9, SNOW, { x: tx + side * tw / 4, y: th / 2 + 0.05, z: tz, rz: -side * slope });
  // fire ring: stones in a circle, charred logs, ash
  const fx = 0.9, fz = -0.6;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283;
    s.stone(0.17 + rand() * 0.06, pal.stone, { x: fx + Math.cos(a) * 0.55, y: b.ground(fx, fz) + 0.07, z: fz + Math.sin(a) * 0.55 });
  }
  s.cyl(0.42, 0.45, 0.04, 0x4a4440, { x: fx, y: b.ground(fx, fz) + 0.02, z: fz, seg: 9 });
  for (let i = 0; i < 3; i++) {
    const a = rand() * 3.14;
    s.cyl(0.06, 0.06, 0.7, 0x2e2622, { x: fx, y: b.ground(fx, fz) + 0.09 + i * 0.05, z: fz, rz: Math.PI / 2, ry: a, seg: 5 });
  }
  // log seats
  for (const [x, z, ry] of [[fx + 1.4, fz + 0.3, 1.4], [fx - 0.2, fz - 1.5, 0.1]]) {
    s.cyl(0.2, 0.2, 1.3, shadeHex(pal.wood, 1.08), { x, y: b.ground(x, z) + 0.18, z, rz: Math.PI / 2, ry, seg: 7 });
  }
  // cooking tripod with a pot, a pack, a lantern, a bedroll
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 6.28;
    s.beam([fx, 1.1, fz], [fx + Math.cos(a) * 0.55, 0, fz + Math.sin(a) * 0.55], 0.03, pal.dark);
  }
  s.cyl(0.16, 0.13, 0.2, old ? 0x5a4a40 : 0x3a3a3a, { x: fx, y: 0.65, z: fz, seg: 8 });
  s.beam([fx, 1.1, fz], [fx, 0.76, fz], 0.01, IRON);
  const px = tx + 1.2, pz = tz + 1.3;
  s.block(0.45, 0.55, 0.3, old ? 0x6a6448 : 0x5a6a3a, { x: px, y: 0, z: pz, ry: 0.3 });
  s.block(0.4, 0.2, 0.25, old ? 0x5a5440 : 0x4a5a32, { x: px, y: 0.55, z: pz - 0.05, ry: 0.3 });
  s.cyl(0.18, 0.18, 0.9, old ? 0x7a6450 : 0x8a3a2a, { x: tx, y: 0.2, z: tz - td / 2 - 0.3, rz: Math.PI / 2, seg: 8 });
  if (old) {
    // abandoned: weeds through the ring, a toppled crate, a scattered map case
    crate(s, 2.1, 0, 0.9, 0.5, mixHex(pal.wood, 0x7a7466, 0.4), { ry: 0.9 });
    for (let i = 0; i < 5; i++) s.ball(0.18 + rand() * 0.15, 0x5c8a3a, { x: fx + (rand() - 0.5) * 0.8, y: 0.1, z: fz + (rand() - 0.5) * 0.8, detail: 0, sy: 0.8 });
  } else {
    crate(s, 2.0, 0, 0.8, 0.5, pal.wood, { ry: 0.3 });
  }
  return {
    blockers: [{ lx: tx, lz: tz - 0.4, r: 0.8 }, { lx: tx, lz: tz + 0.6, r: 0.8 }],
    reach: 5,
  };
}

// ---------------------------------------------------------------------------
// Viewpoint and pond

export function buildViewpoint(b) {
  const { solid: s, rand, pal } = b;
  // the bench faces the view (local −Z); a cairn marks the spot
  bench(s, 0.6, b.ground(0.6, 0), 0, 0, shadeHex(pal.wood, pal.shade), { len: 1.6 });
  cairn(s, -1.4, b.ground(-1.4, 0.4), 0.4, 1.2 + rand() * 0.5, rand, pal.stone);
  for (let i = 0; i < 4; i++) {
    const a = rand() * 6.28, r = 2 + rand() * 1.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.6 + 0.8;
    s.stone(0.3 + rand() * 0.4, shadeHex(pal.stone, 0.9 + rand() * 0.2), { x, y: b.ground(x, z) + 0.1, z });
  }
  return { blockers: [{ lx: -1.4, lz: 0.4, r: 0.5 }], reach: 4 };
}

/**
 * Pond dressing: a ring of reeds where the ground meets the water (y = 0), a few
 * stones and a mossy log. The water itself is terrain + the world's water plane.
 * Needs the terrain under it; without it only the centre stones are placed and the
 * module rebuilds the prop once chunks load.
 */
export function buildPond(b) {
  const { solid: s, rand, pal } = b;
  const dirs = 20;
  let found = 0;
  for (let i = 0; i < dirs; i++) {
    const a = (i / dirs) * 6.283 + rand() * 0.2;
    const cos = Math.cos(a), sin = Math.sin(a);
    // march outwards until the ground rises above the water line
    let shore = -1;
    for (let r = 2; r <= 34; r += 0.75) {
      const wy = b.base + b.ground(r * cos, r * sin);
      if (wy > 0.05) { shore = r; break; }
    }
    if (shore < 0) continue;
    found++;
    const clumps = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < clumps; k++) {
      const r = shore - 0.4 + rand() * 1.4;
      const x = r * cos + (rand() - 0.5), z = r * sin + (rand() - 0.5);
      reedClump(s, x, Math.max(b.ground(x, z), -b.base - 0.1), z, rand, { tint: pal.key === 'amberwood' ? 0.4 : 0 });
    }
    if (rand() < 0.2) {
      const r = shore + 0.8;
      s.stone(0.3 + rand() * 0.3, pal.stone, { x: r * cos, y: b.ground(r * cos, r * sin) + 0.1, z: r * sin });
    }
  }
  b.complete = found > 0 && b.loaded;
  if (found > 0) {
    // a mossy log lying half in the water
    const a = rand() * 6.28;
    let r = 4;
    for (; r < 34; r += 1) if (b.base + b.ground(r * Math.cos(a), r * Math.sin(a)) > 0.05) break;
    const x = (r - 0.5) * Math.cos(a), z = (r - 0.5) * Math.sin(a);
    s.cyl(0.22, 0.26, 3.2, shadeHex(pal.wood, 0.9), { x, y: Math.max(b.ground(x, z), -b.base) + 0.1, z, rz: Math.PI / 2, ry: -a + 0.3, seg: 7 });
    s.ball(0.3, MOSS, { x, y: Math.max(b.ground(x, z), -b.base) + 0.3, z, sy: 0.4, detail: 0 });
  }
  return { reach: 36 };
}
