import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapYaw, angleDelta, clampPitch, headingDir, lookDir, dirToYawPitch, headingTo,
  cameraRotation, eulerYXZForward, applyMouse, angleFromAxis, PITCH_LIMIT, damp,
} from './look.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const nearV = (a, b, eps = 1e-9) => near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.z, b.z, eps);

test('heading directions match core.HeadingDir (north = −Z, east = +X)', () => {
  assert.ok(nearV(headingDir(0), { x: 0, y: 0, z: -1 }));
  assert.ok(nearV(headingDir(Math.PI / 2), { x: 1, y: 0, z: 0 }));
  assert.ok(nearV(headingDir(Math.PI), { x: 0, y: 0, z: 1 }, 1e-9));
  assert.ok(nearV(headingDir(3 * Math.PI / 2), { x: -1, y: 0, z: 0 }));
});

test('lookDir matches core.LookDir', () => {
  for (const [yaw, pitch] of [[0, 0], [0.7, 0.3], [2.5, -0.6], [5.9, 1.2]]) {
    const cp = Math.cos(pitch);
    assert.ok(nearV(lookDir(yaw, pitch), { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp }));
  }
  assert.ok(lookDir(0, 0.5).y > 0, 'positive pitch looks up');
});

test('camera mapping (YXZ, y = −yaw, x = pitch) looks along LookDir', () => {
  for (const [yaw, pitch] of [[0, 0], [Math.PI / 2, 0], [1.1, 0.4], [4.0, -0.9], [6.1, 1.3]]) {
    const r = cameraRotation(yaw, pitch);
    assert.equal(r.order, 'YXZ');
    assert.equal(r.y, -yaw);
    assert.equal(r.x, pitch);
    assert.ok(nearV(eulerYXZForward(r.x, r.y), lookDir(yaw, pitch), 1e-9), `yaw ${yaw} pitch ${pitch}`);
  }
});

test('direction → yaw/pitch round trip and headingTo', () => {
  for (const [yaw, pitch] of [[0.2, 0.1], [3.3, -0.4], [6.0, 0.9]]) {
    const r = dirToYawPitch(lookDir(yaw, pitch));
    assert.ok(near(r.yaw, yaw, 1e-9) && near(r.pitch, pitch, 1e-9));
  }
  assert.ok(near(headingTo({ x: 0, z: 0 }, { x: 0, z: -5 }), 0));
  assert.ok(near(headingTo({ x: 0, z: 0 }, { x: 5, z: 0 }), Math.PI / 2));
  assert.ok(near(headingTo({ x: 0, z: 0 }, { x: -5, z: 0 }), 3 * Math.PI / 2));
});

test('wrap and delta', () => {
  assert.ok(near(wrapYaw(-0.1), Math.PI * 2 - 0.1));
  assert.ok(near(wrapYaw(7), 7 - Math.PI * 2));
  assert.ok(near(angleDelta(6.2, 0.1), 0.1 + Math.PI * 2 - 6.2));
  assert.ok(near(angleDelta(0.1, 6.2), -(0.1 + Math.PI * 2 - 6.2)));
});

test('mouse look: sensitivity, invertY, scale, pitch clamp', () => {
  const a = applyMouse(0, 0, 100, 0, { sensitivity: 1 });
  const b = applyMouse(0, 0, 100, 0, { sensitivity: 2 });
  assert.ok(a.yaw > 0 && near(b.yaw, a.yaw * 2));
  const down = applyMouse(0, 0, 0, 50, {});
  assert.ok(down.pitch < 0, 'moving the mouse down looks down');
  const inv = applyMouse(0, 0, 0, 50, { invertY: true });
  assert.ok(near(inv.pitch, -down.pitch));
  const zoomed = applyMouse(0, 0, 100, 0, { scale: 0.1 });
  assert.ok(near(zoomed.yaw, a.yaw * 0.1));
  assert.equal(applyMouse(0, 0, 0, -1e6, {}).pitch, PITCH_LIMIT);
  assert.equal(clampPitch(-5), -PITCH_LIMIT);
  assert.ok(applyMouse(6.2, 0, 200, 0, {}).yaw < Math.PI * 2);
});

test('angle from view axis', () => {
  const eye = { x: 0, y: 0, z: 0 };
  assert.ok(near(angleFromAxis(eye, 0, 0, { x: 0, y: 0, z: -10 }), 0));
  assert.ok(near(angleFromAxis(eye, 0, 0, { x: 10, y: 0, z: 0 }), Math.PI / 2));
});

test('damp is frame-rate independent', () => {
  const one = damp(5, 1 / 30);
  const two = 1 - (1 - damp(5, 1 / 60)) ** 2;
  assert.ok(near(one, two, 1e-12));
});
