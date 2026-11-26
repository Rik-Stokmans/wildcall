// Fixed-capacity particle pools for the birds' water effects (wake rings, bathing and
// diving splashes). Struct-of-arrays, swap-remove, no allocation after construction.
// Pure module: the three.js side only reads the arrays.

export class ParticlePool {
  /** @param {number} cap maximum live particles */
  constructor(cap) {
    this.cap = cap;
    this.n = 0;
    this.x = new Float32Array(cap); this.y = new Float32Array(cap); this.z = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap); this.vz = new Float32Array(cap);
    this.age = new Float32Array(cap); this.life = new Float32Array(cap); this.size = new Float32Array(cap);
  }

  /** Add a particle; returns false when the pool is full (the spawn is skipped). */
  spawn(x, y, z, vx, vy, vz, life, size) {
    if (this.n >= this.cap || !(life > 0)) return false;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size;
    return true;
  }

  /**
   * Advance by dt with gravity g (m/s², positive pulls down). Particles that outlive
   * their life, or fall below `floor` while descending, are removed.
   */
  step(dt, g = 0, floor = -Infinity) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      this.vy[i] -= g * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
      if (this.age[i] >= this.life[i] || (this.y[i] < floor && this.vy[i] < 0)) this._remove(i);
      else i++;
    }
  }

  /** 0..1 progress through a particle's life. */
  progress(i) { return this.age[i] / this.life[i]; }

  clear() { this.n = 0; }

  _remove(i) {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.z[i] = this.z[j];
    this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.size[i] = this.size[j];
  }
}

/**
 * Rate-based emission with a carried fraction: returns how many particles to emit
 * this frame for `rate` per second, storing the remainder in holder[key].
 */
export function emitCount(holder, key, rate, dt) {
  const acc = (holder[key] || 0) + Math.max(rate, 0) * dt;
  const n = Math.floor(acc);
  holder[key] = acc - n;
  return n;
}

/** Ripple ring radius and opacity at progress p (0..1) for a ring of final size s. */
export function rippleShape(p, s, out = { r: 0, a: 0 }) {
  const e = 1 - (1 - p) * (1 - p); // ease-out expansion
  out.r = s * (0.25 + 0.75 * e);
  out.a = 0.42 * (1 - p) * Math.min(1, p * 8);
  return out;
}
