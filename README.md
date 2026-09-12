# welldget — Wellness Widget

A small macOS desktop widget that floats in the corner of your screen: a daily
wellness checklist with counters, timers, countdowns (incl. a "window airing"
mode) and check-off tasks. State is kept in `localStorage` and resets each day.

<p align="center">
  <img src="build/screenshot.png" alt="welldget floating widget" width="320">
</p>

Imported from the Claude Design prototype `Wellness Widget.dc.html` and wrapped
in a frameless, transparent, always-on-top **Electron** window pinned to the
top-right corner.

## Run it

```bash
npm install
npm run app          # builds the UI and opens the floating widget
```

The widget appears in a screen corner (top-right by default), lives in the
**menu bar** (no Dock icon), and floats above other windows. The window
auto-sizes to the card's height.

- **Move it:** drag by the grip strip at the top of the card.
- **Pick a corner:** Settings (⚙) → «где показывать» (top/bottom · left/right),
  or the menu-bar icon → «Где показывать». The choice is remembered.
- **Show / hide:** click the menu-bar icon.
- **Always-on-top:** Settings (⚙) → «поверх всех окон», or the menu-bar icon.
  Off by default, so the widget can be covered like a normal window.
- **Menu-bar icon:** Settings (⚙) → «иконка в меню-баре», or the menu-bar icon →
  «Скрыть эту иконку». On by default.
- **Dock icon:** Settings (⚙) → «иконка в доке», or the menu-bar icon → «Иконка в
  доке». Off by default — the widget normally lives in the menu bar only. Turning
  it on also gives the app a menu bar of its own.
- Both choices are remembered. The menu-bar icon, the Dock icon and the widget
  are the three ways to reach the app, so switching off the **last** icon always
  brings the widget back on screen and Settings grows a «Выйти из welldget»
  button — otherwise the app would keep running with nothing left to click.
- **New-day reset:** Settings (⚙) → «начало нового дня» picks the hour at which a
  new day starts and all task progress clears. The widget rolls over on its own
  while running, not just on relaunch.
- **Updates:** the app checks GitHub releases on launch, via the menu-bar icon →
  «Проверить обновления…», and via Settings (⚙) → «Проверить обновления». If a
  newer version exists it offers to open the matching DMG for download.
  *(Auto-install in place would require a signed app; see the signing note below.)*
- **Quit:** menu-bar icon → «Выход», Settings (⚙) → «Выйти из welldget» when the
  icon is hidden, or ⌘Q while focused.

### Icons

`npm run icons` regenerates `build/icon.png` and the menu-bar template from
`scripts/gen-icon.cjs` (a sage rounded square with a cream ring + checkmark).
The `.icns` is built from that PNG with `sips` + `iconutil`.

`npm run screenshot` regenerates `build/screenshot.png` (the image above) by
rendering the widget in a headless Electron window and cropping to the card.

### Tests

```bash
npm test             # builds, then runs scripts/test-timers.cjs
```

`scripts/test-timers.cjs` drives the real UI in a hidden Electron window: it
seeds `localStorage` with a task mid-progress, taps its row with a real mouse
event and watches how the runtime evolves. That covers the parts unit tests would
miss — the 1s `setInterval`, the localStorage round-trip and the tap handlers.

`scripts/test-icons.cjs` boots the real main process against a throwaway profile
and flips the menu-bar / Dock switches through the same bridge the settings
toggles use. macOS is fussy here in ways only a live app shows:
`setVisibleOnAllWorkspaces()` quietly puts the app back on a regular (Dock-icon)
activation policy, and once that has happened `app.dock.hide()` is ignored for
the rest of the run — so `electron/main.cjs` sets the activation policy
explicitly and re-asserts it after pinning.

Both exit non-zero on the first failing check, so they work as a CI gate.

### Live development

```bash
npm run dev          # terminal 1 — Vite dev server on :5173
npm run app:dev      # terminal 2 — Electron pointed at the dev server (hot reload)
```

### Web preview (optional)

The UI also runs as a plain web page (full-screen beige background instead of
the floating card):

```bash
npm run dev          # open the printed http://localhost:5173 URL
```

## Packaging a standalone `.app`

```bash
npm run dist         # → release/mac-arm64/welldget.app
```

> **Note on signing:** the produced `.app` runs only after it is code-signed.
> Ad-hoc signing is rejected by macOS AMFI for Electron's JIT, so to get a
> double-clickable, distributable app you need an Apple **Developer ID**
> certificate. Set it in the `build.mac` config (electron-builder) and re-run
> `npm run dist`. For day-to-day personal use, `npm run app` is the simplest
> way to launch the widget.

## Layout

| Path | What |
|------|------|
| `src/WellnessWidget.jsx` | The widget UI + all task logic (React) |
| `src/main.jsx`, `src/index.css` | React entry + keyframes |
| `electron/main.cjs` | Frameless transparent corner window + menu-bar tray |
| `electron/updater.cjs` | Checks GitHub releases and prompts to download updates |
| `scripts/test-timers.cjs` | Timer/countdown regression checks (`npm test`) |
| `scripts/test-icons.cjs` | Menu-bar / Dock icon visibility checks (`npm test`) |
| `index.html` | Fonts (Nunito + Caveat) and root |
| `build/entitlements.mac.plist` | macOS JIT entitlements for signing |
