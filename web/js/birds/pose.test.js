import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  animProfile, createAnimState, resetAnimState, createPose, createAnimInput, updateAnim, stanceOffset,
  legBend, rand, CHANNELS,
} from './pose.js';
import { deriveRig } from './rig.js';
import { ACT, ACT_COUNT, FLAG, FLIGHT_STYLES, GROUND_MODES } from './constants.js';
import { species as mk } from './test-fixtures.js';

function setup(over = {}, extra = {}) {
  const s = mk(over, extra);
  const rig = deriveRig(s);
  return { rig, P: animProfile(s, rig) };
}

/** Run an act for `secs` and return the pose plus min/max of selected channels. */
function run(P, fill, secs = 2, seed = 42) {
  const st = createAnimState(), pose = createPose(), inp = createAnimInput();
  resetAnimState(st, seed, pose);
  fill(inp);
  const lo = {}, hi = {};
  for (let t = 0; t < secs; t += 1 / 60) {
    updateAnim(st, P, inp, 1 / 60, pose);
    if (t < Math.min(0.5, secs / 2)) continue; // let the pose settle from rest first
    for (const k of Object.keys(CHANNELS)) {
      lo[k] = Math.min(lo[k] ?? Infinity, pose[k]);
      hi[k] = Math.max(hi[k] ?? -Infinity, pose[k]);
    }
  }
  return { pose, lo, hi };
}

test('every act × flight style × ground mode yields a finite pose', () => {
  for (const flight of FLIGHT_STYLES) for (const ground of GROUND_MODES) {
    const { P } = setup({}, { move: { flight, ground, flapHz: 10 } });
    for (let act = 0; act < ACT_COUNT + 2; act++) {
      for (const flags of [0, FLAG.SINGING | FLAG.WARY, FLAG.HIDDEN]) {
        const { pose } = run(P, (i) => { i.act = act; i.flags = flags; i.speed = 1.5; i.vz = -1.5; i.y = act % 2 ? 0 : 3; i.groundDy = -2; i.lookYaw = 1; }, 0.5);
        for (const k of Object.keys(CHANNELS)) assert.ok(Number.isFinite(pose[k]), `${flight}/${ground} act ${act} ${k}`);
      }
    }
  }
});

test('singing opens the bill, pulses the throat and lifts the head', () => {
  const { P } = setup();
  const quiet = run(P, (i) => { i.act = ACT.PERCHED; });
  const song = run(P, (i) => { i.act = ACT.PERCHED; i.flags = FLAG.SINGING; });
  assert.ok(song.hi.jaw > 0.15 && quiet.hi.jaw < 0.02);
  assert.ok(song.hi.throat - song.lo.throat > 0.1, 'throat pulses');
  assert.ok(song.hi.throat > quiet.hi.throat);
});

test('perched birds look around and flick their tails; wagtails pump constantly', () => {
  const { P } = setup();
  const r = run(P, (i) => { i.act = ACT.PERCHED; }, 6);
  assert.ok(r.hi.headYaw - r.lo.headYaw > 0.5, 'head turns');
  assert.ok(r.hi.tailPitch - r.lo.tailPitch > 0.1, 'tail flicks');
  const w = setup({}, { traits: { shape: 'wagtail' } });
  const wr = run(w.P, (i) => { i.act = ACT.PERCHED; }, 2);
  assert.ok(wr.hi.tailPitch - wr.lo.tailPitch > 0.4);
});

test('owls turn their heads much further than songbirds', () => {
  const owl = setup({ billShape: 'hooked' }, { traits: { shape: 'owl' } });
  const r = run(owl.P, (i) => { i.act = ACT.PERCHED; }, 20, 7);
  assert.ok(Math.max(Math.abs(r.lo.headYaw), Math.abs(r.hi.headYaw)) > 1.4);
  assert.ok(owl.P.headRange > setup().P.headRange * 1.8);
});

test('flight: airborne, legs tucked, wings flapping; undulating closes wings; soaring glides', () => {
  const { P } = setup({}, { move: { flight: 'undulating', ground: 'hop', flapHz: 12 } });
  const r = run(P, (i) => { i.act = ACT.FLYING; i.speed = 8; i.vz = -8; }, 3);
  assert.ok(r.pose.air > 0.95 && r.pose.legTuck > 0.95);
  assert.ok(r.hi.flapR - r.lo.flapR > 0.8, 'wings beat');
  assert.ok(r.hi.fold > 0.9 && r.lo.fold < 0.1, 'bounds on closed wings');
  assert.ok(r.hi.lift - r.lo.lift > 0.05, 'bounding arcs');
  const s = setup({ wingShape: 'broad', length: 0.5, wingspan: 1.2 }, { move: { flight: 'soaring', ground: 'walk', flapHz: 3 } });
  const g = run(s.P, (i) => { i.act = ACT.SOARING; i.speed = 6; i.vz = -6; i.yawRate = 0.3; }, 3);
  assert.ok(g.hi.fold < 0.05, 'wings stay spread');
  assert.ok(g.pose.tailSpread > 0.8);
  assert.ok(g.pose.bodyRoll > 0.05, 'banks into the turn');
});

test('flap phase advances at flapHz (fleeing faster)', () => {
  const { P } = setup({}, { move: { flight: 'direct', ground: 'hop', flapHz: 10 } });
  const st = createAnimState(), pose = createPose(), inp = createAnimInput();
  resetAnimState(st, 1, pose);
  inp.act = ACT.FLYING;
  const p0 = st.phase;
  for (let k = 0; k < 60; k++) updateAnim(st, P, inp, 1 / 60, pose);
  assert.ok(Math.abs(st.phase - p0 - 10) < 1e-6);
  inp.act = ACT.FLEEING;
  const p1 = st.phase;
  for (let k = 0; k < 60; k++) updateAnim(st, P, inp, 1 / 60, pose);
  assert.ok(st.phase - p1 > 12);
});

test('hovering pitches the body up and fans the tail', () => {
  const { P } = setup();
  const r = run(P, (i) => { i.act = ACT.HOVERING; });
  assert.ok(r.pose.bodyPitch > 0.6 && r.pose.tailSpread > 0.9);
});

test('climbing holds the body vertical against the trunk', () => {
  const { P } = setup({ billShape: 'chisel' }, { move: { flight: 'undulating', ground: 'cling', flapHz: 9 } });
  const r = run(P, (i) => { i.act = ACT.CLIMBING; });
  assert.ok(r.pose.bodyPitch > 1.2 && r.pose.climb > 0.95);
  assert.ok(r.pose.tailPitch < 0, 'tail pressed to the bark');
});

test('alert stands tall and looks at the viewer; hiding crouches; roosting fluffs and tucks', () => {
  const { P } = setup();
  const alert = run(P, (i) => { i.act = ACT.ALERT; i.lookYaw = 0.9; }, 1.5);
  assert.ok(alert.pose.bodyPitch > P.perchPitch + 0.15);
  assert.ok(Math.abs(alert.pose.headYaw - 0.9) < 0.05);
  assert.ok(alert.pose.fluff < 0.97, 'sleeked');
  const hide = run(P, (i) => { i.act = ACT.HIDING; });
  assert.ok(hide.pose.crouch > 0.75);
  const roost = run(P, (i) => { i.act = ACT.ROOSTING; });
  assert.ok(roost.pose.fluff > 1.12 && Math.abs(roost.pose.headYaw) > 2);
});

test('swimming floats, bobs and leaves a wake when moving', () => {
  const { P } = setup({ billShape: 'flat' }, { traits: { shape: 'duck' }, move: { flight: 'direct', ground: 'swim', flapHz: 6 } });
  const still = run(P, (i) => { i.act = ACT.SWIMMING; i.speed = 0; });
  const moving = run(P, (i) => { i.act = ACT.SWIMMING; i.speed = 0.6; });
  assert.ok(still.pose.swim > 0.95 && still.pose.legTuck > 0.9);
  assert.ok(still.pose.wake < 0.05 && moving.pose.wake > 0.7);
  assert.ok(still.hi.lift - still.lo.lift > 0.002, 'bobs');
  const dabble = run(P, (i) => { i.act = ACT.FEEDING; i.y = 0; }, 12, 3);
  assert.ok(dabble.lo.bodyPitch < -1, 'up-ends to dabble');
});

test('wading lowers the feet to the bottom and stalks with the neck forward', () => {
  const { P, rig } = setup({ neck: 1, legs: 1, length: 0.95, wingspan: 1.85 }, { traits: { shape: 'heron' }, move: { flight: 'direct', ground: 'wade', flapHz: 2 } });
  const r = run(P, (i) => { i.act = ACT.WADING; i.groundDy = -0.3; i.speed = 0.2; }, 3);
  assert.ok(r.pose.neckPitch < -0.3);
  assert.ok(r.pose.lift < -0.2 && r.pose.lift >= -rig.length * 0.75 - 0.05);
  assert.ok(r.hi.strideL > 0.1, 'steps');
  assert.ok(P.neckFold, 'herons fold the neck in flight');
  const f = run(P, (i) => { i.act = ACT.FLYING; i.speed = 5; }, 1);
  assert.ok(f.pose.neckPitch > 0.5 && f.pose.neckScale < 0.8);
});

test('feeding pecks; foraging hops or walks per ground mode', () => {
  const hop = setup();
  const feed = run(hop.P, (i) => { i.act = ACT.FEEDING; }, 2);
  assert.ok(feed.lo.headPitch < -0.6, 'pecks reach down');
  const fh = run(hop.P, (i) => { i.act = ACT.FORAGING; i.speed = 0.4; }, 3);
  assert.ok(fh.hi.lift > hop.P.hopH * 0.5, 'hops');
  const walk = setup({}, { move: { flight: 'direct', ground: 'walk', flapHz: 8 } });
  const fw = run(walk.P, (i) => { i.act = ACT.FORAGING; i.speed = 0.5; }, 3);
  assert.ok(fw.hi.strideL > 0.3 && fw.lo.strideL < -0.3, 'alternating strides');
});

test('preening turns the head back; bathing splashes; diving plunges; nesting carries a twig; display fans the tail', () => {
  const { P } = setup();
  const pr = run(P, (i) => { i.act = ACT.PREENING; }, 4);
  assert.ok(Math.max(Math.abs(pr.lo.headYaw), pr.hi.headYaw) > 1.5);
  const bath = run(P, (i) => { i.act = ACT.BATHING; i.y = 0.05; });
  assert.ok(bath.pose.splash > 0.9 && bath.hi.coverLiftL > 0.4);
  const dive = run(P, (i) => { i.act = ACT.DIVING; i.y = 4; i.vy = -6; }, 1);
  assert.ok(dive.pose.bodyPitch < -1 && dive.pose.sweep > 0.9);
  const under = run(P, (i) => { i.act = ACT.DIVING; i.y = 0; }, 1);
  assert.ok(under.pose.lift < -0.1, 'slips under the surface');
  const nest = run(P, (i) => { i.act = ACT.NESTING; });
  assert.equal(nest.pose.twig, 1);
  const show = run(P, (i) => { i.act = ACT.SOCIAL; i.speed = 0; });
  assert.ok(show.pose.tailSpread > 0.7);
  const chase = run(P, (i) => { i.act = ACT.SOCIAL; i.speed = 4; });
  assert.ok(chase.pose.air > 0.9);
});

test('acts blend smoothly (no single-frame jumps in the body)', () => {
  const { P } = setup();
  const st = createAnimState(), pose = createPose(), inp = createAnimInput();
  resetAnimState(st, 5, pose);
  let maxJump = 0;
  for (let f = 0; f < 600; f++) {
    inp.act = [ACT.PERCHED, ACT.FLYING, ACT.ALERT, ACT.ROOSTING, ACT.FORAGING][Math.floor(f / 120)];
    const before = pose.bodyPitch, beforeAir = pose.air;
    updateAnim(st, P, inp, 1 / 60, pose);
    maxJump = Math.max(maxJump, Math.abs(pose.bodyPitch - before), Math.abs(pose.air - beforeAir));
  }
  assert.ok(maxJump < 0.2, `max per-frame jump ${maxJump}`);
});

test('animation is deterministic per seed and varies between individuals', () => {
  const { P } = setup();
  const a = run(P, (i) => { i.act = ACT.PERCHED; }, 3, 9).pose;
  const b = run(P, (i) => { i.act = ACT.PERCHED; }, 3, 9).pose;
  const c = run(P, (i) => { i.act = ACT.PERCHED; }, 3, 10).pose;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  const st = createAnimState();
  resetAnimState(st, 0);
  for (let k = 0; k < 100; k++) { const r = rand(st); assert.ok(r >= 0 && r < 1); }
});

test('stance keeps the feet on the contact point for any pitch and crouch', () => {
  const { rig, P } = setup();
  const pose = createPose();
  for (const pitch of [0, 0.4, 0.9, 1.25]) for (const crouch of [0, 0.5, 1]) for (const fluff of [0.95, 1.15]) {
    Object.assign(pose, { bodyPitch: pitch, crouch, fluff, air: 0, swim: 0, climb: 0, lift: 0 });
    const s = stanceOffset(rig, P, pose);
    const hy = rig.legs.hip.y * fluff, hz = rig.legs.hip.z * fluff;
    const hipY = s.y + hy * Math.cos(pitch) - hz * Math.sin(pitch);
    const hipZ = s.z + hy * Math.sin(pitch) + hz * Math.cos(pitch);
    const footY = hipY - rig.legs.len * legBend(crouch) * fluff;
    assert.ok(Math.abs(footY) < 1e-9, 'feet on the ground');
    assert.ok(Math.abs(hipZ) < 1e-9, 'feet under the hips');
  }
  Object.assign(pose, { air: 1, lift: 0.1 });
  const a = stanceOffset(rig, P, pose);
  assert.ok(Math.abs(a.y - 0.1) < 1e-12 && a.z === 0, 'in flight the body is on the point');
});
