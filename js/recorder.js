// recorder.js — turns the stream of timestamped frames into saved, selected images.
//
// Per camera frame:   draw into an off-screen "buffer" canvas  ->  FrameSelector decides.
// Two buffers alternate so the previous frame (still a candidate for the current target) is never
// overwritten before the decision is made. When a frame is selected its pixels are copied
// synchronously into a private snapshot canvas, encoded to JPEG and written to IndexedDB.
// Only ~2 full frames + a few snapshots are ever in memory; everything else goes to disk.

import { FrameSelector } from './timing.js';
import { CONFIG } from './config.js';
import * as store from './store.js';

const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));
const makeCanvas = (w, h) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { canvas: c, ctx: c.getContext('2d', { alpha: false }) };
};
const release = (c) => { c.width = 0; c.height = 0; };   // frees canvas memory promptly (matters on iOS)

export class Recorder {
  /** callbacks: onUpdate({elapsedMs, selected, saved}), onStopped(session, error|null) */
  constructor({ onUpdate = () => {}, onStopped = () => {} } = {}) {
    this.onUpdate = onUpdate; this.onStopped = onStopped;
    this.recording = false;
    this.stopPromise = null;
  }

  /**
   * Recording starts IMMEDIATELY (the next camera frame is t = 0), so a countdown can end exactly here.
   * Clearing the old experiment and writing the new session run in the background; every image save is
   * chained after them. Resolves when that storage preparation is done (rejects if it failed).
   * `camera` = cameraInfo() at start, `sensorTiltDeg` = level reading at start (or null).
   */
  start({ intervalMs, toleranceMs, source, camera = null, sensorTiltDeg = null, durationMs = 0 }) {
    if (this.recording) return Promise.resolve();
    this.selector = new FrameSelector({ intervalMs, maxFrames: CONFIG.maxFrames });
    this.bufs = null; this.width = this.height = null;
    this.pending = 0; this.saved = 0; this.failure = null;
    this.source = source; this.stopPromise = null; this.durationMs = durationMs;
    this.session = {
      id: Date.now(), createdAt: new Date().toISOString(), status: 'recording', stopReason: null,
      intervalMs, toleranceMs, gapFactor: CONFIG.gapFactor, durationMs,
      sourceMode: source.mode, timeSource: source.timeSource, camera, sensorTiltDeg,
      width: null, height: null, stats: null, frameCount: 0, userAgent: navigator.userAgent,
    };
    this.recording = true;
    const session = this.session;
    const ready = (async () => { await store.clearAll(); await store.setSession(session); })();
    this.chain = ready.catch((e) => this._fail(e));
    return ready;
  }

  /** Called for EVERY camera frame (also while idle, then it returns immediately). */
  feed(info) {
    if (!this.recording) return;
    if (this.width === null) {
      this.width = info.width; this.height = info.height;
      this.bufs = [makeCanvas(this.width, this.height), makeCanvas(this.width, this.height)];
      this.session.width = this.width; this.session.height = this.height;
      this.session.sourceMode = this.source.mode; this.session.timeSource = this.source.timeSource;
      this.chain = this.chain.then(() => store.setSession(this.session)).catch((e) => this._fail(e));
    } else if (info.width !== this.width || info.height !== this.height) {
      this.stop('orientation'); return;
    }
    // use the buffer that does NOT hold the selector's remembered previous frame
    const prevBuf = this.selector.prev && this.selector.prev.buf;
    const buf = prevBuf === this.bufs[0] ? this.bufs[1] : this.bufs[0];
    info.draw(buf.ctx);
    const picked = this.selector.push({ tsMs: info.tsMs, suspect: info.suspect, buf });
    for (const sel of picked) this._capture(sel);
    if (this.selector.done) { this.stop('max'); return; }
    // timer: stop once every target up to the set duration has its frame (measured camera time, not a JS timer)
    if (this.durationMs > 0 && this.selector.nextIndex * this.selector.intervalMs > this.durationMs + 1e-6) { this.stop('duration'); return; }
    this.onUpdate({ elapsedMs: this.selector.prevR, selected: this.selector.nextIndex, saved: this.saved });
  }

  _capture(sel) {
    if (this.pending >= CONFIG.maxPendingEncodes) { this.stop('overload'); return; }
    // synchronous pixel copy: from here on the image is independent of the live buffers
    const snap = makeCanvas(this.width, this.height);
    snap.ctx.drawImage(sel.frame.buf.canvas, 0, 0);
    const rec = {
      index: sel.index, targetMs: sel.targetMs, actualMs: sel.actualMs, deviationMs: sel.deviationMs,
      gapMs: sel.gapMs, duplicate: sel.duplicate, suspect: sel.suspect, width: this.width, height: this.height,
    };
    this.pending++;
    this.chain = this.chain.then(() => this._encodeAndSave(snap.canvas, rec)).catch((e) => this._fail(e));
  }

  async _encodeAndSave(canvas, rec) {
    const full = await toBlob(canvas, 'image/jpeg', CONFIG.jpegQuality);
    if (!full) throw new Error('encode failed');
    const tw = Math.min(CONFIG.thumbWidth, canvas.width);
    const th = Math.max(1, Math.round(canvas.height * tw / canvas.width));
    const t = makeCanvas(tw, th);
    t.ctx.drawImage(canvas, 0, 0, tw, th);
    const thumb = await toBlob(t.canvas, 'image/jpeg', 0.75);
    release(t.canvas); release(canvas);
    const [imgBuf, thumbBuf] = await Promise.all([full.arrayBuffer(), thumb.arrayBuffer()]);
    await store.putFrame({ ...rec, thumb: thumbBuf }, { index: rec.index, data: imgBuf });
    this.saved++; this.pending--;
    this.onUpdate({ elapsedMs: this.selector.prevR, selected: this.selector.nextIndex, saved: this.saved });
  }

  _fail(err) {
    if (!this.failure) { this.failure = err; this.stop('storage'); }
  }

  stop(reason = 'user') {
    if (this.stopPromise) return this.stopPromise;
    if (!this.recording) return Promise.resolve(this.session);
    this.recording = false;
    this.stopPromise = (async () => {
      try { await this.chain; } catch (_) {}
      const clean = reason === 'user' || reason === 'max' || reason === 'duration';
      const s = this.session;
      s.status = clean && !this.failure ? 'stopped' : 'interrupted';
      s.stopReason = this.failure ? 'storage' : reason;
      s.stats = this.selector.stats();
      s.frameCount = this.saved;
      s.endedAt = new Date().toISOString();
      let saveErr = this.failure || null;
      try { await store.setSession(s); } catch (e) { saveErr = saveErr || e; }
      if (this.bufs) for (const b of this.bufs) release(b.canvas);
      this.bufs = null;
      this.onStopped(s, saveErr);
      return s;
    })();
    return this.stopPromise;
  }
}
