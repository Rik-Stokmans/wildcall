// The narrator through the audio engine's voice bus (ctx.audio.voice): clips go to it,
// the volume is left to the bus, and speech synthesis reports its speaking state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createVoicePack, createNarratorVoice } from './pack.js';
import { createController } from './controller.js';

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const goId = (t) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 16);
const LINE = 'Mm. Blackberries. One for the pot, one for me.';
const OTHER = 'A line with no clip.';

const files = () => ({
  'voice/manifest.json': JSON.stringify({ voice: 'V', model: 'm', lines: { [goId(LINE)]: { file: `${goId(LINE)}.ogg`, dur: 2.5 } } }),
  [`voice/${goId(LINE)}.ogg`]: 'OggS',
});
const fetchImpl = (f) => async (url) => (url in f
  ? { ok: true, status: 200, json: async () => JSON.parse(f[url]), arrayBuffer: async () => new TextEncoder().encode(f[url]).buffer }
  : { ok: false, status: 404, json: async () => { throw new Error('404'); }, arrayBuffer: async () => new ArrayBuffer(0) });

function fakeEngineAudio() {
  const plays = [];
  const ac = {
    state: 'running',
    destination: {},
    decodeAudioData: async () => ({ duration: 2.5 }),
    createBufferSource() { throw new Error('the pack must not build its own graph when the bus exists'); },
  };
  const audio = {
    context: ac,
    voice: {
      speakingFlags: [],
      play(buf, opts) {
        const h = { buf, opts, stopped: false, stop() { this.stopped = true; this.end(); }, end() { const cb = opts.onEnded; opts.onEnded = null; cb?.(); } };
        plays.push(h);
        return h;
      },
      setSpeaking(on) { this.speakingFlags.push(on); },
    },
  };
  return { audio, plays };
}

function fakeSpeech() {
  const log = [];
  return {
    log, available: true, voices: () => [], onVoicesChanged: () => () => {},
    speak(text) {
      let resolve;
      const done = new Promise((r) => { resolve = r; });
      const e = { text, end: () => resolve({ ok: true, reason: 'end' }) };
      log.push(e);
      return { done, cancel() { resolve({ ok: false, reason: 'cancelled' }); } };
    },
  };
}

test('a clip plays on the engine voice bus with unity gain (the bus owns the volume)', async () => {
  const { audio, plays } = fakeEngineAudio();
  const pack = createVoicePack({ fetchImpl: fetchImpl(files()), getAudio: () => audio });
  await pack.load();
  const flags = [];
  const v = createNarratorVoice(fakeSpeech(), pack, { onSpeaking: (on) => flags.push(on) });
  const h = v.speak(LINE, { volume: 0.4, expect: 3 });
  await flush();
  assert.equal(plays.length, 1);
  assert.equal(plays[0].opts.gain, 1);
  assert.equal(h.source, 'pack');
  assert.deepEqual(flags, [], 'a clip on the bus reports its own speaking state');
  plays[0].end();
  assert.deepEqual(await h.done, { ok: true, reason: 'end' });
});

test('cancel stops the clip on the bus', async () => {
  const { audio, plays } = fakeEngineAudio();
  const pack = createVoicePack({ fetchImpl: fetchImpl(files()), getAudio: () => audio });
  await pack.load();
  const v = createNarratorVoice(fakeSpeech(), pack);
  const h = v.speak(LINE, {});
  await flush();
  h.cancel();
  assert.equal(plays[0].stopped, true);
  assert.equal((await h.done).reason, 'cancelled');
});

test('speech synthesis reports speaking true while talking and false when done or cancelled', async () => {
  const flags = [];
  const speech = fakeSpeech();
  const v = createNarratorVoice(speech, createVoicePack({ fetchImpl: fetchImpl({}) }), { onSpeaking: (on) => flags.push(on) });
  const h = v.speak(OTHER, { volume: 1 });
  await flush();
  assert.deepEqual(flags, [true]);
  speech.log[0].end();
  await h.done;
  assert.deepEqual(flags, [true, false]);
  const h2 = v.speak(OTHER, {});
  await flush();
  h2.cancel();
  await h2.done;
  assert.deepEqual(flags, [true, false, true, false]);
});

test('a cancel before the clip is found never leaves speaking switched on', async () => {
  const flags = [];
  const v = createNarratorVoice(fakeSpeech(), createVoicePack({ fetchImpl: fetchImpl({}) }), { onSpeaking: (on) => flags.push(on) });
  const h = v.speak(OTHER, {});
  h.cancel();
  await h.done;
  await flush();
  assert.ok(flags.length === 0 || flags.at(-1) === false);
});

test('a throwing onSpeaking never breaks the narrator', async () => {
  const speech = fakeSpeech();
  const v = createNarratorVoice(speech, createVoicePack({ fetchImpl: fetchImpl({}) }), { onSpeaking: () => { throw new Error('x'); } });
  const h = v.speak(OTHER, {});
  await flush();
  speech.log[0].end();
  assert.equal((await h.done).ok, true);
});

test('controller + bus: focus listening cuts the line and the clip stops', async () => {
  const { audio, plays } = fakeEngineAudio();
  const pack = createVoicePack({ fetchImpl: fetchImpl(files()), getAudio: () => audio });
  await pack.load();
  const speech = createNarratorVoice(fakeSpeech(), pack);
  let hard = false;
  const c = createController({
    speech, caption: { show() {}, hide() {} },
    settings: () => ({ narrator: 'normal', volNarrator: 0.9, volMaster: 0.8 }),
    blocked: () => ({ hard, soft: false }),
  });
  c.say(LINE, { priority: 2 });
  await flush();
  assert.equal(plays.length, 1);
  hard = true; // the player starts focused listening: the narrator is silent
  c.tick(0.1);
  assert.equal(plays[0].stopped, true);
});
