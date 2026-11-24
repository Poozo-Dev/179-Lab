// measure.js — pure measurement logic, no DOM. Everything that decides WHAT the student may do with
// their marks (single-point vs two-point workflow), coordinate conversion, centre of mass, tables and CSV.
//
// Marks are stored per frame in pixels of the SAVED image (origin top-left, y down), never converted:
//   marks = { [frameIndex]: { a?: {x, y}, b?: {x, y} } }      a = red point A, b = blue point B
// Everything derived (calibrated coordinates, centre of mass, tables) is recomputed from these raw marks
// whenever anything changes, so no stale derived value can survive an edit.

export const POINTS = Object.freeze({
  a: { key: 'a', name: 'Point A', color: 'red', css: '#ff2d2d' },
  b: { key: 'b', name: 'Point B', color: 'blue', css: '#2f7bff' },
});
export const CM_CSS = '#16c060';

const isPt = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Accepts the current format and the old single-mark format ({x, y} per frame = red point). */
export function normalizeMarks(raw, validIndices) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    const idx = Number(k);
    if (validIndices && !validIndices.has(idx)) continue;
    const m = isPt(v) ? { a: { x: v.x, y: v.y } } : {};
    if (!isPt(v) && v) { if (isPt(v.a)) m.a = { x: v.a.x, y: v.a.y }; if (isPt(v.b)) m.b = { x: v.b.x, y: v.b.y }; }
    if (m.a || m.b) out[idx] = m;
  }
  return out;
}

/**
 * Which workflow the marks allow. Decided from the marks only; the student never picks a mode.
 *   'none'     nothing marked
 *   'single'   only one colour anywhere (A only, or B only): t, x, y table; no plot, no masses, no CM
 *   'unpaired' both colours exist but never on the same frame: two columns, still no plot/masses/CM
 *   'two'      at least one frame has BOTH points: Plot Y(X), optional masses, CM
 */
export function analyzeMarks(frames, marks) {
  let nA = 0, nB = 0, paired = 0;
  for (const f of frames) {
    const m = marks[f.index]; if (!m) continue;
    if (m.a) nA++;
    if (m.b) nB++;
    if (m.a && m.b) paired++;
  }
  let mode = 'none';
  if (paired > 0) mode = 'two';
  else if (nA && nB) mode = 'unpaired';
  else if (nA || nB) mode = 'single';
  return { mode, nA, nB, paired, single: mode === 'single' ? (nA ? 'a' : 'b') : null, canPlot: mode === 'two' };
}

/** Masses are valid only if both are finite and strictly positive (only their ratio matters). */
export function validMasses(masses) {
  if (!masses) return null;
  const a = Number(masses.a), b = Number(masses.b);
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 ? { a, b } : null;
}

export function centerOfMass(pa, pb, masses) {
  const m = validMasses(masses);
  if (!m || !isPt(pa) || !isPt(pb)) return null;
  const M = m.a + m.b;
  return { x: (m.a * pa.x + m.b * pb.x) / M, y: (m.a * pa.y + m.b * pb.y) / M };
}

// ---------------- coordinate system ----------------
// Measurement axes: origin at the BOTTOM-LEFT corner of the picture, x to the right, y up.
// If a vertical reference is set, the axes are rotated by `angleRad` so that +y points along the physical
// "up" (the photo itself is never rotated). angleRad = how far physical up leans to the RIGHT of the
// picture's own up direction. If a scale is set, pixels are multiplied by `scale` (unit per pixel).

/** Physical-up direction from two picture points on a vertical reference (plumb line, door frame). */
export function angleFromVerticalPoints(p1, p2) {
  if (!isPt(p1) || !isPt(p2)) return null;
  // y-up picture coordinates; take the direction from the lower to the upper point
  let dx = p2.x - p1.x, dy = p1.y - p2.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  if (dy < 0) { dx = -dx; dy = -dy; }
  return Math.atan2(dx, dy);
}

/** Scale (unit per pixel) from two points a known distance apart. Rotation does not change distances. */
export function scaleFromPoints(p1, p2, distance) {
  if (!isPt(p1) || !isPt(p2) || !(distance > 0)) return null;
  const px = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  return px > 1e-9 ? distance / px : null;
}

/** Resolve the stored setup into numbers. setup = { cal?: {p1,p2,distance,unit}, vert?: {mode,p1,p2,angleDeg} } */
export function coordSystem(setup, imageHeight) {
  const cal = setup && setup.cal;
  const scale = cal ? scaleFromPoints(cal.p1, cal.p2, cal.distance) : null;
  const vert = setup && setup.vert;
  let angleRad = 0;
  if (vert && vert.mode === 'points') { const a = angleFromVerticalPoints(vert.p1, vert.p2); angleRad = a !== null ? a : 0; }
  else if (vert && vert.mode === 'sensor' && Number.isFinite(vert.angleDeg)) angleRad = vert.angleDeg * Math.PI / 180;
  return { H: imageHeight, scale, unit: scale ? cal.unit : 'px', angleRad };
}

/** Saved-image pixel (y down) -> measurement coordinates. Full precision, nothing rounded. */
export function toWorld(p, cs) {
  const u = p.x, v = cs.H - p.y;                       // y up, origin bottom-left
  const c = Math.cos(cs.angleRad), s = Math.sin(cs.angleRad);
  const k = cs.scale || 1;
  return { x: (u * c - v * s) * k, y: (u * s + v * c) * k };
}

// ---------------- tables / series ----------------
/**
 * Rows in frame order. Missing values are null (never 0). The CM is present only in 'two' mode, only with
 * valid masses, and only on frames that have BOTH points; it is computed in picture pixels and then
 * converted like any other point (the conversion is linear, so this equals converting first).
 */
export function buildTable(frames, marks, cs, masses) {
  const info = analyzeMarks(frames, marks);
  const m = info.mode === 'two' ? validMasses(masses) : null;
  const rows = [];
  for (const f of frames) {
    const mk = marks[f.index] || {};
    if (!mk.a && !mk.b) continue;
    const w = (p) => (p ? toWorld(p, cs) : null);
    const cmPx = m ? centerOfMass(mk.a, mk.b, m) : null;
    rows.push({ index: f.index, t: f.actualMs / 1000, targetMs: f.targetMs, deviationMs: f.deviationMs,
      a: w(mk.a), b: w(mk.b), cm: w(cmPx) });
  }
  let columns;
  if (info.mode === 'single') columns = ['t', info.single + '.x', info.single + '.y'];
  else if (info.mode === 'none') columns = [];
  else columns = ['t', 'a.x', 'a.y', 'b.x', 'b.y', ...(m ? ['cm.x', 'cm.y'] : [])];
  return { mode: info.mode, info, columns, rows, unit: cs.unit, masses: m };
}

/** Chronological trajectories for Plot Y(X). null unless the 'two' workflow is active. */
export function plotSeries(table) {
  if (table.mode !== 'two') return null;
  const pick = (k) => table.rows.filter((r) => r[k]).map((r) => ({ t: r.t, index: r.index, x: r[k].x, y: r[k].y }));
  return { a: pick('a'), b: pick('b'), cm: table.masses ? pick('cm') : null, unit: table.unit };
}

const HEAD = { t: 't (s)', 'a.x': 'x_red', 'a.y': 'y_red', 'b.x': 'x_blue', 'b.y': 'y_blue', 'cm.x': 'x_cm', 'cm.y': 'y_cm' };
export function columnLabel(col, unit, single) {
  if (col === 't') return HEAD.t;
  if (single && col.endsWith('.x')) return `x (${unit})`;
  if (single && col.endsWith('.y')) return `y (${unit})`;
  return `${HEAD[col]} (${unit})`;
}
export function cellValue(row, col) {
  if (col === 't') return row.t;
  const [k, axis] = col.split('.');
  return row[k] ? row[k][axis] : null;
}

/** CSV text (comma separated, '.' decimals). Missing values are empty cells. */
export function toCsv(table, { frameTimes = true } = {}) {
  const single = table.mode === 'single';
  const cols = table.columns;
  const head = ['frame', ...cols.map((c) => columnLabel(c, table.unit, single))];
  if (frameTimes) head.push('target (s)', 'deviation (ms)');
  const lines = [head.join(',')];
  for (const r of table.rows) {
    const cells = [r.index + 1, ...cols.map((c) => { const v = cellValue(r, c); return v === null ? '' : String(v); })];
    if (frameTimes) cells.push(r.targetMs / 1000, r.deviationMs);
    lines.push(cells.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------------- automatic v = 0 point (hidden parabola fit) ----------------
// Under gravity alone x(t) and y(t) are quadratic in t. Both are fitted (least squares, never shown) and the
// moment of LOWEST SPEED is found: |v|² = (2·ax·t + bx)² + (2·ay·t + by)² is quadratic in t, so the minimum is
// exact. For a drop or a vertical throw that speed is 0 (release / top point); for a sideways throw it is the
// top of the arc, where only the vertical speed is 0 — `still` says which. Speed does not depend on rotating or
// scaling the axes, so the result is the same in pixels, millimetres or a rotated coordinate system.

function solve3(M, v) {                 // Gaussian elimination with partial pivoting; null if singular
  const A = M.map((row, i) => [...row, v[i]]);
  for (let col = 0; col < 3; col++) {
    let p = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(A[r][col]) > Math.abs(A[p][col])) p = r;
    if (Math.abs(A[p][col]) < 1e-12) return null;
    [A[col], A[p]] = [A[p], A[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 4; k++) A[r][k] -= f * A[col][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = A[r][3];
    for (let k = r + 1; k < 3; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/** Least-squares v = a·t² + b·t + c (t centred and scaled internally). null if < 3 different times. */
export function fitQuadratic(ts, vs) {
  const n = ts.length;
  if (n < 3 || vs.length !== n) return null;
  const m = ts.reduce((s, t) => s + t, 0) / n;
  const sc = Math.max(...ts.map((t) => Math.abs(t - m)));
  if (!(sc > 1e-9)) return null;
  const u = ts.map((t) => (t - m) / sc);
  if (new Set(u.map((q) => Math.round(q * 1e6))).size < 3) return null;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < n; i++) {
    const q = u[i], y = vs[i];
    s1 += q; s2 += q * q; s3 += q ** 3; s4 += q ** 4; t0 += y; t1 += q * y; t2 += q * q * y;
  }
  const sol = solve3([[s4, s3, s2], [s3, s2, s1], [s2, s1, n]], [t2, t1, t0]);
  if (!sol) return null;
  const [A, B, C] = sol;
  const a = A / (sc * sc), b = B / sc - 2 * A * m / (sc * sc), c = C - B * m / sc + A * m * m / (sc * sc);
  const at = (t) => (a * t + b) * t + c;
  const rms = Math.sqrt(vs.reduce((s, v, i) => s + (v - at(ts[i])) ** 2, 0) / n);
  return { a, b, c, rms, at };
}

/**
 * samples: [{t (s), x, y}] in picture pixels, any order. Returns null when no meaningful point exists:
 * fewer than `minPoints`, a path that is not parabolic (fit error > maxRelRms of the path size, e.g. a
 * pendulum or a rod end), or (almost) no acceleration. Otherwise { t, x, y, still, inside }:
 *   still  — the lowest speed is ≈ 0 (below stillRatio of the fastest marked speed): a true v = 0 point
 *   inside — t lies within the recording, extended by `margin` seconds at both ends
 */
export function restPoint(samples, { minPoints = 3, maxRelRms = 0.03, stillRatio = 0.15, margin = 0 } = {}) {
  if (!samples || samples.length < minPoints) return null;
  const s = [...samples].sort((p, q) => p.t - q.t), ts = s.map((p) => p.t);
  const fx = fitQuadratic(ts, s.map((p) => p.x)), fy = fitQuadratic(ts, s.map((p) => p.y));
  if (!fx || !fy) return null;
  const ext = Math.max(Math.max(...s.map((p) => p.x)) - Math.min(...s.map((p) => p.x)),
    Math.max(...s.map((p) => p.y)) - Math.min(...s.map((p) => p.y)));
  if (!(ext > 0) || Math.max(fx.rms, fy.rms) > maxRelRms * ext) return null;
  const T = ts[ts.length - 1] - ts[0], A = fx.a * fx.a + fy.a * fy.a;
  if (!(Math.sqrt(A) * T * T / 2 > 0.02 * ext)) return null;          // practically uniform motion: no turning point
  const t = -(fx.a * fx.b + fy.a * fy.b) / (2 * A);
  const speed = (u) => Math.hypot(2 * fx.a * u + fx.b, 2 * fy.a * u + fy.b);
  const vmax = Math.max(...ts.map(speed));
  return { t, x: fx.at(t), y: fy.at(t), still: speed(t) <= stillRatio * vmax,
    inside: t >= ts[0] - margin && t <= ts[ts.length - 1] + margin };
}

/** Which marked path is a free projectile: the single colour, or the centre of mass (two points + masses). */
export function restSource(frames, marks, masses) {
  const info = analyzeMarks(frames, marks), m = validMasses(masses);
  const out = [];
  for (const f of frames) {
    const mk = marks[f.index]; if (!mk) continue;
    const p = info.mode === 'single' ? mk[info.single] : info.mode === 'two' && m ? centerOfMass(mk.a, mk.b, m) : null;
    if (p) out.push({ t: f.actualMs / 1000, x: p.x, y: p.y });
  }
  if (info.mode === 'single') return { key: info.single, samples: out };
  if (info.mode === 'two' && m) return { key: 'cm', samples: out };
  return null;
}
