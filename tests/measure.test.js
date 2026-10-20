import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMarks, analyzeMarks, validMasses, centerOfMass, coordSystem, toWorld, angleFromVerticalPoints,
  scaleFromPoints, buildTable, plotSeries, toCsv } from '../js/measure.js';

const frames = (n) => Array.from({ length: n }, (_, i) => ({ index: i, actualMs: i * 200 + 1, targetMs: i * 200, deviationMs: 1 }));
const H = 1000;
const csPx = coordSystem({}, H);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('old single-mark format becomes Point A; invalid / deleted frames dropped', () => {
  const m = normalizeMarks({ 0: { x: 1, y: 2 }, 1: { b: { x: 3, y: 4 } }, 5: { a: { x: 0, y: 0 } }, 2: {} }, new Set([0, 1, 2]));
  assert.deepEqual(m, { 0: { a: { x: 1, y: 2 } }, 1: { b: { x: 3, y: 4 } } });
});

test('only red marked -> single-point mode: no plot, t/x/y table, no CM even with masses', () => {
  const f = frames(3), marks = { 0: { a: { x: 10, y: 990 } }, 2: { a: { x: 30, y: 970 } } };
  const info = analyzeMarks(f, marks);
  assert.equal(info.mode, 'single'); assert.equal(info.single, 'a'); assert.equal(info.canPlot, false);
  const t = buildTable(f, marks, csPx, { a: 1, b: 2 });
  assert.deepEqual(t.columns, ['t', 'a.x', 'a.y']);
  assert.equal(t.masses, null);
  assert.ok(t.rows.every((r) => r.cm === null));
  assert.equal(plotSeries(t), null);
  assert.deepEqual(t.rows.map((r) => [r.a.x, r.a.y]), [[10, 10], [30, 30]]);   // y measured up from the bottom
});

test('only blue marked -> single-point mode as well', () => {
  const f = frames(2), marks = { 1: { b: { x: 5, y: 5 } } };
  const t = buildTable(f, marks, csPx, { a: 1, b: 1 });
  assert.equal(t.mode, 'single'); assert.deepEqual(t.columns, ['t', 'b.x', 'b.y']); assert.equal(plotSeries(t), null);
});

test('both colours on DIFFERENT frames only -> not the two-point workflow', () => {
  const f = frames(2), marks = { 0: { a: { x: 1, y: 1 } }, 1: { b: { x: 2, y: 2 } } };
  const info = analyzeMarks(f, marks);
  assert.equal(info.mode, 'unpaired'); assert.equal(info.canPlot, false);
  const t = buildTable(f, marks, csPx, { a: 1, b: 1 });
  assert.equal(t.masses, null); assert.ok(!t.columns.includes('cm.x')); assert.equal(plotSeries(t), null);
});

test('paired frame enables plotting; CM only on frames with both points', () => {
  const f = frames(3);
  const marks = { 0: { a: { x: 0, y: 1000 }, b: { x: 30, y: 1000 } }, 1: { a: { x: 10, y: 990 } }, 2: { b: { x: 50, y: 900 } } };
  const info = analyzeMarks(f, marks);
  assert.equal(info.mode, 'two'); assert.equal(info.paired, 1); assert.ok(info.canPlot);
  const t = buildTable(f, marks, csPx, { a: 2, b: 1 });
  assert.deepEqual(t.columns, ['t', 'a.x', 'a.y', 'b.x', 'b.y', 'cm.x', 'cm.y']);
  near(t.rows[0].cm.x, 10); near(t.rows[0].cm.y, 0);           // (2*0 + 1*30)/3
  assert.equal(t.rows[1].cm, null); assert.equal(t.rows[1].b, null);   // missing stays missing
  const s = plotSeries(t);
  assert.equal(s.a.length, 2); assert.equal(s.b.length, 2); assert.equal(s.cm.length, 1);
});

test('two-point without masses: trajectories but no CM', () => {
  const f = frames(1), marks = { 0: { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } } };
  const t = buildTable(f, marks, csPx, null);
  assert.ok(!t.columns.includes('cm.x')); assert.equal(plotSeries(t).cm, null);
});

test('removing the paired annotation returns to single mode and drops derived CM', () => {
  const f = frames(2);
  const marks = { 0: { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }, 1: { a: { x: 1, y: 0 } } };
  assert.equal(buildTable(f, marks, csPx, { a: 1, b: 1 }).rows[0].cm.x, 1);
  delete marks[0].b;
  const t = buildTable(f, marks, csPx, { a: 1, b: 1 });
  assert.equal(t.mode, 'single'); assert.ok(t.rows.every((r) => r.cm === null)); assert.equal(plotSeries(t), null);
});

test('mass validation: strictly positive finite numbers only', () => {
  assert.deepEqual(validMasses({ a: 5, b: '2.5' }), { a: 5, b: 2.5 });
  for (const m of [null, { a: 0, b: 1 }, { a: -1, b: 1 }, { a: 1 }, { a: NaN, b: 1 }, { a: Infinity, b: 1 }]) assert.equal(validMasses(m), null);
  assert.equal(centerOfMass({ x: 0, y: 0 }, null, { a: 1, b: 1 }), null);
});

test('CM formula and recalculation when a point or a mass changes', () => {
  const pa = { x: 0, y: 0 }, pb = { x: 10, y: 20 };
  assert.deepEqual(centerOfMass(pa, pb, { a: 1, b: 1 }), { x: 5, y: 10 });
  assert.deepEqual(centerOfMass(pa, pb, { a: 3, b: 1 }), { x: 2.5, y: 5 });
  pb.x = 20;
  assert.deepEqual(centerOfMass(pa, pb, { a: 3, b: 1 }), { x: 5, y: 5 });
});

test('calibration from two points; distances independent of direction', () => {
  near(scaleFromPoints({ x: 0, y: 0 }, { x: 300, y: 400 }, 250), 0.5);   // 500 px = 250 mm
  assert.equal(scaleFromPoints({ x: 1, y: 1 }, { x: 1, y: 1 }, 10), null);
  assert.equal(scaleFromPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, 0), null);
  const cs = coordSystem({ cal: { p1: { x: 0, y: 0 }, p2: { x: 0, y: 200 }, distance: 100, unit: 'mm' } }, H);
  assert.equal(cs.unit, 'mm');
  const w = toWorld({ x: 40, y: 1000 - 60 }, cs);
  near(w.x, 20); near(w.y, 30);
});

test('vertical reference rotates the axes, not the picture; raw pixels unchanged', () => {
  // a plumb line leaning 10° to the right in the picture
  const a = 10 * Math.PI / 180, p1 = { x: 100, y: 900 }, p2 = { x: 100 + 400 * Math.sin(a), y: 900 - 400 * Math.cos(a) };
  near(angleFromVerticalPoints(p1, p2), a, 1e-12);
  near(angleFromVerticalPoints(p2, p1), a, 1e-12);                     // order of the two points does not matter
  const cs = coordSystem({ vert: { mode: 'points', p1, p2 } }, H);
  const w1 = toWorld(p1, cs), w2 = toWorld(p2, cs);
  near(w2.x - w1.x, 0, 1e-9); near(w2.y - w1.y, 400, 1e-9);           // the reference is exactly vertical now
  assert.deepEqual(p1, { x: 100, y: 900 });
  const sens = coordSystem({ vert: { mode: 'sensor', angleDeg: 10 } }, H);
  near(sens.angleRad, a, 1e-12);
});

test('CSV: single-point has t,x,y only; missing values are empty, not zero', () => {
  const f = frames(2);
  const single = toCsv(buildTable(f, { 1: { a: { x: 1.5, y: 1000 } } }, csPx, { a: 1, b: 1 }));
  const [h, r] = single.trim().split('\r\n');
  assert.equal(h, 'frame,t (s),x (px),y (px),target (s),deviation (ms)');
  assert.equal(r, '2,0.201,1.5,0,0.2,1');
  const two = toCsv(buildTable(f, { 0: { a: { x: 0, y: 1000 }, b: { x: 2, y: 1000 } }, 1: { a: { x: 1, y: 1000 } } }, csPx, { a: 1, b: 1 }));
  const lines = two.trim().split('\r\n');
  assert.equal(lines[0], 'frame,t (s),x_red (px),y_red (px),x_blue (px),y_blue (px),x_cm (px),y_cm (px),target (s),deviation (ms)');
  assert.equal(lines[1], '1,0.001,0,0,2,0,1,0,0,1');
  assert.equal(lines[2], '2,0.201,1,0,,,,,0.2,1');
});
