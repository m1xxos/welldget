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
  // menu-bar icon on/off (hiding it leaves the widget as the only UI)
  getTrayVisible: () => ipcRenderer.sendSync('widget-get-tray-visible'),
  setTrayVisible: (v) => ipcRenderer.send('widget-tray-visible', v),
  onTrayVisibleChanged: (cb) => ipcRenderer.on('tray-visible-changed', (_e, v) => cb(v)),
  // Dock icon on/off (on also gives the app a menu bar, and with it ⌘Q)
  getDockVisible: () => ipcRenderer.sendSync('widget-get-dock-visible'),
  setDockVisible: (v) => ipcRenderer.send('widget-dock-visible', v),
  onDockVisibleChanged: (cb) => ipcRenderer.on('dock-visible-changed', (_e, v) => cb(v)),
  // manually check GitHub for a newer release
  checkUpdates: () => ipcRenderer.send('widget-check-updates'),
  // quit — the in-app way out when the menu-bar icon is hidden
  quit: () => ipcRenderer.send('widget-quit'),
});
