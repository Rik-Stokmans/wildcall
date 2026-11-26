// Stylised nest models by site type (task c-field). Unit size: the outer diameter is
// 1 (an instance is scaled by the nest's `size`), the origin is the nest centre the
// server sends, and the front (a dome's or burrow's entrance, a ledge's drop) faces
// −Z, so rotation.y = −yaw turns it to the server's heading. The server lifts a nest
// centre above its perch by 0.3 × size for cups (so the cup's base sits on the limb),
// −0.6 for a pendant (hung under it), 0.15 on the ground and water, 0.2 on a ledge.
//
// Every site has three parts: the nest itself, eggs, and chicks (gaping, bobbing —
// aSway carries the bob weight); enclosed sites have a "peek" part instead: one
// hungry head at the entrance.
import * as THREE from 'three';
import { Geo, V, rng, lin, mixc, mulc, quatTo } from '../forage/geo.js';

const TAU = Math.PI * 2;
const COL = {
  twig: lin(0x6e5a42), twigDark: lin(0x4a3c2c), twigPale: lin(0x9a8466), grass: lin(0xa89466), grassDry: lin(0xc4b080),
  moss: lin(0x6e8a44), mossDark: lin(0x4a6230), lichen: lin(0xa8b49a), mud: lin(0x6a5038), lining: lin(0x8a6e4e),
  hole: lin(0x120c08), bark: lin(0x5a4a3c), earth: lin(0x7a5a3a), sand: lin(0xb89a6a), reed: lin(0xb8a46a),
  wet: lin(0x56602e), guano: lin(0xf0ece0), rock: lin(0x8a8680), down: lin(0xa89a8a), downLight: lin(0xd8d0c4),
  gape: lin(0xf2b23a), gapeIn: lin(0xe0602a), white: lin(0xf2eee6),
};

/** A ring of jittered twig/grass strands around a horizontal circle. */
function weave(g, R, y, r, n, col, { thick = 0.02, wobble = 0.08, sides = 3, colJ = 0.25 } = {}) {
  for (let i = 0; i < n; i++) {
    const a0 = R() * TAU, span = 0.6 + R() * 1.2;
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const a = a0 + span * (k / 4);
      const rr = r * (1 + (R() - 0.5) * wobble);
      pts.push(V(Math.cos(a) * rr, y + (R() - 0.5) * wobble * 0.6, Math.sin(a) * rr));
    }
    g.tube(pts, thick, thick * 0.7, mulc(col, 1 - colJ / 2 + R() * colJ), { sides });
  }
}

/** A lathed bowl: outer wall and darker inner hollow. */
function bowl(g, R, { r = 0.5, bottom = -0.3, top = 0.12, inner = 0.34, depth = 0.22, outer = COL.grass, lining = COL.lining, sides = 12 } = {}) {
  const h = top - bottom;
  g.lathe(V(0, bottom, 0), [[0.001, 0], [r * 0.55, h * 0.04], [r * 0.88, h * 0.3], [r, h * 0.68], [r * 0.96, h * 0.95], [inner * 1.08, h]], (p, n) => mixc(mulc(outer, 0.72), outer, 0.5 + 0.5 * n.y), { sides });
  g.lathe(V(0, top - depth, 0), [[0.001, 0], [inner * 0.7, depth * 0.25], [inner, depth * 0.85], [inner * 1.08, depth]], (p, n) => mulc(lining, 0.75 + 0.25 * Math.max(0, n.y)), { sides });
}

function eggs(g, R, n, col, { y = -0.06, spread = 0.16, size = 0.12, speckle = null } = {}) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + R() * 0.5, d = n > 1 ? spread * (0.6 + R() * 0.4) : 0;
    const p = V(Math.cos(a) * d, y, Math.sin(a) * d);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + (R() - 0.5) * 0.4, a, 0));
    g.ellipsoid(p, [size * 0.72, size, size * 0.72], q, col, { detail: 1, shade: 0.2 });
    if (speckle) for (let s = 0; s < 4; s++) g.sphere(p.clone().add(V((R() - 0.5) * size, size * 0.45, (R() - 0.5) * size)), size * 0.12, speckle, { detail: 0 });
  }
}

/** One chick: a downy ball with a gaping triangular mouth pointing up. */
function chick(g, R, p, s, { down = COL.down, light = COL.downLight, gape = true, up = V(0, 1, 0.25) } = {}) {
  const bob = 0.6 + R() * 0.4;
  g.sphere(p, s * 0.55, mixc(down, light, 0.3), { detail: 1, squash: 0.85, sway: bob * 0.4 });
  const head = p.clone().add(up.clone().normalize().multiplyScalar(s * 0.55));
  g.sphere(head, s * 0.36, light, { detail: 1, sway: bob });
  if (gape) {
    const dir = up.clone().normalize();
    // the two halves of the bill, wide open: bright yellow edges, orange inside
    g.cone(head.clone().add(dir.clone().multiplyScalar(s * 0.2)), s * 0.22, s * 0.32, COL.gapeIn, { sides: 6, quat: quatTo(dir), colorTop: COL.gape, sway: bob });
    g.cone(head.clone().add(dir.clone().multiplyScalar(s * 0.22)), s * 0.25, s * 0.06, COL.gape, { sides: 8, quat: quatTo(dir), sway: bob });
  }
}

function chicks(g, R, n, { y = -0.02, spread = 0.15, size = 0.26, down, light } = {}) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + R() * 0.4, d = n > 1 ? spread : 0;
    const p = V(Math.cos(a) * d, y, Math.sin(a) * d);
    chick(g, R, p, size * (0.85 + R() * 0.3), { down, light, up: V(-Math.cos(a) * 0.25, 1, -Math.sin(a) * 0.25) });
  }
}

/**
 * An entrance hole facing −Z on a surface at z = 0: a worn, paler rim standing a
 * little proud of the bark around a dark, slightly oval opening that darkens towards
 * its centre (drawn in front of the surface, so the trunk never hides it).
 */
function hole(g, R, r, { rim = COL.bark, rimW = 0.35, oval = 1.18 } = {}) {
  const q = quatTo(V(0, 0, -1));
  const sc = new THREE.Matrix4().makeScale(1, oval, 1);
  const tmp = new Geo();
  // the worn rim: a soft ring, paler where birds' feet and bellies have rubbed it
  tmp.lathe(V(0, 0, 0), [[r * (1 + rimW * 1.4), -0.004], [r * (1 + rimW), 0.03], [r * 1.02, 0.045], [r * 0.92, 0.03]],
    (p, n) => mixc(mulc(rim, 0.75), mixc(rim, lin(0xc8b494), 0.45), Math.max(0, Math.min(1, 0.4 + 0.6 * -n.z))), { sides: 16, quat: q });
  // the opening: deepest black in the middle
  tmp.lathe(V(0, 0, 0), [[0.0005, 0.036], [r * 0.5, 0.034], [r * 0.95, 0.032]], (p) => {
    const d = Math.hypot(p.x, p.y) / r;
    return mixc(lin(0x050302), lin(0x2e2218), Math.min(1, d * d));
  }, { sides: 16, quat: q });
  mergeInto(g, tmp, sc);
}

const BUILD = {
  cup_shrub(R) {
    const nest = new Geo();
    bowl(nest, R, { outer: mixc(COL.grass, COL.moss, 0.35), lining: COL.lining });
    weave(nest, R, 0.05, 0.47, 14, COL.grassDry, { thick: 0.018 });
    weave(nest, R, -0.1, 0.5, 10, COL.twig, { thick: 0.02 });
    for (let i = 0; i < 6; i++) nest.blob(V((R() - 0.5) * 0.8, -0.05 - R() * 0.15, (R() - 0.5) * 0.8).setLength(0.46), [0.09, 0.06, 0.09], COL.moss, COL.mossDark, { seed: R() * 1e5, detail: 0, lump: 0.3 });
    return { nest, eggs: (g, n) => eggs(g, R, n, lin(0x9cc4c0), { speckle: lin(0x5a3a2a) }), chicks: (g, n) => chicks(g, R, n, {}) };
  },
  cup_fork(R) {
    const nest = new Geo();
    bowl(nest, R, { outer: COL.twig, lining: COL.mud });
    weave(nest, R, 0.02, 0.48, 16, COL.twigPale, { thick: 0.02 });
    weave(nest, R, -0.14, 0.5, 12, COL.twigDark, { thick: 0.022 });
    // a few loose twigs sticking out
    for (let i = 0; i < 6; i++) {
      const a = R() * TAU;
      nest.tube([V(Math.cos(a) * 0.3, -0.12, Math.sin(a) * 0.3), V(Math.cos(a) * 0.72, -0.2 + R() * 0.1, Math.sin(a) * 0.72)], 0.014, 0.008, COL.twig, { sides: 3 });
    }
    return { nest, eggs: (g, n) => eggs(g, R, n, lin(0x7cc0d0), { speckle: lin(0x2a2020) }), chicks: (g, n) => chicks(g, R, n, {}) };
  },
  platform(R) {
    const nest = new Geo();
    nest.blob(V(0, -0.12, 0), [0.46, 0.16, 0.46], COL.twig, COL.twigDark, { seed: R() * 1e5, lump: 0.25, soft: 0.4 });
    for (let layer = 0; layer < 4; layer++) {
      const y = -0.26 + layer * 0.08, rr = 0.5 - layer * 0.04;
      for (let i = 0; i < 12; i++) {
        const a = R() * TAU, b = a + Math.PI * (0.5 + R() * 0.6);
        const p0 = V(Math.cos(a) * rr * (0.8 + R() * 0.4), y + (R() - 0.5) * 0.05, Math.sin(a) * rr * (0.8 + R() * 0.4));
        const p1 = V(Math.cos(b) * rr * (0.8 + R() * 0.5), y + (R() - 0.5) * 0.05, Math.sin(b) * rr * (0.8 + R() * 0.5));
        nest.tube([p0, p0.clone().lerp(p1, 0.5).add(V(0, 0.03, 0)), p1], 0.018, 0.012, mulc(R() < 0.5 ? COL.twig : COL.twigPale, 0.8 + R() * 0.3), { sides: 3 });
      }
    }
    nest.lathe(V(0, 0.0, 0), [[0.001, 0.0], [0.2, 0.01], [0.3, 0.05]], COL.grassDry, { sides: 10 });
    return { nest, eggs: (g, n) => eggs(g, R, n, lin(0xe8e2d0), { y: 0.04, size: 0.09, spread: 0.1, speckle: lin(0x8a5a3a) }), chicks: (g, n) => chicks(g, R, n, { y: 0.08, size: 0.2, spread: 0.12, down: lin(0xe8e4da), light: COL.white }) };
  },
  dome(R) {
    const nest = new Geo();
    nest.blob(V(0, 0, 0), [0.46, 0.5, 0.46], COL.moss, COL.mossDark, { seed: R() * 1e5, lump: 0.22, soft: 0.5 });
    weave(nest, R, -0.1, 0.46, 10, COL.grass, { thick: 0.016 });
    weave(nest, R, 0.18, 0.4, 8, COL.lichen, { thick: 0.014 });
    // the round side entrance
    const g2 = new Geo();
    hole(g2, R, 0.14, { rim: mixc(COL.moss, COL.grass, 0.5), rimW: 0.4, oval: 1 });
    mergeInto(nest, g2, new THREE.Matrix4().makeTranslation(0, 0.06, -0.44));
    return { nest, peek: (g) => chick(g, R, V(0, 0.06, -0.38), 0.2, { up: V(0, 0.25, -1) }) };
  },
  pendant(R) {
    const nest = new Geo();
    nest.lathe(V(0, -0.5, 0), [[0.001, 0], [0.18, 0.05], [0.36, 0.3], [0.45, 0.6], [0.44, 0.9], [0.3, 1.0]], (p, n) => mixc(COL.mossDark, mixc(COL.moss, COL.lichen, 0.5), 0.4 + 0.6 * Math.max(0, n.y + 0.5)), { sides: 12 });
    nest.lathe(V(0, 0.2, 0), [[0.001, 0], [0.22, 0.1], [0.3, 0.3]], COL.lining, { sides: 12 });
    weave(nest, R, 0.38, 0.42, 10, COL.lichen, { thick: 0.014 });
    // spider-silk slings to the twigs above
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + R() * 0.4;
      nest.tube([V(Math.cos(a) * 0.4, 0.45, Math.sin(a) * 0.4), V(Math.cos(a) * 0.2, 0.75, Math.sin(a) * 0.2)], 0.008, 0.006, COL.lichen, { sides: 3 });
    }
    return { nest, eggs: (g, n) => eggs(g, R, n, lin(0xf0e2d4), { y: 0.3, size: 0.1, spread: 0.1, speckle: lin(0x9a6a4a) }), chicks: (g, n) => chicks(g, R, n, { y: 0.38, size: 0.2, spread: 0.1 }) };
  },
  ground(R) {
    const nest = new Geo();
    nest.lathe(V(0, -0.16, 0), [[0.001, 0.0], [0.3, 0.02], [0.48, 0.1], [0.5, 0.17], [0.34, 0.2]], (p, n) => mixc(mulc(COL.grassDry, 0.7), COL.grassDry, 0.5 + 0.5 * n.y), { sides: 14 });
    nest.lathe(V(0, -0.04, 0), [[0.001, 0], [0.3, 0.06]], COL.lining, { sides: 12 });
    weave(nest, R, 0.0, 0.46, 18, COL.grass, { thick: 0.016, wobble: 0.14 });
    for (let i = 0; i < 5; i++) nest.blob(V((R() - 0.5) * 0.5, -0.0, (R() - 0.5) * 0.5).setLength(0.4), [0.06, 0.03, 0.04], COL.downLight, COL.down, { seed: R() * 1e5, detail: 0 });
    return { nest, eggs: (g, n) => eggs(g, R, n, lin(0xa8a070), { y: 0.02, speckle: lin(0x3a3020) }), chicks: (g, n) => chicks(g, R, n, { y: 0.06, down: lin(0x6a5a40), light: lin(0x9a8a6a) }) };
  },
  scrape(R) {
    const nest = new Geo();
    nest.lathe(V(0, -0.16, 0), [[0.001, 0.0], [0.3, 0.01], [0.48, 0.05], [0.56, 0.09]], (p, n) => mixc(mulc(COL.sand, 0.75), COL.sand, 0.5 + 0.5 * n.y), { sides: 14 });
    for (let i = 0; i < 14; i++) {
      const a = R() * TAU, d = 0.38 + R() * 0.18;
      nest.blob(V(Math.cos(a) * d, -0.09, Math.sin(a) * d), [0.05 + R() * 0.03, 0.03, 0.04 + R() * 0.03], mixc(COL.rock, COL.sand, R()), mulc(COL.rock, 0.7), { seed: R() * 1e5, detail: 0 });
    }
    for (let i = 0; i < 3; i++) nest.leaf(V((R() - 0.5) * 0.5, -0.1, (R() - 0.5) * 0.5), V(R() - 0.5, 0.2, R() - 0.5), 0.16, 0.05, COL.white, COL.downLight, { droop: 0.1 });
    return { nest, eggs: (g, n) => eggs(g, R, n, lin(0xb0a478), { y: -0.07, speckle: lin(0x2a2418) }), chicks: (g, n) => chicks(g, R, n, { y: -0.03, down: lin(0x8a7a5a), light: lin(0xb0a07a) }) };
  },
  reed(R) {
    const nest = new Geo();
    bowl(nest, R, { r: 0.42, bottom: -0.34, top: 0.14, inner: 0.28, depth: 0.22, outer: mixc(COL.reed, COL.grass, 0.4), lining: COL.lining });
    weave(nest, R, -0.05, 0.42, 16, COL.reed, { thick: 0.014, wobble: 0.1 });
    // the reed stems it is woven around
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.3;
      nest.tube([V(Math.cos(a) * 0.36, -1.6, Math.sin(a) * 0.36), V(Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38), V(Math.cos(a) * 0.42, 1.8, Math.sin(a) * 0.42)], 0.03, 0.02, COL.reed, { sides: 4 });
    }
    return { nest, eggs: (g, n) => eggs(g, R, n, lin(0xc0c6a4), { speckle: lin(0x4a5030) }), chicks: (g, n) => chicks(g, R, n, {}) };
  },
  floating(R) {
    const nest = new Geo();
    nest.blob(V(0, -0.1, 0), [0.52, 0.14, 0.5], COL.wet, mulc(COL.wet, 0.6), { seed: R() * 1e5, lump: 0.25, soft: 0.4, flatBottom: true });
    weave(nest, R, -0.02, 0.48, 18, mixc(COL.reed, COL.wet, 0.4), { thick: 0.02, wobble: 0.15 });
    nest.lathe(V(0, -0.02, 0), [[0.001, 0], [0.28, 0.06]], COL.reed, { sides: 12 });
    return { nest, eggs: (g, n) => eggs(g, R, n, lin(0xd0c4a0), { y: 0.02, speckle: lin(0x6a4a30) }), chicks: (g, n) => chicks(g, R, n, { y: 0.06, down: lin(0x2a2a2a), light: lin(0x4a4a4a) }) };
  },
  burrow(R) {
    const nest = new Geo();
    // a low earthen bank swelling out of the ground, grassy on top, with the hole in
    // its face and the spoil the bird has kicked out spilling below it
    nest.blob(V(0, -0.45, 0.6), [1.5, 0.7, 0.9], lin(0x6e7a40), COL.earth, { seed: R() * 1e5, lump: 0.22, soft: 0.35, flatBottom: true });
    nest.blob(V(0, -0.6, -0.55), [0.65, 0.16, 0.5], COL.sand, mulc(COL.earth, 0.85), { seed: R() * 1e5, lump: 0.3, soft: 0.3, flatBottom: true });
    for (let i = 0; i < 5; i++) nest.blob(V((R() - 0.5) * 1.2, -0.62, -0.5 - R() * 0.5), [0.07, 0.05, 0.06], COL.sand, COL.earth, { seed: R() * 1e5, detail: 0 });
    const g2 = new Geo();
    hole(g2, R, 0.3, { rim: COL.earth, rimW: 0.25, oval: 0.85 });
    mergeInto(nest, g2, new THREE.Matrix4().makeTranslation(0, 0, -0.5));
    return { nest, peek: (g) => chick(g, R, V(0, 0.0, -0.44), 0.22, { up: V(0, 0.2, -1) }) };
  },
  ledge(R) {
    const nest = new Geo();
    nest.blob(V(0, -0.2, 0.05), [0.6, 0.1, 0.5], mixc(COL.rock, COL.guano, 0.5), COL.rock, { seed: R() * 1e5, lump: 0.25, soft: 0.3, flatBottom: true });
    weave(nest, R, -0.1, 0.36, 12, lin(0x5a6a3a), { thick: 0.02, wobble: 0.2 });
    nest.lathe(V(0, -0.12, 0), [[0.001, 0], [0.3, 0.04]], COL.grassDry, { sides: 10 });
    // whitewash splashed around the nest: the mark of a seabird ledge
    for (let i = 0; i < 9; i++) {
      const a = R() * TAU, d = 0.5 + R() * 0.45;
      nest.blob(V(Math.cos(a) * d, -0.24, Math.sin(a) * d), [0.1 + R() * 0.12, 0.012, 0.08 + R() * 0.1], COL.guano, mixc(COL.guano, COL.rock, 0.4), { seed: R() * 1e5, detail: 0, lump: 0.4, soft: 0.2 });
    }
    return { nest, eggs: (g, n) => eggs(g, R, n, lin(0xd8d4c4), { y: -0.07, size: 0.14, speckle: lin(0x6a5a4a) }), chicks: (g, n) => chicks(g, R, n, { y: -0.03, size: 0.24, down: lin(0x5a5a5a), light: lin(0x8a8a8a) }) };
  },
  cavity(R) {
    const nest = new Geo();
    hole(nest, R, 0.3, { rim: COL.bark, rimW: 0.3 });
    return { nest, peek: (g) => chick(g, R, V(0, -0.04, 0.02), 0.32, { up: V(0, 0.35, -1) }) };
  },
};

function mergeInto(dst, src, m) {
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
  for (let i = 0; i < src.pos.length; i += 3) {
    v.set(src.pos[i], src.pos[i + 1], src.pos[i + 2]).applyMatrix4(m);
    dst.pos.push(v.x, v.y, v.z);
    v.set(src.nrm[i], src.nrm[i + 1], src.nrm[i + 2]).applyMatrix3(nm).normalize();
    dst.nrm.push(v.x, v.y, v.z);
  }
  dst.col.push(...src.col); dst.sway.push(...src.sway); dst.uv.push(...src.uv); dst.card.push(...src.card); dst.leafw.push(...src.leafw);
}

/**
 * Builds the parts of a site model.
 * @returns {{nest: THREE.BufferGeometry, eggs: THREE.BufferGeometry[], chicks: THREE.BufferGeometry[], peek: THREE.BufferGeometry|null}}
 *   eggs[n] / chicks[n] hold n eggs / chicks (index 0 unused)
 */
export function buildNest(site) {
  const build = BUILD[site] || BUILD.cup_shrub;
  const R = rng(site.length * 7919 + site.charCodeAt(0) * 31);
  const parts = build(R);
  const out = { nest: parts.nest.build(), eggs: [], chicks: [], peek: null };
  for (let n = 1; n <= 5; n++) {
    if (parts.eggs) { const g = new Geo(); parts.eggs(g, n); out.eggs[n] = g.build(); }
    if (parts.chicks) { const g = new Geo(); parts.chicks(g, n); out.chicks[n] = g.build(); }
  }
  if (parts.peek) { const g = new Geo(); parts.peek(g); out.peek = g.build(); }
  return out;
}

export const SITE_MODELS = Object.keys(BUILD);
