// timing.js — pure logic, no DOM, no camera. Everything that decides WHICH frame is kept
// and WHETHER the timing is trustworthy lives here, so it can be unit-tested in Node.
//
// Model: the camera delivers frames, each with a timestamp `tsMs` (ms, any monotonic clock).
// The first frame after Start defines t0. Target times are t0 + k*interval.
// For every target we keep the frame whose *measured* timestamp is nearest to it.
// Frame numbers / nominal FPS are never used to compute time.

export const DEFAULTS = Object.freeze({
  intervalMs: 200,     // sampling interval between kept frames
  toleranceMs: 25,     // max allowed |actual - target| before a frame is flagged
  gapFactor: 1.5,      // flag if bracketing frames are > gapFactor * median frame interval apart
  maxFrames: 100,      // hard cap on kept frames (memory / storage protection)
});

export function median(values) {
  if (!values.length) return NaN;
  const a = [...values].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Streaming nearest-frame selector.
 *
 * push(frame) where frame = { tsMs:number, suspect?:boolean, ...anything }.
 * Returns an array of selections that became final with this frame (usually 0 or 1).
 *
 * A target T_k can only be decided once a frame at/after T_k has arrived, because the
 * nearest frame is either the last one before T_k ("prev") or the first one at/after it ("cur").
 * We therefore only ever hold ONE earlier frame (prev) — memory stays constant.
 *
 * IMPORTANT for callers: `selection.frame` is `prev` or `cur`. The pixels of that frame must be
 * copied synchronously inside the push() return handling, and the caller must not recycle
 * the pixel buffer of `prev` before push() returns (use two alternating buffers).
 */
export class FrameSelector {
  constructor({ intervalMs = DEFAULTS.intervalMs, maxFrames = DEFAULTS.maxFrames } = {}) {
    if (!(intervalMs > 0)) throw new RangeError('intervalMs must be > 0');
    this.intervalMs = intervalMs;
    this.maxFrames = maxFrames;
    this.t0 = null;
    this.prev = null;
    this.prevR = 0;
    this.nextIndex = 0;
    this.lastChosen = null;
    this.frameIntervals = [];   // every observed camera frame-to-frame interval (ms)
    this.nonMonotonic = 0;      // frames ignored because their timestamp did not advance
    this.framesSeen = 0;
  }

  get done() { return this.nextIndex >= this.maxFrames; }

  push(frame) {
    const out = [];
    if (this.done) return out;
    if (!Number.isFinite(frame.tsMs)) { this.nonMonotonic++; return out; }

    if (this.t0 === null) {                       // first frame = time zero
      this.t0 = frame.tsMs;
      this.framesSeen = 1;
      out.push(this._emit(frame, 0, 0, 0));
      this.prev = frame; this.prevR = 0; this.nextIndex = 1;
      return out;
    }

    const r = frame.tsMs - this.t0;               // time of this frame relative to start
    if (!(r > this.prevR)) { this.nonMonotonic++; return out; }  // clock went backwards / repeated
    this.framesSeen++;
    this.frameIntervals.push(r - this.prevR);
    const gap = r - this.prevR;

    while (this.nextIndex < this.maxFrames && this.nextIndex * this.intervalMs <= r) {
      const target = this.nextIndex * this.intervalMs;
      const useCur = (r - target) < (target - this.prevR);   // strictly nearer; tie -> earlier frame
      const chosen = useCur ? frame : this.prev;
      out.push(this._emit(chosen, target, useCur ? r : this.prevR, gap));
      this.nextIndex++;
    }
    this.prev = frame; this.prevR = r;
    return out;
  }

  _emit(frame, targetMs, actualMs, gapMs) {
    const sel = {
      index: this.nextIndex,
      targetMs,
      actualMs,
      deviationMs: actualMs - targetMs,
      gapMs,
      duplicate: this.lastChosen === frame,       // same camera frame already used for an earlier target
      suspect: !!frame.suspect,                   // source says pixel/timestamp pairing is doubtful
      frame,
    };
    this.lastChosen = frame;
    return sel;
  }

  stats() {
    return { framesSeen: this.framesSeen, ...intervalStats(this.frameIntervals), nonMonotonic: this.nonMonotonic };
  }
}

/**
 * Camera frame-interval statistics. `droppedFrames` estimates how many camera frames are missing: an
 * interval of about n median periods (n >= 2) means n-1 frames were not delivered. `unstable` is the share
 * of intervals more than 25 % away from the median (jitter that is not a whole dropped frame).
 */
export function intervalStats(iv) {
  const med = median(iv);
  let dropped = 0, off = 0;
  if (med > 0) {
    for (const d of iv) {
      const n = Math.round(d / med);
      if (n >= 2 && d > 1.5 * med) dropped += n - 1;
      else if (Math.abs(d - med) > 0.25 * med) off++;
    }
  }
  return {
    medianIntervalMs: med,
    estimatedFps: med > 0 ? 1000 / med : NaN,
    maxIntervalMs: iv.length ? Math.max(...iv) : NaN,
    droppedFrames: dropped,
    unstableShare: iv.length ? off / iv.length : 0,
  };
}

/**
 * How well the sampling interval fits the camera's frame period. Frames only exist every `periodMs`, so a
 * target time can be missed by up to half a period; if the interval is a whole number of periods the
 * error stays (nearly) constant instead of alternating. Returns null when the fit is good.
 */
export function alignmentNote(intervalMs, periodMs) {
  if (!(periodMs > 0) || !(intervalMs > 0)) return null;
  const n = intervalMs / periodMs, frac = Math.abs(n - Math.round(n));
  if (frac < 0.1) return null;
  const lo = Math.max(1, Math.floor(n)) * periodMs, hi = Math.ceil(n) * periodMs;
  const s = (ms) => (ms / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return `The interval (${s(intervalMs)} s) is ${n.toFixed(2)} camera frames long, not a whole number, so the ` +
    `kept frames alternate between earlier and later than their target (up to ±${(periodMs / 2).toFixed(1)} ms). ` +
    `Intervals that fit this camera: ${s(lo)} s or ${s(hi)} s.`;
}

/** Running camera-rate estimate for the live preview (no selection involved). */
export class RateEstimator {
  constructor(window = 31) { this.window = window; this.last = null; this.iv = []; }
  push(tsMs) {
    if (this.last !== null && tsMs > this.last) {
      this.iv.push(tsMs - this.last);
      if (this.iv.length > this.window) this.iv.shift();
    }
    this.last = tsMs;
  }
  get medianIntervalMs() { return median(this.iv); }
  get fps() { const m = this.medianIntervalMs; return m > 0 ? 1000 / m : NaN; }
}

/**
 * Judge a finished (or stopped) recording. Pure function.
 * selections: [{index,targetMs,actualMs,deviationMs,gapMs,duplicate,suspect}]
 * Returns { ok, perFrame:[flags[]], problems:[string], notes:[string], worstDeviationMs, badCount }
 */
export function assessQuality(selections, stats, opts = {}) {
  const tol = opts.toleranceMs ?? DEFAULTS.toleranceMs;
  const gapFactor = opts.gapFactor ?? DEFAULTS.gapFactor;
  const med = stats?.medianIntervalMs;
  const perFrame = [];
  let worst = 0, bad = 0;

  for (const s of selections) {
    const flags = [];
    if (Math.abs(s.deviationMs) > tol) flags.push('deviation');
    if (med > 0 && s.gapMs > gapFactor * med) flags.push('gap');
    if (s.duplicate) flags.push('duplicate');
    if (s.suspect) flags.push('suspect');
    if (flags.length) bad++;
    worst = Math.max(worst, Math.abs(s.deviationMs));
    perFrame.push(flags);
  }

  const problems = [], notes = [];
  const n = selections.length;
  if (n < 2) problems.push('Too few frames were captured. Record again.');
  if (bad > 0) {
    problems.push(`${bad} of ${n} frames have unreliable timing (marked with a warning). ` +
      'Repeat the experiment before using these times for calculations.');
  }
  if (stats?.nonMonotonic > 0) {
    problems.push(`${stats.nonMonotonic} camera frame(s) had invalid timestamps and were ignored.`);
  }
  if (med > 0) {
    const quant = med / 2;
    notes.push(`Camera delivered about ${(1000 / med).toFixed(1)} frames/s ` +
      `(median ${med.toFixed(1)} ms between frames).`);
    if (tol < quant) {
      notes.push(`With this frame rate a timing error of up to ±${quant.toFixed(1)} ms is unavoidable; ` +
        `the tolerance (±${tol} ms) is stricter than the camera can guarantee.`);
    }
    if (med > 2 * tol) {
      problems.push('The camera is too slow (low frame rate, often in dim light) for the chosen tolerance. ' +
        'Use better lighting or a larger interval.');
    }
    const align = alignmentNote(opts.intervalMs, med);
    if (align) notes.push(align);
    if (stats.droppedFrames > 0) {
      notes.push(`About ${stats.droppedFrames} camera frame(s) were dropped during the recording ` +
        '(kept images next to a gap are marked).');
    }
    if (stats.unstableShare > 0.1) {
      notes.push(`The camera frame rate was unstable (${Math.round(stats.unstableShare * 100)} % of frame intervals ` +
        'differ by more than 25 % from the typical one). Better lighting usually helps.');
    }
  }
  return { ok: problems.length === 0, perFrame, problems, notes, worstDeviationMs: worst, badCount: bad };
}

const sec = (ms) => (ms / 1000).toFixed(3);
export function formatSigned(ms) { const r = Math.round(ms); return (r >= 0 ? '+' : '−') + Math.abs(r) + ' ms'; }
/** "Frame 4 | Target: 0.600 s | Actual: 0.603 s | Deviation: +3 ms"  (frame numbers are 1-based) */
export function formatFrameLine(s) {
  return `Frame ${s.index + 1} | Target: ${sec(s.targetMs)} s | Actual: ${sec(s.actualMs)} s | Deviation: ${formatSigned(s.deviationMs)}`;
}
export { sec as formatSeconds };
