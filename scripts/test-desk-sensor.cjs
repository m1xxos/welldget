// Automated test for desk auto-detection integration.
// Run with: node scripts/test-desk-sensor.cjs (via Electron)

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const KEY = 'wellness_hybrid_v3';
const INDEX = 'file://' + path.join(__dirname, '..', 'dist', 'index.html');
const PRELOAD = path.join(__dirname, '..', 'electron', 'preload.cjs');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pass(msg) { console.log('  ok   ' + msg); }
function fail(msg, err) {
  console.error(' FAIL  ' + msg + (err ? ' — ' + (err.stack || err) : ''));
  process.exit(1);
}

async function run() {
  await app.whenReady();

  // Setup IPC mock/passthrough for tests before window creation
  let autoDeskState = true;
  ipcMain.on('widget-get-corner', (e) => { e.returnValue = 'top-right'; });
  ipcMain.on('widget-corner', () => {});
  ipcMain.on('widget-get-pinned', (e) => { e.returnValue = false; });
  ipcMain.on('widget-pinned', () => {});
  ipcMain.on('widget-get-tray-visible', (e) => { e.returnValue = true; });
  ipcMain.on('widget-tray-visible', () => {});
  ipcMain.on('widget-get-dock-visible', (e) => { e.returnValue = false; });
  ipcMain.on('widget-dock-visible', () => {});
  ipcMain.on('widget-resize', () => {});

  ipcMain.on('widget-get-auto-desk', (e) => { e.returnValue = autoDeskState; });
  ipcMain.on('widget-auto-desk', (_e, v) => {
    autoDeskState = v;
    if (win && win.webContents) win.webContents.send('auto-desk-changed', autoDeskState);
  });
  ipcMain.on('widget-get-desk-sensor-status', (e) => {
    e.returnValue = { supported: true, available: true, ready: true, state: 'sitting' };
  });

  const win = new BrowserWindow({
    width: 372,
    height: 700,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadURL(INDEX);
  await sleep(600);

  // 1. Check getDeskSensorStatus
  const status = await win.webContents.executeJavaScript('window.widget.getDeskSensorStatus()');
  if (status && status.supported) {
    pass('sensor status reports supported');
  } else {
    fail('sensor status expected supported=true, got: ' + JSON.stringify(status));
  }

  // 2. Check getAutoDesk and toggle
  const initialAuto = await win.webContents.executeJavaScript('window.widget.getAutoDesk()');
  if (initialAuto === true) {
    pass('auto-desk is enabled initially');
  } else {
    fail('expected auto-desk to be true, got ' + initialAuto);
  }

  await win.webContents.executeJavaScript('window.widget.setAutoDesk(false)');
  await sleep(100);
  const disabledAuto = await win.webContents.executeJavaScript('window.widget.getAutoDesk()');
  if (disabledAuto === false) {
    pass('auto-desk toggle off persisted');
  } else {
    fail('expected auto-desk to be false, got ' + disabledAuto);
  }

  await win.webContents.executeJavaScript('window.widget.setAutoDesk(true)');
  await sleep(100);

  // 3. Seed desk task in paused state
  const deskTask = { id: 'desk', label: 'Поработать стоя', type: 'timer', color: '#d98b6f', goalSec: 7200 };
  await win.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({
    day: new Date().toDateString(),
    resetHour: 0,
    tasks: [${JSON.stringify(deskTask)}],
    runtime: { desk: { elapsed: 10, running: false } },
  }))`);
  win.reload();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await sleep(600);

  const rtBefore = await win.webContents.executeJavaScript(
    `JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).runtime.desk`
  );
  if (rtBefore && rtBefore.running === false) {
    pass('seeded desk task is initially paused (running: false)');
  } else {
    fail('expected running: false before event, got: ' + JSON.stringify(rtBefore));
  }

  // 4. Send standing state event
  win.webContents.send('desk-state-changed', { state: 'standing', duration: 8.5, confidence: 0.95 });
  await sleep(400);

  const rtStanding = await win.webContents.executeJavaScript(
    `JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).runtime.desk`
  );
  if (rtStanding && rtStanding.running === true) {
    pass('desk standing event automatically started timer (running: true)');
  } else {
    fail('expected running: true after standing event, got: ' + JSON.stringify(rtStanding));
  }

  // 5. Send sitting state event
  win.webContents.send('desk-state-changed', { state: 'sitting', duration: 8.2, confidence: 0.96 });
  await sleep(400);

  const rtSitting = await win.webContents.executeJavaScript(
    `JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).runtime.desk`
  );
  if (rtSitting && rtSitting.running === false) {
    pass('desk sitting event automatically paused timer (running: false)');
  } else {
    fail('expected running: false after sitting event, got: ' + JSON.stringify(rtSitting));
  }

  console.log('\nAll desk sensor checks passed!');
  win.close();
  app.quit();
}

run().catch(err => fail('unhandled error', err));
