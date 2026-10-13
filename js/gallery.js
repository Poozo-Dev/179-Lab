// gallery.js — thumbnail grid, quality summary and the full-screen zoomable viewer.
import { assessQuality, formatFrameLine, formatSeconds, formatSigned } from './timing.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const el = {
  screen: $('screen-gallery'), sub: $('g-sub'), quality: $('g-quality'), notes: $('g-notes'),
  grid: $('g-grid'), table: $('g-table'), again: $('btn-again'), finish: $('btn-finish'),
  viewer: $('viewer'), stage: $('v-stage'), img: $('v-img'), title: $('v-title'), line: $('v-line'), warn: $('v-warn'),
  close: $('v-close'), save: $('v-save'), prev: $('v-prev'), next: $('v-next'), fit: $('v-fit'),
};

const FLAG_TEXT = {
  deviation: 'timing off target',
  gap: 'camera frames were dropped nearby',
  duplicate: 'same camera frame as the previous image',
  suspect: 'late callback: pixels may belong to a neighbouring frame',
};
const STOP_TEXT = {
  max: null,
  user: null,
  hidden: 'Recording was interrupted because the app went to the background or the screen turned off.',
  'track-ended': 'The camera stopped during recording (disconnected, or taken by another app).',
  orientation: 'The phone was rotated during recording, which changes the image size.',
  storage: 'The phone ran out of storage space or could not save images.',
  overload: 'The phone could not keep up with saving the images (too slow). Try a longer interval.',
  reload: 'The page was closed or reloaded during recording.',
};

let urls = [];      // object URLs of thumbnails (revoked when the gallery is rebuilt)
let state = { session: null, frames: [] };

export function hideGallery() { el.screen.hidden = true; closeViewer(true); }

export function showGallery({ session, frames, notice, onAgain, onFinish }) {
  urls.forEach((u) => URL.revokeObjectURL(u)); urls = [];
  state = { session, frames };
  el.screen.hidden = false;
  window.scrollTo(0, 0);

  const q = assessQuality(frames, session.stats, { toleranceMs: session.toleranceMs, gapFactor: session.gapFactor });
  const problems = [...q.problems];
  const stopText = STOP_TEXT[session.stopReason];
  if (stopText) problems.unshift(stopText);
  if (notice) problems.unshift(notice);
  if (!frames.length) problems.unshift('No frames were captured.');
  const ok = problems.length === 0;

  const when = new Date(session.createdAt).toLocaleString();
  el.sub.textContent = `${when} · every ${formatSeconds(session.intervalMs)} s · ${frames.length} frames` +
    (session.width ? ` · ${session.width}×${session.height}` : '');

  el.quality.className = 'banner ' + (ok ? 'ok' : 'bad');
  el.quality.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = ok
    ? `Timing check passed: all frames within ±${session.toleranceMs} ms of their target time (worst ${Math.round(q.worstDeviationMs)} ms).`
    : 'Timing check failed — repeat the experiment';
  el.quality.append(b);
  if (!ok) {
    const ul = document.createElement('ul');
    for (const p of problems) { const li = document.createElement('li'); li.textContent = p; ul.append(li); }
    el.quality.append(ul);
  }

  el.notes.innerHTML = '';
  const notes = [...q.notes];
  if (session.timeSource) notes.push(`Timestamp source: ${session.timeSource}.`);
  if (session.sourceMode === 'rvfc') {
    notes.push('Compatibility mode: this browser reports frame times less precisely than Chrome on Android. Treat small time differences with caution.');
  }
  notes.push('Times are camera-pipeline timestamps, not sensor exposure times: expect an uncertainty of about one camera frame period.');
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
    btn.setAttribute('aria-label', `Frame ${f.index + 1}, ${formatSeconds(f.actualMs)} seconds`);
    const img = document.createElement('img'); img.src = url; img.alt = '';
    const cap = document.createElement('div'); cap.className = 'cap';
    const a = document.createElement('span'); a.textContent = `#${f.index + 1}`;
    const t = document.createElement('span'); t.textContent = `${formatSeconds(f.actualMs)} s`;
    cap.append(a, t);
    if (flags.length) { const w = document.createElement('span'); w.className = 'w'; w.textContent = '⚠'; cap.append(w); }
    btn.append(img, cap);
    btn.addEventListener('click', () => openViewer(i, q.perFrame));
    el.grid.append(btn);
  });

  el.table.textContent = frames.map((f, i) => {
    const fl = q.perFrame[i];
    return formatFrameLine(f) + (fl.length ? '  ⚠ ' + fl.map((x) => FLAG_TEXT[x]).join('; ') : '');
  }).join('\n');

  el.again.onclick = onAgain;
  el.finish.onclick = onFinish;
  state.perFrame = q.perFrame;
}

// ================================ viewer ================================
const V = { open: false, i: 0, token: 0, url: null, blob: null, nat: { w: 1, h: 1 },
  scale: 1, tx: 0, ty: 0, pointers: new Map(), pinch: null, lastTap: 0, pushed: false };
const MAX_SCALE = 10;

function openViewer(i) {
  V.open = true; el.viewer.hidden = false;
  history.pushState({ viewer: true }, ''); V.pushed = true;
  resetView();
  show(i);
}
function closeViewer(silent) {
  if (!V.open) return;
  V.open = false; V.token++; el.viewer.hidden = true;
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
  el.title.textContent = `Frame ${f.index + 1} of ${frames.length}`;
  el.line.textContent = `t = ${formatSeconds(f.actualMs)} s · target ${formatSeconds(f.targetMs)} s · ${formatSigned(f.deviationMs)}`;
  const fl = (state.perFrame && state.perFrame[i]) || [];
  el.warn.textContent = fl.length ? '⚠ ' + fl.map((x) => FLAG_TEXT[x]).join('; ') : '';
  el.prev.disabled = i === 0; el.next.disabled = i === frames.length - 1;
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
    el.warn.textContent = 'This image could not be loaded.';
  }
}
const go = (d) => show(V.i + d);   // zoom/pan is kept when stepping, to compare an object against a ruler

function resetView() { V.scale = 1; V.tx = 0; V.ty = 0; applyView(); }
function applyView() {
  const r = el.stage.getBoundingClientRect();
  const fit = Math.min(r.width / V.nat.w, r.height / V.nat.h) || 1;
  const mx = Math.max(0, (V.nat.w * fit * V.scale - r.width) / 2);
  const my = Math.max(0, (V.nat.h * fit * V.scale - r.height) / 2);
  V.tx = Math.min(mx, Math.max(-mx, V.tx));
  V.ty = Math.min(my, Math.max(-my, V.ty));
  el.img.style.transform = `translate(${V.tx}px, ${V.ty}px) scale(${V.scale})`;
}
// zoom keeping the screen point (ax, ay) — relative to the stage centre — fixed
function zoomAt(newScale, ax, ay) {
  newScale = Math.min(MAX_SCALE, Math.max(1, newScale));
  const k = newScale / V.scale;
  V.tx = ax - k * (ax - V.tx); V.ty = ay - k * (ay - V.ty);
  V.scale = newScale; applyView();
}
const centerRel = (cx, cy) => {
  const r = el.stage.getBoundingClientRect();
  return [cx - r.left - r.width / 2, cy - r.top - r.height / 2];
};

el.stage.addEventListener('pointerdown', (e) => {
  el.stage.setPointerCapture(e.pointerId);
  V.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, st: performance.now() });
  if (V.pointers.size === 2) {
    const [a, b] = [...V.pointers.values()];
    V.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: V.scale };
  }
});
el.stage.addEventListener('pointermove', (e) => {
  const p = V.pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (V.pointers.size === 2 && V.pinch) {
    const [a, b] = [...V.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const [ax, ay] = centerRel((a.x + b.x) / 2, (a.y + b.y) / 2);
    zoomAt(V.pinch.s * d / V.pinch.d, ax, ay);
  } else if (V.pointers.size === 1 && V.scale > 1) {
    V.tx += dx; V.ty += dy; applyView();
  }
});
function endPointer(e) {
  const p = V.pointers.get(e.pointerId); if (!p) return;
  V.pointers.delete(e.pointerId);
  if (V.pointers.size < 2) V.pinch = null;
  if (e.type === 'pointercancel' || V.pointers.size > 0) return;
  const dx = e.clientX - p.sx, dy = e.clientY - p.sy, dt = performance.now() - p.st;
  if (V.scale <= 1.01 && dt < 700 && Math.abs(dx) > 50 && Math.abs(dx) > 1.6 * Math.abs(dy)) {
    go(dx < 0 ? 1 : -1); return;                                // swipe
  }
  if (Math.hypot(dx, dy) < 10 && dt < 300) {                    // tap / double tap
    const now = performance.now();
    if (now - V.lastTap < 320) {
      const [ax, ay] = centerRel(e.clientX, e.clientY);
      if (V.scale > 1.01) { V.scale = 1; V.tx = 0; V.ty = 0; applyView(); } else zoomAt(3, ax, ay);
      V.lastTap = 0;
    } else V.lastTap = now;
  }
}
el.stage.addEventListener('pointerup', endPointer);
el.stage.addEventListener('pointercancel', endPointer);
el.stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [ax, ay] = centerRel(e.clientX, e.clientY);
  zoomAt(V.scale * Math.exp(-e.deltaY * 0.0015), ax, ay);
}, { passive: false });
window.addEventListener('resize', () => { if (V.open) applyView(); });
window.addEventListener('keydown', (e) => {
  if (!V.open) return;
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
  const f = state.frames[V.i];
  const name = `physlab_frame${String(f.index + 1).padStart(2, '0')}_t${formatSeconds(f.actualMs)}s.jpg`;
  await saveBlob(V.blob, name);
};

// Phones: the share sheet offers "Save Image" / "Save to Files". Desktop: ordinary download.
async function saveBlob(blob, name) {
  const file = new File([blob], name, { type: 'image/jpeg' });
  if (navigator.maxTouchPoints > 0 && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; /* otherwise fall through to download */ }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
