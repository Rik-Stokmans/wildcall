// Turns a parsed chunk into the vertex and index arrays of its terrain mesh.
// Pure: no three.js, no DOM (terrain.js wraps the result in a BufferGeometry).
//
// Layout: the N×N grid first (index = iz*N + ix), then four skirt strips of N
// vertices each (north, south, west, east). Positions are local to the chunk origin
// in X and Z — which keeps float32 vertex data exact however far from the world origin
// the chunk is — and absolute in Y.
import { CHUNK_SIZE } from './constants.js';
import { SRGB_TO_LINEAR } from './color.js';

/**
 * How far a chunk's skirt hangs below its border. Neighbouring chunks of different
 * LOD agree at shared vertices but the finer one has extra vertices in between, so
 * small cracks open along the border; a skirt of about one cell hides them.
 */
export function skirtDrop(cell) { return cell + 1; }

/**
 * @param {import('./chunkCodec.js').ChunkData} chunk
 * @param {(x:number, z:number) => number} [canopyAt]  tree cover at a world point, 0..1
 *        (baked per vertex for the terrain shader's shade; 0 everywhere without it)
 * @param {(x:number, z:number) => number} [regionAt]  region id at a world point (255 =
 *        unknown) for the soft region weights across chunk borders; the chunk's own grid
 *        is used where this is absent
 * @returns {{position:Float32Array, normal:Int8Array, color:Float32Array, canopy:Float32Array,
 *   regA:Float32Array, regB:Float32Array, index:Uint16Array, vertexCount:number, minY:number, maxY:number}}
 */
export function buildTerrainArrays(chunk, canopyAt, regionAt) {
  const { n, cell, heights, normals, colors } = chunk;
  const grid = n * n;
  const vertexCount = grid + 4 * n;
  const position = new Float32Array(vertexCount * 3);
  const normal = new Int8Array(vertexCount * 3);
  const color = new Float32Array(vertexCount * 3);
  const canopy = new Float32Array(vertexCount);
  const regA = new Float32Array(vertexCount * 3);
  const regB = new Float32Array(vertexCount * 2);
  const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cz * CHUNK_SIZE;
  regionWeights(chunk, regionAt, regA, regB);

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix, o = i * 3;
      position[o] = ix * cell;
      position[o + 1] = heights[i];
      position[o + 2] = iz * cell;
      normal[o] = normals[o]; normal[o + 1] = normals[o + 1]; normal[o + 2] = normals[o + 2];
      color[o] = SRGB_TO_LINEAR[colors[o]];
      color[o + 1] = SRGB_TO_LINEAR[colors[o + 1]];
      color[o + 2] = SRGB_TO_LINEAR[colors[o + 2]];
      if (canopyAt) {
        const c = canopyAt(x0 + ix * cell, z0 + iz * cell);
        canopy[i] = c > 0 ? (c < 1 ? c : 1) : 0;
      }
    }
  }

  // Skirt vertices copy their border vertex (same normal and colour, so the skirt is
  // shaded exactly like the ground it hangs from) and drop straight down.
  const drop = skirtDrop(cell);
  const last = n - 1;
  const north = grid, south = grid + n, west = grid + 2 * n, east = grid + 3 * n;
  const copy = (dst, src) => {
    const d = dst * 3, s = src * 3;
    position[d] = position[s]; position[d + 1] = position[s + 1] - drop; position[d + 2] = position[s + 2];
    normal[d] = normal[s]; normal[d + 1] = normal[s + 1]; normal[d + 2] = normal[s + 2];
    color[d] = color[s]; color[d + 1] = color[s + 1]; color[d + 2] = color[s + 2];
    canopy[dst] = canopy[src];
    regA[dst * 3] = regA[src * 3]; regA[dst * 3 + 1] = regA[src * 3 + 1]; regA[dst * 3 + 2] = regA[src * 3 + 2];
    regB[dst * 2] = regB[src * 2]; regB[dst * 2 + 1] = regB[src * 2 + 1];
  };
  for (let k = 0; k < n; k++) {
    copy(north + k, k);
    copy(south + k, last * n + k);
    copy(west + k, k * n);
    copy(east + k, k * n + last);
  }

  const index = new Uint16Array((last * last + 4 * last) * 6);
  let p = 0;
  for (let iz = 0; iz < last; iz++) {
    for (let ix = 0; ix < last; ix++) {
      const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
      // Split each cell along the diagonal with the smaller height difference: ridges
      // and gullies then run along triangle edges instead of being sawn across.
      if (Math.abs(heights[a] - heights[d]) <= Math.abs(heights[b] - heights[c])) {
        index[p++] = a; index[p++] = c; index[p++] = d;
        index[p++] = a; index[p++] = d; index[p++] = b;
      } else {
        index[p++] = a; index[p++] = c; index[p++] = b;
        index[p++] = b; index[p++] = c; index[p++] = d;
      }
    }
  }
  for (let k = 0; k < last; k++) {
    // Each wall faces away from the chunk.
    let t0 = k, t1 = k + 1, s0 = north + k, s1 = north + k + 1;            // north, faces -Z
    index[p++] = t0; index[p++] = t1; index[p++] = s0;
    index[p++] = t1; index[p++] = s1; index[p++] = s0;
    t0 = last * n + k; t1 = t0 + 1; s0 = south + k; s1 = south + k + 1;     // south, faces +Z
    index[p++] = t0; index[p++] = s0; index[p++] = t1;
    index[p++] = t1; index[p++] = s0; index[p++] = s1;
    t0 = k * n; t1 = (k + 1) * n; s0 = west + k; s1 = west + k + 1;         // west, faces -X
    index[p++] = t0; index[p++] = s0; index[p++] = t1;
    index[p++] = t1; index[p++] = s0; index[p++] = s1;
    t0 = k * n + last; t1 = (k + 1) * n + last; s0 = east + k; s1 = east + k + 1; // east, faces +X
    index[p++] = t0; index[p++] = t1; index[p++] = s0;
    index[p++] = t1; index[p++] = s1; index[p++] = s0;
  }

  return { position, normal, color, canopy, regA, regB, index, vertexCount, minY: chunk.minY - drop, maxY: chunk.maxY };
}

// Soft region weights: the terrain shader paints each region type's own ground detail
// (marsh mud and pools, highland strata and scree, coastal sand and tide line, amber
// leaf carpet, snow and ice), blended where region types meet. The chunk carries a hard
// region id per vertex; a small blur over neighbouring samples (across chunk borders
// through `regionAt`, so neighbours agree) turns it into weights that fade over ~20 m.
const BLUR = (() => {
  const o = [[0, 0, 2]];
  for (const [r, w] of [[5, 1], [12, 0.75]]) {
    for (let k = 0; k < 8; k++) {
      const a = (k + (r > 6 ? 0.5 : 0)) / 8 * Math.PI * 2;
      o.push([Math.cos(a) * r, Math.sin(a) * r, w]);
    }
  }
  return o;
})();

/**
 * Fills per-vertex region weights of a chunk's grid: regA = (marsh, highland, coast),
 * regB = (amber, frost); Greenhollow is what is left. Pure.
 */
export function regionWeights(chunk, regionAt, regA, regB) {
  const { n, cell, region } = chunk;
  const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cz * CHUNK_SIZE;
  const acc = [0, 0, 0, 0, 0, 0];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      acc.fill(0);
      let tot = 0;
      for (const [ox, oz, w] of BLUR) {
        const lx = ix * cell + ox, lz = iz * cell + oz;
        let r;
        if (lx >= 0 && lz >= 0 && lx <= CHUNK_SIZE && lz <= CHUNK_SIZE) {
          r = region[Math.round(lz / cell) * n + Math.round(lx / cell)];
          if (r === 255) r = 3; // open sea floor: coastal ground
        } else if (regionAt) {
          r = regionAt(x0 + lx, z0 + lz);
        } else {
          r = region[Math.min(n - 1, Math.max(0, Math.round(lz / cell))) * n + Math.min(n - 1, Math.max(0, Math.round(lx / cell)))];
        }
        if (!(r >= 0 && r < 6)) continue;
        acc[r] += w; tot += w;
      }
      const i = iz * n + ix;
      const k = tot > 0 ? 1 / tot : 0;
      regA[i * 3] = acc[1] * k; regA[i * 3 + 1] = acc[2] * k; regA[i * 3 + 2] = acc[3] * k;
      regB[i * 2] = acc[4] * k; regB[i * 2 + 1] = acc[5] * k;
    }
  }
}

/**
 * Bounding sphere of a chunk's contents in chunk-local coordinates.
 * @param {number} minY @param {number} maxY  vertical extent
 * @param {number} [reach]  how far content may overhang the chunk's footprint
 * @returns {{x:number, y:number, z:number, r:number}}
 */
export function chunkSphere(minY, maxY, reach = 0) {
  const half = CHUNK_SIZE / 2 + reach;
  const hy = (maxY - minY) / 2;
  return { x: CHUNK_SIZE / 2, y: (minY + maxY) / 2, z: CHUNK_SIZE / 2, r: Math.sqrt(2 * half * half + hy * hy) };
}
