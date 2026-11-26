'use strict';
// electron-builder configuration. Unsigned by design (no certificates, no wine needed).
// The engine for each platform/arch is built by scripts/build-engine.mjs into
// build/bin/<platform>-<arch>/ and copied to <resources>/bin/ in the package.
module.exports = {
  appId: 'com.rikstokmans.wildcall',
  productName: 'Wildcall',
  copyright: 'Copyright (c) Rik Stokmans',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['src/**/*', 'package.json'],
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  icon: 'build/icon.png',
  asar: true,
  mac: {
    category: 'public.app-category.games',
    identity: null, // unsigned
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    extraResources: [{ from: 'build/bin/darwin-${arch}', to: 'bin', filter: ['wildcall'] }],
  },
  win: {
    signAndEditExecutable: false, // no rcedit/wine: lets Linux and macOS cross-build
    target: [
      { target: 'portable', arch: ['x64'] },
      { target: 'zip', arch: ['x64'] },
    ],
    extraResources: [{ from: 'build/bin/win32-x64', to: 'bin', filter: ['wildcall.exe'] }],
  },
  portable: { artifactName: '${productName}-${version}-portable-${arch}.${ext}' },
};
