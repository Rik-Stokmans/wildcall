// Smoke test: runs the real Electron shell hidden against a stand-in engine.
// Plus unit tests of the engine supervisor helpers. Run with `npm run smoke`.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const electron = require('electron');
const { tokenize, parseListening, buildCommand } = require('../src/engine.js');
const standin = path.join(here, 'standin-engine.mjs');

function runShell(env) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'wildcall-smoke-'));
  return new Promise((resolve) => {
    // The stand-in writes its pid so we can prove it is gone afterwards.
    const child = spawn(electron, [desktop], {
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '',
        WILDCALL_SMOKE: '1',
        WILDCALL_USER_DATA: userData,
        WILDCALL_ENGINE_CMD: `"${process.execPath}" "${standin}"`,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(userData, { recursive: true, force: true });
      resolve({ code, out, err });
    });
  });
}

/** pids of any stand-in engine processes still alive. */
function standinPids() {
  if (process.platform === 'win32') return [];
  const r = spawnSync('pgrep', ['-f', standin], { encoding: 'utf8' });
  return r.stdout.split('\n').filter(Boolean);
}

test('tokenize honours quotes', () => {
  assert.deepEqual(tokenize(`go run "./my dir" -dev 'a b'`), ['go', 'run', './my dir', '-dev', 'a b']);
});

test('parseListening', () => {
  assert.equal(parseListening('WILDCALL_LISTENING http://127.0.0.1:5123'), 'http://127.0.0.1:5123');
  assert.equal(parseListening('WILDCALL_LISTENING http://127.0.0.1:5123\r'), 'http://127.0.0.1:5123');
  assert.equal(parseListening('listening on :80'), null);
  assert.equal(parseListening('WILDCALL_LISTENING http://evil.example:80'), null);
});

test('buildCommand adds contract flags once', () => {
  assert.deepEqual(buildCommand(['wildcall'], '/s'), {
    file: 'wildcall',
    args: ['-addr', '127.0.0.1:0', '-parent-stdin', '-save', '/s'],
  });
  assert.deepEqual(buildCommand(['go', 'run', '.', '-addr', 'x', '-parent-stdin'], '/s').args, [
    'run', '.', '-addr', 'x', '-parent-stdin', '-save', '/s',
  ]);
});

test('shell loads the page, exposes the bridge and leaves no engine behind', async () => {
  const r = await runShell({});
  assert.equal(r.code, 0, `exit ${r.code}\n${r.out}\n${r.err}`);
  assert.match(r.out, /SMOKE_OK/);
  const info = JSON.parse(r.out.split('SMOKE_OK ')[1].split('\n')[0]);
  assert.match(info.body, /WILDCALL STAND-IN/);
  assert.equal(info.bridge, 'object');
  assert.equal(info.api.node, 'undefined', 'node must not leak into the page');
  assert.equal(info.api.platform, process.platform);
  assert.deepEqual(standinPids(), [], 'orphaned stand-in engine');
});

test('engine failure exits non-zero with captured output and no dialog', async () => {
  const r = await runShell({ STANDIN_MODE: 'die' });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /SMOKE_FAIL/);
  assert.match(r.err, /stand-in: fatal: boom/);
  assert.match(r.err, /stand-in: about to fail/);
  assert.deepEqual(standinPids(), []);
});
