import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeAudioContext } from './fakeaudio.js';
import { AudioEngine } from './engine.js';
import { NarratorBus, DUCK, duckTargets, duckGains, duckTiming } from './narratorbus.js';
import { dbToGain, gainToDb } from './curves.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('duck targets: music -8 dB, ambience -3 dB, birds never', () => {
  const on = duckTargets(true);
  assert.equal(on.musicDb, -8);
  assert.equal(on.ambienceDb, -3);
  assert.equal(on.birdsDb, 0);
  assert.deepEqual(duckTargets(false), { musicDb: 0, ambienceDb: 0, birdsDb: 0 });
  const g = duckGains(true);
  near(gainToDb(g.music), -8);
  near(gainToDb(g.ambience), -3);
  assert.equal(g.birds, 1);
  // 250 ms attack; the release is slower and waits a moment so line gaps do not pump.
  assert.deepEqual(duckTiming(true), { delay: 0, dur: 0.25 });
  assert.ok(duckTiming(false).dur > 0.25 && duckTiming(false).delay > 0);
  assert.equal(DUCK.attackS, 0.25);
});

function setup() {
  const eng = new AudioEngine(FakeAudioContext);
  eng.ac.state = 'running';
  const bus = new NarratorBus(eng, { fetchBytes: async () => new ArrayBuffer(300) });
  return { eng, bus, ac: eng.ac };
}

test('the engine has a narrator bus into the master limiter, set by volNarrator', () => {
  const { eng } = setup();
  assert.ok(eng.narIn.outputs.has(eng.narUser));
  assert.ok(eng.narUser.outputs.has(eng.master));
  eng.applySettings({ volNarrator: 0.5, volMaster: 0.6 });
  near(eng.narUser.gain.value, 0.5);
  near(eng.master.gain.value, 0.6);
  eng.applySettings({ volNarrator: 0.2, volMaster: 1 });
  near(eng.narUser.gain.value, 0.2);
  // The bird bus has no narrator duck stage.
  assert.ok(!eng.birdFocus.outputs.has(eng.ambVo) && !eng.birdUser.outputs.has(eng.musVo));
});

test('a clip on the bus ducks music and ambience, not birds, and releases', () => {
  const { eng, bus, ac } = setup();
  const buf = ac.createBuffer(1, 16000, 8000); // 2 s
  let ended = 0;
  const h = bus.play(buf, { gain: 0.7, onEnded: () => ended++ });
  assert.equal(h.duration, 2);
  assert.equal(bus.speaking, true);
  near(eng.musVo.gain.value, dbToGain(-8));
  near(eng.ambVo.gain.value, dbToGain(-3));
  assert.equal(eng.birdIn.gain.value, 1);
  assert.equal(eng.birdFocus.gain.value, 1);
  // The clip plays through narIn.
  const src = [...ac._sources][0];
  assert.ok(src.outputs.size === 1);
  const clipGain = [...src.outputs][0];
  near(clipGain.gain.value, 0.7);
  assert.ok(clipGain.outputs.has(eng.narIn));
  ac.advance(5);
  assert.equal(ended, 0);
  src.stop(0);
  ac.advance(1);
  assert.equal(ended, 1);
  assert.equal(bus.speaking, false);
  near(eng.musVo.gain.value, 1);
  near(eng.ambVo.gain.value, 1);
});

test('stop() ends the clip once and releases the duck', () => {
  const { eng, bus, ac } = setup();
  let ended = 0;
  const h = bus.play(ac.createBuffer(1, 8000, 8000), { onEnded: () => ended++ });
  assert.equal(h.playing, true);
  h.stop();
  h.stop();
  assert.equal(ended, 1);
  assert.equal(h.playing, false);
  assert.equal(bus.speaking, false);
  near(eng.musVo.gain.value, 1);
});

test('bytes and URLs are decoded; bad data ends without sound', async () => {
  const { eng, bus } = setup();
  let ended = 0;
  const h = bus.play(new ArrayBuffer(400), { onEnded: () => ended++ });
  assert.equal(h.duration, 0); // not decoded yet
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(h.duration, 4);
  assert.equal(bus.speaking, true);
  h.stop();
  const u = bus.play('voice/x.ogg', { onEnded: () => ended++ });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(u.duration, 3);
  u.stop();
  const bad = bus.play(new ArrayBuffer(10), { onEnded: () => ended++ });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(bad.playing, false);
  assert.equal(ended, 3);
  assert.equal(bus.speaking, false);
  near(eng.ambVo.gain.value, 1);
});

test('stopped before decoding finishes: nothing ever plays', async () => {
  const { bus } = setup();
  const h = bus.play(new ArrayBuffer(400));
  h.stop();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(bus.speaking, false);
});

test('speech synthesis reports through setSpeaking, also before the engine exists', () => {
  const bus = new NarratorBus(null);
  bus.setSpeaking(true);
  assert.equal(bus.speaking, true);
  const h = bus.play(new ArrayBuffer(400));
  assert.equal(h.playing, true);
  const eng = new AudioEngine(FakeAudioContext);
  bus.attach(eng);
  near(eng.musVo.gain.value, dbToGain(-8)); // applied on attach
  bus.setSpeaking(false);
  near(eng.musVo.gain.value, 1);
});

test('two lines in a row keep the duck (the clip ending then another starting)', () => {
  const { eng, bus, ac } = setup();
  const a = bus.play(ac.createBuffer(1, 800, 8000));
  const b = bus.play(ac.createBuffer(1, 800, 8000));
  a.stop();
  assert.equal(bus.speaking, true);
  near(eng.musVo.gain.value, dbToGain(-8));
  b.stop();
  assert.equal(bus.speaking, false);
});

test('a context that cannot play ends the clip at once', async () => {
  const eng = new AudioEngine(FakeAudioContext);
  const bus = new NarratorBus(eng, { canPlay: () => false });
  let ended = 0;
  const h = bus.play(eng.ac.createBuffer(1, 80, 8000), { onEnded: () => ended++ });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ended, 1);
  assert.equal(h.playing, false);
  assert.equal(bus.speaking, false);
});
