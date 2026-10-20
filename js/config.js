// config.js — the only place a teacher/developer needs to touch to change behaviour.
import { DEFAULTS } from './timing.js';

export const APP_VERSION = '1.7.4 (2026-10-20)';   // shown under "Settings"; bump when deploying

export const CONFIG = {
  ...DEFAULTS,                       // intervalMs, toleranceMs, gapFactor, maxFrames (see timing.js)
  intervalPresetsMs: [100, 200, 300],
  minIntervalMs: 50,
  maxIntervalMs: 5000,
  toleranceOptionsMs: [10, 15, 25, 40, 60],
  // Requested camera mode, tried in this order (see frame-source.js). The phone may still choose differently;
  // the mode it really delivers is read back and shown (resolution, measured fps).
  video: { width: 1920, height: 1080, frameRates: [60, 30] },
  jpegQuality: 0.95,                 // saved images (full camera resolution, never downscaled)
  countdownOptionsS: [0, 3, 5, 10],  // 0 = start immediately
  // Short exposure choices offered when the camera supports manual exposure (seconds)
  exposureOptionsS: [1 / 250, 1 / 500, 1 / 1000],
  levelToleranceDeg: 1,              // level overlay turns green within this angle
  thumbWidth: 320,
  // Fallback (requestVideoFrameCallback) path only: if our callback runs this much later than the
  // frame was presented, the canvas may already show a NEWER frame than the timestamp describes.
  lateCallbackMs: 25,
  maxPendingEncodes: 10,             // abort recording if the phone cannot encode/save fast enough
};
