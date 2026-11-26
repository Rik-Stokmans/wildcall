import test from 'node:test';
import assert from 'node:assert/strict';
import { worldToScreen, screenToWorld, viewRect, panBy, zoomAt, wheelFactor, scaleBar, edgeArrow, viewFor, MIN_SCALE, MAX_SCALE } from './mapmath.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test('world/screen round trip', () => {
  const v = { cx: 120, cz: -340, scale: 0.7 };
  const s = worldToScreen(v, 1000, 600, 200, -300);
  const w = screenToWorld(v, 1000, 600, s.x, s.y);
  near(w.x, 200); near(w.z, -300);
  const c = worldToScreen(v, 1000, 600, 120, -340);
  assert.deepEqual([c.x, c.y], [500, 300]);
});

test('north is up: smaller z is higher on screen', () => {
  const v = { cx: 0, cz: 0, scale: 1 };
  assert.ok(worldToScreen(v, 100, 100, 0, -10).y < worldToScreen(v, 100, 100, 0, 10).y);
  assert.ok(worldToScreen(v, 100, 100, 10, 0).x > worldToScreen(v, 100, 100, -10, 0).x);
});

test('panning moves the world with the cursor', () => {
  const v = panBy({ cx: 0, cz: 0, scale: 2 }, 100, -40);
  near(v.cx, -50); near(v.cz, 20);
});

test('zoom keeps the point under the cursor fixed and clamps', () => {
  const v = { cx: 10, cz: 20, scale: 0.5 };
  const before = screenToWorld(v, 800, 600, 600, 150);
  const z = zoomAt(v, 800, 600, 600, 150, 2);
  near(z.scale, 1);
  const after = screenToWorld(z, 800, 600, 600, 150);
  near(before.x, after.x); near(before.z, after.z);
  assert.equal(zoomAt(v, 800, 600, 0, 0, 1e9).scale, MAX_SCALE);
  assert.equal(zoomAt(v, 800, 600, 0, 0, 1e-9).scale, MIN_SCALE);
});

test('wheel factor is symmetric', () => {
  near(wheelFactor(100) * wheelFactor(-100), 1);
  assert.ok(wheelFactor(-100) > 1);
});

test('view rect covers the viewport', () => {
  const r = viewRect({ cx: 0, cz: 0, scale: 2 }, 400, 200);
  assert.deepEqual(r, { x0: -100, z0: -50, x1: 100, z1: 50 });
});

test('scale bar picks round numbers near the target width', () => {
  const b = scaleBar(0.5, 100);
  assert.equal(b.metres, 200);
  assert.equal(b.px, 100);
  assert.equal(b.label, '200 m');
  assert.equal(scaleBar(0.05, 100).label, '2 km');
  assert.equal(scaleBar(2, 100).metres, 50);
});

test('edge arrow pins off-screen targets to the border', () => {
  assert.equal(edgeArrow(500, 300, 1000, 600, 30), null);
  const a = edgeArrow(3000, 300, 1000, 600, 30);
  near(a.x, 970); near(a.y, 300); near(a.angle, Math.PI / 2);
  const b = edgeArrow(500, -2000, 1000, 600, 30);
  near(b.y, 30); near(b.x, 500); near(b.angle, 0);
  const c = edgeArrow(-5000, 5000, 1000, 600, 30);
  assert.ok(c.x >= 30 && c.y <= 570);
});

test('viewFor fits a radius', () => {
  const v = viewFor(5, 6, 1000, 600, 300);
  near(v.scale, 1); assert.equal(v.cx, 5);
});
