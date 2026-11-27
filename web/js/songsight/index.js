// Song sight: when a bird near you sings, its voice becomes faintly visible AT the
// bird — two or three thin, soft rings that open from its bill and fade within about a
// second, the way a birder catches the tiny movement of a singer. Rules (logic.js):
// only birds within 35 m (45 m with a live hearing clue), only while playing, never a
// name or a species colour, and the rings are depth-tested against the scene so they
// never show through terrain, trunks or foliage. A singer with a live clue that comes
// within a few degrees of the crosshair for the first time gets one brighter "there!"
// ring. Setting: settings.songRipples ("Song ripples" in the Spotting group).
//
// Cost: one draw call (instanced camera-facing quads, a small shader), fixed pools,
// no allocations per frame after warm-up (only world.clearPath's small result object,
// once per emitted ring: a few per second at most).
//
// API: ctx.songsight = { count, pulse(birdId, strength?), dispose() }  (pulse is for
// debugging / screenshots: it emits one burst at that bird, ignoring the rules).
import {
  RingPool, BoutTable, ringRadius, eligible, thereThreshold, lifeAlpha, RING_LIFE,
  STAGGER, CLUE_RANGE,
} from './logic.js';

const CAP = 96;
/** Rings are drawn a little toward the camera (0.2 m near, up to 0.8 m from ~24 m) so
 *  the singer's own body, its twig and the last leaves around it do not swallow them.
 *  Trunks and the ground are checked separately (world.clearPath) before a ring is
 *  emitted, so the pull never lets a ring show through either. */
const PULL = [0.2, 0.025, 0.8]; // base, per metre, max

const VERT = /* glsl */`
attribute vec4 iPos;   // xyz emitter, w strength
attribute vec4 iData;  // x radius (m), y age 0..1, z alpha, w seed
uniform vec3 uPull;
varying vec2 vUv;
varying vec4 vData;
varying float vStr;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPos.xyz, 1.0);
  float len = max(length(mvPosition.xyz), 1e-3);
  float pull = clamp(uPull.x + uPull.y * len, uPull.x, uPull.z);
  float k = max(len - pull, len * 0.5) / len;
  mvPosition.xyz *= k;
  float R = iData.x * 1.25 * k;
  mvPosition.xy += position.xy * R;
  vUv = position.xy * 1.25;
  vData = iData;
  vStr = iPos.w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform vec3 uLight;
uniform vec3 uDark;
varying vec2 vUv;
varying vec4 vData;
varying float vStr;
#include <fog_pars_fragment>
void main() {
  float r = length(vUv);
  float t = vData.y;
  float rc = mix(0.12, 1.0, 1.0 - pow(1.0 - t, 3.0));
  float fw = max(fwidth(r), 1e-4);
  float w = fw * (0.75 + 0.55 * vStr);             // half line width ~1-1.6 px
  float d = abs(r - rc);
  float line = 1.0 - smoothstep(w, w + fw * 1.3, d);
  float halo = (1.0 - smoothstep(w, w + fw * 5.0, d)) * 0.3; // soft dark edge: reads on pale sky
  // A little broken, like a quick brush stroke rather than a UI circle.
  float s = vData.w * 6.2831;
  float ang = atan(vUv.y, vUv.x);
  float brk = 0.6 + 0.4 * sin(ang * 2.0 + s) + 0.22 * sin(ang * 5.0 - s * 1.7);
  brk = smoothstep(0.0, 0.5, brk);
  float a = vData.z * brk;
  float la = line * a;
  float ha = halo * (1.0 - line) * a;
  float A = la + ha;
  if (A < 0.003) discard;
  gl_FragColor = vec4((uLight * la + uDark * ha) / A, A);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export default {
  name: 'songsight',

  init(ctx) {
    const { THREE, bus, state, camera, scene } = ctx;
    const self = this;
    const pool = new RingPool(CAP);
    const bouts = new BoutTable(24);
    const clueUntil = new Map();   // bird id → time the clue expires (ctx-local clock)
    const discovered = new Set();  // bird ids that already had their "there!" beat
    let clock = 0, sweep = 0, beats = 0;

    // ---- GPU side: one instanced draw.
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const aPos = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    const aData = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4);
    aPos.setUsage(THREE.DynamicDrawUsage); aData.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', aPos);
    geo.setAttribute('iData', aData);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uPull: { value: new THREE.Vector3(PULL[0], PULL[1], PULL[2]) },
        uLight: { value: new THREE.Color(1, 0.96, 0.84) },
        uDark: { value: new THREE.Color(0.06, 0.07, 0.05) },
      }]),
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, fog: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20; // after the opaque world and the foliage
    mesh.name = 'songsight';
    mesh.visible = false;
    scene.add(mesh);

    const fwd = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const head = new THREE.Vector3();
    const enabled = () => state.settings?.songRipples !== false;
    const hasClue = (id) => (clueUntil.get(id) || 0) > clock;

    /** Where the voice comes from: a little above the bird's perch point, at its head. */
    function headOf(b, out) {
      const len = state.species?.[b.sp]?.look?.length || 0.15;
      return out.set(b.pos.x, b.pos.y + 0.45 * len, b.pos.z);
    }

    /** A trunk or the ground between the eye and the singer: no ring this time (the
     *  depth test would hide most of it; this also covers the forward pull). */
    function blocked(b) {
      const r = ctx.world?.clearPath?.(camera.position, headOf(b, head), 0.05);
      if (!r || r.clear) return false;
      if (r.hit === 'trunk') return true;
      // The ground right around a bird on the ground (a tussock, a dip) is left to the
      // depth test; a rise in the ground farther out blocks the ring.
      return r.hit === 'ground' && (1 - r.t) * camera.position.distanceTo(head) > 1.5;
    }

    function burst(id, b, str, n, bright = false) {
      headOf(b, head);
      for (let k = 0; k < n; k++) {
        const i = pool.spawn(id, head.x, head.y, head.z, str, ((id * 0.61803 + k * 0.37 + clock * 0.13) % 1), RING_LIFE + (bright ? 0.25 : 0));
        pool.age[i] = -k * STAGGER; // staggered within the burst
      }
    }

    bus.on('net:call', (m) => {
      if (!m) return;
      const call = state.species?.[m.sp]?.calls?.[m.call];
      bouts.start(m.bird, call, m.reps);
    });
    bus.on('net:clue', (c) => {
      if (!c || !c.id) return;
      clueUntil.set(c.id, clock + (c.ttl > 0 ? c.ttl : 3));
    });
    bus.on('mode', () => { if (state.mode !== 'play') { pool.clear(); geo.instanceCount = 0; } });
    bus.on('settings', (e) => { if (e?.key === 'songRipples' && !enabled()) { pool.clear(); geo.instanceCount = 0; } });

    self._step = (dt) => {
      clock += dt;
      const playing = state.mode === 'play' && enabled();
      const birds = ctx.birds;
      const cam = camera.position;
      // ---- bouts: emit planned rings, and the "there!" beat.
      camera.getWorldDirection(fwd);
      const thr = Math.cos(thereThreshold(camera.fov));
      for (let i = bouts.n - 1; i >= 0; i--) {
        bouts.t[i] += dt;
        const id = bouts.bird[i];
        const b = birds?.get(id);
        if (!b || bouts.t[i] > bouts.dur[i] + 0.5) { bouts.remove(i); continue; }
        if (!playing) continue;
        const dist = cam.distanceTo(b.pos);
        const clue = hasClue(id);
        const ok = eligible({ enabled: true, mode: state.mode, dist, hasClue: clue });
        const times = bouts.times[i];
        while (bouts.next[i] < bouts.count[i] && times[bouts.next[i]] <= bouts.t[i]) {
          bouts.next[i]++;
          if (ok && !blocked(b)) burst(id, b, bouts.str[i], 1);
        }
        if (ok && clue && bouts.active(i) && !discovered.has(id)) {
          headOf(b, head);
          dir.subVectors(head, cam);
          const len = dir.length();
          if (len > 0.5 && dir.dot(fwd) / len > thr) {
            // Spend the beat only when a trunk or the ground is not in the way (the
            // depth test would hide it anyway; this keeps it for a real sighting).
            if (!blocked(b)) { discovered.add(id); beats++; burst(id, b, 1.6, 1, true); }
          }
        }
      }
      // ---- housekeeping every couple of seconds (bounded, rare).
      sweep += dt;
      if (sweep > 2.5) {
        sweep = 0;
        for (const [id, until] of clueUntil) if (until < clock) clueUntil.delete(id);
        for (const id of discovered) if (!birds?.get(id)) discovered.delete(id);
      }
      // ---- rings: follow their singer, age, fill the instance buffers.
      pool.step(dt);
      if (!playing || pool.n === 0) { geo.instanceCount = 0; mesh.visible = false; return; }
      const naked = state.settings?.fov || 70;
      const day = Math.max(0, Math.min(1, ctx.sky?.daylight ?? 1));
      // Softer at night (the scene is dark), and always under the bloom threshold
      // (0.95 by day, 0.55 at night: web/js/fx/grade.js).
      const bright = 0.3 + 0.55 * day;
      mat.uniforms.uLight.value.setRGB(1 * bright, 0.96 * bright, 0.84 * bright);
      const P = aPos.array, D = aData.array;
      let k = 0;
      for (let i = pool.n - 1; i >= 0; i--) {
        const b = birds?.get(pool.bird[i]);
        if (b) { headOf(b, head); pool.x[i] = head.x; pool.y[i] = head.y; pool.z[i] = head.z; }
        else if (pool.age[i] < pool.life[i] - 0.15) pool.age[i] = Math.max(pool.age[i], pool.life[i] - 0.15); // singer gone: fade fast
        const age = pool.age[i];
        if (age < 0) continue; // a staggered ring that has not started yet
        const t = age / pool.life[i];
        const dx = pool.x[i] - cam.x, dy = pool.y[i] - cam.y, dz = pool.z[i] - cam.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > CLUE_RANGE + 5) continue;
        const s = pool.str[i];
        P[k * 4] = pool.x[i]; P[k * 4 + 1] = pool.y[i]; P[k * 4 + 2] = pool.z[i]; P[k * 4 + 3] = Math.min(1.6, s);
        D[k * 4] = ringRadius(dist, camera.fov, naked, s);
        D[k * 4 + 1] = t;
        D[k * 4 + 2] = lifeAlpha(t) * Math.min(1, 0.5 + 0.4 * s);
        D[k * 4 + 3] = pool.seed[i];
        k++;
      }
      geo.instanceCount = k;
      mesh.visible = k > 0;
      if (k > 0) {
        aPos.clearUpdateRanges(); aPos.addUpdateRange(0, k * 4); aPos.needsUpdate = true;
        aData.clearUpdateRanges(); aData.addUpdateRange(0, k * 4); aData.needsUpdate = true;
      }
    };

    ctx.songsight = {
      get count() { return geo.instanceCount; },
      /** How many "there!" beats have fired (debug / tests). */
      get beats() { return beats; },
      /** Debug: one burst at this bird now, ignoring range/clue rules (not the depth test). */
      pulse(id, strength = 1) {
        const b = ctx.birds?.get(id);
        if (b) burst(id, b, strength, strength >= 0.8 ? 3 : 2, strength > 1);
        return !!b;
      },
      dispose() {
        scene.remove(mesh); geo.dispose(); mat.dispose();
        pool.clear(); bouts.clear(); clueUntil.clear(); discovered.clear();
        self._step = null;
      },
    };
  },

  // lateUpdate: birds (earlier in the module list) have moved this frame and the
  // player has placed the camera.
  lateUpdate(dt) { this._step?.(dt); },
};
