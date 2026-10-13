// config.js — the only place a teacher/developer needs to touch to change behaviour.
import { DEFAULTS } from './timing.js';

export const APP_VERSION = '1.6 (2026-10-14)';   // shown under "Timing tolerance"; bump when deploying

export const CONFIG = {
  ...DEFAULTS,                       // intervalMs, toleranceMs, gapFactor, maxFrames (see timing.js)
  intervalPresetsMs: [100, 200, 300],
  minIntervalMs: 50,
  maxIntervalMs: 5000,
  toleranceOptionsMs: [10, 15, 25, 40, 60],
  video: { width: 1280, height: 720, frameRate: 30 },   // "ideal" values; the phone may choose differently
  jpegQuality: 0.92,                 // saved images
  thumbWidth: 320,
  // Fallback (requestVideoFrameCallback) path only: if our callback runs this much later than the
  // frame was presented, the canvas may already show a NEWER frame than the timestamp describes.
  lateCallbackMs: 25,
  maxPendingEncodes: 10,             // abort recording if the phone cannot encode/save fast enough
};
