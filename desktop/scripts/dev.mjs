// Runs the shell against the live Go sources: `go run ./cmd/wildcall -dev` from the repo root.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const electron = createRequire(import.meta.url)('electron'); // path to the binary

const child = spawn(electron, [desktop, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WILDCALL_ENGINE_CMD: process.env.WILDCALL_ENGINE_CMD || 'go run ./cmd/wildcall -dev -addr 127.0.0.1:0 -parent-stdin',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
