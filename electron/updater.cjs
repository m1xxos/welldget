// Lightweight update checker for an unsigned app.
//
// True silent auto-install (Squirrel.Mac / electron-updater) requires the app
// to be code-signed with an Apple Developer ID, which welldget isn't. So instead
// we poll the GitHub "latest release" and, if a newer version exists, prompt the
// user and open the matching DMG in their browser to download manually.
const https = require('https');
const { app, dialog, shell, BrowserWindow } = require('electron');

const REPO = 'm1xxos/welldget';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

function getJSON(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'welldget-updater', Accept: 'application/vnd.github+json' },
    }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location && redirects < 5) {
        res.resume();
        return getJSON(headers.location, redirects + 1).then(resolve, reject);
      }
      if (statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + statusCode)); }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
  });
}

// compare dotted versions; true when `latest` is strictly newer than `current`
function isNewer(latest, current) {
  const a = String(latest).split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(current).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

async function checkForUpdates({ silent = true } = {}) {
  try {
    const rel = await getJSON(LATEST_URL);
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    const current = app.getVersion();
    if (!latest) throw new Error('no release tag');

    if (!isNewer(latest, current)) {
      if (!silent) {
        dialog.showMessageBox({ type: 'info', buttons: ['OK'],
          message: 'У вас последняя версия', detail: `welldget ${current}` });
      }
      return;
    }

    // prefer the DMG built for this Mac's architecture
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const asset = (rel.assets || []).find((a) => a.name && a.name.includes(arch) && a.name.endsWith('.dmg'));
    const url = asset ? asset.browser_download_url : (rel.html_url || `https://github.com/${REPO}/releases/latest`);

    const win = BrowserWindow.getAllWindows()[0];
    const opts = {
      type: 'info', buttons: ['Скачать', 'Позже'], defaultId: 0, cancelId: 1,
      message: `Доступна новая версия welldget ${latest}`,
      detail: `Установлена ${current}. Скачать обновление?`,
    };
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (response === 0) shell.openExternal(url);
  } catch (e) {
    if (!silent) {
      dialog.showMessageBox({ type: 'error', buttons: ['OK'],
        message: 'Не удалось проверить обновления', detail: String(e.message || e) });
    }
  }
}

module.exports = { checkForUpdates };
