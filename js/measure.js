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
  if (vert && vert.mode === 'points') angleRad = angleFromVerticalPoints(vert.p1, vert.p2) ?? 0;
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
