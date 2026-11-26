// Binary chunk frames (docs/contract.md §2.3, format version 2). Pure: no three.js, no DOM.
//
//   offset size  field
//   0      4     magic 'W','C','H','K'
//   4      1     version = 2
//   5      1     lod
//   6      2     N (uint16)
//   8      4     cx (int32)
//   12     4     cz (int32)
//   16     N*N*4 heights  float32, row-major: index = iz*N + ix
//   …      N*N*3 normals  int8 ×3, (x,y,z) * 127
//   …      N*N*3 colors   uint8 ×3, sRGB
//   …      N*N   region   uint8 (255 = open water)
//   …      N*N   habitat  uint8
//   …      pad to a multiple of 4 bytes from the start of the frame
//   …      4     vegCount (uint32)
//   …      vegCount*20   kind u8, variant u8, rot u16, x f32, y f32, z f32, scale f32
//
// Everything is little endian. Frames are read through a DataView so the result does
// not depend on the byte order of the machine.
import { CHUNK_SIZE, MAX_LOD, cellSize, gridSize, vegVisibleAtLod, VEG_KIND_COUNT } from './constants.js';

export const CHUNK_MAGIC = 0x4b484357; // 'WCHK' read as a little-endian uint32
export const CHUNK_VERSION = 2;
export const HEADER_BYTES = 16;
export const VEG_BYTES = 20;
const TWO_PI = Math.PI * 2;

/**
 * @typedef {object} ChunkData
 * @property {number} cx        signed chunk coordinate
 * @property {number} cz
 * @property {number} lod       0..2
 * @property {number} n         vertices per side
 * @property {number} cell      metres between vertices
 * @property {Float32Array} heights  n*n, row-major (iz*n + ix)
 * @property {Int8Array} normals     n*n*3, components * 127
 * @property {Uint8Array} colors     n*n*3, sRGB
 * @property {Uint8Array} region     n*n
 * @property {Uint8Array} habitat    n*n
 * @property {number} minY     lowest height in the chunk
 * @property {number} maxY     highest height in the chunk
 * @property {VegData} veg
 *
 * @typedef {object} VegData  structure-of-arrays vegetation instances
 * @property {number} count
 * @property {Uint8Array} kind
 * @property {Uint8Array} variant
 * @property {Float32Array} rot    radians about Y
 * @property {Float32Array} x      world position
 * @property {Float32Array} y
 * @property {Float32Array} z
 * @property {Float32Array} scale
 */

/** Byte offsets of every section of a frame with N vertices per side. */
export function chunkLayout(n) {
  const nn = n * n;
  const heights = HEADER_BYTES;
  const normals = heights + nn * 4;
  const colors = normals + nn * 3;
  const region = colors + nn * 3;
  const habitat = region + nn;
  const vegCount = (habitat + nn + 3) & ~3; // padded to a multiple of 4
  return { heights, normals, colors, region, habitat, vegCount, veg: vegCount + 4 };
}

/**
 * Reads only the header of a frame. Returns null when the buffer is not a version-2
 * chunk frame (cheap enough to call before deciding whether a chunk is still wanted).
 * @param {ArrayBuffer} buf
 * @returns {{cx:number, cz:number, lod:number, n:number} | null}
 */
export function peekChunkHeader(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEADER_BYTES) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== CHUNK_MAGIC || dv.getUint8(4) !== CHUNK_VERSION) return null;
  const lod = dv.getUint8(5);
  const n = dv.getUint16(6, true);
  if (lod > MAX_LOD || n !== gridSize(lod)) return null;
  return { cx: dv.getInt32(8, true), cz: dv.getInt32(12, true), lod, n };
}

/**
 * Parses a chunk frame into typed arrays that own their memory (the frame can be
 * garbage-collected afterwards).
 * @param {ArrayBuffer} buf
 * @returns {ChunkData}
 * @throws {Error} on a malformed frame; the message says what is wrong
 */
export function parseChunk(buf) {
  if (!(buf instanceof ArrayBuffer)) throw new Error('chunk: not an ArrayBuffer');
  if (buf.byteLength < HEADER_BYTES) throw new Error(`chunk: frame too short (${buf.byteLength} bytes)`);
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== CHUNK_MAGIC) throw new Error('chunk: bad magic');
  const version = dv.getUint8(4);
  if (version !== CHUNK_VERSION) throw new Error(`chunk: unsupported version ${version}`);
  const lod = dv.getUint8(5);
  if (lod > MAX_LOD) throw new Error(`chunk: unsupported lod ${lod}`);
  const n = dv.getUint16(6, true);
  if (n !== gridSize(lod)) throw new Error(`chunk: grid size ${n} does not match lod ${lod}`);
  const cx = dv.getInt32(8, true);
  const cz = dv.getInt32(12, true);
  const nn = n * n;
  const at = chunkLayout(n);
  if (buf.byteLength < at.veg) throw new Error(`chunk: truncated grid (${buf.byteLength} < ${at.veg} bytes)`);

  const heights = new Float32Array(nn);
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0, o = at.heights; i < nn; i++, o += 4) {
    const h = dv.getFloat32(o, true);
    heights[i] = h;
    if (h < minY) minY = h;
    if (h > maxY) maxY = h;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) throw new Error('chunk: non-finite height');
  // Byte-sized fields have no endianness; slice() copies them out of the frame.
  const normals = new Int8Array(buf.slice(at.normals, at.normals + nn * 3));
  const colors = new Uint8Array(buf.slice(at.colors, at.colors + nn * 3));
  const region = new Uint8Array(buf.slice(at.region, at.region + nn));
  const habitat = new Uint8Array(buf.slice(at.habitat, at.habitat + nn));

  const count = dv.getUint32(at.vegCount, true);
  if (buf.byteLength < at.veg + count * VEG_BYTES) {
    throw new Error(`chunk: truncated vegetation (${count} instances do not fit in ${buf.byteLength} bytes)`);
  }
  const veg = allocVeg(count);
  let kept = 0;
  for (let i = 0, o = at.veg; i < count; i++, o += VEG_BYTES) {
    const kind = dv.getUint8(o);
    const x = dv.getFloat32(o + 4, true);
    const y = dv.getFloat32(o + 8, true);
    const z = dv.getFloat32(o + 12, true);
    const scale = dv.getFloat32(o + 16, true);
    // A newer server may append kinds this client cannot draw; skip those (and any
    // record that would poison the instance matrices) instead of failing the chunk.
    if (kind >= VEG_KIND_COUNT || !(scale > 0) || !Number.isFinite(x + y + z + scale)) continue;
    veg.kind[kept] = kind;
    veg.variant[kept] = dv.getUint8(o + 1);
    veg.rot[kept] = dv.getUint16(o + 2, true) / 65535 * TWO_PI;
    veg.x[kept] = x; veg.y[kept] = y; veg.z[kept] = z;
    veg.scale[kept] = scale;
    kept++;
  }
  return { cx, cz, lod, n, cell: cellSize(lod), heights, normals, colors, region, habitat, minY, maxY, veg: trimVeg(veg, kept) };
}

function allocVeg(count) {
  return {
    count,
    kind: new Uint8Array(count), variant: new Uint8Array(count), rot: new Float32Array(count),
    x: new Float32Array(count), y: new Float32Array(count), z: new Float32Array(count),
    scale: new Float32Array(count),
  };
}

function trimVeg(veg, count) {
  if (count === veg.count) return veg;
  return {
    count,
    kind: veg.kind.slice(0, count), variant: veg.variant.slice(0, count), rot: veg.rot.slice(0, count),
    x: veg.x.slice(0, count), y: veg.y.slice(0, count), z: veg.z.slice(0, count),
    scale: veg.scale.slice(0, count),
  };
}

/**
 * Derives a coarser chunk from a finer one without asking the server. This is exact,
 * not an approximation: the contract guarantees that vertices shared between LODs are
 * identical and that vegetation positions do not change with LOD (only which kinds are
 * present), so a lod-1 chunk IS every second vertex of the lod-0 chunk.
 * @param {ChunkData} chunk
 * @param {number} lod  target LOD, >= chunk.lod
 * @returns {ChunkData}
 */
export function decimateChunk(chunk, lod) {
  if (lod === chunk.lod) return chunk;
  if (lod < chunk.lod || lod > MAX_LOD) throw new Error(`chunk: cannot decimate lod ${chunk.lod} to ${lod}`);
  const step = 1 << (lod - chunk.lod);
  const n = gridSize(lod);
  const src = chunk.n;
  const heights = new Float32Array(n * n);
  const normals = new Int8Array(n * n * 3);
  const colors = new Uint8Array(n * n * 3);
  const region = new Uint8Array(n * n);
  const habitat = new Uint8Array(n * n);
  let minY = Infinity, maxY = -Infinity;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const d = iz * n + ix;
      const s = iz * step * src + ix * step;
      const h = chunk.heights[s];
      heights[d] = h;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
      normals[d * 3] = chunk.normals[s * 3];
      normals[d * 3 + 1] = chunk.normals[s * 3 + 1];
      normals[d * 3 + 2] = chunk.normals[s * 3 + 2];
      colors[d * 3] = chunk.colors[s * 3];
      colors[d * 3 + 1] = chunk.colors[s * 3 + 1];
      colors[d * 3 + 2] = chunk.colors[s * 3 + 2];
      region[d] = chunk.region[s];
      habitat[d] = chunk.habitat[s];
    }
  }
  const from = chunk.veg;
  const veg = allocVeg(from.count);
  let kept = 0;
  for (let i = 0; i < from.count; i++) {
    if (!vegVisibleAtLod(from.kind[i], lod)) continue;
    veg.kind[kept] = from.kind[i]; veg.variant[kept] = from.variant[i]; veg.rot[kept] = from.rot[i];
    veg.x[kept] = from.x[i]; veg.y[kept] = from.y[i]; veg.z[kept] = from.z[i];
    veg.scale[kept] = from.scale[i];
    kept++;
  }
  return { cx: chunk.cx, cz: chunk.cz, lod, n, cell: cellSize(lod), heights, normals, colors, region, habitat, minY, maxY, veg: trimVeg(veg, kept) };
}

/**
 * Encodes a chunk frame exactly as the server does. The client never sends chunks; this
 * exists so tests and offline tools can build frames, and it documents the format in
 * executable form.
 * @param {object} c
 * @param {number} c.cx
 * @param {number} c.cz
 * @param {number} c.lod
 * @param {(ix:number, iz:number, x:number, z:number) => {h:number, normal?:number[], color?:number[], region?:number, habitat?:number}} c.sample
 *        called for every vertex with its grid index and world position
 * @param {{kind:number, variant?:number, rot?:number, x:number, y:number, z:number, scale?:number}[]} [c.veg]
 * @returns {ArrayBuffer}
 */
export function encodeChunk({ cx, cz, lod, sample, veg = [] }) {
  const n = gridSize(lod);
  const cell = cellSize(lod);
  const at = chunkLayout(n);
  const buf = new ArrayBuffer(at.veg + veg.length * VEG_BYTES);
  const dv = new DataView(buf);
  dv.setUint32(0, CHUNK_MAGIC, true);
  dv.setUint8(4, CHUNK_VERSION);
  dv.setUint8(5, lod);
  dv.setUint16(6, n, true);
  dv.setInt32(8, cx, true);
  dv.setInt32(12, cz, true);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const s = sample(ix, iz, cx * CHUNK_SIZE + ix * cell, cz * CHUNK_SIZE + iz * cell);
      dv.setFloat32(at.heights + i * 4, s.h, true);
      const nrm = s.normal || [0, 1, 0];
      for (let k = 0; k < 3; k++) dv.setInt8(at.normals + i * 3 + k, Math.round(nrm[k] * 127));
      const col = s.color || [120, 150, 90];
      for (let k = 0; k < 3; k++) dv.setUint8(at.colors + i * 3 + k, col[k]);
      dv.setUint8(at.region + i, s.region ?? 0);
      dv.setUint8(at.habitat + i, s.habitat ?? 2);
    }
  }
  dv.setUint32(at.vegCount, veg.length, true);
  veg.forEach((v, i) => {
    const o = at.veg + i * VEG_BYTES;
    dv.setUint8(o, v.kind);
    dv.setUint8(o + 1, v.variant ?? 0);
    const turns = ((v.rot ?? 0) / TWO_PI) % 1;
    dv.setUint16(o + 2, Math.round((turns < 0 ? turns + 1 : turns) * 65535), true);
    dv.setFloat32(o + 4, v.x, true);
    dv.setFloat32(o + 8, v.y, true);
    dv.setFloat32(o + 12, v.z, true);
    dv.setFloat32(o + 16, v.scale ?? 1, true);
  });
  return buf;
}
