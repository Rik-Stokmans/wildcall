import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createController } from './controller.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

// A fake speech backend: lines "end" only when the test says so.
function fakeSpeech({ available = true } = {}) {
  const log = [];
  return {
    log,
    available,
    voices: () => [{ name: 'Daniel', lang: 'en-GB' }, { name: 'Alex', lang: 'en-US' }],
    onVoicesChanged: () => () => {},
    speak(text, opts) {
      let resolve;
      const done = new Promise((r) => { resolve = r; });
      const entry = { text, opts, cancelled: false, end: () => resolve({ ok: true, reason: 'end' }) };
      log.push(entry);
      return { done, cancel() { entry.cancelled = true; resolve({ ok: false, reason: 'cancelled' }); } };
    },
  };
}

function fakeCaption() {
  const shown = [];
  return { shown, visible: false, show(t) { shown.push(t); this.visible = true; }, hide() { this.visible = false; } };
}

function setup(opts = {}) {
  const speech = fakeSpeech(opts);
  const caption = fakeCaption();
  const settings = { volMaster: 0.8, volNarrator: 0.9, narrator: 'normal', narratorVoice: '', ...opts.settings };
  const b = { hard: false, soft: false };
  const c = createController({ speech, caption, settings: () => settings, blocked: () => b });
  return { c, speech, caption, settings, b };
}

const line = (id, priority, text = `Line number ${id}.`, ttl = 10) => ({ id, text, kind: 'ambient', priority, ttl });

test('speaks a line with the best British voice, rate, pitch and combined volume', async () => {
  const { c, speech, caption } = setup();
  c.receive(line(1, 1));
  assert.equal(speech.log.length, 1);
  const o = speech.log[0].opts;
  assert.equal(o.voice.name, 'Daniel');
  assert.equal(o.rate, 0.92);
  assert.equal(o.pitch, 0.95);
  assert.ok(Math.abs(o.volume - 0.72) < 1e-9);
  assert.deepEqual(caption.shown, ['Line number 1.']);
  speech.log[0].end();
  await flush();
  c.tick(1);
  assert.equal(c.current, null);
  assert.equal(caption.visible, false);
});

test('one at a time: the next line waits for the current one', async () => {
  const { c, speech } = setup();
  c.receive(line(1, 1));
  c.receive(line(2, 1));
  assert.equal(speech.log.length, 1);
  speech.log[0].end();
  await flush();
  c.tick(0.5); // linger
  c.tick(1);   // breath
  assert.equal(speech.log.length, 2);
  assert.equal(speech.log[1].text, 'Line number 2.');
});

test('captions alone when there is no speech engine', () => {
  const { c, caption } = setup({ available: false });
  c.receive(line(1, 1, 'A thin, high trill, somewhere up in the canopy.'));
  assert.equal(caption.visible, true);
  c.tick(2);
  assert.equal(caption.visible, true);
  c.tick(10);
  assert.equal(caption.visible, false);
});

test('captions alone when narrator volume is zero', () => {
  const { c, speech, caption } = setup({ settings: { volNarrator: 0 } });
  c.receive(line(1, 1));
  assert.equal(speech.log.length, 0);
  assert.equal(caption.visible, true);
});

test('holds while focus listening, then speaks if still fresh', async () => {
  const { c, speech, b } = setup();
  b.hard = true;
  c.receive(line(1, 1, 'Held line.', 10));
  c.tick(3);
  assert.equal(speech.log.length, 0);
  b.hard = false;
  c.tick(1);
  assert.equal(speech.log.length, 1);
});

test('held lines expire on TTL', () => {
  const { c, speech, b } = setup();
  b.soft = true; // a screen is open
  c.receive(line(1, 1, 'Stale line.', 5));
  c.tick(6);
  b.soft = false;
  c.tick(1);
  assert.equal(speech.log.length, 0);
});

test('focus listening cuts the current line; priority 2 comes back afterwards, priority 1 does not', async () => {
  const { c, speech, b } = setup();
  c.receive(line(1, 1));
  b.hard = true;
  c.tick(0.1);
  assert.equal(speech.log[0].cancelled, true);
  b.hard = false;
  c.tick(2);
  assert.equal(speech.log.length, 1);

  c.receive(line(2, 2, 'A discovery line.'));
  assert.equal(speech.log.length, 2);
  b.hard = true;
  c.tick(0.1);
  assert.equal(speech.log[1].cancelled, true);
  b.hard = false;
  c.tick(2);
  assert.equal(speech.log.length, 3);
  assert.equal(speech.log[2].text, 'A discovery line.');
});

test('priority 2 interrupts priority 0, not priority 1', async () => {
  const { c, speech } = setup();
  c.receive(line(1, 0, 'Idle musing.'));
  c.receive(line(2, 2, 'Discovery!'));
  assert.equal(speech.log[0].cancelled, true);
  assert.equal(speech.log[1].text, 'Discovery!');

  const s2 = setup();
  s2.c.receive(line(1, 1, 'Reaction.'));
  s2.c.receive(line(2, 3, 'Milestone.'));
  assert.equal(s2.speech.log.length, 1);
  assert.equal(s2.speech.log[0].cancelled, false);
});

test('off says nothing and stops the current line; sparse drops priority 0 and spaces lines', async () => {
  const { c, speech, settings } = setup();
  c.receive(line(1, 1));
  settings.narrator = 'off';
  c.tick(0.1);
  assert.equal(speech.log[0].cancelled, true);
  c.receive(line(2, 3));
  assert.equal(speech.log.length, 1);

  const s = setup({ settings: { narrator: 'sparse' } });
  s.c.receive(line(1, 0));
  assert.equal(s.speech.log.length, 0);
  s.c.receive(line(2, 1, 'First.', 200));
  assert.equal(s.speech.log.length, 1);
  s.speech.log[0].end();
  await flush();
  s.c.receive(line(3, 1, 'Second.', 200));
  s.c.tick(30);
  assert.equal(s.speech.log.length, 1);
  s.c.tick(61);
  assert.equal(s.speech.log.length, 2);
});

test('say(), stop() and voices()', () => {
  const { c, speech } = setup();
  assert.equal(c.say('A local line.', { priority: 2 }), true);
  assert.equal(speech.log[0].text, 'A local line.');
  c.say('Another.', { priority: 1 });
  c.stop();
  assert.equal(speech.log[0].cancelled, true);
  assert.equal(c.queued, 0);
  assert.deepEqual(c.voices().map((v) => v.name), ['Daniel', 'Alex']);
});

test('engine failure falls back to caption timing', async () => {
  const caption = fakeCaption();
  const speech = {
    available: true,
    voices: () => [],
    onVoicesChanged: () => () => {},
    speak: () => ({ done: Promise.resolve({ ok: false, reason: 'synthesis-failed' }), cancel() {} }),
  };
  const c = createController({ speech, caption, settings: () => ({}), blocked: () => ({}) });
  c.receive(line(1, 1, 'A thin, high trill, somewhere up in the canopy.'));
  await flush();
  c.tick(1);
  assert.equal(caption.visible, true, 'caption stays for the estimated speaking time');
  c.tick(10);
  assert.equal(caption.visible, false);
});
