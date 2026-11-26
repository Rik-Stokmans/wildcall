// Base geometry of the ground-cover plants: one instance's worth of vertices whose
// attributes are shape parameters, not positions — the vertex shader in groundCover.js
// builds the actual blade, flower or frond from them. Pure: no three.js, no DOM.


/** A tuft of `blades` tapered blades with `segs` segments: position = (side, v, blade). */
export function tuftGeometry(blades, segs) {
  const rows = segs === 1 ? [0] : segs === 2 ? [0, 0.55] : [0, 0.4, 0.72];
  const per = rows.length * 2 + 1;
  const pos = new Float32Array(blades * per * 3);
  const idx = [];
  for (let b = 0; b < blades; b++) {
    const o = b * per;
    rows.forEach((v, r) => {
      pos.set([-0.5, v, b], (o + r * 2) * 3);
      pos.set([0.5, v, b], (o + r * 2 + 1) * 3);
    });
    pos.set([0, 1, b], (o + per - 1) * 3);
    for (let r = 0; r + 1 < rows.length; r++) {
      const a = o + r * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const t = o + (rows.length - 1) * 2;
    idx.push(t, t + 1, o + per - 1);
  }
  return { position: pos, index: new Uint16Array(idx) };
}

/** Three flowers: a stalk quad (part 0) and an octagonal head (rim part 1, centre part 2). */
export function flowerGeometry() {
  const pos = [], idx = [];
  for (let f = 0; f < 3; f++) {
    const s = pos.length / 3;
    pos.push(-0.5, 0, f, 0.5, 0, f, -0.5, 1, f, 0.5, 1, f);
    idx.push(s, s + 1, s + 3, s, s + 3, s + 2);
    const c = pos.length / 3;
    pos.push(0, 0, 20 + f);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      pos.push(Math.cos(a) * 1.08, Math.sin(a) * 1.08, 10 + f);
    }
    for (let k = 0; k < 8; k++) idx.push(c, c + 1 + k, c + 1 + ((k + 1) % 8));
  }
  return { position: new Float32Array(pos), index: new Uint16Array(idx) };
}

/** Seven fronds of `segs` segments: position = (side, v, frond). */
export function fernGeometry(segs = 5) {
  const pos = [], idx = [];
  for (let f = 0; f < 7; f++) {
    const o = pos.length / 3;
    for (let s = 0; s < segs; s++) {
      const v = s / segs;
      pos.push(-0.5, v, f, 0.5, v, f);
    }
    pos.push(0, 1, f);
    for (let s = 0; s + 1 < segs; s++) {
      const a = o + s * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    const t = o + (segs - 1) * 2;
    idx.push(t, t + 1, o + segs * 2);
  }
  return { position: new Float32Array(pos), index: new Uint16Array(idx) };
}
