// The custom passes of the post pipeline (see index.js for the order):
//   ScenePass       renders the scene into an MSAA HDR target with a depth texture
//   ShaftsPass      sun occlusion mask from depth + two radial-blur passes (low res)
//   AtmospherePass  depth-based aerial perspective, low-ground mist, warm in-scatter
//                   towards the sun, rain curtains, wet darkening, cloud shadows
//   FinalPass       adds shafts, ACES tone mapping, filmic grade (lift/gamma/gain,
//                   saturation, contrast), gentle vignette, sRGB output, dither
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Shared GLSL: view ray / world position from the depth buffer.
const RECON = /* glsl */`
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
// Returns the world position; w = 1 for sky (nothing drawn with depth there).
vec4 worldAt(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  vec4 ndc = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 vp = uProjInv * ndc;
  vp.xyz /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  return vec4(wp, d >= 0.999999 ? 1.0 : 0.0);
}`;

const NOISE = /* glsl */`
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm2(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.1 + 7.3) * 0.3 + vnoise(p * 4.3 + 1.9) * 0.15;
}`;

function quadMaterial(uniforms, fragmentShader, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms, vertexShader: QUAD_VERT, fragmentShader,
    depthTest: false, depthWrite: false, toneMapped: false, ...extra,
  });
}

function reconUniforms() {
  return {
    tDepth: { value: null },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
  };
}
function setRecon(u, camera, depthTexture) {
  u.tDepth.value = depthTexture;
  u.uProjInv.value.copy(camera.projectionMatrixInverse);
  u.uCamWorld.value.copy(camera.matrixWorld);
  u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
}

// ---------------------------------------------------------------------------

/** Renders the scene into its own multisampled HDR target that carries depth. */
export class ScenePass extends Pass {
  constructor(scene, camera, samples) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, samples, depthTexture, depthBuffer: true,
    });
    this.target.texture.name = 'fx.scene';
  }
  setSamples(n) { if (this.target.samples !== n) { this.target.samples = n; this.target.dispose(); } }
  setSize(w, h) { this.target.setSize(w, h); }
  render(renderer) {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
  }
  dispose() { this.target.dispose(); this.target.depthTexture?.dispose(); }
}

// ---------------------------------------------------------------------------

const MASK_FRAG = /* glsl */`
${RECON}
uniform vec3 uSunDir;
varying vec2 vUv;
void main() {
  vec4 w = worldAt(vUv);
  vec3 v = normalize(w.xyz - uCamPos);
  float s = max(dot(v, uSunDir), 0.0);
  // Bright core around the disc plus a wider soft skirt.
  float m = (pow(s, 60.0) * 1.2 + pow(s, 10.0) * 0.25) * w.w;
  gl_FragColor = vec4(m, m, m, 1.0);
}`;

const RADIAL_FRAG = /* glsl */`
uniform sampler2D tInput;
uniform vec2 uSun;
uniform float uSpan;
uniform float uDecay;
varying vec2 vUv;
#define N 28
void main() {
  vec2 delta = (vUv - uSun) * uSpan / float(N);
  vec2 uv = vUv;
  float w = 1.0, sum = 0.0, norm = 0.0;
  // Per-pixel jitter breaks up banding from the finite sample count.
  float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  uv -= delta * j;
  for (int i = 0; i < N; i++) {
    sum += texture2D(tInput, uv).r * w;
    norm += w;
    w *= uDecay;
    uv -= delta;
  }
  float r = sum / norm;
  gl_FragColor = vec4(r, r, r, 1.0);
}`;

/** Screen-space light shafts: an occlusion mask (sky near the sun) blurred radially. */
export class ShaftsPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.needsSwap = false;
    this.depthTexture = null;
    this.enabled = true;
    this.active = false; // false when the shafts are too weak to bother
    this.divisor = 4;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.maskU = { ...reconUniforms(), uSunDir: { value: new THREE.Vector3(0, 1, 0) } };
    this.mask = quadMaterial(this.maskU, MASK_FRAG);
    this.blurU = { tInput: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uSpan: { value: 1 }, uDecay: { value: 0.96 } };
    this.blur = quadMaterial(this.blurU, RADIAL_FRAG);
    this.fsQuad = new FullScreenQuad(this.mask);
  }
  get texture() { return this.rtB.texture; }
  setSize(w, h) {
    const d = this.divisor;
    this.rtA.setSize(Math.max(1, Math.round(w / d)), Math.max(1, Math.round(h / d)));
    this.rtB.setSize(Math.max(1, Math.round(w / d)), Math.max(1, Math.round(h / d)));
  }
  /** @param {THREE.Vector3} sunDir @param {number} sx @param {number} sy sun position in uv */
  setSun(sunDir, sx, sy) {
    this.maskU.uSunDir.value.copy(sunDir);
    this.blurU.uSun.value.set(sx, sy);
  }
  render(renderer) {
    if (!this.active) return;
    setRecon(this.maskU, this.camera, this.depthTexture);
    this.fsQuad.material = this.mask;
    renderer.setRenderTarget(this.rtA);
    this.fsQuad.render(renderer);
    // Two radial passes: long streaks, then a short smoothing pass.
    this.fsQuad.material = this.blur;
    this.blurU.tInput.value = this.rtA.texture; this.blurU.uSpan.value = 0.85; this.blurU.uDecay.value = 0.965;
    renderer.setRenderTarget(this.rtB);
    this.fsQuad.render(renderer);
    this.blurU.tInput.value = this.rtB.texture; this.blurU.uSpan.value = 0.22; this.blurU.uDecay.value = 0.99;
    renderer.setRenderTarget(this.rtA);
    this.fsQuad.render(renderer);
    // Result lives in rtA; swap so `texture` (rtB) is the final one.
    const t = this.rtA; this.rtA = this.rtB; this.rtB = t;
  }
  dispose() { this.rtA.dispose(); this.rtB.dispose(); this.mask.dispose(); this.blur.dispose(); this.fsQuad.dispose(); }
}

// ---------------------------------------------------------------------------

const ATMOS_FRAG = /* glsl */`
${RECON}
${NOISE}
uniform sampler2D tDiffuse;
uniform vec3 uAerial;
uniform float uAerialAmt;
uniform float uAerialK;
uniform float uAerialH;
uniform vec3 uMist;
uniform float uMistAmt;
uniform float uMistH;
uniform float uMistLevel;
uniform vec3 uInscatter;
uniform float uInscatterAmt;
uniform vec3 uSunDir;
uniform float uFogFar;
uniform float uCurtain;
uniform vec3 uCurtainColor;
uniform float uWet;
uniform float uCloudShadow;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
uniform float uTime;
varying vec2 vUv;

// Optical depth through a layer whose density is min(1, exp(-y/H)) (y relative to the
// layer's base), along a straight segment from height y0 to y1 of length d.
float layerDepth(float y0, float y1, float d, float H) {
  float lo = min(y0, y1), hi = max(y0, y1);
  float span = hi - lo;
  if (span < 0.01) return d * min(1.0, exp(-lo / H));
  float under = max(0.0, min(hi, 0.0) - lo);
  float over = H * (exp(-max(lo, 0.0) / H) - exp(-max(hi, 0.0) / H));
  return d * (under + over) / span;
}

// True when the point at distance d along the view ray lies below the water plane.
bool end0Below(vec3 o, vec3 v, float d) { return o.y > 0.0 && o.y + v.y * d < 0.0; }

void main() {
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  vec4 w = worldAt(vUv);
  bool sky = w.w > 0.5;
  vec3 ray = w.xyz - uCamPos;
  float dist = length(ray);
  vec3 v = ray / max(dist, 1e-4);
  // Sky (and clouds, which do not write depth) is treated as seen through the whole
  // fogged distance, so the far terrain ring and the horizon get the same haze.
  float d = sky ? uFogFar : dist;
  // Water does not write depth: under a pond or the sea the depth buffer holds the bed.
  // The air ends at the water surface (y = 0), or ponds — always the lowest ground —
  // fill with pale low-ground mist and read milky blue-grey from a bank.
  if (!sky && v.y < -1e-3 && end0Below(uCamPos, v, d)) d = min(d, uCamPos.y / -v.y);
  vec3 end = uCamPos + v * d;
  float toSun = max(dot(v, uSunDir), 0.0);
  float phase = pow(toSun, 6.0);

  if (!sky) {
    // Wet ground: darker and a little richer near the player.
    float wet = uWet * (1.0 - smoothstep(60.0, 220.0, d));
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, mix(vec3(l), col, 1.15), wet * 0.6) * (1.0 - 0.28 * wet);
    // Soft cloud shadows drifting over the land (sun direction projected up to the
    // cloud layer, a noise field thresholded by the cloud cover).
    if (uCloudShadow > 0.001) {
      vec2 p = end.xz + uSunDir.xz / max(uSunDir.y, 0.2) * max(0.0, 320.0 - (end.y - uCamPos.y));
      float n = fbm2(p / 520.0 + uCloudOffset);
      float sh = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.22, n);
      col *= 1.0 - uCloudShadow * sh;
    }
  }

  // Aerial perspective: a blue haze thickening with distance, thinner up high, which
  // glows warm in the direction of the sun.
  float optA = layerDepth(uCamPos.y - uMistLevel, end.y - uMistLevel, d, uAerialH);
  float aer = uAerialAmt * (1.0 - exp(-optA * uAerialK));
  vec3 aerCol = mix(uAerial, uInscatter, clamp(phase * uInscatterAmt, 0.0, 0.7));
  col = mix(col, aerCol, aer);
  col += uInscatter * pow(toSun, 3.0) * uInscatterAmt * aer * 0.18;

  // Rain curtains: grey veils hanging in the distance, banded by azimuth, drifting.
  if (uCurtain > 0.001) {
    float az = atan(v.x, v.z);
    float band = vnoise(vec2(az * 4.0 + uTime * 0.02, 3.1)) * 0.6 + vnoise(vec2(az * 11.0 - uTime * 0.035, 8.7)) * 0.4;
    band = smoothstep(0.25, 0.8, band);
    float far = smoothstep(30.0, 220.0, d);
    float low = 1.0 - smoothstep(0.02, 0.4, v.y);
    col = mix(col, uCurtainColor, uCurtain * far * low * (0.22 + 0.4 * band));
  }

  // Mist pooling in low ground, lit by the sun from behind.
  float optM = layerDepth(uCamPos.y - uMistLevel, end.y - uMistLevel, d, uMistH) * uMistAmt / 150.0;
  float mist = min(0.96, 1.0 - exp(-optM));
  vec3 mistCol = mix(uMist, uInscatter, clamp(phase * uInscatterAmt * 0.6, 0.0, 1.0));
  col = mix(col, mistCol, mist);

  gl_FragColor = vec4(col, 1.0);
}`;

/** Depth-based atmosphere. Reads the scene target, writes the composer chain. */
export class AtmospherePass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.source = null; // ScenePass target
    this.u = {
      ...reconUniforms(),
      tDiffuse: { value: null },
      uAerial: { value: new THREE.Color() }, uAerialAmt: { value: 0 }, uAerialK: { value: 0.005 }, uAerialH: { value: 200 },
      uMist: { value: new THREE.Color() }, uMistAmt: { value: 0 }, uMistH: { value: 6 }, uMistLevel: { value: 0 },
      uInscatter: { value: new THREE.Color() }, uInscatterAmt: { value: 0 }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uFogFar: { value: 400 }, uCurtain: { value: 0 }, uCurtainColor: { value: new THREE.Color() },
      uWet: { value: 0 }, uCloudShadow: { value: 0 }, uCloudCover: { value: 0 }, uCloudOffset: { value: new THREE.Vector2() },
      uTime: { value: 0 },
    };
    this.material = quadMaterial(this.u, ATMOS_FRAG);
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer) {
    const src = this.source;
    this.u.tDiffuse.value = src.texture;
    setRecon(this.u, this.camera, src.depthTexture);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

// ---------------------------------------------------------------------------

const FINAL_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tShafts;
uniform vec3 uShaftColor;
uniform float uShaftAmt;
uniform float uExposure;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uSat;
uniform float uContrast;
uniform float uVignette;
uniform vec2 uRes;
varying vec2 vUv;

// three.js r170 ACESFilmicToneMapping (same curve as the renderer uses without post).
vec3 wcRrtOdtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFilmic(vec3 color) {
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = wcRrtOdtFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 srgbOETF(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}

void main() {
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  col += uShaftColor * texture2D(tShafts, vUv).r * uShaftAmt;
  col = srgbOETF(acesFilmic(col));
  // Grade (display space): lift / gamma / gain, saturation, contrast.
  col = col * uGain + uLift * (1.0 - col);
  col = pow(max(col, 0.0), 1.0 / uGamma);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);
  col = (col - 0.5) * uContrast + 0.5;
  // Gentle vignette (aspect-correct).
  vec2 q = vUv - 0.5;
  q.x *= uRes.x / uRes.y;
  col *= 1.0 - uVignette * smoothstep(0.3, 1.05, length(q) * 1.2);
  // Dither away banding in the sky gradients.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Tone map + grade + vignette to the screen. */
export class FinalPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.shaftsPass = null; // ShaftsPass whose result is added
    this.u = {
      tDiffuse: { value: null }, tShafts: { value: null },
      uShaftColor: { value: new THREE.Color() }, uShaftAmt: { value: 0 },
      uExposure: { value: 1 },
      uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSat: { value: 1 }, uContrast: { value: 1 }, uVignette: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    };
    this.material = quadMaterial(this.u, FINAL_FRAG);
    this.fsQuad = new FullScreenQuad(this.material);
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
  }
  setSize(w, h) { this.u.uRes.value.set(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    this.u.tDiffuse.value = readBuffer.texture;
    const sp = this.shaftsPass;
    const on = sp && sp.enabled && sp.active && this.u.uShaftAmt.value > 0;
    this.u.tShafts.value = on ? sp.texture : this.black;
    if (!on) this.u.uShaftAmt.value = 0;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }
  dispose() { this.material.dispose(); this.fsQuad.dispose(); this.black.dispose(); }
}
