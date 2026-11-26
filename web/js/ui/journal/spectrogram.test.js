import test from 'node:test';
import assert from 'node:assert/strict';
import { callSpectrogram, freqToY, spectrogramSeconds } from './spectrogram.js';

const call = { notes: [{ dur: 0.2, gap: 0.1, f0: 2000, f1: 4000, wave: 'whistle', amp: 1 }, { dur: 0.1, gap: 0, f0: 6000, f1: 6000, wave: 'noise', amp: 0.8 }], repeat: [2, 3], gap: 0.2 };

test('frequency axis: high is up and clamps', () => {
  assert.ok(freqToY(8000) < freqToY(1000));
  assert.equal(freqToY(1), 1);
  assert.equal(freqToY(1e6), 0);
});

test('duration accounts for repeats and gaps', () => {
  assert.ok(Math.abs(spectrogramSeconds(call, 1) - 0.4) < 1e-9);
  assert.ok(Math.abs(spectrogramSeconds(call, 2) - 1.0) < 1e-9);
});

test('rising whistle paints a rising ridge', () => {
  const { data, cols, rows } = callSpectrogram(call, { cols: 80, rows: 40, reps: 1 });
  assert.equal(data.length, cols * rows);
  const peakRow = (col) => { let b = 0, br = -1; for (let r = 0; r < rows; r++) if (data[r * cols + col] > b) { b = data[r * cols + col]; br = r; } return br; };
  const early = peakRow(Math.floor(cols * 0.05 * 1.0)), late = peakRow(Math.floor(cols * 0.45));
  assert.ok(late < early, 'later column should sit higher (smaller row)');
  assert.ok(Math.max(...data) <= 1 && Math.min(...data) >= 0);
});

test('silence between phrases stays empty', () => {
  const { data, cols, rows, seconds } = callSpectrogram(call, { cols: 100, rows: 30, reps: 2 });
  const col = Math.floor((0.4 + 0.1) / seconds * cols); // inside the 0.2 s gap between phrases
  let sum = 0; for (let r = 0; r < rows; r++) sum += data[r * cols + col];
  assert.equal(sum, 0);
});

test('empty call gives an empty grid', () => {
  const g = callSpectrogram({ notes: [] });
  assert.equal(g.seconds, 0);
  assert.ok(g.data.every((v) => v === 0));
});
