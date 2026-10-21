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
import { t } from './i18n.js';

export class CameraError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function toCameraError(e) {
  if (e instanceof CameraError) return e;
  switch (e && e.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', t('err.denied'));
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('none', t('err.none'));
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('busy', t('err.busy'));
    default:
      return new CameraError('unknown', t('err.unknown'));
  }
}

export async function openCamera() {
  if (!window.isSecureContext) {
    throw new CameraError('insecure', t('err.insecure'));
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new CameraError('unsupported', t('err.unsupported'));
  }
  const v = CONFIG.video;
  // From most to least demanding; rear camera preferred but never required. The high-fps attempt uses
  // `min` so a phone that cannot do it at this size refuses (and we fall back) instead of silently
  // lowering the resolution to reach the frame rate.
  const env = { facingMode: { ideal: 'environment' } };
  const size = { width: { ideal: v.width }, height: { ideal: v.height } };
  const attempts = [
    ...v.frameRates.map((fps, i) => ({ ...env, ...size,
      frameRate: i < v.frameRates.length - 1 ? { ideal: fps, min: fps * 0.8 } : { ideal: fps } })),
    env,
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

/** What the camera really delivers, and which optional controls it supports (detected, never assumed). */
export function cameraInfo(stream) {
  const track = stream && stream.getVideoTracks()[0];
  if (!track) return null;
  let s = {}, c = {};
  try { s = track.getSettings ? track.getSettings() : {}; } catch (_) {}
  try { c = track.getCapabilities ? track.getCapabilities() : {}; } catch (_) {}
  const range = (r) => (r && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min ? r : null);
  const zoom = range(c.zoom);
  const expTime = range(c.exposureTime);
  return {
    width: s.width || null, height: s.height || null, frameRate: s.frameRate || null,
    zoom: zoom ? { min: zoom.min, max: zoom.max, step: zoom.step || 0.1, value: s.zoom ?? zoom.min } : null,
    // exposureTime is in units of 100 µs (W3C Image Capture spec)
    exposure: expTime && Array.isArray(c.exposureMode) && c.exposureMode.includes('manual')
      ? { min: expTime.min, max: expTime.max, modes: c.exposureMode } : null,
    label: track.label || '',
  };
}

/** Apply camera zoom (native constraint only). Returns the zoom actually in effect, or null. */
export async function setZoom(stream, value) {
  const track = stream && stream.getVideoTracks()[0];
  if (!track) return null;
  await track.applyConstraints({ advanced: [{ zoom: value }] });
  try { return track.getSettings().zoom ?? null; } catch (_) { return null; }
}

/** seconds = null -> automatic exposure; otherwise a fixed short exposure time (clamped to what the camera allows). */
export async function setExposure(stream, seconds) {
  const track = stream && stream.getVideoTracks()[0];
  const info = cameraInfo(stream);
  if (!track || !info || !info.exposure) return null;
  if (seconds === null) {
    const mode = info.exposure.modes.includes('continuous') ? 'continuous' : null;
    if (mode) await track.applyConstraints({ advanced: [{ exposureMode: mode }] });
    return null;
  }
  const units = Math.min(info.exposure.max, Math.max(info.exposure.min, seconds * 1e4));
  await track.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: units }] });
  return units / 1e4;
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
        if (this.requested === 'processor') throw new CameraError('unsupported', t('err.noTimestamps'));
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
      throw new CameraError('unsupported', t('err.oldBrowser'));
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
