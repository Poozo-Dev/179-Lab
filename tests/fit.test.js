import test from 'node:test';
import assert from 'node:assert/strict';
import { fitParabola } from '../js/fit.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b}`);

test('recovers an exact parabola (large pixel coordinates)', () => {
  const xs = [120, 340, 560, 790, 1010, 1230], f = (x) => -0.0012 * x * x + 2.1 * x + 35;
  const r = fitParabola(xs, xs.map(f));
  near(r.a, -0.0012, 1e-9, 'a'); near(r.b, 2.1, 1e-6, 'b'); near(r.c, 35, 1e-4, 'c');
  near(r.r2, 1, 1e-9); near(r.rmse, 0, 1e-6); assert.equal(r.exact, false);
});

test('works with time as x (small numbers) — free fall', () => {
  const t = [0, 0.2, 0.4, 0.6, 0.8, 1.0], y = t.map((s) => 900 - 0.5 * 700 * s * s);
  const r = fitParabola(t, y);
  near(r.a, -350, 1e-6); near(r.b, 0, 1e-6); near(r.c, 900, 1e-6);
});

test('noisy data: R² below 1 but close, fitted curve passes near the points', () => {
  const xs = [0, 100, 200, 300, 400, 500, 600], noise = [3, -4, 2, -2, 4, -3, 1];
  const ys = xs.map((x, i) => -0.002 * x * x + 1.4 * x + 10 + noise[i]);
  const r = fitParabola(xs, ys);
  assert.ok(r.r2 < 1 && r.r2 > 0.99);
  assert.ok(r.rmse > 0 && r.rmse < 5);
  near(r.at(300), -0.002 * 300 * 300 + 1.4 * 300 + 10, 5);
});

test('exactly three points: exact fit, flagged as such', () => {
  const r = fitParabola([0, 1, 2], [0, 1, 4]);
  near(r.a, 1, 1e-9); near(r.b, 0, 1e-9); near(r.c, 0, 1e-9); assert.equal(r.exact, true);
});

test('not enough / degenerate data returns null', () => {
  assert.equal(fitParabola([1, 2], [1, 2]), null);
  assert.equal(fitParabola([5, 5, 5, 5], [1, 2, 3, 4]), null);          // vertical line (free fall in y(x))
  assert.equal(fitParabola([5, 5, 7, 7], [1, 2, 3, 4]), null);          // only two distinct x
});

test('collinear points give a ≈ 0', () => {
  const r = fitParabola([0, 10, 20, 30], [5, 25, 45, 65]);
  near(r.a, 0, 1e-9); near(r.b, 2, 1e-9);
});
