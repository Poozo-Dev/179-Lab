import test from 'node:test';
import assert from 'node:assert/strict';
import { screenToImage, imageToScreen, tiltFromOrientation, AngleSmoother } from '../js/geometry.js';
import { Countdown } from '../js/countdown.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('screen <-> image round trip at any zoom/pan', () => {
  for (const v of [
    { sw: 393, sh: 600, nw: 1920, nh: 1080, scale: 1, tx: 0, ty: 0 },
    { sw: 393, sh: 600, nw: 1080, nh: 1920, scale: 7.3, tx: -812, ty: 455 },
    { sw: 1200, sh: 700, nw: 1280, nh: 720, scale: 2, tx: 30, ty: -12 },
  ]) {
    for (const [ix, iy] of [[0, 0], [v.nw, v.nh], [123.25, 456.75]]) {
      const s = imageToScreen(v, ix, iy), p = screenToImage(v, s.x, s.y);
      near(p.x, ix, 1e-6); near(p.y, iy, 1e-6);
    }
  }
});

test('image centre is under the stage centre (shifted by the pan); one screen px = 1/k image px', () => {
  const v = { sw: 400, sh: 300, nw: 2000, nh: 1000, scale: 4, tx: 10, ty: -20 };   // fit = 0.2, k = 0.8
  const c = imageToScreen(v, 1000, 500);
  near(c.x, 210); near(c.y, 130);
  const p = screenToImage(v, 210 + 8, 130);
  near(p.x, 1010); near(p.y, 500);
});

test('level: upright portrait phone is level; rolling it tilts the vertical', () => {
  near(tiltFromOrientation(90, 0, 0), 0, 1e-9);
  // upright (beta 90) and slightly rolled: gamma moves physical up sideways in the picture
  const t = tiltFromOrientation(80, 10, 0);
  assert.ok(Math.abs(t) > 1 && Math.abs(t) < 15);
  assert.equal(Math.sign(tiltFromOrientation(80, 10, 0)), -Math.sign(tiltFromOrientation(80, -10, 0)));
  assert.equal(tiltFromOrientation(5, 0, 0), null);           // nearly flat: projection unreliable
  assert.equal(tiltFromOrientation(null, 0, 0), null);
});

test('level: screen rotation rotates the reported angle by the same amount', () => {
  const portrait = tiltFromOrientation(60, 25, 0);
  const landscape = tiltFromOrientation(60, 25, 90);
  let d = landscape - portrait; d = ((d + 540) % 360) - 180;
  near(Math.abs(d), 90, 1e-9);
});

test('angle smoother handles the ±180° wrap', () => {
  const s = new AngleSmoother(0.5);
  s.push(179); const v = s.push(-179);
  assert.ok(Math.abs(Math.abs(v) - 180) < 1.5);
  assert.equal(s.push(null), null);
});

function fakeTimers() {
  const q = []; let now = 0;
  return {
    setTimer: (fn, ms) => { const t = { fn, at: now + ms, on: true }; q.push(t); return t; },
    clearTimer: (t) => { t.on = false; },
    advance(ms) { now += ms; for (const t of q.filter((t) => t.on && t.at <= now).sort((a, b) => a.at - b.at)) { t.on = false; t.fn(); } },
  };
}

test('countdown: ticks, warning 1 s before the end, go at the end', () => {
  const T = fakeTimers(), log = [];
  const c = new Countdown({ ...T, onTick: (n) => log.push(n), onWarn: () => log.push('warn'), onGo: () => log.push('go') });
  c.start(3);
  assert.equal(c.state, 'counting'); assert.deepEqual(log, [3]);
  T.advance(1000); assert.deepEqual(log, [3, 2]);
  T.advance(1000); assert.deepEqual(log, [3, 2, 1, 'warn']);
  T.advance(1000); assert.deepEqual(log, [3, 2, 1, 'warn', 'go']); assert.equal(c.state, 'done');
  assert.equal(c.cancel(), false);                              // nothing to cancel once recording started
});

test('countdown: cancel stops everything; no go afterwards; can restart', () => {
  const T = fakeTimers(), log = [];
  const c = new Countdown({ ...T, onGo: () => log.push('go'), onCancel: () => log.push('cancel') });
  c.start(5); T.advance(2000);
  assert.equal(c.cancel(), true); assert.equal(c.state, 'cancelled');
  T.advance(10000); assert.deepEqual(log, ['cancel']);
  assert.equal(c.start(3), true); T.advance(3000); assert.deepEqual(log, ['cancel', 'go']);
  assert.throws(() => new Countdown(T).start(0), RangeError);
});
