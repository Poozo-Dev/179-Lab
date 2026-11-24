import test from 'node:test';
import assert from 'node:assert/strict';
import { fitQuadratic, restPoint, restSource } from '../js/measure.js';

const H = 1080, g = 980;                                  // synthetic gravity in px/s²
const frames = (n, dt = 0.1) => Array.from({ length: n }, (_, i) => ({ index: i, actualMs: i * dt * 1000 }));
// picture pixels (y down) of a throw: launch at (x0, yUp0) with speeds vx, vy (y up)
const throwAt = (t, { x0 = 500, y0 = 300, vx = 0, vy = 400 } = {}) => ({ t, x: x0 + vx * t, y: H - (y0 + vy * t - 0.5 * g * t * t) });
let seed = 7; const noise = (a) => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2 * a; };

test('quadratic fit recovers coefficients', () => {
  const ts = [0, 0.1, 0.2, 0.3, 0.4];
  const f = fitQuadratic(ts, ts.map((t) => 3 * t * t - 2 * t + 1));
  assert.ok(Math.abs(f.a - 3) < 1e-9 && Math.abs(f.b + 2) < 1e-9 && Math.abs(f.c - 1) < 1e-9 && f.rms < 1e-9);
  assert.equal(fitQuadratic([0, 0, 0.1], [1, 2, 3]), null);
});

test('vertical throw: v = 0 found at the top, between frames', () => {
  const s = frames(9).map((f) => throwAt(f.actualMs / 1000));
  const r = restPoint(s);
  const tTop = 400 / g;                                  // 0.408 s, between the frames at 0.4 and 0.5
  assert.ok(Math.abs(r.t - tTop) < 1e-6, r.t);
  const p = throwAt(tTop);
  assert.ok(Math.abs(r.x - p.x) < 1e-6 && Math.abs(r.y - p.y) < 1e-6);
  assert.equal(r.still, true); assert.equal(r.inside, true);
});

test('drop released between frames: start point found (extrapolated slightly before the first marked frame)', () => {
  // released from rest at t = -0.03 s; marks start at 0
  const s = frames(7).map((f) => { const t = f.actualMs / 1000, u = t + 0.03; return { t, x: 400, y: H - (900 - 0.5 * g * u * u) }; });
  const r = restPoint(s, { margin: 0.1 });
  assert.ok(Math.abs(r.t + 0.03) < 1e-6 && r.still && r.inside);
  assert.ok(Math.abs(r.y - (H - 900)) < 1e-6);
});

test('robust to marking noise (±1.5 px)', () => {
  const s = frames(9).map((f) => { const p = throwAt(f.actualMs / 1000); return { t: p.t, x: p.x + noise(1.5), y: p.y + noise(1.5) }; });
  const r = restPoint(s);
  assert.ok(r && Math.abs(r.t - 400 / g) < 0.01, JSON.stringify(r));
});

test('sideways throw: top of the arc, but v is not 0 there', () => {
  const r = restPoint(frames(9).map((f) => throwAt(f.actualMs / 1000, { vx: 300 })));
  assert.ok(Math.abs(r.t - 400 / g) < 1e-6);
  assert.equal(r.still, false);
});

test('no point for non-parabolic or uniform motion, or too few marks', () => {
  const circle = frames(11).map((f) => { const t = f.actualMs / 1000; return { t, x: 500 + 200 * Math.sin(2 * Math.PI * t), y: 500 + 200 * Math.cos(2 * Math.PI * t) }; });
  assert.equal(restPoint(circle), null);
  assert.equal(restPoint(frames(6).map((f) => ({ t: f.actualMs / 1000, x: 100 + 300 * f.actualMs / 1000, y: 500 }))), null);
  assert.equal(restPoint(frames(2).map((f) => throwAt(f.actualMs / 1000))), null);
});

test('source: single colour, or centre of mass only with masses (never the rod ends)', () => {
  const fr = frames(4);
  const single = {}; fr.forEach((f) => { single[f.index] = { b: { x: 1, y: f.index } }; });
  assert.equal(restSource(fr, single, null).key, 'b');
  const two = {}; fr.forEach((f) => { two[f.index] = { a: { x: 0, y: f.index }, b: { x: 10, y: f.index } }; });
  assert.equal(restSource(fr, two, null), null);
  const cm = restSource(fr, two, { a: 1, b: 1 });
  assert.equal(cm.key, 'cm'); assert.equal(cm.samples[0].x, 5);
});
