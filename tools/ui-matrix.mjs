// ui-matrix.mjs — cross-platform usability check (run before every deploy that touches the UI).
// Browser profiles × screen sizes; for every crucial control: on screen, not covered, >= 28 px, and it works.
// Usage: python3 -m http.server 8100 &  then  PWROOT=$(npm root -g)/playwright node tools/ui-matrix.mjs <screenshot-dir>
import { createRequire } from 'module';
const require = createRequire(process.env.PWROOT + '/');
const { chromium } = require('playwright');
const OUT = process.argv[2];
const PROFILES = {
  'chrome-android': { query: '', init: '' },                                   // VideoFrame path, no native zoom (fake cam)
  'native-zoom': { query: '', init: `(() => { const g = MediaStreamTrack.prototype.getCapabilities, s = MediaStreamTrack.prototype.getSettings;
      let z = 1; MediaStreamTrack.prototype.getCapabilities = function () { return { ...g.call(this), zoom: { min: 1, max: 8, step: 0.1 } }; };
      MediaStreamTrack.prototype.getSettings = function () { return { ...s.call(this), zoom: z }; };
      MediaStreamTrack.prototype.applyConstraints = async function (c) { if (c && c.advanced && c.advanced[0].zoom) { z = c.advanced[0].zoom; window.__zoom = z; } }; })();` },
  'broken-zoom': { query: '', init: `(() => { const g = MediaStreamTrack.prototype.getCapabilities;
      MediaStreamTrack.prototype.getCapabilities = function () { return { ...g.call(this), zoom: { min: 1, max: 8, step: 0.1 } }; };
      MediaStreamTrack.prototype.applyConstraints = async function () { throw new DOMException('no', 'OverconstrainedError'); }; })();` },
  // Safari / WebView-style: no VideoFrame processor, no sensors, no Web Audio, no wake lock, no ResizeObserver
  'limited-webview': { query: '?source=rvfc', init: `(() => { for (const k of ['MediaStreamTrackProcessor','ResizeObserver','DeviceOrientationEvent','AudioContext','webkitAudioContext']) { window[k] = undefined; }
      try { Object.defineProperty(navigator, 'wakeLock', { value: undefined }); } catch (_) {}
      try { Object.defineProperty(navigator, 'storage', { value: undefined }); } catch (_) {} })();` },
};
const SIZES = [[280, 560], [360, 640], [412, 915], [740, 360], [1024, 768]];
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
let fails = 0, runs = 0;
for (const [pname, prof] of Object.entries(PROFILES)) for (const [w, h] of SIZES) {
  runs++;
  const lang = runs % 2 ? 'ru' : 'en', touch = w < 900;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: touch, hasTouch: touch, deviceScaleFactor: 2 });
  await ctx.addInitScript(`localStorage.setItem('physlab.lang', '${lang}');` + prof.init);
  const page = await ctx.newPage();
  const errs = [], problems = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  const tap = (sel) => (touch ? page.tap(sel) : page.click(sel));
  // visible, inside the screen, at least 28 px in both directions, and the top-most element at its centre?
  const usable = async (ids) => {
    const r = await page.evaluate((ids) => ids.map((id) => {
      const e = document.getElementById(id); if (!e) return [id, 'missing'];
      if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return [id, 'hidden'];
      const b = e.getBoundingClientRect();
      if (b.width < 28 || b.height < 28) return [id, `too small ${Math.round(b.width)}×${Math.round(b.height)}`];
      if (b.left < -0.5 || b.top < -0.5 || b.right > innerWidth + 0.5 || b.bottom > innerHeight + 0.5) return [id, 'off screen'];
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (!hit || !(hit === e || e.contains(hit))) return [id, 'covered by ' + (hit ? hit.id || hit.className || hit.tagName : '?')];
      return null;
    }).filter(Boolean), ids);
    for (const [id, why] of r) problems.push(`${id}: ${why}`);
  };
  // the live picture must fill its area in one direction (contain), whatever happened before
  const fills = async (label) => {
    const f = await page.evaluate(() => { const v = document.getElementById('preview').getBoundingClientRect(), c = document.getElementById('cam-view').getBoundingClientRect();
      return Math.max(v.width / c.width, v.height / c.height); });
    if (Math.abs(f - 1) > 0.02) problems.push(`preview ${label}: fills only ${Math.round(f * 100)}% of the camera area`);
  };
  try {
    await page.goto('http://localhost:8100/' + prof.query);
    await page.evaluate(async () => { const s = await import('./js/store.js'); await s.clearAll(); });
    await page.reload();
    await page.waitForFunction(() => /Ready|Готово/.test(document.getElementById('hud-state').textContent), null, { timeout: 20000 });
    await page.waitForTimeout(400);
    await usable(['btn-record', 'btn-settings', 'btn-level', 'countdown-sel', 'duration-sel', 'interval-input', 'zoom']);
    await fills('after start');
    await page.setViewportSize({ width: h, height: w }); await page.waitForTimeout(700); await fills('after rotating');
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(700); await fills('after rotating back');
    const camView = await page.evaluate(() => document.getElementById('cam-view').getBoundingClientRect().height / innerHeight);
    if (camView < (h < 400 ? 0.5 : 0.55)) problems.push(`camera view only ${Math.round(camView * 100)}% of screen`);
    await tap('#chips .chip >> nth=0');
    if (await page.getAttribute('#chips .chip >> nth=0', 'aria-pressed') !== 'true') problems.push('interval chip does not select');
    await tap('#btn-settings');
    if (await page.isHidden('#settings-panel')) problems.push('settings panel does not open');
    await page.waitForTimeout(100); await fills('with settings open');
    await usable(['btn-record']);                                       // still reachable with the panel open
    await tap('#btn-settings');
    await page.waitForTimeout(100); await fills('after closing settings');
    await tap('#btn-level'); await page.waitForTimeout(150);
    const lvl = await page.evaluate(() => ({ on: document.getElementById('btn-level').getAttribute('aria-pressed'), msg: !document.getElementById('cam-msg').hidden }));
    if (pname === 'limited-webview' ? !lvl.msg : lvl.on !== 'true') problems.push('level toggle: no effect/explanation ' + JSON.stringify(lvl));
    if (lvl.msg) await page.evaluate(() => { document.getElementById('cam-msg').hidden = true; });
    else await tap('#btn-level');
    await page.$eval('#zoom', (e) => { e.value = 2; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(250);
    const z = await page.evaluate(() => ({ tf: document.getElementById('preview').style.transform, nat: window.__zoom, label: document.getElementById('zoom-val').textContent }));
    const crop = pname !== 'native-zoom';
    if (crop ? z.tf !== 'scale(2)' : z.nat !== 2) problems.push('zoom does not act ' + JSON.stringify(z));
    await page.selectOption('#duration-sel', '1');
    await tap('#btn-record');
    await page.waitForSelector('#screen-gallery:not([hidden])', { timeout: 10000 });
    const sess = await page.evaluate(async () => (await import('./js/store.js')).getSession());
    if (crop && !(sess.crop && (sess.width < sess.crop.fullW || sess.height < sess.crop.fullH))) problems.push('crop zoom not applied to saved photos');
    if (!crop && sess.crop) problems.push('native zoom must not crop');
    await usable(['btn-plot', 'btn-again', 'btn-finish', 'btn-lang']);
    await tap('.tile >> nth=0');
    await page.waitForFunction(() => document.getElementById('v-img').naturalWidth > 0);
    await page.waitForTimeout(150);
    await usable(['v-close', 'v-save', 'v-pa', 'v-pb', 'v-delete', 'v-fit', 'v-prev', 'v-next']);
    const stage = await page.evaluate(() => document.getElementById('v-stage').getBoundingClientRect().height / innerHeight);
    if (stage < (h < 400 ? 0.55 : 0.65)) problems.push(`photo only ${Math.round(stage * 100)}% of screen`);
    await tap('#v-pa');
    await usable(['v-clr']);
    const sb = await page.locator('#v-stage').boundingBox();
    if (touch) await page.touchscreen.tap(sb.x + sb.width * 0.4, sb.y + sb.height * 0.6); else await page.mouse.click(sb.x + sb.width * 0.4, sb.y + sb.height * 0.6);
    await page.waitForTimeout(150);
    const pos1 = await page.textContent('#v-pos');
    if (!/x \d/.test(pos1)) problems.push('tap did not place point A');
    const nudges = await page.$$('#v-fine .nudge');
    if (nudges.length !== 4) problems.push('nudge buttons missing');
    else { await (touch ? nudges[3].tap() : nudges[3].click()); if ((await page.textContent('#v-pos')) === pos1) problems.push('nudge does not move'); }
    const nudgeOk = await page.evaluate(() => [...document.querySelectorAll('#v-fine .nudge')].every((b) => { const r = b.getBoundingClientRect(); return r.height >= 28 && r.bottom <= innerHeight; }));
    if (!nudgeOk) problems.push('nudge buttons too small/off screen');
    await tap('#v-pa');
    await tap('#v-next'); await page.waitForTimeout(150);
    if (!/\b2\b/.test(await page.textContent('#v-title'))) problems.push('next frame does not work');
    await tap('#v-delete'); await page.waitForTimeout(250);
    if (await page.isHidden('#toast')) problems.push('delete gives no undo');
    else { await usable(['toast-undo']); await tap('#toast-undo'); }
    await tap('#v-fit'); await tap('#v-close');
  } catch (e) { problems.push('CRASH ' + e.message.split('\n')[0]); }
  if (errs.length) problems.push('JS errors: ' + errs.join('; '));
  const ok = !problems.length; if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${pname.padEnd(15)} ${String(w + '×' + h).padEnd(9)} ${lang} ${touch ? 'touch' : 'mouse'}${ok ? '' : '\n      ' + problems.join('\n      ')}`);
  if (!ok) await page.screenshot({ path: `${OUT}/fail-${pname}-${w}x${h}.png` }).catch(() => {});
  await ctx.close();
}
console.log(`\n${runs - fails}/${runs} configurations passed`);
await browser.close();
