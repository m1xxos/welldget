import React from 'react';

/* ---- hover helper: merges hoverStyle on mouse over ---- */
function Hover({ as: Tag = 'div', baseStyle, hoverStyle, children, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <Tag
      style={{ ...baseStyle, ...(hover ? hoverStyle : null) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

const FONT = "'Nunito',sans-serif";
const CAVEAT = "'Caveat',cursive";

export default class WellnessWidget extends React.Component {
  isWidget = typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent);
  pageRef = React.createRef();
  _lastH = 0;
  KEY = 'wellness_hybrid_v3';
  PALETTE = ['#9aab78', '#8fb6b0', '#d98b6f', '#b79a78', '#cba85f', '#a99bc4'];
  PER_OPTIONS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];

  defaults() {
    return [
      { id: 'water', label: 'Попить воды', type: 'counter', color: '#8fb6b0', reps: 8, per: 0.25, unit: 'л' },
      { id: 'window', label: 'Открыть окно', type: 'countdown', color: '#94a886', mode: 'window', dur: 300 },
      { id: 'desk', label: 'Поработать стоя', type: 'timer', color: '#d98b6f', goalSec: 7200 },
      { id: 'eyes', label: 'Пауза для глаз', type: 'counter', color: '#b79a78', reps: 3, per: 1, unit: '' },
      { id: 'walk', label: 'Пройтись', type: 'check', color: '#cba85f', link: '' },
      { id: 'hn', label: 'Hacker News', type: 'check', color: '#e0794a', link: 'https://news.ycombinator.com' },
    ];
  }

  initRuntime(t) {
    if (t.type === 'counter') return { count: 0 };
    if (t.type === 'timer') return { elapsed: 0, running: false };
    if (t.type === 'countdown') return { phase: 'idle', left: t.dur };
    return { done: false };
  }

  state = {
    day: new Date().toDateString(), tasks: this.defaults(), runtime: {}, view: 'list',
    newName: '', newType: 'counter', newReps: 8, newPer: 1, newUnit: '', newMin: 30, newUrl: '',
  };

  // ---- migration from older shapes ----
  migrate(t) {
    if (t.type === 'window') return { id: t.id, label: t.label, type: 'countdown', mode: 'window', color: t.color, dur: t.airingSec || 300 };
    if (t.type === 'link') return { id: t.id, label: t.label, type: 'check', color: t.color, link: t.link || '' };
    if (t.type === 'counter') {
      const per = (typeof t.per === 'number') ? t.per : (typeof t.perUnit === 'number' ? t.perUnit : 1);
      let reps = (typeof t.reps === 'number') ? t.reps
        : (typeof t.target === 'number') ? t.target
        : (typeof t.goal === 'number') ? Math.round(t.goal / per) : 8;
      if (!(reps > 0)) reps = 8;
      return { id: t.id, label: t.label, type: 'counter', color: t.color, reps, per, unit: t.unit || '' };
    }
    return t;
  }

  migrateRuntime(t, r) {
    if (!r) return this.initRuntime(t);
    if (t.type === 'countdown') {
      const map = { closed: 'idle', airing: 'running', done: 'done', idle: 'idle', running: 'running' };
      const phase = map[r.phase] || 'idle';
      return { phase, left: (phase === 'running' && typeof r.left === 'number') ? r.left : t.dur };
    }
    if (t.type === 'timer') return { elapsed: r.elapsed || 0, running: false };
    if (t.type === 'counter') return { count: r.count || 0 };
    return { done: !!r.done };
  }

  componentDidMount() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        const p = JSON.parse(raw);
        const today = new Date().toDateString();
        const tasks = (p.tasks && p.tasks.length ? p.tasks : this.defaults()).map(t => this.migrate(t));
        const runtime = {};
        if (p.day === today && p.runtime) tasks.forEach(t => { runtime[t.id] = this.migrateRuntime(t, p.runtime[t.id]); });
        else tasks.forEach(t => { runtime[t.id] = this.initRuntime(t); });
        this.setState({ day: today, tasks, runtime });
      } else {
        const rt = {}; this.state.tasks.forEach(t => { rt[t.id] = this.initRuntime(t); });
        this.setState({ runtime: rt });
      }
    } catch (e) {}
    this.timer = setInterval(() => this.tick(), 1000);
    // report once fonts settle so the measured height is accurate
    this.reportHeight();
    setTimeout(() => this.reportHeight(), 250);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.reportHeight());
  }

  componentWillUnmount() { clearInterval(this.timer); }

  componentDidUpdate() {
    try { const { day, tasks, runtime } = this.state; localStorage.setItem(this.KEY, JSON.stringify({ day, tasks, runtime })); } catch (e) {}
    this.reportHeight();
  }

  // tell Electron the real content height so the transparent window fits the card
  reportHeight() {
    if (!this.isWidget || !window.widget || !this.pageRef.current) return;
    const h = Math.ceil(this.pageRef.current.getBoundingClientRect().height);
    if (h && h !== this._lastH) { this._lastH = h; window.widget.setHeight(h); }
  }

  tick() {
    this.setState(s => {
      let changed = false; const rt = { ...s.runtime };
      s.tasks.forEach(t => {
        const r = rt[t.id]; if (!r) return;
        if (t.type === 'timer' && r.running && r.elapsed < t.goalSec) { rt[t.id] = { ...r, elapsed: r.elapsed + 1 }; changed = true; }
        if (t.type === 'countdown' && r.phase === 'running' && r.left > 0) { rt[t.id] = { ...r, left: r.left - 1 }; changed = true; }
      });
      return changed ? { runtime: rt } : null;
    });
  }

  rt(id) { const t = this.state.tasks.find(x => x.id === id); return this.state.runtime[id] || this.initRuntime(t || {}); }
  setRT(id, val) { this.setState(s => ({ runtime: { ...s.runtime, [id]: val } })); }

  tapTask(t) {
    const r = this.rt(t.id);
    if (t.type === 'check') this.setRT(t.id, { done: !r.done });
    else if (t.type === 'counter') this.setRT(t.id, { count: r.count >= t.reps ? 0 : r.count + 1 });
    else if (t.type === 'timer') this.setRT(t.id, { ...r, running: !r.running });
    else if (t.type === 'countdown') {
      if (r.phase === 'idle') this.setRT(t.id, { phase: 'running', left: t.dur });
      else if (r.phase === 'running') this.setRT(t.id, { phase: 'done', left: 0 });
      else this.setRT(t.id, { phase: 'idle', left: t.dur });
    }
  }

  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  r2(n) { return Math.round(n * 100) / 100; }
  numRu(n) { return String(+Number(n).toFixed(2)).replace('.', ','); }
  cyclePer(per, dir) { let i = this.PER_OPTIONS.findIndex(x => Math.abs(x - per) < 1e-9); if (i < 0) i = 4; i = this.clamp(i + dir, 0, this.PER_OPTIONS.length - 1); return this.PER_OPTIONS[i]; }

  patch(id, fn) { this.setState(s => ({ tasks: s.tasks.map(t => t.id === id ? fn(t) : t) })); }
  editName(id, v) { this.patch(id, t => ({ ...t, label: v })); }
  editUnit(id, v) { this.patch(id, t => ({ ...t, unit: v })); }
  editLink(id, v) { this.patch(id, t => ({ ...t, link: v })); }
  editReps(id, dir) { this.patch(id, t => ({ ...t, reps: this.clamp(t.reps + dir, 1, 50) })); }
  editPer(id, dir) { this.patch(id, t => ({ ...t, per: this.cyclePer(t.per, dir) })); }
  editTimed(id, dir) { this.patch(id, t => t.type === 'timer' ? { ...t, goalSec: this.clamp(t.goalSec + dir * 900, 900, 28800) } : { ...t, dur: this.clamp(t.dur + dir * 60, 60, 5400) }); }
  removeTask(id) { this.setState(s => { const rt = { ...s.runtime }; delete rt[id]; return { tasks: s.tasks.filter(t => t.id !== id), runtime: rt }; }); }

  pickType(type) { this.setState({ newType: type }); }
  newStepReps(dir) { this.setState(s => ({ newReps: this.clamp(s.newReps + dir, 1, 50) })); }
  newStepPer(dir) { this.setState(s => ({ newPer: this.cyclePer(s.newPer, dir) })); }
  newStepMin(dir) { this.setState(s => ({ newMin: this.clamp(s.newMin + dir * 5, 5, 480) })); }

  addTask() {
    const s = this.state, label = s.newName.trim(); if (!label) return;
    const id = 'c' + Date.now(), color = this.PALETTE[s.tasks.length % this.PALETTE.length];
    let task;
    if (s.newType === 'counter') task = { id, label, type: 'counter', color, reps: s.newReps, per: s.newPer, unit: s.newUnit.trim() };
    else if (s.newType === 'timer') task = { id, label, type: 'timer', color, goalSec: s.newMin * 60 };
    else if (s.newType === 'countdown') task = { id, label, type: 'countdown', color, dur: s.newMin * 60 };
    else task = { id, label, type: 'check', color, link: s.newUrl ? s.newUrl.trim() : '' };
    this.setState(st => ({ tasks: [...st.tasks, task], runtime: { ...st.runtime, [id]: this.initRuntime(task) }, newName: '', newUrl: '', newUnit: '' }));
  }

  fmtH(s) { return Math.floor(s / 3600) + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0'); }
  fmtMS(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  durLabel(s) { return s % 3600 === 0 ? (s / 3600) + ' ч' : Math.round(s / 60) + ' мин'; }
  ringOff(r) { return (62.83 * (1 - this.clamp(r, 0, 1))).toFixed(2); }
  lbl(done) { return { fontFamily: FONT, fontSize: '14.5px', fontWeight: 700, color: done ? '#a89e8d' : '#3a352e', textDecoration: done ? 'line-through' : 'none', textDecorationColor: '#cbbfa9' }; }

  isDone(t) {
    const r = this.rt(t.id);
    if (t.type === 'check') return r.done;
    if (t.type === 'counter') return r.count >= t.reps;
    if (t.type === 'timer') return r.elapsed >= t.goalSec;
    return r.phase === 'done';
  }

  buildListTask(t) {
    const r = this.rt(t.id);
    const rs = { fontFamily: FONT, fontSize: '12px', fontWeight: 700, color: '#a59678' };

    if (t.type === 'check') {
      return { id: t.id, isCheck: true, isRing: false, done: r.done, color: t.color, link: t.link || null, label: t.label, labelStyle: this.lbl(r.done), tap: () => this.tapTask(t),
        boxStyle: { width: '24px', height: '24px', borderRadius: '50%', flex: 'none', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '2px solid ' + (r.done ? t.color : '#d9cdb2'), transition: 'border-color .2s' } };
    }
    if (t.type === 'counter') {
      const done = r.count >= t.reps;
      const sub = t.unit ? (this.numRu(r.count * t.per) + ' / ' + this.numRu(t.reps * t.per) + ' ' + t.unit) : '';
      return { id: t.id, isRing: true, color: t.color, ringOffset: this.ringOff(r.count / t.reps), done, label: t.label, labelStyle: this.lbl(done),
        sub, subStyle: { fontFamily: FONT, fontSize: '11.5px', fontWeight: 600, color: '#a59c8b' },
        rightText: r.count + ' / ' + t.reps, rightStyle: rs, tap: () => this.tapTask(t) };
    }
    if (t.type === 'timer') {
      const done = r.elapsed >= t.goalSec;
      return { id: t.id, isRing: true, color: t.color, ringOffset: this.ringOff(r.elapsed / t.goalSec), done, running: r.running, label: t.label,
        sub: r.running ? 'идёт…' : (r.elapsed > 0 && !done ? 'на паузе' : ''), subStyle: { fontFamily: FONT, fontSize: '11.5px', fontWeight: 600, color: '#a59c8b' },
        labelStyle: this.lbl(done), rightText: this.fmtH(r.elapsed) + ' / ' + this.durLabel(t.goalSec), rightStyle: rs, tap: () => this.tapTask(t) };
    }
    // countdown
    const win = t.mode === 'window';
    const alert = r.phase === 'running' && r.left === 0;
    const prog = r.phase === 'done' ? 1 : r.phase === 'running' ? (t.dur - r.left) / t.dur : 0;
    let label, sub;
    if (win) {
      label = r.phase === 'idle' ? (t.label || 'Открыть окно') : r.phase === 'running' ? 'Закрыть окно' : 'Проветрено';
      sub = r.phase === 'idle' ? ('проветрить ' + this.durLabel(t.dur)) : r.phase === 'running' ? (alert ? 'пора закрыть окно!' : 'идёт проветривание') : 'свежо ✦';
    } else {
      label = t.label;
      sub = r.phase === 'idle' ? ('обратный отсчёт ' + this.durLabel(t.dur)) : r.phase === 'running' ? (alert ? 'время вышло!' : 'идёт отсчёт') : 'готово ✦';
    }
    return { id: t.id, isRing: true, color: t.color, ringOffset: this.ringOff(prog), done: r.phase === 'done', label, labelStyle: this.lbl(r.phase === 'done'),
      sub, subStyle: { fontFamily: FONT, fontSize: '11.5px', fontWeight: 600, color: alert ? '#c8553a' : '#a59c8b', animation: alert ? 'nudge .4s ease infinite' : 'none' },
      rightText: r.phase === 'running' ? this.fmtMS(r.left) : '', rightStyle: { fontFamily: FONT, fontSize: '13px', fontWeight: 800, color: alert ? '#c8553a' : t.color },
      tap: () => this.tapTask(t) };
  }

  buildSettingsTask(t) {
    const typeLabels = { counter: 'счётчик', timer: 'таймер', countdown: (t.mode === 'window' ? 'окно' : 'обр. отсчёт'), check: 'галочка' };
    const base = { id: t.id, color: t.color, label: t.label, typeLabel: typeLabels[t.type],
      isCounter: t.type === 'counter', isTimed: t.type === 'timer' || t.type === 'countdown', isCheck: t.type === 'check',
      onName: (e) => this.editName(t.id, e.target.value), remove: () => this.removeTask(t.id) };
    if (t.type === 'counter') {
      const total = t.unit ? (this.numRu(t.reps * t.per) + ' ' + t.unit) : (t.reps + ' раз');
      return { ...base, unit: t.unit || '', onUnit: (e) => this.editUnit(t.id, e.target.value),
        repText: String(t.reps), perText: this.numRu(t.per), totalText: total,
        repDec: () => this.editReps(t.id, -1), repInc: () => this.editReps(t.id, 1),
        perDec: () => this.editPer(t.id, -1), perInc: () => this.editPer(t.id, 1) };
    }
    if (t.type === 'timer') return { ...base, paramLabel: 'длительность', paramText: this.durLabel(t.goalSec), paramDec: () => this.editTimed(t.id, -1), paramInc: () => this.editTimed(t.id, 1) };
    if (t.type === 'countdown') return { ...base, paramLabel: t.mode === 'window' ? 'проветривание' : 'длительность', paramText: this.durLabel(t.dur), paramDec: () => this.editTimed(t.id, -1), paramInc: () => this.editTimed(t.id, 1) };
    return { ...base, link: t.link || '', onLink: (e) => this.editLink(t.id, e.target.value) };
  }

  renderVals() {
    const s = this.state;
    const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    const tasks = s.tasks.map(t => this.buildListTask(t));
    const total = s.tasks.length, completed = s.tasks.filter(t => this.isDone(t)).length;

    const stepBtn = { width: '21px', height: '21px', border: 'none', borderRadius: '50%', background: '#ece2cb', color: '#7c715a', fontSize: '14px', fontWeight: 700, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' };
    const stepBtnP = { ...stepBtn, fontSize: '13px' };

    const typeMeta = [['check', 'галочка'], ['counter', 'счётчик'], ['timer', 'таймер'], ['countdown', 'обр. отсчёт']];
    const typeOptions = typeMeta.map(([key, label]) => ({ key, label, select: () => this.pickType(key),
      style: { border: 'none', borderRadius: '9px', padding: '7px 12px', fontFamily: FONT, fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', ...(s.newType === key ? { background: '#94a886', color: '#fff' } : { background: '#ece2cb', color: '#8a8070' }) } }));

    const canAdd = s.newName.trim().length > 0;
    return {
      today, tasks, total, completed, dayOffset: (138.23 * (1 - (total ? completed / total : 0))).toFixed(2),
      isList: s.view === 'list', isSettings: s.view === 'settings',
      openSettings: () => this.setState({ view: 'settings' }), closeSettings: () => this.setState({ view: 'list' }),
      settingsTasks: s.tasks.map(t => this.buildSettingsTask(t)),
      stepBtn, stepBtnP,
      newName: s.newName, onNewName: (e) => this.setState({ newName: e.target.value }),
      typeOptions,
      addCounter: s.newType === 'counter', addTimed: s.newType === 'timer' || s.newType === 'countdown', addCheck: s.newType === 'check',
      addTimedLabel: s.newType === 'countdown' ? 'длительность отсчёта' : 'длительность',
      newUnit: s.newUnit, onNewUnit: (e) => this.setState({ newUnit: e.target.value }),
      newRepText: String(s.newReps), newPerText: this.numRu(s.newPer),
      newRepDec: () => this.newStepReps(-1), newRepInc: () => this.newStepReps(1), newPerDec: () => this.newStepPer(-1), newPerInc: () => this.newStepPer(1),
      newMinText: s.newMin + ' мин', newMinDec: () => this.newStepMin(-1), newMinInc: () => this.newStepMin(1),
      newUrl: s.newUrl, onNewUrl: (e) => this.setState({ newUrl: e.target.value }),
      addTask: () => this.addTask(),
      addBtnStyle: { width: '100%', border: 'none', borderRadius: '11px', padding: '10px', fontFamily: FONT, fontSize: '13.5px', fontWeight: 700, cursor: 'pointer', transition: 'opacity .2s', ...(canAdd ? { background: '#3a352e', color: '#f7f0e2', opacity: 1 } : { background: '#d8ccb3', color: '#fff', opacity: .7 }) },
      stop: (e) => e.stopPropagation(),
    };
  }

  render() {
    const v = this.renderVals();
    // when wrapped by Electron, render as a floating transparent corner widget
    const widget = this.isWidget;
    const pageStyle = widget
      ? { width: '100%', boxSizing: 'border-box', padding: '8px 16px 34px', background: 'transparent', fontFamily: FONT, WebkitAppRegion: 'drag' }
      : { width: 'max-content', minWidth: '100%', minHeight: '100vh', boxSizing: 'border-box', padding: '56px 60px', background: '#e7e5df', fontFamily: FONT };
    return (
      <div ref={this.pageRef} style={pageStyle}>
        {!widget && (
          <div style={{ margin: '0 0 22px 2px' }}>
            <div style={{ fontFamily: CAVEAT, fontSize: '21px', color: '#b08a52', lineHeight: 1 }}>твой день</div>
            <div style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: '#9a8f7c', marginTop: '2px' }}>Hybrid · paper + air</div>
          </div>
        )}

        <div style={{ flex: 'none', width: widget ? 'auto' : '340px' }}>
          <div style={{ padding: widget ? '8px 20px 18px' : '22px 20px 18px', borderRadius: '24px', background: '#f7f0e2', backgroundImage: 'radial-gradient(rgba(150,130,95,.05) 1px,transparent 1px)', backgroundSize: '7px 7px', border: '1px solid rgba(255,255,255,.6)', boxShadow: '0 26px 50px -24px rgba(86,72,46,.55),0 2px 6px rgba(86,72,46,.06)', WebkitAppRegion: widget ? 'no-drag' : undefined }}>

            {/* drag handle — grab here (above "сегодня") to move the widget */}
            {widget && (
              <div title="перетащить виджет" style={{ WebkitAppRegion: 'drag', cursor: 'grab', height: '20px', margin: '0 -12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '40px', height: '4px', borderRadius: '2px', background: '#ddd2b8' }} />
              </div>
            )}

            {/* ============ LIST VIEW ============ */}
            {v.isList && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', WebkitAppRegion: widget ? 'drag' : undefined }}>
                  <div>
                    <div style={{ fontFamily: CAVEAT, fontSize: '27px', lineHeight: .85, color: '#3a352e' }}>сегодня</div>
                    <div style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 600, color: '#9a8f7c', marginTop: '3px' }}>{v.today}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Hover as="button" onClick={v.openSettings} title="настройки"
                      baseStyle={{ width: '32px', height: '32px', flex: 'none', border: 'none', borderRadius: '50%', background: 'rgba(148,168,134,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, WebkitAppRegion: widget ? 'no-drag' : undefined }}
                      hoverStyle={{ background: 'rgba(148,168,134,.3)' }}>
                      <svg width="17" height="17" viewBox="0 0 18 18"><g fill="none" stroke="#7c8a6c" strokeWidth="1.7" strokeLinecap="round"><path d="M2 5h11"></path><path d="M2 13h7"></path><circle cx="15" cy="5" r="2"></circle><circle cx="13" cy="13" r="2"></circle></g></svg>
                    </Hover>
                    <div style={{ position: 'relative', width: '54px', height: '54px', flex: 'none' }}>
                      <svg width="54" height="54" viewBox="0 0 54 54">
                        <circle cx="27" cy="27" r="22" fill="none" stroke="#e7dcc4" strokeWidth="5"></circle>
                        <circle cx="27" cy="27" r="22" fill="none" stroke="#94a886" strokeWidth="5" strokeLinecap="round" strokeDasharray="138.23" strokeDashoffset={v.dayOffset} transform="rotate(-90 27 27)" style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.34,1.2,.4,1)' }}></circle>
                      </svg>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontWeight: 800, fontSize: '13px', color: '#3a352e' }}>{v.completed}<span style={{ fontWeight: 600, color: '#b3a890' }}>/{v.total}</span></div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {v.tasks.map(t => (
                    <Hover as="div" key={t.id} onClick={t.tap}
                      baseStyle={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: '9px 8px', borderRadius: '13px', cursor: 'pointer', transition: 'background .18s' }}
                      hoverStyle={{ background: 'rgba(148,168,134,.13)' }}>
                      {t.isRing && (
                        <span style={{ position: 'relative', width: '26px', height: '26px', flex: 'none' }}>
                          <svg width="26" height="26" viewBox="0 0 26 26">
                            <circle cx="13" cy="13" r="10" fill="none" stroke="#e3d8bf" strokeWidth="3"></circle>
                            <circle cx="13" cy="13" r="10" fill="none" stroke={t.color} strokeWidth="3" strokeLinecap="round" strokeDasharray="62.83" strokeDashoffset={t.ringOffset} transform="rotate(-90 13 13)" style={{ transition: 'stroke-dashoffset .45s cubic-bezier(.34,1.2,.4,1)' }}></circle>
                          </svg>
                          {t.done && (
                            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pop .3s ease both' }}>
                              <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 6.4L5 9l4.5-5.4" fill="none" stroke={t.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                            </span>
                          )}
                        </span>
                      )}
                      {t.isCheck && (
                        <span style={t.boxStyle}>
                          {t.done && (
                            <span style={{ display: 'flex', animation: 'pop .3s ease both' }}>
                              <svg width="13" height="13" viewBox="0 0 12 12"><path d="M2.5 6.4L5 9l4.5-5.4" fill="none" stroke={t.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                            </span>
                          )}
                        </span>
                      )}

                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
                        <span style={t.labelStyle}>{t.label}</span>
                        {t.sub && <span style={t.subStyle}>{t.sub}</span>}
                      </span>

                      {t.rightText && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: 'none' }}>
                          {t.running && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#d98b6f', animation: 'pulse 1.1s ease-in-out infinite' }}></span>}
                          <span style={t.rightStyle}>{t.rightText}</span>
                        </span>
                      )}
                      {t.link && (
                        <Hover as="a" href={t.link} target="_blank" rel="noopener" onClick={v.stop} title="открыть ссылку"
                          baseStyle={{ width: '24px', height: '24px', flex: 'none', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(217,139,111,.16)', color: '#d98b6f', textDecoration: 'none', fontSize: '12px' }}
                          hoverStyle={{ background: 'rgba(217,139,111,.3)' }}>↗</Hover>
                      )}
                    </Hover>
                  ))}
                </div>
              </div>
            )}

            {/* ============ SETTINGS VIEW ============ */}
            {v.isSettings && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', WebkitAppRegion: widget ? 'drag' : undefined }}>
                  <div style={{ fontFamily: CAVEAT, fontSize: '26px', lineHeight: .85, color: '#3a352e' }}>настройки</div>
                  <Hover as="button" onClick={v.closeSettings}
                    baseStyle={{ border: 'none', background: '#94a886', color: '#fff', fontFamily: FONT, fontSize: '12.5px', fontWeight: 700, padding: '7px 14px', borderRadius: '10px', cursor: 'pointer', WebkitAppRegion: widget ? 'no-drag' : undefined }}
                    hoverStyle={{ background: '#86996f' }}>готово</Hover>
                </div>

                <div style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: '#b0a488', marginBottom: '4px' }}>задачи</div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {v.settingsTasks.map(t => (
                    <div key={t.id} style={{ padding: '10px 2px', borderBottom: '1px dashed #e1d6bd' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', flex: 'none', background: t.color }}></span>
                        <input value={t.label} onChange={t.onName} style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontFamily: FONT, fontSize: '14px', fontWeight: 700, color: '#3a352e' }} />
                        <span style={{ fontFamily: FONT, fontSize: '10.5px', fontWeight: 700, color: '#c3b89f', flex: 'none' }}>{t.typeLabel}</span>
                        <Hover as="button" onClick={t.remove}
                          baseStyle={{ border: 'none', background: 'transparent', color: '#c3b8a2', fontSize: '17px', lineHeight: 1, cursor: 'pointer', flex: 'none', padding: '0 2px' }}
                          hoverStyle={{ color: '#d98b6f' }}>×</Hover>
                      </div>

                      {/* counter controls: goal (raz) + measure */}
                      {t.isCounter && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center', margin: '8px 0 2px 19px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ fontFamily: FONT, fontSize: '11.5px', fontWeight: 600, color: '#9a8f7c' }}>сколько раз</span>
                            <button onClick={t.repDec} style={v.stepBtn}>−</button>
                            <span style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 700, color: '#3a352e', minWidth: '22px', textAlign: 'center' }}>{t.repText}</span>
                            <button onClick={t.repInc} style={v.stepBtnP}>+</button>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <span style={{ fontFamily: FONT, fontSize: '11.5px', fontWeight: 600, color: '#9a8f7c' }}>за раз</span>
                            <button onClick={t.perDec} style={v.stepBtn}>−</button>
                            <span style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 700, color: '#3a352e', minWidth: '30px', textAlign: 'center' }}>{t.perText}</span>
                            <button onClick={t.perInc} style={v.stepBtnP}>+</button>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontFamily: FONT, fontSize: '11.5px', fontWeight: 600, color: '#9a8f7c' }}>ед.</span>
                            <input value={t.unit} onChange={t.onUnit} placeholder="—" style={{ width: '52px', border: 'none', borderRadius: '7px', background: '#ece2cb', padding: '4px 8px', outline: 'none', fontFamily: FONT, fontSize: '12px', fontWeight: 700, color: '#3a352e' }} />
                          </div>
                          <span style={{ fontFamily: FONT, fontSize: '11px', fontWeight: 700, color: '#bcae90', width: '100%' }}>= {t.totalText}</span>
                        </div>
                      )}

                      {/* timer / countdown single param */}
                      {t.isTimed && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '8px 0 2px 19px' }}>
                          <span style={{ fontFamily: FONT, fontSize: '11.5px', fontWeight: 600, color: '#9a8f7c' }}>{t.paramLabel}</span>
                          <button onClick={t.paramDec} style={v.stepBtn}>−</button>
                          <span style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 700, color: '#3a352e', minWidth: '50px', textAlign: 'center' }}>{t.paramText}</span>
                          <button onClick={t.paramInc} style={v.stepBtnP}>+</button>
                        </div>
                      )}

                      {/* check link */}
                      {t.isCheck && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '8px 0 2px 19px' }}>
                          <span style={{ fontFamily: FONT, fontSize: '11.5px', fontWeight: 600, color: '#9a8f7c', flex: 'none' }}>ссылка</span>
                          <input value={t.link} onChange={t.onLink} placeholder="https://… (необязательно)" style={{ flex: 1, minWidth: 0, border: 'none', borderRadius: '7px', background: '#ece2cb', padding: '5px 9px', outline: 'none', fontFamily: FONT, fontSize: '12px', fontWeight: 600, color: '#3a352e' }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* add new */}
                <div style={{ marginTop: '16px', padding: '14px', borderRadius: '16px', background: 'rgba(148,168,134,.1)' }}>
                  <div style={{ fontFamily: CAVEAT, fontSize: '21px', color: '#3a352e', lineHeight: 1, marginBottom: '9px' }}>новая задача</div>
                  <input value={v.newName} onChange={v.onNewName} placeholder="название…" style={{ width: '100%', border: 'none', borderRadius: '10px', background: '#fbf6ec', padding: '9px 11px', outline: 'none', fontFamily: FONT, fontSize: '14px', fontWeight: 600, color: '#3a352e', marginBottom: '9px' }} />
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    {v.typeOptions.map(o => (
                      <button key={o.key} onClick={o.select} style={o.style}>{o.label}</button>
                    ))}
                  </div>

                  {v.addCounter && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '9px 14px', alignItems: 'center', marginBottom: '11px', padding: '0 2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 600, color: '#8a8070' }}>сколько раз</span>
                        <button onClick={v.newRepDec} style={v.stepBtn}>−</button>
                        <span style={{ fontFamily: FONT, fontSize: '13px', fontWeight: 700, color: '#3a352e', minWidth: '24px', textAlign: 'center' }}>{v.newRepText}</span>
                        <button onClick={v.newRepInc} style={v.stepBtnP}>+</button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 600, color: '#8a8070' }}>за раз</span>
                        <button onClick={v.newPerDec} style={v.stepBtn}>−</button>
                        <span style={{ fontFamily: FONT, fontSize: '13px', fontWeight: 700, color: '#3a352e', minWidth: '30px', textAlign: 'center' }}>{v.newPerText}</span>
                        <button onClick={v.newPerInc} style={v.stepBtnP}>+</button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontFamily: FONT, fontSize: '12px', fontWeight: 600, color: '#8a8070' }}>ед.</span>
                        <input value={v.newUnit} onChange={v.onNewUnit} placeholder="л / стр." style={{ width: '60px', border: 'none', borderRadius: '7px', background: '#fbf6ec', padding: '5px 8px', outline: 'none', fontFamily: FONT, fontSize: '12px', fontWeight: 700, color: '#3a352e' }} />
                      </div>
                    </div>
                  )}
                  {v.addTimed && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '11px', padding: '0 2px' }}>
                      <span style={{ fontFamily: FONT, fontSize: '12.5px', fontWeight: 700, color: '#8a8070' }}>{v.addTimedLabel}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <button onClick={v.newMinDec} style={v.stepBtn}>−</button>
                        <span style={{ fontFamily: FONT, fontSize: '13px', fontWeight: 700, color: '#3a352e', minWidth: '52px', textAlign: 'center' }}>{v.newMinText}</span>
                        <button onClick={v.newMinInc} style={v.stepBtnP}>+</button>
                      </div>
                    </div>
                  )}
                  {v.addCheck && (
                    <input value={v.newUrl} onChange={v.onNewUrl} placeholder="ссылка https://… (необязательно)" style={{ width: '100%', border: 'none', borderRadius: '10px', background: '#fbf6ec', padding: '9px 11px', outline: 'none', fontFamily: FONT, fontSize: '13px', fontWeight: 600, color: '#3a352e', marginBottom: '11px' }} />
                  )}

                  <button onClick={v.addTask} style={v.addBtnStyle}>Добавить задачу</button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    );
  }
}
