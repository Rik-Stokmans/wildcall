// The terrain material: the server's vertex colours stay the base (region, habitat,
// trails and shoreline are blended in there); this shader paints over them the things
// a 2 m vertex grid cannot carry, all in world space so chunk borders and LOD rings
// never show a seam:
//   * a low-contrast painterly wash (broad brightness, warm/cool shift),
//   * grassy ground lifted towards the colour of the grass on it, so the grass field
//     melts into the terrain at its far edge,
//   * clover patches in the open, leaf litter under trees, pebbles on bare earth,
//   * broken, soft edges where trails meet grass,
//   * banded rock and earth on steep slopes,
//   * shade under the canopy with a slowly drifting dapple of light,
// and, per region type (soft per-vertex weights from terrainMesh.js, so neighbouring
// region types blend):
//   * Murmur Marsh: ochre / olive / teal patchwork, sedge tussocks, dark wet mud at the
//     water's edge and still pools of open water in the flats that mirror the sky,
//   * Windpeak Highlands: grey-violet rock in strata with ledges and cracks, lichen,
//     scree fans streaked down the fall line, heather patches on the short turf,
//   * Whispering Coast: wind ripples in the sand, a dark glossy wet tide line with a
//     wrack line above it, shingle, pale banded sea cliffs streaked white by the gulls,
//   * Amberwood: a carpet of fallen gold, rust and copper leaves,
//   * Frostveil: blue-shadowed snow with drift ripples and sparkle, and frozen lakes of
//     dark clear ice with white cracks, frosted at the edges.
// Fine detail fades with distance so nothing shimmers. A patched MeshLambertMaterial:
// lights, fog and shadow receiving work as everywhere else; reflections (pools, wet
// sand, ice) and snow sparkle are added as emitted light.
import * as THREE from 'three';
import { GRASS_COLOR_GLSL, MARSH_POOL_GLSL } from './groundCover.js';

const VERT_HEAD = /* glsl */`
attribute float aCanopy;
attribute vec3 aRegA;
attribute vec2 aRegB;
varying float vCanopy;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec4 vReg;
varying float vFrost;
`;

const VERT_TAIL = /* glsl */`
vCanopy = aCanopy;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
vReg = vec4(aRegA, aRegB.x);
vFrost = aRegB.y;
`;

const FRAG_HEAD = /* glsl */`
uniform float uTime;
uniform float uWind;
uniform float uWet;
uniform vec2 uWindDir;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uSkyHigh;
uniform float uLight;
varying float vCanopy;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec4 vReg;
varying float vFrost;
${GRASS_COLOR_GLSL}
${MARSH_POOL_GLSL}
float tHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Round speckles on a jittered grid: x = coverage (0..1), y = a random per speckle.
vec2 speckle(vec2 p, float size) {
  vec2 c = floor(p);
  vec2 o = vec2(tHash(c), tHash(c + 17.3));
  float r = length(fract(p) - (0.25 + 0.5 * o));
  return vec2(1.0 - smoothstep(size * 0.7, size, r), tHash(c + 41.7));
}
// Distance to the nearest cell border of a jittered (Voronoi) grid: ice cracks.
float cellEdge(vec2 p) {
  vec2 c = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = g + vec2(tHash(c + g), tHash(c + g + 19.1)) * 0.85 - f;
    float d = dot(o, o);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}
// Sky seen in a level mirror from this view direction (linear, before lighting).
vec3 skyMirror(vec3 V) {
  return mix(uSkyCol, uSkyHigh, smoothstep(0.05, 0.55, V.y));
}
`;

const FRAG_DETAIL = /* glsl */`
vec3 bumpW = vec3(0.0);
{
  vec3 base = diffuseColor.rgb;
  vec3 s = pow(max(base, vec3(0.0)), vec3(1.0 / 2.2)) * 255.0;
  float grass = smoothstep(10.0, 28.0, s.g - (s.r + s.b) * 0.5) * (1.0 - smoothstep(500.0, 580.0, s.r + s.g + s.b)) * (1.0 + vCanopy * step(vCanopy, 0.0));
  float bright = s.r + s.g + s.b;
  vec2 p = vWPos.xz;
  float h = vWPos.y;
  vec3 toEye = cameraPosition - vWPos;
  float dist = length(toEye);
  vec3 V = toEye / max(dist, 1e-3);
  float near = 1.0 - smoothstep(18.0, 60.0, dist);
  float mid = 1.0 - smoothstep(60.0, 220.0, dist);
  float canopy = clamp(vCanopy, 0.0, 1.0);
  // Far field: woods drawn as a blanket of crowns (farField.js), not ground.
  float blanket = clamp(-vCanopy, 0.0, 1.0);
  float wM = vReg.x, wW = vReg.y, wC = vReg.z, wA = vReg.w, wF = vFrost;
  float wG = clamp(1.0 - wM - wW - wC - wA - wF, 0.0, 1.0);
  float ny = vWNrm.y;
  float steep = 1.0 - smoothstep(0.55, 0.82, ny);
  float level = smoothstep(0.93, 0.985, ny);
  // On steep faces plan-view (xz) patterns stretch into streaks: use coordinates along
  // the face (horizontal along it, and height) there instead.
  // (Triplanar-style: a face turned towards ±z runs along x, one towards ±x along z;
  // the per-vertex normal itself wavers too much to derive a direction from.)
  float facesX = smoothstep(0.35, 0.65, abs(vWNrm.x) / max(abs(vWNrm.x) + abs(vWNrm.z), 1e-4));
  vec2 pf = ny < 0.72 ? vec2(facesX > 0.5 ? p.y : p.x, vWPos.y) : p;
  vec3 L = normalize(uSunDir);
  float sunUp = smoothstep(-0.05, 0.12, L.y);
  vec3 emit = vec3(0.0);

  float n1 = tNoise(p / 29.0);
  float n2 = tNoise(p / 7.3 + 3.1);
  float n3 = tNoise(p * 0.55 + 9.7);
  vec3 col = base * (0.93 + 0.14 * n1);
  col *= mix(vec3(1.0), vec3(1.05, 1.02, 0.9), (n2 - 0.5) * 0.7 * mid + 0.15);

  // Grass: the field colour, mottled like clumps of grass seen from afar, with the
  // wind's gusts running across it as lighter waves, and darker clover drifts.
  col = mix(col, grassField(col), grass * 0.8);
  float far = smoothstep(6.0, 22.0, dist) * mid;
  float clumps = tNoise(p * 0.9 + 4.1) * 0.6 + tNoise(p * 2.3 - 1.7) * 0.4;
  col *= 1.0 + grass * far * (clumps - 0.5) * 0.22;
  float gust = tNoise(p * 0.045 - uWindDir * uTime * 1.15) * 0.65 + tNoise(p * 0.16 - uWindDir * uTime * 2.2) * 0.35;
  col *= 1.0 + grass * (1.0 - canopy) * uWind * smoothstep(0.5, 0.95, gust) * (0.16 + 0.1 * wM + 0.06 * wW);
  float clover = grass * (1.0 - canopy) * smoothstep(0.6, 0.74, tNoise(p * 0.17 + 7.0)) * (wG + 0.4 * wA);
  col = mix(col, col * vec3(0.8, 0.92, 0.84), clover * 0.55 * mid);
  vec2 dot1 = speckle(p * 5.0, 0.18);
  col = mix(col, vec3(0.86, 0.86, 0.8), clover * dot1.x * step(0.55, dot1.y) * near * 0.85);

  // Leaf litter under trees: warm leaves scattered over the floor.
  // (Leaves are small rotated ellipses, so the floor reads as litter, not dots.)
  // Amberwood: a whole carpet of fallen gold, rust and copper, in the open as well.
  float la = tHash(floor(p * 6.0)) * 6.2831853;
  mat2 lr = mat2(cos(la), sin(la), -sin(la), cos(la));
  vec2 leaf = speckle(lr * (p * vec2(6.0, 6.0)) * vec2(1.0, 1.9) + vec2(n3 * 1.3, n2), 0.3);
  vec3 leafCol = mix(vec3(0.3, 0.19, 0.08), vec3(0.42, 0.33, 0.12), leaf.y) * (0.85 + 0.3 * n3);
  float litter = smoothstep(0.25, 0.7, canopy) * (0.4 + 0.6 * grass) * smoothstep(0.35, 0.6, n2 + 0.2 * canopy) * (1.0 - wF);
  col = mix(col, mix(col, leafCol, 0.28), litter * leaf.x * near * (1.0 - wA));
  col = mix(col, col * vec3(1.03, 0.96, 0.86), litter * 0.4 * mid);
  if (wA > 0.01) {
    vec3 gold = vec3(0.82, 0.5, 0.06), rust = vec3(0.42, 0.09, 0.02), copper = vec3(0.62, 0.22, 0.04), brown = vec3(0.2, 0.09, 0.03);
    float carpet = wA * (1.0 - steep) * (0.6 + 0.4 * smoothstep(0.2, 0.6, canopy + 0.3 * n2));
    // From further off the carpet reads as a patchy wash of rust and gold drifts.
    float drift = tNoise(p / 9.0 + 4.0) * 0.7 + tNoise(p / 2.6) * 0.3;
    vec3 wash = mix(vec3(0.46, 0.16, 0.04), vec3(0.74, 0.46, 0.09), smoothstep(0.3, 0.7, drift));
    col = mix(col, wash * (0.8 + 0.3 * n2), carpet * 0.62 * mid);
    // Close by, single leaves in two layers: a darker under-layer and bright fresh ones.
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      float a2 = tHash(floor(p * (3.2 + fk)) + fk * 9.0) * 6.2831853;
      mat2 r2 = mat2(cos(a2), sin(a2), -sin(a2), cos(a2));
      vec2 lf = speckle(r2 * (p * (3.2 + fk) + fk * 5.3) * vec2(1.0, 1.8), 0.36 - 0.04 * fk);
      vec3 lc = lf.y < 0.32 ? gold : lf.y < 0.56 ? copper : lf.y < 0.82 ? rust : brown;
      lc *= (0.75 + 0.45 * fract(lf.y * 13.7)) * (fk > 0.5 ? 1.12 : 0.82);
      col = mix(col, lc, carpet * lf.x * near * 0.85);
    }
  }

  // Bare earth and trails: pebbles and ruts, and a broken, grassy edge.
  float bare = (1.0 - grass) * (1.0 - smoothstep(560.0, 640.0, bright)) * (1.0 - wF * 0.8);
  vec2 peb = speckle(pf * 3.4, 0.22);
  float sandLike = smoothstep(380.0, 460.0, bright) * smoothstep(10.0, 34.0, s.r - s.b);
  col = mix(col, col * (0.72 + 0.55 * peb.y), bare * peb.x * near * 0.6 * (1.0 - wW) * (1.0 - steep) * (1.0 - sandLike * wC));
  col *= 1.0 - bare * 0.08 * (tNoise(pf * 1.7) - 0.5) * near;
  float edge = grass * (1.0 - grass) * 4.0;
  col = mix(col, grassField(col * vec3(0.85, 1.12, 0.8)), edge * smoothstep(0.45, 0.75, tNoise(p * 0.9 + 2.0)) * 0.5 * (1.0 - wF));

  // Steep ground: bands of rock and earth.
  float band = tNoise(vec2(p.x * 0.11 + p.y * 0.07, vWPos.y * 1.3));
  col = mix(col, col * (0.78 + 0.32 * band) * vec3(1.02, 0.98, 0.95), steep * 0.7 * (1.0 - 0.7 * (wW + wC)));

  // --- Windpeak Highlands and sea cliffs: stratified rock --------------------------------
  float rocky = steep * (wW + wC) + wW * (1.0 - grass) * (1.0 - smoothstep(0.75, 0.95, ny)) * 0.8;
  if (rocky > 0.01) {
    float warp = tNoise(p * 0.021 + 3.0) * 7.0;
    float bandH = mix(3.4, 2.1, wC);
    float layer = (vWPos.y + warp) / bandH;
    float fl = fract(layer), id = floor(layer);
    float tone = tHash(vec2(id, 7.1));
    // Vertical joints split each layer into blocks; computed along x and along z and
    // blended by which way the face looks, so they never zig-zag across triangles.
    float bw = 3.0 + 4.0 * tHash(vec2(id, 2.0));
    float bX = tHash(vec2(floor(p.x / bw + tNoise(vec2(p.x * 0.22, id * 1.7))), id));
    float bZ = tHash(vec2(floor(p.y / bw + tNoise(vec2(p.y * 0.22, id * 1.7))), id + 0.5));
    float block = mix(bX, bZ, facesX);
    float cX = abs(tNoise(vec2(p.x * 0.45, vWPos.y * 0.09 + id * 3.1)) - 0.5);
    float cZ = abs(tNoise(vec2(p.y * 0.45, vWPos.y * 0.09 + id * 3.1)) - 0.5);
    float crack = 1.0 - smoothstep(0.0, 0.05, mix(cX, cZ, facesX));
    // Relief: each layer's face leans back under a ledge; blocks stand proud a little.
    float prof = smoothstep(0.0, 0.12, fl) * (1.0 - 0.55 * fl) + 0.25 * block;
    bumpW += vec3(0.0, 1.0, 0.0) * (0.5 - fl) * 0.38 * rocky * mid;
    tone = mix(tone, block, 0.35);
    // Streaks down the face: rusty iron stains and darker wet runs.
    float sX = tNoise(vec2(p.x * 0.6, vWPos.y * 0.035)), sZ = tNoise(vec2(p.y * 0.6, vWPos.y * 0.035 + 7.0));
    float streak = mix(sX, sZ, facesX);
    vec3 hiRock = mix(vec3(0.3, 0.29, 0.34), vec3(0.46, 0.44, 0.48), tone);       // grey-violet
    vec3 coastRock = mix(vec3(0.24, 0.22, 0.19), vec3(0.54, 0.5, 0.44), tone * tone); // banded cliff
    coastRock *= mix(0.55, 1.0, smoothstep(0.5, 3.5, vWPos.y));                      // dark, wet foot
    vec3 rockCol = mix(hiRock, coastRock, wC / max(wW + wC, 1e-3));
    rockCol *= 0.9 + 0.25 * tNoise(pf * 0.35 + id);
    rockCol *= 0.82 + 0.3 * prof;
    // warm and cool layers
    rockCol *= mix(vec3(1.06, 1.0, 0.92), vec3(0.94, 0.96, 1.06), tHash(vec2(id, 3.3)));
    // dark seams under each layer, a lit ledge on top of it
    rockCol *= 1.0 - 0.42 * (1.0 - smoothstep(0.0, 0.09, fl)) * mid;
    rockCol *= 1.0 + 0.18 * smoothstep(0.82, 0.98, fl) * mid;
    rockCol *= 1.0 - 0.45 * crack * near;
    rockCol = mix(rockCol, rockCol * vec3(1.18, 0.95, 0.78), smoothstep(0.62, 0.85, streak) * 0.6 * steep);
    rockCol *= 1.0 - 0.22 * smoothstep(0.25, 0.05, streak) * steep;
    float rk = clamp(rocky, 0.0, 1.0);
    col = mix(col, mix(col, rockCol, 0.75), rk);
    // Lichen on the highland rock; the gulls' white streaks down the sea cliffs.
    vec2 li = speckle(pf * 6.0 + id, 0.3);
    col = mix(col, vec3(0.42, 0.36, 0.17) * (0.7 + 0.5 * li.y), wW * rk * li.x * step(0.86, li.y) * near * 0.3 * (1.0 - steep));
    float guano = smoothstep(0.7, 0.88, streak) * smoothstep(4.0, 9.0, vWPos.y);
    col = mix(col, vec3(0.86, 0.85, 0.8), wC * steep * guano * 0.55 * mid);
  }
  if (wW > 0.01) {
    // Scree fans on the middle slopes: pebbles streaked down the fall line.
    float scree = wW * (1.0 - grass) * smoothstep(0.58, 0.7, ny) * (1.0 - smoothstep(0.86, 0.95, ny));
    // (across the slope: x or z by facing; down the fall line: height)
    vec2 qx = vec2(p.x * 0.35, vWPos.y * 0.09), qz = vec2(p.y * 0.35, vWPos.y * 0.09 + 3.0);
    float streak = mix(tNoise(qx) * 0.7 + tNoise(qx * 2.3 + 5.0) * 0.3, tNoise(qz) * 0.7 + tNoise(qz * 2.3 + 5.0) * 0.3, facesX);
    vec2 sp = speckle(p * 5.1 + streak, 0.42);
    vec2 sp2 = speckle(p * 2.3 - streak * 2.0, 0.3);
    vec3 screeCol = vec3(0.36, 0.35, 0.38) * (0.82 + 0.3 * streak);
    screeCol *= 1.0 + 0.25 * (sp.y - 0.5) * sp.x * near + 0.2 * (sp2.y - 0.5) * sp2.x * mid;
    col = mix(col, screeCol, scree * 0.8);
    // Heather on the short turf: purple-brown cushions between the grass.
    float heath = smoothstep(0.42, 0.68, tNoise(p / 13.0 + 3.0) * 0.65 + tNoise(p / 3.4 + 1.0) * 0.35);
    vec3 heather = mix(vec3(0.17, 0.08, 0.11), vec3(0.27, 0.13, 0.2), tNoise(p * 0.8));
    col = mix(col, heather * (0.8 + 0.4 * n2), wW * grass * (1.0 - steep) * heath * 0.5);
    // Wind-cropped turf: muted, with straw in the open.
    float lum = dot(col, vec3(0.3, 0.6, 0.1));
    col = mix(col, mix(vec3(lum), col, 0.7) * vec3(1.1, 1.0, 0.8), wW * grass * (0.45 + 0.3 * tNoise(p / 21.0 + 9.0)));
  }

  // --- Murmur Marsh ------------------------------------------------------------------------
  if (wM > 0.01) {
    float mp = tNoise(p / 23.0 + 5.0) * 0.65 + tNoise(p / 6.0 - 2.0) * 0.35;
    vec3 ochre = col * vec3(1.18, 1.0, 0.66);
    vec3 teal = col * vec3(0.74, 0.92, 0.9);
    col = mix(col, mix(teal, ochre, smoothstep(0.32, 0.7, mp)), wM * 0.6);
    // sedge tussocks: darker cushions with a straw ring
    vec2 tus = speckle(p * 0.8, 0.45);
    col = mix(col, col * mix(vec3(0.7, 0.72, 0.56), vec3(1.15, 1.06, 0.8), tus.y), wM * tus.x * near * 0.4 * grass);
    // dark, wet mud along every margin
    float mud = wM * (1.0 - smoothstep(0.12, 0.7, h));
    col = mix(col, vec3(0.07, 0.055, 0.035) * (0.8 + 0.4 * n3), mud * 0.7);
    // still pools in the flats: dark peaty water mirroring the sky
    float pool = wM * marshPool(p, h) * level;
    if (pool > 0.001) {
      float ndv = clamp(V.y, 0.0, 1.0);
      float fres = 0.04 + 0.96 * pow(1.0 - ndv, 4.0);
      vec2 rip = vec2(tNoise(p * 1.3 + uTime * 0.15), tNoise(p * 1.3 - uTime * 0.12 + 7.0)) - 0.5;
      vec3 N = normalize(vec3(rip.x * 0.06 * uWind, 1.0, rip.y * 0.06 * uWind));
      vec3 R = reflect(-V, N);
      vec3 sky = mix(uSkyCol, uSkyHigh, smoothstep(0.05, 0.6, R.y)) * (0.25 + 0.75 * uLight);
      float glint = pow(max(dot(R, L), 0.0), 160.0) * 3.0 * sunUp;
      col = mix(col, vec3(0.02, 0.025, 0.018), pool);
      emit += pool * (sky * mix(0.3, 0.95, fres) + uSunCol * glint);
      // a darker rim of wet mud and a few floating leaves
      float rim = wM * marshPool(p + 0.9, h) * (1.0 - pool);
      col = mix(col, vec3(0.06, 0.05, 0.03), rim * 0.5);
    }
  }

  // --- Whispering Coast ------------------------------------------------------------------
  if (wC > 0.01) {
    float sandy = wC * smoothstep(330.0, 430.0, bright) * smoothstep(10.0, 34.0, s.r - s.b) * (1.0 - grass) * (1.0 - steep);
    float bed = wC * (1.0 - smoothstep(-0.2, 0.25, h));
    // wind ripples in dry sand, finer ripples under the shallows
    float rp = sin(dot(p, vec2(0.83, 0.56)) * 7.0 + tNoise(p * 0.35) * 6.0 + tNoise(p * 1.7) * 1.2);
    col *= 1.0 + 0.07 * rp * near * max(sandy, bed * 0.7);
    // wet tide line: dark, glossy sand reflecting the sky
    float wet = max(sandy, bed) * (1.0 - smoothstep(0.05, 0.32 + 0.1 * tNoise(p * 0.2), h)) * smoothstep(-0.25, 0.0, h);
    col = mix(col, col * vec3(0.7, 0.69, 0.68), wet * 0.8);
    // dry sand above the tide: pale and bleached
    col = mix(col, col * vec3(1.1, 1.08, 1.05), sandy * smoothstep(0.5, 1.2, h) * 0.8);
    float fresS = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
    emit += wet * (skyMirror(V) * (0.25 + 0.75 * uLight) * fresS * 0.45 + uSunCol * pow(max(dot(reflect(-V, vec3(0.0, 1.0, 0.0)), L), 0.0), 60.0) * 0.6 * sunUp);
    // the wrack line: dark seaweed and shells above the tide
    float wr = 1.0 - smoothstep(0.0, 0.12, abs(h - 0.72 - 0.18 * tNoise(p * 0.08)));
    vec2 wk = speckle(p * 4.0, 0.32);
    col = mix(col, mix(vec3(0.08, 0.07, 0.03), vec3(0.75, 0.72, 0.66), step(0.8, wk.y)), sandy * wr * wk.x * near * 0.75);
    // shingle: rounded pebbles on the upper beach
    // (on the darker, coarser beaches below the cliffs; sand stays sand)
    float shingle = wC * (1.0 - grass) * (1.0 - sandLike) * smoothstep(0.35, 0.65, tNoise(p / 17.0 + 2.0)) * (1.0 - smoothstep(1.4, 3.0, h)) * smoothstep(0.2, 0.5, h);
    vec2 pb = speckle(p * 5.5, 0.5);
    vec2 pb2 = speckle(p * 7.7 + 3.3, 0.5);
    col = mix(col, mix(vec3(0.34, 0.33, 0.32), vec3(0.62, 0.6, 0.56), pb.y), shingle * pb.x * near * 0.8);
    col = mix(col, mix(vec3(0.3, 0.29, 0.28), vec3(0.55, 0.53, 0.5), pb2.y), shingle * pb2.x * near * 0.7);
    col = mix(col, col * vec3(0.86, 0.86, 0.88), shingle * 0.4 * mid);
    // salt-wind grass: blue-green, a little silvery
    col = mix(col, col * vec3(0.92, 1.0, 1.04), wC * grass * 0.5);
  }

  // --- Frostveil ------------------------------------------------------------------------
  if (wF > 0.01) {
    float snow = wF * smoothstep(520.0, 640.0, bright) * (1.0 - smoothstep(30.0, 60.0, max(s.r, max(s.g, s.b)) - min(s.r, min(s.g, s.b))));
    float ice = wF * level * (1.0 - smoothstep(0.03, 0.09, abs(h - 0.3)));
    // drift ripples (sastrugi) and soft hollows
    float sg = sin(dot(p, vec2(0.6, 0.8)) * 2.3 + tNoise(p * 0.21) * 7.0);
    col *= 1.0 + snow * (0.045 * sg * near + 0.05 * (n2 - 0.5));
    // blue shadow on the side turned from the sun
    float away = 1.0 - clamp(dot(vWNrm, L) * 1.6, 0.0, 1.0);
    col = mix(col, col * vec3(0.8, 0.88, 1.06), snow * away * 0.55);
    // sparkle: tiny facets that catch the sun as the eye moves
    // (jittered points, a few per square metre, each lit from one viewing angle only)
    vec2 sq = p * 9.0;
    vec2 sc = floor(sq);
    vec2 sj = vec2(tHash(sc + 3.1), tHash(sc + 8.7));
    float facet = tHash(sc + floor(V.xz * 14.0 + sj * 3.0) * 3.7);
    float dot2 = 1.0 - smoothstep(0.035, 0.07, length(fract(sq) - (0.2 + 0.6 * sj)));
    float spark = step(0.985, facet) * dot2 * (1.0 - smoothstep(3.0, 14.0, dist)) * sunUp;
    emit += snow * spark * uSunCol * 2.2 * (0.6 + 0.4 * clamp(dot(vWNrm, L), 0.0, 1.0));
    // Frozen lakes: clear dark ice, white cracks, frost on the shallow edges.
    if (ice > 0.001) {
      float cl = smoothstep(0.35, 0.65, tNoise(p / 9.0 + 4.0) * 0.7 + tNoise(p / 2.7) * 0.3);
      vec3 iceCol = mix(vec3(0.42, 0.58, 0.66), vec3(0.08, 0.2, 0.26), cl);
      float ce = cellEdge(p / 3.2);
      float ce2 = cellEdge(p / 0.9 + 3.0);
      float crack = (1.0 - smoothstep(0.0, 0.045, ce)) * 0.9 + (1.0 - smoothstep(0.0, 0.03, ce2)) * 0.45 * near;
      float frost = smoothstep(0.5, 0.75, tNoise(p / 5.0 + 9.0)) * 0.6;
      iceCol = mix(iceCol, vec3(0.86, 0.92, 0.96), clamp(crack * mid + frost, 0.0, 1.0));
      col = mix(col, iceCol, ice);
      float fres = 0.05 + 0.95 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
      vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
      emit += ice * (1.0 - frost) * (skyMirror(V) * (0.25 + 0.75 * uLight) * fres * 0.6
        + uSunCol * pow(max(dot(R, L), 0.0), 220.0) * 2.5 * sunUp);
    }
  }

  // Under water: the bed takes the water's colour with depth (no grey gravel seen
  // through a clear pond), with sunlit caustics wavering over the shallows.
  if (h < 0.05 && wF < 0.99) {
    float dep = clamp(0.02 - h, 0.0, 8.0);
    vec3 absorb = mix(vec3(1.0), mix(vec3(0.52, 0.8, 0.78), vec3(0.62, 0.86, 0.84), wC), smoothstep(0.0, 1.0, dep));
    absorb = mix(absorb, mix(vec3(0.2, 0.42, 0.46), vec3(0.25, 0.55, 0.62), wC), smoothstep(1.0, 4.5, dep));
    absorb = mix(absorb, vec3(0.42, 0.36, 0.22), wM);
    col *= mix(vec3(1.0), absorb, 1.0 - wF);
    vec2 cq = p * 0.9;
    float c1 = abs(tNoise(cq + vec2(uTime * 0.31, uTime * 0.17)) - 0.5);
    float c2 = abs(tNoise(cq * 1.7 - vec2(uTime * 0.23, -uTime * 0.29) + 4.0) - 0.5);
    float caust = pow(1.0 - min(c1, c2) * 2.0, 6.0);
    col *= 1.0 + 0.45 * caust * (1.0 - smoothstep(0.1, 2.2, dep)) * sunUp * mid * (1.0 - wM) * (1.0 - wF);
  }

  // Far woods: clumps of lit and shaded crowns.
  if (blanket > 0.01) {
    float cr = tNoise(p * 0.09 + 3.0) * 0.6 + tNoise(p * 0.31) * 0.4;
    col *= mix(1.0, 0.72 + 0.5 * cr, blanket);
  }

  // Shade under the canopy, with a gently drifting dapple of light.
  float dap = tNoise(p * 0.42 + uWindDir * uTime * 0.12) * 0.6 + tNoise(p * 1.1 - uWindDir * uTime * 0.2) * 0.4;
  col *= 1.0 - canopy * (0.2 + 0.2 * smoothstep(0.38, 0.62, dap));

  // Rain darkens the ground (soil more than grass; less under the trees) and puts a
  // faint sheen on flat open ground; snow and ice stay as they are.
  float wetK = uWet * (1.0 - wF);
  col *= 1.0 - wetK * (0.12 + 0.18 * (1.0 - grass)) * (1.0 - 0.5 * canopy);
  float sheen = pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0) * level * (1.0 - grass * 0.7) * (1.0 - canopy);
  emit += wetK * sheen * skyMirror(V) * 0.35 * (0.25 + 0.75 * uLight);

  diffuseColor.rgb = col;
  totalEmissiveRadiance += emit;
}
`;

/**
 * @param {object} shared  live uniforms shared with the ground cover and the world
 *        (uGrassTint, uTime, uWind, uWet, uWindDir, uSunDir, uSunCol, uSkyCol, uSkyHigh, uLight)
 */
export function createTerrainMaterial(shared) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uniforms = { ...defaultTerrainUniforms(), ...(shared || {}) };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + VERT_TAIL);
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_DETAIL)
      // Relief from the rock strata (world-space bump turned into view space).
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (dot(bumpW, bumpW) > 1e-6) normal = normalize(normal + mat3(viewMatrix) * bumpW);');
  };
  mat.customProgramCacheKey = () => 'wc-terrain-3';
  return mat;
}

/** Every uniform the terrain shader reads, with neutral values. */
export function defaultTerrainUniforms() {
  return {
    uGrassTint: { value: new THREE.Vector4() },
    uTime: { value: 0 },
    uWind: { value: 0.3 },
    uWet: { value: 0 },
    uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
    uSkyCol: { value: new THREE.Color(0.7, 0.8, 0.86) },
    uSkyHigh: { value: new THREE.Color(0.2, 0.4, 0.7) },
    uLight: { value: 1 },
  };
}
