// Pure view maths: yaw/pitch conventions, mouse look and the three.js camera mapping.
//
// Pinned conventions (internal/core/types.go header, docs/contract.md §2):
//   yaw is a compass heading, 0 = north (−Z), +π/2 = east (+X)
//   HeadingDir(yaw)      = (sin yaw, 0, −cos yaw)
//   LookDir(yaw, pitch)  = (sin yaw·cos pitch, sin pitch, −cos yaw·cos pitch)
//   camera.rotation.order = 'YXZ', rotation.y = −yaw, rotation.x = pitch

export const TAU = Math.PI * 2;
export const PITCH_LIMIT = 1.45;            // ~83°: never quite straight up/down
export const RAD_PER_PIXEL = 0.0022;        // at sensitivity 1 and naked-eye FOV

/** Wrap an angle into [0, 2π). */
export function wrapYaw(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** Shortest signed difference b − a in (−π, π]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export function clampPitch(p) {
  return p < -PITCH_LIMIT ? -PITCH_LIMIT : p > PITCH_LIMIT ? PITCH_LIMIT : p;
}

/** core.HeadingDir */
export function headingDir(yaw) {
  return { x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
}

/** core.LookDir */
export function lookDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Inverse of lookDir for a (not necessarily unit) direction: {yaw, pitch}. */
export function dirToYawPitch(d) {
  const h = Math.hypot(d.x, d.z);
  return { yaw: wrapYaw(Math.atan2(d.x, -d.z)), pitch: Math.atan2(d.y, h) };
}

/** core.HeadingTo: compass heading from a to b (0..2π). */
export function headingTo(a, b) {
  return wrapYaw(Math.atan2(b.x - a.x, -(b.z - a.z)));
}

/** The Euler angles to give a three.js camera (order 'YXZ'). */
export function cameraRotation(yaw, pitch) {
  return { order: 'YXZ', x: pitch, y: -yaw, z: 0 };
}

/**
 * Forward vector of an object rotated with Euler order YXZ (x = pitch, y = rotY):
 * R = Ry · Rx applied to the default forward (0, 0, −1). Used by the tests to prove that
 * cameraRotation() and lookDir() agree, without importing three.js.
 */
export function eulerYXZForward(x, y) {
  // Rx · (0,0,−1) = (0, sin x, −cos x)
  const vx = 0, vy = Math.sin(x), vz = -Math.cos(x);
  // Ry · v
  return { x: vx * Math.cos(y) + vz * Math.sin(y), y: vy, z: -vx * Math.sin(y) + vz * Math.cos(y) };
}

/**
 * Apply a mouse delta (pixels) to a yaw/pitch pair.
 * @param {object} opts {sensitivity, invertY, scale}  scale < 1 slows the view when zoomed
 * @returns {{yaw:number, pitch:number}}
 */
export function applyMouse(yaw, pitch, dx, dy, opts = {}) {
  const k = RAD_PER_PIXEL * (opts.sensitivity > 0 ? opts.sensitivity : 1) * (opts.scale > 0 ? opts.scale : 1);
  const inv = opts.invertY ? -1 : 1;
  return {
    yaw: wrapYaw(yaw + dx * k),
    // Mouse down (dy > 0) looks down unless inverted.
    pitch: clampPitch(pitch - dy * k * inv),
  };
}

/** Angle (radians) between the view axis (yaw, pitch) and the direction from eye to p. */
export function angleFromAxis(eye, yaw, pitch, p) {
  const d = lookDir(yaw, pitch);
  const vx = p.x - eye.x, vy = p.y - eye.y, vz = p.z - eye.z;
  const len = Math.hypot(vx, vy, vz);
  if (len < 1e-6) return 0;
  const c = (d.x * vx + d.y * vy + d.z * vz) / len;
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
}

/**
 * Exponential smoothing factor for frame-rate independent damping: lerp by this much
 * per frame to close (1 − 1/e) of the gap every 1/rate seconds.
 */
export function damp(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}
