// Task regression checks. Runs the built UI in a real (hidden) Electron window,
// seeds localStorage with a task mid-progress, clicks it like a user would and
// watches how the state evolves. Run with: npm test
//
// A real window is the only honest way to test this: the tick lives on a
// setInterval inside the React component, and the widget reads/writes its whole
// state through localStorage.
const { app, BrowserWindow } = require('electron');
const path = require('path');

const KEY = 'wellness_hybrid_v3';
const INDEX = 'file://' + path.join(__dirname, '..', 'dist', 'index.html');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- harness ----

// One hidden window is reused by every test — seed() reloads it in between.
let win;
async function open() {
  if (!win) {
    win = new BrowserWindow({ width: 372, height: 700, show: false });
    await win.loadURL(INDEX);
  }
  return win;
}

// Seed one task + its runtime, then reload so componentDidMount picks it up.
// `day` is stamped inside the page so it matches the widget's own idea of today.
async function seed(win, task, runtime) {
  await win.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({
    day: new Date().toDateString(),
    resetHour: 0,
    tasks: ${JSON.stringify([task])},
    runtime: ${JSON.stringify({ [task.id]: runtime })},
  }))`);
  win.reload();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await sleep(700); // fonts + first render settle
}

const runtimeOf = (win, id) => win.webContents.executeJavaScript(
  `JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).runtime[${JSON.stringify(id)}]`);

const rowText = win => win.webContents.executeJavaScript(
  `(() => { const m = document.body.innerText.match(/\\d+:\\d\\d \\/ [^\\n]+/); return m ? m[0] : null; })()`);

// Tap a task row with a real mouse event — React's synthetic handlers ignore
// programmatic .click() on some of these nodes.
async function tapRow(win, label) {
  const at = await win.webContents.executeJavaScript(`(() => {
    const el = [...document.querySelectorAll('div')]
      .filter(d => (d.textContent || '').includes(${JSON.stringify(label)})).pop();
    if (!el) throw new Error('row not found: ' + ${JSON.stringify(label)});
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  for (const type of ['mouseDown', 'mouseUp']) {
    win.webContents.sendInputEvent({ type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await sleep(60);
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  — ' + detail : ''}`);
}

// ---- tests ----

// A running timer must keep counting after it reaches goalSec (it used to
// freeze exactly on the target while still reading «идёт…»).
async function timerRunsPastGoal() {
  const GOAL = 6, START = 4;
  const task = { id: 'desk', label: 'Поработать стоя', type: 'timer', color: '#d98b6f', goalSec: GOAL };
  const win = await open();
  {
    await seed(win, task, { elapsed: START, running: false });
    await tapRow(win, task.label); // start it

    const seen = [];
    for (let i = 0; i < GOAL + 3; i++) {
      await sleep(1000);
      seen.push((await runtimeOf(win, task.id)).elapsed);
    }
    const last = seen[seen.length - 1];
    const trace = `${START} → ${seen.join(', ')} (goal ${GOAL})`;

    check('timer keeps ticking past its goal', last > GOAL, trace);
    check('timer advances ~1s per second', last >= START + seen.length - 1, trace);
    check('row still shows elapsed / goal', /\/ /.test(await rowText(win) || ''), await rowText(win));

    // and it must still stop on tap
    await tapRow(win, task.label);
    const paused = (await runtimeOf(win, task.id)).elapsed;
    await sleep(2000);
    const after = (await runtimeOf(win, task.id)).elapsed;
    check('tapping past the goal still pauses', after === paused, `${paused} → ${after}`);
  }
}

// A countdown is the opposite case: it must stop at zero, not run negative.
async function countdownStopsAtZero() {
  const task = { id: 'air', label: 'Проветрить', type: 'countdown', mode: 'window', color: '#7d9b76', dur: 6 };
  const win = await open();
  {
    // a seeded "running" countdown resumes on load, so no tap is needed
    await seed(win, task, { phase: 'running', left: 3 });
    await sleep(6000);
    const { left } = await runtimeOf(win, task.id);
    check('countdown never goes below zero', left === 0, `left ${left}`);
  }
}

app.whenReady().then(async () => {
  await timerRunsPastGoal();
  await countdownStopsAtZero();
  if (win) win.destroy();

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  app.exit(failed ? 1 : 0);
}).catch(err => {
  console.error(err);
  app.exit(1);
});
