// Menu-bar / Dock icon visibility checks. Boots the real main process against a
// throwaway profile and flips the switches the way the settings toggles do, then
// watches the tray, the Dock, the window and config.json follow. Run with: npm test
//
// macOS is fussy here in ways only a live app shows: setVisibleOnAllWorkspaces()
// silently puts the app back on a regular (Dock-icon) activation policy, and
// once that has happened app.dock.hide() is ignored for the rest of the run. So
// these checks guard behaviour that no unit test could see.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}   ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
}

// a fresh profile, so the app starts from its defaults and the real config.json
// written by the main process can be read back
app.setPath('userData', path.join(app.getPath('temp'), 'welldget-icons-test-' + Date.now()));
const cfg = () => {
  try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8')); }
  catch (e) { return {}; }
};

require(path.join(__dirname, '..', 'electron', 'main.cjs'));

app.whenReady().then(async () => {
  await sleep(2500); // let the window load and the tray settle
  const win = () => BrowserWindow.getAllWindows()[0];
  const js = code => win().webContents.executeJavaScript(code);
  // drive the bridge the settings toggles use, then let macOS act on it
  const set = async (what, v) => { await js(`window.widget.set${what}(${v})`); await sleep(500); };

  check('window exists', !!win());
  check('menu-bar icon on by default', await js('window.widget.getTrayVisible()') === true);
  check('Dock icon off by default', await js('window.widget.getDockVisible()') === false);
  check('app starts as an accessory', !app.dock.isVisible());

  // ---- Dock icon ----
  await set('DockVisible', true);
  check('Dock icon appears', app.dock.isVisible());
  check('Dock state persisted', cfg().dockVisible === true, JSON.stringify(cfg()));
  check('renderer sees it', await js('window.widget.getDockVisible()') === true);

  // with a Dock icon left to click, dropping the tray must not force the widget back
  win().hide();
  await set('TrayVisible', false);
  check('hidden widget stays hidden while the Dock icon remains', !win().isVisible());

  // ---- last icon gone → the widget is the only way back in ----
  await set('DockVisible', false);
  check('Dock icon gone', !app.dock.isVisible());
  check('widget reappears when the last icon is switched off', win().isVisible());
  check('both flags persisted', cfg().trayVisible === false && cfg().dockVisible === false, JSON.stringify(cfg()));

  await set('TrayVisible', true);
  check('menu-bar icon restored', await js('window.widget.getTrayVisible()') === true);
  check('persisted back', cfg().trayVisible === true, JSON.stringify(cfg()));

  win().hide();
  await set('TrayVisible', false);
  check('hidden widget returns when its only icon goes away', win().isVisible());

  // ---- pinning must not leak a Dock icon ----
  await set('TrayVisible', true);
  await set('Pinned', true);
  check('pinning keeps the Dock icon away', !app.dock.isVisible());
  await set('Pinned', false);
  check('unpinning keeps the Dock icon away', !app.dock.isVisible());
  check('widget survived the pin round-trip', win().isVisible());

  console.log(fails ? `\n${fails}/${fails} icon checks failed` : '\nall icon checks passed');
  app.exit(fails ? 1 : 0);
});
