// main.js — app flow: camera screen -> (Start/Stop) -> gallery -> Record again / Finish.
import { CONFIG, APP_VERSION } from './config.js';
import { RateEstimator, formatSeconds } from './timing.js';
import { openCamera, stopStream, FrameSource, cameraInfo, setZoom, setExposure } from './frame-source.js';
import { Recorder } from './recorder.js';
import * as store from './store.js';
import { showGallery, hideGallery } from './gallery.js';
import { Countdown, unlockAudio, beep } from './countdown.js';
import { tiltFromOrientation, AngleSmoother } from './geometry.js';
import { t, applyStatic, hasChosen, setLang, onLangChange } from './i18n.js';

// Home-screen web app? (enables the cosmetic bottom-stripe fix in styles.css; nothing else depends on it)
try {
  if (navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)) {
    document.documentElement.classList.add('standalone');
  }
} catch (_) {}

const $ = (id) => document.getElementById(id);
const el = {
  cam: $('screen-camera'), video: $('preview'), state: $('hud-state'), rate: $('hud-rate'), back: $('btn-back'),
  msg: $('cam-msg'), msgText: $('cam-msg-text'), retry: $('btn-retry'),
  chips: $('chips'), input: $('interval-input'), rec: $('btn-record'),
  cd: $('countdown'), cdNum: $('cd-num'), cdSel: $('countdown-sel'), levelBtn: $('btn-level'), level: $('level'),
  zoomRow: $('row-zoom'), zoom: $('zoom'), zoomVal: $('zoom-val'), exp: $('exposure'), expRow: $('row-exposure'),
  expTip: $('exposure-tip'),
};

// ---------- small persistence of the last-used settings (optional convenience) ----------
const pref = {
  get(k, d) { try { const v = localStorage.getItem('physlab.' + k); return v === null ? d : Number(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('physlab.' + k, String(v)); } catch (_) {} },
};
let intervalMs = pref.get('interval', CONFIG.intervalMs);
let countdownS = pref.get('countdown', 0);
if (!(intervalMs >= CONFIG.minIntervalMs && intervalMs <= CONFIG.maxIntervalMs)) intervalMs = CONFIG.intervalMs;
if (!CONFIG.countdownOptionsS.includes(countdownS)) countdownS = 0;

const sourceOverride = new URLSearchParams(location.search).get('source');   // ?source=rvfc|processor (testing)

// ---------- state ----------
let screen = 'none';           // 'camera' | 'gallery'
let stream = null, source = null, camToken = 0, wake = null, cam = null;
let storageOk = true;
const rate = new RateEstimator();
const recorder = new Recorder({ onUpdate: onRecUpdate, onStopped: onRecStopped });

// ---------- interval / countdown controls ----------
function renderInterval() {
  el.chips.innerHTML = '';
  for (const ms of CONFIG.intervalPresetsMs) {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = formatSeconds(ms).replace(/0+$/, '').replace(/\.$/, '.0') + ' ' + t('u.s');
    b.setAttribute('aria-pressed', String(ms === intervalMs));
    b.onclick = () => { intervalMs = ms; pref.set('interval', ms); renderInterval(); };
    el.chips.append(b);
  }
  el.input.value = String(intervalMs / 1000);
}
el.input.addEventListener('change', () => {
  const ms = Math.round(parseFloat(String(el.input.value).replace(',', '.')) * 1000);
  if (ms >= CONFIG.minIntervalMs && ms <= CONFIG.maxIntervalMs) { intervalMs = ms; pref.set('interval', ms); }
  renderInterval();
});
function renderCountdownOptions() {
  el.cdSel.innerHTML = '';
  for (const s of CONFIG.countdownOptionsS) {
    const o = document.createElement('option'); o.value = s; o.textContent = s ? `${s} ${t('u.s')}` : t('cam.off'); o.selected = s === countdownS;
    el.cdSel.append(o);
  }
}
el.cdSel.onchange = () => { countdownS = Number(el.cdSel.value); pref.set('countdown', countdownS); };

// ---------- messages ----------
function showMsg(text, withRetry = true) {
  el.msgText.textContent = text; el.retry.hidden = !withRetry; el.msg.hidden = false;
}
const hideMsg = () => { el.msg.hidden = true; };

// ---------- camera lifecycle ----------
async function lockScreen() {
  try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } }
  catch (_) {}
}
function stopCamera() {
  camToken++;
  countdown.cancel();
  if (source) { source.stop(); source = null; }
  stopStream(stream); stream = null; cam = null;
  el.video.srcObject = null;
  if (wake) { wake.release().catch(() => {}); wake = null; }
  el.rec.disabled = true;
  renderCameraControls();
}

async function startCamera() {
  stopCamera();
  const token = camToken;
  hideMsg(); setHud('cam.starting'); el.rec.disabled = true;
  let s = null;
  try {
    s = await openCamera();
    if (token !== camToken) { stopStream(s); return; }
    stream = s;
    el.video.srcObject = s;
    await el.video.play();
    if (token !== camToken) return;
    rate.iv = []; rate.last = null;
    const src = new FrameSource(el.video, s, (info) => {
      if (Number.isFinite(info.tsMs)) rate.push(info.tsMs);
      recorder.feed(info);
    }, sourceOverride || 'auto');
    src.onError = () => {};
    await src.start();
    if (token !== camToken) { src.stop(); return; }
    source = src;
    cam = cameraInfo(s);
    renderCameraControls();
    const track = s.getVideoTracks()[0];
    const lost = () => { if (token === camToken && recorder.recording) recorder.stop('track-ended'); };
    track.addEventListener('ended', () => {
      if (token !== camToken) return;
      if (recorder.recording) recorder.stop('track-ended');
      else if (screen === 'camera') { stopCamera(); showMsg(t('cam.stoppedMsg')); setHud('cam.stopped'); }
    });
    track.addEventListener('mute', lost);
    lockScreen();
    el.rec.disabled = !storageOk;
    setHud('cam.ready');
    askLanguage();
  } catch (e) {
    if (token !== camToken) { stopStream(s); return; }
    stopCamera();
    setHud('cam.unavailable');
    showMsg(e && e.code ? e.message : t('err.unknown'));
    askLanguage();
  }
}
el.retry.onclick = startCamera;

// ---------- zoom / exposure (only shown when the camera really supports them) ----------
function renderCameraControls() {
  const busy = recorder.recording || countdown.state === 'counting';
  const z = cam && cam.zoom;
  el.zoomRow.hidden = !z;
  if (z) {
    Object.assign(el.zoom, { min: z.min, max: z.max, step: z.step });
    if (document.activeElement !== el.zoom) el.zoom.value = z.value;
    el.zoomVal.textContent = `${Number(el.zoom.value).toFixed(1)}×`;
    el.zoom.disabled = busy;                     // the picture geometry must not change during a recording
  }
  const ex = cam && cam.exposure;
  el.expRow.hidden = !ex; el.expTip.hidden = !!ex;
  el.exp.disabled = busy;
}
let zoomBusy = false, zoomWanted = null;
el.zoom.addEventListener('input', async () => {
  zoomWanted = Number(el.zoom.value);
  el.zoomVal.textContent = `${zoomWanted.toFixed(1)}×`;
  if (zoomBusy) return;
  zoomBusy = true;
  try {
    while (zoomWanted !== null) {
      const v = zoomWanted; zoomWanted = null;
      const got = await setZoom(stream, v);
      if (cam && cam.zoom && got !== null) cam.zoom.value = got;
    }
  } catch (_) { el.zoomRow.hidden = true; }    // advertised but not working: hide rather than pretend
  zoomBusy = false;
});
function renderExposureOptions() {
  const v = el.exp.value || 'auto';
  el.exp.innerHTML = `<option value="auto">${t('cam.expAuto')}</option>` +
    CONFIG.exposureOptionsS.map((s) => `<option value="${s}">1/${Math.round(1 / s)} ${t('u.s')}</option>`).join('');
  el.exp.value = v;
}
el.exp.onchange = async () => {
  try { await setExposure(stream, el.exp.value === 'auto' ? null : Number(el.exp.value)); }
  catch (_) { el.exp.value = 'auto'; el.expRow.hidden = true; el.expTip.hidden = false; }
};

// ---------- HUD ----------
let hud = { key: 'cam.starting', p: {}, rec: false };   // remembered so a language change can redraw it
function setHud(key, p = {}, rec = false) { hud = { key, p, rec }; el.state.textContent = t(key, p); el.state.classList.toggle('rec', rec); }
setInterval(() => {
  if (screen !== 'camera' || !stream) { el.rate.hidden = true; return; }
  const fps = rate.fps, v = el.video;              // real delivered size and measured rate, not the request
  el.rate.hidden = !(fps > 0);
  if (fps > 0) el.rate.textContent = (v.videoWidth ? `${v.videoWidth}×${v.videoHeight} · ` : '') + `${fps.toFixed(1)} ${t('u.fps')}`;
}, 500);

function onRecUpdate({ elapsedMs, selected }) {
  setHud('cam.rec', { s: (elapsedMs / 1000).toFixed(1), n: selected }, true);
}

// ---------- level overlay (phone motion sensors) ----------
// Shows the picture's vertical axis (dashed) and the physical vertical from the gravity sensor. Purely an
// aid: recording never depends on it. Sensor data are noisy and become meaningless when the phone is held
// nearly flat, which is reported instead of a number.
const level = { on: false, angle: null, at: 0, smooth: new AngleSmoother(0.25), raf: 0, timer: 0 };
const screenAngle = () => {                       // how far the display is rotated from the phone's portrait
  const so = window.screen && window.screen.orientation;
  if (so && Number.isFinite(so.angle)) return so.angle;
  const w = Number(window.orientation);            // older iOS
  return Number.isFinite(w) ? (w + 360) % 360 : 0;
};
function onOrientation(e) {
  if (e.beta === null || e.gamma === null) return;
  level.angle = level.smooth.push(tiltFromOrientation(e.beta, e.gamma, screenAngle()));
  level.at = performance.now();
  if (!level.raf) level.raf = requestAnimationFrame(() => { level.raf = 0; drawLevel(); });
}
function drawLevel() {
  if (!level.on) { el.level.toggleAttribute('hidden', true); return; }
  el.level.toggleAttribute('hidden', false);   // SVG has no .hidden property
  const r = el.level.getBoundingClientRect(), W = r.width, H = r.height;
  const cx = W / 2, cy = H / 2, L = Math.min(W, H) * 0.38;
  const fresh = performance.now() - level.at < 1500;
  let out = `<line x1="${cx}" y1="${cy - L}" x2="${cx}" y2="${cy + L}" stroke="#fff" stroke-width="2" stroke-dasharray="8 6" opacity=".85"/>`;
  if (fresh && level.angle !== null) {
    const a = level.angle, ok = Math.abs(a) <= CONFIG.levelToleranceDeg, rad = a * Math.PI / 180;
    const dx = Math.sin(rad) * L, dy = Math.cos(rad) * L, col = ok ? '#35c27a' : '#f2b134';
    out += `<line x1="${cx - dx}" y1="${cy + dy}" x2="${cx + dx}" y2="${cy - dy}" stroke="${col}" stroke-width="4" stroke-linecap="round"/>`;
    out += `<circle cx="${cx}" cy="${cy}" r="5" fill="${col}"/>`;
  }
  el.level.innerHTML = out;
}
async function setLevel(on) {
  if (on === level.on) return;
  if (!on) {
    level.on = false; window.removeEventListener('deviceorientation', onOrientation);
    clearInterval(level.timer); el.levelBtn.setAttribute('aria-pressed', 'false'); drawLevel(); return;
  }
  if (typeof DeviceOrientationEvent === 'undefined') { showMsg(t('cam.noSensor'), false); return; }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {      // iOS: must be asked from a tap
    let r = 'denied';
    try { r = await DeviceOrientationEvent.requestPermission(); } catch (_) {}
    if (r !== 'granted') { showMsg(t('cam.sensorDenied'), false); return; }
  }
  level.on = true; level.angle = null; level.at = 0; level.smooth = new AngleSmoother(0.25);
  window.addEventListener('deviceorientation', onOrientation);
  el.levelBtn.setAttribute('aria-pressed', 'true');
  level.timer = setInterval(drawLevel, 500);               // also reports "no data" when the sensor is silent
  drawLevel();
}
el.levelBtn.onclick = () => setLevel(!level.on);
const sensorTilt = () => (level.on && level.angle !== null && performance.now() - level.at < 1000 ? level.angle : null);

// ---------- countdown ----------
let cancelBeeps = [];
const countdown = new Countdown({
  onTick: (n) => { el.cd.hidden = false; el.cdNum.textContent = String(n); },
  onGo: () => { el.cd.hidden = true; cancelBeeps = []; beginRecording(); },
  onCancel: () => {
    el.cd.hidden = true; cancelBeeps.forEach((c) => c()); cancelBeeps = [];
    el.rec.classList.remove('on'); el.rec.setAttribute('aria-label', t('cam.start')); setHud('cam.ready'); renderCameraControls();
  },
});

// ---------- start / stop ----------
el.rec.onclick = async () => {
  if (countdown.state === 'counting') { countdown.cancel(); return; }
  if (recorder.recording) { el.rec.disabled = true; await recorder.stop('user'); return; }   // onRecStopped navigates
  if (!source) return;
  const audio = unlockAudio();     // must happen BEFORE any await, or iOS does not count it as a tap
  hideMsg();
  const free = await store.freeBytes();
  if (free !== null && free < 25 * 1024 * 1024) {
    showMsg(t('cam.lowStorage'), false); return;
  }
  if (countdownS > 0) {
    if (audio) {                   // beeps on the audio clock: warning 1 s before the end, final at the end
      if (countdownS >= 2) cancelBeeps.push(beep(countdownS - 1, { freq: 880, dur: 0.12 }));
      cancelBeeps.push(beep(countdownS, { freq: 1320, dur: 0.35 }));
    }
    el.rec.classList.add('on'); el.rec.setAttribute('aria-label', t('cam.cancelCd'));
    setHud('cam.countdown');
    countdown.start(countdownS);
    renderCameraControls();
    return;
  }
  if (audio) beep(0, { freq: 1320, dur: 0.25 });     // recording starts now
  beginRecording();
};

function beginRecording() {
  if (!source || recorder.recording) return;
  const toleranceMs = intervalMs * CONFIG.toleranceFraction;    // fixed rule: flag frames > 10 % of the interval off
  const ready = recorder.start({ intervalMs, toleranceMs, source, camera: cameraInfo(stream), sensorTiltDeg: sensorTilt() });
  ready.then(() => store.requestPersistence(), () => {});   // a storage failure stops the recorder itself
  el.rec.classList.add('on'); el.rec.setAttribute('aria-label', t('cam.stop')); el.rec.disabled = false;
  el.back.hidden = true;
  setHud('cam.rec', { s: '0.0', n: 0 }, true);
  renderCameraControls();
}

async function onRecStopped(session, err) {
  el.rec.classList.remove('on'); el.rec.setAttribute('aria-label', t('cam.start'));
  stopCamera();                       // release the camera as soon as recording ends
  await goGallery(err ? err.message : null);
}

// ---------- screens ----------
async function goGallery(notice) {
  let session, frames, marks = {}, setup = {};
  try {
    session = await store.getSession();
    frames = session ? await store.listFrames() : [];
    if (session) { marks = await store.getMarks(); setup = await store.getSetup(); }
  } catch (e) { storageOk = false; await showCameraScreen(); showMsg(e.message, false); return; }
  if (!session) { await showCameraScreen(); if (notice) showMsg(notice, false); return; }
  frames.sort((a, b) => a.index - b.index);
  screen = 'gallery';
  setLevel(false);
  el.cam.hidden = true;
  showGallery({
    session, frames, marks, setup, notice,
    onAgain: () => {
      if (confirm(t('cam.confirmAgain'))) showCameraScreen();
    },
    onFinish: async () => {
      if (!confirm(t('cam.confirmFinish'))) return;
      try { await store.clearAll(); } catch (e) { alert(e.message); return; }
      showCameraScreen();
    },
  });
}

async function showCameraScreen() {
  screen = 'camera';
  hideGallery();
  el.cam.hidden = false;
  let has = false;
  try { has = !!(await store.getSession()); } catch (_) {}
  el.back.hidden = !has;
  startCamera();
}
el.back.onclick = () => { stopCamera(); goGallery(); };

// ---------- page visibility (screen lock, app switch) ----------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    countdown.cancel();
    if (recorder.recording) recorder.stop('hidden');       // timing is not trustworthy across a suspension
    else if (screen === 'camera') stopCamera();
  } else if (screen === 'camera' && !stream) {
    startCamera();
  } else if (screen === 'camera') {
    lockScreen();
  }
});
window.addEventListener('resize', () => { if (level.on) drawLevel(); });

// ---------- language ----------
function renderTexts() {
  applyStatic();
  renderInterval(); renderCountdownOptions(); renderExposureOptions();
  el.state.textContent = t(hud.key, hud.p);
  el.rec.setAttribute('aria-label', t(countdown.state === 'counting' ? 'cam.cancelCd' : recorder.recording ? 'cam.stop' : 'cam.start'));
  const ver = document.getElementById('app-version'); if (ver) ver.textContent = t('cam.version') + ' ' + APP_VERSION;
}
onLangChange(renderTexts);
// First launch: ask once, after the camera permission question (so the two prompts do not overlap).
const langModal = document.getElementById('lang-modal');
function askLanguage() { if (!hasChosen()) langModal.hidden = false; }
for (const b of langModal.querySelectorAll('[data-lang]')) b.onclick = () => { langModal.hidden = true; setLang(b.dataset.lang); };

// ---------- boot ----------
async function boot() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  renderTexts();
  try {
    await store.probe();
    const session = await store.getSession();
    if (session && session.status === 'recording') {            // page was closed/reloaded mid-recording
      session.status = 'interrupted'; session.stopReason = 'reload';
      await store.setSession(session);
    }
    if (session) { await goGallery(); return; }
  } catch (e) {
    storageOk = false;
    await showCameraScreen();
    showMsg(e.message, false);
    el.rec.disabled = true;
    return;
  }
  showCameraScreen();
}
boot();
