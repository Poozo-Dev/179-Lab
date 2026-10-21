// gallery.js — thumbnail grid, quality summary, measurement table and the full-screen zoomable viewer with
// the precise marking tool (Point A red, Point B blue, scale and vertical reference points).
import { assessQuality, formatFrameLine, formatSeconds, formatSigned } from './timing.js';
import * as store from './store.js';
import { saveBlob } from './save.js';
import { openPlot } from './plot.js';
import { POINTS, CM_CSS, normalizeMarks, analyzeMarks, validMasses, centerOfMass, coordSystem,
  buildTable, cellValue, toCsv } from './measure.js';
import { screenToImage, imageToScreen, fitScale } from './geometry.js';
import { t, getLang, setLang, onLangChange } from './i18n.js';

const $ = (id) => document.getElementById(id);
const el = {
  screen: $('screen-gallery'), sub: $('g-sub'), quality: $('g-quality'), notes: $('g-notes'),
  grid: $('g-grid'), table: $('g-table'), again: $('btn-again'), finish: $('btn-finish'), plot: $('btn-plot'),
  mStatus: $('m-status'), mTable: $('m-table'), csv: $('btn-csv'),
  cDesc: $('c-desc'), cal: $('btn-cal'), calClear: $('btn-cal-clear'),
  vert: $('btn-vert'), vertSensor: $('btn-vert-sensor'), vertClear: $('btn-vert-clear'),
  viewer: $('viewer'), stage: $('v-stage'), img: $('v-img'), title: $('v-title'), line: $('v-line'), warn: $('v-warn'),
  close: $('v-close'), save: $('v-save'), prev: $('v-prev'), next: $('v-next'), fit: $('v-fit'),
  del: $('v-delete'), marks: $('v-marks'), hint: $('v-hint'), count: $('v-count'), loupe: $('v-loupe'),
  pa: $('v-pa'), pb: $('v-pb'), clr: $('v-clr'), tools: $('v-tools'), fine: $('v-fine'), pos: $('v-pos'),
  setup: $('v-setup'), which: $('v-which'), distWrap: $('v-dist-wrap'), dist: $('v-dist'), unit: $('v-unit'),
  setupOk: $('v-setup-ok'), setupCancel: $('v-setup-cancel'),
  toast: $('toast'), toastText: $('toast-text'), toastUndo: $('toast-undo'),
};

const flagText = (x) => t('flag.' + x);
// why the recording stopped (null = normal stop, nothing to report)
const stopText = (reason) => (reason && !['user', 'max', 'duration'].includes(reason) ? t('stop.' + reason) : null);
const U = (unit) => t('u.' + unit);
const TS_KEY = {                     // stored English names of the timestamp source -> translated text
  'VideoFrame.timestamp (camera capture clock)': 'ts.processor',
  'requestVideoFrameCallback captureTime': 'ts.capture',
  'requestVideoFrameCallback presentationTime (compatibility mode)': 'ts.presentation',
};

let urls = [];      // object URLs of thumbnails (revoked when the gallery is rebuilt)
let state = { session: null, frames: [], marks: {}, setup: {}, perFrame: [], timingOk: true };
let tiles = [];     // thumbnail buttons, to show which frames have marked points

export function hideGallery() { el.screen.hidden = true; closeViewer(true); hideToast(); }

let handlers = {};

export function showGallery({ session, frames, marks, setup, notice, onAgain, onFinish }) {
  const valid = new Set(frames.map((f) => f.index));
  state = { session, frames, marks: normalizeMarks(marks, valid), setup: setup || {}, perFrame: [], timingOk: true };
  handlers = { notice, onAgain, onFinish };
  renderGallery(false);
}

const imageH = () => state.session.height || (state.frames[0] && state.frames[0].height) || 0;
const marksInfo = () => analyzeMarks(state.frames, state.marks);
const tableNow = (masses = state.setup.masses) => buildTable(state.frames, state.marks, coordSystem(state.setup, imageH()), masses);
// The green centre-of-mass point exists only in the two-point workflow, with valid masses, on frames with both points.
const cmFor = (mk) => (marksInfo().mode === 'two' && mk ? centerOfMass(mk.a, mk.b, state.setup.masses) : null);

// Builds the whole gallery from `state`. Called again after a frame is deleted or restored, so the timing
// check, counts, tables and thumbnails always agree with the frames that are really left.
function renderGallery(keepScroll) {
  const { session, frames } = state, { notice, onAgain, onFinish } = handlers;
  urls.forEach((u) => URL.revokeObjectURL(u)); urls = [];
  tiles = [];
  el.screen.hidden = false;
  if (!keepScroll) window.scrollTo(0, 0);

  const q = assessQuality(frames, session.stats, { toleranceMs: session.toleranceMs, gapFactor: session.gapFactor, intervalMs: session.intervalMs });
  const problems = [...q.problems];
  const stopMsg = stopText(session.stopReason);
  if (stopMsg) problems.unshift(stopMsg);
  if (notice) problems.unshift(notice);
  if (!frames.length) problems.unshift(t('g.noFrames'));
  const ok = problems.length === 0;

  const when = new Date(session.createdAt).toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-GB');
  el.sub.textContent = t('g.sub', { when, iv: formatSeconds(session.intervalMs), n: frames.length }) +
    (session.width ? ` · ${session.width}×${session.height}` : '');

  el.quality.className = 'banner ' + (ok ? 'ok' : 'bad');
  el.quality.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = ok
    ? t('g.passed', { tol: Math.round(session.toleranceMs * 10) / 10, worst: Math.round(q.worstDeviationMs) })
    : t('g.failed');
  el.quality.append(b);
  if (!ok) {
    const ul = document.createElement('ul');
    for (const p of problems) { const li = document.createElement('li'); li.textContent = p; ul.append(li); }
    el.quality.append(ul);
  }

  el.notes.innerHTML = '';
  const notes = [...q.notes];
  const cam = session.camera;
  if (cam && cam.width) {
    notes.push(t('n.camMode', { w: cam.width, h: cam.height, fps: cam.frameRate ? Math.round(cam.frameRate) : 0,
      zoom: cam.zoom ? Number(cam.zoom.value).toFixed(1) : 0 }));
  }
  if (session.timeSource) notes.push(t('n.tsSource', { src: TS_KEY[session.timeSource] ? t(TS_KEY[session.timeSource]) : session.timeSource }));
  if (session.sourceMode === 'rvfc') {
    notes.push(t('n.compat'));
  }
  notes.push(t('n.pipeline'));
  for (const n of notes) { const li = document.createElement('li'); li.textContent = n; el.notes.append(li); }

  // thumbnails
  el.grid.innerHTML = '';
  frames.forEach((f, i) => {
    const url = URL.createObjectURL(new Blob([f.thumb], { type: 'image/jpeg' }));
    urls.push(url);
    const flags = q.perFrame[i];
    const btn = document.createElement('button');
    btn.className = 'tile' + (flags.length ? ' flag' : '');
    btn.style.setProperty('--ar', `${f.width} / ${f.height}`);
    btn.setAttribute('aria-label', t('g.tileAria', { i: f.index + 1, t: formatSeconds(f.actualMs) }));
    const img = document.createElement('img'); img.src = url; img.alt = '';
    const cap = document.createElement('div'); cap.className = 'cap';
    const a = document.createElement('span'); a.textContent = `#${f.index + 1}`;
    const ts = document.createElement('span'); ts.textContent = `${formatSeconds(f.actualMs)} ${t('u.s')}`;
    cap.append(a, ts);
    if (flags.length) { const w = document.createElement('span'); w.className = 'w'; w.textContent = '⚠'; cap.append(w); }
    btn.append(img, cap);
    btn.addEventListener('click', () => openViewer(state.frames.indexOf(f)));
    el.grid.append(btn); tiles.push(btn);
  });

  el.table.textContent = frames.map((f, i) => {
    const fl = q.perFrame[i];
    return formatFrameLine(f) + (fl.length ? '  ⚠ ' + fl.map(flagText).join('; ') : '');
  }).join('\n');

  el.again.onclick = onAgain;
  el.finish.onclick = onFinish;
  state.perFrame = q.perFrame; state.timingOk = ok;
  refreshMeasurements();
}

// ================================ measurements ================================
const posText = (p) => `x ${p.x.toFixed(1)}, y ${p.y.toFixed(1)} ${U('px')}`;
const COL = { 'a.x': 'col.xa', 'a.y': 'col.ya', 'b.x': 'col.xb', 'b.y': 'col.yb', 'cm.x': 'col.xcm', 'cm.y': 'col.ycm' };
function colLabel(col, unit, single) {
  if (col === 't') return t('col.t');
  const key = single ? (col.endsWith('.x') ? 'col.x' : 'col.y') : COL[col];
  return `${t(key)} (${U(unit)})`;
}

// small EN · RU switch in the gallery header (the language is normally chosen once, at first launch)
const langBtn = $('btn-lang');
function renderLangBtn() {
  const cur = getLang();
  langBtn.innerHTML = ['en', 'ru'].map((l) => (l === cur ? `<b>${l.toUpperCase()}</b>` : l.toUpperCase())).join(' · ');
}
langBtn.onclick = () => setLang(getLang() === 'en' ? 'ru' : 'en');
renderLangBtn();
onLangChange(() => { renderLangBtn(); if (!el.screen.hidden && state.session) renderGallery(true); });
const DEC = { px: 1, mm: 2, cm: 3, m: 4 };
const fmtNum = (v, unit) => (v === null ? '—' : v.toFixed(DEC[unit] ?? 3).replace('-', '−'));

/** Everything derived from the marks/setup is recomputed here after EVERY change (no stale results). */
function refreshMeasurements() {
  state.frames.forEach((f, i) => {
    const m = state.marks[f.index] || {};
    if (tiles[i]) { tiles[i].classList.toggle('ma', !!m.a); tiles[i].classList.toggle('mb', !!m.b); }
  });
  const table = tableNow(), info = table.info;
  let status;
  if (info.mode === 'none') status = t('m.none');
  else if (info.mode === 'single') status = t('m.single', { pt: t('pt.' + info.single), n: info.single === 'a' ? info.nA : info.nB });
  else if (info.mode === 'unpaired') status = t('m.unpaired', { a: info.nA, b: info.nB });
  else {
    status = t('m.two', { a: info.nA, b: info.nB, both: info.paired });
    status += table.masses ? t('m.masses', { ma: table.masses.a, mb: table.masses.b, both: info.paired }) : t('m.noMasses');
  }
  el.mStatus.textContent = status;
  el.plot.disabled = !info.canPlot;

  el.mTable.innerHTML = '';
  if (table.rows.length) {
    const single = table.mode === 'single';
    const head = document.createElement('tr');
    for (const c of ['#', ...table.columns.map((c) => colLabel(c, table.unit, single))]) {
      const th = document.createElement('th'); th.textContent = c; head.append(th);
    }
    el.mTable.append(head);
    for (const r of table.rows) {
      const tr = document.createElement('tr');
      const cells = [String(r.index + 1), ...table.columns.map((c) => (c === 't' ? r.t.toFixed(3) : fmtNum(cellValue(r, c), table.unit)))];
      for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.append(td); }
      el.mTable.append(tr);
    }
  }
  el.csv.disabled = !table.rows.length;
  el.csv.onclick = () => {
    const t = tableNow();
    if (!t.rows.length) return;
    const blob = new Blob([toCsv(t)], { type: 'text/csv' });
    saveBlob(blob, `physlab_${t.mode === 'single' ? 'points' : 'two-points'}_${t.unit}.csv`, 'text/csv');
  };
  el.plot.onclick = () => {
    if (!marksInfo().canPlot) return;                              // gate again: never plot without paired marks
    openPlot({
      build: (masses) => tableNow(masses),
      frameOrder: state.frames.map((f) => f.index),
      masses: validMasses(state.setup.masses), timingOk: state.timingOk,
      onMasses: (m) => { if (m) state.setup.masses = m; else delete state.setup.masses; persistSetup(); },
    });
  };
  renderCoordInfo();
}

function renderCoordInfo() {
  const s = state.setup, cs = coordSystem(s, imageH());
  const parts = [t('c.origin')];
  if (s.vert && cs.angleRad) {
    const deg = cs.angleRad * 180 / Math.PI;
    parts.push(t('c.rot', { deg: `${deg >= 0 ? '+' : '−'}${Math.abs(deg).toFixed(2)}`, sensor: s.vert.mode === 'sensor' }));
  } else parts.push(t('c.noRot'));
  parts.push(cs.scale
    ? t('c.scale', { px: U('px'), s: Number(cs.scale.toPrecision(5)), unit: U(cs.unit), d: s.cal.distance, dunit: U(s.cal.unit) })
    : t('c.noScale'));
  el.cDesc.textContent = parts.join('; ') + '.';
  el.calClear.hidden = !s.cal; el.vertClear.hidden = !s.vert;
  el.cal.textContent = t(s.cal ? 'g.changeScale' : 'g.setScale');
  el.vert.textContent = t(s.vert && s.vert.mode === 'points' ? 'g.changeVert' : 'g.setVert');
  const st = state.session.sensorTiltDeg;
  el.vertSensor.hidden = !Number.isFinite(st);
  if (Number.isFinite(st)) el.vertSensor.textContent = t('c.sensorBtn', { deg: `${st >= 0 ? '+' : '−'}${Math.abs(st).toFixed(1)}` });
}

async function persistSetup() {
  try { await store.setSetup(state.setup); }
  catch (e) { el.mStatus.textContent = t('m.saveErr') + e.message; }
  refreshMeasurements();
  renderMarks();
}
el.calClear.onclick = () => { delete state.setup.cal; persistSetup(); };
el.vertClear.onclick = () => { delete state.setup.vert; persistSetup(); };
el.vertSensor.onclick = () => {
  state.setup.vert = { mode: 'sensor', angleDeg: state.session.sensorTiltDeg }; persistSetup();
};
const startSetup = (kind) => {
  const saved = state.setup[kind];
  const pos = saved && saved.frame !== undefined ? state.frames.findIndex((f) => f.index === saved.frame) : -1;
  V.draft = { kind, p1: saved && saved.p1 ? { ...saved.p1 } : null, p2: saved && saved.p2 ? { ...saved.p2 } : null };
  V.sub = V.draft.p1 && !V.draft.p2 ? 'p2' : 'p1';
  if (kind === 'cal') { el.dist.value = saved ? saved.distance : ''; el.unit.value = saved ? saved.unit : 'mm'; }
  openViewer(Math.max(0, pos), kind);
};
el.cal.onclick = () => state.frames.length && startSetup('cal');
el.vert.onclick = () => state.frames.length && startSetup('vert');

// ================================ viewer ================================
// V.target: null (view only) | 'a' | 'b' (marking that point) | 'cal' | 'vert' (placing two reference points)
const V = { open: false, i: 0, token: 0, url: null, blob: null, nat: { w: 1, h: 1 },
  scale: 1, tx: 0, ty: 0, pointers: new Map(), pinch: null, lastTap: 0, pushed: false,
  target: null, draft: null, sub: 'p1', drag: null };

function view() {
  const r = el.stage.getBoundingClientRect();
  return { sw: r.width, sh: r.height, nw: V.nat.w, nh: V.nat.h, scale: V.scale, tx: V.tx, ty: V.ty };
}
// at full zoom one image pixel is at least ~8 screen pixels, whatever the camera resolution
const maxScale = () => Math.max(10, 8 / fitScale(view()));

function openViewer(i, target = null) {
  V.open = true; V.target = target; el.viewer.hidden = false;
  if (!target || target === 'a' || target === 'b') V.draft = null;
  history.pushState({ viewer: true }, ''); V.pushed = true;
  resetView();
  show(i);
}
function closeViewer(silent) {
  if (!V.open) return;
  V.open = false; V.target = null; V.draft = null; V.drag = null; V.token++; el.viewer.hidden = true;
  el.marks.innerHTML = ''; el.loupe.hidden = true;
  el.img.removeAttribute('src');
  if (V.url) { URL.revokeObjectURL(V.url); V.url = null; V.blob = null; }
  if (V.pushed && !silent) { V.pushed = false; history.back(); }
  else V.pushed = false;
}
window.addEventListener('popstate', () => { if (V.open) { V.pushed = false; closeViewer(true); } });

async function show(i) {
  const frames = state.frames;
  if (i < 0 || i >= frames.length) return;
  V.i = i;
  const f = frames[i], token = ++V.token;
  el.title.textContent = t('v.title', { i: f.index + 1, k: i + 1, n: frames.length });
  el.line.textContent = t('v.line', { t: formatSeconds(f.actualMs), target: formatSeconds(f.targetMs), dev: formatSigned(f.deviationMs) });
  const fl = (state.perFrame && state.perFrame[i]) || [];
  el.warn.textContent = fl.length ? '⚠ ' + fl.map(flagText).join('; ') : '';
  el.prev.disabled = i === 0; el.next.disabled = i === frames.length - 1;
  updateTools(); renderMarks();
  try {
    const rec = await store.getImage(f.index);
    if (token !== V.token) return;
    const blob = new Blob([rec.data], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const tmp = new Image(); tmp.src = url;
    try { await tmp.decode(); } catch (_) {}
    if (token !== V.token) { URL.revokeObjectURL(url); return; }
    const old = V.url;
    el.img.src = url; V.url = url; V.blob = blob;
    V.nat = { w: tmp.naturalWidth || f.width, h: tmp.naturalHeight || f.height };
    if (old) URL.revokeObjectURL(old);
    applyView();
  } catch (_) {
    el.warn.textContent = t('v.loadErr');
  }
}
const go = (d) => show(V.i + d);   // zoom/pan is kept when stepping, to compare an object against a ruler

function resetView() { V.scale = 1; V.tx = 0; V.ty = 0; applyView(); }
function applyView() {
  const v = view(), fit = fitScale(v);
  const mx = Math.max(0, (V.nat.w * fit * V.scale - v.sw) / 2);
  const my = Math.max(0, (V.nat.h * fit * V.scale - v.sh) / 2);
  V.tx = Math.min(mx, Math.max(-mx, V.tx));
  V.ty = Math.min(my, Math.max(-my, V.ty));
  el.img.style.transform = `translate(${V.tx}px, ${V.ty}px) scale(${V.scale})`;
  renderMarks();
}
// zoom keeping the screen point (ax, ay) — relative to the stage centre — fixed
function zoomAt(newScale, ax, ay) {
  newScale = Math.min(maxScale(), Math.max(1, newScale));
  const k = newScale / V.scale;
  V.tx = ax - k * (ax - V.tx); V.ty = ay - k * (ay - V.ty);
  V.scale = newScale; applyView();
}
const stageXY = (cx, cy) => { const r = el.stage.getBoundingClientRect(); return [cx - r.left, cy - r.top]; };
const centerRel = (cx, cy) => {
  const r = el.stage.getBoundingClientRect();
  return [cx - r.left - r.width / 2, cy - r.top - r.height / 2];
};

// ---------- points being edited ----------
const curFrame = () => state.frames[V.i];
function getPoint() {
  if (V.target === 'a' || V.target === 'b') { const m = state.marks[curFrame().index]; return m ? m[V.target] || null : null; }
  if (V.draft) return V.draft[V.sub];
  return null;
}
function setPoint(p) {
  if (V.target === 'a' || V.target === 'b') {
    const idx = curFrame().index, m = state.marks[idx] || (state.marks[idx] = {});
    if (p) m[V.target] = p; else { delete m[V.target]; if (!m.a && !m.b) delete state.marks[idx]; }
  } else if (V.draft) V.draft[V.sub] = p;
}
const clampPt = (p) => ({ x: Math.min(V.nat.w, Math.max(0, p.x)), y: Math.min(V.nat.h, Math.max(0, p.y)) });

async function commitPoint() {
  renderMarks(); updateTools();
  if (V.target === 'a' || V.target === 'b') {
    refreshMeasurements();
    try { await store.setMarks(state.marks); }
    catch (e) { el.hint.textContent = t('v.markErr') + e.message; }
  }
}

function updateTools() {
  const f = curFrame(); if (!f) return;
  const setup = V.target === 'cal' || V.target === 'vert';
  el.tools.hidden = setup; el.setup.hidden = !setup;
  const m = state.marks[f.index] || {};
  for (const k of ['a', 'b']) {
    const b = k === 'a' ? el.pa : el.pb;
    b.classList.toggle('on', V.target === k);
    b.textContent = V.target === k ? `● ${k.toUpperCase()} ${t('v.done')}` : `● ${k.toUpperCase()}${m[k] ? ' ' + t('v.move') : ''}`;
  }
  el.stage.classList.toggle('marking', !!V.target);
  el.stage.dataset.target = V.target || '';
  const p = V.target ? getPoint() : null;
  // shown for the whole marking session (disabled until a point exists), so placing the first point does not
  // change the layout and resize the picture under the finger
  el.clr.hidden = !(V.target === 'a' || V.target === 'b'); el.clr.disabled = !p;
  el.fine.hidden = !V.target;
  for (const b of el.fine.querySelectorAll('.nudge')) b.disabled = !p;
  el.pos.textContent = p ? posText(p) : t('v.noPoint');   // never empty: keeps the row height
  if (setup) {
    el.distWrap.hidden = V.target !== 'cal';
    el.which.textContent = t('v.editing', { k: V.sub === 'p1' ? '1' : '2' });
  }
  el.hint.textContent = V.target === 'cal' ? t('v.hintCal')
    : V.target === 'vert' ? t('v.hintVert')
    : V.target ? t('v.hintMark', { pt: t('pt.' + V.target) })
    : t('v.hintIdle');
  const n = analyzeMarks(state.frames, state.marks);
  el.count.textContent = t('v.count', { a: n.nA, b: n.nB, n: state.frames.length });
}

// ---------- drawing marks (SVG overlay in screen coordinates) ----------
const dot = (p, r, fill, extra = '') => `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" ${extra}/>`;
function renderMarks() {
  if (!V.open) return;
  const v = view(), cur = curFrame(), curIdx = cur ? cur.index : -1;
  const S = (p) => imageToScreen(v, p.x, p.y);
  let out = '';
  const setup = V.target === 'cal' || V.target === 'vert';
  if (!setup) {
    for (const [idx, m] of Object.entries(state.marks)) {       // other frames: small faded dots (orientation)
      if (Number(idx) === curIdx) continue;
      if (m.a) out += dot(S(m.a), 4, 'rgba(255,45,45,.45)', 'stroke="rgba(255,255,255,.7)" stroke-width="1"');
      if (m.b) out += dot(S(m.b), 4, 'rgba(47,123,255,.5)', 'stroke="rgba(255,255,255,.7)" stroke-width="1"');
    }
    const m = state.marks[curIdx];
    if (m) {
      for (const k of ['a', 'b']) {
        if (!m[k]) continue;
        const s = S(m[k]);
        out += dot(s, 9, 'none', `stroke="${POINTS[k].css}" stroke-width="3"`) + dot(s, 1.6, '#fff');
        out += `<text x="${s.x + 12}" y="${s.y - 10}" fill="#fff" font-size="13" font-weight="700" paint-order="stroke" stroke="${POINTS[k].css}" stroke-width="3">${k.toUpperCase()}</text>`;
      }
      const cm = cmFor(m);
      if (cm) {
        const s = S(cm);
        out += `<rect x="${s.x - 7}" y="${s.y - 7}" width="14" height="14" transform="rotate(45 ${s.x} ${s.y})" fill="${CM_CSS}" stroke="#fff" stroke-width="2"/>`;
      }
    }
  } else if (V.draft) {
    const col = V.target === 'cal' ? '#ffd23f' : '#3fe0ff';
    const pts = ['p1', 'p2'].map((k) => V.draft[k] && S(V.draft[k]));
    if (pts[0] && pts[1]) out += `<line x1="${pts[0].x}" y1="${pts[0].y}" x2="${pts[1].x}" y2="${pts[1].y}" stroke="${col}" stroke-width="2"/>`;
    pts.forEach((s, i) => {
      if (!s) return;
      const active = V.sub === (i ? 'p2' : 'p1');
      out += dot(s, active ? 9 : 7, 'none', `stroke="${col}" stroke-width="${active ? 3 : 2}"`) + dot(s, 1.6, '#fff');
      out += `<text x="${s.x + 12}" y="${s.y - 10}" fill="#000" font-size="13" font-weight="700" paint-order="stroke" stroke="${col}" stroke-width="3">${i + 1}</text>`;
    });
  }
  el.marks.innerHTML = out;
}

// ---------- magnifier ----------
const LOUPE = 132;
function drawLoupe(sx, sy, p) {
  const c = el.loupe, dpr = window.devicePixelRatio || 1, v = view();
  if (c.width !== LOUPE * dpr) { c.width = c.height = LOUPE * dpr; c.style.width = c.style.height = LOUPE + 'px'; }
  const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const k = V.scale * fitScale(v), z = Math.max(4 * k, 2);      // loupe pixels per image pixel
  const half = LOUPE / 2 / z;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, LOUPE, LOUPE);
  ctx.imageSmoothingEnabled = z < 4;
  // draw only the part that lies inside the image (some browsers reject source rectangles outside it)
  const x0 = Math.max(0, p.x - half), y0 = Math.max(0, p.y - half);
  const x1 = Math.min(V.nat.w, p.x + half), y1 = Math.min(V.nat.h, p.y + half);
  if (x1 > x0 && y1 > y0) {
    try { ctx.drawImage(el.img, x0, y0, x1 - x0, y1 - y0, (x0 - p.x) * z + LOUPE / 2, (y0 - p.y) * z + LOUPE / 2, (x1 - x0) * z, (y1 - y0) * z); } catch (_) {}
  }
  const L = (q) => ({ x: (q.x - p.x) * z + LOUPE / 2, y: (q.y - p.y) * z + LOUPE / 2 });
  const m = state.marks[curFrame().index] || {};
  const others = [];
  if (V.target === 'a' && m.b) others.push([m.b, POINTS.b.css]);
  if (V.target === 'b' && m.a) others.push([m.a, POINTS.a.css]);
  if (V.draft) { const o = V.draft[V.sub === 'p1' ? 'p2' : 'p1']; if (o) others.push([o, '#ffd23f']); }
  for (const [q, col] of others) { const s = L(q); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.stroke(); }
  const col = V.target === 'a' ? POINTS.a.css : V.target === 'b' ? POINTS.b.css : V.target === 'cal' ? '#ffd23f' : '#3fe0ff';
  const C = LOUPE / 2;
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)';
  for (const w of [3, 1.2]) {                                    // dark halo, then coloured crosshair with a gap
    ctx.lineWidth = w; ctx.strokeStyle = w === 3 ? 'rgba(0,0,0,.55)' : col; ctx.beginPath();
    ctx.moveTo(C, 4); ctx.lineTo(C, C - 5); ctx.moveTo(C, C + 5); ctx.lineTo(C, LOUPE - 4);
    ctx.moveTo(4, C); ctx.lineTo(C - 5, C); ctx.moveTo(C + 5, C); ctx.lineTo(LOUPE - 4, C); ctx.stroke();
  }
  // above the finger (never under it); below it when there is no room at the top
  let left = sx - LOUPE / 2, top = sy - LOUPE - 56;
  if (top < 4) top = sy + 56;
  left = Math.min(v.sw - LOUPE - 4, Math.max(4, left));
  c.style.left = left + 'px'; c.style.top = top + 'px'; c.style.borderColor = col;
  c.hidden = false;
}

function dragTo(e) {
  const [sx, sy] = stageXY(e.clientX, e.clientY);
  const p = clampPt(screenToImage(view(), sx, sy));
  setPoint(p); renderMarks(); drawLoupe(sx, sy, p);
  el.pos.textContent = posText(p);
}

// ---------- pointer handling ----------
el.stage.addEventListener('pointerdown', (e) => {
  el.stage.setPointerCapture(e.pointerId);
  V.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, st: performance.now() });
  if (V.pointers.size === 1 && V.target && V.url && curFrame()) {      // marking: touch-and-slide places the point
    V.drag = { id: e.pointerId, before: getPoint() };
    dragTo(e);
  }
  if (V.pointers.size === 2) {
    if (V.drag) { setPoint(V.drag.before); V.drag = null; el.loupe.hidden = true; renderMarks(); updateTools(); }   // it was a pinch
    const [a, b] = [...V.pointers.values()];
    V.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: V.scale, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }
});
el.stage.addEventListener('pointermove', (e) => {
  const p = V.pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (V.drag && V.drag.id === e.pointerId) { dragTo(e); return; }
  if (V.pointers.size === 2 && V.pinch) {
    const [a, b] = [...V.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    V.tx += mx - V.pinch.mx; V.ty += my - V.pinch.my; V.pinch.mx = mx; V.pinch.my = my;   // two-finger pan
    const [ax, ay] = centerRel(mx, my);
    zoomAt(V.pinch.s * d / V.pinch.d, ax, ay);
  } else if (V.pointers.size === 1 && V.scale > 1 && !V.target) {
    V.tx += dx; V.ty += dy; applyView();
  }
});
function endPointer(e) {
  const p = V.pointers.get(e.pointerId); if (!p) return;
  V.pointers.delete(e.pointerId);
  if (V.pointers.size < 2) V.pinch = null;
  if (V.drag && V.drag.id === e.pointerId) {
    const wasNew = !V.drag.before;
    V.drag = null; el.loupe.hidden = true;
    if (e.type === 'pointercancel') { renderMarks(); updateTools(); return; }
    if (V.draft && wasNew && V.sub === 'p1' && !V.draft.p2) V.sub = 'p2';     // reference points: 1 then 2
    commitPoint(); return;
  }
  if (e.type === 'pointercancel' || V.pointers.size > 0 || V.target) return;
  const dx = e.clientX - p.sx, dy = e.clientY - p.sy, dt = performance.now() - p.st;
  if (Math.hypot(dx, dy) < 10 && dt < 300) pulseTools();       // a tap with no point selected: show where to start
  if (V.scale <= 1.01 && dt < 700 && Math.abs(dx) > 50 && Math.abs(dx) > 1.6 * Math.abs(dy)) {
    go(dx < 0 ? 1 : -1); return;                                // swipe
  }
  if (Math.hypot(dx, dy) < 10 && dt < 300) {
    const now = performance.now();
    if (now - V.lastTap < 320) {
      const [ax, ay] = centerRel(e.clientX, e.clientY);
      if (V.scale > 1.01) { V.scale = 1; V.tx = 0; V.ty = 0; applyView(); } else zoomAt(3, ax, ay);
      V.lastTap = 0;
    } else V.lastTap = now;
  }
}
el.stage.addEventListener('pointerup', endPointer);
// iPhone: stop the long-press menu, text/image selection and drag-out of the photo (they cancel our drag)
el.stage.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
el.stage.addEventListener('contextmenu', (e) => e.preventDefault());
el.stage.addEventListener('dragstart', (e) => e.preventDefault());
el.stage.addEventListener('pointercancel', endPointer);
el.stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [ax, ay] = centerRel(e.clientX, e.clientY);
  zoomAt(V.scale * Math.exp(-e.deltaY * 0.0015), ax, ay);
}, { passive: false });
window.addEventListener('resize', () => { if (V.open) applyView(); });
// any change of the photo area (toolbars, hint text, rotation) must re-place the marks over the picture
if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (V.open) applyView(); }).observe(el.stage);

function nudge(dx, dy) {
  const p = getPoint(); if (!p || !V.url) return;
  setPoint(clampPt({ x: p.x + dx, y: p.y + dy }));               // exactly one original image pixel
  commitPoint();
}
el.fine.addEventListener('click', (e) => {
  const b = e.target.closest('.nudge'); if (b) nudge(Number(b.dataset.dx), Number(b.dataset.dy));
});
window.addEventListener('keydown', (e) => {
  if (!V.open) return;
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (V.target && arrows[e.key] && getPoint()) { e.preventDefault(); nudge(...arrows[e.key]); return; }
  if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'ArrowRight') go(1);
  else if (e.key === 'Escape') closeViewer();
});

el.close.onclick = () => closeViewer();
el.prev.onclick = () => go(-1);
el.next.onclick = () => go(1);
el.fit.onclick = resetView;
el.save.onclick = async () => {
  if (!V.blob) return;
  const f = curFrame();
  const name = `physlab_frame${String(f.index + 1).padStart(2, '0')}_t${formatSeconds(f.actualMs)}s.jpg`;
  await saveBlob(V.blob, name);
};

// briefly highlight the A/B buttons (a tap on the photo does nothing until one of them is selected)
function pulseTools() {
  for (const b of [el.pa, el.pb]) { b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); }
}
el.pa.onclick = () => { V.target = V.target === 'a' ? null : 'a'; updateTools(); renderMarks(); };
el.pb.onclick = () => { V.target = V.target === 'b' ? null : 'b'; updateTools(); renderMarks(); };
el.clr.onclick = () => { if (V.target === 'a' || V.target === 'b') { setPoint(null); commitPoint(); } };

// ---------- scale / vertical reference ----------
el.which.onclick = () => { V.sub = V.sub === 'p1' ? 'p2' : 'p1'; updateTools(); renderMarks(); };
el.setupCancel.onclick = () => closeViewer();
el.setupOk.onclick = () => {
  const d = V.draft; if (!d) return;
  if (!d.p1 || !d.p2) { el.hint.textContent = t('v.bothFirst'); return; }
  if (Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y) < 5) { el.hint.textContent = t('v.tooClose'); return; }
  const frame = curFrame().index;
  if (d.kind === 'cal') {
    const dist = Number(String(el.dist.value).replace(',', '.'));
    if (!(dist > 0)) { el.hint.textContent = t('v.distErr'); return; }
    state.setup.cal = { p1: d.p1, p2: d.p2, distance: dist, unit: el.unit.value, frame };
  } else {
    state.setup.vert = { mode: 'points', p1: d.p1, p2: d.p2, frame };
  }
  closeViewer();
  persistSetup();
};

// ============================ deleting a frame ============================
// Immediate, with a short Undo. For trimming a recording that started too early or ended too late. Frame
// numbers and time stamps of the remaining frames are NOT changed (they stay the real measured values),
// and the timing check, tables and derived results are re-evaluated for what is left.
let undo = null, toastTimer = 0;
function hideToast() { clearTimeout(toastTimer); el.toast.hidden = true; undo = null; }
function showToast(text, onUndo) {
  clearTimeout(toastTimer);
  el.toastText.textContent = text; el.toastUndo.hidden = !onUndo; el.toast.hidden = false;
  undo = onUndo;
  toastTimer = setTimeout(hideToast, 8000);
}
el.toastUndo.onclick = async () => { const u = undo; hideToast(); if (u) await u(); };

el.del.onclick = async () => {
  const f = curFrame(); if (!f) return;
  let image = null;
  try { image = await store.getImage(f.index); } catch (_) {}
  try { await store.deleteFrame(f.index); }
  catch (e) { el.hint.textContent = t('v.deleteErr') + e.message; return; }
  const mark = state.marks[f.index];
  state.frames.splice(V.i, 1);                                   // the next frame now sits at the same position
  delete state.marks[f.index];
  if (mark) { try { await store.setMarks(state.marks); } catch (_) {} }
  renderGallery(true);
  showToast(t('v.deleted', { i: f.index + 1 }), image ? async () => {
    try { await store.putFrame(f, image); } catch (e) { showToast(t('v.restoreErr') + e.message); return; }
    state.frames.push(f); state.frames.sort((a, b) => a.index - b.index);
    if (mark) { state.marks[f.index] = mark; try { await store.setMarks(state.marks); } catch (_) {} }
    renderGallery(true);
    if (V.open) show(state.frames.indexOf(f));
  } : null);
  if (!state.frames.length) { closeViewer(); return; }
  show(Math.min(V.i, state.frames.length - 1));                  // next frame (or the previous one if the last was deleted)
};
