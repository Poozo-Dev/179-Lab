import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameSelector, RateEstimator, assessQuality, formatFrameLine, median, intervalStats, alignmentNote } from '../js/timing.js';

// helper: feed timestamps, collect selections
function run(tsList, opts = {}) {
  const sel = new FrameSelector(opts);
  const out = [];
  tsList.forEach((t, i) => out.push(...sel.push({ tsMs: t, id: i })));
  return { out, sel };
}
const regular = (n, periodMs, start = 0) => Array.from({ length: n }, (_, i) => start + i * periodMs);

test('perfect 30 fps, 200 ms interval: every 6th frame, ~0 deviation', () => {
  const { out } = run(regular(100, 1000 / 30), { intervalMs: 200 });
  assert.equal(out[0].frame.id, 0);
  assert.deepEqual(out.slice(0, 5).map(s => s.frame.id), [0, 6, 12, 18, 24]);
  for (const s of out) assert.ok(Math.abs(s.deviationMs) < 1e-6, `dev ${s.deviationMs}`);
});

test('first frame is t=0 regardless of absolute clock offset', () => {
  const a = run(regular(60, 33.3), { intervalMs: 200 }).out;
  const b = run(regular(60, 33.3, 987654321.5), { intervalMs: 200 }).out;
  assert.deepEqual(a.map(s => [s.index, s.frame.id]), b.map(s => [s.index, s.frame.id]));
  assert.equal(b[0].actualMs, 0);
});

test('non-aligned interval picks the truly nearest frame (max error = half a frame)', () => {
  const { out } = run(regular(200, 1000 / 30), { intervalMs: 250 });
  for (const s of out) assert.ok(Math.abs(s.deviationMs) <= 1000 / 30 / 2 + 1e-9);
  // 250 ms = 7.5 frames -> alternates between frame 7/8 style choices, never 'rounds' by frame count
  const t1 = out[1]; assert.ok([7, 8].includes(t1.frame.id));
});

test('timing comes from timestamps, not frame numbers (irregular cadence)', () => {
  // frames at 0, 90, 130, 205, 290, 410, 420, 600  (ms)
  const ts = [0, 90, 130, 205, 290, 410, 420, 600];
  const { out } = run(ts, { intervalMs: 200 });
  assert.deepEqual(out.map(s => s.frame.id), [0, 3, 5, 7]);     // 0, 205 (+5), 410 (+10), 600 (0)
  assert.deepEqual(out.map(s => s.deviationMs), [0, 5, 10, 0]);
});

test('tie goes to the earlier frame', () => {
  const { out } = run([0, 180, 220, 500], { intervalMs: 200 });
  assert.equal(out[1].frame.id, 1);                              // 180 vs 220 are both 20 ms away
});

test('dropped frames: large gap is reported and flagged', () => {
  const ts = [...regular(10, 33.3), ...regular(10, 33.3, 33.3 * 10 + 100)]; // 100 ms hole after frame 9
  const { out, sel } = run(ts, { intervalMs: 100 });
  const q = assessQuality(out, sel.stats(), { toleranceMs: 25 });
  assert.ok(q.perFrame.some(f => f.includes('gap')));
  assert.equal(q.ok, false);
  assert.ok(q.problems.join(' ').includes('unreliable'));
});

test('a hole spanning several targets yields duplicates, flagged not hidden', () => {
  const ts = [0, 33, 66, 99, 600, 633, 666];                  // 500 ms hole
  const { out, sel } = run(ts, { intervalMs: 100 });
  const dups = out.filter(s => s.duplicate);
  assert.ok(dups.length >= 1);
  const q = assessQuality(out, sel.stats(), { toleranceMs: 25 });
  assert.equal(q.ok, false);
  assert.ok(q.perFrame.some(f => f.includes('duplicate')));
  assert.ok(q.perFrame.some(f => f.includes('deviation')));
});

test('good recording passes quality check', () => {
  const jitter = regular(150, 33.333).map((t, i) => t + ((i * 7) % 5) - 2); // ±2 ms jitter
  const { out, sel } = run(jitter, { intervalMs: 200 });
  const q = assessQuality(out, sel.stats(), { toleranceMs: 25 });
  assert.equal(q.ok, true, q.problems.join('; '));
  assert.equal(q.badCount, 0);
});

test('tolerance is configurable', () => {
  const ts = regular(100, 1000 / 30);
  const { out, sel } = run(ts, { intervalMs: 250 });           // up to ±16.7 ms error
  assert.equal(assessQuality(out, sel.stats(), { toleranceMs: 25 }).ok, true);
  assert.equal(assessQuality(out, sel.stats(), { toleranceMs: 5 }).ok, false);
});

test('non-increasing timestamps are ignored and reported', () => {
  const { out, sel } = run([0, 33, 33, 20, 66, 100, 133, 166, 200, 233], { intervalMs: 100 });
  assert.equal(sel.stats().nonMonotonic, 2);
  assert.ok(out.every(s => Number.isFinite(s.actualMs)));
  assert.equal(assessQuality(out, sel.stats()).ok, false);
});

test('NaN timestamps are rejected', () => {
  const sel = new FrameSelector({ intervalMs: 100 });
  assert.deepEqual(sel.push({ tsMs: NaN }), []);
  assert.equal(sel.stats().nonMonotonic, 1);
});

test('suspect frames (late callback) are flagged', () => {
  const sel = new FrameSelector({ intervalMs: 100 });
  const out = [];
  for (let i = 0; i < 12; i++) out.push(...sel.push({ tsMs: i * 33.3, suspect: i === 3 }));
  const q = assessQuality(out, sel.stats());
  assert.ok(q.perFrame.flat().includes('suspect'));
  assert.equal(q.ok, false);
});

test('maxFrames stops selection', () => {
  const { out, sel } = run(regular(500, 33.3), { intervalMs: 100, maxFrames: 5 });
  assert.equal(out.length, 5);
  assert.equal(sel.done, true);
});

test('only one previous frame is retained (constant memory)', () => {
  const sel = new FrameSelector({ intervalMs: 200 });
  for (let i = 0; i < 1000; i++) sel.push({ tsMs: i * 33.3 });
  assert.ok(sel.prev && !('history' in sel));
});

test('slow camera is reported against tolerance', () => {
  const { out, sel } = run(regular(40, 100), { intervalMs: 200 });   // 10 fps
  const q = assessQuality(out, sel.stats(), { toleranceMs: 25 });
  assert.equal(q.ok, false);
  assert.ok(q.problems.join(' ').includes('too slow'));
});

test('formatFrameLine matches the specified layout', () => {
  assert.equal(formatFrameLine({ index: 3, targetMs: 600, actualMs: 603, deviationMs: 3 }),
    'Frame 4 | Target: 0.600 s | Actual: 0.603 s | Deviation: +3 ms');
  assert.ok(formatFrameLine({ index: 0, targetMs: 0, actualMs: 0, deviationMs: -4.2 }).endsWith('−4 ms'));
});

test('RateEstimator and median', () => {
  const r = new RateEstimator();
  regular(40, 20).forEach(t => r.push(t));
  assert.equal(Math.round(r.fps), 50);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('interval stats: dropped camera frames and jitter are counted', () => {
  const iv = [33.3, 33.4, 33.3, 66.7, 33.3, 100, 33.3, 33.4];       // one gap of 2 periods, one of 3
  const s = intervalStats(iv);
  assert.equal(s.droppedFrames, 3);
  assert.equal(s.unstableShare, 0);
  assert.ok(intervalStats([33, 45, 20, 33, 33]).unstableShare > 0.3);
});

test('alignment note only when the interval is not a whole number of frame periods', () => {
  assert.equal(alignmentNote(200, 1000 / 30), null);                // 6 frames
  assert.equal(alignmentNote(100, 1000 / 60), null);                // 6 frames
  const n = alignmentNote(250, 1000 / 30);                          // 7.5 frames
  assert.match(n, /7\.50 camera frames/);
  assert.match(n, /0\.233 s or 0\.267 s/);
});

test('irregular frames with a dropped stretch: gap flagged, note about dropped frames', () => {
  const ts = [0, 33, 67, 100, 133, 167, 300, 333, 367, 400];          // frames 200..267 missing
  const sel = new FrameSelector({ intervalMs: 100, maxFrames: 10 });
  const out = ts.flatMap((t) => sel.push({ tsMs: t }));
  const q = assessQuality(out, sel.stats(), { toleranceMs: 25, intervalMs: 100 });
  assert.ok(q.perFrame.some((f) => f.includes('gap')));
  assert.ok(q.notes.some((n) => /dropped/.test(n)));
  assert.ok(out.every((s, i) => i === 0 || s.actualMs > out[i - 1].actualMs || s.duplicate));
});
