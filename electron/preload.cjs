const { contextBridge, ipcRenderer } = require('electron');

// let the renderer tell the main process its real content height,
// so the transparent window can shrink to fit the card
contextBridge.exposeInMainWorld('widget', {
  setHeight: (h) => ipcRenderer.send('widget-resize', Math.ceil(h)),
});
