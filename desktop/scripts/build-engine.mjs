// Cross-compiles the Go engine into desktop/build/bin/<platform>-<arch>/.
// Usage: node scripts/build-engine.mjs [--mac] [--win] [--target darwin-arm64,...]
// With no flags all three targets are built. --mac = darwin-arm64 + darwin-x64.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// key (electron platform-arch) -> Go GOOS/GOARCH
const TARGETS = {
  'darwin-arm64': { goos: 'darwin', goarch: 'arm64', exe: 'wildcall' },
  'darwin-x64': { goos: 'darwin', goarch: 'amd64', exe: 'wildcall' },
  'win32-x64': { goos: 'windows', goarch: 'amd64', exe: 'wildcall.exe' },
};

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repoRoot = path.resolve(desktop, '..');

function pick(argv) {
  const out = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mac') ['darwin-arm64', 'darwin-x64'].forEach((t) => out.add(t));
    else if (a === '--win') out.add('win32-x64');
    else if (a === '--target') (argv[++i] || '').split(',').filter(Boolean).forEach((t) => out.add(t));
    else throw new Error(`unknown argument ${a}`);
  }
  if (out.size === 0) Object.keys(TARGETS).forEach((t) => out.add(t));
  for (const t of out) if (!TARGETS[t]) throw new Error(`unknown target ${t} (have ${Object.keys(TARGETS).join(', ')})`);
  return [...out];
}

let targets;
try {
  targets = pick(process.argv.slice(2));
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

for (const key of targets) {
  const t = TARGETS[key];
  const outFile = path.join(desktop, 'build', 'bin', key, t.exe);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  console.log(`engine ${key}: go build -> ${path.relative(repoRoot, outFile)}`);
  const r = spawnSync('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', outFile, './cmd/wildcall'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, CGO_ENABLED: '0', GOOS: t.goos, GOARCH: t.goarch },
  });
  if (r.status !== 0) {
    console.error(`engine build failed for ${key}`);
    process.exit(r.status ?? 1);
  }
}
