// The little physical moment of picking (task c-field): the view dips towards the
// plant and comes back up, a puff of leaves and fruit bits pops from the plant, and a
// soft rustle-and-snap plays. Everything is cheap and allocation-free per frame.
import * as THREE from 'three';
import { dipCurve } from './logic.js';

const DIP_TIME = 0.62;   // seconds for the crouch-reach-and-rise
const PUFF_N = 14;

export function createPickFx(ctx) {
  const { scene, camera } = ctx;
  let dipT = -1;
  let dipPitch = 0;

  // particles: little leaves/berries flicking up and falling
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
  const puff = new THREE.InstancedMesh(geo, mat, PUFF_N);
  puff.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PUFF_N * 3), 3);
  puff.count = 0;
  puff.frustumCulled = false;
  scene.add(puff);
  const parts = Array.from({ length: PUFF_N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), s: 0, life: 0 }));
  let puffLeft = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const c = new THREE.Color();
  const eul = new THREE.Euler();

  function sound(kind) {
    const ac = ctx.audio?.context;
    if (!ac || ac.state !== 'running') return;
    const st = ctx.state.settings || {};
    const vol = (st.volMaster ?? 0.8) * (st.volUI ?? 0.6) * (kind === 'fail' ? 0.25 : 0.5);
    if (vol <= 0.001) return;
    const t0 = ac.currentTime + 0.01;
    const out = ac.createGain();
    out.gain.value = vol;
    out.connect(ac.destination);
    // rustle: band-passed noise with a soft envelope
    const len = Math.floor(ac.sampleRate * 0.35);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = b * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = b * (0.6 + 0.4 * Math.sin(i / len * 40)); }
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.7;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.55, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.34);
    src.connect(bp).connect(g).connect(out);
    src.start(t0); src.stop(t0 + 0.36);
    if (kind === 'pick') {
      // a soft little snap of a stalk, a beat after the rustle
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(900, t0 + 0.2);
      o.frequency.exponentialRampToValueAtTime(320, t0 + 0.26);
      const og = ac.createGain();
      og.gain.setValueAtTime(0, t0 + 0.2);
      og.gain.linearRampToValueAtTime(0.35, t0 + 0.205);
      og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
      o.connect(og).connect(out);
      o.start(t0 + 0.2); o.stop(t0 + 0.3);
    }
    setTimeout(() => { try { out.disconnect(); } catch { /* already gone */ } }, 800);
  }

  return {
    /** Starts the reach-and-pick motion; `pitch` is how far the view tips down (rad). */
    reach(pitch = 0.22) { dipT = 0; dipPitch = pitch; sound('reach'); },
    /** Pops a puff of bits from a point; colours [hex...]. */
    puff(pos, colors) {
      puffLeft = PUFF_N;
      for (let i = 0; i < PUFF_N; i++) {
        const p = parts[i];
        p.p.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3));
        p.v.set((Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 1.2);
        p.s = 0.012 + Math.random() * 0.018;
        p.life = 0.7 + Math.random() * 0.5;
        c.setHex(colors[i % colors.length], THREE.SRGBColorSpace);
        puff.setColorAt(i, c);
      }
      puff.instanceColor.needsUpdate = true;
      puff.count = PUFF_N;
      sound('pick');
    },
    fail() { sound('fail'); },
    get busy() { return dipT >= 0 && dipT < DIP_TIME; },
    /** Runs after the player has placed the camera this frame. */
    lateUpdate(dt) {
      if (dipT >= 0) {
        dipT += dt;
        const k = dipCurve(dipT / DIP_TIME);
        camera.position.y -= k * 0.32;
        camera.rotation.x -= k * dipPitch;
        if (dipT >= DIP_TIME) dipT = -1;
      }
      if (puffLeft > 0) {
        let alive = 0;
        for (let i = 0; i < PUFF_N; i++) {
          const p = parts[i];
          if (p.life <= 0) { m4.makeScale(0, 0, 0); puff.setMatrixAt(i, m4); continue; }
          p.life -= dt;
          p.v.y -= 4.5 * dt;
          p.v.multiplyScalar(1 - 1.5 * dt);
          p.p.addScaledVector(p.v, dt);
          const s = p.s * Math.min(1, p.life * 3);
          q.setFromEuler(eul.set(p.life * 9, p.life * 7, 0));
          m4.compose(p.p, q, sc.set(s, s * 0.6, s));
          puff.setMatrixAt(i, m4);
          if (p.life > 0) alive++;
        }
        puff.instanceMatrix.needsUpdate = true;
        if (!alive) { puffLeft = 0; puff.count = 0; }
      }
    },
  };
}
