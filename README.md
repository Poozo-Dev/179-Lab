# PhysLab Camera

A tiny offline-capable web app (PWA) for school physics experiments. It records a camera stream and keeps
**one frame per time step** (default 0.2 s) with its measured timestamp, so students can measure positions
in the images themselves (projectile trajectory, free fall next to a ruler).

Plain HTML + CSS + vanilla JavaScript. No dependencies, no build step, no server code, no accounts, no network
use after the first load. Everything (camera, images, timestamps) stays on the phone.

## Using it

1. Open the site on a phone, allow the camera (rear camera is preferred).
2. Choose the interval (0.2 s default) and press the big red button to **Start**.
3. Do the experiment, press the button again to **Stop**.
4. The **gallery** opens: thumbnails with frame number and time, a timing check, and a table
   (`Frame 4 | Target: 0.600 s | Actual: 0.603 s | Deviation: +3 ms`).
   Tap a thumbnail for the full-size viewer: swipe or ‹ › to change frame, pinch / double-tap / mouse wheel to
   zoom (zoom and position are **kept** when stepping between frames, so an object can be compared against a
   ruler), **Save** stores the image on the phone, **Fit** resets the zoom.
5. **Stopping ≠ finishing.** Frames stay on the phone (also after reloads/restarts) until you press
   **Finish & clear data**. **Record again** also deletes the current frames (after a confirmation).

If the timing check fails (⚠ on frames, red banner) the app tells you to repeat the experiment — it never
silently presents doubtful times as good ones.

## Project layout

```
index.html, styles.css      screens (camera / gallery / viewer)
manifest.webmanifest, sw.js installable + offline (service worker)
icons/                      app icons (tools/make-icons.py regenerates them)
js/config.js                all tunable numbers (interval presets, tolerance options, max frames, JPEG quality…)
js/timing.js                PURE logic: nearest-frame selection, quality checks, formatting  <- unit-tested
js/frame-source.js          camera + frame/timestamp sources (VideoFrame path, requestVideoFrameCallback path)
js/recorder.js              frame selection -> JPEG encoding -> IndexedDB
js/store.js                 IndexedDB wrapper (one experiment at a time)
js/gallery.js               gallery, quality summary, zoomable viewer, saving
js/main.js                  application flow, camera lifecycle, visibility handling
tests/timing.test.js        unit tests (Node's built-in test runner)
```

## Timing architecture (read this before trusting numbers)

**What is *not* done:** no `setInterval(takePhoto, 200)`. JavaScript timers can be late by tens of
milliseconds and say nothing about when the camera actually produced a frame.

**What is done:**

1. The camera runs continuously (`getUserMedia`). Every camera frame arrives *with a timestamp*.
2. The first frame after **Start** is `t0`. Targets are `t0, t0+Δ, t0+2Δ, …`.
3. For each target the frame whose **measured timestamp** is nearest is kept (`FrameSelector` in `timing.js`).
   Only one earlier frame is remembered, so memory use is constant. Frame numbers / nominal fps are never used to
   compute time, so dropped frames and variable frame rates show up as real deviations.
4. For every kept frame the app stores: frame number, target time, actual time, deviation, and the gap
   between the two camera frames around the target.
5. A frame is **flagged** when: |deviation| > tolerance (default ±25 ms, selectable on the camera screen),
   or camera frames were dropped around it (gap > 1.5 × median frame interval), or the same camera frame had to be
   used twice, or the source reports that pixel↔timestamp pairing is doubtful. Any flag fails the timing check.

**Two frame sources** (chosen automatically; `?source=processor` / `?source=rvfc` forces one for testing):

| | `processor` (preferred) | `rvfc` (fallback) |
|---|---|---|
| API | `MediaStreamTrackProcessor` → `VideoFrame` | `video.requestVideoFrameCallback` + canvas |
| Pixels ↔ timestamp | **Same object** → cannot mismatch | Two separate things: metadata and "whatever the `<video>` shows when we draw" |
| Clock | `VideoFrame.timestamp` (camera capture clock) | `captureTime` if the browser provides it, else `presentationTime` |
| Where | Chrome / Android Chrome | everything else, **currently including iOS Safari unless it provides `MediaStreamTrackProcessor`** |

The fallback has an inherent weakness: if our callback runs late, the video element may already show a *newer*
frame than the metadata describes. This cannot be detected directly, so callbacks that run more than 25 ms after
the frame was presented (`lateCallbackMs`) are marked **suspect** and fail the quality check. Remaining risk
on that path: a rare, undetected shift of one frame period (~33 ms at 30 fps).

**Quantisation:** a camera at 30 fps can only deliver frames every 33 ms, so a target that falls between two frames
is off by up to ±16.7 ms. Choose intervals that are multiples of the frame period (0.1, 0.2, 0.3, 0.5 s at 30 fps)
for the best results. The camera's measured frame rate is shown on the camera screen.

**Accuracy statement:** timestamps are those of the browser's camera pipeline, **not** hardware sensor-exposure
times. Expect an absolute uncertainty of roughly one frame period. Intervals *between* frames are expected to be
more consistent than the absolute times (with the synthetic camera below they agreed to < 1 ms; real cameras have
more jitter — measure yours with the stopwatch test), and they are what free-fall / projectile analysis uses.

**Why not record a video and extract frames afterwards?** It would tie timestamps to pixels perfectly, but
`MediaRecorder` output is lossy-compressed, its container timestamps and seeking behave differently on
Safari and Chrome, and frame-accurate extraction needs either a demuxer library or fragile seeking.
That is far more complexity than the live approach, which can be verified and falls back to flagging problems.
If testing on real iPhones shows the `rvfc` path is not trustworthy enough, this is the next option to build.

## Verified so far (desktop Chromium, synthetic camera)

* Unit tests: `npm test` (17 tests: selection, offsets, irregular cadence, ties, dropped frames, duplicates,
  non-monotonic timestamps, tolerance, frame cap, formatting).
* End-to-end in headless Chromium with a fake camera playing a video in which every frame has its index drawn as
  binary blocks: for both paths, **the image kept for each target showed exactly the frame whose timestamp was
  stored (0 frames mismatch)**, also for intervals that are not frame multiples.
* A 400 ms main-thread freeze during recording is **reported** (large deviation + dropped-frame flags), not hidden.
* Gallery survives page reload, works offline after the first visit, reload during recording is reported,
  "Finish & clear" empties the database, 100-frame cap works.

**Not verified (needs real phones):** actual iPhone/Android cameras, Safari's timestamp behaviour, behaviour under
screen lock, low-light frame-rate drops, real storage limits. See the checklist below.

## Local development

No install needed beyond Node ≥ 18 (tests) and any static file server:

```
npm test                     # unit tests
python3 -m http.server 8080  # or: npx serve .   -> http://localhost:8080
```

The camera works on `http://localhost` and on any `https://` address (browsers refuse it on plain http).

## Testing on a phone

* Easiest: deploy (below) and open the https URL on the phone.
* Local network: use an https tunnel (e.g. `npx localtunnel --port 8080`, or Cloudflare Tunnel) —
  `http://192.168.x.x` does **not** get camera access.
* Chrome Android: `chrome://inspect` with USB debugging shows the console of the phone.
  iPhone: Safari → Settings → Advanced → Web Inspector, then Safari on a Mac → Develop menu.

Checklist for the first real-device test:

1. Camera screen shows a sensible fps (30 or 60). Note which source was used (shown under *Timestamp source* in the gallery).
2. Record 10 s at 0.2 s. Banner should be green; deviations small (≤ ~17 ms).
3. Point the phone at a stopwatch / a phone showing a running millisecond counter: the counter values in
   consecutive saved frames should differ by ≈ the interval. **Do this on every phone model you rely on.**
4. Lock the screen during a recording → app must report the interruption.
5. Install to home screen, switch to airplane mode, open again → must work.
6. Save an image from the viewer (iPhone: "Save Image" in the share sheet).

## Free deployment

**GitHub Pages:** push this folder to a repository → Settings → Pages → deploy from branch `main`, folder `/ (root)`.
URL: `https://<user>.github.io/<repo>/`. **Cloudflare Pages:** create a project from the repository, no build command,
output directory `/`. Both serve https and cost nothing.

Installing: iPhone Safari → Share → *Add to Home Screen*. Android Chrome → menu → *Install app*.

Updates: the service worker serves the cached version first and refreshes it in the background, so a redeployed
change appears the **second** time the app is opened. No version number has to be edited.

## Known limitations

* Timestamps are camera-pipeline times, not exposure times (see above). The fallback path is less trustworthy.
* The browser may deliver a different resolution/frame rate than requested (config.js asks for 1280×720 @ 30 fps).
  Low light often lowers the frame rate on phones — the quality check will say so.
* Recording is stopped (not paused) if the app goes to the background, the screen locks, the camera is taken by
  another app, or the phone is rotated. Frames captured until then are kept and the gallery says what happened.
* Only one experiment is kept at a time. Maximum 100 frames per recording (`maxFrames`).
* Safari may delete website data of sites not visited for 7 days *unless the app was added to the Home Screen*.
  Save important images to the phone's photo library right after the experiment.
* Images are JPEG (quality 0.92); thumbnails are separate smaller JPEGs.
* UI language is English.
