// The bird outline (setting birdOutline): a soft, thin, warm-cream edge around every
// bird the player has a line of sight to — a painterly highlight, not a game marker.
//
// It is an inverted-hull shell: the bird's own skinned geometry drawn a second time,
// back faces only, each vertex pushed outwards along its screen-space normal by a
// fixed number of pixels. Where the shell sticks out past the bird's silhouette it
// shows as a thin rim. The shell is depth-tested against the scene like any other
// surface, so it is hidden wherever the bird is hidden: never through terrain, trunks
// or leaves — a leaf card in front of the bird covers its outline too. Legs and the
// nest twig get no shell (they would turn into thick cream sticks).
//
// One extra draw call per outlined bird; the shell shares the bird's geometry and
// skeleton. Strength and width per bird come from visibility.js outlineStyle().
import * as THREE from 'three';
import { BONE } from './mesh.js';

/** Warm cream by day (sRGB). */
export const OUTLINE_DAY = new THREE.Color().setStyle('#fff1cf', THREE.SRGBColorSpace);
/** A cool, dim moonlit grey-blue at night. */
export const OUTLINE_NIGHT = new THREE.Color().setStyle('#8d9bb5', THREE.SRGBColorSpace);
/** The live outline colour every bird shares (setOutlineDaylight). */
export const OUTLINE_COLOR = OUTLINE_DAY.clone();

/** Blend the shared outline colour for the light (0 night … 1 day). */
export function setOutlineDaylight(daylight) {
  const k = daylight < 0 ? 0 : daylight > 1 ? 1 : daylight;
  OUTLINE_COLOR.copy(OUTLINE_NIGHT).lerp(OUTLINE_DAY, k);
}

const VERT = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
uniform float uPx;      // width in device pixels
uniform vec2 uRes;      // drawing buffer size in device pixels
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  #include <fog_vertex>
#ifdef USE_SKINNING
  // Legs and the twig: no shell.
  if (skinIndex.x > ${BONE.legL - 0.5}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
#endif
  vec3 n = normalize(normalMatrix * objectNormal);
  vec2 d = (projectionMatrix * vec4(n, 0.0)).xy;
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(0.0);
  gl_Position.xy += d * uPx * 2.0 / uRes * gl_Position.w;
}
`;

const FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(uColor, uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

let base = null;
function baseMaterial() {
  if (!base) {
    base = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uPx: { value: 1.2 }, uRes: { value: new THREE.Vector2(1280, 720) },
        uColor: { value: OUTLINE_COLOR.clone() }, uAlpha: { value: 0 },
      }]),
      vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: true,
    });
    base.name = 'bird-outline';
  }
  return base;
}

/** Shared drawing-buffer size every outline reads (updated per frame by the birds module). */
export const OUTLINE_RES = new THREE.Vector2(1280, 720);

/**
 * Attach an outline shell to a bird view (from model.js instantiate). Idempotent.
 * Returns the shell mesh (hidden until styled).
 */
export function attachOutline(view) {
  if (view.outline) return view.outline;
  const mat = baseMaterial().clone();
  mat.uniforms.uRes.value = OUTLINE_RES; // shared object: one update serves every bird
  mat.uniforms.uColor.value = OUTLINE_COLOR;
  const bird = view.object;
  const shell = new THREE.SkinnedMesh(view.template.geometry, mat);
  shell.name = 'bird-outline';
  shell.bind(bird.skeleton, new THREE.Matrix4());
  shell.boundingSphere = bird.boundingSphere;
  shell.castShadow = false;
  shell.receiveShadow = false;
  shell.renderOrder = 1;
  shell.visible = false;
  bird.add(shell);
  view.outline = shell;
  return shell;
}

/** Style (or hide, alpha ≈ 0) a view's outline. px is in device pixels. */
export function styleOutline(view, alpha, px) {
  const o = view.outline;
  if (!o) return;
  const on = alpha > 0.01;
  o.visible = on;
  if (!on) return;
  o.material.uniforms.uAlpha.value = alpha;
  o.material.uniforms.uPx.value = px;
}

export function hideOutline(view) { if (view?.outline) view.outline.visible = false; }
