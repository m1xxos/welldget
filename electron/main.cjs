const { app, BrowserWindow, screen, Menu, Tray, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { checkForUpdates } = require('./updater.cjs');

const SIX_HOURS = 6 * 60 * 60 * 1000;
const DOCK_SETTLE = 150; // ms macOS takes to act on an activation-policy change

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const WIDTH = 372;
const HEIGHT = 200; // initial; the renderer reports its real height and we resize to fit
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 900;
const MARGIN = 16;

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const CORNER_LABELS = {
  'top-left': 'Сверху слева',
  'top-right': 'Сверху справа',
  'bottom-left': 'Снизу слева',
  'bottom-right': 'Снизу справа',
};

let win = null;
let tray = null;
let corner = 'top-right';
let pinned = false; // false → behaves like a normal window that other apps can cover
let trayVisible = true; // false → no menu-bar icon; the widget itself is the only UI
let dockVisible = false; // false → accessory app: no Dock icon, no app menu

// ---- persistence (main process owns the config) ----
function configPath() { return path.join(app.getPath('userData'), 'config.json'); }
function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (CORNERS.includes(c.corner)) corner = c.corner;
    if (typeof c.pinned === 'boolean') pinned = c.pinned;
    if (typeof c.trayVisible === 'boolean') trayVisible = c.trayVisible;
    if (typeof c.dockVisible === 'boolean') dockVisible = c.dockVisible;
  } catch (e) {}
}
function saveConfig() {
  try { fs.writeFileSync(configPath(), JSON.stringify({ corner, pinned, trayVisible, dockVisible })); } catch (e) {}
}

// when pinned, float above everything on every Space; otherwise act like a
// normal window that lives on one Space and can be covered by other apps
function applyPinned() {
  if (!win) return;
  win.setAlwaysOnTop(pinned, 'floating');
  win.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: pinned });
  // that call puts the app back on a regular activation policy, which resurrects
  // the Dock icon — so re-assert whichever one the user actually asked for. It
  // lands a moment later than the call itself, hence the second pass.
  applyDockPolicy();
  setTimeout(applyDockPolicy, DOCK_SETTLE);
}

function setPinned(next) {
  next = !!next;
  if (next === pinned) return;
  pinned = next;
  saveConfig();
  applyPinned();
  buildTrayMenu();
  if (win) win.webContents.send('pinned-changed', pinned); // keep the in-app UI in sync
}

// The menu-bar icon, the Dock icon and the widget itself are the three ways to
// reach the app. Dropping the last icon while the widget is hidden would leave a
// running app with nothing to click, so in that case the widget comes back.
function ensureReachable() {
  if (trayVisible || dockVisible) return;
  if (!win) createWindow();
  else if (!win.isVisible()) win.show();
}

function setTrayVisible(next) {
  next = !!next;
  if (next === trayVisible) return;
  trayVisible = next;
  saveConfig();
  applyTrayVisible();
  if (win) win.webContents.send('tray-visible-changed', trayVisible);
}

function applyTrayVisible() {
  if (trayVisible) {
    if (!tray) createTray();
    else buildTrayMenu();
    return;
  }
  if (tray) { tray.destroy(); tray = null; }
  ensureReachable();
}

function setDockVisible(next) {
  next = !!next;
  if (next === dockVisible) return;
  dockVisible = next;
  saveConfig();
  applyDockVisible();
  buildTrayMenu();
  if (win) win.webContents.send('dock-visible-changed', dockVisible);
}

// Showing the Dock icon also turns the app from an accessory into a regular one,
// which is what gives it an app menu (and with it a working ⌘Q).
//
// The activation policy is set explicitly rather than left to app.dock.hide():
// once anything has flipped the app to the regular policy (setVisibleOnAllWorkspaces
// does, see applyPinned) macOS quietly ignores app.dock.hide() for the rest of
// the run, while setActivationPolicy() still gets through.
function applyDockPolicy() {
  if (!app.dock) return;
  if (dockVisible) {
    app.setActivationPolicy('regular');
    app.dock.show();
  } else {
    app.setActivationPolicy('accessory');
    app.dock.hide();
  }
}

function applyDockVisible() {
  applyDockPolicy();
  ensureReachable();
}

// ---- place the window at the configured corner given its current size ----
function placeWindow() {
  if (!win) return;
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = win.getSize();
  const left = workArea.x + MARGIN;
  const right = workArea.x + workArea.width - w - MARGIN;
  const top = workArea.y + MARGIN;
  const bottom = workArea.y + workArea.height - h - MARGIN;
  const map = {
    'top-left': [left, top],
    'top-right': [right, top],
    'bottom-left': [left, bottom],
    'bottom-right': [right, bottom],
  };
  const [x, y] = map[corner] || map['top-right'];
  win.setPosition(Math.round(x), Math.round(y));
}

function setCorner(next) {
  if (!CORNERS.includes(next) || next === corner) return;
  corner = next;
  saveConfig();
  placeWindow();
  buildTrayMenu();
  if (win) win.webContents.send('corner-changed', corner); // keep the in-app UI in sync
}

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: pinned,
    visibleOnAllWorkspaces: pinned,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  applyPinned();

  placeWindow();

  // open task links (e.g. Hacker News) in the user's default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.on('closed', () => { win = null; });
}

// resize to the height the renderer reports, then re-anchor to the chosen corner
ipcMain.on('widget-resize', (_e, h) => {
  if (!win) return;
  const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(h)));
  const [w, cur] = win.getContentSize();
  if (cur !== height || w !== WIDTH) win.setContentSize(WIDTH, height);
  placeWindow();
});

ipcMain.on('widget-corner', (_e, next) => setCorner(next));
ipcMain.on('widget-get-corner', (e) => { e.returnValue = corner; });

ipcMain.on('widget-pinned', (_e, next) => setPinned(next));
ipcMain.on('widget-get-pinned', (e) => { e.returnValue = pinned; });

ipcMain.on('widget-tray-visible', (_e, next) => setTrayVisible(next));
ipcMain.on('widget-get-tray-visible', (e) => { e.returnValue = trayVisible; });

ipcMain.on('widget-dock-visible', (_e, next) => setDockVisible(next));
ipcMain.on('widget-get-dock-visible', (e) => { e.returnValue = dockVisible; });

ipcMain.on('widget-check-updates', () => checkForUpdates({ silent: false }));

ipcMain.on('widget-quit', () => app.quit());

function toggleWindow() {
  if (!win) { createWindow(); return; }
  if (win.isVisible()) win.hide();
  else win.show();
}

function trayIcon() {
  const p = path.join(__dirname, 'trayTemplate.png');
  if (fs.existsSync(p)) {
    const img = nativeImage.createFromPath(p);
    img.setTemplateImage(true);
    return img;
  }
  // fallback dot if the asset is missing
  const img = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAVUlEQVR4nO3SMQ7AIAxD0e9/6XRpJQYkFCkLfpJnFCdyrA0AAAAAAAAAAAAAAAAA8KdmZpaZ2T0z3T0z3b07d3f3iIjuvru7eyLi7d5793Z3d/cHkQ8M2QnQ2bsAAAAASUVORK5CYII='
  );
  img.setTemplateImage(true);
  return img;
}

function buildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Показать / скрыть виджет', click: toggleWindow },
    { type: 'separator' },
    { label: 'Поверх всех окон', type: 'checkbox', checked: pinned, click: () => setPinned(!pinned) },
    { label: 'Иконка в доке', type: 'checkbox', checked: dockVisible, click: () => setDockVisible(!dockVisible) },
    { label: 'Скрыть эту иконку', click: () => setTrayVisible(false) },
    { label: 'Проверить обновления…', click: () => checkForUpdates({ silent: false }) },
    {
      label: 'Где показывать',
      submenu: CORNERS.map(c => ({
        label: CORNER_LABELS[c],
        type: 'radio',
        checked: corner === c,
        click: () => setCorner(c),
      })),
    },
    { type: 'separator' },
    { label: 'Выход', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('welldget');
  buildTrayMenu();
  tray.on('click', toggleWindow);
}

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  if (trayVisible) createTray();
  // menu-bar widget by default: no Dock icon unless the user asked for one
  applyDockPolicy();

  // check GitHub for a newer release shortly after launch, then periodically
  setTimeout(() => checkForUpdates({ silent: true }), 4000);
  setInterval(() => checkForUpdates({ silent: true }), SIX_HOURS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (win && !win.isVisible()) win.show();
  });
});

// keep running in the menu bar after the window closes
app.on('window-all-closed', () => {});
