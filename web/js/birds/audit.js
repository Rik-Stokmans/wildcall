// Bird visibility audit (ctx.birds.visibilityAudit): measures, instead of guessing, how
// much of each bird in view the player can actually see. Debug / tuning tool, computed
// on demand (never per frame): it renders three extra frames into a small offscreen
// target and reads them back.
//
//   1. the scene without birds (and without anything parented to the camera), for its
//      depth — leaf cards, grass, trunks and terrain exactly as the player sees them,
//      including the leaf windows and grass gaps;
//   2. every audited bird as a flat id colour, depth-tested against that scene depth →
//      the pixels actually visible;
//   3. the same with the depth cleared → the pixels it would cover if nothing hid it
//      (birds still hide each other, which is rare and real).
// The pure summary lives in auditLogic.js.
import * as THREE from 'three';
import { countIds, visibleFraction, summariseAudit } from './auditLogic.js';

const MAX_IDS = 254;

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {THREE.Camera} o.camera
 * @param {THREE.Object3D} o.root      the birds group
 * @param {() => object[]} o.candidates  [{id, sp, act, dist, object, length (drawn, m)}] — full models only
 * @param {(on: boolean) => void} [o.setAuditMode] hide decorations (outlines) while auditing
 */
export function createAudit({ renderer, scene, camera, root, candidates, setAuditMode }) {
  let rt = null, pixels = null;
  const counts = new Uint32Array(MAX_IDS + 2);
  const mats = [];
  const frustum = new THREE.Frustum();
  const m4 = new THREE.Matrix4();
  const v3 = new THREE.Vector3();
  const sphere = new THREE.Sphere();

  function idMaterial(i) {
    let m = mats[i];
    if (!m) {
      m = new THREE.MeshBasicMaterial({ fog: false, toneMapped: false });
      m.color.setRGB((i + 1) / 255, 0, 0, THREE.LinearSRGBColorSpace);
      mats[i] = m;
    }
    return m;
  }

  /**
   * @param {{range?: number, width?: number, height?: number, minFrac?: number, minPx?: number, list?: boolean}} [opt]
   * @returns {{entries: object[], summary: object, specks: number, ms: number}}
   */
  function run(opt = {}) {
    const t0 = performance.now();
    const range = opt.range ?? 60;
    const W = opt.width || 1280, H = opt.height || 720;
    if (!rt || rt.width !== W || rt.height !== H) {
      rt?.dispose();
      rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true, samples: 0 });
      pixels = new Uint8Array(W * H * 4);
    }
    camera.updateMatrixWorld();
    const aspect = camera.aspect;
    // Measure at the requested aspect (1280×720 by default), whatever the window is.
    if (camera.isPerspectiveCamera) { camera.aspect = W / H; camera.updateProjectionMatrix(); }
    m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m4);
    const camPos = v3.setFromMatrixPosition(camera.matrixWorld).clone();

    // Who is audited: full models within range whose body is inside the frustum.
    const items = [];
    for (const c of candidates()) {
      if (!(c.dist <= range) || !c.object) continue;
      c.object.updateMatrixWorld();
      sphere.center.setFromMatrixPosition(c.object.matrixWorld);
      sphere.center.y += (c.height || 0) * 0.5;
      sphere.radius = Math.max(0.05, (c.length || 0.15) * 0.4);
      if (!frustum.intersectsSphere(sphere)) continue;
      if (items.length >= MAX_IDS) break;
      items.push(c);
    }

    // Save renderer state.
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevBg = scene.background;
    const vis = scene.children.map((o) => o.visible);
    const camKids = camera.children.map((o) => o.visible);
    const objVis = items.map((c) => c.object.visible);
    const objMat = items.map((c) => c.object.material);
    const allBirds = root.children.map((o) => o.visible);
    setAuditMode?.(true);
    const entries = [];
    try {
      renderer.shadowMap.autoUpdate = false;
      renderer.autoClear = false;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);

      // 1. the scene's depth (birds, their effects and the held tools hidden).
      root.visible = false;
      for (const o of scene.children) if (o.name === 'birds-fx') o.visible = false;
      for (const o of camera.children) o.visible = false;
      renderer.clear(true, true, true);
      renderer.render(scene, camera);

      // 2. ids against that depth.
      scene.background = null;
      for (const o of scene.children) o.visible = o === root;
      root.visible = true;
      for (const o of root.children) o.visible = false;
      items.forEach((c, i) => { c.object.visible = true; c.object.material = idMaterial(i); });
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, pixels);
      const visible = Array.from(countIds(pixels, counts));

      // 3. ids with nothing in front.
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, pixels);
      const full = countIds(pixels, counts);

      items.forEach((c, i) => {
        const pxFull = full[i + 1], pxVisible = Math.min(visible[i + 1], pxFull);
        const angle = (2 * Math.atan((c.length || 0) / 2 / Math.max(c.dist, 1e-3)) * 180) / Math.PI;
        entries.push({
          id: c.id, sp: c.sp, spId: c.spId, act: c.act, flags: c.flags,
          dist: round(c.dist, 1), angle: round(angle, 3), scale: round(c.scale ?? 1, 2),
          pxFull, pxVisible, frac: round(visibleFraction(pxVisible, pxFull), 3),
        });
      });
    } finally {
      items.forEach((c, i) => { c.object.material = objMat[i]; c.object.visible = objVis[i]; });
      root.children.forEach((o, i) => { o.visible = allBirds[i]; });
      scene.children.forEach((o, i) => { o.visible = vis[i]; });
      camera.children.forEach((o, i) => { o.visible = camKids[i]; });
      root.visible = true;
      scene.background = prevBg;
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAuto;
      renderer.setClearColor(prevClear, prevAlpha);
      renderer.shadowMap.autoUpdate = prevShadow;
      if (camera.isPerspectiveCamera && camera.aspect !== aspect) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
      setAuditMode?.(false);
    }
    entries.sort((a, b) => a.dist - b.dist);
    const summary = summariseAudit(entries, { minFrac: opt.minFrac, minPx: opt.minPx });
    return { entries, summary, ms: Math.round(performance.now() - t0) };
  }

  return { run, dispose() { rt?.dispose(); for (const m of mats) m?.dispose(); } };
}

function round(v, k) { const p = 10 ** k; return Math.round(v * p) / p; }
