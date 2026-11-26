// Procedural NPCs from NPCDef.look: friendly, slightly exaggerated characters (big
// head, round coat, chunky boots) with hair, hat and a signature prop. Idle animation
// (breathing, a gentle sway, arms that drift) and they turn to face the player when
// near. The body is split into a few merged meshes so it animates with transforms
// only — no skinning, no per-frame geometry work.
import * as THREE from 'three';
import { Shape, solidMesh } from './mesh.js';
import { npcProportions, parseColor, shadeHex, mixHex, hashString, rng, npcFacing } from './logic.js';

const BOOTS = 0x4a3426;
const TROUSERS = 0x4e4a40;

/**
 * Builds an NPC character.
 * @param {object} def proto.NPCDef (may be undefined: a generic naturalist is drawn)
 * @param {string} seedId POI id, for deterministic hair style / small variations
 * @returns {{group: THREE.Group, update(dt:number, t:number, px:number, pz:number, eyeY:number): void,
 *   headHeight: number, dispose(): void}}
 */
export function buildNPC(def, seedId) {
  const look = def?.look || {};
  const P = npcProportions(look);
  const rand = rng(hashString(seedId || def?.id || 'npc'));
  const skin = parseColor(look.skin, 0xe0b090);
  const hair = parseColor(look.hair, 0x6a4a30);
  const coat = parseColor(look.coat, 0x5a7a4a);
  const trim = parseColor(look.trim, 0xd8c8a0);
  const hat = String(look.hat || 'none');
  const prop = String(look.prop || 'none');
  const style = Math.floor(rand() * 4); // 0 short, 1 bun, 2 ponytail, 3 curls
  const beard = rand() < 0.3;

  const group = new THREE.Group();
  group.name = 'npc:' + (def?.id || seedId);

  // --- legs and boots (static) ------------------------------------------------
  const legs = new Shape(rand);
  const legX = 0.1 * P.build;
  for (const sx of [-1, 1]) {
    legs.cyl(0.075 * P.build, 0.085 * P.build, P.leg - 0.1, TROUSERS, { x: sx * legX, y: (P.leg - 0.1) / 2 + 0.1, z: 0 });
    legs.ball(0.11, BOOTS, { x: sx * legX, y: 0.07, z: -0.05, sx: 0.9, sy: 0.6, sz: 1.4 });
  }
  group.add(solidMesh(legs.build(), 'npc-legs'));

  // --- body: coat, arms, prop (pivot at the hip) ------------------------------
  const body = new THREE.Group();
  body.position.y = P.hip;
  group.add(body);
  const torso = new Shape(rand);
  const tH = P.torso;
  // A round coat that flares over the hips, with a trim band and buttons.
  torso.cyl(P.chest, P.waist * 1.25, tH * 0.75, coat, { x: 0, y: tH * 0.36, z: 0, seg: 10 });
  torso.ball(P.chest * 1.02, coat, { x: 0, y: tH * 0.72, z: 0, sy: 0.75 });
  torso.cyl(P.waist * 1.3, P.waist * 1.45, 0.22, shadeHex(coat, 0.95), { x: 0, y: -0.02, z: 0, seg: 10 });
  torso.cyl(P.waist * 1.27, P.waist * 1.27, 0.05, trim, { x: 0, y: tH * 0.18, z: 0, seg: 10 });
  for (let i = 0; i < 3; i++) torso.ball(0.02, trim, { x: 0, y: tH * (0.35 + i * 0.15), z: -P.chest * 0.98, detail: 0 });
  torso.cyl(0.1, P.chest * 0.75, 0.1, trim, { x: 0, y: tH * 0.96, z: 0, seg: 8 }); // collar
  torso.cyl(0.055, 0.06, 0.08, skin, { x: 0, y: tH + 0.03, z: 0, seg: 6 }); // neck
  // pockets
  for (const sx of [-1, 1]) torso.box(0.1, 0.08, 0.02, shadeHex(coat, 0.85), { x: sx * P.waist * 0.7, y: tH * 0.22, z: -P.waist * 1.15, ry: sx * 0.3 });
  if (prop === 'toolbelt') {
    torso.cyl(P.waist * 1.33, P.waist * 1.33, 0.07, 0x6a4a2c, { x: 0, y: tH * 0.1, z: 0, seg: 10 });
    for (const a of [-0.9, 0.6, 1.6]) torso.block(0.09, 0.12, 0.06, 0x7a5a3a, { x: Math.sin(a) * P.waist * 1.35, y: tH * 0.0, z: -Math.cos(a) * P.waist * 1.35, ry: -a });
    torso.cyl(0.015, 0.015, 0.16, 0x9a9a9a, { x: Math.sin(1.6) * P.waist * 1.4, y: tH * 0.12, z: -Math.cos(1.6) * P.waist * 1.4, seg: 4 });
  }
  if (prop === 'binoculars') {
    torso.beam([-P.chest * 0.6, tH * 0.95, -0.02], [-0.03, tH * 0.5, -P.chest - 0.03], 0.015, 0x3a2a1e);
    torso.beam([P.chest * 0.6, tH * 0.95, -0.02], [0.03, tH * 0.5, -P.chest - 0.03], 0.015, 0x3a2a1e);
    for (const dx of [-0.045, 0.045]) torso.cyl(0.035, 0.04, 0.12, 0x2e2e2e, { x: dx, y: tH * 0.46, z: -P.chest - 0.05, seg: 7 });
  }
  body.add(solidMesh(torso.build(), 'npc-torso'));

  // arms pivot at the shoulders
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * (P.chest + 0.03), tH * 0.88, 0);
    const a = new Shape(rand);
    const len = 0.56 * P.scale;
    a.cyl(0.06 * P.build, 0.07 * P.build, len, coat, { x: 0, y: -len / 2, z: 0, seg: 7 });
    a.cyl(0.072 * P.build, 0.072 * P.build, 0.05, trim, { x: 0, y: -len + 0.03, z: 0, seg: 7 }); // cuff
    a.ball(0.065, skin, { x: 0, y: -len - 0.04, z: 0, detail: 0 });
    if (sx === -1 && prop === 'clipboard') {
      a.box(0.22, 0.3, 0.02, 0x8a6a42, { x: 0.05, y: -len - 0.02, z: -0.1, rx: -0.9 });
      a.box(0.18, 0.24, 0.005, 0xf2ead8, { x: 0.05, y: -len - 0.005, z: -0.112, rx: -0.9 });
      a.box(0.06, 0.03, 0.02, 0x9a9a9a, { x: 0.05, y: -len + 0.1, z: -0.2, rx: -0.9 });
    }
    if (sx === 1 && prop === 'staff') {
      // a walking staff resting on the ground, gripped by the hand
      const bottom = -(P.hip + tH * 0.88) + 0.02, L = 1.65 * P.scale;
      a.cyl(0.025, 0.03, L, 0x7a5a3a, { x: 0, y: bottom + L / 2, z: -0.06, seg: 6 });
      a.ball(0.045, 0x5a4a3a, { x: 0, y: bottom + L, z: -0.06, detail: 0 });
    }
    arm.add(solidMesh(a.build(), 'npc-arm'));
    // arms rest slightly forward and out: friendlier than straight down
    arm.rotation.z = sx * 0.12;
    arm.rotation.x = sx === -1 && prop === 'clipboard' ? -0.7 : -0.08;
    body.add(arm);
    arms.push(arm);
  }

  // --- head: face, hair, hat (pivot at the neck) -------------------------------
  const head = new THREE.Group();
  head.position.y = tH + 0.06;
  body.add(head);
  const h = new Shape(rand);
  const R = P.head;
  const hy = R * 0.95;
  h.ball(R, skin, { x: 0, y: hy, z: 0, sx: 0.95, sy: 1.02 });
  h.ball(R * 0.2, shadeHex(skin, 0.93), { x: 0, y: hy - R * 0.08, z: -R * 0.97, detail: 0 }); // nose
  for (const sx of [-1, 1]) {
    h.ball(R * 0.1, 0x2a2420, { x: sx * R * 0.36, y: hy + R * 0.12, z: -R * 0.86, detail: 0 }); // eyes
    h.ball(R * 0.16, mixHex(skin, 0xe07070, 0.35), { x: sx * R * 0.55, y: hy - R * 0.18, z: -R * 0.72, sy: 0.6, detail: 0 });
    h.box(R * 0.3, R * 0.06, R * 0.05, shadeHex(hair, 0.85), { x: sx * R * 0.36, y: hy + R * 0.34, z: -R * 0.86, rz: sx * 0.12 });
    h.ball(R * 0.2, skin, { x: sx * R * 0.95, y: hy, z: 0, sx: 0.5, detail: 0 }); // ears
  }
  h.box(R * 0.35, R * 0.05, R * 0.05, shadeHex(skin, 0.7), { x: 0, y: hy - R * 0.42, z: -R * 0.84 }); // smile
  // hair cap (back and top), then a style
  h.ball(R * 1.06, hair, { x: 0, y: hy + R * 0.12, z: R * 0.12, sx: 0.98, sy: 0.92 });
  if (style === 1) h.ball(R * 0.42, hair, { x: 0, y: hy + R * 0.95, z: R * 0.45 });
  if (style === 2) h.cyl(R * 0.18, R * 0.1, R * 1.4, hair, { x: 0, y: hy - R * 0.2, z: R * 1.0, rx: 0.3, seg: 6 });
  if (style === 3) for (let i = 0; i < 7; i++) {
    const a = (i / 7) * 6.283;
    h.ball(R * 0.32, shadeHex(hair, 0.95 + rand() * 0.1), { x: Math.cos(a) * R * 0.8, y: hy + R * 0.55, z: Math.sin(a) * R * 0.8 + R * 0.15, detail: 0 });
  }
  if (beard) h.ball(R * 0.55, hair, { x: 0, y: hy - R * 0.55, z: -R * 0.55, sy: 0.85, sz: 0.7 });
  // hats
  const hatHex = shadeHex(mixHex(coat, trim, 0.35), 0.9);
  const top = hy + R * 0.85;
  switch (hat) {
    case 'brim':
      h.cyl(R * 1.7, R * 1.7, 0.03, hatHex, { x: 0, y: top - R * 0.05, z: 0, seg: 12 });
      h.cyl(R * 0.85, R * 0.95, R * 0.7, hatHex, { x: 0, y: top + R * 0.28, z: 0, seg: 10 });
      h.cyl(R * 0.97, R * 0.97, R * 0.15, trim, { x: 0, y: top + R * 0.02, z: 0, seg: 10 });
      break;
    case 'beanie':
      h.ball(R * 1.08, hatHex, { x: 0, y: hy + R * 0.32, z: 0.01, sy: 0.85 });
      h.cyl(R * 1.1, R * 1.1, R * 0.28, shadeHex(hatHex, 0.9), { x: 0, y: hy + R * 0.18, z: 0, seg: 10 });
      h.ball(R * 0.28, trim, { x: 0, y: hy + R * 1.25, z: 0, detail: 0 });
      break;
    case 'ranger':
      h.cyl(R * 1.9, R * 1.9, 0.035, 0x8a7448, { x: 0, y: top - R * 0.05, z: 0, seg: 12 });
      h.cyl(R * 0.55, R * 0.95, R * 0.75, 0x8a7448, { x: 0, y: top + R * 0.32, z: 0, seg: 4, ry: Math.PI / 4 });
      h.cyl(R * 0.96, R * 0.96, R * 0.12, 0x4a3a2a, { x: 0, y: top + 0.01, z: 0, seg: 10 });
      break;
    case 'cap':
      h.ball(R * 1.06, hatHex, { x: 0, y: hy + R * 0.38, z: 0.01, sy: 0.7 });
      h.box(R * 1.3, R * 0.06, R * 0.9, shadeHex(hatHex, 0.85), { x: 0, y: hy + R * 0.42, z: -R * 1.05, rx: 0.12 });
      break;
    default: break;
  }
  head.add(solidMesh(h.build(), 'npc-head'));

  // --- animation ------------------------------------------------------------
  const phase = rand() * 6.28;
  let yaw = null;
  let baseYaw = 0;
  const headHeight = P.hip + tH + 0.06 + hy;

  function update(dt, t, px, pz, eyeY) {
    if (yaw === null) yaw = baseYaw;
    const wx = group.parent ? group.parent.position.x + group.position.x : group.position.x;
    const wz = group.parent ? group.parent.position.z + group.position.z : group.position.z;
    yaw = npcFacing(yaw, baseYaw, wx, wz, px, pz, dt);
    group.rotation.y = -yaw - (group.parent ? group.parent.rotation.y : 0);
    // breathing and a slow sway
    const br = Math.sin(t * 1.5 + phase);
    body.scale.set(1 - 0.006 * br, 1 + 0.014 * br, 1 + 0.01 * br);
    body.rotation.z = 0.025 * Math.sin(t * 0.55 + phase);
    body.rotation.x = 0.015 * Math.sin(t * 0.4 + phase * 1.3);
    arms[0].rotation.x = (prop === 'clipboard' ? -0.7 : -0.08) + 0.05 * Math.sin(t * 0.9 + phase);
    arms[1].rotation.x = -0.08 + 0.05 * Math.sin(t * 0.9 + phase + 1.7);
    // the head looks up/down towards the player when they are near, otherwise nods idly
    const d = Math.hypot(px - wx, pz - wz);
    const near = d < 7 && Number.isFinite(eyeY);
    const myEye = (group.parent ? group.parent.position.y : 0) + group.position.y + headHeight;
    const want = near ? Math.max(-0.35, Math.min(0.35, Math.atan2(eyeY - myEye, Math.max(d, 0.5)))) : 0.04 * Math.sin(t * 0.3 + phase);
    head.rotation.x += (want - head.rotation.x) * Math.min(1, dt * 3);
    head.rotation.z = 0.04 * Math.sin(t * 0.45 + phase);
  }

  return {
    group,
    update,
    headHeight,
    /** Resting compass heading (the POI's yaw). */
    setBaseYaw(y) {
      baseYaw = +y || 0;
      if (yaw === null) { yaw = baseYaw; group.rotation.y = -yaw; }
    },
    get yaw() { return yaw ?? baseYaw; },
    dispose() {
      group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    },
  };
}
