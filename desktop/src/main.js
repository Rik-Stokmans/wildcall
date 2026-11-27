'use strict';
// Wildcall desktop shell (main process). See docs/contract.md §7.
//
// Environment (development and tests only):
//   WILDCALL_ENGINE_CMD   full command used instead of the bundled engine, e.g. "go run ./cmd/wildcall -dev"
//   WILDCALL_ENGINE_PATH  path to an engine binary used instead of the bundled one
//   WILDCALL_ENGINE_CWD   working directory for the above (default: repo root)
//   WILDCALL_USER_DATA    override the userData (and so save) directory
//   WILDCALL_SMOKE=1      hidden window, no dialogs, verify the page + preload bridge, then exit 0/1
//   WILDCALL_SMOKE_DEEP=1 with SMOKE: also wait until the game reaches its title screen (needs WebGL)

const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Engine, tokenize } = require('./engine');

const SMOKE = process.env.WILDCALL_SMOKE === '1';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const isMac = process.platform === 'darwin';

app.setName('Wildcall');
if (process.env.WILDCALL_USER_DATA) app.setPath('userData', process.env.WILDCALL_USER_DATA);

let engine = null;
let win = null;
let engineOrigin = '';
let quitting = false;

function engineBase() {
  if (process.env.WILDCALL_ENGINE_CMD) return tokenize(process.env.WILDCALL_ENGINE_CMD);
  if (process.env.WILDCALL_ENGINE_PATH) return [process.env.WILDCALL_ENGINE_PATH];
  const exe = process.platform === 'win32' ? 'wildcall.exe' : 'wildcall';
  return [path.join(process.resourcesPath, 'bin', exe)];
}

function fail(title, detail) {
  if (SMOKE) {
    process.stderr.write(`SMOKE_FAIL ${title}\n${detail}\n`);
    shutdown(1);
    return;
  }
  dialog.showErrorBox(title, detail);
  shutdown(1);
}

/** Stop the engine (letting it save), then leave. Safe to call more than once. */
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  quitting = true;
  const done = () => app.exit(code);
  if (engine) engine.stop().then(done, done);
  else done();
}

function installMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]),
  );
}

function toggleFullscreen() {
  if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#1c2a22',
    title: 'WILDCALL',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--wildcall-version=${app.getVersion()}`],
    },
  });

  win.on('page-title-updated', (e) => e.preventDefault()); // keep the title "WILDCALL"
  win.once('ready-to-show', () => {
    if (!SMOKE) win.show();
  });
  win.on('closed', () => {
    win = null;
    shutdown(0); // closing the window quits on every platform, engine included
  });

  // F11 everywhere; Ctrl-Cmd-F comes from the macOS View menu role, so do not double-handle it.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  // Only the engine's own origin may be shown; nothing opens new windows.
  const allowed = (u) => {
    try {
      return new URL(u).origin === engineOrigin;
    } catch {
      return false;
    }
  };
  win.webContents.on('will-navigate', (e, u) => {
    if (!allowed(u)) e.preventDefault();
  });
  win.webContents.on('will-redirect', (e, u) => {
    if (!allowed(u)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      try {
        const info = await win.webContents.executeJavaScript(
          `({title: document.title, body: document.body ? document.body.innerText : '',
             bridge: typeof window.wildcallDesktop,
             api: window.wildcallDesktop ? {
               quit: typeof window.wildcallDesktop.quit,
               toggleFullscreen: typeof window.wildcallDesktop.toggleFullscreen,
               isFullscreen: typeof window.wildcallDesktop.isFullscreen,
               platform: window.wildcallDesktop.platform,
               version: window.wildcallDesktop.version,
               node: typeof require} : null})`,
        );
        const fsState = await win.webContents.executeJavaScript('window.wildcallDesktop.isFullscreen()');
        if (info.bridge !== 'object' || info.api.quit !== 'function' || info.api.toggleFullscreen !== 'function' ||
            info.api.isFullscreen !== 'function' || typeof fsState !== 'boolean' || info.api.node !== 'undefined') {
          fail('Smoke: bridge wrong', JSON.stringify(info));
          return;
        }
        // WILDCALL_SMOKE_DEEP=1: also wait for the game itself to come up - the client
        // connected to the engine over its WebSocket, received the world and reached the
        // title screen. Needs WebGL; where there is none (some CI machines) the shallow
        // check stands and the result says so.
        if (process.env.WILDCALL_SMOKE_DEEP === '1') {
          const deep = await win.webContents.executeJavaScript(`(async () => {
            const gl = !!document.createElement('canvas').getContext('webgl2');
            const t0 = Date.now();
            let mode = 'none';
            while (Date.now() - t0 < 90000) {
              mode = (window.wildcall && window.wildcall.state && window.wildcall.state.mode) || 'none';
              if (mode === 'mainmenu' || mode === 'play') break;
              await new Promise((r) => setTimeout(r, 500));
            }
            const st = window.wildcall && window.wildcall.state;
            return { webgl2: gl, mode, seconds: Math.round((Date.now() - t0) / 100) / 10,
              species: st && st.species ? st.species.length : 0,
              chunks: window.wildcall && window.wildcall.world && window.wildcall.world.debug ? window.wildcall.world.debug.chunks : 0,
              bootText: (document.getElementById('boot-status') || {}).textContent || '' };
          })()`);
          info.deep = deep;
          if (deep.webgl2 && deep.mode !== 'mainmenu' && deep.mode !== 'play') {
            fail('Smoke: the game did not reach the title screen', JSON.stringify(deep));
            return;
          }
        }
        process.stdout.write(`SMOKE_OK ${JSON.stringify(info)}\n`);
        shutdown(0);
      } catch (err) {
        fail('Smoke: page check threw', String(err));
      }
    });
  }
  win.webContents.on('did-fail-load', (_e, code, desc, u) => {
    fail('The game page could not be loaded', `${desc} (${code}) at ${u}\n\n${engine ? engine.output() : ''}`);
  });
  win.loadURL(url);
}

ipcMain.on('wildcall:quit', () => shutdown(0));
ipcMain.on('wildcall:toggle-fullscreen', toggleFullscreen);
ipcMain.handle('wildcall:is-fullscreen', () => !!(win && !win.isDestroyed() && win.isFullScreen()));

async function boot() {
  const saveDir = app.getPath('userData');
  fs.mkdirSync(saveDir, { recursive: true });
  const usingOverride = process.env.WILDCALL_ENGINE_CMD || process.env.WILDCALL_ENGINE_PATH;
  engine = new Engine({
    base: engineBase(),
    saveDir,
    cwd: usingOverride ? process.env.WILDCALL_ENGINE_CWD || REPO_ROOT : undefined,
  });
  let url;
  try {
    url = await engine.start();
  } catch (err) {
    fail('Wildcall could not start', err.message);
    return;
  }
  engineOrigin = new URL(url).origin;
  engine.onExit = (code, signal) => {
    if (quitting) return;
    fail('The Wildcall engine stopped unexpectedly',
      `It exited (${signal ? 'signal ' + signal : 'code ' + code}). Your progress was saved when possible.\n\n${engine.output()}`);
  };
  // Deny every permission request: the game needs none (audio output is not a permission).
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  installMenu();
  createWindow(url);
}

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.on('window-all-closed', () => shutdown(0));
  app.on('before-quit', (e) => {
    if (!shuttingDown) {
      e.preventDefault();
      shutdown(0);
    }
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));
  app.whenReady().then(boot);
}
