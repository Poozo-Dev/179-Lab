// plot.js — plot of the manually marked positions on a white canvas, with a least-squares parabola.
//
// Two views of the same points (y is measured UPWARD from the bottom edge of the picture, in image pixels):
//   • Trajectory  y(x):  the path in the picture. For projectile motion this is a parabola.
//   • Height      y(t):  height against time. Parabola for free fall and for projectile motion (vertical part).
// Static camera assumed: marks are plain pixel positions, nothing is corrected for perspective or lens.
import { fitParabola } from './fit.js';
import { formatSeconds } from './timing.js';
import { saveBlob } from './save.js';

const $ = (id) => document.getElementById(id);
const el = { root: $('plot'), canvas: $('p-canvas'), close: $('p-close'), save: $('p-save'), info: $('p-info'),
  modes: [...document.querySelectorAll('#p-modes .chip')] };

const P = { open: false, mode: 'traj', data: null, pushed: false };

// ---------- helpers ----------
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
function ticks(lo, hi, target = 6) {
  const step = niceStep((hi - lo) / target), out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return { values: out, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}
const num = (v) => { const r = Number(v.toPrecision(4)); return Object.is(r, -0) ? '0' : String(r).replace('-', '−'); };
function equation(fit, mode) {
  const X = mode === 'traj' ? 'x' : 't';
  const sign = (v) => (v < 0 ? '−' : '+') + ' ' + num(Math.abs(v));
  return `y = ${num(fit.a)}·${X}² ${sign(fit.b)}·${X} ${sign(fit.c)}`;
}
function fitText(ctx, text, maxW, size, weight = '') {      // shrink the font until the text fits the width
  let s = size;
  for (; s > 9; s -= 0.5) { ctx.font = `${weight} ${s}px system-ui, sans-serif`; if (ctx.measureText(text).width <= maxW) break; }
  return s;
}

function model(data, mode) {
  const pts = data.points;
  const xs = pts.map((p) => (mode === 'traj' ? p.x : p.t)), ys = pts.map((p) => p.y);
  return { xs, ys, fit: fitParabola(xs, ys) };
}

// ---------- drawing (logical size W×H in CSS pixels; the caller sets the pixel ratio) ----------
export function drawPlot(ctx, W, H, data, mode) {
  const { points } = data, { xs, ys, fit } = model(data, mode);
  const L = 62, R = 18, T = 58, B = 50, pw = W - L - R, ph = H - T - B;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // caption (also ends up in the saved picture)
  ctx.fillStyle = '#111'; ctx.textAlign = 'left';
  const title = (mode === 'traj' ? 'Trajectory y(x)' : 'Height y(t)') + ` — ${points.length} point${points.length === 1 ? '' : 's'}`;
  ctx.font = `600 ${fitText(ctx, title, W - 24, 15, '600')}px system-ui, sans-serif`; ctx.fillText(title, 12, 20);
  let line, color = '#555';
  if (fit) { line = `${equation(fit, mode)}     R² = ${fit.r2.toFixed(4)}${fit.exact ? ' (3 points: exact fit)' : ''}`; color = '#1565c0'; }
  else if (points.length < 3) line = 'Mark at least 3 frames to fit a parabola.';
  else line = mode === 'traj' ? 'All points have the same x: use “Height y(t)”.' : 'Not enough different times to fit.';
  ctx.fillStyle = color; ctx.font = `${fitText(ctx, line, W - 24, 13)}px system-ui, sans-serif`; ctx.fillText(line, 12, 42);

  if (!points.length) {
    ctx.fillStyle = '#888'; ctx.textAlign = 'center'; ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('Open a frame, tap “Add position”, then tap the object.', W / 2, H / 2); return;
  }

  // data window (with padding); the curve's own extent is included so it is never cut off
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let ylo = Math.min(...ys), yhi = Math.max(...ys);
  if (fit) for (let i = 0; i <= 60; i++) { const v = fit.at(x0 + (x1 - x0) * i / 60); ylo = Math.min(ylo, v); yhi = Math.max(yhi, v); }
  const padR = (lo, hi) => { const r = hi - lo, p = r > 0 ? r * 0.1 : (Math.abs(hi) * 0.1 || 1); return [lo - p, hi + p]; };
  const [xmin, xmax] = padR(x0, x1), [ymin, ymax] = padR(ylo, yhi);
  const xr = xmax - xmin, yr = ymax - ymin;
  let sx = pw / xr, sy = ph / yr;
  if (mode === 'traj') sx = sy = Math.min(sx, sy);              // true shape: 1 px in x = 1 px in y
  const ox = L + (pw - xr * sx) / 2, oy = T + ph - (ph - yr * sy) / 2;
  const mx = (x) => ox + (x - xmin) * sx, my = (y) => oy - (y - ymin) * sy;
  const vx0 = xmin - (ox - L) / sx, vx1 = vx0 + pw / sx, vy0 = ymin - (T + ph - oy) / sy, vy1 = vy0 + ph / sy;

  // grid + tick labels
  const tx = ticks(vx0, vx1), ty = ticks(vy0, vy1);
  ctx.lineWidth = 1; ctx.font = '11.5px system-ui, sans-serif'; ctx.fillStyle = '#444';
  ctx.textAlign = 'center';
  for (const v of tx.values) { const X = mx(v); ctx.strokeStyle = '#e6e6e6'; ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, T + ph); ctx.stroke(); ctx.fillText(v.toFixed(tx.decimals), X, T + ph + 16); }
  ctx.textAlign = 'right';
  for (const v of ty.values) { const Y = my(v); ctx.strokeStyle = '#e6e6e6'; ctx.beginPath(); ctx.moveTo(L, Y); ctx.lineTo(L + pw, Y); ctx.stroke(); ctx.fillText(v.toFixed(ty.decimals), L - 6, Y + 4); }
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.strokeRect(L, T, pw, ph);
  ctx.fillStyle = '#222'; ctx.font = '12.5px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(mode === 'traj' ? 'x (pixels, from the left edge of the picture)' : 't (seconds)', L + pw / 2, H - 10);
  ctx.save(); ctx.translate(15, T + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('y (pixels, up from the bottom edge)', 0, 0); ctx.restore();

  // fitted parabola
  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  if (fit) {
    ctx.strokeStyle = '#1565c0'; ctx.lineWidth = 2.5; ctx.beginPath();
    const a = vx0, b = vx1;
    for (let i = 0; i <= 200; i++) { const x = a + (b - a) * i / 200, X = mx(x), Y = my(fit.at(x)); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    ctx.stroke();
  }
  ctx.restore();

  // points first, then labels (so a label's white halo never hides a neighbouring point).
  // Labels try several positions around their point and take the first that overlaps no earlier label.
  points.forEach((p, i) => {
    ctx.fillStyle = '#e53935'; ctx.strokeStyle = '#7f1010'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mx(xs[i]), my(ys[i]), 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  });
  const above = !(fit && fit.a > 0);                      // outside of the curve: above if it bends down
  const up = [[9, -9, 'left'], [-9, -9, 'right'], [0, -24, 'center'], [9, 17, 'left'], [-9, 17, 'right'], [0, 34, 'center']];
  const down = [[9, 17, 'left'], [-9, 17, 'right'], [0, 34, 'center'], [9, -9, 'left'], [-9, -9, 'right'], [0, -24, 'center']];
  const cand = above ? up : down, placed = [];
  const dots = points.map((_, k) => ({ x0: mx(xs[k]) - 8, x1: mx(xs[k]) + 8, y0: my(ys[k]) - 8, y1: my(ys[k]) + 8 }));
  ctx.font = '600 12px system-ui, sans-serif';
  points.forEach((p, i) => {
    const X = mx(xs[i]), Y = my(ys[i]);
    const label = mode === 'traj' ? `${formatSeconds(p.t * 1000)} s` : `#${p.index + 1}`;
    const w = ctx.measureText(label).width;
    const boxOf = ([dx, dy, al]) => {
      const lx = X + dx, x0 = al === 'left' ? lx : al === 'right' ? lx - w : lx - w / 2;
      return { lx, al, ly: Y + dy, x0, x1: x0 + w, y0: Y + dy - 12, y1: Y + dy + 3 };
    };
    const free = (b) => b.x0 >= L + 2 && b.x1 <= L + pw - 2 && b.y0 >= T + 2 && b.y1 <= T + ph - 2 &&
      ![...placed, ...dots.filter((_, k) => k !== i)].some((q) => b.x0 < q.x1 + 2 && b.x1 > q.x0 - 2 && b.y0 < q.y1 && b.y1 > q.y0);
    const boxes = cand.map(boxOf), box = boxes.find(free) || boxes[0];
    placed.push(box);
    ctx.textAlign = box.al;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(label, box.lx, box.ly);
    ctx.fillStyle = '#111'; ctx.fillText(label, box.lx, box.ly);
  });
}

// ---------- overlay ----------
function render(canvas, dpr, W, H) {
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPlot(ctx, W, H, P.data, P.mode);
}
function redraw() {
  if (!P.open) return;
  const r = el.canvas.getBoundingClientRect();
  render(el.canvas, window.devicePixelRatio || 1, Math.max(200, r.width), Math.max(200, r.height));
  const { fit } = model(P.data, P.mode), n = P.data.points.length, notes = [];
  if (n && n < 3) notes.push('Mark at least 3 frames to fit a parabola.');
  if (fit) {
    notes.push(`${equation(fit, P.mode)}   (R² = ${fit.r2.toFixed(4)})`);
    notes.push(`Least-squares fit to ${fit.n} points; typical distance of the points from the curve: ${num(fit.rmse)} px.`);
    if (fit.exact) notes.push('With exactly 3 points the parabola always passes through all of them. Mark more frames for a meaningful fit.');
  }
  if (n && !fit && n >= 3 && P.mode === 'traj') notes.push('All marked points have (almost) the same x, which happens in vertical free fall. Switch to “Height y(t)”.');
  if (P.data.timingOk === false) notes.push('Warning: the timing check of this recording failed, so the time stamps are not fully reliable.');
  if (n) notes.push('Positions are pixels in the picture (static camera assumed). To convert to metres, measure a known length, e.g. the ruler, in the same picture.');
  el.info.innerHTML = '';
  for (const t of notes) { const li = document.createElement('li'); li.textContent = t; el.info.append(li); }
}
function setMode(m) {
  P.mode = m;
  el.modes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  redraw();
}

export function openPlot({ session, frames, marks, timingOk }) {
  const H = session.height || (frames[0] && frames[0].height) || 0;
  const points = frames.filter((f) => marks[f.index])
    .map((f) => ({ index: f.index, t: f.actualMs / 1000, x: marks[f.index].x, y: H - marks[f.index].y }));
  P.data = { points, timingOk };
  P.open = true; el.root.hidden = false;
  history.pushState({ plot: true }, ''); P.pushed = true;
  setMode(P.mode);
}
function closePlot(silent) {
  if (!P.open) return;
  P.open = false; el.root.hidden = true;
  if (P.pushed && !silent) { P.pushed = false; history.back(); } else P.pushed = false;
}
window.addEventListener('popstate', () => { if (P.open) { P.pushed = false; closePlot(true); } });
window.addEventListener('resize', redraw);
window.addEventListener('keydown', (e) => { if (P.open && e.key === 'Escape') closePlot(); });
el.close.onclick = () => closePlot();
el.modes.forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
el.save.onclick = async () => {
  if (!P.data || !P.data.points.length) return;
  const r = el.canvas.getBoundingClientRect(), W = Math.max(360, r.width), H = Math.max(360, r.height);
  const off = document.createElement('canvas');
  render(off, 3, W, H);                                          // 3× pixel ratio for a sharp picture
  const blob = await new Promise((res) => off.toBlob(res, 'image/png'));
  off.width = off.height = 0;
  if (blob) await saveBlob(blob, `physlab_plot_${P.mode === 'traj' ? 'trajectory' : 'height-vs-time'}.png`, 'image/png');
};
