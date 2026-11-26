import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParticlePool, emitCount, rippleShape } from './particles.js';

test('particles live for their lifetime and are removed after', () => {
  const p = new ParticlePool(4);
  assert.ok(p.spawn(0, 0, 0, 0, 0, 0, 1, 1));
  assert.ok(p.spawn(0, 0, 0, 0, 0, 0, 2, 1));
  p.step(1.5);
  assert.equal(p.n, 1);
  assert.equal(p.life[0], 2, 'swap-remove kept the survivor');
  p.step(1);
  assert.equal(p.n, 0);
  assert.equal(p.spawn(0, 0, 0, 0, 0, 0, 0, 1), false, 'zero life rejected');
});

test('capacity is respected', () => {
  const p = new ParticlePool(2);
  assert.ok(p.spawn(0, 0, 0, 0, 0, 0, 1, 1));
  assert.ok(p.spawn(0, 0, 0, 0, 0, 0, 1, 1));
  assert.equal(p.spawn(0, 0, 0, 0, 0, 0, 1, 1), false);
  p.clear();
  assert.equal(p.n, 0);
});

test('droplets follow a ballistic arc and vanish below the water', () => {
  const p = new ParticlePool(1);
  p.spawn(0, 0, 0, 1, 2, 0, 5, 0.01);
  for (let i = 0; i < 10; i++) p.step(0.01, 9.81, -0.05);
  assert.ok(p.y[0] > 0 && p.x[0] > 0.09);
  for (let i = 0; i < 100; i++) p.step(0.01, 9.81, -0.05);
  assert.equal(p.n, 0);
});

test('emitCount carries fractions across frames', () => {
  const h = {};
  let total = 0;
  for (let i = 0; i < 60; i++) total += emitCount(h, 'k', 10, 1 / 60);
  assert.ok(total === 9 || total === 10);
  assert.equal(emitCount(h, 'k', -5, 1), 0);
});

test('ripples expand and fade', () => {
  const a = rippleShape(0.05, 1), b = rippleShape(0.5, 1), c = rippleShape(1, 1);
  assert.ok(a.r < b.r && b.r < c.r);
  assert.ok(Math.abs(c.r - 1) < 1e-12);
  assert.equal(c.a, 0);
  assert.ok(b.a > 0);
  assert.equal(rippleShape(0, 1).a, 0, 'fades in');
});
