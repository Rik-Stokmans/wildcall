import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankVoices, pickVoice, scoreVoice, createSpeech } from './voice.js';

// A typical macOS + Chrome mix.
const VOICES = [
  { name: 'Samantha', lang: 'en-US', default: true, localService: true },
  { name: 'Alex', lang: 'en-US', localService: true },
  { name: 'Thomas', lang: 'fr-FR', localService: true },
  { name: 'Kate', lang: 'en-GB', localService: true },
  { name: 'Daniel', lang: 'en-GB', localService: true },
  { name: 'Google UK English Female', lang: 'en-GB', localService: false },
  { name: 'Google UK English Male', lang: 'en-GB', localService: false },
  { name: 'Zarvox', lang: 'en-US', localService: true },
  { name: 'Anna', lang: 'de-DE', localService: true },
  { name: 'Rocko (English (UK))', lang: 'en-GB', localService: true },
];

test('Daniel (en-GB male) ranks first', () => {
  assert.equal(rankVoices(VOICES)[0].name, 'Daniel');
});

test('non-English voices are excluded, even ones with preferred names', () => {
  const names = rankVoices(VOICES).map((v) => v.name);
  assert.ok(!names.includes('Thomas'));
  assert.ok(!names.includes('Anna'));
});

test('en-GB male beats en-GB female, en-GB beats en-US, novelty voices sink', () => {
  const names = rankVoices(VOICES).map((v) => v.name);
  assert.ok(names.indexOf('Google UK English Male') < names.indexOf('Google UK English Female'));
  assert.ok(names.indexOf('Kate') < names.indexOf('Samantha'));
  assert.equal(names.at(-1), 'Zarvox');
  assert.ok(names.indexOf('Rocko (English (UK))') > names.indexOf('Alex'));
});

test('without Daniel, a "UK English Male" voice wins', () => {
  const v = pickVoice(VOICES.filter((x) => x.name !== 'Daniel'));
  assert.equal(v.name, 'Google UK English Male');
});

test('any English voice when no British voice exists', () => {
  const v = pickVoice([{ name: 'Anna', lang: 'de-DE' }, { name: 'Alex', lang: 'en-US' }]);
  assert.equal(v.name, 'Alex');
});

test('settings.narratorVoice overrides when installed, falls back when not', () => {
  assert.equal(pickVoice(VOICES, 'Samantha').name, 'Samantha');
  assert.equal(pickVoice(VOICES, 'Not Installed').name, 'Daniel');
});

test('no voices → null; underscores in lang codes are tolerated', () => {
  assert.equal(pickVoice([]), null);
  assert.equal(pickVoice(undefined), null);
  assert.ok(scoreVoice({ name: 'Oliver', lang: 'en_GB' }) > scoreVoice({ name: 'Oliver', lang: 'en_US' }));
});

test('speech backend without speechSynthesis is unavailable and settles', async () => {
  const s = createSpeech({});
  assert.equal(s.available, false);
  assert.deepEqual(s.voices(), []);
  const h = s.speak('Hello there.');
  const r = await h.done;
  assert.equal(r.ok, false);
  h.cancel();
});

test('speech backend drives a fake engine', async () => {
  const spoken = [];
  class U { constructor(t) { this.text = t; } }
  const synth = {
    paused: false,
    getVoices: () => VOICES,
    speak(u) { spoken.push(u); setTimeout(() => u.onend?.(), 5); },
    cancel() {},
    addEventListener() {}, removeEventListener() {},
  };
  const s = createSpeech({ speechSynthesis: synth, SpeechSynthesisUtterance: U });
  assert.equal(s.available, true);
  const voice = pickVoice(s.voices());
  const h = s.speak('A most sophisticated little song, that.', { voice, rate: 0.92, pitch: 0.95, volume: 0.5 });
  const r = await h.done;
  assert.equal(r.ok, true);
  assert.equal(spoken[0].voice.name, 'Daniel');
  assert.equal(spoken[0].lang, 'en-GB');
  assert.equal(spoken[0].rate, 0.92);
  assert.equal(spoken[0].volume, 0.5);
});
