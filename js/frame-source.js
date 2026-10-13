// frame-source.js — camera access + delivery of frames WITH timestamps.
//
// Two interchangeable sources, both call  onFrame({ tsMs, width, height, suspect, draw(ctx) }):
//
//  1. "processor" (preferred): MediaStreamTrackProcessor yields VideoFrame objects. The timestamp
//     and the pixels are the SAME object, so they cannot get out of sync. Chrome/Android.
//
//  2. "rvfc" (fallback, e.g. Safari): HTMLVideoElement.requestVideoFrameCallback gives metadata
//     about the frame that was just presented; we then copy the video element into a canvas.
//     Risk: if the callback runs late, the element may already show a newer frame than the metadata
//     describes. We cannot detect that directly, so late callbacks are marked `suspect`
//     and the quality check turns them into a visible warning.
//
// `draw(ctx)` must be called synchronously inside onFrame (the VideoFrame is closed afterwards).
// Timestamps are browser/capture-pipeline times, NOT sensor exposure times (see README).

import { CONFIG } from './config.js';

export class CameraError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function toCameraError(e) {
  if (e instanceof CameraError) return e;
  switch (e && e.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera permission was denied. Allow camera access for this site in the browser settings, then tap "Try again".');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('none', 'No camera was found on this device.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('busy', 'The camera could not be started. Close other apps that use the camera and tap "Try again".');
    default:
      return new CameraError('unknown', 'The camera could not be started. Tap "Try again".');
  }
}

export async function openCamera() {
  if (!window.isSecureContext) {
    throw new CameraError('insecure', 'The camera only works on a secure (https://) address.');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new CameraError('unsupported', 'This browser cannot use the camera. Use Safari on iPhone or Chrome on Android.');
  }
  const v = CONFIG.video;
  const attempts = [   // from most to least specific; rear camera preferred but never required
    { facingMode: { ideal: 'environment' }, width: { ideal: v.width }, height: { ideal: v.height }, frameRate: { ideal: v.frameRate } },
    { facingMode: { ideal: 'environment' } },
    true,
  ];
  let last;
  for (const video of attempts) {
    try { return await navigator.mediaDevices.getUserMedia({ video, audio: false }); }
    catch (e) { last = e; if (e.name === 'NotAllowedError' || e.name === 'SecurityError') break; }
  }
  throw toCameraError(last);
}

export function stopStream(stream) {
  if (stream) for (const t of stream.getTracks()) t.stop();
}

export class FrameSource {
  /** mode: 'auto' | 'processor' | 'rvfc' */
  constructor(video, stream, onFrame, mode = 'auto') {
    this.video = video; this.stream = stream; this.onFrame = onFrame; this.requested = mode;
    this.running = false;
    this.mode = null;          // 'processor' | 'rvfc' once started
    this.timeSource = null;    // human-readable name of the timestamp used
    this.reader = null;
    this.onError = () => {};
  }

  async start() {
    this.running = true;
    const canProcessor = typeof MediaStreamTrackProcessor === 'function' && typeof VideoFrame === 'function';
    if (this.requested !== 'rvfc' && canProcessor) {
      try { await this._startProcessor(); this.mode = 'processor'; return this.mode; }
      catch (e) {
        if (this.requested === 'processor') throw new CameraError('unsupported', 'Frame timestamps are not available in this browser.');
        this._cancelReader();            // broken/absent implementation -> fall back
      }
    }
    this._startRvfc();
    this.mode = 'rvfc';
    return this.mode;
  }

  stop() {
    this.running = false;
    this._cancelReader();
  }

  _cancelReader() {
    const r = this.reader; this.reader = null;
    if (r) { try { r.cancel(); } catch (_) {} try { r.releaseLock(); } catch (_) {} }
  }

  // ---- 1. VideoFrame path --------------------------------------------------------------
  async _startProcessor() {
    const track = this.stream.getVideoTracks()[0];
    const proc = new MediaStreamTrackProcessor({ track });
    const reader = proc.readable.getReader();
    this.reader = reader;
    // Probe: a processor that never yields a frame must not leave us without a source.
    const first = await Promise.race([
      reader.read(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    if (first.done || !first.value) throw new Error('no frame');
    this.timeSource = 'VideoFrame.timestamp (camera capture clock)';
    this._handleVideoFrame(first.value);
    this._readLoop(reader);
  }

  async _readLoop(reader) {
    while (this.running && this.reader === reader) {
      let r;
      try { r = await reader.read(); } catch (_) { break; }
      if (r.done) break;
      this._handleVideoFrame(r.value);
    }
  }

  _handleVideoFrame(frame) {
    try {
      this.onFrame({
        tsMs: frame.timestamp / 1000,           // microseconds -> ms
        width: frame.displayWidth,
        height: frame.displayHeight,
        suspect: false,                          // pixels and timestamp belong to the same object
        draw: (ctx) => ctx.drawImage(frame, 0, 0),
      });
    } catch (e) { this.onError(e); }
    finally { frame.close(); }                   // always release the camera buffer
  }

  // ---- 2. requestVideoFrameCallback path ---------------------------------------------------
  _startRvfc() {
    const video = this.video;
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
      throw new CameraError('unsupported', 'This browser is too old to provide video frame timing. Update Safari/Chrome.');
    }
    let field = null;   // which metadata field is our clock; fixed after the first frame (never mix clocks)
    const cb = (now, md) => {
      if (!this.running) return;
      video.requestVideoFrameCallback(cb);       // re-arm first: an exception below must not stop capture
      if (field === null) {
        field = typeof md.captureTime === 'number' ? 'captureTime' : 'presentationTime';
        this.timeSource = field === 'captureTime'
          ? 'requestVideoFrameCallback captureTime'
          : 'requestVideoFrameCallback presentationTime (compatibility mode)';
      }
      const ts = md[field];
      const latency = now - md.presentationTime; // how long ago this frame was presented
      try {
        this.onFrame({
          tsMs: typeof ts === 'number' ? ts : NaN,
          width: video.videoWidth,
          height: video.videoHeight,
          suspect: latency > CONFIG.lateCallbackMs,
          draw: (ctx) => ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight),
        });
      } catch (e) { this.onError(e); }
    };
    video.requestVideoFrameCallback(cb);
  }
}
