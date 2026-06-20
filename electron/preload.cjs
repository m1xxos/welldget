const { contextBridge, ipcRenderer } = require('electron');

// bridge between the renderer (React) and the main process
contextBridge.exposeInMainWorld('widget', {
  // tell main the real content height so the transparent window fits the card
  setHeight: (h) => ipcRenderer.send('widget-resize', Math.ceil(h)),
  // screen-corner placement
  getCorner: () => ipcRenderer.sendSync('widget-get-corner'),
  setCorner: (corner) => ipcRenderer.send('widget-corner', corner),
  onCornerChanged: (cb) => ipcRenderer.on('corner-changed', (_e, corner) => cb(corner)),
});
