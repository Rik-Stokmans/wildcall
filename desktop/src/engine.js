'use strict';
// Engine supervisor: starts the Go engine, waits for its WILDCALL_LISTENING
// line and keeps the tail of its output for error dialogs. No Electron imports,
// so it can be unit-tested with plain node.

const { spawn } = require('node:child_process');
const readline = require('node:readline');

const LISTEN_RE = /^WILDCALL_LISTENING\s+(http:\/\/127\.0\.0\.1:\d+)\s*$/;
const START_TIMEOUT_MS = 30000;
const TAIL_LINES = 40;
const STOP_GRACE_MS = 4000;

/** Split a command line on whitespace, honouring "double" and 'single' quotes. */
function tokenize(cmd) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Pure: the engine's listening URL if the line is the announcement, else null. */
function parseListening(line) {
  const m = LISTEN_RE.exec(line.trim());
  return m ? m[1] : null;
}

/**
 * Build the final argv. `base` is the executable plus any fixed arguments.
 * The contract flags are added unless the caller (dev command) already has them.
 */
function buildCommand(base, saveDir) {
  const [file, ...args] = base;
  if (!args.includes('-addr')) args.push('-addr', '127.0.0.1:0');
  if (!args.includes('-parent-stdin')) args.push('-parent-stdin');
  args.push('-save', saveDir);
  return { file, args };
}

class Engine {
  /**
   * @param {{base: string[], saveDir: string, cwd?: string, timeoutMs?: number}} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.tail = [];
    this.url = null;
    this.proc = null;
    this.exited = null; // {code, signal} once the process is gone
    this.onExit = null; // set by the caller after start() resolves
    this._exitWaiters = [];
  }

  pushLine(line) {
    this.tail.push(line);
    if (this.tail.length > TAIL_LINES) this.tail.shift();
  }

  output() {
    return this.tail.join('\n');
  }

  /** Resolves with the engine URL, rejects with an Error whose message includes the output tail. */
  start() {
    const { file, args } = buildCommand(this.opts.base, this.opts.saveDir);
    const timeoutMs = this.opts.timeoutMs ?? START_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (why) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.stop().finally(() => reject(new Error(`${why}\n\n${this.output()}`.trim())));
      };
      let proc;
      try {
        proc = spawn(file, args, {
          cwd: this.opts.cwd,
          stdio: ['pipe', 'pipe', 'pipe'], // stdin stays open: EOF is the engine's "parent died" signal
          windowsHide: true,
        });
      } catch (err) {
        reject(new Error(`Could not start the engine (${file}): ${err.message}`));
        return;
      }
      this.proc = proc;
      proc.stdin.on('error', () => {}); // EPIPE when the engine is already gone
      const timer = setTimeout(
        () => fail(`The engine did not report it was listening within ${Math.round(timeoutMs / 1000)} seconds.`),
        timeoutMs,
      );
      const onLine = (line) => {
        this.pushLine(line);
        if (settled) return;
        const url = parseListening(line);
        if (url) {
          settled = true;
          clearTimeout(timer);
          this.url = url;
          resolve(url);
        }
      };
      readline.createInterface({ input: proc.stdout }).on('line', onLine);
      readline.createInterface({ input: proc.stderr }).on('line', (l) => this.pushLine(l));
      proc.on('error', (err) => fail(`Could not start the engine (${file}): ${err.message}`));
      proc.on('close', (code, signal) => {
        this.exited = { code, signal };
        for (const w of this._exitWaiters.splice(0)) w();
        if (!settled) {
          fail(`The engine exited before it was ready (${signal ? 'signal ' + signal : 'code ' + code}).`);
        } else if (this.onExit && !this._stopping) {
          this.onExit(code, signal);
        }
      });
    });
  }

  /** Ask the engine to save and exit (stdin EOF), then force-kill after a grace period. */
  stop() {
    this._stopping = true;
    const proc = this.proc;
    if (!proc || this.exited) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(killTimer);
        resolve();
      };
      this._exitWaiters.push(done);
      const killTimer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, STOP_GRACE_MS);
      try {
        proc.stdin.end();
      } catch {
        /* ignore */
      }
      // Kick it as well: a hung engine that never reads stdin still has to die.
      setTimeout(() => {
        try {
          if (!this.exited) proc.kill('SIGTERM');
        } catch {
          /* ignore */
        }
      }, 1500).unref();
    });
  }
}

module.exports = { Engine, tokenize, parseListening, buildCommand, TAIL_LINES, START_TIMEOUT_MS };
