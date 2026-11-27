// Materials of the branching trees: patched MeshLambertMaterials (so the sky's lights,
// fog and shadows behave like everywhere else) plus matching depth materials so
// shadows move and thin out with the leaves.
//
// Vertex stage (wood and leaves):
//   * wind — the whole tree leans downwind with gusts (limbs barely move), foliage
//     masses bob independently, leaf cards shimmer; computed in world metres and
//     converted into the instance's space, so shadows follow;
//   * leaf cards — every card is turned to face the camera (in the shadow pass: the
//     light), its corners spread in the view plane; its normal is domed so the cards
//     of a mass together shade like a soft ball;
//   * seasons — leaf colours blend towards the season's colour of their class
//     (keeping light and shade); broadleaves shed cards towards winter.
// Fragment stage (leaves): wrapped diffuse light so the shaded side of a crown is
// never black, a touch of light through the leaves at the edges against the sun, and
// an alpha test that keeps distant cards solid instead of letting mipmaps eat them.
import * as THREE from 'three';
import { LEAF_WINDOWS, LEAF_WINDOW_HEAD, LEAF_WINDOW_VERTEX, LEAF_WINDOW_FRAG_HEAD, LEAF_WINDOW_FRAG } from './leafWindows.js';

const HEADER = /* glsl */`
attribute vec4 aTree;
#ifdef TREE_CARDS
attribute vec2 aCard;
#endif
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform float uBend;
uniform float uFlutter;
uniform float uFreq;
uniform float uThin;
uniform vec4 uFade;   // distance-band cross-fade window (instancing.js fadeWindow)
uniform float uLodScale; // zoom: distances shrink while looking through optics

#ifdef USE_INSTANCING
// World-space metres (at the model's scale 1) -> the instance's model space.
vec3 treeLocal(vec3 w) {
  mat3 m = mat3(instanceMatrix);
  return (transpose(m) * w) / length(m[1]);
}
float treePhase() {
  vec2 wp = modelMatrix[3].xz + instanceMatrix[3].xz;
  return fract(dot(wp, vec2(0.0713, 0.0531))) * 6.2831853;
}
#else
vec3 treeLocal(vec3 w) { return w; }
float treePhase() { return 0.0; }
#endif

vec3 treeWind() {
  if (uWind <= 0.001) return vec3(0.0);
  float ph = treePhase();
  float gust = 0.55 + 0.45 * sin(uTime * 0.37 + ph * 0.6) * sin(uTime * 0.13 + ph);
  float lean = uWind * uBend * aTree.x * gust * (0.7 + 0.3 * sin(uTime * uFreq + ph));
  vec3 w = vec3(uWindDir.x * lean, -lean * 0.12, uWindDir.y * lean);
  float mp = ph + aTree.z * 6.2831853;
  float fl = uWind * uFlutter * aTree.y * (0.45 + gust) * (0.4 + 0.6 * aTree.x);
  w += fl * vec3(sin(uTime * uFreq * 2.3 + mp), 0.45 * sin(uTime * uFreq * 1.7 + mp * 1.3), cos(uTime * uFreq * 2.1 + mp));
  return treeLocal(w);
}

vec3 treeCard() {
#ifdef TREE_CARDS
  // Cards whose random value is under the season's thinning are dropped (collapsed).
  float keep = step(uThin, aTree.w);
  float sh = uWind * 0.16 * sin(uTime * (3.3 + aTree.w * 2.0) + aTree.w * 40.0);
  float c = cos(sh), s = sin(sh);
  vec2 k = vec2(aCard.x * c - aCard.y * s, aCard.x * s + aCard.y * c) * keep;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  return treeLocal(right * k.x + up * k.y);
#else
  return vec3(0.0);
#endif
}
`;

const NORMAL = /* glsl */`
vec3 objectNormal = vec3(normal);
#ifdef TREE_CARDS
  vec3 cardOff = treeCard();
  float cl = length(cardOff);
  if (cl > 1e-5) objectNormal = normalize(objectNormal + cardOff / cl * 0.42);
#endif
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
`;

// Shadow pass: the cards face the light here, so they would shadow themselves in
// stripes; pushing them a little away from the light keeps the dappling (cards shade
// the ones behind them) without the acne. Only the shadow-caster sets (forest.js:
// the instances whose shadow can land in the map) are drawn in this pass.
const BEGIN = /* glsl */`
vec3 transformed = vec3(position) + treeWind();
#ifdef TREE_CARDS
  transformed += treeCard();
  vec3 toLight = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  transformed += treeLocal(-toLight * 0.9);
#endif
`;

// Main pass: the distance-band cross-fade. Instances wholly outside this level's band
// are collapsed (their vertices cost almost nothing); inside a fade zone the fragment
// stage keeps a dithered share of the pixels (complementary to the other level).
const BEGIN_MAIN = /* glsl */`
vec3 transformed = vec3(position) + treeWind();
#ifdef TREE_CARDS
  {
    // Leaf windows around nearby birds (leafWindows.js): the card's world centre and
    // half-size flag cards that may overlap a window; the fragment cuts per pixel.
#ifdef USE_INSTANCING
    mat4 cardM = modelMatrix * instanceMatrix;
    float cardR = length(aCard) * length(instanceMatrix[1].xyz);
#else
    mat4 cardM = modelMatrix;
    float cardR = length(aCard);
#endif
    vec3 wc = (cardM * vec4(transformed, 1.0)).xyz;
    vec3 wv = (cardM * vec4(transformed + cardOff, 1.0)).xyz;
${LEAF_WINDOW_VERTEX}
  }
  transformed += cardOff;
#endif
#ifdef USE_INSTANCING
{
  vec3 ipw = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float dd = distance(ipw.xz, cameraPosition.xz) * uLodScale;
  vTreeFade = vec2(clamp((dd - uFade.x) / (uFade.y - uFade.x), 0.0, 1.0),
                   1.0 - clamp((dd - uFade.z) / (uFade.w - uFade.z), 0.0, 1.0));
  if (vTreeFade.x <= 0.0 || vTreeFade.y <= 0.0) transformed = vec3(0.0);
}
#else
  vTreeFade = vec2(1.0);
#endif
`;

const DITHER = /* glsl */`
#include <clipping_planes_fragment>
${LEAF_WINDOW_FRAG}
{
  // Interleaved gradient noise: a stable screen-space dither for the LOD cross-fade.
  float tD = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (tD < 1.0 - vTreeFade.x || tD >= vTreeFade.y) discard;
}
`;

const COLOR = /* glsl */`
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3(1.0);
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor *= mix(vec3(1.0), instanceColor, 0.35 + 0.65 * aTree.y);
#endif
#if defined( USE_COLOR ) && defined( USE_INSTANCING )
  if (aTree.y > 0.0) {
    if (uSeasonAmt > 0.0) {
      vec2 ip = mod(modelMatrix[3].xz * 0.37 + instanceMatrix[3].xz, 997.0);
      float pick = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453);
      vec3 target = mix(uSeasonA, uSeasonB, step(0.5, pick));
      const vec3 L = vec3(0.2126, 0.7152, 0.0722);
      float ratio = clamp(dot(vColor, L) / max(dot(uSeasonRef, L), 1e-3), 0.35, 1.9);
      vColor = mix(vColor, target * ratio, uSeasonAmt);
    }
    // Leaves glinting as they turn in the wind.
    vColor *= 1.0 + 0.07 * uWind * sin(uTime * 5.3 + aTree.w * 31.0);
  }
#endif
`;

const SEASON_UNIFORMS = /* glsl */`
uniform vec3 uSeasonA;
uniform vec3 uSeasonB;
uniform vec3 uSeasonRef;
uniform float uSeasonAmt;
`;

// Distant cards: mipmapped alpha averages leaves with gaps and would fall under the
// threshold; scale it up with the mip level so a far crown stays a full mass.
const ALPHA_TEST = /* glsl */`
#if defined( TREE_CARDS ) && defined( USE_MAP )
  {
    vec2 tsz = vec2(textureSize(map, 0));
    vec2 ddx = dFdx(vMapUv * tsz), ddy = dFdy(vMapUv * tsz);
    float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
    diffuseColor.a *= 1.0 + mip * 0.3;
    if (diffuseColor.a < 0.5) discard;
  }
#endif
`;

const LEAF_LIGHT = /* glsl */`
#include <lights_lambert_pars_fragment>
uniform float uWrap;
uniform float uTrans;
uniform float uAmbient;
uniform float uSkyFill;
uniform float uRim;
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf
void RE_Direct_Leaf(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
  float ndl = dot(geometryNormal, directLight.direction);
  float wrap = saturate((ndl + uWrap) / (1.0 + uWrap));
  vec3 irradiance = wrap * directLight.color;
  // Sun behind the leaves: light comes through at the thin edges of the masses.
  float back = pow(saturate(dot(-geometryViewDir, directLight.direction)), 3.0);
  float edge = 1.0 - saturate(dot(geometryNormal, geometryViewDir));
  irradiance += directLight.color * back * (0.25 + 0.75 * edge) * uTrans * vec3(1.0, 1.05, 0.7);
  // A soft rim where the light grazes the crowns' edges (moonlit silhouettes at night).
  irradiance += directLight.color * pow(edge, 2.5) * saturate(ndl + 0.6) * uRim;
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert(material.diffuseColor);
}
`;

// Shaded wood and the insides of crowns get a little more sky light, so the forest
// stays soft and readable instead of going black under its own canopy.
const AMBIENT = /* glsl */`
reflectedLight.indirectDiffuse *= uAmbient;
#if NUM_HEMI_LIGHTS > 0
  // Cool sky light filling the undersides: shade reads blue-green, never black.
  float skyFill = uSkyFill * (0.6 - 0.4 * normal.y);
  reflectedLight.indirectDiffuse += BRDF_Lambert(diffuseColor.rgb) * hemisphereLights[0].skyColor * skyFill;
#endif
#include <aomap_fragment>
`;

function patchVertex(shader, main) {
  shader.vertexShader = HEADER + (main ? SEASON_UNIFORMS + LEAF_WINDOW_HEAD + 'varying vec2 vTreeFade;\n' : '') + shader.vertexShader
    .replace('#include <begin_vertex>', main ? BEGIN_MAIN : BEGIN);
  if (main) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', NORMAL)
      .replace('#include <color_vertex>', COLOR);
  }
  shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', ALPHA_TEST + '#include <alphatest_fragment>');
  if (main) {
    shader.fragmentShader = 'varying vec2 vTreeFade;\n' + LEAF_WINDOW_FRAG_HEAD + shader.fragmentShader
      .replace('#include <clipping_planes_fragment>', DITHER)
      .replace('#include <lights_lambert_pars_fragment>', LEAF_LIGHT)
      .replace('#include <aomap_fragment>', AMBIENT);
  }
}

/**
 * Builds the material pair of one tree kind and part.
 * @param {object} o
 * @param {boolean} o.cards  leaf cards (true) or wood (false)
 * @param {THREE.Texture} o.map
 * @param {object} o.uniforms  shared live uniforms: uTime, uWind, uWindDir, uThin, uFade (per detail), uLodScale,
 *   uSeasonA, uSeasonB, uSeasonRef, uSeasonAmt, plus per kind uBend, uFlutter, uFreq
 * @returns {{material: THREE.Material, depth: THREE.Material}}
 */
/** Rim light on leaf masses, shared by every tree (set per frame by the world: stronger at night). */
export const TREE_RIM = { value: 0.12 };

export function createTreeMaterial({ cards, map, uniforms }) {
  const defines = cards ? { TREE_CARDS: '' } : {};
  const all = {
    ...uniforms,
    ...(cards ? LEAF_WINDOWS : {}),
    uWrap: { value: cards ? 0.55 : 0.3 },
    uTrans: { value: cards ? 0.55 : 0 },
    uAmbient: { value: cards ? 1.15 : 1.6 },
    uSkyFill: { value: cards ? 0.55 : 0.22 },
    uRim: cards ? TREE_RIM : { value: 0 },
  };
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map,
    side: cards ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.defines = { ...defines };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, all);
    patchVertex(shader, true);
  };
  material.customProgramCacheKey = () => (cards ? 'wc-tree-leaf' : 'wc-tree-wood');

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: cards ? map : null });
  depth.defines = { ...defines };
  depth.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, all);
    patchVertex(shader, false);
  };
  depth.customProgramCacheKey = () => (cards ? 'wc-tree-leaf-depth' : 'wc-tree-wood-depth');
  if (cards) depth.side = THREE.DoubleSide;
  return { material, depth };
}
