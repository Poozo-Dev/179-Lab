# Development notes

Things that are **not** in the README: how to work on this project, what to keep, and what to avoid.

## Current state (v1.7.0)

- Classroom-feedback release: 1080p/60 fps request with fallback, zoom/exposure when supported, countdown with
  beeps, level overlay, two-point marking (A red / B blue) with magnifier and 1-px nudges, scale & vertical setup,
  measurement table + CSV, Plot Y(X) with optional masses and centre of mass, frame delete with Undo.
- Recording presets: **0.1 s, 0.2 s, 0.3 s** (0.5 s removed from the chips; the free-typing box still accepts other values).
- Camera screen: state pill, fps pill and **Frames** button are at the **top** (overlaying the video). This was tried at the bottom and reverted on request; keep it at the top.
- The iPhone grey-stripe fix is confirmed working on the real phone. Do not remove it (see "Do not").

## Workflow

- Repo: `https://github.com/Poozo-Dev/179-Lab`, branch `main`, served by GitHub Pages at `https://poozo-dev.github.io/179-Lab/`. A push to `main` is the deploy.
- **Bump `APP_VERSION` in `js/config.js` on every deploy**, so the phone shows which version it runs ("App version … " under *Settings*).
- After a deploy the phone needs **two** opens (the service worker serves the cached copy first, then updates it). Force-close the app between the opens.
- Run unit tests before pushing: `node --test tests/*.test.js` (note the glob; `node --test tests/` fails on Node 22).
- Changing which files the service worker precaches (`sw.js` `SHELL` list) or making a larger shell change: bump `CACHE` in `sw.js` (currently `physlab-shell-v4`).
- The Windows folder `LabCode` on the user's PC is a manual mirror of the repo. Keep it in sync if the user uses it, but never treat it as the source of truth.
- Git commits/PRs created by Claude carry the Co-Authored-By and Claude-Session lines.
- Routine jobs (file search, log reading, renames, one-line edits, simple commands) can go to the `haiku-helper` subagent (`.claude/agents/haiku-helper.md`). CLAUDE.md has the rules.

## Do

- Keep the app **vanilla**: HTML, CSS, JS, no dependencies, no build step, no server, no network calls after first load.
- Keep all data on the phone (IndexedDB). Nothing is uploaded.
- Keep the timing logic in `js/timing.js` (pure, unit-tested). Add tests for any change to it or to `js/measure.js` / `js/geometry.js`.
- Keep the marks in **saved-image pixel coordinates** (raw, never rotated or scaled). Calibrated/rotated values are
  always derived on the fly by `measure.js` (origin bottom-left, y up).
- Keep the **workflow gate** in `measure.analyzeMarks`: plot, masses and centre of mass only when at least one frame
  has BOTH points. One colour only = plain t, x, y table. Never show a plot automatically.
- Keep the quality check honest: a doubtful timing must be flagged, not hidden.
- Test UI changes at a phone size (393×852 or 412×800) with a fake camera before pushing.
- Keep `qr/` in sync with the Pages URL. The QR and poster encode the URL; regenerate them if the URL changes.

## Do not

- **Do not remove or change the standalone stripe fix** in `styles.css` (`html.standalone` class set in `main.js`, the `::after` extension blocks, the `:has(...)` background rules, the gallery visibility rule). It was tested for three rounds; small CSS changes to `html`/`body` backgrounds can bring the grey stripe back.
- **Do not use the class name `rec` for anything except the record button.** The button's circle styling uses `.rec`; a pill with that class got the button's look. The REC pill uses `.pill.rec`.
- **Do not add `setInterval(takePhoto, …)`** or anything that picks frames by timer instead of camera timestamps.
- **Do not fit curves** to the measured trajectories or the centre of mass (the parabola fit was removed on request in v1.7).
- **Do not rotate saved photos**; a vertical reference rotates the measurement axes only.
- **Do not commit credentials**, API keys or personal data (the repo is public).
- **Do not add a backend, accounts or analytics.**
- **Do not commit `.y4m` test videos or screenshots** from the test scratchpad.

## Testing notes (not in the repo)

- Playwright scripts that drive the app with a fake camera (`--use-fake-device-for-media-stream`, `--use-file-for-fake-video-capture=ids.y4m`) live in the session scratchpad only. They need the scratch path as an argument (e.g. `node e2e-mark.mjs <scratch-dir>`).
- Headless Chromium throws `NotSupportedError` without the `--use-fake-ui-for-media-stream` flag.
- Serve the repo with `python3 -m http.server 8100` for tests; restart it if you get "connection refused".

## Open items

- Real-device checks still missing: iPhone/Android camera fps and timestamps, Safari timestamp source (probably the `rvfc` fallback), touch gestures on the marking tool, screen lock behaviour, storage limits.
- Real-device checks for v1.7: 60 fps/1080p availability (iPhone, Android), zoom and manual exposure support,
  level sign/orientation on iOS and Android in portrait and landscape, beep audibility vs. silent switch,
  magnifier/nudge usability on small screens, memory use with 1080p frames at 0.1 s.
- The README's "Updates" section says a redeployed change appears on the second open. The version label is the way to confirm this.
