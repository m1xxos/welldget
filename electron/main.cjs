const { app, BrowserWindow, screen, Menu, Tray, nativeImage } = require('electron');
const path = require('path');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const WIDTH = 372;
const HEIGHT = 640;
const MARGIN = 16;

let win = null;
let tray = null;

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  // top-right corner of the active display
  const x = Math.round(workArea.x + workArea.width - WIDTH - MARGIN);
  const y = Math.round(workArea.y + MARGIN);

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // show on every Space and even over fullscreen apps
    visibleOnAllWorkspaces: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // float above normal windows without stealing focus from fullscreen apps
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.on('closed', () => { win = null; });
}

function toggleWindow() {
  if (!win) { createWindow(); return; }
  if (win.isVisible()) win.hide();
  else win.show();
}

function createTray() {
  // simple template-image dot so the widget can be toggled / quit from the menu bar
  const img = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAVUlEQVR4nO3SMQ7AIAxD0e9/6XRpJQYkFCkLfpJnFCdyrA0AAAAAAAAAAAAAAAAA8KdmZpaZ2T0z3T0z3b07d3f3iIjuvru7eyLi7d5793Z3d/cHkQ8M2QnQ2bsAAAAASUVORK5CYII='
  );
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('welldget');
  const menu = Menu.buildFromTemplate([
    { label: 'Показать / скрыть виджет', click: toggleWindow },
    { type: 'separator' },
    { label: 'Выход', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', toggleWindow);
}

app.whenReady().then(() => {
  // menu-bar widget: no Dock icon
  if (app.dock) app.dock.hide();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// keep running in the menu bar after the window closes
app.on('window-all-closed', () => {});
