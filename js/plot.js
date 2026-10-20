// plot.js — "Plot Y(X)": the measured trajectories of Point A (red) and Point B (blue) on ONE chart with
// shared axes, plus the centre of mass (green) when the student entered valid masses.
//
// Only ever opened by the student (gallery button), and only for two-point experiments (measure.js decides).
// Nothing is fitted or smoothed: every plotted point is a measured mark (or, for green, the mass-weighted
// average of two marks on the same frame). Points are joined in time order; a dashed segment means frames in
// between have no mark for that point — nothing is interpolated there.
import { POINTS, CM_CSS, validMasses, plotSeries } from './measure.js';
import { saveBlob } from './save.js';

const $ = (id) => document.getElementById(id);
const el = { root: $('plot'), canvas: $('p-canvas'), close: $('p-close'), save: $('p-save'), info: $('p-info'),
  form: $('p-mass'), ma: $('p-ma'), mb: $('p-mb'), err: $('p-mass-err'), skip: $('p-skip'), chart: $('p-chart'),
  masses: $('p-masses') };

const P = { open: false, pushed: false, ctx: null, data: null };

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
const fmtMass = (m) => String(Number(m.toPrecision(6)));

/** data = { series: [{label, color, points:[{x,y,pos}]}], unit } — pos = position of the frame in the recording */
export function drawPlot(ctx, W, H, data) {
  const L = 64, R = 16, T = 30 + 18 * data.series.length, B = 46, pw = W - L - R, ph = H - T - B;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  // legend (also ends up in the saved picture)
  ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#111';
  ctx.fillText('Plot Y(X) — measured positions', 12, 20);
  data.series.forEach((s, i) => {
    const y = 38 + 18 * i;
    ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(14, y - 4); ctx.lineTo(38, y - 4); ctx.stroke();
    ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(26, y - 4, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222'; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`${s.label} — ${s.points.length} point${s.points.length === 1 ? '' : 's'}`, 46, y);
  });

  const all = data.series.flatMap((s) => s.points);
  if (!all.length) return;
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const padR = (lo, hi) => { const r = hi - lo, p = r > 0 ? r * 0.08 : (Math.abs(hi) * 0.1 || 1); return [lo - p, hi + p]; };
  const [xmin, xmax] = padR(Math.min(...xs), Math.max(...xs)), [ymin, ymax] = padR(Math.min(...ys), Math.max(...ys));
  const xr = xmax - xmin, yr = ymax - ymin;
  const sc = Math.min(pw / xr, ph / yr);                        // same scale on both axes: true shape
  const ox = L + (pw - xr * sc) / 2, oy = T + ph - (ph - yr * sc) / 2;
  const mx = (x) => ox + (x - xmin) * sc, my = (y) => oy - (y - ymin) * sc;
  const vx0 = xmin - (ox - L) / sc, vx1 = vx0 + pw / sc, vy0 = ymin - (T + ph - oy) / sc, vy1 = vy0 + ph / sc;

  const tx = ticks(vx0, vx1), ty = ticks(vy0, vy1);
  ctx.lineWidth = 1; ctx.font = '11.5px system-ui, sans-serif'; ctx.fillStyle = '#444';
  ctx.textAlign = 'center';
  for (const v of tx.values) { const X = mx(v); ctx.strokeStyle = '#e6e6e6'; ctx.beginPath(); ctx.moveTo(X, T); ctx.lineTo(X, T + ph); ctx.stroke(); ctx.fillText(v.toFixed(tx.decimals), X, T + ph + 16); }
  ctx.textAlign = 'right';
  for (const v of ty.values) { const Y = my(v); ctx.strokeStyle = '#e6e6e6'; ctx.beginPath(); ctx.moveTo(L, Y); ctx.lineTo(L + pw, Y); ctx.stroke(); ctx.fillText(v.toFixed(ty.decimals), L - 6, Y + 4); }
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.strokeRect(L, T, pw, ph);
  ctx.fillStyle = '#222'; ctx.font = '12.5px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`x (${data.unit})`, L + pw / 2, H - 10);
  ctx.save(); ctx.translate(15, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(`y (${data.unit})`, 0, 0); ctx.restore();

  ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
  for (const s of data.series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2;
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i - 1], q = s.points[i];
      ctx.setLineDash(q.pos - p.pos > 1 ? [5, 5] : []);
      ctx.beginPath(); ctx.moveTo(mx(p.x), my(p.y)); ctx.lineTo(mx(q.x), my(q.y)); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = s.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    for (const p of s.points) { ctx.beginPath(); ctx.arc(mx(p.x), my(p.y), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  ctx.restore();
}

// ---------- overlay ----------
function render(canvas, dpr, W, H) {
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPlot(ctx, W, H, P.data);
}
function redraw() {
  if (!P.open || !P.data) return;
  const r = el.canvas.getBoundingClientRect();
  render(el.canvas, window.devicePixelRatio || 1, Math.max(200, r.width), Math.max(200, r.height));
}

/** Build the chart from the CURRENT measurements (never from an earlier, possibly stale result). */
function showChart(masses) {
  const c = P.ctx, table = c.build(masses), ser = plotSeries(table);
  if (!ser) { closePlot(); return; }                             // two-point workflow no longer valid
  const pos = new Map(c.frameOrder.map((idx, i) => [idx, i]));
  const mk = (pts) => pts.map((p) => ({ x: p.x, y: p.y, pos: pos.get(p.index) }));
  const series = [
    { label: 'Point A (red)', color: POINTS.a.css, points: mk(ser.a) },
    { label: 'Point B (blue)', color: POINTS.b.css, points: mk(ser.b) },
  ];
  if (ser.cm) series.push({ label: 'Centre of mass (green)', color: CM_CSS, points: mk(ser.cm) });
  P.data = { series, unit: ser.unit };
  el.form.hidden = true; el.chart.hidden = false; el.save.hidden = false;
  redraw();

  const notes = [];
  for (const s of series) if (s.points.length < 2) notes.push(`${s.label}: only ${s.points.length} marked frame — mark more frames to see a trajectory.`);
  if (ser.cm) {
    notes.push(`Centre of mass for the ${ser.cm.length} frame(s) that have both points, with m_red = ${fmtMass(table.masses.a)} g and m_blue = ${fmtMass(table.masses.b)} g. ` +
      'Frames with only one point have no centre of mass. Nothing is fitted: the green path comes straight from your marks.');
  } else notes.push('No masses entered, so no centre of mass is shown. Tap “Masses…” to add them.');
  notes.push('Lines join the points in time order. A dashed line means frames in between have no mark for that point (nothing is filled in).');
  notes.push(ser.unit === 'px'
    ? 'Coordinates are image pixels (origin bottom-left, y up). Set a scale in the gallery to get millimetres or metres.'
    : `Coordinates in ${ser.unit} using your scale (origin bottom-left of the picture, y up).`);
  if (c.timingOk === false) notes.push('Warning: the timing check of this recording failed, so the time order of points may be unreliable.');
  el.info.innerHTML = '';
  for (const t of notes) { const li = document.createElement('li'); li.textContent = t; el.info.append(li); }
}

function showMassForm() {
  const m = P.ctx.masses || {};
  el.ma.value = m.a ?? ''; el.mb.value = m.b ?? ''; el.err.textContent = '';
  el.form.hidden = false; el.chart.hidden = true; el.save.hidden = true;
}

/**
 * ctx = { build(masses) -> measure.buildTable result, frameOrder: [frame indices], masses, timingOk, onMasses(m) }
 * Opens with the (optional) mass question; the chart appears only after the student answers it.
 */
export function openPlot(ctx) {
  P.ctx = ctx; P.data = null;
  P.open = true; el.root.hidden = false;
  history.pushState({ plot: true }, ''); P.pushed = true;
  showMassForm();
}
function closePlot(silent) {
  if (!P.open) return;
  P.open = false; el.root.hidden = true; P.data = null;
  if (P.pushed && !silent) { P.pushed = false; history.back(); } else P.pushed = false;
}
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const num = (s) => Number(String(s).replace(',', '.').trim());
  const m = validMasses({ a: num(el.ma.value), b: num(el.mb.value) });
  if (!m || el.ma.value.trim() === '' || el.mb.value.trim() === '') {
    el.err.textContent = 'Enter two masses greater than 0 (or tap Skip).'; return;
  }
  P.ctx.masses = m; P.ctx.onMasses(m);
  showChart(m);
});
el.skip.onclick = () => {
  // emptying both fields and skipping removes stored masses; otherwise they stay stored for later
  if (P.ctx.masses && !el.ma.value.trim() && !el.mb.value.trim()) { P.ctx.masses = null; P.ctx.onMasses(null); }
  showChart(null);
};
el.masses.onclick = showMassForm;
window.addEventListener('popstate', () => { if (P.open) { P.pushed = false; closePlot(true); } });
window.addEventListener('resize', redraw);
window.addEventListener('keydown', (e) => { if (P.open && e.key === 'Escape') closePlot(); });
el.close.onclick = () => closePlot();
el.save.onclick = async () => {
  if (!P.data) return;
  const r = el.canvas.getBoundingClientRect(), W = Math.max(360, r.width), H = Math.max(360, r.height);
  const off = document.createElement('canvas');
  render(off, 3, W, H);                                          // 3× pixel ratio for a sharp picture
  const blob = await new Promise((res) => off.toBlob(res, 'image/png'));
  off.width = off.height = 0;
  if (blob) await saveBlob(blob, 'physlab_plot_yx.png', 'image/png');
};
