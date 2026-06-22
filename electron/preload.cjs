const { contextBridge, ipcRenderer } = require('electron');

// bridge between the renderer (React) and the main process
contextBridge.exposeInMainWorld('widget', {
  // tell main the real content height so the transparent window fits the card
  setHeight: (h) => ipcRenderer.send('widget-resize', Math.ceil(h)),
  // screen-corner placement
  getCorner: () => ipcRenderer.sendSync('widget-get-corner'),
  setCorner: (corner) => ipcRenderer.send('widget-corner', corner),
  onCornerChanged: (cb) => ipcRenderer.on('corner-changed', (_e, corner) => cb(corner)),
  // always-on-top ("pinned") vs. normal coverable window
  getPinned: () => ipcRenderer.sendSync('widget-get-pinned'),
  setPinned: (v) => ipcRenderer.send('widget-pinned', v),
  onPinnedChanged: (cb) => ipcRenderer.on('pinned-changed', (_e, v) => cb(v)),
  // manually check GitHub for a newer release
  checkUpdates: () => ipcRenderer.send('widget-check-updates'),
});
