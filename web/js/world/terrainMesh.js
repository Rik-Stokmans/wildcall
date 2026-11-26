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
 * @returns {{position:Float32Array, normal:Int8Array, color:Float32Array, canopy:Float32Array,
 *   index:Uint16Array, vertexCount:number, minY:number, maxY:number}}
 */
export function buildTerrainArrays(chunk, canopyAt) {
  const { n, cell, heights, normals, colors } = chunk;
  const grid = n * n;
  const vertexCount = grid + 4 * n;
  const position = new Float32Array(vertexCount * 3);
  const normal = new Int8Array(vertexCount * 3);
  const color = new Float32Array(vertexCount * 3);
  const canopy = new Float32Array(vertexCount);
  const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cz * CHUNK_SIZE;

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

  return { position, normal, color, canopy, index, vertexCount, minY: chunk.minY - drop, maxY: chunk.maxY };
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
