// main.js — app flow: camera screen -> (Start/Stop) -> gallery -> Record again / Finish.
import { CONFIG } from './config.js';
import { RateEstimator, formatSeconds } from './timing.js';
import { openCamera, stopStream, FrameSource } from './frame-source.js';
import { Recorder } from './recorder.js';
import * as store from './store.js';
import { showGallery, hideGallery } from './gallery.js';

const $ = (id) => document.getElementById(id);
const el = {
  cam: $('screen-camera'), video: $('preview'), state: $('hud-state'), rate: $('hud-rate'), back: $('btn-back'),
  msg: $('cam-msg'), msgText: $('cam-msg-text'), retry: $('btn-retry'),
  chips: $('chips'), input: $('interval-input'), tol: $('tolerance'), rec: $('btn-record'),
};

// ---------- small persistence of the last-used settings (optional convenience) ----------
const pref = {
  get(k, d) { try { const v = localStorage.getItem('physlab.' + k); return v === null ? d : Number(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('physlab.' + k, String(v)); } catch (_) {} },
};
let intervalMs = pref.get('interval', CONFIG.intervalMs);
let toleranceMs = pref.get('tolerance', CONFIG.toleranceMs);
if (!(intervalMs >= CONFIG.minIntervalMs && intervalMs <= CONFIG.maxIntervalMs)) intervalMs = CONFIG.intervalMs;
if (!CONFIG.toleranceOptionsMs.includes(toleranceMs)) toleranceMs = CONFIG.toleranceMs;

const sourceOverride = new URLSearchParams(location.search).get('source');   // ?source=rvfc|processor (testing)

// ---------- state ----------
let screen = 'none';           // 'camera' | 'gallery'
let stream = null, source = null, camToken = 0, wake = null;
let storageOk = true;
const rate = new RateEstimator();
const recorder = new Recorder({ onUpdate: onRecUpdate, onStopped: onRecStopped });

// ---------- interval / tolerance controls ----------
function renderInterval() {
  el.chips.innerHTML = '';
  for (const ms of CONFIG.intervalPresetsMs) {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = formatSeconds(ms).replace(/0+$/, '').replace(/\.$/, '.0') + ' s';
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
for (const ms of CONFIG.toleranceOptionsMs) {
  const o = document.createElement('option'); o.value = ms; o.textContent = `±${ms} ms`; o.selected = ms === toleranceMs;
  el.tol.append(o);
}
el.tol.onchange = () => { toleranceMs = Number(el.tol.value); pref.set('tolerance', toleranceMs); };

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
  if (source) { source.stop(); source = null; }
  stopStream(stream); stream = null;
  el.video.srcObject = null;
  if (wake) { wake.release().catch(() => {}); wake = null; }
  el.rec.disabled = true;
}

async function startCamera() {
  stopCamera();
  const token = camToken;
  hideMsg(); setHud('Starting camera…'); el.rec.disabled = true;
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
    const track = s.getVideoTracks()[0];
    const lost = () => { if (token === camToken && recorder.recording) recorder.stop('track-ended'); };
    track.addEventListener('ended', () => {
      if (token !== camToken) return;
      if (recorder.recording) recorder.stop('track-ended');
      else if (screen === 'camera') { stopCamera(); showMsg('The camera stopped (it may have been taken by another app).'); setHud('Camera stopped'); }
    });
    track.addEventListener('mute', lost);
    lockScreen();
    el.rec.disabled = !storageOk;
    setHud('Ready');
  } catch (e) {
    if (token !== camToken) { stopStream(s); return; }
    stopCamera();
    setHud('Camera unavailable');
    showMsg(e && e.code ? e.message : 'The camera could not be started. Tap "Try again".');
  }
}
el.retry.onclick = startCamera;

// ---------- HUD ----------
function setHud(text, rec = false) { el.state.textContent = text; el.state.classList.toggle('rec', rec); }
setInterval(() => {
  if (screen !== 'camera' || !stream) { el.rate.hidden = true; return; }
  const fps = rate.fps;
  el.rate.hidden = !(fps > 0);
  if (fps > 0) el.rate.textContent = `${fps.toFixed(1)} fps`;
}, 500);

function onRecUpdate({ elapsedMs, selected }) {
  setHud(`● REC ${(elapsedMs / 1000).toFixed(1)} s · ${selected} frames`, true);
}

// ---------- start / stop ----------
el.rec.onclick = async () => {
  if (recorder.recording) { el.rec.disabled = true; await recorder.stop('user'); return; }   // onRecStopped navigates
  if (!source) return;
  hideMsg();
  const free = await store.freeBytes();
  if (free !== null && free < 25 * 1024 * 1024) {
    showMsg('There is very little free storage on this phone. Free some space and try again.', false); return;
  }
  el.rec.disabled = true;
  try {
    await recorder.start({ intervalMs, toleranceMs, source });
  } catch (e) {
    el.rec.disabled = false; showMsg(e.message || 'Could not start recording.', false); return;
  }
  store.requestPersistence();
  el.rec.classList.add('on'); el.rec.setAttribute('aria-label', 'Stop'); el.rec.disabled = false;
  el.back.hidden = true;
  setHud('● REC 0.0 s · 0 frames', true);
};

async function onRecStopped(session, err) {
  el.rec.classList.remove('on'); el.rec.setAttribute('aria-label', 'Start');
  stopCamera();                       // release the camera as soon as recording ends
  await goGallery(err ? err.message : null);
}

// ---------- screens ----------
async function goGallery(notice) {
  let session, frames;
  try {
    session = await store.getSession();
    frames = session ? await store.listFrames() : [];
  } catch (e) { storageOk = false; showCameraScreen(); showMsg(e.message, false); return; }
  if (!session) { showCameraScreen(); return; }
  frames.sort((a, b) => a.index - b.index);
  screen = 'gallery';
  el.cam.hidden = true;
  showGallery({
    session, frames, notice,
    onAgain: () => {
      if (confirm('Starting a new recording deletes the frames shown here. Continue?')) showCameraScreen();
    },
    onFinish: async () => {
      if (!confirm('Delete all frames of this experiment? This cannot be undone.')) return;
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
    if (recorder.recording) recorder.stop('hidden');       // timing is not trustworthy across a suspension
    else if (screen === 'camera') stopCamera();
  } else if (screen === 'camera' && !stream) {
    startCamera();
  } else if (screen === 'camera') {
    lockScreen();
  }
});

// ---------- boot ----------
async function boot() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  renderInterval();
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
