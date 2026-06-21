// Renders the widget (in its Electron "widget" layout) and saves a PNG for the
// README. Run with: npm run screenshot  →  build/screenshot.png
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const WIDTH = 372;
const OUT = path.join(__dirname, '..', 'build', 'screenshot.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: 600,
    show: false,
    // a soft desktop-like backdrop so the floating card reads as a widget
    backgroundColor: '#b9bca4',
    webPreferences: { offscreen: false },
  });

  await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // let fonts + ring animations settle
  await new Promise(r => setTimeout(r, 1200));

  // find the floating card's bounds so we can crop to it with even margins
  const card = await win.webContents.executeJavaScript(`(() => {
    const el = [...document.querySelectorAll('div')].find(d => getComputedStyle(d).boxShadow !== 'none');
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  })()`);

  const img = await win.webContents.capturePage();
  const M = 22; // breathing room around the card
  const cropped = img.crop({
    x: Math.max(0, Math.round(card.x - M)),
    y: Math.max(0, Math.round(card.y - M)),
    width: Math.round(card.w + M * 2),
    height: Math.round(card.h + M * 2),
  });
  fs.writeFileSync(OUT, cropped.toPNG());
  console.log('saved', OUT);
  app.quit();
});
