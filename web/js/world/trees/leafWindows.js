// Leaf windows (setting leafFade): the foliage must not bury a bird the engine considers
// visible. Like the grass parting around ground birds (groundCover.js gaps), leaf cards
// in a slim sight-line cone between the camera and a nearby bird are thinned out with a
// stable screen-space dither, so the bird sits in a small natural window in the leaves.
// Only leaf cards: trunks, limbs and terrain are never opened, and the window reaches
// only a few metres in front of the bird (its own crown) plus, at the player's end, a
// pinhole through the leaves within a few metres of the camera (the player parting the
// branches right in front of them; angular, 1.6x the bird's apparent size). Trees
// standing in between stay solid — a window, not a tunnel.
//
// Leaf cards are large (about a metre), so the window is cut per pixel: the vertex
// stage flags the cards that may overlap a window (a cheap broad test with the card's
// size), and only on those the fragment stage measures each pixel's distance from the
// sight line and dithers it away inside the cone (soft edge, so the leaf texture gives
// the hole a ragged, natural rim).
//
// The birds module (web/js/birds) owns the list: it writes up to MAX_LEAF_WINDOWS
// birds into these shared uniforms (no allocation) — A = body centre xyz + strength
// 0..1, B = radius at the bird, window depth, radius at the far end, depth of the
// camera-end pinhole (0 = none). The maths is
// mirrored by leafCut() in web/js/birds/visibility.js (unit-tested there); keep them
// in step.
import * as THREE from 'three';

export const MAX_LEAF_WINDOWS = 12;

/** Live uniforms shared by every leaf material (main pass only). */
export const LEAF_WINDOWS = {
  uLeafWinA: { value: Array.from({ length: MAX_LEAF_WINDOWS }, () => new THREE.Vector4(0, -1e4, 0, 0)) },
  uLeafWinB: { value: Array.from({ length: MAX_LEAF_WINDOWS }, () => new THREE.Vector4(0.25, 2.2, 0.45, 0)) },
  uLeafWinN: { value: 0 },
};

const UNIFORMS = /* glsl */`
uniform vec4 uLeafWinA[${MAX_LEAF_WINDOWS}];
uniform vec4 uLeafWinB[${MAX_LEAF_WINDOWS}];
uniform int uLeafWinN;
// Cut 0..1 of the windows at world point p; cardR widens the test by a card's half-size
// (vertex stage: "may this card overlap a window?"), 0 for an exact pixel; jit scales
// the radii per card (0.95..1.4: never below the bird itself) so the window's rim
// follows whole leaves, ragged and natural, instead of a clean dithered circle.
float leafWindowCut(vec3 p, float cardR, float jit) {
  float cut = 0.0;
  for (int i = 0; i < ${MAX_LEAF_WINDOWS}; i++) {
    if (i >= uLeafWinN) break;
    vec4 A = uLeafWinA[i];
    vec4 B = uLeafWinB[i];
    vec3 cb = A.xyz - cameraPosition;
    float L = length(cb);
    vec3 dir = cb / max(L, 1e-4);
    vec3 cp = p - cameraPosition;
    float s = dot(cp, dir);
    float ahead = L - s;
    float d = length(cp - dir * s) - cardR;
    if (ahead >= -0.1 - cardR && ahead <= B.y + cardR) {
      float u = clamp(ahead / B.y, 0.0, 1.0);
      float r = mix(B.x, max(B.z, B.x * 1.5), u) * jit;
      float f = (1.0 - smoothstep(r * 0.6, r, d)) * smoothstep(-0.1 - cardR, 0.05, ahead) * (1.0 - smoothstep(B.y * 0.8, B.y + cardR, ahead));
      cut = max(cut, f * A.w);
    }
    if (s > -cardR && s < B.w + cardR) {
      float rn = (max(s, 0.0) / max(L, 1e-4) * B.x * 1.6 + 0.02) * jit;
      float fn = (1.0 - smoothstep(rn * 0.6, rn, d)) * (1.0 - smoothstep(B.w * 0.75, B.w + cardR, s));
      cut = max(cut, fn * A.w);
    }
  }
  return cut;
}
`;

/** Vertex declarations (leaf cards only). */
export const LEAF_WINDOW_HEAD = /* glsl */`
#ifdef TREE_CARDS
${UNIFORMS}
varying float vLeafNear;
varying float vLeafJit;
varying vec3 vLeafW;
#endif
`;

/**
 * Vertex body, after the card offset was added to `transformed`: `wc` is the card's
 * world centre, `cardR` its half-size; writes the flag and this vertex's world position.
 */
export const LEAF_WINDOW_VERTEX = /* glsl */`
#ifdef TREE_CARDS
  vLeafNear = uLeafWinN > 0 ? leafWindowCut(wc, cardR, 1.4) : 0.0;
  vLeafJit = 0.95 + 0.45 * fract(aTree.w * 7.31);
  vLeafW = wv;
#endif
`;

/** Fragment declarations. */
export const LEAF_WINDOW_FRAG_HEAD = /* glsl */`
#ifdef TREE_CARDS
${UNIFORMS}
varying float vLeafNear;
varying float vLeafJit;
varying vec3 vLeafW;
#endif
`;

/** Fragment body: dither the pixel away inside a window (a different noise phase than the LOD cross-fade). */
export const LEAF_WINDOW_FRAG = /* glsl */`
#ifdef TREE_CARDS
  if (vLeafNear > 0.002) {
    float wCut = leafWindowCut(vLeafW, 0.0, vLeafJit);
    if (wCut > 0.002) {
      float wD = fract(52.9829189 * fract(dot(gl_FragCoord.xy + vec2(23.0, 41.0), vec2(0.06711056, 0.00583715))));
      if (wD < wCut) discard;
    }
  }
#endif
`;
