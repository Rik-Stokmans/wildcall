'use strict';
// Sandboxed preload: the only bridge between the game page and the shell.
const { contextBridge, ipcRenderer } = require('electron');

const versionArg = process.argv.find((a) => a.startsWith('--wildcall-version='));

contextBridge.exposeInMainWorld('wildcallDesktop', {
  quit: () => {
    ipcRenderer.send('wildcall:quit');
  },
  toggleFullscreen: () => {
    ipcRenderer.send('wildcall:toggle-fullscreen');
  },
  isFullscreen: () => ipcRenderer.invoke('wildcall:is-fullscreen'),
  platform: process.platform,
  version: versionArg ? versionArg.slice('--wildcall-version='.length) : '0.0.0',
});
