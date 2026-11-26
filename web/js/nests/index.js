// c-field: nests in the world (docs/contract.md §11). Every nest the server lists in
// its `nests` message (all nests within ~200 m, full list each time) is drawn by site
// type — a stick platform, a grass cup in a fork or a shrub, a mossy dome, a lichen
// pendant, a hole in a trunk, a reed-woven cup, a floating mound, a bank burrow, a
// ledge with its guano streak — at its position and heading, with eggs or gaping
// chicks in open nests at those stages. The owner species is never known here.
//
// Public API (ctx.nests):
//   list            the current nests [{id, site, stage, x, y, z, size, yaw}]
//   get(id)         one of them, or undefined
//   journalSection(env) → {left, right}   the journal's Nests list
//   debugView(idOrSite|null, dist?)       harness only: hold the camera on a nest
//   debug           counts
import * as THREE from 'three';
import { buildNest } from './models.js';
import { parseNests, contentsOf, clutchSize, nestHash, cavityOnTrunk, distToSegment, treeToWorld, TREE_KINDS, STAGE, headingDir } from './sites.js';
import { renderNestJournal } from './journal.js';

const CAVITY_RETRY = 2; // seconds between attempts to seat unresolved cavities on a trunk

function bobPatch(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'attribute float aSway;\nuniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
vec3 transformed = vec3(position);
#ifdef USE_INSTANCING
  float ph = dot(instanceMatrix[3].xz, vec2(1.7, 2.3));
  // hungry chicks: heads stretch up and down, each nest in its own rhythm
  transformed.y += aSway * 0.05 * max(0.0, sin(uTime * 7.0 + ph + position.x * 9.0));
#endif
`);
  };
  material.customProgramCacheKey = () => 'nest-bob';
}

export default {
  name: 'nests',

  init(ctx) {
    const { scene, state, bus } = ctx;
    const root = new THREE.Group();
    root.name = 'nests';
    scene.add(root);
    const uniforms = { uTime: { value: 0 } };
    const nestMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const liveMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    bobPatch(liveMat, uniforms);

    const models = new Map();
    const model = (site) => { if (!models.has(site)) models.set(site, buildNest(site)); return models.get(site); };
    const meshes = new Map();
    let nests = [];
    const byId = new Map();
    const seat = new Map(); // nest id → {x, y, z, rotY} where it was seated (cavities on trunks)
    let dirty = false;
    let retry = 0;
    let treeIndex = null;
    let debugTarget = null;
    const origin = { x: 0, z: 0 };

    function trees() {
      if (treeIndex) return treeIndex;
      const list = state.welcome?.trees;
      if (!list?.length) return null;
      treeIndex = new Map();
      for (const m of list) treeIndex.set(m.kind * 8 + m.variant, m);
      return treeIndex;
    }

    /** The trunk or limb under a cavity nest, if its tree is in loaded vegetation. */
    function seatCavity(n) {
      const idx = trees();
      const world = ctx.world;
      if (!idx || !world?.vegOf) return null;
      const size = world.chunkSize || 64;
      const pcx = Math.floor(n.x / size), pcz = Math.floor(n.z / size);
      let best = null, bd = Infinity;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          let list = null;
          try { list = world.vegOf(pcx + dx, pcz + dz); } catch { list = null; }
          if (!list) continue;
          for (const v of list) {
            if (!TREE_KINDS.includes(v.kind)) continue;
            if (Math.abs(v.x - n.x) > 4 || Math.abs(v.z - n.z) > 4) continue;
            const m = idx.get(v.kind * 8 + (v.variant % 6));
            if (!m) continue;
            for (const br of m.branches) {
              const a = treeToWorld(br.a, v), b = treeToWorld(br.b, v);
              const d = distToSegment(n, a, b) - Math.max(br.ra, br.rb) * v.scale;
              if (d < bd) { bd = d; best = { a, b, ra: br.ra * v.scale, rb: br.rb * v.scale }; }
            }
          }
        }
      }
      if (!best || bd > 0.35) return null;
      const c = cavityOnTrunk(n, best.a, best.b, best.ra, best.rb, n.yaw);
      if (!c) return null;
      const yaw = Math.atan2(c.nx, -c.nz);
      return { x: c.x + c.nx * 0.004, y: c.y, z: c.z + c.nz * 0.004, rotY: -yaw, ok: true };
    }

    function placement(n) {
      if (n.site === 'cavity') {
        const s = seat.get(n.id);
        if (s?.ok) return s;
        const found = seatCavity(n);
        if (found) { seat.set(n.id, found); return found; }
      }
      return { x: n.x, y: n.y, z: n.z, rotY: -n.yaw, ok: false };
    }

    function meshFor(key, geom, mat, need) {
      let m = meshes.get(key);
      if (m && m.instanceMatrix.count < need) { root.remove(m); m.dispose(); m = null; }
      if (!m) {
        let cap = 8;
        while (cap < need) cap *= 2;
        m = new THREE.InstancedMesh(geom, mat, cap);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        m.receiveShadow = true;
        m.name = 'nest:' + key;
        meshes.set(key, m);
        root.add(m);
      }
      return m;
    }

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p3 = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color();
    const Y = new THREE.Vector3(0, 1, 0);

    function rebuild() {
      dirty = false;
      const f = ctx.player?.feet || ctx.camera.position;
      origin.x = Math.round(f.x / 64) * 64; origin.z = Math.round(f.z / 64) * 64;
      root.position.set(origin.x, 0, origin.z);
      const groups = new Map();
      const add = (key, geom, mat, n, pl, tint, sy = 1) => {
        if (!geom) return;
        let g = groups.get(key);
        if (!g) { g = { geom, mat, list: [] }; groups.set(key, g); }
        g.list.push({ n, pl, tint, sy });
      };
      let unresolved = 0;
      for (const n of nests) {
        const md = model(n.site);
        const pl = placement(n);
        if (n.site === 'cavity' && !pl.ok) unresolved++;
        // old nests are weathered and sagging; new ones fresh and not yet full height
        // old nests are weathered: bleached and greyed rather than darker
        const tint = n.stage === STAGE.OLD ? [1.18, 1.14, 1.08] : n.stage === STAGE.BUILDING ? [1.08, 1.06, 0.98] : [1, 1, 1];
        const sy = n.stage === STAGE.OLD && n.site !== 'cavity' && n.site !== 'burrow' ? 0.82 : n.stage === STAGE.BUILDING && n.site !== 'cavity' && n.site !== 'burrow' ? 0.72 : 1;
        add('n|' + n.site, md.nest, nestMat, n, pl, tint, sy);
        const what = contentsOf(n.site, n.stage);
        const count = Math.max(1, Math.min(5, clutchSize(n.id, n.site)));
        if (what === 'eggs') add(`e|${n.site}|${count}`, md.eggs[count], liveMat, n, pl, [1, 1, 1]);
        else if (what === 'chicks') add(`c|${n.site}|${count}`, md.chicks[count], liveMat, n, pl, [1, 1, 1]);
        else if (what === 'peek') add('p|' + n.site, md.peek, liveMat, n, pl, [1, 1, 1]);
      }
      for (const [key, m] of meshes) if (!groups.has(key)) m.count = 0;
      for (const [key, g] of groups) {
        const m = meshFor(key, g.geom, g.mat, g.list.length);
        let i = 0;
        for (const { n, pl, tint, sy } of g.list) {
          q.setFromAxisAngle(Y, pl.rotY);
          p3.set(pl.x - origin.x, pl.y, pl.z - origin.z);
          s3.set(n.size, n.size * sy, n.size);
          m4.compose(p3, q, s3);
          m.setMatrixAt(i, m4);
          const k = 0.94 + nestHash(n.id, 3) * 0.12;
          col.setRGB(tint[0] * k, tint[1] * k, tint[2] * k);
          m.setColorAt(i, col);
          i++;
        }
        m.count = i;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.computeBoundingSphere();
      }
      retry = unresolved ? CAVITY_RETRY : 0;
    }

    bus.on('net:nests', (msg) => {
      const list = parseNests(msg);
      const sig = list.map((n) => `${n.id}:${n.stage}`).join(',');
      const old = nests.map((n) => `${n.id}:${n.stage}`).join(',');
      nests = list;
      byId.clear();
      for (const n of list) byId.set(n.id, n);
      for (const id of [...seat.keys()]) if (!byId.has(id)) seat.delete(id);
      if (sig !== old) dirty = true;
    });
    bus.on('welcome', () => { treeIndex = null; seat.clear(); nests = []; dirty = true; });
    bus.on('world:chunk', () => { if (retry > 0) retry = Math.min(retry, 0.3); });

    ctx.nests = {
      root,
      get list() { return nests; },
      get: (id) => byId.get(Number(id)),
      journalSection: (env) => renderNestJournal(env),
      /** Harness only: holds the camera `dist` metres in front of a nest (by id or site), or releases it (null). */
      debugView(target, dist, stage) {
        if (target == null) { debugTarget = null; return null; }
        const f = ctx.player?.feet || ctx.camera.position;
        const pool = nests.filter((n) => (typeof target === 'number' ? n.id === target : n.site === target) && (stage == null || n.stage === Number(stage)));
        pool.sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z));
        const n = pool[0];
        debugTarget = n ? { id: n.id, dist } : null;
        return n ? { id: n.id, site: n.site, stage: n.stage, size: n.size, seated: placement(n).ok } : null;
      },
      get debug() {
        let inst = 0;
        for (const m of meshes.values()) inst += m.count;
        return { nests: nests.length, meshes: meshes.size, instances: inst, cavitiesSeated: [...seat.values()].filter((s) => s.ok).length };
      },
    };

    this._frame = (dt) => {
      uniforms.uTime.value = ctx.time;
      if (retry > 0) { retry -= dt; if (retry <= 0) dirty = true; }
      if (dirty) rebuild();
    };
    this._late = () => {
      if (!debugTarget) return;
      const n = byId.get(debugTarget.id);
      if (!n) return;
      const pl = placement(n);
      const front = n.site === 'cavity' || n.site === 'burrow' || n.site === 'dome' || n.site === 'ledge';
      const h = front ? headingDir(-pl.rotY) : headingDir(-pl.rotY + 0.6);
      const d = debugTarget.dist || Math.max(0.7, n.size * 5);
      const ground = n.site === 'ground' || n.site === 'scrape' || n.site === 'floating';
      const up = front ? 0.15 : ground ? 1.4 : 0.55;
      const cam = ctx.camera;
      cam.position.set(pl.x + h.x * d, pl.y + d * up + (n.site === 'pendant' ? -0.2 : 0), pl.z + h.z * d);
      cam.lookAt(pl.x, pl.y, pl.z);
    };
  },

  update(dt) { this._frame?.(dt); },
  lateUpdate() { this._late?.(); },
};
