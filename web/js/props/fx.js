// Small animated effects owned by props: chimney smoke puffs and the soft glint on
// collectibles. Sprites only, a handful each, updated only while near the player.
import * as THREE from 'three';
import { materials } from './mesh.js';

const PUFFS = 7;
const LIFE = 7; // seconds a puff takes to rise and fade

/**
 * Chimney smoke: soft sprites rising from a local point of `parent`, drifting with the
 * wind (given in world space; the parent's heading turns it into the local frame).
 */
export function createSmoke(parent, lx, ly, lz, seed = 0) {
  const base = materials().smoke;
  const puffs = [];
  for (let i = 0; i < PUFFS; i++) {
    const m = base.clone();
    const sp = new THREE.Sprite(m);
    sp.name = 'props-smoke';
    sp.renderOrder = 10;
    parent.add(sp);
    puffs.push({ sp, m, off: (i / PUFFS) * LIFE + seed * 0.37, jitter: ((i * 7919 + seed * 31) % 100) / 100 - 0.5 });
  }
  return {
    /**
     * @param {number} t seconds
     * @param {number} wind 0..1
     * @param {number} yaw parent's compass heading (to turn the world wind into local)
     * @param {number} light 0..1 daylight (unlit sprites are dimmed at night)
     */
    update(t, wind, yaw, light) {
      // prevailing wind blows towards the north-east (+x, −z), as in the sky module
      const wx = 0.8 * (0.25 + wind * 1.6), wz = -0.6 * (0.25 + wind * 1.6);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const dx = wx * c + wz * s, dz = -wx * s + wz * c;
      const grey = 0.3 + 0.7 * light;
      for (const p of puffs) {
        const age = (t + p.off) % LIFE;
        const k = age / LIFE;
        const rise = age * (0.75 - wind * 0.35);
        p.sp.position.set(lx + dx * age + p.jitter * 0.3 * k, ly + rise, lz + dz * age + p.jitter * 0.25 * k);
        const size = 0.45 + k * 2.2;
        p.sp.scale.set(size, size, 1);
        p.m.opacity = 0.42 * (1 - k) * Math.min(1, k * 8);
        p.m.color.setRGB(0.86 * grey, 0.85 * grey, 0.82 * grey);
        p.m.rotation = p.jitter * 3 + k * 0.8;
      }
    },
    set visible(v) { for (const p of puffs) p.sp.visible = v; },
    dispose() {
      for (const p of puffs) { parent.remove(p.sp); p.m.dispose(); }
    },
  };
}

/** A four-pointed glint sprite (additive). Opacity is driven by the caller. */
export function createGlint(parent) {
  const m = new THREE.SpriteMaterial({
    map: materials().spark, color: 0xfff2cc, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0,
  });
  const sp = new THREE.Sprite(m);
  sp.name = 'props-glint';
  sp.scale.set(0.45, 0.45, 1);
  sp.visible = false;
  sp.renderOrder = 11;
  parent.add(sp);
  return {
    sprite: sp,
    /** @param {number} amount 0..1 @param {number} t seconds @param {number} phase */
    update(amount, t, phase) {
      const tw = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.3 + phase)) ** 3;
      m.opacity = amount * tw;
      m.rotation = t * 0.4 + phase;
      const s = 0.3 + 0.2 * tw;
      sp.scale.set(s, s, 1);
      sp.visible = m.opacity > 0.01;
    },
    dispose() { parent.remove(sp); m.dispose(); },
  };
}
